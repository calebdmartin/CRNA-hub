// CRNA Hub — whose rows are these? One name matcher for every import
// (Nov 10, 2026, v110 — Caleb's requirement).
//
// Caleb: "make sure that if the user enters their full name like
// 'Caleb Martin' but their schedule only shows 'Martin', the app
// recognizes that as the same person. The only snag: multiple
// employees with the same last name — at that point the app should
// ask for clarification."
//
// Pinned here:
//  - the pair matcher accepts "Martin", "C. Martin", "Martin, Caleb",
//    "MARTIN", "Martin C" and "C Martin" against "Caleb Martin"
//    ("Martin C" parsed as surname-first was the gap: the trailing
//    initial used to be taken AS the surname);
//  - (a) Caleb's actual grid shape — a row labelled just "Martin",
//    profile "Caleb Martin" (and profile stored as just "Martin") —
//    imports his Dec 1–5 cells (5**, 5*, 5**, 5*, 7) with NO ask;
//  - (b) "Martin, Caleb" + "Martin, Josh" in one import: the preview
//    asks ONCE, listing the labels; unchosen rows wait unchecked;
//    after the pick, only the chosen person's rows are in, the
//    other's are left out and REPORTED in the preview; the answer
//    is remembered per import source, so the next same import
//    resolves without asking;
//  - (c) QGenda-shaped rows (single assignee "[Martin]") match the
//    full-name profile with no ask;
//  - (d) "C Martin" with no competitor matches silently.
// Audit notes: schedule TEXT imports and photo/grid (AI) reads both
// classify through scheduleNamesMatch + finalizeScheduleNameMatching.
// QGenda's own filtering happens in the feed reader with the profile
// name the app sends (its personal feed carries one assignee); the
// .ics calendar import has no name filtering by design — a calendar
// export is the user's own.
// Run: node test-name-matching.js
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

const GRID = [['2026-12-01', '5**'], ['2026-12-02', '5*'], ['2026-12-03', '5**'], ['2026-12-04', '5*'], ['2026-12-05', '7']];
function gridRead(profile) {
  run(`db=empty();db.settings.scheduleName=${JSON.stringify(profile)};`);
  const shifts = GRID.map(([date, code]) => ({ date, facility: '', type: '', code, name: 'Martin', pay: '' }));
  run(`applyAiToSchedulePreview({shifts:${JSON.stringify(shifts)}},'grid.png')`);
  return run(`({amb:!!schedulePreview.nameAmb,inc:schedulePreview.rows.filter(r=>r.include).length,matched:schedulePreview.rows.filter(r=>r.match==='matched').length,codes:schedulePreview.rows.map(r=>r.code)})`);
}

// ---------- the pair matcher ----------
t('matcher: bare last name matches the full profile', run(`scheduleNamesMatch('Martin','Caleb Martin')`) === true);
t('matcher: "C. Martin" matches', run(`scheduleNamesMatch('C. Martin','Caleb Martin')`) === true);
t('matcher: "Martin, Caleb" matches', run(`scheduleNamesMatch('Martin, Caleb','Caleb Martin')`) === true);
t('matcher: "MARTIN" matches', run(`scheduleNamesMatch('MARTIN','Caleb Martin')`) === true);
t('matcher: "Martin C" matches (surname first, trailing initial)', run(`scheduleNamesMatch('Martin C','Caleb Martin')`) === true);
t('matcher: "C Martin" matches', run(`scheduleNamesMatch('C Martin','Caleb Martin')`) === true);
t('matcher: a different Martin does NOT match', run(`scheduleNamesMatch('Martin, Josh','Caleb Martin')`) === false && run(`scheduleNamesMatch('J. Martin','Caleb Martin')`) === false);

// ---------- (a) Caleb's grid: bare "Martin" row, no ask ----------
const a1 = gridRead('Caleb Martin');
t('(a) grid rows all matched + included under profile "Caleb Martin"', a1.inc === 5 && a1.matched === 5, JSON.stringify(a1));
t('(a) the Dec 1–5 codes survive in order (5**, 5*, 5**, 5*, 7)', JSON.stringify(a1.codes) === JSON.stringify(['5**', '5*', '5**', '5*', '7']));
t('(a) nobody asks anything', a1.amb === false && !run(`schedulePreviewHTML()`).includes('More than one'));
const a2 = gridRead('Martin');
t('(a) profile stored as just "Martin" — same result, no ask', a2.inc === 5 && a2.amb === false);

