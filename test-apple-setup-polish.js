// CRNA Hub — Apple Calendar one-tap setup polish (Nov 8, 2026).
// Run: node test-apple-setup-polish.js
//
// Covers the Live calendar sync Apple card (the same component the
// Account tab panel and the onboarding step-2 deep link render):
//   * a prominent "Create it at Apple →" anchor (real <a>, target
//     _blank, rel noopener) ABOVE the fields, pointing at Apple's
//     app-specific-passwords security section;
//   * the old instruction paragraph replaced by a 3-step list;
//   * the beta reassurance line: the password step is web-only, the
//     final app uses the iPhone's Allow prompt;
//   * the two safety lines kept ("Stored encrypted and never shown
//     again." / "Never enter your normal Apple password here.");
//   * paste-friendly password: Apple's grouped format
//     (xxxx-xxxx-xxxx-xxxx, spaces too) is stripped of separators
//     before the connect request is sent;
//   * Google's card is untouched by any of it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = fs.existsSync(path.join(__dirname, 'repo', 'app.js'))
  ? path.join(__dirname, 'repo') + path.sep
  : __dirname + path.sep;
const store = new Map();
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, scrollIntoView() {},
  };
}
const elements = {};
const alerts = [];
const fetchCalls = [];
class FakeFormData {
  constructor(form) { this._e = (form && form._entries) || []; }
  *[Symbol.iterator]() { yield* this._e; }
}
const sandbox = {
  console, setTimeout, clearTimeout, AbortController, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  FormData: FakeFormData,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  document: {
    getElementById: (id) => elements[id] || (elements[id] = el()),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
  fetch: async (url, opts) => {
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    fetchCalls.push({ url, body });
    let data = { ok: true };
    if (body && body.action === 'status') data = { connections: [] };
    else if (body && body.action === 'log') data = { log: [] };
    else if (body && body.action === 'apple-calendars') data = { calendars: [] };
    return { status: 200, ok: true, text: async () => JSON.stringify(data) };
  },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

(async () => {
  run(`
    liveSyncConfig = { state: 'ready', google: true, outlook: false, apple: true, encryption: true };
    liveSyncConnections = {};
    liveSyncApplePick = null;
    globalThis.__appleOff = liveSyncProviderCard('apple');
    globalThis.__googleOff = liveSyncProviderCard('google');
  `);
  const card = sandbox.__appleOff;
  const APPLE_URL = 'https://appleid.apple.com/account/manage/section/security';

  // --- 1. One-tap button ---
  t('button present: "Create it at Apple →" is a real anchor with the Apple URL, target _blank, rel noopener',
    card.includes('<a class="button" href="' + APPLE_URL + '" target="_blank" rel="noopener">Create it at Apple →</a>'));
  t('button sits above the Apple ID and password fields',
    card.indexOf('Create it at Apple') > -1 &&
    card.indexOf('Create it at Apple') < card.indexOf('f_liveAppleId') &&
    card.indexOf('Create it at Apple') < card.indexOf('f_liveApplePw'));

  // --- 2. Three short steps, old paragraph gone ---
  t('step 1 present', card.includes('Tap the button and sign in at Apple.'));
  t('step 2 present (names the app-specific password “CRNA Hub”)',
    card.includes('Generate an app-specific password named “CRNA Hub”.'));
  t('step 3 present', card.includes('Paste it here.'));
  t('old instruction paragraph is gone',
    !card.includes('create one in your Apple account') &&
    !card.includes('Sign-In and Security') &&
    !card.includes('then enter it here once'));

  // --- 3. Beta reassurance line ---
  t('beta note present, verbatim',
    card.includes('Beta note: this password step is only for the web version — in the final app you’ll just tap Allow when your iPhone asks.'));

  // --- 4. Safety lines kept; fields and connect flow intact ---
  t('safety lines kept',
    card.includes('Stored encrypted and never shown again.') &&
    card.includes('Never enter your normal Apple password here.'));
  t('fields and connect button unchanged',
    card.includes('id="f_liveAppleId"') && card.includes('id="f_liveApplePw"') &&
    card.includes('placeholder="xxxx-xxxx-xxxx-xxxx"') &&
    card.includes('data-action="live-apple-connect"') &&
    card.includes('Connect Apple Calendar'));

  // --- 5. Google card untouched ---
  t('Google card has no Apple button, steps, or beta note',
    sandbox.__googleOff.includes('Connect Google Calendar') &&
    !sandbox.__googleOff.includes('Create it at Apple') &&
    !sandbox.__googleOff.includes('Beta note'));

  // --- 6. Grouped paste is cleaned before it is sent ---
  elements['f_liveAppleId'] = Object.assign(el(), { value: 'a@icloud.com' });
  elements['f_liveApplePw'] = Object.assign(el(), { value: 'abcd-efgh ijkl-mnop' });
  try { await run(`liveSyncAppleConnect()`); } catch (e) { /* render noise is fine; the request is what matters */ }
  const sent = fetchCalls.map((c) => JSON.stringify(c.body || {})).join('\n');
  t('connect request carries the password with separators stripped',
    sent.includes('abcdefghijklmnop') && !sent.includes('abcd-efgh'));

  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
})();
