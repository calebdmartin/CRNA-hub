// CRNA Hub — tests for Bug 1 (Nov 6, 2026): YTD $0 when every imported
// shift arrives proposed. Run: node test-ytd-bug1.js
//
// Caleb's report: 139 shifts in 2026, "Priced shifts in 2026: 0
// confirmed/completed, 0 submitted, 139 proposed", Year to date $0.00
// and Predicted 2026 $0.00 under C and S, while all-time gross was
// $679,000. Root cause: imported shifts arrived as proposed, and C/S
// year-to-date only count confirmed/submitted — so a user whose shifts
// are all proposed sees $0 everywhere, and the P column (the only
// non-zero one) was pushed off-screen on mobile.
//
// Covers, without any live API call (fetch is stubbed; no network):
//   * importStatusForDate: past -> confirmed, today/future -> proposed,
//     missing/invalid date -> proposed (never silently confirmed).
//   * Schedule import approve: past rows arrive confirmed, future rows
//     proposed; a later sync/update never rewrites a stored status.
//   * Live-sync apply: past creates arrive confirmed, future creates
//     proposed — even when the server payload carries no status (older
//     server) or a stale 'proposed' stamp; updates never touch status.
//   * One-tap "Mark past shifts as confirmed": reclassifies only past
//     proposed shifts in the year (future, today, submitted, confirmed,
//     and other years untouched); afterwards C YTD is non-zero when
//     past priced shifts exist, P is unchanged, unpriced shifts stay
//     excluded (never $0) and W-2 salary days stay excluded.
//   * C/S/P table renders all three columns, and on mobile the table
//     fits the panel width (no min-width pushing P off-screen).
//   * Dashboard order (Caleb, Nov 6, 2026): calendar first, then the
//     C/S/P income table below it — not the table above the calendar.
//
// Dates are computed from today at run time, so the tests stay true
// whenever they run — no fixed-date rot.
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
const alerts = [];
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
  alert: (m) => { alerts.push(String(m)); },
  __alerts: alerts,
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({ ok: true }) }),
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
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const cssSrc = fs.readFileSync(R + 'styles.css', 'utf8');
const liveSyncSrc = fs.readFileSync(R + 'live-sync.js', 'utf8');
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

// Dates relative to today (local), so nothing here rots.
const iso = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const now = new Date();
const todayStr = iso(now);
const year = now.getFullYear();
const pastD = new Date(now); pastD.setDate(pastD.getDate() - 30);
const pastStr = iso(pastD);
const past2D = new Date(now); past2D.setDate(past2D.getDate() - 10);
const past2Str = iso(past2D);
const futureD = new Date(now); futureD.setDate(futureD.getDate() + 30);
const futureStr = iso(futureD);
const lastYearStr = `${year - 1}-06-15`;

// ---------- 1. importStatusForDate ----------
t('importStatusForDate: past -> confirmed',
  run(`importStatusForDate('${pastStr}')`) === 'confirmed' &&
  run(`importStatusForDate('${pastStr}', '${todayStr}')`) === 'confirmed');
t('importStatusForDate: today arrives confirmed (status model Nov 6, 2026: sourced = confirmed, any date)',
  run(`importStatusForDate('${todayStr}')`) === 'confirmed' &&
  run(`importStatusForDate('${todayStr}', '${todayStr}')`) === 'confirmed');
t('importStatusForDate: future -> confirmed (supersedes the Bug 1 date rule)',
  run(`importStatusForDate('${futureStr}')`) === 'confirmed');
t('importStatusForDate: missing/invalid date -> proposed, never silently confirmed',
  run(`importStatusForDate('')`) === 'proposed' &&
  run(`importStatusForDate('not-a-date')`) === 'proposed' &&
  run(`importStatusForDate(null)`) === 'proposed');

// ---------- 2. Schedule import approve: past confirmed, future proposed ----------
run(`
  db.shifts = [];
  db.facilities = [];
  db.facilitySuggestions = [];
  schedulePreview = { fileName: 'staff.csv', source: 'schedule-import', matchedName: 'C. Martin', rows: [
    { date: '${pastStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', match: 'matched', include: true, duplicate: false, flags: [], source: 'schedule-import' },
    { date: '${futureStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', match: 'matched', include: true, duplicate: false, flags: [], source: 'schedule-import' },
    { date: '${todayStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', match: 'matched', include: true, duplicate: false, flags: [], source: 'schedule-import' },
  ]};
  __alerts.length = 0;
  approveScheduleImport();
  globalThis.__sched = db.shifts.slice();
`);
t('schedule import: past, future and today rows all arrive confirmed (status model Nov 6, 2026)',
  sandbox.__sched.find((x) => x.date === pastStr).status === 'confirmed' &&
  sandbox.__sched.find((x) => x.date === futureStr).status === 'confirmed' &&
  sandbox.__sched.find((x) => x.date === todayStr).status === 'confirmed');
