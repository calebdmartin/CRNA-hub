// CRNA Hub — tests for the FINAL native portal sign-in rework (Nov 5, 2026).
// Run: node test-portal-signin.js
//
// Covers, without any live portal or API call:
//   * the final native design is the designed path everywhere it is shown
//     (PORTAL_NATIVE_SPEC: system sign-in sheet, Face ID, no passwords in
//     the app, preview-before-save, per-source honest status);
//   * the new-tab sign-in is ONLY a clearly-labelled preview stand-in
//     ("Preview stand-in — the finished app signs you in with the system
//     sign-in sheet", class "standin") on the Credentials tab, the
//     Assistant portal-check flow, the onboarding step, and the assistant's
//     own answer — and the final model is stated before the stand-in;
//   * Connect still opens the real portal (window.open) and "I signed in
//     — check it" still starts the assistant check;
//   * the reusable final pieces still work: deterministic portal-page
//     parsing (status, numbers, dates, CE credits — never invented),
//     preview-before-save (nothing saved until approved), provenance
//     labels, Verified only for a real pull (a verified record is never
//     downgraded by an assistant check), and monitoring cadence
//     (weekly, escalating 90/60/30/7; blocked outcomes recorded honestly).
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
  constructor(form) { this._map = new Map((form && form._entries) || []); }
  get(k) { const v = this._map.get(k); return v === undefined ? null : v; }
  *[Symbol.iterator]() { yield* this._map; }
}
const openedUrls = [];
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  FormData: FakeFormData,
  openedUrls,
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
  alert: () => {}, confirm: () => true,
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.open = (url) => { openedUrls.push(String(url)); return null; };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const STANDIN = 'Preview stand-in — the finished app signs you in with the system sign-in sheet';

// --- 1. Final native spec object: the designed path, in code.
t('spec: final model is the system sign-in sheet',
  run(`PORTAL_NATIVE_SPEC.model`) === 'system_signin_sheet' &&
  run(`PORTAL_NATIVE_SPEC.sheet`).includes('ASWebAuthenticationSession'));
t('spec: never stores portal passwords, preview-before-save',
  run(`PORTAL_NATIVE_SPEC.neverStoresPasswords`) === true &&
  run(`PORTAL_NATIVE_SPEC.previewBeforeSave`) === true);
t('spec: per-source honest status (NBCRNA unproven, AANA likely blocked, WV/OH blocked)',
  run(`PORTAL_NATIVE_SPEC.sources.nbcrna.status`) === 'unproven' &&
  run(`PORTAL_NATIVE_SPEC.sources.aana.status`) === 'likely_blocked' &&
  run(`PORTAL_NATIVE_SPEC.sources.wv.status`) === 'blocked' &&
  run(`PORTAL_NATIVE_SPEC.sources.ohio.status`) === 'blocked');
t('spec: monitoring is weekly with 90/60/30/7 escalation; public automatic, private via re-sign-in prompt',
  run(`PORTAL_NATIVE_SPEC.monitoring.baseCadenceDays`) === 7 &&
  run(`PORTAL_NATIVE_SPEC.monitoring.escalation.inside90`) === 3 &&
  run(`PORTAL_NATIVE_SPEC.monitoring.escalation.inside30`) === 2 &&
  run(`PORTAL_NATIVE_SPEC.monitoring.escalation.inside7`) === 1 &&
  run(`PORTAL_NATIVE_SPEC.monitoring.publicChecks`) === 'automatic' &&
  run(`PORTAL_NATIVE_SPEC.monitoring.privatePortals`).includes('re-sign-in prompt'));
t('spec: server owns the NBCRNA pull + blocked answers + status rows; native owns the sheet',
  run(`PORTAL_NATIVE_SPEC.serverOwns.join(' ')`).includes('NBCRNA public verification pull') &&
  run(`PORTAL_NATIVE_SPEC.nativeOwns.join(' ')`).includes('system sign-in sheet'));
t('stand-in label constant is the exact agreed wording',
  run(`PORTAL_STANDIN_LABEL`) === STANDIN);

// --- 2. Credentials tab: final model leads, stand-in is boxed and labelled.
run(`globalThis.__cred = credentialsPage();`);
t('Credentials tab states the final model (system sign-in sheet + Face ID, app never sees the password)',
  sandbox.__cred.includes('system sign-in sheet') &&
  sandbox.__cred.includes('iPhone Passwords + Face ID') &&
  sandbox.__cred.includes('the app never sees your password'));
t('Credentials tab: final model is stated BEFORE the stand-in label',
  sandbox.__cred.indexOf('system sign-in sheet') < sandbox.__cred.indexOf(STANDIN));
