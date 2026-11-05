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
