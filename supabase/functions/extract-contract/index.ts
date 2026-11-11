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
//
// Pay-stub mode (Nov 5, 2026, mode: "paystub"): photos of a pay stub
// return { ok: true, mode: "paystub", paystub, raw_text, model } where
// paystub is the normalised AiPaystub shape (employer, facility,
// frequency, period_start, period_end, pay_date, gross_pay, net_pay —
// null where the stub does not state a value). The client builds one
// pay schedule per agency from the frequency + pay date and shows a
// preview before saving anything; the stub photo itself is never
// stored, server-side or client-side.
//
// Portal-check mode (Nov 6, 2026, mode: "portal"): photos of a
// credentialing portal page the user signed into THEMSELVES (NBCRNA /
// AANA / a state board lookup — body.portalSource says which) return
// { ok: true, mode: "portal", portal, raw_text, model } where portal
// is the normalised AiPortalCheck shape (status, number, period /
// renewal dates, Class A / B and MAC Ed / Dev progress, license
// fields — null where the page does not state a value). The client
// shows the extraction as the check's preview report and saves
// nothing until the user approves it. No portal password is ever
// involved: the user signs in on the portal's own page and brings
// back a screenshot of the record page.

import {
  CORS,
  json,
  err,
  authUserId,
} from "../_shared/calendar.ts";
import {
  normalizeAiContract,
  normalizeAiPaystub,
  normalizeAiPortalCheck,
  normalizeAiScheduleRead,
  normalizeAiGridLocate,
  normalizeAiBandRead,
  normalizeAiRule,
  extractAiContent,
  parseAiResponseText,
} from "./normalize.ts";

const MODEL = "gpt-4o-mini";
// Schedule reads stay on mini (Nov 6, 2026 reliability pass): the
// stronger gpt-4o was tried live for schedule mode and was WORSE on
// a dense grid — it pattern-completed blank cells into invented
// shifts (14 cells where 5 exist) and returned zero on another run.
// Mini at temperature 0 is near-deterministic; its residual grid
// errors (row bleed on ultra-dense photos) are what the client's
// double-read reconciliation + preview-before-save exist to catch.
// The model choice was measured, not assumed — see the reliability
// test header for the run data.
const SCHEDULE_MODEL = MODEL;
// Grid band sub-modes (Nov 7, 2026) use gpt-4o, measured live on
// the fixture grid the same day: on the band composite, mini
// anchored its transcription to the wide shaded label columns and
// placed every code ~4 columns early (0/5 across a dozen runs and
// four composite variants), while gpt-4o read the composite
// exactly — 5/5 cells in the right columns, 2/2 runs — AND its
// locate pass enumerated all 43 rows including the 2 blank-label
// rows mini silently skipped (41). This does NOT contradict the
// Nov 6 note above: that measurement was the FULL-PHOTO grid read,
// where 4o invented cells. Full-photo schedule reads stay on mini;
// only the two new band sub-modes (locate, band) use 4o.
const GRID_BAND_MODEL = "gpt-4o";
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

