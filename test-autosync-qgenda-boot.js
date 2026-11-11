// CRNA Hub — auto-sync after imports/deletions + QGenda boot check (Nov 7, 2026).
//
// Caleb approved "Build both" after the sync audit found: (1) live
// calendar sync ran on app open and after form saves, but NOT after
// import approvals (schedule upload, .ics, QGenda, contract) or shift
// deletions — those shifts only reached the "CRNA Hub" calendar at
// the next app open; (2) QGenda never checked itself — fetch happened
// only at connect and on "Check feed now".
//
// Part 1 pins: approveScheduleImport, approveCalendarImport,
// approveFacilityContract and confirmShiftDelete all schedule the
// existing debounced silent push (window.liveSyncSchedulePush), which
// no-ops signed-out / with no provider connected, and dedupes through
// the 3s debounce (import + immediate delete = ONE sync).
// Part 2 pins: qgendaBootCheck (wired into cloudInit /
// cloudAfterSignIn) runs ONE silent feed check per app open when
// QGenda is connected and the feature toggle is on. All-known feed ->
// nothing visible beyond the last-checked stamp. New shifts -> they
// wait in the schedule preview (never auto-imported), flagged by the
// Dashboard notice ("QGenda: N new shifts ready to review.") and the
// QGenda panel; dismissing the notice keeps the preview. Failures
// stay silent. Toggle off -> no check at all.
// Run: node test-autosync-qgenda-boot.js
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
        else if (body.action === 'status') data = { connections: [{ provider: 'apple', status: 'connected', lastSyncedAt: '2026-11-07T12:00:00Z', sourceCalendarName: 'Caleb Work Schedule' }] };
        else if (body.action === 'log') data = { log: [] };
        else if (body.action === 'config') data = { state: 'ready', apple: true, google: false, outlook: false, encryption: true };
      } else if (body && body.function === 'qgenda-feed') {
        if (body.action === 'status') data = { connected: state.qgStatusConnected, masked: 'app.qgenda.com/…' };
        else if (body.action === 'fetch') {
          if (state.qgFail) { status = 500; data = { error: 'feed_unreachable' }; }
          else data = { ok: true, masked: 'app.qgenda.com/…', shifts: state.qgShifts };
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
  const syncCalls = () => fetchCalls.filter((c) => c.body && c.body.function === 'sync-calendar' && c.body.action === 'sync');
  const qgCalls = (action) => fetchCalls.filter((c) => c.body && c.body.function === 'qgenda-feed' && (!action || c.body.action === action));
  return { run, sandbox, alerts, fetchCalls, state, flushTimers, syncCalls, qgCalls };
}
const drain = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const HOLZER = `{id:'f1', name:'Holzer', aliases:'', address:'', hourlyRate:'250', paidHours8:'8.5', rate8:'2125'}`;
const SIGNIN = `cloudSession = { access_token: 'tok', email: 't@example.com', expires_at: 9999999999 };`;
const CONNECT = `liveSyncConnections = { apple: { status: 'connected', sourceCalendarName: 'Caleb Work Schedule' } };`;
const SCHED_PREVIEW = `schedulePreview = { fileName: 'sched.csv', source: 'schedule-import', matchedName: '', noNamesInFile: false, ai: false, rows: [{ date: '2026-12-01', facility: 'Holzer', type: '8-hour day', pay: '2125', name: '', matchedName: '', match: 'matched', include: true, duplicate: false, flags: [], source: 'schedule-import' }] };`;

(async () => {
  // ---------- Part 1a: schedule import approval schedules ONE silent sync, payload carries the import ----------
  {
    const w = makeWorld();
    w.run(`${SIGNIN} ${CONNECT} db.facilities = [${HOLZER}]; db.shifts = []; ${SCHED_PREVIEW}`);
    w.run(`approveScheduleImport()`);
    t('1a import added the shift locally', w.run(`db.shifts.length`) === 1);
    t('1a no sync before the debounce fires', w.syncCalls().length === 0);
    w.flushTimers(); await drain();
    t('1a exactly one sync after approval', w.syncCalls().length === 1, 'got ' + w.syncCalls().length);
    const payload = (w.syncCalls()[0] || {}).body && w.syncCalls()[0].body.body;
    t('1a sync payload includes the imported shift',
      !!(payload && Array.isArray(payload.localShifts) && payload.localShifts.some((s) => s.date === '2026-12-01' && s.facility === 'Holzer')));
    t('1a sync was silent (only the import alert showed)', w.alerts.length === 1 && /Added 1 shift/.test(w.alerts[0]), JSON.stringify(w.alerts));
  }

  // ---------- Part 1b: import + immediate delete dedupe to one sync through the debounce ----------
  {
    const w = makeWorld();
    w.run(`${SIGNIN} ${CONNECT} db.facilities = [${HOLZER}];
      db.shifts = [{ id: 'old1', date: '2026-11-20', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed', source: 'user-entered', sources: ['user-entered'], note: '', updatedAt: null }];
      ${SCHED_PREVIEW}`);
    w.run(`approveScheduleImport()`);
    await w.run(`confirmShiftDelete('old1')`);
    w.flushTimers(); await drain();
    t('1b import + delete inside the debounce window = one sync', w.syncCalls().length === 1, 'got ' + w.syncCalls().length);
  }

  // ---------- Part 1c: signed out / no provider -> no sync, no errors ----------
  {
    const w = makeWorld();
    w.run(`db.facilities = [${HOLZER}]; db.shifts = []; ${SCHED_PREVIEW}`);
    w.run(`approveScheduleImport()`);
    w.flushTimers(); await drain();
    t('1c signed-out import still adds the shift', w.run(`db.shifts.length`) === 1);
    t('1c signed-out import triggers no sync and no error', w.syncCalls().length === 0 && w.fetchCalls.length === 0);
    const w2 = makeWorld();
    w2.run(`${SIGNIN} liveSyncConnections = {}; db.facilities = [${HOLZER}]; db.shifts = []; ${SCHED_PREVIEW}`);
    w2.run(`approveScheduleImport()`);
    w2.flushTimers(); await drain();
    t('1c signed-in but no provider connected -> no sync', w2.syncCalls().length === 0);
  }

  // ---------- Part 1d: contract approval schedules a push (repricing changes payloads) ----------
  {
    const w = makeWorld();
    w.run(`${SIGNIN} ${CONNECT} db.facilities = []; db.shifts = []; db.contracts = [];
      facilityContractPreview = { fileName: 'contract.pdf', isPhoto: false, contract: { id: 'ct1', facility: 'CAMC', rates: { rate8: '2000' } }, facilities: [{ include: true, name: 'CAMC', aliases: '', address: '', effectiveStart: '', effectiveEnd: '', rates: { rate8: '2000', hourlyRate: '250' } }] };
      facilityContractPendingImages = [];`);
    await w.run(`approveFacilityContract()`);
    t('1d first save asks before creating the brand-new facility (facility-choice parity)',
      w.run(`(db.facilities || []).length`) === 0 && w.run(`facilityContractConfirmCreate`) === true);
    await w.run(`approveFacilityContract()`);
    t('1d contract approval saved the facility with its rates',
      w.run(`(db.facilities || []).some(f => f.name === 'CAMC' && f.rate8 === '2000')`) === true);
    w.flushTimers(); await drain();
    t('1d contract approval triggered exactly one sync', w.syncCalls().length === 1, 'got ' + w.syncCalls().length);
  }

  // ---------- Part 1e: .ics calendar import approval schedules a push ----------
  {
    const w = makeWorld();
    w.run(`${SIGNIN} ${CONNECT} db.facilities = [${HOLZER}]; db.shifts = [];
      calPreview = { rows: [{ include: true, date: '2026-12-03', facility: 'Holzer', type: '8-hour day', pay: '2125', source: 'calendar-apple', note: '', duplicate: false }] };`);
    w.run(`approveCalendarImport()`);
    w.flushTimers(); await drain();
    t('1e .ics approval added the shift and triggered one sync',
      w.run(`db.shifts.length`) === 1 && w.syncCalls().length === 1, 'syncs=' + w.syncCalls().length);
  }

  // ---------- Part 1f: shift deletion schedules a push ----------
  {
    const w = makeWorld();
    w.run(`${SIGNIN} ${CONNECT} db.facilities = [${HOLZER}];
      db.shifts = [{ id: 'del1', date: '2026-11-21', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed', source: 'user-entered', sources: ['user-entered'], note: '', updatedAt: null }];
      shiftDeleteConfirm = null;`);
    await w.run(`confirmShiftDelete('del1')`);
    t('1f shift removed locally', w.run(`db.shifts.length`) === 0);
    w.flushTimers(); await drain();
    t('1f deletion triggered exactly one sync', w.syncCalls().length === 1, 'got ' + w.syncCalls().length);
    const payload = (w.syncCalls()[0] || {}).body && w.syncCalls()[0].body.body;
    t('1f sync payload no longer carries the deleted shift, tombstone rides along',
      !!(payload && !payload.localShifts.some((s) => s.id === 'del1') && (payload.tombstones || []).some((x) => x.shiftId === 'del1')));
  }

  // ---------- Part 2a: boot check, feed unchanged -> silent, last-checked stamped ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [{ date: '2026-12-05', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true }];
    w.run(`${SIGNIN} db.facilities = [${HOLZER}];
      db.shifts = [{ id: 'k1', date: '2026-12-05', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], note: '', updatedAt: null }];
      db.settings.qgendaConnected = true;`);
    await w.run(`qgendaBootCheck()`);
    t('2a boot check fetched the feed once', w.qgCalls('fetch').length === 1);
    t('2a unchanged feed: no preview left waiting', w.run(`schedulePreview`) === null);
    t('2a unchanged feed: no pending-new count, no Dashboard notice',
      w.run(`qgendaPendingNew`) === 0 && w.run(`dashboardQgendaNoticeHTML()`) === '');
    t('2a last-checked stamp updated', !!w.run(`db.settings.qgendaLastCheckedAt`));
    t('2a panel shows the last-checked line', w.run(`qgendaFeedHTML()`).includes('Last checked:'));
    t('2a nothing imported, no alerts', w.run(`db.shifts.length`) === 1 && w.alerts.length === 0);
    await w.run(`qgendaBootCheck()`);
    t('2a second boot check in the same session is a no-op (once per open)', w.qgCalls('fetch').length === 1);
  }

  // ---------- Part 2b: boot check, new shifts -> notice + pending preview, nothing imported ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [
      { date: '2026-12-05', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true },
      { date: '2026-12-07', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true },
      { date: '2026-12-09', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true },
    ];
    w.run(`${SIGNIN} ${CONNECT} db.facilities = [${HOLZER}];
      db.shifts = [{ id: 'k1', date: '2026-12-05', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], note: '', updatedAt: null }];
      db.settings.qgendaConnected = true;`);
    await w.run(`qgendaBootCheck()`);
    t('2b new shifts wait in a QGenda preview (3 rows, 2 new)',
      w.run(`!!schedulePreview && schedulePreview.source === 'qgenda-feed' && schedulePreview.rows.length === 3`) === true &&
      w.run(`qgendaPendingNew`) === 2);
    t('2b nothing auto-imported', w.run(`db.shifts.length`) === 1);
    t('2b Dashboard carries the notice', w.run(`dashboard()`).includes('QGenda: 2 new shifts ready to review.'));
    t('2b QGenda panel flags the waiting shifts and rests open',
      w.run(`qgendaFeedHTML()`).includes('QGenda: 2 new shifts ready to review') &&
      /id="qgenda-panel" open/.test(w.run(`qgendaFeedHTML()`)));
    w.run(`actions('qgenda-notice-dismiss', '', '', '')`);
    t('2b dismissing the notice hides it but keeps the preview',
      w.run(`dashboardQgendaNoticeHTML()`) === '' && w.run(`!!schedulePreview`) === true);
    w.run(`actions('schedule-approve', '', '', '')`);
    t('2b approving imports the 2 new shifts (known one merges, never doubles)',
      w.run(`db.shifts.length`) === 3, 'shifts=' + w.run(`db.shifts.length`));
    t('2b approval clears the pending state', w.run(`qgendaPendingNew`) === 0 && w.run(`dashboardQgendaNoticeHTML()`) === '');
    w.flushTimers(); await drain();
    t('2b approval also schedules the calendar sync (Part 1 covers QGenda approvals)', w.syncCalls().length >= 1);
  }

  // ---------- Part 2c: feature toggle off -> no boot check ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [{ date: '2026-12-07', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true }];
    w.run(`${SIGNIN} db.settings.qgendaConnected = true; db.settings.featureQgenda = false;`);
    await w.run(`qgendaBootCheck()`);
    t('2c toggle off: no feed call of any kind', w.qgCalls().length === 0 && w.fetchCalls.length === 0);
    t('2c toggle off: no preview, no notice', w.run(`schedulePreview`) === null && w.run(`dashboardQgendaNoticeHTML()`) === '');
  }

  // ---------- Part 2d: boot check failure stays silent ----------
  {
    const w = makeWorld();
    w.state.qgFail = true;
    w.run(`${SIGNIN} db.settings.qgendaConnected = true;`);
    await w.run(`qgendaBootCheck()`);
    t('2d failed check: no banner text, no alert, no preview',
      w.run(`qgendaStatusError`) === '' && w.alerts.length === 0 && w.run(`schedulePreview`) === null);
    t('2d failed check does not stamp last-checked', !w.run(`db.settings.qgendaLastCheckedAt`));
  }

  // ---------- Part 2e: not connected locally -> one status probe decides ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [{ date: '2026-12-07', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true }];
    w.run(`${SIGNIN} db.facilities = [${HOLZER}]; db.shifts = []; db.settings.qgendaConnected = false;`);
    await w.run(`qgendaBootCheck()`);
    t('2e status probe ran, server said connected, feed checked, preview waits',
      w.qgCalls('status').length === 1 && w.qgCalls('fetch').length === 1 && w.run(`qgendaPendingNew`) === 1);
    const w3 = makeWorld();
    w3.state.qgStatusConnected = false;
    w3.run(`${SIGNIN} db.settings.qgendaConnected = false;`);
    await w3.run(`qgendaBootCheck()`);
    t('2e server says not connected -> no fetch', w3.qgCalls('fetch').length === 0);
  }

  // ---------- Source pins: wiring + honest copy ----------
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  t('pin: cloudInit runs the QGenda boot check after the merge',
    /async function cloudInit\(\)[\s\S]*?monitorBackgroundSweep\(\); qgendaBootCheck\(\);/.test(appSrc));
  t('pin: cloudAfterSignIn runs it too (once-guard keeps it to one per open)',
    /async function cloudAfterSignIn\(\)[\s\S]*?monitorBackgroundSweep\(\); qgendaBootCheck\(\);/.test(appSrc));
  t('pin: all four Part 1 call sites schedule the push',
    (appSrc.match(/window\.liveSyncSchedulePush\(\)/g) || []).length >= 8,
    'count=' + (appSrc.match(/window\.liveSyncSchedulePush\(\)/g) || []).length);
  t('pin: no copy still claims the QGenda feed does not sync / has no background sync',
    !appSrc.includes('does not sync in the background') && !appSrc.includes('has no background sync'));
  t('pin: panel copy states the auto-check-on-open behaviour',
    appSrc.includes('We check your feed each time you open the app'));
  t('pin: service worker cache bumped to v85',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v111'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
