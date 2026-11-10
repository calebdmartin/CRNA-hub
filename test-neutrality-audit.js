// Neutrality audit (Nov 10, 2026) — Caleb's rule, generalized: NONE of
// his personal rules may be baked into the app as universal behaviour.
// His rates, names, paid hours, pay timing and weekend definition live
// ONLY as captured per-facility / per-user data. This suite pins:
//   1. The server title parser that priced "Holzer" titles from
//      hard-coded rates (parseWorkShiftTitle) is GONE from the shared
//      calendar parser and the QGenda parser — pricing flows only
//      through saved facility rules (the Deno suites pin the math).
//   2. Client contract classification is generic: "<Facility> 8/10/12"
//      works for ANY capitalised facility name, prose never classifies,
//      month names never become facilities, and no contract header
//      invents a facility the document's lines never named.
//   3. A synthetic other user (invented facilities, different rates,
//      a Friday-inclusive weekend) prices correctly through the client
//      engine with no Caleb data present — and Caleb's own captured
//      card still reproduces his exact prices through the same path.
// Run: node test-neutrality-audit.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) {
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [],
    dataset: {}, style: {}, _listeners: {}, _entries: null,
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [],
  };
}
const elements = {};
const getEl = (id) => elements[id] || (elements[id] = el(id));
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
    getElementById: (id) => getEl(id),
    querySelectorAll: () => [],
    createElement: () => el(), body: { append() {} },
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
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) { fails++; process.exitCode = 1; } };

