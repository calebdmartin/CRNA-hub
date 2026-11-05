// CRNA Hub — shared helpers for the calendar-sync Edge Functions.
//
// Security model (read this before changing anything here):
// - Provider OAuth tokens, refresh tokens, and Apple app-specific passwords
//   are NEVER sent to the browser, NEVER stored in localStorage, and NEVER
//   committed to this repo. They live only in the `calendar_connections`
//   table, encrypted with AES-GCM under CALENDAR_ENCRYPTION_KEY, and are
//   decrypted only inside these Edge Functions (service-role key, server
//   side only).
// - The browser holds only its own Supabase Auth JWT. Every request here
//   validates that JWT against Supabase Auth and scopes all database rows
//   to that user_id. Row Level Security on the tables is a second layer;
//   these functions use the service-role key, so the user scoping in code
//   below is what actually enforces per-user isolation — do not remove it.
// - No secret, client ID, or token value is ever logged. Errors returned to
//   the browser carry a short code, never a provider response body.

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function err(code: string, status = 400): Response {
  return json({ ok: false, error: code }, status);
}

function env(name: string): string {
  return Deno.env.get(name) ?? "";
}

export function supabaseUrl(): string {
  return env("SUPABASE_URL");
}

function serviceKey(): string {
  return env("SUPABASE_SERVICE_ROLE_KEY");
}

function anonKey(): string {
  return env("SUPABASE_ANON_KEY");
}

function appUrl(): string {
  return env("APP_URL");
}

