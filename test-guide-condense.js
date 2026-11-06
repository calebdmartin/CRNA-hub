// CRNA Hub — tests for the condensed Getting started guide (Nov 6, 2026,
// branch muse/credentialing). Run: node test-guide-condense.js
//
// Caleb's ask: the guide list should be just the bullet-point list
// (step number, title, done check, Start/Review button) — NO long
// paragraph under each step. The short direction for a step lives on
// that step's own page, shown only after the user taps Start/Review
// for it, and only while the step is still undone.
//
// Covers, without any live API call (fetch is stubbed; no network):
//   * the guide renders 5 steps in the same order, with the same jump
//     targets (tab + panel) and the same auto-check conditions;
//   * the guide list has no long paragraphs: no step-description div,
//     no stand-in / final-model copy, no income disclaimer, and none
//     of the five direction lines appear in the guide itself;
//   * the header stays short: "N of 5 done — in order." and nothing more;
//   * each step's direction is one or two lines (<= 160 chars) and is
//     shown on its destination page after Start, and only there;
//   * no direction shows before Start, after navigating away, or for a
//     step that is already done (Review).
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
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');

// ---------- Fresh state: nothing done ----------
run(`
  cloudSession = null;
  db.settings.onboardingDismissed = false;
  db.settings.scheduleImported = false;
  db.settings.qgendaConnected = false;
  db.facilities = []; db.contracts = []; db.licenses = []; db.documents = [];
  db.nbcrna = {}; db.aana = {};
  globalThis.__steps = onboardingSteps();
  globalThis.__guide = onboardingHTML();
`);
const steps = sandbox.__steps;
const guide = sandbox.__guide;

// ---------- Order, jump targets, auto-check conditions unchanged ----------
t('guide is still 5 steps, same order, same titles',
  steps.length === 5 &&
  steps.map(s => s.title).join('|') === 'Create your account|Sync calendars or upload a schedule|Add facilities & contracts|Connect credentialing services and licenses|Upload certifications');
t('jump targets unchanged (tab + panel per step)',
  steps[0].tab === 'Account' && steps[0].panel === '' &&
  steps[1].tab === 'Account' && steps[1].panel === 'live-sync-panel' &&
  steps[2].tab === 'Facilities' && steps[2].panel === '' &&
  steps[3].tab === 'Credentials' && steps[3].panel === '' &&
  steps[4].tab === 'Credentials' && steps[4].panel === 'cert-documents');
t('nothing checks off with no records behind it',
  steps.every(s => s.done === false));
t('step objects carry a direction, not a long desc',
  steps.every(s => typeof s.direction === 'string' && s.direction.length > 0) &&
  !('desc' in steps[0]) && !appSrc.includes("desc:'On the Account tab"));

