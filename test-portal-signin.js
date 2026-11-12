// CRNA Hub — tests for the portal sign-in / check model.
// Run: node test-portal-signin.js
//
// Nov 12, 2026 (v142): the model is the AGENT READ (Caleb's direction:
// "Do it the same way you do it for me now") — PORTAL_AGENT_SPEC
// supersedes the Nov 5 PORTAL_NATIVE_SPEC (system sign-in sheet +
// server pull) pins below; they were rewritten in place, reasons in
// the section comments. The server-pull model was a proven dead end
// (NBCRNA submit 404s, AANA SSO bot-gated, WV/OH block automation);
// an agent reading the portal in the user's own signed-in browser
// session is the working shape.
//
// Covers, without any live portal or API call:
//   * the agent-read design is the designed path everywhere it is shown
//     (PORTAL_AGENT_SPEC: agent reads in the user's signed-in session,
//     no passwords in the app, only a 'read' verifies, per-source
//     honest status, page paths as data);
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

// --- 1. Agent-read spec object: the designed path, in code.
// (Supersedes the Nov 5 PORTAL_NATIVE_SPEC pins — v142, reason above.)
t('spec: the model is the agent read',
  run(`PORTAL_AGENT_SPEC.model`) === 'agent_read' &&
  run(`PORTAL_AGENT_SPEC.session`).includes('signs in to the portal themselves') &&
  run(`typeof PORTAL_NATIVE_SPEC`) === 'undefined');
t('spec: never stores portal passwords; only a read verifies',
  run(`PORTAL_AGENT_SPEC.neverStoresPasswords`) === true &&
  run(`PORTAL_AGENT_SPEC.onlyReadVerifies`) === true);
t('spec: the result outcomes are read / needs-sign-in / blocked / not-found, handled by applyPortalAgentRead',
  JSON.stringify(run(`PORTAL_AGENT_SPEC.outcomes`)) === JSON.stringify(['read', 'needs-sign-in', 'blocked', 'not-found']) &&
  run(`PORTAL_AGENT_SPEC.resultHandler`) === 'applyPortalAgentRead' &&
  run(`typeof applyPortalAgentRead`) === 'function');
t('spec: per-source honest status — every portal is an agent read now (no unproven / likely-blocked pull statuses)',
  run(`PORTAL_AGENT_SPEC.sources.nbcrna.status`) === 'agent_read' &&
  run(`PORTAL_AGENT_SPEC.sources.aana.status`) === 'agent_read' &&
  run(`PORTAL_AGENT_SPEC.sources.wv.status`) === 'agent_read' &&
  run(`PORTAL_AGENT_SPEC.sources.ohio.status`) === 'agent_read');
t('spec: monitoring is weekly with 90/60/30/7 escalation; a due read that needs the user raises ONE prompt per cycle',
  run(`PORTAL_AGENT_SPEC.monitoring.baseCadenceDays`) === 7 &&
  run(`PORTAL_AGENT_SPEC.monitoring.escalation.inside90`) === 3 &&
  run(`PORTAL_AGENT_SPEC.monitoring.escalation.inside30`) === 2 &&
  run(`PORTAL_AGENT_SPEC.monitoring.escalation.inside7`) === 1 &&
  run(`PORTAL_AGENT_SPEC.monitoring.dueAction`).includes('ONE needs-you prompt per cycle') &&
  run(`PORTAL_AGENT_SPEC.monitoring.reads`).includes('never a silent server pull'));
t('spec: page paths are data (PORTAL_AGENT_PATHS); fallbacks are the guided check, manual routes, manual entry',
  run(`PORTAL_AGENT_SPEC.paths`) === 'PORTAL_AGENT_PATHS' &&
  run(`PORTAL_AGENT_SPEC.fallbacks.join(' ')`).includes('guided check') &&
  run(`PORTAL_AGENT_SPEC.fallbacks.join(' ')`).includes('manual entry'));
t('stand-in label constant is GONE (Nov 6 sweep)',
  run(`typeof PORTAL_STANDIN_LABEL`) === 'undefined');

