'use strict';
// v137 (Nov 11, 2026) — three phases, one round.
//
// PHASE 1 — CODE WINS (Caleb's Mar 30, 2027 paycheck): his period
// Mar 8–21, 2027 showed $29,200; the correct figure is $27,075.
// The $2,125 difference is one row: 2027-03-08, source
// "qgenda-feed", code "HOLZ - PCDO", stored type "8-hour day",
// stored pay 2125. PCDO is an UNPAID definition on his card (post
// call day off) — it must price $0. Pins:
//   a. Fixture = his real row set + his stated card (+ the unpaid
//      PCDO definition from his own words): stored sum $29,200
//      (the bug), the paycheck engine reads $27,075 anyway
//      (read-time CODE WINS), and the boot heal re-derives the
//      row itself — pay '0', payUnit 'unpaid', type the
//      definition's name, settled — stored sum $27,075.
//   b. A QGenda-shaped PCDO row prices $0 at APPROVE, not just
//      after a heal.
//   c. Regression family: for every defined code kind (day /
//      call / unpaid), a row with a deliberately wrong derived
//      stamp reprices from the definition; a hand-typed total
//      (the correction layer) is never overridden.
// PHASE 2 — Add shift close-and-return (Caleb, with screenshot):
//   a successful STANDALONE save closes the form and lands on the
//   calendar on the shift's month with the day flashed; the
//   double-booking warning keeps precedence (form stays open).
//   As shipped in v137, day-sheet saves kept returning to the day
//   sheet — SUPERSEDED in v140 (Caleb, Nov 12, 2026, screenshot):
//   an ADD from the day sheet ("Add a shift on this day") now
//   lands on the calendar the same way; only an EDIT opened from
//   the day sheet still returns to it. The pins below assert the
//   v140 behavior.
// PHASE 3 — manual-shift chips (Caleb's Apr 5/6, 2027 screenshot):
//   as built in v137, a code-less manual shift's chip named
//   facility + shift via a borrowed facility code, else
//   "HOLZ · 8hr"; proposed chips render amber, confirmed chips
//   unchanged. The LABEL design was superseded the same evening
//   by Caleb's v138 correction — a hand-added chip is the
//   facility name he picked + the short type ("Holzer 8hr") —
//   and the Phase 3 pins below assert the corrected design.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) {
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [],
    dataset: {}, style: {}, _listeners: {}, _entries: null,
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [],
  };
}
const elements = {};
const getEl = (id) => elements[id] || (elements[id] = el(id));
class FakeFormData {
  constructor(form) { this._map = (form && form._map) || {}; this._e = (form && form._entries) || []; }
  get(k) { return k in this._map ? this._map[k] : null; }
  *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; }
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
    getElementById: (id) => getEl(id),
    querySelectorAll: () => [],
    createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
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
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' — ' + extra : '')); if (!cond) { fails++; process.exitCode = 1; } };

// Caleb's live HOLZ card (cloud copy, Nov 11, 2026) PLUS the
// unpaid PCDO definition from his own pay words ("Holz PCDO=post
// call day off=no pay") — the definition the words save persists.
const HOLZ_CARD = `{
  id:'cfd8caaa-dfdb-49b3-af1c-e06542cb8753', name:'Holzer', aliases:'Holzer, HOLZ',
  address:'100 Jackson Pike, Gallipolis, OH 45631',
  hourlyRate:'250', paidHours8:'8.5', rate8:'2125', rate10:'', rate12:'',
  rate24:'4800', weekendRate24:'4200', hourlyCall1st:'4800',
  rateSecond:'3000', weekendRateSecond:'2000', callBonus:'4200',
  weekendDays:[0,6], weekendDaysSource:'stated', ratesSource:'contract',
  codeMap:{
    '8s':{label:'8-hour day',hours:'8',canonicalType:'8-hour day',derived:true},
    '8hr':{label:'8-hour day',hours:'8',canonicalType:'8-hour day',derived:true},
    'Call 2':{label:'Call 2',canonicalType:'Second call',viaWords:true},
    '1st call':{label:'1st call',canonicalType:'24-hour call',viaWords:true},
    'HOLZ - PCDO':{label:'post call day off',canonicalType:'',hours:'',unpaid:true,viaWords:true}
  }
}`;

