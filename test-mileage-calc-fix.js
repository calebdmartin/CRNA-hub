// CRNA Hub — tests for the mileage auto-calculation fix (Nov 7, 2026,
// branch muse/credentialing). Run: node test-mileage-calc-fix.js
//
// Caleb's live bug: Weekly mileage review, week of Nov 2–8 — 7 Holzer
// trips, home address on file, yet "Calculate miles for this week"
// created 0 and Confirm all confirmed 0, with only "Nothing was
// guessed" for an explanation. Root cause: his Holzer facility record
// (auto-created from his calendar) had NO address, and every failure
// path in the calculation swallowed that fact silently.
//
// Covers, with a URL-aware fetch stub (no live calls):
//   A. Caleb-shaped fixture: home set, Holzer facility with NO address,
//      7 shifts Nov 2–8. Calculate reports "0 of 7" AND names the
//      missing facility address; the review shows the inline fix
//      (address input for Holzer); saving the address through the
//      review's own action recalculates — all 7 trips get the stubbed
//      router's round-trip miles — and Confirm all then confirms all 7.
//   B. Missing HOME address: calculate names it, the review offers the
//      home fix inline, saving it recalculates the week.
//   C. Unfindable facility address: calculate says the address could
//      not be found; the review's fix box is prefilled with the bad
//      address so it can be corrected in place.
// The stubbed router returns 34.3 mi one-way for the Winfield →
// Gallipolis pair, so a round trip is 68.6 mi.
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
const fixVals = {}; // 'reviewFixFacility:Holzer' -> typed address
function jsonResp(payload) {
  return { status: 200, ok: true, text: async () => JSON.stringify(payload), json: async () => payload };
}
async function stubFetch(url) {
  const u = String(url);
  if (u.includes('nominatim.openstreetmap.org')) return jsonResp([]);
  if (u.includes('geocode.arcgis.com')) {
    const q = decodeURIComponent((u.split('singleLine=')[1] || '').split('&')[0]);
    if (q.includes('Travelers Ridge')) return jsonResp({ candidates: [{ location: { x: -82.002, y: 38.5395 }, score: 100, address: q }] });
    if (q.includes('Jackson Pike')) return jsonResp({ candidates: [{ location: { x: -82.2375, y: 38.8465 }, score: 98, address: q }] });
    return jsonResp({ candidates: [] });
  }
  if (u.includes('router.project-osrm.org')) return jsonResp({ routes: [{ distance: 34.3 * 1609.344 }] });
  return jsonResp({});
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
    querySelector: (sel) => {
      const m = /^\.(reviewFix\w+)\[data-key="([^"]*)"\]$/.exec(sel);
      if (m && fixVals[m[1] + ':' + m[2]] !== undefined) return { value: fixVals[m[1] + ':' + m[2]] };
      return null;
    },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
  fetch: stubFetch,
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
const HOME = '482 Travelers Ridge, Winfield Wv 25213';
const HOLZER_ADDR = '100 Jackson Pike, Gallipolis, OH 45631';

