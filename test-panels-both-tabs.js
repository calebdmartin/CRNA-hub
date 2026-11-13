// CRNA Hub — tests for the QGenda + Upload a schedule dual home
// (Nov 7, 2026, branch muse/credentialing). Run: node test-panels-both-tabs.js
//
// Caleb's call: the QGenda panel and the Upload a schedule panel stay
// on the Account tab AND are also reachable from the Facilities tab.
// They are the same shared components (qgendaFeedHTML /
// scheduleImportHTML), not copies: the app renders one tab at a time,
// so a single rendered page never carries duplicate ids, the connect
// form / upload preview state is the same object whichever tab shows
// it, and the QGenda feature toggle collapses the panel in both
// homes. Live calendar sync and Backup & restore stay Account-only.
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
  constructor(form) { this._map = (form && form._map) || {}; this._e = (form && form._entries) || []; }
  get(k) { return k in this._map ? this._map[k] : null; }
  *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; }
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
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {},
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const count = (html, needle) => html.split(needle).length - 1;
const SESSION = `cloudSession = { access_token: 'tok', refresh_token: 'rtok', email: 'caleb@example.com' };`;
const RESET = `
  onboardStep = 0;
  liveSyncConfig = { state: 'ready', google: true, outlook: false, apple: true, encryption: true };
  liveSyncConnections = {};
  liveSyncAppleCalendars = [];
  liveSyncShowOthers = false;
  liveSyncState.pending = [];
  liveSyncLog = [];
  liveSyncError = '';
  qgendaStatusError = '';
  schedulePreview = null; scheduleImportError = ''; scheduleAiStatus = ''; scheduleImportContext = '';
  calPreview = null; calImportError = '';
  db.settings.scheduleImported = false;
  db.settings.qgendaConnected = false;
  db.settings.featureQgenda = true;
`;

