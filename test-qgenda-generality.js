// Round 3 generality (client side): a facility whose QGenda grammar the
// app has never seen ("STM - OR Day", "STM - Backup") must still work —
// rows land unclassified, the clarification prompt asks per raw name,
// the answers price the shifts and are remembered (codeMap), and the
// code prefix is remembered as the facility's alias once the user links
// it, so the next feed resolves without asking again. Zero STM-specific
// code anywhere: this exercises only the generic import machinery.
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
  const stmRow = (o) => Object.assign({ date: '2026-11-10', facility: 'STM', type: 'STM - OR Day', code: 'STM - OR Day', hours: null, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed' }, o || {});
  const stmPreview = (rows, extra) => Object.assign({ fileName: 'QGenda feed', source: 'qgenda-feed', matchedName: 'Martin', rows }, extra || {});
  const maryFac = `{id:'f1',name:'St. Mary',aliases:'',address:'',hourlyRate:'',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyCall1st:'',callBonus:'',weekendRate24:'',weekendRateSecond:'',distance:'',notes:'',codeMap:{}}`;

  // ---------- Case 1: first STM import — user links the code to St. Mary
  // and clarifies the two raw names; shifts price from the answers.
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${maryFac}]; db.shifts=[]; persist();`);
  run(`schedulePreview = ${JSON.stringify(stmPreview([stmRow({}), stmRow({ date: '2026-11-12', type: 'STM - Backup', code: 'STM - Backup' })], { facilityAll: 'St. Mary' }))};`);
  const html1 = run(`schedulePreviewHTML()`);
  t('prompt asks per distinct raw STM name', html1.includes('What is “STM - OR Day”') && html1.includes('What is “STM - Backup”'));
  t('prompt is for the linked facility, not the raw code', html1.includes('First time at St. Mary'));
  run(`schedulePreview.clarifyDraft = {hourlyRate:'250', codes:{'STM - OR Day':{label:'OR day shift',hours:'8'},'STM - Backup':{label:'Backup call',hours:'4'}}};`);
  run(`approveScheduleImport();`);
  t('two shifts imported', run(`db.shifts.length`) === 2);
  t('shifts belong to the linked facility', run(`db.shifts.every(s=>s.facility==='St. Mary')`));
  t('OR Day priced from the clarified mapping (250 x 8)', run(`(db.shifts.find(s=>s.date==='2026-11-10')||{}).pay`) === '2000' && run(`(db.shifts.find(s=>s.date==='2026-11-10')||{}).type`) === 'OR day shift');
  t('Backup priced from the clarified mapping (250 x 4)', run(`(db.shifts.find(s=>s.date==='2026-11-12')||{}).pay`) === '1000' && run(`(db.shifts.find(s=>s.date==='2026-11-12')||{}).type`) === 'Backup call');
  t('codeMap remembers both raw names on the facility', run(`!!(db.facilities[0].codeMap||{})['STM - OR Day'] && !!(db.facilities[0].codeMap||{})['STM - Backup']`));
  t('the code prefix is remembered as a facility alias', run(`facilityAliases(db.facilities[0]).includes('STM')`) === true);
  t('future STM rows resolve to St. Mary by alias', run(`(facilityByNameOrAlias('STM')||{}).name`) === 'St. Mary');

  // ---------- Case 2: re-import — no prompt, prices from memory.
  run(`schedulePreview = ${JSON.stringify(stmPreview([stmRow({ date: '2026-11-17' }), stmRow({ date: '2026-11-19', type: 'STM - Backup', code: 'STM - Backup' })]))};`);
  t('no clarification prompt on re-import (mapping remembered)', run(`importRatesTarget(schedulePreview) === null`));
  t('rows count as facility-resolved via the alias', run(`schedulePreview.rows.every(r=>scheduleRowFacilityResolved(r))`));
  run(`approveScheduleImport();`);
  t('re-imported shifts price automatically', run(`(db.shifts.find(s=>s.date==='2026-11-17')||{}).pay`) === '2000' && run(`(db.shifts.find(s=>s.date==='2026-11-19')||{}).pay`) === '1000');
  t('re-imported shifts carry the clarified types', run(`(db.shifts.find(s=>s.date==='2026-11-17')||{}).type`) === 'OR day shift' && run(`(db.shifts.find(s=>s.date==='2026-11-19')||{}).type`) === 'Backup call');

  // ---------- Case 3: no link, no clarification — the rows still land,
  // named by the code as read, unpriced (never silently dropped).
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[]; db.shifts=[]; persist();`);
  run(`schedulePreview = ${JSON.stringify(stmPreview([stmRow({ date: '2026-11-10' })]))};`);
  run(`approveScheduleImport();`);
  t('unlinked STM row still imports', run(`db.shifts.length`) === 1);
  t('it keeps the code as its facility, as read', run(`db.shifts[0].facility`) === 'STM');
  t('it stays unpriced rather than mispriced', run(`db.shifts[0].pay`) === '' && run(`db.shifts[0].incomplete`) === true);

  // ---------- Case 4: the .ics calendar approve path links the same way.
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${maryFac}]; db.shifts=[]; persist();`);
  run(`calPreview = {fileName:'stm.ics', source:'calendar-import', sourceLabel:'ICS', facilityAll:'St. Mary', rows:[{date:'2026-11-10', facility:'STM', type:'STM - OR Day', code:'STM - OR Day', pay:'', include:true, duplicate:false, flags:[], source:'calendar-import', note:''}]};`);
  run(`approveCalendarImport();`);
  t('calendar import remembers the code as an alias too', run(`facilityAliases(db.facilities[0]).includes('STM')`) === true);
  t('calendar shift lands on the linked facility', run(`db.shifts.length`) === 1 && run(`db.shifts[0].facility`) === 'St. Mary');

  console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL PASS');
})();
