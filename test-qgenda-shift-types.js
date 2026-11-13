// CRNA Hub — QGenda shift-type read, CLIENT side (Nov 8, 2026).
//
// Caleb opened the QGenda preview (53 shifts) and the clarification
// prompt asked only about "Call (unclassified)" and "Shift" — the
// server parser was canonicalizing every event into fixed buckets
// and discarding the real shift names. The server now returns, per
// shift: `code` (the real shift name as read, e.g. "8/2nd call",
// "Night Float") and `hours` (number|null from the event times),
// while `type` stays the canonical classification used for pricing.
// Response contract: shifts = {date, facility, type, code, hours,
// pay, facilityKnown, status, uid}.
//
// This test pins the client half:
//  a. Preview rows carry the distinct codes; the clarification
//     prompt asks per distinct code actually read (never collapsed
//     into "Shift" / "Call (unclassified)"), and a code's row-derived
//     hours pre-fill its Hours input. A code the facility can already
//     price by its canonical type ("Holzer 8" -> "8-hour day" priced
//     from the hourly rate) is NOT asked about.
//  b. Canonical-priced exclusion: once Holzer can price "Second
//     call" itself (rateSecond + weekendRateSecond), the
//     "8/2nd call" code leaves the prompt — its own code string
//     still prices $0 through facilityPayFor, so only the new
//     type-based check can exclude it. "Night Float" (type "Shift",
//     unpriced) still asks.
//  c. Regeneration replaces stale: a seeded OLD generic preview is
//     replaced wholesale by a fresh fetch — never merged.
//  d. The fetch request body carries the user's schedule name.
// Run: node test-qgenda-shift-types.js
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
  const state = { qgShifts: [] };
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
        if (body.action === 'status') data = { connected: true, masked: 'app.qgenda.com/…' };
        else if (body.action === 'fetch') data = { ok: true, masked: 'app.qgenda.com/…', shifts: state.qgShifts };
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
  const qgFetchBodies = () => fetchCalls
    .filter((c) => c.body && c.body.function === 'qgenda-feed' && c.body.action === 'fetch')
    .map((c) => c.body.body || {});
  return { run, sandbox, alerts, fetchCalls, state, qgFetchBodies };
}

const SIGNIN = `cloudSession = { access_token: 'tok', email: 't@example.com', expires_at: 9999999999 };`;
// Holzer with ONLY an hourly rate: canonical pricing then covers
// "8-hour day" (250 x 8) but leaves "Second call" (needs rateSecond
// or rate8+callBonus) and "24-hour call" (needs rate24 /
// hourlyCall1st / weekendRate24) unpriced — verified below through
// facilityPayFor itself before the prompt assertions rely on it.
const HOLZER = {
  id: 'f1', name: 'Holzer', aliases: '', address: '', hourlyRate: '250',
  paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '',
  rateSecond: '', weekendRateSecond: '', callBonus: '', hourlyCall1st: '',
  weekendRate24: '', distance: '', notes: '',
};
const NEW_SHIFTS = [
  { date: '2026-12-07', facility: 'Holzer', type: '8-hour day', code: 'Holzer 8', hours: 8.5, pay: '', facilityKnown: true, status: 'confirmed', uid: 'q1' },
  { date: '2026-12-08', facility: 'Holzer', type: 'Second call', code: '8/2nd call', hours: null, pay: '', facilityKnown: true, status: 'confirmed', uid: 'q2' },
  { date: '2026-12-09', facility: 'Holzer', type: '24-hour call', code: '24/1st call', hours: 24, pay: '', facilityKnown: true, status: 'confirmed', uid: 'q3' },
  { date: '2026-12-10', facility: 'Holzer', type: 'Shift', code: 'Night Float', hours: 12, pay: '', facilityKnown: true, status: 'confirmed', uid: 'q4' },
];

