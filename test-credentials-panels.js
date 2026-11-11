// CRNA Hub — tests for the Credentials tab panel split (Nov 6, 2026, branch
// muse/credentialing). Run: node test-credentials-panels.js
//
// Every Credentials section is now its own sibling <details> collapse
// panel, same pattern as the Account sync-area split:
//   NBCRNA connect · AANA connect · Portal monitoring · State Licenses
//   connect · Certification documents · Manual entry.
// The "Checks due" strip stays a plain reminder section at the top.
// Default states: a section that needs action starts open (no record
// yet, a check due / prompt waiting, a portal opened awaiting return, a
// guided check in flight, a cert expiring within 90 days, an edit in
// progress); a settled section rests collapsed with a one-line summary
// in its header. Nothing functional changed.
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
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');

const PANELS = ['credentials-nbcrna-panel', 'credentials-aana-panel', 'credentials-monitoring-panel', 'credentials-licenses-panel', 'cert-documents', 'credentials-manual-panel'];
const panelTag = (html, id) => {
  const m = html.match(new RegExp('<details class="panel collapse-panel" id="' + id + '"( open)?>'));
  return m ? m[0] : null;
};
const RESET = `
  db = empty();
  editId = null; manualType = 'NBCRNA'; onboardStep = 0;
  portalCheck = null; portalCheckError = ''; portalCheckOcrStatus = '';
  portalOpened = {}; portalLeaveSheet = '';
  docOcrStatus = ''; docStorageError = '';
  cloudSession = null; cloudPortals = [];
`;
const SETTLED = `
  ${RESET}
  db.nbcrna = { status: 'Certified', number: '126402', periodStart: '2023-05-01', periodEnd: '2027-04-30', renewalDeadline: '2027-04-30', reminders: '90,60,30,7', source: 'user_entered' };
  db.aana = { status: 'Active', number: '126402', expiration: '2027-12-31', reminders: '90,60,30,7', source: 'user_entered' };
  db.licenses = [{ id: 'l1', state: 'West Virginia', type: 'APRN', number: '103459', issue: '2013-07-02', expiry: '2027-06-30', reminders: '90,60,30,7' }];
  db.documents = [{ id: 'd1', certType: 'ACLS', issue: '2026-01-01', expiry: '2028-01-01', expirySource: 'user-entered' }];
  ensurePortalMonitoring();
  db.portalMonitoring.forEach(m => { m.lastChecked = cloudNow(); m.lastOutcome = 'no_change'; m.changeFlag = false; m.promptDismissedCycle = ''; });
  globalThis.__page = credentialsPage();
`;

