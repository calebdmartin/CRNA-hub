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

// --- Schedule-photo mode (Nov 5, 2026) ---
// The schedule upload sends photos of a staff schedule; the model
// returns only shifts for the schedule name. A row is kept only when
// it has a parseable YYYY-MM-DD date and a facility; the client still
// classifies every row (matched / other / uncertain) before preview.
export interface AiScheduleShift {
  date: string;
  facility: string;
  type: string;
  name: string;
  pay: string;
}

function coerceScheduleDate(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

export function normalizeAiSchedule(raw: unknown): AiScheduleShift[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const shifts = (raw as Record<string, unknown>)["shifts"];
  if (!Array.isArray(shifts)) return [];
  const out: AiScheduleShift[] = [];
  for (const item of shifts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const date = coerceScheduleDate(row["date"]);
    const facility = coerceAiText(row["facility"]) ?? "";
    if (!date || !facility) continue;
    out.push({
      date,
      facility,
      type: coerceAiText(row["type"]) ?? "Other",
      name: coerceAiText(row["name"]) ?? "",
      pay: "",
    });
  }
  return out;
}
