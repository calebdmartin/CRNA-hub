// CRNA Hub — tests for pay-stub upload: one pay schedule per agency
// (Nov 5, 2026; paycheck engine rebuilt Nov 6, 2026 on Caleb's rule).
// Run: node test-paystub.js
//
// The model under test (Caleb, Nov 6, 2026):
//   * A pay stub is a CALENDAR OF PAYDAYS ONLY: it contributes the pay
//     frequency, the pay-period pattern, and the lag from period end
//     to payday. Its gross/net is NEVER projected forward — a stub
//     showing $12,757.50 must not make every future check $12,757.50.
//   * Each paycheck is CALCULATED from the user's actual shifts inside
//     that pay period (calendar / QGenda / schedule uploads), priced by
//     the same engine as the C/P totals. The paycheck is the period's
//     WHOLE shift sum — confirmed and proposed alike (status is a
//     forecast split, not a pay split; regression-locked below against
//     Caleb's real November 2026: Nov 24 = $27,075, not the $9,375
//     confirmed-only slice the app once showed). The proposed share is
//     noted under the headline; unpriced shifts flag the estimate
//     incomplete, never $0.
//   * No fake net: paycheck displays show calculated gross only.
//   * RECONCILIATION: the stub's own check is the ACTUAL for its
//     period. In the Dashboard YTD figures, a stubbed (fully ended)
//     period contributes its actual INSTEAD of its shift sum — never
//     both. The actual builds no forward rule: later periods stay
//     pure shift calculations. A stub for a period with no recorded
//     shifts still records its actual for that period.
//   * ONE HEADLINE PER MONTH (Caleb, Nov 7, 2026): the calendar banner,
//     the Dashboard card, and the assistant all use monthHeadline() —
//     with a pay schedule, the headline is the PAYCHECK basis (what
//     lands in the month: Nov 2026 = $39,832.50), NOT the worked sum
//     ($39,825); unscheduled work adds its worked sum once; no schedule
//     at all keeps the worked basis.
// Covers, without any live API call (fetch is stubbed; no network):
//   * Frequency normalisation (weekly / biweekly / semi-monthly /
//     monthly, incl. "every 2 weeks" / "twice a month"); unknown -> ''.
//   * Schedule math: weekly, biweekly, monthly (31st clamps to the
//     30th/28th), semi-monthly anchored on the stub's own pay date.
//   * Period derivation: anchor period + exact lag preserved for later
//     paydays (Premier: period Oct 19 – Nov 1 -> paid Nov 10; the next
//     period is Nov 2 – Nov 15 -> paid Nov 24).
//   * Deterministic text parsing (pasted text / text-layer PDF).
//   * Preview-before-save: approve saves one schedule per agency with
//     NO amount required; re-upload replaces only that agency.
//   * Two agencies paying on the same date stay two separate entries.
//   * Estimated paychecks are NOT added into the raw C/P totals.
//   * Edit/delete, manual entry validation, onboarding, persistence.
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
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');

// ---------- Frequency normalisation ----------
t('normalizePayFrequency: weekly/biweekly/monthly pass through; variants coerce',
  run(`normalizePayFrequency('weekly')`) === 'weekly' &&
  run(`normalizePayFrequency('every 2 weeks')`) === 'biweekly' &&
  run(`normalizePayFrequency('Bi-Weekly')`) === 'biweekly' &&
  run(`normalizePayFrequency('twice a month')`) === 'semi-monthly' &&
  run(`normalizePayFrequency('semimonthly')`) === 'semi-monthly' &&
  run(`normalizePayFrequency('monthly')`) === 'monthly');
t('normalizePayFrequency: unknown/blank -> empty, never guessed',
  run(`normalizePayFrequency('whenever')`) === '' &&
  run(`normalizePayFrequency('')`) === '' &&
  run(`normalizePayFrequency(undefined)`) === '');