// Validate a Supabase Auth JWT and return its user id, or null.
export async function authUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const r = await fetch(`${supabaseUrl()}/auth/v1/user`, {
      headers: {
        apikey: anonKey(),
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data?.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

// --- Minimal PostgREST client (service role, server side only) ---

function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: serviceKey(),
    Authorization: `Bearer ${serviceKey()}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function sbGet(
  table: string,
  query: string,
): Promise<Record<string, unknown>[]> {
  const r = await fetch(
    `${supabaseUrl()}/rest/v1/${table}?${query}`,
    { headers: sbHeaders() },
  );
  if (!r.ok) throw new Error(`db_read_failed:${table}`);
  return (await r.json()) as Record<string, unknown>[];
}

export async function sbUpsert(
  table: string,
  row: Record<string, unknown>,
  _onConflict: string,
): Promise<void> {
  const r = await fetch(`${supabaseUrl()}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders({
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`db_write_failed:${table}`);
}

// Bulk upsert: one PostgREST round-trip for many rows instead of one
// per row. The Apple import writes one import-map row per source event
// (231 on Caleb's work calendar); doing that sequentially took ~36s
// server-side on Nov 5, 2026, past the Vercel proxy's 25s limit, so
// the browser never received the 231 created shifts even though the
// server had paired them. Conflict target is the table's primary key,
// exactly as the single-row upsert above. An empty list is a no-op.
export async function sbUpsertMany(
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!rows.length) return;
  const r = await fetch(`${supabaseUrl()}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders({
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`db_write_failed:${table}`);
}

// Split an array into chunks of at most `size` (for batched deletes,
// where a PostgREST `in.(...)` list must stay short enough for a URL).
export function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, Math.floor(size) || 1);
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export async function sbInsert(
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const r = await fetch(`${supabaseUrl()}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`db_write_failed:${table}`);
}

export async function sbDelete(
  table: string,
  query: string,
): Promise<void> {
  const r = await fetch(
    `${supabaseUrl()}/rest/v1/${table}?${query}`,
    { method: "DELETE", headers: sbHeaders() },
  );
  if (!r.ok) throw new Error(`db_delete_failed:${table}`);
}

export async function sbPatch(
  table: string,
  query: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const r = await fetch(
    `${supabaseUrl()}/rest/v1/${table}?${query}`,
    {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    },
  );
  if (!r.ok) throw new Error(`db_write_failed:${table}`);
}

// --- AES-GCM encryption for stored provider credentials ---

function encryptionKeyBytes(): Uint8Array {
  const hex = env("CALENDAR_ENCRYPTION_KEY").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("encryption_not_configured");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function aesKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encryptionKeyBytes() as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(),
    new TextEncoder().encode(plain),
  );
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  let bin = "";
  combined.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export async function decryptSecret(stored: string): Promise<string> {
  const bin = atob(stored);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    await aesKey(),
    ct,
  );
  return new TextDecoder().decode(plain);
}

export function encryptionConfigured(): boolean {
  return /^[0-9a-fA-F]{64}$/.test(env("CALENDAR_ENCRYPTION_KEY").trim());
}

// --- Shift <-> calendar-event mapping ---
//
// A CRNA Hub shift is an all-day event. Title: "Facility — Shift type".
// Description lines (kept identical across providers so any provider's
// event can be parsed back into a shift):
//   Type: <shift type>
//   Expected gross: $<pay>        (omitted when the shift is unpriced)
//   Note: <free-text note>        (omitted when empty)
//   CRNA Hub shift: <shift id>    (fallback marker; the sync map table is
//                                   the authoritative pairing)

export interface LocalShift {
  id: string;
  date: string;
  facility: string;
  type: string;
  pay?: string | number | null;
  note?: string | null;
  updatedAt?: string | null;
}

export interface ProviderEvent {
  providerEventId: string;
  date: string;
  facility: string;
  type: string;
  pay: string;
  note: string;
  shiftId: string | null;
  updatedAt: string | null;
  cancelled: boolean;
  rawUpdatedAt: string | null;
  // Raw event title as the provider returned it. The dedicated-calendar
  // parsers above split it into facility/type; the work-calendar import
  // needs the raw title instead (see parseWorkShiftTitle).
  summary?: string;
  // Event location as the provider returned it (ICS LOCATION, Google
  // location, Outlook location display name). The work-calendar import
  // uses it as a second place a facility can be named — an event titled
  // "8" with location "CAMC" is a CAMC shift.
  location?: string;
  // Set by the server when a provider change is an import from a source
  // calendar (e.g. "apple-import"). The browser stores it as the shift's
  // source so imported shifts stay visibly distinct from user-entered
  // ones and from shifts synced from the dedicated calendar.
  source?: string;
}

export function shiftTitle(s: LocalShift): string {
  return `${s.facility || ""} — ${s.type || "Shift"}`;
}

export function shiftDescription(s: LocalShift): string {
  const lines = [`Type: ${s.type || "Shift"}`];
  if (s.pay !== "" && s.pay !== null && s.pay !== undefined) {
    lines.push(`Expected gross: $${String(s.pay).replace(/[^0-9.]/g, "")}`);
  }
  if (s.note) lines.push(`Note: ${s.note}`);
  lines.push(`CRNA Hub shift: ${s.id}`);
  return lines.join("\n");
}

export function parseTitle(title: string): { facility: string; type: string } {
  const t = String(title || "").trim();
  for (const sep of [" — ", " - ", ": "]) {
    const i = t.indexOf(sep);
    if (i > 0) {
      return { facility: t.slice(0, i).trim(), type: t.slice(i + sep.length).trim() };
    }
  }
  return { facility: t, type: "Shift" };
}

export function parseDescription(desc: string): {
  type: string;
  pay: string;
  note: string;
  shiftId: string | null;
} {
  const text = String(desc || "");
  const type = /^\s*Type:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  const pay = /Expected gross:\s*\$?([\d,]+(?:\.\d+)?)/i.exec(text)?.[1]
    ?.replace(/,/g, "") ?? "";
  const note = /^\s*Note:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  const shiftId = /CRNA Hub shift:\s*([A-Za-z0-9-]+)/.exec(text)?.[1] ?? null;
  return { type, pay, note, shiftId };
}

// Parse a work-calendar event title (e.g. "Holzer 8", "Holzer 8/2nd call",
// "Holzer 24/1st call", "Holzer 10") into a CRNA Hub shift. Returns null
// when the title is not a recognisable Holzer shift — the import caller
// must skip (and count) those events, never import them as junk shifts.
//
// Shift types use the app's canonical names ("8-hour day", "10-hour
// shift", "12-hour shift", "24-hour call", "Second call"), matching the
// contract parser in app.js. Pay uses Caleb's confirmed Holzer rules
// ($250/hr; 8-hour day is paid 8.5h = $2,125; 10-hour is paid 10.5h =
// $2,625; 2nd call is $2,000 day + $1,000 overnight bonus = $3,000 on a
// weekday and a flat $2,000 on a weekend; 24/1st call is flat $4,800 on
// a weekday and $4,200 on a weekend). A 12-hour shift has no confirmed
// flat rate on file, so its pay is left blank (the app marks it
// incomplete) rather than guessed. The date decides weekday vs weekend.
export function parseWorkShiftTitle(
  title: string,
  date: string,
): { facility: string; type: string; pay: string } | null {
  const t = String(title || "").trim().toLowerCase();
  if (!/\bholzer\b/.test(t)) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00Z`).getUTCDay()
    : -1;
  const weekend = day === 0 || day === 6;
  // 2nd call first: "Holzer 8/2nd call" and "Holzer 2nd call" both contain
  // an 8/24 pattern that must not win over the call part.
  if (/\b2nd\s*call\b|\bsecond\s*call\b/.test(t)) {
    return { facility: "Holzer", type: "Second call", pay: weekend ? "2000" : "3000" };
  }
  // The hour number must sit next to "Holzer" (or carry an hour suffix):
  // a bare number elsewhere in the title (e.g. a date in "Holzer 8 Nov
  // 24") must never reclassify the shift.
  if (/holzer\s+24\b|\b24\s*-?\s*hour\b|\b24h\b|\b24\s*\/\s*1st\b|holzer\s+1st\b|\b1st\s*call\b|\bfirst\s*call\b/.test(t)) {
    return { facility: "Holzer", type: "24-hour call", pay: weekend ? "4200" : "4800" };
  }
  if (/holzer\s+12\b|\b12\s*-?\s*hour\b|\b12h\b/.test(t)) {
    return { facility: "Holzer", type: "12-hour shift", pay: "" };
  }
  if (/holzer\s+10\b|\b10\s*-?\s*hour\b|\b10h\b/.test(t)) {
    return { facility: "Holzer", type: "10-hour shift", pay: "2625" };
  }
  if (/holzer\s+8\b|\b8\s*-?\s*hour\b|\b8h\b/.test(t)) {
    return { facility: "Holzer", type: "8-hour day", pay: "2125" };
  }
  return null;
}

// --- Generic work-shift recognition (all facilities, Nov 5, 2026) ---
//
// parseWorkShiftTitle above stays Holzer-only (its regression tests pin
// Caleb's confirmed Holzer rates). parseWorkShiftEvent is the import
// parser the sync loop actually calls. Recognition order:
//   1. Holzer — the confirmed rules win, whatever the Facilities list
//      says.
//   2. The user's Facilities list (sent with each sync by the browser;
//      facilities live on-device, like shifts — there is no server-side
//      facilities table). A facility matches by name or alias against
//      the event title AND the event location, so an event titled just
//      "CAMC" — or a bare shift pattern ("8", "2nd call") with the
//      facility in the location — is a shift for that facility. Pay
//      comes only from that facility's own pay rule, never guessed.
//   3. Generic fallback for facilities not yet listed: a facility-like
//      title plus a shift pattern ("CAMC 8", "St. Mary's 24"). Pay is
//      always blank — the shift imports as unpriced/incomplete and the
//      client offers the facility on the Facilities tab so the user can
//      set its pay rule. A title with no shift pattern and no listed
//      facility ("Team lunch", "Lunch at CAMC", "Dentist appointment")
//      is not a shift, however facility-like it looks.
// A facility added after an import re-scans cleanly: skipped events
// leave no import-map row, so the next sync re-evaluates them, and a
// shift already imported unpriced is re-priced by the import loop when
// its facility gains a pay rule (see sync-calendar/index.ts). The
// parser itself is date-window-free: any date parses, past or future —
// the import range is the full source-calendar history (see
// fetchAppleSourceEvents), not a 2025–2028 window.

export interface FacilityPayRule {
  name: string;
  aliases?: string[];
  rate8?: number | null;
  rate10?: number | null;
  rate12?: number | null;
  rate24?: number | null;
  rateSecond?: number | null;
  hourlyRate?: number | null;
  paidHours8?: number | null;
  callBonus?: number | null;
}

function ruleNum(v: unknown): number | null {
  const n = typeof v === "number"
    ? v
    : typeof v === "string" && v.trim() !== ""
    ? Number(v)
    : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Coerce the browser's facilities payload (one entry per saved facility:
// name, aliases as an array or comma-separated string, and the pay-rule
// numbers) into validated rules. Anything malformed is dropped, never
// guessed at; an absent or empty list simply means "no known facilities".
export function normalizeFacilityRules(input: unknown): FacilityPayRule[] {
  if (!Array.isArray(input)) return [];
  const out: FacilityPayRule[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    const aliasesRaw = r.aliases;
    const aliases = Array.isArray(aliasesRaw)
      ? aliasesRaw.map((a) => String(a ?? "").trim()).filter(Boolean)
      : typeof aliasesRaw === "string"
      ? aliasesRaw.split(",").map((a) => a.trim()).filter(Boolean)
      : [];
    out.push({
      name,
      aliases,
      rate8: ruleNum(r.rate8),
      rate10: ruleNum(r.rate10),
      rate12: ruleNum(r.rate12),
      rate24: ruleNum(r.rate24),
      rateSecond: ruleNum(r.rateSecond),
      hourlyRate: ruleNum(r.hourlyRate),
      callBonus: ruleNum(r.callBonus),
      paidHours8: ruleNum(r.paidHours8),
    });
  }
  return out;
}

// Price one shift type from a facility's own pay rule. Returns "" when
// the rule does not cover that type — never a guessed amount. Only
// Holzer has weekday/weekend-specific rates (in parseWorkShiftTitle);
// every other facility's flat rates apply as entered, any day.
export function priceShiftWithFacility(type: string, rule: FacilityPayRule): string {
  const money = (v: number | null | undefined): string =>
    v === null || v === undefined ? "" : String(Math.round(v * 100) / 100);
  const hourly = rule.hourlyRate ?? null;
  const hours8 = rule.paidHours8 ?? 8;
  if (type === "8-hour day") {
    return money(rule.rate8 ?? (hourly !== null ? hourly * hours8 : null));
  }
  if (type === "10-hour shift") {
    return money(rule.rate10 ?? (hourly !== null ? hourly * 10 : null));
  }
  if (type === "12-hour shift") {
    return money(rule.rate12 ?? (hourly !== null ? hourly * 12 : null));
  }
  if (type === "24-hour call") return money(rule.rate24 ?? null);
  if (type === "Second call") {
    if (rule.rateSecond !== null && rule.rateSecond !== undefined) {
      return money(rule.rateSecond);
    }
    const base = rule.rate8 ?? (hourly !== null ? hourly * hours8 : null);
    if (rule.callBonus !== null && rule.callBonus !== undefined && base !== null) {
      return money(base + rule.callBonus);
    }
    return "";
  }
  return "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// True when `needle` appears in `haystack` as a whole token (so the
// alias "CAMC" does not match inside another word, and "St. Mary"
// matches "St. Mary's"). Multi-word names match across any whitespace.
function containsToken(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  const pat = escapeRegExp(n).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Za-z0-9])${pat}([^A-Za-z0-9]|$)`, "i").test(haystack);
}

