// CRNA Hub — assistant-guided portal navigation tests (Nov 6, 2026).
// Run: node test-portal-guided-nav.js
//
// Caleb approved building the portal check as assistant-guided
// navigation: after sign-in, the assistant names the exact page it
// needs per portal, reads each page the user shows it, checks fields
// off as they land, advances to the next needed page, re-asks BY NAME
// when a page gives nothing new (wrong page), and only presents the
// preview report when the record is complete — nothing saved before
// approval. The engine's input is "pages shown to the assistant",
// which is what the finished native app's in-app browser will feed
// it automatically after the system sign-in sheet returns.
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
sandbox.window.open = () => null;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
// submitPortalCheck builds a FormData from the form element; the
// fake forms here carry their entries on _entries, which the
// FakeFormData constructor reads.
const submit = async (text, extra) => {
  run(`globalThis.__form = { _entries: [['pasted', ${JSON.stringify(text)}], ...${JSON.stringify(extra || [])}], querySelector: () => null };`);
  await run(`submitPortalCheck({currentTarget: globalThis.__form})`);
};

// --- 1. Navigation maps exist for all three sources and start right.
run(`
  globalThis.__maps = Object.fromEntries(['nbcrna','aana','licenses'].map(k => [k, { pages: portalNavMap(k).pages.length, first: portalNavMap(k).pages[0].direction, required: portalNavMap(k).required }]));
`);
t('NBCRNA map: record page then CPC progress page, status + period end required',
  sandbox.__maps.nbcrna.pages === 2 &&
  sandbox.__maps.nbcrna.first.includes('certification record') &&
  sandbox.__maps.nbcrna.required.includes('status') &&
  sandbox.__maps.nbcrna.required.includes('periodEnd'));
t('AANA map: membership page then CE transcript, status + expiration required',
  sandbox.__maps.aana.pages === 2 &&
  sandbox.__maps.aana.first.includes('My AANA Membership Information') &&
  sandbox.__maps.aana.required.includes('expiration'));
t('State licenses map: one lookup-result page, status + expiry required',
  sandbox.__maps.licenses.pages === 1 &&
  sandbox.__maps.licenses.first.includes('WV Board License Lookup') &&
  sandbox.__maps.licenses.first.includes('Ohio eLicense') &&
  sandbox.__maps.licenses.required.includes('expiry'));

