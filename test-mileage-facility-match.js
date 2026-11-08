// CRNA Hub — tests for the mileage facility-matching fix (Nov 7, 2026,
// branch muse/credentialing). Run: node test-mileage-facility-match.js
//
// Caleb's live bug, second act: after adding addresses for his
// hospitals on the Facilities tab, "Calculate miles for this week"
// STILL failed all 7 Holzer trips — now claiming "No facility named
// Holzer is saved yet." Root cause: mileage resolved a trip's facility
// by exact name only (trimmed + lowercased, aliases exact too). His
// trips/shifts carry the short name "Holzer" (from his calendar),
// while the hospital record he edited carries the fuller name — so
// the lookup found nothing and the app falsely said the facility was
// not saved at all.
//
// Covers, with a URL-aware fetch stub (no live calls):
//   A. Caleb-shaped fixture: trips say "Holzer", the saved facility is
//      "Holzer Health" WITH the Gallipolis address, home set. Before
//      the link: Calculate reports 0 of 7 but names "Holzer Health" as
//      the likely match (never "not saved"), and the review offers a
//      one-tap link. Tapping it records the alias, stamps the link on
//      trips and shifts, recalculates — 7 trips at 68.6 mi round trip
//      — Confirm all confirms 7, the prompt never comes back, and the
//      alias survives the cloud-sync row round trip.
//   B. Exact names still resolve instantly; spacing/punctuation drift
//      resolves by canonical key; a stored facilityId wins over the
//      name, and a dead link falls back to the name.
//   C. Unrelated names never prompt: no near-match, the honest
//      "not saved" guidance stays; two candidate facilities = no
//      prompt either (ambiguous is not obvious).
//   D. The bulk draft generator resolves through the same path (it
//      used to have its own exact-name-only lookup): 0 drafts before
//      the alias exists, real drafts after.
//   E. Rename defence: editing a facility's name in the Facilities
//      form keeps the old name as an alias, so trips that still say
//      the old name keep resolving.
//   F. Same defence on the contract-merge save path.
// The stubbed router returns 34.3 mi one-way for the Winfield ->
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
    querySelector: () => null,
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
const SHIFTS_A = [2, 3, 4, 5, 6, 7, 8].map((d, i) => ({
  id: 'a' + (i + 1), date: '2026-11-0' + d, facility: 'Holzer',
  type: '8-hour day', pay: '2125', status: 'confirmed',
}));

