// CRNA Hub — day sheet vs. uploaded shifts (Nov 7, 2026 bug report).
// Caleb: "I added a CAMC schedule and it added the days to the calendar
// with the shifts but when I click on the day to edit the shift it
// doesn't show me the CAMC shift. Only the Holzer shift."
//
// Root cause: a GRID schedule (names x dates, the CAMC shape) prints no
// facility, and the AI grid read returns facility:null BY DESIGN — so
// the imported shifts saved with facility ''. Everywhere a shift is
// labelled by its facility they degraded: the calendar chip fell back
// to "Off" (reads as a day off, not a worked shift) and the day-sheet
// row title was BLANK. Sitting next to a clearly labelled Holzer shift,
// the uploaded shift was effectively invisible — "only the Holzer
// shift" is what the sheet appeared to show. The day sheet's date
// filter itself was never different from the calendar's.
//
// Fix (shared seam, no CAMC special-case):
//   * one shiftsOnDay() selection used by BOTH the calendar grid and
//     the day sheet — they can never disagree about a day's shifts;
//   * one shiftFacilityLabel() used by the calendar chip, the day
//     sheet title, the delete sheet and the Upcoming list: the saved
//     facility name, "Off" only for an actual Off/PTO shift, otherwise
//     "No facility yet" — never a blank title, never a false "Off";
//   * the schedule preview gains ONE schedule-level facility field
//     ("Which facility is this schedule for?") shown whenever a row
//     lacks a facility; on approve it fills exactly those rows, so a
//     grid upload for CAMC lands AS CAMC shifts.
//
// Cleanup path (same report): an uploaded shift deletes from the day
// sheet with NO calendar-removal checkbox (it never came from a
// calendar — no source event exists), and the delete tombstones it so
// the next cloud merge cannot resurrect it.
// Run: node test-daysheet-upload-shifts.js
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
const appHTML = () => elements['app'].innerHTML;
const daySheet = () => { const h = appHTML(); const i = h.indexOf('id="day-view"'); return i >= 0 ? h.slice(i, i + 30000) : ''; };
const dayButton = (date) => { const h = appHTML(); const i = h.indexOf('data-date="' + date + '"'); return i >= 0 ? h.slice(Math.max(0, i - 200), i + 4000) : ''; };

// ---------- Fixture: Caleb-shaped data ----------
// Holzer saved under its full name with the short alias (his real
// record); CAMC saved with his real rates (no call taken there).
run(`
  db.facilities = [
    {id:'f1', name:'Holzer Gallipolis', aliases:'Holzer', address:'100 Jackson Pike, Gallipolis, OH 45631', hourlyRate:'250', paidHours8:'8.5', rate8:'2125', rateSecond:'3000', weekendRateSecond:'2000', rate24:'4800'},
    {id:'f2', name:'CAMC', address:'3200 MacCorkle Ave SE, Charleston, WV 25304', hourlyRate:'250', rate8:'2000', rate10:'2500', rate12:'3000'}
  ];
  db.settings.scheduleName = 'Martin';
  db.shifts = [];
  // His Holzer shift that Apple sync imported for Mon Dec 7, 2026.
  addShiftDeduped({id:'hz-dec7', date:'2026-12-07', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed', source:'apple-import', sources:['apple-import'], note:'Imported from Caleb Work Schedule', updatedAt:'2026-11-07T12:00:00.000Z'});
  persist();
`);

// ---------- Part 1: the report — a CAMC GRID upload (facility-less rows) ----------
run(`
  applyAiToSchedulePreview({ok:true, mode:'schedule', shifts:[
    {date:'2026-12-07', facility:'', code:'OR1', type:'', name:'Martin', pay:''},
    {date:'2026-12-09', facility:'', code:'OR2', type:'', name:'Martin', pay:''}
  ]}, 'camc-december-grid.jpg');
`);
t('grid preview offers one schedule-level facility field', appHTML().includes('schedFacilityAll') || run(`schedulePreviewHTML().includes('schedFacilityAll')`));
// Approve WITHOUT naming the facility (the path Caleb took).
run(`approveScheduleImport()`);
t('grid upload saved both shifts', run(`db.shifts.filter(x=>x.source==='schedule-import-ai').length`) === 2);
t('grid shifts saved facility-less (grid prints none)', run(`db.shifts.filter(x=>x.source==='schedule-import-ai').every(x=>x.facility==='')`));

run(`month = new Date(2026, 11, 1); render();`);
t('calendar counts 2 shifts on Dec 7', dayButton('2026-12-07').includes('2 shifts'));
t('calendar chip for the uploaded shift does NOT call it "Off"', !/chip[^>]*>Off<br>/.test(dayButton('2026-12-07')));
t('calendar chip labels the uploaded shift "No facility yet"', dayButton('2026-12-07').includes('No facility yet'));

run(`selectDay('2026-12-07'); render();`);
let sheet = daySheet();
t('day sheet Dec 7 lists BOTH shifts (2 Edit buttons)', (sheet.match(/data-action="edit-shifts"/g) || []).length === 2);
t('day sheet shows the Holzer shift', sheet.includes('Holzer'));
t('day sheet titles the uploaded shift "No facility yet" (never blank)', sheet.includes('No facility yet'));
t('day sheet still shows its code + unpriced state', sheet.includes('OR1') && sheet.includes('Pay not yet priced'));

