// CRNA Hub — Google Calendar OAuth start + callback (Edge Function).
//
// POST { action: "start" }  (Authorization: Bearer <Supabase Auth JWT>)
//   -> { ok: true, authUrl } — the browser redirects to authUrl.
// GET  ?code=...&state=...  (Google redirects here; redirect URI registered
//        in Google Cloud must be exactly this function's URL)
//   -> exchanges the code (PKCE), creates/finds the dedicated "CRNA Hub"
//      calendar, encrypts and stores the tokens server-side, then returns
//      the user to the app (APP_URL secret) or a plain success page.
//
// No client ID, client secret, token, or code verifier ever appears in the
// repo or in client code. They come from Supabase function secrets:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL (see ../README.md).
// Scope: https://www.googleapis.com/auth/calendar — the minimum scope that
// allows creating the dedicated "CRNA Hub" calendar and reading/writing
// events in it. The sync only ever touches that one calendar, never the
// user's other calendars.

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
  ensureGoogleCalendar,
  googleAccessToken,
} from "../_shared/google.ts";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar";

function clientId(): string {
  return Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
}
function clientSecret(): string {
  return Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
}
function redirectUri(): string {
  return fnUrl("google-auth");
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
    provider: "google",
    code_verifier: verifier,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // refresh token, so sync keeps working
    prompt: "consent", // guarantees a refresh token even on reconnect
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return json({ ok: true, authUrl: `${GOOGLE_AUTH}?${params}` });
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
    return dest
      ? Response.redirect(dest, 302)
      : err("oauth_failed", 400);
  }
  const rows = await sbGet(
    "calendar_oauth_states",
    `select=*&state=eq.${encodeURIComponent(state)}&provider=eq.google`,
  );
  const row = rows[0];
  if (!row || Date.parse(String(row.expires_at ?? "")) < Date.now()) {
    return err("oauth_state_expired", 400);
  }
  await sbDelete(
    "calendar_oauth_states",
    `state=eq.${encodeURIComponent(state)}`,
  );
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    code_verifier: String(row.code_verifier ?? ""),
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });
  const r = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) return err("google_token_exchange_failed", 502);
  const data = await r.json();
  if (!data.refresh_token) {
    // Without a refresh token sync would die in an hour; the start step
    // forces prompt=consent, so this should not happen — surface it
    // honestly rather than storing a half-connection.
    return err("google_refresh_token_missing", 502);
  }
  const userId = String(row.user_id);
  const conn: Record<string, unknown> = {
    user_id: userId,
    provider: "google",
    encrypted_access_token: await encryptSecret(String(data.access_token)),
    encrypted_refresh_token: await encryptSecret(String(data.refresh_token)),
    access_token_expires_at: new Date(
      Date.now() + (Number(data.expires_in ?? 3600) * 1000),
    ).toISOString(),
    status: "connected",
    auto_delete: false,
  };
  const existing = await getConnection(userId, "google");
  if (existing?.calendar_id) conn.calendar_id = existing.calendar_id;
  const { accessToken } = await googleAccessToken(conn);
  conn.calendar_id = await ensureGoogleCalendar(accessToken, conn);
  await sbUpsert("calendar_connections", conn, "user_id,provider");
  const dest = back("?calendar_connected=google");
  return dest ? Response.redirect(dest, 302) : successPage("Google Calendar");
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
  } catch (e) {
    // Never leak provider bodies or tokens in an error response.
    const msg = e instanceof Error ? e.message : "sync_failed";
    if (msg === "encryption_not_configured") return err(msg, 503);
    return err("google_auth_failed", 502);
  }
});
