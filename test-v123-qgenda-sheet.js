// CRNA Hub — v123 Request B (Nov 11, 2026): the QGenda preview
// pops up as a sheet. Caleb, verbatim: "The Qgenda preview needs
// to pop up right after the link is reviewed. No searching or
// scrolling." The preview used to wait buried under the Upload a
// schedule panel, pointed to by a line of text in the QGenda
// panel.
//
// Pins:
//  B1 a manual check (Check feed now / connect) that finds new
//     shifts opens the preview sheet immediately, with the
//     shifts inside, approvable in place; the Upload panel then
//     shows a pointer line instead of a second copy.
//  B2 approving inside the sheet saves the shifts priced and
//     closes the sheet; a re-check finds nothing new — no sheet,
//     quiet result line in the panel.
//  B3 a manual check with zero new shifts never opens a sheet.
//  B4 the app-open (silent) check never pops the sheet: the
//     Dashboard notice + the panel's Review now button open the
//     same sheet on demand; closing it leaves the pending
//     preview intact and resumable.
//  B5 the v115 double-booking stop fires inside the sheet
//     identically (same heading, same approve behavior).
// Run: node test-v123-qgenda-sheet.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
}

function makeWorld() {
  const store = new Map();
  const alerts = [];
  const fetchCalls = [];
  const state = { qgShifts: [], qgFail: false };
  function el(id) {
    return {
      id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [],
      dataset: {}, style: {}, _listeners: {},
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
  const sandbox = {
    console, URL, URLSearchParams, Date, JSON, Math,
    crypto: require('crypto').webcrypto,
    FormData: FakeFormData,
    setTimeout, clearTimeout,
    localStorage: {
      getItem: (k) => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      getElementById: (id) => getEl(id),
      querySelectorAll: () => [],
      createElement: () => el(), body: { append() {} },
      addEventListener() {},
    },
    window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
    alert: (m) => { alerts.push(String(m)); },
    confirm: () => true,
    fetch: async (url, opts) => {
      let body = null;
      try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
      fetchCalls.push({ url, body });
      let data = { ok: true };
      let status = 200;
      if (body && body.function === 'qgenda-feed') {
        if (body.action === 'status') data = { connected: true, masked: 'app.qgenda.com/…', parserVersion: 6 };
        else if (body.action === 'fetch') {
          if (state.qgFail) { status = 500; data = { error: 'feed_unreachable' }; }
          else data = { ok: true, masked: 'app.qgenda.com/…', shifts: state.qgShifts, parserVersion: 6 };
        }
      } else if (body && body.function === 'sync-calendar') {
        if (body.action === 'sync') data = { ok: true, providerChanges: [], pendingDeletions: [], shiftSync: [] };
        else if (body.action === 'status') data = { connections: [] };
        else if (body.action === 'log') data = { log: [] };
        else if (body.action === 'config') data = { state: 'ready', apple: false, google: false, outlook: false, encryption: true };
      }
      return { status, ok: status === 200, text: async () => JSON.stringify(data), json: async () => data };
    },
    history: { replaceState() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  const drain = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return { run, sandbox, alerts, fetchCalls, state, drain };
}
const SIGNIN = `cloudSession = { access_token: 'tok', user: { email: 't@example.com' } }; db.settings.qgendaConnected = true;`;
const HOLZER = `{id:'f1', name:'Holzer', aliases:'', address:'', hourlyRate:'250', paidHours8:'8.5', rate8:'2125', weekendDays:[0,6], codeMap:{}}`;
const ROW1 = { date: '2026-12-07', facility: 'Holzer', type: '8-hour day', code: 'HOLZ - G Main (8)', hours: 8, pay: '2125', facilityKnown: true };
const ROW2 = { date: '2026-12-08', facility: 'Holzer', type: '8-hour day', code: 'HOLZ - G Main (8)', hours: 8, pay: '2125', facilityKnown: true };

(async () => {
  // ---------- B1 + B2: manual check pops the sheet; approve inside it ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [ROW1, ROW2];
    w.run(`db = empty(); db.facilities = [${HOLZER}]; db.shifts = []; ${SIGNIN}`);
    await w.run(`fetchQgendaFeed({})`);
    await w.drain();
    t('B1 manual check with new shifts opens the sheet immediately',
      w.run(`qgendaSheetOpen`) === true && w.run(`qgendaPendingNew`) === 2);
    const sheet = w.run(`qgendaPreviewSheetHTML()`);
    t('B1 the sheet IS the preview (rows + approve button inside)',
      sheet.includes('QGenda — review new shifts') && sheet.includes('HOLZ - G Main (8)') &&
      sheet.includes('data-action="schedule-approve"'));
    t('B1 the sheet rides the global overlay (present on any tab)',
      w.run(`assistantOverlayHTML()`).includes('QGenda — review new shifts'));
    t('B1 the Upload panel shows a pointer instead of a second copy',
      w.run(`scheduleImportHTML()`).includes('Your QGenda preview is open in front of you') &&
      !w.run(`scheduleImportHTML()`).includes('id="schedule-import-panel"') === false);
    await w.run(`actions('schedule-approve')`);
    await w.drain();
    t('B2 approving in the sheet saves both shifts priced and closes the sheet',
      w.run(`db.shifts.length`) === 2 && w.run(`db.shifts.every(s=>s.pay==='2125')`) === true &&
      w.run(`qgendaSheetOpen`) === false && w.run(`schedulePreview`) === null,
      JSON.stringify(w.run(`db.shifts`)));
    await w.run(`fetchQgendaFeed({})`);
    await w.drain();
    t('B2 re-check adds zero and opens no sheet — quiet result line instead',
      w.run(`db.shifts.length`) === 2 && w.run(`qgendaSheetOpen`) === false &&
      w.run(`qgendaStatusError`).includes('no new shifts'));
  }

  // ---------- B3: manual check, zero new from the start ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [ROW1];
    w.run(`db = empty(); db.facilities = [${HOLZER}];
      db.shifts = [{id:'s1', date:'2026-12-07', facility:'Holzer', type:'8-hour day', code:'HOLZ - G Main (8)', pay:'2125', status:'confirmed', source:'qgenda-feed', sources:['qgenda-feed']}];
      ${SIGNIN}`);
    await w.run(`fetchQgendaFeed({})`);
    await w.drain();
    t('B3 manual check with 0 new shifts: no sheet, quiet line, nothing doubled',
      w.run(`qgendaSheetOpen`) === false && w.run(`db.shifts.length`) === 1 &&
      w.run(`qgendaStatusError`).includes('no new shifts'));
  }

  // ---------- B4: silent boot check — no pop; Review now opens it ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [ROW1, ROW2];
    w.run(`db = empty(); db.facilities = [${HOLZER}]; db.shifts = []; ${SIGNIN}`);
    await w.run(`fetchQgendaFeed({silent:true})`);
    await w.drain();
    t('B4 silent check finds new shifts but never pops the sheet',
      w.run(`qgendaPendingNew`) === 2 && w.run(`qgendaSheetOpen`) === false);
    t('B4 Dashboard notice is up; panel note has Review now (buried pointer text is gone)',
      w.run(`dashboardQgendaNoticeHTML()`).includes('2 new shifts ready to review') &&
      w.run(`qgendaFeedHTML()`).includes('data-action="qgenda-review"') &&
      w.run(`qgendaFeedHTML()`).includes('Review now') &&
      !w.run(`qgendaFeedHTML()`).includes('see the preview under Upload a schedule'));
    await w.run(`actions('qgenda-review')`);
    await w.drain();
    t('B4 Review now opens the same sheet in place',
      w.run(`qgendaSheetOpen`) === true && w.run(`qgendaPreviewSheetHTML()`).includes('HOLZ - G Main (8)'));
    await w.run(`actions('qgenda-sheet-close')`);
    t('B4 closing the sheet leaves the pending preview intact and resumable',
      w.run(`qgendaSheetOpen`) === false && w.run(`qgendaPendingPreview()`) === true &&
      w.run(`qgendaPendingNew`) === 2);
    await w.run(`actions('qgenda-review')`);
    t('B4 the sheet reopens from the button with the same rows',
      w.run(`qgendaSheetOpen`) === true && w.run(`schedulePreview.rows.length`) === 2);
  }

  // ---------- B5: double-booking stop inside the sheet ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [{ date: '2026-12-07', facility: 'Holzer', type: '8-hour day', code: 'HOLZ - G Main (8)', hours: 8, pay: '2125', facilityKnown: true }];
    w.run(`db = empty(); db.facilities = [${HOLZER}, {id:'f2', name:'CAMC', aliases:'', address:'', hourlyRate:'250', codeMap:{}}];
      db.shifts = [{id:'s9', date:'2026-12-07', facility:'CAMC', type:'8-hour day', code:'5**', pay:'2500', status:'confirmed', source:'calendar', sources:['calendar']}];
      ${SIGNIN}`);
    await w.run(`fetchQgendaFeed({})`);
    await w.drain();
    t('B5 the sheet opens over the conflicting day',
      w.run(`qgendaSheetOpen`) === true);
    // The v115 gate is a two-step stop, in the panel and sheet
    // alike: the first Approve adds nothing and renders the
    // warning into the preview; the second Approve decides.
    await w.run(`actions('schedule-approve')`);
    await w.drain();
    const sheet = w.run(`qgendaPreviewSheetHTML()`);
    t('B5 first Approve in the sheet stops and renders the double-booking warning inside it',
      w.run(`db.shifts.filter(s=>s.date==='2026-12-07').length`) === 1 &&
      sheet.includes('double-booking yourself') && sheet.includes('importConflictOverride'),
      sheet.slice(0, 200));
    await w.run(`actions('schedule-approve')`);
    await w.drain();
    t('B5 second Approve (no override ticked) holds the conflicting shift out',
      w.run(`db.shifts.filter(s=>s.date==='2026-12-07').length`) === 1 &&
      w.run(`db.shifts[0].facility`) === 'CAMC');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