// ---------- (d) initials, no competitor ----------
run(`db=empty();db.settings.scheduleName='Caleb Martin';`);
const dShifts = [{ date: '2026-12-01', facility: 'HOLZ', type: '8-hour day', code: '', name: 'C Martin', pay: '' }, { date: '2026-12-02', facility: 'HOLZ', type: '8-hour day', code: '', name: 'Martin C', pay: '' }];
run(`applyAiToSchedulePreview({shifts:${JSON.stringify(dShifts)}},'sched.png')`);
t('(d) "C Martin" and "Martin C" both match silently', run(`schedulePreview.rows.every(r=>r.match==='matched'&&r.include)`) === true && run(`!!schedulePreview.nameAmb`) === false);

// ---------- (c) QGenda-shaped: one assignee, "[Martin]" ----------
run(`db=empty();db.settings.scheduleName='Caleb Martin';`);
const qShifts = [{ date: '2026-11-02', facility: 'HOLZ', type: '8-hour day', code: 'HOLZ - G Main (8)', name: 'Martin', pay: '' }, { date: '2026-11-03', facility: 'HOLZ', type: 'Second call', code: 'HOLZ - Call 2', name: 'Martin', pay: '' }];
run(`applyAiToSchedulePreview({shifts:${JSON.stringify(qShifts)}},'QGenda feed')`);
t('(c) single-assignee rows match the full-name profile, no ask', run(`schedulePreview.rows.every(r=>r.match==='matched'&&r.include)`) === true && run(`!!schedulePreview.nameAmb`) === false);

// ---------- (b) two Martins: ask once, remember ----------
const CSV = ['Date,Name,Facility,Shift', '2026-12-01,"Martin, Caleb",HOLZ,8-hour day', '2026-12-02,"Martin, Caleb",HOLZ,8-hour day', '2026-12-01,"Martin, Josh",HOLZ,8-hour day', '2026-12-02,"Martin, Josh",HOLZ,Second call'].join('\n');
run(`db=empty();db.settings.scheduleName='Caleb Martin';`);
run(`schedulePreview=parseScheduleText(${JSON.stringify(CSV)},'staff.csv');`);
const amb = run(`schedulePreview.nameAmb`);
t('(b) ambiguity detected with both labels listed', !!amb && amb.candidates.length === 2 && amb.candidates.some(c => c.label === 'Martin, Caleb') && amb.candidates.some(c => c.label === 'Martin, Josh'), JSON.stringify(amb && amb.candidates));
t('(b) until the user picks, NO same-name row is included (never silently import a namesake)', run(`schedulePreview.rows.every(r=>!r.include)`) === true);
const ambHTML = run(`schedulePreviewHTML()`);
t('(b) the preview asks in words, listing the candidates', ambHTML.includes('More than one Martin on this schedule') && ambHTML.includes('Martin, Caleb') && ambHTML.includes('Martin, Josh') && ambHTML.includes('These are mine — keep going'));
const calebKey = amb.candidates.find(c => c.label === 'Martin, Caleb').key;
run(`schedulePreview.nameAmb.picks=[${JSON.stringify(calebKey)}];db.settings.namePicks=db.settings.namePicks||{};db.settings.namePicks[schedulePreview.nameAmb.memKey]={cands:schedulePreview.nameAmb.candidates.map(c=>c.key).sort(),picks:[${JSON.stringify(calebKey)}]};applyNameAmbiguity(schedulePreview);`);
t('(b) after the pick, only Caleb\u2019s rows are in', run(`schedulePreview.rows.filter(r=>r.include).length`) === 2 && run(`schedulePreview.rows.filter(r=>r.include).every(r=>r.match==='matched')`) === true);
t('(b) Josh\u2019s rows are out, marked other — not deleted, not silent', run(`schedulePreview.rows.filter(r=>!r.include).every(r=>r.match==='other')`) === true);
const ambHTML2 = run(`scheduleNameAmbiguityHTML(schedulePreview)`);
t('(b) left-out rows are reported in the preview', ambHTML2.includes('2 rows under a similar name (Martin, Josh) were left out'), ambHTML2.slice(-260));
run(`schedulePreview=parseScheduleText(${JSON.stringify(CSV)},'staff.csv');`);
t('(b) remembered: the same import again resolves WITHOUT waiting', run(`!!schedulePreview.nameAmb && !!schedulePreview.nameAmb.picks`) === true && run(`schedulePreview.rows.filter(r=>r.include).length`) === 2 && run(`schedulePreview.rows.filter(r=>r.include).every(r=>r.match==='matched')`) === true);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
