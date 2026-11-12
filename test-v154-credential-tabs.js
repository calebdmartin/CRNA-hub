// CRNA Hub — v154 (Nov 12, 2026): credential quick-view chips at
// the top of the Credentials tab. Caleb: "tabs at the top of the
// credential page just like the tabs at the top of this page,
// that has a quick view of compliance for each portal and
// license" — name · Active/Lapsed · one requirements icon
// (green ✓ / red ✗); a tap scrolls to that credential's section
// and opens its panel. The derivation (credentialChipStatus) is
// pinned to reuse the app's existing truth ONLY: portalReadState
// sessions, monitorDisplay / monitorPromptVisible, the filed
// records' own status + dates, and the v150 watchdog's CE window
// rule (tracked-short or untracked = attention only inside the
// 90-day window; outside it, no crying wolf).
// Run: node test-v154-credential-tabs.js
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
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
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
  alert: () => {}, confirm: () => true, prompt: () => null,
  fetch: async (url, opts) => {
    if (((opts && opts.method) || 'GET') === 'GET') return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
    return { status: 201, ok: true, text: async () => '', json: async () => ({}) };
  },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
let failures = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra ? ' — ' + extra : ''));
  if (!cond) { failures++; process.exitCode = 1; }
};
const J = (v) => JSON.stringify(v);
const seg = (html, fromId, toId) => {
  const a = html.indexOf('id="' + fromId + '"');
  const b = toId ? html.indexOf('id="' + toId + '"') : html.length;
  return a < 0 ? '' : html.slice(a, b < 0 ? html.length : b);
};
const RESET = `
  db = empty();
  editId = null; manualType = 'NBCRNA'; onboardStep = 0;
  portalCheck = null; portalCheckError = ''; portalCheckOcrStatus = '';
  portalOpened = {}; portalLeaveSheet = '';
  cloudSession = null; cloudActive = false; cloudOffline = false; cloudPortals = []; cloudSyncTimes = {};
  portalAttemptFailed = {}; portalReadRequests = {}; portalDepartureCache = null; portalDepartureLoaded = false;
  try { localStorage.removeItem('crna-hub-portal-departure'); } catch (e) {}
`;
// Caleb-shaped fixture, Nov 12, 2026: all four portals read and
// filed, sessions live, monitoring freshly checked; WV RN has a
// CE Broker course on file that landed in the PRIOR cycle (0 of
// 12 in-cycle) but renews Jun 2028 — far outside every window.
const CALEB = RESET + `
  db.nbcrna = { status: 'Certified', number: '126402', periodStart: '2023-05-01', periodEnd: '2027-04-30', renewalDeadline: '2027-04-30', reminders: '90,60,30,7', source: 'nbcrna_portal' };
  db.aana = { status: 'Active', number: '126402', expiration: '2027-08-31', reminders: '90,60,30,7', source: 'aana_portal', classA: 103, classB: 2 };
  db.licenses = [
    { id: 'wv-rn', state: 'West Virginia', type: 'RN', number: '86131', issue: '2013-07-02', expiry: '2028-06-30', status: 'Active', reminders: '90,60,30,7', source: 'state_board_portal', updatedAt: cloudNow() },
    { id: 'wv-aprn', state: 'West Virginia', type: 'APRN-CRNA', number: '103459', issue: '2019-05-31', expiry: '2027-06-30', status: 'Active', reminders: '90,60,30,7', source: 'state_board_portal', updatedAt: cloudNow() },
    { id: 'oh-rn', state: 'Ohio', type: 'RN', number: '86131', issue: '2013-07-02', expiry: '2028-06-30', status: 'Active', reminders: '90,60,30,7', source: 'state_board_portal', updatedAt: cloudNow() },
    { id: 'oh-aprn', state: 'Ohio', type: 'APRN-CRNA', number: 'APRN.CRNA.0021197', issue: '2025-01-16', expiry: '2027-10-31', status: 'Active', reminders: '90,60,30,7', source: 'state_board_portal', updatedAt: cloudNow() }
  ];
  db.aanaCE = [{ id: 'cb-may26', title: 'WV RN CE Package - 15 Credit Hours', date: '2026-05-14', credits: '15', source: 'cebroker', licState: 'West Virginia', licType: 'RN', category: 'General', updatedAt: cloudNow() }];
  cloudSyncTimes = { nbcrna: cloudNow(), aana: cloudNow(), cebroker: cloudNow(), licenses: cloudNow() };
  cloudPortals = [
    { portal: 'nbcrna', state: null, session_state: 'live', last_read_outcome: 'read', read_requested_at: null },
    { portal: 'aana', state: null, session_state: 'live', last_read_outcome: 'read', read_requested_at: null },
    { portal: 'cebroker', state: null, session_state: 'live', last_read_outcome: 'read', read_requested_at: null },
    { portal: 'state_board', state: 'West Virginia', session_state: 'live', last_read_outcome: 'read', read_requested_at: null },
    { portal: 'state_board', state: 'Ohio', session_state: 'live', last_read_outcome: 'read', read_requested_at: null }
  ];
  ensurePortalMonitoring();
  db.portalMonitoring.forEach(m => { m.lastChecked = cloudNow(); m.lastOutcome = 'no_change'; m.changeFlag = false; m.promptDismissedCycle = ''; });
`;

