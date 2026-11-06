// CRNA Hub — tests for the Facilities contract-upload panel (Nov 6, 2026,
// branch muse/credentialing). Run: node test-facilities-contract-panel.js
//
// "Add a facility from a contract" is now its own sibling collapse panel
// (facility-contract-panel), same rank as the pay stub and manual-entry
// panels — "My facilities" still sits at the top untouched. The panel
// starts expanded when it is the actionable path (no facilities yet, a
// contract read / preview / error mid-flight, or a facility suggestion
// is being worked) and rests collapsed once facilities exist and
// nothing is in flight.
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
const tag = (html) => {
  const m = html.match(/<details class="panel collapse-panel" id="facility-contract-panel"( open)?>/);
  return m ? m[0] : null;
};
const RESET = `
  db = empty();
  editId = null; facilitySuggestionPrefill = null;
  facilityContractPreview = null; facilityContractError = ''; facilityContractOcrStatus = '';
  facilityContractPendingImages = []; facilityContractOcrPages = [];
  ruleChatPreview = null; ruleChatError = ''; ruleChatMessages = [];
  paystubPreview = null; paystubError = ''; paystubStatus = '';
`;

(async () => {
  // ============ Facilities exist, nothing in flight: collapsed =======
  run(RESET + `
    db.facilities = [{ id: 'f1', name: 'Holzer', rate8: '2125' }];
    globalThis.__page = facilitiesPage();
  `);
  const settled = sandbox.__page;
  t('contract upload is its own collapse panel, resting collapsed once facilities exist',
    tag(settled) && !tag(settled).includes(' open'));
  t('page order unchanged: My facilities, then contract, pay stub, manual panels',
    settled.indexOf('id="my-facilities-panel"') < settled.indexOf('id="facility-contract-panel"') &&
    settled.indexOf('id="facility-contract-panel"') < settled.indexOf('id="paystub-panel"') &&
    settled.indexOf('id="paystub-panel"') < settled.indexOf('id="facility-manual-panel"'));
  t('contract controls live inside the panel (form, read button, rule chat)',
    settled.indexOf('id="facilityContractForm"') > settled.indexOf('id="facility-contract-panel"') &&
    settled.indexOf('Read my contract') > settled.indexOf('id="facility-contract-panel"') &&
    settled.indexOf('Describe it in your own words') > settled.indexOf('id="facility-contract-panel"') &&
    settled.indexOf('Describe it in your own words') < settled.indexOf('id="paystub-panel"'));

  // ============ No facilities yet: expanded (actionable path) =========
  run(RESET + `globalThis.__page = facilitiesPage();`);
  t('no facilities yet: contract panel starts expanded',
    tag(sandbox.__page) && tag(sandbox.__page).includes(' open'));

  // ============ Preview mid-flight: expanded, preview renders =========
  run(RESET + `
    db.facilities = [{ id: 'f1', name: 'Holzer', rate8: '2125' }];
    facilityContractPreview = { fileName: 'contract.pdf', isPhoto: false, aiRead: false, facilities: [{ name: 'CAMC', include: true, rates: {}, found: [], missing: [], unreadable: [] }] };
    globalThis.__page = facilitiesPage();
  `);
  t('a contract preview mid-flight keeps the panel expanded and renders the preview',
    tag(sandbox.__page).includes(' open') &&
    sandbox.__page.includes('Nothing is saved yet') &&
    sandbox.__page.indexOf('Nothing is saved yet') > sandbox.__page.indexOf('id="facility-contract-panel"') &&
    sandbox.__page.indexOf('Nothing is saved yet') < sandbox.__page.indexOf('id="paystub-panel"'));

  // ============ Error / pages in flight: expanded =====================
  run(RESET + `
    db.facilities = [{ id: 'f1', name: 'Holzer', rate8: '2125' }];
    facilityContractError = 'That file could not be read.';
    globalThis.__page = facilitiesPage();
  `);
  t('a contract read error keeps the panel expanded',
    tag(sandbox.__page).includes(' open') && sandbox.__page.includes('That file could not be read.'));

  // ============ Independent collapse vs sibling panels =================
  run(RESET + `
    db.facilities = [{ id: 'f1', name: 'Holzer', rate8: '2125' }];
    globalThis.__page = facilitiesPage();
  `);
  t('contract panel collapses independently of the pay stub and manual panels',
    !tag(sandbox.__page).includes(' open') &&
    sandbox.__page.includes('<details class="panel collapse-panel" id="paystub-panel">') &&
    sandbox.__page.includes('<details class="panel collapse-panel" id="facility-manual-panel">'));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
})();
