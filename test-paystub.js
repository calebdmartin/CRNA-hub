// CRNA Hub — tests for pay-stub upload: one pay schedule per agency
// (Nov 5, 2026, branch muse/credentialing). Run: node test-paystub.js
//
// Covers, without any live API call (fetch is stubbed; no network):
//   * Frequency normalisation (weekly / biweekly / semi-monthly /
//     monthly, incl. "every 2 weeks" / "twice a month"); unknown -> ''.
//   * Schedule math: weekly, biweekly, monthly (31st clamps to the
//     30th/28th), semi-monthly anchored on the stub's own pay date
//     (7th -> 7th + 22nd; 20th -> 5th + 20th); next pay date advances
//     past today, a pay date of today IS the next payday.
//   * Deterministic text parsing (pasted text / text-layer PDF):
//     agency, pay period, pay date, gross/net (current-period column,
//     never YTD), frequency inferred from the period length.
//   * Preview-before-save: approve saves one schedule per agency;
//     re-uploading a stub for the same agency replaces only that
//     agency's schedule; other agencies are untouched.
//   * Two agencies paying on the same date show as two separate
//     entries, each labelled with its agency, on the calendar and in
//     the upcoming list — never merged into one combined paycheck.
//   * Calendar chips label each paycheck as an estimate with the
//     paystub disclaimer; estimated paychecks are NOT added into the
//     C/S/P shift-income totals.
//   * Edit/delete: deleting a stub removes only that agency's schedule.
//   * Manual entry (no stub) validates agency + frequency + pay date.
//   * Stub is optional: onboarding step 3 mentions pay stubs but still
//     checks off on facilities alone.
//   * Pay stubs persist across load() (localStorage round-trip).
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
t('preview holds the parsed agency and shows next pay dates before anything saves',
  sandbox.__previewAgency === 'Premier Anesthesia Group' &&
  sandbox.__previewNext.includes('Next expected pay dates'));
t('approve saves one schedule per agency (stub photo itself is not stored)',
  sandbox.__savedCount === 1 && sandbox.__savedAgency === 'Premier Anesthesia Group' &&
  sandbox.__savedGross === '3200' &&
  run(`!db.payStubs[0].imageFileName && !db.payStubs[0].imageData && !db.payStubs[0].rawText`) === true &&
  appSrc.includes("never stored"));
run(`
  // Second agency, then a re-upload for the first agency with new pay.
  db.payStubs.push({id:'px', agency:'Second Agency', facility:'', frequency:'weekly', periodStart:'', periodEnd:'', payDate:'2026-11-06', gross:'1000', net:'800', source:'manual'});
  paystubPreview = paystubPreviewFromParsed({agency:'Premier Anesthesia Group', facility:'Holzer', frequency:'biweekly', periodStart:'2026-11-02', periodEnd:'2026-11-15', payDate:'2026-11-20', gross:3600, net:2700}, 'stub2.pdf', 'test', false);
  approvePaystub();
  globalThis.__afterReplace = db.payStubs.length;
  globalThis.__premierGross = (db.payStubs.find((x) => x.agency === 'Premier Anesthesia Group') || {}).gross;
  globalThis.__secondGross = (db.payStubs.find((x) => x.agency === 'Second Agency') || {}).gross;
`);
t('re-upload for the same agency replaces only that agency (gross updated, count unchanged, other agency untouched)',
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
`);
t('calendar shows estimated paycheck chips labelled by agency with est. amounts',
  sandbox.__cal.includes('chip paycheck') &&
  sandbox.__cal.includes('Premier Anesthesia Group') &&
  sandbox.__cal.includes('Holzer Locums') &&
  sandbox.__cal.includes('est.'));
t('calendar carries the paystub disclaimer on estimated paychecks',
  sandbox.__cal.includes('Paycheck dates and amounts are estimates') ||
  sandbox.__cal.includes('estimates from your pay stub'));
t('dashboard upcoming-paychecks panel lists both agencies as estimates',
  sandbox.__dash.includes('Upcoming paychecks (estimated)') &&
  sandbox.__dash.includes('Premier Anesthesia Group') &&
  sandbox.__dash.includes('Holzer Locums') &&
  sandbox.__dash.includes('estimate'));
t('estimated paychecks are NOT added into the C/S/P shift-income totals',
  sandbox.__split.c.predicted === 2125 && sandbox.__split.p.predicted === 2125);

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
t('assistant answers next-paycheck questions per agency, labelled estimates',
  sandbox.__ans.includes('Premier Anesthesia Group') &&
  sandbox.__ans.includes('est.') &&
  sandbox.__ans.includes('double-check'));
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
  sandbox.__persistedStubs === run(`db.payStubs.length`) && sandbox.__persistedStubs >= 3);
t('paystub disclaimer constant present and shown on the Facilities panel',
  appSrc.includes("PAYSTUB_DISCLAIMER='Paycheck dates and amounts are estimates") &&
  appSrc.includes('paystub-panel'));

console.log(failures === 0 ? 'paystub test done: all passed' : 'paystub test done: FAILURES=' + failures);
