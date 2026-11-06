// CRNA Hub — same-origin Supabase Auth proxy (Vercel serverless function).
//
// Why this exists: on some browsers/devices, a POST from the app page
// directly to https://<project>.supabase.co/auth/v1/... fails at the
// network layer ("Load failed") even though the Supabase host itself is
// reachable (GET /auth/v1/health loads fine). Routing the auth request
// through this same-origin function removes the browser-to-Supabase
// cross-origin POST from the path entirely: the browser only ever talks
// to its own origin, and this function talks to Supabase server-side.
//
// Security notes:
// - This is NOT an open proxy. Only four allowlisted GoTrue endpoints
//   are forwarded (signup, token with password/refresh_token grants,
//   logout, and update-user — a PUT that writes the signed-in user's
//   own user_metadata with their own access token, used for the step 1
//   profile: name, employment type, monthly income goal), and only with
//   the project's PUBLISHABLE key — the same public client key already
//   embedded in supabase-config.js. The secret/service-role key is never
//   used here and never appears here.
// - Request bodies are forwarded as-is to GoTrue; this function does not
//   log, store, or inspect passwords, tokens, or emails.
// - The function returns GoTrue's status code and JSON body verbatim, so
//   the app's existing error handling and session logic are unchanged.

const SUPABASE_URL = 'https://xgoghgihfhtnyevgapyp.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_jA1PXQMusABD53uoqtoBBg_mTNVDgDX';

const ALLOWED = {
  signup: { path: '/auth/v1/signup', grants: null },
  token: { path: '/auth/v1/token', grants: new Set(['password', 'refresh_token']) },
  logout: { path: '/auth/v1/logout', grants: null },
  // Profile save only: the caller must pass its own access token, and
  // GoTrue only ever updates the token owner's metadata.
  'update-user': { path: '/auth/v1/user', method: 'PUT', grants: null },
};

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, proxy: 'crna-hub-auth' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
  }
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  const spec = ALLOWED[payload.endpoint];
  if (!spec) {
    res.status(400).json({ error: 'unknown_endpoint' });
    return;
  }
  let upstream = SUPABASE_URL + spec.path;
  if (spec.grants) {
    const grant = payload.query && payload.query.grant_type;
    if (!spec.grants.has(grant)) {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    upstream += '?grant_type=' + encodeURIComponent(grant);
  }
  const headers = {
    apikey: PUBLISHABLE_KEY,
    'Content-Type': 'application/json',
  };
  if (payload.token) headers.Authorization = 'Bearer ' + payload.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const upstreamRes = await fetch(upstream, {
      method: spec.method || 'POST',
      headers,
      body: JSON.stringify(payload.body || {}),
      signal: controller.signal,
    });
    const text = await upstreamRes.text();
    res.setHeader('X-Auth-Proxy', '1');
    res.setHeader('Content-Type', 'application/json');
    res.status(upstreamRes.status).send(text);
  } catch (e) {
    res.status(502).json({ error: 'upstream_unreachable', message: 'Could not reach the sign-in service.' });
  } finally {
    clearTimeout(timer);
  }
};