// ---------- Schedule math ("today" 2026-11-05) ----------
run(`
  db.payStubs = [
    {id:'p1', agency:'Premier Anesthesia Group', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-10-23', gross:'3200', net:'2400', source:'ai-vision'},
    {id:'p2', agency:'Holzer Locums', facility:'Holzer', frequency:'weekly', periodStart:'', periodEnd:'', payDate:'2026-11-06', gross:'2125', net:'1800', source:'manual'},
    {id:'p3', agency:'Monthly Agency', facility:'', frequency:'monthly', periodStart:'', periodEnd:'', payDate:'2026-10-31', gross:'9000', net:'6500', source:'manual'},
    {id:'p4', agency:'Semi Monthly Co', facility:'', frequency:'semi-monthly', periodStart:'', periodEnd:'', payDate:'2026-11-07', gross:'4000', net:'3000', source:'manual'}
  ];
  db.shifts = [];
  globalThis.__next1 = paystubNextPayDate(db.payStubs[0], '2026-11-05');
  globalThis.__next2 = paystubNextPayDate(db.payStubs[1], '2026-11-05');
  globalThis.__next3 = paystubNextPayDate(db.payStubs[2], '2026-11-05');
  globalThis.__next4 = paystubNextPayDate(db.payStubs[3], '2026-11-05');
  globalThis.__occNov = paystubOccurrencesInMonth('2026-11');
  globalThis.__up = paystubUpcoming(6, '2026-11-05');
`);
t('biweekly next pay date advances past today: 10/23 -> 11/06',
  sandbox.__next1 === '2026-11-06');
t('weekly next pay date is the stub pay date when it is still ahead',
  sandbox.__next2 === '2026-11-06');
t('monthly 31st clamps to the 30th: 10/31 -> 11/30',
  sandbox.__next3 === '2026-11-30' &&
  run(`paystubStepDate('2026-11-30','monthly',31)`) === '2026-12-31');
t('semi-monthly anchors on the stub pay date: 11/07 -> 11/07, then 11/22',
  sandbox.__next4 === '2026-11-07' &&
  run(`paystubStepDate('2026-11-07','semi-monthly',7)`) === '2026-11-22' &&
  run(`paystubStepDate('2026-11-22','semi-monthly',7)`) === '2026-12-07');
t('semi-monthly anchor in the second half: 20th -> 5th + 20th',
  run(`paystubStepDate('2026-10-20','semi-monthly',20)`) === '2026-11-05' &&
  run(`paystubStepDate('2026-11-05','semi-monthly',20)`) === '2026-11-20');
t('pay date of today IS the next payday',
  run(`paystubNextPayDate({payDate:'2026-11-05', frequency:'weekly'}, '2026-11-05')`) === '2026-11-05');
t('two agencies paying on the same date stay separate (Nov 6 and Nov 20 have both)',
  sandbox.__occNov.filter((x) => x.date === '2026-11-06').length === 2 &&
  sandbox.__occNov.filter((x) => x.date === '2026-11-06').map((x) => x.agency).sort().join('|') === 'Holzer Locums|Premier Anesthesia Group' &&
  sandbox.__occNov.filter((x) => x.date === '2026-11-20').length === 2);
t('upcoming list is date-ordered across agencies and keeps each agency label',
  sandbox.__up.length >= 4 &&
  sandbox.__up[0].date === '2026-11-06' &&
  sandbox.__up.every((x) => x.agency) &&
  new Set(sandbox.__up.map((x) => x.agency)).size > 1);
t('occurrences carry no net figure at all (no fake net == gross)',
  sandbox.__occNov.every((x) => !('net' in x)) &&
  sandbox.__up.every((x) => !('net' in x)));

// ---------- Deterministic text parsing ----------
run(`
  globalThis.__stubText = [
    'Employer: Premier Anesthesia Group',
    'Pay Period: 10/19/2026 - 11/01/2026',
    'Pay Date: 11/06/2026',
    'Gross Pay: $3,200.00',
    'Net Pay: $2,400.00'
  ].join('\\n');
  globalThis.__parsed = parsePaystubText(globalThis.__stubText);
`);
const parsed = sandbox.__parsed;
t('parsePaystubText: agency, period, pay date, gross/net read from labelled lines',
  parsed.agency === 'Premier Anesthesia Group' &&
  parsed.periodStart === '2026-10-19' && parsed.periodEnd === '2026-11-01' &&
  parsed.payDate === '2026-11-06' && parsed.gross === 3200 && parsed.net === 2400);
t('parsePaystubText: 14-day period infers biweekly',
  parsed.frequency === 'biweekly');
t('paystubFrequencyFromPeriod: 7 weekly, 15 semi-monthly, 30 monthly, other blank',
  run(`paystubFrequencyFromPeriod('2026-11-01','2026-11-07')`) === 'weekly' &&
  run(`paystubFrequencyFromPeriod('2026-11-01','2026-11-15')`) === 'semi-monthly' &&
  run(`paystubFrequencyFromPeriod('2026-11-01','2026-11-30')`) === 'monthly' &&
  run(`paystubFrequencyFromPeriod('2026-11-01','2026-11-10')`) === '');
