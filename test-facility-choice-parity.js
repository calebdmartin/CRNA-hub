// CRNA Hub — facility-choice parity for imports (Nov 7, 2026).
//
// Caleb, after the CAMC day-sheet fix (d24af163): "We will probably
// need that for Qgenda and the contract upload." The guarantee being
// extended: no import path may save a shift with an unresolved
// facility without asking the user ONCE in the preview.
//
// Investigation results this suite pins:
//   * SCHEDULE UPLOAD (already built in d24af163): the "Which facility
//     is this schedule for?" field filled only BLANK rows. Extended
//     here: a row whose facility names no saved facility is equally
//     unresolved, so the field now appears for it too and the answer
//     applies to it. Resolved rows (name/alias match) always win, and
//     a facility the user hand-types into a row is never overridden.
//   * QGENDA: rows arrive through the SHARED schedule preview
//     (fetchQgendaFeed -> schedulePreview -> approveScheduleImport), so
//     the same field/logic covers both the manual fetch and the boot
//     check. The server parser (qgenda-feed/parse.ts over the shared
//     calendar.ts) returns facilityKnown:false + pay:'' for unmatched
//     facilities — before this build those rows saved under the raw
//     feed string, unpriced, with only a post-hoc Dashboard
//     suggestion. Now the preview asks first.
//   * CONTRACT UPLOAD: the preview forces a typed name and approval
//     only creates/updates FACILITIES (contract-derived shifts arrive
//     via schedule upload and carry that facility — every artifact is
//     forced). The one silent decision was CREATE-vs-UPDATE: a name
//     matching nothing saved silently created a new facility.
//     approveFacilityContract now stops the first save and the preview
//     asks the user to confirm creating it (or fix the name / add an
//     alias so it updates a saved facility instead).
// Run: node test-facility-choice-parity.js
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
const drain = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

