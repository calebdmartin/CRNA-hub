// CRNA Hub — grid schedule READ RELIABILITY tests (Nov 6, 2026,
// branch muse/credentialing). Run: node test-schedule-grid-reliability.js
//
// Caleb ran the SAME grid photo three times live and got three
// different answers: incorrect dates twice, "no shifts identified"
// once. Reproduced against the live function before this fix
// (temperature was never sent, so the API default 1.0 applied):
//   run 1: Nov 23/24 "endo 3" (Mitchell's row, bled upward), Nov 29
//          "7", Dec 1 "5*", Dec 2 "5**", Dec 3 "5" — dates drifted
//          a column off the true codes.
//   run 2: Nov 23/24 "endo 3", Nov 27 "5", Nov 28 "7", Nov 29 "5".
//   run 3: Nov 23/24 "endo 3", Nov 25 "7".
// Truth (verified by eye on the fixture): Martin row = Dec 1 `5**`,
// Dec 2 `5*`, Dec 3 `5**`, Dec 4 `5*`, Dec 5 `7`, all else blank.
//
// The hardening, in three layers:
//  1. Server pins temperature 0 + a fixed seed (transcription is not
//     a creative task) — asserted against the function source here;
//     the anchoring normalizer is asserted too (it is TypeScript and
//     exercised live, not from Node).
//  2. Date anchoring: the grid prompt returns header_dates + a
//     1-based column per cell, and normalizeAiScheduleRead re-derives
//     each cell's date from header_dates[column-1] — asserted in the
//     normalize.ts source, verified live after deploy.
//  3. Client consistency protocol (exercised here with stubbed model
//     responses): a grid is read TWICE and reconciled — agreement is
//     clean, disagreement / single-read cells are flagged
//     "check this one", both-reads-empty with a visible grid header
//     is an honest couldn't-read, and the same pair of reads yields
//     the identical preview every time.
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
    getElementById: (id) => elements[id] || (elements[id] = el()),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({ ok: true }) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

// ---------- Layer 1+2: server source assertions ----------
const fnSrc = fs.readFileSync(R + 'supabase' + path.sep + 'functions' + path.sep + 'extract-contract' + path.sep + 'index.ts', 'utf8');
const normSrc = fs.readFileSync(R + 'supabase' + path.sep + 'functions' + path.sep + 'extract-contract' + path.sep + 'normalize.ts', 'utf8');
t('server: extraction temperature pinned to 0 (was unset = API default 1.0)',
  fnSrc.includes('temperature: 0'));
t('server: fixed seed sent with the read',
  /seed:\s*\d+/.test(fnSrc));
t('server: grid prompt asks for header_dates and a per-cell column',
  fnSrc.includes('header_dates') && fnSrc.includes('column = the cell'));
t('server: grid prompt orders header-first, row-band discipline, recheck',
  fnSrc.includes('STEP 1') && fnSrc.includes('STEP 2') && fnSrc.includes('STEP 3'));
t('normalizer: normalizeAiScheduleRead anchors grid dates to header_dates[column-1]',
  normSrc.includes('normalizeAiScheduleRead') && normSrc.includes('headerDates[column - 1]'));
t('normalizer: schedule response carries header_dates back to the client',
  fnSrc.includes('header_dates: read.headerDates'));

// ---------- Layer 3: reconciliation units ----------
const Y = new Date().getFullYear();
const HEADER = ['23-Nov','24-Nov','25-Nov','26-Nov','27-Nov','28-Nov','29-Nov','30-Nov','1-Dec','2-Dec','3-Dec','4-Dec','5-Dec','6-Dec']
  .map(s => { const [d, m] = s.split('-'); return `${Y}-${m === 'Nov' ? '11' : '12'}-${d.padStart(2, '0')}`; });
const cell = (column, date, code, extra) => Object.assign(
  { date, facility: '', type: code, code, name: 'Martin', pay: '', column, anchored: true }, extra || {});
const READ_A = { ok: true, mode: 'schedule', header_dates: HEADER, shifts: [
  cell(9, `${Y}-12-01`, '5**'), cell(10, `${Y}-12-02`, '5*'), cell(11, `${Y}-12-03`, '5**'),
  cell(12, `${Y}-12-04`, '5*'), cell(13, `${Y}-12-05`, '7'),
] };
run(`db.settings.scheduleName='Martin'; db.shifts=[]; db.facilities=[];`);

