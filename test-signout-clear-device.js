// CRNA Hub — Sign out & clear this device (Nov 6, 2026, Caleb): plain
// Sign out keeps the on-device copy by design, so showing the app to a
// friend meant his data was still on screen. The Account tab now has a
// second, separate option next to Sign out:
//   * "Sign out & clear this device" — confirms first, downloads the
//     JSON backup anyway (belt and suspenders), then signs out and wipes
//     every user store on the device: the database, the cloud session
//     markers, the in-progress portal check, the live-sync state
//     (pending deletions, tombstones, sync log) and all in-memory
//     previews/prompts — landing on the fresh signed-out state.
//   * The cloud account is never touched: the only network call is the
//     auth logout — no REST reads/writes, no DELETEs — so signing back
//     in re-runs the automatic merge and the records come back with
//     no duplicates (since the full cloud sync build, that includes
//     shifts, facilities, mileage, and pay stubs — the downloaded
//     backup via Restore remains as a fallback).
//   * Plain Sign out is unchanged: data stays on the device.
// Run: node test-signout-clear-device.js
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
let confirmAnswer = true, confirmMsg = '';
let lastBlob = null;
const fetchCalls = [];
const URL2 = URL;
URL2.createObjectURL = (b) => { lastBlob = b; return 'blob:stub'; };
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
  alert: () => {}, confirm: (m) => { confirmMsg = String(m); return confirmAnswer; },
  fetch: async (url, opts) => { fetchCalls.push({ url: String(url), method: (opts && opts.method) || 'GET' }); throw new Error('network-stub'); },
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