t('parsePaystubText: unstated fields stay blank, never invented',
  run(`parsePaystubText('Pay Date: 11/06/2026\\nNet Pay: $100.00').agency`) === '' &&
  run(`parsePaystubText('Pay Date: 11/06/2026\\nNet Pay: $100.00').gross`) === null);

// ---------- Preview-before-save: approve, replace, delete ----------
run(`
  db.payStubs = [];
  paystubPreview = paystubPreviewFromParsed(parsePaystubText(globalThis.__stubText), 'stub.pdf', 'test', false);
  globalThis.__previewAgency = paystubPreview.agency;
  globalThis.__previewNext = paystubNextDatesText(paystubPreview);
  approvePaystub();
  globalThis.__savedCount = db.payStubs.length;
  globalThis.__savedAgency = db.payStubs[0] && db.payStubs[0].agency;
  globalThis.__savedGross = db.payStubs[0] && db.payStubs[0].gross;
`);
const saveAlert = alerts[alerts.length - 1] || '';
t('preview holds the parsed agency and shows next pay dates before anything saves',
  sandbox.__previewAgency === 'Premier Anesthesia Group' &&
  sandbox.__previewNext.includes('Next expected pay dates'));
t('approve saves one schedule per agency (stub photo itself is not stored)',
  sandbox.__savedCount === 1 && sandbox.__savedAgency === 'Premier Anesthesia Group' &&
  sandbox.__savedGross === '3200' &&
  run(`!db.payStubs[0].imageFileName && !db.payStubs[0].imageData && !db.payStubs[0].rawText`) === true &&
  appSrc.includes("never stored"));
t('save confirmation no longer promises a fixed amount per check',
  !/per check/.test(saveAlert) &&
  saveAlert.includes('calculated from your shifts'));
run(`
  // A stub with NO amount at all now saves fine — paychecks come from shifts.
  paystubPreview = paystubPreviewFromParsed({agency:'No Amount Agency', facility:'', frequency:'weekly', periodStart:'', periodEnd:'', payDate:'2026-11-06', gross:'', net:''}, 'stub3.pdf', 'test', false);
  approvePaystub();
  globalThis.__noAmountSaved = db.payStubs.some((x) => x.agency === 'No Amount Agency');
  db.payStubs = db.payStubs.filter((x) => x.agency !== 'No Amount Agency');
`);
t('approve saves a schedule with no amount on the stub (amounts come from shifts)',
  sandbox.__noAmountSaved === true);
run(`
  // Second agency, then a re-upload for the first agency with a new stub.
  db.payStubs.push({id:'px', agency:'Second Agency', facility:'', frequency:'weekly', periodStart:'', periodEnd:'', payDate:'2026-11-06', gross:'1000', net:'800', source:'manual'});
  paystubPreview = paystubPreviewFromParsed({agency:'Premier Anesthesia Group', facility:'Holzer', frequency:'biweekly', periodStart:'2026-11-02', periodEnd:'2026-11-15', payDate:'2026-11-20', gross:3600, net:2700}, 'stub2.pdf', 'test', false);
  approvePaystub();
  globalThis.__afterReplace = db.payStubs.length;
  globalThis.__premierGross = (db.payStubs.find((x) => x.agency === 'Premier Anesthesia Group') || {}).gross;
  globalThis.__secondGross = (db.payStubs.find((x) => x.agency === 'Second Agency') || {}).gross;
`);
t('re-upload for the same agency replaces only that agency (record updated, count unchanged, other agency untouched)',
  sandbox.__afterReplace === 2 &&
  sandbox.__premierGross === '3600' &&
  sandbox.__secondGross === '1000');
run(`
  const secondId = db.payStubs.find((x) => x.agency === 'Second Agency').id;
  actions('delete-paystub', secondId);
  globalThis.__afterDelete = db.payStubs.length;
  globalThis.__remaining = db.payStubs.map((x) => x.agency).join('|');
`);
t('delete removes only that agency\'s schedule',
  sandbox.__afterDelete === 1 && sandbox.__remaining === 'Premier Anesthesia Group');