const recAgree = run(`reconcileGridReads(${JSON.stringify(READ_A)}, ${JSON.stringify(READ_A)})`);
t('reconcile: two agreeing reads -> 5 solid cells, none flagged',
  recAgree.shifts.length === 5 && recAgree.shifts.every(s => !s.check) && recAgree.gridSeen === true);
t('reconcile: agreed cells are the true Martin row (dates + codes verbatim)',
  recAgree.shifts.map(s => s.date.slice(5) + ' ' + s.code).join('|') === '12-01 5**|12-02 5*|12-03 5**|12-04 5*|12-05 7');

const READ_B = { ok: true, mode: 'schedule', header_dates: HEADER, shifts: [
  cell(9, `${Y}-12-01`, '5**'), cell(10, `${Y}-12-02`, '5*'), cell(11, `${Y}-12-03`, '5*'), // code differs
  cell(12, `${Y}-12-04`, '5*'), cell(14, `${Y}-12-06`, '3'), // Dec 5 missed, Dec 6 invented
] };
const recDis = run(`reconcileGridReads(${JSON.stringify(READ_A)}, ${JSON.stringify(READ_B)})`);
const byCol = (rec, c) => rec.shifts.find(s => s.column === c);
t('reconcile: disagreement keeps ONE row per cell (union, no doubles)',
  recDis.shifts.length === 6);
t('reconcile: differing code flagged "check this one — disagreed on this cell", first read kept',
  byCol(recDis, 11).check === true && byCol(recDis, 11).code === '5**' &&
  byCol(recDis, 11).checkReason.includes('disagreed on this cell'));
t('reconcile: cell only in read 1 flagged "only one of the two reads saw this cell"',
  byCol(recDis, 13).check === true && byCol(recDis, 13).checkReason.includes('only one of the two reads'));
t('reconcile: cell only in read 2 flagged the same way',
  byCol(recDis, 14).check === true && byCol(recDis, 14).checkReason.includes('only one of the two reads'));
t('reconcile: agreed cells stay clean in a mixed read',
  byCol(recDis, 9).check === undefined && byCol(recDis, 10).check === undefined && byCol(recDis, 12).check === undefined);

const READ_C = { ok: true, mode: 'schedule', header_dates: HEADER, shifts: [
  cell(9, `${Y}-11-30`, '5**'), // same column + code, WRONG date (header drift)
] };
const recDate = run(`reconcileGridReads(${JSON.stringify(READ_C)}, ${JSON.stringify(READ_C.shifts.length ? { ok: true, mode: 'schedule', header_dates: HEADER, shifts: [cell(9, `${Y}-12-01`, '5**')] } : null)})`);
t('reconcile: same column/code but different dates flagged as a date disagreement',
  recDate.shifts.length === 1 && recDate.shifts[0].check === true &&
  recDate.shifts[0].checkReason.includes('disagreed on the date'));

const READ_U = { ok: true, mode: 'schedule', header_dates: [], shifts: [
  cell(9, `${Y}-12-01`, '5**', { anchored: false }),
] };
const recUn = run(`reconcileGridReads(${JSON.stringify(READ_U)}, ${JSON.stringify(READ_U)})`);
t('reconcile: unanchored cells flagged even when both reads agree',
  recUn.shifts.length === 1 && recUn.shifts[0].check === true &&
  recUn.shifts[0].checkReason.includes('could not be verified against the header'));

const recSolo = run(`reconcileGridReads(${JSON.stringify(READ_A)}, null)`);
t('reconcile: missing second read flags every cell as single-read (never silently trusted)',
  recSolo.shifts.length === 5 && recSolo.shifts.every(s => s.check && s.checkReason.includes('single read')));

