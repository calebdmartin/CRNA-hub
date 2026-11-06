// CRNA Hub — tests for schedule import by name + QGenda feed + the
// removed Import & Backup tab (Nov 5, 2026, branch muse/credentialing).
// Run: node test-schedule-import.js
//
// Covers, without any live API call (fetch is stubbed; no network):
//   * No "Import & Backup" tab: not in tabs, not in the render map,
//     and no user-facing "Import & Backup" copy remains in app.js
//     (only the removal note and the build stamp mention it).
//   * Its pieces relocated: Account tab carries live sync, QGenda,
//     schedule upload, the .ics manual fallback (a <details>, not a
//     tab), and backup/restore; contract import lives on Facilities.
//   * Schedule name: "C. Martin" / "Martin, Caleb" / "Caleb Martin"
//     are the same person; "Jordan Martin" and "Caleb Jones" are not.
//   * Schedule parsing (CSV + text lines): rows for the user are
//     matched and included, rows for other people are excluded and
//     never saved, uncertain rows stay unchecked; a file with no names
//     is treated as the user's own schedule and says so.
//   * Preview-before-save: parsing saves nothing; approve adds only
//     included rows as schedule-import shifts (past rows confirmed,
//     future rows proposed — Bug 1, Nov 6, 2026) and checks step 2 off.
//   * AI schedule preview: server rows are classified the same way.
//   * QGenda: feed-URL validation, masking (never the full URL), the
//     QGenda panel copy (secret handling + sign-in fallback), and step
//     2 checking off when the feed is connected.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, scrollIntoView() {},
  };
}
const elements = {};
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
    getElementById: (id) => elements[id] || (elements[id] = el()),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({ ok: true }) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');

// ---------- No Import & Backup tab; pieces relocated ----------
t('no "Import & Backup" tab in tabs or the render map',
  run(`tabs.indexOf('Import & Backup')`) === -1 &&
  !appSrc.includes("'Import & Backup':importPage"));
t('no "Import & Backup" copy remains anywhere in app.js (Nov 6 sweep removed the last comment)',
  (appSrc.match(/Import & Backup/g) || []).length === 0);
run(`
  db.facilities = [{id:'f1', name:'Holzer', aliases:'', rate8:'2125', rate10:'2625', rate12:'', rate24:'', rateSecond:'3000', weekendRateSecond:'2000', hourlyRate:'250', paidHours8:'8.5', callBonus:'1000'}];
  db.shifts = [];
  db.settings.scheduleName = 'C. Martin';
  globalThis.__acct = accountPage();
  globalThis.__sync = syncSectionHTML();
  globalThis.__backup = backupHTML();
`);
const acct = sandbox.__acct, sync = sandbox.__sync;
t('Account tab carries live sync, QGenda, schedule upload, backup/restore',
  acct.includes('Live calendar sync') && acct.includes('QGenda') &&
  acct.includes('Upload a schedule') && acct.includes('Backup &amp; restore'));
t('.ics import/export is a small manual fallback <details>, not a tab or panel',
  sync.includes('<details><summary>Manual fallback') &&
  sync.includes('Import shifts from a calendar (.ics)') &&
  !sync.includes('<h2>Calendar files (.ics)'));
t('sign-in form collects the name as it appears on the schedule',
  acct.includes('Name as it appears on your schedule') &&
  acct.includes('f_scheduleName'));
t('contract import lives on the Facilities tab',
  run(`facilitiesPage()`).includes('Add a facility from a contract'));

// ---------- Schedule-name matching ----------
t('schedule name forms match: "C. Martin", "Martin, Caleb", "Caleb Martin"',
  run(`scheduleNamesMatch('C. Martin','Caleb Martin')`) &&
  run(`scheduleNamesMatch('Martin, Caleb','C. Martin')`) &&
  run(`scheduleNamesMatch('Caleb Martin','Martin, Caleb')`) &&
  run(`scheduleNamesMatch('Martin','Caleb Martin')`));