// His real Mar 8–21, 2027 rows (shifts table, Nov 11, 2026) —
// Mar 8 is the defective QGenda row, verbatim.
const MARCH_ROWS = `[
  {id:'7552cfaa-51b1-4174-9ed2-e54f7074dbec', date:'2027-03-08', facility:'Holzer', code:'HOLZ - PCDO', type:'8-hour day', pay:'2125', payRate:'', payUnit:'facility', status:'confirmed', incomplete:false, source:'qgenda-feed', sources:['qgenda-feed'], note:'Schedule import: QGenda feed — matched name "Caleb Martin"', updatedAt:'2026-11-12T01:24:47.766Z'},
  {id:'m09', date:'2027-03-09', facility:'Holzer', code:'HOLZ - G Main (8)', type:'8-hour day', pay:'2125', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m10', date:'2027-03-10', facility:'Holzer', code:'HOLZ - G Main (8)', type:'8-hour day', pay:'2125', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m11', date:'2027-03-11', facility:'Holzer', code:'HOLZ - G Main (8)', type:'8-hour day', pay:'2125', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m12', date:'2027-03-12', facility:'Holzer', code:'HOLZ - G Main (8)', type:'8-hour day', pay:'2125', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m15', date:'2027-03-15', facility:'Holzer', code:'HOLZ - Call 2', type:'Second call', pay:'3000', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m16', date:'2027-03-16', facility:'Holzer', code:'HOLZ - G Main (8)', type:'8-hour day', pay:'2125', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m17', date:'2027-03-17', facility:'Holzer', code:'HOLZ - G Main (8)', type:'8-hour day', pay:'2125', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m18', date:'2027-03-18', facility:'Holzer', code:'HOLZ - G Main (8)', type:'8-hour day', pay:'2125', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m19', date:'2027-03-19', facility:'Holzer', code:'HOLZ - Call 2', type:'Second call', pay:'3000', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m20', date:'2027-03-20', facility:'Holzer', code:'HOLZ - Call 1', type:'24-hour call', pay:'4200', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'},
  {id:'m21', date:'2027-03-21', facility:'Holzer', code:'HOLZ - Call 2', type:'Second call', pay:'2000', status:'confirmed', incomplete:false, source:'apple-import', sources:['apple-import','qgenda-feed'], updatedAt:'2026-11-12T01:00:00.000Z'}
]`;

const STUB = `{id:'stub-holz', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2027-03-08', periodEnd:'2027-03-21', payDate:'2027-03-30', gross:'', net:'', source:'manual'}`;

/* ================= PHASE 1a: the paycheck reads right ======== */
run(`
  db = empty();
  db.facilities = [${HOLZ_CARD}];
  db.shifts = ${MARCH_ROWS};
  db.payStubs = [${STUB}];
  db.mileage = []; db.hotelStays = []; db.documents = [];
  persist();
`);
t('P1 fixture: stored pays sum to the buggy $29,200', run(`db.shifts.reduce((a,x)=>a+num(x.pay),0)`) === 29200,
  run(`db.shifts.reduce((a,x)=>a+num(x.pay),0)`));
t('P1 read-time: the PCDO row contributes $0 (CODE WINS)', run(`effectiveShiftPay(db.shifts[0])`) === 0);
t('P1 read-time: Mar 30, 2027 paycheck totals $27,075 before any heal',
  run(`paystubOccurrences(db.payStubs[0],'2027-03-01','2027-03-31').find(o=>o.date==='2027-03-30').total`) === 27075,
  run(`paystubOccurrences(db.payStubs[0],'2027-03-01','2027-03-31').find(o=>o.date==='2027-03-30').total`));
t('P1 read-time: March headline is $27,075', run(`monthHeadline('2027-03').gross`) === 27075,
  run(`monthHeadline('2027-03').gross`));

/* ================= PHASE 1b: the heal re-derives the row ===== */
run(`healUnpricedShiftPays();`);
const pcdo = () => run(`db.shifts.find(x=>x.id==='7552cfaa-51b1-4174-9ed2-e54f7074dbec')`);
t('P1 heal: Mar 8 row pays $0', pcdo().pay === '0', pcdo().pay);
t('P1 heal: Mar 8 row stamped unpaid', pcdo().payUnit === 'unpaid', pcdo().payUnit);
t('P1 heal: Mar 8 row settled, not incomplete', pcdo().incomplete === false);
t('P1 heal: Mar 8 row typed as the definition names it', pcdo().type === 'post call day off', pcdo().type);
t('P1 heal: correction timestamped so it cloud-merges', pcdo().updatedAt > '2026-11-12T01:24:47.766Z', pcdo().updatedAt);
t('P1 heal: stored sum is now $27,075', run(`db.shifts.reduce((a,x)=>a+num(x.pay),0)`) === 27075);
t('P1 heal: the other rows are untouched',
  run(`db.shifts.filter(x=>x.code==='HOLZ - G Main (8)').every(x=>x.pay==='2125'&&x.type==='8-hour day')`) === true &&
  run(`db.shifts.find(x=>x.id==='m15').pay`) === '3000' &&
  run(`db.shifts.find(x=>x.id==='m20').pay`) === '4200' &&
  run(`db.shifts.find(x=>x.id==='m21').pay`) === '2000');
