// CRNA Hub — Dashboard day view + card removals + step text cleanup (Nov 6, 2026).
// Run: node test-dashboard-dayview-cleanup.js
// 1. "Credential deadlines" card removed from the Dashboard (the top-of-page
//    deadline reminders and the Credentials tab are untouched).
// 2. Mileage review card removed from the Dashboard (Mileage tab untouched).
// 3. Tapping a calendar date opens a day view: that day's shifts, each with
//    a status changer, Edit and Delete, plus Add shift. Deleting follows
//    the two-way rules (tombstone recorded, source calendar never touched),
//    asks first, and totals re-render immediately.
// 4. The long "Saved shifts" list is gone from the Dashboard; the bulk
//    "Mark N past shifts as confirmed" action stays with the income table.
// 5. Step pages: long explanatory paragraphs stripped; short friendly
//    one-line directions remain; disclaimers live only in the established
//    small-print / collapsed spots.
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

// ---------- Fixture ----------
run(`
  db.shifts = [
    {id:'d1', date:'2026-01-05', facility:'Holzer', type:'8-hour day', pay:'2000', status:'proposed', incomplete:false, source:'calendar-apple'},
    {id:'d2', date:'2026-01-05', facility:'CAMC', type:'10-hour shift', pay:'2500', status:'confirmed', incomplete:false, source:'user-entered'},
    {id:'d3', date:'2026-12-10', facility:'Holzer', type:'8-hour day', pay:'2000', status:'proposed', incomplete:false, source:'user-entered'}
  ];
  db.facilities = [{id:'f1', name:'Holzer'}, {id:'f2', name:'CAMC'}];
  db.mileage = [
    {id:'m1', date:'2026-01-05', facility:'Holzer', miles:'80', status:'draft'},
    {id:'m2', date:'2026-01-05', facility:'CAMC', miles:'30', status:'verified'}
  ];
  db.documents = [{id:'doc1', certType:'ACLS', expiry:'2026-11-20', expirySource:'user_entered'}];
  globalThis.__tombstones = [];
  window.liveSyncRecordTombstone = (id) => { globalThis.__tombstones.push(id); };
  month = new Date(2026, 0, 1);
  globalThis.__dash = dashboard();
`);
const dash = sandbox.__dash;

// ---------- 1 + 2: cards removed from Dashboard, sources untouched ----------
t('Dashboard has no "Credential deadlines" card',
  !dash.includes('<h2>Credential deadlines</h2>') && !dash.includes('No credential deadlines within their reminder windows'));
t('deadline data still exists for the top reminders / Credentials tab (function kept)',
  run(`credentialDeadlines().length`) >= 1 && run(`credentialDeadlinesPanel().includes('Credential deadlines')`));
t('Dashboard has no mileage review card, even with a review week due',
  !dash.includes('Mileage review due') && !dash.includes('Mileage review overdue') && !dash.includes('data-action="mileage-review-goto"'));
t('Mileage tab still renders the weekly review flow',
  run(`mileagePage().includes('Weekly mileage review')`));

// ---------- 4: Saved shifts list gone, bulk confirm stays ----------
t('Dashboard has no "Saved shifts" list',
  !dash.includes('<h2>Saved shifts</h2>') && !appSrc.includes('function savedShiftsHTML'));
t('bulk "Mark N past shifts as confirmed" still lives with the income table',
  dash.includes('Mark 1 past shift as confirmed') || run(`incomeCSPTableHTML(2026, yearIncomeSplit(2026)).includes('past shift')`));
run(`globalThis.__n = confirmPastProposedShifts(2026);`);
t('bulk confirm still works (past proposed -> confirmed)',
  sandbox.__n === 1 && run(`db.shifts.find(x=>x.id==='d1').status`) === 'confirmed');

// ---------- 3: day view ----------
run(`
  db.shifts.find(x=>x.id==='d1').status = 'proposed';
  selectDay('2026-01-05');
  globalThis.__day = dayViewHTML();
  globalThis.__dashAfterTap = dashboard();
`);
const day = sandbox.__day;
t('tapping a date opens the day view under the calendar (not just the add form)',
  sandbox.__dashAfterTap.includes('id="day-view"') && sandbox.__dashAfterTap.indexOf('id="day-view"') > sandbox.__dashAfterTap.indexOf('class="calendar"'));
t('day view lists both shifts for that day with status changer, Edit and Delete per shift',
  day.includes('Holzer') && day.includes('CAMC') &&
  day.includes('data-shift-status="d1"') && day.includes('data-shift-status="d2"') &&
  day.includes('data-action="delete-shifts" data-id="d1"') && day.includes('data-action="delete-shifts" data-id="d2"') &&
  day.includes('data-action="edit-shifts" data-id="d1"'));
t('day view keeps an Add shift option for the day',
  day.includes('data-action="add-shift"') && day.includes('Add a shift on this day'));