// --- 2. Credentials tab: clean Connect cards, no scaffolding (Nov 6 sweep).
run(`globalThis.__cred = credentialsPage();`);
t('Credentials tab: Connect cards carry only the clean sign-in line (no final-model essay)',
  sandbox.__cred.includes('Sign in on the portal') &&
  sandbox.__cred.includes('We never ask for your portal password') &&
  !sandbox.__cred.includes('system sign-in sheet') && !sandbox.__cred.includes('Face ID'));
t('Credentials tab: no stand-in label or box anywhere',
  !sandbox.__cred.includes('standin') && !sandbox.__cred.includes(STANDIN));
t('Credentials tab: no final-design status readout on any card',
  !sandbox.__cred.includes('Final-design status:') &&
  !sandbox.__cred.includes('<strong>unproven</strong>') &&
  !sandbox.__cred.includes('<strong>likely_blocked</strong>'));
// (v147 rewrite — State Licenses is per-state: with no states on
// the card yet there is no Connect button at all, just the state
// picker; the generic "Connect State Licenses" button is gone for
// good. Per-state Connect pins live in test-v147-state-picker.js.)
t('Credentials tab: Connect / check-it / Safari actions still present on every card',
  sandbox.__cred.includes('Connect NBCRNA — open portal') &&
  sandbox.__cred.includes('Connect AANA — open portal') &&
  !sandbox.__cred.includes('Connect State Licenses — open portal') &&
  sandbox.__cred.includes('id="licStatePicker"') &&
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
t('"I signed in — check it" opens the check step directly (collect step, NBCRNA) — Nov 6 flow fix',
  sandbox.__checkStep === 'collect' && sandbox.__checkSource === 'nbcrna');
t('collect step is the guided panel for that portal (names the page it needs), not an instruction restart',
  sandbox.__assistantHtml.includes('Open your certification record on your timeline — that’s the page I need.') &&
  sandbox.__assistantHtml.includes('name="shotFile"') &&
  sandbox.__assistantHtml.includes('name="pasted"') &&
  sandbox.__assistantHtml.includes('Read it') &&
  !sandbox.__assistantHtml.includes('<ol') &&
  !sandbox.__assistantHtml.includes('Open the portal and sign in yourself') &&
  !sandbox.__assistantHtml.includes(STANDIN) && !sandbox.__assistantHtml.includes('standin'));

// --- 4. Assistant tab intro + assistant answer: final first, stand-in labelled.
run(`portalCheck = null; globalThis.__portalIntro = portalCheckHTML();`);
t('Assistant portal-check intro is one clean line + Check buttons, no scaffolding',
  sandbox.__portalIntro.includes('Sign in on the portal') &&
  !sandbox.__portalIntro.includes('system sign-in sheet') &&
  !sandbox.__portalIntro.includes(STANDIN) && !sandbox.__portalIntro.includes('standin'));
run(`globalThis.__answer = answerQuestion('check my NBCRNA portal');`);
// (v143 rewrite — the answer now points at the primary path: Connect
// → sign in on the portal's own page → "I'm signed in — read it now".
// The old wording pointed at "I signed in — check it", the guided
// screenshot check, which is the collapsed backup now.)
t('assistant answer is ONE short line pointing at the read-it-now step (canned essay gone — Nov 6)',
  !sandbox.__answer.includes('system sign-in sheet') &&
  !sandbox.__answer.includes(STANDIN) &&
  sandbox.__answer.includes('read it now') &&
  sandbox.__answer.includes('signed-in session') &&
  sandbox.__answer.includes('nothing is saved until you approve') &&
  sandbox.__answer.length < 300);

// --- 5. Onboarding step 4: one-line direction; the final model +
// stand-in labelling live on the Credentials page (the destination).
run(`globalThis.__step4 = onboardingSteps()[3]; globalThis.__credPage = credentialsPage();`);
t('onboarding step 4 direction is one short line: connect, sign in on the portal page, no password here',
  sandbox.__step4.direction.includes('Connect NBCRNA, AANA, and your state licenses') &&
  sandbox.__step4.direction.includes('never a password here'));
t('Credentials page (step 4 destination) carries no scaffolding at all',
  !sandbox.__credPage.includes('system sign-in sheet') &&
  !sandbox.__credPage.includes(STANDIN) && !sandbox.__credPage.includes('standin'));

// --- 6. Deterministic portal-page parsing: reads what is there, invents nothing.
run(`
  globalThis.__nb = parsePortalCheckText('NBCRNA Certification Record Certification status: Certified Certification number: 126402 Certification Period: May 1, 2023 - April 30, 2027 Class A credits: 103 Class B credits: 2 MAC Ed credits: 60 MAC Dev credits: 40 CPC Check-In: Complete', 'nbcrna');
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
  const pasted = 'NBCRNA Certification Record Certification status: Certified Certification number: 126402 Certification Period: May 1, 2023 - April 30, 2027 Class A credits: 103 Class B credits: 2 MAC Ed credits: 60 MAC Dev credits: 40 CPC Check-In: Complete';
  run(`globalThis.__fakeForm = { _entries: [['pasted', ${JSON.stringify(pasted)}]], querySelector: () => null };`);
  await run(`submitPortalCheck({currentTarget: globalThis.__fakeForm})`);
  t('starting a check saves nothing', sandbox.__beforeSubmit.status === '' && sandbox.__beforeSubmit.source === 'user_entered');
  t('reading the page builds a preview and still saves nothing',
    run(`portalCheck && portalCheck.step`) === 'preview' && run(`db.nbcrna.status`) === '');
  run(`globalThis.__previewHtml = portalCheckHTML();`);
  t('preview shows what was found and says nothing is saved until approved',
    sandbox.__previewHtml.includes('Preview — NBCRNA portal check') &&
    sandbox.__previewHtml.includes('Nothing is saved until you approve below') &&
    sandbox.__previewHtml.includes('Found:'));

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
  // (v142 relabel: the legacy public_verification source now reads
  // "Verified — NBCRNA portal read"; the record itself is never downgraded.)
  t('a portal-verified record keeps its Verified source after an assistant check',
    sandbox.__keptSource === 'public_verification' &&
    sandbox.__keptLabel.includes('Verified — NBCRNA portal read'));

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
    recordMonitorCheck('nbcrna','blocked','NBCRNA agent read could not run: the portal refused the read (captcha)','agent_read');
    globalThis.__blocked = (db.portalMonitoring.find(m => m.key === 'nbcrna') || {}).lastOutcome;
    globalThis.__blockedLabel = monitorOutcomeLabel('blocked');
    // v149: due-ness now also reads the verified-read evidence (the
    // cards' source) — a source with a fresh verified read is NOT due
    // even when its legacy entry was never stamped. This pin is about
    // a monitor with NO check evidence at all, so the verified stamp
    // from §7's read is cleared to restore that premise.
    const savedNbcrnaSync = cloudSyncTimes.nbcrna; cloudSyncTimes.nbcrna = '';
    globalThis.__dueNew = monitorIsDue({key:'nbcrna',source:'nbcrna',enabled:true,lastChecked:''}, localDate(new Date()));
    cloudSyncTimes.nbcrna = savedNbcrnaSync;
    globalThis.__monHtml = portalMonitoringHTML();
  `);
  t('monitoring cadence: weekly far out, 3 days inside 90, 2 inside 30, daily inside 7 / expired',
    sandbox.__cadFar === 7 && sandbox.__cad90 === 3 && sandbox.__cad30 === 2 &&
    sandbox.__cad7 === 1 && sandbox.__cadExp === 1);
  t('monitoring covers NBCRNA + AANA by default',
    sandbox.__mons.includes('nbcrna') && sandbox.__mons.includes('aana'));
  // (v142 relabel: blocked now reads plainly as "Couldn’t read".)
  t('a blocked check is recorded as blocked — never faked as verified',
    sandbox.__blocked === 'blocked' &&
    sandbox.__blockedLabel === 'Couldn’t read');
  t('a never-checked monitor is due now',
    sandbox.__dueNew === true);
  t('monitoring panel is one clean line: checks run on their own every 7 days, faster near renewal, no password stored; no preview-limit scaffolding',
    sandbox.__monHtml.includes('every 7 days — faster near renewal') &&
    sandbox.__monHtml.includes('never store a portal password') &&
    !sandbox.__monHtml.includes('Web-preview limit') &&
    !sandbox.__monHtml.includes('finished app'));

  console.log(failures === 0 ? '\nAll portal-sign-in tests passed.' : `\n${failures} test(s) failed.`);
})().catch((e) => { console.error('TEST ERROR', e); process.exitCode = 1; });