t('other people do not match: Jordan Martin, Caleb Jones, C. Jones',
  !run(`scheduleNamesMatch('Jordan Martin','C. Martin')`) &&
  !run(`scheduleNamesMatch('Caleb Jones','C. Martin')`) &&
  !run(`scheduleNamesMatch('C. Jones','C. Martin')`));

// ---------- CSV staff list: matched / other / uncertain ----------
const CSV = `date,provider,facility,shift,pay
2026-11-10,C. Martin,Holzer,8-hour day,2125
2026-11-11,Jordan Martin,Holzer,8-hour day,2125
2026-11-12,"Martin, Caleb",Holzer,Second call,3000
2026-11-13,,Holzer,8-hour day,
2026-11-14,Caleb Jones,Holzer,8-hour day,2125`;
run(`
  db.shifts = [];
  db.settings.scheduleImported = false;
  globalThis.__parsed = parseScheduleText(${JSON.stringify(CSV)}, 'staff-nov.csv');
`);
const parsed = sandbox.__parsed;
t('CSV staff list parses to 5 rows with matched/other/uncertain split',
  parsed.rows.length === 5 &&
  parsed.rows.filter(r => r.match === 'matched').length === 2 &&
  parsed.rows.filter(r => r.match === 'other').length === 2 &&
  parsed.rows.filter(r => r.match === 'uncertain').length === 1);
t('matched rows included, other-person rows excluded, uncertain unchecked',
  parsed.rows[0].include === true && parsed.rows[2].include === true &&
  parsed.rows[1].include === false && parsed.rows[4].include === false &&
  parsed.rows[3].include === false);
t('preview-before-save: parsing saves no shifts',
  run(`db.shifts.length`) === 0);
run(`
  schedulePreview = globalThis.__parsed;
  globalThis.__before = db.shifts.length;
  approveScheduleImport();
`);
t('approve adds only the 2 matched rows as schedule-import shifts, past confirmed / future proposed (Bug 1)',
  run(`db.shifts.length`) === 2 &&
  run(`db.shifts.every(x => x.source === 'schedule-import' && x.status === (x.date < localDate(new Date()) ? 'confirmed' : 'proposed'))`) &&
  run(`db.shifts.map(x => x.date).join(',')`) === '2026-11-10,2026-11-12');
t('approve checks step 2 off and records the imported file',
  run(`db.settings.scheduleImported`) === true &&
  run(`db.settings.scheduleImportFile`) === 'staff-nov.csv' &&
  run(`onboardingSteps()[1].done`) === true);
t('no other-person shift was saved',
  !run(`db.shifts.some(x => x.date === '2026-11-11' || x.date === '2026-11-14')`));

// ---------- Text lines ----------
const TEXT = `Nov 10 — C. Martin — Holzer 8
Nov 11 — Jordan Martin — Holzer 8
2026-11-12 Holzer 8/2nd call — Martin, Caleb`;
run(`
  db.shifts = [];
  globalThis.__textParsed = parseScheduleText(${JSON.stringify(TEXT)}, 'pasted');
`);
const tp = sandbox.__textParsed;
t('text lines: dates, Holzer types, and names all read',
  tp.rows.length === 3 &&
  tp.rows[0].date === '2026-11-10' && tp.rows[0].type === '8-hour day' &&
  tp.rows[2].date === '2026-11-12' && tp.rows[2].type === 'Second call');
t('text lines: own rows matched, Jordan Martin excluded',
  tp.rows[0].match === 'matched' && tp.rows[1].match === 'other' &&
  tp.rows[2].match === 'matched');

