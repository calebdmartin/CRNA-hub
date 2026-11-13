// CRNA Hub — live Assistant chat (Edge Function).
//
// Server side of the Assistant tab. FINAL native-app form: the Assistant
// is a live AI model, not deterministic in-app logic alone. The client
// (askAssistantLive / callAssistantChat in app.js) calls this function
// through the same-origin proxy (api/fn.js) with the user's own Supabase
// auth token, and this function calls OpenAI (gpt-4o-mini) server-side.
//
// What the model receives — and what it NEVER receives:
//   * Receives: the user's question (max 500 chars) plus a minimal
//     structured summary the client builds from the user's own records
//     (counts, totals, the next few shifts, credential deadlines,
//     facility names + rates, mileage totals, PTO balance, CE totals).
//   * NEVER receives: facility notes or codes, shift notes, document
//     text or filenames, passwords, patient information, addresses,
//     emails, or phone numbers. The client builds the summary from an
//     allowlist by construction, and this function ALSO validates the
//     summary server-side: any key on the denylist below (or any nested
//     object that is not a plain JSON value) rejects the request with
//     bad_summary. A document's contents are never sent, and are never
//     requested — the model answers from the summary only, and says
//     plainly when the summary does not hold the answer.
//   * Nothing here is stored or logged: no question, no summary, no
//     answer is written anywhere. The request lives for one call.
//
// Auth: verify_jwt at the gateway plus authUserId here, same as
// extract-contract. The OpenAI key comes from Deno.env (OPENAI_API_KEY)
// only — the SAME secret extract-contract uses, so the owner sets it
// once in the Supabase dashboard (Edge Functions -> Manage secrets ->
// OPENAI_API_KEY). It is never logged, never returned, and never in
// this repo. Until it is set, every call fails cleanly with
// openai_key_missing and the app falls back to its deterministic
// on-device answers, labelled honestly.
//
// Rate limits (documented here and in the app):
//   * Client: at most one live call per 10 seconds, never more than one
//     in flight (ASSISTANT_MIN_INTERVAL_MS / assistantChatBusy in app.js).
//   * This function: a best-effort per-user throttle — 1 request per 10s
//     and 30 requests per rolling hour, per authenticated user. It is
//     best-effort because Edge Function instances are ephemeral: the
//     throttle lives in this instance's memory and does not survive a
//     cold start or a second instance. The DURABLE per-user cap is
//     final-only and NOT built here: an `assistant_chat_log` table
//     (user_id, created_at) with a count query per request, to be added
//     with the native-app backend migration. Until then, the in-memory
//     throttle plus the client limit are the enforced limits.
//   * A throttled request gets { ok: false, error: "rate_limited" }
//     (429) and the client falls back to on-device answers.
//
// No clinical advice: the system prompt refuses clinical questions and
// redirects to facility protocols / a current clinical reference / a
// qualified colleague. CRNA Hub is an administrative assistant, not
// clinical decision support, and holds no patient information.
//
// Response: { ok: true, answer, model } or { ok: false, error, message }
// with a short code. The provider's response body is never forwarded:
// it can carry request echoes and is not needed to explain a failure.
//
// DEPLOYED Nov 5, 2026 (assistant-chat v1, verify_jwt on; OPENAI_API_KEY
// set in Supabase secrets). Redeploy with:
//   supabase functions deploy assistant-chat
// If the function or the key is ever unavailable, the Assistant tab's
// live call fails and the app falls back to deterministic on-device
// answers, labelled "On-device answer".

import {
  CORS,
  json,
  err,
  authUserId,
} from "../_shared/calendar.ts";

const MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_QUESTION_CHARS = 500;
const MAX_SUMMARY_CHARS = 20_000;
// Best-effort per-user throttle (see header: ephemeral, not durable).
const MIN_INTERVAL_MS = 10_000;
const MAX_PER_HOUR = 30;
const HOUR_MS = 3_600_000;

// Keys that must never appear in a summary, at any depth. The client
// never sends them; this is the server-side backstop.
const DENIED_KEYS = new Set([
  "notes",
  "note",
  "password",
  "code",
  "codes",
  "document",
  "documents",
  "patient",
  "email",
  "address",
  "phone",
  "ssn",
  "dob",
  "filename",
  "fileName",
]);

// Top-level summary keys the client is allowed to send. Anything else
// is rejected — the summary shape is fixed, not free-form.
const ALLOWED_TOP_KEYS = new Set([
  "today",
  "month",
  "year",
  "upcoming",
  "credentials",
  "facilities",
  "mileage",
  "pto",
  "ce",
]);

