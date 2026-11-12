// CRNA Hub — v145: "Email proposed shifts" moves under the calendar
// (Caleb, Nov 12, 2026 ~10:12 AM EST, right after confirming the
// v144 chips live): "Can we move the 'email proposed shifts' button
// up to the bottom of the calendar?"
//
// The move, pinned:
//   * GONE from Dashboard Quick actions (a move, not a copy);
//   * rendered directly under the calendar — below the month grid
//     and its "N shifts · Tap a day…" line, above the 💰 paycheck
//     legend paragraph;
//   * shown ONLY when the currently viewed month contains at least
//     one proposed shift (any facility); month navigation
//     re-evaluates it;
//   * the tap runs the EXISTING flow unchanged (data-action
//     "proposed-email" → the facility picker sheet, proposed only);
//   * the facility-card entry point is untouched.
// Label pinned: "Email proposed shifts" (same words as the sheet
// title and the facility card — one label everywhere).
// Run: node test-v145-email-button-placement.js
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
const dayStr = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};
const HOLZ_FAC = { id: 'fh', name: 'HOLZ', aliases: 'Holzer', address: '100 Jackson Pike, Gallipolis, OH 45631', hourlyRate: '250', paidHours8: '8.5', rate8: '', rate10: '2625', rate12: '', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000', hourlyCall1st: '', callBonus: '', distance: '', notes: '', weekendDays: [0, 6], contactEmail: '', codeMap: { 'HOLZ - G Main (8)': { label: '8hr day shift', canonicalType: '8-hour day', hours: '8', paidHours: 8.5, rulesConfirmed: true } } };
// Caleb-shaped April 2027 (his real month: Apr 1–2 confirmed off his
// calendar, Apr 5–9 the proposed run he added by hand), plus a
// confirmed-only May so navigation has somewhere bare to land.
function aprilFixture() {
  const apr = (id, d, status, source) => ({ id, date: '2027-04-' + d, facility: 'HOLZ', code: status === 'proposed' ? '' : 'HOLZ - G Main (8)', type: status === 'proposed' ? '8-hour day' : '8hr day shift', pay: '2125', payUnit: 'facility', status, source, incomplete: false });
  return [
    apr('a1', '01', 'confirmed', 'calendar-apple'), apr('a2', '02', 'confirmed', 'calendar-apple'),
    apr('a5', '05', 'proposed', 'user-entered'), apr('a6', '06', 'proposed', 'user-entered'),
    apr('a7', '07', 'proposed', 'user-entered'), apr('a8', '08', 'proposed', 'user-entered'),
    apr('a9', '09', 'proposed', 'user-entered'),
    { id: 'm3', date: '2027-05-03', facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125', payUnit: 'facility', status: 'confirmed', source: 'user-entered', incomplete: false },
  ];
}
const BTN = '<button class="secondary" data-action="proposed-email">Email proposed shifts</button>';

(async () => {
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  // Source order inside calendar(): shift-count line < button < 💰 legend.
  const iCount = appSrc.indexOf('shifts · Tap a day to see its shifts');
  const iBtn = appSrc.indexOf('proposedInMonth.length?');
  const iLegend = appSrc.indexOf('💰 = paycheck calculated from your shifts');
  t('source: button sits between the shift-count line and the 💰 legend', iCount > -1 && iBtn > iCount && iLegend > iBtn);
  t('source: Quick actions no longer carries the button', !appSrc.includes('Ask Assistant</button><button class="secondary" data-action="proposed-email"'));

  // ---- World 1: fixed April/May 2027, month under test control ----
  let w = makeWorld();
  w.run(`db = empty(); db.settings.scheduleName = 'Caleb Martin'; db.facilities = ${J([HOLZ_FAC])}; db.shifts = ${J(aprilFixture())}; persist(); month = new Date(2027, 3, 1); selected = '2027-04-05';`);
  let dash = w.run(`dashboard()`);
  t('april (5 proposed): button rendered under the calendar', dash.includes(BTN));
  t('april: exactly one proposed-email button on the dashboard', (dash.match(/data-action="proposed-email"/g) || []).length === 1, String((dash.match(/data-action="proposed-email"/g) || []).length));
  const qa = dash.split('Quick actions')[1].split('</section>')[0];
  t('april: Quick actions keeps its other buttons, loses this one', qa.includes('Add shift') && !qa.includes('proposed-email'));
  t('april: button below the shift-count line', dash.indexOf(BTN) > dash.indexOf('shifts · Tap a day'));
  t('april: fixture headline untouched by the move (7 shifts × $2,125 worked)', w.run(`monthHeadline('2027-04').gross`) === 14875, String(w.run(`monthHeadline('2027-04').gross`)));

  // Month navigation re-evaluates: next → May (confirmed only) hides
  // it; prev → April brings it back.
  w.run(`actions('next');`);
  dash = w.run(`dashboard()`);
  t('may (no proposed): button gone after navigating next', !dash.includes('data-action="proposed-email"'));
  w.run(`actions('prev');`);
  dash = w.run(`dashboard()`);
  t('back to april: button returns after navigating prev', dash.includes(BTN));

  // A month with proposed shifts at ANOTHER facility still shows it
  // (any facility counts).
  w.run(`db.shifts = db.shifts.map(x => x.id === 'a5' ? { ...x, facility: 'CAMC' } : x); db.facilities = ${J([HOLZ_FAC, { ...HOLZ_FAC, id: 'fc', name: 'CAMC', aliases: '' }])}; persist();`);
  dash = w.run(`dashboard()`);
  t('proposed at any facility counts', dash.includes(BTN));

  // ---- World 2: the tap + the facility card (relative dates, the
  // existing flow is upcoming-based) ----
  w = makeWorld();
  const relShifts = [
    { id: 'p1', date: dayStr(9), facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125', payUnit: 'facility', status: 'proposed', source: 'user-entered', incomplete: false },
    { id: 'p2', date: dayStr(11), facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125', payUnit: 'facility', status: 'proposed', source: 'user-entered', incomplete: false },
    { id: 'c1', date: dayStr(10), facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125', payUnit: 'facility', status: 'confirmed', source: 'user-entered', incomplete: false },
  ];
  w.run(`db = empty(); db.settings.scheduleName = 'Caleb Martin'; db.facilities = ${J([HOLZ_FAC])}; db.shifts = ${J(relShifts)}; persist();`);
  w.run(`actions('proposed-email');`);
  t('tap: the existing picker sheet opens', w.run(`propEmailOpen`) === true);
  const sheet = w.run(`proposedEmailSheetHTML()`);
  t('tap: sheet lists exactly the 2 proposed shifts, confirmed excluded', (sheet.match(/propEmailInclude/g) || []).length === 2 && !sheet.includes(dayStr(10)), sheet.slice(0, 200));
  const facPage = w.run(`facilitiesPage()`);
  t('facility card: entry point untouched (count + facility id)', facPage.includes('data-action="proposed-email" data-id="fh"') && facPage.includes('Email proposed shifts (2)'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
