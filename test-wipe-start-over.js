// CRNA Hub — Start over (testing): erase my account & this device
// (Nov 7, 2026, Caleb). A TESTING utility, not a product feature: a
// collapsed "Testing tools" panel at the bottom of the Account tab
// (signed-in only). Caleb asked for it after learning the on-device
// store is shared across accounts — signing in with a new email merged
// his phone data INTO that account, and there was no way to un-copy
// it. He explicitly declined a backup: "starting from scratch on even
// on my actual account" — so unlike "Sign out & clear this device"
// (kept untouched, backup-first, account preserved), this tool:
//   * erases the signed-in account's CLOUD data — every user-scoped
//     table (migrations 001–012 set: synced records, credentials,
//     portal connections, documents + their stored files, calendar
//     connections/pairings/logs) plus the profile fields in Auth
//     user_metadata — through the user's own token, so RLS scopes
//     every delete to the caller and a second user is untouchable;
//   * keeps the Auth user: same email/password signs back in to a
//     genuinely EMPTY account (no resurrection through the merge,
//     no connected calendar providers);
//   * then clears the device and signs out (the cloudSignOutAndClear
//     Device tail, minus the backup — no download ever happens);
//   * is gated by a serious confirmation: the sheet names the account
//     email and requires typing ERASE plus a second armed tap — one
//     casual tap erases nothing;
//   * fails honestly: steps stop at the first failure, the report
//     names what was erased / what failed / what was not attempted,
//     and the device + session are left exactly as they were.
// The fake cloud below emulates PostgREST + RLS + Storage + the auth
// proxy behind the shapes sbReq / sbStorageReq / sbAuthReq use.
// Run: node test-wipe-start-over.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = fs.existsSync(path.join(__dirname, 'repo', 'app.js'))
  ? path.join(__dirname, 'repo') + path.sep
  : __dirname + path.sep;
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
  constructor(form) { this._e = (form && form._entries) || []; }
  *[Symbol.iterator]() { yield* this._e; }
}
let blobUrls = 0;
const URL2 = URL;
URL2.createObjectURL = () => { blobUrls++; return 'blob:stub'; };
URL2.revokeObjectURL = () => {};
const sandbox = {
  console, setTimeout, clearTimeout, URL: URL2, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  Blob,
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
  alert: () => {}, confirm: () => true,
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) process.exitCode = 1;
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
const restSrc = fs.readFileSync(R + 'api/rest.js', 'utf8');

// ---------------- Fake cloud -------------------------------------
const TOKENS = { tokA: 'user-a', tokA2: 'user-a', tokB: 'user-b' };
const EMAILS = { 'user-a': 'caleb@example.com', 'user-b': 'other@example.com' };
const TABLES = ['shifts', 'facilities', 'mileage_trips', 'pay_stubs', 'vehicles', 'user_settings',
  'nbcrna_profiles', 'aana_memberships', 'licenses', 'ce_records', 'portal_connections', 'documents',
  'calendar_connections', 'calendar_sync_map', 'calendar_import_map', 'calendar_pending_deletions',
  'calendar_oauth_states', 'sync_log'];