(async () => {
  // ---------- Caleb fixture: every chip green ----------
  run(CALEB + 'globalThis.__chips = credentialChipStatus(); globalThis.__page = credentialsPage();');
  const chips = sandbox.__chips, page = sandbox.__page;
  t('Caleb fixture: 7 chips (3 portals + 4 licenses)', chips.length === 7, J(chips.map(c => c.key)));
  t('chip names: NBCRNA · AANA · CE Broker · WV RN · WV APRN-CRNA · OH RN · OH APRN-CRNA',
    J(chips.map(c => c.name)) === J(['NBCRNA', 'AANA', 'CE Broker', 'WV RN', 'WV APRN-CRNA', 'OH RN', 'OH APRN-CRNA']), J(chips.map(c => c.name)));
  t('chip status words: Certified · Active · Verified · Active x4',
    J(chips.map(c => c.status)) === J(['Certified', 'Active', 'Verified', 'Active', 'Active', 'Active', 'Active']), J(chips.map(c => c.status)));
  t('Caleb fixture: every chip green (WV RN 0-of-12 in-cycle but due Jun 2028 — outside the windows)',
    chips.every(c => c.attention === false), J(chips.filter(c => c.attention).map(c => c.key)));
  t('chip targets: portal chips point at their own panels',
    chips[0].panel === 'credentials-nbcrna-panel' && chips[1].panel === 'credentials-aana-panel' && chips[2].panel === 'credentials-cebroker-panel');
  t('chip targets: license chips point at the licenses panel + their own row anchor',
    chips.slice(3).every(c => c.panel === 'credentials-licenses-panel') &&
    chips[3].anchor === 'cred-license-wv-rn' && chips[6].anchor === 'cred-license-oh-aprn', J(chips.slice(3).map(c => c.anchor)));
  t('page: strip renders above the first Credentials panel',
    page.indexOf('class="cred-chips"') > -1 && page.indexOf('class="cred-chips"') < page.indexOf('id="credentials-nbcrna-panel"'));
  t('page: one chip button per credential, carrying name + status',
    (page.match(/data-action="credential-chip"/g) || []).length === 7 &&
    page.includes('NBCRNA · Certified') && page.includes('CE Broker · Verified') && page.includes('WV APRN-CRNA · Active'));
  t('page: Caleb fixture renders green icons only',
    (page.match(/cred-chip-icon ok/g) || []).length === 7 && !page.includes('cred-chip-icon bad'));
  const licSeg = seg(page, 'credentials-licenses-panel', 'credentials-cebroker-panel');
  t('page: every license row carries its chip anchor inside the licenses panel',
    ['wv-rn', 'wv-aprn', 'oh-rn', 'oh-aprn'].every(id => licSeg.includes('id="cred-license-' + id + '"')));

  // ---------- Onboarding step 4: no strip ----------
  run(CALEB + 'onboardStep = 4; globalThis.__page4 = credentialsPage();');
  t('onboarding step 4 does NOT get the strip', !sandbox.__page4.includes('cred-chips'));

  // ---------- Tap wiring ----------
  t('tap wiring: actions() routes credential-chip taps to credentialChipGo',
    appSrc.includes("action==='credential-chip'") && appSrc.includes('credentialChipGo(entry)'));
  t('tap wiring: credentialChipGo opens the panel, then scrolls to the license anchor',
    /function credentialChipGo\(key\)/.test(appSrc) && appSrc.includes('facilityScrollTo(chip.panel)') && appSrc.includes('facilityScrollTo(chip.anchor)'));
  t('tap wiring: chips are buttons with data-action + data-id keys',
    page.includes('data-action="credential-chip" data-id="nbcrna"') && page.includes('data-action="credential-chip" data-id="license:wv-rn"'));

  // ---------- Synthetic red cases ----------
  run(RESET + `
    db.licenses = [{ id: 'exp1', state: 'Ohio', type: 'RN', number: '1', issue: '2020-01-01', expiry: addDaysStr(localDate(new Date()), -10), status: 'Active', reminders: '90,60,30,7', source: 'user_entered' }];
    globalThis.__chips = credentialChipStatus();
  `);
  const exp = sandbox.__chips.find(c => c.key === 'license:exp1');
  t('expired license: status word Lapsed + red ✗', !!exp && exp.status === 'Lapsed' && exp.attention === true, J(exp));

  run(RESET + `
    db.nbcrna = { status: 'Certified', number: '126402', periodEnd: '2027-04-30', renewalDeadline: '2027-04-30', reminders: '90,60,30,7', source: 'nbcrna_portal' };
    cloudPortals = [{ portal: 'nbcrna', state: null, session_state: 'needs_signin', last_read_outcome: 'needs-sign-in', read_requested_at: null }];
    globalThis.__chips = credentialChipStatus();
  `);
  const nChip = sandbox.__chips.find(c => c.key === 'nbcrna');
  t('needs-sign-in session: portal chip red ✗ (status word still Certified)',
    !!nChip && nChip.status === 'Certified' && nChip.attention === true, J(nChip));

  // ---------- CE window rule (the watchdog's 90/60/30/7 windows) ----------
  const ceScenario = (daysOut, withRecord) => RESET + `
    db.licenses = [{ id: 'wvx', state: 'West Virginia', type: 'RN', number: '86131', expiry: addDaysStr(localDate(new Date()), ${daysOut}), status: 'Active', reminders: '90,60,30,7', source: 'user_entered' }];
    ${withRecord ? `db.aanaCE = [{ id: 'ce-x', title: 'Some course', date: localDate(new Date()), credits: '3', licState: 'West Virginia', licType: 'RN', category: 'General' }];` : ''}
    ensurePortalMonitoring();
    db.portalMonitoring.forEach(m => { m.lastChecked = cloudNow(); m.lastOutcome = 'no_change'; m.changeFlag = false; m.promptDismissedCycle = ''; });
    globalThis.__chips = credentialChipStatus();
  `;
  run(ceScenario(200, true));
  let wv = sandbox.__chips.find(c => c.key === 'license:wvx');
  t('CE window: tracked shortfall (3 of 12) 200 days out renders green ✓', !!wv && wv.attention === false, J(wv));
  run(ceScenario(30, true));
  wv = sandbox.__chips.find(c => c.key === 'license:wvx');
  t('CE window: the same shortfall 30 days out renders red ✗', !!wv && wv.attention === true, J(wv));
  run(ceScenario(200, false));
  wv = sandbox.__chips.find(c => c.key === 'license:wvx');
  t('CE window: untracked CE 200 days out renders green ✓', !!wv && wv.attention === false, J(wv));
  run(ceScenario(30, false));
  wv = sandbox.__chips.find(c => c.key === 'license:wvx');
  t('CE window: untracked CE 30 days out renders red ✗ (the watchdog untracked-at-90 rule)', !!wv && wv.attention === true, J(wv));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
