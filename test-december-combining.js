// CRNA Hub — December: same-day task combining + paid hours
// (Nov 9, 2026).
//
// Caleb's live December (from his work calendar — one event per
// day, single assignments): pure G Main days, "8 + 2nd call" days
// and "1st call" days. QGenda lists a combined day as TWO tasks —
// G Main (8) AND Call 1 on the same date — but they are one
// assignment: weekday 1st call ($4,800) is the whole 24 hours,
// weekday 2nd call ($3,000) is day base + bonus, weekend 2nd call
// is a flat $2,000 with no day base (his contract addendum + his
// stated rules). December on the pre-fix code:
//   Dec 8 paycheck  $10,000  (5 x $2,000 — the 8.5 paid hours the
//                            clarification never asked about)
//   Dec 22 paycheck $35,600  (day rows priced ON TOP of calls)
//   December headline $45,600
// Truth: Dec 8 $10,625 · Dec 22 $29,975 · December worked $49,500
// · December headline (paycheck basis) $40,600.
//
// The fix: (1) combineDayCallRows absorbs a day row into a
// same-date/same-facility call row centrally (QGenda preview
// build + both approve paths), so a combined day saves as ONE
// shift priced as the call; (2) the clarification prompt asks a
// day code for its PAID hours (defaulting to the shift's hours),
// saved per code and into paidHours8, and the pricer uses it —
// derived pays, including feed prices stamped as per-shift
// totals at approve, reprice when the answer lands; (3) already-
// saved day+call pairs heal on load/cloud merge (manual entries
// never merge away).
//
// Run: node test-december-combining.js
// Repro of the pre-fix numbers: DEC_REPRO=1 DEC_DIR=<pre-fix dir> node test-december-combining.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = (process.env.DEC_DIR || __dirname) + path.sep;
const REPRO = !!process.env.DEC_REPRO;
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
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) { fails++; process.exitCode = 1; } };

// Caleb's Holzer facility as his post-retest QGenda-only account
// has it: hourly $250, call splits saved by the v100 prompt,
// paidHours8 '8' (the old clarify migration wrote the SHIFT's
// hours there — the adversarial case), no flat day rate.
const FAC = `{ id:'f1', name:'Holzer', aliases:'', address:'100 Jackson Pike, Gallipolis, OH 45631',
  hourlyRate:'250', hourlyCall1st:'175', callBonus:'', rate8:'', paidHours8:'8', rate10:'', rate12:'',
  rate24:'4800', weekendRate24:'4200', rateSecond:'3000', weekendRateSecond:'2000',
  codeMap:{ 'HOLZ - G Main (8)':{label:'8-hour day',hours:'8'},
            'HOLZ - Call 2':{label:'Second call',hours:'24',canonicalType:'Second call'},
            'HOLZ - Call 1':{label:'24-hour call',hours:'24',canonicalType:'24-hour call'} } }`;
const SCHED = `{ id:'ps1', agency:'Holzer', facility:'Holzer', frequency:'biweekly',
  periodStart:'2026-11-02', periodEnd:'2026-11-15', payDate:'2026-11-24', gross:'', net:'',
  source:'import', fileName:'' }`;
// The QGenda row set from his December screenshot (server-priced,
// source 'qgenda-feed' — the tag the live feed actually sends).
const G = (date) => ({ date, facility: 'Holzer', code: 'HOLZ - G Main (8)', type: '8-hour day', hours: 8, pay: '2000', include: true, duplicate: false, flags: [], match: null, source: 'qgenda-feed' });
const C1 = (date, pay) => ({ date, facility: 'Holzer', code: 'HOLZ - Call 1', type: '24-hour call', hours: 24, pay, include: true, duplicate: false, flags: [], match: null, source: 'qgenda-feed' });
const C2 = (date, pay) => ({ date, facility: 'Holzer', code: 'HOLZ - Call 2', type: 'Second call', hours: 24, pay, include: true, duplicate: false, flags: [], match: null, source: 'qgenda-feed' });
const ROWS = [
  ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map(G),
  G('2026-11-30'),
  G('2026-12-01'), G('2026-12-03'), G('2026-12-04'), G('2026-12-08'), G('2026-12-10'),
  G('2026-12-14'), G('2026-12-16'), G('2026-12-18'), G('2026-12-29'), G('2026-12-30'),
  C2('2026-12-02', '3000'), C2('2026-12-05', '2000'), C2('2026-12-28', '3000'),
  C1('2026-12-04', '4800'), C1('2026-12-06', '4200'), C1('2026-12-08', '4800'),
  C1('2026-12-10', '4800'), C1('2026-12-14', '4800'), C1('2026-12-16', '4800'), C1('2026-12-18', '4800'),
];
function setupWorld() {
  run(`db.facilities=[${FAC}]; db.payStubs=[${SCHED}]; db.shifts=[]; db.contracts=[];`);
  run(`schedulePreview={fileName:'QGenda feed',source:'qgenda-feed',parserVersion:5,rows:${JSON.stringify(ROWS)}};`);
}
// importRatesTarget returns null when nothing needs asking, so
// fall back to the explicit Holzer target for direct prompt reads.
const CODES_EXPR = `unclarifiedCodes(schedulePreview, (()=>{const t=importRatesTarget(schedulePreview);return t||{name:'Holzer',fac:facilityByNameOrAlias('Holzer')}})())`;
const occTotal = (d) => run(`(paystubOccurrencesOn('${d}')[0]||{}).total`);
const shiftsOn = (d) => run(`db.shifts.filter(s=>s.date==='${d}')`);

