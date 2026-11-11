// CRNA Hub — v124 (Nov 11, 2026): paydates are shift-derived.
// Caleb, verbatim: "if there are no dates with a facility then the
// calendar should not populate paydates moving forward. For
// example, I'm no longer working at CAMC, so the calendar should
// recognize I don't have any dates there and stop populating a pay
// schedule after the last paycheck." (He confirmed the rule as
// summarized back to him with a thumbs-up.)
//
// The rule, pinned here:
//  1 a projected paydate exists ONLY for a pay period holding at
//    least one shift (confirmed OR proposed) claimed by that
//    facility's schedule; the series ends at the check paying for
//    the last shift-bearing period — no perpetual projection.
//  2 a gap period with no shifts gets no paydate, even between
//    two worked periods.
//  3 fully dynamic: delete a period's last shift and its paydate
//    is gone on the next derivation; add a shift in a later
//    period and its paydate appears. Nothing is stored, no flag.
//  4 stub ACTUALS (and entered actuals) always show — real money
//    that landed — even in a period with no recorded shifts.
//  5 a period whose shifts are all unpriced still HAS shifts: its
//    paydate populates, amount null (incomplete), never $0.00.
//  6 Caleb regression: HOLZ Nov 24 $27,075 / Dec 8 $10,625 /
//    Dec 22 $29,975, November headline $39,832.50, December
//    $40,600 — and no Jan 5, 2027 paydate, because the Dec 14-27
//    period holds no HOLZ shifts in this fixture.
// Run: node test-v124-shift-derived-paydates.js
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

const FAC_H = `{ id:'f1', name:'Holzer', aliases:'', address:'100 Jackson Pike, Gallipolis, OH 45631', hourlyRate:'250', paidHours8:'8.5', rate8:'2125', rate10:'2625', rateSecond:'3000', weekendRateSecond:'2000', rate24:'4800', weekendRate24:'4200', hourlyCall1st:'175', callBonus:'' }`;
const FAC_C = `{ id:'f2', name:'CAMC', aliases:'', address:'3200 MacCorkle Ave SE, Charleston, WV 25304', hourlyRate:'250', paidHours8:'', rate8:'2000', rate10:'2500', rateSecond:'', weekendRateSecond:'', rate24:'', weekendRate24:'', hourlyCall1st:'', callBonus:'' }`;
// Both schedules share Caleb's real cadence shape: biweekly,
// anchor period Oct 19 - Nov 1, 2026, paid Nov 10. Periods:
// P0 Oct 19-Nov 1 (Nov 10) · P1 Nov 2-15 (Nov 24) · P2 Nov 16-29
// (Dec 8) · P3 Nov 30-Dec 13 (Dec 22) · P4 Dec 14-27 (Jan 5) ·
// P5 Dec 28-Jan 10 (Jan 19) · P6 Jan 11-24 (Feb 2).
const SCHED_H = `{ id:'ps-h', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'', net:'', source:'import', fileName:'' }`;
const SCHED_C = `{ id:'ps-c', agency:'CAMC', facility:'CAMC', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'', net:'', source:'import', fileName:'' }`;
const S = (id, date, fac, pay, status) => ({ id, date, facility: fac, type: '8-hour day', pay: String(pay), status: status || 'confirmed' });

// ================= World A: gap period + dynamics =================
run(`db = empty(); db.settings.scheduleName = 'Martin';
  db.facilities = [${FAC_H}, ${FAC_C}];
  db.payStubs = [${SCHED_H}, ${SCHED_C}];
  db.shifts = ${JSON.stringify([
    S('a-h1', '2026-11-04', 'Holzer', 2125),                 // HOLZ P1
    S('a-h3', '2026-12-03', 'Holzer', 2125, 'proposed'),     // HOLZ P3 (proposed counts)
    S('a-c1', '2026-11-05', 'CAMC', 2000),                   // CAMC P1
    S('a-c2', '2026-11-18', 'CAMC', 2000),                   // CAMC P2 — CAMC's last
  ])}; persist();`);
const occA = (agency) => run(`paystubOccurrences(paystubSchedules().find(s=>s.agency==='${agency}'), '2026-11-01', '2027-03-31')`);
const holzA = occA('Premier Anesthesia Group, PC');
t('A1 HOLZ paydates only for shift-bearing periods P1+P3 (gap P2 and empty P0/P4+ produce none)',
  JSON.stringify(holzA.map(o => o.date)) === JSON.stringify(['2026-11-24', '2026-12-22']),
  JSON.stringify(holzA.map(o => o.date)));
t('A1 HOLZ amounts are the period shift sums (proposed included)',
  holzA.every(o => o.total === 2125 && o.shiftCount === 1), JSON.stringify(holzA.map(o => [o.date, o.total])));
