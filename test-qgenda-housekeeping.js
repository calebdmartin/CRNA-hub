// CRNA Hub — QGenda housekeeping filter, client side (Nov 9, 2026).
//
// Caleb's live report: the clarification prompt asked "What is
// 'AutoSync from QGenda: 2:11PM'?" — a QGenda feed sync marker, not
// a shift — and a code still carried a "[Martin]" bracket remnant.
// The server parser filters housekeeping on an explicit marker and
// drops assignee brackets (parser v5; see the Deno tests in
// supabase/functions/qgenda-feed/parse.test.ts). These tests pin
// the client mirror: a preview built from an older response can
// never carry a sync marker into the prompt or an import, and
// normalizeCodeKey heals bracket remnants in saved keys the same
// way the server cleaner does. An unusual real shift name is never
// filtered — the marker test is explicit, not a heuristic.
// Run: node test-qgenda-housekeeping.js
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
  const state = { qgShifts: [], qgFail: false, qgStatusConnected: true };
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
      if (body && body.function === 'sync-calendar') {
        if (body.action === 'sync') data = { ok: true, providerChanges: [], pendingDeletions: [], shiftSync: [] };
        else if (body.action === 'status') data = { connections: [] };
        else if (body.action === 'log') data = { log: [] };
        else if (body.action === 'config') data = { state: 'ready', apple: true, google: false, outlook: false, encryption: true };
      } else if (body && body.function === 'qgenda-feed') {
        if (body.action === 'status') data = { connected: state.qgStatusConnected, masked: 'app.qgenda.com/…' };
        else if (body.action === 'fetch') {
          if (state.qgFail) { status = 500; data = { error: 'feed_unreachable' }; }
          else data = { ok: true, masked: 'app.qgenda.com/…', shifts: state.qgShifts, parserVersion: 4 };
        }
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
  const flushTimers = () => {
    for (let round = 0; round < 20; round++) {
      const due = timers.filter((x) => !x.cleared && !x.fired);
      if (!due.length) break;
      due.forEach((x) => { x.fired = true; x.fn(); });
    }
  };
  return { run, sandbox, alerts, fetchCalls, state, flushTimers };
}
const drain = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const SIGNIN = `cloudSession = { access_token: 'tok' };`;

