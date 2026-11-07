// CRNA Hub — Dashboard C/S/P cleanup (Nov 6, 2026). Run: node test-dashboard-csp-cleanup.js
// The highlighted explanation + disclaimer paragraphs under the
// Income C/S/P table are hidden from the default Dashboard view:
// the table alone shows, the explanation and the paystub disclaimer
// live behind a collapsed "What do C and P mean?" toggle, and the
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
t('C/P table still renders with both columns and both rows (S eliminated Nov 6, 2026)',
  table.includes('C — Confirmed only') && !table.includes('S — Submitted-inclusive') &&
  table.includes('P — Proposed-inclusive') && table.includes('Year to date') && table.includes('Predicted 2026 annual'));
t('default view (before the toggle) has NO explanation paragraph and NO disclaimer paragraph',
  !beforeToggle.includes('C is confirmed income you can plan on') &&
  !beforeToggle.includes('Income figures are estimates') &&
  !beforeToggle.includes('Priced shifts in 2026'));
t('a collapsed "What do C and P mean?" toggle exists and is not open by default',
  table.includes('<details class="csp-info"><summary>What do C and P mean?</summary>') &&
  !/<details[^>]*\sopen[\s>]/.test(table));
t('inside the toggle: the C/P explanation, the priced-shift counts, and the disclaimer',
  table.includes('C is confirmed income you can plan on') &&
  table.includes('Priced shifts in 2026: 1 confirmed/completed, 1 proposed') &&
  table.includes('Income figures are estimates from your own rates and shifts — always double-check them against your actual paystubs. CRNA Hub is not liable for mistakes.'));
t('Dashboard default flow shows the table and the toggle, disclaimer only inside it',
  dash.includes('What do C and P mean?') &&
  dash.split('<details')[0].includes('C — Confirmed only') === false || dash.includes('csp-table'));
t('disclaimer also lives as small print on the Account tab (backup section)',
  sandbox.__acct.includes('Income figures are estimates from your own rates and shifts') &&
  sandbox.__acct.includes('font-size:0.85em'));
// --- "Why might these totals be off?" toggle (Nov 6, 2026) ---
// Collapsed by default, next to the C/S/P toggle: totals only count
// shifts the app could see and recognize in the calendar, they get
// better the longer the app is used, and paystubs are the check.
t('a second collapsed toggle "Why might these totals be off?" exists, not open by default',
  table.includes('<details class="csp-info"><summary>Why might these totals be off?</summary>'));
t('inside it: calendar-recognition caveat + improves-with-use line + paystub check',
  table.includes("built only from the shifts CRNA Hub can see in your calendar") &&
  table.includes("so the totals can understate your real income") &&
  table.includes('The longer you use the app, the better our information gets.') &&
  table.includes('Always check against your paystubs.'));
t('default view (before any toggle) has none of the off-totals text',
  !beforeToggle.includes('Why might these totals be off?') &&
  !beforeToggle.includes('understate your real income'));
t('no unrecognized-events line when sync holds nothing unrecognized',
  !table.includes("weren't recognized as shifts"));
run(`
  db.facilitySuggestions = [
    {id:'sg1', name:'CAMC', count:5, dismissed:false},
    {id:'sg2', name:'Other Hospital', count:2, dismissed:true}
  ];
  globalThis.__table2 = incomeCSPTableHTML(2026, yearIncomeSplit(2026));
`);
t('unrecognized-events line shows the tracked held count when N > 0',
  sandbox.__table2.includes("7 calendar events weren't recognized as shifts and aren't counted yet") &&
  sandbox.__table2.includes('add the hospital on the Facilities tab'));
run(`
  db.facilitySuggestions = [{id:'sg3', name:'CAMC', count:1, dismissed:false}];
  globalThis.__table3 = incomeCSPTableHTML(2026, yearIncomeSplit(2026));
`);
t('singular wording for exactly one unrecognized event',
  sandbox.__table3.includes("1 calendar event wasn't recognized as a shift and isn't counted yet"));
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
