// Nov 9, 2026 (evening) — the live-account trace for the Nov 24
// paycheck, the paystub-record-shape heal, the describe-in-words
// clarification, and per-facility weekendDays.
//
// Caleb's live account after the v101/v102 round (screenshot,
// branch preview): November headline $37,200.00, Nov 10 ONE chip
// "Holzer est. $11,000.00" (the Premier ACTUAL chip gone), Nov 24
// "Holzer est. $26,200.00", 17 QGenda shifts. The arithmetic:
//   $26,200 = Nov 2-15 at G Main x7 x $2,000 (paidHours 8, not 8.5)
//             + Call 2 $3,000 (Tue Nov 3) + $3,000 (Fri Nov 6)
//             + $2,000 (Sun Nov 8) + Call 1 $4,200 (Sat Nov 7)
//             — the call split WAS live; $27,075 - $26,200 = $875
//             = 7 x $125, the paid-hours gap alone.
//   $11,000 = the Oct 19 - Nov 1 period at the same unit prices.
//   $37,200 = 11,000 + 26,200 exactly: the stub actual contributed
//             $0. His stub record exists (Premier Anesthesia Group,
//             PC, $12,757.50, payDate 2026-11-10) — it rendered as a
//             chip that morning.
// Diagnosis (reproduced against the v102 code in /tmp/repro-nov24.js
// before this fix round):
//   * Three stored shapes produce the EXACT screenshot state:
//     V4 (stub record's gross/net blank — e.g. a blank re-read
//     replaced it), V5 (stub record absent), and V10/V12 (stub
//     payDate stored '11/10/2026' or as an ISO datetime — the AI
//     read's date in a form the engine's strict-ISO guard rejects,
//     so the record generates no series and never unifies). V10/V12
//     are the healable family: the amount is in storage, only the
//     date shape hides it. V3/V7/V14 (period/frequency variants)
//     were KILLED — the actual stays visible in all of them.
//   * The paid-hours half: boot ran NO reprice pass and NO prompt.
//     The v102 paid-hours re-ask lived only inside import previews
//     and its approve path recorded the SHOWN DEFAULT (the shift's
//     own 8 hours) as the answer, so his unverified 8 became a
//     permanent "answer" and nothing ever repriced on plain open.
// This suite pins the fixes:
//   1. Stored-shape normalization heals V10/V12 on plain open
//      (value-preserving: dates/frequency/amounts canonicalized,
//      nothing invented) -> Nov 10 is the ACTUAL again.
//   2. A blank re-upload can never erase a known actual
//      (approvePaystub carries it); deleting an amount-stating
//      record warns in words (code-pinned here by the carry).
//   3. The words heal: on plain open the Dashboard surfaces ONE
//      describe-in-your-own-words prompt for the unverified
//      facility (prefilled with current beliefs). Caleb's sentence
//      ("...paid for 8.5 hours...") parses, reads back, confirms,
//      reprices -> Nov 24 $27,075, headline $39,832.50.
//   4. Friday pins BOTH ways: weekendDays [0,6] prices Friday Call
//      2 at $3,000 and Friday Call 1 at $4,800 (weekday); a
//      facility whose weekend includes Friday prices them at its
//      weekend rates. No facility literals in pricing code.
// Run: node test-nov24-live-trace.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

