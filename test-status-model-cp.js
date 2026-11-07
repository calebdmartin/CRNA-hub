// CRNA Hub — TWO-STATUS MODEL tests (Nov 6, 2026, branch
// muse/credentialing). Run: node test-status-model-cp.js
//
// Caleb's status model change: 'submitted' is eliminated. Sourced
// shifts (calendar sync, contract, QGenda, schedule upload) save as
// CONFIRMED whatever their date; manual adds ASK "Confirmed or
// proposed?"; C/S/P becomes C/P on the Dashboard and in the
// assistant; stored/cloud 'submitted' converts to 'confirmed'
// (client normalizeShiftStatus + migration 011's CHECK constraint).
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
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const Y = new Date().getFullYear();
const past = `${Y}-01-15`, future = `${Y}-12-20`;

// ---------- The vocabulary ----------
t("SHIFT_STATUSES has no 'submitted' (two working statuses + outcomes)",
  run(`SHIFT_STATUSES.includes('submitted')`) === false &&
  run(`SHIFT_STATUSES.join(',')`) === 'proposed,confirmed,rejected,canceled,completed');
t("no 'Submitted' label or S column anywhere in the Dashboard income table",
  !appSrc.includes('S — Submitted-inclusive') && !appSrc.includes('>Submitted<') &&
  appSrc.includes('What do C and P mean?'));

// ---------- Migration: submitted -> confirmed, idempotent ----------
t("normalizeShiftStatus('submitted') === 'confirmed' (the migration rule)",
  run(`normalizeShiftStatus('submitted')`) === 'confirmed' &&
  run(`normalizeShiftStatus(' Submitted ')`) === 'confirmed');
t('migration is idempotent: confirmed stays confirmed, proposed stays proposed',
  run(`normalizeShiftStatus(normalizeShiftStatus('submitted'))`) === 'confirmed' &&
  run(`normalizeShiftStatus('proposed')`) === 'proposed' &&
  run(`normalizeShiftStatus('bogus')`) === 'proposed');
run(`
  globalThis.__mig = loadStore => loadStore;
  db.shifts = [
    {id:'m1', date:'${past}', facility:'Holzer', type:'8-hour day', pay:'100', status:'submitted'},
    {id:'m2', date:'${future}', facility:'Holzer', type:'8-hour day', pay:'100', status:'submitted'},
    {id:'m3', date:'${future}', facility:'Holzer', type:'8-hour day', pay:'100', status:'proposed'},
  ];
  db.shifts.forEach(x => x.status = normalizeShiftStatus(x.status));
`);
t('boot-style pass converts stored submitted rows to confirmed, leaves proposed alone',
  run(`db.shifts.map(x=>x.status).join(',')`) === 'confirmed,confirmed,proposed');
const mig11 = fs.readFileSync(R + 'supabase' + path.sep + 'supabase-schema-011.sql', 'utf8');
t('migration 011 converts rows and drops submitted from the CHECK constraint',
  mig11.includes("set status = 'confirmed' where status = 'submitted'") &&
  mig11.includes('shifts_status_check') &&
  mig11.includes("'proposed', 'confirmed', 'rejected', 'canceled', 'completed'"));

// ---------- Sourced shifts land confirmed (any date) ----------
t('importStatusForDate: past AND future sourced shifts are confirmed; dateless stays proposed',
  run(`importStatusForDate('${past}')`) === 'confirmed' &&
  run(`importStatusForDate('${future}')`) === 'confirmed' &&
  run(`importStatusForDate('')`) === 'proposed' &&
  run(`importStatusForDate('not-a-date')`) === 'proposed');
t('live-sync create stamp agrees: future calendar shift arrives confirmed',
  run(`liveSyncImportStatusForDate('${future}')`) === 'confirmed' &&
  run(`liveSyncImportStatusForDate('')`) === 'proposed');
const sharedSrc = fs.readFileSync(R + 'supabase' + path.sep + 'functions' + path.sep + '_shared' + path.sep + 'calendar.ts', 'utf8');
t('server shared rule agrees (sourced = confirmed, dateless = proposed)',
  sharedSrc.includes('return "confirmed";') && sharedSrc.includes('if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(d)) return "proposed";'));

