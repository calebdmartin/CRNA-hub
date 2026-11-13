// CRNA Hub — pure parsing / normalisation for the extract-contract Edge
// Function.
//
// No Deno APIs and no imports in this file, on purpose: the same code is
// unit-tested under Node (type stripping) as well as run under Deno, so
// the mapping the server returns is the mapping the tests verified.
//
// The shape mirrors the structured-rates prompt shared with
// ~/workspace/custom-connectors/custom.openai/bin/vision.py (the prompt
// the Nov 5, 2026 vision test used): facility, address, provider,
// assignment_dates_text, regular_daily_rate, premium_hourly_rate,
// first_call_hourly_rate, second_call_weeknight_rate,
// second_call_weekend_rate, call_bonus, paid_hours_8h, raw_text.
//
// Rules, all of which the tests pin down:
// - Amounts are numbers. A string amount ("$2,000.00", "2000") is
//   coerced; anything that is not a finite positive number becomes null.
//   0 is not a rate (same rule as the app's rateOrNull) — never $0.
// - paid_hours_8h is a boolean. true/false pass through; "true"/"yes"
//   and 1 coerce to true, "false"/"no" and 0 to false; anything else
//   (including a bare hour count such as 8) is null, not guessed.
// - Text is trimmed, or null when blank / not a string.
// - Null stays null: a rate the document does not state is never
//   invented, never defaulted, never 0.

export interface AiContractRates {
  facility: string | null;
  address: string | null;
  provider: string | null;
  assignment_dates_text: string | null;
  regular_daily_rate: number | null;
  premium_hourly_rate: number | null;
  first_call_hourly_rate: number | null;
  second_call_weeknight_rate: number | null;
  second_call_weekend_rate: number | null;
  call_bonus: number | null;
  paid_hours_8h: boolean | null;
  raw_text: string | null;
}

export const AI_CONTRACT_KEYS: (keyof AiContractRates)[] = [
  "facility",
  "address",
  "provider",
  "assignment_dates_text",
  "regular_daily_rate",
  "premium_hourly_rate",
  "first_call_hourly_rate",
  "second_call_weeknight_rate",
  "second_call_weekend_rate",
  "call_bonus",
  "paid_hours_8h",
  "raw_text",
];

const RATE_KEYS: (keyof AiContractRates)[] = [
  "regular_daily_rate",
  "premium_hourly_rate",
  "first_call_hourly_rate",
  "second_call_weeknight_rate",
  "second_call_weekend_rate",
  "call_bonus",
];

const TEXT_KEYS: (keyof AiContractRates)[] = [
  "facility",
  "address",
  "provider",
  "assignment_dates_text",
  "raw_text",
];

export function nullRates(): AiContractRates {
  return {
    facility: null,
    address: null,
    provider: null,
    assignment_dates_text: null,
    regular_daily_rate: null,
    premium_hourly_rate: null,
    first_call_hourly_rate: null,
    second_call_weeknight_rate: null,
    second_call_weekend_rate: null,
    call_bonus: null,
    paid_hours_8h: null,
    raw_text: null,
  };
}

// A rate amount: finite and positive, or null. Accepts numbers and
// numeric strings ("$2,000.00" -> 2000). 0 / negative / NaN / junk -> null.
export function coerceAiNumber(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

// paid_hours_8h as a boolean, or null when it cannot be read as one.
export function coerceAiPaidHours(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
    return null;
  }
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "yes" || t === "y") return true;
    if (t === "false" || t === "no" || t === "n") return false;
    return null;
  }
  return null;
}

export function coerceAiText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

// Normalise one parsed model object into the AiContractRates shape.
// Unknown extra keys are dropped; missing keys stay null.
export function normalizeAiContract(raw: unknown): AiContractRates {
  const out = nullRates();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const k of TEXT_KEYS) out[k] = coerceAiText(obj[k]);
  for (const k of RATE_KEYS) out[k] = coerceAiNumber(obj[k]);
  out.paid_hours_8h = coerceAiPaidHours(obj["paid_hours_8h"]);
  return out;
}

// Pull the assistant message text out of an OpenAI chat-completions
// envelope, or null when the envelope has no readable content.
export function extractAiContent(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object") return null;
  const choices = (envelope as Record<string, unknown>)["choices"];
  if (!Array.isArray(choices) || !choices.length) return null;
  const first = choices[0] as Record<string, unknown> | null;
  if (!first || typeof first !== "object") return null;
  const message = first["message"] as Record<string, unknown> | null;
  if (!message || typeof message !== "object") return null;
  const content = message["content"];
  return typeof content === "string" && content.trim() ? content : null;
}