const camcA = occA('CAMC');
t('A2 CAMC series ends at the check for its last shift-bearing period (Dec 8) — nothing in January or beyond',
  JSON.stringify(camcA.map(o => o.date)) === JSON.stringify(['2026-11-24', '2026-12-08']),
  JSON.stringify(camcA.map(o => o.date)));
t('A2 January 2027 month view holds no CAMC occurrence',
  run(`paystubOccurrencesInMonth('2027-01').filter(o=>o.agency==='CAMC').length`) === 0);
t('A3 CAMC next paydays from Nov 20 are Nov 24 + Dec 8; from Dec 9 there are none',
  JSON.stringify(run(`paystubNextPaydays(paystubSchedules().find(s=>s.agency==='CAMC'), 3, '2026-11-20')`)) === JSON.stringify(['2026-11-24', '2026-12-08']) &&
  JSON.stringify(run(`paystubNextPaydays(paystubSchedules().find(s=>s.agency==='CAMC'), 3, '2026-12-09')`)) === JSON.stringify([]));
t('A4 Upcoming from Dec 9 lists the HOLZ Dec 22 check and no CAMC row',
  (() => { const up = run(`paystubUpcoming(6, '2026-12-09')`); return up.some(o => o.date === '2026-12-22' && o.agency === 'Premier Anesthesia Group, PC') && !up.some(o => o.agency === 'CAMC'); })());

// Dynamics: delete HOLZ's last P3 shift -> Dec 22 paydate gone.
run(`db.shifts = db.shifts.filter(x => x.id !== 'a-h3');`);
t('A5 deleting a period\'s last shift removes its projected paydate on the next derivation',
  JSON.stringify(occA('Premier Anesthesia Group, PC').map(o => o.date)) === JSON.stringify(['2026-11-24']) &&
  run(`paystubOccurrencesInMonth('2026-12').filter(o=>o.agency==='Premier Anesthesia Group, PC').length`) === 0);
// Add a HOLZ shift in P5 (Dec 28 - Jan 10) -> the Jan 19 paydate
// appears; the P4 gap (Dec 14-27, payday Jan 5) stays empty.
run(`db.shifts.push(${JSON.stringify(S('a-h5', '2027-01-06', 'Holzer', 2125))});`);
t('A6 adding a shift in a later period brings its paydate back (Jan 19), gap P4 (Jan 5) still none',
  JSON.stringify(occA('Premier Anesthesia Group, PC').map(o => o.date)) === JSON.stringify(['2026-11-24', '2027-01-19']));
t('A6 January month view for HOLZ is exactly the Jan 19 check',
  JSON.stringify(run(`paystubOccurrencesInMonth('2027-01').filter(o=>o.agency==='Premier Anesthesia Group, PC').map(o=>o.date)`)) === JSON.stringify(['2027-01-19']));
// Unpriced shifts still populate their period's paydate, as
// incomplete (amount null), never a $0.00.
run(`db.shifts.push({id:'a-c9', date:'2027-01-20', facility:'CAMC', type:'5**', code:'5**', pay:'', incomplete:true, status:'confirmed'});`);
const camcA2 = occA('CAMC');
const feb2 = camcA2.find(o => o.date === '2027-02-02') || {};
t('A7 an all-unpriced period still populates its paydate (Feb 2), flagged incomplete with a null amount',
  feb2.shiftCount === 1 && feb2.unpriced === 1 && run(`paystubOccurrenceAmount(paystubOccurrences(paystubSchedules().find(s=>s.agency==='CAMC'), '2027-02-01', '2027-02-28')[0])`) === null,
  JSON.stringify(camcA2.map(o => o.date)));

// ================= World B: actuals are exempt =================
run(`db = empty(); db.settings.scheduleName = 'Martin';
  db.facilities = [${FAC_H}];
  db.payStubs = [{ id:'ps-b', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'5000', net:'', source:'ai-vision', fileName:'stub.jpg' }];
  db.shifts = []; persist();`);
const occB = () => run(`paystubOccurrences(db.payStubs[0], '2026-11-01', '2027-03-31')`);
t('B1 a stub actual shows even with zero recorded shifts anywhere — and only that check',
  JSON.stringify(occB().map(o => o.date)) === JSON.stringify(['2026-11-10']) &&
  occB()[0].isActual === true && occB()[0].actual === 5000 &&
  run(`paystubOccurrenceAmount(paystubOccurrences(db.payStubs[0], '2026-11-01', '2026-11-30')[0])`) === 5000,
  JSON.stringify(occB().map(o => o.date)));
t('B2 reconciliation is untouched: the stubbed period still reconciles with shiftCount 0',
  run(`paystubReconciliations().length`) === 1 && run(`paystubReconciliations()[0].shiftCount`) === 0);
t('B3 the schedules list is honest when nothing is coming: "none coming up" instead of projected cadence dates',
  run(`paystubListHTML()`).includes('none coming up — a pay date appears when a pay period has shifts recorded'));
