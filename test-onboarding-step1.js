// CRNA Hub — tests for onboarding step 1 as one profile place (Nov 5, 2026,
// branch muse/credentialing). Run: node test-onboarding-step1.js
//
// Covers, without any live API call (fetch is stubbed; no network):
//   * Step 1 collects, in one place on the Account tab: account
//     (email + password), name as it appears on the schedule AND on
//     licenses (one field, that label), employment type (W-2 / 1099 /
//     both), and an optional monthly income goal with a Skip option.
//   * Step 1 checks off only when the account exists (signed in); the
//     name, employment type, and goal are profile fields saved with the
//     account, not separate gates.
//   * Employment type is saved and drives the income engine: W-2-only
//     makes no shift billable (salary, never double-counted); 1099,
//     both, and unset (legacy) price shifts from contracts/facilities;
//     W-2 salary days (Off / PTO) are excluded under every type.
//   * Income goal: settable on the Account tab (Profile - step 1),
//     skippable (0 = unset); removed from the Dashboard Nov 5, 2026 -
//     no goal panel or set-goal affordance there any more.
//   * Profile sync: signup carries schedule_name, employment_type and
//     monthly_income_goal in Auth user_metadata; a signed-in profile
//     save PUTs the same metadata via the auth proxy (update-user);
//     sign-in reads metadata back into empty local settings only.
//   * The name feeds schedule matching (profileName is the same stored
//     value the import matches on) and credential matching (Credentials
//     tab names the profile it matches records to).
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
const fetchCalls = [];
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
  fetch: async (url, opts) => {
    fetchCalls.push({ url: String(url), opts: opts || {} });
    return { status: 200, ok: true, text: async () => '{}', json: async () => ({}) };
  },
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

// ---------- Step 1 form: all four fields, in one place ----------
run(`
  cloudSession = null;
  db.settings.scheduleName = 'C. Martin';
  db.settings.employmentType = '1099';
  db.settings.monthlyIncomeGoal = 40000;
  globalThis.__acct = accountPage();
`);
const acct = sandbox.__acct;
t('step 1 form collects email + password (account)',
  acct.includes('name="email"') && acct.includes('name="password"'));
t('one name field labelled for schedule AND licenses',
  acct.includes('Name as it appears on your schedule and licenses') &&
  acct.includes('f_scheduleName') &&
  (acct.match(/id="f_scheduleName"/g) || []).length === 1);
t('employment type select offers W-2, 1099, or both',
  acct.includes('f_employmentType') &&
  acct.includes('value="w2"') && acct.includes('W-2') &&
  acct.includes('value="1099"') && acct.includes('1099') &&
  acct.includes('value="both"') && acct.includes('Both W-2 and 1099'));
t('monthly income goal field is optional and has a Skip option',
  acct.includes('f_incomeGoalStep1') &&
  acct.includes('Monthly income goal ($) — optional') &&
  acct.includes('data-action="skip-income-goal"') &&
  acct.includes('Skip — I\u2019ll set this later'));
t('form pre-fills saved profile values',
  acct.includes('value="C. Martin"') && acct.includes('value="1099" selected') &&
  acct.includes('value="40000"'));

// ---------- Step 1 checks off only when the account exists ----------
run(`
  cloudSession = null;
  globalThis.__stepsOut = onboardingSteps();
  cloudSession = { access_token: 'x', refresh_token: 'y', expires_at: 9999999999, email: 'a@b.c', user_id: 'u1' };
  db.settings.scheduleName = '';
  db.settings.employmentType = '';
  db.settings.monthlyIncomeGoal = 0;
  globalThis.__stepsInBare = onboardingSteps();
  db.settings.scheduleName = 'C. Martin';
  db.settings.employmentType = '1099';
  db.settings.monthlyIncomeGoal = 40000;
  globalThis.__stepsInFull = onboardingSteps();
  cloudSession = null;
`);
t('step 1 not done while signed out',
  sandbox.__stepsOut[0].done === false);
t('step 1 done when signed in even with no name, type, or goal yet',
  sandbox.__stepsInBare[0].done === true);
t('step 1 stays done with the full profile filled in',
  sandbox.__stepsInFull[0].done === true);
t('step 1 description covers name (both uses), employment type, and the goal skip',
  sandbox.__stepsInFull[0].desc.includes('name as it appears on your schedule and licenses') &&
  sandbox.__stepsInFull[0].desc.includes('W-2') &&
  sandbox.__stepsInFull[0].desc.includes('1099') &&
  sandbox.__stepsInFull[0].desc.includes('Skip'));