(async () => {
  // ================= Facilities: both panels, once each, at the bottom =================
  run(`
    ${SESSION}
    ${RESET}
    globalThis.__fac = facilitiesPage();
  `);
  const fac = sandbox.__fac;
  t('Facilities renders the QGenda and Upload a schedule panels',
    fac.includes('<details class="panel collapse-panel" id="qgenda-panel"') &&
    fac.includes('<details class="panel collapse-panel" id="schedule-import-panel"'));
  t('Facilities: each panel and its form appear exactly once (no duplicate ids)',
    count(fac, 'id="qgenda-panel"') === 1 && count(fac, 'id="schedule-import-panel"') === 1 &&
    count(fac, 'id="qgendaForm"') === 1 && count(fac, 'id="scheduleForm"') === 1);
  t('Facilities: panel order — contract, pay stub, QGenda, upload a schedule, manual add LAST (Nov 10, 2026: manual entry is the backup path, so it sits at the bottom)',
    fac.indexOf('id="facility-contract-panel"') < fac.indexOf('id="paystub-panel"') &&
    fac.indexOf('id="paystub-panel"') < fac.indexOf('id="qgenda-panel"') &&
    fac.indexOf('id="qgenda-panel"') < fac.indexOf('id="schedule-import-panel"') &&
    fac.indexOf('id="schedule-import-panel"') < fac.indexOf('id="facility-manual-panel"'));
  t('Facilities: QGenda panel holds the real connect controls',
    fac.includes('Your QGenda Subscription URL') && fac.includes('Connect QGenda feed') &&
    fac.includes('I signed in to QGenda — use my schedule'));
  t('Facilities: upload panel holds the upload form and .ics fallback',
    fac.includes('f_scheduleFile') && fac.includes('Read schedule — preview only') &&
    fac.includes('data-action="export-cal-all"'));
  t('Facilities: live-sync and backup panels stay Account-only',
    !fac.includes('id="live-sync-panel"') && !fac.includes('id="backup-panel"'));
  t('Facilities: fresh user defaults match Account (upload open, QGenda collapsed)',
    fac.includes('<details class="panel collapse-panel" id="schedule-import-panel" open>') &&
    fac.includes('<details class="panel collapse-panel" id="qgenda-panel">'));

  // ================= Account: unchanged — all three sync panels + backup =================
  run(`
    ${RESET}
    globalThis.__acct = accountPage();
  `);
  const acct = sandbox.__acct;
  t('Account still renders live sync, QGenda, upload, and backup — once each',
    count(acct, 'id="live-sync-panel"') === 1 && count(acct, 'id="qgenda-panel"') === 1 &&
    count(acct, 'id="schedule-import-panel"') === 1 && count(acct, 'id="backup-panel"') === 1 &&
    count(acct, 'id="qgendaForm"') === 1 && count(acct, 'id="scheduleForm"') === 1);
  t('Account order unchanged: live sync, QGenda, upload, backup',
    acct.indexOf('id="live-sync-panel"') < acct.indexOf('id="qgenda-panel"') &&
    acct.indexOf('id="qgenda-panel"') < acct.indexOf('id="schedule-import-panel"') &&
    acct.indexOf('id="schedule-import-panel"') < acct.indexOf('id="backup-panel"'));

  // ================= Shared state: one mid-import preview, both homes =================
  run(`
    ${RESET}
    schedulePreview = { fileName: 'dec-grid.png', source: 'upload', matchedName: 'Martin', noNamesInFile: false, ai: true,
      rows: [{ date: '2026-12-01', facility: 'Holzer', type: '5**', pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [] }] };
    globalThis.__facPreview = facilitiesPage();
    globalThis.__acctPreview = accountPage();
    schedulePreview = null;
  `);
  t('mid-import preview shows identically on Facilities and on Account',
    sandbox.__facPreview.includes('Parsed from:') && sandbox.__facPreview.includes('dec-grid.png') &&
    sandbox.__facPreview.includes('data-action="schedule-approve"') &&
    sandbox.__acctPreview.includes('Parsed from:') && sandbox.__acctPreview.includes('dec-grid.png') &&
    sandbox.__acctPreview.includes('data-action="schedule-approve"'));
  t('mid-import: upload panel starts open on Facilities too (never slams shut)',
    sandbox.__facPreview.includes('<details class="panel collapse-panel" id="schedule-import-panel" open>'));

  // ================= QGenda flow state is shared too =================
  run(`
    ${RESET}
    qgendaStatusError = 'Could not connect the QGenda feed: test problem. Nothing was saved.';
    globalThis.__facQg = facilitiesPage();
    qgendaStatusError = '';
    db.settings.qgendaConnected = true; db.settings.qgendaMasked = 'https://app.qgenda.com/…';
    globalThis.__facQgConn = facilitiesPage();
    db.settings.qgendaConnected = false; db.settings.qgendaMasked = '';
  `);
  t('a QGenda result opens the panel and shows on Facilities, same as Account',
    sandbox.__facQg.includes('<details class="panel collapse-panel" id="qgenda-panel" open>') &&
    sandbox.__facQg.includes('Could not connect the QGenda feed'));
  t('connected QGenda state shows on Facilities (fetch/disconnect controls)',
    sandbox.__facQgConn.includes('QGenda feed connected.') &&
    sandbox.__facQgConn.includes('data-action="qgenda-fetch"') &&
    sandbox.__facQgConn.includes('data-action="qgenda-disconnect"'));

  // ================= Feature toggle collapses the panel in BOTH homes =================
  run(`
    ${RESET}
    db.settings.featureQgenda = false;
    globalThis.__facOff = facilitiesPage();
    globalThis.__acctOff = accountPage();
    db.settings.featureQgenda = true;
  `);
  t('QGenda feature off: Facilities panel collapses to the off line, no connect form',
    sandbox.__facOff.includes('QGenda feed is off') && !sandbox.__facOff.includes('id="qgendaForm"'));
  t('QGenda feature off: Account panel collapses the same way',
    sandbox.__acctOff.includes('QGenda feed is off') && !sandbox.__acctOff.includes('id="qgendaForm"'));

  // ================= Onboarding deep link for step 2 still resolves =================
  run(`
    ${RESET}
    globalThis.__step2 = onboardingSteps().find(s => s.n === 2);
  `);
  t('onboarding step 2 still points at a panel that exists (Account live-sync panel)',
    sandbox.__step2.tab === 'Account' && sandbox.__step2.panel === 'live-sync-panel' &&
    acct.includes('id="live-sync-panel"'));

  t('service worker cache bumped to v81',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v160'));

  console.log(failures === 0 ? 'panels-both-tabs test done: all passed' : 'panels-both-tabs test done: FAILURES=' + failures);
})();