// Schedule-photo mode (Nov 5, 2026; grid schedules Nov 6, 2026):
// photos of a STAFF SCHEDULE, not a contract. The model returns ONLY
// shifts for the named person — matching the name as it appears on
// the schedule, in any of its forms ("C. Martin", "Martin, Caleb",
// "Caleb Martin"). Rows for anyone else are left out entirely; the
// client still classifies every returned row before showing the
// preview. Dates are YYYY-MM-DD; when a date has no year, use the
// current year. Never invent a shift, a date, or a name.
//
// Nov 6, 2026: the first grid photo (names down the left, dates
// across the top, short codes like "5**" in the cells) returned zero
// shifts — the old prompt described only list schedules, so the
// model had no way to reconstruct rows x columns, and the normalizer
// then dropped every facility-less cell. The prompt now teaches the
// grid layout explicitly: find the named person's ROW, take each
// column's date from the HEADER row, and return one shift per
// non-blank cell with the code VERBATIM. Codes are never interpreted
// — no times, hours, or meanings are invented for them.
function schedulePrompt(scheduleName: string): string {
  return (
    "Read these photos of a staff schedule. This is a transcription task: copy exactly what is printed, nothing more. " +
    "Return ONLY a JSON object with these keys: shifts (an array), header_dates (an array), and raw_text. " +
    "Include ONLY shifts for the person named '" + scheduleName + "' — match the name in any of its printed forms. " +
    "Leave out every shift that belongs to anyone else. " +
    "If no shift for that person is visible, return an empty shifts array. " +
    "Do not invent any shift. " +
    "LIST schedules (one shift per line or row, with words like '8-hour day' or 'Second call'): each shift has date (YYYY-MM-DD), facility, type (one of: 8-hour day, 10-hour shift, 12-hour shift, 24-hour call, Second call, Other, Off / PTO), name (the person the shift belongs to, exactly as printed), code null, column null. header_dates is an empty array for a list schedule. " +
    "GRID schedules (a table: people's names down the left side, dates across the top header row, and a short code in each cell): work in this exact order. " +
    "STEP 1 — header first: read the header row at the top and return header_dates as an array with ONE entry per date column, left to right, each entry the header text exactly as printed (headers look like '23-Nov', '1-Dec', 'Nov 23'). Count the columns carefully — every date column gets an entry, in order. " +
    "STEP 2 — find the row whose name matches '" + scheduleName + "' (the row label may be just a last name). Stay strictly inside that one row's horizontal band: codes printed in the rows directly above or below belong to OTHER people, even when they look similar — never include them. " +
    "STEP 3 — return one shift for each NON-BLANK cell in that row: column = the cell's column position (1 for the first date column, 2 for the second, and so on, matching the header_dates order), date = that column's header date (YYYY-MM-DD; when a header has no year, use the current year), code = the cell's text EXACTLY as printed (for example '5**', '5*', '7', 'NC1'), type null, facility null, name = the row's name exactly as printed. " +
    "Blank cells are not shifts — skip them. " +
    "Before answering, re-check every cell you listed: its column number must line up under the header date you gave it, and the code must come from '" + scheduleName + "'s row only. " +
    "NEVER interpret a grid code: do not turn it into hours, times, or a shift-type name, and do not copy codes from anyone else's row."
  );
}

// Grid LOCATE pass (Nov 7, 2026, schedule sub-mode locate: true):
// structure only — the header dates and every data row's name
// label, in order. Deliberately NO bounding boxes: measured live,
// the model's freehand coordinates were far too coarse to crop by.
// The client pairs these labels with geometric line detection on
// the original photo to find the matched row's exact band.
function gridLocatePrompt(): string {
  return (
    "This photo shows a staff schedule GRID: people's names run down the left side and dates run across a header row near the top, with short codes in the cells. " +
    "This is a locating task only — do NOT transcribe any shift codes. " +
    "Return ONLY a JSON object with these keys: is_grid (true when this layout is present), " +
    "header_dates (the header row's date labels, one per date column, left to right, exactly as printed), " +
    "row_labels (an array with the name label of EVERY data row, top to bottom, exactly as printed — include a row even when its label is blank, as an empty string; do NOT include the header row or any totals / footer rows). " +
    "Count the data rows carefully — one entry per row, in order."
  );
}

