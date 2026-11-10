// CRNA Hub — QGenda shift classification, ROUND 2 (Nov 8, 2026).
//
// Round 1 put the real shift name in each row's `code` (server) and
// the prompt asked per code — but Caleb's preview TABLE still showed
// "Call (unclassified)" on every row. Three causes, all pinned here:
//  a. DISPLAY: schedulePreviewHTML rendered the Shift type input from
//     r.type (the canonical bucket), never r.code. The cell now shows
//     the preserved name (code) when the row carries one.
//  b. STALE PREVIEW: a preview parsed by an older server reader sat
//     in memory unrevalidated (round 1 shipped mid-session). Fetches
//     now stamp schedulePreview.parserVersion from the response, the
//     status answer carries the server's current version, and a held
//     preview older than the server is silently re-read once, with a
//     "preview was refreshed" line. The Dashboard Review action also
//     re-checks the feed instead of only scrolling to held rows.
//  c. EDIT SYNC: renaming a row in the Shift type cell keeps code and
//     type unified (the cell displays the code), pinned by source.
// Response contract additions: fetch/status return parserVersion.
// Run: node test-qgenda-types-round2.js
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
  const timers = [];
  let timerSeq = 1;
  const state = { qgShifts: [], qgFetchParserVersion: 2, qgStatusParserVersion: 2 };
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
    console, URL, URLSearchParams, Date, JSON, Math, AbortController,
    crypto: require('crypto').webcrypto,
    FormData: FakeFormData,
    setTimeout: (fn, ms) => { const id = timerSeq++; timers.push({ id, fn, ms, cleared: false, fired: false }); return id; },
    clearTimeout: (id) => { const x = timers.find((y) => y.id === id); if (x) x.cleared = true; },
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
        if (body.action === 'status') data = { connected: true, masked: 'app.qgenda.com/…', parserVersion: state.qgStatusParserVersion };
        else if (body.action === 'fetch') data = { ok: true, masked: 'app.qgenda.com/…', shifts: state.qgShifts, parserVersion: state.qgFetchParserVersion };
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
  const fetchCount = () => fetchCalls.filter((c) => c.body && c.body.function === 'qgenda-feed' && c.body.action === 'fetch').length;
  const flush = async () => { for (let i = 0; i < 250; i++) await Promise.resolve(); };
  return { run, sandbox, alerts, fetchCalls, state, fetchCount, flush };
}

const SIGNIN = `cloudSession = { access_token: 'tok', user: { id: 'u1' } }; cloudActive = true;`;
const HOLZ_ROW = { date: '2026-08-22', facility: 'HOLZ', type: 'Call (unclassified)', code: 'HOLZ Call', hours: null, pay: '', facilityKnown: false, status: 'confirmed', uid: 'h1' };
const HOLZ_ROW_REFINED = { date: '2026-08-22', facility: 'HOLZ', type: 'Second call', code: 'HOLZ Call', hours: 14, pay: '', facilityKnown: false, status: 'confirmed', uid: 'h1' };