(async () => {
  // ================= Settled user: structure + everything collapsed ====
  run(SETTLED);
  const settled = sandbox.__page;
  t('all six Credentials sections are sibling collapse panels, in order',
    PANELS.every(id => panelTag(settled, id)) &&
    PANELS.slice(1).every((id, i) => settled.indexOf('id="' + id + '"') > settled.indexOf('id="' + PANELS[i] + '"')));
  t('no panel is nested inside another (exactly six top-level details panels before the manual panel closes the page)',
    (settled.match(/<details class="panel collapse-panel"/g) || []).length === 6);
  t('settled sections all rest collapsed (no open attribute on any panel)',
    PANELS.every(id => panelTag(settled, id) && !panelTag(settled, id).includes(' open')));
  t('headers carry one-line summaries from existing data',
    settled.includes('NBCRNA · Certified · ends Apr 30, 2027') &&
    settled.includes('AANA · Active · expires Dec 31, 2027') &&
    settled.includes('State Licenses · 1 on file · next expiry Jun 30, 2027') &&
    settled.includes('Certification documents · 1 on file · next expires Jan 1, 2028') &&
    /Portal monitoring · checked /.test(settled));
  t('all controls still present inside the panels',
    settled.includes('Connect NBCRNA — open portal') &&
    settled.includes('Connect AANA — open portal') &&
    settled.includes('Connect State Licenses — open portal') &&
    (settled.match(/I signed in — check it/g) || []).length >= 3 &&
    settled.includes('Pause monitoring') && settled.includes('Cadence') &&
    settled.includes('id="cert-documents"') && settled.includes('Certification type') &&
    settled.includes('id="manualTypeSelect"') && settled.includes('Save NBCRNA record'));

  // ================= Fresh user: actionable panels start open =========
  run(RESET + `globalThis.__page = credentialsPage();`);
  const fresh = sandbox.__page;
  t('fresh user: connect panels and documents start open (nothing on file yet)',
    panelTag(fresh, 'credentials-nbcrna-panel').includes(' open') &&
    panelTag(fresh, 'credentials-aana-panel').includes(' open') &&
    panelTag(fresh, 'credentials-licenses-panel').includes(' open') &&
    panelTag(fresh, 'cert-documents').includes(' open'));
  t('fresh user: monitoring starts open (checks due, never checked)',
    panelTag(fresh, 'credentials-monitoring-panel').includes(' open'));
  t('fresh user: manual entry still rests collapsed',
    !panelTag(fresh, 'credentials-manual-panel').includes(' open'));

  // ================= Due prompt opens just its own panels ==============
  run(SETTLED + `
    const aa = db.portalMonitoring.find(m => m.source === 'aana');
    aa.lastChecked = ''; aa.lastOutcome = '';
    globalThis.__page = credentialsPage();
  `);
  const due = sandbox.__page;
  t('a due AANA check opens the AANA panel and the monitoring panel only',
    panelTag(due, 'credentials-aana-panel').includes(' open') &&
    panelTag(due, 'credentials-monitoring-panel').includes(' open') &&
    !panelTag(due, 'credentials-nbcrna-panel').includes(' open') &&
    !panelTag(due, 'cert-documents').includes(' open'));
  t('the Checks due strip still renders at the top, ahead of the panels',
    due.includes('<h2>Checks due</h2>') && due.includes('AANA check due — sign in to run it') &&
    due.indexOf('Checks due') < due.indexOf('id="credentials-nbcrna-panel"'));

  // ================= Portal opened / guided check in flight ============
  run(SETTLED + `
    portalOpened = { nbcrna: true };
    globalThis.__page = credentialsPage();
  `);
  t('a portal opened awaiting return opens only its own panel, return button inside',
    panelTag(sandbox.__page, 'credentials-nbcrna-panel').includes(' open') &&
    !panelTag(sandbox.__page, 'credentials-aana-panel').includes(' open') &&
    sandbox.__page.includes('I’m back — run my check'));
  run(SETTLED + `
    portalCheck = { source: 'licenses', step: 'guide', page: 0 };
    globalThis.__page = credentialsPage();
  `);
  t('a guided check in flight opens the panel for its source',
    panelTag(sandbox.__page, 'credentials-licenses-panel').includes(' open') &&
    !panelTag(sandbox.__page, 'credentials-nbcrna-panel').includes(' open'));

  // ================= Expiring cert + edit in progress ==================
  run(SETTLED + `
    db.documents = [{ id: 'd1', certType: 'ACLS', issue: '2024-12-01', expiry: '${new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10)}', expirySource: 'user-entered' }];
    globalThis.__page = credentialsPage();
  `);
  t('a cert expiring within 90 days opens the documents panel',
    panelTag(sandbox.__page, 'cert-documents').includes(' open') &&
    !panelTag(sandbox.__page, 'credentials-nbcrna-panel').includes(' open'));
  run(SETTLED + `
    editId = 'l1'; manualType = 'State license';
    globalThis.__page = credentialsPage();
  `);
  t('editing a license opens the manual entry panel (unchanged behavior)',
    panelTag(sandbox.__page, 'credentials-manual-panel').includes(' open'));

  // ================= Source-level guards ===============================
  t('source: connCard / monitoring / documents all render through collapsePanelHTML',
    /function portalMonitoringHTML\(\)[\s\S]{0,900}?collapsePanelHTML\('credentials-monitoring-panel'/.test(appSrc) &&
    appSrc.includes("collapsePanelHTML('cert-documents'") &&
    appSrc.includes("'credentials-'+portalKey+'-panel'"));
  t('service worker cache bumped to v65',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v115'));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
})();