t('schedule import approve no longer says all added shifts are proposed',
  !appSrc.includes('All added shifts are proposed until you confirm them.') &&
  appSrc.includes('Imported shifts arrive confirmed — they are on a real schedule.'));

// ---------- 3. Live-sync apply: past confirmed, future proposed, updates never restamp ----------
run(`
  db.shifts = [];
  db.facilitySuggestions = [];
  liveSyncState.pending = [];
  liveSyncState.tombstones = [];
  globalThis.__applied = liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'create', shift: { id: 'past-1', date: '${pastStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    { action: 'create', shift: { id: 'future-1', date: '${futureStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    { action: 'create', shift: { id: 'past-stale', date: '${past2Str}', facility: 'Holzer', type: '8-hour day', pay: '2125', note: 'Imported from Caleb Work Schedule', source: 'apple-import', status: 'proposed', updatedAt: null } },
  ], pendingDeletions: [], imported: null });
  globalThis.__syncShifts = db.shifts.slice();
`);
t('live sync: past create arrives confirmed even with no server status',
  sandbox.__syncShifts.find((x) => x.id === 'past-1').status === 'confirmed');
t('live sync: future create arrives confirmed (status model Nov 6, 2026)',
  sandbox.__syncShifts.find((x) => x.id === 'future-1').status === 'confirmed');
t('live sync: local date wins over a stale server-proposed stamp on a past shift',
  sandbox.__syncShifts.find((x) => x.id === 'past-stale').status === 'confirmed');
run(`
  globalThis.__applied2 = liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'update', shift: { id: 'past-1', date: '${pastStr}', facility: 'Holzer', type: '8-hour day', pay: '3000', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: '${todayStr}T10:00:00Z' } },
  ], pendingDeletions: [], imported: null });
  globalThis.__past1 = db.shifts.find(x => x.id === 'past-1');
`);
t('live sync: an update re-prices but never rewrites a stored status',
  sandbox.__past1.status === 'confirmed' && sandbox.__past1.pay === '3000');
t('live sync no longer stamps every import as proposed',
  !liveSyncSrc.includes("status: 'proposed', incomplete:") &&
  liveSyncSrc.includes('liveSyncImportStatusForDate(s.date)'));

// ---------- 4. The bug, reproduced then fixed by one tap ----------
// Caleb's shape, shrunk: all past priced shifts proposed, so C/S YTD
// read $0 while P holds everything — plus an unpriced past shift, a
// W-2 salary day, a future proposed shift, and a prior-year proposed
// shift that the one-tap fix must leave alone.
run(`
  db.shifts = [
    { id: 'b1', date: '${pastStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'proposed' },
    { id: 'b2', date: '${past2Str}', facility: 'Holzer', type: 'Second call', pay: '3000', status: 'proposed' },
    { id: 'b3', date: '${pastStr}', facility: 'Holzer', type: '12-hour shift', pay: '', incomplete: true, status: 'proposed' },
    { id: 'b4', date: '${pastStr}', facility: 'Holzer', type: 'Off / PTO', pay: '5000', status: 'proposed' },
    { id: 'b5', date: '${futureStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'proposed' },
    { id: 'b6', date: '${todayStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'proposed' },
    { id: 'b7', date: '${lastYearStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'proposed' },
  ];
  db.facilities = [];
  globalThis.__before = yearIncomeSplit(${year}, '${todayStr}');
  globalThis.__dashBefore = dashboard();
  globalThis.__pastN = pastProposedShifts(${year}).length;
  __alerts.length = 0;
  globalThis.__marked = confirmPastProposedShifts(${year});
  globalThis.__after = yearIncomeSplit(${year}, '${todayStr}');
  globalThis.__dashAfter = dashboard();
`);
t('bug reproduced: all past priced shifts proposed -> C YTD $0, P YTD holds everything',
  sandbox.__before.c.ytd === 0 &&
  sandbox.__before.p.ytd === 7250);
