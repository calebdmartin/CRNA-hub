// CRNA Hub — same-origin Supabase Edge Function proxy (Vercel serverless).
//
// Why this exists: on some browsers/devices, a request from the app page
// directly to https://<project>.supabase.co fails at the network layer
// ("Load failed") even though the host is reachable for GETs. The auth
// proxy (api/auth.js) and PostgREST proxy (api/rest.js) already proved
// that routing through a same-origin function fixes that path; this
// extends the same pattern to the live calendar sync functions, so the
// browser only ever talks to its own origin. Without it, the Live
// calendar sync panel reports the sync function as "not deployed or not
// reachable" on such devices even when the function is live.
//
// Security notes:
// - This is NOT an open proxy. Only six allowlisted functions are
//   forwarded (sync-calendar, google-auth, outlook-auth, portal-sync,
//   extract-contract, assistant-chat), and only allowlisted actions:
//   sync-calendar config/status/log/apple-calendars/
//   sync/connect-apple/set-apple-source-calendar/disconnect/
//   set-auto-delete/resolve-deletion, the OAuth "start" action for
//   google-auth/outlook-auth, and portal-sync config/status/
//   verify-nbcrna/verify-license (the former connect-aana action was
//   deleted Nov 5, 2026 — audit F9 — and is rejected here),
//   extract-contract extract-contract, and assistant-chat chat.
//   Everything else is rejected with 400.
// - Only the project's PUBLISHABLE key is used (the same public client
//   key already embedded in supabase-config.js), plus the user's own
//   Authorization Bearer token, which the Edge Function verifies
//   server-side exactly as it does for direct requests. The
//   secret/service-role key is never used here and never appears here.
// - The public config check (sync-calendar?action=config and
//   portal-sync?action=config, booleans only, no user data) is the one
//   call allowed without a user token.
//   Every other call requires a token and is rejected with 401 without
//   one, so no user data is reachable through this proxy anonymously.
// - Upstream status and body are returned verbatim, so the app's
//   existing error handling is unchanged. The function does not log,
//   store, or inspect tokens, passwords, or shift contents.

const SUPABASE_URL = 'https://xgoghgihfhtnyevgapyp.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_jA1PXQMusABD53uoqtoBBg_mTNVDgDX';

const FUNCTIONS = {
  'sync-calendar': new Set(['config', 'status', 'log', 'apple-calendars', 'sync', 'connect-apple', 'set-apple-source-calendar', 'disconnect', 'set-auto-delete', 'resolve-deletion']),
  'google-auth': new Set(['start']),
  'outlook-auth': new Set(['start']),
  // Portal connections (Credentials tab): NBCRNA public verification,
  // state-board verification attempts, status. (The former AANA
  // one-time sign-in action 'connect-aana' was deleted Nov 5, 2026 —
  // audit F9 — and is no longer allowlisted.)
  // Same token rule as sync-calendar: the public config check is
  // token-less, everything else requires the user's token.
  'portal-sync': new Set(['config', 'status', 'verify-nbcrna', 'verify-license']),
  // AI contract reading (Facilities + Import & Backup "Read with AI"):
  // one action, POST only, requires the user's token like the rest.
  'extract-contract': new Set(['extract-contract']),
  // Live Assistant chat (Assistant tab): one action, POST only, requires
  // the user's token like the rest. The client sends only the question
  // plus a minimal structured summary of the user's records — never
  // facility notes/codes, documents, or patient information.
  'assistant-chat': new Set(['chat']),
};

function bad(res, code, status) {
  res.status(status || 400).json({ error: code });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, proxy: 'crna-hub-fn' });
    return;
  }
  if (req.method !== 'POST') {
    bad(res, 'method_not_allowed', 405);
    return;
  }
  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
  }
  if (!payload || typeof payload !== 'object' || typeof payload.function !== 'string') {
    bad(res, 'bad_request');
    return;
  }
  const allowedActions = FUNCTIONS[payload.function];
  if (!allowedActions) {
    bad(res, 'function_not_allowed');
    return;
  }
  const method = String(payload.method || 'POST').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    bad(res, 'unsupported_method');
    return;
  }
  // Action comes from the query-style action (GET) or the body action (POST).
  const action = payload.action || (payload.body && payload.body.action);
  if (!action || !allowedActions.has(action)) {
    bad(res, 'action_not_allowed');
    return;
  }
  const isPublicConfig = (payload.function === 'sync-calendar' || payload.function === 'portal-sync') && method === 'GET' && action === 'config';
  if (!isPublicConfig && !payload.token) {
    bad(res, 'not_signed_in', 401);
    return;
  }
  let upstream = SUPABASE_URL + '/functions/v1/' + payload.function;
  if (method === 'GET') upstream += '?action=' + encodeURIComponent(action);
  const headers = { apikey: PUBLISHABLE_KEY };
  if (payload.token) headers.Authorization = 'Bearer ' + payload.token;
  let upstreamBody;
  if (method === 'POST') {
    upstreamBody = JSON.stringify(payload.body || { action });
    headers['Content-Type'] = 'application/json';
  }
  const controller = new AbortController();
  // Vision reads and assistant answers take longer than a sync status
  // check: give the AI calls 60s through the proxy (the Edge Function
  // itself aborts at 60s).
  const timer = setTimeout(() => controller.abort(), (payload.function === 'extract-contract' || payload.function === 'assistant-chat') ? 60000 : 25000);
  try {
    const upstreamRes = await fetch(upstream, {
      method,
      headers,
      body: upstreamBody,
      signal: controller.signal,
    });
    const text = await upstreamRes.text();
    res.setHeader('X-Fn-Proxy', '1');
    res.setHeader('Content-Type', 'application/json');
    res.status(upstreamRes.status).send(text);
  } catch (e) {
    // A timeout is a different failure from an unreachable service:
    // the sync itself was still running server-side (a big calendar
    // scan used to take 30-80s), so the client can say "try again"
    // instead of implying the service is down.
    if (controller.signal.aborted) {
      res.status(502).json({ error: 'sync_timed_out', message: 'The sync service took too long to answer. Nothing was changed — tap Sync now again.' });
    } else {
      res.status(502).json({ error: 'upstream_unreachable', message: 'Could not reach the sync service.' });
    }
  } finally {
    clearTimeout(timer);
  }
};