(async () => {
  // ---------- A. Caleb-shaped: facility record carries NO address ----------
  run(`
    db.settings.homeAddress = '${HOME}';
    db.settings.homeLat = ''; db.settings.homeLng = ''; db.settings.homeGeocodedAddress = '';
    db.settings.mileageTripType = 'round-trip';
    db.hotelStays = [];
    db.facilities = [{id:'f1', name:'Holzer', aliases:'', address:'', distance:'', distanceSource:'',
      rate8:'2125', rate10:'2625', rateSecond:'3000', hourlyRate:'250'}];
    db.shifts = [
      {id:'a1', date:'2026-11-02', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
      {id:'a2', date:'2026-11-03', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
      {id:'a3', date:'2026-11-04', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
      {id:'a4', date:'2026-11-05', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
      {id:'a5', date:'2026-11-06', facility:'Holzer', type:'8-hour day / 2nd call', pay:'3000', status:'confirmed'},
      {id:'a6', date:'2026-11-07', facility:'Holzer', type:'24-hour 1st call', pay:'4200', status:'confirmed'},
      {id:'a7', date:'2026-11-08', facility:'Holzer', type:'8-hour day / 2nd call', pay:'2000', status:'confirmed'}
    ];
    db.mileage = [];
    mileageReviewWeek = '2026-11-02';
    mileageReviewCalcNote = null;
  `);
  run(`ensureWeeklyMileageDrafts('2026-11-02')`);
  t('A: 7 blank draft trips exist for the week, like Caleb\u2019s review',
    run(`db.mileage.filter(m=>m.status==='draft').length`) === 7 &&
    run(`db.mileage.every(m=>!(Number(m.miles)>0))`));

  const diagA = await run(`mileageRouteDiagnostic(facilityByNameOrAlias('Holzer'))`);
  t('A: diagnostic names the real cause — facility address-missing', diagA && diagA.error === 'address-missing');

  alerts.length = 0;
  await run(`generateWeeklyMileageDrafts('2026-11-02')`);
  t('A: Calculate reports 0 of 7 honestly (no bare "0 created")',
    alerts.length === 1 && alerts[0].includes('Calculated miles for 0 of 7 trip(s)'));
  t('A: Calculate names WHICH address is missing',
    alerts[0].includes('Holzer has no address saved'));
  t('A: no dialog claims "Nothing was guessed"',
    !alerts.some((a) => a.includes('Nothing was guessed')));
  t('A: trips are still blank drafts (nothing fabricated)',
    run(`db.mileage.every(m=>m.status==='draft'&&!(Number(m.miles)>0))`));

  const htmlA = run(`mileageReviewHTML()`);
  t('A: review shows the inline facility-address fix for Holzer',
    htmlA.includes('reviewFixFacility') && htmlA.includes('data-key="Holzer"') &&
    htmlA.includes('Holzer has no address saved') && htmlA.includes('mileage-review-fix-facility'));
  t('A: the blank trip rows themselves name the missing address',
    htmlA.includes('No address saved for Holzer'));

  // Save the address through the review's own fix action -> recalculates.
  fixVals['reviewFixFacility:Holzer'] = HOLZER_ADDR;
  alerts.length = 0;
  await run(`actions('mileage-review-fix-facility','Holzer')`);
  t('A: the fix saved the address onto the facility record',
    run(`facilityByNameOrAlias('Holzer').address`) === HOLZER_ADDR);
  t('A: recalculation reports 7 of 7',
    alerts.length >= 1 && alerts[alerts.length - 1].includes('Calculated miles for 7 of 7 trip(s)'));
  t('A: every trip now carries the router\u2019s round-trip miles (34.3 one-way -> 68.6)',
    run(`db.mileage.every(m=>m.miles==='68.6'&&m.oneWayMiles==='34.3'&&m.milesSource==='auto'&&m.tripType==='round-trip')`));

  alerts.length = 0;
  const confA = run(`confirmWeeklyMileage('2026-11-02')`);
  t('A: Confirm all now confirms all 7 calculated trips',
    confA && confA.confirmed === 7 && confA.remaining === 0 &&
    run(`db.mileage.every(m=>m.status==='verified')`) &&
    alerts.some((a) => a.includes('all 7 trip(s) confirmed')) &&
    !alerts.some((a) => a.includes('Nothing was guessed')));

  // ---------- B. Missing HOME address ----------
  run(`
    db.settings.homeAddress = '';
    db.settings.homeLat = ''; db.settings.homeLng = ''; db.settings.homeGeocodedAddress = '';
    db.facilities = [{id:'f1', name:'Holzer', aliases:'', address:'${HOLZER_ADDR}', distance:'', distanceSource:''}];
    db.shifts = [
      {id:'b1', date:'2026-11-16', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
      {id:'b2', date:'2026-11-17', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'}
    ];
    db.mileage = [];
    mileageReviewWeek = '2026-11-16';
    mileageReviewCalcNote = null;
  `);
  const diagB = await run(`mileageRouteDiagnostic(facilityByNameOrAlias('Holzer'))`);
  t('B: diagnostic names the real cause — origin-missing', diagB && diagB.error === 'origin-missing');
  alerts.length = 0;
  await run(`generateWeeklyMileageDrafts('2026-11-16')`);
  t('B: Calculate reports 0 of 2 and names the missing home address',
    alerts.length === 1 && alerts[0].includes('Calculated miles for 0 of 2 trip(s)') &&
    alerts[0].includes('No home address is saved'));
  const htmlB = run(`mileageReviewHTML()`);
  t('B: review offers the home-address fix inline',
    htmlB.includes('reviewFixHome') && htmlB.includes('mileage-review-fix-home'));
  fixVals['reviewFixHome:home'] = HOME;
  alerts.length = 0;
  await run(`actions('mileage-review-fix-home','')`);
  t('B: saving home in the review recalculates — both trips get 68.6 round-trip miles',
    run(`db.settings.homeAddress`) === HOME &&
    run(`db.mileage.length`) === 2 && run(`db.mileage.every(m=>m.miles==='68.6')`) &&
    alerts[alerts.length - 1].includes('Calculated miles for 2 of 2 trip(s)'));

  // ---------- C. Facility address that cannot be found ----------
  run(`
    db.facilities = [{id:'f1', name:'Holzer', aliases:'', address:'999 Nowhere Lane, Atlantis, OH 00000', distance:'', distanceSource:''}];
    db.shifts = [
      {id:'c1', date:'2026-11-23', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'}
    ];
    db.mileage = [];
    mileageReviewWeek = '2026-11-23';
    mileageReviewCalcNote = null;
  `);
  const diagC = await run(`mileageRouteDiagnostic(facilityByNameOrAlias('Holzer'))`);
  t('C: diagnostic names the real cause — address-not-found', diagC && diagC.error === 'address-not-found');
  alerts.length = 0;
  await run(`generateWeeklyMileageDrafts('2026-11-23')`);
  t('C: Calculate says the saved address could not be found (and quotes it)',
    alerts.length === 1 && alerts[0].includes('Calculated miles for 0 of 1 trip(s)') &&
    alerts[0].includes('could not be found') && alerts[0].includes('999 Nowhere Lane'));
  const htmlC = run(`mileageReviewHTML()`);
  t('C: review fix box is prefilled with the bad address for correction',
    htmlC.includes('reviewFixFacility') && htmlC.includes('value="999 Nowhere Lane, Atlantis, OH 00000"'));
  t('C: the trip stays a blank draft — no miles invented',
    run(`db.mileage.length`) === 1 && run(`!(Number(db.mileage[0].miles)>0)`));

  // ---------- Cache ----------
  t('service worker cache bumped to v71',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v120'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