// ---------- Calendar + dashboard visibility, estimates only ----------
run(`
  db.payStubs = [
    {id:'p1', agency:'Premier Anesthesia Group', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-10-23', gross:'3200', net:'2400', source:'ai-vision'},
    {id:'p2', agency:'Holzer Locums', facility:'Holzer', frequency:'weekly', periodStart:'', periodEnd:'', payDate:'2026-11-06', gross:'2125', net:'1800', source:'manual'}
  ];
  db.shifts = [{id:'s1', date:'2026-11-10', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'}];
  month = new Date(2026, 10, 1);
  globalThis.__cal = calendar();
  globalThis.__dash = dashboard();
  globalThis.__split = yearIncomeSplit(2026, '2026-11-05');
  globalThis.__reconciled = reconciledYearSplit(2026, '2026-11-05');
`);
t('calendar shows paycheck chips labelled by agency, amounts calculated from shifts',
  sandbox.__cal.includes('chip paycheck') &&
  sandbox.__cal.includes('Premier Anesthesia Group') &&
  sandbox.__cal.includes('Holzer Locums') &&
  sandbox.__cal.includes('est. $2,125'));
t('calendar carries the paystub disclaimer on paychecks',
  sandbox.__cal.includes('calculated from your shifts for each pay period'));
t('dashboard upcoming-paychecks panel lists both agencies',
  sandbox.__dash.includes('Upcoming paychecks · next') &&
  sandbox.__dash.includes('Premier Anesthesia Group') &&
  sandbox.__dash.includes('Holzer Locums'));
t('estimated paychecks are NOT added into the raw C/P shift-income totals',
  sandbox.__split.c.predicted === 2125 && sandbox.__split.p.predicted === 2125);
t('reconciliation: a stubbed period with NO recorded shifts still lands its actual in YTD (income the calendar missed)',
  // p1's period Oct 19 - Nov 1 holds no shifts (the only shift sits in
  // p2's Nov 7 - 13 window), so its $3,200 actual is added on its own;
  // p2's own period ends Nov 6 > Nov 5, so it is not reconciled yet.
  sandbox.__reconciled.c.ytd === 3200 &&
  sandbox.__reconciled.c.predicted === 2125 + 3200 &&
  sandbox.__reconciled.stubActuals.length === 1 &&
  sandbox.__reconciled.stubActuals[0].shiftCount === 0);

