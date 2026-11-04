// Microsoft Outlook (Graph) provider helpers shared by outlook-auth and
// sync-calendar. Importing this module has no side effects.

import { decryptSecret, encryptSecret } from "./calendar.ts";

export const GRAPH_API = "https://graph.microsoft.com/v1.0";
export const MS_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

function clientId(): string {
  return Deno.env.get("OUTLOOK_CLIENT_ID") ?? "";
}
function clientSecret(): string {
  return Deno.env.get("OUTLOOK_CLIENT_SECRET") ?? "";
}

export async function graphFetch(
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
    scope: "Calendars.ReadWrite offline_access",
  });
  const r = await fetch(MS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error("outlook_refresh_failed");
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

export async function outlookAccessToken(
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

export async function ensureOutlookCalendar(
  accessToken: string,
  conn: Record<string, unknown>,
): Promise<string> {
  if (conn.calendar_id) return String(conn.calendar_id);
  const r = await graphFetch(`${GRAPH_API}/me/calendars`, accessToken);
  if (r.ok) {
    const list = await r.json();
    const found = (list.value ?? []).find(
      (c: { name?: string }) => c.name === "CRNA Hub",
    );
    if (found?.id) return String(found.id);
  }
  const created = await graphFetch(`${GRAPH_API}/me/calendars`, accessToken, {
    method: "POST",
    body: JSON.stringify({ name: "CRNA Hub" }),
  });
  if (!created.ok) throw new Error("outlook_calendar_create_failed");
  const data = await created.json();
  return String(data.id);
}