// ---------- No-names file = own schedule ----------
run(`
  globalThis.__noNames = parseScheduleText('date,facility,shift,pay\\n2026-11-10,Holzer,8-hour day,2125', 'mine.csv');
`);
t('file with no names is treated as the user’s own schedule and says so',
  sandbox.__noNames.noNamesInFile === true &&
  sandbox.__noNames.rows[0].match === 'matched' &&
  sandbox.__noNames.rows[0].include === true);

// ---------- Date tokens ----------
t('schedule dates: ISO, M/D/Y, M/D, "Jan 5, 2027", "5 Jan 2027"',
  run(`scheduleParseDateToken('2026-11-10')`) === '2026-11-10' &&
  run(`scheduleParseDateToken('11/12/2026')`) === '2026-11-12' &&
  run(`scheduleParseDateToken('Jan 5, 2027')`) === '2027-01-05' &&
  run(`scheduleParseDateToken('5 Jan 2027')`) === '2027-01-05');

// ---------- AI schedule preview classification ----------
run(`
  db.shifts = [];
  globalThis.__aiOk = applyAiToSchedulePreview({shifts:[
    {date:'2026-11-10', facility:'Holzer', type:'8-hour day', name:'C. Martin'},
    {date:'2026-11-11', facility:'Holzer', type:'8-hour day', name:'Jordan Martin'},
    {date:'2026-11-12', facility:'Holzer', type:'Second call', name:''}
  ]}, 'photo.jpg');
  globalThis.__aiRows = schedulePreview.rows;
`);
t('AI schedule preview classifies matched / other / uncertain the same way',
  sandbox.__aiOk === true &&
  sandbox.__aiRows[0].match === 'matched' && sandbox.__aiRows[0].include === true &&
  sandbox.__aiRows[1].match === 'other' && sandbox.__aiRows[1].include === false &&
  sandbox.__aiRows[2].match === 'uncertain' && sandbox.__aiRows[2].include === false);

// ---------- QGenda ----------
t('QGenda feed URL validation: real subscription URLs pass, the rest fail',
  run(`qgendaFeedUrlLooksValid('https://app.qgenda.com/ical/user/abc.ics?token=x')`) &&
  run(`qgendaFeedUrlLooksValid('https://app.qgenda.com/sync/subscription/abc')`) &&
  !run(`qgendaFeedUrlLooksValid('http://app.qgenda.com/ical/x.ics')`) &&
  !run(`qgendaFeedUrlLooksValid('https://evil.com/ical/x.ics')`) &&
  !run(`qgendaFeedUrlLooksValid('https://app.qgenda.com/schedule')`) &&
  !run(`qgendaFeedUrlLooksValid('')`));
run(`globalThis.__qg = qgendaFeedHTML();`);
t('QGenda panel: subscription URL, secret handling, and the sign-in fallback',
  sandbox.__qg.includes('Your Subscription URL') &&
  sandbox.__qg.includes('stored encrypted on the server') &&
  sandbox.__qg.includes('never shown in full') &&
  sandbox.__qg.includes('No QGenda password is ever asked for or stored') &&
  sandbox.__qg.includes('I signed in to QGenda') &&
  sandbox.__qg.includes('no background sync'));
t('QGenda panel carries no roadmap/API scaffolding (Nov 6 sweep)',
  !sandbox.__qg.includes('official QGenda API') &&
  !sandbox.__qg.includes('later step'));
run(`
  db.settings.qgendaConnected = true;
  globalThis.__stepsQg = onboardingSteps();
  db.settings.qgendaConnected = false;
  scheduleImportContext = '';
  actions('qgenda-check-it', '', '');
`);
t('step 2 checks off when the QGenda feed is connected',
  sandbox.__stepsQg[1].done === true);
t('"I signed in to QGenda" routes to the schedule upload with the QGenda note',
  run(`scheduleImportContext`) === 'qgenda' &&
  run(`scheduleImportHTML()`).includes('Signed in to QGenda?'));

console.log(failures === 0 ? 'schedule-import test done: all passed' : 'schedule-import test done: FAILURES=' + failures);
