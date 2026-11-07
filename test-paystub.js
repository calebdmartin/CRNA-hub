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
//     the same engine as the C/P totals. Confirmed shifts make the
//     headline estimate; proposed shifts show as an incl.-proposed
//     figure; unpriced shifts flag the estimate incomplete, never $0.
//   * No fake net: paycheck displays show calculated gross only.
//   * RECONCILIATION: the stub's own check is the ACTUAL for its
//     period. In the Dashboard YTD figures, a stubbed (fully ended)
//     period contributes its actual INSTEAD of its shift sum — never
//     both. The actual builds no forward rule: later periods stay
//     pure shift calculations. A stub for a period with no recorded
//     shifts still records its actual for that period.
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
  sandbox.__dash.includes('Upcoming paychecks (estimated)') &&
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

// ---------- Caleb's fixture: per-period calculation + reconciliation ----------
// Premier stub: period Oct 19 - Nov 1, 2026, paid Nov 10, actual
// $12,757.50. His shifts in that period add up to $11,500 (predicted);
// he worked a little more and the stub is the truth for that period.
run(`
  db.facilities = [{id:'f1', name:'Holzer'}, {id:'f2', name:'CAMC'}];
  db.payStubs = [
    {id:'pc', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'12757.50', net:'12757.50', source:'ai-vision'}
  ];
  db.shifts = [
    {id:'a1', date:'2026-10-20', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'a2', date:'2026-10-22', facility:'Holzer', type:'8/2nd call', pay:'3000', status:'confirmed'},
    {id:'a3', date:'2026-10-27', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'a4', date:'2026-10-29', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'a5', date:'2026-10-30', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'b1', date:'2026-11-03', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'b2', date:'2026-11-05', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'b3', date:'2026-11-12', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'b4', date:'2026-11-13', facility:'Holzer', type:'8-hour day', pay:'2125', status:'proposed'},
    {id:'c1', date:'2026-11-17', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'c2', date:'2026-11-18', facility:'Holzer', type:'5**', pay:'', incomplete:true, status:'confirmed'},
    {id:'d1', date:'2026-11-04', facility:'CAMC', type:'8-hour day', pay:'2000', status:'confirmed'}
  ];
  globalThis.__pcOcc = paystubOccurrences(db.payStubs[0], '2026-11-01', '2026-12-31');
  globalThis.__pcRec = paystubReconciliations();
  globalThis.__pcRaw = yearIncomeSplit(2026, '2026-11-06');
  globalThis.__pcRecon = reconciledYearSplit(2026, '2026-11-06');
  globalThis.__pcCSP = incomeCSPHTML(2026, reconciledYearSplit(2026, '2026-11-06'));
  globalThis.__pcUpHTML = paystubUpcomingHTML();
`);
const occ = Object.fromEntries(sandbox.__pcOcc.map((x) => [x.date, x]));
t('period derivation: Nov 10 covers Oct 19 - Nov 1; Nov 24 covers Nov 2 - Nov 15 (9-day lag preserved)',
  occ['2026-11-10'] && occ['2026-11-10'].periodStart === '2026-10-19' && occ['2026-11-10'].periodEnd === '2026-11-01' &&
  occ['2026-11-24'] && occ['2026-11-24'].periodStart === '2026-11-02' && occ['2026-11-24'].periodEnd === '2026-11-15' &&
  occ['2026-12-08'] && occ['2026-12-08'].periodStart === '2026-11-16' && occ['2026-12-08'].periodEnd === '2026-11-29');
t('the stub\'s own check (Nov 10) is the ACTUAL $12,757.50, not an estimate — and its shifts summed to $11,500',
  occ['2026-11-10'].isActual === true && occ['2026-11-10'].actual === 12757.50 &&
  occ['2026-11-10'].gross === 11500 && occ['2026-11-10'].shiftCount === 5);
t('the NEXT check (Nov 24) is calculated from its own period shifts — $6,375 confirmed, $8,500 incl. proposed — NOT the stub amount',
  occ['2026-11-24'].isActual === false &&
  occ['2026-11-24'].gross === 6375 && occ['2026-11-24'].grossWithProposed === 8500 &&
  occ['2026-11-24'].gross !== 12757.50 && occ['2026-11-24'].shiftCount === 4);
t('an unpriced shift in a period flags that check incomplete (Dec 8: $2,125 priced + 1 unpriced), never $0-filled',
  occ['2026-12-08'].gross === 2125 && occ['2026-12-08'].unpriced === 1 && occ['2026-12-08'].shiftCount === 2);
t('a period with no shifts recorded yet shows no amount (Dec 22), never the stub amount',
  occ['2026-12-22'] && occ['2026-12-22'].shiftCount === 0 &&
  run(`paystubOccurrenceAmount(globalThis.__pcOcc.find((x) => x.date === '2026-12-22'))`) === null);
t('the CAMC shift is not claimed by the Holzer stub (facility named on the stub)',
  occ['2026-11-24'].shiftCount === 4);
t('reconciliation record: actual 12,757.50 replaces shift sum 11,500 -> delta +1,257.50',
  sandbox.__pcRec.length === 1 &&
  sandbox.__pcRec[0].actual === 12757.50 && sandbox.__pcRec[0].shiftSum === 11500 &&
  sandbox.__pcRec[0].delta === 1257.50 && sandbox.__pcRec[0].shiftCount === 5);
t('reconciled YTD: the period contributes its actual, every other period its shift sum (no double count)',
  // Raw C YTD at Nov 6: 11,500 (stub period) + 4,250 (Nov 2-15 period,
  // dated <= Nov 6) + 2,000 (CAMC) = 17,750. Reconciled: +1,257.50.
  sandbox.__pcRaw.c.ytd === 17750 &&
  sandbox.__pcRecon.c.ytd === 19007.50 &&
  sandbox.__pcRecon.c.predicted === 23257.50 &&
  sandbox.__pcRecon.p.ytd === 19007.50 &&
  sandbox.__pcRecon.stubActuals.length === 1);
t('income table note spells out the swap with Caleb\'s numbers (+$1,257.50 vs prediction)',
  sandbox.__pcCSP.includes('Pay stub actual included') &&
  sandbox.__pcCSP.includes('$12,757.50') &&
  sandbox.__pcCSP.includes('$11,500.00') &&
  sandbox.__pcCSP.includes('+$1,257.50'));
t('upcoming panel: Nov 10 shows actual from pay stub, Nov 24 shows its own calculated estimate',
  sandbox.__pcUpHTML.includes('$12,757.50') &&
  sandbox.__pcUpHTML.includes('actual') &&
  sandbox.__pcUpHTML.includes('from pay stub') &&
  sandbox.__pcUpHTML.includes('$6,375.00') &&
  !sandbox.__pcUpHTML.includes('$12,757.50 net'));
run(`
  // A later stub with a HUGE amount changes only its own period.
  db.payStubs[0].gross = '99999'; db.payStubs[0].net = '';
  globalThis.__hugeOcc = paystubOccurrences(db.payStubs[0], '2026-11-01', '2026-12-31');
  db.payStubs[0].gross = '12757.50'; db.payStubs[0].net = '12757.50';
`);
t('a huge stub amount leaks nowhere: only its own check is the actual; period 2 stays the shift sum',
  sandbox.__hugeOcc.find((x) => x.date === '2026-11-10').actual === 99999 &&
  sandbox.__hugeOcc.find((x) => x.date === '2026-11-24').gross === 6375 &&
  sandbox.__hugeOcc.find((x) => x.date === '2026-12-08').gross === 2125);
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
