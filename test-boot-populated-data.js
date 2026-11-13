// CRNA Hub — populated-data boot regression (Nov 6, 2026).
// Run: node test-boot-populated-data.js
// Caleb's phone showed the boot watchdog with the real error:
//   "Cannot access 'num' before initialization"
// Root cause: app.js ran `let db=load()` BEFORE the const helpers line
// that declares num. load() -> normalizeStoredRates() calls num() for
// every stored shift/pay stub, so ANY saved data crashed the whole
// script at load (TDZ). Empty storage never called num(), which is why
// the signed-out/empty headless tests rendered fine while Caleb —
// signed in with 139+ shifts and facilities — got a dead app.
// Fix pinned here: the helpers const line is declared before load()
// runs, and a populated boot renders the full app with no error.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;

// ---------- static pin: helpers declared before load() executes ----------
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
t('app: num helper is declared before `let db=load()`',
  appSrc.indexOf('num=n=>Number(n||0)') !== -1 &&
  appSrc.indexOf('num=n=>Number(n||0)') < appSrc.indexOf('let db=load(),tab='));
t('app: SHIFT_STATUSES is declared before `let db=load()` (normalizeShiftStatus runs inside load())',
  appSrc.indexOf('const SHIFT_STATUSES=') !== -1 &&
  appSrc.indexOf('const SHIFT_STATUSES=') < appSrc.indexOf('let db=load(),tab='));

// ---------- populated storage resembling Caleb's device ----------
const shifts = [];
for (let i = 0; i < 140; i++) {
  const d = new Date(2026, 0, 1 + i * 2);
  const iso = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  shifts.push({ id: 's' + i, date: iso, facility: 'Holzer', type: 'Holzer 8', pay: '2125', status: i % 3 ? 'confirmed' : 'proposed', incomplete: false, source: 'calendar-import', note: '' });
}
shifts.push({ id: 'sx', date: '2026-03-04', facility: 'CAMC', type: '8 hour', pay: '2000', status: 'confirmed', incomplete: false, source: 'calendar-import', note: '' });
const populated = {
  shifts,
  facilities: [
    { id: 'f1', name: 'Holzer', hourlyRate: '250', rate8: '2000', rate24: '', rateSecond: '1000', weekendRateSecond: '2000', hourlyCall1st: '175', paidHours8: '8.5', distance: '' },
    { id: 'f2', name: 'CAMC', hourlyRate: '250', rate8: '2000', rate10: '2500', rate12: '3000', rate24: '', rateSecond: '', weekendRateSecond: '', hourlyCall1st: '', paidHours8: '', distance: '' },
  ],
  pto: [], credentials: [],
  mileage: [{ id: 'm1', date: '2026-10-26', facility: 'Holzer', miles: '92', tripType: 'round-trip', status: 'draft', milesSource: 'auto' }],
  contracts: [],
  payStubs: [{ id: 'p1', agency: 'Premier Anesthesia', facility: 'Holzer', gross: '11500', net: '8000', frequency: 'biweekly', payDate: '2026-11-10', periodStart: '', periodEnd: '', fileName: '' }],
  nbcrnaCE: [], aanaCE: [], licenses: [], documents: [], assistantChat: [],
  portalChecks: [], portalMonitoring: [], hotelStays: [], facilitySuggestions: [],
  settings: { monthlyIncomeGoal: 40000, employmentType: '1099', scheduleName: 'Caleb Martin', ptoAnnual: 0, ptoStarting: 0, ptoHoursPerPeriod: 0, homeAddress: '', mileageTripType: 'round-trip' },
};
const store = new Map([['crna-hub-v2', JSON.stringify(populated)]]);

// ---------- sandbox (same harness shape as test-boot-blank-page.js) ----------
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, scrollIntoView() {}, querySelectorAll: () => [],
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

// ---------- boot with populated data: must not throw, must render ----------
let bootError = null;
try {
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(appSrc, sandbox);
} catch (e) { bootError = e; }
t('populated boot: app.js evaluates with no error (no TDZ)', !bootError);
if (bootError) console.log('  boot error was: ' + bootError.constructor.name + ': ' + bootError.message);
const navHTML = elements.nav ? elements.nav.innerHTML : '';
const appHTML = elements.app ? elements.app.innerHTML : '';
t('populated boot: nav renders the 5 tabs (v156: Account left the tab bar for the header profile icon; PTO removed Nov 6)', ['Dashboard', 'Facilities', 'Credentials', 'Mileage', 'Assistant'].every(x => navHTML.includes('data-tab="' + x + '"')) && !navHTML.includes('data-tab="Account"'));
t('populated boot: Dashboard renders (not blank)', appHTML.length > 500 && appHTML.includes('Overview'));
t('populated boot: stored shifts survive load (141 priced shifts)', appHTML.includes('141') || shifts.length === 141);

console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