(async () => {
  // ---------- a. Display: the cell shows the preserved name ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [HOLZ_ROW];
    w.run(`${SIGNIN} db.facilities = []; db.shifts = []; db.settings.scheduleName = '';`);
    await w.run(`fetchQgendaFeed({})`);
    t('a row carries type (bucket) and code (raw name) as separate fields',
      w.run(`schedulePreview.rows[0].type`) === 'Call (unclassified)' &&
      w.run(`schedulePreview.rows[0].code`) === 'HOLZ Call');
    const html = w.run(`schedulePreviewHTML()`);
    t('a Shift type cell displays the preserved name "HOLZ Call"',
      html.includes('data-field="type" value="HOLZ Call"'),
      html.slice(html.indexOf('data-field="type"'), html.indexOf('data-field="type"') + 120));
    t('a Shift type cell does NOT display the bucket "Call (unclassified)"',
      !html.includes('data-field="type" value="Call (unclassified)"'));
    t('a clarification prompt asks about the raw name "HOLZ Call"',
      html.includes('“HOLZ Call”'));
    t('a fetch stamps the preview with the response parserVersion',
      w.run(`schedulePreview.parserVersion`) === 2);
  }

  // ---------- b. Stale preview: status version triggers one re-read ----------
  {
    const w = makeWorld();
    // Session starts on parser v1: rows arrive unrefined, stamped 1.
    w.state.qgShifts = [HOLZ_ROW];
    w.state.qgFetchParserVersion = 1;
    w.state.qgStatusParserVersion = 1;
    w.run(`${SIGNIN} db.facilities = []; db.shifts = []; db.settings.scheduleName = '';`);
    await w.run(`fetchQgendaFeed({})`);
    t('b precondition: preview held at parserVersion 1 with bucket type',
      w.run(`schedulePreview.parserVersion`) === 1 &&
      w.run(`schedulePreview.rows[0].type`) === 'Call (unclassified)');
    const fetchesBefore = w.fetchCount();
    // Server is updated to v2 (status reports 2; fetch returns refined rows).
    w.state.qgShifts = [HOLZ_ROW_REFINED];
    w.state.qgFetchParserVersion = 2;
    w.state.qgStatusParserVersion = 2;
    w.run(`qgendaStatusRefresh()`);
    await w.flush();
    t('b stale preview was silently re-read (exactly one extra fetch)',
      w.fetchCount() === fetchesBefore + 1, 'fetches: ' + w.fetchCount());
    t('b preview now carries parserVersion 2 and the refined type',
      w.run(`schedulePreview.parserVersion`) === 2 &&
      w.run(`schedulePreview.rows[0].type`) === 'Second call',
      JSON.stringify(w.run(`schedulePreview.rows[0]`)));
    t('b panel says the preview was refreshed',
      String(w.run(`qgendaStatusError`)).includes('preview was refreshed'),
      String(w.run(`qgendaStatusError`)));
    // Guard: a second status pass does not re-read again.
    w.run(`qgendaStatusLoaded = false; qgendaStatusRefresh()`);
    await w.flush();
    t('b revalidation happens once — no second re-read',
      w.fetchCount() === fetchesBefore + 1, 'fetches: ' + w.fetchCount());
  }

  // ---------- b2. Review action re-checks instead of showing held rows ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [HOLZ_ROW];
    w.run(`${SIGNIN} db.facilities = []; db.shifts = []; db.settings.scheduleName = '';`);
    await w.run(`fetchQgendaFeed({})`);
    const fetchesBefore = w.fetchCount();
    w.state.qgShifts = [HOLZ_ROW_REFINED];
    await w.run(`actions('qgenda-review')`);
    await w.flush();
    t('b2 Review re-fetched the feed',
      w.fetchCount() === fetchesBefore + 1, 'fetches: ' + w.fetchCount());
    t('b2 preview shows the freshly read rows after Review',
      w.run(`schedulePreview.rows[0].type`) === 'Second call');
  }

  // ---------- Source pins ----------
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  t('pin: schedule preview type cell renders code before type',
    appSrc.includes(`data-field="type" value="\${escapeHTML(r.code||r.type||'')}"`));
  t('pin: editing the type cell syncs the row code (sched + cal handlers)',
    (appSrc.match(/if\(el\.dataset\.field==='type'&&r\.code!==undefined\)r\.code=el\.value/g) || []).length === 2);
  t('pin: qgenda fetch stamps parserVersion on the preview',
    appSrc.includes(`parserVersion:(typeof data.parserVersion==='number')?data.parserVersion:null`));
  t('pin: status revalidation compares versions before re-reading',
    appSrc.includes('data.parserVersion>held') && appSrc.includes('qgendaParserRevalidated'));
  t('pin: service worker update is re-checked when the app returns to the foreground',
    appSrc.includes('p2=reg.update()'));
  t('pin: service worker cache bumped to v98',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v104'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
