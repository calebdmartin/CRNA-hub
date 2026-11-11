// CRNA Hub — portal return path + check flow tests (Nov 6, 2026).
// Run: node test-portal-return-check.js
//
// Caleb's two reports, covered end to end without any live portal or
// API call:
//   1. "Can it redirect him back to the app after he's signed in —
//      for ALL portal logins?" Every portal Connect is ONE connect
//      flow object (portalConnectFlow): open() -> returnToApp() ->
//      the assistant check. The finished native app's open() is
//      Apple's system sign-in sheet, which returns the user
//      automatically; the web build opens a new tab, keeps the
//      window handle (opener severed), shows a persistent one-tap
//      return prompt on the card, and returnToApp() closes the
//      portal tab it opened and starts the check. No portal is left
//      without a return path.
//   2. "I signed in — check it" dropped him into a canned chat essay
//      that just repeated the instructions. Now it opens the check
//      step directly — the upload/paste panel for THAT portal — a
//      screenshot is read with the live AI (extract-contract mode
//      'portal', the same vision path as contracts), and the result
//      is presented as the preview report. Nothing is saved until
//      he approves. The canned assistant answer is one short line.
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
let lastFakeWin = null;
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
    addEventListener() {}, hidden: false,
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {}, confirm: () => true,
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.addEventListener = () => {};
sandbox.window.open = (url) => {
  openedUrls.push(String(url));
  lastFakeWin = { closed: false, opener: { portal: true }, close() { this.closed = true; } };
  sandbox.__lastWin = lastFakeWin;
  return lastFakeWin;
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const KEYS = ['nbcrna', 'aana', 'licenses'];

// --- 1. One connect flow object per portal; final-product structure.
run(`globalThis.__flows = Object.fromEntries(Object.keys(PORTAL_CHECK_SOURCES).map(k => [k, !!portalConnectFlow(k) && typeof portalConnectFlow(k).open === 'function' && typeof portalConnectFlow(k).returnToApp === 'function' ? 'full' : 'partial']));`);
t('every portal in PORTAL_CHECK_SOURCES has a full connect flow (open + returnToApp)',
  KEYS.every((k) => sandbox.__flows[k] === 'full') &&
  Object.keys(sandbox.__flows).length === KEYS.length);
t('the final native model stays the system sign-in sheet the flow drops into',
  run(`PORTAL_NATIVE_SPEC.model`) === 'system_signin_sheet' &&
  run(`PORTAL_NATIVE_SPEC.sheet`).includes('ASWebAuthenticationSession'));

// --- 2. Connect opens the portal, keeps a closeable handle, severs opener.
run(`
  openedUrls.length = 0;
  portalOpenSignIn('nbcrna');
  globalThis.__afterOpen = { urls: openedUrls.slice(), winClosed: globalThis.__lastWin.closed, openerSevered: globalThis.__lastWin.opener === null, openedFlag: !!portalOpened.nbcrna };
`);
t('Connect opens the real NBCRNA portal and keeps the window handle (opener severed)',
  sandbox.__afterOpen.urls.length === 1 && sandbox.__afterOpen.urls[0] === 'https://portal.nbcrna.com/' &&
  sandbox.__afterOpen.winClosed === false && sandbox.__afterOpen.openerSevered === true &&
  sandbox.__afterOpen.openedFlag === true);

// --- 3. EVERY portal card shows the persistent return prompt once opened.
run(`
  portalOpenSignIn('aana'); portalOpenSignIn('licenses');
  globalThis.__cred = credentialsPage();
  globalThis.__returnBtns = ['nbcrna','aana','licenses'].map(k => globalThis.__cred.includes('data-action="portal-return" data-id="' + k + '"'));
`);
t('return prompt is on every portal card once its Connect was tapped (no portal left without a return path)',
  sandbox.__cred.includes('Signed in over there?') &&
  sandbox.__returnBtns.every(Boolean) &&
  (sandbox.__cred.match(/I’m back — run my check/g) || []).length >= 3);

// --- 4. One-tap return: closes the portal tab and starts the check.
run(`
  globalThis.__winBefore = globalThis.__lastWin;
  actions('portal-return', 'licenses');
  globalThis.__afterReturn = { winClosed: globalThis.__winBefore.closed, step: portalCheck && portalCheck.step, source: portalCheck && portalCheck.source, tab };
`);
t('one-tap return closes the portal tab it opened and lands in the check step for that portal',
  sandbox.__afterReturn.winClosed === true &&
  sandbox.__afterReturn.step === 'collect' && sandbox.__afterReturn.source === 'licenses' &&
  sandbox.__afterReturn.tab === 'Assistant');

// --- 5. The check step IS the upload/paste panel — no instruction restart.
run(`
  startPortalCheck('nbcrna');
  globalThis.__collectHtml = portalCheckHTML();
  globalThis.__chatTail = (db.assistantChat || []).slice(-1)[0];
  globalThis.__chatAll = (db.assistantChat || []).map(m => m.text).join('\\n');
`);
t('check step opens the guided panel for THAT portal directly (step 1 names the page it needs)',
  sandbox.__collectHtml.includes('NBCRNA — step 1 of 2') &&
  sandbox.__collectHtml.includes('Open your certification record on your timeline — that’s the page I need.') &&
  sandbox.__collectHtml.includes('name="shotFile"') &&
  sandbox.__collectHtml.includes('name="pasted"') &&
  sandbox.__collectHtml.includes('Read it'));
t('guided step copy is one short direction line — no web-vs-native lecture',
  !sandbox.__collectHtml.includes('can’t see inside the portal’s tab') &&
  !sandbox.__collectHtml.includes('sign-in sheet hands the page back'));
t('no instruction essay anywhere: no numbered restart list, no per-source how, no canned chat essay',
  !sandbox.__collectHtml.includes('<ol') &&
  !sandbox.__collectHtml.includes('Open the portal and sign in yourself') &&
  !sandbox.__chatAll.includes('Start below') &&
  !sandbox.__chatAll.includes('I will never store your portal password'));
t('the chat line is one short pointer at the panel',
  sandbox.__chatTail.role === 'assistant' &&
  sandbox.__chatTail.text.includes('Show me the page that lists your record') &&
  sandbox.__chatTail.text.length < 220);

// --- 6. The canned assistant answer no longer recites the essay.
run(`globalThis.__answer = answerQuestion('check my NBCRNA portal');`);
t('canned portal answer is one short line pointing at the check step',
  sandbox.__answer.includes('I signed in — check it') &&
  sandbox.__answer.includes('nothing is saved until you approve') &&
  !sandbox.__answer.includes('works like this') &&
  sandbox.__answer.length < 300);

// --- 7. AI read -> extracted preview report; nothing saved before approval.
(async () => {
  run(`
    db.nbcrna = {status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'};
    db.portalChecks = []; db.portalMonitoring = [];
    cloudSession = { email: 'crna@example.com' };
    aiContractImagesDataURLs = async (files) => files.map(() => 'data:image/png;base64,AAAA');
    liveSyncPost = async (fnName, body) => {
      if (body && body.mode === 'portal' && body.portalSource === 'nbcrna') return { ok: true, mode: 'portal', portal: { status:'Certified', number:'126402', period_start:'2023-05-01', period_end:'2027-04-30', renewal_deadline:'2027-04-30', class_a:103, class_b:2, mac_ed:60, mac_dev:40, check_status:'Complete', expiration:null, license_type:null, issue_date:null, expiry:null, state:null }, raw_text: 'NBCRNA Certification Record' };
      throw new Error('unexpected fn ' + fnName);
    };
    startPortalCheck('nbcrna');
    globalThis.__shotInput = { files: [{ type: 'image/png', name: 'nbcrna-record.png' }] };
    globalThis.__shotForm = { _entries: [['pasted','']], querySelector: (sel) => sel.includes('file') ? globalThis.__shotInput : null };
  `);
  await run(`submitPortalCheck({currentTarget: globalThis.__shotForm})`);
  run(`
    globalThis.__afterShot = { step: portalCheck && portalCheck.step, via: portalCheck && portalCheck.via, status: portalCheck && portalCheck.fields.status, number: portalCheck && portalCheck.fields.number, macEd: portalCheck && portalCheck.fields.macEd, periodEnd: portalCheck && portalCheck.fields.periodEnd, savedStatus: db.nbcrna.status, savedSource: db.nbcrna.source };
    globalThis.__reportHtml = portalCheckHTML();
  `);
  t('screenshot is read with the live AI and lands on the extracted preview report',
    sandbox.__afterShot.step === 'preview' && sandbox.__afterShot.via === 'ai' &&
    sandbox.__afterShot.status === 'Certified' && sandbox.__afterShot.number === '126402' &&
    sandbox.__afterShot.macEd === '60' && sandbox.__afterShot.periodEnd === '2027-04-30');
  t('the preview is the report: it says what was found, via AI, nothing saved yet',
    sandbox.__reportHtml.includes('Preview — NBCRNA portal check') &&
    sandbox.__reportHtml.includes('read with AI from your screenshot') &&
    sandbox.__reportHtml.includes('Found:') &&
    sandbox.__reportHtml.includes('Nothing is saved until you approve below'));
  t('nothing saved before approval (record untouched by the read)',
    sandbox.__afterShot.savedStatus === '' && sandbox.__afterShot.savedSource === 'user_entered');

  // Approve the report -> now it saves, with assistant provenance.
  run(`
    globalThis.__approveForm = { _entries: [['source','nbcrna'],['status','Certified'],['number','126402'],['periodStart','2023-05-01'],['periodEnd','2027-04-30'],['renewalDeadline','2027-04-30'],['classA','103'],['classB','2'],['macEd','60'],['macDev','40']] };
    approvePortalCheck({currentTarget: globalThis.__approveForm});
    globalThis.__savedNow = { status: db.nbcrna.status, source: db.nbcrna.source };
  `);
  t('approving the report saves it as an assistant portal check',
    sandbox.__savedNow.status === 'Certified' && sandbox.__savedNow.source === 'assistant_portal_check');

  // --- 8. AI unavailable -> honest on-device fallback, still a real check.
  run(`
    liveSyncPost = async () => { throw new Error('offline'); };
    ocrImageFile = async () => 'NBCRNA Certification Record Certification status: Certified Certification number: 126402 Certification Period: May 1, 2023 - April 30, 2027';
    startPortalCheck('nbcrna');
  `);
  await run(`submitPortalCheck({currentTarget: globalThis.__shotForm})`);
  // Guided flow: the OCR'd page is only the record page (no CPC
  // credits on it), so the assistant checks those fields off and
  // advances to the CPC progress page — via=ocr, still a real check.
  t('when the AI read is unavailable the screenshot still checks via on-device OCR (via=ocr)',
    run(`portalCheck && portalCheck.step`) === 'collect' &&
    run(`portalCheck && portalCheck.page`) === 1 &&
    run(`portalCheck && portalCheck.via`) === 'ocr' &&
    run(`portalCheck && portalCheck.fields.status`) === 'Certified');
  run(`actions('portal-guide-finish')`);
  t('finishing after the OCR read shows the preview report',
    run(`portalCheck && portalCheck.step`) === 'preview');

  // --- 9. Pasted text still produces a preview report (and saves nothing).
  run(`
    db.nbcrna.status = '';
    startPortalCheck('aana');
    globalThis.__pasteForm = { _entries: [['pasted','AANA Membership Membership status: Active Membership number: 126402 Membership expiration: June 30, 2027']], querySelector: () => null };
  `);
  await run(`submitPortalCheck({currentTarget: globalThis.__pasteForm})`);
  // Guided flow (Nov 6, 2026): the membership page filled the required
  // fields, so the assistant advances to the next page it needs — the
  // CE transcript — instead of jumping straight to the report.
  t('pasted membership page advances the guided flow to the CE transcript page',
    run(`portalCheck && portalCheck.step`) === 'collect' &&
    run(`portalCheck && portalCheck.page`) === 1 &&
    run(`portalCheck && portalCheck.fields.expiration`) === '2027-06-30' &&
    run(`db.aana && db.aana.status`) !== 'Active');
  run(`actions('portal-guide-finish')`);
  t('finishing from there shows the extracted preview report (still nothing saved)',
    run(`portalCheck && portalCheck.step`) === 'preview' &&
    run(`portalCheck && portalCheck.source`) === 'aana' &&
    run(`portalCheck && portalCheck.fields.expiration`) === '2027-06-30' &&
    run(`db.aana && db.aana.status`) !== 'Active');

  // --- 10. Pure AI-merge helper: union of AI fields + raw-text parse, invents nothing.
  run(`
    globalThis.__merged = portalCheckFieldsFromAi({ status:'Certified', period_end:'2027-04-30' }, 'Certification number: 126402 Class A credits: 103', 'nbcrna');
    globalThis.__mergedEmpty = portalCheckFieldsFromAi({}, '', 'nbcrna');
  `);
  t('AI merge unions structured fields with the raw-text parse',
    sandbox.__merged.fields.status === 'Certified' &&
    sandbox.__merged.fields.number === '126402' &&
    sandbox.__merged.fields.classA === '103' &&
    sandbox.__merged.fields.periodEnd === '2027-04-30' &&
    sandbox.__merged.found.includes('MAC Ed credits') === false &&
    sandbox.__merged.missing.includes('MAC Ed credits'));
  t('an empty read stays empty (missing reported, nothing invented)',
    Object.keys(sandbox.__mergedEmpty.fields).length === 0 &&
    sandbox.__mergedEmpty.missing.includes('Certification status'));

  // --- 11. Extract-contract portal mode is wired server-side.
  const idx = fs.readFileSync(R + 'supabase/functions/extract-contract/index.ts', 'utf8');
  const norm = fs.readFileSync(R + 'supabase/functions/extract-contract/normalize.ts', 'utf8');
  t('server: extract-contract has a portal mode with a per-source prompt and normalizer',
    idx.includes('mode === "portal"') && idx.includes('portalPrompt(portalSource)') &&
    idx.includes('normalizeAiPortalCheck') && norm.includes('export function normalizeAiPortalCheck'));

  // --- 12. Cache bumped for the shell change.
  t('service worker cache bumped to v65',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v129'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
