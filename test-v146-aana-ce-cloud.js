// CRNA Hub — v146: AANA CE totals survive the cloud round trip
// (mapping gap flagged by the v145 round). The agent read filed
// Caleb's real AANA row with ce_class_a 103 / ce_class_b 2, but
// cloudApplyData never mapped those columns into db.aana.classA /
// classB, and cloudAanaRow never wrote them back — so the v145
// AANA info strip lost its CE segment on his phone.
//
// Pins:
//   1. A cloud payload carrying ce_class_a 103 / ce_class_b 2 lands
//      as classA '103' / classB '2' (same null handling as the
//      NBCRNA credit fields), and the rendered AANA strip shows
//      "CE 105 · 103 Class A + 2 Class B".
//   2. A payload with null CE columns lands as '' / '' and the
//      strip renders NO CE segment and no junk.
//   3. A local record with classA / classB serializes them back
//      out through cloudAanaRow (numbers via cloudNumOrNull;
//      '' -> null), so a local save cannot erase them.
// Run: node test-v146-aana-ce-cloud.js
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
const stripsOf = (html) => [...html.matchAll(/<p class="cred-strip">([^<]*)<\/p>/g)].map(m => m[1]);
const F = (d) => run(`fmt('${d}')`);

(async () => {
  // ---- 1. Cloud payload WITH CE totals (Caleb's real filed row) ----
  run(`db = empty(); db.settings.scheduleName = 'Caleb Martin'; manualType = 'NBCRNA'; persist();
    cloudApplyData({
      nbcrna: null,
      aana: { user_id: 'u1', membership_status: 'Active', membership_number: '126402', expiration: '2027-08-31', ce_class_a: 103, ce_class_b: 2, source: 'aana_portal', last_synced_at: '2026-11-12T15:10:00.000Z' },
      licenses: [], ce: [], portals: [], documents: [],
    });`);
  t('cloud CE totals land as strings on the local record',
    run(`db.aana.classA`) === '103' && run(`db.aana.classB`) === '2',
    J({ a: run(`db.aana.classA`), b: run(`db.aana.classB`) }));
  t('the rest of the AANA record still maps (status/number/expiration/source)',
    run(`db.aana.status`) === 'Active' && run(`db.aana.number`) === '126402' &&
    run(`db.aana.expiration`) === '2027-08-31' && run(`db.aana.source`) === 'aana_portal');
  const page = run(`credentialsPage()`);
  const aanaStrip = 'Member 126402 · Dues through ' + F('2027-08-31') + ' · CE 105 · 103 Class A + 2 Class B · Reminders at 90, 60, 30, 7 days';
  t('AANA strip renders its CE segment from the cloud-fed record', stripsOf(page).includes(aanaStrip), J(stripsOf(page)));

  // ---- 2. Cloud payload with NULL CE columns ----
  run(`db = empty(); db.settings.scheduleName = 'Caleb Martin'; manualType = 'NBCRNA'; persist();
    cloudApplyData({
      nbcrna: null,
      aana: { user_id: 'u1', membership_status: 'Active', membership_number: '126402', expiration: '2027-08-31', ce_class_a: null, ce_class_b: null, source: 'aana_portal', last_synced_at: '2026-11-12T15:10:00.000Z' },
      licenses: [], ce: [], portals: [], documents: [],
    });`);
  t('null CE columns land as empty strings, not "null"',
    run(`db.aana.classA`) === '' && run(`db.aana.classB`) === '',
    J({ a: run(`db.aana.classA`), b: run(`db.aana.classB`) }));
  const page2 = run(`credentialsPage()`);
  const strips2 = stripsOf(page2);
  t('no CE segment and no junk when CE is absent',
    strips2.includes('Member 126402 · Dues through ' + F('2027-08-31') + ' · Reminders at 90, 60, 30, 7 days') &&
    strips2.every(s => !/undefined|NaN|Class [AB]/.test(s)), J(strips2));

  // ---- 3. Local record serializes CE back out (round trip) ----
  run(`db.aana = { status: 'Active', number: '126402', expiration: '2027-08-31', classA: '103', classB: '2', docNote: '', ceNote: '', reminders: '90,60,30,7', source: 'aana_portal' };`);
  const row = run(`cloudAanaRow()`);
  t('cloudAanaRow writes ce_class_a / ce_class_b as numbers',
    row.ce_class_a === 103 && row.ce_class_b === 2, J(row));
  run(`db.aana = { status: 'Active', number: '126402', expiration: '2027-08-31', classA: '', classB: '', source: 'user_entered' };`);
  const row2 = run(`cloudAanaRow()`);
  t('cloudAanaRow writes null (not 0, not "") for absent CE',
    row2.ce_class_a === null && row2.ce_class_b === null, J(row2));

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