run(`db.payStubs[0].occOverrides = { '2026-12-08': { actual: '777', payDate: '2026-12-08' } };`);
t('B4 an entered actual on a shiftless period still shows (stored correction = real money), amount $777 only',
  JSON.stringify(occB().map(o => o.date)) === JSON.stringify(['2026-11-10', '2026-12-08']) &&
  (occB().find(o => o.date === '2026-12-08') || {}).actual === 777,
  JSON.stringify(occB().map(o => o.date)));

// ================= World C: Caleb's real HOLZ regression =================
const C = (id, date, type, pay, status) => ({ id, date, facility: 'Holzer', type, pay: String(pay), status: status || 'confirmed' });
const PROP = ['n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11'];
const CS = (id, date, type, pay) => C(id, date, type, pay, PROP.includes(id) ? 'proposed' : 'confirmed');
run(`db = empty(); db.settings.scheduleName = 'Martin';
  db.facilities = [${FAC_H}];
  db.payStubs = [{ id:'pc', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'12757.50', net:'12757.50', source:'ai-vision' }];
  db.shifts = ${JSON.stringify([
    CS('o1', '2026-10-22', 'Second call', 3000),
    CS('o2', '2026-10-26', '8-hour day', 2125), CS('o3', '2026-10-27', '8-hour day', 2125),
    CS('o4', '2026-10-28', '8-hour day', 2125), CS('o5', '2026-10-29', '8-hour day', 2125),
    CS('n1', '2026-11-02', '8-hour day', 2125), CS('n2', '2026-11-03', 'Second call', 3000),
    CS('n3', '2026-11-04', '8-hour day', 2125), CS('n4', '2026-11-05', '8-hour day', 2125),
    CS('n5', '2026-11-06', 'Second call', 3000), CS('n6', '2026-11-07', '24-hour call', 4200),
    CS('n7', '2026-11-08', 'Second call', 2000), CS('n8', '2026-11-10', '8-hour day', 2125),
    CS('n9', '2026-11-11', '8-hour day', 2125), CS('n10', '2026-11-12', '8-hour day', 2125),
    CS('n11', '2026-11-13', '8-hour day', 2125),
    CS('n12', '2026-11-16', '8-hour day', 2125), CS('n13', '2026-11-17', '8-hour day', 2125),
    CS('n14', '2026-11-18', '8-hour day', 2125), CS('n15', '2026-11-19', '8-hour day', 2125),
    CS('n16', '2026-11-20', '8-hour day', 2125), CS('n17', '2026-11-30', '8-hour day', 2125),
    C('d1', '2026-12-01', '8-hour day', 2125), C('d2', '2026-12-03', '8-hour day', 2125),
    C('d3', '2026-12-02', 'Second call', 3000), C('d4', '2026-12-05', 'Second call', 2000),
    C('d5', '2026-12-04', '24-hour call', 4800), C('d6', '2026-12-06', '24-hour call', 4200),
    C('d7', '2026-12-08', '24-hour call', 4800), C('d8', '2026-12-10', '24-hour call', 4800),
  ])}; persist();`);
const occC = run(`paystubOccurrences(db.payStubs[0], '2026-11-01', '2027-03-31')`);
t('C1 Caleb series: Nov 10 actual, Nov 24, Dec 8, Dec 22 — and NO Jan 5, 2027 (Dec 14-27 holds no shifts)',
  JSON.stringify(occC.map(o => o.date)) === JSON.stringify(['2026-11-10', '2026-11-24', '2026-12-08', '2026-12-22']),
  JSON.stringify(occC.map(o => o.date)));
t('C2 amounts unchanged: $12,757.50 actual / $27,075 / $10,625 / $29,975',
  occC[0].isActual === true && occC[0].actual === 12757.50 &&
  occC[1].total === 27075 && occC[2].total === 10625 && occC[3].total === 29975,
  JSON.stringify(occC.map(o => [o.date, o.total, o.actual])));
t('C3 headlines unchanged: November $39,832.50, December $40,600',
  run(`monthHeadline('2026-11').gross`) === 39832.50 && run(`monthHeadline('2026-12').gross`) === 40600,
  run(`monthHeadline('2026-11').gross`) + '/' + run(`monthHeadline('2026-12').gross`));
t('C4 January 2027: no occurrences, headline is the bare worked basis ($0, no paycheck rows)',
  run(`paystubOccurrencesInMonth('2027-01').length`) === 0 &&
  run(`monthHeadline('2027-01').paychecks`) === 0 && run(`monthHeadline('2027-01').gross`) === 0 &&
  run(`paystubUpcoming(6, '2026-12-23').length`) === 0);
t('C5 January 2027 calendar renders no paycheck chip',
  (() => { run(`month = new Date(2027, 0, 1);`); const cal = run(`calendar()`); return !cal.includes('chip paycheck'); })());

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