// JSON.parse that returns null instead of throwing (a model reply that
// is not JSON is a bad response, never a crash).
export function parseAiResponseText(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// --- Pay-stub mode (Nov 5, 2026) ---
// Photos of a PAY STUB (one stub per agency). The model returns the
// employer's name, the pay frequency, the pay period, the pay date of
// this check, and the gross / net for this check — nothing else is
// needed to build that agency's pay schedule, and the client derives
// every future payday from the frequency + pay date, never from a
// model-invented date. Same null rules as contracts: a field the stub
// does not state is null, never invented, never 0.
export interface AiPaystub {
  employer: string | null;
  facility: string | null;
  frequency: "weekly" | "biweekly" | "semi-monthly" | "monthly" | null;
  period_start: string | null;
  period_end: string | null;
  pay_date: string | null;
  gross_pay: number | null;
  net_pay: number | null;
  raw_text: string | null;
}

export function coercePaystubFrequency(v: unknown): AiPaystub["frequency"] {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
  if (t === "weekly") return "weekly";
  if (
    t === "biweekly" || t === "bi-weekly" || t === "bi weekly" ||
    t === "every 2 weeks" || t === "every two weeks" || t === "fortnightly"
  ) return "biweekly";
  if (
    t === "semi-monthly" || t === "semi monthly" || t === "semimonthly" ||
    t === "twice a month" || t === "twice-monthly" || t === "twice monthly"
  ) return "semi-monthly";
  if (t === "monthly") return "monthly";
  return null;
}

// A pay-stub date: YYYY-MM-DD passes through; MM/DD/YYYY and
// "Nov 7, 2026" / "7 Nov 2026" normalise to it; anything else is null.
// The client re-validates the result before it ever reaches a preview.
export function coercePaystubDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  const months: Record<string, string> = {
    january: "01", jan: "01", february: "02", feb: "02", march: "03",
    mar: "03", april: "04", apr: "04", may: "05", june: "06", jun: "06",
    july: "07", jul: "07", august: "08", aug: "08", september: "09",
    sep: "09", sept: "09", october: "10", oct: "10", november: "11",
    nov: "11", december: "12", dec: "12",
  };
  const named = t.match(
    /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$|^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/,
  );
  if (named) {
    const mon = months[(named[1] || named[5] || "").toLowerCase()];
    const day = named[2] || named[4];
    const year = named[3] || named[6];
    if (mon && day && year) return `${year}-${mon}-${day.padStart(2, "0")}`;
  }
  return null;
}