(async () => {
  const G = 'HOLZ - G Main (8)', C2 = 'HOLZ - Call 2', C1 = 'HOLZ - Call 1';
  // Caleb's facility as the v102 code leaves it: hourly 250 with
  // paidHours8 copied from the shift hours ('8' — recorded by the
  // approve path as an "answer" though he never typed it), the
  // Call 2 split saved, NO facility-level 24h fields (Call 1 prices
  // through its codeMap definition), defs saved by the old field
  // flow — none of them confirmed in the read-back sense.
  const FAC = `{id:'f1',name:'Holzer',aliases:'',address:'',hourlyRate:'250',paidHours8:'8',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',rateSecond:'3000',weekendRateSecond:'2000',hourlyCall1st:'',callBonus:'',distance:'',notes:'',
    codeMap:{'${G}':{label:'8-hour day',hours:'8',paidHours:'8'},'${C2}':{label:'Second call',hours:'24',canonicalType:'Second call',pay:'3000',payUnit:'daily',payRate:''},'${C1}':{label:'24-hour call',hours:'24',canonicalType:'24-hour call',pay:'6000',payUnit:'hourly',payRate:'250'}}}`;
  const mkShift = (id, date, code, type, pay, payUnit) => ({ id, date, facility: 'Holzer', type, code, pay, payRate: payUnit === 'hourly' ? '250' : '', payUnit, status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: false, note: '' });
  // The Oct 19 - Nov 1 period is the verified stub period: 4 G Main
  // + Friday Call 2 (Oct 23) — $11,000 at his live unit prices,
  // $11,500 at correct rates (the stub's own shift math).
  const SHIFTS = `[
    ${[['2026-10-19'], ['2026-10-20'], ['2026-10-21'], ['2026-10-22']].map(([d], i) => JSON.stringify(mkShift('o' + i, d, G, '8-hour day', '2000', 'facility'))).join(',')},
    ${JSON.stringify(mkShift('o4', '2026-10-23', C2, 'Second call', '3000', 'facility'))},
    ${[['2026-11-02'], ['2026-11-04'], ['2026-11-05'], ['2026-11-10'], ['2026-11-11'], ['2026-11-12'], ['2026-11-13'], ['2026-11-16'], ['2026-11-17'], ['2026-11-18'], ['2026-11-19'], ['2026-11-20'], ['2026-11-30']].map(([d], i) => JSON.stringify(mkShift('n' + i, d, G, '8-hour day', '2000', 'facility'))).join(',')},
    ${JSON.stringify(mkShift('n13', '2026-11-03', C2, 'Second call', '3000', 'facility'))},
    ${JSON.stringify(mkShift('n14', '2026-11-06', C2, 'Second call', '3000', 'facility'))},
    ${JSON.stringify(mkShift('n15', '2026-11-08', C2, 'Second call', '2000', 'facility'))},
    ${JSON.stringify(mkShift('n16', '2026-11-07', C1, '24-hour call', '4200', 'daily'))}
  ]`;
  const IMPORT_REC = `{id:'imp1',agency:'Holzer',facility:'Holzer',frequency:'biweekly',periodStart:'2026-11-02',periodEnd:'2026-11-15',payDate:'2026-11-24',gross:'',net:'',source:'import',fileName:''}`;
  const occ = (ym, pd) => run(`paystubOccurrencesInMonth('${ym}')`).find(o => o.date === pd) || {};
  const setup = (stubRec) => {
    run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${FAC}]; db.shifts=${SHIFTS}; db.payStubs=[${IMPORT_REC}${stubRec ? ',' + stubRec : ''}]; persist();`);
  };
  const periodSum = (a, b) => run(`db.shifts.filter(s=>s.date>='${a}'&&s.date<='${b}').reduce((x,s)=>x+(Number(s.pay)||0),0)`);

  // ---------- 0: the screenshot's arithmetic, and why v102 hid it ----------
  // (The full three-figure repro against the unmodified v102 code
  // lives in the round's harness evidence; here the fixture's own
  // period sums pin the same decomposition, and the guard that hid
  // the stub is pinned directly.)
  setup(`{id:'stub1',agency:'Premier Anesthesia Group, PC',facility:'',frequency:'biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'11/10/2026',gross:'12757.50',net:'',source:'stub',fileName:'stub.png'}`);
  t('repro: Oct 19 - Nov 1 shifts at his stored pays sum to $11,000 (the Nov 10 estimate)', periodSum('2026-10-19', '2026-11-01') === 11000, 'got ' + periodSum('2026-10-19', '2026-11-01'));
  t('repro: Nov 2 - 15 shifts at his stored pays sum to $26,200 (the Nov 24 estimate)', periodSum('2026-11-02', '2026-11-15') === 26200, 'got ' + periodSum('2026-11-02', '2026-11-15'));
  t('repro: the two estimates alone make the $37,200 headline', periodSum('2026-10-19', '2026-11-01') + periodSum('2026-11-02', '2026-11-15') === 37200);
  t('repro: the v102 strict-ISO guard rejects the stored payDate shape', !run(`psValidISO('11/10/2026')`) && !run(`psValidISO(db.payStubs.find(s=>s.id==='stub1').payDate)`));

  // ---------- 1: plain-open heal of the date-mangled stub (V10) ----------
  // healPaystubRecordShapes() is what the v103 boot runs on open.
  run(`window.__h = healPaystubRecordShapes();`);
  t('heal: the stored record was rewritten in place on open', run(`window.__h`) >= 1 && run(`db.payStubs.find(s=>s.id==='stub1').payDate`) === '2026-11-10', 'changed=' + run(`window.__h`));
  t('heal: Nov 10 is the Premier ACTUAL $12,757.50, the estimate suppressed', occ('2026-11', '2026-11-10').isActual === true && run(`paystubOccurrenceAmount(paystubOccurrencesInMonth('2026-11').find(o=>o.date==='2026-11-10'))`) === 12757.5);
  t('heal: the two records read as ONE schedule (the stub is the default)', run(`paystubSchedules().length`) === 1);
  t('heal: headline is actual + Nov 24 estimate = $38,957.50 (paid hours still unhealed)', run(`monthHeadline('2026-11').gross`) === 38957.5, 'got ' + run(`monthHeadline('2026-11').gross`));
  t('heal: the Pay schedules list explains the merged pair', run(`paystubListHTML().includes('same payer saved two ways')`));

  // ---------- 1b: the ISO-datetime shape (V12) heals identically ----------
  setup(`{id:'stub1',agency:'Premier Anesthesia Group, PC',facility:'',frequency:'Biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'2026-11-10T00:00:00.000Z',gross:'12757.50',net:'',source:'stub',fileName:'stub.png'}`);
  run(`healPaystubRecordShapes();`);
  t('heal (datetime): Nov 10 actual restored, one schedule, frequency canonicalized in storage', occ('2026-11', '2026-11-10').isActual === true && run(`paystubSchedules().length`) === 1 && run(`db.payStubs.find(s=>s.id==='stub1').frequency`) === 'biweekly');

  // ---------- 1c: a blank re-read can never erase a known actual (V4) ----------
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${FAC}]; db.shifts=[]; db.payStubs=[{id:'old1',agency:'Premier Anesthesia Group, PC',facility:'',frequency:'biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'2026-11-10',gross:'12757.50',net:'',source:'stub',fileName:'stub.png'}]; persist();
       paystubPreview = {agency:'Premier Anesthesia Group, PC',facility:'',frequency:'biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'2026-11-10',gross:'',net:'',source:'stub',fileName:'stub2.png'};`);
  await run(`approvePaystub()`);
  t('carry: approving a blank re-read keeps the $12,757.50 actual', parseFloat(run(`(db.payStubs.find(s=>s.id==='old1')||db.payStubs[0]).gross`)) === 12757.5 && run(`db.payStubs.length`) === 1, JSON.stringify(run(`db.payStubs.map(s=>s.gross)`)));

  // ---------- 2: the words heal on plain open ----------
  setup(`{id:'stub1',agency:'Premier Anesthesia Group, PC',facility:'',frequency:'biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'11/10/2026',gross:'12757.50',net:'',source:'stub',fileName:'stub.png'}`);
  run(`healPaystubRecordShapes(); db.payStubs = db.payStubs.filter(s=>s.source!=='import'); persist();`);
  const healHTML = run(`dashboardRulesHealHTML()`);
  t('words: the Dashboard surfaces the describe prompt for Holzer on plain open', healHTML.includes('Quick check — pay rules at Holzer') && healHTML.includes('describeText') && healHTML.includes('Make my rules'), healHTML.slice(0, 120));
  t('words: the box is prefilled with current beliefs (incl. the wrong 8 paid hours, his to correct)', healHTML.includes('paid for 8 hours') && healHTML.includes('Weekend is Saturday and Sunday'), healHTML.slice(healHTML.indexOf('Pay rules at'), healHTML.indexOf('Pay rules at') + 300));
  t('words: NO field grids anywhere in the prompt', !healHTML.includes('clarifyCode') && !healHTML.includes('clarifyHourly') && !healHTML.includes('impCodePaidHours'));
  const WORDS = "Day shifts pay $250/hr and I'm paid for 8.5 hours. Call 2 is $3,000 on weekdays, $2,000 on weekends. Call 1 is $4,800 weekdays, $4,200 weekends. Weekend is Saturday and Sunday.";
  run(`window.__codes = facilityRulesUnverified(db.facilities[0]).codes; window.__parsed = describeParseLocal(${JSON.stringify(WORDS)}, db.facilities[0], window.__codes);`);
  // The prompt asks only about the two UNVERIFIED codes (G Main's
  // paid hours, Call 1's unstated split) — Call 2's split was
  // already saved, so it is not re-asked; his sentence restates it
  // anyway and the rates still land.
  // v114 expectation change (stated, not silent): the parse's
  // code universe is now the facility's known codes, not just
  // the caller's list — the words NAME Call 2, so its definition
  // is rebuilt too (defs = 3, not 2). The caller-list-only
  // universe was the v114 defect itself: on the facility card
  // it silently dropped CAMC's "5*" (shifts, no saved def) from
  // the read-back entirely. What the prompt ASKS (unanswered)
  // is unchanged: still 0 here, and Call 2 is not re-asked.
  t('words: the parse answers the asked codes, nothing left over', run(`window.__parsed.unanswered.length`) === 0 && run(`Object.keys(window.__parsed.defs).length`) === 3, JSON.stringify(run(`window.__parsed.unanswered`)) + ' defs=' + run(`Object.keys(window.__parsed.defs).length`));
  t('words: the parse reads paid hours 8.5 and both call splits', run(`window.__parsed.rates.paidHours8`) === 8.5 && run(`window.__parsed.rates.rateSecond`) === 3000 && run(`window.__parsed.rates.weekendRateSecond`) === 2000 && run(`window.__parsed.rates.rate24`) === 4800 && run(`window.__parsed.rates.weekendRate24`) === 4200, JSON.stringify(run(`window.__parsed.rates`)));
  t('words: the weekend definition parses to Sat/Sun for his facility', JSON.stringify(run(`window.__parsed.weekendDays`)) === '[0,6]');
  const summary = run(`describeSummaryText('Holzer', window.__parsed, db.facilities[0])`);
  t('words: the read-back summary states the rules in plain language', summary.includes('$2,125') && summary.includes('Weekend means Saturday and Sunday') && summary.includes('$3,000 on weekdays'), summary);
  run(`applyDescribedRules(db.facilities[0], window.__parsed); persist();`);
  t('words: G Main reprices to $2,125', run(`(db.shifts.find(s=>s.date==='2026-11-02')||{}).pay`) === '2125', run(`(db.shifts.find(s=>s.date==='2026-11-02')||{}).pay`));
  t('words: paidHours8 saved as 8.5 and the definitions are confirmed', run(`db.facilities[0].paidHours8`) === '8.5' && run(`codeDefFor(db.facilities[0],'${G}').rulesConfirmed`) === true);
  t('words: Nov 24 heals to $27,075', occ('2026-11', '2026-11-24').total === 27075, 'got ' + occ('2026-11', '2026-11-24').total);
  t('words: headline heals to $39,832.50 (actual + healed estimate)', run(`monthHeadline('2026-11').gross`) === 39832.5, 'got ' + run(`monthHeadline('2026-11').gross`));
  t('words: November worked total is $39,825', run(`db.shifts.filter(s=>s.date>='2026-11-01'&&s.date<='2026-11-30').reduce((a,s)=>a+(Number(s.pay)||0),0)`) === 39825, 'got ' + run(`db.shifts.filter(s=>s.date>='2026-11-01'&&s.date<='2026-11-30').reduce((a,s)=>a+(Number(s.pay)||0),0)`));
  t('words: the prompt never returns once confirmed', run(`dashboardRulesHealHTML()`) === '');

  // ---------- 3: Friday pins, both weekend definitions ----------
  run(`window.__hf={hourlyRate:'250',paidHours8:'8.5',rate8:'',rateSecond:'3000',weekendRateSecond:'2000',rate24:'4800',weekendRate24:'4200',callBonus:'',hourlyCall1st:''}`);
  t('fri: default weekend (Sat/Sun) — Friday Call 2 is the WEEKDAY $3,000', run(`facilityPayFor(window.__hf,'Second call','2026-11-06')`) === 3000);
  t('fri: default weekend (Sat/Sun) — Friday Call 1 is the WEEKDAY $4,800', run(`facilityPayFor(window.__hf,'24-hour call','2026-11-06')`) === 4800);
  t('fri: default weekend — Sunday Call 2 $2,000, Saturday Call 1 $4,200', run(`facilityPayFor(window.__hf,'Second call','2026-11-08')`) === 2000 && run(`facilityPayFor(window.__hf,'24-hour call','2026-11-07')`) === 4200);
  run(`window.__hfFri={...window.__hf,weekendDays:[0,5,6]}`);
  t('fri: weekend-includes-Friday facility — Friday Call 2 prices at its WEEKEND $2,000', run(`facilityPayFor(window.__hfFri,'Second call','2026-11-06')`) === 2000);
  t('fri: weekend-includes-Friday facility — Friday Call 1 prices at its WEEKEND $4,200', run(`facilityPayFor(window.__hfFri,'24-hour call','2026-11-06')`) === 4200);
  t('fri: the words parser captures "weekend includes Friday"', JSON.stringify(run(`parseWeekendDaysText('Weekend includes Friday at this hospital.')`)) === '[0,5,6]');
  t('fri: the words parser captures "Friday is a weekday" as a removal', JSON.stringify(run(`parseWeekendDaysText('Weekend includes Friday. Actually, Friday is a weekday here.')`)) === '[0,6]');

  // ---------- 4: chip codes are the feed's task names, by design ----------
  t('chips: a QGenda shift chip shows the code as read (the full task name)', run(`shiftChipLabel({code:'${G}',type:'8-hour day',facility:'Holzer'})`) === G);

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
})();