t('P1 heal: Mar 30 paycheck still $27,075',
  run(`paystubOccurrences(db.payStubs[0],'2027-03-01','2027-03-31').find(o=>o.date==='2027-03-30').total`) === 27075);

/* ============ PHASE 1c: regression family, every kind ======== */
run(`
  db = empty();
  const card = ${HOLZ_CARD};
  card.rate10 = '2625';
  card.codeMap['G Main (10)'] = {label:'G Main (10)', canonicalType:'10-hour shift', hours:'10', viaWords:true};
  db.facilities = [card];
  db.shifts = [
    {id:'w-day', date:'2027-03-09', facility:'Holzer', code:'HOLZ - G Main (10)', type:'8-hour day', pay:'999', payUnit:'facility', status:'confirmed', incomplete:false, source:'qgenda-feed'},
    {id:'w-call', date:'2027-03-15', facility:'Holzer', code:'HOLZ - Call 2', type:'Second call', pay:'9999', payUnit:'facility', status:'confirmed', incomplete:false, source:'qgenda-feed'},
    {id:'w-fact', date:'2027-03-08', facility:'Holzer', code:'HOLZ - PCDO', type:'8-hour day', pay:'500', payUnit:'daily', status:'confirmed', incomplete:false, source:'user-entered'}
  ];
  db.payStubs = []; persist();
`);
t('P1 family: wrong-stamped DAY definition reads at the definition price', run(`effectiveShiftPay(db.shifts[0])`) === 2625);
t('P1 family: wrong-stamped CALL definition reads at the definition price', run(`effectiveShiftPay(db.shifts[1])`) === 3000);
run(`repairShiftPaysForFacility(db.facilities[0]);`);
t('P1 family: heal reprices the day row from its definition', run(`db.shifts[0].pay`) === '2625', run(`db.shifts[0].pay`));
t('P1 family: heal reprices the call row from its definition', run(`db.shifts[1].pay`) === '3000', run(`db.shifts[1].pay`));
t('P1 family: a hand-typed total on an unpaid code is a fact and stands',
  run(`db.shifts[2].pay`) === '500' && run(`effectiveShiftPay(db.shifts[2])`) === 500);

/* ============ PHASE 1d: QGenda approve prices $0 ============= */
run(`
  db = empty();
  db.facilities = [${HOLZ_CARD}];
  db.shifts = []; db.payStubs = [];
  db.settings.scheduleName = 'Martin';
  persist();
  schedulePreview = {fileName:'qgenda', matchedName:'Martin', source:'qgenda-feed', rows:[
    {date:'2027-03-08', facility:'Holzer', type:'8-hour day', code:'HOLZ - PCDO', pay:'2125', name:'Martin', matchedName:'Martin', match:'matched', include:true, duplicate:false, flags:[], source:'qgenda-feed'},
    {date:'2027-03-09', facility:'Holzer', type:'8-hour day', code:'HOLZ - G Main (8)', pay:'2125', name:'Martin', matchedName:'Martin', match:'matched', include:true, duplicate:false, flags:[], source:'qgenda-feed'}
  ]};
  approveScheduleImport();
`);
t('P1 approve: both rows saved', run(`db.shifts.length`) === 2, run(`db.shifts.length`));
t('P1 approve: the PCDO row lands at $0, unpaid, settled, typed as the day off',
  run(`db.shifts[0].pay`) === '0' && run(`db.shifts[0].payUnit`) === 'unpaid' &&
  run(`db.shifts[0].incomplete`) === false && run(`db.shifts[0].type`) === 'post call day off',
  JSON.stringify(run(`db.shifts[0]`)));
t('P1 approve: the ordinary day row keeps its $2,125',
  run(`db.shifts[1].pay`) === '2125' && run(`db.shifts[1].type`) === '8-hour day');

