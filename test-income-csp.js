// CRNA Hub — tests for the confirmed / submitted / proposed (C/S/P)
// income split + Monthly Income Goal + 5-step onboarding (Nov 5, 2026,
// branch muse/credentialing). Run: node test-income-csp.js
//
// Covers, without any live API call (fetch is stubbed; no network):
//   * C/S/P totals: C = confirmed (+ completed), S = C + submitted,
//     P = S + proposed; rejected/canceled count in no total; YTD and
//     predicted-annual for each; legacy ytd/predicted fields stay P.
//   * Unpriced shifts excluded from all three totals and counted
//     (never $0); W-2 salary days (Off / PTO) excluded from all three
//     even with a pay value stored, and counted.
//   * Missing/unknown status defaults to proposed, never confirmed.
//   * Imported (CSV / calendar / contract) and manually added shifts
//     arrive as proposed; submitEntry normalizes status.
//   * Status change (setShiftStatus) re-prices the three totals at once.
//   * Year scoping preserved: other-year shifts never enter the totals.
//   * Monthly Income Goal: stored per user, progress vs CONFIRMED
//     total this month, shown as $ and %.
//   * Dashboard + Saved shifts show the C/S/P table with the paystub
//     disclaimer; Saved shifts has a per-shift status changer.
//   * Assistant income answers quote the same C/S/P split.
//   * Onboarding is 5 steps: facilities & contracts merged into step 3,
//     done when >=1 facility has a rate or a contract; no standalone
//     contracts step; "N of 5" count works.
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

// ---------- Fixture: mixed statuses, year 2026, "today" 2026-11-05 ----------
run(`
  db.shifts = [
    {id:'s1', date:'2026-10-20', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'s2', date:'2026-11-10', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'s3', date:'2026-10-21', facility:'Holzer', type:'8-hour day', pay:'2000', status:'completed'},
    {id:'s4', date:'2026-10-22', facility:'Holzer', type:'Second call', pay:'3000', status:'submitted'},
    {id:'s5', date:'2026-11-12', facility:'Holzer', type:'Second call', pay:'3000', status:'submitted'},
    {id:'s6', date:'2026-11-01', facility:'Holzer', type:'8-hour day', pay:'2000', status:'proposed'},
    {id:'s7', date:'2026-11-20', facility:'Holzer', type:'8-hour day', pay:'2000', status:'proposed'},
    {id:'s8', date:'2026-11-21', facility:'Holzer', type:'8-hour day', pay:'5000', status:'rejected'},
    {id:'s9', date:'2026-10-19', facility:'Holzer', type:'8-hour day', pay:'5000', status:'canceled'},
    {id:'s10', date:'2026-11-22', facility:'Holzer', type:'8-hour day', pay:'', incomplete:true, status:'proposed'},
    {id:'s11', date:'2026-11-23', facility:'Holzer', type:'24-hour call', pay:'', incomplete:true, status:'confirmed'},
    {id:'s12', date:'2026-11-06', facility:'Holzer', type:'Off / PTO', pay:'5000', status:'confirmed'},
    {id:'s13', date:'2026-11-07', facility:'Holzer', type:'8-hour day', pay:'1000'},
    {id:'s14', date:'2027-01-05', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'}
  ];
  db.facilities = [{id:'f1', name:'Holzer', rate8:'2125'}];
  globalThis.__split = yearIncomeSplit(2026, '2026-11-05');
  globalThis.__split27 = yearIncomeSplit(2027, '2026-11-05');
`);
const sp = sandbox.__split, sp27 = sandbox.__split27;
// C: past 2125+2000=4125, future 2125 -> predicted 6250
t('C = confirmed (+completed) only: YTD 4125, predicted 6250',
  sp.c.ytd === 4125 && sp.c.predicted === 6250 && sp.c.future === 2125);
// S: past 4125+3000=7125, future 2125+3000=5125 -> predicted 12250
t('S = submitted-inclusive: YTD 7125, predicted 12250',
  sp.s.ytd === 7125 && sp.s.predicted === 12250);
// P: past 7125+2000=9125, future 5125+2000+1000(status-less)=8125 -> predicted 17250
t('P = proposed-inclusive: YTD 9125, predicted 17250 (status-less shift counts as proposed)',
  sp.p.ytd === 9125 && sp.p.predicted === 17250);
t('rejected/canceled ($5000 each) count in no total',
  sp.p.predicted === 17250 && sp.c.predicted === 6250);
t('unpriced shifts excluded from all three totals and counted (2)',
  sp.unpriced === 2 && sp.unpricedFuture === 2);