t('bulk confirm counts only the past proposed shifts in the year',
  sandbox.__pastN === 4 && sandbox.__marked === 4);
t('bulk confirm: C YTD becomes non-zero (past priced work now confirmed), P unchanged',
  sandbox.__after.c.ytd === 5125 &&
  sandbox.__after.p.ytd === 7250 && sandbox.__after.c.predicted === 5125);
t('bulk confirm: unpriced past shift stays excluded (never $0), W-2 day stays excluded',
  sandbox.__after.unpriced === 1 && sandbox.__after.w2Salary === 1);
t('bulk confirm: future, today, and prior-year proposed shifts are untouched',
  run(`db.shifts.find(x => x.id === 'b5').status`) === 'proposed' &&
  run(`db.shifts.find(x => x.id === 'b6').status`) === 'proposed' &&
  run(`db.shifts.find(x => x.id === 'b7').status`) === 'proposed' &&
  run(`db.shifts.find(x => x.id === 'b3').status`) === 'confirmed');
t('bulk confirm button shows while past proposed shifts exist, gone after',
  sandbox.__dashBefore.includes('Mark 4 past shifts as confirmed') &&
  sandbox.__dashBefore.includes('data-action="confirm-past-shifts"') &&
  !sandbox.__dashAfter.includes('data-action="confirm-past-shifts"'));
t('bulk confirm reports what it did',
  alerts.some((m) => m.includes('Marked 4 past shift(s)') && m.includes('Confirmed (C) year to date')));

// ---------- 5. P column renders, and fits on mobile ----------
// Static check (already covered behaviourally): the rendered table
// carries all three column headers.
run(`
  globalThis.__csp = incomeCSPTableHTML(${year}, yearIncomeSplit(${year}, '${todayStr}'));
`);
t('P column renders in the C/P table (both headers present, no S column)',
  sandbox.__csp.includes('C — Confirmed only') &&
  !sandbox.__csp.includes('S — Submitted-inclusive') &&
  sandbox.__csp.includes('P — Proposed-inclusive'));
t('mobile CSS lets the C/P table fit the panel instead of pushing P off-screen',
  cssSrc.includes('.table-scroll .csp-table{min-width:0}') &&
  cssSrc.includes('.csp-table th{white-space:normal}'));
t('paystub disclaimer kept on the C/S/P table',
  sandbox.__csp.includes('always double-check them against your actual paystubs'));

// ---------- 6. Dashboard order: calendar first, C/S/P table below it ----------
run(`
  db.shifts = [
    { id: 'o1', date: '${pastStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed' },
    { id: 'o2', date: '${futureStr}', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'proposed' },
  ];
  db.payStubs = [
    { id: 'ord1', agency: 'Premier Anesthesia Group', facility: 'Holzer', frequency: 'biweekly', periodStart: '', periodEnd: '', payDate: '${futureStr}', gross: '2125', net: '1800', source: 'manual' },
  ];
  globalThis.__dash = dashboard();
`);
t('Dashboard: calendar comes before the C/S/P income table',
  sandbox.__dash.indexOf('data-action="prev"') !== -1 &&
  sandbox.__dash.indexOf('<h2>Income · ') !== -1 &&
  sandbox.__dash.indexOf('data-action="prev"') < sandbox.__dash.indexOf('<h2>Income · '));
t('Dashboard: the income table is no longer above the calendar',
  !appSrc.includes("${incomeCSPHTML(currentYear(),ytdSplit)}${paystubUpcomingHTML()}"));
t('Dashboard: Upcoming paychecks panel sits below the calendar, above the income table',
  appSrc.includes("${calendar()}${dayViewHTML()}${paystubUpcomingHTML()}${incomeCSPHTML(currentYear(),ytdSplit)}") &&
  sandbox.__dash.indexOf('id="upcoming-paychecks"') !== -1 &&
  sandbox.__dash.indexOf('data-action="prev"') < sandbox.__dash.indexOf('id="upcoming-paychecks"') &&
  sandbox.__dash.indexOf('id="upcoming-paychecks"') < sandbox.__dash.indexOf('<h2>Income · '));

console.log(failures === 0 ? 'ytd-bug1 test done: all passed' : 'ytd-bug1 test done: FAILURES=' + failures);