t('day view shows only that day (the December shift is not listed)',
  !day.includes('2026-12-10') && (day.match(/data-shift-status=/g) || []).length === 2);
run(`selected = '2026-01-06'; dayViewOpen = true; globalThis.__emptyDay = dayViewHTML();`);
t('day view for an empty day says so and still offers Add',
  sandbox.__emptyDay.includes('No shifts on this day yet') && sandbox.__emptyDay.includes('data-action="add-shift"'));

// status change in the day view re-prices immediately
run(`setShiftStatus('d2', 'proposed');`);
t('status change from the day view updates the shift (totals re-render from it)',
  run(`db.shifts.find(x=>x.id==='d2').status`) === 'proposed' &&
  run(`yearIncomeSplit(2026).c.ytd`) === 0);
run(`setShiftStatus('d2', 'confirmed');`);

// delete: imported shift -> tombstone + local removal + totals update
run(`
  globalThis.__grossBefore = db.shifts.filter(x=>x.date.startsWith('2026-01')).reduce((s,x)=>s+num(x.pay),0);
  globalThis.__cBefore = yearIncomeSplit(2026).c.ytd;
  actions('delete-shifts', 'd1');
`);
t('deleting the imported shift records a tombstone (two-way rule: source calendar untouched, CRNA Hub copy removed at sync)',
  JSON.stringify(sandbox.__tombstones) === JSON.stringify(['d1']));
t('deleted shift is gone locally and the draft mileage trip for it went with it (verified trips untouched)',
  !run(`db.shifts.some(x=>x.id==='d1')`) && !run(`db.mileage.some(m=>m.id==='m1')`) && run(`db.mileage.some(m=>m.id==='m2')`));
t('totals update immediately after delete (month gross drops by the deleted pay)',
  sandbox.__grossBefore - run(`db.shifts.filter(x=>x.date.startsWith('2026-01')).reduce((s,x)=>s+num(x.pay),0)`) === 2000);
run(`globalThis.__dashAfterDelete = dashboard(); selected='2026-01-05'; dayViewOpen = true; globalThis.__dayAfterDelete = dayViewHTML();`);
t('re-rendered Dashboard/day view no longer show the deleted shift',
  !sandbox.__dayAfterDelete.includes('data-shift-status="d1"') && sandbox.__dayAfterDelete.includes('data-shift-status="d2"'));

// delete: app-created shift deletes directly too
run(`globalThis.__cBefore2 = yearIncomeSplit(2026).c.ytd; actions('delete-shifts', 'd2');`);
t('app-created shift deletes directly (removed, tombstone harmless)',
  !run(`db.shifts.some(x=>x.id==='d2')`));
t('C year-to-date drops by the confirmed shift pay after its delete',
  sandbox.__cBefore2 - run(`yearIncomeSplit(2026).c.ytd`) === 2500);

// ---------- 5: step-page text cleanup ----------
run(`
  globalThis.__fac = facilitiesPage();
  globalThis.__cred = credentialsPage();
  globalThis.__acct = accountPage();
`);
const fac = sandbox.__fac, cred = sandbox.__cred, acct = sandbox.__acct;
t('step 3 contract panel: short direction, long explanations gone',
  fac.includes('Upload your contract and we’ll extract your dates and pay') &&
  !fac.includes('Works with text (.txt, CSV)') && !fac.includes('on-device OCR dropped rows'));
t('step 3 manual panel: one friendly line, rate caveats condensed',
  fac.includes('No contract? No problem') && !fac.includes('each sync recognises its events') &&
  fac.includes('leave a rate blank if you don’t take it here'));
t('step 3 pay stub panel: one line, stub-never-stored kept, disclaimer out of the main flow',
  fac.includes('never stored') && !fac.includes('Two agencies paying the same day') &&
  !fac.includes('CRNA Hub is not liable for mistakes'));
t('step 5 cert panel: one line instead of the how-it-works essay',
  cred.includes('Upload a cert and we’ll read its expiration date') &&
  !cred.includes('Tesseract.js') && !cred.includes('taken as the last day of that month'));
t('step 4 cards: covers/finalFlow/Safari essays gone; status + stand-in label kept',
  !cred.includes('What the check covers') && !cred.includes('will not load here') &&
  cred.includes('Final-design status:') && cred.includes('Preview stand-in'));
t('step 1 account panel: long sign-in/profile essays condensed',
  !acct.includes('Connect on the Credentials tab opens each real portal for you to sign in yourself') &&
  !acct.includes('in the Profile — step 1 panel'));
t('disclaimers still live in the established spots (Account small print, collapsed C/S/P toggle)',
  acct.includes('Income figures are estimates from your own rates and shifts') &&
  run(`incomeCSPTableHTML(2026, yearIncomeSplit(2026))`).includes('CRNA Hub is not liable for mistakes'));
t('Getting started directions are still the short one-liners',
  run(`onboardingSteps().every(s => s.direction.length < 170)`));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
