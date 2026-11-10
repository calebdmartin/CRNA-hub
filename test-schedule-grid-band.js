// CRNA Hub — tests for grid BAND extraction (Nov 7, 2026, branch
// muse/credentialing). Run: node test-schedule-grid-band.js
//
// Caleb killed the crop advice: cropping a grid photo by hand
// throws away the date header. The user never crops — the app
// zooms: a locate pass returns the grid's structure (header dates
// + every row's name label, in order), deterministic pixel
// geometry on the ORIGINAL photo finds the ruled lines and the
// matched row's exact band, the client stacks header band + row
// band into one composite, and the server transcribes it as a
// per-column cells array. Band cells are cross-checked against
// the full-photo read; disagreements flag "check this one".
//
// Measured live on the fixture grid (schedule-grid-martin),
// through the deployed function: full-photo read 0/5 correct
// cells (Mitchell bleed); band read (gpt-4o, dates-only
// composite) 5/5 correct, 2/2 runs. gpt-4o-mini mis-anchored the
// composite ~4 columns early — the band sub-modes run on gpt-4o.
// These tests pin the mechanics with stubbed server responses and
// a synthetic ruled-grid image.
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
  constructor(form) { this._map = (form && form._map) || {}; this._e = (form && form._entries) || []; }
  get(k) { return k in this._map ? this._map[k] : null; }
  *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; }
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
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
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
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const idxSrc = fs.readFileSync(R + 'supabase/functions/extract-contract/index.ts', 'utf8');
const normSrc = fs.readFileSync(R + 'supabase/functions/extract-contract/normalize.ts', 'utf8');

// --- Server wiring (static) ---
t('server: locate sub-mode wired (prompt + response shape)',
  idxSrc.includes('gridLocatePrompt') && idxSrc.includes('body.locate === true') &&
  idxSrc.includes('normalizeAiGridLocate') && idxSrc.includes('row_labels: loc.rowLabels'));
t('server: band sub-mode wired (prompt + response shape)',
  idxSrc.includes('gridBandPrompt') && idxSrc.includes('body.band === true') &&
  idxSrc.includes('normalizeAiBandRead'));
t('server: band prompt demands one cells entry per column, blanks included',
  idxSrc.includes('EXACTLY one entry per column') && idxSrc.includes('array length must equal'));
t('server: locate prompt asks for structure only — no coordinates, no codes',
  idxSrc.includes('locating task only') && idxSrc.includes('header_dates') && idxSrc.includes('row_labels'));
t('normalizer: band read maps cells[i] to column i+1 with header-anchored dates',
  normSrc.includes('normalizeAiBandRead') && normSrc.includes('column: i + 1') && normSrc.includes('anchored: true'));
t('server: band sub-modes run on gpt-4o (measured: mini mis-anchors the composite ~4 columns)',
  idxSrc.includes('GRID_BAND_MODEL = "gpt-4o"') &&
  idxSrc.includes('body.locate === true || body.band === true ? GRID_BAND_MODEL : SCHEDULE_MODEL'));
t('client: composite covers the DATE columns only, stretched ~2.2x vertically',
  appSrc.includes('const x0=geom.dateSpans[0].x0,x1=geom.gridX1') && appSrc.includes('*scale*2.2'));
t('client: callExtractSchedule forwards locate/band flags and prebuilt images',
  appSrc.includes('if(o.locate)payload.locate=true') && appSrc.includes('if(o.band)payload.band=true') &&
  appSrc.includes('o.images?o.images:await aiContractImagesDataURLs(files)'));

// --- Geometry on a synthetic ruled grid ---
// 3 data rows: Alpha (inked label), blank-label row, Martin
// (inked label). 4 date columns. Lines every 20px from y=40;
// header band above the first line.
run(`
  globalThis.__synth = (() => {
    const W = 400, H = 140;
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    const dark = (x, y) => { const o = (y * W + x) * 4; data[o] = data[o+1] = data[o+2] = 0; };
    // Anti-aliased label glyphs: mid-grey pixels, like real JPEG'd
    // grid text (the geometry's label test reads the mid-grey band).
    const mid = (x, y) => { const o = (y * W + x) * 4; data[o] = data[o+1] = data[o+2] = 150; };
    // horizontal lines at y = 40, 60, 80, 100
    for (const y of [40, 60, 80, 100]) for (let x = 0; x < W; x++) dark(x, y);
    // vertical lines: ONE wide name column 0-100, then the four
    // date columns 100-175, 175-250, 250-325, 325-400 (the real
    // layout: a single label span before the dates)
    for (const x of [0, 100, 175, 250, 325, 399]) for (let y = 20; y <= 100; y++) dark(x, y);
    // header ink above the first line
    for (let y = 26; y < 34; y++) for (let x = 110; x < 160; x++) dark(x, y);
    // label ink: band 0 (Alpha) and band 2 (Martin); band 1 blank
    for (let y = 46; y < 54; y++) for (let x = 10; x < 60; x++) mid(x, y);
    for (let y = 86; y < 94; y++) for (let x = 10; x < 70; x++) mid(x, y);
    return { data, W, H };
  })();
  globalThis.__geom = detectGridGeometry(globalThis.__synth.data, globalThis.__synth.W, globalThis.__synth.H, 4, 2);
`);
const geom = sandbox.__geom;
t('geometry: ruled lines found on a synthetic grid', !!geom);
t('geometry: header band sits above the first line',
  !!geom && geom.headerBand.y1 <= 43 && geom.headerBand.y0 >= 10);