// ---------- Full flow with stubbed reads ----------
const IMG = [{ name: 'IMG_1428.jpeg', type: 'image/jpeg' }];
(async () => {
  // Agreement end-to-end: clean preview, agreement status.
  run(`
    db.shifts=[]; schedulePreview=null; scheduleImportError=''; scheduleAiStatus='';
    globalThis.__queue=[${JSON.stringify(READ_A)}, ${JSON.stringify(READ_A)}];
    callExtractSchedule = async (f, n, o) => { if (o && (o.locate || o.band)) return { ok: true, mode: 'schedule', is_grid: false }; return globalThis.__queue.shift(); };
    ocrImageFile = async () => '';
  `);
  await run(`readScheduleWithAI(${JSON.stringify(IMG)})`);
  t('flow: agreeing double read -> clean 5-row preview, no check flags',
    run(`schedulePreview && schedulePreview.rows.filter(r=>r.match==='matched').length`) === 5 &&
    run(`schedulePreview.rows.every(r=>!r.flags.some(f=>f.includes('check this one')))`) === true &&
    run(`scheduleAiStatus`).includes('both reads agreed'));

  // Disagreement end-to-end: flagged rows in the preview + honest status.
  run(`
    db.shifts=[]; schedulePreview=null; scheduleImportError=''; scheduleAiStatus='';
    globalThis.__queue=[${JSON.stringify(READ_A)}, ${JSON.stringify(READ_B)}];
    callExtractSchedule = async (f, n, o) => { if (o && (o.locate || o.band)) return { ok: true, mode: 'schedule', is_grid: false }; return globalThis.__queue.shift(); };
  `);
  await run(`readScheduleWithAI(${JSON.stringify(IMG)})`);
  t('flow: disagreeing reads -> preview flags the disputed cells "check this one"',
    run(`schedulePreview.rows.filter(r=>r.flags.some(f=>f.includes('check this one'))).length`) === 3 &&
    run(`schedulePreviewHTML()`).includes('check this one') &&
    run(`scheduleAiStatus`).includes('Read twice'));
  const preview1 = run(`JSON.stringify(schedulePreview.rows.map(r=>[r.date,r.type,r.flags.join(';')]))`);
  run(`
    db.shifts=[]; schedulePreview=null; scheduleImportError=''; scheduleAiStatus='';
    globalThis.__queue=[${JSON.stringify(READ_A)}, ${JSON.stringify(READ_B)}];
    callExtractSchedule = async (f, n, o) => { if (o && (o.locate || o.band)) return { ok: true, mode: 'schedule', is_grid: false }; return globalThis.__queue.shift(); };
  `);
  await run(`readScheduleWithAI(${JSON.stringify(IMG)})`);
  t('flow: same pair of reads -> byte-identical preview (deterministic reconciliation)',
    run(`JSON.stringify(schedulePreview.rows.map(r=>[r.date,r.type,r.flags.join(';')]))`) === preview1);

  // Both reads empty, header visible: honest couldn't-read, no OCR coin flip.
  const EMPTY_GRID = { ok: true, mode: 'schedule', header_dates: HEADER, shifts: [] };
  run(`
    db.shifts=[]; schedulePreview=null; scheduleImportError=''; scheduleAiStatus='';
    globalThis.__ocrCalls=0;
    globalThis.__queue=[${JSON.stringify(EMPTY_GRID)}, ${JSON.stringify(EMPTY_GRID)}];
    callExtractSchedule = async (f, n, o) => { if (o && (o.locate || o.band)) return { ok: true, mode: 'schedule', is_grid: false }; return globalThis.__queue.shift(); };
    ocrImageFile = async () => { globalThis.__ocrCalls++; return 'Dec 6, 2026'; };
  `);
  await run(`readScheduleWithAI(${JSON.stringify(IMG)})`);
  t('flow: both reads empty but grid header seen -> couldnt-read, no preview, OCR never consulted',
    run(`scheduleImportError`).includes("couldn't read this grid") &&
    run(`schedulePreview`) === null && run(`globalThis.__ocrCalls`) === 0 &&
    run(`db.shifts.length`) === 0);

  // List schedule: NOT double-read, behavior unchanged.
  const LIST = { ok: true, mode: 'schedule', header_dates: [], shifts: [
    { date: `${Y}-11-10`, facility: 'Holzer', type: '8-hour day', code: '', name: 'Martin', pay: '' },
  ] };
  run(`
    db.shifts=[]; schedulePreview=null; scheduleImportError=''; scheduleAiStatus='';
    globalThis.__listCalls=0;
    callExtractSchedule = async () => { globalThis.__listCalls++; return ${JSON.stringify(LIST)}; };
  `);
  await run(`readScheduleWithAI(${JSON.stringify(IMG)})`);
  t('flow: list schedule still single-read, preview as before',
    run(`globalThis.__listCalls`) === 1 &&
    run(`schedulePreview && schedulePreview.rows.length`) === 1);

  console.log(failures === 0 ? 'schedule-grid-reliability test done: all passed' : 'schedule-grid-reliability test done: FAILURES=' + failures);
})();
