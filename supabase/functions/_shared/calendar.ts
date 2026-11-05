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
