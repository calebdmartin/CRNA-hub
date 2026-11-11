// CRNA Hub — tests for the facility ADDRESS gap fix (Nov 7, 2026,
// branch muse/credentialing). Run: node test-facility-address.js
//
// Caleb: "Under Facilities we need a place to save the address to the
// hospital. I don't see that yet." Audit found the manual add/edit form
// DID carry an Address input, but it was effectively invisible: a plain
// field with no placeholder, third of fourteen in the bottom collapsed
// panel — and tapping Edit on a facility scrolled to the TOP of the
// page, away from the form. My facilities showed the address only as
// the first segment of one dense line ("No address · rates · ..."),
// with no prompt that mileage depends on it.
//
// Covers, with Caleb's shape (home in Winfield, Holzer auto-created
// with address:''):
//   A. My facilities: an address-less facility shows its own prompt
//      line ("No address saved — mileage can't calculate..."), tappable
//      into the edit form; a facility WITH an address shows the address
//      on its own line instead.
//   B. The manual form's Address field carries the mileage placeholder;
//      in edit mode it is prefilled with the saved address.
//   C. Saving through the edit form stores the address and clears the
//      stale geocode + auto distance cached for the old address.
//   D. After the address is saved, Home -> facility mileage calculates
//      (stubbed router: 34.3 mi one-way, 68.6 round trip — the same
//      fixture as test-mileage-calc-fix.js).
//   E. Manual ADD still works with and without an address; the
//      contract preview editor still carries its Address input.
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
  alert: () => {},
  confirm: () => true,
  fetch: stubFetch,
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const HOME = '482 Travelers Ridge, Winfield Wv 25213';
const HOLZER_ADDR = '100 Jackson Pike, Gallipolis, OH 45631';
const FAC_ENTRIES = (addr) => ([
  ['name', 'Holzer'], ['aliases', ''], ['address', addr],
  ['hourlyRate', '250'], ['paidHours8', '8.5'], ['rate8', '2125'], ['rate10', '2625'], ['rate12', ''],
  ['rate24', ''], ['hourlyCall1st', ''], ['rateSecond', '3000'], ['weekendRateSecond', '2000'],
  ['callBonus', ''], ['distance', ''], ['distanceSource', ''], ['notes', ''],
]);