function titleEqualsToken(title: string, needle: string): boolean {
  return title.trim().replace(/[–—\-:;,.]+$/, "").trim().toLowerCase() ===
    needle.trim().toLowerCase();
}

// Shift type from an explicit pattern in the text: a call, an hour
// count with an hour suffix, or a day/night shift. A bare number ("8")
// is deliberately NOT matched here — it only counts when it sits next
// to a known facility (see below), so a date in a title can never
// reclassify a shift.
function shiftTypeFromPattern(text: string): string | null {
  const s = String(text || "").toLowerCase();
  if (/\b2nd\s*call\b|\bsecond\s*call\b/.test(s)) return "Second call";
  if (/\b24\s*-?\s*hour\b|\b24h\b|\b24\s*\/\s*1st\b|\b1st\s*call\b|\bfirst\s*call\b/.test(s)) {
    return "24-hour call";
  }
  if (/\b12\s*-?\s*hour\b|\b12h\b/.test(s)) return "12-hour shift";
  if (/\b10\s*-?\s*hour\b|\b10h\b/.test(s)) return "10-hour shift";
  if (/\b8\s*-?\s*hour\b|\b8h\b|\bday\s+shift\b/.test(s)) return "8-hour day";
  if (/\bnight\s+shift\b|\bnight\s+call\b/.test(s)) return "12-hour shift";
  if (/\bcall\b/.test(s)) return "Call (unclassified)";
  return null;
}