const cloud = new Map();
const tableOf = (name) => { if (!cloud.has(name)) cloud.set(name, new Map()); return cloud.get(name); };
const storageObjects = new Set();
const authMeta = { 'user-a': {}, 'user-b': {} };
const requests = [];
let failDeleteTable = null;
const resp = (status, data) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(data === undefined ? '' : data) });
sandbox.fetch = async (url, opts) => {
  const u = String(url);
  if (u === '/api/auth') {
    const body = JSON.parse(opts.body);
    const user = TOKENS[body.token];
    if (body.endpoint === 'logout') return resp(200, {});
    if (body.endpoint === 'update-user') {
      if (!user) return resp(401, { message: 'bad token' });
      Object.assign(authMeta[user], (body.body && body.body.data) || {});
      return resp(200, { id: user, email: EMAILS[user], user_metadata: authMeta[user] });
    }
    return resp(200, {});
  }
  if (u !== '/api/rest') throw new Error('unexpected url ' + u);
  const body = JSON.parse(opts.body);
  const user = TOKENS[body.token];
  if (!user) return resp(401, { message: 'bad token' });
  if (body.path.startsWith('/storage/v1/object/certification-documents/')) {
    const p = decodeURIComponent(body.path.slice('/storage/v1/object/certification-documents/'.length));
    requests.push({ storage: p, method: body.method, user });
    if (body.method === 'DELETE') { storageObjects.delete(p); return resp(200, {}); }
    return resp(200, {});
  }
  const m = body.path.match(/^\/rest\/v1\/([a-z_0-9]+)(\?(.*))?$/);
  if (!m) return resp(404, { message: 'no route' });
  const table = tableOf(m[1]);
  const qs = new URLSearchParams(m[3] || '');
  requests.push({ table: m[1], method: body.method, user, userIdFilter: (qs.get('user_id') || '').replace(/^eq\./, '') });
  if (body.method === 'GET') {
    const want = (qs.get('user_id') || '').replace(/^eq\./, '');
    if (want && want !== user) return resp(200, []); // RLS: not your rows
    return resp(200, [...table.values()].filter(r => r.user_id === user));
  }
  if (body.method === 'POST') {
    const rows = Array.isArray(body.body) ? body.body : [body.body];
    for (const row of rows) {
      if (row.user_id !== user) return resp(403, { message: 'RLS violation' });
      table.set(row.id || row.user_id, JSON.parse(JSON.stringify(row)));
    }
    return resp(201, '');
  }
  if (body.method === 'DELETE') {
    if (failDeleteTable === m[1]) return resp(500, { message: 'injected failure on ' + m[1] });
    const idEq = (qs.get('id') || '').replace(/^eq\./, '');
    const uidEq = (qs.get('user_id') || '').replace(/^eq\./, '');
    for (const [k, row] of [...table.entries()]) {
      if (row.user_id !== user) continue; // RLS: only ever your own rows
      if (idEq && row.id !== idEq) continue;
      if (uidEq && row.user_id !== uidEq) continue;
      table.delete(k);
    }
    return resp(200, '');
  }
  return resp(405, {});
};
const cloudRows = (table, user) => [...tableOf(table).values()].filter(r => r.user_id === user);
const sess = (tok, uid) => ({ access_token: tok, refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, email: EMAILS[uid], user_id: uid });

function seedCloudUser(uid, tag) {
  for (const tb of TABLES) {
    if (tb === 'user_settings') { tableOf(tb).set(uid, { user_id: uid, data: { scheduleName: tag, homeAddress: '1 Main St' } }); continue; }
    if (tb === 'nbcrna_profiles' || tb === 'aana_memberships') { tableOf(tb).set(uid, { user_id: uid, source: 'user_entered' }); continue; }
    tableOf(tb).set(tag + '-1', { id: tag + '-1', user_id: uid });
    tableOf(tb).set(tag + '-2', { id: tag + '-2', user_id: uid });
  }
  tableOf('documents').set(tag + '-doc', { id: tag + '-doc', user_id: uid, storage_path: uid + '/' + tag + '.pdf' });
  storageObjects.add(uid + '/' + tag + '.pdf');
  authMeta[uid] = { schedule_name: tag, employment_type: '1099', monthly_income_goal: 40000 };
}
function seedDevice() {
  run(`
    db.shifts = [{ id: 'sh-1', date: '2026-11-02', facility: 'Holzer', type: 'Holzer 8', pay: '2125', status: 'confirmed', incomplete: false, source: 'calendar-apple', note: '' }];
    db.facilities = [{ id: 'fa-1', name: 'Holzer', address: 'Gallipolis, OH' }];
    db.mileage = [{ id: 'mi-1', date: '2026-11-02', facility: 'Holzer', miles: 80, status: 'verified', tripType: 'round-trip', oneWayMiles: 40 }];
    db.payStubs = [{ id: 'ps-1', agency: 'Premier Anesthesia', facility: 'Holzer', frequency: 'biweekly', payDate: '2026-11-10' }];
    db.vehicles = [{ id: 'vh-1', name: 'Expedition', isDefault: true }];
    db.licenses = [{ id: 'lic-1', state: 'WV', type: 'APRN', number: '103459', issue: '', expiry: '2027-06-30', portal: '', note: '', source: 'user_entered', reminders: '90,60,30,7' }];
    db.documents = [{ id: 'doc-1', certType: 'ACLS', issue: '', expiry: '2027-05-31', fileName: 'acls.pdf', storagePath: 'user-a/a.pdf', storageStatus: 'cloud' }];
    db.settings.scheduleName = 'Martin'; db.settings.homeAddress = '611 Olympia Fields Dr';
    persist();
    cloudTombstones = [{ kind: 'shifts', id: 'ghost-1' }]; cloudTombstonesPersist();
    localStorage.setItem('crna-hub-live-sync', JSON.stringify({ pending: [{ shiftId: 'sh-1' }] }));
    cloudSession = ${JSON.stringify(sess('tokA', 'user-a'))};
    cloudActive = true; cloudLastSync = '2026-11-06T00:00:00.000Z'; cloudPersistSession();
  `);
}

