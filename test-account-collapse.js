// CRNA Hub — tests for the Account-page collapses (Nov 6, 2026, branch
// muse/credentialing). Run: node test-account-collapse.js
//
// Covers, without any live API call (fetch is stubbed; no network):
//   * Profile — step 1: saving collapses the section to a one-line
//     summary (name · employment type · goal, only what's set) with an
//     Edit button; a complete profile starts collapsed on load; an
//     incomplete one (no name) starts expanded; Edit reopens the form
//     with values intact; saving again re-collapses.
//   * Your addresses: same treatment — collapsed once the home address
//     is set (Home: … · Hotel: …, hotel only when set), expanded when
//     empty, Edit reopens with values, saving re-collapses.
//   * Sync log: renders as a collapsed <details> whose summary carries
//     the latest run's line; the full rows live inside it.
//   * Calendar providers: a connected provider's card collapses to a
//     one-line summary (provider · Connected · last sync) with its
//     controls inside; once any provider is chosen, the unchosen
//     providers' connect prompts are hidden (display only) behind a
//     "Use a different calendar service" fallback that reveals them
//     again; with nothing connected, every option shows as before.
//   * Upload a schedule: an expandable panel — collapsed once a
//     calendar is connected (or a schedule was already imported), open
//     for a fresh user with neither; upload controls intact either way.
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
const SESSION = `cloudSession = { access_token: 'x', email: 'crna@example.com' };`;