// Shift type from a bare trailing number ("CAMC 8", "CAMC 24"). Only
// used where the facility is already established (a listed facility, or
// the generic fallback's guarded bare-number path), never on a bare
// title — a trailing date ("Holzer 8 Nov 24") must never win.
function bareNumberShiftType(text: string): string | null {
  const m = /(?:^|[\s/])\b(8|10|12|24)\b\s*$/.exec(String(text || "").trim());
  if (!m) return null;
  return m[1] === "8"
    ? "8-hour day"
    : m[1] === "10"
    ? "10-hour shift"
    : m[1] === "12"
    ? "12-hour shift"
    : "24-hour call";
}

function leadingNumberShiftType(text: string): string | null {
  const m = /^\s*(8|10|12|24)\b/.exec(String(text || ""));
  if (!m) return null;
  return m[1] === "8"
    ? "8-hour day"
    : m[1] === "10"
    ? "10-hour shift"
    : m[1] === "12"
    ? "12-hour shift"
    : "24-hour call";
}

// Index of the first shift-pattern token in a title, or -1. Longest
// patterns first, so "2nd call" wins over the bare "call" inside it.
const SHIFT_PATTERN_RE =
  /\b(2nd\s*call|second\s*call|24\s*-?\s*hour|24h|24\s*\/\s*1st|1st\s*call|first\s*call|12\s*-?\s*hour|12h|10\s*-?\s*hour|10h|8\s*-?\s*hour|8h|day\s+shift|night\s+shift|night\s+call|call)\b/i;

