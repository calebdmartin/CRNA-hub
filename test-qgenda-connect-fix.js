// CRNA Hub — QGenda connect fix (Nov 6, 2026).
//
// Caleb pasted his real QGenda Subscription URL, tapped "Connect
// QGenda feed", and got "Could not connect the QGenda feed:
// function_not_allowed — Nothing was saved." Root cause: the
// same-origin proxy (api/fn.js) forwards only an allowlist of Edge
// Functions, and qgenda-feed was never added to it — every QGenda
// call died at the proxy before reaching Supabase, even though the
// qgenda-feed Edge Function was deployed and healthy (verified live:
// save/status/fetch/disconnect all work direct, stored URL is
// AES-GCM ciphertext, migration 006 applied).
//
// This suite pins: (1) the proxy allowlists qgenda-feed with exactly
// its four actions and actually forwards a save call upstream;
// (2) the proxy still rejects unknown functions/actions; (3) the app
// maps QGenda errors to plain next steps via qgendaFriendlyError and
// never renders a raw server code in the banner again.
const fs = require('fs');
const path = require('path');
const R = __dirname + '/';
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name); }
}

const fnSrc = fs.readFileSync(R + 'api/fn.js', 'utf8');
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');

t('proxy allowlists qgenda-feed with its four actions',
  /'qgenda-feed': new Set\(\['status', 'save', 'fetch', 'disconnect'\]\)/.test(fnSrc));

(async () => {
  // Functional: run the real handler with a stubbed upstream fetch.
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, text: async () => JSON.stringify({ ok: true, connected: true }) };
  };
  delete require.cache[path.resolve(R + 'api/fn.js')];
  const handler = require(R + 'api/fn.js');
  const mockRes = () => ({
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader() {},
    send(x) { this.body = x; return this; },
  });
  const save = mockRes();
  await handler({ method: 'POST', body: { function: 'qgenda-feed', action: 'save', token: 'jwt', body: { action: 'save', url: 'https://app.qgenda.com/ical/x' } } }, save);
  t('qgenda save is forwarded upstream (no function_not_allowed)',
    save.statusCode === 200 && calls.length === 1 &&
    calls[0].url === 'https://xgoghgihfhtnyevgapyp.supabase.co/functions/v1/qgenda-feed');
  const unknown = mockRes();
  await handler({ method: 'POST', body: { function: 'not-a-function', action: 'save', token: 'jwt', body: {} } }, unknown);
  t('unknown functions are still rejected',
    unknown.statusCode === 400 && unknown.body && unknown.body.error === 'function_not_allowed');
  const bogus = mockRes();
  await handler({ method: 'POST', body: { function: 'qgenda-feed', action: 'bogus', token: 'jwt', body: { action: 'bogus' } } }, bogus);
  t('non-allowlisted qgenda actions are still rejected',
    bogus.statusCode === 400 && bogus.body && bogus.body.error === 'action_not_allowed');
  global.fetch = realFetch;

  t('app has the human-error mapper for QGenda',
    appSrc.includes('function qgendaFriendlyError('));
  t('connect catch uses the mapper (no raw code in the banner)',
    appSrc.includes("qgendaStatusError=qgendaFriendlyError(err,'save')") &&
    !appSrc.includes('Could not connect the QGenda feed: '));
  t('fetch catch uses the mapper too',
    appSrc.includes("qgendaStatusError=qgendaFriendlyError(err,'fetch')") &&
    !appSrc.includes('Could not check the QGenda feed: '));
  t('mapper covers the server-side failure family with a plain fallback',
    appSrc.includes('Something went wrong on our side just now'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