// ---------- Employment type drives the income engine ----------
run(`
  db.shifts = [
    {id:'e1', date:'2026-11-10', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
    {id:'e2', date:'2026-11-11', facility:'Holzer', type:'Second call', pay:'3000', status:'confirmed'},
    {id:'e3', date:'2026-11-12', facility:'Holzer', type:'Off / PTO', pay:'5000', status:'confirmed'}
  ];
  db.settings.employmentType = 'w2';
  globalThis.__w2split = yearIncomeSplit(2026, '2026-11-05');
  globalThis.__w2month = monthIncomeSplit('2026-11');
  db.settings.employmentType = '1099';
  globalThis.__t9split = yearIncomeSplit(2026, '2026-11-05');
  db.settings.employmentType = 'both';
  globalThis.__bothSplit = yearIncomeSplit(2026, '2026-11-05');
  db.settings.employmentType = '';
  globalThis.__unsetSplit = yearIncomeSplit(2026, '2026-11-05');
`);
t('W-2 only: no shift is billable — C/S/P are $0, salary never double-counted',
  sandbox.__w2split.c.predicted === 0 && sandbox.__w2split.s.predicted === 0 &&
  sandbox.__w2split.p.predicted === 0 && sandbox.__w2split.w2Salary === 1 &&
  sandbox.__w2month.c === 0);
t('1099: priced shifts count, W-2 salary day excluded even with $5000 stored',
  sandbox.__t9split.c.predicted === 5125 && sandbox.__t9split.w2Salary === 1);
t('both: same as 1099 for priced shifts',
  sandbox.__bothSplit.c.predicted === 5125);
t('unset employment type keeps legacy behaviour (billable) for existing users',
  sandbox.__unsetSplit.c.predicted === 5125);
t('employment type normalizes: unknown values read as unset, labels are exact',
  run(`db.settings.employmentType = 'bogus'; employmentType()`) === '' &&
  run(`db.settings.employmentType = 'W2'; employmentType()`) === 'w2' &&
  run(`db.settings.employmentType = 'both'; employmentTypeLabel()`) === 'W-2 + 1099' &&
  run(`db.settings.employmentType = '1099'; employmentTypeLabel()`) === '1099');
run(`db.settings.employmentType = 'w2'; globalThis.__w2dash = dashboard(); globalThis.__w2saved = savedShiftsHTML(); db.settings.employmentType = '';`);
t('W-2 only: Dashboard and Saved shifts say per-shift totals do not apply',
  sandbox.__w2dash.includes('Employment type: W-2 only') &&
  sandbox.__w2saved.includes('W-2 only, so no shift counts as billable income'));
t('assistant answers the employment-type question from settings',
  run(`db.settings.employmentType = 'both'; answerQuestion('Am I W-2 or 1099?')`).includes('W-2 + 1099') &&
  run(`db.settings.employmentType = ''; answerQuestion('What is my employment type?')`).includes('No employment type is set yet'));

// ---------- Income goal: settable in step 1, never on the Dashboard ----------
// November 2026 fixture: confirmed billable this month = 2125 + 3000.
// The goal value itself is unchanged - only its Dashboard home is gone.
run(`
  db.settings.employmentType = '1099';
  db.settings.monthlyIncomeGoal = 10000;
  globalThis.__goalStored = monthlyIncomeGoal();
  globalThis.__dashSet = dashboard();
  db.settings.monthlyIncomeGoal = 0;
  globalThis.__goalUnset = monthlyIncomeGoal();
  globalThis.__dashUnset = dashboard();
`);
t('goal set: value is stored and readable; Dashboard carries no goal panel',
  sandbox.__goalStored === 10000 &&
  !sandbox.__dashSet.includes('Monthly income goal') &&
  !sandbox.__dashSet.includes('f_incomeGoal') &&
  !sandbox.__dashSet.includes('save-income-goal'));
t('goal skipped (0 = unset): stored as 0; Dashboard has no set-goal affordance',
  sandbox.__goalUnset === 0 &&
  !sandbox.__dashUnset.includes('Monthly income goal') &&
  !sandbox.__dashUnset.includes('Set income goal'));
t('goal widget function is gone from the app source',
  !appSrc.includes('function incomeGoalHTML'));
run(`
  db.settings.monthlyIncomeGoal = 0;
  globalThis.__acctSignedIn = null;
  cloudSession = { access_token: 'x', refresh_token: 'y', expires_at: 9999999999, email: 'a@b.c', user_id: 'u1' };
  globalThis.__acctSignedIn = accountPage();
  cloudSession = null;
`);
t('signed-in Account tab lets the goal be set later (profile panel)',
  sandbox.__acctSignedIn.includes('Profile — step 1') &&
  sandbox.__acctSignedIn.includes('f_profileIncomeGoal') &&
  sandbox.__acctSignedIn.includes('data-action="save-profile"'));

// ---------- Skip action clears the goal field, leaves goal unset ----------
run(`
  db.settings.monthlyIncomeGoal = 0;
  document.getElementById('f_incomeGoalStep1').value = '40000';
  cloudAuthStatus = '';
  actions('skip-income-goal');
  globalThis.__skipStatus = cloudAuthStatus;
  globalThis.__skipValue = document.getElementById('f_incomeGoalStep1').value;
`);
t('Skip clears the goal input and confirms it can be set later',
  sandbox.__skipValue === '' &&
  sandbox.__skipStatus.includes('set it later on the Account tab'));