(async () => {
  // ---------- a. Distinct codes in the prompt + row-derived hours ----------
  {
    const w = makeWorld();
    w.state.qgShifts = NEW_SHIFTS;
    w.run(`${SIGNIN} db.facilities = ${JSON.stringify([HOLZER])}; db.shifts = []; db.settings.scheduleName = '';`);
    // Preconditions, stated through the pricing engine itself:
    t('a precondition: hourly-only Holzer prices "8-hour day" canonically',
      w.run(`facilityPayFor(db.facilities[0], '8-hour day', '2026-12-07')`) > 0);
    t('a precondition: hourly-only Holzer cannot price "Second call" or "24-hour call"',
      w.run(`facilityPayFor(db.facilities[0], 'Second call', '2026-12-08')`) === 0 &&
      w.run(`facilityPayFor(db.facilities[0], '24-hour call', '2026-12-09')`) === 0);
    t('a precondition: the code strings themselves price $0 (exclusion must come via type)',
      w.run(`facilityPayFor(db.facilities[0], '8/2nd call', '2026-12-08')`) === 0 &&
      w.run(`facilityPayFor(db.facilities[0], '24/1st call', '2026-12-09')`) === 0 &&
      w.run(`facilityPayFor(db.facilities[0], 'Night Float', '2026-12-10')`) === 0);
    await w.run(`fetchQgendaFeed({})`);
    t('a preview rows carry the 4 distinct codes, in feed order',
      JSON.stringify(w.run(`(schedulePreview.rows || []).map(r => r.code)`)) ===
      JSON.stringify(['Holzer 8', '8/2nd call', '24/1st call', 'Night Float']),
      JSON.stringify(w.run(`(schedulePreview.rows || []).map(r => r.code)`)));
    t('a preview rows carry hours (number preserved, null preserved)',
      w.run(`schedulePreview.rows[0].hours`) === 8.5 &&
      w.run(`schedulePreview.rows[1].hours`) === null &&
      w.run(`schedulePreview.rows[3].hours`) === 12);
    t('a unclarified codes are the distinct unpriced codes, with row hours attached',
      // Nov 9, 2026: entries also carry ctype (the canonical type
      // the code's rows arrived with) and splitType — the two call
      // codes are flagged for the weekday/weekend follow-up because
      // this facility has no call split at all and the codes are
      // being clarified anyway; Night Float is not a call type.
      JSON.stringify(w.run(`unclarifiedCodes(schedulePreview, { name: 'Holzer', fac: db.facilities[0] })`)) ===
      JSON.stringify([{ code: '8/2nd call', hours: '', ctype: 'Second call', splitType: 'Second call' }, { code: '24/1st call', hours: '24', ctype: '24-hour call', splitType: '24-hour call' }, { code: 'Night Float', hours: '12', ctype: '', splitType: '' }]),
      JSON.stringify(w.run(`unclarifiedCodes(schedulePreview, { name: 'Holzer', fac: db.facilities[0] })`)));
    const html = w.run(`importRatesPromptHTML(schedulePreview, 'sched')`);
    // Nov 9, 2026 (evening): the clarification prompt is ONE
    // describe-in-words box. It LISTS the distinct codes it read
    // (the same set the field grid used to ask about, from the
    // same unclarifiedCodes engine) — no per-code fields at all.
    t('a prompt lists "8/2nd call" among the codes it read', html.includes('8/2nd call'));
    t('a prompt lists "24/1st call" among the codes it read', html.includes('24/1st call'));
    t('a prompt lists "Night Float" among the codes it read', html.includes('Night Float'));
    t('a prompt is one words box — no per-code field grid',
      html.includes('describeText') && html.includes('Make my rules') && !html.includes('clarifyCode') && !html.includes('What is'));
    t('a prompt does NOT collapse codes into "Shift" / "Call (unclassified)"',
      !html.includes('“Shift”') && !html.includes('Call (unclassified)'));
    t('a prompt does NOT ask about "Holzer 8" (already priced by its canonical type)',
      !html.includes('Holzer 8'));

    // ---------- b. Canonical-priced exclusion for Second call ----------
    w.run(`db.facilities[0].rateSecond = '3000'; db.facilities[0].weekendRateSecond = '2000';`);
    t('b precondition: Holzer now prices "Second call" canonically (weekday and weekend)',
      w.run(`facilityPayFor(db.facilities[0], 'Second call', '2026-12-08')`) === 3000 &&
      w.run(`facilityPayFor(db.facilities[0], 'Second call', '2026-12-12')`) === 2000);
    const htmlB = w.run(`importRatesPromptHTML(schedulePreview, 'sched')`);
    t('b "8/2nd call" no longer appears in the prompt (priced via its type)',
      !htmlB.includes('8/2nd call'));
    t('b "Night Float" still appears in the prompt', htmlB.includes('Night Float'));
    t('b "24/1st call" still appears in the prompt', htmlB.includes('24/1st call'));
  }

  // ---------- c. Regeneration replaces a stale generic preview ----------
  {
    const w = makeWorld();
    w.state.qgShifts = NEW_SHIFTS;
    w.run(`${SIGNIN} db.facilities = ${JSON.stringify([HOLZER])}; db.shifts = []; db.settings.scheduleName = '';
      schedulePreview = { fileName: 'QGenda feed', source: 'qgenda-feed', matchedName: '', noNamesInFile: false, ai: false, rows: [
        { date: '2026-11-02', facility: 'Holzer', type: 'Shift', code: 'Shift', pay: '', name: '', matchedName: '', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed' },
        { date: '2026-11-03', facility: 'Holzer', type: 'Call (unclassified)', code: 'Call (unclassified)', pay: '', name: '', matchedName: '', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed' },
        { date: '2026-11-04', facility: 'Holzer', type: 'Shift', code: 'Shift', pay: '', name: '', matchedName: '', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed' }
      ] };`);
    t('c precondition: stale generic preview is in place (3 rows)',
      w.run(`schedulePreview.rows.length`) === 3);
    await w.run(`fetchQgendaFeed({})`);
    t('c preview is replaced by exactly the new rows (4, not merged with the stale 3)',
      w.run(`schedulePreview.rows.length`) === 4 &&
      JSON.stringify(w.run(`schedulePreview.rows.map(r => r.code)`)) ===
      JSON.stringify(['Holzer 8', '8/2nd call', '24/1st call', 'Night Float']));
    t('c zero rows carry code "Shift" or "Call (unclassified)"',
      w.run(`schedulePreview.rows.filter(r => r.code === 'Shift' || r.code === 'Call (unclassified)').length`) === 0);
    t('c qgendaPendingNew matches the new count',
      w.run(`qgendaPendingNew`) === 4, 'got ' + w.run(`qgendaPendingNew`));
  }

  // ---------- d. Fetch request body includes the schedule name ----------
  {
    const w = makeWorld();
    w.state.qgShifts = [NEW_SHIFTS[0]];
    w.run(`${SIGNIN} db.facilities = ${JSON.stringify([HOLZER])}; db.shifts = []; db.settings.scheduleName = 'Martin';`);
    await w.run(`fetchQgendaFeed({})`);
    const bodies = w.qgFetchBodies();
    t('d exactly one qgenda fetch was made', bodies.length === 1, 'got ' + bodies.length);
    t('d the fetch request body includes name === "Martin" (the schedule name)',
      bodies.length === 1 && bodies[0].name === 'Martin',
      JSON.stringify(bodies.map((b) => b.name)));
  }

  // ---------- Source pins ----------
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  t('pin: fetch sends the schedule name with the fetch action',
    appSrc.includes(`liveSyncPost('qgenda-feed',{action:'fetch',facilities,name:scheduleName()})`));
  t('pin: preview rows build code + numeric-or-null hours from the response',
    appSrc.includes(`code:String(sh.code||'').trim()`) &&
    appSrc.includes(`hours:(typeof sh.hours==='number'&&isFinite(sh.hours))?sh.hours:null`));
  t('pin: service worker cache bumped to v96',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v159'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
