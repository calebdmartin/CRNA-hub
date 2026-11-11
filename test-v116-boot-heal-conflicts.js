// CRNA Hub — v116: boot-check doubling regression + cross-hospital
// day alerts (Nov 10, 2026, live verification of v115 ~9:39 PM ET).
//
// WHAT HAPPENED LIVE: on reload with v115 the test account read
// CORRECT (November 17 shifts, headline $39,832.50, December
// $53,600). Within the same minute — the QGenda panel stamped
// "Last checked 9:39 PM" — the data DOUBLED (November 34 shifts,
// headline $66,907.50, December $94,200, HOLZ YTD doubled) and a
// stray empty "Holzer" facility card appeared. A manual feed check
// afterwards behaved perfectly (128 duplicates, 0 added): the
// approve path was never the door.
//
// PROVEN MECHANISM (this suite reproduces it on the pre-fix code
// by construction of the fixture): the first paint was local data
// only. The doubling entered through cloudAutoMerge — the boot
// step cloudInit runs BEFORE qgendaBootCheck — unioning the cloud
// by record ID. The cloud still holds the QGenda PARSER-V2-ERA
// generation of the same schedule (facility "Holzer", codes
// "Holzer 8" / "8/2nd call" / "Holzer 24/1st call", canonical
// types), approved on another device in that era, alongside the
// current generation (facility "HOLZ", raw codes "HOLZ - G Main
// (8)", clarified label types like "8hr day shift"). v115 identity
// decided by CODE ALONE whenever both records carried one, and the
// renamed codes never matched — so no pair collapsed, and the same
// merge unioned the era's empty "Holzer" facility record. The
// QGenda boot check itself saves nothing (pinned byte-identical
// here); it only shared the minute. A second hole: the dedupe heal
// ran only at script load and inside the cloud merge, so any pair
// completed mid-session (calendar sync applying afterwards)
// survived until the next reload.
//
// FIXES: (1) identity — when both codes are present but unequal,
// a renamed-code fallback can still match: same canonical KIND,
// neither code a separately DEFINED code at the facility, and any
// pay both records state agrees; canonicalTypeOf now also reads
// "8hr"-style and trailing "(8)" hour counts and bare "Call 1/2".
// (2) Ordering — one healShiftsAfterChange() (dedupe + day/call
// pairs + variant-shell fold) now runs at the end of the cloud
// merge, of every calendar-sync application, of backup restore,
// and at boot. (3) The empty variant shell folds into the ruled
// facility as an alias. (4) Caleb's two new rules: the same shift
// never double-counts through ANY door (QGenda, calendar sync,
// schedule upload, contract — all funnel through the one identity),
// and a cross-hospital same-day clash that lands (or is held at
// the sync door) raises a persistent Dashboard banner + calendar
// flag naming the date and both shifts until dismissed or resolved.
// Run: node test-v116-boot-heal-conflicts.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
}
function makeWorld(seedDb) {
  const store = new Map();
  if (seedDb) store.set('crna-hub-v2', JSON.stringify(seedDb));
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
  const state = { qgShifts: [] };
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
      addEventListener() {},
    },
    window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
    alert: (m) => { alerts.push(String(m)); },
    confirm: () => true,
    fetch: async (url, opts) => {
      let body = null;
      try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
      let data = { ok: true };
      if (body && body.function === 'qgenda-feed') {
        if (body.action === 'status') data = { connected: true, masked: 'app.qgenda.com/…', parserVersion: 6 };
        else if (body.action === 'fetch') data = { ok: true, masked: 'app.qgenda.com/…', parserVersion: 6, shifts: state.qgShifts };
      } else if (body && body.function === 'sync-calendar') {
        if (body.action === 'sync') data = { ok: true, providerChanges: [], pendingDeletions: [], shiftSync: [] };
        else if (body.action === 'status') data = { connections: [] };
        else if (body.action === 'log') data = { log: [] };
        else if (body.action === 'config') data = { state: 'ready', apple: false, google: false, outlook: false, encryption: true };
      }
      return { status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data };
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
  return { run, alerts, state, store };
}
const drain = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); };
const J = (v) => JSON.stringify(v);