// ---------- Name feeds schedule matching and credential matching ----------
t('profileName is the same stored value the schedule import matches on',
  run(`db.settings.scheduleName = 'C. Martin'; profileName()`) === 'C. Martin' &&
  run(`scheduleNamesMatch(profileName(), 'Martin, Caleb')`) === true &&
  run(`scheduleNamesMatch(profileName(), 'Jordan Martin')`) === false);
run(`
  db.settings.scheduleName = 'C. Martin';
  globalThis.__cred = credentialsPage();
  db.settings.scheduleName = '';
  globalThis.__credNoName = credentialsPage();
`);
t('Credentials tab names the profile the portal records are matched to',
  sandbox.__cred.includes('Portal records are matched to the name from step 1') &&
  sandbox.__cred.includes('C. Martin') &&
  !sandbox.__credNoName.includes('Portal records are matched to the name from step 1'));

// ---------- Profile sync: signup metadata + signed-in save + sign-in read ----------
(async () => {
  fetchCalls.length = 0;
  run(`db.settings.scheduleName = ''; db.settings.employmentType = ''; db.settings.monthlyIncomeGoal = 0;`);
  await run(`cloudSignUp('new@example.com', 'pw123456', 'C. Martin', 'both', 40000)`);
  const signupCall = fetchCalls.find((c) => c.url === '/api/auth');
  let signupData = null;
  try { signupData = JSON.parse(signupCall.opts.body).body.data; } catch (e) {}
  t('signup carries the profile in Auth user_metadata',
    signupCall && JSON.parse(signupCall.opts.body).endpoint === 'signup' &&
    signupData && signupData.schedule_name === 'C. Martin' &&
    signupData.employment_type === 'both' &&
    signupData.monthly_income_goal === 40000);
  t('signup saves the profile locally too',
    run(`db.settings.scheduleName`) === 'C. Martin' &&
    run(`db.settings.employmentType`) === 'both' &&
    run(`db.settings.monthlyIncomeGoal`) === 40000);

  // Signed-in profile save -> proxy update-user PUT with the user's token.
  fetchCalls.length = 0;
  run(`
    cloudSession = { access_token: 'tok-1', refresh_token: 'r1', expires_at: 9999999999, email: 'a@b.c', user_id: 'u1' };
    db.settings.scheduleName = 'C. Martin';
    db.settings.employmentType = 'w2';
    db.settings.monthlyIncomeGoal = 0;
  `);
  await run(`cloudSaveProfile()`);
  const saveCall = fetchCalls.find((c) => c.url === '/api/auth');
  let saveBody = null;
  try { saveBody = JSON.parse(saveCall.opts.body); } catch (e) {}
  t('signed-in profile save PUTs user_metadata via the auth proxy (update-user)',
    saveCall && saveBody && saveBody.endpoint === 'update-user' &&
    saveBody.token === 'tok-1' &&
    saveBody.body && saveBody.body.data &&
    saveBody.body.data.schedule_name === 'C. Martin' &&
    saveBody.body.data.employment_type === 'w2' &&
    saveBody.body.data.monthly_income_goal === null);
  t('no new table: profile sync uses user_metadata only, no profiles-table call',
    !fetchCalls.some((c) => String(c.url).includes('/rest/v1/profiles')) &&
    appSrc.includes('user_metadata') && !appSrc.includes('/rest/v1/profiles'));

  // Sign-in reads metadata back into empty local settings only.
  run(`
    db.settings.scheduleName = '';
    db.settings.employmentType = '';
    db.settings.monthlyIncomeGoal = 0;
    cloudStoreSession({ access_token: 'tok-2', refresh_token: 'r2', expires_in: 3600, user: { email: 'a@b.c', id: 'u1', user_metadata: { schedule_name: 'C. Martin', employment_type: '1099', monthly_income_goal: 30000 } } });
    globalThis.__metaFilled = { n: db.settings.scheduleName, e: db.settings.employmentType, g: db.settings.monthlyIncomeGoal };
    db.settings.scheduleName = 'Local Name';
    cloudStoreSession({ access_token: 'tok-3', refresh_token: 'r3', expires_in: 3600, user: { email: 'a@b.c', id: 'u1', user_metadata: { schedule_name: 'Server Name', employment_type: 'w2', monthly_income_goal: 100 } } });
    globalThis.__metaKept = { n: db.settings.scheduleName, e: db.settings.employmentType, g: db.settings.monthlyIncomeGoal };
  `);
  t('sign-in fills empty local profile fields from user_metadata',
    sandbox.__metaFilled.n === 'C. Martin' && sandbox.__metaFilled.e === '1099' &&
    sandbox.__metaFilled.g === 30000);
  t('sign-in never clobbers a locally set profile value',
    sandbox.__metaKept.n === 'Local Name' && sandbox.__metaKept.e === '1099' &&
    sandbox.__metaKept.g === 30000);

  console.log(failures === 0 ? 'onboarding-step1 test done: all passed' : 'onboarding-step1 test done: FAILURES=' + failures);
})();