// ---------- Caleb's REAL November 2026 fixture (regression, Nov 6) ----------
// His actual calendar + his actual Premier stub, replacing the earlier
// synthetic fixture. The bug this locks down: the app showed the Nov 24
// check as $9,375 while his forecast (and the period's true shift sum)
// was $27,075. His Nov 6-13 shifts were still stored as "proposed"
// (synced before the two-status model made sourced shifts confirmed),
// and the paycheck displayed only the confirmed slice. A paycheck is
// the whole period's pay — status is a forecast split, not a pay
// split — so the occurrence amount is the period total, identical
// under either status assignment. Verified by hand:
//   Nov 2-15 period: seven 8-hour days x $2,125 = $14,875 + second
//   calls Nov 3 $3,000, Nov 6 $3,000, Nov 8 $2,000 = $8,000 + Nov 7
//   24-hour call $4,200 = $27,075 (11 shifts).
//   Nov 16-29 period: five 8-hour days Nov 16-20 = $10,625.
//   Oct 19 - Nov 1 period: Oct 22 second call $3,000 + four 8-hour
//   days Oct 26-29 x $2,125 = $11,500 (his prediction; the stub's
//   $12,757.50 is the actual). November month total: $39,825.
run(`
  db.facilities = [{id:'f1', name:'Holzer'}];
  db.payStubs = [
    {id:'pc', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'12757.50', net:'12757.50', source:'ai-vision'}
  ];
  const D = (id, date, type, pay, status) => ({id, date, facility:'Holzer', type, pay:String(pay), status:status || 'confirmed'});
  const PROP = ['n5','n6','n7','n8','n9','n10','n11']; // Nov 6-13 as stored on Caleb's phone
  const S = (id, date, type, pay) => D(id, date, type, pay, PROP.includes(id) ? 'proposed' : 'confirmed');
  db.shifts = [
    S('o1','2026-10-22','Second call',3000),
    S('o2','2026-10-26','8-hour day',2125), S('o3','2026-10-27','8-hour day',2125),
    S('o4','2026-10-28','8-hour day',2125), S('o5','2026-10-29','8-hour day',2125),
    S('n1','2026-11-02','8-hour day',2125), S('n2','2026-11-03','Second call',3000),
    S('n3','2026-11-04','8-hour day',2125), S('n4','2026-11-05','8-hour day',2125),
    S('n5','2026-11-06','Second call',3000), S('n6','2026-11-07','24-hour call',4200),
    S('n7','2026-11-08','Second call',2000), S('n8','2026-11-10','8-hour day',2125),
    S('n9','2026-11-11','8-hour day',2125), S('n10','2026-11-12','8-hour day',2125),
    S('n11','2026-11-13','8-hour day',2125),
    S('n12','2026-11-16','8-hour day',2125), S('n13','2026-11-17','8-hour day',2125),
    S('n14','2026-11-18','8-hour day',2125), S('n15','2026-11-19','8-hour day',2125),
    S('n16','2026-11-20','8-hour day',2125), S('n17','2026-11-30','8-hour day',2125)
  ];
  globalThis.__pcOcc = paystubOccurrences(db.payStubs[0], '2026-11-01', '2026-12-31');
  globalThis.__pcRec = paystubReconciliations();
  globalThis.__pcRaw = yearIncomeSplit(2026, '2026-11-06');
  globalThis.__pcRecon = reconciledYearSplit(2026, '2026-11-06');
  globalThis.__pcCSP = incomeCSPHTML(2026, reconciledYearSplit(2026, '2026-11-06'));
  globalThis.__pcUpHTML = paystubUpcomingHTML();
  globalThis.__pcHeadNov = monthHeadline('2026-11');
  globalThis.__pcHeadDec = monthHeadline('2026-12');
  globalThis.__decOccSum = paystubOccurrencesInMonth('2026-12').reduce((s, o) => { const a = paystubOccurrenceAmount(o); return a == null ? s : s + a; }, 0);
  month = new Date(2026, 11, 1);
  globalThis.__pcCalDec = calendar();
  month = new Date(2026, 10, 1);
  globalThis.__pcCal = calendar();
  globalThis.__pcClaims = (() => { const c = paystubShiftClaims(); const seen = new Set(); let dup = false;
    for (const o of globalThis.__pcOcc) { for (const x of db.shifts) { if (c.get(x.id) === 'pc' && x.date >= o.periodStart && x.date <= o.periodEnd) { if (seen.has(x.id + '@' + o.date)) dup = true; seen.add(x.id + '@' + o.date); } } }
    return { dup, claimed: new Set([...c.entries()].filter(([, v]) => v === 'pc').map(([k]) => k)) }; })();
`);
const occ = Object.fromEntries(sandbox.__pcOcc.map((x) => [x.date, x]));
t('period derivation: Nov 10 covers Oct 19 - Nov 1; Nov 24 covers Nov 2 - Nov 15 (9-day lag preserved); Dec 8 covers Nov 16 - Nov 29',
  occ['2026-11-10'] && occ['2026-11-10'].periodStart === '2026-10-19' && occ['2026-11-10'].periodEnd === '2026-11-01' &&
  occ['2026-11-24'] && occ['2026-11-24'].periodStart === '2026-11-02' && occ['2026-11-24'].periodEnd === '2026-11-15' &&
  occ['2026-12-08'] && occ['2026-12-08'].periodStart === '2026-11-16' && occ['2026-12-08'].periodEnd === '2026-11-29');
t('the stub\'s own check (Nov 10) is the ACTUAL $12,757.50, not an estimate — and its shifts summed to $11,500',
  occ['2026-11-10'].isActual === true && occ['2026-11-10'].actual === 12757.50 &&
  occ['2026-11-10'].total === 11500 && occ['2026-11-10'].shiftCount === 5 &&
  run(`paystubOccurrenceAmount(globalThis.__pcOcc.find((x) => x.date === '2026-11-10'))`) === 12757.50);
t('REGRESSION: Nov 24 occurrence is $27,075 — the whole Nov 2 - Nov 15 period (11 shifts), even with Nov 6-13 stored as proposed',
  occ['2026-11-24'].isActual === false &&
  occ['2026-11-24'].total === 27075 && occ['2026-11-24'].grossWithProposed === 27075 &&
  occ['2026-11-24'].gross === 9375 && // the confirmed slice that used to be (wrongly) displayed
  run(`paystubOccurrenceAmount(globalThis.__pcOcc.find((x) => x.date === '2026-11-24'))`) === 27075 &&
  occ['2026-11-24'].shiftCount === 11 && occ['2026-11-24'].unpriced === 0);