/* ================= PHASE 2: close-and-return ================= */
// submitEntry reads FormData off currentTarget; drive it through
// a sandbox-side helper so the fake form keeps its _map.
run(`
  __submitShift = (map) => {
    const form = { dataset: { kind: 'shifts' }, _map: map };
    submitEntry({ preventDefault(){}, currentTarget: form });
  };
`);
run(`
  db = empty();
  db.facilities = [${HOLZ_CARD}];
  db.shifts = []; db.payStubs = []; db.mileage = [];
  month = new Date(2026, 10, 1); selected = '2026-11-03';
  dayViewOpen = false; showShiftForm = false; editId = null; flashDay = '';
  tab = 'Dashboard'; persist();
`);
run(`actions('add-shift')`);
t('P2 open: standalone origin recorded', run(`shiftFormOrigin`) === 'standalone');
t('P2 form: facility and date are required (a failed add never closes it)',
  run(`shiftFormHTML()`).includes('required'));
run(`__submitShift({date:'2027-04-05', facility:'Holzer', type:'8-hour day', status:'proposed', pay:'', note:''})`);
t('P2 save: the shift is saved', run(`db.shifts.length`) === 1);
t('P2 save: form closed', run(`showShiftForm`) === false);
t('P2 save: calendar positioned on the shift month', run(`month.getFullYear()`) === 2027 && run(`month.getMonth()`) === 3);
t('P2 save: the added day is selected and flashed', run(`selected`) === '2027-04-05' && run(`flashDay`) === '2027-04-05');
t('P2 save: day sheet NOT opened', run(`dayViewOpen`) === false);
t('P2 save: the calendar cell carries the flash', run(`calendar()`).includes('flash'));

// Double-booking warning takes precedence over close-and-return.
run(`
  db.shifts = [{id:'x1', date:'2027-04-06', facility:'CAMC', code:'5**', type:'8-hour day', pay:'2000', status:'confirmed', incomplete:false, source:'user-entered'}];
  flashDay = ''; month = new Date(2026, 10, 1); persist();
  actions('add-shift');
  __submitShift({date:'2027-04-06', facility:'Holzer', type:'8-hour day', status:'confirmed', pay:'', note:''});
`);
t('P2 conflict: form stays open with the warning', run(`showShiftForm`) === true && !!run(`pendingManualShift`));
t('P2 conflict: nothing saved, no navigation', run(`db.shifts.length`) === 1 && run(`flashDay`) === '');
run(`actions('manual-shift-anyway')`);
t('P2 conflict resolved: saved, closed, landed on the day',
  run(`db.shifts.length`) === 2 && run(`showShiftForm`) === false && run(`flashDay`) === '2027-04-06' && run(`month.getMonth()`) === 3);

// v140 (Caleb, Nov 12, 2026): an ADD from the day sheet lands on
// the calendar like any other add — sheet closed, month moved,
// day flashed. (In v137 this pin asserted the day sheet stayed
// up; Caleb's screenshot the next morning superseded that.)
run(`
  dayViewOpen = true; flashDay = ''; month = new Date(2026, 10, 1);
  actions('add-shift');
`);
t('P2 day sheet: origin recorded as daysheet', run(`shiftFormOrigin`) === 'daysheet');
run(`__submitShift({date:'2027-04-07', facility:'Holzer', type:'8-hour day', status:'confirmed', pay:'', note:''})`);
t('P2 day sheet add (v140): saved, sheet closed, landed on the calendar',
  run(`db.shifts.length`) === 3 && run(`dayViewOpen`) === false && run(`showShiftForm`) === false &&
  run(`selected`) === '2027-04-07' && run(`flashDay`) === '2027-04-07' &&
  run(`month.getFullYear()`) === 2027 && run(`month.getMonth()`) === 3);

// …but an EDIT opened from the day sheet still returns to it
// (the inspect loop is unchanged): reopen the day, edit the
// shift just added, and the day sheet is where the save lands.
run(`flashDay=''; selectDay('2027-04-07'); actions('edit-shifts', db.shifts[2].id);`);
t('P2 day sheet edit: origin recorded as daysheet', run(`shiftFormOrigin`) === 'daysheet' && run(`showShiftForm`) === true);
run(`__submitShift({date:'2027-04-07', facility:'Holzer', type:'10-hour day', status:'confirmed', pay:'', note:''})`);
t('P2 day sheet edit (v140): edit applied, day sheet stays up, no calendar jump',
  run(`db.shifts[2].type`) === '10-hour day' && run(`dayViewOpen`) === true && run(`showShiftForm`) === false &&
  run(`flashDay`) === '' && run(`selected`) === '2027-04-07' &&
  run(`month.getFullYear()`) === 2027 && run(`month.getMonth()`) === 3);