(async () => {
  // --- 1. The hard-coded server pricing parser is gone -------------
  const calTs = fs.readFileSync(R + 'supabase/functions/_shared/calendar.ts', 'utf8');
  const parseTs = fs.readFileSync(R + 'supabase/functions/qgenda-feed/parse.ts', 'utf8');
  t('server: parseWorkShiftTitle no longer exists in _shared/calendar.ts', !calTs.includes('parseWorkShiftTitle'));
  t('server: qgenda parse.ts no longer references parseWorkShiftTitle', !parseTs.includes('parseWorkShiftTitle'));
  t('server: no hard-coded price literals left in the shared parser', !/"(2125|2625|3000|4800|4200)"/.test(calTs));
  t('server: no hard-coded Holzer location rescue in qgenda parse.ts', !/containsToken\(location, "holzer"\)/.test(parseTs));
  const appJs = fs.readFileSync(R + 'app.js', 'utf8');
  t('client: no hard-coded Holzer facility branch remains', !/return \{name:'Holzer'/.test(appJs) && !/addName\('Holzer'\)/.test(appJs) && !/globalFacility='Holzer'/.test(appJs));

  // --- 2. Generic client classification ----------------------------
  run(`db.facilities=[];db.contracts=[];db.shifts=[]`);
  t('classify: “Holzer 8” is an 8-hour day (parity, via the generic rule)', run(`contractShiftType('Holzer 8')`) === '8-hour day');
  t('classify: “Riverside 8” is an 8-hour day', run(`contractShiftType('Riverside 8')`) === '8-hour day');
  t('classify: “Holzer 10” / “Northgate 12” classify generically',
    run(`contractShiftType('Holzer 10')`) === '10-hour shift' && run(`contractShiftType('Northgate 12')`) === '12-hour shift');
  t('classify: “Holzer 8/2nd call” and “Riverside 8/2nd call” are Second call',
    run(`contractShiftType('Holzer 8/2nd call')`) === 'Second call' && run(`contractShiftType('Riverside 8/2nd call')`) === 'Second call');
  t('classify: prose never classifies (“paid for 12 years of service”)', run(`contractShiftType('paid for 12 years of service')`) === '');
  t('facility-for-line: “Holzer 8” names Holzer from the line itself', run(`contractFacilityForLine('Holzer 8','').name`) === 'Holzer');
  t('facility-for-line: “Riverside 10” names Riverside', run(`contractFacilityForLine('Riverside 10','').name`) === 'Riverside');
  t('facility-for-line: a dated line names no month (“Nov 12 8-hour day”)', run(`contractFacilityForLine('Nov 12 8-hour day','').name`) === '');

  // A contract for a facility the app has never heard of, with no
  // saved facilities: the header label names it, the rows price from
  // the document's own stated flats.
  const otherDoc = [
    'Facility: Riverside General',
    'Nov 10, 2026 Riverside 8 $1,440 flat',
    'Nov 12, 2026 Riverside 2nd call $2,200 flat',
  ].join('\n');
  run(`window.__otherDoc=${JSON.stringify(otherDoc)}`);
  const otherParsed = run(`parseContractText(window.__otherDoc,'other.txt')`);
  t('contract: header facility is used for an unknown facility', otherParsed.contract.facility === 'Riverside General', otherParsed.contract.facility);
  t('contract: rows carry the header facility and the stated flats',
    otherParsed.rows.length === 2 && otherParsed.rows.every(r => r.facility === 'Riverside General') &&
    otherParsed.rows[0].pay === '1440' && otherParsed.rows[1].pay === '2200',
    JSON.stringify(otherParsed.rows.map(r => [r.facility, r.type, r.pay])));

  // A rates-only document that merely MENTIONS a hospital in prose
  // must not have that hospital stamped onto it as its facility.
  const proseDoc = 'Locum coverage at Holzer Medical Center.\nRate: $250/hr\n2nd call rate: $3,000';
  run(`window.__proseDoc=${JSON.stringify(proseDoc)}`);
  const proseParsed = run(`parseContractText(window.__proseDoc,'prose.txt')`);
  t('contract: a prose mention never becomes the contract facility', proseParsed.contract.facility === '', JSON.stringify(proseParsed.contract.facility));

  // Facility-from-contract candidates: acronym codes come from the
  // document's own name positions, never a built-in hospital list —
  // and prose acronyms (“DAILY RATE …”) suggest nothing.
  const rghDoc = 'RGH\nDaily rate $1,440 per day\nSecond call $2,200';
  run(`window.__rghDoc=${JSON.stringify(rghDoc)}`);
  const rghParsed = run(`parseFacilityContract(window.__rghDoc,'rgh.txt')`);
  const rghNames = rghParsed.facilities.map(f => f.name);
  t('facility contract: the document’s own code (RGH) is a candidate', rghNames.includes('RGH'), rghNames.join(','));
  t('facility contract: prose words (DAILY) are never candidates', !rghNames.includes('DAILY') && !rghNames.includes('RATE'), rghNames.join(','));

  // --- 3. Synthetic other user prices from their own card only -----
  // Invented facilities, invented rates, weekend = Fri/Sat/Sun.
  // 2026-11-06 is a Friday; 2026-11-09 is a Monday.
  const rghFac = run(`(db.facilities=[{id:'fx1',name:'Riverside General',aliases:'RGH',address:'',hourlyRate:'180',paidHours8:'8',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',rateSecond:'2200',weekendRateSecond:'1600',hourlyCall1st:'150',callBonus:'',weekendDays:[0,5,6],distance:'',notes:''}],db.facilities[0])`);
  t('other user: 8-hour day = $180 x 8 paid hours', run(`facilityPayFor(db.facilities[0],'8-hour day','2026-11-09')`) === 1440);
  t('other user: Monday 2nd call at the weekday rate', run(`facilityPayFor(db.facilities[0],'Second call','2026-11-09')`) === 2200);
  t('other user: FRIDAY 2nd call at THEIR weekend rate', run(`facilityPayFor(db.facilities[0],'Second call','2026-11-06')`) === 1600);
  t('other user: 24-hour call from their segmented rates', run(`facilityPayFor(db.facilities[0],'24-hour call','2026-11-09')`) === 3840);

  // Caleb parity through the same neutral path: his CAPTURED card
  // (saved from his contract and his own words) reproduces his exact
  // prices. Nothing about these numbers exists in the code.
  run(`db.facilities=[{id:'f1',name:'Holzer',aliases:'',address:'',hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'',rate12:'',rate24:'4800',weekendRate24:'4200',rateSecond:'3000',weekendRateSecond:'2000',hourlyCall1st:'175',callBonus:'',distance:'',notes:''}]`);
  t('caleb parity: Holzer 8 = $2,125 from his card', run(`facilityPayFor(db.facilities[0],'8-hour day','2026-11-09')`) === 2125);
  t('caleb parity: weekday 2nd call $3,000 / weekend $2,000',
    run(`facilityPayFor(db.facilities[0],'Second call','2026-11-09')`) === 3000 &&
    run(`facilityPayFor(db.facilities[0],'Second call','2026-11-08')`) === 2000);
  t('caleb parity: Friday is a WEEKDAY for his facilities ($3,000, not $2,000)', run(`facilityPayFor(db.facilities[0],'Second call','2026-11-06')`) === 3000);
  t('caleb parity: 24-hour call $4,800 weekday / $4,200 weekend from his card',
    run(`facilityPayFor(db.facilities[0],'24-hour call','2026-11-09')`) === 4800 &&
    run(`facilityPayFor(db.facilities[0],'24-hour call','2026-11-08')`) === 4200);

  console.log(fails ? `\n${fails} FAILING` : '\nALL PASS');
})();