run(`selectDay('2026-12-09'); render();`);
sheet = daySheet();
t('day sheet Dec 9 (uploaded shift alone) lists it', (sheet.match(/data-action="edit-shifts"/g) || []).length === 1 && sheet.includes('No facility yet') && !sheet.includes('No shifts on this day'));

// ---------- Part 2: cleanup — deleting an uploaded shift ----------
// No calendar-removal checkbox may be offered: an upload has no source
// calendar event. The delete tombstones it against cloud resurrection.
const upId = run(`db.shifts.find(x=>x.source==='schedule-import-ai' && x.date==='2026-12-09').id`);
run(`selectDay('2026-12-09'); actions('delete-shifts', ${JSON.stringify(upId)}, '', ''); render();`);
t('delete sheet opens for the uploaded shift', appHTML().includes('Delete this shift?'));
t('delete sheet offers NO calendar-removal checkbox for an upload', !appHTML().includes('f_deleteAlsoFromCalendar'));
t('delete sheet uses the no-calendar wording', appHTML().includes('Deleting removes it here and from your CRNA Hub calendar right away.'));
run(`actions('shift-delete-confirm', ${JSON.stringify(upId)}, '', '');`);
t('uploaded shift deleted', run(`!db.shifts.some(x=>x.id===${JSON.stringify(upId)})`));
t('cloud merge cannot resurrect the deleted upload shift',
  run(`cloudMergeSyncedList(db.shifts, [{id:${JSON.stringify(upId)}, date:'2026-12-09', facility:'', type:'OR2', pay:'', status:'confirmed', source:'schedule-import-ai', updatedAt:'2026-11-07T13:00:00.000Z'}], 'shifts').some(x=>x.id===${JSON.stringify(upId)})`) === false);
// Remove the Dec 7 grid shift too, so Part 3 starts clean.
const upId7 = run(`db.shifts.find(x=>x.source==='schedule-import-ai' && x.date==='2026-12-07').id`);
run(`selectDay('2026-12-07'); actions('delete-shifts', ${JSON.stringify(upId7)}, '', ''); actions('shift-delete-confirm', ${JSON.stringify(upId7)}, '', '');`);
t('second uploaded shift deleted the same way', run(`!db.shifts.some(x=>x.source==='schedule-import-ai')`));

// ---------- Part 3: naming the facility in the preview lands real CAMC shifts ----------
run(`
  applyAiToSchedulePreview({ok:true, mode:'schedule', shifts:[
    {date:'2026-12-07', facility:'', code:'OR1', type:'', name:'Martin', pay:''},
    {date:'2026-12-09', facility:'', code:'OR2', type:'', name:'Martin', pay:''}
  ]}, 'camc-december-grid.jpg');
  schedulePreview.facilityAll = 'CAMC';
  approveScheduleImport();
`);
t('schedule-level facility filled the grid rows', run(`db.shifts.filter(x=>x.source==='schedule-import-ai').every(x=>x.facility==='CAMC')`));
run(`month = new Date(2026, 11, 1); selectDay('2026-12-07'); render();`);
sheet = daySheet();
t('day sheet Dec 7 now titles the uploaded shift CAMC', sheet.includes('>CAMC<') || sheet.includes('CAMC'));
t('day sheet Dec 7 lists both shifts again', (sheet.match(/data-action="edit-shifts"/g) || []).length === 2);
t('calendar chip names CAMC (not "No facility yet", not "Off")', dayButton('2026-12-07').includes('CAMC') && !dayButton('2026-12-07').includes('No facility yet'));

// ---------- Part 4: a named-facility upload (the literal fixture) ----------
// CSV rows that DO carry the facility: same-day Holzer + CAMC, and a
// CAMC-only day. Both must list, each opening its OWN editor.
run(`
  schedulePreview = { fileName:'camc-list.csv', source:'schedule-import', matchedName:'Martin', rows:[
    {date:'2026-12-07', facility:'CAMC', type:'8-hour day', pay:'', include:true, match:'matched', source:'schedule-import'},
    {date:'2026-12-10', facility:'CAMC', type:'12-hour shift', pay:'', include:true, match:'matched', source:'schedule-import'}
  ]};
  approveScheduleImport();
`);
const camcId = run(`db.shifts.find(x=>x.facility==='CAMC' && x.type==='8-hour day' && x.date==='2026-12-07').id`);
t('named CAMC upload priced from the CAMC rule ($2,000)', run(`db.shifts.find(x=>x.id===${JSON.stringify(camcId)}).pay`) === '2000');
run(`selectDay('2026-12-07'); render();`);
sheet = daySheet();
t('day sheet Dec 7 lists Holzer AND CAMC', sheet.includes('Holzer') && sheet.includes('CAMC') && (sheet.match(/data-action="edit-shifts"/g) || []).length === 3);
run(`actions('edit-shifts', ${JSON.stringify(camcId)}, '', ''); render();`);
t('editing the CAMC shift opens ITS editor (facility CAMC, its date)', appHTML().includes('value="CAMC"') && appHTML().includes('value="2026-12-07"'));
run(`actions('cancel', '', '', ''); selectDay('2026-12-10'); render();`);
sheet = daySheet();
t('day sheet Dec 10 (CAMC only) lists the CAMC shift', sheet.includes('CAMC') && (sheet.match(/data-action="edit-shifts"/g) || []).length === 1);

console.log(fails ? ('FAILURES: ' + fails) : 'ALL PASS');
