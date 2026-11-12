// CRNA Hub — tests for the Nov 6, 2026 declutter + addresses + per-shift
// origin round (branch muse/credentialing). Run: node test-facilities-declutter.js
//
// Covers:
//   * Facilities: pay stub panel and manual facility panel collapsed by
//     default (tappable <details> header), contract panel open and
//     primary; no read-method buttons anywhere. (v123: the standalone AI rule chat is retired — the contract
//     preview's own words box is the only clarification path.)
//   * One read action: contract + pay stub photos go to AI automatically;
//     with AI unavailable the on-device read takes over automatically and
//     says so (honest status line), producing the same preview flow.
//   * Account: Backup & restore collapsed with its explanation paragraphs
//     gone, all four functions still inside; home address moved up into
//     the account/profile area with a new hotel address field alongside;
//     saving stores both; the hotel address feeds mileage origins.
//   * Per-shift origin: day-view "Drive from" picker per shift; call
//     shifts get the friendly prompt with quick Home/Hotel + dismiss;
//     dismissing changes nothing; the saved choice is what the weekly
//     recalculation drives from (hotel -> hotel address, home -> home
//     address), and a call shift set to Home calculates from home.
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
const reviewEls = {}; // '.reviewOrigin:tripId' -> {value}
class FakeFormData {
  constructor(form) { this._map = (form && form._map) || {}; }
  get(k) { return k in this._map ? this._map[k] : null; }
  *[Symbol.iterator]() { yield* Object.entries(this._map); }
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
    querySelectorAll: () => [],
    querySelector: (sel) => {
      const m = /^\.(\w+)\[data-trip="([^"]+)"\]$/.exec(sel);
      if (m) return reviewEls[m[1] + ':' + m[2]] || null;
      return null;
    },
    createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {},
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