t('Dec 8 occurrence is $10,625 — five 8-hour days Nov 16-20; Nov 21-29 hold no shifts',
  occ['2026-12-08'].total === 10625 && occ['2026-12-08'].shiftCount === 5 &&
  run(`paystubOccurrenceAmount(globalThis.__pcOcc.find((x) => x.date === '2026-12-08'))`) === 10625);
t('the paycheck is status-blind: the same data with every shift confirmed yields the identical $27,075',
  run(`db.shifts.forEach((x) => x.status = 'confirmed'); globalThis.__allConf = paystubOccurrences(db.payStubs[0], '2026-11-01', '2026-12-31'); db.shifts.forEach((x) => { if (['n5','n6','n7','n8','n9','n10','n11'].includes(x.id)) x.status = 'proposed'; }); globalThis.__allConf.find((x) => x.date === '2026-11-24').total`) === 27075);
t('no double-claiming: every shift is claimed by exactly one stub and lands in exactly one occurrence window',
  sandbox.__pcClaims.dup === false && sandbox.__pcClaims.claimed.size === 22);
t('November calendar: banner carries the ONE headline — $39,832.50 paycheck basis; the worked $39,825 appears nowhere; chips unchanged',
  sandbox.__pcCal.includes('month-banner') && sandbox.__pcCal.includes('November 2026') &&
  sandbox.__pcCal.includes('Expected gross <strong>$39,832.50</strong>') &&
  sandbox.__pcCal.includes('incl. actual from pay stub') &&
  !sandbox.__pcCal.includes('$39,825') &&
  sandbox.__pcCal.includes('17 shifts') && sandbox.__pcCal.includes('Tap a day to see its shifts') &&
  sandbox.__pcCal.includes('est. $27,075.00') && sandbox.__pcCal.includes('actual $12,757.50'));
t('monthHeadline: November is paycheck-basis $39,832.50 (actual $12,757.50 + Nov 24 est $27,075), worked remainder $0',
  sandbox.__pcHeadNov.gross === 39832.50 && sandbox.__pcHeadNov.scheduled === true &&
  sandbox.__pcHeadNov.anyActual === true && sandbox.__pcHeadNov.paycheckTotal === 39832.50 &&
  sandbox.__pcHeadNov.worked === 0 && sandbox.__pcHeadNov.paychecks === 2);
t('monthHeadline: December equals the sum of its own paycheck occurrences (Dec 8 + Dec 22), not a worked-basis figure',
  sandbox.__pcHeadDec.gross === sandbox.__decOccSum && sandbox.__pcHeadDec.gross === 12750 &&
  sandbox.__pcHeadDec.scheduled === true && sandbox.__pcHeadDec.anyActual === false);
t('December banner follows the viewed month and carries the same paycheck-basis headline',
  sandbox.__pcCalDec.includes('month-banner') && sandbox.__pcCalDec.includes('December 2026') &&
  sandbox.__pcCalDec.includes('Expected gross <strong>' + run(`currency(globalThis.__decOccSum)`) + '</strong>'));
t('reconciliation record: actual 12,757.50 replaces shift sum 11,500 -> delta +1,257.50',
  sandbox.__pcRec.length === 1 &&
  sandbox.__pcRec[0].actual === 12757.50 && sandbox.__pcRec[0].shiftSum === 11500 &&
  sandbox.__pcRec[0].delta === 1257.50 && sandbox.__pcRec[0].shiftCount === 5);
t('reconciled YTD: the stubbed period contributes its actual, every other period its shift sum (no double count)',
  // Raw C YTD at Nov 6 (today): Oct shifts 11,500 + Nov 2-5 confirmed
  // 9,375 = 20,875. P YTD adds the proposed Nov 6 shift: 23,875.
  // Reconciled C: +1,257.50. Reconciled P swaps vs the P period sum,
  // which is also 11,500 here (the stub period is all confirmed).
  sandbox.__pcRaw.c.ytd === 20875 && sandbox.__pcRaw.p.ytd === 23875 &&
  sandbox.__pcRecon.c.ytd === 22132.50 && sandbox.__pcRecon.p.ytd === 25132.50 &&
  sandbox.__pcRecon.stubActuals.length === 1);
