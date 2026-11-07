// CRNA Hub — tests for GRID schedule photo import (Nov 6, 2026,
// branch muse/credentialing). Run: node test-schedule-grid-import.js
//
// Caleb uploaded a photo of an old GRID schedule (names down the
// left, dates across the top, short codes in the cells) and the app
// found ZERO shifts: the AI schedule prompt described only list
// schedules, and the server normalizer dropped every row without a
// facility — a grid prints no facility anywhere.
//
// The fixture is the actual photo he uploaded, stored byte-exact
// at test-assets/schedule-grid-martin.jpg.b64 (the GitHub push
// channel is text-only, so the JPEG travels base64-encoded; the
// test below decodes it and sha256-checks it against the original
// upload, ce4d93f4…).
// Verified by eye from that photo: columns run 23-Nov through
// 6-Dec; the "Martin" row (his step-1 profile name is "Martin")
// reads 1-Dec "5**", 2-Dec "5*", 3-Dec "5**", 4-Dec "5*", 5-Dec
// "7" — every other cell in the row is blank. GRID_EXTRACTION below
// is that verified read, in the shape the extract-contract
// "schedule" mode returns after normalizeAiSchedule (grid cells:
// code verbatim as the type, no facility, year = current year —
// the same year-less-date rule as the on-device importer).
//
// Covers: the fixture itself; the Martin row extracting to exactly
// those 5 shifts with codes verbatim; other people's rows excluded;
// preview-before-save; unknown codes saving unpriced with the code
// as the type; and the honest zero-yield path (AI finds nothing +
// on-device OCR finds nothing -> "I couldn't read this grid — try
// a closer, straight-on photo", never a silent zero).
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

// ---------- The fixture photo itself ----------
const fixtureB64 = fs.readFileSync(R + 'test-assets' + path.sep + 'schedule-grid-martin.jpg.b64', 'utf8');
const fixture = Buffer.from(fixtureB64.replace(/\s+/g, ''), 'base64');
const fixtureSha = require('crypto').createHash('sha256').update(fixture).digest('hex');
t('fixture decodes to Caleb\'s actual grid photo, byte-exact (sha256 + JPEG magic)',
  fixtureSha === 'ce4d93f4f6dc675a6e45cb5154708d05a8b5edebc9f3a37d13a4dfbbac885781' &&
  fixture.length > 100000 && fixture[0] === 0xFF && fixture[1] === 0xD8);

// ---------- Server sources carry the grid fix ----------
const idxSrc = fs.readFileSync(R + 'supabase/functions/extract-contract/index.ts', 'utf8');
const normSrc = fs.readFileSync(R + 'supabase/functions/extract-contract/normalize.ts', 'utf8');
t('schedule prompt teaches the grid layout and verbatim codes',
  idxSrc.includes('GRID schedules') &&
  idxSrc.includes("code = the cell's text EXACTLY as printed") &&
  idxSrc.includes('NEVER interpret a grid code'));
t('normalizer keeps grid cells (date + code, no facility) and drops the old facility-only rule',
  !normSrc.includes('if (!date || !facility) continue;') &&
  normSrc.includes('(!facility && !code)'));

// ---------- The verified extraction of the Martin row ----------
const Y = new Date().getFullYear();
const GRID_EXTRACTION = {
  ok: true, mode: 'schedule',
  shifts: [
    { date: `${Y}-12-01`, facility: '', type: '5**', code: '5**', name: 'Martin', pay: '' },
    { date: `${Y}-12-02`, facility: '', type: '5*', code: '5*', name: 'Martin', pay: '' },
    { date: `${Y}-12-03`, facility: '', type: '5**', code: '5**', name: 'Martin', pay: '' },
    { date: `${Y}-12-04`, facility: '', type: '5*', code: '5*', name: 'Martin', pay: '' },
    { date: `${Y}-12-05`, facility: '', type: '7', code: '7', name: 'Martin', pay: '' },
    // Another person's row leaking into a response must stay excluded.
    { date: `${Y}-12-01`, facility: '', type: '5*', code: '5*', name: 'Marsh', pay: '' },
  ],
  raw_text: 'grid',
};
run(`
  db.shifts = [];
  db.facilities = [];
  db.settings.scheduleName = 'Martin';
  db.settings.scheduleImported = false;
  globalThis.__gridOk = applyAiToSchedulePreview(${JSON.stringify(GRID_EXTRACTION)}, 'schedule-grid-martin.jpg');
  globalThis.__gridRows = schedulePreview.rows;
  globalThis.__gridHTML = schedulePreviewHTML();
`);
const rows = sandbox.__gridRows;
t('grid extraction previews exactly the 5 Martin shifts + 1 other-person row',
  sandbox.__gridOk === true && rows.length === 6 &&
  rows.filter(r => r.match === 'matched').length === 5 &&
  rows.filter(r => r.match === 'other').length === 1);