(async () => {
  // ---------- 1: the marker test itself ----------
  {
    const w = makeWorld();
    t('1 marker: timed AutoSync matches', w.run(`isHousekeepingShiftName('AutoSync from QGenda: 2:11PM')`) === true);
    t('1 marker: bare AutoSync matches', w.run(`isHousekeepingShiftName('AutoSync')`) === true);
    t('1 marker: case-insensitive', w.run(`isHousekeepingShiftName('autosync from qgenda')`) === true);
    t('1 marker: real shift names never match', w.run(`isHousekeepingShiftName('HOLZ - Call 2')`) === false && w.run(`isHousekeepingShiftName('HOLZ - G Main (8)')`) === false);
    t('1 marker: unusual real names never match', w.run(`isHousekeepingShiftName('Team lunch')`) === false && w.run(`isHousekeepingShiftName('HOLZ - Educ Day')`) === false && w.run(`isHousekeepingShiftName('')`) === false);
  }

  // ---------- 2: normalizeCodeKey bracket healing (mirrors the server cleaner) ----------
  {
    const w = makeWorld();
    w.run(`db.settings.scheduleName = 'Caleb Martin'`);
    t('2 full-name bracket drops', w.run(`normalizeCodeKey('HOLZ - G Main (10) [Caleb Martin]')`) === 'HOLZ - G Main (10)');
    t('2 last-name-only bracket drops', w.run(`normalizeCodeKey('HOLZ - G Main (10) [Martin]')`) === 'HOLZ - G Main (10)');
    t('2 first-name-only bracket drops', w.run(`normalizeCodeKey('HOLZ - G Main (10) [Caleb]')`) === 'HOLZ - G Main (10)');
    t('2 initial + last name drops', w.run(`normalizeCodeKey('HOLZ - G Main (10) [C. Martin]')`) === 'HOLZ - G Main (10)');
    t('2 unrelated bracket content stays', w.run(`normalizeCodeKey('HOLZ - G Main (10) [OR 2]')`) === 'HOLZ - G Main (10) [OR 2]');
    t('2 name part + other content stays', w.run(`normalizeCodeKey('HOLZ - G Main (10) [Martin OR 2]')`) === 'HOLZ - G Main (10) [Martin OR 2]');
    t('2 emptied brackets still drop (v100 behaviour)', w.run(`normalizeCodeKey('HOLZ - Call 2 [ ]')`) === 'HOLZ - Call 2');
    w.run(`db.settings.scheduleName = 'Martin'`);
    t('2 partial form: [Caleb Martin] heals with only "Martin" known', w.run(`normalizeCodeKey('HOLZ - G Main (10) [Caleb Martin]')`) === 'HOLZ - G Main (10)');
    // Documented residual (same as the server given the same name):
    // a bracket containing NO provided name part is indistinguishable
    // from genuine content and is kept.
    t('2 residual: bracket with no provided name part is kept', w.run(`normalizeCodeKey('HOLZ - G Main (10) [Caleb]')`) === 'HOLZ - G Main (10) [Caleb]');
  }

  // ---------- 3: a fetch carrying a housekeeping row never reaches the preview ----------
  {
    const w = makeWorld();
    w.run(`${SIGNIN} db.settings.scheduleName = 'Martin'; db.settings.qgendaConnected = true;
      db.facilities = [{ id: 'f1', name: 'Holzer', aliases: '', address: '', hourlyRate: '', paidHours8: '', rate8: '', rate10: '', rateSecond: '', weekendRateSecond: '', rate24: '', weekendRate24: '', hourlyCall1st: '', callBonus: '' }];
      db.shifts = [];`);
    // Rows as the OLD (v4) parser would emit them: the sync marker
    // rides along as a row, and the real rows arrive unpriced.
    w.state.qgShifts = [
      { date: '2026-11-09', facility: '', type: 'AutoSync from QGenda: 2:11PM', code: 'AutoSync from QGenda: 2:11PM', hours: 8, pay: '', facilityKnown: false },
      { date: '2026-11-10', facility: 'Holzer', type: '8-hour day', code: 'HOLZ - G Main (8)', hours: 8, pay: '', facilityKnown: true },
      { date: '2026-11-11', facility: 'Holzer', type: '10-hour shift', code: 'HOLZ - G Main (10)', hours: 10, pay: '', facilityKnown: true },
    ];
    await w.run(`fetchQgendaFeed()`);
    await drain();
    t('3 preview holds only the real rows', w.run(`(schedulePreview.rows || []).length`) === 2, 'rows=' + w.run(`JSON.stringify((schedulePreview.rows || []).map(r => r.code))`));
    t('3 no housekeeping row in the preview', w.run(`(schedulePreview.rows || []).some(r => /autosync/i.test(r.code || '') || /autosync/i.test(r.type || ''))`) === false);
    const codes = w.run(`unclarifiedCodes(schedulePreview, importRatesTarget(schedulePreview)).map(c => c.code)`);
    t('3 prompt asks only about the real codes', JSON.stringify(codes.slice().sort()) === JSON.stringify(['HOLZ - G Main (10)', 'HOLZ - G Main (8)']), JSON.stringify(codes));
  }

  // ---------- 4: a stale preview cannot prompt about or import housekeeping ----------
  {
    const w = makeWorld();
    w.run(`db.facilities = [{ id: 'f1', name: 'Holzer', aliases: '', address: '', hourlyRate: '', paidHours8: '', rate8: '' }];
      db.shifts = [];
      schedulePreview = { fileName: 'QGenda feed', source: 'qgenda-feed', matchedName: 'Martin', noNamesInFile: false, ai: false, parserVersion: 4, rows: [
        { date: '2026-11-09', facility: '', type: 'AutoSync from QGenda: 2:11PM', code: 'AutoSync from QGenda: 2:11PM', hours: 8, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed' },
        { date: '2026-11-10', facility: 'Holzer', type: '8-hour day', code: 'HOLZ - G Main (8)', hours: 8, pay: '2125', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed' },
      ] };`);
    const codes = w.run(`unclarifiedCodes(schedulePreview, importRatesTarget(schedulePreview)).map(c => c.code)`);
    t('4 stale preview: prompt excludes the marker', !codes.some((c) => /autosync/i.test(c)), JSON.stringify(codes));
    w.run(`approveScheduleImport()`);
    t('4 stale preview: approve saves no housekeeping shift', w.run(`(db.shifts || []).some(x => /autosync/i.test(x.code || '') || /autosync/i.test(x.type || ''))`) === false);
    t('4 stale preview: the real shift still saves', w.run(`(db.shifts || []).length`) === 1 && w.run(`db.shifts[0].date`) === '2026-11-10', 'shifts=' + w.run(`(db.shifts || []).length`));
  }

  // ---------- 5: shell cache bumped ----------
  {
    const sw = fs.readFileSync(R + 'sw.js', 'utf8');
    t('5 service worker cache is v101', sw.includes('crna-hub-shell-v109'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();
