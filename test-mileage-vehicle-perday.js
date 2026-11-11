// CRNA Hub — tests for per-day vehicle editing in the weekly mileage
// review (Nov 7, 2026, branch muse/credentialing).
// Run: node test-mileage-vehicle-perday.js
//
// Caleb: "I don't drive the same vehicle everyday of the week so make
// sure you can edit individual days or select 'same vehicle for all
// days' something like that."
//
// The model:
//   * EVERY trip row (confirmed trips included) carries its own
//     compact vehicle picker whenever the user has 2+ vehicles —
//     tucked under the facility name, no separate wide column.
//   * The week control is reframed as the explicit all-days action:
//     "Same vehicle for all days:" + Apply. Applying sets EVERY trip
//     in the week to that vehicle, overriding per-day picks.
//   * Per-day picks made AFTER an apply are later deliberate choices:
//     they stand through save/reload and the cloud round trip, and a
//     mixed-vehicle week exports per-trip in the CSV.
//   * Changing a vehicle never un-confirms a trip and never changes
//     its miles or the week's totals.
//
// Fixture is Caleb's shape: the week of Nov 2–8, 2026, seven
// confirmed Holzer trips at 68.6 mi each (480.2 total), vehicles
// "Truck" (default) and "Car".
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;

function makeWorld(store, downloads) {
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
    Blob: class { constructor(parts) { this.parts = parts; } },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:fake'; };
  sandbox.URL.revokeObjectURL = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
const cssSrc = fs.readFileSync(R + 'styles.css', 'utf8');

const PICKS_STUB = `
  window.__vehPicks = {};
  document.querySelector = (s) => {
    const m = /\\[data-trip="([^"]+)"\\]/.exec(s);
    if (m && s.indexOf('reviewVehicle') >= 0 && window.__vehPicks && (m[1] in window.__vehPicks)) return { value: window.__vehPicks[m[1]] };
    return null;
  };`;

const SEED = `
  db.facilities = []; db.hotelStays = [];
  db.vehicles = [
    {id: 'veh-truck', name: 'Truck', make: '', model: '', year: '', isDefault: true, updatedAt: '2026-11-07T10:00:00.000Z'},
    {id: 'veh-car', name: 'Car', make: '', model: '', year: '', isDefault: false, updatedAt: '2026-11-07T10:00:00.000Z'},
  ];
  db.shifts = [2, 3, 4, 5, 6, 7, 8].map(d => ({id: 'ps-' + d, date: '2026-11-0' + d, facility: 'Holzer', type: '8-hour day', status: 'confirmed', pay: '2125'}));
  db.mileage = [2, 3, 4, 5, 6, 7, 8].map(d => ({id: 'pd-' + d, date: '2026-11-0' + d, facility: 'Holzer', purpose: 'work', miles: '68.6', status: 'verified', origin: 'home', tripType: 'round-trip', oneWayMiles: '34.3', milesSource: 'auto', hotelAddress: ''}));
  mileageReviewWeek = '2026-11-02'; mileageReviewVehicleWeek = ''; mileageReviewVehicleId = '';
  persist();
`;
const weekTotal = (run) => run(`mileageTripsInWeek('2026-11-02').reduce((s, m) => s + num(m.miles), 0)`);

(async () => {
  const store = new Map();
  const downloads = [];
  const { run } = makeWorld(store, downloads);
  run(PICKS_STUB);
  run(SEED);

  // ================= 1. Rendering =================
  const review = run(`mileageReviewHTML()`);
  t('the week control is labelled "Same vehicle for all days:"', review.includes('Same vehicle for all days:'));
  t('it carries an explicit Apply button', review.includes('data-action="mileage-review-vehicle-apply"'));
  t('it says what Apply does, in one line',
    review.includes('Applies to all 7 days in this week') && review.includes('you can still change single days below'));
  t('every one of the 7 rows carries its own vehicle picker',
    (review.match(/class="reviewVehicle"/g) || []).length === 7);
  t('confirmed rows carry the picker too (all 7 trips are confirmed)',
    review.includes('data-trip="pd-4"') && review.includes('data-trip="pd-6"'));
  t('no separate Vehicle column — the picker sits in the facility cell',
    !review.includes('<th>Vehicle</th>') && review.indexOf('Holzer') < review.indexOf('class="reviewVehicle"'));
  t('the compact picker style exists', cssSrc.includes('.reviewVehicle{display:block'));
  t('source: changing the week select no longer stamps on its own',
    !appSrc.includes('stampWeekVehicle(wk,mrv.value)'));
  t('fixture total is 7 x 68.6 = 480.2', Math.abs(weekTotal(run) - 480.2) < 0.001);

  // ================= 2. All-days apply: Truck =================
  run(`stampWeekVehicle('2026-11-02', 'veh-truck');`);
  t('all-days apply puts Truck on all 7 trips',
    run(`db.mileage.filter(m => m.vehicleId === 'veh-truck' && m.vehicleName === 'Truck').length`) === 7);
  t('all 7 stay confirmed, miles and totals unchanged',
    run(`db.mileage.every(m => m.status === 'verified' && m.miles === '68.6')`) === true &&
    Math.abs(weekTotal(run) - 480.2) < 0.001);

  // ============ 3. Per-day picks after the apply ============
  run(`window.__vehPicks = {'pd-4': 'veh-car', 'pd-6': 'veh-car'};`);
  run(`applyMileageReviewEdits('2026-11-02');`);
  run(`window.__vehPicks = {};`);
  t('Nov 4 and Nov 6 are now Car',
    run(`db.mileage.find(m => m.id === 'pd-4').vehicleId`) === 'veh-car' &&
    run(`db.mileage.find(m => m.id === 'pd-6').vehicleId`) === 'veh-car');
  t('the other five days stay Truck',
    run(`db.mileage.filter(m => m.vehicleId === 'veh-truck').length`) === 5);
  t('per-day changes never un-confirm and never move the totals',
    run(`db.mileage.every(m => m.status === 'verified' && m.miles === '68.6')`) === true &&
    Math.abs(weekTotal(run) - 480.2) < 0.001);

  // ================= 4. Mixed week exports per-trip =================
  run(`mileageExportYear = ''; mileageExportSel = null; mileageExportOpen = false; mileageExportInit(); mileageExportDownload();`);
  const csv = downloads[downloads.length - 1].parts.join('').split('\r\n').filter(l => l.startsWith('2026-11-'));
  t('CSV has all 7 trips', csv.length === 7);
  t('CSV: Nov 4 and Nov 6 export as Car, the rest as Truck',
    csv.filter(l => l.startsWith('2026-11-04') || l.startsWith('2026-11-06')).every(l => l.endsWith(',Car')) &&
    csv.filter(l => !(l.startsWith('2026-11-04') || l.startsWith('2026-11-06'))).every(l => l.endsWith(',Truck')));

  // ================= 5. Save / reload keeps the mix =================
  const w2 = makeWorld(store, []);
  const run2 = w2.run;
  run2(PICKS_STUB);
  t('after reload the per-day picks are intact',
    run2(`db.mileage.find(m => m.id === 'pd-4').vehicleId`) === 'veh-car' &&
    run2(`db.mileage.find(m => m.id === 'pd-6').vehicleId`) === 'veh-car' &&
    run2(`db.mileage.filter(m => m.vehicleId === 'veh-truck').length`) === 5);
  t('after reload all trips are still confirmed at 480.2 total',
    run2(`db.mileage.every(m => m.status === 'verified')`) === true &&
    Math.abs(weekTotal(run2) - 480.2) < 0.001);

  // ============ 6. Re-applying all-days overrides ============
  run2(`mileageReviewWeek = '2026-11-02'; stampWeekVehicle('2026-11-02', 'veh-car');`);
  t('re-applying all-days (Car) overrides the per-day picks — all 7 Car',
    run2(`db.mileage.filter(m => m.vehicleId === 'veh-car').length`) === 7);
  t('...still confirmed, still 480.2',
    run2(`db.mileage.every(m => m.status === 'verified' && m.miles === '68.6')`) === true &&
    Math.abs(weekTotal(run2) - 480.2) < 0.001);

  // ================= 7. Cloud round trip =================
  t('service worker cache bumped to v81', swSrc.includes('crna-hub-shell-v125'));
  const w3 = makeWorld(new Map(), []);
  const run3 = w3.run;
  run3(PICKS_STUB);
  const TOKENS = { tokA: 'user-a' };
  const cloud = new Map();
  const tableOf = (name) => { if (!cloud.has(name)) cloud.set(name, new Map()); return cloud.get(name); };
  const resp = (status, data) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(data === undefined ? '' : data) });
  w3.sandbox.fetch = async (url, opts) => {
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
      if (want && want !== user) return resp(200, []);
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
  const sess = { access_token: 'tokA', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'user-a@example.com', user_id: 'user-a' };
  run3(`cloudSession = ${JSON.stringify(sess)}; cloudActive = true;`);
  run3(SEED);
  run3(`stampWeekVehicle('2026-11-02', 'veh-truck');`);
  // A per-day change rides the mileage cloud save on its own.
  run3(`window.__vehPicks = {'pd-4': 'veh-car', 'pd-6': 'veh-car'}; applyMileageReviewEdits('2026-11-02'); window.__vehPicks = {};`);
  await new Promise(r => setTimeout(r, 250));
  const cloudRow4 = tableOf('mileage_trips').get('pd-4');
  t('the per-day change reaches the cloud mileage row by itself',
    !!cloudRow4 && JSON.stringify(cloudRow4).includes('veh-car'));
  await run3(`cloudUploadSynced()`);
  run3(`db = empty();`);
  t('device wiped', run3(`db.mileage.length`) === 0);
  await run3(`(async () => { const d = await cloudFetchAll(); cloudApplyData(d); })()`);
  t('after the cloud round trip the mix is intact: Nov 4 + Nov 6 Car, five Truck',
    run3(`db.mileage.find(m => m.id === 'pd-4').vehicleId`) === 'veh-car' &&
    run3(`db.mileage.find(m => m.id === 'pd-6').vehicleId`) === 'veh-car' &&
    run3(`db.mileage.filter(m => m.vehicleId === 'veh-truck').length`) === 5);
  t('...with every trip still confirmed at 68.6',
    run3(`db.mileage.every(m => m.status === 'verified' && m.miles === '68.6')`) === true);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