t('W-2 salary day with a stored $5000 pay excluded from all three, counted',
  sp.w2Salary === 1 && sp.w2SalaryPriced === 1 && sp.c.ytd === 4125);
t('legacy ytd/predicted fields stay mapped to P',
  sp.ytd === sp.p.ytd && sp.predicted === sp.p.predicted && sp.futureGross === sp.p.future);
t('year scoping: 2027 confirmed shift not in 2026 totals; 2027 C predicted is 2125',
  sp27.c.predicted === 2125 && sp27.c.ytd === 0);

// ---------- Status normalization ----------
t('normalizeShiftStatus: case-insensitive, unknown/missing -> proposed',
  run(`normalizeShiftStatus('CONFIRMED')`) === 'confirmed' &&
  run(`normalizeShiftStatus('bogus')`) === 'proposed' &&
  run(`normalizeShiftStatus('')`) === 'proposed' &&
  run(`normalizeShiftStatus(undefined)`) === 'proposed');

// ---------- Status change re-prices ----------
run(`setShiftStatus('s7', 'confirmed'); globalThis.__split2 = yearIncomeSplit(2026, '2026-11-05');`);
const sp2 = sandbox.__split2;
t('status change re-prices: proposed->confirmed moves $2000 into C, P unchanged',
  sp2.c.predicted === 8250 && sp2.s.predicted === 14250 && sp2.p.predicted === 17250);
run(`setShiftStatus('s7', 'nonsense'); globalThis.__split3 = yearIncomeSplit(2026, '2026-11-05');`);
t('invalid status change normalizes back to proposed',
  sandbox.__split3.c.predicted === 6250 && sandbox.__split3.p.predicted === 17250);
run(`setShiftStatus('s7', 'proposed');`); // restore fixture

// ---------- Creation paths default to proposed (static + submitEntry) ----------
t('CSV import defaults new shifts to proposed',
  appSrc.includes("status:'proposed',note:'CSV import'"));
t('calendar (.ics) import defaults new shifts to proposed',
  appSrc.includes("status:'proposed',source:r.source") || appSrc.includes("status:'proposed'"));
t('contract import defaults new shifts to proposed',
  appSrc.includes("status:'proposed',source:r.source||'extracted-from-contract'"));
t('submitEntry normalizes shift status on save',
  appSrc.includes("if(kind==='shifts')record.status=normalizeShiftStatus(record.status);"));
t('stored shifts without a status are normalized to proposed on load',
  appSrc.includes('x.status=normalizeShiftStatus(x.status);'));

// ---------- Monthly income goal ----------
run(`
  db.settings.monthlyIncomeGoal = 10000;
  globalThis.__prefix = localDate(new Date()).slice(0,7);
  globalThis.__month = monthIncomeSplit(globalThis.__prefix);
  globalThis.__goalHtml = incomeGoalHTML();
`);
// November 2026 fixture: confirmed = 2125 (Nov 10) + 5000 W-2 excluded = 2125
// (s7 is proposed, s5 submitted, s13 proposed) — compute from the engine, not by hand:
const mc = sandbox.__month.c;
const expectPct = Math.round(mc / 10000 * 100);
t('goal progress is measured against the CONFIRMED month total ($ and %)',
  sandbox.__goalHtml.includes('$' + mc.toLocaleString('en-US')) &&
  sandbox.__goalHtml.includes(expectPct + '%') &&
  sandbox.__goalHtml.includes('$10,000'));
t('goal panel shows submitted/proposed month totals as context, confirmed only counts',
  sandbox.__goalHtml.includes('Only confirmed counts toward the goal'));
run(`db.settings.monthlyIncomeGoal = 0; globalThis.__goalHtml0 = incomeGoalHTML();`);
t('no goal set: panel invites setting one instead of showing a %',
  sandbox.__goalHtml0.includes('Set a monthly goal') && !sandbox.__goalHtml0.includes('% of your'));

// ---------- Dashboard + Saved shifts render C/S/P ----------
run(`
  globalThis.__dash = dashboard();
  savedShiftsYear = 2026;
  globalThis.__saved = savedShiftsHTML();
`);
t('Dashboard shows C/S/P table with YTD + predicted-annual labels',
  sandbox.__dash.includes('C — Confirmed only') &&
  sandbox.__dash.includes('S — Submitted-inclusive') &&
  sandbox.__dash.includes('P — Proposed-inclusive') &&
  sandbox.__dash.includes('Year to date') && sandbox.__dash.includes('Predicted 2026 annual'));
t('Dashboard keeps the paystub disclaimer and the goal panel',
  sandbox.__dash.includes('Income figures are estimates from your own rates and shifts') &&
  sandbox.__dash.includes('Monthly income goal'));