function cleanFacilityRaw(s: string): string {
  let v = String(s || "").trim().replace(/[\s,;:\-/–—]+$/, "").trim();
  v = v.replace(/\s*\b(8|10|12|24)\b\s*$/, "").trim();
  v = v.replace(/\s*\b(shift|call|day|night)\b\s*$/i, "").trim();
  v = v.replace(/[\s,;:\-/–—]+$/, "").trim();
  return v;
}

const NON_FACILITY_WORDS =
  /\b(lunch|dinner|breakfast|brunch|meeting|appointment|dentist|doctor|birthday|holiday|vacation|church|school|wedding|party|pto|off|work|call|shift)\b/i;

// A plausible facility name for the generic fallback: capitalised,
// at least two characters, no ordinary-life words, no digits left in
// it (a leftover "8 Nov" is a date fragment, not a facility).
function facilityLikeName(s: string): boolean {
  const v = String(s || "").trim();
  if (v.length < 2 || v.length > 80) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  if (!/^[A-Z0-9]/.test(v)) return false;
  if (NON_FACILITY_WORDS.test(v)) return false;
  if (/\d/.test(v)) return false;
  return true;
}

export function parseWorkShiftEvent(
  title: string,
  location: string,
  date: string,
  facilities: FacilityPayRule[] = [],
): { facility: string; type: string; pay: string; facilityKnown: boolean } | null {
  const t = String(title || "").trim();
  const loc = String(location || "").trim();
  if (!t && !loc) return null;

  // 1. Holzer — the confirmed rules win over everything else.
  const holzerTitle = parseWorkShiftTitle(t, date);
  if (holzerTitle) return { ...holzerTitle, facilityKnown: true };
  if (/\bholzer\b/i.test(loc)) {
    const h = parseWorkShiftTitle(`Holzer ${t}`, date);
    if (h) return { ...h, facilityKnown: true };
  }
  if (/^holzer$/i.test(t)) {
    return { facility: "Holzer", type: "Shift", pay: "", facilityKnown: true };
  }

  // 2. The user's Facilities list — longest name/alias first, so
  // "Charleston Area Medical Center" wins over a short alias of
  // another facility that happens to appear inside it.
  const rules = [...facilities].sort((a, b) => {
    const longest = (r: FacilityPayRule) =>
      Math.max(r.name.length, ...(r.aliases ?? []).map((x) => x.length));
    return longest(b) - longest(a);
  });
  for (const rule of rules) {
    const names = [rule.name, ...(rule.aliases ?? [])];
    const matched = names.find(
      (n) => containsToken(t, n) || (loc !== "" && containsToken(loc, n)),
    );
    if (!matched) continue;
    // Shift pattern in the title (or, for a title-less event, in the
    // location); a bare number counts only once the facility token is
    // removed, so "CAMC 8" reads as an 8-hour day and "CAMC 8 Nov 24"
    // still reads as the leading 8, never the trailing date. A title
    // that IS just the facility name is an unclassified shift for the
    // user to confirm — never skipped, never priced.
    let type = shiftTypeFromPattern(t) ?? shiftTypeFromPattern(loc);
    if (!type) {
      const rest = t
        .replace(new RegExp(escapeRegExp(matched).replace(/\s+/g, "\\s+"), "i"), "")
        .trim()
        .replace(/^[-–—:;,\s]+|[-–—:;,\s]+$/g, "");
      type = leadingNumberShiftType(rest);
      if (!type && titleEqualsToken(t, matched)) type = "Shift";
    }
    if (!type) continue; // e.g. "Lunch at CAMC": facility named, not a shift.
    return {
      facility: rule.name,
      type,
      pay: priceShiftWithFacility(type, rule),
      facilityKnown: true,
    };
  }

  // 3. Generic fallback — a facility-like title plus a shift pattern.
  // Pay is always blank: the facility is not listed yet, so no rate
  // exists to apply. The client learns the facility name from the
  // import and offers it on the Facilities tab.
  const type = shiftTypeFromPattern(t) ?? bareNumberShiftType(t);
  if (!type) return null;
  let facilityRaw = "";
  const bare = /^(.+?)\s+(8|10|12|24)\s*$/.exec(t);
  if (bare) {
    // A bare trailing number only counts when the text before it is a
    // clean facility name — "CAMC 8 Nov 24" (digit / month in the
    // prefix) is a date fragment, not a shift.
    if (/\d/.test(bare[1]) ||
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i.test(bare[1])) {
      return null;
    }
    facilityRaw = bare[1];
  } else {
    const idx = t.search(SHIFT_PATTERN_RE);
    // idx > 0: the facility is the text before the pattern ("St.
    // Mary's 12-hour shift"). idx <= 0: the title is just the pattern
    // ("8", "2nd call"), so the facility can only come from the
    // location — or nowhere, and this is not a shift.
    facilityRaw = idx > 0 ? t.slice(0, idx) : loc;
  }
  facilityRaw = cleanFacilityRaw(facilityRaw);
  if (!facilityRaw && loc) facilityRaw = cleanFacilityRaw(loc);
  if (!facilityLikeName(facilityRaw)) return null;
  return { facility: facilityRaw, type, pay: "", facilityKnown: false };
}

