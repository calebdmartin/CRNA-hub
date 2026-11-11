// CRNA Hub — full cloud sync (Nov 6, 2026): shifts, facilities,
// mileage trips, pay stubs, and settings join credentials in the
// automatic cloud merge. Before this build they lived only on the
// device — lose the phone, lose the data. Now:
//   * device A uploads everything (migration 010 tables; the row's
//     `data` jsonb carries the complete record, typed columns are
//     best-effort) and a fresh device B signing into the same account
//     gets it ALL back — same ids (calendar pairing depends on them),
//     no duplicates;
//   * a second user sees none of it (per-user scoping end to end);
//   * offline edits and an offline delete land on reconnect — the
//     delete travels as a tombstone and cannot resurrect;
//   * clear-device -> sign-in returns everything, no duplicates;
//   * sync is idempotent: a second merge changes nothing.
// The fake cloud below emulates PostgREST + RLS behind the /api/rest
// proxy shape sbReq uses: rows are only ever visible/writable by the
// token's owner.
// Run: node test-cloud-full-sync.js
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
let confirmAnswer = true;
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
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
  alert: () => {}, confirm: () => confirmAnswer,
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

// ---------------- Fake cloud (PostgREST + RLS behind /api/rest) ----
const TOKENS = { tokA: 'user-a', tokA2: 'user-a', tokB: 'user-b' };
const cloud = new Map(); // table -> Map(key -> row)
const tableOf = (name) => { if (!cloud.has(name)) cloud.set(name, new Map()); return cloud.get(name); };
const resp = (status, data) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(data === undefined ? '' : data) });
let online = true;
sandbox.fetch = async (url, opts) => {
  if (!online) throw new Error('offline-stub');
  const u = String(url);
  if (u === '/api/auth') return resp(200, {});
  if (u !== '/api/rest') throw new Error('unexpected url ' + u);
  const body = JSON.parse(opts.body);
  const user = TOKENS[body.token];
  if (!user) return resp(401, { message: 'bad token' });
  const m = body.path.match(/^\/rest\/v1\/([a-z_0-9]+)(\?(.*))?$/);
  if (!m) return resp(404, { message: 'no route' });
  const table = tableOf(m[1]);
  const qs = new URLSearchParams(m[3] || '');
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
    const idEq = (qs.get('id') || '').replace(/^eq\./, '');
    const row = table.get(idEq);
    if (row && row.user_id === user) table.delete(idEq);
    return resp(200, '');
  }
  return resp(405, {});
};
const cloudRows = (table, user) => [...tableOf(table).values()].filter(r => r.user_id === user);
const canon = (x) => JSON.stringify(x, Object.keys(x || {}).sort());
const canonRec = (x) => { const c = Object.assign({}, x); delete c.updatedAt; return JSON.stringify(c, Object.keys(c).sort()); };
const sess = (tok, uid) => ({ access_token: tok, refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, email: uid + '@example.com', user_id: uid });

