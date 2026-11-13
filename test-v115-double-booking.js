// CRNA Hub — v115: cross-device duplicate heal + double-booking guard
// (Nov 10, 2026, Caleb live report ~9:24 PM ET).
//
// PART 1 — Caleb's phone showed TWO chips on nearly every November
// day and a $92,407.50 headline (= stub actual + 2 x the November
// worked total): tonight's cloud-browser test imports synced back
// and merged alongside the phone's own copies WITHOUT deduping,
// because the copies differ in the stored fields identity used to
// compare — type wording ("8-hour day" vs "8hr day shift"), the
// facility text ("Holzer" vs the feed's "HOLZ"), a bracketed
// assignee remnant in one code, different stored start times.
// Identity is now date + TOLERANT facility + normalized code/kind:
// the heal (boot / cloud merge) collapses the pair shapes below
// into ONE survivor, and genuinely different shifts never merge.
//
// PART 2 — Caleb's ask, verbatim intent: "There needs to be a hard
// stop or a message that comes up to the user 'looks like you are
// double booking yourself'." Exact duplicates are hard-stopped at
// every door (never added, counted as already-on-your-calendar);
// a DIFFERENT shift landing on an already-booked date — above all
// a SECOND HOSPITAL's schedule upload (cross-facility) — stops the
// approve with a "Looks like you're double-booking yourself"
// warning naming both sides, defaults to NOT adding, and offers a
// per-conflict "Add it anyway — I really have both" override. A
// day+call pair at the SAME facility is one assignment (December
// combining) and is never flagged.
// Run: node test-v115-double-booking.js
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
    dataset: {}, style: {}, scrollIntoView() {}, querySelectorAll: () => [],
  };
}
const elements = {};
const getEl = (id) => elements[id] || (elements[id] = el());
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
    getElementById: (id) => getEl(id),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alerts,
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
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
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) { fails++; process.exitCode = 1; } };
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
t('service worker cache is v116', swSrc.includes('crna-hub-shell-v163'));

const G = 'HOLZ - G Main (8)', C2 = 'HOLZ - Call 2', C1 = 'HOLZ - Call 1';
const HOLZER_FAC = `{id:'fh',name:'Holzer',aliases:'',address:'',hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'2625',rate12:'',rate24:'4800',weekendRate24:'4200',rateSecond:'3000',weekendRateSecond:'2000',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}}`;
const CAMC_FAC = `{id:'fc',name:'CAMC',aliases:'',address:'3200 MacCorkle Ave SE, Charleston, WV 25304',hourlyRate:'250',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',rateSecond:'',weekendRateSecond:'',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{'5**':{label:'10-hour shift',hours:'10'},'5*':{label:'10-hour shift',hours:'10'},'7':{label:'12-hour shift',hours:'12'}}}`;

// ================= PART 1a: the pair shapes =================
run(`db = empty(); db.settings.scheduleName = 'Caleb Martin'; db.facilities = [${HOLZER_FAC}]; db.shifts = []; persist();`);

// Shape 1: facility text variant ("HOLZ" resolves nowhere — the
// saved facility is "Holzer") + clarified-label type wording +
// bracketed assignee in one code + different stored start times.
run(`db.shifts = [
  {id:'p1',date:'2026-11-02',facility:'Holzer',type:'8-hour day',code:'${G}',pay:'2125',payUnit:'facility',status:'confirmed',source:'apple-import',sources:['apple-import'],incomplete:false,startTime:'06:30',updatedAt:'2026-11-09T00:00:00Z'},
  {id:'b1',date:'2026-11-02',facility:'HOLZ',type:'8hr day shift',code:'${G} [Martin]',pay:'2125',payUnit:'facility',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false,startTime:'00:00',updatedAt:'2026-11-10T00:00:00Z'},
]; globalThis.__r1 = dedupeShiftsInPlace();`);
t('P1: variant facility + label type + bracket code + different start times collapse to ONE',
  run(`db.shifts.length`) === 1, 'count=' + run(`db.shifts.length`));
t('P1: the survivor remembers both sources',
  run(`shiftSourcesList(db.shifts[0]).includes('apple-import') && shiftSourcesList(db.shifts[0]).includes('qgenda-feed')`));

