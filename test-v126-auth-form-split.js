// CRNA Hub — v126 (Nov 11, 2026): the signed-out Account form split.
// Caleb's question: "Once the app is built will I have to insert my
// name, employment type, and income goal every time to sign in?" The
// old form stacked the step-1 profile fields on the same screen as
// Sign in (they only fed Create account; Sign in ignored them), so it
// READ as if they were required at every sign-in. Now: sign-in is
// email + password only; "New here? Create your account" swaps in the
// create form carrying the profile fields, with a way back.
//
// Pins:
//  1 signed-out default render is the SIGN-IN form: email + password +
//     Sign in + the New here? switch + the confirmation note — and NO
//     name / employment / goal fields, no Skip, no create heading.
//  2 the CREATE form carries email + password + name + employment +
//     optional goal + Skip + a Create account submit + the way back,
//     pre-filled with saved profile values.
//  3 switching forms never loses the typed email/password (the draft
//     is captured in render(), like the mileage form draft) — both
//     directions.
//  4 the create form's submit IS the create path: same validation
//     message as the old button, signup carries the profile in
//     user_metadata, profile saves locally, and a confirmation-pending
//     signup lands on the SIGN-IN form with the created message.
//  5 sign-in submits email + password only; the session stores and
//     the profile restores from the account's user_metadata into
//     empty local settings; the typed draft is cleared afterwards.
//  6 post-erase landing: the wipe's reset block resets the auth form
//     (source pin), and with the banner status set the signed-out
//     Account shows the banner above the SIGN-IN form.
//  7 SW cache is v127.
// Run: node test-v126-auth-form-split.js
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
  get(name) { const e = this._e.find((x) => x[0] === name); return e ? e[1] : null; }
}
const alerts = [];
const fetchCalls = [];
let authBehavior = 'session'; // 'session' | 'confirm' ({} = no session back)
const sessionPayload = {
  access_token: 'tok-9', refresh_token: 'ref-9', expires_in: 3600,
  user: { email: 'caleb@example.com', id: 'u-9', user_metadata: { schedule_name: 'C. Martin', employment_type: '1099', monthly_income_goal: 30000 } },
};
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
    addEventListener() {},
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
  fetch: async (url, opts) => {
    const u = String(url);
    fetchCalls.push({ url: u, opts: opts || {} });
    let payload = [];
    if (u.includes('/api/auth')) payload = authBehavior === 'session' ? sessionPayload : {};
    else if (u.includes('/api/fn')) payload = {};
    const text = JSON.stringify(payload);
    return { status: 200, ok: true, text: async () => text, json: async () => JSON.parse(text) };
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
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');

(async () => {
  run(`cloudSession = null; cloudAuthResetForm(); cloudAuthStatus = ''; tab = 'Account';
       db.settings.scheduleName = 'C. Martin'; db.settings.employmentType = '1099'; db.settings.monthlyIncomeGoal = 40000;`);

  // ---------- 1. Sign-in form is the default: credentials only ----------
  const signin = run(`accountPage()`);
  t('1a sign-in form: email + password + Sign in submit',
    signin.includes('id="cloudAuthForm"') && signin.includes('name="email"') && signin.includes('name="password"') &&
    signin.includes('<button type="submit">Sign in</button>'));
  t('1b sign-in form: NO profile fields, no Skip, no create heading',
    !signin.includes('id="f_scheduleName"') && !signin.includes('id="f_employmentType"') &&
    !signin.includes('id="f_incomeGoalStep1"') && !signin.includes('skip-income-goal') &&
    !signin.includes('Account — create your account'));
  t('1c sign-in form: New here? switch + confirmation note',
    signin.includes('New here?') && signin.includes('data-action="cloud-show-create"') &&
    signin.includes('If we email you a confirmation, tap it, then sign in.'));
  t('1d mode defaults to signin', run(`cloudAuthMode`) === 'signin');

  // ---------- 2. Create form carries the step-1 profile ----------
  run(`cloudAuthMode = 'create';`);
  const create = run(`accountPage()`);
  t('2a create form: all step-1 fields + Skip',
    create.includes('f_scheduleName') && create.includes('Name as it appears on your schedule and licenses') &&
    create.includes('f_employmentType') && create.includes('f_incomeGoalStep1') &&
    create.includes('Monthly income goal ($) — optional') && create.includes('data-action="skip-income-goal"'));
  t('2b create form: Create account submit + way back to sign-in',
    create.includes('<button type="submit">Create account</button>') &&
    create.includes('Already have an account?') && create.includes('data-action="cloud-show-signin"'));
  t('2c create form pre-fills saved profile values',
    create.includes('value="C. Martin"') && create.includes('value="1099" selected') && create.includes('value="40000"'));

  // ---------- 3. The switch keeps the typed email/password ----------
  run(`cloudAuthMode = 'signin'; cloudAuthDraft = { email: '', password: '' };`);
  elements['f_email'].value = 'typed@example.com';
  elements['f_password'].value = 'secret123';
  run(`actions('cloud-show-create')`);
  t('3a switch to create keeps the typed email + password (draft + rendered values)',
    run(`cloudAuthDraft.email`) === 'typed@example.com' && run(`cloudAuthDraft.password`) === 'secret123' &&
    run(`accountPage()`).includes('value="typed@example.com"') && run(`accountPage()`).includes('value="secret123"'));
  run(`actions('cloud-show-signin')`);
  t('3b switch back to sign-in keeps them too',
    run(`cloudAuthMode`) === 'signin' && run(`accountPage()`).includes('value="typed@example.com"') &&
    run(`accountPage()`).includes('value="secret123"'));

  // ---------- 4. Create submit = the create path ----------
  authBehavior = 'confirm'; fetchCalls.length = 0; alerts.length = 0;
  run(`cloudAuthMode = 'create'; db.settings.scheduleName = ''; db.settings.employmentType = ''; db.settings.monthlyIncomeGoal = 0;
       globalThis.__ev = { preventDefault() {}, currentTarget: { _entries: [['email', 'new@example.com'], ['password', 'pw123456'], ['scheduleName', 'C. Martin'], ['employmentType', 'both'], ['incomeGoalStep1', '40000']] } };`);
  await run(`submitCloudAuth(globalThis.__ev)`);
  await new Promise((r) => setTimeout(r, 30)); // create submit fires cloudSignUp without awaiting it (same as the old button)
  const signupCall = fetchCalls.find((c) => { try { return JSON.parse(c.opts.body).endpoint === 'signup'; } catch (e) { return false; } });
  let signupData = null;
  try { signupData = JSON.parse(signupCall.opts.body).body.data; } catch (e) {}
  t('4a create submit calls signup with the profile in user_metadata',
    !!signupCall && signupData && signupData.schedule_name === 'C. Martin' &&
    signupData.employment_type === 'both' && signupData.monthly_income_goal === 40000);
  t('4b create submit saves the profile locally',
    run(`db.settings.scheduleName`) === 'C. Martin' && run(`db.settings.employmentType`) === 'both' &&
    run(`db.settings.monthlyIncomeGoal`) === 40000);
  t('4c confirmation-pending signup lands on the SIGN-IN form with the created message',
    run(`cloudAuthMode`) === 'signin' &&
    run(`cloudAuthStatus`).includes('Account created.') && run(`cloudAuthStatus`).includes('then sign in.') &&
    alerts.some((a) => a.includes('Account created.')));
  // Validation: blank credentials in create mode — the old button's message, no call.
  fetchCalls.length = 0; alerts.length = 0;
  run(`cloudAuthMode = 'create';
       globalThis.__evBad = { preventDefault() {}, currentTarget: { _entries: [['email', ''], ['password', ''], ['scheduleName', ''], ['employmentType', ''], ['incomeGoalStep1', '']] } };`);
  await run(`submitCloudAuth(globalThis.__evBad)`);
  t('4d create validation: blank email/password → the same alert, no signup call',
    alerts.includes('Enter an email and password first.') && !fetchCalls.some((c) => c.url.includes('/api/auth')));

  // ---------- 5. Sign-in: credentials only, profile restores ----------
  authBehavior = 'session'; fetchCalls.length = 0; alerts.length = 0;
  run(`cloudAuthMode = 'signin'; cloudAuthDraft = { email: 'typed@example.com', password: 'secret123' };
       db.settings.scheduleName = ''; db.settings.employmentType = ''; db.settings.monthlyIncomeGoal = 0;
       globalThis.__evIn = { preventDefault() {}, currentTarget: { _entries: [['email', 'caleb@example.com'], ['password', 'pw123456']] } };`);
  await run(`submitCloudAuth(globalThis.__evIn)`);
  await new Promise((r) => setTimeout(r, 30));
  t('5a sign-in stores the session', !!run(`cloudSession`) && run(`cloudSession.email`) === 'caleb@example.com');
  t('5b profile restores from the account (user_metadata) into empty local settings',
    run(`db.settings.scheduleName`) === 'C. Martin' && run(`db.settings.employmentType`) === '1099' &&
    run(`db.settings.monthlyIncomeGoal`) === 30000);
  t('5c typed draft cleared + mode back to signin after sign-in',
    run(`cloudAuthDraft.email`) === '' && run(`cloudAuthDraft.password`) === '' && run(`cloudAuthMode`) === 'signin');

  // ---------- 6. Post-erase landing ----------
  const bannerIdx = appSrc.indexOf('Start over (testing) is done');
  t('6a the wipe reset block resets the auth form before the banner is set (source pin)',
    bannerIdx > 0 && appSrc.slice(Math.max(0, bannerIdx - 2000), bannerIdx).includes('cloudAuthResetForm()'));
  run(`cloudSession = null; cloudAuthMode = 'create'; cloudAuthResetForm();
       cloudAuthStatus = 'Start over (testing) is done: this account and this device were erased. Sign in to a fresh, empty account.';`);
  const afterWipe = run(`accountPage()`);
  t('6b post-erase Account: banner above the SIGN-IN form, no profile fields',
    afterWipe.includes('Start over (testing) is done') && afterWipe.includes('New here?') &&
    !afterWipe.includes('id="f_scheduleName"') &&
    afterWipe.indexOf('Start over (testing) is done') < afterWipe.indexOf('id="cloudAuthForm"'));

  // ---------- 7. SW ----------
  t('7 sw cache bumped to v127', swSrc.includes('crna-hub-shell-v141'));

  console.log(`\nv126 auth-form split: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 1; });