(async () => {
  // ================= Profile — step 1 =================
  run(`
    ${SESSION}
    profileEditing = false;
    db.settings.scheduleName = ''; db.settings.employmentType = ''; db.settings.monthlyIncomeGoal = 0;
    globalThis.__acctIncomplete = accountPage();
  `);
  t('profile incomplete (no name): form expanded on load, no Edit button',
    sandbox.__acctIncomplete.includes('f_profileName') &&
    sandbox.__acctIncomplete.includes('data-action="save-profile"') &&
    !sandbox.__acctIncomplete.includes('data-action="edit-profile"'));

  run(`
    document.getElementById('f_profileName').value = 'Martin';
    document.getElementById('f_profileEmploymentType').value = '1099';
    document.getElementById('f_profileIncomeGoal').value = '40000';
    actions('save-profile');
    globalThis.__acctSaved = accountPage();
  `);
  t('save profile: section collapses to the one-line summary with Edit',
    sandbox.__acctSaved.includes('Martin · 1099 · Monthly goal: $40,000.00') &&
    sandbox.__acctSaved.includes('data-action="edit-profile"') &&
    !sandbox.__acctSaved.includes('f_profileName') &&
    !sandbox.__acctSaved.includes('data-action="save-profile"'));
  t('save profile: values stored unchanged (same save logic)',
    run(`db.settings.scheduleName`) === 'Martin' &&
    run(`db.settings.employmentType`) === '1099' &&
    run(`db.settings.monthlyIncomeGoal`) === 40000);

  run(`globalThis.__acctReload = accountPage();`);
  t('load with a complete profile: starts collapsed',
    sandbox.__acctReload.includes('data-action="edit-profile"') &&
    !sandbox.__acctReload.includes('f_profileName'));

  run(`
    actions('edit-profile');
    globalThis.__acctEdit = accountPage();
  `);
  t('Edit expands the form with current values intact',
    sandbox.__acctEdit.includes('f_profileName') &&
    sandbox.__acctEdit.includes('value="Martin"') &&
    sandbox.__acctEdit.includes('value="40000"') &&
    sandbox.__acctEdit.includes('data-action="save-profile"'));

  run(`
    actions('save-profile');
    globalThis.__acctResaved = accountPage();
  `);
  t('saving again re-collapses',
    sandbox.__acctResaved.includes('data-action="edit-profile"') &&
    !sandbox.__acctResaved.includes('f_profileName'));

  run(`
    db.settings.employmentType = ''; db.settings.monthlyIncomeGoal = 0; profileEditing = false;
    globalThis.__acctNameOnly = accountPage();
  `);
  t('summary shows only what is set (name alone: no type, no goal)',
    sandbox.__acctNameOnly.includes('<p>Martin</p>') &&
    sandbox.__acctNameOnly.includes('data-action="edit-profile"'));

  // ================= Your addresses =================
  run(`
    addressesEditing = false; homeGeocodeStatus = '';
    db.settings.homeAddress = ''; db.settings.hotelAddress = '';
    globalThis.__addrEmpty = homeAddressSection();
  `);
  t('addresses empty: form expanded on load, no Edit button',
    sandbox.__addrEmpty.includes('f_homeAddress') &&
    sandbox.__addrEmpty.includes('Save addresses') &&
    !sandbox.__addrEmpty.includes('data-action="edit-addresses"'));

  const ADDR_LINE = 'Save your home address and where you stay on call — we\'ll use them to calculate your mileage automatically.';
  t('addresses edit view carries the one-line mileage explanation (Nov 7, 2026)',
    sandbox.__addrEmpty.includes(ADDR_LINE) && sandbox.__addrEmpty.includes('<h2>Your addresses</h2>'));

  run(`
    db.settings.homeAddress = '1 Home St'; db.settings.hotelAddress = '9 Hotel Ave';
    globalThis.__addrSaved = homeAddressSection();
  `);
  t('addresses saved: collapsed to Home · Hotel summary with Edit',
    sandbox.__addrSaved.includes('Home: 1 Home St · Hotel: 9 Hotel Ave') &&
    sandbox.__addrSaved.includes('data-action="edit-addresses"') &&
    !sandbox.__addrSaved.includes('f_homeAddress'));
  t('addresses summary view carries the same one-line mileage explanation',
    sandbox.__addrSaved.includes(ADDR_LINE));

  run(`
    db.settings.hotelAddress = '';
    globalThis.__addrHomeOnly = homeAddressSection();
  `);
  t('summary omits Hotel when only Home is set',
    sandbox.__addrHomeOnly.includes('Home: 1 Home St') &&
    !sandbox.__addrHomeOnly.includes('Hotel:'));

  run(`
    db.settings.hotelAddress = '9 Hotel Ave';
    actions('edit-addresses');
    globalThis.__addrEdit = homeAddressSection();
  `);
  t('Edit expands the address form with values intact',
    sandbox.__addrEdit.includes('f_homeAddress') &&
    sandbox.__addrEdit.includes('value="1 Home St"') &&
    sandbox.__addrEdit.includes('value="9 Hotel Ave"'));

  await run(`submitHomeAddress({ currentTarget: { _map: { homeAddress: '2 New St', hotelAddress: '' } } })`);
  run(`globalThis.__addrResaved = homeAddressSection();`);
  t('saving addresses re-collapses (new values in the summary)',
    sandbox.__addrResaved.includes('Home: 2 New St') &&
    sandbox.__addrResaved.includes('data-action="edit-addresses"') &&
    !sandbox.__addrResaved.includes('f_homeAddress') &&
    run(`addressesEditing`) === false);

  // ================= Sync panel: log + providers =================
  run(`
    ${SESSION}
    liveSyncConfig = { state: 'ready', google: true, outlook: false, apple: true, encryption: true };
    liveSyncConnections = {};
    liveSyncAppleCalendars = [];
    liveSyncState.pending = [];
    liveSyncLog = [];
    globalThis.__panelFresh = liveSyncPanelHTML();
  `);
  t('fresh state: all provider options show, no fallback line, nothing collapsed',
    sandbox.__panelFresh.includes('Connect Google Calendar') &&
    sandbox.__panelFresh.includes('Connect Apple Calendar') &&
    sandbox.__panelFresh.includes('Not available yet') &&
    !sandbox.__panelFresh.includes('Use a different calendar service') &&
    !sandbox.__panelFresh.includes('sync-provider'));

  run(`
    liveSyncLog = [
      { created_at: '2026-11-06T12:00:00Z', provider: 'apple', direction: 'both', shifts_created: 3, shifts_updated: 1, shifts_flagged: 0, shifts_deleted: 0 },
      { created_at: '2026-11-05T12:00:00Z', provider: 'apple', direction: 'pull', shifts_created: 10, shifts_updated: 0, shifts_flagged: 2, shifts_deleted: 0 },
    ];
    globalThis.__panelLog = liveSyncPanelHTML();
  `);
  const logIdx = sandbox.__panelLog.indexOf('<details class="collapse-sub sync-log">');
  t('sync log renders collapsed (details, no open attribute) with the latest line in its summary',
    logIdx >= 0 &&
    sandbox.__panelLog.includes('Sync log · last:') &&
    sandbox.__panelLog.includes('apple') &&
    !/<details class="collapse-sub sync-log"[^>]*\sopen[\s>]/.test(sandbox.__panelLog));
  t('full log rows live inside the collapsed log',
    sandbox.__panelLog.indexOf('created 3') > logIdx &&
    sandbox.__panelLog.indexOf('created 10') > logIdx);

  run(`
    liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
    liveSyncAppleCalendars = [{ url: 'cal-work', name: 'Caleb Work Schedule', isDedicated: false }];
    liveSyncShowOthers = false;
    globalThis.__panelChosen = liveSyncPanelHTML();
  `);
  t('connected provider collapses to provider · Connected · last sync, controls inside',
    sandbox.__panelChosen.includes('<details class="collapse-sub sync-provider">') &&
    sandbox.__panelChosen.includes('Apple Calendar · Connected · Pulling from: Caleb Work Schedule · Last sync:') &&
    sandbox.__panelChosen.includes('Sync now') &&
    sandbox.__panelChosen.includes('Disconnect'));
  t('unchosen providers’ connect prompts hidden once one is chosen',
    !sandbox.__panelChosen.includes('Connect Google Calendar') &&
    !sandbox.__panelChosen.includes('Not available yet'));
  t('one quiet fallback line offers the other services',
    sandbox.__panelChosen.includes('Use a different calendar service') &&
    sandbox.__panelChosen.includes('data-action="live-toggle-other-calendars"'));
  t('hiding is display-only: the direct Google card still renders its connect prompt',
    run(`liveSyncProviderCard('google')`).includes('Connect Google Calendar'));

  run(`
    liveSyncAction('live-toggle-other-calendars');
    globalThis.__panelRevealed = liveSyncPanelHTML();
  `);
  t('fallback reveals the other providers again (and offers to hide them)',
    sandbox.__panelRevealed.includes('Connect Google Calendar') &&
    sandbox.__panelRevealed.includes('Not available yet') &&
    sandbox.__panelRevealed.includes('Hide other calendar services'));
  run(`
    liveSyncAction('live-toggle-other-calendars');
    globalThis.__panelRehidden = liveSyncPanelHTML();
  `);
  t('toggling again hides them again',
    !sandbox.__panelRehidden.includes('Connect Google Calendar') &&
    sandbox.__panelRehidden.includes('Use a different calendar service'));

  // ================= Upload a schedule =================
  run(`
    liveSyncConnections = {};
    db.settings.scheduleImported = false;
    schedulePreview = null; scheduleImportError = ''; scheduleAiStatus = ''; scheduleImportContext = '';
    globalThis.__schedFresh = scheduleImportHTML();
  `);
  t('upload a schedule: fresh user (no calendar, nothing imported) starts expanded',
    sandbox.__schedFresh.startsWith('<details class="panel collapse-panel" id="schedule-import-panel" open>') &&
    sandbox.__schedFresh.includes('f_scheduleFile') &&
    sandbox.__schedFresh.includes('Read schedule — preview only'));

  run(`
    liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z' } };
    globalThis.__schedConnected = scheduleImportHTML();
  `);
  t('upload a schedule: collapsed once a calendar is connected, controls intact inside',
    sandbox.__schedConnected.startsWith('<details class="panel collapse-panel" id="schedule-import-panel">') &&
    sandbox.__schedConnected.includes('Upload a schedule') &&
    sandbox.__schedConnected.includes('f_scheduleFile') &&
    sandbox.__schedConnected.includes('id="scheduleForm"'));

  run(`
    liveSyncConnections = {};
    db.settings.scheduleImported = true;
    globalThis.__schedImported = scheduleImportHTML();
    db.settings.scheduleImported = false;
  `);
  t('upload a schedule: also collapsed after a schedule was already imported',
    sandbox.__schedImported.startsWith('<details class="panel collapse-panel" id="schedule-import-panel">'));

  run(`
    schedulePreview = { rows: [] };
    globalThis.__schedBusy = scheduleImportHTML();
    schedulePreview = null;
  `);
  t('upload a schedule: an in-flight preview keeps it open',
    sandbox.__schedBusy.startsWith('<details class="panel collapse-panel" id="schedule-import-panel" open>'));

  t('service worker cache bumped to v65',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v132'));

  console.log(failures === 0 ? 'account-collapse test done: all passed' : 'account-collapse test done: FAILURES=' + failures);
})();