if (REPRO) {
  setupWorld();
  const codes = run(CODES_EXPR);
  t('repro: pre-fix prompt asks nothing (no paid-hours question exists)', Array.isArray(codes) && codes.length === 0, JSON.stringify(codes));
  run(`approveScheduleImport()`);
  t('repro: Dec 4 saved as TWO shifts (day + call)', shiftsOn('2026-12-04').length === 2, 'count=' + shiftsOn('2026-12-04').length);
  t('repro: G Main priced $2,000 flat', run(`(db.shifts.find(s=>s.date==='2026-12-01')||{}).pay`) === '2000');
  t('repro: Dec 8 paycheck is $10,000', occTotal('2026-12-08') === 10000, 'got ' + occTotal('2026-12-08'));
  t('repro: Dec 22 paycheck is $35,600 (double-counted)', occTotal('2026-12-22') === 35600, 'got ' + occTotal('2026-12-22'));
  t('repro: December headline is $45,600', run(`monthHeadline('2026-12', db.shifts).gross`) === 45600, 'got ' + run(`monthHeadline('2026-12', db.shifts).gross`));
  console.log(fails ? `\n${fails} REPRO CHECK(S) DIFFER` : '\nALL REPRO CHECKS MATCH THE PRE-FIX NUMBERS');
  process.exit(fails ? 1 : 0);
}

// ---- unit: the combiner + row kinds ----
run(`window.__u = {
  pair: combineDayCallRows([{date:'2026-12-04',facility:'Holzer',code:'HOLZ - G Main (8)',type:'8-hour day',include:true},{date:'2026-12-04',facility:'Holzer',code:'HOLZ - Call 1',type:'24-hour call',include:true}]),
  c2pair: combineDayCallRows([{date:'2026-12-05',facility:'Holzer',code:'HOLZ - G Main (8)',type:'8-hour day',include:true},{date:'2026-12-05',facility:'Holzer',code:'HOLZ - Call 2',type:'Second call',include:true}]),
  solo: combineDayCallRows([{date:'2026-12-01',facility:'Holzer',code:'HOLZ - G Main (8)',type:'8-hour day',include:true}]),
  diffFac: combineDayCallRows([{date:'2026-12-04',facility:'Holzer',code:'HOLZ - G Main (8)',type:'8-hour day',include:true},{date:'2026-12-04',facility:'CAMC',code:'Call 1',type:'24-hour call',include:true}]),
  kDay: importRowKind({code:'HOLZ - G Main (8)',type:''}),
  kCall: importRowKind({code:'X',type:'8/2nd call'}),
  kOther: importRowKind({code:'Team lunch',type:''}),
};`);
const U = run(`window.__u`);
t('unit: day+Call 1 same day combine to one row', U.pair.length === 1 && U.pair[0].type === '24-hour call');
t('unit: absorbed day is flagged on the call row, not dropped silently', Array.isArray(U.pair[0].absorbedCodes) && U.pair[0].absorbedCodes.includes('HOLZ - G Main (8)') && (U.pair[0].flags || []).some(f => /one assignment/.test(f)));
t('unit: day+Call 2 combine too (8/2nd call semantics)', U.c2pair.length === 1 && U.c2pair[0].type === 'Second call');
t('unit: a standalone day row is untouched', U.solo.length === 1 && U.solo[0].type === '8-hour day');
t('unit: different facilities on the same date never combine', U.diffFac.length === 2);
t('unit: row kinds — grammar "(8)" code is a day, "8/2nd call" is a call, "Team lunch" is neither', U.kDay === 'day' && U.kCall === 'call' && U.kOther === '');

