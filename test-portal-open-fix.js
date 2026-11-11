// CRNA Hub — portal Connect navigation fix tests (Nov 6, 2026).
// Run: node test-portal-open-fix.js
//
// Caleb's report: tapping portal sign-in did NOT open a new tab — it
// redirected the CURRENT tab to the portal, so he lost the app and
// could not see how to show the AI the page it needs. Root cause: the
// old Connect was a <button> whose handler called window.open — in a
// single-window app (home-screen / standalone, in-app webviews) iOS
// loads a script-opened window into the app's only window. The fix:
// Connect is a real <a href target="_blank"> the browser opens, the
// flow runs inside the tap (synchronous window.open in a tabbed
// browser; hands-off in standalone so the link opens outside the
// app), a blocked popup NEVER navigates the app tab (a pre-leaving
// sheet shows first and leaving is its own explicit tap), the guided
// step itself says how to show the page from a phone, and the
// in-progress check is persisted so leaving/returning resumes it.
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
class FakeFormData {
  constructor(form) { this._map = new Map((form && form._entries) || []); }
  get(k) { const v = this._map.get(k); return v === undefined ? null : v; }
  *[Symbol.iterator]() { yield* this._map; }
}
function makeSandbox() {
  const elements = {};
  const openedUrls = [];
  const navAssign = [];
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
    window: null, navigator: {},
    location: { protocol: 'https:', search: '', pathname: '/', href: 'https://crna-hub.example/', assign: (u) => navAssign.push(String(u)) },
    alert: () => {}, confirm: () => true,
    fetch: async () => { throw new Error('network-stub'); },
    history: { replaceState() {} },
    __openedUrls: openedUrls, __navAssign: navAssign,
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.window.addEventListener = () => {};
  sandbox.window.open = (url) => {
    openedUrls.push(String(url));
    return { closed: false, opener: { portal: true }, close() { this.closed = true; } };
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  return sandbox;
}
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

const A = makeSandbox();
const runA = (code) => vm.runInContext(code, A);

// --- 1. Connect is a real anchor the browser opens as a new tab ---
runA(`globalThis.__cred = credentialsPage();`);
t('Connect is a real <a href target="_blank"> for every portal (browser-native new tab)',
  ['nbcrna', 'aana', 'licenses'].every((k) => A.__cred.includes('data-portal-connect="' + k + '"')) &&
  A.__cred.includes('href="https://portal.nbcrna.com/" target="_blank"') &&
  A.__cred.includes('Connect NBCRNA — open portal'));
t('no script-redirect Connect button remains',
  !A.__cred.includes('data-action="connect-portal"'));

// --- 2. Tabbed browser: tap opens the tab, app tab never navigates ---
runA(`
  globalThis.__ev = { prevented: false, preventDefault() { this.prevented = true; } };
  globalThis.__openResult = portalConnectFlow('nbcrna').open(globalThis.__ev);
  globalThis.__after = { urls: globalThis.__openedUrls.slice(), assign: globalThis.__navAssign.slice(), href: location.href, openedFlag: !!portalOpened.nbcrna, prevented: globalThis.__ev.prevented };
`);
t('tap opens the portal in a new tab via the synchronous open, link navigation cancelled',
  A.__openResult === 'tab' && A.__after.urls.length === 1 && A.__after.urls[0] === 'https://portal.nbcrna.com/' && A.__after.prevented === true);
t('the app tab is never navigated when a new tab opens (no assign, no href change)',
  A.__after.assign.length === 0 && A.__after.href === 'https://crna-hub.example/' && A.__after.openedFlag === true);

// --- 3. Popup blocked: pre-leaving sheet, navigation only on explicit tap ---
runA(`
  window.open = () => null;
  globalThis.__ev2 = { prevented: false, preventDefault() { this.prevented = true; } };
  globalThis.__blockedResult = portalConnectFlow('aana').open(globalThis.__ev2);
  globalThis.__sheetHtml = credentialsPage();
  globalThis.__blockedState = { sheet: portalLeaveSheet, assign: globalThis.__navAssign.slice(), href: location.href, openedFlag: !!portalOpened.aana, prevented: globalThis.__ev2.prevented };
`);
t('blocked popup: open reports blocked and the app tab does NOT navigate',
  A.__blockedResult === 'blocked' && A.__blockedState.assign.length === 0 && A.__blockedState.href === 'https://crna-hub.example/' && A.__blockedState.openedFlag === false);
t('pre-leaving sheet shows: leaving the app, the two things to do, the app stays here',
  A.__blockedState.sheet === 'aana' &&
  A.__sheetHtml.includes('One sec — the portal opens outside CRNA Hub') &&
  A.__sheetHtml.includes('sign in, then screenshot the page that shows your record') &&
  A.__sheetHtml.includes('CRNA Hub stays right here') &&
  A.__sheetHtml.includes('picks up where you left off') &&
  A.__sheetHtml.includes('data-action="portal-leave-go" data-id="aana"'));
runA(`
  actions('portal-leave-cancel');
  globalThis.__afterCancel = { sheet: portalLeaveSheet, assign: globalThis.__navAssign.slice() };
`);
t('"Not now" dismisses the sheet and still nothing navigates',
  A.__afterCancel.sheet === '' && A.__afterCancel.assign.length === 0);
runA(`
  portalLeaveSheet = 'aana'; render();
  actions('portal-leave-go', 'aana');
  globalThis.__afterGo = { sheet: portalLeaveSheet, assign: globalThis.__navAssign.slice(), openedFlag: !!portalOpened.aana };
`);
t('explicit "Take me to AANA" tap is the only path that navigates the current tab',
  A.__afterGo.assign.length === 1 && A.__afterGo.assign[0] === 'https://www.aana.com/login' &&
  A.__afterGo.sheet === '' && A.__afterGo.openedFlag === true);

// --- 4. Standalone / home-screen app: the real link is left alone ---
runA(`
  window.matchMedia = (q) => ({ matches: /standalone|fullscreen/.test(q) });
  globalThis.__ev3 = { prevented: false, preventDefault() { this.prevented = true; } };
  globalThis.__urlsBefore = globalThis.__openedUrls.length;
  globalThis.__saResult = portalConnectFlow('licenses').open(globalThis.__ev3);
  globalThis.__saState = { urls: globalThis.__openedUrls.length, assign: globalThis.__navAssign.slice(), prevented: globalThis.__ev3.prevented, openedFlag: !!portalOpened.licenses };
  delete window.matchMedia;
`);
t('standalone app: open() does not hijack the tap — no script open, no navigation, state recorded for the link',
  A.__saResult === 'link' && A.__saState.urls === A.__urlsBefore && A.__saState.assign.length === 1 &&
  A.__saState.prevented === false && A.__saState.openedFlag === true);

// --- 5. The guided step itself says how to show the page from a phone ---
runA(`
  startPortalCheck('nbcrna');
  globalThis.__collectHtml = portalCheckHTML();
`);
t('current step carries the phone guidance in the step (screenshot, come back, upload; paste alternative)',
  A.__collectHtml.includes('screenshot that page over there, come back to this tab, then upload it below') &&
  A.__collectHtml.includes("Paste the page's text below instead") &&
  A.__collectHtml.includes('Open your certification record on your timeline — that’s the page I need.'));

(async () => {
  // --- 6. Guided state survives a full reload and resumes mid-check ---
  runA(`globalThis.__form = { _entries: [['pasted', 'NBCRNA Certification Record. Certification status: Certified. Certification number: 126402. Certification Period: May 1, 2023 - April 30, 2027.']], querySelector: () => null };`);
  await runA(`submitPortalCheck({currentTarget: globalThis.__form})`);
  runA(`globalThis.__mid = { step: portalCheck.step, page: portalCheck.page, pagesShown: portalCheck.pagesShown, stored: !!localStorage.getItem('crna-hub-portal-check') };`);
  t('mid-check state is persisted (page 1 read, advanced to page 2)',
    A.__mid.step === 'collect' && A.__mid.page === 1 && A.__mid.pagesShown === 1 && A.__mid.stored === true);

  const B = makeSandbox(); // same localStorage store, brand-new page load
  const runB = (code) => vm.runInContext(code, B);
  runB(`
    globalThis.__restored = portalCheck ? { source: portalCheck.source, step: portalCheck.step, page: portalCheck.page, pagesShown: portalCheck.pagesShown, status: portalCheck.fields.status, periodEnd: portalCheck.fields.periodEnd } : null;
    globalThis.__restoredHtml = portalCheckHTML();
    globalThis.__restoredCred = credentialsPage();
  `);
  t('after a full reload the check resumes at the same step with its fields intact',
    B.__restored && B.__restored.source === 'nbcrna' && B.__restored.step === 'collect' &&
    B.__restored.page === 1 && B.__restored.pagesShown === 1 &&
    B.__restored.status === 'Certified' && B.__restored.periodEnd === '2027-04-30');
  t('resumed check shows step 2 asking for the CPC progress page',
    B.__restoredHtml.includes('NBCRNA — step 2 of 2') && B.__restoredHtml.includes('CPC / MAC progress'));
  t('opened-portal state also survives the reload (return prompt still waiting)',
    B.__restoredCred.includes('data-action="portal-return" data-id="aana"'));
  runB(`actions('portal-check-cancel'); globalThis.__cleared = !portalCheck && JSON.parse(localStorage.getItem('crna-hub-portal-check') || '{}').check === null;`);
  t('cancelling the check clears the persisted check (opened-portal prompts stay)', B.__cleared === true);

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
})();