export function normalizeAiPaystub(raw: unknown): AiPaystub {
  const out: AiPaystub = {
    employer: null,
    facility: null,
    frequency: null,
    period_start: null,
    period_end: null,
    pay_date: null,
    gross_pay: null,
    net_pay: null,
    raw_text: null,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  out.employer = coerceAiText(obj["employer"] ?? obj["agency"]);
  out.facility = coerceAiText(obj["facility"]);
  out.frequency = coercePaystubFrequency(obj["frequency"]);
  out.period_start = coercePaystubDate(obj["period_start"]);
  out.period_end = coercePaystubDate(obj["period_end"]);
  out.pay_date = coercePaystubDate(obj["pay_date"]);
  out.gross_pay = coerceAiNumber(obj["gross_pay"]);
  out.net_pay = coerceAiNumber(obj["net_pay"]);
  out.raw_text = coerceAiText(obj["raw_text"]);
  return out;
}

// --- Receipt mode (Nov 12, 2026, v158) ---
// Photos of a business-expense RECEIPT. The model returns ONLY the
// total amount actually paid, the date of the purchase, and the
// vendor's name — the client puts them into an editable confirm
// form and saves NOTHING until the user approves. Category/facility
// are the user's own choices and are never read from the receipt.
// Same null rules as every other mode: a field the receipt does not
// state is null, never invented, never 0. `amount` is the receipt
// TOTAL (after tax/tip as printed), never a subtotal or a line item.
export interface AiReceipt {
  vendor: string | null;
  date: string | null;
  amount: number | null;
  raw_text: string | null;
}

export function normalizeAiReceipt(raw: unknown): AiReceipt {
  const out: AiReceipt = { vendor: null, date: null, amount: null, raw_text: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  out.vendor = coerceAiText(obj["vendor"] ?? obj["merchant"] ?? obj["store"]);
  out.date = coercePaystubDate(obj["date"]);
  out.amount = coerceAiNumber(obj["amount"] ?? obj["total"]);
  out.raw_text = coerceAiText(obj["raw_text"]);
  return out;
}

// --- Portal-check mode (Nov 6, 2026) ---
// Photos of a credentialing portal page the user signed into
// themselves (NBCRNA / AANA / a state board lookup). The model returns
// ONLY the record facts printed on that page — status, number, dates,
// CE / MAC progress — and the client shows them as a preview report:
// nothing is saved until the user approves it. Same null rules as
// every other mode: a field the page does not state is null, never
// invented, never 0.
export interface AiPortalCheck {
  status: string | null;
  number: string | null;
  period_start: string | null;
  period_end: string | null;
  renewal_deadline: string | null;
  class_a: number | null;
  class_b: number | null;
  mac_ed: number | null;
  mac_dev: number | null;
  check_status: string | null;
  expiration: string | null;
  license_type: "APRN" | "RN" | null;
  issue_date: string | null;
  expiry: string | null;
  state: string | null;
  raw_text: string | null;
}

export function normalizeAiPortalCheck(raw: unknown): AiPortalCheck {
  const out: AiPortalCheck = {
    status: null,
    number: null,
    period_start: null,
    period_end: null,
    renewal_deadline: null,
    class_a: null,
    class_b: null,
    mac_ed: null,
    mac_dev: null,
    check_status: null,
    expiration: null,
    license_type: null,
    issue_date: null,
    expiry: null,
    state: null,
    raw_text: null,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  out.status = coerceAiText(obj["status"]);
  out.number = coerceAiText(obj["number"] ?? obj["license_number"] ?? obj["certification_number"]);
  out.period_start = coercePaystubDate(obj["period_start"]);
  out.period_end = coercePaystubDate(obj["period_end"]);
  out.renewal_deadline = coercePaystubDate(obj["renewal_deadline"] ?? obj["renewal_date"]);
  out.class_a = coerceAiNumber(obj["class_a"]);
  out.class_b = coerceAiNumber(obj["class_b"]);
  out.mac_ed = coerceAiNumber(obj["mac_ed"]);
  out.mac_dev = coerceAiNumber(obj["mac_dev"]);
  out.check_status = coerceAiText(obj["check_status"] ?? obj["cpc_check_in_status"] ?? obj["mac_check"]);
  out.expiration = coercePaystubDate(obj["expiration"] ?? obj["membership_expiration"]);
  const lt = coerceAiText(obj["license_type"]);
  out.license_type = lt && /aprn/i.test(lt) ? "APRN" : lt && /\brn\b/i.test(lt) ? "RN" : null;
  out.issue_date = coercePaystubDate(obj["issue_date"]);
  out.expiry = coercePaystubDate(obj["expiry"] ?? obj["expiration_date"]);
  out.state = coerceAiText(obj["state"]);
  out.raw_text = coerceAiText(obj["raw_text"]);
  return out;
}

// --- Schedule-photo mode (Nov 5, 2026; grid support Nov 6, 2026) ---
// The schedule upload sends photos of a staff schedule; the model
// returns only shifts for the schedule name. A LIST row is kept only
// when it has a parseable date and a facility; a GRID row (a cell
// from a names-by-dates grid) legitimately has NO facility — it is
// kept when it has a date and its cell code, carried verbatim in
// `code` and as the shift `type` (the app never invents a meaning
// for a code; the user can rename it in the preview). The client
// still classifies every row (matched / other / uncertain) before
// preview.
export interface AiScheduleShift {
  date: string;
  facility: string;
  type: string;
  code: string;
  name: string;
  pay: string;
  // Grid reliability (Nov 6, 2026): for a grid cell, `column` is the
  // 1-based position of its column and `anchored` says whether the
  // date below was re-derived from that column's header date (the
  // anchoring step in normalizeAiScheduleRead) instead of trusting
  // the model's own date guess. List rows: column null, anchored
  // false (not applicable — their dates come from the row itself).
  column: number | null;
  anchored: boolean;
}

const SCHEDULE_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function coerceScheduleDate(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // Grid column headers are usually "23-Nov" or "Nov 23" with no
  // year — same rule as the on-device importer: the current year.
  const year = new Date().getFullYear();
  m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?(?:[,\s]+(\d{4}))?$/);
  if (m) {
    const mo = SCHEDULE_MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      return `${m[3] ? +m[3] : year}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?$/);
  if (m) {
    const mo = SCHEDULE_MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) {
      return `${m[3] ? +m[3] : year}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
  }
  return "";
}

// Full schedule read (Nov 6, 2026 reliability pass): returns the
// shifts PLUS the grid header dates the model transcribed, and —
// for grid cells — re-derives every date from its COLUMN's header
// date (date anchoring). Caleb ran the same grid photo three times
// and got three different answers: the model would pair a correct
// code with the neighboring column's date (off-by-one drift) or
// bleed a cell in from the row below. A column position is a much
// easier thing for the model to report than a date, and the header
// row is read once, as a list — so the anchored date (header[column])
// replaces the model's free-floating date guess wherever the header
// was actually read. Cells whose column has no readable header keep
// the model's date with anchored=false, and the client flags them
// "check this one" in the preview instead of trusting them silently.
export function normalizeAiScheduleRead(
  raw: unknown,
): { shifts: AiScheduleShift[]; headerDates: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { shifts: [], headerDates: [] };
  }
  const obj = raw as Record<string, unknown>;
  const rawHeader = obj["header_dates"];
  const headerDates: string[] = Array.isArray(rawHeader)
    ? rawHeader.map((h) => coerceScheduleDate(h))
    : [];
  const shifts = obj["shifts"];
  if (!Array.isArray(shifts)) return { shifts: [], headerDates };
  const out: AiScheduleShift[] = [];
  for (const item of shifts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    let date = coerceScheduleDate(row["date"]);
    const facility = coerceAiText(row["facility"]) ?? "";
    const code = coerceAiText(row["code"]) ?? "";
    // List rows need a facility; grid cells need their code instead.
    if (!date && !code) continue;
    if (!facility && !code) continue;
    let column: number | null = null;
    let anchored = false;
    if (code) {
      const c = row["column"];
      if (typeof c === "number" && Number.isFinite(c)) {
        const ci = Math.trunc(c);
        if (ci >= 1) column = ci;
      } else if (typeof c === "string" && /^\d+$/.test(c.trim())) {
        column = parseInt(c.trim(), 10);
      }
      // Anchoring: the column's header date IS this cell's date.
      if (column !== null && headerDates[column - 1]) {
        date = headerDates[column - 1];
        anchored = true;
      }
      if (!date) continue;
      // Grid headers never print a year, so any year the model
      // attaches to a grid cell is a guess — the importer's rule for
      // year-less dates is the current year.
      date = `${new Date().getFullYear()}-${date.slice(5)}`;
    } else if (!date) {
      continue;
    }
    out.push({
      date,
      facility,
      // A grid code stays verbatim as the shift type — never mapped
      // to an invented meaning.
      type: code ? code : (coerceAiText(row["type"]) ?? "Other"),
      code,
      name: coerceAiText(row["name"]) ?? "",
      pay: "",
      column,
      anchored,
    });
  }
  return { shifts: out, headerDates };
}

export function normalizeAiSchedule(raw: unknown): AiScheduleShift[] {
  return normalizeAiScheduleRead(raw).shifts;
}

// --- Plain-language rule mode (Nov 6, 2026) ---
// The user describes a pay rule in their own words in the contract
// chat box — e.g. "24hr call, first 8 hours $250/hr, then after 3pm
// 175/hr until 7am" — and the model returns a STRUCTURED rule. The
// model never does pay arithmetic: totals are computed by the app's
// deterministic income engine from these fields. Same null rules as
// contracts: a value the description does not state is null, never
// invented, never 0. When part of the description is ambiguous (which
// hours, weekday vs weekend), the model returns a clarifying_question
// instead of guessing, and the app asks it in the chat.
export interface AiRuleSegment {
  hours: number | null;
  rate: number | null;
  from: string | null;
  to: string | null;
  label: string | null;
}

export interface AiRule {
  shift_type: string | null;
  applies_to: "weekday" | "weekend" | "both" | null;
  hourly_rate: number | null;
  first_call_hourly_rate: number | null;
  flat_rate: number | null;
  weekend_flat_rate: number | null;
  second_call_rate: number | null;
  weekend_second_call_rate: number | null;
  call_bonus: number | null;
  segments: AiRuleSegment[];
  summary: string | null;
  clarifying_question: string | null;
  missing: string[];
}

const RULE_SHIFT_TYPES: Record<string, string> = {
  "24-hour call": "24-hour call", "24 hour call": "24-hour call", "24hr call": "24-hour call",
  "24h call": "24-hour call", "first call": "24-hour call", "1st call": "24-hour call",
  "second call": "Second call", "2nd call": "Second call",
  "8-hour day": "8-hour day", "8 hour day": "8-hour day", "8-hour shift": "8-hour day", "8h": "8-hour day",
  "10-hour shift": "10-hour shift", "10 hour shift": "10-hour shift", "10h": "10-hour shift",
  "12-hour shift": "12-hour shift", "12 hour shift": "12-hour shift", "12h": "12-hour shift",
  "other": "Other",
};

export function coerceRuleShiftType(v: unknown): string | null {
  const t = coerceAiText(v);
  if (!t) return null;
  return RULE_SHIFT_TYPES[t.toLowerCase().replace(/\s+/g, " ").trim()] ?? null;
}

export function coerceRuleAppliesTo(v: unknown): AiRule["applies_to"] {
  const t = coerceAiText(v);
  if (!t) return null;
  const s = t.toLowerCase().trim();
  if (s === "weekday" || s === "weekdays" || s === "weeknight" || s === "weeknights") return "weekday";
  if (s === "weekend" || s === "weekends") return "weekend";
  if (s === "both" || s === "all" || s === "every day" || s === "all days") return "both";
  return null;
}

function coerceSegmentHours(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : null;
}

export function normalizeAiRule(raw: unknown): AiRule {
  const out: AiRule = {
    shift_type: null, applies_to: null, hourly_rate: null,
    first_call_hourly_rate: null, flat_rate: null, weekend_flat_rate: null,
    second_call_rate: null, weekend_second_call_rate: null, call_bonus: null,
    segments: [], summary: null, clarifying_question: null, missing: [],
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  out.shift_type = coerceRuleShiftType(obj["shift_type"]);
  out.applies_to = coerceRuleAppliesTo(obj["applies_to"]);
  out.hourly_rate = coerceAiNumber(obj["hourly_rate"]);
  out.first_call_hourly_rate = coerceAiNumber(obj["first_call_hourly_rate"]);
  out.flat_rate = coerceAiNumber(obj["flat_rate"]);
  out.weekend_flat_rate = coerceAiNumber(obj["weekend_flat_rate"]);
  out.second_call_rate = coerceAiNumber(obj["second_call_rate"]);
  out.weekend_second_call_rate = coerceAiNumber(obj["weekend_second_call_rate"]);
  out.call_bonus = coerceAiNumber(obj["call_bonus"]);
  const segs = obj["segments"];
  if (Array.isArray(segs)) {
    for (const item of segs.slice(0, 6)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const s = item as Record<string, unknown>;
      const seg: AiRuleSegment = {
        hours: coerceSegmentHours(s["hours"]),
        rate: coerceAiNumber(s["rate"]),
        from: coerceAiText(s["from"]),
        to: coerceAiText(s["to"]),
        label: coerceAiText(s["label"]),
      };
      if (seg.rate != null || seg.hours != null) out.segments.push(seg);
    }
  }
  out.summary = coerceAiText(obj["summary"]);
  out.clarifying_question = coerceAiText(obj["clarifying_question"]);
  const missing = obj["missing"];
  if (Array.isArray(missing)) {
    out.missing = missing.map((m) => coerceAiText(m)).filter((m): m is string => !!m).slice(0, 6);
  }
  return out;
}

// --- Multi-rule words read (Nov 11, 2026, v133, mode: "rules") ---
// The old "rule" mode above reads ONE pay rule for ONE shift type —
// a schema that structurally cannot represent the words box, where
// a user states several rules in one paragraph. This read covers
// the WHOLE text: every rule, every code, each value carrying the
// exact substring of the user's text it came from (its "quote").
// The client validates each quote against the text before trusting
// the value (traceability), checks that every code the text names
// is resolved or listed unknown (coverage), and only then lets the
// read lead. Values stay null where the text does not state them —
// the model transcribes; it never computes and never invents.
export interface AiQuotedValue {
  value: number;
  quote: string;
}

export interface AiRulesCode {
  code: string;
  label: string | null;
  type: string | null;
  hours: number | null;
  paid_hours: AiQuotedValue | null;
  weekday_pay: AiQuotedValue | null;
  weekend_pay: AiQuotedValue | null;
  unpaid: boolean;
  quote: string | null;
}

export interface AiRulesRead {
  hourly_rate: AiQuotedValue | null;
  paid_hours_8: AiQuotedValue | null;
  paid_hours_by_length: { length: number; value: AiQuotedValue }[];
  first_call_hourly_rate: AiQuotedValue | null;
  call_bonus: AiQuotedValue | null;
  weekend: { days: string[]; stated: boolean; quote: string | null };
  codes: AiRulesCode[];
  unknown: { name: string; quote: string | null }[];
  clarifying_question: string | null;
}

const WEEKDAY_NAMES: Record<string, string> = {
  sunday: "Sunday", sun: "Sunday",
  monday: "Monday", mon: "Monday",
  tuesday: "Tuesday", tue: "Tuesday", tues: "Tuesday",
  wednesday: "Wednesday", wed: "Wednesday",
  thursday: "Thursday", thu: "Thursday", thur: "Thursday", thurs: "Thursday",
  friday: "Friday", fri: "Friday",
  saturday: "Saturday", sat: "Saturday",
};

function coerceQuotedValue(v: unknown): AiQuotedValue | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const n = coerceAiNumber(o["value"]);
  const q = coerceAiText(o["quote"]);
  if (n == null || !q) return null;
  return { value: n, quote: q.slice(0, 240) };
}

function coerceQuoteHours(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : null;
}

export function normalizeAiRulesRead(raw: unknown): AiRulesRead {
  const out: AiRulesRead = {
    hourly_rate: null,
    paid_hours_8: null,
    paid_hours_by_length: [],
    first_call_hourly_rate: null,
    call_bonus: null,
    weekend: { days: [], stated: false, quote: null },
    codes: [],
    unknown: [],
    clarifying_question: null,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  out.hourly_rate = coerceQuotedValue(obj["hourly_rate"]);
  out.paid_hours_8 = coerceQuotedValue(obj["paid_hours_8"]);
  out.first_call_hourly_rate = coerceQuotedValue(obj["first_call_hourly_rate"]);
  out.call_bonus = coerceQuotedValue(obj["call_bonus"]);
  const phl = obj["paid_hours_by_length"];
  if (Array.isArray(phl)) {
    for (const item of phl.slice(0, 8)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      const len = coerceQuoteHours(o["length"]);
      const val = coerceQuotedValue(o["value"]);
      if (len != null && val) out.paid_hours_by_length.push({ length: len, value: val });
    }
  }
  const wk = obj["weekend"];
  if (wk && typeof wk === "object" && !Array.isArray(wk)) {
    const w = wk as Record<string, unknown>;
    const days: string[] = [];
    if (Array.isArray(w["days"])) {
      for (const d of w["days"]) {
        const name = typeof d === "string" ? WEEKDAY_NAMES[d.trim().toLowerCase()] : undefined;
        if (name && !days.includes(name)) days.push(name);
      }
    }
    out.weekend = {
      days,
      stated: w["stated"] === true && days.length > 0,
      quote: coerceAiText(w["quote"])?.slice(0, 240) ?? null,
    };
    if (!out.weekend.stated) out.weekend.days = [];
  }
  const codes = obj["codes"];
  if (Array.isArray(codes)) {
    for (const item of codes.slice(0, 30)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      const code = coerceAiText(o["code"]);
      if (!code) continue;
      out.codes.push({
        code: code.slice(0, 80),
        label: coerceAiText(o["label"])?.slice(0, 80) ?? null,
        type: coerceRuleShiftType(o["type"]),
        hours: coerceQuoteHours(o["hours"]),
        paid_hours: coerceQuotedValue(o["paid_hours"]),
        weekday_pay: coerceQuotedValue(o["weekday_pay"]),
        weekend_pay: coerceQuotedValue(o["weekend_pay"]),
        unpaid: o["unpaid"] === true,
        quote: coerceAiText(o["quote"])?.slice(0, 240) ?? null,
      });
    }
  }
  const unk = obj["unknown"];
  if (Array.isArray(unk)) {
    for (const item of unk.slice(0, 12)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      const name = coerceAiText(o["name"]);
      if (!name) continue;
      out.unknown.push({ name: name.slice(0, 80), quote: coerceAiText(o["quote"])?.slice(0, 240) ?? null });
    }
  }
  out.clarifying_question = coerceAiText(obj["clarifying_question"]);
  return out;
}

// --- Grid band extraction (Nov 7, 2026) ---
// Caleb's objection killed the old advice: cropping a grid photo by
// hand throws away the date header the reader needs, so the USER
// never crops — the app zooms. Pipeline (client-orchestrated):
//   1. LOCATE (below): on the full photo, the model returns only the
//      grid's header dates and EVERY data row's name label, in
//      order. No codes, no coordinates — measured live Nov 7, the
//      model's freehand bounding boxes were far too coarse to crop
//      by (it placed the fixture's Martin row at y 300-400 of 1017;
//      the row actually sits at ~850). The client instead detects
//      the grid's ruled lines geometrically on a canvas (they are
//      deterministic), spots blank-label rows by their label cells
//      (real text is anti-aliased mid-grey; a blank cell is not),
//      and so derives the matched row's exact pixel band.
//   2. BAND (below): the client stacks the header band and the
//      matched row's band from the ORIGINAL full-resolution photo
//      into one composite (date columns only, vertically stretched
//      ~2.2x, column numbers burned into the margin), and gpt-4o
//      transcribes it as a per-column CELLS array — one entry per
//      column, "" for blank — so a cell's position comes from the
//      array, never from counting filled cells. Measured on the
//      fixture: the full-photo read scored 0/5 correct cells with
//      Mitchell's "endo 3" bleeding in; the band read scored 5/5
//      correct, 2/2 runs. (gpt-4o-mini mis-anchored the composite
//      by ~4 columns — the wide shaded label columns pulled its
//      alignment — so the band sub-modes run on gpt-4o.)
export interface AiGridLocate {
  isGrid: boolean;
  headerDates: string[];
  rowLabels: string[];
}

export function normalizeAiGridLocate(raw: unknown): AiGridLocate {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { isGrid: false, headerDates: [], rowLabels: [] };
  }
  const obj = raw as Record<string, unknown>;
  const rawHeader = obj["header_dates"];
  const headerDates: string[] = Array.isArray(rawHeader)
    ? rawHeader.map((h) => coerceScheduleDate(h))
    : [];
  const rawLabels = obj["row_labels"];
  const rowLabels: string[] = Array.isArray(rawLabels)
    ? rawLabels.slice(0, 200).map((l) => (coerceAiText(l) ?? ""))
    : [];
  const isGrid = obj["is_grid"] === true &&
    headerDates.filter((d) => d).length >= 3 && rowLabels.length >= 2;
  return { isGrid, headerDates, rowLabels };
}

// Band transcription -> the same AiScheduleShift shape as a full
// schedule read, so the client's anchoring + reconciliation +
// preview code treats both identically. `cells[i]` is column i+1;
// its date is re-derived from headerDates[i] (anchored) — the model
// is never trusted for a band cell's date.
export function normalizeAiBandRead(
  raw: unknown,
  scheduleName: string,
): { shifts: AiScheduleShift[]; headerDates: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { shifts: [], headerDates: [] };
  }
  const obj = raw as Record<string, unknown>;
  const rawHeader = obj["header_dates"];
  const headerDates: string[] = Array.isArray(rawHeader)
    ? rawHeader.map((h) => coerceScheduleDate(h))
    : [];
  const cells = obj["cells"];
  if (!Array.isArray(cells)) return { shifts: [], headerDates };
  const out: AiScheduleShift[] = [];
  const n = Math.min(cells.length, headerDates.length || cells.length);
  for (let i = 0; i < n; i++) {
    const code = (coerceAiText(cells[i]) ?? "").trim();
    if (!code) continue;
    const date = headerDates[i] || "";
    if (!date) continue;
    // Grid headers print no year; the importer's rule for a
    // year-less date is the current year (same as the full read).
    const yr = `${new Date().getFullYear()}-${date.slice(5)}`;
    out.push({
      date: yr,
      facility: "",
      type: code,
      code,
      name: scheduleName,
      pay: "",
      column: i + 1,
      anchored: true,
    });
  }
  return { shifts: out, headerDates };
}