(async () => {
  // ---------- Fixture: Caleb-shaped saved facilities ----------
  // Holzer under its full name + short alias; CAMC with his real rates.
  run(`
    db.facilities = [
      {id:'f1', name:'Holzer Gallipolis', aliases:'Holzer', address:'100 Jackson Pike, Gallipolis, OH 45631', hourlyRate:'250', paidHours8:'8.5', rate8:'2125', rateSecond:'3000', weekendRateSecond:'2000', rate24:'4800'},
      {id:'f2', name:'CAMC', address:'3200 MacCorkle Ave SE, Charleston, WV 25304', hourlyRate:'250', rate8:'2000', rate10:'2500', rate12:'3000'}
    ];
    db.settings.scheduleName = 'Martin';
    db.shifts = [];
    persist();
  `);

  // ---------- Part 1: schedule upload with an UNRESOLVED (non-blank) facility name ----------
  // Before this build the choice field appeared only for blank rows;
  // a row naming an unsaved facility saved under that raw string.
  run(`
    schedulePreview = { fileName:'other-hospital.csv', source:'schedule-import', matchedName:'Martin', rows:[
      {date:'2026-12-14', facility:'Mercer Medical', type:'8-hour day', pay:'', include:true, match:'matched', source:'schedule-import', flags:['new facility — will be suggested, not created']},
      {date:'2026-12-15', facility:'CAMC', type:'8-hour day', pay:'', include:true, match:'matched', source:'schedule-import', flags:[]}
    ]};
    render();
  `);
  t('unresolved (non-blank) facility row surfaces the one facility choice',
    run(`schedulePreviewHTML().includes('schedFacilityAll') && schedulePreviewHTML().includes('Which facility is this schedule for?')`));
  run(`schedulePreview.facilityAll = 'CAMC'; approveScheduleImport();`);
  t('the choice applies to the unresolved row and it lands priced',
    run(`db.shifts.find(x=>x.date==='2026-12-14').facility`) === 'CAMC' &&
    run(`db.shifts.find(x=>x.date==='2026-12-14').pay`) === '2000');
  t('the resolved row keeps its own facility (its choice always wins)',
    run(`db.shifts.find(x=>x.date==='2026-12-15').facility`) === 'CAMC');

  // ---------- Part 2: the choice must NOT override a resolved row ----------
  run(`
    schedulePreview = { fileName:'mixed.csv', source:'schedule-import', matchedName:'Martin', rows:[
      {date:'2026-12-16', facility:'Mercer Medical', type:'8-hour day', pay:'', include:true, match:'matched', source:'schedule-import', flags:[]},
      {date:'2026-12-17', facility:'Holzer', type:'8-hour day', pay:'', include:true, match:'matched', source:'schedule-import', flags:[]}
    ]};
    schedulePreview.facilityAll = 'CAMC';
    approveScheduleImport();
  `);
  t('unresolved row took the chosen facility',
    run(`db.shifts.find(x=>x.date==='2026-12-16').facility`) === 'CAMC');
  t('resolved Holzer row was NOT overridden by the choice',
    run(`db.shifts.find(x=>x.date==='2026-12-17').facility`) === 'Holzer' &&
    run(`db.shifts.find(x=>x.date==='2026-12-17').pay`) === '2125');

  // ---------- Part 3: a hand-typed row facility is the user's answer ----------
  run(`
    schedulePreview = { fileName:'typed.csv', source:'schedule-import', matchedName:'Martin', rows:[
      {date:'2026-12-18', facility:'Mercer Medical', type:'8-hour day', pay:'', include:true, match:'matched', source:'schedule-import', flags:[], _userTypedFacility:true},
      {date:'2026-12-19', facility:'', type:'8-hour day', pay:'', include:true, match:'matched', source:'schedule-import', flags:[]}
    ]};
    schedulePreview.facilityAll = 'CAMC';
    approveScheduleImport();
  `);
  t('hand-typed row facility is left alone by the schedule-level choice',
    run(`db.shifts.find(x=>x.date==='2026-12-18').facility`) === 'Mercer Medical');
  t('blank row in the same preview still takes the choice',
    run(`db.shifts.find(x=>x.date==='2026-12-19').facility`) === 'CAMC');

  // ---------- Part 4: fully-resolved previews are unchanged ----------
  run(`
    schedulePreview = { fileName:'clean.csv', source:'schedule-import', matchedName:'Martin', rows:[
      {date:'2026-12-21', facility:'Holzer', type:'8-hour day', pay:'', include:true, match:'matched', source:'schedule-import', flags:[]}
    ]};
  `);
  t('a fully-resolved preview shows NO facility choice field',
    !run(`schedulePreviewHTML().includes('schedFacilityAll')`));
  run(`approveScheduleImport();`);
  t('resolved import saves exactly as before',
    run(`db.shifts.find(x=>x.date==='2026-12-21').facility`) === 'Holzer' &&
    run(`db.shifts.find(x=>x.date==='2026-12-21').pay`) === '2125');

  // ---------- Part 5: QGenda rows (the shared preview) ----------
  // Rows in the exact shape fetchQgendaFeed builds from the server
  // payload: a known facility arrives under its canonical saved name
  // with pay; an unknown one arrives as the raw feed string, pay
  // blank, flagged. The preview must ask before saving the unknown.
  run(`
    schedulePreview = { fileName:'QGenda feed', source:'qgenda-feed', matchedName:'Martin', noNamesInFile:false, ai:false, rows:[
      {date:'2026-12-22', facility:'Holzer Gallipolis', type:'8-hour day', pay:'2125', name:'Martin', matchedName:'Martin', match:'matched', include:true, duplicate:false, flags:[], source:'qgenda-feed', incomplete:false},
      {date:'2026-12-23', facility:'Mercer Medical Center', type:'8-hour day', pay:'', name:'Martin', matchedName:'Martin', match:'matched', include:true, duplicate:false, flags:['new facility — will be suggested, not created'], source:'qgenda-feed', incomplete:true}
    ]};
    render();
  `);
  t('QGenda preview with an unresolved row surfaces the facility choice',
    run(`schedulePreviewHTML().includes('schedFacilityAll')`));
  run(`schedulePreview.facilityAll = 'CAMC'; approveScheduleImport();`);
  t('QGenda unknown-facility row lands under the chosen facility, priced',
    run(`db.shifts.find(x=>x.date==='2026-12-23').facility`) === 'CAMC' &&
    run(`db.shifts.find(x=>x.date==='2026-12-23').pay`) === '2000');
  t('QGenda known-facility row untouched by the choice',
    run(`db.shifts.find(x=>x.date==='2026-12-22').facility`) === 'Holzer Gallipolis' &&
    run(`db.shifts.find(x=>x.date==='2026-12-22').pay`) === '2125');

  // ---------- Part 6: contract approval — create must be confirmed ----------
  const before6 = run(`db.facilities.length`);
  run(`
    facilityContractPreview = { fileName:'mercer.pdf', isPhoto:false, contract:{id:'ct-m', facility:'Mercer Medical', rates:{rate8:'2100'}}, facilities:[{include:true, name:'Mercer Medical', aliases:'', address:'', effectiveStart:'', effectiveEnd:'', rates:{rate8:'2100', hourlyRate:'250'}, found:[], missing:[], unreadable:[]}] };
    facilityContractPendingImages = [];
  `);
  await run(`approveFacilityContract()`);
  await drain();
  t('first save of an unmatched contract name creates NOTHING yet',
    run(`db.facilities.length`) === before6 && run(`facilityContractPreview !== null`));
  t('the preview now asks the user to confirm creating the new facility',
    run(`facilityContractPreviewHTML().includes('New facility — not one of your saved facilities') && facilityContractPreviewHTML().includes('Yes — create the new facility and save')`));
  await run(`approveFacilityContract()`);
  await drain();
  t('confirming creates the facility with the contract rates',
    run(`(db.facilities||[]).some(f=>f.name==='Mercer Medical' && f.rate8==='2100')`));

  // ---------- Part 7: contract for a SAVED facility — no confirmation, unchanged ----------
  run(`
    facilityContractPreview = { fileName:'camc2.pdf', isPhoto:false, contract:{id:'ct-c', facility:'CAMC', rates:{rate8:'2000'}}, facilities:[{include:true, name:'CAMC', aliases:'', address:'', effectiveStart:'', effectiveEnd:'', rates:{rate8:'2000'}, found:[], missing:[], unreadable:[]}] };
    facilityContractPendingImages = [];
  `);
  const camcBefore = run(`db.facilities.find(f=>f.name==='CAMC').ratesSourceFile || ''`);
  await run(`approveFacilityContract()`);
  await drain();
  t('contract naming a saved facility saves in one step (no create-confirmation)',
    run(`facilityContractPreview === null`) === true &&
    run(`db.facilities.filter(f=>f.name==='CAMC').length`) === 1);

  // ---------- Part 8: contract name fixed via alias matches the saved facility ----------
  // The confirmation block tells the user: add the short name under
  // aliases and it will UPDATE that facility instead of creating one.
  run(`
    facilityContractPreview = { fileName:'charleston.pdf', isPhoto:false, contract:{id:'ct-ch', facility:'Charleston Area Medical Center', rates:{rate8:'2000'}}, facilities:[{include:true, name:'Charleston Area Medical Center', aliases:'CAMC', address:'', effectiveStart:'', effectiveEnd:'', rates:{rate8:'2000'}, found:[], missing:[], unreadable:[]}] };
    facilityContractPendingImages = [];
  `);
  const countBefore8 = run(`(db.facilities||[]).length`);
  await run(`approveFacilityContract()`);
  await drain();
  t('contract whose alias matches a saved facility updates it — no duplicate facility, no confirmation stall',
    run(`facilityContractPreview === null`) === true &&
    run(`(db.facilities||[]).length`) === countBefore8 &&
    run(`facilityByNameOrAlias('Charleston Area Medical Center').id`) === 'f2');

  console.log(fails ? ('FAILURES: ' + fails) : 'ALL PASS');
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exitCode = 1; });