// Shape 2: two facility RECORDS exist (Holzer + the feed-created
// HOLZ) — copies pointing at different records still collapse.
run(`db.facilities = [${HOLZER_FAC}, {id:'fz',name:'HOLZ',aliases:'',hourlyRate:'',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',rateSecond:'',weekendRateSecond:'',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}}];
db.shifts = [
  {id:'p2',date:'2026-11-03',facility:'Holzer',type:'Second call',code:'${C2}',pay:'3000',payUnit:'facility',status:'confirmed',source:'apple-import',sources:['apple-import'],incomplete:false},
  {id:'b2',date:'2026-11-03',facility:'HOLZ',type:'2nd call',code:'${C2}',pay:'3000',payUnit:'facility',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
]; globalThis.__r2 = dedupeShiftsInPlace();`);
t('P1: copies split across two variant facility records collapse to ONE',
  run(`db.shifts.length`) === 1, 'count=' + run(`db.shifts.length`));

// Shape 3: older copy carries the code AS its type, no code field.
run(`db.facilities = [${HOLZER_FAC}]; db.shifts = [
  {id:'p3',date:'2026-11-06',facility:'Holzer',type:'${C2}',code:'',pay:'3000',status:'confirmed',source:'apple-import',sources:['apple-import'],incomplete:false},
  {id:'b3',date:'2026-11-06',facility:'Holzer',type:'Second call',code:'${C2}',pay:'3000',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
]; dedupeShiftsInPlace();`);
t('P1: code-as-type older copy merges with the coded copy',
  run(`db.shifts.length`) === 1, 'count=' + run(`db.shifts.length`));

// Safety: genuinely different shifts never merge.
run(`db.shifts = [
  {id:'s1',date:'2026-11-04',facility:'Holzer',type:'8hr day shift',code:'${G}',pay:'2125',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
  {id:'s2',date:'2026-11-04',facility:'Holzer',type:'10hour day shift',code:'HOLZ - G Main (10)',pay:'2625',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
  {id:'s3',date:'2026-11-04',facility:'Holzer',type:'2nd call',code:'${C2}',pay:'3000',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
  {id:'s4',date:'2026-11-04',facility:'CAMC',type:'8-hour day',code:'',pay:'2000',status:'confirmed',source:'schedule-import',sources:['schedule-import'],incomplete:false},
]; dedupeShiftsInPlace();`);
t('P1 safety: different code / a call / a different facility on one day all stay',
  run(`db.shifts.length`) === 4, 'count=' + run(`db.shifts.length`));

// ================= PART 1b: Caleb's November, doubled then healed =================
const NOV_PHONE = [];
[['2026-11-02'], ['2026-11-04'], ['2026-11-05'], ['2026-11-10'], ['2026-11-11'], ['2026-11-12'], ['2026-11-13'], ['2026-11-16'], ['2026-11-17'], ['2026-11-18'], ['2026-11-19'], ['2026-11-20'], ['2026-11-30']].forEach(([d], i) => NOV_PHONE.push({ id: 'ph' + i, date: d, facility: 'Holzer', type: '8-hour day', code: G, pay: '2125', payUnit: 'facility', status: 'confirmed', source: 'apple-import', sources: ['apple-import'], incomplete: false }));
NOV_PHONE.push({ id: 'ph13', date: '2026-11-03', facility: 'Holzer', type: 'Second call', code: C2, pay: '3000', payUnit: 'facility', status: 'confirmed', source: 'apple-import', sources: ['apple-import'], incomplete: false });
NOV_PHONE.push({ id: 'ph14', date: '2026-11-06', facility: 'Holzer', type: 'Second call', code: C2, pay: '3000', payUnit: 'facility', status: 'confirmed', source: 'apple-import', sources: ['apple-import'], incomplete: false });
NOV_PHONE.push({ id: 'ph15', date: '2026-11-08', facility: 'Holzer', type: 'Second call', code: C2, pay: '2000', payUnit: 'facility', status: 'confirmed', source: 'apple-import', sources: ['apple-import'], incomplete: false });
NOV_PHONE.push({ id: 'ph16', date: '2026-11-07', facility: 'Holzer', type: '24-hour call', code: C1, pay: '4200', payUnit: 'facility', status: 'confirmed', source: 'apple-import', sources: ['apple-import'], incomplete: false });
// December period shifts (Nov 16–29 already above: 5 G days =
// $10,625 for Dec 8; Nov 30 + Dec 1–13 engineered to $29,975 for
// Dec 22): G x2, Call 2 weekday x2, Call 2 weekend x4, Call 1
// weekday x2 = $27,850 + Nov 30 G $2,125.
const DEC_PHONE = [
  ['2026-12-01', G, '8-hour day', '2125'], ['2026-12-03', G, '8-hour day', '2125'],
  ['2026-12-02', C2, 'Second call', '3000'], ['2026-12-09', C2, 'Second call', '3000'],
  ['2026-12-05', C2, 'Second call', '2000'], ['2026-12-06', C2, 'Second call', '2000'],
  ['2026-12-12', C2, 'Second call', '2000'], ['2026-12-13', C2, 'Second call', '2000'],
  ['2026-12-04', C1, '24-hour call', '4800'], ['2026-12-11', C1, '24-hour call', '4800'],
].map(([d, c, ty, p], i) => ({ id: 'pd' + i, date: d, facility: 'Holzer', type: ty, code: c, pay: p, payUnit: 'facility', status: 'confirmed', source: 'apple-import', sources: ['apple-import'], incomplete: false }));
const browserCopy = (s, i) => ({ id: 'bw' + i, date: s.date, facility: 'HOLZ', type: s.code === G ? '8hr day shift' : s.code === C2 ? '2nd call' : '24hr call', code: s.code + (i % 2 ? ' [Martin]' : ''), pay: s.pay, payUnit: 'facility', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: false, startTime: '00:00' });
const CAMC_DEC = [
  ['2026-12-01', '5**', '2500'], ['2026-12-02', '5*', '2500'], ['2026-12-03', '5**', '2500'], ['2026-12-04', '5*', '2500'], ['2026-12-05', '7', '3000'],
].map(([d, c, p], i) => ({ id: 'cm' + i, date: d, facility: 'CAMC', type: c === '7' ? '12-hour shift' : '10-hour shift', code: c, pay: p, payUnit: 'facility', status: 'confirmed', source: 'schedule-import', sources: ['schedule-import'], incomplete: false }));
run(`db = empty(); db.settings.scheduleName = 'Caleb Martin';
  db.facilities = [${HOLZER_FAC}, ${CAMC_FAC}];
  db.payStubs = [{id:'stub1',agency:'Premier Anesthesia Group, PC',facility:'Holzer',frequency:'biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'2026-11-10',gross:'12757.50',net:'',source:'stub',fileName:'stub.png'}];
  db.shifts = ${JSON.stringify([...NOV_PHONE, ...DEC_PHONE, ...CAMC_DEC, ...[...NOV_PHONE, ...DEC_PHONE].map(browserCopy)])}; persist();`);
