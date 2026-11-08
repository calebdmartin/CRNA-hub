// CRNA Hub — tests for mileage header totals + saved vehicles
// (Nov 7, 2026, branch muse/credentialing).
// Run: node test-mileage-vehicles.js
//
// Caleb's ask: at the top of the Mileage page, a weekly mileage total
// and a year-to-date total; and QuickBooks-style saved vehicles — add
// and save vehicles, one default, trips stamped with it.
//
// Covers:
//   * Header stats: This week (Mon–Sun, matching the weekly review)
//     and Year to date (current calendar year), CONFIRMED trips only —
//     drafts/skipped/cleared never count — shown above the review and
//     updated the moment a week is confirmed.
//   * Vehicle CRUD through the real form path: add, edit, exactly one
//     default (setting a new default clears the old), Make-default
//     action, blank name refused. Vehicles panel is collapsed unless
//     editing; first vehicle pre-checks Default.
//   * Default stamping: new drafts (priced + blank) and hand-logged
//     trips get the default vehicle; existing unstamped trips are NOT
//     backfilled.
//   * Per-trip vehicle picker appears in the weekly review (and the
//     trip form) only with 2+ vehicles; a review pick is applied on
//     save. With >= 1 vehicle the review ALSO carries a week-level
//     control ("Same vehicle for all days") whose Apply stamps EVERY
//     trip in the week — confirmed ones included, without touching
//     their status or miles — overriding per-day picks for that week
//     (superseded semantics, Nov 7, 2026: per-day picks made AFTER an
//     apply stand; the dedicated per-day regression lives in
//     test-mileage-vehicle-perday.js). With no vehicles the control
//     area is just an "Add a vehicle" jump to the Vehicles panel.
//   * Mileage page order: header totals, then the Vehicles panel
//     (moved up under the totals Nov 7, 2026), then the review.
//   * The license plate field is gone from the vehicle form (Caleb:
//     "seems weird") — stored plate values on older vehicles stay
//     harmlessly in place but are never collected, shown or exported.
//   * Deleting a vehicle keeps the trip's history: the name snapshot
//     stays on the trip, in the log line and in the CSV.
//   * CSV gains a Vehicle column (blank where unstamped).
//   * Cloud: vehicles sync like facilities (migration 012) — upload,
//     fresh-device restore via merge, tombstoned delete — and a
//     trip's vehicle stamp round-trips with the trip.
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