(async () => {
  // ---------- A. Caleb-shaped: trips "Holzer", saved "Holzer Health" ----------
  run(`
    db.settings.homeAddress = '${HOME}';
    db.settings.homeLat = ''; db.settings.homeLng = ''; db.settings.homeGeocodedAddress = '';
    db.settings.mileageTripType = 'round-trip';
    db.hotelStays = [];
    db.facilities = [{id:'f1', name:'Holzer Health', aliases:'', address:'${HOLZER_ADDR}', distance:'', distanceSource:'',
      lat:'', lng:'', geocodedAddress:'', rate8:'2125', rate10:'2625', rateSecond:'3000', hourlyRate:'250'}];
    db.shifts = ${JSON.stringify(SHIFTS_A)};
    db.mileage = [];
    mileageReviewWeek = '2026-11-02';
    mileageReviewCalcNote = null;
  `);
  t('A: the short name does not resolve exactly, but the near-match is found',
    run(`facilityByNameOrAlias('Holzer')`) === null &&
    (run(`facilityNearMatch('Holzer')`) || {}).id === 'f1');

  run(`ensureWeeklyMileageDrafts('2026-11-02')`);
  t('A: 7 blank draft trips exist for the week',
    run(`db.mileage.filter(m=>m.status==='draft').length`) === 7 &&
    run(`db.mileage.every(m=>!(Number(m.miles)>0))`));

  alerts.length = 0;
  await run(`generateWeeklyMileageDrafts('2026-11-02')`);
  t('A: Calculate still reports 0 of 7 before the link',
    alerts.length === 1 && alerts[0].includes('Calculated miles for 0 of 7 trip(s)'));
  t('A: the dialog names the saved near-match instead of claiming nothing is saved',
    alerts[0].includes('Holzer Health') && alerts[0].includes('looks like the match') &&
    !alerts[0].includes('No facility named Holzer is saved yet'));

  const htmlA = run(`mileageReviewHTML()`);
  t('A: the review offers the one-tap link to the saved facility',
    htmlA.includes('data-action="mileage-review-link-facility"') &&
    htmlA.includes('data-id="f1"') && htmlA.includes('data-date="Holzer"') &&
    htmlA.includes('These trips say') && htmlA.includes('Link to Holzer Health'));
  t('A: the review never claims Holzer is not saved',
    !htmlA.includes('No facility named Holzer is saved'));

  alerts.length = 0;
  await run(`actions('mileage-review-link-facility','f1','Holzer')`);
  t('A: linking records the short name as an alias of the facility',
    run(`facilityAliases(db.facilities[0])`).includes('Holzer') &&
    (run(`facilityByNameOrAlias('Holzer')`) || {}).id === 'f1');
  t('A: linking recalculates immediately — 7 of 7',
    alerts.length >= 1 && alerts[alerts.length - 1].includes('Calculated miles for 7 of 7 trip(s)'));
  t('A: every trip got the round-trip miles and the facility link',
    run(`db.mileage.every(m=>m.miles==='68.6'&&m.oneWayMiles==='34.3'&&m.milesSource==='auto'&&m.facilityId==='f1')`) &&
    run(`db.shifts.every(x=>x.facilityId==='f1')`));

  const confA = run(`confirmWeeklyMileage('2026-11-02')`);
  t('A: Confirm all confirms all 7 linked trips',
    confA && confA.confirmed === 7 && confA.remaining === 0);

  const htmlA2 = run(`mileageReviewHTML()`);
  t('A: the link is never offered again once recorded',
    !htmlA2.includes('mileage-review-link-facility'));

  const rowA = run(`cloudFacilityRow(db.facilities[0])`);
  t('A: the cloud sync row carries the alias (column and record copy)',
    !!rowA && String(rowA.aliases || '').includes('Holzer') &&
    String((rowA.data || {}).aliases || '').includes('Holzer'));
  const rowJson = JSON.stringify(rowA);
  run(`window.__facsA = db.facilities; db.facilities = [cloudRowToRecord(${rowJson})].filter(Boolean);`);
  t('A: after a sync round trip, the short name still resolves',
    (run(`facilityByNameOrAlias('Holzer')`) || {}).id === 'f1');
  run(`db.facilities = window.__facsA; window.__facsA = null;`);

  // ---------- B. Exact names, tolerant keys, stored-link priority ----------
  run(`
    db.facilities = [
      {id:'f1', name:'Holzer Health', aliases:'', address:'${HOLZER_ADDR}', distance:'', distanceSource:''},
      {id:'f2', name:'CAMC', aliases:'', address:'3200 MacCorkle Ave SE, Charleston, WV 25304', distance:'', distanceSource:''}
    ];
    db.shifts = []; db.mileage = []; db.hotelStays = [];
  `);
  t('B: an exact name still resolves instantly, with no near-match prompt',
    (run(`facilityByNameOrAlias('CAMC')`) || {}).id === 'f2' &&
    run(`facilityNearMatch('CAMC')`) === null);
  t('B: spacing and punctuation drift resolve by canonical key',
    (run(`facilityByNameOrAlias('holzer   health')`) || {}).id === 'f1' &&
    (run(`facilityByNameOrAlias('Holzer-Health')`) || {}).id === 'f1' &&
    (run(`facilityByNameOrAlias(' CAMC ')`) || {}).id === 'f2');
  t('B: a stored facility link wins over the name; a dead link falls back to it',
    (run(`facilityForRecord({facility:'some other text', facilityId:'f1'})`) || {}).id === 'f1' &&
    (run(`facilityForRecord({facility:'CAMC', facilityId:'no-such-id'})`) || {}).id === 'f2');

  // ---------- C. Unrelated or ambiguous names never prompt ----------
  run(`
    db.facilities = [
      {id:'f1', name:'Holzer Health', aliases:'', address:'${HOLZER_ADDR}', distance:'', distanceSource:''},
      {id:'f3', name:'Charleston Area Medical Center', aliases:'', address:'501 Morris St, Charleston, WV 25301', distance:'', distanceSource:''}
    ];
    db.shifts = [{id:'c1', date:'2026-11-02', facility:'Riverside', type:'8-hour day', pay:'', status:'confirmed'}];
    db.mileage = []; db.hotelStays = [];
    mileageReviewWeek = '2026-11-02';
    mileageReviewCalcNote = null;
  `);
  t('C: unrelated names produce no near-match (CAMC is not short for the Charleston name here)',
    run(`facilityNearMatch('Riverside')`) === null && run(`facilityNearMatch('CAMC')`) === null);
  alerts.length = 0;
  await run(`generateWeeklyMileageDrafts('2026-11-02')`);
  t('C: a truly unmatched facility keeps the honest not-saved guidance',
    alerts.length === 1 && alerts[0].includes('No facility named Riverside is saved yet'));
  const htmlC = run(`mileageReviewHTML()`);
  t('C: the review shows the plain guidance and no link offer',
    htmlC.includes('No facility named Riverside is saved') &&
    !htmlC.includes('mileage-review-link-facility'));
  run(`db.facilities.push({id:'f4', name:'Holzer Clinic', aliases:'', address:'', distance:'', distanceSource:''})`);
  t('C: two candidate facilities = ambiguous = no prompt',
    run(`facilityNearMatch('Holzer')`) === null);

  // ---------- D. Bulk generator uses the same resolution ----------
  run(`
    db.facilities = [{id:'f1', name:'Holzer Health', aliases:'', address:'${HOLZER_ADDR}', distance:'', distanceSource:''}];
    db.shifts = [
      {id:'d1', date:'2026-11-02', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'},
      {id:'d2', date:'2026-11-03', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'}
    ];
    db.mileage = []; db.hotelStays = [];
  `);
  alerts.length = 0;
  await run(`makeMileageDrafts()`);
  t('D: bulk generator creates nothing while the name cannot resolve',
    alerts.length === 1 && alerts[0].includes('0 mileage draft(s) created') &&
    run(`db.mileage.length`) === 0);
  run(`addFacilityAlias(db.facilities[0],'Holzer')`);
  alerts.length = 0;
  await run(`makeMileageDrafts()`);
  t('D: once the alias exists, the bulk generator prices both trips',
    alerts.length === 1 && alerts[0].includes('2 mileage draft(s) created') &&
    run(`db.mileage.length`) === 2 &&
    run(`db.mileage.every(m=>m.miles==='68.6'&&m.facilityId==='f1'&&m.facility==='Holzer Health')`));

  // ---------- E. Rename defence on the Facilities form save path ----------
  const FAC_ENTRIES = (name) => ([
    ['name', name], ['aliases', ''], ['address', HOLZER_ADDR],
    ['hourlyRate', '250'], ['paidHours8', '8.5'], ['rate8', '2125'], ['rate10', '2625'], ['rate12', ''],
    ['rate24', ''], ['hourlyCall1st', ''], ['rateSecond', '3000'], ['weekendRateSecond', '2000'],
    ['callBonus', ''], ['distance', ''], ['distanceSource', ''], ['notes', ''],
  ]);
  run(`
    db.facilities = [{id:'f9', name:'Holzer', aliases:'', address:'${HOLZER_ADDR}', distance:'', distanceSource:'',
      lat:'', lng:'', geocodedAddress:''}];
    db.shifts = []; db.mileage = []; db.hotelStays = [];
    editId = 'f9';
  `);
  run(`submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'facilities'}, _entries:${JSON.stringify(FAC_ENTRIES('Holzer Health'))}}})`);
  t('E: renaming a facility keeps the old name as an alias',
    run(`db.facilities[0].name`) === 'Holzer Health' &&
    run(`facilityAliases(db.facilities[0])`).includes('Holzer') &&
    (run(`facilityByNameOrAlias('Holzer')`) || {}).id === 'f9');

  // ---------- F. Rename defence on the contract-merge save path ----------
  run(`
    db.facilities = [{id:'f1', name:'Holzer', aliases:'Holzer Health', address:'', distance:'', distanceSource:'',
      lat:'', lng:'', geocodedAddress:'', rate8:'2125'}];
    db.contracts = []; db.shifts = []; db.mileage = []; db.hotelStays = [];
    facilityContractPendingImages = [];
    facilityContractPreview = {facilities:[{name:'Holzer Health', aliases:'', address:'${HOLZER_ADDR}', rates:{rate8:'2125'},
      include:true, found:[], missing:[], effectiveStart:'', effectiveEnd:''}],
      contract:{id:'ct1', rates:{}, facility:'Holzer'}, fileName:'addendum.txt', isPhoto:false, shiftCount:0};
  `);
  await run(`approveFacilityContract()`);
  t('F: a contract merge that renames the facility keeps the old name resolving',
    run(`db.facilities[0].name`) === 'Holzer Health' &&
    run(`facilityAliases(db.facilities[0])`).includes('Holzer') &&
    (run(`facilityByNameOrAlias('Holzer')`) || {}).id === 'f1');

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
