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
run(`const blankFac = (name) => ({id:'f-' + name, name, aliases:'', address:'', hourlyRate:'', paidHours8:'', rate8:'2000', rate10:'', rate12:'', rate24:'', rateSecond:'', hourlyCall1st:'', callBonus:'', weekendRate24:'', weekendRateSecond:'', distance:'', notes:''});`);
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? "PASS " : "FAIL ") + name + (extra ? " — " + extra : "")); if (!cond) { fails++; process.exitCode = 1; } };

(async () => {
  const Y = run(`currentYear()`);
  const TODAY = Y + '-11-08';
  const seed = {
    facilities: [
      {id: 'f-holzer', name: 'Holzer Health System', aliases: 'Holzer', address: '100 Jackson Pike, Gallipolis, OH 45631', hourlyRate: '250', paidHours8: '8.5', rate8: '2125', rate10: '', rate12: '', rate24: '', rateSecond: '', hourlyCall1st: '', callBonus: '', weekendRate24: '', weekendRateSecond: '', distance: '', notes: ''},
      {id: 'f-camc', name: 'CAMC', aliases: '', address: '3200 MacCorkle Ave SE, Charleston, WV 25304', hourlyRate: '', paidHours8: '', rate8: '2000', rate10: '', rate12: '', rate24: '', rateSecond: '', hourlyCall1st: '', callBonus: '', weekendRate24: '', weekendRateSecond: '', distance: '', notes: ''},
      {id: 'f-tiny', name: 'Tiny Hospital', aliases: '', address: '', hourlyRate: '', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', rateSecond: '', hourlyCall1st: '', callBonus: '', weekendRate24: '', weekendRateSecond: '', distance: '', notes: ''},
    ],
    shifts: [
      // Holzer — counts: alias-named confirmed, proposed, completed
      {id: 'h1', date: Y + '-03-10', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed'},
      {id: 'h2', date: Y + '-05-01', facility: 'Holzer Health System', type: 'Second call', pay: '3000', status: 'proposed'},
      {id: 'h3', date: Y + '-06-15', facility: 'Holzer Health System', type: '24-hour call', pay: '4800', status: 'completed'},
      // Holzer — excluded: future, prior year, unpriced, incomplete, rejected, canceled, Off type
      {id: 'h4', date: Y + '-12-01', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed'},
      {id: 'h5', date: (Y - 1) + '-11-01', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed'},
      {id: 'h6', date: Y + '-04-01', facility: 'Holzer', type: '8-hour day', pay: '', status: 'confirmed'},
      {id: 'h7', date: Y + '-04-02', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed', incomplete: true},
      {id: 'h8', date: Y + '-04-03', facility: 'Holzer', type: '8-hour day', pay: '2000', status: 'rejected'},
      {id: 'h9', date: Y + '-04-04', facility: 'Holzer', type: '8-hour day', pay: '2000', status: 'canceled'},
      {id: 'h10', date: Y + '-04-05', facility: 'Holzer', type: 'Off', pay: '1000', status: 'confirmed'},
      // CAMC — counts
      {id: 'c1', date: Y + '-02-01', facility: 'CAMC', type: '8-hour day', pay: '2000', status: 'confirmed'},
      {id: 'c2', date: Y + '-02-02', facility: 'CAMC', type: '10-hour day', pay: '2500', status: 'proposed'},
      // Tiny — shifts exist but all unpriced
      {id: 't1', date: Y + '-03-01', facility: 'Tiny Hospital', type: '8-hour day', pay: '', status: 'confirmed'},
    ],
  };
  run(`db = empty(); const seedData = ${JSON.stringify(seed)}; db.facilities = seedData.facilities; db.shifts = seedData.shifts; persist();`);
  const ytdOf = (fid) => run(`facilityYearToDate(db.facilities.find(f => f.id === '${fid}'), '${TODAY}')`);

  t('Holzer YTD = confirmed+proposed+completed priced past shifts (alias attributed)', ytdOf('f-holzer') === 9925, 'got ' + ytdOf('f-holzer'));
  t('CAMC YTD sums only its own shifts', ytdOf('f-camc') === 4500, 'got ' + ytdOf('f-camc'));
  t('Facility with only unpriced shifts shows 0', ytdOf('f-tiny') === 0, 'got ' + ytdOf('f-tiny'));
  const engineYtd = run(`yearIncomeSplit(${Y}, '${TODAY}').ytd`);
  t('Per-facility YTDs reconcile with the engine YTD (P bucket)', ytdOf('f-holzer') + ytdOf('f-camc') + ytdOf('f-tiny') === engineYtd, 'engine ' + engineYtd);

  // facilityId attribution: a shift carrying CAMC's id counts for CAMC even under another name string
  run(`db.shifts.push({id: 'c3', date: '${Y}-03-01', facility: 'Charleston Area Medical Center', facilityId: 'f-camc', type: '8-hour day', pay: '1000', status: 'confirmed'}); persist();`);
  t('facilityId wins attribution', ytdOf('f-camc') === 5500 && ytdOf('f-holzer') === 9925, 'camc ' + ytdOf('f-camc'));

  // Live recompute: deleting a shift drops the figure with no extra refresh path
  run(`db.shifts = db.shifts.filter(x => x.id !== 'h1'); persist();`);
  t('YTD recomputes live after a delete', ytdOf('f-holzer') === 7800, 'got ' + ytdOf('f-holzer'));

  // Rendering: every My facilities card carries the figure line with the year label
  const html = run(`myFacilitiesHTML()`);
  const figures = (html.match(/class="facility-ytd"/g) || []).length;
  t('One YTD figure per facility card', figures === 3, 'found ' + figures);
  t('Holzer card shows its YTD figure', html.includes(Y + ' YTD ' + run(`currency(7800)`)), run(`currency(7800)`));
  t('CAMC card shows its YTD figure', html.includes(Y + ' YTD ' + run(`currency(5500)`)));
  t('Unpriced-only facility card shows $0 figure, no warning text added', html.includes(Y + ' YTD ' + run(`currency(0)`)));

  console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL PASS');
})();
