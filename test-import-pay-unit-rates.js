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
  const lastAlert = () => alerts[alerts.length - 1] || '';
  const mkRow = (o) => Object.assign({date:'2026-12-07', facility:'CAMC', type:'8-hour day', pay:'', name:'Martin', matchedName:'Martin', match:'matched', include:true, duplicate:false, flags:[], source:'schedule-import'}, o || {});
  const mkPreview = (rows, extra) => Object.assign({fileName:'sched.csv', matchedName:'Martin', source:'schedule-import', rows}, extra || {});

  // ---------- Case 1: pay unit — hourly converts, daily is the default total ----------
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[{id:'f1',name:'CAMC',aliases:'',address:'',hourlyRate:'',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyCall1st:'',callBonus:'',weekendRate24:'',weekendRateSecond:'',distance:'',notes:''}]; db.shifts=[]; persist();`);
  run(`schedulePreview = ${JSON.stringify(mkPreview([mkRow({pay:'250'})]))};`);
  t('pay-unit control renders in the schedule preview', run(`schedulePreviewHTML().includes('previewPayUnit')`));
  t('default unit is labelled per-shift total', run(`schedulePreviewHTML().includes('Pay ($ per shift)')`));
  run(`schedulePreview.payUnit='hourly';`);
  t('hourly unit relabels the Pay header', run(`schedulePreviewHTML().includes('Pay ($/hr)')`));
  run(`approveScheduleImport();`);
  t('hourly 250 x 8h lands as a 2000 total', run(`db.shifts.length`) === 1 && run(`db.shifts[0].pay`) === '2000');
  t('the entered rate + unit persist on the shift', run(`db.shifts[0].payRate`) === '250' && run(`db.shifts[0].payUnit`) === 'hourly');

  run(`db = empty(); db.facilities=[{id:'f1',name:'CAMC',aliases:'',hourlyRate:'',rate8:''}]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({type:'12-hour shift', pay:'100'})]))}; schedulePreview.payUnit='hourly'; approveScheduleImport();`);
  t('hourly 100 x 12h lands as 1200', run(`db.shifts[0].pay`) === '1200' && run(`db.shifts[0].payUnit`) === 'hourly');

  run(`db = empty(); db.facilities=[{id:'f1',name:'CAMC',aliases:'',hourlyRate:'',rate8:''}]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({pay:'2000'})]))}; approveScheduleImport();`);
  t('daily (default) keeps the typed amount as the shift total', run(`db.shifts[0].pay`) === '2000' && run(`db.shifts[0].payUnit`) === 'daily' && run(`db.shifts[0].payRate`) === '2000');

  // ---------- Case 2: rates prompt — new facility on a fresh account ----------
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({facility:''})]))}; schedulePreview.facilityAll='CAMC';`);
  t('prompt appears for a brand-new facility', run(`schedulePreviewHTML().includes('First time at CAMC') && schedulePreviewHTML().includes('importRateEdit') && schedulePreviewHTML().includes('Skip for now')`));
  run(`schedulePreview.ratesDraft={hourlyRate:'250', rate8:'2000'}; approveScheduleImport();`);
  t('facility is created WITH the entered rates', run(`db.facilities.length`) === 1 && run(`db.facilities[0].hourlyRate`) === '250' && run(`db.facilities[0].rate8`) === '2000');
  t('the imported shift prices immediately from them', run(`db.shifts.length`) === 1 && run(`db.shifts[0].pay`) === '2000' && run(`db.shifts[0].incomplete`) === false);
  t('approval message says rates were saved', lastAlert().includes('Rates saved for CAMC'));

  // ---------- Case 3: no prompt when the facility already prices the rows ----------
  run(`db = empty(); db.facilities=[{id:'f1',name:'CAMC',aliases:'',hourlyRate:'250',rate8:'2000'}]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({})]))};`);
  t('no rates prompt for an already-priced facility', !run(`schedulePreviewHTML().includes('First time at')`));
  run(`approveScheduleImport();`);
  t('blank pay still prices from the saved facility rates', run(`db.shifts[0].pay`) === '2000');

  // ---------- Case 4: existing facility with NO usable rates — prompt + merge ----------
  run(`db = empty(); db.facilities=[{id:'f1',name:'CAMC',aliases:'',hourlyRate:'',rate8:''}]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({})]))};`);
  t('prompt appears for a saved facility with no rates', run(`schedulePreviewHTML().includes('First time at CAMC')`));
  run(`schedulePreview.ratesDraft={hourlyRate:'250'}; approveScheduleImport();`);
  t('rates merge onto the existing facility (no duplicate)', run(`db.facilities.length`) === 1 && run(`db.facilities[0].hourlyRate`) === '250');
  t('shift prices from the just-entered hourly rate', run(`db.shifts[0].pay`) === '2000');

  // ---------- Case 5: skip path — unpriced, explained, never nags again ----------
  run(`db = empty(); db.facilities=[]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({facility:''})]))}; schedulePreview.facilityAll='Mercer';`);
  run(`actions('import-rates-skip','sched');`);
  t('skip dismisses the prompt', !run(`schedulePreviewHTML().includes('First time at')`));
  run(`approveScheduleImport();`);
  t('skipped shifts land named but unpriced', run(`db.shifts.length`) === 1 && run(`db.shifts[0].facility`) === 'Mercer' && run(`db.shifts[0].pay`) === '' && run(`db.shifts[0].incomplete`) === true);
  t('approval message explains rates can be set later on Facilities', lastAlert().includes('No rates for Mercer yet') && lastAlert().includes('Facilities tab'));
  t('the created facility remembers the skip', run(`db.facilities[0].ratesPromptSkipped`) === true);
  run(`schedulePreview = ${JSON.stringify(mkPreview([mkRow({facility:'Mercer', date:'2026-12-08'})]))};`);
  t('a later import for the same facility does not nag', !run(`schedulePreviewHTML().includes('First time at')`));

  // ---------- Case 6: QGenda parity (shared preview + approve) ----------
  run(`db = empty(); db.facilities=[]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({facility:'', source:'qgenda-feed'})], {fileName:'QGenda feed', source:'qgenda-feed'}))}; schedulePreview.facilityAll='CAMC';`);
  t('QGenda preview shows the pay-unit control and the rates prompt', run(`schedulePreviewHTML().includes('previewPayUnit') && schedulePreviewHTML().includes('First time at CAMC')`));
  run(`schedulePreview.ratesDraft={rate8:'2000'}; approveScheduleImport();`);
  t('QGenda shifts price from the entered rates', run(`db.shifts.length`) === 1 && run(`db.shifts[0].pay`) === '2000' && run(`db.facilities[0].rate8`) === '2000');

  // ---------- Case 7: .ics preview parity ----------
  run(`db = empty(); db.facilities=[]; db.shifts=[]; persist();
       calPreview = {fileName:'cal.ics', sourceLabel:'Calendar file', sourceCode:'calendar-file', rows:[{date:'2026-12-07', facility:'CAMC', type:'8-hour day', pay:'', flags:[], include:true, duplicate:false, source:'calendar-file', note:'Imported from Calendar file (.ics): cal.ics'}]};`);
  t('.ics preview shows the pay-unit control and the rates prompt', run(`calPreviewHTML().includes('previewPayUnit') && calPreviewHTML().includes('First time at CAMC')`));
  run(`calPreview.ratesDraft={rate8:'2000'}; approveCalendarImport();`);
  t('.ics approve creates the facility with rates and prices the shift', run(`db.facilities.length`) === 1 && run(`db.facilities[0].rate8`) === '2000' && run(`db.shifts.length`) === 1 && run(`db.shifts[0].pay`) === '2000');

  console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL PASS');
})();