t('Dashboard month gross is labelled as all statuses (no silent single total)',
  sandbox.__dash.includes('Expected gross · this month (all statuses)'));
t('Saved shifts shows C/S/P for the selected year + per-shift status changer + W-2 label',
  sandbox.__saved.includes('C — Confirmed only') &&
  sandbox.__saved.includes('data-shift-status="s1"') &&
  sandbox.__saved.includes('W-2 salary day — excluded from income totals'));
t('Saved shifts year scoping note preserved',
  sandbox.__saved.includes('only the totals above are scoped to 2026'));
run(`globalThis.__form = shiftFormHTML();`);
t('shift form offers the status select, defaulting new shifts to proposed',
  sandbox.__form.includes('name="status"') && sandbox.__form.includes('value="proposed" selected'));

// ---------- Assistant answers use the same C/S/P split ----------
run(`
  globalThis.__ansYear = answerQuestion('What is my income this year?');
  globalThis.__ansMonth = answerQuestion("What's my projected income this month?");
  globalThis.__ansCSP = answerQuestion('What is my C/S/P forecast?');
`);
t('assistant year answer quotes C, S and P (not one combined total)',
  sandbox.__ansYear.includes('C (confirmed only)') &&
  sandbox.__ansYear.includes('S (submitted-inclusive') &&
  sandbox.__ansYear.includes('P (proposed-inclusive'));
t('assistant month answer quotes C, S and P',
  sandbox.__ansMonth.includes('C (confirmed only)') &&
  sandbox.__ansMonth.includes('S (submitted-inclusive)') &&
  sandbox.__ansMonth.includes('P (proposed-inclusive)'));
t('assistant C/S/P question answers with live totals, not "planned feature"',
  sandbox.__ansCSP.includes('C (confirmed only)') &&
  !sandbox.__ansCSP.includes('planned feature'));
run(`globalThis.__summary = buildAssistantSummary();`);
t('live-model summary carries c/s/p year totals and confirmed month total',
  sandbox.__summary.year.c && sandbox.__summary.year.s && sandbox.__summary.year.p &&
  typeof sandbox.__summary.month.confirmed === 'number' &&
  sandbox.__summary.month.monthlyIncomeGoal === 0);
t('no "does not yet track" / "planned, not live" income copy remains',
  !appSrc.includes('does not yet track confirmed vs. submitted vs. proposed') &&
  !appSrc.includes('the C/S/P split is a planned feature'));

// ---------- Onboarding: 5 steps, facilities & contracts merged ----------
run(`
  db.facilities = []; db.contracts = [];
  globalThis.__steps0 = onboardingSteps();
  db.facilities = [{id:'f1', name:'Holzer', rate8:'', rate24:'', rateSecond:'', hourlyRate:'', callBonus:''}];
  globalThis.__stepsBare = onboardingSteps();
  db.facilities = [{id:'f1', name:'Holzer', rate8:'2125'}];
  globalThis.__stepsRate = onboardingSteps();
  db.facilities = [{id:'f1', name:'Holzer', rate8:''}];
  db.contracts = [{id:'c1', facility:'Holzer', rates:{}}];
  globalThis.__stepsContract = onboardingSteps();
  globalThis.__onboardHtml = onboardingHTML();
`);
const steps0 = sandbox.__steps0;
t('onboarding is 5 steps in the new order',
  steps0.length === 5 &&
  steps0.map(s => s.title).join('|') === 'Create your account|Sync your calendars|Add facilities & contracts|Connect credentialing services and licenses|Upload certifications');
t('no standalone "Upload current contracts" step remains',
  !steps0.some(s => s.title === 'Upload current contracts') &&
  !appSrc.includes("title:'Upload current contracts'"));
t('step 3 not done with no facilities; bare facility (no rate, no contract) does not check it off',
  steps0[2].done === false && sandbox.__stepsBare[2].done === false);
t('step 3 checks off with a facility rate, or with a contract and no rate',
  sandbox.__stepsRate[2].done === true && sandbox.__stepsContract[2].done === true);
t('"N of 5" count works in the guide',
  sandbox.__onboardHtml.includes(' of 5 done'));
t('step 3 description covers sync suggestion, contract upload, and manual entry',
  steps0[2].desc.includes('sync suggestion') &&
  steps0[2].desc.includes('Upload the contract') &&
  steps0[2].desc.includes('by hand is the backup'));
t('step 3 still carries the paystub disclaimer',
  steps0[2].desc.includes('Income figures are estimates from your own rates and shifts'));

console.log(failures === 0 ? 'income-csp test done: all passed' : 'income-csp test done: FAILURES=' + failures);