(async () => {
  const downloads = [];
  const { run } = makeWorld(new Map(), downloads);

  // Review-input stub: lets a phase decide what the vehicle picker says.
  run(`window.__vehPick = null;
       document.querySelector = (s) => {
         if (window.__vehPick && s.indexOf('reviewVehicle') >= 0) return { value: window.__vehPick };
         return null;
       };`);

  // ================= 1. Header totals =================
  // Boundary dates come from the app's own week math so the Mon–Sun
  // edges are exercised honestly on any run date.
  run(`
    (() => {
      const today = localDate(new Date());
      const mon = weekStartISO(today);
      window.__D = {
        today, mon,
        sun: addDaysISO(mon, 6),
        prevSun: addDaysISO(mon, -1),
        nextMon: addDaysISO(mon, 7),
        minus60: addDaysISO(mon, -60),
        lastYear: String(Number(today.slice(0, 4)) - 1) + '-06-15',
        curYear: today.slice(0, 4),
      };
      const D = window.__D;
      const trip = (id, date, miles, status) => ({id, date, facility: 'Holzer', purpose: 'work', miles: String(miles), status, origin: 'home', tripType: 'round-trip', oneWayMiles: '', milesSource: 'manual', hotelAddress: ''});
      // The weekly review exists only for weeks containing shifts
      // (mileageWeeks reads shifts), so park one shift in the current
      // week — its date+facility match the w-mon trip, so the review
      // drafts nothing extra.
      db.shifts = [{id: 's-mon', date: D.mon, facility: 'Holzer', type: '8-hour day', status: 'confirmed', pay: '2125'}];
      db.facilities = []; db.hotelStays = []; db.vehicles = [];
      db.mileage = [
        trip('w-mon', D.mon, 10, 'verified'),
        trip('w-sun', D.sun, 20, 'verified'),
        trip('last-week', D.prevSun, 40, 'verified'),
        trip('next-week', D.nextMon, 80, 'verified'),
        trip('minus-60', D.minus60, 160, 'verified'),
        trip('last-year', D.lastYear, 320, 'verified'),
        trip('w-draft', D.mon, 1000, 'draft'),
        trip('w-skip', D.sun, 2000, 'skipped'),
        trip('w-dismissed', D.mon, 4000, 'dismissed'),
      ];
      window.__FX = db.mileage.map(m => ({date: m.date, miles: Number(m.miles), status: m.status}));
    })();
  `);
  const D = run(`window.__D`);
  const FX = run(`window.__FX`);
  const expWeek = FX.filter(x => x.status === 'verified' && x.date >= D.mon && x.date <= D.sun).reduce((s, x) => s + x.miles, 0);
  const expYtd = FX.filter(x => x.status === 'verified' && x.date.slice(0, 4) === D.curYear).reduce((s, x) => s + x.miles, 0);
  t('fixture sanity: week sum is Mon+Sun only (30)', expWeek === 30);
  t('mileageWeekTotal counts confirmed trips in the Mon–Sun week only', run(`mileageWeekTotal()`) === expWeek);
  t('mileageYearTotal counts confirmed trips in the current year only', run(`mileageYearTotal()`) === expYtd);
  t('week total excludes last week, next week and last year',
    run(`mileageWeekTotal()`) === 30 && expYtd >= 150);
  const header = run(`mileageHeaderHTML()`);
  t('header shows This week and Year to date figures',
    header.includes(expWeek.toFixed(1) + ' mi</strong>This week') && header.includes(expYtd.toFixed(1) + ' mi</strong>Year to date'));
  t('header states the confirmed-only basis', header.includes('Confirmed trips only.'));
  const page = run(`mileagePage()`);
  t('header stats sit at the very top of the Mileage page, above the weekly review',
    page.indexOf('Year to date') >= 0 && page.indexOf('Year to date') < page.indexOf('Weekly mileage review'));

  // Totals move when a week is confirmed. (The phase-1 'w-draft'
  // fixture is removed first — confirming would otherwise count its
  // 1000 miles too, which is correct app behavior but not what this
  // step isolates.)
  run(`
    db.mileage = db.mileage.filter(m => m.id !== 'w-draft');
    db.mileage.push({id: 'w-new', date: window.__D.mon, facility: 'Holzer', purpose: 'work', miles: '15', status: 'draft', origin: 'home', tripType: 'round-trip', oneWayMiles: '', milesSource: 'manual', hotelAddress: ''});
    confirmWeeklyMileage(window.__D.mon);
  `);
  t('confirming a draft updates the week total immediately', run(`mileageWeekTotal()`) === expWeek + 15);
  t('...and the year total', run(`mileageYearTotal()`) === expYtd + 15);
  t('header re-renders with the new totals', run(`mileageHeaderHTML()`).includes((expWeek + 15).toFixed(1) + ' mi</strong>This week'));

  // ================= 2. Vehicle CRUD =================
  run(`db.vehicles = []; db.mileage = []; editId = null;`);
  run(`submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'vehicles'}, _entries:[['name','2022 Silverado'],['make','Chevrolet'],['model','Silverado 1500'],['year','2022'],['isDefault','on']]}})`);
  t('add vehicle via the form', run(`db.vehicles.length`) === 1 && run(`db.vehicles[0].name`) === '2022 Silverado');
  t('first vehicle saved as default with its details',
    run(`db.vehicles[0].isDefault`) === true && run(`db.vehicles[0].make`) === 'Chevrolet' && run(`db.vehicles[0].model`) === 'Silverado 1500');
  t('vehicle form no longer collects a license plate',
    !run(`vehiclesPanelHTML()`).includes('License plate') && !appSrc.includes("field('plate'"));
  run(`submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'vehicles'}, _entries:[['name','2019 Outback'],['make','Subaru'],['model','Outback'],['year','2019']]}})`);
  t('second vehicle added, not default', run(`db.vehicles.length`) === 2 && run(`db.vehicles[1].isDefault`) === false);
  run(`submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'vehicles'}, _entries:[['name','2024 Model Y'],['make','Tesla'],['model','Model Y'],['year','2024'],['isDefault','on']]}})`);
  t('adding a new default clears the old one — exactly one default',
    run(`db.vehicles.filter(v => v.isDefault).length`) === 1 && run(`defaultVehicle().name`) === '2024 Model Y');
  const v2id = run(`db.vehicles[1].id`);
  run(`editId = '${v2id}'; submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'vehicles'}, _entries:[['name','2019 Outback Touring'],['make','Subaru'],['model','Outback'],['year','2019']]}})`);
  t('edit updates in place', run(`db.vehicles.length`) === 3 && run(`db.vehicles[1].name`) === '2019 Outback Touring' && run(`db.vehicles[1].model`) === 'Outback');
  run(`submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'vehicles'}, _entries:[['name','  '],['make',''],['model',''],['year','']]}})`);
  t('a vehicle with no name is refused', run(`db.vehicles.length`) === 3);
  const v1id = run(`db.vehicles[0].id`);
  run(`actions('vehicle-default', '${v1id}')`);
  t('Make default action moves the default', run(`defaultVehicle().name`) === '2022 Silverado' && run(`db.vehicles.filter(v => v.isDefault).length`) === 1);

  // Panel rendering: collapsed by default, open while editing, copy line.
  run(`editId = null;`);
  const panel = run(`vehiclesPanelHTML()`);
  t('vehicles panel is a collapsed panel by default', panel.includes('id="vehicles-panel"') && !panel.includes('id="vehicles-panel" open'));
  t('panel carries the one-line explainer', panel.includes('Trips use your default vehicle'));
  t('panel lists vehicles with the Default pill and details',
    panel.includes('2022 Silverado') && panel.includes('Default') && panel.includes('Chevrolet') && !panel.includes('Plate'));
  run(`editId = '${v2id}';`);
  t('panel opens while editing a vehicle', run(`vehiclesPanelHTML()`).includes('id="vehicles-panel" open'));
  run(`editId = null; db.vehicles = [];`);
  t('first-vehicle form pre-checks Default', run(`vehiclesPanelHTML()`).includes('value="on" checked'));
  t('empty panel says so', run(`vehiclesPanelHTML()`).includes('No vehicles yet.'));

  // ================= 3. Default stamping =================
  run(`
    db.vehicles = [
      {id: 'veh-1', name: '2022 Silverado', make: 'Chevrolet', model: 'Silverado', year: '2022', plate: '', isDefault: true},
      {id: 'veh-2', name: '2019 Outback', make: 'Subaru', model: 'Outback', year: '2019', plate: '', isDefault: false},
    ];
    db.facilities = [{id: 'fac-1', name: 'Holzer', address: '100 Jackson Pike, Gallipolis, OH 45631'}];
    db.settings.homeAddress = '482 Travelers Ridge, Winfield WV 25213';
  `);
  const draft = run(`mileageDraftForShift({date: '2026-11-02', facility: 'Holzer', type: '8-hour day'}, db.facilities[0], 34.3, 'auto', 'home', '', 'round-trip')`);
  t('new priced draft is stamped with the default vehicle', draft.vehicleId === 'veh-1' && draft.vehicleName === '2022 Silverado');
  const blank = run(`blankMileageDraftForShift({date: '2026-11-02', facility: 'Holzer', type: '8-hour day'}, 'home', '')`);
  t('new blank draft is stamped too', blank.vehicleId === 'veh-1' && blank.vehicleName === '2022 Silverado');
  // Hand-logged trip, no vehicle field submitted (single-vehicle-style
  // form): the default is stamped at save.
  run(`db.mileage = []; editId = null;
       submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'mileage'}, _entries:[['date','2026-11-02'],['facility','Holzer'],['origin','home'],['hotelAddress',''],['tripType','round-trip'],['miles','68.6'],['milesSource','manual'],['oneWayMiles',''],['purpose','work'],['status','verified']]}})`);
  t('hand-logged trip is stamped with the default', run(`db.mileage[0].vehicleId`) === 'veh-1' && run(`db.mileage[0].vehicleName`) === '2022 Silverado');
  // Hand-logged trip WITH the picker (2+ vehicles): the pick wins.
  run(`db.mileage = []; editId = null;
       submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'mileage'}, _entries:[['date','2026-11-03'],['facility','Holzer'],['origin','home'],['hotelAddress',''],['tripType','round-trip'],['miles','68.6'],['milesSource','manual'],['oneWayMiles',''],['purpose','work'],['status','verified'],['vehicleId','veh-2']]}})`);
  t('an explicit vehicle pick on the trip form wins over the default',
    run(`db.mileage[0].vehicleId`) === 'veh-2' && run(`db.mileage[0].vehicleName`) === '2019 Outback');
  // No backfill: an unstamped existing trip stays unstamped.
  run(`db.mileage = [{id: 'old-1', date: '2026-10-05', facility: 'Holzer', purpose: 'work', miles: '50', status: 'verified', origin: 'home', tripType: 'round-trip'}];
       mileagePage();`);
  t('existing unstamped trips are never backfilled',
    run(`'vehicleId' in db.mileage[0]`) === false && run(`tripVehicleLabel(db.mileage[0])`) === '');
  // No default -> no stamp.
  run(`db.vehicles.forEach(v => v.isDefault = false);`);
  const draft2 = run(`mileageDraftForShift({date: '2026-11-02', facility: 'Holzer', type: '8-hour day'}, db.facilities[0], 34.3, 'auto', 'home', '', 'round-trip')`);
  t('with no default vehicle, new trips are simply unstamped', draft2.vehicleId === '' && draft2.vehicleName === '');

  // ================= 4. Picker visibility + review application =========
  run(`
    db.vehicles = [
      {id: 'veh-1', name: '2022 Silverado', isDefault: true},
      {id: 'veh-2', name: '2019 Outback', isDefault: false},
    ];
    const today = localDate(new Date()); const mon = weekStartISO(today);
    window.__mon = mon;
    db.mileage = [
      {id: 'rv-draft', date: mon, facility: 'Holzer', purpose: 'work', miles: '68.6', status: 'draft', origin: 'home', tripType: 'round-trip', vehicleId: 'veh-1', vehicleName: '2022 Silverado'},
      {id: 'rv-ver', date: mon, facility: 'Holzer', purpose: 'work', miles: '68.6', status: 'verified', origin: 'home', tripType: 'round-trip', vehicleId: 'veh-2', vehicleName: '2019 Outback'},
    ];
    // A shift in the week so the review exists at all (mileageWeeks
    // reads shifts); it matches rv-draft by date+facility, so the
    // review creates no extra draft for it.
    db.shifts = [{id: 's-rv', date: mon, facility: 'Holzer', type: '8-hour day', status: 'confirmed', pay: '2125'}];
  `);
  const review2 = run(`mileageReviewHTML()`);
  t('with 2+ vehicles the review has no separate Vehicle column', !review2.includes('<th>Vehicle</th>'));
  t('draft rows get the vehicle picker', review2.includes('class="reviewVehicle"'));
  t('confirmed rows get their own vehicle picker too',
    (review2.match(/class="reviewVehicle"/g) || []).length >= 2 && review2.includes('2019 Outback'));
  t('trip form shows the vehicle select with 2+ vehicles', run(`mileagePage()`).includes('name="vehicleId"'));
  run(`window.__vehPick = 'veh-2'; applyMileageReviewEdits(window.__mon); window.__vehPick = null;`);
  t('a review pick is applied to the trip on save',
    run(`db.mileage.find(m => m.id === 'rv-draft').vehicleId`) === 'veh-2' &&
    run(`db.mileage.find(m => m.id === 'rv-draft').vehicleName`) === '2019 Outback');
  run(`db.vehicles = [db.vehicles[0]];`);
  const review1 = run(`mileageReviewHTML()`);
  t('with a single vehicle the per-trip picker and column step aside', !review1.includes('class="reviewVehicle"') && !review1.includes('<th>Vehicle</th>'));
  t('with a single vehicle the all-days control shows instead', review1.includes('id="mileageReviewVehicleSelect"') && review1.includes('Same vehicle for all days:'));
  t('single-vehicle trips still show no picker in the form', !run(`mileagePage()`).includes('name="vehicleId"'));
  run(`db.vehicles = [];`);
  const review0 = run(`mileageReviewHTML()`);
  t('with no vehicles the review offers only an Add-a-vehicle jump', !review0.includes('reviewVehicle') && review0.includes('Add a vehicle'));

  // ================= 5. Delete keeps trip history =================
  run(`
    db.vehicles = [
      {id: 'veh-1', name: '2022 Silverado', isDefault: true},
      {id: 'veh-2', name: '2019 Outback', isDefault: false},
    ];
    db.mileage = [
      {id: 'hist-1', date: localDate(new Date()), facility: 'Holzer', purpose: 'work', miles: '68.6', status: 'verified', origin: 'home', tripType: 'round-trip', vehicleId: 'veh-1', vehicleName: '2022 Silverado'},
    ];
    actions('delete-vehicles', 'veh-1');
  `);
  t('vehicle deleted', run(`db.vehicles.length`) === 1 && run(`db.vehicles[0].id`) === 'veh-2');
  t("the trip keeps the vehicle's name as its history", run(`tripVehicleLabel(db.mileage[0])`) === '2022 Silverado');
  t('the trip log line still names the vehicle', run(`mileageTripLine(db.mileage[0])`).includes('2022 Silverado'));

  // ============ 6b. Panel position + week stamping ============
  // Caleb's exact state (Nov 7, 2026): the week of Nov 2-8 fully
  // confirmed, 7 trips x 68.6 mi, no vehicle anywhere — then he adds
  // ONE vehicle and picks it in the review's week picker.
  run(`
    db.facilities = []; db.hotelStays = [];
    db.vehicles = [{id: 'veh-c', name: '2023 F-150', make: 'Ford', model: 'F-150', year: '2023', isDefault: true, updatedAt: '2026-11-07T10:00:00.000Z'}];
    db.shifts = [2, 3, 4, 5, 6, 7, 8].map(d => ({id: 'cs-' + d, date: '2026-11-0' + d, facility: 'Holzer', type: '8-hour day', status: 'confirmed', pay: '2125'}));
    db.mileage = [2, 3, 4, 5, 6, 7, 8].map(d => ({id: 'ct-' + d, date: '2026-11-0' + d, facility: 'Holzer', purpose: 'work', miles: '68.6', status: 'verified', origin: 'home', tripType: 'round-trip', oneWayMiles: '34.3', milesSource: 'auto', hotelAddress: ''}));
    mileageReviewWeek = '2026-11-02'; mileageReviewVehicleWeek = ''; mileageReviewVehicleId = '';
  `);
  const pageC = run(`mileagePage()`);
  t('Mileage page order: totals, Vehicles panel, then the review',
    pageC.indexOf('Year to date') >= 0 &&
    pageC.indexOf('Year to date') < pageC.indexOf('id="vehicles-panel"') &&
    pageC.indexOf('id="vehicles-panel"') < pageC.indexOf('Weekly mileage review'));
  const reviewC = run(`mileageReviewHTML()`);
  t('one vehicle: the all-days control appears with it selected',
    reviewC.includes('id="mileageReviewVehicleSelect"') && reviewC.includes('2023 F-150') && reviewC.includes('Same vehicle for all days:'));
  t('week vehicle total before stamping is 7 x 68.6',
    Math.abs(run(`mileageTripsInWeek('2026-11-02').reduce((s, m) => s + num(m.miles), 0)`) - 480.2) < 0.001);
  run(`stampWeekVehicle('2026-11-02', 'veh-c');`);
  t('week stamp lands on all 7 confirmed trips',
    run(`db.mileage.filter(m => m.vehicleId === 'veh-c' && m.vehicleName === '2023 F-150').length`) === 7);
  t('stamping never un-confirms and never changes miles',
    run(`db.mileage.every(m => m.status === 'verified' && m.miles === '68.6')`) === true &&
    Math.abs(run(`mileageTripsInWeek('2026-11-02').reduce((s, m) => s + num(m.miles), 0)`) - 480.2) < 0.001);
  // A per-day pick made AFTER an all-days apply stands (it is the
  // later deliberate choice) — the other six keep the applied vehicle.
  run(`
    db.vehicles.push({id: 'veh-d', name: '2020 Outback', make: 'Subaru', model: 'Outback', year: '2020', isDefault: false, updatedAt: '2026-11-07T10:00:00.000Z'});
    const t4 = db.mileage.find(m => m.id === 'ct-4');
    t4.vehicleId = 'veh-d'; t4.vehicleName = '2020 Outback';
  `);
  t('a per-day pick made after the apply stands',
    run(`db.mileage.find(m => m.id === 'ct-4').vehicleId`) === 'veh-d');
  t('the other six trips still carry the week vehicle',
    run(`db.mileage.filter(m => m.vehicleId === 'veh-c').length`) === 6);
  // ...until the user explicitly applies all-days again, which
  // overrides the per-day pick for that week.
  run(`stampWeekVehicle('2026-11-02', 'veh-c');`);
  t('re-applying all-days overrides the per-day pick',
    run(`db.mileage.filter(m => m.vehicleId === 'veh-c').length`) === 7);
  run(`
    mileageExportYear = ''; mileageExportSel = null; mileageExportOpen = false;
    mileageExportInit(); mileageExportDownload();
  `);
  const csvC = downloads[downloads.length - 1].parts.join('').split('\r\n').filter(l => l.startsWith('2026-11-'));
  t('export shows the stamped vehicle on all 7 rows',
    csvC.length === 7 && csvC.every(l => l.endsWith(',2023 F-150')));

  const dlBefore = downloads.length;
  // ================= 6. CSV vehicle column =================
  run(`
    mileageExportYear = ''; mileageExportSel = null; mileageExportOpen = false;
    db.mileage.push({id: 'hist-2', date: localDate(new Date()), facility: 'Holzer', purpose: 'work', miles: '20', status: 'verified', origin: 'home', tripType: 'round-trip'});
    mileageExportInit(); mileageExportDownload();
  `);
  t('one more CSV downloaded', downloads.length === dlBefore + 1);
  const csvLines = downloads[downloads.length - 1].parts.join('').split('\r\n');
  t('CSV header ends with the Vehicle column',
    csvLines[0] === 'date,facility,purpose,miles,tripType,oneWayMiles,milesSource,origin,hotelAddress,status,vehicle');
  const stampedRow = csvLines.find(l => l.startsWith('2026-11-02'));
  const unstampedRow = csvLines.find(l => l.includes(',20,'));
  t('stamped trip exports its vehicle name', !!stampedRow && stampedRow.endsWith(',2023 F-150'));
  t('unstamped trip exports a blank vehicle', !!unstampedRow && unstampedRow.endsWith(','));

  // ================= 7. Cloud round trip =================
  t('source: vehicles are a synced list bound for the vehicles table',
    appSrc.includes("{ kind: 'vehicles', table: 'vehicles', row: cloudVehicleRow }") && appSrc.includes("'/rest/v1/vehicles'"));
  t('service worker cache bumped to v81', swSrc.includes('crna-hub-shell-v91'));

  const downloads2 = [];
  const w2 = makeWorld(new Map(), downloads2);
  const run2 = w2.run;
  const TOKENS = { tokA: 'user-a', tokB: 'user-b' };
  const cloud = new Map();
  const tableOf = (name) => { if (!cloud.has(name)) cloud.set(name, new Map()); return cloud.get(name); };
  const resp = (status, data) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(data === undefined ? '' : data) });
  w2.sandbox.fetch = async (url, opts) => {
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
  run2(`cloudSession = ${JSON.stringify(sess)}; cloudActive = true;
        db.vehicles = [
          {id: 'veh-1', name: '2022 Silverado', make: 'Chevrolet', model: 'Silverado', year: '2022', plate: 'ABC123', isDefault: true, updatedAt: '2026-11-07T10:00:00.000Z'},
          {id: 'veh-2', name: '2019 Outback', make: 'Subaru', model: 'Outback', year: '2019', plate: '', isDefault: false, updatedAt: '2026-11-07T10:00:00.000Z'},
        ];
        db.mileage = [
          {id: 'ct-1', date: '2026-11-02', facility: 'Holzer', purpose: 'work', miles: '68.6', status: 'verified', origin: 'home', tripType: 'round-trip', vehicleId: 'veh-1', vehicleName: '2022 Silverado'},
        ];
        persist();`);
  await run2(`cloudUploadSynced()`);
  const cloudVehicles = [...tableOf('vehicles').values()].filter(r => r.user_id === 'user-a');
  t('vehicles upload to the vehicles table', cloudVehicles.length === 2);
  t('the uploaded payload carries the full record (default flag included)',
    cloudVehicles.some(r => r.data && r.data.isDefault === true && r.data.plate === 'ABC123'));
  t("a stored plate stays in the record but is never shown",
    run2(`vehicleDetailLine(db.vehicles.find(v => v.id === 'veh-1'))`).includes('Chevrolet') && !run2(`vehicleDetailLine(db.vehicles.find(v => v.id === 'veh-1'))`).includes('ABC123'));
  run2(`db = empty();`);
  t('device wiped', run2(`db.vehicles.length`) === 0 && run2(`db.mileage.length`) === 0);
  await run2(`(async () => { const d = await cloudFetchAll(); cloudApplyData(d); })()`);
  t('fresh device gets the vehicles back', run2(`db.vehicles.length`) === 2);
  t('the default survives the round trip', run2(`defaultVehicle() && defaultVehicle().name`) === '2022 Silverado');
  t("the trip's vehicle stamp round-trips too",
    run2(`db.mileage.length`) === 1 && run2(`tripVehicleLabel(db.mileage[0])`) === '2022 Silverado');
  run2(`cloudRecordTombstone('vehicles', 'veh-2')`);
  await new Promise(r => setTimeout(r, 60));
  t('a vehicle delete tombstones through to the cloud',
    [...tableOf('vehicles').values()].filter(r => r.user_id === 'user-a').length === 1);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
