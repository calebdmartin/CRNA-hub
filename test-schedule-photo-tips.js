// CRNA Hub — tests for the paper-schedule photo tips toggle (Nov 6,
// 2026, branch muse/credentialing). Run: node test-schedule-photo-tips.js
//
// Caleb asked for the grid-photo instruction to live in the app as a
// dropdown like the Dashboard's "What do C, S and P mean?" toggle.
// Inside the Upload a schedule panel there is now a collapsed-by-
// default <details class="csp-info"> — same element, class, and
// interaction as the C/S/P toggle — labeled "Taking a photo of a
// paper schedule?", expanding to three short tip lines.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, scrollIntoView() {},
  };
}
const elements = {};
class FakeFormData {
  constructor(form) { this._map = (form && form._map) || {}; this._e = (form && form._entries) || []; }
  get(k) { return k in this._map ? this._map[k] : null; }
  *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; }
}
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  FormData: FakeFormData,
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  document: {
    getElementById: (id) => elements[id] || (elements[id] = el()),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {},
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
run(`
  cloudSession = { access_token: 'tok', user: { id: 'u1', email: 'c@example.com' } };
  onboardStep = 0;
  liveSyncConfig = { state: 'ready', google: true, outlook: false, apple: true, encryption: true };
  liveSyncConnections = {};
  liveSyncAppleCalendars = [];
  liveSyncShowOthers = false;
  liveSyncState.pending = [];
  liveSyncLog = [];
  liveSyncError = '';
  qgendaStatusError = '';
  schedulePreview = null; scheduleImportError = ''; scheduleAiStatus = ''; scheduleImportContext = '';
  db.settings.scheduleImported = false;
  db.settings.qgendaConnected = false;
  globalThis.__html = syncSectionHTML();
`);
const html = sandbox.__html;
const iU = html.indexOf('id="schedule-import-panel"');
const upload = iU >= 0 ? html.slice(iU) : '';
const TOGGLE = '<details class="csp-info"><summary>Taking a photo of a paper schedule?</summary>';
t('photo tips toggle exists inside the Upload a schedule panel', upload.includes(TOGGLE));
t('toggle is collapsed by default (no open attribute on the details)', upload.includes(TOGGLE) && !upload.includes('<details class="csp-info" open'));
t('toggle uses the exact C/S/P pattern (details.csp-info + summary)',
  upload.includes(TOGGLE) &&
  fs.readFileSync(R + 'app.js', 'utf8').includes('<details class="csp-info"><summary>What do C, S and P mean?</summary>'));
t('all three tip lines ship, one idea per line',
  upload.includes('<p class="muted">A closer, straight-on photo reads best.</p>') &&
  upload.includes('<p class="muted">Show the whole grid — the dates across the top and your name row.</p>') &&
  upload.includes('<p class="muted">Cropping to just the grid helps more than you\'d think.</p>'));
t('tips sit before the upload form so they are seen before choosing a file',
  upload.indexOf(TOGGLE) >= 0 && upload.indexOf(TOGGLE) < upload.indexOf('id="scheduleForm"'));
t('toggle appears nowhere outside the upload panel',
  !html.slice(0, iU).includes('Taking a photo of a paper schedule?'));
t('service worker cache bumped to v59', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v59'));
console.log(failures ? failures + ' FAILURES' : 'ALL PASS');
