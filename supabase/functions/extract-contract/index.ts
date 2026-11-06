// CRNA Hub — AI contract reading (Edge Function).
//
// Server side of the "Read with AI" button on the Facilities tab and
// on the schedule upload (Account tab). Contract/schedule photos ONLY, and only on the user's
// explicit tap — nothing here runs on page load, on OCR, or on any other
// trigger. The browser resizes photos to <=1024px on the long side
// before sending, and the photos travel once, over HTTPS, to OpenAI;
// they are not stored server-side by this function.
//
// Model: gpt-4o-mini, response_format json_object, the same
// structured-rates prompt as ~/workspace/custom-connectors/custom.openai/
// bin/vision.py (the prompt the Nov 5, 2026 vision test used, which
// returned for the Holzer addendum: regular_daily_rate 2000,
// premium_hourly_rate 250, first_call_hourly_rate 175,
// second_call_weeknight_rate 1000, second_call_weekend_rate 2000).
//
// Auth: verify_jwt at the gateway plus authUserId here, same as
// portal-sync. The OpenAI key comes from Deno.env (OPENAI_API_KEY) only
// — it is never logged, never returned, and never in this repo. Until
// the owner adds it in the Supabase dashboard (Edge Functions ->
// Manage secrets -> OPENAI_API_KEY), every call fails cleanly with
// openai_key_missing and the app shows the setup message instead of
// pretending the read worked.
//
// Response: { ok: true, rates, raw_text, model } where rates is the
// normalised AiContractRates shape (null where the document does not
// state a value — never invented, never 0), or { ok: false, error }
// with a short code. The app maps rates into the same preview-before-
// save flow as on-device OCR: AI fills only blank fields, never
// overwrites a user correction, and the 1st-call hourly math lives in
// the app (weekday 8h x premium + 16h x 1st-call; weekend 24h x
// 1st-call), not here.

import {
  CORS,
  json,
  err,
  authUserId,
} from "../_shared/calendar.ts";
import {
  normalizeAiContract,
  normalizeAiSchedule,
  extractAiContent,
  parseAiResponseText,
} from "./normalize.ts";

const MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_IMAGES = 4;
// A resized JPEG data URL is ~100-400KB of base64; 4 pages stay well
// under this. Anything larger is a client bug, not a contract photo.
const MAX_IMAGE_CHARS = 12_000_000;

// Same structured-rates prompt as vision.py — keep the two in sync.
// Only the keys below are returned; null where a value is not stated;
// amounts are numbers; do not invent any rate.
const PROMPT =
  "Read these photos of a locum contract assignment addendum (Attachment A). " +
  "Return ONLY a JSON object with these keys, using null where a value is not stated: " +
  "facility, address, provider, assignment_dates_text, " +
  "regular_daily_rate, premium_hourly_rate, first_call_hourly_rate, " +
  "second_call_weeknight_rate, second_call_weekend_rate, " +
  "call_bonus, paid_hours_8h, raw_text. " +
  "regular_daily_rate is the 'Regular Daily Rate' (minimum 8 hrs). " +
  "premium_hourly_rate is the 'Premium Hourly Rate' (applies after 8 hours). " +
  "first_call_hourly_rate is the hourly rate for 1st call. " +
  "Amounts are numbers without $ or commas. Do not invent any rate.";

// Schedule-photo mode (Nov 5, 2026): photos of a STAFF SCHEDULE, not a
// contract. The model returns ONLY shifts for the named person —
// matching the name as it appears on the schedule, in any of its forms
// ("C. Martin", "Martin, Caleb", "Caleb Martin"). Rows for anyone else
// are left out entirely; the client still classifies every returned row
// before showing the preview. Dates are YYYY-MM-DD; when a date has no
// year, use the current year. Never invent a shift, a date, or a name.
function schedulePrompt(scheduleName: string): string {
  return (
    "Read these photos of a staff schedule. " +
    "Return ONLY a JSON object with these keys: shifts (an array) and raw_text. " +
    "Each shift has date (YYYY-MM-DD), facility, type (one of: 8-hour day, 10-hour shift, 12-hour shift, 24-hour call, Second call, Other, Off / PTO), and name (the person the shift belongs to, exactly as printed). " +
    "Include ONLY shifts for the person named '" + scheduleName + "' — match the name in any of its printed forms. " +
    "Leave out every shift that belongs to anyone else. " +
    "If no shift for that person is visible, return an empty shifts array. " +
    "Do not invent any shift."
  );
}