(async () => {
  // ================= Facilities page structure =================
  run(`db.facilities = [{id:'f1', name:'Holzer', aliases:'', address:'', hourlyRate:'250'}];
       db.facilitySuggestions = []; db.payStubs = []; editId = null; facilitySuggestionPrefill = null;
       paystubPreview = null; paystubError = ''; paystubStatus = '';`);
  const page = run(`facilitiesPage()`);
  t('pay stub panel is a collapsed-by-default details (no open attr)',
    page.includes('<details class="panel collapse-panel" id="paystub-panel">'));
  t('manual facility panel is a collapsed-by-default details (no open attr)',
    page.includes('<details class="panel collapse-panel" id="facility-manual-panel">'));
  t('manual pay-schedule form is nested-collapsed inside the pay stub panel',
    page.includes('<details class="collapse-sub" id="paystub-manual">'));
  t('contract upload is its own collapse panel above the pay stub panel, with the one read button',
    page.includes('<details class="panel collapse-panel" id="facility-contract-panel"') &&
    page.includes('Read my contract') &&
    page.indexOf('facility-contract-panel') < page.indexOf('paystub-panel') &&
    page.indexOf('paystub-panel') < page.indexOf('facility-manual-panel'));
  t('no read-method buttons anywhere on the Facilities page',
    !page.includes('facility-contract-ocr') && !page.includes('paystub-read-text') &&
    !page.includes('No connection? Try on-device') && !page.includes('Read pasted text / PDF instead') &&
    !page.includes('Read with AI — recommended'));
  t('read-method actions are gone from the app source',
    !appSrc.includes('data-action="facility-contract-ocr"') &&
    !appSrc.includes("action==='facility-contract-ocr'") &&
    !appSrc.includes("action==='paystub-read-text'") &&
    !appSrc.includes('async function importPaystubText'));
  // v123 expectation change (Caleb, Nov 11, 2026 — disclosed, not
  // silent): the standalone AI rule chat under the contract panel
  // is retired; the words box now lives inside the contract
  // preview itself (see test-v123-import-preview-words.js).
  t('standalone AI rule chat is retired from the page',
    !page.includes('ruleChatForm') && !page.includes('Make my rule with AI'));
  t('facilities list and manual form fields survive inside the collapse',
    page.includes('My facilities') && page.includes('Holzer') &&
    page.includes('id="f_name"') && page.includes('Hourly rate ($)'));
  run(`editId = 'f1';`);
  const pageEdit = run(`facilitiesPage()`);
  t('manual panel renders OPEN when editing a facility',
    pageEdit.includes('<details class="panel collapse-panel" id="facility-manual-panel" open>'));
  run(`editId = null; paystubPreview = {agency:'Premier', frequency:'biweekly', payDate:'2026-11-20', gross:'100', net:'', periodStart:'', periodEnd:'', facility:'', id:'', fileName:'s.jpg', method:'test', aiRead:true, source:'ai-vision', found:[]};`);
  const pageStub = run(`facilitiesPage()`);
  t('pay stub panel renders OPEN while a preview is waiting',
    pageStub.includes('<details class="panel collapse-panel" id="paystub-panel" open>'));
  run(`paystubPreview = null;`);

  // ================= Automatic fallback: contract photos =================
  run(`ocrBestPassForFile = async () => ({text: 'Facility: Holzer\\nRate: $250/hr, $1,000 overnight call bonus', pass: 'stub'});`);
  elements['f_facilityContractFile'] = el();
  elements['f_facilityContractFile'].files = [{ name: 'contract.jpg', type: 'image/jpeg' }];
  elements['f_facilityContractText'] = el();
  run(`facilityContractPreview = null; facilityContractError = ''; db.facilities = [];`);
  await run(`importFacilityContract({ preventDefault() {} })`);
  t('contract photo with no sign-in is read on-device automatically -> preview',
    run(`!!facilityContractPreview`) === true &&
    /Holzer/.test(run(`facilityContractPreview.facilities[0].name`)));
  t('fallback is announced honestly on the preview',
    run(`facilityContractOcrStatus`).includes('read on your device instead'));
  t('nothing saved by the fallback read itself', run(`db.facilities.length`) === 0);

  // ================= Automatic fallback: pay stub photos =================
  run(`ocrBestPassForFile = async () => ({text: 'Employer: Premier Anesthesia Group\\nPay Period: 11/02/2026 - 11/15/2026\\nPay Date: 11/20/2026\\nGross Pay: $3,600.00\\nNet Pay: $2,700.00', pass: 'stub'});`);
  elements['f_paystubFile'] = el();
  elements['f_paystubFile'].files = [{ name: 'stub.jpg', type: 'image/jpeg' }];
  elements['f_paystubText'] = el();
  run(`paystubPreview = null; paystubError = ''; paystubStatus = '';`);
  await run(`importPaystub({ preventDefault() {} })`);
  t('pay stub photo with no sign-in is read on-device automatically -> preview',
    run(`!!paystubPreview`) === true && run(`paystubPreview.agency`) === 'Premier Anesthesia Group');
  t('pay stub fallback preview is labelled on-device (source + status)',
    run(`paystubPreview.source`) === 'device-ocr' &&
    run(`paystubStatus`).includes('read on your device instead'));
  // Pasted-text path still one action, no method choice:
  elements['f_paystubFile'].files = [];
  elements['f_paystubText'].value = 'Employer: Premier Anesthesia Group\nPay Date: 11/20/2026\nGross Pay: $3,600.00';
  run(`paystubPreview = null; paystubError = ''; paystubStatus = '';`);
  await run(`importPaystub({ preventDefault() {} })`);
  t('pasted pay stub text still reads in one action',
    run(`!!paystubPreview`) === true && run(`paystubPreview.source`) === 'text-parse');
  run(`paystubPreview = null;`);

  // ================= Account: backup collapse =================
  const backup = run(`backupHTML()`);
  t('Backup & restore is collapsed by default',
    backup.startsWith('<details class="panel collapse-panel" id="backup-panel">'));
  t('backup explanation paragraphs are gone',
    !backup.includes('Back up before changing phones') && !backup.includes('Current mode:') &&
    !backup.includes('never overwrites your cloud account'));
  t('all four backup functions still inside, disclaimer kept as small print',
    backup.includes('Download JSON backup') && backup.includes('Download shift CSV') &&
    backup.includes('Download mileage CSV') && backup.includes('id="restoreFile"') &&
    backup.includes('CRNA Hub is not liable for mistakes') && backup.includes('font-size:0.85em'));

  // ================= Account: addresses moved up + hotel field =================
  const acct = run(`accountPage()`);
  t('addresses section is on the Account tab, above Live calendar sync',
    acct.includes('<h2>Your addresses</h2>') &&
    acct.indexOf('<h2>Your addresses</h2>') < acct.indexOf('Live calendar sync'));
  t('addresses carry the one-line mileage explanation (Nov 7, 2026)',
    acct.includes('Save your home address and where you stay on call — we\'ll use them to calculate your mileage automatically.'));
  t('old home-address heading/paragraphs are gone',
    !acct.includes('Home address — for automatic mileage') &&
    !acct.includes('OpenStreetMap geocoder and OSRM'));
  t('both address fields present (home + hotel)',
    acct.includes('id="f_homeAddress"') && acct.includes('id="f_hotelAddress"'));
  await run(`submitHomeAddress({ currentTarget: { _map: { homeAddress: '1 Home St', hotelAddress: '9 Hotel Ave' } } })`);
  t('saving stores BOTH addresses',
    run(`db.settings.homeAddress`) === '1 Home St' && run(`db.settings.hotelAddress`) === '9 Hotel Ave');
  t('saved hotel address is a known mileage origin address',
    run(`knownHotelAddresses()`).includes('9 Hotel Ave'));

  // ================= Per-shift origin: day view =================
  run(`
    db.settings.homeAddress = '1 Home St'; db.settings.hotelAddress = '9 Hotel Ave';
    db.hotelStays = []; db.mileage = [];
    db.facilities = [{id:'f1', name:'Holzer', aliases:'', address:'1 Facility Way', distance:''}];
    db.shifts = [
      {id:'c1', date:'2026-11-03', facility:'Holzer', type:'24-hour call', pay:'4800', status:'confirmed'},
      {id:'d1', date:'2026-11-03', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'}
    ];
    selected = '2026-11-03'; dayViewOpen = true; callOriginPromptDismissed = new Set();
  `);
  const day = run(`dayViewHTML()`);
  t('call shift shows the friendly driving-location prompt with quick Home/Hotel',
    day.includes('I see you’re on call — want to change your driving location?') &&
    day.includes('data-action="shift-origin-quick"') && day.includes('data-date="hotel"') &&
    day.includes('data-action="shift-origin-dismiss"'));
  t('non-call shift gets NO prompt but keeps the Drive from picker',
    (day.match(/on call — want to change/g) || []).length === 1 &&
    day.includes('data-shift-origin="d1"'));
  run(`setShiftTripOrigin('c1', 'hotel')`);
  t('choosing Hotel saves the choice on the shift’s own trip, from the saved hotel address',
    run(`db.mileage.length`) === 1 && run(`db.mileage[0].origin`) === 'hotel' &&
    run(`db.mileage[0].hotelAddress`) === '9 Hotel Ave' && run(`db.mileage[0].originChosen`) === true);
  const dayAfter = run(`dayViewHTML()`);
  t('prompt is gone once the user has chosen for that shift',
    !dayAfter.includes('on call — want to change'));
  run(`db.shifts.push({id:'c2', date:'2026-11-03', facility:'Holzer', type:'Second call', pay:'3000', status:'confirmed'});
       actions('shift-origin-dismiss', 'c2');`);
  const dayDismissed = run(`dayViewHTML()`);
  t('dismissing the prompt hides it and changes NOTHING (no trip created)',
    !dayDismissed.includes('data-id="c2" data-date="hotel"') &&
    run(`db.mileage.filter(m => m.date === '2026-11-03').length`) === 1);
  run(`setShiftTripOrigin('c1', 'home')`);
  t('the same call shift can be set back to Home — call never forces Hotel',
    run(`db.mileage[0].origin`) === 'home' && run(`db.mileage[0].hotelAddress`) === '');
  t('tripOriginAddress resolves by the SAVED choice',
    run(`tripOriginAddress({origin:'home', hotelAddress:''})`) === '1 Home St' &&
    run(`tripOriginAddress({origin:'hotel', hotelAddress:'', date:'2026-11-03', facility:'Holzer'})`) === '9 Hotel Ave' &&
    run(`tripOriginAddress({origin:'hotel', hotelAddress:'5 Other Hotel', date:'2026-11-03', facility:'Holzer'})`) === '5 Other Hotel');

  // ================= Weekly recalc drives from the saved choice =================
  sandbox.fetch = async (url) => {
    const u = String(url);
    if (u.includes('nominatim')) {
      const q = decodeURIComponent(u.split('q=')[1] || '');
      const lat = q.includes('Hotel') ? '10' : q.includes('Home') ? '20' : '30';
      return { ok: true, status: 200, text: async () => '{}', json: async () => [{ lat, lon: '0', display_name: q }] };
    }
    if (u.includes('router.project-osrm.org')) {
      const seg = u.split('driving/')[1].split('?')[0];
      const [a, b] = seg.split(';').map((s) => Number(s.split(',')[1]));
      const miles = Math.abs(a - b) * 100;
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({ routes: [{ distance: miles * 1609.344 }] }) };
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };
  run(`
    db.settings.homeAddress = '2 Home Street';
    db.mileage = [
      {id:'t1', date:'2026-11-03', facility:'Holzer', purpose:'x', miles:'', status:'draft', milesSource:'needs-manual', origin:'hotel', hotelAddress:'', tripType:'round-trip', oneWayMiles:'', originChosen:true},
      {id:'t2', date:'2026-11-04', facility:'Holzer', purpose:'x', miles:'', status:'draft', milesSource:'needs-manual', origin:'home', hotelAddress:'', tripType:'round-trip', oneWayMiles:'', originChosen:true}
    ];
    db.shifts = [
      {id:'c1', date:'2026-11-03', facility:'Holzer', type:'24-hour call', pay:'4800', status:'confirmed'},
      {id:'c9', date:'2026-11-04', facility:'Holzer', type:'24-hour call', pay:'4800', status:'confirmed'}
    ];
    db.facilities = [{id:'f1', name:'Holzer', aliases:'', address:'1 Facility Way', distance:''}];
  `);
  await run(`generateWeeklyMileageDrafts('2026-11-02')`);
  t('recalc: Hotel choice drives from the HOTEL address (2000 mi one-way -> 4000 round trip)',
    run(`db.mileage.find(m => m.id === 't1').miles`) === '4000' &&
    run(`db.mileage.find(m => m.id === 't1').hotelAddress`) === '9 Hotel Ave');
  t('recalc: a CALL shift set to Home drives from HOME (1000 mi one-way -> 2000 round trip)',
    run(`db.mileage.find(m => m.id === 't2').miles`) === '2000');

  // Review edit: changing origin to Hotel stamps the saved hotel address
  run(`db.mileage = [{id:'t9', date:'2026-11-03', facility:'Holzer', purpose:'x', miles:'80', status:'draft', milesSource:'manual', origin:'home', hotelAddress:'', tripType:'round-trip', oneWayMiles:'40'}];`);
  reviewEls['reviewOrigin:t9'] = { value: 'hotel' };
  reviewEls['reviewMiles:t9'] = { value: '' };
  run(`applyMileageReviewEdits('2026-11-02')`);
  t('review: switching a trip to Hotel stamps the saved hotel address + marks the choice',
    run(`db.mileage[0].origin`) === 'hotel' && run(`db.mileage[0].hotelAddress`) === '9 Hotel Ave' &&
    run(`db.mileage[0].originChosen`) === true && run(`db.mileage[0].miles`) === '');

  const reviewHTML = run(`mileageReviewHTML()`);
  t('weekly review shows the same friendly line for an unchosen call trip',
    reviewHTML.includes('I see you’re on call — want to change your driving location? Pick here.'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
