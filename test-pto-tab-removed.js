// CRNA Hub — PTO tab removal + Dashboard monitoring card removal +
// Credentials manual-entry collapse (Nov 6, 2026).
// Run: node test-pto-tab-removed.js
// Caleb: the PTO tab goes away (can return later) — navigation, page,
// and every pointer to it; the stored PTO data model stays untouched
// so existing accounts and old backups keep working. The Dashboard
// portal-monitoring card goes too (monitoring lives on Credentials).
// The Credentials manual-entry form becomes a collapsed-by-default
// panel, like the Facilities collapses; Connect cards stay primary.
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
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');

// --- PTO tab removal ---
t('tab list has exactly 6 tabs and no PTO',
  run(`tabs.length`) === 6 && !run(`tabs.includes('PTO')`));
t('no ptoPage function remains', !appSrc.includes('function ptoPage'));
t('nav render has no PTO button', !run(`tabs.map(x=>'<button data-tab="'+x+'">').join('')`).includes('PTO'));
run(`
  globalThis.__dash = dashboard();
  globalThis.__cred = credentialsPage();
  globalThis.__help = answerQuestion('How can CRNA Hub help me?');
  globalThis.__ptoQ = answerQuestion('What is my PTO balance?');
`);
t('assistant help answer no longer points at a PTO tab',
  !sandbox.__help.includes('PTO'));
t('assistant PTO question gets the generic answer, not a PTO ledger readout',
  !sandbox.__ptoQ.includes('recorded W-2 PTO balance') && !sandbox.__ptoQ.includes('PTO'));
t('data model intact: empty() still carries pto array and pto settings',
  run(`Array.isArray(empty().pto) && 'ptoStarting' in empty().settings && 'ptoAnnual' in empty().settings && 'ptoHoursPerPeriod' in empty().settings`));
run(`
  db.pto = [{id:'p1', date:'2026-10-01', hours:'8', note:'Vacation'}];
  db.settings.ptoStarting = 40;
  persist();
  globalThis.__savedPto = JSON.parse(localStorage.getItem('crna-hub-v2')).pto;
`);
t('stored PTO entries still persist untouched with the tab gone',
  Array.isArray(sandbox.__savedPto) && sandbox.__savedPto.length === 1 && sandbox.__savedPto[0].note === 'Vacation');
t("the 'Off / PTO' shift type still exists (W-2 salary days unchanged)",
  appSrc.includes("'Off / PTO'") && run(`isW2SalaryShift({type:'Off / PTO'})`));

// --- Dashboard portal-monitoring card removal ---
t('Dashboard has no Portal monitoring card',
  !sandbox.__dash.includes('<h2>Portal monitoring</h2>') && !sandbox.__dash.includes('portal check(s) due'));
t('no dashboardMonitoringPanel function or call remains',
  !appSrc.includes('dashboardMonitoringPanel'));
t('Credentials tab still carries the full portal monitoring panel',
  sandbox.__cred.includes('id="credentials-monitoring-panel"') && sandbox.__cred.includes('Portal monitoring'));
t('Dashboard still renders its other sections',
  sandbox.__dash.includes('Overview') && sandbox.__dash.includes('Quick actions'));
// v150 (Nov 12, 2026): Caleb asked to remove the Dashboard "Upcoming
// shifts" section ("Just to clean things up" — it duplicated the
// calendar), so the pin that required it is superseded by the
// removal pins in test-v150-ce-requirements.js.
t('Dashboard no longer renders Upcoming shifts (removed in v150)',
  !sandbox.__dash.includes('Upcoming shifts'));

// --- Credentials manual entry collapsed ---
t('manual entry is a collapse panel on Credentials',
  sandbox.__cred.includes('<details class="panel collapse-panel" id="credentials-manual-panel">'));
t('manual entry panel is collapsed by default (no open attribute)',
  !/<details class="panel collapse-panel" id="credentials-manual-panel" open/.test(sandbox.__cred));
t('manual entry essay paragraph is gone',
  !sandbox.__cred.includes('Manual entry (fallback only)') && !sandbox.__cred.includes('Use this form when a portal pull is unavailable'));
t('full manual form is inside the panel: type select + NBCRNA form + save',
  sandbox.__cred.includes('id="manualTypeSelect"') && sandbox.__cred.includes('data-kind="nbcrna"') && sandbox.__cred.includes('Save NBCRNA record'));
t('Connect cards stay on the page, above the manual panel',
  sandbox.__cred.indexOf('Connect NBCRNA') > -1 &&
  sandbox.__cred.indexOf('Connect NBCRNA') < sandbox.__cred.indexOf('id="credentials-manual-panel"'));
run(`
  db.licenses = [{id:'lic1', state:'West Virginia', type:'RN', number:'86131', issue:'2013-07-02', expiry:'2028-06-30', portal:'', note:'', reminders:'90,60,30,7', source:'user_entered'}];
  manualType = 'State license'; editId = 'lic1';
  globalThis.__credEdit = credentialsPage();
  editId = null;
`);
t('manual panel opens automatically when editing a license record',
  /<details class="panel collapse-panel" id="credentials-manual-panel" open>/.test(sandbox.__credEdit) &&
  sandbox.__credEdit.includes('Save license'));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