(async () => {
  t('precondition: Supabase configured, cache v65',
    run(`SUPABASE_CONFIGURED`) === true && swSrc.includes('crna-hub-shell-v132'));
  t('source: full-sync tables and tombstones are wired',
    appSrc.includes("'/rest/v1/shifts'") && appSrc.includes("'/rest/v1/facilities'") &&
    appSrc.includes("'/rest/v1/mileage_trips'") && appSrc.includes("'/rest/v1/pay_stubs'") &&
    appSrc.includes("'/rest/v1/user_settings'") && appSrc.includes('cloudRecordTombstone') &&
    appSrc.includes('cloudMergeSyncedList'));

  // ---------- 1. Device A: populated account uploads everything ----
  run(`
    cloudSession = ${JSON.stringify(sess('tokA', 'user-a'))}; cloudActive = false;
    db.shifts = [
      { id: 'sh-1', date: '2026-11-02', facility: 'Holzer', type: 'Holzer 8', pay: '2125', status: 'confirmed', incomplete: false, source: 'calendar-apple', note: '', contractId: 'ct-9', updatedAt: '2026-11-05T10:00:00.000Z' },
      { id: 'sh-2', date: '2026-11-09', facility: 'CAMC', type: '8-hour day', pay: '', status: 'proposed', incomplete: true, source: 'user-entered', note: 'unpriced', updatedAt: '2026-11-05T10:00:00.000Z' },
    ];
    db.facilities = [{ id: 'fa-1', name: 'Holzer', aliases: '', address: '100 Hospital Dr, Gallipolis, OH', hourlyRate: '250', paidHours8: '8.5', rate8: '2000', rate10: '', rate12: '', rate24: '', rateSecond: '1000', weekendRateSecond: '2000', callBonus: '', hourlyCall1st: '175', weekendRate24: '', distance: '42', distanceSource: 'manual', ratesSource: 'contract', ratesSourceFile: 'holzer.pdf', ratesSourceDate: '2026-10-13', notes: '', lat: '', lng: '', geocodedAddress: '', updatedAt: '2026-11-05T10:00:00.000Z' }];
    db.mileage = [
      { id: 'mi-1', date: '2026-11-02', facility: 'Holzer', purpose: 'Scheduled facility trip: Holzer', miles: '84', oneWayMiles: '42', tripType: 'round-trip', milesSource: 'manual', origin: 'home', hotelAddress: '', status: 'verified', updatedAt: '2026-11-05T10:00:00.000Z' },
      { id: 'mi-2', date: '2026-10-20', facility: 'Holzer', purpose: 'Scheduled facility trip: Holzer', miles: '', oneWayMiles: '', tripType: 'round-trip', milesSource: '', origin: 'home', hotelAddress: '', status: 'dismissed', dismissedAt: '2026-11-06', updatedAt: '2026-11-06T10:00:00.000Z' },
    ];
    db.payStubs = [{ id: 'ps-1', agency: 'Premier Anesthesia', facility: 'Holzer', frequency: 'biweekly', periodStart: '2026-10-19', periodEnd: '2026-11-01', payDate: '2026-11-10', gross: '11500', net: '', source: 'ai-vision', fileName: 'stub.png', updatedAt: '2026-11-05T10:00:00.000Z' }];
    db.settings.scheduleName = 'Martin'; db.settings.employmentType = '1099';
    db.settings.homeAddress = '611 Olympia Fields Dr'; db.settings.monthlyIncomeGoal = 40000;
    persist();
    globalThis.__seed = JSON.parse(JSON.stringify({ shifts: db.shifts, facilities: db.facilities, mileage: db.mileage, payStubs: db.payStubs, settings: db.settings }));
  `);
  await run(`cloudAutoMerge()`);
  const upA = {
    shifts: cloudRows('shifts', 'user-a'), facilities: cloudRows('facilities', 'user-a'),
    mileage: cloudRows('mileage_trips', 'user-a'), payStubs: cloudRows('pay_stubs', 'user-a'),
    settings: cloudRows('user_settings', 'user-a'),
  };
  t('upload: all four record classes + settings reached the cloud',
    upA.shifts.length === 2 && upA.facilities.length === 1 && upA.mileage.length === 2 &&
    upA.payStubs.length === 1 && upA.settings.length === 1);
  t('upload: data payload round-trips the complete record (contractId, dismissedAt survive)',
    upA.shifts.find(r => r.id === 'sh-1').data.contractId === 'ct-9' &&
    upA.mileage.find(r => r.id === 'mi-2').data.dismissedAt === '2026-11-06' &&
    upA.facilities[0].data.ratesSourceFile === 'holzer.pdf');
  t('upload: typed columns are sane (pay numeric, blank pay null — never $0, dismissed status kept)',
    upA.shifts.find(r => r.id === 'sh-1').pay === 2125 &&
    upA.shifts.find(r => r.id === 'sh-2').pay === null &&
    upA.mileage.find(r => r.id === 'mi-2').status === 'dismissed' &&
    upA.settings[0].data.homeAddress === '611 Olympia Fields Dr');

  // ---------- 2. Idempotence -----------------------------------------
  const snap1 = JSON.stringify([...cloud.entries()].map(([k, v]) => [k, [...v.entries()]]));
  const dbSnap1 = run(`JSON.stringify({ shifts: db.shifts, facilities: db.facilities, mileage: db.mileage, payStubs: db.payStubs, settings: db.settings })`);
  await run(`cloudAutoMerge()`);
  const snap2 = JSON.stringify([...cloud.entries()].map(([k, v]) => [k, [...v.entries()]]));
  t('idempotent: a second sync changes nothing in the cloud', snap1 === snap2);
  t('idempotent: a second sync changes nothing on the device',
    run(`JSON.stringify({ shifts: db.shifts, facilities: db.facilities, mileage: db.mileage, payStubs: db.payStubs, settings: db.settings })`) === dbSnap1);

  // ---------- 3. Device B: fresh phone, same account ------------------
  run(`
    db = empty(); persist();
    localStorage.removeItem('crna-hub-settings-snapshot'); cloudSettingsSnapshot = null; cloudTombstones = [];
    cloudSession = ${JSON.stringify(sess('tokA2', 'user-a'))}; cloudActive = false;
  `);
  await run(`cloudAutoMerge()`);
  t('device B: everything arrives — counts match device A',
    run(`db.shifts.length`) === 2 && run(`db.facilities.length`) === 1 &&
    run(`db.mileage.length`) === 2 && run(`db.payStubs.length`) === 1);
  t('device B: same ids (calendar pairing stable), no duplicates',
    run(`JSON.stringify(db.shifts.map(x => x.id).sort())`) === JSON.stringify(['sh-1', 'sh-2']) &&
    run(`JSON.stringify(db.mileage.map(x => x.id).sort())`) === JSON.stringify(['mi-1', 'mi-2']));
  t('device B: records are field-for-field the seeded ones',
    run(`JSON.stringify(db.shifts.map(x => { const c = Object.assign({}, x); delete c.updatedAt; return c; }))`) ===
    JSON.stringify(sandbox.__seed.shifts.map(x => { const c = Object.assign({}, x); delete c.updatedAt; return c; })) &&
    run(`db.mileage.find(x => x.id === 'mi-2').status`) === 'dismissed' &&
    run(`db.payStubs[0].agency`) === 'Premier Anesthesia');
  t('device B: settings arrive (name, home address, goal)',
    run(`db.settings.scheduleName`) === 'Martin' && run(`db.settings.homeAddress`) === '611 Olympia Fields Dr' &&
    run(`db.settings.monthlyIncomeGoal`) === 40000);

  // ---------- 4. Two-user isolation -----------------------------------
  run(`
    db = empty(); persist();
    localStorage.removeItem('crna-hub-settings-snapshot'); cloudSettingsSnapshot = null; cloudTombstones = [];
    cloudSession = ${JSON.stringify(sess('tokB', 'user-b'))}; cloudActive = false;
  `);
  await run(`cloudAutoMerge()`);
  t('isolation: user B downloads none of user A\u2019s records',
    run(`db.shifts.length + db.facilities.length + db.mileage.length + db.payStubs.length`) === 0 &&
    run(`db.settings.homeAddress || ''`) === '');
  t('isolation: user B\u2019s cloud side holds only their (empty) settings row at most',
    cloudRows('shifts', 'user-b').length === 0 && cloudRows('facilities', 'user-b').length === 0 &&
    cloudRows('mileage_trips', 'user-b').length === 0 && cloudRows('pay_stubs', 'user-b').length === 0);

  // ---------- 5. Offline edit + offline delete, then reconnect --------
  run(`
    db = empty(); persist();
    localStorage.removeItem('crna-hub-settings-snapshot'); cloudSettingsSnapshot = null; cloudTombstones = [];
    cloudSession = ${JSON.stringify(sess('tokA', 'user-a'))}; cloudActive = true;
  `);
  await run(`cloudAutoMerge()`); // device A state restored locally
  online = false;
  run(`
    const s1 = db.shifts.find(x => x.id === 'sh-1'); s1.pay = '2225'; s1.updatedAt = '2026-11-06T20:00:00.000Z';
    db.facilities.push({ id: 'fa-2', name: 'CAMC', aliases: '', address: 'Charleston, WV', hourlyRate: '250', paidHours8: '', rate8: '2000', rate10: '2500', rate12: '3000', rate24: '', rateSecond: '', weekendRateSecond: '', callBonus: '', hourlyCall1st: '', weekendRate24: '', distance: '', distanceSource: '', ratesSource: 'manual', ratesSourceFile: '', ratesSourceDate: '', notes: '', lat: '', lng: '', geocodedAddress: '', updatedAt: '2026-11-06T20:00:00.000Z' });
    db.mileage = db.mileage.filter(x => x.id !== 'mi-1'); persist();
    cloudRecordTombstone('mileage', 'mi-1');
  `);
  const offOk = await run(`cloudAutoMerge()`);
  t('offline: merge reports failure, local edits and the tombstone survive',
    offOk === false && run(`db.shifts.find(x => x.id === 'sh-1').pay`) === '2225' &&
    run(`cloudTombstones.some(t => t.kind === 'mileage' && t.id === 'mi-1')`) === true);
  online = true;
  await run(`cloudAutoMerge()`);
  t('reconnect: the offline edit and new facility land in the cloud',
    cloudRows('shifts', 'user-a').find(r => r.id === 'sh-1').data.pay === '2225' &&
    cloudRows('facilities', 'user-a').some(r => r.id === 'fa-2'));
  t('reconnect: the offline delete lands — trip gone from cloud and not resurrected locally',
    !cloudRows('mileage_trips', 'user-a').some(r => r.id === 'mi-1') &&
    run(`db.mileage.some(x => x.id === 'mi-1')`) === false &&
    run(`cloudTombstones.length`) === 0);

  // ---------- 6. Newest-wins both directions --------------------------
  const shRow = tableOf('shifts').get('sh-1');
  shRow.data = Object.assign({}, shRow.data, { pay: '3333' });
  shRow.updated_at = '2026-11-06T21:00:00.000Z'; shRow.pay = 3333;
  await run(`cloudAutoMerge()`);
  t('conflict: a newer cloud edit wins over the older local copy',
    run(`db.shifts.find(x => x.id === 'sh-1').pay`) === '3333');
  run(`const s2 = db.shifts.find(x => x.id === 'sh-1'); s2.pay = '4444'; s2.updatedAt = '2026-11-06T22:00:00.000Z'; persist();`);
  await run(`cloudAutoMerge()`);
  t('conflict: a newer local edit wins and pushes up',
    cloudRows('shifts', 'user-a').find(r => r.id === 'sh-1').data.pay === '4444');
  t('conflict: still exactly one sh-1 everywhere (ids never re-minted)',
    run(`db.shifts.filter(x => x.id === 'sh-1').length`) === 1 &&
    cloudRows('shifts', 'user-a').filter(r => r.id === 'sh-1').length === 1);

  // ---------- 7. Clear device -> sign in -> everything back -----------
  confirmAnswer = true;
  await run(`cloudSignOutAndClearDevice()`);
  t('clear device: local data gone, session gone',
    run(`db.shifts.length + db.facilities.length + db.mileage.length + db.payStubs.length`) === 0 &&
    run(`cloudSession`) === null);
  run(`cloudSession = ${JSON.stringify(sess('tokA', 'user-a'))}; cloudActive = false;`);
  await run(`cloudAfterSignIn()`);
  t('sign back in: EVERYTHING returns from the cloud — shifts, facilities, mileage, pay stubs',
    run(`db.shifts.length`) === 2 && run(`db.facilities.length`) === 2 &&
    run(`db.mileage.length`) === 1 && run(`db.payStubs.length`) === 1);
  t('sign back in: settings return too, and still no duplicate ids',
    run(`db.settings.homeAddress`) === '611 Olympia Fields Dr' &&
    run(`new Set(db.shifts.map(x => x.id)).size`) === run(`db.shifts.length`) &&
    run(`db.shifts.some(x => x.id === 'sh-1' && x.pay === '4444')`) === true);
})().catch(e => { console.log('FAIL harness error: ' + (e && e.stack || e)); process.exitCode = 1; });
