// CRNA Hub — v147: the State Licenses card is per-state (Caleb,
// Nov 12, 2026: "the state board sign in needs a state selector so
// it knows what state portal to redirect the user to" — "Make sure
// it's all 50 states", + DC).
//
// Pins:
//   1. STATE_BOARDS covers exactly the 51 US_STATES entries, each
//      with a board name and a portal URL; WV and OH carry the
//      audited SIGN-IN routes (v149 — Caleb: the v147 values opened
//      the public lookup pages, not the sign-ins; every URL in the
//      table was replaced by the audited sign-in table).
//   2. The picker offers exactly 51 entries minus the states shown.
//   3. Each shown state's Connect targets THAT state's table URL
//      (WV, OH + Texas/California/Florida spot checks).
//   4. The old generic "Connect State Licenses" button never renders.
//   5. A read-it-now tap stamps ONLY that state's connection row
//      (in-memory row + the per-state device stamp).
//   6. States with records/connections render above the picker;
//      adding a state creates its row AND its portal connection
//      (the upsert POST carries a state_board row for it); removing
//      a record-less state row works, a state with records refuses.
//   7. Caleb-shaped fixture: WV + OH license records render both
//      rows with their v145 strips; a WV departure's return
//      greeting names West Virginia, and its button queues the WV
//      read only.
// Run: node test-v147-state-picker.js
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
const board = (s) => run(`stateBoard('${s}')`);
const pickerOptions = (html) => {
  const m = html.match(/<select id="licStatePicker"[^>]*>([\s\S]*?)<\/select>/);
  return m ? [...m[1].matchAll(/<option value="([^"]+)">/g)].map(x => x[1]) : null;
};
const RESET = `
  db = empty(); editId = null; manualType = 'NBCRNA'; onboardStep = 0;
  portalCheck = null; portalCheckError = ''; portalCheckOcrStatus = '';
  portalOpened = {}; portalLeaveSheet = ''; portalReadRequests = {}; portalAttemptFailed = {};
  cloudSession = null; cloudActive = false; cloudOffline = false; cloudPortals = [];
  portalDepartureLoaded = true; portalDepartureCache = null; portalDeparturePersist();
`;