t('income table note spells out the swap with Caleb\'s numbers (+$1,257.50 vs prediction)',
  sandbox.__pcCSP.includes('Pay stub actual included') &&
  sandbox.__pcCSP.includes('$12,757.50') &&
  sandbox.__pcCSP.includes('$11,500.00') &&
  sandbox.__pcCSP.includes('+$1,257.50'));
t('upcoming panel condensed (Nov 7, 2026): one line per check — date, period range, prominent total, pill',
  sandbox.__pcUpHTML.includes('Nov 10, 2026') &&
  sandbox.__pcUpHTML.includes('(Oct 19 – Nov 1)') &&
  sandbox.__pcUpHTML.includes('$12,757.50') &&
  sandbox.__pcUpHTML.includes('>actual<') &&
  sandbox.__pcUpHTML.includes('Nov 24, 2026') &&
  sandbox.__pcUpHTML.includes('(Nov 2 – Nov 15)') &&
  sandbox.__pcUpHTML.includes('$27,075.00') &&
  !sandbox.__pcUpHTML.includes('Estimated $27,075.00 gross') &&
  !sandbox.__pcUpHTML.includes('includes $17,700.00 from proposed shifts') &&
  !sandbox.__pcUpHTML.includes('$12,757.50 net'));
t('the row detail moved into the paycheck editor: Nov 24 breakdown; Nov 10 stub source-of-truth',
  run(`paycheckEditorHTML(paystubOccurrences(db.payStubs.find(s=>s.id==='pc'),'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-24'))`).includes('Estimated $27,075.00 gross') &&
  run(`paycheckEditorHTML(paystubOccurrences(db.payStubs.find(s=>s.id==='pc'),'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-24'))`).includes('includes $17,700.00 from proposed shifts') &&
  run(`paycheckEditorHTML(paystubOccurrences(db.payStubs.find(s=>s.id==='pc'),'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-10'))`).includes('from pay stub') &&
  run(`paycheckEditorHTML(paystubOccurrences(db.payStubs.find(s=>s.id==='pc'),'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-10'))`).includes('source of truth'));
// ---------- Month headline: partial coverage + no schedule (Nov 7) ----------
// One voice per month (Caleb, Nov 7, 2026): with a pay schedule, the
// headline is what LANDS in the month; facilities with no schedule
// still count their worked shifts, once; with no schedule at all the
// headline is the worked sum, as it always was.
run(`
  db.facilities = [{id:'f1', name:'Holzer'}, {id:'f2', name:'CAMC'}];
  db.shifts.push(
    {id:'c1', date:'2026-11-18', facility:'CAMC', type:'8-hour day', pay:'2000', status:'confirmed'},
    {id:'c2', date:'2026-11-19', facility:'CAMC', type:'8-hour day', pay:'2000', status:'confirmed'}
  );
  globalThis.__partHead = monthHeadline('2026-11');
  month = new Date(2026, 10, 1);
  globalThis.__partCal = calendar();
  db.shifts = db.shifts.filter((x) => x.id !== 'c1' && x.id !== 'c2');
  db.payStubs = [];
  globalThis.__noSchedHead = monthHeadline('2026-11');
  globalThis.__noSchedCal = calendar();
  db.payStubs = [{id:'pc', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'12757.50', net:'12757.50', source:'ai-vision'}];
`);
t('partial coverage: unscheduled CAMC shifts add their worked sum ONCE on top of the paycheck basis ($39,832.50 + $4,000)',
  sandbox.__partHead.gross === 43832.50 && sandbox.__partHead.partial === true &&
  sandbox.__partHead.worked === 4000 && sandbox.__partHead.paycheckTotal === 39832.50 &&
  sandbox.__partCal.includes('Expected gross <strong>$43,832.50</strong>'));
t('no pay schedule at all: the headline falls back to the worked basis ($39,825) in the same banner, no stub qualifier',
  sandbox.__noSchedHead.scheduled === false && sandbox.__noSchedHead.gross === 39825 &&
  sandbox.__noSchedCal.includes('Expected gross <strong>$39,825.00</strong>') &&
  !sandbox.__noSchedCal.includes('incl. actual from pay stub'));
