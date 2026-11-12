'use strict';
// v136 (Nov 11, 2026) — bare ordinal call references in calendar
// titles. Caleb's December 2026: Dec 8/14/18 are titled "Holzer 1st "
// (trailing space, NO word "call"); the server classifier required
// "1st call" or an exact code token, so all three parsed to null and
// were counted as not-shifts, unnamed. This file pins the client
// .ics path (parseICS -> approve -> paycheck machinery): all 15
// December events land, the three bare-ordinal days price as 1st
// call at $4,800, and the app's December figures return to the
// pinned values (Dec 22 occurrence $29,975, December headline
// $40,600). The server path is pinned in _shared/calendar.test.ts.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = __dirname + path.sep;
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
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) { fails++; process.exitCode = 1; } };
const J = (x) => JSON.stringify(x);

// Caleb's HOLZ card (client shape): name HOLZ, alias Holzer, the
// words-built rates and the code definitions his card carries.
const HOLZ = {
  id: 'holz', name: 'HOLZ', aliases: 'Holzer', address: '100 Jackson Pike, Gallipolis, OH 45631',
  hourlyRate: '250', paidHours8: '8.5',
  rate8: '', rate10: '2625', rate12: '', rate24: '4800', weekendRate24: '4200',
  rateSecond: '3000', weekendRateSecond: '2000', callBonus: '', hourlyCall1st: '175',
  weekendDays: [0, 6], ratesSource: 'words',
  codeMap: {
    'Holz-call 1': { label: '24hr call', canonicalType: '24-hour call', weekdayPay: '4800', weekendPay: '4200', rulesConfirmed: true, viaWords: true },
    'Holz-call 2': { label: '2nd call', canonicalType: 'Second call', weekdayPay: '3000', weekendPay: '2000', rulesConfirmed: true, viaWords: true },
    'Holz-g main (8)': { label: '8hr day shift', hours: '8', paidHours: '8.5', rulesConfirmed: true, viaWords: true },
    'Holz-g main (10)': { label: '10hour day shift', hours: '10', paidHours: '10.5', rulesConfirmed: true, viaWords: true },
    'Holz PCDO': { label: 'post call day off', hours: '8', rulesConfirmed: true, viaWords: true, unpaid: true },
  },
};
const ev = (uid, summary, ymd) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART;VALUE=DATE:${ymd}\r\nDTEND;VALUE=DATE:${ymd}\r\nEND:VEVENT\r\n`;
const DEC = [
  ['20261116', 'Holzer 8'], ['20261117', 'Holzer 8'], ['20261118', 'Holzer 8'],
  ['20261119', 'Holzer 8'], ['20261120', 'Holzer 8'],
  ['20261130', 'Holzer 8'], ['20261201', 'Holzer 8'], ['20261202', 'Holzer 8 2nd call'],
  ['20261203', 'Holzer 8'], ['20261204', 'Holzer 1st call'], ['20261205', 'Holzer 8 2nd call'],
  ['20261206', 'Holzer 1st call'], ['20261208', 'Holzer 1st '], ['20261210', 'Holzer 1st call'],
  ['20261214', 'Holzer 1st '], ['20261216', 'Holzer 1st call'], ['20261218', 'Holzer 1st '],
  ['20261228', 'Holzer 8 2nd call'], ['20261229', 'Holzer 8'], ['20261230', 'Holzer 8'],
];
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' + DEC.map(([d, s], i) => ev('dec' + i, s, d)).join('') + 'END:VCALENDAR';

run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=${JSON.stringify([HOLZ])}; db.shifts=[]; persist();`);
const parsed = run(`parseICS(${JSON.stringify(ICS)}, 'cal.ics')`);
t('all 20 events become rows', parsed.rows.length === 20, 'rows=' + parsed.rows.length);
const bare = parsed.rows.filter(r => ['2026-12-08', '2026-12-14', '2026-12-18'].includes(r.date));
t('the three bare-ordinal days are classified 24-hour call',
  bare.length === 3 && bare.every(r => r.type === '24-hour call'), J(bare.map(r => [r.date, r.type])));
t('the three bare-ordinal days price $4,800 with no unclassified flag',
  bare.every(r => Number(r.pay) === 4800 && !r.flags.some(f => f.includes('not classified'))), J(bare.map(r => [r.date, r.pay, r.flags])));
t('no December row is left unclassified',
  parsed.rows.every(r => r.type !== 'Other'), J(parsed.rows.filter(r => r.type === 'Other').map(r => r.date)));

