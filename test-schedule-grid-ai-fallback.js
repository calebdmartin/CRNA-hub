// CRNA Hub — grid schedule AI-path + fallback-guard tests (Nov 6, 2026,
// branch muse/credentialing). Run: node test-schedule-grid-ai-fallback.js
//
// Caleb retried the grid upload live and hit two failures:
//  1. The AI read never happened — banner said "read on your device
//     instead". Root cause: the AI read of this dense grid takes
//     10–30s server-side (measured 27.5s direct), and the app reaches
//     the server through the Vercel proxy api/fn.js, whose platform
//     DEFAULT function duration is far shorter — Vercel killed the
//     proxy mid-read (smaller contract/portal reads finish in time,
//     which is why only schedule reads died). Fix: vercel.json raises
//     api/fn.js to maxDuration 60 (matching the proxy's own 60s
//     upstream timer), and the client retries the read-only AI call
//     once before falling back.
//  2. The on-device fallback FABRICATED shifts: OCR noise became two
//     date-only "Other" rows (Dec 6, 2026 / Nov 1, 2026) presented as
//     Martin's shifts. Fix: scheduleRowHasEvidence — a photo-fallback
//     row needs a matched name, a grid code, a facility, or a real
//     shift type; bare-date "Other" rows are dropped, and if nothing
//     with evidence remains the import shows the honest couldn't-read
//     message with NO approvable rows.
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

// ---------- Fix 1a: the proxy gets a real duration budget ----------
const vercel = JSON.parse(fs.readFileSync(R + 'vercel.json', 'utf8'));
t('vercel.json raises api/fn.js maxDuration to 60s (AI reads take 10–30s)',
  vercel.functions && vercel.functions['api/fn.js'] && vercel.functions['api/fn.js'].maxDuration >= 60);
const fnSrc = fs.readFileSync(R + 'api/fn.js', 'utf8');
t('fn.js documents why the duration raise exists',
  fnSrc.includes('maxDuration 60'));

// ---------- Evidence rule unit checks ----------
run(`db.settings.scheduleName='Martin'; db.shifts=[]; db.facilities=[];`);
t('evidence: bare date + Other + nothing else = NO evidence',
  run(`scheduleRowHasEvidence({date:'2026-12-06',facility:'',type:'Other',matchedName:'',code:''})`) === false);
t('evidence: grid code counts',
  run(`scheduleRowHasEvidence({date:'2026-12-01',facility:'',type:'5**',matchedName:'',code:'5**'})`) === true);
t('evidence: facility counts',
  run(`scheduleRowHasEvidence({date:'2026-11-10',facility:'Holzer',type:'Other',matchedName:'',code:''})`) === true);
t('evidence: real shift type counts',
  run(`scheduleRowHasEvidence({date:'2026-11-10',facility:'',type:'8-hour day',matchedName:'',code:''})`) === true);
t('evidence: matched name counts',
  run(`scheduleRowHasEvidence({date:'2026-11-10',facility:'',type:'Other',matchedName:'Martin',code:''})`) === true);

const Y = new Date().getFullYear();
const GRID_EXTRACTION = {
  ok: true, mode: 'schedule',
  shifts: [
    { date: `${Y}-12-01`, facility: '', type: '5**', code: '5**', name: 'Martin', pay: '' },
    { date: `${Y}-12-02`, facility: '', type: '5*', code: '5*', name: 'Martin', pay: '' },
    { date: `${Y}-12-03`, facility: '', type: '5**', code: '5**', name: 'Martin', pay: '' },
    { date: `${Y}-12-04`, facility: '', type: '5*', code: '5*', name: 'Martin', pay: '' },
    { date: `${Y}-12-05`, facility: '', type: '7', code: '7', name: 'Martin', pay: '' },
  ],
  raw_text: 'grid',
};
const IMG = [{ name: 'IMG_1428.jpeg', type: 'image/jpeg' }];

(async () => {
  // ---------- Fix 1b: one AI stall retries, then succeeds ----------
  run(`
    db.shifts=[]; schedulePreview=null; scheduleImportError=''; scheduleAiStatus='';
    globalThis.__aiCalls=0; globalThis.__ocrCalls=0;
    callExtractSchedule = async () => { globalThis.__aiCalls++; if(globalThis.__aiCalls===1) throw new Error('sync_timed_out'); return ${JSON.stringify(GRID_EXTRACTION)}; };
    ocrImageFile = async () => { globalThis.__ocrCalls++; return ''; };
  `);
  await run(`readScheduleWithAI(${JSON.stringify(IMG)})`);
  t('AI stall retries once and the AI read lands (no OCR fallback used)',
    run(`globalThis.__aiCalls`) === 2 && run(`globalThis.__ocrCalls`) === 0 &&
    run(`schedulePreview && schedulePreview.rows.filter(r=>r.match==='matched').length`) === 5 &&
    run(`scheduleAiStatus`) === '');

  // ---------- Fix 2a: AI down + OCR garbage = couldn't-read, zero rows ----------
  run(`
    db.shifts=[]; schedulePreview=null; scheduleImportError=''; scheduleAiStatus='';
    callExtractSchedule = async () => { throw new Error('sync_timed_out'); };
    ocrImageFile = async () => 'STAFF SCHEDULE\\nDec 6, 2026\\nNov 1, 2026\\nTOTALS S M T W';
  `);
  await run(`readScheduleWithAI(${JSON.stringify(IMG)})`);
  t('AI unavailable + OCR garbage: honest couldnt-read message',
    run(`scheduleImportError`).includes("couldn't read this grid") &&
    run(`scheduleImportError`).includes('closer, straight-on photo') &&
    run(`scheduleImportError`).includes('Nothing was saved'));
  t('AI unavailable + OCR garbage: NO preview, NO approvable rows, nothing saved',
    run(`schedulePreview`) === null && run(`db.shifts.length`) === 0);

  // ---------- Fix 2b: AI empty + OCR garbage = same honest result ----------
  run(`
    db.shifts=[]; schedulePreview=null; scheduleImportError=''; scheduleAiStatus='';
    callExtractSchedule = async () => ({ ok:true, mode:'schedule', shifts:[] });
    ocrImageFile = async () => 'Dec 6, 2026\\nNov 1, 2026';
  `);
  await run(`readScheduleWithAI(${JSON.stringify(IMG)})`);
  t('AI empty + OCR garbage: couldnt-read, no fabricated preview',
    run(`scheduleImportError`).includes("couldn't read this grid") && run(`schedulePreview`) === null);

  // ---------- Fix 2c: legitimate list-schedule OCR fallback still works ----------
  run(`
    db.shifts=[]; schedulePreview=null; scheduleImportError=''; scheduleAiStatus='';
    callExtractSchedule = async () => { throw new Error('sync_timed_out'); };
    ocrImageFile = async () => '2026-11-10, Holzer, 8-hour day\\n2026-11-12, Holzer, Second call';
  `);
  await run(`readScheduleWithAI(${JSON.stringify(IMG)})`);
  t('legit list photo via OCR fallback: rows with facility/type evidence survive',
    run(`schedulePreview && schedulePreview.rows.length`) === 2 &&
    run(`schedulePreview.rows.every(r=>r.type!=='Other'||r.facility)`) === true &&
    run(`scheduleAiStatus`).includes('read on your device'));

  console.log(failures === 0 ? 'schedule-grid-ai-fallback test done: all passed' : 'schedule-grid-ai-fallback test done: FAILURES=' + failures);
})();