t('Credentials tab: stand-in is in a visually distinct .standin box with its label',
  sandbox.__cred.includes('class="standin"') &&
  sandbox.__cred.includes('<span class="standin-label">Preview stand-in</span>') &&
  sandbox.__cred.includes(STANDIN));
t('Credentials tab: each Connect card states its final-design status honestly',
  sandbox.__cred.includes('Final-design status:') &&
  sandbox.__cred.includes('<strong>unproven</strong>') &&
  sandbox.__cred.includes('<strong>likely_blocked</strong>') &&
  sandbox.__cred.includes('<strong>blocked</strong>'));
t('Credentials tab: Connect / check-it / Safari actions still present on every card',
  sandbox.__cred.includes('Connect NBCRNA — open portal') &&
  sandbox.__cred.includes('Connect AANA — open portal') &&
  sandbox.__cred.includes('Connect State Licenses — open portal') &&
  (sandbox.__cred.match(/I signed in — check it/g) || []).length >= 3 &&
  sandbox.__cred.includes('Open in Safari'));
t('Credentials tab: no portal password field anywhere',
  !sandbox.__cred.includes('type="password"') && !sandbox.__cred.includes('name="password"'));
t('Credentials tab: records are labelled by source; the rest is user-entered, not verified',
  sandbox.__cred.includes('user-entered, not verified'));

// --- 3. Connect still opens the real portal; check-it still starts the assistant check.
run(`
  openedUrls.length = 0;
  portalOpenSignIn('nbcrna');
  globalThis.__openedNbcrna = openedUrls.slice();
  portalOpenSignIn('aana');
  globalThis.__openedAana = openedUrls.slice();
  globalThis.__portalOpened = Object.assign({}, portalOpened);
  startPortalCheck('nbcrna');
  globalThis.__checkStep = portalCheck ? portalCheck.step : '';
  globalThis.__checkSource = portalCheck ? portalCheck.source : '';
  globalThis.__assistantHtml = portalCheckHTML();
`);
t('Connect NBCRNA opens the real NBCRNA portal URL in a new tab',
  sandbox.__openedNbcrna.length === 1 && sandbox.__openedNbcrna[0] === 'https://portal.nbcrna.com/');
t('Connect AANA opens the real AANA login URL in a new tab',
  sandbox.__openedAana.length === 2 && sandbox.__openedAana[1] === 'https://www.aana.com/login');
t('"I signed in — check it" starts the assistant check (intro step, NBCRNA)',
  sandbox.__checkStep === 'intro' && sandbox.__checkSource === 'nbcrna');
t('portal-check intro step states the per-source final flow and labels the stand-in',
  sandbox.__assistantHtml.includes('system sign-in sheet') &&
  sandbox.__assistantHtml.includes(STANDIN) &&
  sandbox.__assistantHtml.includes('class="standin"') &&
  sandbox.__assistantHtml.includes('MAC Ed / MAC Dev'));
t('portal-check intro step: final flow is stated before the stand-in',
  sandbox.__assistantHtml.indexOf('system sign-in sheet') < sandbox.__assistantHtml.indexOf(STANDIN));

// --- 4. Assistant tab intro + assistant answer: final first, stand-in labelled.
run(`portalCheck = null; globalThis.__portalIntro = portalCheckHTML();`);
t('Assistant portal-check intro leads with the final model and boxes the stand-in',
  sandbox.__portalIntro.indexOf('system sign-in sheet') < sandbox.__portalIntro.indexOf(STANDIN) &&
  sandbox.__portalIntro.includes('class="standin"'));
run(`globalThis.__answer = answerQuestion('check my NBCRNA portal');`);
t('assistant answer describes the sheet first and labels the new tab as the stand-in',
  sandbox.__answer.includes('system sign-in sheet') &&
  sandbox.__answer.includes(STANDIN) &&
  sandbox.__answer.indexOf('system sign-in sheet') < sandbox.__answer.indexOf(STANDIN) &&
  sandbox.__answer.includes('never store a portal password') &&
  sandbox.__answer.includes('never claim a record is verified unless I actually read it'));

// --- 5. Onboarding step 4: final model first, stand-in labelled.
run(`globalThis.__step4 = onboardingSteps()[3].desc;`);
t('onboarding step 4 leads with the sheet and labels the new-tab preview as the stand-in',
  sandbox.__step4.includes('system sign-in sheet') &&
  sandbox.__step4.includes(STANDIN) &&
  sandbox.__step4.indexOf('system sign-in sheet') < sandbox.__step4.indexOf(STANDIN));

