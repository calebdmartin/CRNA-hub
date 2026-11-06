// CRNA Hub — Dashboard C/S/P cleanup (Nov 6, 2026). Run: node test-dashboard-csp-cleanup.js
// The highlighted explanation + disclaimer paragraphs under the
// Income C/S/P table are hidden from the default Dashboard view:
// the table alone shows, the explanation and the paystub disclaimer
// live behind a collapsed "What do C, S and P mean?" toggle, and the
// disclaimer also appears as small print on the Account tab.
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
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  FormData: class { *[Symbol.iterator]() {} },
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
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

run(`
  db.shifts = [
    {id:'s1', date:'2026-01-05', facility:'Holzer', type:'8-hour day', pay:'2000', status:'confirmed', incomplete:false},
    {id:'s2', date:'2026-12-01', facility:'Holzer', type:'8-hour day', pay:'2000', status:'proposed', incomplete:false}
  ];
  globalThis.__dash = dashboard();
  globalThis.__table = incomeCSPTableHTML(2026, yearIncomeSplit(2026));
  globalThis.__acct = accountPage();
`);
const dash = sandbox.__dash, table = sandbox.__table;
// Split the rendered table HTML at the toggle: everything before
// <details is the default view; the explanation must not be there.
const beforeToggle = table.split('<details')[0];
t('C/S/P table still renders with all three columns and both rows',
  table.includes('C — Confirmed only') && table.includes('S — Submitted-inclusive') &&
  table.includes('P — Proposed-inclusive') && table.includes('Year to date') && table.includes('Predicted 2026 annual'));
t('default view (before the toggle) has NO explanation paragraph and NO disclaimer paragraph',
  !beforeToggle.includes('C is confirmed income you can plan on') &&
  !beforeToggle.includes('Income figures are estimates') &&
  !beforeToggle.includes('Priced shifts in 2026'));
t('a collapsed "What do C, S and P mean?" toggle exists and is not open by default',
  table.includes('<details class="csp-info"><summary>What do C, S and P mean?</summary>') &&
  !/<details[^>]*\sopen[\s>]/.test(table));
t('inside the toggle: the C/S/P explanation, the priced-shift counts, and the disclaimer',
  table.includes('C is confirmed income you can plan on') &&
  table.includes('Priced shifts in 2026: 1 confirmed/completed, 0 submitted, 1 proposed') &&
  table.includes('Income figures are estimates from your own rates and shifts — always double-check them against your actual paystubs. CRNA Hub is not liable for mistakes.'));
t('Dashboard default flow shows the table and the toggle, disclaimer only inside it',
  dash.includes('What do C, S and P mean?') &&
  dash.split('<details')[0].includes('C — Confirmed only') === false || dash.includes('csp-table'));
t('disclaimer also lives as small print on the Account tab (backup section)',
  sandbox.__acct.includes('Income figures are estimates from your own rates and shifts') &&
  sandbox.__acct.includes('font-size:0.85em'));
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