// Mirror importCalendar's row mapping, then approve.
run(`
  (() => {
    const rows = ${JSON.stringify(parsed.rows)}.map(r => ({ ...r, source: 'calendar-file', sourceLabel: 'Calendar file', status: importStatusForDate(r.date), include: true, duplicate: false, incomplete: !String(r.pay || '').trim(), note: 'Imported from Calendar file (.ics): cal.ics' }));
    calPreview = { fileName: 'cal.ics', sourceLabel: 'Calendar file', sourceCode: 'calendar-file', rows };
  })()
`);
run(`approveCalendarImport();`);
const shifts = run(`db.shifts`);
t('approve imports all 20 shifts', shifts.length === 20, 'shifts=' + shifts.length);
const sum = (a, b) => shifts.filter(s => s.date >= a && s.date <= b).reduce((x, s) => x + (Number(s.pay) || 0), 0);
t('period Nov 30 - Dec 13 totals $29,975 (the Dec 22 check, Dec 8 included)',
  sum('2026-11-30', '2026-12-13') === 29975, 'got ' + sum('2026-11-30', '2026-12-13'));
t('period Nov 16 - Nov 29 totals $10,625 (the Dec 8 check)',
  sum('2026-11-16', '2026-11-29') === 10625, 'got ' + sum('2026-11-16', '2026-11-29'));

// Re-import adds zero (same file again -> every row a duplicate).
const again = run(`parseICS(${JSON.stringify(ICS)}, 'cal.ics')`);
run(`
  (() => {
    const rows = ${JSON.stringify(again.rows)}.map(r => ({ ...r, source: 'calendar-file', sourceLabel: 'Calendar file', status: importStatusForDate(r.date), include: true, duplicate: (db.shifts || []).some(x => shiftsSameShift(x, r)), incomplete: !String(r.pay || '').trim(), note: 'Imported from Calendar file (.ics): cal.ics' }));
    calPreview = { fileName: 'cal.ics', sourceLabel: 'Calendar file', sourceCode: 'calendar-file', rows };
  })()
`);
run(`approveCalendarImport();`);
t('re-import adds zero shifts', run(`db.shifts.length`) === 20, 'shifts=' + run(`db.shifts.length`));

// The paycheck machinery over the imported shifts: with Caleb's
// biweekly HOLZ schedule anchored Nov 2 - 15 (paid Nov 24), the
// December occurrences and headline return to the pinned values.
const facName = shifts[0] ? shifts[0].facility : 'HOLZ';
run(`db.payStubs=[{ id:'ps1', agency:${JSON.stringify(facName)}, facility:${JSON.stringify(facName)}, frequency:'biweekly', periodStart:'2026-11-02', periodEnd:'2026-11-15', payDate:'2026-11-24', gross:'', net:'', source:'import', fileName:'' }];`);
const occ = run(`paystubOccurrencesInMonth('2026-12').map(o=>({date:o.date,total:paystubOccurrenceAmount(o)}))`);
t('Dec 8 occurrence is $10,625', (occ.find(o => o.date === '2026-12-08') || {}).total === 10625, J(occ));
t('Dec 22 occurrence is $29,975 (Dec 8 shift included)',
  (occ.find(o => o.date === '2026-12-22') || {}).total === 29975, J(occ));
t('December headline is $40,600', run(`monthHeadline('2026-12', db.shifts).gross`) === 40600,
  'got ' + run(`monthHeadline('2026-12', db.shifts).gross`));

// Title variants through the shared binding helpers.
const variants = run(`['1st','1st ','first','FIRST','call 1st','2nd','second','2nd call'].map(c => [c, bareOrdinalCallKind(c)])`);
t('bareOrdinalCallKind reads every ordinal spelling',
  J(variants) === J([['1st', 'first'], ['1st ', 'first'], ['first', 'first'], ['FIRST', 'first'], ['call 1st', 'first'], ['2nd', 'second'], ['second', 'second'], ['2nd call', 'second']]), J(variants));
t('non-ordinals bind nothing', run(`bareOrdinalCallKind('8')`) === null && run(`bareOrdinalCallKind('call')`) === null && run(`bareOrdinalCallKind('1st week')`) === null);
t('binding resolves to the saved Call 1 definition',
  run(`(function(){ const b = ordinalCallBinding(facilityByNameOrAlias('HOLZ'), '1st'); return b && b.code === 'Holz-call 1' && b.type === '24-hour call'; })()`) === true);
t('sw: cache bumped to v136', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v137'));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