(async () => {
  t('Supabase is configured in this checkout (precondition)', run(`SUPABASE_CONFIGURED`) === true);

  // ---------- Seed a fully signed-in, populated device ----------
  run(`
    db.shifts = [{ id: 'shift-1', date: '2026-11-02', facility: 'Holzer', type: 'Holzer 8', pay: '2125', status: 'confirmed', incomplete: false, source: 'calendar-import', note: '' }];
    db.facilities = [{ id: 'fac-1', name: 'Holzer', address: 'Gallipolis, OH' }];
    db.mileage = [{ id: 'mi-1', date: '2026-11-02', facility: 'Holzer', miles: 80, status: 'verified', tripType: 'round-trip', oneWayMiles: 40 }];
    db.payStubs = [{ id: 'ps-1', agency: 'Premier Anesthesia', facility: 'Holzer', frequency: 'biweekly', payDate: '2026-11-10' }];
    db.licenses = [{ id: 'lic-1', state: 'WV', type: 'APRN', number: '103459', issue: '', expiry: '2027-06-30', portal: '', note: '', source: 'user_entered', reminders: '90,60,30,7' }];
    Object.assign(db.nbcrna, { status: 'Certified', number: '126402', periodEnd: '2027-04-30' });
    db.assistantChat = [{ who: 'user', text: 'private chat' }];
    db.portalMonitoring = [{ key: 'nbcrna', source: 'nbcrna', enabled: true }];
    db.settings.scheduleName = 'Martin';
    db.settings.homeAddress = '611 Olympia Fields Dr';
    persist();
    localStorage.setItem('crna-hub-starter-v1', '{"shifts":[{"id":"legacy"}]}');
    localStorage.setItem('crna-hub-portal-check', JSON.stringify({ check: { source: 'nbcrna', step: 'collect', page: 1, fields: {}, found: [], missing: [] }, opened: { nbcrna: true } }));
    liveSyncState = { pending: [{ shiftId: 'shift-1', provider: 'apple' }], tombstones: [{ id: 'shift-9', provider: 'apple' }], lastImport: { at: '2026-11-06T00:00:00.000Z' }, repairImport: false, shiftSync: { apple: { 'shift-1': 'synced' } } };
    liveSyncStateSave();
    liveSyncLog = [{ at: '2026-11-06T00:00:00.000Z', message: 'Synced Holzer shifts' }];
    liveSyncConnections = { apple: { status: 'connected', lastSyncedAt: '2026-11-06T00:00:00.000Z' } };
    cloudSession = { access_token: 'tok', refresh_token: 'ref', expires_at: Date.now() / 1000 + 3600, user_id: 'u1', email: 'crna@example.com' };
    cloudActive = true; cloudLastSync = '2026-11-06T00:00:00.000Z'; cloudPersistSession();
    portalCheckRestore();
  `);

  // ---------- 1. Both options are offered, clearly separate ----------
  const acct = run(`accountPage()`);
  t('signed-in Account panel keeps plain Sign out', acct.includes('data-action="cloud-signout">Sign out</button>'));
  t('signed-in Account panel adds Sign out & clear this device', acct.includes('data-action="cloud-signout-clear"') && acct.includes('Sign out &amp; clear this device'));
  t('clear action is wired in the dispatcher', appSrc.includes("action==='cloud-signout-clear'") && appSrc.includes('cloudSignOutAndClearDevice'));

  // ---------- 2. Confirmation is required — declining changes nothing ----------
  confirmAnswer = false;
  await run(`cloudSignOutAndClearDevice()`);
  t('declining the confirmation keeps the data', run(`db.shifts.length`) === 1 && run(`db.licenses.length`) === 1);
  t('declining keeps the session and the stored database', run(`!!cloudSession`) === true && store.has('crna-hub-v2'));
  t('confirmation says what happens, in plain words',
    confirmMsg.includes('clears everything off this phone') && confirmMsg.includes('come back when you sign in'));

  // ---------- 3. Confirming clears the whole device ----------
  confirmAnswer = true;
  fetchCalls.length = 0;
  run(`actions('cloud-signout-clear')`);
  await new Promise(r => setTimeout(r, 50));
  t('confirmation was asked again before clearing', confirmMsg.includes('clears everything off this phone'));
  t('database is empty: shifts, facilities, mileage, pay stubs, licenses, chat, monitoring',
    run(`db.shifts.length + db.facilities.length + db.mileage.length + db.payStubs.length + db.licenses.length + db.assistantChat.length + db.portalMonitoring.length`) === 0);
  t('singletons and settings are reset (NBCRNA blank, profile name and home address gone)',
    run(`db.nbcrna.status === '' && db.settings.scheduleName === '' && db.settings.homeAddress === ''`) === true);
  t('localStorage user stores are removed',
    !store.has('crna-hub-v2') && !store.has('crna-hub-starter-v1') && !store.has('crna-hub-portal-check') &&
    !store.has('crna-hub-live-sync') && !store.has('crna-hub-supabase-session') && !store.has('crna-hub-last-sync'));
  t('session is gone', run(`cloudSession`) === null && run(`cloudActive`) === false);
  t('no leftover surfaces: portal check, pending deletions, tombstones, sync log, connections all reset',
    run(`portalCheck === null && liveSyncState.pending.length === 0 && liveSyncState.tombstones.length === 0 && liveSyncLog.length === 0 && Object.keys(liveSyncConnections).length === 0`) === true);
  const acctAfter = run(`accountPage()`);
  t('lands on the fresh signed-out state (sign-in form, no signed-in line)',
    acctAfter.includes('cloudAuthForm') && !acctAfter.includes('Signed in as'));
  t('dashboard shows none of his data', !run(`dashboard()`).includes('Holzer'));
  t('cloud account untouched by the clear: no REST calls, no DELETEs (auth logout only)',
    fetchCalls.every(c => !c.url.includes('/rest/v1/') && c.method !== 'DELETE'));

  // ---------- 4. A backup downloaded first, so the clear stays recoverable ----------
  t('a backup file was downloaded before clearing', !!lastBlob);
  const backupText = lastBlob ? await lastBlob.text() : '';
  const backup = backupText ? JSON.parse(backupText) : {};
  t('backup holds the records (shift, facility, mileage)',
    !!backup.shifts && backup.shifts.some(x => x.id === 'shift-1') && backup.facilities.some(x => x.id === 'fac-1') && backup.mileage.some(x => x.id === 'mi-1'));

  // ---------- 5. Sign back in: the cloud merge restores credentials, no dupes ----------
  const cloudData = {
    nbcrna: { certification_status: 'Certified', certification_number: '126402', period_start: '2023-05-01', period_end: '2027-04-30', renewal_deadline: '2027-04-30', class_a_credits: 103, class_b_credits: 2, mac_ed_credits: 60, mac_dev_credits: 40, mac_ed_required: 60, mac_dev_required: 40, source: 'user_entered', last_synced_at: '2026-11-05T00:00:00.000Z' },
    aana: null, portals: [], documents: [],
    licenses: [{ id: 'lic-1', user_id: 'u1', state: 'WV', license_type: 'APRN', license_number: '103459', issue_date: '', expiration_date: '2027-06-30', status: null, board_portal_url: '', notes: '', source: 'user_entered', last_synced_at: '2026-11-05T00:00:00.000Z' }],
    ce: [{ id: 'ce-1', user_id: 'u1', source: 'nbcrna', title: 'Course A', credits: 5, credit_class: 'Class A', completed_date: '2026-10-01', last_synced_at: '2026-11-05T00:00:00.000Z' }],
  };
  run(`
    cloudSession = { access_token: 'tok2', refresh_token: 'ref2', expires_at: Date.now() / 1000 + 3600, user_id: 'u1', email: 'crna@example.com' };
    globalThis.__cloudData = ${JSON.stringify(cloudData)};
    cloudApplyData(globalThis.__cloudData);
    cloudApplyData(globalThis.__cloudData);
  `);
  t('sign-in merge restores the credential records from the account',
    run(`db.nbcrna.status`) === 'Certified' && run(`db.licenses.length`) === 1 && run(`db.nbcrnaCE.length`) === 1);
  t('applying the merge twice creates no duplicates',
    run(`db.licenses.filter(x => x.id === 'lic-1').length`) === 1 && run(`db.nbcrnaCE.filter(x => x.id === 'ce-1').length`) === 1);

  // ---------- 6. Records also come back from the backup ----------
  await run(`restoreBackup({ target: { files: [{ text: async () => ${JSON.stringify(backupText)} }] } })`);
  t('restore brings back the shifts, facilities, and mileage from the backup',
    run(`db.shifts.some(x => x.id === 'shift-1') && db.facilities.some(x => x.id === 'fac-1') && db.mileage.some(x => x.id === 'mi-1')`) === true);

  // ---------- 7. Plain Sign out is unchanged ----------
  run(`
    localStorage.setItem('crna-hub-portal-check', '{"check":null,"opened":{"nbcrna":true}}');
    cloudSession = { access_token: 'tok3', refresh_token: 'ref3', expires_at: Date.now() / 1000 + 3600, user_id: 'u1', email: 'crna@example.com' };
    cloudActive = true; cloudPersistSession();
  `);
  await run(`cloudSignOut()`);
  t('plain sign out ends the session', run(`cloudSession`) === null);
  t('plain sign out leaves the data on the device (database and portal state intact)',
    store.has('crna-hub-v2') && JSON.parse(store.get('crna-hub-v2')).shifts.some(x => x.id === 'shift-1') && store.has('crna-hub-portal-check'));
  t('service worker cache bumped to v65', swSrc.includes('crna-hub-shell-v92'));
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