// Grid BAND pass (Nov 7, 2026, schedule sub-mode band: true): the
// image is a composite the app built from ONE grid photo — the date
// header band stacked directly above the matched person's row band,
// both from the original full-resolution photo, columns aligned,
// with a red column number printed in the margin above each column.
// The model transcribes it as a per-column cells array so position
// comes from the array itself. Measured on Caleb's fixture grid
// (gpt-4o, dates-only composite): 5/5 true cells in the right
// columns, 2/2 runs, vs 0/5 for the full-photo read. (gpt-4o-mini
// mis-anchored the same composite by ~4 columns — see
// GRID_BAND_MODEL.) Any residual disagreement with the full-photo
// read is surfaced by the client's cross-check, never silently
// trusted.
function gridBandPrompt(scheduleName: string): string {
  return (
    "This image is a close-up composite made from ONE grid schedule photo. It has TWO horizontal strips from the same photo, lined up column for column: " +
    "the TOP strip is the grid's date header row, and the BOTTOM strip is the single schedule row for '" + scheduleName + "', enlarged. " +
    "A red number is printed in the top margin above each column, starting at 1. " +
    "This is a transcription task: copy exactly what is printed in the BOTTOM strip, nothing more. " +
    "Return ONLY a JSON object with these keys: cells (an array), header_dates (an array), and raw_text. " +
    "header_dates: read the TOP strip — one entry per date column, left to right, exactly as printed. " +
    "cells: an array with EXACTLY one entry per column, in the same left-to-right order as header_dates — the entry is the code printed in the BOTTOM strip's cell for that column, copied EXACTLY (for example '5**', '5*', '7', 'NC1'), or an empty string \"\" when that cell is blank. " +
    "Include EVERY column, blank or not — the array length must equal the number of header_dates. Do not skip blank columns and do not merge columns. " +
    "Everything visible in the bottom strip belongs to the one row — there is no other person's row in this image. " +
    "NEVER interpret a code: do not turn it into hours, times, or a shift-type name."
  );
}

// Pay-stub mode (Nov 5, 2026): photos of a PAY STUB, one stub per
// agency. The model returns ONLY this check's facts — employer, pay
// frequency, pay period, pay date, gross and net for this check — and
// never invents a future payday: the client derives every future date
// from the frequency + pay date. Dates are YYYY-MM-DD. Amounts are
// numbers. Null where the stub does not state a value; never invent
// an employer, a date, or an amount.
function paystubPrompt(): string {
  return (
    "Read these photos of a pay stub. " +
    "Return ONLY a JSON object with these keys, using null where a value is not stated: " +
    "employer, facility, frequency, period_start, period_end, pay_date, gross_pay, net_pay, raw_text. " +
    "employer is the employer / agency name printed on the stub. " +
    "facility is the hospital / facility name only when the stub prints one, else null. " +
    "frequency is one of: weekly, biweekly, semi-monthly, monthly — the pay frequency stated on the stub, or inferred from the pay period (7 days weekly, 14 days biweekly, about 15 days semi-monthly, about a month monthly); null when it cannot be told. " +
    "period_start and period_end are the pay period dates (YYYY-MM-DD). " +
    "pay_date is the pay date / check date of this check (YYYY-MM-DD). " +
    "gross_pay is the gross pay for this check, net_pay the net pay for this check — current-period amounts, not year-to-date. " +
    "Amounts are numbers without $ or commas. Do not invent any value."
  );
}

// Plain-language rule mode (Nov 6, 2026, mode: "rule"): NO photos.
// The user describes a pay rule in their own words in the contract
// chat box; the model returns a STRUCTURED rule (see normalizeAiRule)
// plus, when part of the description is ambiguous, ONE short
// clarifying question instead of a guess. The model never computes
// pay totals — the app's deterministic income engine does that from
// the structured fields. The conversation so far (ruleHistory) is
// included so a follow-up answer refines the same rule.
function rulePrompt(): string {
  return (
    "A CRNA describes a pay rule for one shift type in their own words. " +
    "Return ONLY a JSON object with these keys, using null where the description does not state a value: " +
    "shift_type (one of: '24-hour call', 'Second call', '8-hour day', '10-hour shift', '12-hour shift', 'Other'), " +
    "applies_to (one of: 'weekday', 'weekend', 'both' — which days this rule covers), " +
    "hourly_rate, first_call_hourly_rate, flat_rate, weekend_flat_rate, second_call_rate, weekend_second_call_rate, call_bonus, " +
    "segments (an array of {hours, rate, from, to, label} for time-based parts, e.g. first 8 hours at one rate then the rest at another; from/to are clock times like '15:00' and '07:00' when stated, else null), " +
    "summary (one short plain-language sentence restating the rule, rates only — do NOT compute any total pay), " +
    "clarifying_question (ONE short question when something important is ambiguous — e.g. whether the rule also applies on weekends, or which hours a rate covers — else null), " +
    "missing (an array of short labels for important values the description does not state). " +
    "For a segmented 24-hour / 1st call rule like 'first 8 hours $300/hr, then $200/hr from 4pm to 6am': shift_type '24-hour call', hourly_rate 300, first_call_hourly_rate 200, segments [{hours:8, rate:300}, {hours:16, rate:200, from:'16:00', to:'06:00'}], and if the description does not say whether weekends differ, applies_to null with a clarifying_question asking about weekends. " +
    "Amounts are numbers without $ or commas. Do not invent any rate, hour count, or day applicability."
  );
}