// ---------- Guide list: bullets only, no long paragraphs ----------
t('guide has 5 step rows, each with number, title, done check, Start button',
  (guide.match(/<li class="onboard-step/g) || []).length === 5 &&
  (guide.match(/data-action="onboard-goto"/g) || []).length === 5 &&
  guide.includes('1. Create your account') && guide.includes('5. Upload certifications') &&
  guide.includes('Start →') && guide.includes('○'));
t('no long paragraph under any step (no step-description div in the guide)',
  !guide.includes('<div class="muted">'));
t('no direction line appears in the guide itself',
  steps.every(s => !guide.includes(s.direction)));
t('no stand-in / final-model copy in the guide',
  !guide.includes('Preview stand-in') && !guide.includes('system sign-in sheet') &&
  !guide.includes('EventKit') && !guide.includes('app-specific password'));
t('no income disclaimer paragraph in the guide',
  !guide.includes('Income figures are estimates'));
t('header stays short: "N of 5 done — in order." and nothing more',
  guide.includes('0 of 5 done — in order.') &&
  !guide.includes('Nothing is marked done') && !guide.includes('portal password'));

// ---------- Each direction is one or two lines ----------
t('every direction is short (<= 160 chars, at most 2 sentences)',
  steps.every(s => s.direction.length <= 160 &&
    s.direction.split('.').filter(x => x.trim()).length <= 2));
t('step 1 direction is exact',
  steps[0].direction === 'Create your account, add the name as it appears on your schedule and licenses, pick W-2, 1099, or both, and set a monthly income goal — or skip it.');
t('step 2 direction is exact',
  steps[1].direction === 'Connect a calendar once, or upload a schedule — the app picks out only your shifts.');
t('step 3 direction: contract upload or manual entry, pay stub optional',
  steps[2].direction.includes('Upload your contract') &&
  steps[2].direction.includes('enter a facility by hand') &&
  steps[2].direction.includes('pay stub is optional'));
t('step 4 direction: connect, sign in on the portal page, no password here',
  steps[3].direction.includes('Connect NBCRNA, AANA, and your state licenses') &&
  steps[3].direction.includes('never a password here'));
t('step 5 direction is exact',
  steps[4].direction === 'Upload a cert and we’ll read its expiration date.');

// ---------- No direction shows before Start ----------
run(`
  globalThis.__acctBefore = accountPage();
  globalThis.__syncBefore = syncSectionHTML();
  globalThis.__facBefore = facilitiesPage();
  globalThis.__credBefore = credentialsPage();
`);
t('no direction banner on any destination page before Start is tapped',
  !sandbox.__acctBefore.includes('data-onboard-direction') &&
  !sandbox.__syncBefore.includes('data-onboard-direction') &&
  !sandbox.__facBefore.includes('data-onboard-direction') &&
  !sandbox.__credBefore.includes('data-onboard-direction'));

// ---------- Start greets the user with the direction on that step's page ----------
run(`actions('onboard-goto', 'Account', ''); globalThis.__acct1 = accountPage();`);
t('step 1: Start shows its direction at the top of the Account tab',
  sandbox.__acct1.includes('data-onboard-direction="1"') &&
  sandbox.__acct1.includes(steps[0].direction));
run(`actions('onboard-goto', 'Account', 'live-sync-panel'); globalThis.__sync2 = syncSectionHTML();`);
t('step 2: Start shows its direction at the top of the live-sync panel',
  sandbox.__sync2.includes('data-onboard-direction="2"') &&
  sandbox.__sync2.includes(steps[1].direction));
run(`actions('onboard-goto', 'Facilities', ''); globalThis.__fac3 = facilitiesPage();`);
t('step 3: Start shows its direction at the top of the Facilities tab',
  sandbox.__fac3.includes('data-onboard-direction="3"') &&
  sandbox.__fac3.includes(steps[2].direction));
run(`actions('onboard-goto', 'Credentials', ''); globalThis.__cred4 = credentialsPage();`);
t('step 4: Start shows its direction at the top of the Credentials tab',
  sandbox.__cred4.includes('data-onboard-direction="4"') &&
  sandbox.__cred4.includes(steps[3].direction));
run(`actions('onboard-goto', 'Credentials', 'cert-documents'); globalThis.__cred5 = credentialsPage();`);
t('step 5: Start shows its direction inside the Certification documents panel',
  sandbox.__cred5.includes('data-onboard-direction="5"') &&
  sandbox.__cred5.includes(steps[4].direction) &&
  sandbox.__cred5.indexOf('data-onboard-direction="5"') < sandbox.__cred5.indexOf('No certification documents yet'));

// ---------- Direction clears when navigating away ----------
// (setTab is the tab-bar path; tapping another tab drops the greeting.)
run(`actions('onboard-goto', 'Facilities', ''); setTab('Dashboard'); globalThis.__facAfterNav = facilitiesPage();`);
t('direction is gone after navigating to another tab',
  !sandbox.__facAfterNav.includes('data-onboard-direction'));

// ---------- Direction does not show for a done step (Review) ----------
run(`
  db.facilities = [{id:'f1', name:'Holzer', rate8:'2125'}];
  globalThis.__stepsDone3 = onboardingSteps();
  actions('onboard-goto', 'Facilities', '');
  globalThis.__facDone3 = facilitiesPage();
  db.facilities = [];
`);
t('step 3 checks off with a facility rate, and Review shows no direction banner',
  sandbox.__stepsDone3[2].done === true &&
  !sandbox.__facDone3.includes('data-onboard-direction'));

// ---------- Auto-check conditions still respond to state ----------
run(`
  cloudSession = { access_token: 'x', refresh_token: 'y', expires_at: 9999999999, email: 'a@b.c', user_id: 'u1' };
  globalThis.__s1 = onboardingSteps()[0].done;
  cloudSession = null;
  db.settings.scheduleImported = true;
  globalThis.__s2 = onboardingSteps()[1].done;
  db.settings.scheduleImported = false;
  db.licenses = [{id:'l1', state:'West Virginia', type:'RN', expiry:'2028-06-30'}];
  globalThis.__s4 = onboardingSteps()[3].done;
  db.licenses = [];
  db.documents = [{id:'d1', certType:'ACLS', expiry:'2027-01-01'}];
  globalThis.__s5 = onboardingSteps()[4].done;
  db.documents = [];
`);
t('auto-checks unchanged: signed-in checks 1, schedule import checks 2, license checks 4, cert checks 5',
  sandbox.__s1 === true && sandbox.__s2 === true &&
  sandbox.__s4 === true && sandbox.__s5 === true);

console.log(failures === 0 ? 'guide-condense test done: all passed' : 'guide-condense test done: FAILURES=' + failures);