t('P1 repro: the doubled state holds 2x the HOLZ shifts (54 HOLZ + 5 CAMC)',
  run(`db.shifts.length`) === 59, 'count=' + run(`db.shifts.length`));
run(`globalThis.__heal = dedupeShiftsInPlace();`);
t('P1 heal: November is back to 17 shifts, December HOLZ to 10, CAMC untouched at 5',
  run(`db.shifts.filter(s=>s.date>='2026-11-01'&&s.date<='2026-11-30').length`) === 17 &&
  run(`db.shifts.filter(s=>s.facility==='CAMC').length`) === 5 &&
  run(`db.shifts.length`) === 32, 'total=' + run(`db.shifts.length`));
t('P1 heal: November headline is $39,832.50 again (not $92,407.50)',
  run(`monthHeadline('2026-11').gross`) === 39832.5, 'got ' + run(`monthHeadline('2026-11').gross`));
t('P1 heal: Nov 24 paycheck is $27,075',
  run(`(paystubOccurrencesInMonth('2026-11').find(o=>o.date==='2026-11-24')||{}).shiftCount`) >= 11 &&
  run(`paystubOccurrenceAmount(paystubOccurrencesInMonth('2026-11').find(o=>o.date==='2026-11-24'))`) === 27075);
t('P1 heal: December headline is $53,600 (HOLZ checks $40,600 + CAMC $13,000)',
  run(`monthHeadline('2026-12').gross`) === 53600, 'got ' + run(`monthHeadline('2026-12').gross`));

// ================= PART 2a: re-import is a hard stop =================
run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = [${HOLZER_FAC}];
  db.shifts = ${JSON.stringify(NOV_PHONE)}; persist(); alerts.length = 0;
  schedulePreview = { fileName: 'QGenda feed', source: 'qgenda-feed', matchedName: 'Martin', rows: ${JSON.stringify(NOV_PHONE.map(s => ({ date: s.date, facility: 'Holzer', type: s.type, code: s.code, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: true, flags: [], source: 'qgenda-feed', incomplete: true })))} };
  approveScheduleImport();`);
t('P2: re-importing the same QGenda set adds ZERO new shifts',
  run(`db.shifts.length`) === 17, 'count=' + run(`db.shifts.length`));
t('P2: the result message says the duplicates were already there / merged, never doubled',
  alerts.some(a => /duplicate|already/i.test(a) && /never doubled/i.test(a)), alerts.join(' | '));

// Within-batch duplicate (empty db, same row twice in one preview).
run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = [${HOLZER_FAC}]; db.shifts = []; alerts.length = 0;
  schedulePreview = { fileName: 'grid.png', source: 'schedule-import', matchedName: 'Martin', rows: [
    {date:'2026-12-07',facility:'Holzer',type:'8-hour day',code:'${G}',pay:'',name:'Martin',match:'matched',include:true,duplicate:false,flags:[],source:'schedule-import'},
    {date:'2026-12-07',facility:'Holzer',type:'8-hour day',code:'${G}',pay:'',name:'Martin',match:'matched',include:true,duplicate:false,flags:[],source:'schedule-import'},
  ]};
  approveScheduleImport();`);