// An unpriced shift inside a period flags that check, never $0-fills it,
// and a stub naming a facility never claims another facility's shifts.
run(`
  db.facilities = [{id:'f1', name:'Holzer'}, {id:'f2', name:'CAMC'}];
  db.shifts = [
    {id:'u1', date:'2026-11-03', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'u2', date:'2026-11-05', facility:'Holzer', type:'5**', pay:'', incomplete:true, status:'confirmed'},
    {id:'u3', date:'2026-11-04', facility:'CAMC', type:'8-hour day', pay:'2000', status:'confirmed'}
  ];
  globalThis.__uOcc = paystubOccurrences(db.payStubs[0], '2026-11-01', '2026-11-30');
`);
t('an unpriced shift in a period flags that check incomplete (Nov 24: $2,125 priced + 1 unpriced), never $0-filled; the CAMC shift is not claimed by the Holzer stub',
  sandbox.__uOcc.find((x) => x.date === '2026-11-24').total === 2125 &&
  sandbox.__uOcc.find((x) => x.date === '2026-11-24').unpriced === 1 &&
  sandbox.__uOcc.find((x) => x.date === '2026-11-24').shiftCount === 2);
run(`
  // A later stub with a HUGE amount changes only its own period.
  db.shifts = [];
  db.payStubs[0].gross = '99999'; db.payStubs[0].net = '';
  globalThis.__hugeOcc = paystubOccurrences(db.payStubs[0], '2026-11-01', '2026-12-31');
  db.payStubs[0].gross = '12757.50'; db.payStubs[0].net = '12757.50';
`);
t('a huge stub amount leaks nowhere: only its own check is the actual; later periods stay shift-calculated (none recorded -> no amount)',
  sandbox.__hugeOcc.find((x) => x.date === '2026-11-10').actual === 99999 &&
  sandbox.__hugeOcc.find((x) => x.date === '2026-11-24').shiftCount === 0 &&
  run(`paystubOccurrenceAmount(globalThis.__hugeOcc.find((x) => x.date === '2026-11-24'))`) === null);
t('paystubStubActual: gross wins; net is only the fallback; blank stub has no actual',
  run(`paystubStubActual({gross:'100', net:'80'}).amount`) === 100 &&
  run(`paystubStubActual({gross:'', net:'80'}).basis`) === 'net' &&
  run(`paystubStubActual({gross:'', net:''})`) === null);

// ---------- Manual entry validation ----------
run(`
  editId = null;
  const before = db.payStubs.length;
  submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'payStubs'}, _entries:[['agency',''],['frequency','weekly'],['payDate','2026-11-06'],['gross','1500'],['net','1100']]}});
  globalThis.__manualNoAgency = db.payStubs.length === before;
  submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'payStubs'}, _entries:[['agency','Acme Staffing'],['frequency','weekly'],['payDate','2026-11-06'],['gross','1500'],['net','1100']]}});
  globalThis.__manualSaved = db.payStubs.some((x) => x.agency === 'Acme Staffing' && x.frequency === 'weekly' && x.payDate === '2026-11-06');
`);
t('manual entry without an agency saves nothing (alert shown)',
  sandbox.__manualNoAgency === true && alerts.length > 0);
t('manual entry with agency + frequency + pay date saves',
  sandbox.__manualSaved === true);

// ---------- Assistant + onboarding + persistence ----------
run(`globalThis.__ans = answerQuestion('When is my next paycheck?');`);
t('assistant answers next-paycheck questions per agency, labelled, with amounts from shifts or the stub actual',
  sandbox.__ans.includes('Premier Anesthesia Group, PC') &&
  sandbox.__ans.includes('double-check') &&
  (sandbox.__ans.includes('actual') || sandbox.__ans.includes('est.')));
run(`
  db.facilities = [{id:'f1', name:'Holzer', rate8:'2125'}];
  globalThis.__steps = onboardingSteps();
  persist();
  const reloaded = load();
  globalThis.__persistedStubs = (reloaded.payStubs || []).length;
`);
t('onboarding step 3 direction mentions pay stubs but still checks off on facilities alone',
  sandbox.__steps[2].direction.includes('pay stub') &&
  sandbox.__steps[2].done === true);
t('pay stubs persist across load()',
  sandbox.__persistedStubs === run(`db.payStubs.length`) && sandbox.__persistedStubs >= 2);
t('paystub disclaimer constant present and shown on the Facilities panel',
  appSrc.includes("PAYSTUB_DISCLAIMER='Paycheck amounts are calculated from your shifts") &&
  appSrc.includes('paystub-panel'));

console.log(failures === 0 ? 'paystub test done: all passed' : 'paystub test done: FAILURES=' + failures);
