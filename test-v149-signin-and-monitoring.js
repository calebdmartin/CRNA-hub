// CRNA Hub — v149 (Nov 12, 2026):
//   Item 1 — State board Connect buttons open the SIGN-IN page.
//     Caleb reported the WV Connect opened the public lookup
//     (wvrn.boardsofnursing.org/licenselookup), not the sign-in.
//     An audit of all 51 jurisdictions found the v147 STATE_BOARDS
//     table wrong everywhere (49 board homepages, WV + OH lookup
//     pages) and produced the audited sign-in table
//     (state-board-signin-urls.md: 32 verified, 19 likely). v149
//     replaces every URL verbatim and heals license records saved
//     under the old table.
//   Item 2 — the Portal monitoring panel must not contradict the
//     credential cards. Caleb's screenshot (Nov 12, 2026 ~2:14 PM
//     ET) showed NBCRNA "Last checked: never · Outcome: Couldn't
//     read — NBCRNA public check could not run…" and AANA "Last
//     checked: never · Not checked yet · due now" while both cards
//     correctly showed Verified from agent reads filed that
//     morning. The panel read only its legacy portalMonitoring
//     entries; the rows now derive Last checked / Outcome / Next
//     due from the newest evidence across both stores.
// Run: node test-v149-signin-and-monitoring.js
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
let fetchLog = [];
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
    const u = String(url);
    fetchLog.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    if (u.startsWith('/api/')) return { status: 404, ok: false, text: async () => '', json: async () => ({}) };
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
`;

// The audited sign-in table (state-board-signin-urls.md, Nov 12, 2026) — verbatim.
const AUDITED = {
  'Alabama': 'https://www.abn.alabama.gov/my-profile/',
  'Alaska': 'https://professionallicense.alaska.gov/MYLICENSE',
  'Arizona': 'https://azbn.boardsofnursing.org/azbn',
  'Arkansas': 'https://arsbn.boardsofnursing.org/arsbn',
  'California': 'https://www.breeze.ca.gov/',
  'Colorado': 'https://apps2.colorado.gov/dora/licensing',
  'Connecticut': 'http://www.elicense.ct.gov/',
  'Delaware': 'https://delpros.delaware.gov/OH_HomePage',
  'District of Columbia': 'https://dohenterprise.my.site.com/dchealthrenewals/s/portal-page',
  'Florida': 'https://flhealthsource.gov/',
  'Georgia': 'https://goals.sos.ga.gov/GASOSOneStop/s/login/',
  'Hawaii': 'https://mypvl.dcca.hawaii.gov/',
  'Idaho': 'https://edopl.idaho.gov/OnlineServices/_/',
  'Illinois': 'https://online-dfpr.micropact.com',
  'Indiana': 'https://mylicense.in.gov/eGov/ML1PLA.html',
  'Iowa': 'https://amanda-portal.idph.state.ia.us/ibon/portal/#/dashboards/index',
  'Kansas': 'https://portal.egov.ksbn.ks.gov/egov/',
  'Kentucky': 'https://kybn.boardsofnursing.org/kybn',
  'Louisiana': 'https://lsbn.boardsofnursing.org/',
  'Maine': 'https://www.pfr.maine.gov/ALMSonline/Welcome.aspx',
  'Maryland': 'https://mdchart.health.maryland.gov/CHART/s/login/?ec=302&startURL=/CHART/s/',
  'Massachusetts': 'https://healthprofessionlicensing.mass.gov/',
  'Michigan': 'https://www.michigan.gov/miplus',
  'Minnesota': 'https://mbn.hlb.state.mn.us/#/login',
  'Mississippi': 'https://gateway.licensure.msbn.ms.gov/',
  'Missouri': 'https://mopro.mo.gov/license/s/',
  'Montana': 'https://ebiz.mt.gov/POL/Default.aspx',
  'Nebraska': 'https://nebraska.mylicense.com/',
  'Nevada': 'https://nvbn.boardsofnursing.org/nvbn',
  'New Hampshire': 'https://forms.nh.gov/license/Login.aspx',
  'New Jersey': 'https://newjersey.mylicense.com/eGov/Login.aspx',
  'New Mexico': 'https://nmbn.boardsofnursing.org/nmbn',
  'New York': 'http://op.nysed.gov/services/online-registration-renewal',
  'North Carolina': 'https://portal.ncbon.com/',
  'North Dakota': 'https://ndbon.boardsofnursing.org/ndbn/',
  'Ohio': 'https://elicense.ohio.gov/OH_CommunitiesLogin',
  'Oklahoma': 'https://okbn.boardsofnursing.org/okbn',
  'Oregon': 'https://osbn.boardsofnursing.org/orbn',
  'Pennsylvania': 'https://www.pals.pa.gov',
  'Rhode Island': 'https://healthri.mylicense.com',
  'South Carolina': 'https://eservice.llr.sc.gov/SSO/',
  'South Dakota': 'https://sdbon.boardsofnursing.org/sdbn',
  'Tennessee': 'https://lars.tn.gov/datamart/login.do',
  'Texas': 'https://txbn.boardsofnursing.org/txbn',
  'Utah': 'https://utahdoc.mylicenseone.com',
  'Vermont': 'https://sos.vermont.gov/opr/online-services/',
  'Virginia': 'https://www.license.dhp.virginia.gov/license/Login.aspx',
  'Washington': 'https://secureaccess.wa.gov',
  'West Virginia': 'https://wvrn.boardsofnursing.org/wvrn/',
  'Wisconsin': 'https://license.wi.gov/',
  'Wyoming': 'https://wybn.boardsofnursing.org/wybn',
};

(async () => {
  // ---- Item 1a. All 51 table URLs equal the audited sign-in table ----
  const mismatches = run(`US_STATES.filter(s => stateBoard(s).url !== (${J(AUDITED)})[s])`);
  t('all 51 STATE_BOARDS Connect URLs equal the audited sign-in table',
    Array.isArray(mismatches) && mismatches.length === 0, J(mismatches));
  t('WV is exactly Caleb\u2019s sign-in URL',
    run(`stateBoard('West Virginia').url`) === 'https://wvrn.boardsofnursing.org/wvrn/');
  t('OH is exactly the audited eLicense login URL',
    run(`stateBoard('Ohio').url`) === 'https://elicense.ohio.gov/OH_CommunitiesLogin');
  t('no v147 homepage/lookup URL survives in the table',
    run(`STATE_BOARDS.every(b => !STATE_BOARD_URLS_PRE_V149.includes(b.url))`));

  // ---- Item 1b. Rendered Connect anchors resolve from the table ----
  run(RESET + `
    db.licenses = [
      { id: 'l1', state: 'West Virginia', type: 'APRN', status: 'Active', number: '103459', expiry: '2027-06-30', reminders: '90,60,30,7', source: 'user_entered' },
      { id: 'l2', state: 'Ohio', type: 'APRN', status: 'Active', number: 'APRN.CRNA.0021197', expiry: '2027-10-31', reminders: '90,60,30,7', source: 'user_entered' },
    ];
    globalThis.__page = credentialsPage();
  `);
  t('WV row renders and its Connect href is the sign-in URL',
    sandbox.__page.includes('data-portal-state="West Virginia"') &&
    sandbox.__page.includes('href="https://wvrn.boardsofnursing.org/wvrn/"'));
  t('OH row Connect href is the eLicense login URL',
    sandbox.__page.includes('href="https://elicense.ohio.gov/OH_CommunitiesLogin"'));
  t('the per-state connect flow opens the audited URL too',
    run(`portalConnectFlow('licenses', 'West Virginia').meta.url`) === 'https://wvrn.boardsofnursing.org/wvrn/' &&
    run(`portalConnectFlow('licenses', 'Ohio').meta.url`) === 'https://elicense.ohio.gov/OH_CommunitiesLogin');

  // ---- Item 1c. Healing records saved under the old table ----
  run(RESET + `
    db.licenses = [
      { id: 'h1', state: 'West Virginia', type: 'APRN', portal: 'https://wvrn.boardsofnursing.org/licenselookup', expiry: '2027-06-30' },
      { id: 'h2', state: 'Ohio', type: 'RN', portal: 'https://elicense.ohio.gov/oh_verifylicense', expiry: '2028-06-30' },
      { id: 'h3', state: 'Texas', type: 'RN', portal: 'https://www.bon.texas.gov/', expiry: '2028-01-31' },
      { id: 'h4', state: 'Ohio', type: 'APRN', portal: 'https://www.abn.alabama.gov/', expiry: '2027-10-31' },
      { id: 'h5', state: 'Ohio', type: 'APRN', portal: 'https://example.com/my-own-board-link', expiry: '2027-10-31' },
      { id: 'h6', state: 'Ohio', type: 'APRN', portal: '', expiry: '2027-10-31' },
    ];
    globalThis.__fixed = healLicensePortalUrls();
    globalThis.__after = Object.fromEntries(db.licenses.map(x => [x.id, x.portal]));
  `);
  t('a record carrying the OLD WV lookup URL heals to the sign-in URL',
    sandbox.__after.h1 === 'https://wvrn.boardsofnursing.org/wvrn/', J(sandbox.__after));
  t('a record carrying the OLD OH verify URL heals to the eLicense login',
    sandbox.__after.h2 === 'https://elicense.ohio.gov/OH_CommunitiesLogin');
  t('a record carrying an OLD homepage (Texas) heals to its own state\u2019s sign-in',
    sandbox.__after.h3 === 'https://txbn.boardsofnursing.org/txbn');
  t('an old-table value from ANOTHER state still heals — to the record\u2019s own state',
    sandbox.__after.h4 === 'https://elicense.ohio.gov/OH_CommunitiesLogin');
  t('a user-edited custom URL (matches no old-table value) is never touched',
    sandbox.__after.h5 === 'https://example.com/my-own-board-link' && sandbox.__after.h6 === '');
  t('the heal reports exactly the 4 healed records', sandbox.__fixed === 4, J(sandbox.__fixed));

  // ---- Item 1d. The labelled public-lookup links stay lookups ----
  t('PORTAL_LOOKUP_LINKS keeps its lookup URLs under the "Official lookups" label',
    run(`PORTAL_LOOKUP_LINKS.licenses`).includes('Official lookups') &&
    run(`PORTAL_LOOKUP_LINKS.licenses`).includes('https://wvrn.boardsofnursing.org/licenselookup') &&
    run(`PORTAL_LOOKUP_LINKS.licenses`).includes('https://elicense.ohio.gov/oh_verifylicense'));

  // ---- Item 2a. Caleb-shaped NBCRNA + AANA fixtures ----
  run(RESET + `
    db.nbcrna = { status: 'Certified', number: '126402', periodStart: '2023-05-01', periodEnd: '2027-04-30', renewalDeadline: '2027-04-30', checkStatus: '', classA: '', classB: '', macEd: '', macDev: '', source: 'nbcrna_portal', reminders: '90,60,30,7' };
    db.aana = { status: 'Active', number: '126402', expiration: '2027-08-31', classA: '103', classB: '2', source: 'aana_portal', reminders: '90,60,30,7' };
    cloudSyncTimes.nbcrna = '2026-11-12T14:42:00.000Z'; // Nov 12, 2026 9:42 AM ET — the filed read
    cloudSyncTimes.aana = '2026-11-12T15:10:00.000Z';
    db.portalMonitoring = [
      { key: 'nbcrna', source: 'nbcrna', state: '', type: '', label: 'NBCRNA', enabled: true, cadenceDays: 7,
        lastChecked: '', lastAttempt: '2026-11-12T13:05:00.000Z', lastOutcome: 'blocked',
        lastSummary: 'NBCRNA public check could not run: NBCRNA\u2019s verification submit did not answer from the server, so no record was pulled. This check is still unproven.',
        lastMethod: '', changeFlag: false },
      { key: 'aana', source: 'aana', state: '', type: '', label: 'AANA', enabled: true, cadenceDays: 7,
        lastChecked: '', lastAttempt: '', lastOutcome: '', lastSummary: '', lastMethod: '', changeFlag: false },
    ];
    globalThis.__html = portalMonitoringHTML();
    globalThis.__nb = db.portalMonitoring.find(m => m.key === 'nbcrna');
    globalThis.__aa = db.portalMonitoring.find(m => m.key === 'aana');
    globalThis.__dispNb = monitorDisplay(globalThis.__nb);
    globalThis.__dispAa = monitorDisplay(globalThis.__aa);
  `);
  const d12 = run(`fmt('2026-11-12')`), d19 = run(`fmt('2026-11-19')`);
  // v151: the panel gained a fifth row (CE Broker — never checked
  // in this fixture, legitimately "never" / "due now" / "Not
  // checked yet"), so the panel-wide negative assertions below
  // are scoped to the NBCRNA / AANA rows they were written about.
  const rowOf = (html, label, nextLabel) => {
    const a = html.indexOf('<strong>' + label + '</strong>');
    const b = nextLabel ? html.indexOf('<strong>' + nextLabel + '</strong>') : html.length;
    return a < 0 ? '' : html.slice(a, b < 0 ? html.length : b);
  };
  const rowNb = rowOf(sandbox.__html, 'NBCRNA', 'AANA');
  const rowAa = rowOf(sandbox.__html, 'AANA', 'CE Broker');
  t('NBCRNA row: Last checked is the filed read (Nov 12, 2026), never "never"',
    sandbox.__dispNb.lastChecked === '2026-11-12T14:42:00.000Z' &&
    rowNb.includes('Last checked: ' + d12) && !rowNb.includes('Last checked: never'),
    sandbox.__html.slice(0, 400));
  t('NBCRNA row: Outcome is the verified read; the stale public-check text is gone',
    sandbox.__dispNb.outcomeText === 'Verified — read from your signed-in session' &&
    sandbox.__html.includes('Outcome: Verified — read from your signed-in session') &&
    !sandbox.__html.includes('public check could not run'));
  t('NBCRNA row: Next due = read date + cadence (Nov 19, 2026), not due now',
    run(`monitorNextDue(db.portalMonitoring.find(m => m.key === 'nbcrna'), '2026-11-12')`) === '2026-11-19' &&
    run(`monitorIsDue(db.portalMonitoring.find(m => m.key === 'nbcrna'), '2026-11-12')`) === false &&
    rowNb.includes('Next due: ' + d19) && !rowNb.includes('due now'));
  t('AANA row: a read filed today clears "Not checked yet / due now" the same way',
    sandbox.__dispAa.verified === true && sandbox.__dispAa.lastChecked === '2026-11-12T15:10:00.000Z' &&
    run(`monitorNextDue(db.portalMonitoring.find(m => m.key === 'aana'), '2026-11-12')`) === '2026-11-19' &&
    !rowAa.includes('Not checked yet'));
  t('the legacy entries themselves are NOT rewritten (pause/cadence data intact)',
    sandbox.__nb.lastOutcome === 'blocked' && sandbox.__nb.lastChecked === '' && sandbox.__nb.enabled === true);

  // ---- Item 2b. Pause + cadence rendering unchanged under the derivation ----
  run(`db.portalMonitoring.find(m => m.key === 'nbcrna').enabled = false;
    globalThis.__htmlPaused = portalMonitoringHTML();`);
  t('a paused row still renders Paused + Resume, with its cadence form',
    sandbox.__htmlPaused.includes('Paused') && sandbox.__htmlPaused.includes('Resume monitoring') &&
    sandbox.__htmlPaused.includes('name="cadenceDays"') &&
    sandbox.__htmlPaused.includes('Outcome: Verified — read from your signed-in session'));

  // ---- Item 2c. A source with ONLY the legacy failure still shows it honestly ----
  run(RESET + `
    db.licenses = [{ id: 'w1', state: 'West Virginia', type: 'APRN', status: 'Active', number: '103459', expiry: '2027-06-30', reminders: '90,60,30,7', source: 'user_entered' }];
    ensurePortalMonitoring();
    const mon = db.portalMonitoring.find(m => m.key === 'licenses:West Virginia:APRN');
    mon.lastAttempt = '2026-11-10T15:00:00.000Z'; mon.lastOutcome = 'blocked';
    mon.lastSummary = 'The board lookup did not answer.';
    globalThis.__licHtml = portalMonitoringHTML();
    globalThis.__licDisp = monitorDisplay(mon);
    globalThis.__licDue = monitorNextDue(mon, '2026-11-12');
  `);
  t('failure-only licenses row still shows the failure (no verified read to outrank it)',
    sandbox.__licDisp.verified === false &&
    sandbox.__licHtml.includes('Last checked: never') &&
    sandbox.__licHtml.includes('Couldn\u2019t read') &&
    sandbox.__licHtml.includes('The board lookup did not answer.'));
  t('failure-only row: next due still rides the attempt + cadence (Nov 17, 2026)',
    sandbox.__licDue === '2026-11-17', sandbox.__licDue);

  // ---- Item 2d. Licenses rows follow the same rule, per state + type ----
  run(RESET + `
    db.licenses = [
      { id: 'w1', state: 'West Virginia', type: 'APRN', status: 'Active', number: '103459', expiry: '2027-06-30', reminders: '90,60,30,7', source: 'state_board_portal', updatedAt: '2026-11-12T16:00:00.000Z' },
      { id: 'w2', state: 'West Virginia', type: 'RN', status: 'Active', number: '86131', expiry: '2028-06-30', reminders: '90,60,30,7', source: 'user_entered', updatedAt: '2026-11-01T00:00:00.000Z' },
    ];
    ensurePortalMonitoring();
    const ap = db.portalMonitoring.find(m => m.key === 'licenses:West Virginia:APRN');
    ap.lastAttempt = '2026-11-12T13:05:00.000Z'; ap.lastOutcome = 'blocked'; ap.lastSummary = 'WV public check could not run.';
    const rn = db.portalMonitoring.find(m => m.key === 'licenses:West Virginia:RN');
    globalThis.__apDisp = monitorDisplay(ap);
    globalThis.__rnDisp = monitorDisplay(rn);
    globalThis.__apDue = monitorNextDue(ap, '2026-11-12');
  `);
  t('WV APRN row derives from its verified board read',
    sandbox.__apDisp.verified === true && sandbox.__apDisp.lastChecked === '2026-11-12T16:00:00.000Z' &&
    sandbox.__apDue === '2026-11-19', J(sandbox.__apDisp));
  t('the WV RN row does NOT borrow the APRN read (per-type evidence)',
    sandbox.__rnDisp.verified === false && sandbox.__rnDisp.lastChecked === '');

  // ---- Item 2e. In-app filings stamp the entry (applyPortalAgentRead) ----
  run(RESET + `
    ensurePortalMonitoring();
    globalThis.__res = applyPortalAgentRead('aana', { outcome: 'read', fields: { status: 'Active', number: '126402', expiration: '2027-08-31' } });
    globalThis.__monAfter = db.portalMonitoring.find(m => m.key === 'aana');
    globalThis.__dispAfter = monitorDisplay(globalThis.__monAfter);
  `);
  t('an in-app agent read stamps the monitoring entry (lastChecked + outcome)',
    sandbox.__res.ok === true && !!sandbox.__monAfter.lastChecked &&
    ['changed', 'no_change'].includes(sandbox.__monAfter.lastOutcome) &&
    sandbox.__dispAfter.lastChecked === sandbox.__monAfter.lastChecked,
    J({ res: sandbox.__res, mon: sandbox.__monAfter }));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