const SYSTEM_PROMPT =
  "You are the CRNA Hub assistant, an administrative assistant for an " +
  "independent locum CRNA. " +
  "CRNA Hub is a scheduling and admin app for CRNAs: it keeps shifts from every facility in one calendar, forecasts income and paychecks from recorded shifts and facility rates, logs mileage, and tracks licenses, certifications and continuing education with expiry reminders." +
  " Answer ONLY from the structured summary " +
  "provided — counts, totals, and the next few shifts from the user's " +
  "own records. Never invent a shift, rate, date, or credential the " +
  "summary does not state; if the summary does not hold the answer, " +
  "say so plainly and say what record would answer it. Keep answers " +
  "short, numbers-first, and in plain language. Income figures are " +
  "estimates from recorded shifts, not paid income — say so when you " +
  "quote one. You cannot answer clinical questions: if asked about a " +
  "patient, a diagnosis, a treatment, a drug or dose, or any clinical " +
  "decision, refuse briefly and point to facility protocols, a current " +
  "clinical reference, or a qualified colleague. You hold no patient " +
  "information and must never ask for any. " +
  "In the credentials section, onFile lists everything recorded and " +
  "dueSoon lists only what is expired or due within its reminder " +
  "window; an empty dueSoon never means no credentials are on file — " +
  "when dueSoon is empty, say nothing is expiring soon and name the " +
  "soonest item in onFile.";

function isPlainValue(v: unknown): boolean {
  if (v === null) return true;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.every(isPlainValue);
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).every(
      ([k, val]) => !DENIED_KEYS.has(k) && isPlainValue(val),
    );
  }
  return false;
}

function summaryIsClean(summary: unknown): boolean {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
  const obj = summary as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_TOP_KEYS.has(k)) return false;
  }
  return isPlainValue(obj);
}

// Best-effort per-user throttle. userId -> { lastAt, stamps[] }.
// Ephemeral by design (see header): a cold start or a second instance
// resets it. The durable cap is the assistant_chat_log table, final-only.
const throttle = new Map<string, { lastAt: number; stamps: number[] }>();

function throttled(userId: string, now: number): boolean {
  const rec = throttle.get(userId);
  if (!rec) {
    throttle.set(userId, { lastAt: now, stamps: [now] });
    return false;
  }
  if (now - rec.lastAt < MIN_INTERVAL_MS) return true;
  rec.stamps = rec.stamps.filter((t) => now - t < HOUR_MS);
  if (rec.stamps.length >= MAX_PER_HOUR) return true;
  rec.lastAt = now;
  rec.stamps.push(now);
  return false;
}

function questionFromBody(
  body: Record<string, unknown>,
): { question: string; summary: unknown } | { error: string; status: number } {
  const q = body.question;
  if (typeof q !== "string" || !q.trim()) {
    return { error: "missing_question", status: 400 };
  }
  if (q.trim().length > MAX_QUESTION_CHARS) {
    return { error: "question_too_long", status: 400 };
  }
  const summary = body.summary;
  if (!summaryIsClean(summary)) {
    return { error: "bad_summary", status: 400 };
  }
  if (JSON.stringify(summary).length > MAX_SUMMARY_CHARS) {
    return { error: "summary_too_large", status: 400 };
  }
  return { question: q.trim(), summary };
}

function extractAnswer(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object") return null;
  const choices = (envelope as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const first = choices[0] as Record<string, unknown>;
  const msg = first.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (typeof content !== "string" || !content.trim()) return null;
  return content.trim();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return err("method_not_allowed", 405);
  }
  try {
    const userId = await authUserId(req);
    if (!userId) return err("not_signed_in", 401);

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") return err("bad_request", 400);
    if (body.action !== "chat") return err("action_not_allowed", 400);
    const parsed = questionFromBody(body);
    if ("error" in parsed) return err(parsed.error, parsed.status);

    if (throttled(userId, Date.now())) {
      return json(
        {
          ok: false,
          error: "rate_limited",
          message:
            "Too many assistant questions — wait a moment and try again. The on-device answer is still available.",
        },
        429,
      );
    }

    // The key lives only in the function's own environment. It is read
    // here, used for this one request, and never logged or returned.
    const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!apiKey) {
      return json(
        {
          ok: false,
          error: "openai_key_missing",
          message:
            "AI assistant isn't set up yet — add the OpenAI key in Supabase (Edge Functions → Manage secrets → OPENAI_API_KEY)",
        },
        503,
      );
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content:
                "Summary of my records (counts and totals only):\n" +
                JSON.stringify(parsed.summary) +
                "\n\nMy question: " +
                parsed.question,
            },
          ],
          temperature: 0.2,
          max_tokens: 800,
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // The provider's response body is never forwarded: it can carry
      // request echoes and is not needed to explain the failure.
      return json(
        {
          ok: false,
          error: "openai_error",
          message: `OpenAI returned HTTP ${res.status} — try again, or use the on-device answer.`,
        },
        502,
      );
    }
    const envelope: unknown = await res.json().catch(() => null);
    const answer = extractAnswer(envelope);
    if (!answer) {
      return json(
        {
          ok: false,
          error: "openai_bad_response",
          message:
            "OpenAI answered without readable text — try again, or use the on-device answer.",
        },
        502,
      );
    }
    return json({ ok: true, answer, model: MODEL });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return json(
        {
          ok: false,
          error: "openai_error",
          message:
            "OpenAI took too long to answer — try again, or use the on-device answer.",
        },
        502,
      );
    }
    return err("chat_failed", 502);
  }
});