// Portal-check mode prompt: the record page for one credentialing
// portal. Only what the page states — the client treats the result as
// a preview report, never as a verified pull, and saves nothing
// until the user approves it.
function portalPrompt(source: string): string {
  const which = source === "aana"
    ? "an AANA member page (membership status / CE transcript)"
    : source === "licenses"
    ? "a state board of nursing license lookup result page"
    : "an NBCRNA certification record page";
  return (
    "Read these photos of " + which + ". The user signed in themselves and photographed the page that lists their record. " +
    "Return ONLY a JSON object with these keys, using null where the page does not state a value: " +
    "status, number, period_start, period_end, renewal_deadline, class_a, class_b, mac_ed, mac_dev, check_status, expiration, license_type, issue_date, expiry, state, raw_text. " +
    "status is the certification / membership / license status exactly as printed (e.g. Certified, Active). " +
    "number is the certification / membership / license number. " +
    "period_start and period_end are the certification period dates (YYYY-MM-DD); renewal_deadline is the renewal / recertification deadline when the page states one. " +
    "class_a and class_b are CE credit totals; mac_ed and mac_dev are the MAC Ed / MAC Dev credit totals — numbers without commas. check_status is the CPC check-in / MAC Check status exactly as printed (e.g. Complete), or null when the page does not state one. " +
    "expiration is a membership expiration date; license_type is APRN or RN; issue_date and expiry are the license issue and expiration dates; state is the licensing state when printed. " +
    "raw_text is the full text visible on the page. Do not invent any value."
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
    const mode = body.mode === "schedule" ? "schedule" : body.mode === "paystub" ? "paystub" : body.mode === "rule" ? "rule" : body.mode === "portal" ? "portal" : "contract";
    const portalSource = typeof body.portalSource === "string" &&
      ["nbcrna", "aana", "licenses"].includes(body.portalSource)
      ? body.portalSource
      : "nbcrna";
    const scheduleName = typeof body.scheduleName === "string"
      ? body.scheduleName.trim()
      : "";
    if (mode === "schedule" && !scheduleName) {
      return err("missing_schedule_name", 400);
    }
    // Rule mode is text-only: the user's own words plus the short
    // conversation so far. No images are accepted or required.
    let ruleText = "";
    let ruleHistory: { role: string; text: string }[] = [];
    if (mode === "rule") {
      ruleText = typeof body.ruleText === "string" ? body.ruleText.trim().slice(0, 2000) : "";
      if (!ruleText) return err("missing_rule_text", 400);
      if (Array.isArray(body.ruleHistory)) {
        ruleHistory = body.ruleHistory.slice(-6).filter((h): h is Record<string, unknown> =>
          !!h && typeof h === "object" && !Array.isArray(h) && typeof (h as Record<string, unknown>)["text"] === "string"
        ).map((h) => ({
          role: (h as Record<string, unknown>)["role"] === "assistant" ? "assistant" : "user",
          text: String((h as Record<string, unknown>)["text"]).slice(0, 1000),
        }));
      }
    }
    const parsed = mode === "rule" ? { images: [] as string[] } : imagesFromBody(body);
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

    const ruleConversation = mode === "rule"
      ? (ruleHistory.length
        ? "\n\nConversation so far:\n" + ruleHistory.map((h) => (h.role === "assistant" ? "Assistant: " : "User: ") + h.text).join("\n") + "\n"
        : "") +
        "\nThe user's latest description: " + ruleText
      : "";
    const content: Record<string, unknown>[] = [
      {
        type: "text",
        text: mode === "schedule" ? (body.locate === true ? gridLocatePrompt() : body.band === true ? gridBandPrompt(scheduleName) : schedulePrompt(scheduleName)) : mode === "paystub" ? paystubPrompt() : mode === "rule" ? rulePrompt() + ruleConversation : mode === "portal" ? portalPrompt(portalSource) : PROMPT,
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
          model: mode === "schedule" ? (body.locate === true || body.band === true ? GRID_BAND_MODEL : SCHEDULE_MODEL) : MODEL,
          messages: [{ role: "user", content }],
          response_format: { type: "json_object" },
          max_tokens: 2000,
          // Transcription, not creation (Nov 6, 2026 reliability
          // pass): until now NO temperature was sent, so the API's
          // default (1.0) applied — and the same grid photo returned
          // three different answers across three runs. temperature 0
          // + a fixed seed pin the read to the model's most likely
          // transcription. (OpenAI does not promise bitwise-identical
          // output even at temperature 0 — the grid flow additionally
          // reads twice and reconciles; see the client.)
          temperature: 0,
          seed: 20261106,
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
            (mode === "schedule" ? "schedule" : mode === "paystub" ? "pay stub" : mode === "portal" ? "portal page" : "contract") +
            " data — try again, or use on-device OCR.",
        },
        502,
      );
    }
    if (mode === "schedule" && body.locate === true) {
      const loc = normalizeAiGridLocate(raw);
      return json({
        ok: true,
        mode: "schedule",
        locate: true,
        is_grid: loc.isGrid,
        header_dates: loc.headerDates,
        row_labels: loc.rowLabels,
        model: GRID_BAND_MODEL,
      });
    }
    if (mode === "schedule" && body.band === true) {
      const read = normalizeAiBandRead(raw, scheduleName);
      const rawText = (raw as Record<string, unknown>)["raw_text"];
      return json({
        ok: true,
        mode: "schedule",
        band: true,
        shifts: read.shifts,
        header_dates: read.headerDates,
        raw_text: typeof rawText === "string" ? rawText : "",
        model: GRID_BAND_MODEL,
      });
    }
    if (mode === "schedule") {
      const read = normalizeAiScheduleRead(raw);
      const rawText = (raw as Record<string, unknown>)["raw_text"];
      return json({
        ok: true,
        mode: "schedule",
        shifts: read.shifts,
        // The grid header dates as transcribed (YYYY-MM-DD, "" where
        // a header cell could not be read). The client compares the
        // two reads' headers and cells when it reconciles a grid.
        header_dates: read.headerDates,
        raw_text: typeof rawText === "string" ? rawText : "",
        model: SCHEDULE_MODEL,
      });
    }
    if (mode === "paystub") {
      const paystub = normalizeAiPaystub(raw);
      const rawText = (raw as Record<string, unknown>)["raw_text"];
      return json({
        ok: true,
        mode: "paystub",
        paystub,
        raw_text: typeof rawText === "string" ? rawText : "",
        model: MODEL,
      });
    }
    if (mode === "rule") {
      const rule = normalizeAiRule(raw);
      return json({ ok: true, mode: "rule", rule, model: MODEL });
    }
    if (mode === "portal") {
      const portal = normalizeAiPortalCheck(raw);
      const rawText = (raw as Record<string, unknown>)["raw_text"];
      return json({
        ok: true,
        mode: "portal",
        portal,
        raw_text: typeof rawText === "string" ? rawText : (portal.raw_text ?? ""),
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
