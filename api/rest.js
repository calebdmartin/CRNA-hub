// CRNA Hub — same-origin Supabase PostgREST / Storage proxy (Vercel serverless).
//
// Why this exists: on some browsers/devices, a POST/PUT/DELETE from the app
// page directly to https://<project>.supabase.co fails at the network layer
// ("Load failed") even though the host is reachable for GETs. The auth
// proxy (api/auth.js) already proved that routing through a same-origin
// function fixes that path; this extends the same pattern to credential
// sync: PostgREST rows and certification-document objects now go through
// this function, so the browser only ever talks to its own origin.
//
// Security notes:
// - This is NOT an open proxy. Only allowlisted paths are forwarded:
//   /rest/v1/<table> for the credential/calendar tables below, and
//   /storage/v1/object/certification-documents/<user-path> for the one
//   private certification bucket. Everything else is rejected with 400.
// - Only the project's PUBLISHABLE key is used (the same public client key
//   already embedded in supabase-config.js), plus the user's own
//   Authorization Bearer token, which Row Level Security enforces
//   server-side exactly as it does for direct requests. The
//   secret/service-role key is never used here and never appears here.
// - Upstream status and body are returned verbatim, so the app's existing
//   error handling is unchanged. The function does not log, store, or
//   inspect tokens, file contents, or record contents.

const SUPABASE_URL = 'https://xgoghgihfhtnyevgapyp.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_jA1PXQMusABD53uoqtoBBg_mTNVDgDX';

const REST_TABLES = new Set([
  'nbcrna_profiles',
  'aana_memberships',
  'licenses',
  'ce_records',
  'portal_connections',
  'documents',
  'calendar_connections',
  'calendar_sync_map',
  'calendar_pending_deletions',
  'sync_log',
]);

const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

function bad(res, code, status) {
  res.status(status || 400).json({ error: code });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, proxy: 'crna-hub-rest' });
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
  if (!payload || typeof payload !== 'object' || typeof payload.path !== 'string') {
    bad(res, 'bad_request');
    return;
  }
  const method = String(payload.method || 'GET').toUpperCase();
  if (!METHODS.has(method)) {
    bad(res, 'unsupported_method');
    return;
  }
  const path = payload.path;
  let isStorage = false;
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length).split(/[?/]/)[0];
    if (!REST_TABLES.has(table)) {
      bad(res, 'table_not_allowed');
      return;
    }
  } else if (path.startsWith('/storage/v1/object/certification-documents/')) {
    isStorage = true;
  } else {
    bad(res, 'path_not_allowed');
    return;
  }
  // Never allow a request without a user token: RLS must apply.
  if (!payload.token) {
    bad(res, 'not_signed_in', 401);
    return;
  }
  const headers = {
    apikey: PUBLISHABLE_KEY,
    Authorization: 'Bearer ' + payload.token,
  };
  if (payload.prefer) headers.Prefer = String(payload.prefer);
  let upstreamBody;
  if (payload.bodyBase64) {
    upstreamBody = Buffer.from(String(payload.bodyBase64), 'base64');
    headers['Content-Type'] = payload.contentType || 'application/octet-stream';
  } else if (payload.body !== undefined && payload.body !== null) {
    upstreamBody = JSON.stringify(payload.body);
    headers['Content-Type'] = 'application/json';
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const upstreamRes = await fetch(SUPABASE_URL + path, {
      method,
      headers,
      body: upstreamBody,
      signal: controller.signal,
    });
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    const contentType = upstreamRes.headers.get('content-type') || 'application/json';
    res.setHeader('X-Rest-Proxy', '1');
    res.setHeader('Content-Type', contentType);
    // For JSON responses, forward the body verbatim. For binary (storage
    // downloads), forward the bytes verbatim with their content type.
    res.status(upstreamRes.status).send(buf);
  } catch (e) {
    res.status(502).json({ error: 'upstream_unreachable', message: 'Could not reach the sync service.' });
  } finally {
    clearTimeout(timer);
  }
};