// The double-booking escape from the day sheet also lands on
// the calendar (v140): warn first, then "Add it anyway" closes
// everything and flashes the day.
run(`
  db.shifts.push({id:'x2', date:'2027-04-08', facility:'CAMC', code:'5**', type:'8-hour day', pay:'2000', status:'confirmed', incomplete:false, source:'user-entered'});
  selectDay('2027-04-08'); actions('add-shift');
  __submitShift({date:'2027-04-08', facility:'Holzer', type:'8-hour day', status:'confirmed', pay:'', note:''});
`);
t('P2 day sheet conflict: form stays open with the warning, nothing saved',
  run(`showShiftForm`) === true && !!run(`pendingManualShift`) && run(`db.shifts.length`) === 4);
run(`actions('manual-shift-anyway')`);
t('P2 day sheet conflict resolved (v140): saved, sheet closed, landed on the day',
  run(`db.shifts.length`) === 5 && run(`showShiftForm`) === false && run(`dayViewOpen`) === false &&
  run(`flashDay`) === '2027-04-08' && run(`month.getFullYear()`) === 2027 && run(`month.getMonth()`) === 3);

/* ================= PHASE 3: chips ============================ */
run(`
  db = empty();
  db.facilities = [${HOLZ_CARD}];
  db.shifts = [
    {id:'m1', date:'2027-04-05', facility:'Holzer', type:'8-hour day', pay:'2125', status:'proposed', incomplete:false, source:'user-entered'},
    {id:'m2', date:'2027-04-06', facility:'Holzer', code:'HOLZ - G Main (8)', type:'8-hour day', pay:'2125', status:'confirmed', incomplete:false, source:'apple-import'}
  ];
  db.payStubs = []; db.mileage = [];
  month = new Date(2027, 3, 1); selected = '2027-04-05'; dayViewOpen = false; flashDay = '';
  persist();
`);
// SUPERSEDED in v138 (Caleb's correction, Nov 11, 2026, the same
// evening v137 shipped): a hand-added shift's chip is the facility
// name he picked + the short type — "Holzer 8hr" — NOT a borrowed
// schedule code and NOT the short-name fallback. Live, the borrow
// had also failed his real rows (first match in map order was the
// duration-named "8s"). The four pins below now assert the v138
// design; the borrow itself survives for code-less shifts that
// arrived from a feed (test-chip-paysched A2 pins that path).
t('P3 chip: code-less manual shift names facility + type', run(`shiftChipLabel(db.shifts[0])`) === 'Holzer 8hr',
  run(`shiftChipLabel(db.shifts[0])`));
t('P3 chip: manual second call names facility + type (no borrowed code)',
  run(`shiftChipLabel({facility:'Holzer', type:'Second call', status:'proposed', source:'user-entered'})`) === 'Holzer 2nd call',
  run(`shiftChipLabel({facility:'Holzer', type:'Second call', status:'proposed', source:'user-entered'})`));
run(`db.facilities[0].codeMap['G Main (8)'] = {label:'G Main (8)', canonicalType:'8-hour day', hours:'8', viaWords:true}; persist();`);
t('P3 chip: a matching facility code does NOT rename a hand-added shift', run(`shiftChipLabel(db.shifts[0])`) === 'Holzer 8hr',
  run(`shiftChipLabel(db.shifts[0])`));
run(`delete db.facilities[0].codeMap['G Main (8)']; persist();`);
const gridHtml = run(`calendar()`);
t('P3 grid: proposed chip is amber-classed and named',
  /<span class="chip[^"]*proposed[^"]*">Holzer 8hr<\/span>/.test(gridHtml));
t('P3 grid: confirmed coded chip unchanged, no proposed class',
  (() => { const m = gridHtml.match(/<span class="chip([^"]*)">HOLZ - G Main \(8\)<\/span>/); return !!m && !/proposed/.test(m[1]); })());
run(`db = empty(); db.shifts = [{id:'z1', date:'2026-12-02', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'}]; persist();`);
t('P3 chip: no facility record — bare short type, as before', run(`shiftChipLabel(db.shifts[0])`) === '8-hour day');
const css = fs.readFileSync(R + 'styles.css', 'utf8');
t('P3 css: proposed chips are amber', css.includes('.chip.proposed') && css.includes('#fde68a'));

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
