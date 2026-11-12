// CRNA Hub — v117: two-hospitals banner shows BOTH shifts and can
// delete either one right from the notification (Caleb, Nov 10,
// 2026 ~10:31 PM ET, from his phone screenshot of five stacked
// Dec 1–5 banners that offered only "Got it — leave both").
//
// BUILD: each conflict banner lists both conflicting shifts as
// their own lines — facility + code/type + priced amount (or
// "not priced yet") — and each saved shift's line carries a
// "Delete this shift" button wired to the EXISTING delete flow
// (data-action="delete-shifts": the same confirmation sheet the
// day sheet uses, same tombstones, same live reprice). Deleting
// one side resolves that pair: banner gone, calendar flag clears,
// other days' banners untouched. Held conflicts (sync held the
// incoming shift OUT — only one side is saved): the saved side
// shows with its delete option; the held side is labeled
// "held out — not on your calendar" with a "Keep it out"
// dismissal and NO delete (it isn't saved). "Got it — leave both"
// stays exactly as it was.
// Run: node test-v117-banner-delete.js
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
      if (body && body.function === 'sync-calendar') {
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
  return { run, alerts, store };
}
const drain = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); };
const J = (v) => JSON.stringify(v);

// ---------- fixtures (same shapes as the v116 suite / live account) ----------
const NOTE = 'Schedule import: QGenda feed — matched name "Caleb Martin"';
const HOLZ_FAC = { id: 'fh', name: 'HOLZ', aliases: 'Holzer', address: '100 Jackson Pike, Gallipolis, OH 45631', hourlyRate: '250', paidHours8: '8.5', rate8: '', rate10: '2625', rate12: '', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000', hourlyCall1st: '', callBonus: '', distance: '', notes: '', weekendDays: [0, 6], codeMap: { 'HOLZ - G Main (8)': { label: '8hr day shift', canonicalType: '8-hour day', hours: '8', paidHours: 8.5, rulesConfirmed: true }, 'HOLZ - G Main (10)': { label: '10hour day shift', canonicalType: '10-hour shift', hours: '10', rulesConfirmed: true }, 'HOLZ - Call 1': { label: '24hr call', canonicalType: '24-hour call', hours: '24', weekdayPay: '4800', weekendPay: '4200', rulesConfirmed: true }, 'HOLZ - Call 2': { label: '2nd call', canonicalType: 'Second call', hours: '24', weekdayPay: '3000', weekendPay: '2000', rulesConfirmed: true }, 'HOLZ - PCDO': { label: 'post call day off', canonicalType: '8-hour day', hours: '8', unpaid: true, rulesConfirmed: true } } };
const CAMC_FAC = { id: 'fc', name: 'CAMC', aliases: '', address: '3200 MacCorkle Ave SE, Charleston, WV 25304', hourlyRate: '250', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', hourlyCall1st: '', callBonus: '', distance: '', notes: '', codeMap: { '5**': { label: '10 hour shift', hours: '10' }, '5*': { label: '10 hour shift', hours: '10' }, '7': { label: '12 hour shift', hours: '12' } } };
const NOV = [];
[2, 4, 5, 10, 11, 12, 13, 16, 17, 18, 19, 20, 30].forEach((d) => NOV.push({ d, k: 'G8' }));
[3, 6, 8].forEach((d) => NOV.push({ d, k: 'C2' }));
NOV.push({ d: 7, k: 'C1' });
const DEC = [];
[1, 2, 3, 4, 5, 7, 8, 9, 10, 11].forEach((d) => DEC.push({ d, k: 'G8' }));
DEC.push({ d: 12, k: 'C2' }, { d: 13, k: 'C1' }, { d: 15, k: 'G8' }, { d: 16, k: 'G8' }, { d: 18, k: 'C2' });
const PAY = { G8: () => '2125', C2: (date) => ([0, 6].includes(new Date(date + 'T12:00:00').getDay()) ? '2000' : '3000'), C1: (date) => ([0, 6].includes(new Date(date + 'T12:00:00').getDay()) ? '4200' : '4800') };
const NEWCODE = { G8: 'HOLZ - G Main (8)', C2: 'HOLZ - Call 2', C1: 'HOLZ - Call 1' };
const NEWLABEL = { G8: '8hr day shift', C2: '2nd call', C1: '24hr call' };
function buildShifts(month, roster, idPrefix) {
  return roster.map(({ d, k }) => {
    const date = `2026-${month}-${String(d).padStart(2, '0')}`;
    return { id: `${idPrefix}-${month}-${d}-${k}`, date, facility: 'HOLZ', code: NEWCODE[k], type: NEWLABEL[k], pay: PAY[k](date), payUnit: 'facility', payRate: '', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: false, note: NOTE, updatedAt: '2026-11-10T00:00:00.000Z' };
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
const STUBS = [
  { id: 'psH', agency: 'Holzer', facility: 'Holzer', frequency: 'biweekly', payDate: '2026-11-10', periodStart: '', periodEnd: '', gross: '', net: '', source: 'import', fileName: '', updatedAt: '2026-11-10T00:00:00.000Z' },
  { id: 'psP', agency: 'Premier Anesthesia Group, PC', facility: 'Holzer', frequency: 'biweekly', payDate: '2026-11-10', periodStart: '2026-10-19', periodEnd: '2026-11-01', gross: '12757.50', net: '', source: 'stub', fileName: '', updatedAt: '2026-11-10T00:00:00.000Z' },
];
function fullWorld() {
  const w = makeWorld();
  w.run(`db = empty();
    db.settings.scheduleName = 'Caleb Martin';
    db.facilities = ${J([HOLZ_FAC, CAMC_FAC])};
    db.shifts = ${J([...buildShifts('11', NOV, 'n'), ...buildShifts('12', DEC, 'n'), ...CAMC_SHIFTS, CALLIN])};
    db.payStubs = ${J(STUBS)};
    persist();
    month = new Date(2026, 11, 1);`);
  return w;
}
const HOLZ_DEC1 = 'n-12-1-G8', CAMC_DEC1 = 'n-camc-1';
const bannerSections = (html) => html.match(/<section class="panel conflict-day-alert"[\s\S]*?<\/section>/g) || [];
const bannerFor = (html, dayLabel) => bannerSections(html).find((s) => s.includes(dayLabel)) || '';
const dec1Banner = (html) => bannerFor(html, 'Dec 1:');

(async () => {
  const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
  t('service worker cache is v117', swSrc.includes('crna-hub-shell-v149'));

  // ================= A: baseline pins + banner anatomy =================
  {
    const w = fullWorld();
    t('A baseline pins intact (Nov $39,832.50 / Nov 24 $27,075 / Dec $53,600)',
      w.run(`monthHeadline('2026-11').gross`) === 39832.5 &&
      w.run(`(()=>{const o=paystubOccurrencesInMonth('2026-11').find(x=>x.date==='2026-11-24');return o?paystubOccurrenceTotal(o):null})()`) === 27075 &&
      w.run(`monthHeadline('2026-12').gross`) === 53600);
    const dash = w.run(`dashboard()`);
    const b1 = dec1Banner(dash);
    t('A Dec 1 banner exists (HOLZ + CAMC landed pair)', !!b1);
    t('A banner lists the HOLZ shift as its own line with its price ($2,125.00)',
      b1.includes('HOLZ - G Main (8)') && b1.includes('$2,125.00'), b1.slice(0, 300));
    t('A banner lists the CAMC shift as its own line with its price ($2,500.00)',
      b1.includes('CAMC 5**') && b1.includes('$2,500.00'));
    t('A each listed shift carries a Delete this shift button wired to the shared delete flow',
      b1.includes(`data-action="delete-shifts" data-id="${HOLZ_DEC1}"`) &&
      b1.includes(`data-action="delete-shifts" data-id="${CAMC_DEC1}"`) &&
      (b1.match(/Delete this shift/g) || []).length === 2, b1.slice(0, 400));
    t('A "Got it — leave both" is still there, unchanged',
      b1.includes('data-action="conflict-alert-dismiss"') && b1.includes('Got it — leave both'));
    t('A all five Dec 1–5 banners render (one per clash day)',
      (dash.match(/conflict-day-alert/g) || []).length === 5,
      'count=' + (dash.match(/conflict-day-alert/g) || []).length);
  }

  // ================= B: delete the CAMC side from the banner =================
  {
    const w = fullWorld();
    w.run(`actions('delete-shifts', ${J(CAMC_DEC1)})`);
    t('B tapping Delete in the banner opens the SAME confirmation sheet as the day sheet',
      w.run(`!!shiftDeleteConfirm && shiftDeleteConfirm.id === ${J(CAMC_DEC1)}`) === true &&
      w.run(`dashboard()`).includes('Delete this shift?') &&
      w.run(`dashboard()`).includes(`data-action="shift-delete-confirm" data-id="${CAMC_DEC1}"`));
    await w.run(`actions('shift-delete-confirm', ${J(CAMC_DEC1)})`); await drain();
    t('B the CAMC shift is gone everywhere; the HOLZ shift is untouched',
      w.run(`db.shifts.some(x=>x.id===${J(CAMC_DEC1)})`) === false &&
      w.run(`db.shifts.some(x=>x.id===${J(HOLZ_DEC1)})`) === true);
    t('B December headline drops by exactly the deleted shift ($53,600 → $51,100)',
      w.run(`monthHeadline('2026-12').gross`) === 51100, 'got ' + w.run(`monthHeadline('2026-12').gross`));
    const dash = w.run(`dashboard()`);
    t('B the Dec 1 banner is gone; the Dec 2–5 banners are unaffected',
      !dec1Banner(dash) && (dash.match(/conflict-day-alert/g) || []).length === 4,
      'count=' + (dash.match(/conflict-day-alert/g) || []).length);
    t('B November pins untouched by the banner delete (Nov $39,832.50 / Nov 24 $27,075)',
      w.run(`monthHeadline('2026-11').gross`) === 39832.5 &&
      w.run(`(()=>{const o=paystubOccurrencesInMonth('2026-11').find(x=>x.date==='2026-11-24');return o?paystubOccurrenceTotal(o):null})()`) === 27075);
    t('B the calendar flag for Dec 1 cleared with the pair',
      w.run(`activeDayConflicts().some(c=>c.date==='2026-12-01')`) === false &&
      w.run(`activeDayConflicts().some(c=>c.date==='2026-12-02')`) === true);
  }

  // ================= C: delete the HOLZ side instead (symmetric) =================
  {
    const w = fullWorld();
    w.run(`actions('delete-shifts', ${J(HOLZ_DEC1)})`);
    await w.run(`actions('shift-delete-confirm', ${J(HOLZ_DEC1)})`); await drain();
    t('C deleting the HOLZ side removes it and keeps the CAMC shift',
      w.run(`db.shifts.some(x=>x.id===${J(HOLZ_DEC1)})`) === false &&
      w.run(`db.shifts.some(x=>x.id===${J(CAMC_DEC1)})`) === true);
    t('C December headline drops by exactly $2,125 ($53,600 → $51,475)',
      w.run(`monthHeadline('2026-12').gross`) === 51475, 'got ' + w.run(`monthHeadline('2026-12').gross`));
    t('C the Dec 1 banner cleared', !dec1Banner(w.run(`dashboard()`)));
  }

  // ================= D: cancel keeps everything; leave-both still works =================
  {
    const w = fullWorld();
    w.run(`actions('delete-shifts', ${J(CAMC_DEC1)})`);
    w.run(`actions('shift-delete-cancel')`);
    t('D cancelling the confirmation deletes nothing and the banner stays',
      w.run(`db.shifts.some(x=>x.id===${J(CAMC_DEC1)})`) === true &&
      !!dec1Banner(w.run(`dashboard()`)) &&
      w.run(`monthHeadline('2026-12').gross`) === 53600);
    const sig = w.run(`activeDayConflicts().find(c=>c.date==='2026-12-01').signature`);
    w.run(`actions('conflict-alert-dismiss', ${J(sig)})`);
    t('D "Got it — leave both" still dismisses with no data change (and stays dismissed)',
      !dec1Banner(w.run(`dashboard()`)) &&
      w.run(`db.shifts.filter(x=>x.date==='2026-12-01').length`) === 2 &&
      w.run(`monthHeadline('2026-12').gross`) === 53600);
  }

  // ================= E: held conflict =================
  {
    const mkHeld = () => {
      const w = makeWorld();
      w.run(`db = empty();
        db.settings.scheduleName = 'Caleb Martin';
        db.facilities = ${J([HOLZ_FAC, CAMC_FAC])};
        db.shifts = [{ id: 'h1', date: '2026-12-02', facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125', payUnit: 'facility', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: false, note: '', updatedAt: '2026-11-10T00:00:00.000Z' }];
        db.payStubs = []; persist();
        month = new Date(2026, 11, 1);`);
      w.run(`liveSyncApplyChanges('apple', { providerChanges: [{ action: 'create', shift: { id: 'srv-camc', date: '2026-12-02', facility: 'CAMC', type: '10 hour shift', code: '5**', pay: '2500', note: 'Imported from Caleb Work Schedule', source: 'apple-import' } }], pendingDeletions: [], shiftSync: [] })`);
      return w;
    };
    const w = mkHeld();
    const dash = w.run(`dashboard()`);
    const heldSection = (dash.match(/<section class="panel conflict-day-alert"[\s\S]*?<\/section>/) || [''])[0];
    t('E held banner renders', !!heldSection && heldSection.includes('booked at two hospitals on'));
    t('E held side is labeled "held out — not on your calendar" with a Keep it out button and NO delete for it',
      heldSection.includes('held out — not on your calendar') &&
      heldSection.includes('data-action="conflict-held-keep-out"') &&
      heldSection.includes('Keep it out'));
    t('E the saved side shows its price and the ONLY delete button in the banner is the saved shift',
      heldSection.includes('$2,125.00') &&
      heldSection.includes('data-action="delete-shifts" data-id="h1"') &&
      (heldSection.match(/data-action="delete-shifts"/g) || []).length === 1,
      heldSection.slice(0, 400));
    const sig = w.run(`activeDayConflicts()[0].signature`);
    w.run(`actions('conflict-held-keep-out', ${J(sig)})`);
    t('E "Keep it out" dismisses the banner and changes no data',
      !w.run(`dashboard()`).includes('conflict-day-alert') &&
      w.run(`db.shifts.length`) === 1);
    // deleting the saved side clears a held banner too
    const w2 = mkHeld();
    w2.run(`actions('delete-shifts', 'h1')`);
    await w2.run(`actions('shift-delete-confirm', 'h1')`); await drain();
    t('E deleting the saved side clears the held banner (nothing left to conflict)',
      w2.run(`db.shifts.length`) === 0 && !w2.run(`dashboard()`).includes('conflict-day-alert'));
  }

  // ================= F: unpriced shift line =================
  {
    const w = fullWorld();
    w.run(`db.shifts.push({ id: 'r1', date: '2026-12-07', facility: 'Riverside', code: '', type: '8-hour day', pay: '', payUnit: '', status: 'confirmed', source: 'schedule-import', sources: ['schedule-import'], incomplete: true, note: '', updatedAt: '2026-11-10T00:00:00.000Z' }); persist();`);
    const dash = w.run(`dashboard()`);
    const m = bannerFor(dash, 'Dec 7:');
    t('F an unpriced conflicting shift reads "not priced yet" on its banner line',
      !!m && m.includes('Riverside') && m.includes('not priced yet'), m ? m.slice(0, 300) : 'no Dec 7 banner');
    t('F the unpriced shift still gets its own delete button',
      !!m && m.includes('data-action="delete-shifts" data-id="r1"'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('SUITE ERROR', e); process.exitCode = 1; });