// ---------- Manual add asks ----------
run(`editId=''; db.facilities=[]; db.shifts=[];`);
const addHTML = run(`shiftFormHTML()`);
t('add form asks "Confirmed or proposed?" with exactly the two options, proposed preselected',
  addHTML.includes('Confirmed or proposed?') &&
  addHTML.includes('value="proposed" selected') && addHTML.includes('value="confirmed"') &&
  !addHTML.includes('submitted'));
run(`editId='e1'; db.shifts=[{id:'e1', date:'${future}', facility:'Holzer', type:'8-hour day', pay:'', status:'confirmed'}];`);
const editHTML = run(`shiftFormHTML()`);
t('edit form keeps the full (submitted-free) status list',
  editHTML.includes('Status') && !editHTML.includes('submitted') && !editHTML.includes('Confirmed or proposed?'));
run(`editId='';`);

// ---------- C/P totals on a mixed dataset ----------
run(`
  db.settings.employmentType='1099';
  db.shifts = [
    {id:'a', date:'${past}',   facility:'Holzer', type:'8-hour day', pay:'1000', status:'confirmed'},
    {id:'b', date:'${future}', facility:'Holzer', type:'8-hour day', pay:'2000', status:'confirmed'},
    {id:'c', date:'${future}', facility:'Holzer', type:'8-hour day', pay:'4000', status:'proposed'},
    {id:'d', date:'${past}',   facility:'Holzer', type:'8-hour day', pay:'8000', status:'submitted'},
    {id:'e', date:'${past}',   facility:'Holzer', type:'8-hour day', pay:'16000', status:'rejected'},
    {id:'f', date:'${past}',   facility:'Holzer', type:'Off / PTO',  pay:'32000', status:'confirmed'},
  ];
  db.shifts.forEach(x => x.status = normalizeShiftStatus(x.status));
  globalThis.__split = yearIncomeSplit(${Y});
  globalThis.__month = monthIncomeSplit('${Y}-12');
`);
t('C/P: no S bucket exists in either split',
  run(`'s' in globalThis.__split`) === false && run(`'s' in globalThis.__month`) === false);
t('C/P: C counts confirmed only (submitted row migrated in, rejected + W-2 out)',
  run(`globalThis.__split.c.ytd`) === 1000 + 8000 && run(`globalThis.__split.c.predicted`) === 1000 + 8000 + 2000);
t('C/P: P adds proposed on top of C, nothing else',
  run(`globalThis.__split.p.predicted`) === 1000 + 8000 + 2000 + 4000 &&
  run(`globalThis.__split.byStatus.submitted`) === undefined &&
  run(`globalThis.__split.byStatus.confirmed`) === 3 && run(`globalThis.__split.byStatus.proposed`) === 1);
t('C/P: month split agrees (December = confirmed 2000, P 6000)',
  run(`globalThis.__month.c`) === 2000 && run(`globalThis.__month.p`) === 6000);
const tableHTML = run(`incomeCSPTableHTML(${Y}, globalThis.__split)`);
t('Dashboard table renders exactly the C and P columns + the C/P toggle',
  tableHTML.includes('C — Confirmed only') && tableHTML.includes('P — Proposed-inclusive') &&
  tableHTML.includes('What do C and P mean?') && !tableHTML.includes('Submitted'));

// ---------- Dedupe merge in the two-status world ----------
run(`
  db.shifts = [{id:'keep', date:'${future}', facility:'Holzer', type:'8-hour day', pay:'500', status:'proposed', sources:['manual']}];
  globalThis.__res = addShiftDeduped({id:'inc', date:'${future}', facility:'Holzer', type:'8-hour day', pay:'500', status:'confirmed', source:'qgenda', sources:['qgenda']});
`);
t('dedupe: a sourced (confirmed) copy upgrades a proposed manual record — never a downgrade',
  run(`db.shifts.length`) === 1 && run(`db.shifts[0].status`) === 'confirmed' &&
  run(`db.shifts[0].sources.includes('qgenda')`) === true);
t('status rank: confirmed > proposed, completed above both',
  run(`shiftStatusRank('confirmed') > shiftStatusRank('proposed')`) === true &&
  run(`shiftStatusRank('submitted')`) === run(`shiftStatusRank('confirmed')`));

// ---------- Pay-stub estimates stay out ----------
t('pay-stub disclaimer still excludes estimates from the C/P totals',
  appSrc.includes('never added into the C/P shift-income'));

console.log(failures === 0 ? 'status-model-cp test done: all passed' : 'status-model-cp test done: FAILURES=' + failures);
