// CRNA Hub — QGenda panel step-by-step (Nov 6, 2026). Caleb laid out
// the connect flow as four short steps, and the panel copy now reads
// exactly that way, replacing the old prose paragraph:
//   1. Open QGenda
//   2. Calendar sync
//   3. Copy URL
//   4. Paste URL into CRNA Hub
// The two one-liners that must stay — the URL is stored encrypted and
// never shown in full; no QGenda password is ever asked for or
// stored — are folded into one short line under the steps. The
// "Open QGenda to copy it" button (step 1) and the URL field (step 4)
// already line up with the steps; labels unchanged.
// Run: node test-qgenda-steps.js
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
    dataset: {}, style: {}, scrollIntoView() {},
  };
}
const elements = {};
class FakeFormData {
  constructor(form) { this._e = (form && form._entries) || []; }
  *[Symbol.iterator]() { yield* this._e; }
}
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  Blob,
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
  alert: () => {}, confirm: () => true,
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) process.exitCode = 1;
};

run(`db.settings.qgendaConnected = false; globalThis.__qg = qgendaFeedHTML();`);
const qg = sandbox.__qg;
const i1 = qg.indexOf('<li>Open QGenda</li>');
const i2 = qg.indexOf('<li>Calendar sync</li>');
const i3 = qg.indexOf('<li>Copy URL</li>');
const i4 = qg.indexOf('<li>Paste URL into CRNA Hub</li>');
t('the panel shows the 4 steps, in order, as a numbered list',
  qg.includes('<ol class="qgenda-steps">') && i1 > -1 && i1 < i2 && i2 < i3 && i3 < i4);
t('the steps come before the URL form (step 4 is the paste)',
  i4 > -1 && i4 < qg.indexOf('Your QGenda Subscription URL'));
t('the old prose paragraph is gone',
  !qg.includes('open Sync and copy') && !qg.includes('then paste it here'));
t('the must-keep one-liners survive in one short line under the steps',
  qg.includes('stored encrypted on the server and never shown in full') &&
  qg.includes('No QGenda password is ever asked for or stored') &&
  i4 < qg.indexOf('stored encrypted on the server'));
t('buttons still line up with the steps (Open QGenda = step 1, Connect = step 4)',
  qg.includes('Open QGenda to copy it') && qg.includes('Connect QGenda feed'));
console.log('DONE');