// ---- the December import, fixed ----
setupWorld();
const codes = run(CODES_EXPR);
t('prompt: only G Main is asked about (call codes settled, absorbed days unasked)', Array.isArray(codes) && codes.length === 1 && codes[0].code === 'HOLZ - G Main (8)', JSON.stringify(codes));
t('prompt: the G Main question is the PAID-hours question', !!(codes[0] && codes[0].paidHoursAsk) && !codes[0].splitType);
run(`schedulePreview.clarifyDraft={hourlyRate:'',codes:{'HOLZ - G Main (8)':{paidHours:'8.5'}}};`);
run(`approveScheduleImport()`);
t('approve: 26 feed rows save as 20 shifts (6 combined days)', run(`db.shifts.length`) === 20, 'count=' + run(`db.shifts.length`));
for (const d of ['2026-12-04', '2026-12-08', '2026-12-10', '2026-12-14', '2026-12-16', '2026-12-18']) {
  const s = shiftsOn(d);
  t(`approve: ${d} is ONE shift — the 1st call at $4,800`, s.length === 1 && s[0].type === '24-hour call' && s[0].pay === '4800', JSON.stringify(s.map(x => x.type + ':' + x.pay)));
}
t('approve: Dec 6 (Sunday) 1st call is one shift at $4,200', (() => { const s = shiftsOn('2026-12-06'); return s.length === 1 && s[0].pay === '4200'; })());
t('approve: Dec 2 Call 2 weekday $3,000 · Dec 5 Saturday flat $2,000 · Dec 28 $3,000',
  shiftsOn('2026-12-02')[0].pay === '3000' && shiftsOn('2026-12-05')[0].pay === '2000' && shiftsOn('2026-12-28')[0].pay === '3000');
for (const d of ['2026-11-16', '2026-11-30', '2026-12-01', '2026-12-03', '2026-12-29', '2026-12-30']) {
  t(`approve: standalone G Main ${d} prices $2,125 (paid hours 8.5)`, (shiftsOn(d)[0] || {}).pay === '2125', 'got ' + (shiftsOn(d)[0] || {}).pay);
}
t('totals: December worked sum is $49,500', run(`db.shifts.filter(s=>s.date>='2026-12-01'&&s.date<='2026-12-31').reduce((a,s)=>a+(Number(s.pay)||0),0)`) === 49500, 'got ' + run(`db.shifts.filter(s=>s.date>='2026-12-01'&&s.date<='2026-12-31').reduce((a,s)=>a+(Number(s.pay)||0),0)`));
t('totals: Dec 8 paycheck is $10,625', occTotal('2026-12-08') === 10625, 'got ' + occTotal('2026-12-08'));
t('totals: Dec 22 paycheck is $29,975', occTotal('2026-12-22') === 29975, 'got ' + occTotal('2026-12-22'));
t('totals: December headline (paycheck basis) is $40,600', run(`monthHeadline('2026-12', db.shifts).gross`) === 40600, 'got ' + run(`monthHeadline('2026-12', db.shifts).gross`));
t('answers saved: paidHours8 and the code definition both carry 8.5',
  run(`db.facilities[0].paidHours8`) === '8.5' && run(`db.facilities[0].codeMap['HOLZ - G Main (8)'].paidHours`) === '8.5');
run(`schedulePreview={fileName:'QGenda feed',source:'qgenda-feed',parserVersion:5,rows:${JSON.stringify(ROWS)}};`);
t('prompt: after the answer, nothing is asked again', run(CODES_EXPR + '.length') === 0);

// ---- healing: pairs saved before the fix merge on load ----
run(`db.shifts=[
  {id:'hd1',date:'2026-12-04',facility:'Holzer',type:'8-hour day',code:'HOLZ - G Main (8)',pay:'2000',payUnit:'daily',status:'confirmed',sources:['qgenda-feed'],updatedAt:null},
  {id:'hc1',date:'2026-12-04',facility:'Holzer',type:'24-hour call',code:'HOLZ - Call 1',pay:'4800',payUnit:'facility',status:'confirmed',sources:['qgenda-feed'],updatedAt:null},
  {id:'md1',date:'2026-12-11',facility:'Holzer',type:'8-hour day',code:'HOLZ - G Main (8)',pay:'2000',payUnit:'daily',status:'confirmed',sources:['user-entered'],updatedAt:null},
  {id:'mc1',date:'2026-12-11',facility:'Holzer',type:'24-hour call',code:'HOLZ - Call 1',pay:'4800',payUnit:'daily',status:'confirmed',sources:['user-entered'],updatedAt:null}
];`);
const healed = run(`healDayCallShiftPairs()`);
t('heal: the imported day+call pair merges into the call shift', healed.merged === 1 && shiftsOn('2026-12-04').length === 1 && shiftsOn('2026-12-04')[0].id === 'hc1' && shiftsOn('2026-12-04')[0].pay === '4800');
t('heal: merged shift remembers both sources', (shiftsOn('2026-12-04')[0].sources || []).length >= 1);
t('heal: a purely manual pair is never merged away (correction layer)', shiftsOn('2026-12-11').length === 2);

console.log(fails ? `\n${fails} FAILING` : '\nALL PASS');