(async () => {
  run(`
    db.settings.homeAddress = '${HOME}';
    db.settings.homeLat = ''; db.settings.homeLng = ''; db.settings.homeGeocodedAddress = '';
    db.facilities = [{id:'f1', name:'Holzer', aliases:'', address:'', distance:'', distanceSource:'',
      lat:'', lng:'', geocodedAddress:'',
      hourlyRate:'250', paidHours8:'8.5', rate8:'2125', rate10:'2625', rateSecond:'3000', weekendRateSecond:'2000'}];
    db.shifts = []; db.mileage = []; db.facilitySuggestions = [];
    editId = null; facilitySuggestionPrefill = null;
  `);

  // ---------- A. My facilities summary lines ----------
  const pageA = run(`facilitiesPage()`);
  t('A: address-less facility shows its own prompt line naming the mileage consequence',
    pageA.includes('No address saved — mileage can’t calculate for this facility. Tap to add it.'));
  t('A: the prompt line is tappable into the edit form (data-action edit-facilities + facility id)',
    pageA.includes('class="warning facility-addr" data-action="edit-facilities" data-id="f1"'));
  t('A: the old buried "No address ·" prefix is gone from the rates line',
    !pageA.includes('No address ·') && !pageA.includes('No address</div>'));

  // ---------- B. The form field itself ----------
  t('B: manual form Address field carries the mileage placeholder',
    pageA.includes('id="f_address"') &&
    pageA.includes('placeholder="Street, City, State ZIP — used to calculate mileage"'));
  run(`editId = 'f1';`);
  const pageEditEmpty = run(`facilitiesPage()`);
  t('B: edit mode opens the manual panel titled Edit hospital',
    pageEditEmpty.includes('Edit hospital') && pageEditEmpty.includes('id="facility-manual-panel"'));
  run(`editId = null;`);

  // ---------- C. Edit save stores address, clears stale geo/auto distance ----------
  run(`
    db.facilities[0].lat = '38.8'; db.facilities[0].lng = '-82.2';
    db.facilities[0].geocodedAddress = '1 Old Wrong St, Gallipolis, OH 45631';
    db.facilities[0].distance = '55'; db.facilities[0].distanceSource = 'auto';
    editId = 'f1';
    submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'facilities'}, _entries:${JSON.stringify(FAC_ENTRIES(HOLZER_ADDR))}}});
  `);
  const saved = run(`db.facilities[0]`);
  t('C: the address typed in the edit form is saved on the facility record',
    saved.address === HOLZER_ADDR);
  t('C: stale geocode for the old address is cleared',
    saved.lat === '' && saved.lng === '' && saved.geocodedAddress === '');
  t('C: the auto distance computed for the old address is invalidated',
    saved.distance === '' && saved.distanceSource === '');
  const pageB = run(`facilitiesPage()`);
  t('A2: with an address saved, My facilities shows it on its own line and drops the prompt',
    pageB.includes('class="muted facility-addr" data-action="edit-facilities" data-id="f1"') &&
    pageB.includes(HOLZER_ADDR) &&
    !pageB.includes('No address saved — mileage can’t calculate'));
  run(`editId = 'f1';`);
  const pageEditFull = run(`facilitiesPage()`);
  t('B2: reopening the edit form prefills the saved address',
    pageEditFull.includes('value="' + HOLZER_ADDR + '"'));
  run(`editId = null;`);

  // ---------- D. Mileage now calculates Home -> Holzer ----------
  const miles = await run(`homeToFacilityMiles(db.facilities[0])`);
  t('D: Home -> Holzer one-way miles calculate after the address save (34.3 stub)',
    miles && Math.abs(miles.oneWay - 34.3) < 0.05);
  t('D: round trip is 68.6 mi',
    miles && Math.abs(run(`roundTripMiles(${miles.oneWay})`) - 68.6) < 0.1);

  // ---------- E. Add paths ----------
  run(`
    editId = null;
    submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'facilities'}, _entries:[
      ['name','Riverside'], ['aliases',''], ['address',''],
      ['hourlyRate',''], ['paidHours8',''], ['rate8',''], ['rate10',''], ['rate12',''],
      ['rate24',''], ['hourlyCall1st',''], ['rateSecond',''], ['weekendRateSecond',''],
      ['callBonus',''], ['distance',''], ['distanceSource',''], ['notes',''],
    ]}});
  `);
  t('E: manual add without an address still saves (address stays empty, never invented)',
    run(`db.facilities.some(f=>f.name==='Riverside' && f.address==='')`));
  const pageE = run(`facilitiesPage()`);
  t('E: the new address-less facility gets the same prompt line',
    (pageE.match(/No address saved — mileage can’t calculate/g) || []).length === 1);
  run(`
    facilityContractPreview = {facilities:[{name:'Holzer', aliases:'', address:'', rates:{}, found:[], missing:[], include:true, unreadable:[]}],
      contract:{rates:{}, method:'test'}, fileName:'contract.png', isPhoto:true, aiRead:true, shiftCount:0};
  `);
  const pageContract = run(`facilitiesPage()`);
  t('E: contract preview editor still carries its Address input',
    pageContract.includes('id="f_facPrev_0_address"') && pageContract.includes('>Address</label>'));
  run(`facilityContractPreview = null;`);

  // ---------- Source pins ----------
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
  t('S: edit-facilities action scrolls to the manual panel instead of the page top',
    appSrc.includes("if(kind==='facilities')facilityScrollTo('facility-manual-panel')"));
  t('S: service worker cache bumped to v75', swSrc.includes('crna-hub-shell-v119'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