const KEY_MISSING_MESSAGE =
  "AI reading isn't set up yet — add the OpenAI key in Supabase (Edge Functions → Manage secrets → OPENAI_API_KEY)";

function imagesFromBody(
  body: Record<string, unknown>,
): { images: string[] } | { error: string; status: number } {
  const raw = body.images ?? (body.image !== undefined ? [body.image] : null);
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "missing_images", status: 400 };
  }
  if (raw.length > MAX_IMAGES) {
    return { error: "too_many_images", status: 400 };
  }
  for (const item of raw) {
    if (
      typeof item !== "string" ||
      !item.startsWith("data:image/") ||
      item.length > MAX_IMAGE_CHARS
    ) {
      return { error: "invalid_image", status: 400 };
    }
  }
  return { images: raw as string[] };
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
    const mode = body.mode === "schedule" ? "schedule" : "contract";
    const scheduleName = typeof body.scheduleName === "string"
      ? body.scheduleName.trim()
      : "";
    if (mode === "schedule" && !scheduleName) {
      return err("missing_schedule_name", 400);
    }
    const parsed = imagesFromBody(body);
    if ("error" in parsed) return err(parsed.error, parsed.status);

    // The key lives only in the function's own environment. It is read
    // here, used for this one request, and never logged or returned.
    const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!apiKey) {
      return json(
        { ok: false, error: "openai_key_missing", message: KEY_MISSING_MESSAGE },
        503,
      );
    }

    const content: Record<string, unknown>[] = [
      {
        type: "text",
        text: mode === "schedule" ? schedulePrompt(scheduleName) : PROMPT,
      },
      ...parsed.images.map((url) => ({
        type: "image_url",
        image_url: { url, detail: "high" },
      })),
    ];

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
          messages: [{ role: "user", content }],
          response_format: { type: "json_object" },
          max_tokens: 2000,
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
          message: `OpenAI returned HTTP ${res.status} — try again, or use on-device OCR.`,
        },
        502,
      );
    }
    const envelope: unknown = await res.json().catch(() => null);
    const text = extractAiContent(envelope);
    if (!text) {
      return json(
        {
          ok: false,
          error: "openai_bad_response",
          message:
            "OpenAI answered without readable contract data — try again, or use on-device OCR.",
        },
        502,
      );
    }
    const raw = parseAiResponseText(text);
    if (raw === null) {
      return json(
        {
          ok: false,
          error: "openai_bad_response",
          message:
            "OpenAI answered without readable " +
            (mode === "schedule" ? "schedule" : "contract") +
            " data — try again, or use on-device OCR.",
        },
        502,
      );
    }
    if (mode === "schedule") {
      const shifts = normalizeAiSchedule(raw);
      const rawText = (raw as Record<string, unknown>)["raw_text"];
      return json({
        ok: true,
        mode: "schedule",
        shifts,
        raw_text: typeof rawText === "string" ? rawText : "",
        model: MODEL,
      });
    }
    const rates = normalizeAiContract(raw);
    return json({ ok: true, rates, raw_text: rates.raw_text, model: MODEL });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return json(
        {
          ok: false,
          error: "openai_error",
          message:
            "OpenAI took too long to answer — try again, or use on-device OCR.",
        },
        502,
      );
    }
    return err("extract_failed", 502);
  }
});
