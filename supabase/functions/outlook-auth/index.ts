// CRNA Hub — Outlook (Microsoft Entra) OAuth start + callback.
// Mirrors google-auth/index.ts; see that file's header for the security
// model. Secrets (OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, APP_URL) come
// only from Supabase function secrets — never from the repo or client code.
// Scope: Calendars.ReadWrite + offline_access (refresh token). The sync
// only ever touches the dedicated "CRNA Hub" calendar, never the user's
// other calendars. Redirect URI registered in Entra must be exactly this
// function's URL.

import {
  CORS,
  authUserId,
  encryptSecret,
  err,
  fnUrl,
  getConnection,
  json,
  pkceChallenge,
  randomHex,
  sbDelete,
  sbGet,
  sbInsert,
  sbUpsert,
} from "../_shared/calendar.ts";
import {
  ensureOutlookCalendar,
  outlookAccessToken,
} from "../_shared/outlook.ts";

const MS_AUTH =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPE = "Calendars.ReadWrite offline_access openid profile";

function clientId(): string {
  return Deno.env.get("OUTLOOK_CLIENT_ID") ?? "";
}
function clientSecret(): string {
  return Deno.env.get("OUTLOOK_CLIENT_SECRET") ?? "";
}
function redirectUri(): string {
  return fnUrl("outlook-auth");
}

async function handleStart(req: Request): Promise<Response> {
  const userId = await authUserId(req);
  if (!userId) return err("not_signed_in", 401);
  if (!clientId() || !clientSecret()) return err("provider_not_configured", 503);
  const state = randomHex(24);
  const verifier = randomHex(48);
  const challenge = await pkceChallenge(verifier);
  await sbInsert("calendar_oauth_states", {
    state,
    user_id: userId,
    provider: "outlook",
    code_verifier: verifier,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return json({ ok: true, authUrl: `${MS_AUTH}?${params}` });
}

function successPage(providerLabel: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>CRNA Hub — ${providerLabel} connected</title>` +
      `<body style="font-family:system-ui;padding:32px"><h1>${providerLabel} connected</h1>` +
      `<p>Live calendar sync is now on. Shifts in your dedicated “CRNA Hub” calendar will sync both ways.</p>` +
      `<p>Close this tab and return to CRNA Hub.</p></body>`,
    { headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function handleCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const appBase = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  const back = (q: string) => appBase ? `${appBase}${q}` : null;
  if (providerError || !code || !state) {
    const dest = back(`?calendar_error=${encodeURIComponent(providerError ?? "oauth_failed")}`);
    return dest ? Response.redirect(dest, 302) : err("oauth_failed", 400);
  }
  const rows = await sbGet(
    "calendar_oauth_states",
    `select=*&state=eq.${encodeURIComponent(state)}&provider=eq.outlook`,
  );
  const row = rows[0];
  if (!row || Date.parse(String(row.expires_at ?? "")) < Date.now()) {
    return err("oauth_state_expired", 400);
  }
  await sbDelete("calendar_oauth_states", `state=eq.${encodeURIComponent(state)}`);
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    code_verifier: String(row.code_verifier ?? ""),
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    scope: "Calendars.ReadWrite offline_access",
  });
  const r = await fetch(MS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) return err("outlook_token_exchange_failed", 502);
  const data = await r.json();
  if (!data.refresh_token) return err("outlook_refresh_token_missing", 502);
  const userId = String(row.user_id);
  const conn: Record<string, unknown> = {
    user_id: userId,
    provider: "outlook",
    encrypted_access_token: await encryptSecret(String(data.access_token)),
    encrypted_refresh_token: await encryptSecret(String(data.refresh_token)),
    access_token_expires_at: new Date(
      Date.now() + (Number(data.expires_in ?? 3600) * 1000),
    ).toISOString(),
    status: "connected",
    auto_delete: false,
  };
  const existing = await getConnection(userId, "outlook");
  if (existing?.calendar_id) conn.calendar_id = existing.calendar_id;
  const { accessToken } = await outlookAccessToken(conn);
  conn.calendar_id = await ensureOutlookCalendar(accessToken, conn);
  await sbUpsert("calendar_connections", conn, "user_id,provider");
  const dest = back("?calendar_connected=outlook");
  return dest ? Response.redirect(dest, 302) : successPage("Outlook");
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.action === "start") return await handleStart(req);
      return err("unknown_action", 400);
    }
    if (req.method === "GET") return await handleCallback(new URL(req.url));
    return err("method_not_allowed", 405);
  } catch {
    return err("outlook_auth_failed", 502);
  }
});
