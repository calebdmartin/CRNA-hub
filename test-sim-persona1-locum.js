'use strict';
// SIMULATED USER P1 — "Marta Novak", independent locum, TWO hospitals.
// Standing simulated-user pass (approved by Caleb Nov 11, 2026):
// full journeys through the app's REAL code paths, every figure
// hand-computed in the fixture comments below. Run directly or via
// test-sim-run-all.js. See hidden_files/simulated-user-pass.md.
//
// JOURNEY: QGenda-style feed rows arrive for St. Mary Regional ->
// Marta sets the pay rules in her own words (the codes context is
// built from the feed rows exactly the way facilityDescribeCodes
// builds it from saved shifts) -> feed approved -> pay schedule ->
// stub upload lands an actual -> second hospital (Blue Ridge) set
// up in words -> calendar (.ics) import with a multi-day block ->
// hand-added proposed + confirmed shifts -> chips, calendar,
// paycheck and C/P totals checked against hand math throughout.
//
// HAND MATH — St. Mary Regional, $225/hr, paid 8.5h on an 8h shift:
//   SM8  $225 x 8.5 = $1,912.50      SM10 $225 x 10 = $2,250
//   L12 / L12B $225 x 12 = $2,700    C1 weekday $4,000 / weekend $3,500
//   C2 weekday $2,600 / weekend $1,800   PDO $0 (post call day off)
//   Period Mon Mar 1 - Sun Mar 14, 2027 (payday Tue Mar 23):
//     Mar 1 SM8 1912.50 · Mar 2 SM10 2250 · Mar 3 PDO 0 ·
//     Mar 4 C2 (Thu) 2600 · Mar 5 SM8 1912.50 · Mar 6 C1 (Sat) 3500 ·
//     Mar 7 PDO 0 · Mar 8 L12 2700 · Mar 9 L12B 2700 ·
//     Mar 10 SM8 1912.50 · Mar 11 C1 (Thu) 4000 · Mar 12 SM10 2250 ·
//     Mar 13 C2 (Sat) 1800 · Mar 14 SM8 1912.50
//   Period total = 7650 + 4500 + 4400 + 7500 + 5400 = $29,450.
//   The stub that lands says $29,100 (a $350 call-in difference she
//   does not chase) -> Mar 23 shows the ACTUAL, headline $29,100.
// HAND MATH — Blue Ridge, $200/hr: B8 $1,600, B12 $2,400.
//   Block Mon Apr 5 - Fri Apr 9 = 5 x B8 = $8,000; Sat Apr 10 B12
//   $2,400; hand-added proposed Mon Apr 12 B8-type $1,600; confirmed
//   Tue Apr 13 12h $2,400. April headline (worked) = $14,400.
//   2027 C/P at Apr 1: C = 29,450 + 12,800 = $42,250;
//   P = C + the one proposed $1,600 = $43,850.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) { return { id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [], dataset: {}, style: {}, _listeners: {}, _entries: null, addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }, append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [] }; }
const elements = {}; const getEl = (id) => elements[id] || (elements[id] = el(id));
class FakeFormData { constructor(f) { this._map = (f && f._map) || {}; this._e = (f && f._entries) || []; } get(k) { return k in this._map ? this._map[k] : null; } *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; } }
const sandbox = { console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math, crypto: require('crypto').webcrypto, FormData: FakeFormData, localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }, document: { getElementById: (id) => getEl(id), querySelectorAll: () => [], createElement: () => el(), body: { append() {} }, addEventListener() {} }, window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' }, alert: () => {}, confirm: () => true, fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }), history: { replaceState() {} } };
sandbox.window = sandbox; sandbox.window.scrollTo = () => {};
if (typeof sandbox.URL.createObjectURL !== 'function') Object.assign(sandbox.URL, { createObjectURL: () => 'data:,', revokeObjectURL: () => {} });
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra)); if (!cond) { fails++; process.exitCode = 1; } };
const J = (v) => JSON.stringify(v);
const BLANK_CARD = { address: '', hourlyRate: '', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', rateSecond: '', hourlyCall1st: '', callBonus: '', weekendRate24: '', weekendRateSecond: '', distance: '', notes: '' };

/* ================= St. Mary Regional: the feed arrives ========= */
const FEED = [
  ['2027-03-01', 'SM8', '8-hour day', ''], ['2027-03-02', 'SM10', '10-hour shift', ''],
  ['2027-03-03', 'PDO', '8-hour day', '2250'], ['2027-03-04', 'C2', 'Second call', ''],
  ['2027-03-05', 'SM8', '8-hour day', ''], ['2027-03-06', 'C1', '24-hour call', ''],
  ['2027-03-07', 'PDO', '8-hour day', '2250'], ['2027-03-08', 'L12', '12-hour shift', ''],
  ['2027-03-09', 'L12B', '12-hour shift', ''], ['2027-03-10', 'SM8', '8-hour day', ''],
  ['2027-03-11', 'C1', '24-hour call', ''], ['2027-03-12', 'SM10', '10-hour shift', ''],
  ['2027-03-13', 'C2', 'Second call', ''], ['2027-03-14', 'SM8', '8-hour day', ''],
].map(([date, code, type, pay]) => ({ date, facility: 'St. Mary Regional', type, code, pay, name: 'Novak', matchedName: 'Novak', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed' }));

run(`
  db = empty(); db.settings.scheduleName = 'Novak'; db.settings.employmentType = '1099';
  db.facilities = [{ id:'sma', name:'St. Mary Regional', aliases:'St. Mary Regional, SMA', ${J(BLANK_CARD).slice(1, -1)} }];
  db.shifts = []; db.payStubs = []; persist();
`);
// The words-box code context for a feed facility: one entry per
// distinct code the feed carried, typed by the feed's own row type
// — the same shape facilityDescribeCodes builds from saved shifts.
run(`__codesFromRows = (rows) => { const seen = new Map(); for (const r of rows) { if (!seen.has(r.code)) seen.set(r.code, { code: r.code, ctype: canonicalTypeOf(r.type), hours: '' }); } return [...seen.values()]; };`);

const SMA_WORDS = [
  'Day shifts pay $225/hr',
  "I'm paid for 8.5 hours on an 8-hour shift",
  'SM8 = an 8-hour shift',
  'SM10 is a 10-hour shift',
  'C1 = 24-hour call. 1st call pays $4,000 on weekdays and $3,500 on weekends',
  'C2 is second call, $2,600 on weekdays and $1,800 on weekends',
  'PDO = post call day off — no pay',
  'L12 = a 12-hour shift',
  'L12B is the same as L12',
  'Weekends are Saturday and Sunday only',
].join('\n');
const parsed = run(`describeParseLocal(${J(SMA_WORDS)}, db.facilities[0], __codesFromRows(${J(FEED)}))`);
t('P1 words: every rule resolves — nothing unanswered, no follow-up question',
  parsed.unanswered.length === 0 && !parsed.question, J(parsed.unanswered));
const summary = run(`describeSummaryText('St. Mary Regional', ${J(parsed)}, db.facilities[0])`);
t('P1 words: read-back states the whole card (paid hours, call splits, no-pay, same-as, weekend)',
  summary.includes('$225/hr × 8.5 paid hours = $1,912.5') && summary.includes('$4,000 on weekdays, $3,500 on weekends') &&
  summary.includes('$2,600 on weekdays, $1,800 on weekends') && summary.includes('no pay — post call day off') &&
  summary.includes('Weekend means Saturday and Sunday'), summary);
run(`applyDescribedRules(db.facilities[0], describeParseLocal(${J(SMA_WORDS)}, db.facilities[0], __codesFromRows(${J(FEED)}))); persist();`);
t('P1 card: rates saved (hourly 225, paidHours8 8.5, call splits, stated Sat/Sun weekend)',
  run(`db.facilities[0].hourlyRate`) === '225' && run(`db.facilities[0].paidHours8`) === '8.5' &&
  run(`db.facilities[0].rate24`) === '4000' && run(`db.facilities[0].weekendRate24`) === '3500' &&
  run(`db.facilities[0].rateSecond`) === '2600' && run(`db.facilities[0].weekendRateSecond`) === '1800' &&
  J(run(`db.facilities[0].weekendDays`)) === '[0,6]' && run(`db.facilities[0].weekendDaysSource`) === 'stated');
t('P1 card: PDO saved as an UNPAID definition', run(`db.facilities[0].codeMap['PDO'].unpaid`) === true);

/* ================= Feed approved ================================ */
run(`schedulePreview = { fileName:'qgenda', matchedName:'Novak', source:'qgenda-feed', rows: ${J(FEED)} }; approveScheduleImport();`);
const EXPECTED_PAYS = { '2027-03-01': '1912.5', '2027-03-02': '2250', '2027-03-03': '0', '2027-03-04': '2600', '2027-03-05': '1912.5', '2027-03-06': '3500', '2027-03-07': '0', '2027-03-08': '2700', '2027-03-09': '2700', '2027-03-10': '1912.5', '2027-03-11': '4000', '2027-03-12': '2250', '2027-03-13': '1800', '2027-03-14': '1912.5' };
t('P1 feed: 14 shifts land, each at the hand-computed pay',
  run(`db.shifts.length`) === 14 && run(`db.shifts.every(x => String(x.pay) === ${J(EXPECTED_PAYS)}[x.date] && x.status === 'confirmed')`) === true,
  run(`db.shifts.map(x => x.date + '=' + x.pay).join(' ')`));
t('P1 feed: the unpaid code prices $0 settled FROM THE IMPORT (feed guessed $2,250 — the code wins)',
  run(`db.shifts.filter(x => x.code === 'PDO').every(x => x.pay === '0' && x.payUnit === 'unpaid' && x.incomplete === false && x.type === 'post call day off')`) === true,
  J(run(`db.shifts.filter(x => x.code === 'PDO')`)));
t('P1 feed: stored period sum is the hand total $29,450',
  run(`db.shifts.reduce((a, x) => a + num(x.pay), 0)`) === 29450);

/* ================= Pay schedule, then the stub lands ============ */
run(`db.payStubs = [{ id:'sma-sched', agency:'NorthStar Anesthesia Partners', facility:'St. Mary Regional', frequency:'biweekly', periodStart:'2027-03-01', periodEnd:'2027-03-14', payDate:'2027-03-23', gross:'', net:'', source:'manual' }]; persist();`);
const occBefore = run(`paystubOccurrences(db.payStubs[0], '2027-03-01', '2027-03-31').find(o => o.date === '2027-03-23')`);
t('P1 paycheck: Mar 23 estimate is the calculated $29,450 (14 shifts)',
  !!occBefore && occBefore.total === 29450 && occBefore.isActual === false && occBefore.shiftCount === 14, J(occBefore));
run(`paystubPreview = { id:'', agency:'NorthStar Anesthesia Partners', facility:'St. Mary Regional', frequency:'biweekly', payDate:'2027-03-23', periodStart:'2027-03-01', periodEnd:'2027-03-14', gross:'29100', net:'', source:'ai-vision', fileName:'stub.jpg' }; approvePaystub();`);
const occAfter = run(`paystubOccurrences(db.payStubs[0], '2027-03-01', '2027-03-31').find(o => o.date === '2027-03-23')`);
t('P1 stub: the uploaded stub lands as the ACTUAL $29,100 on the same schedule (one record, not two)',
  run(`db.payStubs.length`) === 1 && !!occAfter && occAfter.isActual === true && occAfter.actual === 29100, J(occAfter));
t('P1 headline: March shows the stub actual only — the $29,450 estimate is suppressed, never added',
  run(`monthHeadline('2027-03').gross`) === 29100 && run(`monthHeadline('2027-03').anyActual`) === true,
  J(run(`monthHeadline('2027-03')`)));

/* ================= Blue Ridge: words, calendar block, hands ==== */
run(`db.facilities.push({ id:'brsc', name:'Blue Ridge', aliases:'Blue Ridge, BRSC', ${J(BLANK_CARD).slice(1, -1)} }); persist();`);
const BR_WORDS = ['Day shifts pay $200/hr', 'B8 = an 8-hour shift', 'B12 is a 12-hour shift'].join('\n');
const BR_CODES = [{ code: 'B8', ctype: '8-hour day', hours: 8 }, { code: 'B12', ctype: '12-hour shift', hours: 12 }];
run(`applyDescribedRules(db.facilities[1], describeParseLocal(${J(BR_WORDS)}, db.facilities[1], ${J(BR_CODES)})); persist();`);
const ev = (uid, s, ds, de) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${s}\r\nDTSTART${ds}\r\nDTEND${de}\r\nEND:VEVENT\r\n`;
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
  ev('br1', 'Blue Ridge B8', ':20270405T070000Z', ':20270409T080000Z') +
  ev('br2', 'Blue Ridge B12', ':20270410T070000Z', ':20270410T190000Z') +
  'END:VCALENDAR';
run(`(() => { const parsed = parseICS(${J(ICS)}, 'cal.ics');
  const rows = parsed.rows.map((r) => ({ ...r, source:'calendar-file', sourceLabel:'Calendar file', include:true, duplicate:false, incomplete: !String(r.pay || '').trim(), note:'Imported from Calendar file (.ics): cal.ics' }));
  calPreview = { fileName:'cal.ics', sourceLabel:'Calendar file', sourceCode:'calendar-file', rows }; })();
  approveCalendarImport();`);
t('P1 calendar: the timed multi-day B8 block expands to 5 day shifts ($1,600 each) + the B12 single ($2,400)',
  run(`db.shifts.filter(x => x.facility === 'Blue Ridge').length`) === 6 &&
  run(`db.shifts.filter(x => x.facility === 'Blue Ridge').reduce((a, x) => a + num(x.pay), 0)`) === 10400 &&
  run(`db.shifts.filter(x => x.code === 'B8').every(x => String(x.pay) === '1600')`) === true,
  run(`db.shifts.filter(x => x.facility === 'Blue Ridge').map(x => x.date + '=' + x.pay).join(' ')`));

// Hand adds through the real form submit (v137 close-and-return).
run(`__submitShift = (map) => { const form = { dataset: { kind: 'shifts' }, _map: map }; submitEntry({ preventDefault(){}, currentTarget: form }); };`);
run(`month = new Date(2027, 0, 1); selected = '2027-01-04'; dayViewOpen = false; showShiftForm = false; editId = null; flashDay = ''; tab = 'Dashboard'; persist(); actions('add-shift');`);
t('P1 add: standalone origin recorded', run(`shiftFormOrigin`) === 'standalone');
run(`__submitShift({ date:'2027-04-12', facility:'Blue Ridge', type:'8-hour day', status:'proposed', pay:'', note:'' });`);
t('P1 add: proposed shift saves priced from the card ($1,600)',
  run(`db.shifts.find(x => x.date === '2027-04-12').pay`) === '1600' && run(`db.shifts.find(x => x.date === '2027-04-12').status`) === 'proposed');
t('P1 add: form CLOSES and the calendar lands on the added day (close-and-return)',
  run(`showShiftForm`) === false && run(`selected`) === '2027-04-12' && run(`flashDay`) === '2027-04-12' &&
  run(`month.getFullYear()`) === 2027 && run(`month.getMonth()`) === 3 && run(`dayViewOpen`) === false);
t('P1 chip: hand-added proposed chip names the facility + short type',
  run(`shiftChipLabel(db.shifts.find(x => x.date === '2027-04-12'))`) === 'Blue Ridge 8hr',
  run(`shiftChipLabel(db.shifts.find(x => x.date === '2027-04-12'))`));
run(`actions('add-shift'); __submitShift({ date:'2027-04-13', facility:'Blue Ridge', type:'12-hour shift', status:'confirmed', pay:'', note:'' });`);
const grid = run(`calendar()`);
t('P1 grid: the proposed chip renders AMBER (proposed class); the confirmed hand-add does not',
  /<span class="chip[^"]*proposed[^"]*">Blue Ridge 8hr<\/span>/.test(grid) &&
  (() => { const m = grid.match(/<span class="chip([^"]*)">Blue Ridge 12hr<\/span>/); return !!m && !/proposed/.test(m[1]); })());

/* ================= Whole-picture totals ========================= */
t('P1 headline: April is the worked month — $14,400 incl. the proposed shift',
  run(`monthHeadline('2027-04').gross`) === 14400, J(run(`monthHeadline('2027-04')`)));
const split = run(`yearIncomeSplit(2027, '2027-04-01')`);
t('P1 C/P: C predicted $42,250 (29,450 + 12,800), P adds the proposed $1,600 = $43,850',
  split.c.predicted === 42250 && split.p.predicted === 43850 && split.byStatus.proposed === 1 && split.byStatus.confirmed === 21,
  J({ c: split.c.predicted, p: split.p.predicted, by: split.byStatus }));
t('P1 C/P: nothing unpriced, nothing W-2 in a pure 1099 locum year',
  split.unpriced === 0 && split.w2Salary === 0);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