// --- 6. Deterministic portal-page parsing: reads what is there, invents nothing.
run(`
  globalThis.__nb = parsePortalCheckText('NBCRNA Certification Record Certification status: Certified Certification number: 126402 Certification Period: May 1, 2023 - April 30, 2027 Class A credits: 103 Class B credits: 2 MAC Ed credits: 60 MAC Dev credits: 40', 'nbcrna');
  globalThis.__aa = parsePortalCheckText('AANA Membership Membership status: Active Membership number: 126402 Membership expiration: June 30, 2027', 'aana');
  globalThis.__lic = parsePortalCheckText('West Virginia Board of Nursing License Verification License status: Active APRN License number: RN86131 Issue date: July 2, 2013 Expiration date: June 30, 2028', 'licenses');
  globalThis.__thin = parsePortalCheckText('Certification status: Certified', 'nbcrna');
`);
t('NBCRNA page parses status, number, period, and CE/MAC credits',
  sandbox.__nb.fields.status === 'Certified' &&
  sandbox.__nb.fields.number === '126402' &&
  sandbox.__nb.fields.periodStart === '2023-05-01' &&
  sandbox.__nb.fields.periodEnd === '2027-04-30' &&
  sandbox.__nb.fields.renewalDeadline === '2027-04-30' &&
  sandbox.__nb.fields.classA === '103' && sandbox.__nb.fields.classB === '2' &&
  sandbox.__nb.fields.macEd === '60' && sandbox.__nb.fields.macDev === '40');
t('AANA page parses status, number, and expiration',
  sandbox.__aa.fields.status === 'Active' &&
  sandbox.__aa.fields.number === '126402' &&
  sandbox.__aa.fields.expiration === '2027-06-30');
t('license page parses status, type, number, issue, and expiration',
  sandbox.__lic.fields.status === 'Active' &&
  sandbox.__lic.fields.type === 'APRN' &&
  sandbox.__lic.fields.number === 'RN86131' &&
  sandbox.__lic.fields.issue === '2013-07-02' &&
  sandbox.__lic.fields.expiry === '2028-06-30');
t('a thin page leaves unread fields blank (missing listed, never invented)',
  sandbox.__thin.fields.status === 'Certified' &&
  !('number' in sandbox.__thin.fields) && !('macEd' in sandbox.__thin.fields) &&
  sandbox.__thin.missing.includes('License / certification number') &&
  sandbox.__thin.missing.includes('MAC Ed credits'));

