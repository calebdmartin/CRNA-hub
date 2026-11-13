// CRNA Hub — v118: "Email proposed shifts" (Feature 2).
//
// INVESTIGATION (recorded in the v118 delivery): Caleb remembered
// testing an email function for proposed shifts. A sweep of the
// current code, every local snapshot back to v111, and all 164
// commit messages on muse/credentialing found NO email/mailto/
// share-proposed implementation anywhere, and the earliest app.js in
// git history has zero mailto: occurrences. What shipped once were
// the per-shift Google/Outlook CALENDAR links (commit 26474c8dfd) —
// the likely memory. So this feature was BUILT NEW here, to the
// brief: facility → its upcoming proposed shifts (checkboxes, all
// ticked) → the facility's scheduling contact email (new optional
// contactEmail field, asked once and remembered) → a clean plain-
// text email composed in the user's OWN mail app via mailto: (the
// app never sends on its own). No "sent" marker is offered: none
// exists in the shift data model, and statuses stay confirmed /
// proposed only.
//
// Pins: Caleb-shaped HOLZ data — the email lists exactly the
// proposed shifts (dates, types, count), confirmed and past shifts
// excluded; a facility with no proposed shifts shows the friendly
// nothing-to-send state; no contact email on file → asked in the
// sheet, and remembered on the facility after composing.
// Run: node test-v118-proposed-email.js
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
const HOLZ_FAC = { id: 'fh', name: 'HOLZ', aliases: 'Holzer', address: '100 Jackson Pike, Gallipolis, OH 45631', hourlyRate: '250', paidHours8: '8.5', rate8: '', rate10: '2625', rate12: '', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000', hourlyCall1st: '', callBonus: '', distance: '', notes: '', weekendDays: [0, 6], contactEmail: '', codeMap: { 'HOLZ - G Main (8)': { label: '8hr day shift', canonicalType: '8-hour day', hours: '8', paidHours: 8.5, rulesConfirmed: true }, 'HOLZ - Call 2': { label: '2nd call', canonicalType: 'Second call', hours: '24', weekdayPay: '3000', weekendPay: '2000', rulesConfirmed: true } } };
const CAMC_FAC = { id: 'fc', name: 'CAMC', aliases: '', address: '3200 MacCorkle Ave SE, Charleston, WV 25304', hourlyRate: '250', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', hourlyCall1st: '', callBonus: '', distance: '', notes: '', contactEmail: 'sched@camc.example', codeMap: {} };
function shiftsFixture() {
  return [
    { id: 'p1', date: dayStr(9), facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125', payUnit: 'facility', status: 'proposed', source: 'user-entered', incomplete: false },
    { id: 'p2', date: dayStr(11), facility: 'HOLZ', code: 'HOLZ - Call 2', type: '2nd call', pay: '', payUnit: '', status: 'proposed', source: 'user-entered', incomplete: false },
    { id: 'c1', date: dayStr(10), facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125', payUnit: 'facility', status: 'confirmed', source: 'user-entered', incomplete: false },
    { id: 'p0', date: dayStr(-2), facility: 'HOLZ', code: 'HOLZ - G Main (8)', type: '8hr day shift', pay: '2125', payUnit: 'facility', status: 'proposed', source: 'user-entered', incomplete: false },
    { id: 'cm1', date: dayStr(9), facility: 'CAMC', code: '7', type: '12 hour shift', pay: '3000', payUnit: 'facility', status: 'confirmed', source: 'user-entered', incomplete: false },
  ];
}

(async () => {
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  t('history pin: no pre-existing mailto implementation was in the code', !fs.readFileSync(R + '../crnahub-v117/app.js', 'utf8').includes('mailto:'));
  t('sheet: component exists and mounts on both surfaces', appSrc.includes('proposedEmailSheetHTML()') && (appSrc.match(/proposedEmailSheetHTML\(\)\}/g) || []).length >= 2);
  t('facility form: contact email field added', appSrc.includes("field('contactEmail','Scheduling contact email (optional)'"));
  t('no third status invented: compose never touches shift status', !/proposed-email[\s\S]{0,400}status\s*=\s*'sent'/.test(appSrc));

  let w = makeWorld();
  w.run(`db = empty(); db.settings.scheduleName = 'Caleb Martin'; db.facilities = ${J([HOLZ_FAC, CAMC_FAC])}; db.shifts = ${J(shiftsFixture())}; persist();`);
  const holz = `db.facilities.find(f => f.id === 'fh')`;
  t('selection: exactly the 2 upcoming HOLZ proposed shifts', w.run(`upcomingProposedShifts(${holz}).length`) === 2, J(w.run(`upcomingProposedShifts(${holz}).map(x => x.id)`)));
  t('selection: confirmed + past proposed excluded', w.run(`upcomingProposedShifts(${holz}).every(x => x.status === 'proposed' && x.date >= localDate(new Date()))`) === true);
  t('selection: facility with no proposed shifts is empty', w.run(`upcomingProposedShifts(db.facilities.find(f => f.id === 'fc')).length`) === 0);
  t('selection: facilitiesWithProposedShifts = HOLZ only', w.run(`facilitiesWithProposedShifts().map(f => f.id).join(',')`) === 'fh');

  // Sheet rendering
  w.run(`openProposedEmailSheet('fh');`);
  let sheet = w.run(`proposedEmailSheetHTML()`);
  t('sheet: lists both proposed shifts as ticked checkboxes', (sheet.match(/propEmailInclude/g) || []).length === 2 && (sheet.match(/checked/g) || []).length >= 2, sheet.slice(0, 300));
  t('sheet: shows dates + types + price where priced', sheet.includes('8hr day shift') && sheet.includes('2nd call') && sheet.includes('$2,125'));
  t('sheet: contact field present and empty for HOLZ', sheet.includes('f_propEmailContact') && sheet.includes('placeholder="scheduling@hospital.org"'));
  t('sheet: says the mail app sends it, not the app', sheet.includes('never sends email for you'));
  const facPage = w.run(`facilitiesPage()`);
  t('facility card: Email button with count', facPage.includes('Email proposed shifts (2)'));
  // v145 (Caleb, Nov 12, 2026) SUPERSEDES the old pin below it in
  // spirit: the dashboard entry MOVED from Quick actions to directly
  // under the calendar, shown only in months containing a proposed
  // shift (pinned in test-v145-email-button-placement.js). The
  // action itself — and this sheet — are unchanged. View the
  // fixture's proposed month so the moved button renders.
  w.run(`month = new Date(${J(dayStr(9))} + 'T12:00:00'); selected = ${J(dayStr(9))};`);
  const dash = w.run(`dashboard()`);
  const qaSeg = dash.split('Quick actions')[1].split('</section>')[0];
  t('dashboard (v145): out of Quick actions, under the calendar', !qaSeg.includes('proposed-email') && dash.includes('data-action="proposed-email"') && dash.includes('Email proposed shifts') && dash.indexOf('data-action="proposed-email"') > dash.indexOf('shifts · Tap a day'));

  // Composition
  const composed = w.run(`composeProposedEmail(${holz}, upcomingProposedShifts(${holz}), 'Caleb Martin')`);
  t('compose: subject', composed.subject === 'Proposed shifts — Caleb Martin — HOLZ', composed.subject);
  const bodyLines = composed.body.split('\n').filter((l) => l.startsWith('• '));
  t('compose: exactly 2 shift lines', bodyLines.length === 2, composed.body);
  // v163 (Nov 13, 2026, Caleb) SUPERSEDES the old pin here, which
  // asserted the priced line carried '$2,125' in the body: the email
  // to the scheduler now carries NO money at all — dates and shift
  // types only, no per-shift figures and no total. Prices remain in
  // the in-app picker only (pinned above and in test-v163).
  t('compose: lines carry date + type and NO money anywhere', bodyLines.some((l) => l.includes('8hr day shift')) && bodyLines.some((l) => l.includes('2nd call')) && !/\$[\d,]/.test(composed.body) && !/\$[\d,]/.test(composed.subject), J(bodyLines));
  t('compose: friendly intro + sign-off with the user name', composed.body.startsWith('Hello,') && composed.body.includes('Thanks,\nCaleb Martin'));

  // Send flow: contact asked once, remembered after; mailto addressed right
  w.getEl('f_propEmailFacility').value = 'fh';
  w.getEl('f_propEmailContact').value = 'scheduling@holzer.example';
  w.sandbox.document.querySelectorAll = (sel) => sel.includes('propEmailInclude') ? [{ value: 'p1' }, { value: 'p2' }] : [];
  w.run(`sendProposedEmail();`);
  const href = w.sandbox.location.href;
  t('send: opens the user\'s mail app (mailto:)', href.startsWith('mailto:'), href.slice(0, 60));
  const decoded = decodeURIComponent(href);
  t('send: addressed to the entered contact', decoded.startsWith('mailto:scheduling@holzer.example?'), decoded.slice(0, 50));
  t('send: subject + both shifts in the body, confirmed absent', decoded.includes('Proposed shifts — Caleb Martin — HOLZ') && decoded.includes('8hr day shift') && decoded.includes('2nd call') && !decoded.includes(dayStr(10)), decoded.slice(0, 300));
  t('send: contact remembered on the facility', w.run(`db.facilities.find(f => f.id === 'fh').contactEmail`) === 'scheduling@holzer.example');
  w.run(`openProposedEmailSheet('fh');`);
  sheet = w.run(`proposedEmailSheetHTML()`);
  t('send: next time the contact is prefilled', sheet.includes('value="scheduling@holzer.example"'));
  // no contact -> asked, nothing sent
  w = makeWorld();
  w.run(`db = empty(); db.settings.scheduleName = 'Caleb Martin'; db.facilities = ${J([HOLZ_FAC])}; db.shifts = ${J(shiftsFixture())}; persist(); openProposedEmailSheet('fh');`);
  w.getEl('f_propEmailFacility').value = 'fh';
  w.getEl('f_propEmailContact').value = '   ';
  w.sandbox.document.querySelectorAll = (sel) => sel.includes('propEmailInclude') ? [{ value: 'p1' }] : [];
  w.run(`sendProposedEmail();`);
  t('send: blank contact blocks with a plain ask', w.alerts.some((a) => a.includes('Add the scheduling contact email first')) && w.sandbox.location.href === '', J(w.alerts));

  // Nothing-to-send state
  w = makeWorld();
  w.run(`db = empty(); db.facilities = ${J([CAMC_FAC])}; db.shifts = ${J(shiftsFixture().filter((x) => x.facility === 'CAMC'))}; persist(); openProposedEmailSheet('');`);
  sheet = w.run(`proposedEmailSheetHTML()`);
  t('empty: friendly nothing-to-send state', sheet.includes('No proposed shifts to email right now'), sheet.slice(0, 200));
  t('empty: no compose button in that state', !sheet.includes('proposed-email-send'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