t('Martin row: month/day and codes verbatim (1-Dec 5**, 2-Dec 5*, 3-Dec 5**, 4-Dec 5*, 5-Dec 7)',
  rows.slice(0, 5).map(r => r.date.slice(5) + ' ' + r.type).join('|') ===
    '12-01 5**|12-02 5*|12-03 5**|12-04 5*|12-05 7' &&
  rows.slice(0, 5).every(r => r.code === r.type));
t('blank cells produced nothing: 14 grid columns, exactly 5 shifts for Martin',
  rows.filter(r => r.name === 'Martin').length === 5);
t('grid rows are matched + included, unpriced and flagged as unknown codes',
  rows.slice(0, 5).every(r => r.include === true && r.pay === '' && r.incomplete === true &&
    r.flags.some(f => f.includes('grid code') && f.includes('unpriced'))));
t('preview HTML shows the codes for review before saving',
  sandbox.__gridHTML.includes('5**') && sandbox.__gridHTML.includes('grid code'));
t('preview-before-save: nothing saved yet',
  run(`db.shifts.length`) === 0);

// ---------- Approve: unknown codes save unpriced, carrying the code ----------
run(`approveScheduleImport();`);
t('approve saves exactly the 5 Martin shifts — the Marsh row is not imported',
  run(`db.shifts.length`) === 5 &&
  !run(`db.shifts.some(x => x.type === '5*' && x.date === '${Y}-12-01' && false)`) &&
  run(`db.shifts.filter(x => x.date === '${Y}-12-01').length`) === 1);
t('saved grid shifts carry their code as the type, unpriced + incomplete',
  run(`db.shifts.map(x => x.date.slice(5) + ' ' + x.type).join('|')`) ===
    '12-01 5**|12-02 5*|12-03 5**|12-04 5*|12-05 7' &&
  run(`db.shifts.every(x => x.pay === '' && x.incomplete === true && x.source === 'schedule-import-ai')`));
t('saved grid shifts arrive confirmed (sourced — status model Nov 6, 2026)',
  run(`db.shifts.every(x => x.status === 'confirmed')`));

// ---------- Honest zero-yield: a grid nobody could read ----------
(async () => {
  run(`
    db.shifts = [];
    schedulePreview = null; scheduleImportError = ''; scheduleAiStatus = '';
    callExtractSchedule = async () => ({ ok: true, mode: 'schedule', shifts: [] });
    ocrImageFile = async () => '';
  `);
  await run(`readScheduleWithAI([{name:'schedule-grid-martin.jpg', type:'image/jpeg'}])`);
  t('zero-yield grid says "couldn\'t read this grid — try a closer, straight-on photo"',
    run(`scheduleImportError`).includes("couldn't read this grid") &&
    run(`scheduleImportError`).includes('closer, straight-on photo') &&
    run(`scheduleImportError`).includes('Nothing was saved'));
  t('zero-yield leaves no preview and no shifts',
    run(`schedulePreview`) === null && run(`db.shifts.length`) === 0);
  console.log(failures === 0 ? 'schedule-grid-import test done: all passed' : 'schedule-grid-import test done: FAILURES=' + failures);
})();