// Two facility spellings are the same facility when they match
// case-insensitively, or when both are a name/alias of one saved
// facility rule (e.g. "CAMC" and "Charleston Area Medical Center").
// The import loop dedupes through this, so a shift first imported
// under an alias is not re-created under the canonical name.
export function sameFacility(a: string, b: string, rules: FacilityPayRule[]): boolean {
  const norm = (s: string) => String(s || "").trim().toLowerCase();
  if (norm(a) === norm(b)) return true;
  return rules.some((r) => {
    const names = [r.name, ...(r.aliases ?? [])].map(norm);
    return names.includes(norm(a)) && names.includes(norm(b));
  });
}

// Pure decision for an import-map row whose paired shift is NOT on the
// device. This is the exact spot that silently skipped every shift on
// Nov 5, 2026: a row created by a sync whose response never arrived
// (proxy timeout) was indistinguishable from a row left by a user
// deletion, and both were skipped — and the old client alert then
// labelled the whole total "skipped as not shifts", even though 231 of
// them had parsed as Holzer shifts. The three states are now distinct:
//   skip-deleted  — the user deleted the shift (flagged, or a tombstone
//                   arrived with this sync). Never re-import.
//   skip-legacy   — migration 005 has not run, so the flags that would
//                   tell "never delivered" from "deleted" do not exist.
//                   Keep the old safe skip; the client repair button is
//                   the explicit way out until 005 runs.
//   repair-create — the row was never delivered (never seen on the
//                   device, not flagged deleted). Re-create the shift
//                   with the same id so the pairing stays valid.
//   repair-pair   — same as repair-create, except the shift is already
//                   on the device under a different id (re-added by the
//                   user, or created from the dedicated calendar): drop
//                   the phantom row and pair the shift that is here.
export function decideStaleImportRow(opts: {
  deletedLocally?: unknown;
  tombstoned: boolean;
  keyExistsLocally: boolean;
  flagsSupported: boolean;
}): "skip-deleted" | "skip-legacy" | "repair-create" | "repair-pair" {
  if (opts.deletedLocally === true || opts.tombstoned) return "skip-deleted";
  if (!opts.flagsSupported) return "skip-legacy";
  if (opts.keyExistsLocally) return "repair-pair";
  return "repair-create";
}

