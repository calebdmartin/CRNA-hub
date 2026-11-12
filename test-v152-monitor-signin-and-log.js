// CRNA Hub — v152 (Nov 12, 2026):
//   Item 1 — the monitoring due-prompt "Sign in" button was dead in
//     the home-screen (standalone) app. monitor-signin invoked the
//     connect flow programmatically, with no tap event and no
//     anchor; the standalone branch of open() only returns 'link'
//     and relies on the anchor's own navigation, so the tap did
//     nothing. The route now lands on the source's Credentials card
//     with its pre-leaving sheet open; the sheet's explicit
//     "Take me to …" tap is the working navigation. The legacy
//     connect-portal action shared the same no-anchor trap and
//     takes the same route.
//   Item 2 — Caleb: "Let's go ahead and get rid of this monitoring
//     log." The Portal monitoring panel no longer renders the
//     Monitoring log (heading, entries, or the empty fallback).
//     db.portalChecks is NOT deleted: the Assistant's "Recent
//     assistant portal checks" line reads the same data.
// Run: node test-v152-monitor-signin-and-log.js
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
  // Caleb's case: the app running from the Home Screen.
  window: null, navigator: { standalone: true },
  location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {}, confirm: () => true, prompt: () => null,
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra ? ' — ' + extra : ''));
  if (!cond) { failures++; process.exitCode = 1; }
};
const J = (v) => JSON.stringify(v);
const RESET = `
  db = empty(); editId = null; manualType = 'NBCRNA'; onboardStep = 0;
  portalCheck = null; portalCheckError = ''; portalCheckOcrStatus = '';
  portalOpened = {}; portalLeaveSheet = ''; portalReadRequests = {}; portalAttemptFailed = {};
  cloudSession = null; cloudActive = false; cloudOffline = false; cloudPortals = [];
  cloudSyncTimes = {};
  portalDepartureLoaded = true; portalDepartureCache = null; portalDeparturePersist();
  tab = 'Dashboard';
`;

(async () => {
  t('harness is in standalone (home-screen) mode — the reported case',
    run(`portalStandaloneMode()`) === true);

  // ---------- Item 2: the panel log is gone; its data is not ----------
  run(RESET + `
    db.licenses = [{ id: 'l1', state: 'Ohio', type: 'APRN', status: 'Active', number: 'APRN.CRNA.0021197', issue: '2025-01-16', expiry: '2027-10-31', reminders: '90,60,30,7', source: 'state_board_portal' }];
    db.portalChecks = [{ source: 'nbcrna', state: '', retrievedAt: '2026-11-12T14:00:00.000Z', status: 'changed', summary: 'UNIQUE LOG SENTINEL — certification period confirmed' }];
    ensurePortalMonitoring();
    globalThis.__panel = portalMonitoringHTML();
    globalThis.__recent = portalCheckHTML();
  `);
  t('panel: no "Monitoring log" heading and no log entries (sentinel summary absent)',
    !sandbox.__panel.includes('Monitoring log') && !sandbox.__panel.includes('UNIQUE LOG SENTINEL'));
  t('panel: per-source rows still render (labels, Last checked / Next due / Outcome, Pause, Cadence)',
    sandbox.__panel.includes('<strong>CE Broker</strong>') &&
    sandbox.__panel.includes('<strong>Ohio APRN</strong>') &&
    sandbox.__panel.includes('Last checked:') && sandbox.__panel.includes('Next due:') &&
    sandbox.__panel.includes('Outcome:') && sandbox.__panel.includes('Pause monitoring') &&
    sandbox.__panel.includes('<summary class="muted">Cadence</summary>'));
  t('the Assistant recent-checks line still reads db.portalChecks (the data was not deleted)',
    sandbox.__recent.includes('Recent assistant portal checks:') &&
    sandbox.__recent.includes('UNIQUE LOG SENTINEL'));
  run(`db.portalChecks = []; globalThis.__panelEmpty = portalMonitoringHTML();`);
  t('panel: with no checks on file there is no "No checks logged yet" fallback either',
    !sandbox.__panelEmpty.includes('No checks logged yet') && !sandbox.__panelEmpty.includes('Monitoring log'));

  // ---------- Item 1: monitor-signin is not a no-op in standalone ----------
  run(RESET + `
    ensurePortalMonitoring();
    document.getElementById('credentials-cebroker-panel').scrollIntoView = function () { globalThis.__scrolled = 'credentials-cebroker-panel'; };
    tab = 'Dashboard'; portalLeaveSheet = '';
    actions('monitor-signin', 'cebroker');
    globalThis.__route = { tab, sheet: portalLeaveSheet, scrolled: globalThis.__scrolled || '', html: document.getElementById('app').innerHTML };
  `);
  t('CE Broker: one tap lands on Credentials with the CE Broker pre-leaving sheet open (not a no-op)',
    sandbox.__route.tab === 'Credentials' && sandbox.__route.sheet === 'cebroker',
    J({ tab: sandbox.__route.tab, sheet: sandbox.__route.sheet }));
  t('CE Broker: the rendered page contains its pre-leaving sheet and the card was scrolled to',
    sandbox.__route.scrolled === 'credentials-cebroker-panel' &&
    sandbox.__route.html.includes('One sec — the portal opens outside CRNA Hub') &&
    sandbox.__route.html.includes('data-action="portal-leave-go" data-id="cebroker"') &&
    sandbox.__route.html.includes('Take me to CE Broker'));

  run(RESET + `
    db.licenses = [{ id: 'l1', state: 'Ohio', type: 'APRN', status: 'Active', number: 'APRN.CRNA.0021197', issue: '2025-01-16', expiry: '2027-10-31', reminders: '90,60,30,7', source: 'state_board_portal' }];
    ensurePortalMonitoring();
    document.getElementById('credentials-licenses-panel').scrollIntoView = function () { globalThis.__scrolledLic = 'credentials-licenses-panel'; };
    tab = 'Dashboard'; portalLeaveSheet = '';
    actions('monitor-signin', 'licenses:Ohio:APRN');
    globalThis.__routeLic = { tab, sheet: portalLeaveSheet, scrolled: globalThis.__scrolledLic || '', html: document.getElementById('app').innerHTML };
  `);
  t('licenses: one tap lands on Credentials with that state’s flow sheet open (licenses:<State>)',
    sandbox.__routeLic.tab === 'Credentials' && sandbox.__routeLic.sheet === 'licenses:Ohio',
    J({ tab: sandbox.__routeLic.tab, sheet: sandbox.__routeLic.sheet }));
  t('licenses: the rendered page contains the Ohio pre-leaving sheet and the card was scrolled to',
    sandbox.__routeLic.scrolled === 'credentials-licenses-panel' &&
    sandbox.__routeLic.html.includes('data-action="portal-leave-go" data-id="licenses" data-date="Ohio"') &&
    sandbox.__routeLic.html.includes('Take me to Ohio'));

  // ---------- Audit pin: the other programmatic caller takes the same route ----------
  run(RESET + `
    tab = 'Dashboard'; portalLeaveSheet = '';
    actions('connect-portal', 'CE Broker');
    globalThis.__routeLegacy = { tab, sheet: portalLeaveSheet };
  `);
  t('legacy connect-portal action (the other no-anchor caller) lands on the card + sheet too',
    sandbox.__routeLegacy.tab === 'Credentials' && sandbox.__routeLegacy.sheet === 'cebroker',
    J(sandbox.__routeLegacy));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
