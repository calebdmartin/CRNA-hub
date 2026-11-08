// CRNA Hub — facility prompt on a FRESH device (Nov 7, 2026, late).
//
// Caleb, minutes after clearing his device and starting fresh:
// "The upload a schedule didn't prompt me to add a facility during
// the upload." On a fresh account he has NO saved facilities, so
// every uploaded row is definitionally unresolved — the "Which
// facility is this schedule for?" field should have appeared. It
// didn't. Root cause, verified against the pre-fix code: the
// question was gated on rows already INCLUDED
// (schedulePreviewNeedsFacility checked r.include), and whole
// classes of fresh-state rows arrive unchecked:
//   * AI reads whose rows carry no name (screenshots / personal
//     exports) sat 'uncertain' — applyAiToSchedulePreview lacked
//     the no-names fix-up parseScheduleText always had.
//   * Reads whose printed name could not be matched because the
//     fresh account had no schedule name saved yet also sat
//     'uncertain'/unchecked, so the question never rendered — and
//     the checkbox handler does not re-render, so checking the
//     rows never brought it back either.
//   * The .ics preview had no facility field at all.
// And when the field WAS answered with a brand-new name, approve
// only recorded a Dashboard suggestion — the facility was never
// created, so on a fresh device the shifts pointed at nothing.
// Fixes pinned here: the question keys off includable rows
// (match !== 'other'), nameless AI reads are treated as the user's
// own schedule, a name cannot be classified 'other' while no
// schedule name is on file, the .ics preview carries the same
// field, and approving with a new name CREATES the facility.
// Run: node test-facility-prompt-fresh.js
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
  // ---------- Case 1: fresh device + GRID photo read (Caleb's shape) ----------
  run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = []; db.shifts = []; persist();`);
  t('fresh fixture really has zero facilities', run(`db.facilities.length`) === 0);
  run(`applyAiToSchedulePreview({ok:true, mode:'schedule', shifts:[
    {date:'2026-12-01', code:'5**', type:null, facility:null, name:'Martin'},
    {date:'2026-12-02', code:'5*', type:null, facility:null, name:'Martin'},
    {date:'2026-12-03', code:'7', type:null, facility:null, name:'Martin'}
  ]}, 'grid.jpg'); render();`);
  t('grid preview on a fresh device shows the facility question',
    run(`schedulePreviewHTML().includes('schedFacilityAll') && schedulePreviewHTML().includes('Which facility is this schedule for?')`));
  run(`schedulePreview.facilityAll = 'CAMC'; approveScheduleImport();`);
  t('approving with a typed name CREATES the facility',
    run(`(db.facilities||[]).some(f=>f.name==='CAMC')`));
  t('the shifts land under that facility name',
    run(`db.shifts.length`) === 3 && run(`db.shifts.every(x=>x.facility==='CAMC')`));
  t('no duplicate Dashboard suggestion for the just-created facility',
    run(`(db.facilitySuggestions||[]).filter(x=>x.name==='CAMC').length`) === 0);

  // ---------- Case 2: fresh device, schedule name never saved ----------
  run(`db = empty(); db.settings.scheduleName = ''; db.facilities = []; db.shifts = []; persist();`);
  run(`applyAiToSchedulePreview({ok:true, mode:'schedule', shifts:[
    {date:'2026-12-01', code:'5**', type:null, facility:null, name:'Martin'},
    {date:'2026-12-02', code:'5*', type:null, facility:null, name:'Martin'}
  ]}, 'grid.jpg'); render();`);
  t('rows stay unchecked when no schedule name is on file (nothing auto-included)',
    run(`schedulePreview.rows.every(r=>r.include===false && r.match==='uncertain')`));
  t('…but the facility question STILL shows',
    run(`schedulePreviewHTML().includes('schedFacilityAll')`));
  run(`schedulePreview.rows.forEach(r=>r.include=true); schedulePreview.facilityAll = 'Holzer'; approveScheduleImport();`);
  t('after the user checks the rows and names the facility, shifts land named + facility created',
    run(`db.shifts.length`) === 2 && run(`db.shifts.every(x=>x.facility==='Holzer')`) && run(`(db.facilities||[]).some(f=>f.name==='Holzer')`));

  // ---------- Case 3: nameless AI read = the user's own schedule ----------
  run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = []; db.shifts = []; persist();`);
  run(`applyAiToSchedulePreview({ok:true, mode:'schedule', shifts:[
    {date:'2026-12-04', type:'8-hour day', facility:'', name:''},
    {date:'2026-12-05', type:'8-hour day', facility:'', name:''}
  ]}, 'screenshot.png'); render();`);
  t('a nameless read is treated as the user\'s own schedule (matched + included)',
    run(`schedulePreview.rows.every(r=>r.match==='matched' && r.include===true)`) && run(`schedulePreview.noNamesInFile`) === true);
  t('…and the facility question shows for it',
    run(`schedulePreviewHTML().includes('schedFacilityAll')`));

  // ---------- Case 4: text schedule naming an unsaved hospital; user picks a saved one ----------
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [{id:'f2', name:'CAMC', aliases:'', address:'3200 MacCorkle Ave SE, Charleston, WV 25304', hourlyRate:'250', rate8:'2000', rate10:'2500', rate12:'3000'}];
    db.shifts = []; persist();`);
  run(`schedulePreview = parseScheduleText('Date,Name,Facility,Shift\\n2026-12-07,Martin,Mercer Medical,8-hour day', 'sched.csv'); render();`);
  t('text rows naming an unsaved hospital surface the question',
    run(`schedulePreviewHTML().includes('schedFacilityAll')`));
  run(`schedulePreview.facilityAll = 'CAMC'; approveScheduleImport();`);
  t('choosing the saved facility lands the shift named and PRICED from its rates',
    run(`db.shifts.find(x=>x.date==='2026-12-07').facility`) === 'CAMC' &&
    run(`db.shifts.find(x=>x.date==='2026-12-07').pay`) === '2000');
  t('picking a saved facility creates no duplicate facility',
    run(`db.facilities.length`) === 1);

  // ---------- Case 5: staff text schedule while no schedule name is on file ----------
  run(`db = empty(); db.settings.scheduleName = ''; db.facilities = []; db.shifts = []; persist();`);
  run(`schedulePreview = parseScheduleText('Date,Name,Facility,Shift\\n2026-12-08,Martin,,8-hour day\\n2026-12-09,Smith,,8-hour day', 'staff.csv'); render();`);
  t('a found name is never labelled someone else\'s while the user\'s name is unknown',
    run(`schedulePreview.rows.every(r=>r.match==='uncertain')`));
  t('a staff list is NOT silently treated as a personal export',
    run(`schedulePreview.noNamesInFile`) === false && run(`schedulePreview.rows.every(r=>r.include===false)`));
  t('…and the facility question still shows',
    run(`schedulePreviewHTML().includes('schedFacilityAll')`));

  // ---------- Case 6: fully-resolved preview unchanged ----------
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [{id:'f2', name:'CAMC', aliases:'', hourlyRate:'250', rate8:'2000'}];
    db.shifts = []; persist();`);
  run(`schedulePreview = { fileName:'clean.csv', source:'schedule-import', matchedName:'Martin', rows:[
    {date:'2026-12-10', facility:'CAMC', type:'8-hour day', pay:'', include:true, match:'matched', source:'schedule-import', flags:[]}
  ]};`);
  t('a fully-resolved preview shows NO facility question (unchanged)',
    !run(`schedulePreviewHTML().includes('schedFacilityAll')`));
  run(`schedulePreview = { fileName:'others.csv', source:'schedule-import', matchedName:'Martin', rows:[
    {date:'2026-12-10', facility:'', type:'8-hour day', pay:'', include:false, match:'other', source:'schedule-import', flags:[]}
  ]};`);
  t('someone else\'s unresolved rows alone never trigger the question',
    !run(`schedulePreviewHTML().includes('schedFacilityAll')`));

  // ---------- Case 7: .ics preview carries the same question ----------
  run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = []; db.shifts = []; persist();`);
  run(`calPreview = {fileName:'cal.ics', sourceLabel:'Apple Calendar', sourceCode:'calendar-file', rows:[
    {date:'2026-12-11', facility:'', type:'8-hour day', pay:'', include:true, duplicate:false, flags:['unknown facility'], source:'apple-calendar'}
  ]};`);
  t('.ics preview with a blank facility shows the facility question',
    run(`calPreviewHTML().includes('calFacilityAll') && calPreviewHTML().includes('Which facility is this schedule for?')`));
  const alertsBefore = alerts.length;
  run(`calPreview.facilityAll = 'CAMC'; approveCalendarImport();`);
  t('.ics approve fills the facility, saves the shift, and creates the facility',
    run(`db.shifts.length`) === 1 && run(`db.shifts[0].facility`) === 'CAMC' && run(`(db.facilities||[]).some(f=>f.name==='CAMC')`));
  t('.ics approve was not blocked by the missing facility',
    !alerts.slice(alertsBefore).some(a => a.includes('Fix or uncheck')));

  console.log(fails ? ('FAILURES: ' + fails) : 'ALL PASS');
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exitCode = 1; });