(async () => {
  // --- 2. NBCRNA guided walk: page 1 fills part of the checklist and
  //        advances to the CPC progress page by name.
  run(`
    db.nbcrna = {status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'};
    db.portalChecks = []; db.portalMonitoring = [];
    startPortalCheck('nbcrna');
    globalThis.__step1 = portalCheckHTML();
  `);
  t('step 1 names the exact page needed, in one line',
    sandbox.__step1.includes('NBCRNA — step 1 of 2') &&
    sandbox.__step1.includes('Open your certification record on your timeline — that’s the page I need.') &&
    sandbox.__step1.includes('Your record so far') &&
    sandbox.__step1.includes('○ Certification status'));

  await submit('NBCRNA Certification Record. Certification status: Certified. Certification number: 126402. Certification Period: May 1, 2023 - April 30, 2027.');
  run(`
    globalThis.__afterPage1 = { step: portalCheck.step, page: portalCheck.page, status: portalCheck.fields.status, periodEnd: portalCheck.fields.periodEnd, saved: db.nbcrna.status };
    globalThis.__step2 = portalCheckHTML();
  `);
  t('page 1 read: fields checked off, flow advances to the CPC progress page',
    sandbox.__afterPage1.step === 'collect' &&
    sandbox.__afterPage1.page === 1 &&
    sandbox.__afterPage1.status === 'Certified' &&
    sandbox.__afterPage1.periodEnd === '2027-04-30');
  t('step 2 asks for the next page by name and shows what is already found',
    sandbox.__step2.includes('Now open your CPC / MAC progress — the page showing MAC Check, MAC Ed and MAC Dev — that’s the page I need.') &&
    sandbox.__step2.includes('✓ Certification status — got it') &&
    sandbox.__step2.includes('○ MAC Ed credits'));
  t('nothing saved mid-walk', sandbox.__afterPage1.saved === '');

  // --- 3. Wrong page: nothing new -> one-line re-ask by name, no advance.
  await submit('Welcome to the NBCRNA portal home. News and announcements for certificants.');
  run(`
    globalThis.__wrong = { step: portalCheck.step, page: portalCheck.page, err: portalCheckError, html: portalCheckHTML() };
  `);
  t('wrong page re-asks for the right page by name, in one line, and does not advance',
    sandbox.__wrong.step === 'collect' &&
    sandbox.__wrong.page === 1 &&
    sandbox.__wrong.err.includes('doesn’t show your CPC / MAC progress') &&
    sandbox.__wrong.err.includes('open your CPC / MAC progress') &&
    sandbox.__wrong.err.length < 160 &&
    !sandbox.__wrong.html.includes('Nothing was saved'));

  // --- 4. Page 2 completes the record -> preview, still unsaved.
  await submit('CPC Progress. Class A credits: 103. Class B credits: 2. MAC Ed credits: 60. MAC Dev credits: 40.');
  run(`
    globalThis.__done = { step: portalCheck.step, macEd: portalCheck.fields.macEd, classA: portalCheck.fields.classA, saved: db.nbcrna.status, html: portalCheckHTML() };
  `);
  t('final page completes the record and lands on the preview report',
    sandbox.__done.step === 'preview' &&
    sandbox.__done.macEd === '60' && sandbox.__done.classA === '103' &&
    sandbox.__done.html.includes('Preview — NBCRNA portal check') &&
    sandbox.__done.html.includes('2 pages shown'));
  t('complete record still saves nothing before approval', sandbox.__done.saved === '');
  run(`
    globalThis.__approveForm = { _entries: [['source','nbcrna'],['status','Certified'],['number','126402'],['periodStart','2023-05-01'],['periodEnd','2027-04-30'],['renewalDeadline','2027-04-30'],['classA','103'],['classB','2'],['macEd','60'],['macDev','40']] };
    approvePortalCheck({currentTarget: globalThis.__approveForm});
  `);
  t('approval saves the guided record with assistant provenance',
    run(`db.nbcrna.status`) === 'Certified' && run(`db.nbcrna.source`) === 'assistant_portal_check');

  // --- 5. AANA walk starts at the membership page; skip reaches report.
  run(`startPortalCheck('aana'); globalThis.__aanaStep = portalCheckHTML();`);
  t('AANA flow starts at the membership page',
    sandbox.__aanaStep.includes('AANA — step 1 of 2') &&
    sandbox.__aanaStep.includes('Open your Member Dashboard, then My AANA Membership Information — that’s the page I need.'));
  await submit('AANA Membership. Membership status: Active. Membership number: 126402. Membership expiration: June 30, 2027.');
  run(`actions('portal-guide-skip'); globalThis.__aanaDone = { step: portalCheck.step, status: portalCheck.fields.status };`);
  t('skipping the transcript page finishes at the preview with what was found',
    sandbox.__aanaDone.step === 'preview' && sandbox.__aanaDone.status === 'Active');

  // --- 6. State licenses: single page completes in one showing.
  run(`startPortalCheck('licenses');`);
  await submit('West Virginia Board of Nursing. License status: Active. License number: 103459. License type: APRN. Issued: July 2, 2013. License expires: June 30, 2027.', [['state', 'West Virginia']]);
  run(`globalThis.__lic = { step: portalCheck.step, expiry: portalCheck.fields.expiry, type: portalCheck.fields.type, saved: (db.licenses || []).length };`);
  t('single-page portal completes straight to preview when the page has everything',
    sandbox.__lic.step === 'preview' &&
    sandbox.__lic.expiry === '2027-06-30' &&
    sandbox.__lic.type === 'APRN' &&
    sandbox.__lic.saved === 0);

  // --- 7. Single upload with everything on one page (NBCRNA) completes
  //        without being asked for page 2.
  run(`
    db.nbcrna.status = '';
    liveSyncPost = async () => { throw new Error('offline'); };
    ocrImageFile = async () => 'NBCRNA Certification Record. Certification status: Certified. Certification number: 126402. Certification Period: May 1, 2023 - April 30, 2027. Class A credits: 103. Class B credits: 2. MAC Ed credits: 60. MAC Dev credits: 40. CPC Check-In: Complete.';
    startPortalCheck('nbcrna');
    globalThis.__shotInput = { files: [{ type: 'image/png', name: 'all-in-one.png' }] };
    globalThis.__shotForm = { _entries: [['pasted','']], querySelector: (sel) => sel.includes('file') ? globalThis.__shotInput : null };
  `);
  await run(`submitPortalCheck({currentTarget: globalThis.__shotForm})`);
  t('one page with everything completes the walk in a single showing',
    run(`portalCheck && portalCheck.step`) === 'preview' &&
    run(`portalCheck && portalCheck.pagesShown`) === 1 &&
    run(`portalCheck && portalCheck.fields.macDev`) === '40' &&
    run(`portalCheck && portalCheck.fields.checkStatus`) === 'Complete');

  // --- 8. The return path from c28931c6 is untouched.
  t('return path still wired (portal-return action + connect flow)',
    fs.readFileSync(R + 'app.js', 'utf8').includes('portalConnectFlow') &&
    fs.readFileSync(R + 'app.js', 'utf8').includes('portal-guide-skip'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