(async () => {
  t('precondition: Supabase configured, cache v89', run(`SUPABASE_CONFIGURED`) === true && swSrc.includes('crna-hub-shell-v118'));
  t('source: single mount + dispatcher wiring + no-backup erase path',
    appSrc.includes('testingToolsMountHTML()') && appSrc.includes("action==='wipe-open'") &&
    appSrc.includes("action==='wipe-erase'") && appSrc.includes('wipeEraseRun') &&
    appSrc.includes('TESTING UTILITY'));
  t('source: rest proxy allowlists every table the wipe deletes',
    TABLES.every(tb => restSrc.includes("'" + tb + "'")));

  // ---------- Placement: signed-in only, subdued, distinct ----------
  seedDevice();
  const acctIn = run(`accountPage()`);
  t('signed-in Account shows the Testing tools panel, collapsed, at the end',
    acctIn.includes('id="testing-tools-panel"') && acctIn.indexOf('testing-tools-panel') > acctIn.indexOf('Sign out &amp; clear this device') &&
    !acctIn.slice(acctIn.indexOf('testing-tools-panel'), acctIn.indexOf('testing-tools-panel') + 200).includes(' open'));
  t('panel label is the plain testing wording',
    acctIn.includes('Start over (testing) — erase my account &amp; this device') && acctIn.includes('No backup is made'));
  t('existing Sign out & clear this device is untouched beside it',
    acctIn.includes('data-action="cloud-signout-clear"') && acctIn.includes('Sign out &amp; clear this device'));
  run(`cloudSession = null;`);
  t('signed-out Account has no wipe tool', !run(`accountPage()`).includes('Start over (testing)'));
  run(`cloudSession = ${JSON.stringify(sess('tokA', 'user-a'))}; cloudActive = true;`);

  // ---------- Seed the cloud: user A (full) + user B (must survive) --
  seedCloudUser('user-a', 'a');
  seedCloudUser('user-b', 'b');
  const bBefore = JSON.stringify(TABLES.map(tb => [tb, cloudRows(tb, 'user-b').length]));
  t('seeded: A has rows in every table, B has rows in every table',
    TABLES.every(tb => cloudRows(tb, 'user-a').length > 0 && cloudRows(tb, 'user-b').length > 0));

  // ---------- The gate: typing + arming, never one tap ---------------
  run(`wipeConfirm = { text: '', armed: false, busy: false, step: '', error: '', report: null };`);
  elements['f_wipeText'] = el(); elements['f_wipeText'].value = '';
  run(`wipeEraseTap()`);
  t('empty confirmation erases nothing and does not arm',
    run(`wipeConfirm.armed`) === false && TABLES.every(tb => cloudRows(tb, 'user-a').length > 0) && !!run(`cloudSession`));
  elements['f_wipeText'].value = 'erase';
  run(`wipeEraseTap()`);
  t('lowercase "erase" is not accepted', run(`wipeConfirm.armed`) === false && run(`wipeConfirm.error`).includes('ERASE'));
  elements['f_wipeText'].value = 'ERASE';
  run(`wipeEraseTap()`);
  t('typing ERASE only arms — still nothing erased, still signed in',
    run(`wipeConfirm.armed`) === true && TABLES.every(tb => cloudRows(tb, 'user-a').length > 0) && !!run(`cloudSession`));
  const deletesBefore = requests.filter(r => r.method === 'DELETE').length;
  t('no DELETE of any kind happened during the gate', deletesBefore === 0);

  // ---------- The wipe itself -----------------------------------------
  run(`wipeEraseTap()`); // second, armed tap — runs the wipe
  for (let i = 0; i < 200 && run(`!!cloudSession`); i++) await new Promise(r => setTimeout(r, 10));
  t('wipe completed and signed out', run(`cloudSession`) === null && run(`wipeConfirm`) === null);
  t('cloud: user A erased from EVERY user-scoped table', TABLES.every(tb => cloudRows(tb, 'user-a').length === 0));
  t('cloud: user B completely untouched', JSON.stringify(TABLES.map(tb => [tb, cloudRows(tb, 'user-b').length])) === bBefore);
  t('every wipe DELETE carried A\u2019s token identity and A\u2019s user_id filter',
    requests.filter(r => r.method === 'DELETE' && r.table).every(r => r.user === 'user-a' && r.userIdFilter === 'user-a'));
  t('storage: A\u2019s uploaded file deleted, B\u2019s kept',
    !storageObjects.has('user-a/a.pdf') && storageObjects.has('user-b/b.pdf'));
  t('auth profile metadata cleared for A, intact for B',
    authMeta['user-a'].schedule_name === null && authMeta['user-a'].employment_type === null &&
    authMeta['user-a'].monthly_income_goal === null && authMeta['user-b'].schedule_name === 'b');
  t('device: local database, tombstones, live-sync state and session key all gone',
    !store.has('crna-hub-v2') && !store.has('crna-hub-cloud-tombstones') && !store.has('crna-hub-live-sync') &&
    !store.has('crna-hub-supabase-session') && run(`db.shifts.length`) === 0 && run(`db.facilities.length`) === 0);
  t('NO backup was downloaded during the wipe', blobUrls === 0);
  t('signed-out Account explains the start-over', run(`accountPage()`).includes('Start over (testing) is done'));

  // ---------- No resurrection: sign back in, merge finds nothing ------
  run(`
    cloudSession = ${JSON.stringify(sess('tokA2', 'user-a'))}; cloudActive = false;
  `);
  await run(`cloudAutoMerge()`);
  t('sign-in after wipe merges to EMPTY (no ghosts from cloud or tombstones)',
    run(`db.shifts.length`) === 0 && run(`db.facilities.length`) === 0 && run(`db.mileage.length`) === 0 &&
    run(`db.payStubs.length`) === 0 && run(`db.vehicles.length`) === 0 && run(`db.licenses.length`) === 0 &&
    run(`db.documents.length`) === 0 && run(`(db.settings.scheduleName || '')`) === '');
  t('cloud still holds no A DATA after the merge — only what a brand-new account\u2019s first merge creates',
    TABLES.filter(tb => tb !== 'portal_connections' && tb !== 'user_settings').every(tb => cloudRows(tb, 'user-a').length === 0) &&
    cloudRows('portal_connections', 'user-a').every(r => r.status === 'not_connected') &&
    cloudRows('user_settings', 'user-a').every(r => !r.data || ((r.data.scheduleName || '') === '' && (r.data.homeAddress || '') === '' && !(Number(r.data.monthlyIncomeGoal) > 0))));

  // ---------- Failure: stop, report honestly, device intact -----------
  seedCloudUser('user-a', 'a2');
  seedDevice();
  failDeleteTable = 'mileage_trips';
  run(`wipeConfirm = { text: 'ERASE', armed: true, busy: false, step: '', error: '', report: null };`);
  await run(`wipeEraseRun()`);
  const rep = run(`wipeConfirm && wipeConfirm.report`);
  t('failure produced a report (no success claimed)', !!rep && rep.failed === 'Mileage trips');
  t('report names erased / failed / not-attempted honestly',
    rep.erased.includes('Shifts') && rep.erased.includes('Facilities') &&
    rep.remaining.includes('Vehicles') && rep.remaining.includes('Settings, addresses & feature choices'));
  t('failure stopped at the failing step: earlier tables erased, later ones intact',
    cloudRows('shifts', 'user-a').length === 0 && cloudRows('facilities', 'user-a').length === 0 &&
    cloudRows('mileage_trips', 'user-a').length > 0 && cloudRows('vehicles', 'user-a').length > 0 &&
    cloudRows('user_settings', 'user-a').length > 0);
  t('device NOT cleared and session kept after the failure',
    !!run(`cloudSession`) && run(`db.shifts.length`) === 1 && store.has('crna-hub-v2'));
  t('user B still untouched after the failed wipe', JSON.stringify(TABLES.map(tb => [tb, cloudRows(tb, 'user-b').length])) === bBefore);

  // ---------- Retry after failure is safe and completes ---------------
  failDeleteTable = null;
  await run(`wipeEraseRun()`);
  t('retry completes the wipe (idempotent re-run)',
    run(`cloudSession`) === null && TABLES.every(tb => cloudRows(tb, 'user-a').length === 0));
  t('user B untouched at the very end', JSON.stringify(TABLES.map(tb => [tb, cloudRows(tb, 'user-b').length])) === bBefore);
})();