(async () => {
  // ---- 1. The table: 51 entries, WV/OH exact ----
  t('STATE_BOARDS covers exactly the 51 US_STATES entries (50 states + DC)',
    run(`STATE_BOARDS.length`) === 51 &&
    run(`US_STATES.length`) === 51 &&
    run(`US_STATES.every(s => !!stateBoard(s))`));
  t('every entry carries a board name and an http(s) URL',
    run(`STATE_BOARDS.every(b => b.board && (b.url.indexOf('https://') === 0 || b.url.indexOf('http://') === 0))`));
  // v149: WV/OH expectations updated to the audited sign-in URLs —
  // Caleb reported the v147 lookup routes never reach a sign-in.
  t('WV targets the WV board SIGN-IN (Caleb\u2019s correction)',
    board('West Virginia').url === 'https://wvrn.boardsofnursing.org/wvrn/',
    J(board('West Virginia')));
  t('OH targets the Ohio eLicense LOGIN (audited)',
    board('Ohio').url === 'https://elicense.ohio.gov/OH_CommunitiesLogin',
    J(board('Ohio')));
  t('state names resolve from full name or 2-letter code',
    run(`stateNameOf('west virginia')`) === 'West Virginia' &&
    run(`stateNameOf('OH')`) === 'Ohio' && run(`stateNameOf('DC')`) === 'District of Columbia' &&
    run(`stateNameOf('Narnia')`) === '');

  // ---- 2/3/4. Caleb-shaped fixture: WV + OH records ----
  run(RESET + `
    db.licenses = [
      { id: 'l1', state: 'West Virginia', type: 'RN', status: 'Active', number: '86131', issue: '2013-07-02', expiry: '2028-06-30', reminders: '90,60,30,7', source: 'user_entered' },
      { id: 'l2', state: 'West Virginia', type: 'APRN', status: 'Active', number: '103459', issue: '2013-07-02', expiry: '2027-06-30', reminders: '90,60,30,7', source: 'user_entered' },
      { id: 'l3', state: 'Ohio', type: 'APRN', status: 'Active', number: 'APRN.CRNA.0021197', issue: '2019-01-01', expiry: '2027-10-31', reminders: '90,60,30,7', source: 'user_entered' },
    ];
    globalThis.__page = credentialsPage();
  `);
  const page = sandbox.__page;
  t('WV + OH rows render, each with its own Connect to its own board portal',
    page.includes('data-portal-state="West Virginia"') && page.includes('data-portal-state="Ohio"') &&
    page.includes('href="' + board('West Virginia').url + '"') &&
    page.includes('href="' + board('Ohio').url + '"') &&
    page.includes('Connect West Virginia — open portal') && page.includes('Connect Ohio — open portal'));
  t('the v145 license strip renders under each state row',
    page.includes('86131 · Active · Expires ' + run(`fmt('2028-06-30')`)) &&
    page.includes('APRN.CRNA.0021197 · Active · Expires ' + run(`fmt('2027-10-31')`)) &&
    page.includes('Reminders at 90, 60, 30, 7 days'));
  t('the old generic "Connect State Licenses" button no longer renders',
    !page.includes('Connect State Licenses — open portal') &&
    !run(`credentialsPage()`).includes('Connect State Licenses'));
  const opts = pickerOptions(page);
  t('picker offers exactly 51 minus the 2 shown states (49), WV/OH absent, DC present',
    Array.isArray(opts) && opts.length === 49 &&
    !opts.includes('West Virginia') && !opts.includes('Ohio') && opts.includes('District of Columbia'),
    J(opts && opts.length));
  t('state rows render above the picker',
    page.indexOf('data-portal-state="Ohio"') > -1 &&
    page.indexOf('data-portal-state="Ohio"') < page.indexOf('id="licStatePicker"'));

  // ---- 5. Read-it-now stamps ONLY that state ----
  run(RESET + `
    cloudPortals = [
      { id: 'pwv', portal: 'state_board', state: 'West Virginia', status: 'not_connected', session_state: 'unknown', read_requested_at: null, last_read_outcome: null, last_synced_at: null },
      { id: 'poh', portal: 'state_board', state: 'Ohio', status: 'not_connected', session_state: 'unknown', read_requested_at: null, last_read_outcome: null, last_synced_at: null },
    ];
    portalRequestRead('licenses', { state: 'Ohio' });
    globalThis.__oh = portalReadState('licenses', 'Ohio');
    globalThis.__wv = portalReadState('licenses', 'West Virginia');
    globalThis.__rows = cloudPortals.map(r => ({ state: r.state, req: r.read_requested_at }));
  `);
  t('read-it-now stamps only Ohio\u2019s row + Ohio\u2019s device stamp',
    !!sandbox.__oh.readRequestedAt && !sandbox.__wv.readRequestedAt &&
    sandbox.__rows.find(r => r.state === 'Ohio').req === sandbox.__oh.readRequestedAt &&
    sandbox.__rows.find(r => r.state === 'West Virginia').req === null,
    J(sandbox.__rows));
  run(`const before = portalReadState('licenses','Ohio').readRequestedAt;
    applyPortalAgentRead('licenses', { outcome: 'needs-sign-in', state: 'Ohio', reason: 'session expired' });
    globalThis.__ohAfter = portalReadState('licenses', 'Ohio');
    globalThis.__wvAfter = portalReadState('licenses', 'West Virginia');`);
  t('a filed Ohio result clears Ohio\u2019s request, sets Ohio\u2019s session, leaves WV untouched',
    sandbox.__ohAfter.readRequestedAt === '' && sandbox.__ohAfter.sessionState === 'needs_signin' &&
    sandbox.__ohAfter.lastReadOutcome === 'needs-sign-in' && sandbox.__wvAfter.sessionState === 'unknown');

  // ---- 6. Add / remove states ----
  run(RESET + `portalStateAdd('Texas'); globalThis.__page2 = credentialsPage();`);
  const page2 = sandbox.__page2;
  t('adding a state renders its row at once, Connect aimed at the Texas board',
    run(`licenseStatesShown().includes('Texas')`) &&
    page2.includes('data-portal-state="Texas"') &&
    page2.includes('href="' + board('Texas').url + '"') &&
    page2.includes('Texas Board of Nursing'));
  t('spot check: California and Florida rows aim at their own boards too',
    run(`portalStateAdd('California'); portalStateAdd('Florida'); credentialsPage()`)
      .includes('href="' + board('California').url + '"') &&
    run(`credentialsPage()`).includes('href="' + board('Florida').url + '"'));
  const opts2 = pickerOptions(page2);
  t('the picker shrinks by the added state (50 after Texas)',
    Array.isArray(opts2) && opts2.length === 50 && !opts2.includes('Texas'), J(opts2 && opts2.length));
  run(`portalStateRemove('Texas');
    globalThis.__shownAfterRemove = licenseStatesShown();
    globalThis.__page3 = credentialsPage();`);
  t('removing a record-less state drops its row and returns it to the picker',
    !sandbox.__shownAfterRemove.includes('Texas') &&
    !sandbox.__page3.includes('data-portal-state="Texas"') &&
    (pickerOptions(sandbox.__page3) || []).includes('Texas'));
  run(RESET + `
    db.licenses = [{ id: 'l9', state: 'Ohio', type: 'RN', status: 'Active', number: '86131', expiry: '2028-06-30', reminders: '90,60,30,7' }];
    portalStateRemove('Ohio');
    globalThis.__ohKept = licenseStatesShown().includes('Ohio');`);
  t('a state WITH license records cannot be removed out from under them',
    sandbox.__ohKept === true);

  // ---- 6b. Adding a state creates its portal connection ----
  run(RESET + `
    cloudSession = { user_id: 'u1', access_token: 'tok', expires_at: Date.now() / 1000 + 3600 };
    cloudActive = true;
    db.settings.licStates = ['Texas']; // as portalStateAdd leaves it
  `);
  fetchLog = [];
  await run(`(async () => { await cloudUpsertPortals(); })()`);
  const portalPost = fetchLog.find(f => f.url.includes('/rest/v1/portal_connections') && f.method === 'POST');
  const postedRows = portalPost ? JSON.parse(portalPost.body || '[]') : [];
  t('the portals upsert creates a state_board connection row for an added state',
    postedRows.some(r => r.portal === 'state_board' && r.state === 'Texas' && r.status === 'not_connected'),
    J(postedRows.map(r => r.portal + ':' + r.state)));
  t('cloudApplyData unions a state_board row\u2019s state into the shown states',
    run(RESET + `
      cloudApplyData({ nbcrna: null, aana: null, licenses: [], ce: [], documents: [],
        portals: [{ portal: 'state_board', state: 'Ohio', status: 'connected' }] });
      licenseStatesShown().includes('Ohio')`));

  // ---- 7. Return greeting names the state ----
  run(RESET + `
    db.licenses = [{ id: 'l1', state: 'West Virginia', type: 'APRN', status: 'Active', number: '103459', expiry: '2027-06-30', reminders: '90,60,30,7' }];
    portalDepartureStamp('licenses', 'West Virginia');
    portalNoteReturn();
    globalThis.__greet = portalReturnGreetingHTML();
  `);
  t('the return greeting names the state: "tap to run your West Virginia read"',
    sandbox.__greet.includes('Welcome back — tap to run your West Virginia read') &&
    sandbox.__greet.includes('data-date="West Virginia"'), sandbox.__greet);
  run(`actions('portal-return-read', 'licenses', 'West Virginia');
    globalThis.__wvReq = portalReadState('licenses', 'West Virginia').readRequestedAt;
    globalThis.__greetGone = portalReturnGreetingHTML();`);
  t('the greeting button queues that state\u2019s read and clears the greeting',
    !!sandbox.__wvReq && sandbox.__greetGone === '');

  // ---- Session line is per state in the row ----
  run(RESET + `
    db.licenses = [{ id: 'l1', state: 'West Virginia', type: 'APRN', status: 'Active', number: '103459', expiry: '2027-06-30', reminders: '90,60,30,7' }];
    cloudPortals = [{ id: 'pwv', portal: 'state_board', state: 'West Virginia', status: 'not_connected', session_state: 'live', read_requested_at: null, last_synced_at: null }];
    db.settings.licStates = ['Ohio'];
    globalThis.__page4 = credentialsPage();
  `);
  t('WV row shows "Session live"; the added Ohio row shows its own Connect + Remove, no session claim',
    sandbox.__page4.includes('Session live') &&
    sandbox.__page4.includes('Connect Ohio — open portal') &&
    sandbox.__page4.includes('data-action="portal-state-remove" data-id="Ohio"') &&
    !sandbox.__page4.includes('data-action="portal-state-remove" data-id="West Virginia"'));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