// --- 7. Preview-before-save: nothing is saved until the user approves.
(async () => {
  run(`
    db.nbcrna = {status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'};
    db.aana = {status:'',number:'',expiration:'',docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'};
    db.licenses = []; db.portalChecks = []; db.portalMonitoring = [];
    portalCheck = null;
    startPortalCheck('nbcrna');
    globalThis.__beforeSubmit = { status: db.nbcrna.status, source: db.nbcrna.source };
  `);
  const pasted = 'NBCRNA Certification Record Certification status: Certified Certification number: 126402 Certification Period: May 1, 2023 - April 30, 2027 Class A credits: 103 Class B credits: 2 MAC Ed credits: 60 MAC Dev credits: 40';
  run(`globalThis.__fakeForm = { _entries: [['pasted', ${JSON.stringify(pasted)}]], querySelector: () => null };`);
  await run(`submitPortalCheck({currentTarget: globalThis.__fakeForm})`);
  t('starting a check saves nothing', sandbox.__beforeSubmit.status === '' && sandbox.__beforeSubmit.source === 'user_entered');
  t('reading the page builds a preview and still saves nothing',
    run(`portalCheck && portalCheck.step`) === 'preview' && run(`db.nbcrna.status`) === '');
  run(`globalThis.__previewHtml = portalCheckHTML();`);
  t('preview shows what was found, says nothing is saved until approved, and names the source on save',
    sandbox.__previewHtml.includes('Preview — NBCRNA portal check') &&
    sandbox.__previewHtml.includes('Nothing is saved until you approve below') &&
    sandbox.__previewHtml.includes('assistant portal check — read from the page you provided, not a server portal pull'));

  // Approve the preview: now it saves, labelled assistant_portal_check.
  run(`
    globalThis.__approveForm = { _entries: [['source','nbcrna'],['status','Certified'],['number','126402'],['periodStart','2023-05-01'],['periodEnd','2027-04-30'],['renewalDeadline','2027-04-30'],['classA','103'],['classB','2'],['macEd','60'],['macDev','40']] };
    approvePortalCheck({currentTarget: globalThis.__approveForm});
    globalThis.__saved = { status: db.nbcrna.status, number: db.nbcrna.number, source: db.nbcrna.source, macEd: db.nbcrna.macEd };
    globalThis.__savedLabel = portalSourceLabel(db.nbcrna.source, '');
    globalThis.__checkAfterApprove = portalCheck;
  `);
  t('approving the preview saves the checked record with assistant-portal-check provenance',
    sandbox.__saved.status === 'Certified' && sandbox.__saved.number === '126402' &&
    sandbox.__saved.source === 'assistant_portal_check' && sandbox.__saved.macEd === '60');
  t('provenance label says the record was read from the page shown, not a server pull',
    sandbox.__savedLabel.includes('Assistant portal check') && !sandbox.__savedLabel.includes('Verified'));
  t('approved check clears the in-progress check', sandbox.__checkAfterApprove === null);

  // A verified record is NEVER downgraded by a later assistant check.
  run(`
    db.nbcrna.source = 'public_verification';
    startPortalCheck('nbcrna');
    portalCheck = {source:'nbcrna',state:'West Virginia',step:'preview',fields:{status:'Certified',number:'126402',periodStart:'2023-05-01',periodEnd:'2027-04-30',renewalDeadline:'2027-04-30',classA:'103',classB:'2',macEd:'60',macDev:'40'},found:[],missing:[],retrievedAt:cloudNow(),via:'pasted'};
    approvePortalCheck({currentTarget: globalThis.__approveForm});
    globalThis.__keptSource = db.nbcrna.source;
    globalThis.__keptLabel = portalSourceLabel(db.nbcrna.source, '');
  `);
  t('a server-verified record keeps its Verified source after an assistant check',
    sandbox.__keptSource === 'public_verification' &&
    sandbox.__keptLabel.includes('Verified — NBCRNA public lookup'));

  // --- 8. Monitoring: cadence escalates near renewal; blocked is recorded honestly.
  const isoIn = (days) => {
    const d = new Date(); d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  run(`
    db.nbcrna.renewalDeadline = '${isoIn(200)}';
    globalThis.__cadFar = monitorCadence({source:'nbcrna',cadenceDays:7});
    db.nbcrna.renewalDeadline = '${isoIn(60)}';
    globalThis.__cad90 = monitorCadence({source:'nbcrna',cadenceDays:7});
    db.nbcrna.renewalDeadline = '${isoIn(20)}';
    globalThis.__cad30 = monitorCadence({source:'nbcrna',cadenceDays:7});
    db.nbcrna.renewalDeadline = '${isoIn(5)}';
    globalThis.__cad7 = monitorCadence({source:'nbcrna',cadenceDays:7});
    db.nbcrna.renewalDeadline = '${isoIn(-3)}';
    globalThis.__cadExp = monitorCadence({source:'nbcrna',cadenceDays:7});
    db.portalMonitoring = [];
    ensurePortalMonitoring();
    globalThis.__mons = db.portalMonitoring.map(m => m.key);
    recordMonitorCheck('nbcrna','blocked','NBCRNA public check could not run: submit endpoint unavailable','public');
    globalThis.__blocked = (db.portalMonitoring.find(m => m.key === 'nbcrna') || {}).lastOutcome;
    globalThis.__blockedLabel = monitorOutcomeLabel('blocked');
    globalThis.__dueNew = monitorIsDue({key:'nbcrna',source:'nbcrna',enabled:true,lastChecked:''}, localDate(new Date()));
    globalThis.__monHtml = portalMonitoringHTML();
  `);
  t('monitoring cadence: weekly far out, 3 days inside 90, 2 inside 30, daily inside 7 / expired',
    sandbox.__cadFar === 7 && sandbox.__cad90 === 3 && sandbox.__cad30 === 2 &&
    sandbox.__cad7 === 1 && sandbox.__cadExp === 1);
  t('monitoring covers NBCRNA + AANA by default',
    sandbox.__mons.includes('nbcrna') && sandbox.__mons.includes('aana'));
  t('a blocked check is recorded as blocked — never faked as verified',
    sandbox.__blocked === 'blocked' &&
    sandbox.__blockedLabel === 'Blocked — automation not allowed');
  t('a never-checked monitor is due now',
    sandbox.__dueNew === true);
  t('monitoring panel states the schedule, the re-sign-in prompt, and the preview background limit',
    sandbox.__monHtml.includes('weekly by default') &&
    sandbox.__monHtml.includes('prompts you to sign in when due') &&
    sandbox.__monHtml.includes('never silently logs in') &&
    sandbox.__monHtml.includes('cannot run checks in the background while it is closed'));

  console.log(failures === 0 ? '\nAll portal-sign-in tests passed.' : `\n${failures} test(s) failed.`);
})().catch((e) => { console.error('TEST ERROR', e); process.exitCode = 1; });
