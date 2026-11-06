// CRNA Hub — tests for mileage draft generation: one draft per shift,
// bulk + weekly paths agree (Nov 6, 2026, branch muse/credentialing).
// Run: node test-mileage-drafts.js
//
// Covers, without any live API call (fetch is stubbed; no network):
//   * makeMileageDrafts (bulk "Generate schedule-based drafts" button):
//     one draft per (date, facility); Off / PTO shifts skipped; shifts
//     with no facility on file skipped (never guessed); and a shift that
//     already has a trip — even a manual trip with a different purpose —
//     gets no second draft. That last rule is the weekly review's rule
//     (mileageTripMatchesShift: date + facility), not the old
//     purpose-string check, so the two paths can no longer disagree
//     about whether a shift already has a trip.
//   * Draft miles come from the facility's saved one-way distance when
//     no address can be auto-calculated (round trip = 2 x one-way,
//     counted once, never doubled).
//   * Re-running the bulk generator creates nothing new (idempotent).
//   * ensureWeeklyMileageDrafts (weekly review, sync path) agrees: it
//     creates no duplicate for a shift that already has a trip, and it
//     drafts blank (never guessed) for a shift with no usable distance.
//   * Only verified trips count in mileage totals; drafts do not.
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
  constructor(form) { this._e = (form && form._entries) || []; }
  *[Symbol.iterator]() { yield* this._e; }
}
const alerts = [];
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
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

(async () => {
  // ---------- Fixture: week Mon 2026-11-02, no home/facility addresses ----------
  // No addresses anywhere, so homeToFacilityMiles returns null and the
  // bulk generator falls back to the facility's saved one-way distance.
  run(`
    db.settings.homeAddress = '';
    db.settings.mileageTripType = 'round-trip';
    db.hotelStays = [];
    db.facilities = [{id:'f1', name:'Holzer', aliases:'', address:'', rate8:'2125', distance:'40'}];
    db.shifts = [
      {id:'d1', date:'2026-11-03', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
      {id:'d2', date:'2026-11-04', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
      {id:'d3', date:'2026-11-05', facility:'Holzer', type:'Off / PTO', pay:'5000', status:'confirmed'},
      {id:'d4', date:'2026-11-06', facility:'CAMC', type:'8-hour day', pay:'', status:'proposed', incomplete:true}
    ];
    db.mileage = [
      {id:'tm1', date:'2026-11-04', facility:'Holzer', purpose:'Drove to Holzer for call', miles:'80', status:'verified', milesSource:'manual', origin:'home', hotelAddress:'', tripType:'round-trip', oneWayMiles:'40'}
    ];
  `);

  // ---------- Bulk generator ----------
  await run(`makeMileageDrafts()`);
  const trips = run(`db.mileage`);
  t('bulk drafts: exactly one new draft (Nov 3), from the facility one-way distance (40 mi -> 80 round trip)',
    trips.length === 2 &&
    trips.some((m) => m.date === '2026-11-03' && m.status === 'draft' && m.miles === '80' &&
      m.tripType === 'round-trip' && m.oneWayMiles === '40' && m.milesSource === 'manual'));
  t('bulk drafts: no second draft for Nov 4 — the manual trip already covers that shift, purpose differs',
    trips.filter((m) => m.date === '2026-11-04').length === 1);
  t('bulk drafts: Off / PTO day (Nov 5) gets no draft',
    !trips.some((m) => m.date === '2026-11-05'));
  t('bulk drafts: shift with no facility on file (Nov 6, CAMC) is skipped, never guessed',
    !trips.some((m) => m.date === '2026-11-06'));
  t('bulk drafts: alert reports 1 created (a shift with no facility on file is skipped silently here — the weekly review still lists it as missing, see below)',
    alerts.length >= 1 && alerts[0].includes('1 mileage draft(s) created'));
  t('only verified trips count in mileage totals; the draft does not',
    run(`verifiedMileageTotal()`) === 80 && run(`verifiedMileageTrips().length`) === 1);

  // ---------- Idempotence ----------
  const before = run(`db.mileage.length`);
  await run(`makeMileageDrafts()`);
  t('bulk drafts: re-running creates nothing new',
    run(`db.mileage.length`) === before);

  // ---------- Weekly review path agrees ----------
  run(`globalThis.__ensured = ensureWeeklyMileageDrafts('2026-11-02');`);
  const afterWeekly = run(`db.mileage`);
  t('weekly ensure: no duplicate for shifts that already have a trip (Nov 3 draft, Nov 4 manual)',
    afterWeekly.filter((m) => m.date === '2026-11-03').length === 1 &&
    afterWeekly.filter((m) => m.date === '2026-11-04').length === 1);
  t('weekly ensure: shift with no usable distance drafts blank for manual entry, never guessed',
    afterWeekly.some((m) => m.date === '2026-11-06' && m.status === 'draft' &&
      m.miles === '' && m.milesSource === 'needs-manual'));
  t('weekly ensure: Off / PTO day still gets no draft',
    !afterWeekly.some((m) => m.date === '2026-11-05'));
  run(`globalThis.__review = weeklyMileageReview('2026-11-02');`);
  t('weekly review: no shift in the week is missing a trip anymore',
    sandbox.__review.missing.length === 0 && sandbox.__review.toReview === 2);

  console.log(failures === 0 ? 'mileage-drafts test done: all passed' : 'mileage-drafts test done: FAILURES=' + failures);
})();