// Pure per-event classification for the Apple import loop: what one
// parsed source event becomes, before any side effect. Branch order
// mirrors the loop — a shift already on the device is never re-created
// (second sync: no duplicate), a stale pairing is decided by
// decideStaleImportRow, and only an event with no pairing and no local
// match is a fresh create. `importRow` is null when the event was
// never paired before. The cancelled / undated / unparsed cases are
// decided by the caller first (they are "skip-not-shift" there).
export type ImportEventDecision =
  | "skip-not-shift"
  | "already-here"
  | "skip-deleted"
  | "skip-legacy"
  | "repair-create"
  | "repair-pair"
  | "duplicate"
  | "create";

export function decideImportEvent(opts: {
  parsed: boolean;
  localExists: boolean;
  importRow?: { deleted_locally?: unknown } | null;
  tombstoned: boolean;
  keyExistsLocally: boolean;
  flagsSupported: boolean;
}): ImportEventDecision {
  if (!opts.parsed) return "skip-not-shift";
  if (opts.localExists) return "already-here";
  if (opts.importRow) {
    return decideStaleImportRow({
      deletedLocally: opts.importRow.deleted_locally,
      tombstoned: opts.tombstoned,
      keyExistsLocally: opts.keyExistsLocally,
      flagsSupported: opts.flagsSupported,
    });
  }
  if (opts.keyExistsLocally) return "duplicate";
  return "create";
}

export function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const bytes = new Uint8Array(digest);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Connection row helpers. `calendar_connections` has one row per user per
// provider. Token columns hold AES-GCM ciphertext (see above), never plain
// text; access tokens are also encrypted, not just refresh tokens.
export type ConnectionRow = Record<string, unknown> & {
  user_id: string;
  provider: string;
};

export async function getConnection(
  user_id: string,
  provider: string,
): Promise<ConnectionRow | null> {
  const rows = await sbGet(
    "calendar_connections",
    `select=*&user_id=eq.${encodeURIComponent(user_id)}&provider=eq.${encodeURIComponent(provider)}`,
  );
  return (rows[0] as ConnectionRow) ?? null;
}

export async function getMapRows(
  userId: string,
  provider: string,
): Promise<Record<string, unknown>[]> {
  return await sbGet(
    "calendar_sync_map",
    `select=*&user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`,
  );
}

export async function writeSyncLog(
  userId: string,
  provider: string,
  direction: string,
  counts: Record<string, number>,
  error: string | null,
): Promise<void> {
  try {
    await sbInsert("sync_log", {
      user_id: userId,
      provider,
      direction,
      shifts_created: counts.created ?? 0,
      shifts_updated: counts.updated ?? 0,
      shifts_flagged: counts.flagged ?? 0,
      shifts_deleted: counts.deleted ?? 0,
      error: error ?? null,
    });
  } catch {
    // A logging failure must never fail the sync itself.
  }
}

// Where the browser returns after a provider consent screen. The owner sets
// APP_URL once (see supabase/functions/README.md) to the URL users actually
// open. If it is unset, the callback renders a plain success page instead of
// guessing a URL — it never redirects to an owner-unapproved origin.
export function callbackReturnUrl(fallbackQuery: string): string | null {
  const base = appUrl().replace(/\/$/, "");
  if (!base) return null;
  return `${base}${fallbackQuery}`;
}

export function fnUrl(name: string): string {
  return `${supabaseUrl()}/functions/v1/${name}`;
}