t('P2: a duplicate inside one batch lands once',
  run(`db.shifts.length`) === 1, 'count=' + run(`db.shifts.length`));

// ================= PART 2b: the two-hospital clash (CAMC after HOLZ) =================
run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = [${HOLZER_FAC}, ${CAMC_FAC}];
  db.shifts = [
    {id:'hz1',date:'2026-12-01',facility:'Holzer',type:'8-hour day',code:'${G}',pay:'2125',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
    {id:'hz2',date:'2026-12-02',facility:'Holzer',type:'Second call',code:'${C2}',pay:'3000',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
    {id:'hz3',date:'2026-12-03',facility:'Holzer',type:'8-hour day',code:'${G}',pay:'2125',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
    {id:'hz4',date:'2026-12-04',facility:'Holzer',type:'24-hour call',code:'${C1}',pay:'4800',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
    {id:'hz5',date:'2026-12-05',facility:'Holzer',type:'Second call',code:'${C2}',pay:'2000',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false},
  ]; persist(); alerts.length = 0;
  schedulePreview = { fileName: 'camc-grid.png', source: 'schedule-import', matchedName: 'Martin', facilityAll: 'CAMC', rows: [
    {date:'2026-12-01',facility:'',type:'5**',code:'5**',pay:'',name:'Martin',match:'matched',include:true,duplicate:false,flags:[],source:'schedule-import'},
    {date:'2026-12-02',facility:'',type:'5*',code:'5*',pay:'',name:'Martin',match:'matched',include:true,duplicate:false,flags:[],source:'schedule-import'},
    {date:'2026-12-03',facility:'',type:'5**',code:'5**',pay:'',name:'Martin',match:'matched',include:true,duplicate:false,flags:[],source:'schedule-import'},
    {date:'2026-12-04',facility:'',type:'5*',code:'5*',pay:'',name:'Martin',match:'matched',include:true,duplicate:false,flags:[],source:'schedule-import'},
    {date:'2026-12-05',facility:'',type:'7',code:'7',pay:'',name:'Martin',match:'matched',include:true,duplicate:false,flags:[],source:'schedule-import'},
  ]};
  approveScheduleImport();`);
t('P2 cross-facility: the first approve STOPS — nothing at all was added',
  run(`db.shifts.length`) === 5 && run(`!!schedulePreview`), 'count=' + run(`db.shifts.length`));
t('P2 cross-facility: all five CAMC dates are flagged as conflicts',
  run(`(schedulePreview.pendingConflicts || []).length`) === 5, 'got ' + run(`(schedulePreview.pendingConflicts || []).length`));
t('P2 cross-facility: the warning names both hospitals and the date, in plain words',
  run(`(schedulePreview.pendingConflicts || []).some(c => /Dec 2/.test(c.text) && /CAMC/.test(c.text) && /HOLZ - G Main \(8\)|Call 2/.test(c.text))`) &&
  run(`importConflictsHTML(schedulePreview, 'sched')`).includes('double-booking'),
  run(`(schedulePreview.pendingConflicts || []).map(c => c.text).join(' | ')`));
// Override ONLY Dec 2 ("Add it anyway"), then approve again.
run(`const c2 = schedulePreview.pendingConflicts.find(c => c.date === '2026-12-02');
  schedulePreview.conflictOverrides = {}; schedulePreview.conflictOverrides[c2.key] = true;
  alerts.length = 0; approveScheduleImport();`);
t('P2 cross-facility: only the overridden date is added — both shifts stay, both priced',
  run(`db.shifts.length`) === 6 &&
  run(`db.shifts.some(s=>s.date==='2026-12-02'&&s.facility==='CAMC'&&Number(s.pay)===2500)`) &&
  run(`db.shifts.some(s=>s.date==='2026-12-02'&&s.facility==='Holzer'&&Number(s.pay)===3000)`),
  'count=' + run(`db.shifts.length`));
t('P2 cross-facility: the other four CAMC shifts were NOT added',
  run(`db.shifts.filter(s=>s.facility==='CAMC').length`) === 1);

// Opposite order + different door: CAMC saved first, then a QGenda
// (schedule-preview) HOLZ row clashes the same way.
run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = [${HOLZER_FAC}, ${CAMC_FAC}];
  db.shifts = [{id:'cm1',date:'2026-12-02',facility:'CAMC',type:'10-hour shift',code:'5*',pay:'2500',status:'confirmed',source:'schedule-import',sources:['schedule-import'],incomplete:false}]; persist();
  schedulePreview = { fileName: 'QGenda feed', source: 'qgenda-feed', matchedName: 'Martin', rows: [
    {date:'2026-12-02',facility:'Holzer',type:'Second call',code:'${C2}',pay:'',name:'Martin',match:'matched',include:true,duplicate:false,flags:[],source:'qgenda-feed'},
  ]};
  approveScheduleImport();`);
t('P2 cross-facility (reverse order, QGenda door): the clash stops the approve too',
  run(`db.shifts.length`) === 1 && run(`(schedulePreview.pendingConflicts || []).length`) === 1);

// ================= PART 2c: day + call at one facility is NOT a conflict =================
run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = [${HOLZER_FAC}];
  db.shifts = [{id:'dc1',date:'2026-12-07',facility:'Holzer',type:'8-hour day',code:'${G}',pay:'2125',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false}]; persist(); alerts.length = 0;
  schedulePreview = { fileName: 'QGenda feed', source: 'qgenda-feed', matchedName: 'Martin', rows: [
    {date:'2026-12-07',facility:'Holzer',type:'Second call',code:'${C2}',pay:'',name:'Martin',match:'matched',include:true,duplicate:false,flags:[],source:'qgenda-feed'},
  ]};
  approveScheduleImport();`);
t('P2: an incoming call beside a saved day shift at the SAME facility is not flagged',
  run(`!schedulePreview`) && run(`db.shifts.length`) === 2, 'count=' + run(`db.shifts.length`));

// ================= PART 2d: manual add gets the same warning =================
run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = [${HOLZER_FAC}, ${CAMC_FAC}];
  db.shifts = [{id:'mn1',date:'2026-12-01',facility:'Holzer',type:'8-hour day',code:'${G}',pay:'2125',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false}]; persist();
  globalThis.__ev = { preventDefault(){}, currentTarget: { dataset: { kind: 'shifts' }, _entries: [['date','2026-12-01'],['facility','CAMC'],['type','8-hour day'],['pay','2000'],['note','']] } };
  submitEntry(globalThis.__ev);`);
t('P2 manual: a clashing hand-added shift is NOT saved on first submit',
  run(`db.shifts.length`) === 1 && run(`!!pendingManualShift`), 'count=' + run(`db.shifts.length`));
t('P2 manual: the form shows the double-booking warning inline',
  run(`shiftFormHTML()`).includes('double-booking'));
run(`actions('manual-shift-anyway');`);
t('P2 manual: "Add it anyway" saves it — both shifts on the day, priced',
  run(`db.shifts.length`) === 2 && run(`db.shifts.some(s=>s.facility==='CAMC'&&Number(s.pay)===2000)`));

// ================= PART 2e: calendar sync holds conflicts out =================
run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = [${HOLZER_FAC}, ${CAMC_FAC}];
  db.shifts = [{id:'sy1',date:'2026-12-01',facility:'Holzer',type:'8-hour day',code:'${G}',pay:'2125',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:false}]; persist();
  globalThis.__syncRes = liveSyncApplyChanges('apple', { providerChanges: [
    {action:'create', shift:{id:'sy2',date:'2026-12-01',facility:'CAMC',type:'10-hour shift',pay:'',note:'',source:'apple-import',updatedAt:null}},
    {action:'create', shift:{id:'sy3',date:'2026-12-02',facility:'CAMC',type:'10-hour shift',pay:'',note:'',source:'apple-import',updatedAt:null}},
  ], pendingDeletions: [] });`);
t('P2 sync: a synced shift clashing with a booked day is held out and reported; a clean one lands',
  run(`db.shifts.length`) === 2 && run(`(__syncRes.conflicts || []).length`) === 1 && run(`__syncRes.created`) === 1,
  JSON.stringify(run(`__syncRes`)));

console.log(fails ? ('FAILURES: ' + fails) : 'ALL PASS');