// ---------- fixtures (shared with the live account's shape) ----------
const NOTE = 'Schedule import: QGenda feed — matched name "Caleb Martin"';
const HOLZ_FAC = { id: 'fh', name: 'HOLZ', aliases: 'Holzer', address: '100 Jackson Pike, Gallipolis, OH 45631', hourlyRate: '250', paidHours8: '8.5', rate8: '', rate10: '2625', rate12: '', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000', hourlyCall1st: '', callBonus: '', distance: '', notes: '', weekendDays: [0, 6], codeMap: { 'HOLZ - G Main (8)': { label: '8hr day shift', canonicalType: '8-hour day', hours: '8', paidHours: 8.5, rulesConfirmed: true }, 'HOLZ - G Main (10)': { label: '10hour day shift', canonicalType: '10-hour shift', hours: '10', rulesConfirmed: true }, 'HOLZ - Call 1': { label: '24hr call', canonicalType: '24-hour call', hours: '24', weekdayPay: '4800', weekendPay: '4200', rulesConfirmed: true }, 'HOLZ - Call 2': { label: '2nd call', canonicalType: 'Second call', hours: '24', weekdayPay: '3000', weekendPay: '2000', rulesConfirmed: true }, 'HOLZ - PCDO': { label: 'post call day off', canonicalType: '8-hour day', hours: '8', unpaid: true, rulesConfirmed: true } } };
const HOLZER_SHELL = { id: 'fz', name: 'Holzer', aliases: '', address: '', hourlyRate: '', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', hourlyCall1st: '', callBonus: '', distance: '', notes: '', codeMap: {} };
const CAMC_FAC = { id: 'fc', name: 'CAMC', aliases: '', address: '3200 MacCorkle Ave SE, Charleston, WV 25304', hourlyRate: '250', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', hourlyCall1st: '', callBonus: '', distance: '', notes: '', codeMap: { '5**': { label: '10 hour shift', hours: '10' }, '5*': { label: '10 hour shift', hours: '10' }, '7': { label: '12 hour shift', hours: '12' } } };
const NOV = [];
[2, 4, 5, 10, 11, 12, 13, 16, 17, 18, 19, 20, 30].forEach((d) => NOV.push({ d, k: 'G8' }));
[3, 6, 8].forEach((d) => NOV.push({ d, k: 'C2' }));
NOV.push({ d: 7, k: 'C1' });
const DEC = [];
[1, 2, 3, 4, 5, 7, 8, 9, 10, 11].forEach((d) => DEC.push({ d, k: 'G8' }));
DEC.push({ d: 12, k: 'C2' }, { d: 13, k: 'C1' }, { d: 15, k: 'G8' }, { d: 16, k: 'G8' }, { d: 18, k: 'C2' });
const OCT = [];
[1, 2, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30].forEach((d) => OCT.push({ d, k: 'G8' }));
[3, 4, 10, 11, 17, 18, 24, 25].forEach((d) => OCT.push({ d, k: 'C2W' }));
OCT.push({ d: 3, k: 'C1W' }, { d: 17, k: 'C1W' });
const PAY = { G8: () => '2125', C2: (date) => ([0, 6].includes(new Date(date + 'T12:00:00').getDay()) ? '2000' : '3000'), C1: (date) => ([0, 6].includes(new Date(date + 'T12:00:00').getDay()) ? '4200' : '4800'), C2W: () => '2000', C1W: () => '4200' };
const NEWCODE = { G8: 'HOLZ - G Main (8)', C2: 'HOLZ - Call 2', C1: 'HOLZ - Call 1', C2W: 'HOLZ - Call 2', C1W: 'HOLZ - Call 1' };
const NEWLABEL = { G8: '8hr day shift', C2: '2nd call', C1: '24hr call', C2W: '2nd call', C1W: '24hr call' };
const OLDCODE = { G8: 'Holzer 8', C2: '8/2nd call', C1: 'Holzer 24/1st call', C2W: '8/2nd call', C1W: 'Holzer 24/1st call' };
const OLDTYPE = { G8: '8-hour day', C2: 'Second call', C1: '24-hour call', C2W: 'Second call', C1W: '24-hour call' };
function buildShifts(month, roster, gen, idPrefix) {
  return roster.map(({ d, k }) => {
    const date = `2026-${month}-${String(d).padStart(2, '0')}`;
    const base = { id: `${idPrefix}-${month}-${d}-${k}`, date, pay: PAY[k](date), status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: false, note: NOTE, updatedAt: '2026-11-10T00:00:00.000Z' };
    if (gen === 'new') return { ...base, facility: 'HOLZ', code: NEWCODE[k], type: NEWLABEL[k], payUnit: 'facility', payRate: '' };
    return { ...base, facility: 'Holzer', code: OLDCODE[k], type: OLDTYPE[k], payUnit: 'facility', payRate: '' };
  });
}
const CAMC_SHIFTS = [
  { id: 'n-camc-1', date: '2026-12-01', facility: 'CAMC', code: '5**', type: '10 hour shift', pay: '2500', payUnit: 'facility', status: 'confirmed', source: 'schedule-import-ai', sources: ['schedule-import-ai'], incomplete: false, note: '', updatedAt: '2026-11-10T00:00:00.000Z' },
  { id: 'n-camc-2', date: '2026-12-02', facility: 'CAMC', code: '5*', type: '10 hour shift', pay: '2500', payUnit: 'facility', status: 'confirmed', source: 'schedule-import-ai', sources: ['schedule-import-ai'], incomplete: false, note: '', updatedAt: '2026-11-10T00:00:00.000Z' },
  { id: 'n-camc-3', date: '2026-12-03', facility: 'CAMC', code: '5**', type: '10 hour shift', pay: '2500', payUnit: 'facility', status: 'confirmed', source: 'schedule-import-ai', sources: ['schedule-import-ai'], incomplete: false, note: '', updatedAt: '2026-11-10T00:00:00.000Z' },
  { id: 'n-camc-4', date: '2026-12-04', facility: 'CAMC', code: '5*', type: '10 hour shift', pay: '2500', payUnit: 'facility', status: 'confirmed', source: 'schedule-import-ai', sources: ['schedule-import-ai'], incomplete: false, note: '', updatedAt: '2026-11-10T00:00:00.000Z' },
  { id: 'n-camc-5', date: '2026-12-05', facility: 'CAMC', code: '7', type: '12 hour shift', pay: '3000', payUnit: 'facility', status: 'confirmed', source: 'schedule-import-ai', sources: ['schedule-import-ai'], incomplete: false, note: '', updatedAt: '2026-11-10T00:00:00.000Z' },
];
const CALLIN = { id: 'n-callin', date: '2026-12-10', facility: 'HOLZ', code: '', type: 'Other', pay: '400', payUnit: '', status: 'confirmed', source: 'user-entered', sources: ['user-entered'], incomplete: false, note: 'Called in', updatedAt: '2026-11-10T00:00:00.000Z' };
const genNew = [...buildShifts('10', OCT, 'new', 'n'), ...buildShifts('11', NOV, 'new', 'n'), ...buildShifts('12', DEC, 'new', 'n'), ...CAMC_SHIFTS, CALLIN];
const genOld = [...buildShifts('10', OCT, 'old', 'o'), ...buildShifts('11', NOV, 'old', 'o'), ...buildShifts('12', DEC, 'old', 'o')];
const STUBS = [
  { id: 'psH', agency: 'Holzer', facility: 'Holzer', frequency: 'biweekly', payDate: '2026-11-10', periodStart: '', periodEnd: '', gross: '', net: '', source: 'import', fileName: '', updatedAt: '2026-11-10T00:00:00.000Z' },
  { id: 'psP', agency: 'Premier Anesthesia Group, PC', facility: 'Holzer', frequency: 'biweekly', payDate: '2026-11-10', periodStart: '2026-10-19', periodEnd: '2026-11-01', gross: '12757.50', net: '', source: 'stub', fileName: '', updatedAt: '2026-11-10T00:00:00.000Z' },
];
function feedRows() {
  const rows = [];
  const push = (month, roster) => roster.forEach(({ d, k }) => {
    const date = `2026-${month}-${String(d).padStart(2, '0')}`;
    rows.push({ date, facility: 'HOLZ', code: NEWCODE[k], type: NEWCODE[k], pay: '', hours: 8, facilityKnown: true });
  });
  push('10', OCT); push('11', NOV); push('12', DEC);
  rows.push({ date: '2026-11-09', facility: 'Holzer', code: 'HOLZ - PCDO', type: 'HOLZ - PCDO', pay: '', hours: null, facilityKnown: false });
  return rows;
}
const todayISO = new Date().toISOString().slice(0, 10);
const singleGenYTD = genNew.filter((x) => x.facility === 'HOLZ' && x.date <= todayISO).reduce((s, x) => s + Number(x.pay || 0), 0);
const snapOf = (run) => run(`JSON.stringify({ shifts: db.shifts, facilities: db.facilities, payStubs: db.payStubs })`);
const metrics = (run) => ({
  shifts: run(`db.shifts.length`),
  nov: run(`db.shifts.filter(x=>x.date.startsWith('2026-11')).length`),
  facNames: run(`db.facilities.map(f=>f.name)`),
  novHead: run(`monthHeadline('2026-11').gross`),
  decHead: run(`monthHeadline('2026-12').gross`),
  nov24: run(`(()=>{const o=paystubOccurrencesInMonth('2026-11').find(x=>x.date==='2026-11-24');return o?paystubOccurrenceTotal(o):null})()`),
  ytd: run(`facilityYearToDate(db.facilities.find(f=>f.name==='HOLZ'))`),
});

(async () => {
  const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
  t('service worker cache is v116', swSrc.includes('crna-hub-shell-v116'));

  // ================= Part A: the boot sequence =================
  {
    const w = makeWorld();
    w.run(`db = empty();
      db.settings.scheduleName = 'Caleb Martin';
      db.settings.qgendaConnected = true;
      db.facilities = ${J([HOLZ_FAC, CAMC_FAC])};
      db.shifts = ${J(genNew)};
      db.payStubs = ${J(STUBS)};
      persist();
      cloudSession = { access_token: 'tok', user: { id: 'u1', email: 'calebdmartin621@gmail.com' } };
      cloudActive = true;
      sbReq = async () => [];
      cloudFetchAll = async () => globalThis.__cloudData;
      cloudUploadLocal = async () => true;
      globalThis.__cloudData = { nbcrna: null, aana: null, portals: [], documents: [], licenses: [], ce: [],
        shifts: ${J([...genNew, ...genOld])}, facilities: ${J([HOLZ_FAC, CAMC_FAC, HOLZER_SHELL])},
        mileage: [], payStubs: ${J(STUBS)}, vehicles: [], settings: null };`);
    w.state.qgShifts = feedRows();
    const m0 = metrics(w.run);
    t('A0 local first paint is the healed state (Nov 17, $39,832.50 / Dec $53,600)',
      m0.nov === 17 && m0.novHead === 39832.5 && m0.decHead === 53600 && m0.nov24 === 27075, J(m0));
    await w.run(`cloudAutoMerge()`); await drain();
    const m1 = metrics(w.run);
    t('A1 cloud merge no longer doubles: November stays 17 shifts', m1.nov === 17 && m1.shifts === m0.shifts, J(m1));
    t('A1 totals unchanged by the merge ($39,832.50 / Nov 24 $27,075 / Dec $53,600)',
      m1.novHead === 39832.5 && m1.nov24 === 27075 && m1.decHead === 53600, J(m1));
    t('A1 stray "Holzer" shell folded away — facilities are exactly HOLZ + CAMC, Holzer kept as an alias',
      J(m1.facNames) === J(['HOLZ', 'CAMC']) && w.run(`facilityAliases(db.facilities[0]).includes('Holzer')`) === true, J(m1.facNames));
    t('A1 facility YTD is the single-generation figure (not doubled)', m1.ytd === singleGenYTD, m1.ytd + ' vs ' + singleGenYTD);
    const beforeCheck = snapOf(w.run);
    await w.run(`qgendaBootCheck()`); await drain();
    t('A2 boot check with an all-saved feed changes NOTHING (shifts/facilities/stubs byte-identical)',
      snapOf(w.run) === beforeCheck);
    w.run(`qgendaBootChecked = false;`);
    await w.run(`cloudAutoMerge()`); await drain();
    await w.run(`qgendaBootCheck()`); await drain();
    t('A3 repeated opens change nothing (byte-identical state)', snapOf(w.run) === beforeCheck);
  }

  // ================= Part B: doubled state, plain open =================
  {
    const doubledDb = {
      settings: { scheduleName: 'Caleb Martin', qgendaConnected: true },
      facilities: [HOLZ_FAC, CAMC_FAC, HOLZER_SHELL],
      shifts: [...genNew, ...genOld],
      payStubs: STUBS,
    };
    const w = makeWorld(doubledDb); // app.js boot heals run at load
    const m = metrics(w.run);
    t('B plain open heals the doubled state: November back to 17 shifts', m.nov === 17, J(m));
    t('B totals restored ($39,832.50 / Nov 24 $27,075 / Dec $53,600, YTD single-generation)',
      m.novHead === 39832.5 && m.nov24 === 27075 && m.decHead === 53600 && m.ytd === singleGenYTD, J(m));
    t('B stray shell folded at open; HOLZ keeps "Holzer" as an alias',
      J(m.facNames) === J(['HOLZ', 'CAMC']) && w.run(`facilityAliases(db.facilities[0]).includes('Holzer')`) === true, J(m.facNames));
  }

  // ================= Part C: identity safety =================
  {
    const w = makeWorld();
    w.run(`db = empty(); db.facilities = ${J([HOLZ_FAC, CAMC_FAC])}; db.shifts = []; persist();`);
    const same = (a, b) => w.run(`shiftsSameShift(${J(a)}, ${J(b)})`);
    const g8new = { date: '2026-12-02', facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125' };
    const g8old = { date: '2026-12-02', facility: 'Holzer', code: 'Holzer 8', type: '8-hour day', pay: '2125' };
    t('C renamed-code pair IS the same shift (Holzer 8 == HOLZ - G Main (8))', same(g8new, g8old) === true);
    t('C renamed pair with DIFFERENT stated pays stays two shifts',
      same(g8new, { ...g8old, pay: '2500' }) === false);
    t('C G Main (8) vs G Main (10) same day stay two shifts',
      same(g8new, { date: '2026-12-02', facility: 'HOLZ', code: 'HOLZ - G Main (10)', type: '10hour day shift', pay: '2625' }) === false);
    t('C day + call same facility same day stay two shifts',
      same(g8new, { date: '2026-12-02', facility: 'HOLZ', code: 'HOLZ - Call 2', type: '2nd call', pay: '3000' }) === false);
    t('C two DEFINED codes at one facility stay two shifts (CAMC 5** vs 5*)',
      same({ date: '2026-12-02', facility: 'CAMC', code: '5**', type: '10 hour shift', pay: '2500' },
           { date: '2026-12-02', facility: 'CAMC', code: '5*', type: '10 hour shift', pay: '2500' }) === false);
    // Fold safety
    w.run(`db.facilities = [
      {id:'r1',name:'Holzer',aliases:'',address:'',hourlyRate:'250',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',rateSecond:'',weekendRateSecond:'',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}},
      {id:'r2',name:'HOLZ',aliases:'',address:'',hourlyRate:'',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',rateSecond:'',weekendRateSecond:'',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}},
      {id:'r3',name:'Riverside',aliases:'',address:'',hourlyRate:'',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',rateSecond:'',weekendRateSecond:'',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}}
    ]; db.shifts = []; healVariantFacilityRecords();`);
    t('C fold safety: a variant WITH rates and a non-variant shell are never folded (the empty HOLZ shell folds into ruled Holzer)',
      w.run(`db.facilities.map(f=>f.name).join(',')`) === 'Holzer,Riverside' &&
      w.run(`facilityAliases(db.facilities[0]).includes('HOLZ')`) === true,
      w.run(`db.facilities.map(f=>f.name).join(',')`));
  }

  // ================= Part D: one shift, four doors =================
  {
    const w = makeWorld();
    w.run(`db = empty();
      db.settings.scheduleName = 'Caleb Martin';
      db.settings.qgendaConnected = true;
      db.facilities = ${J([HOLZ_FAC])};
      db.shifts = []; db.payStubs = [];
      persist();
      cloudSession = { access_token: 'tok', user: { id: 'u1', email: 'calebdmartin621@gmail.com' } };
      cloudActive = true;`);
    // Door 1: QGenda approve
    w.run(`schedulePreview = { fileName: 'QGenda feed', source: 'qgenda-feed', matchedName: 'Caleb Martin', noNamesInFile: false, ai: false,
      rows: [{ date: '2026-12-02', facility: 'HOLZ', type: 'HOLZ - G Main (8)', code: 'HOLZ - G Main (8)', hours: 8, pay: '2125', name: 'Caleb Martin', matchedName: 'Caleb Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed', incomplete: false }] };
      approveScheduleImport();`);
    t('D1 QGenda approve saves the shift once', w.run(`db.shifts.length`) === 1, 'n=' + w.run(`db.shifts.length`));
    // Door 2: calendar sync delivers the same shift (server shape: facility full name, canonical type)
    const res2 = w.run(`liveSyncApplyChanges('apple', { providerChanges: [{ action: 'create', shift: { id: 'srv-ev-1', date: '2026-12-02', facility: 'Holzer', type: '8-hour day', pay: '2125', note: 'Imported from Caleb Work Schedule', source: 'apple-import' } }], pendingDeletions: [], shiftSync: [] })`);
    t('D2 calendar sync merges into the same shift (no second copy, no hold)',
      w.run(`db.shifts.length`) === 1 && res2.created === 0, J(res2));
    // Door 3: schedule upload approve
    w.run(`schedulePreview = { fileName: 'sched.csv', source: 'schedule-import', matchedName: '', noNamesInFile: false, ai: false,
      rows: [{ date: '2026-12-02', facility: 'HOLZ', type: '8-hour day', code: '', pay: '2125', name: '', matchedName: '', match: 'matched', include: true, duplicate: true, flags: [], source: 'schedule-import', incomplete: false }] };
      approveScheduleImport();`);
    t('D3 schedule upload merges into the same shift', w.run(`db.shifts.length`) === 1, 'n=' + w.run(`db.shifts.length`));
    // Door 4: a second QGenda check + approve
    w.state.qgShifts = [{ date: '2026-12-02', facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: 'HOLZ - G Main (8)', pay: '', hours: 8, facilityKnown: true }];
    await w.run(`fetchQgendaFeed()`); await drain();
    t('D4 second QGenda check reads the row as a duplicate', w.run(`!!(schedulePreview && schedulePreview.rows[0] && schedulePreview.rows[0].duplicate)`) === true);
    w.run(`approveScheduleImport();`);
    const srcs = w.run(`shiftSourcesList(db.shifts[0])`);
    t('D4 still exactly ONE shift after the second QGenda approve', w.run(`db.shifts.length`) === 1);
    t('D all four sources recorded on the one shift, priced once ($2,125)',
      ['qgenda-feed', 'apple-import', 'schedule-import'].every((s) => srcs.includes(s)) && w.run(`db.shifts[0].pay`) === '2125',
      J(srcs) + ' pay=' + w.run(`db.shifts[0].pay`));
  }

  // ================= Part E: cross-hospital day alerts =================
  {
    const mkE = () => {
      const w = makeWorld();
      w.run(`db = empty();
        db.settings.scheduleName = 'Caleb Martin';
        db.facilities = ${J([HOLZ_FAC, CAMC_FAC])};
        db.shifts = [{ id: 'h1', date: '2026-12-02', facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125', payUnit: 'facility', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: false, note: '', updatedAt: '2026-11-10T00:00:00.000Z' }];
        db.payStubs = []; persist();
        month = new Date(2026, 11, 1);`);
      return w;
    };
    const camcCreate = { providerChanges: [{ action: 'create', shift: { id: 'srv-camc', date: '2026-12-02', facility: 'CAMC', type: '10 hour shift', code: '5**', pay: '2500', note: 'Imported from Caleb Work Schedule', source: 'apple-import' } }], pendingDeletions: [], shiftSync: [] };
    // (a) sync delivers a CAMC shift onto a HOLZ day -> banner + calendar flag
    const wa = mkE();
    const resA = wa.run(`liveSyncApplyChanges('apple', ${J(camcCreate)})`);
    const dashA = wa.run(`dashboard()`);
    t('E(a) sync-held cross-hospital clash raises the Dashboard banner naming both hospitals/shifts',
      dashA.includes('booked at two hospitals on') && dashA.includes('Dec 2') && dashA.includes('CAMC') && dashA.includes('HOLZ - G Main (8)'),
      dashA.slice(0, 0));
    t('E(a) the day is flagged on the calendar', wa.run(`calendar()`).includes('⚠ 2 hospitals'));
    t('E(a) the incoming shift itself was held out by the guard (named in the sync result)',
      resA.created === 0 && (resA.conflicts || []).length === 1, J(resA));
    // (e) repeated syncs/opens do not duplicate the alert
    wa.run(`liveSyncApplyChanges('apple', ${J(camcCreate)})`);
    const dashA2 = wa.run(`dashboard()`);
    t('E(e) repeated syncs do not duplicate the alert',
      (dashA2.match(/conflict-day-alert/g) || []).length === 1,
      'count=' + (dashA2.match(/conflict-day-alert/g) || []).length);
    // (b) dismissing keeps shifts unchanged
    const sig = wa.run(`activeDayConflicts()[0].signature`);
    t('E(b) the dismiss button is wired to an action', fs.readFileSync(R + 'app.js', 'utf8').includes("action==='conflict-alert-dismiss'"));
    wa.run(`actions('conflict-alert-dismiss', ${J(sig)})`);
    const dashB = wa.run(`dashboard()`);
    t('E(b) dismissing hides the banner and keeps every shift unchanged',
      !dashB.includes('conflict-day-alert') && wa.run(`db.shifts.length`) === 1);
    // (c) deleting the saved side clears the alert on its own
    const wc = mkE();
    wc.run(`liveSyncApplyChanges('apple', ${J(camcCreate)})`);
    t('E(c) alert present before the delete', wc.run(`dashboard()`).includes('conflict-day-alert'));
    wc.run(`db.shifts = db.shifts.filter(x => x.id !== 'h1'); persist();`);
    t('E(c) deleting the saved shift clears the alert (no dismiss needed)',
      !wc.run(`dashboard()`).includes('conflict-day-alert'));
    // (d) day + call at the SAME facility is one assignment — no alert
    const wd = mkE();
    wd.run(`db.shifts.push({ id: 'h2', date: '2026-12-02', facility: 'HOLZ', code: 'HOLZ - Call 2', type: '2nd call', pay: '3000', payUnit: 'facility', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: false, note: '', updatedAt: '2026-11-10T00:00:00.000Z' }); persist();`);
    t('E(d) day + call at the same facility raises NO alert',
      !wd.run(`dashboard()`).includes('conflict-day-alert') && wd.run(`crossFacilityDayConflicts().length`) === 0);
    // landed pair (cloud/restore style): both saved -> banner; delete one -> clears
    const we = mkE();
    we.run(`db.shifts.push({ id: 'c1', date: '2026-12-02', facility: 'CAMC', code: '5**', type: '10 hour shift', pay: '2500', payUnit: 'facility', status: 'confirmed', source: 'schedule-import-ai', sources: ['schedule-import-ai'], incomplete: false, note: '', updatedAt: '2026-11-10T00:00:00.000Z' }); persist();`);
    const dashE = we.run(`dashboard()`);
    t('E landed cross-hospital pair banners with both named (CAMC 5** / HOLZ - G Main (8))',
      dashE.includes('booked at two hospitals on') && dashE.includes('CAMC 5**') && dashE.includes('HOLZ - G Main (8)'));
    we.run(`db.shifts = db.shifts.filter(x => x.id !== 'c1'); persist();`);
    t('E deleting one side of a landed pair clears the banner', !we.run(`dashboard()`).includes('conflict-day-alert'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('SUITE ERROR', e); process.exitCode = 1; });