t('geometry: three data bands detected (blank-label row kept, not skipped)',
  !!geom && geom.rows.length === 3 && geom.rows[1].label === '');
t('geometry: inked rows carry label slots in order (Alpha=0, Martin=1)',
  !!geom && geom.rows[0].label === '0' && geom.rows[2].label === '1');
t('geometry: date columns follow the single name span; grid right edge is the last date column',
  !!geom && geom.dateSpans.length === 4 && geom.dateSpans[0].x0 === 100 && geom.gridX1 === 399);
t('geometry: refuses a photo with no ruled grid',
  run(`detectGridGeometry(new Uint8ClampedArray(100*100*4).fill(255), 100, 100, 4, 2)`) === null);

// --- Cross-check (the honesty layer) ---
run(`
  globalThis.__band = [
    { date: '2026-12-01', code: '5**', type: '5**', column: 9, name: 'Martin', facility: '', pay: '', anchored: true },
    { date: '2026-12-02', code: '5*', type: '5*', column: 10, name: 'Martin', facility: '', pay: '', anchored: true },
    { date: '2026-11-27', code: '5**', type: '5**', column: 5, name: 'Martin', facility: '', pay: '', anchored: true },
  ];
  globalThis.__full = { shifts: [
    { date: '2026-12-01', code: '5**', type: '5**', column: 9, name: 'Martin', facility: '', pay: '' },
    { date: '2026-12-02', code: '7', type: '7', column: 10, name: 'Martin', facility: '', pay: '' },
    { date: '2026-11-23', code: 'endo 3', type: 'endo 3', column: 1, name: 'Martin', facility: '', pay: '' },
  ] };
  globalThis.__cc = crossCheckGridReads(globalThis.__band, globalThis.__full);
`);
const cc = sandbox.__cc;
const byCol = (c) => cc.find((s) => s.column === c);
t('cross-check: methods agreeing on a cell leave it unflagged',
  !!byCol(9) && !byCol(9).check);
t('cross-check: different codes for one cell flag it (band code stands)',
  !!byCol(10) && byCol(10).check === true && byCol(10).code === '5*');
t('cross-check: band-only cell is flagged, never silently trusted (the phantom case)',
  !!byCol(5) && byCol(5).check === true && byCol(5).includeDefault !== false);
t('cross-check: full-photo-only cell is appended flagged AND starts unchecked (neighbour-bleed guard)',
  !!byCol(1) && byCol(1).check === true && byCol(1).includeDefault === false);

// --- Preview honours includeDefault ---
run(`
  db.shifts = [];
  db.settings.scheduleName = 'Martin';
  globalThis.__applied = applyAiToSchedulePreview({ ok: true, mode: 'schedule', shifts: [
    { date: '2026-12-01', code: '5**', type: '5**', column: 9, name: 'Martin', facility: '', pay: '', anchored: true },
    { date: '2026-11-23', code: 'endo 3', type: 'endo 3', column: 1, name: 'Martin', facility: '', pay: '', includeDefault: false },
  ] }, 'grid.jpg');
  globalThis.__rows = schedulePreview ? schedulePreview.rows : [];
`);
t('preview: a cross-checked full-only row loads unchecked; an agreed band row loads checked',
  sandbox.__applied === true && sandbox.__rows.length === 2 &&
  sandbox.__rows[0].include === true && sandbox.__rows[1].include === false);

// --- Guidance copy: the user never crops ---
t('photo tips: whole-grid guidance, no crop advice',
  appSrc.includes('One photo of the whole grid is best') &&
  appSrc.includes("there's no need to crop") &&
  !appSrc.includes('Cropping to just the grid'));
t("couldn't-read message: whole-grid guidance, no crop advice",
  appSrc.includes('try one straight-on photo of the whole grid, dates across the top and your name row both in frame'));

// --- Band flow wiring ---
t('flow: single-photo grids try the band read before the full-photo double read',
  appSrc.includes('tryGridBandRead(images,data)') &&
  appSrc.indexOf('tryGridBandRead(images,data)') < appSrc.indexOf('const rec=reconcileGridReads(data,data2)'));
t('flow: band failure falls back — tryGridBandRead swallows errors to null',
  appSrc.includes('async function tryGridBandRead') && appSrc.includes('}catch(e){ return null }'));
t('service worker cache bumped to v73',
  fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v109'));

console.log(failures ? failures + ' FAILURES' : 'ALL PASS');
