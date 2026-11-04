// Google Calendar provider helpers shared by google-auth and sync-calendar.
// Importing this module has no side effects (no Deno.serve here).

import { decryptSecret, encryptSecret } from "./calendar.ts";

export const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

function clientId(): string {
  return Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
}
function clientSecret(): string {
  return Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
}

export async function googleFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function refreshAccess(
  conn: Record<string, unknown>,
): Promise<{ accessToken: string; row: Record<string, unknown> }> {
  const refresh = await decryptSecret(String(conn.encrypted_refresh_token ?? ""));
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "refresh_token",
    refresh_token: refresh,
  });
  const r = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error("google_refresh_failed");
  const data = await r.json();
  const row: Record<string, unknown> = { ...conn };
  if (data.access_token) {
    row.encrypted_access_token = await encryptSecret(String(data.access_token));
    row.access_token_expires_at = new Date(
      Date.now() + (Number(data.expires_in ?? 3600) * 1000),
    ).toISOString();
  }
  if (data.refresh_token) {
    row.encrypted_refresh_token = await encryptSecret(String(data.refresh_token));
  }
  return { accessToken: String(data.access_token), row };
}

// Returns a working access token, refreshing first when expired or nearly so.
export async function googleAccessToken(
  conn: Record<string, unknown>,
): Promise<{ accessToken: string; row: Record<string, unknown> }> {
  const expires = conn.access_token_expires_at
    ? Date.parse(String(conn.access_token_expires_at))
    : 0;
  if (expires && expires - Date.now() > 60_000 && conn.encrypted_access_token) {
    return {
      accessToken: await decryptSecret(String(conn.encrypted_access_token)),
      row: conn,
    };
  }
  return await refreshAccess(conn);
}

export async function ensureGoogleCalendar(
  accessToken: string,
  conn: Record<string, unknown>,
): Promise<string> {
  if (conn.calendar_id) return String(conn.calendar_id);
  const r = await googleFetch(`${GOOGLE_API}/users/me/calendarList`, accessToken);
  if (r.ok) {
    const list = await r.json();
    const found = (list.items ?? []).find(
      (c: { summary?: string }) => c.summary === "CRNA Hub",
    );
    if (found?.id) return String(found.id);
  }
  const created = await googleFetch(`${GOOGLE_API}/calendars`, accessToken, {
    method: "POST",
    body: JSON.stringify({ summary: "CRNA Hub", timeZone: "UTC" }),
  });
  if (!created.ok) throw new Error("google_calendar_create_failed");
  const data = await created.json();
  return String(data.id);
}

export async function revokeGoogle(refreshToken: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch {
    // Revocation is best-effort; the stored connection is deleted regardless.
  }
}
