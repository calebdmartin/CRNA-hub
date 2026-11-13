// CRNA Hub — v163: one price per shift, everywhere (the proposed-
// email override bug) + the scheduler email carries NO money.
//
// BUG (caught Nov 13, 2026 by Caleb's video review of his REAL
// account, April 2027): a manually added shift whose typed Expected
// gross differed from the facility rate card was priced two ways.
// The calendar/engine honoured the typed amount (the month total
// rose by exactly the typed figure), but "Email proposed shifts"
// priced its picker rows straight from the rate card
// (propEmailPrice -> resolveShiftPrice) and ignored the stored
// amount. Root cause: the email path recomputed instead of reading
// the shared result. Fix: a single per-shift display price,
// shiftDisplayPrice() — effectiveShiftPay for a priced shift (a
// typed amount is a fact and stands; a saved code definition still
// wins over a derived stamp), the live card price for a shift with
// no usable stamp (exactly as paystubPeriodTotals treats it), null
// when nothing can price it. The picker routes through it.
//
// REQUIREMENT CHANGE (Caleb, Nov 13, 2026): the email TO THE
// SCHEDULER carries no money at all — no per-shift figures, no
// total. Dates and shift types only. (v118's body-price pin was
// updated with this reason recorded.)
//
// PIN UPDATE (v164, Caleb, Nov 13, 2026): the picker SHEET is
// money-free too. Caleb re-screenshotted the sheet — its heading
// says "These proposed shifts will be listed in the email:" — and
// ruled: no income anywhere on that flow. The rows now show date +
// shift type only, exactly what the scheduler receives, so the
// sheet is literally what gets sent. The v163 picker-price pins
// below (override row $2,000.00, card rows $2,125.00) are therefore
// SUPERSEDED and rewritten to pin NO money on the sheet. The shared
// shiftDisplayPrice() engine pins stand: calendar, day sheet,
// paychecks and the assistant still price consistently — only this
// email flow displays no prices.
//
// Fixture is generic (no user's facilities or figures): a facility
// whose card prices an 8-hour day at $2,125 (hourly 250 x 8.5 paid
// hours) and a hand-added proposed shift typed at $2,000 — the
// incident's shape, nobody's data.
// Run: node test-v163-email-override-pricing.js
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
    window: null, navigator: {},
    location: { protocol: 'https:', search: '', pathname: '/', href: '' },
    alert: (m) => { alerts.push(String(m)); },
    confirm: () => true,
    fetch: async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ ok: true }), json: async () => ({ ok: true }) }),
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
  return { run, alerts, store, getEl, sandbox };
}
const J = (v) => JSON.stringify(v);
// A future month (same month for every fixture date, always ahead
// of today so the proposed picker includes the shifts).
function futureDay(day) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 5); d.setDate(day);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}
const D_CARD = futureDay(12), D_OVR = futureDay(14), D_CONF = futureDay(15), D_BLANK = futureDay(16);
const PREFIX = D_OVR.slice(0, 7);
// Card: hourly 250 x 8.5 paid hours = $2,125 for an 8-hour day.
const GEN_FAC = { id: 'fg', name: 'General Hospital', aliases: '', address: '1 Main Street', hourlyRate: '250', paidHours8: '8.5', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', hourlyCall1st: '', callBonus: '', distance: '', notes: '', weekendDays: [0, 6], contactEmail: 'scheduling@general.example', codeMap: {} };
// Record shapes mirror the real Add-shift save path: a typed pay
// saves with payRate '' / payUnit '' and incomplete false; a blank
// pay is stamped from the card at the same amounts.
const SH_CARD = { id: 's-card', date: D_CARD, facility: 'General Hospital', code: '', type: '8-hour day', pay: '2125', payRate: '', payUnit: '', status: 'proposed', source: 'user-entered', incomplete: false };
const SH_OVR = { id: 's-ovr', date: D_OVR, facility: 'General Hospital', code: '', type: '8-hour day', pay: '2000', payRate: '', payUnit: '', status: 'proposed', source: 'user-entered', incomplete: false };
const SH_CONF = { id: 's-conf', date: D_CONF, facility: 'General Hospital', code: '', type: '8-hour day', pay: '2000', payRate: '', payUnit: '', status: 'confirmed', source: 'user-entered', incomplete: false };
const SH_BLANK = { id: 's-blank', date: D_BLANK, facility: 'General Hospital', code: '', type: '8-hour day', pay: '', payRate: '', payUnit: '', status: 'proposed', source: 'user-entered', incomplete: true };

(async () => {
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
  t('sw: cache bumped to v163', swSrc.includes('crna-hub-shell-v164'));
  const fnBody = (name) => { const i = appSrc.indexOf('function ' + name + '('); if (i < 0) return ''; let depth = 0, j = appSrc.indexOf('{', i); const start = j; for (; j < appSrc.length; j++) { if (appSrc[j] === '{') depth++; else if (appSrc[j] === '}') { depth--; if (!depth) return appSrc.slice(start, j + 1); } } return ''; };
  t('source (v164): no picker-price helper remains — the sheet never prices a row', !appSrc.includes('function propEmailPrice') && !fnBody('proposedEmailSheetHTML').includes('propEmailPrice'));
  t('source: the shared display price reads effectiveShiftPay for priced shifts', fnBody('shiftDisplayPrice').includes('effectiveShiftPay'));
  t('source: compose (the scheduler email) never touches prices', !fnBody('composeProposedEmail').includes('shiftDisplayPrice') && !fnBody('composeProposedEmail').includes('$'));
  t('card sanity: the facility card prices an 8-hour day at 2125', (() => { const w = makeWorld(); w.run(`db = empty(); db.facilities = ${J([GEN_FAC])}; db.shifts = []; persist();`); return w.run(`facilityPayFor(db.facilities[0], '8-hour day', ${J(D_OVR)})`) === 2125; })());

  // --- Totals: the calendar honours the typed override exactly ---
  let w = makeWorld();
  w.run(`db = empty(); db.facilities = ${J([GEN_FAC])}; db.shifts = ${J([SH_CARD])}; persist();`);
  const baseP = w.run(`monthIncomeSplit(${J(PREFIX)}).p`);
  const baseHead = w.run(`monthHeadline(${J(PREFIX)}).gross`);
  t('baseline: card-priced proposed shift totals 2125', baseP === 2125, String(baseP));
  w.run(`db.shifts = ${J([SH_CARD, SH_OVR])}; persist();`);
  t('month P total rises by exactly the typed 2000 (not the card 2125)', w.run(`monthIncomeSplit(${J(PREFIX)}).p`) - baseP === 2000, String(w.run(`monthIncomeSplit(${J(PREFIX)}).p`)));
  t('month headline rises by exactly the typed 2000', w.run(`monthHeadline(${J(PREFIX)}).gross`) - baseHead === 2000, String(w.run(`monthHeadline(${J(PREFIX)}).gross`)));

  // --- The shared display price ---
  t('display price: override shift = 2000 (typed amount stands)', w.run(`shiftDisplayPrice(db.shifts.find(x => x.id === 's-ovr'))`) === 2000);
  t('display price: card-stamped shift = 2125', w.run(`shiftDisplayPrice(db.shifts.find(x => x.id === 's-card'))`) === 2125);
  w.run(`db.shifts = ${J([SH_CARD, SH_OVR, SH_BLANK])}; persist();`);
  t('display price: unstamped shift live-prices from the card = 2125', w.run(`shiftDisplayPrice(db.shifts.find(x => x.id === 's-blank'))`) === 2125);
  t('display price: nothing can price it = null (never $0)', w.run(`shiftDisplayPrice({ date: ${J(D_OVR)}, facility: 'Nowhere Clinic', type: '8-hour day', pay: '', incomplete: true })`) === null);

  // --- Picker (v164): date + shift type ONLY — the sheet is the email ---
  w.run(`openProposedEmailSheet('fg');`);
  const sheet = w.run(`proposedEmailSheetHTML()`);
  const rows = sheet.split('<label class="row checkline">').slice(1);
  const fmtOf = (iso) => w.run(`fmt(${J(iso)})`);
  const rowOv = rows.find((s) => s.includes(fmtOf(D_OVR)));
  const rowCard = rows.find((s) => s.includes(fmtOf(D_CARD)));
  const rowBlank = rows.find((s) => s.includes(fmtOf(D_BLANK)));
  t('picker: all 3 proposed shifts listed', rows.length === 3, String(rows.length));
  t('picker (v164): every row shows date + shift type, exactly what the scheduler receives',
    [rowOv, rowCard, rowBlank].every((r) => !!r && r.includes('8-hour day')), rows.join(' | '));
  t('picker (v164): NO dollar figure anywhere on the sheet (no $, no 2,000 / 2,125 in any form)',
    !/\$/.test(sheet) && !/2,?000|2,?125/.test(sheet), sheet.slice(0, 800));
  t('picker (v164): the override row carries no price to diverge — date + type only',
    !!rowOv && !/\$|2,?000/.test(rowOv), rowOv || 'row missing');

  // --- The email itself: NO money, dates + types only ---
  const fac = `db.facilities.find(f => f.id === 'fg')`;
  const composed = w.run(`composeProposedEmail(${fac}, upcomingProposedShifts(${fac}), 'Test User')`);
  t('email: subject carries no money', !/\$/.test(composed.subject), composed.subject);
  t('email: body contains NO dollar figure anywhere', !/\$[\d,]/.test(composed.body), composed.body);
  t('email: body contains no amounts in words/digits either (no 2000 / 2125 / total)', !/2,?000|2,?125/.test(composed.body) && !/total/i.test(composed.body), composed.body);
  const bodyLines = composed.body.split('\n').filter((l) => l.startsWith('• '));
  t('email: one line per proposed shift (3)', bodyLines.length === 3, J(bodyLines));
  t('email: lines carry date + shift type', [D_CARD, D_OVR, D_BLANK].every((d) => bodyLines.some((l) => l.includes(fmtOf(d)) && l.includes('8-hour day'))), J(bodyLines));

  // --- Confirmed variant: same shared result on the other surfaces ---
  w = makeWorld();
  w.run(`db = empty(); db.facilities = ${J([GEN_FAC])}; db.shifts = ${J([SH_CONF])}; persist();`);
  t('confirmed variant: C total is the typed 2000, not the card 2125', w.run(`monthIncomeSplit(${J(PREFIX)}).c`) === 2000, String(w.run(`monthIncomeSplit(${J(PREFIX)}).c`)));
  t('confirmed variant: display price = 2000', w.run(`shiftDisplayPrice(db.shifts[0])`) === 2000);
  w.run(`selected = ${J(D_CONF)}; dayViewOpen = true;`);
  const day = w.run(`dayViewHTML()`);
  t('confirmed variant: day sheet shows $2,000.00', day.includes('$2,000.00') && !day.includes('$2,125'), day.slice(0, 400));

  // --- Assistant summary figures ride the same result ---
  w = makeWorld();
  const todayStr = w.run(`localDate(new Date())`);
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); })();
  const shNow = { ...SH_OVR, id: 's-now', date: tomorrow };
  w.run(`db = empty(); db.facilities = ${J([GEN_FAC])}; db.shifts = ${J([shNow])}; persist();`);
  if (tomorrow.slice(0, 7) === todayStr.slice(0, 7)) {
    const byFac = w.run(`buildAssistantSummary().month.byFacility`);
    t('assistant summary: by-facility figure is the typed 2000', JSON.stringify(byFac) === JSON.stringify([{ facility: 'General Hospital', gross: 2000 }]), J(byFac));
  } else {
    console.log('  skip - assistant summary pin (fixture crosses a month boundary today)');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
