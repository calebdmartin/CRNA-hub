// v130 — multi-day calendar events (Caleb, Nov 11, 2026: "Some weeks I
// made one event for the entire week rather than individual days so I
// bet that's the snag"). Before this round parseICS read DTSTART only:
// a Mon–Fri block became ONE row on Monday and Tue–Fri never arrived.
// Pins, on the client .ics import path (the server path is pinned by
// the Deno suites):
//   * Mon–Fri "CAMC 10" block -> 5 rows -> approve -> 5 shifts x
//     $2,500 = $12,500, each row flagged as part of the block.
//   * "CAMC 5**" block -> 5 rows; priced per day by the facility's
//     code definition once the rows carry the code (the row model's
//     code field, as code-bearing sources and the preview's own code
//     confirmation produce) — including the weekend variant: a Fri–Tue
//     block prices Sat/Sun at the def's weekendPay.
//   * HOLZ "24/1st call" 3p→3p -> exactly 1 row/shift, $4,800 (a call
//     crossing midnight is one shift, not a block).
//   * A night float 7p→7a -> 1 row (crossing midnight != block).
//   * Block overlapping an existing Wednesday shift -> Wednesday
//     stays single, total 5 not 6; re-import -> zero added.
//   * Block + a separate different-code event on Wednesday -> the
//     existing double-booking flow (one Wednesday shift, one left out
//     and reported).
//   * All-day "HOLZ - PCDO" block -> one row per day (each then
//     classifies/prices per day like a single-day import); a row
//     carrying the PCDO code prices $0 as settled (payUnit 'unpaid').
//   * Per-block "Expected gross" still lands on its own block's rows
//     (blockIndex alignment — expansion must not shift the mapping).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

const CAMC = {
  id: 'camc', name: 'CAMC', aliases: '', address: '', hourlyRate: '250', paidHours8: '',
  rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '',
  rateSecond: '', weekendRateSecond: '', callBonus: '', hourlyCall1st: '',
  weekendDays: [0, 6], ratesSource: 'manual',
  codeMap: {
    '5**': { label: '10 hour shift', hours: '10', canonicalType: '10-hour shift', weekdayPay: '2500', weekendPay: '2000', rulesConfirmed: true, viaWords: true },
  },
};
const HOLZ = {
  id: 'holz', name: 'HOLZ', aliases: 'Holzer', address: '', hourlyRate: '250', paidHours8: '8.5',
  rate8: '', rate10: '', rate12: '', rate24: '4800', weekendRate24: '4200',
  rateSecond: '3000', weekendRateSecond: '2000', callBonus: '', hourlyCall1st: '175',
  weekendDays: [0, 6], ratesSource: 'manual',
  codeMap: {
    'HOLZ - PCDO': { label: 'post call day off', hours: '8', canonicalType: '', rulesConfirmed: true, viaWords: true, unpaid: true },
  },
};
const setup = (shifts) => run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=${JSON.stringify([CAMC, HOLZ])}; db.shifts=${JSON.stringify(shifts || [])}; persist();`);
const ev = (uid, summary, ds, de, extra) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART${ds}\r\nDTEND${de}\r\n${extra || ''}END:VEVENT\r\n`;
const cal = (...evs) => 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' + evs.join('') + 'END:VCALENDAR';
// Mirror of importCalendar's row mapping (app.js) — the DOM handler
// itself needs a real file input; this is its exact transformation,
// including the v130 blockIndex gross lookup.
const toCalPreview = (text, fileName) => run(`
  (() => {
    const parsed = parseICS(${JSON.stringify(text)}, ${JSON.stringify(fileName || 'cal.ics')});
    const grossByBlock = ${JSON.stringify(text)}.split(/BEGIN:VEVENT/i).slice(1).map(b => { const m = b.match(/Expected gross:\\s*\\$?([\\d\\\\,]+(?:\\.\\d+)?)/i); return m ? m[1].replace(/[\\\\,]/g, '') : ''; });
    const rows = parsed.rows.map((r, ri) => {
      const gb = grossByBlock[r.blockIndex != null ? r.blockIndex : ri];
      if (gb) r = { ...r, pay: gb };
      const duplicate = (db.shifts || []).some(x => shiftsSameShift(x, r));
      const flags = [...r.flags];
      if (duplicate) flags.push('already in CRNA Hub — will merge, not double');
      return { ...r, source: 'calendar-file', sourceLabel: 'Calendar file', status: importStatusForDate(r.date), include: true, duplicate, incomplete: !String(r.pay || '').trim(), note: 'Imported from Calendar file (.ics): cal.ics' };
    });
    calPreview = { fileName: 'cal.ics', sourceLabel: 'Calendar file', sourceCode: 'calendar-file', rows };
    return rows.length;
  })()
`);
const camcWeek = () => run(`db.shifts.filter(s => s.facility === 'CAMC')`);
const sumPay = (arr) => arr.reduce((a, s) => a + (Number(s.pay) || 0), 0);

(async () => {
  const lastAlert = () => alerts[alerts.length - 1] || '';

  // ---------- 1. Mon–Fri CAMC 10 block -> 5 shifts x $2,500 ----------
  setup([]);
  const blockICS = cal(ev('w1', 'CAMC 10', ';VALUE=DATE:20261102', ';VALUE=DATE:20261107'));
  const parsed = run(`parseICS(${JSON.stringify(blockICS)}, 'cal.ics')`);
  t('block parses to 5 rows', parsed.rows.length === 5, 'rows=' + parsed.rows.length);
  t('rows cover Mon–Fri', JSON.stringify(parsed.rows.map(r => r.date)) === JSON.stringify(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']));
  t('every row flagged as part of the block (explicit preview)',
    parsed.rows.every(r => r.flags.some(f => f.includes('split into one shift per day'))));
  t('every row keeps the block index', parsed.rows.every(r => r.blockIndex === 0));
  toCalPreview(blockICS);
  run(`approveCalendarImport();`);
  t('approve adds 5 shifts', camcWeek().length === 5, 'shifts=' + camcWeek().length);
  t('total is $12,500', sumPay(camcWeek()) === 12500, 'total=' + sumPay(camcWeek()));
  t('alert reports 5 added', /Added 5 shift/.test(lastAlert()), lastAlert());

  // ---------- 2. Re-import the same file -> zero added ----------
  toCalPreview(blockICS);
  run(`approveCalendarImport();`);
  t('re-import adds zero', camcWeek().length === 5 && /Added 0 shift/.test(lastAlert()), lastAlert());

  // ---------- 3. Block overlapping an existing Wednesday shift ----------
  setup([{ id: 'wed1', date: '2026-11-04', facility: 'CAMC', type: '10-hour shift', code: '', pay: '2500', payUnit: 'facility', status: 'confirmed', source: 'manual', sources: ['manual'], incomplete: false, note: '' }]);
  toCalPreview(blockICS);
  run(`approveCalendarImport();`);
  t('overlap: total stays 5, Wednesday single', camcWeek().length === 5 && camcWeek().filter(s => s.date === '2026-11-04').length === 1, 'shifts=' + camcWeek().length);
  t('overlap: Wednesday merged, not doubled', /Merged 1 duplicate/.test(lastAlert()), lastAlert());
  t('overlap: total still $12,500', sumPay(camcWeek()) === 12500);

  // ---------- 4. Different-code event on the block's Wednesday ----------
  setup([]);
  const clashICS = cal(
    ev('w1', 'CAMC 10', ';VALUE=DATE:20261102', ';VALUE=DATE:20261107'),
    ev('w2', 'CAMC 12', ';VALUE=DATE:20261104', ';VALUE=DATE:20261105'),
  );
  toCalPreview(clashICS);
  run(`approveCalendarImport();`);
  // The v115 gate stops the import on the clash (nothing added yet)
  // and the preview lists it; the user resolves it there — here by
  // unchecking the separate Wednesday 12 entry (the block's own
  // Wednesday stands) — and approves again.
  t('clash: the double-booking gate stops the first approve', /double-booking/.test(lastAlert()) && camcWeek().length === 0, lastAlert());
  run(`calPreview.rows.forEach(r => { if (r.date === '2026-11-04' && r.type === '12-hour shift') r.include = false; }); approveCalendarImport();`);
  const wed = camcWeek().filter(s => s.date === '2026-11-04');
  t('clash: Wednesday has exactly one shift', wed.length === 1, 'wed=' + wed.length);
  t('clash: week total is 5 shifts, not 6', camcWeek().length === 5, 'shifts=' + camcWeek().length);

  // ---------- 5. CAMC 5** block: per-day code pricing + weekend variant ----------
  setup([]);
  const starICS = cal(ev('s1', 'CAMC 5**', ';VALUE=DATE:20261102', ';VALUE=DATE:20261107'));
  const starParsed = run(`parseICS(${JSON.stringify(starICS)}, 'cal.ics')`);
  t('5** block expands to 5 rows', starParsed.rows.length === 5);
  toCalPreview(starICS);
  run(`calPreview.rows.forEach(r => { r.code = '5**'; }); approveCalendarImport();`);
  t('5** week prices $2,500/day = $12,500', camcWeek().length === 5 && sumPay(camcWeek()) === 12500, 'total=' + sumPay(camcWeek()));
  // Fri Nov 6 – Tue Nov 10: Sat/Sun price at the def's weekendPay.
  setup([]);
  const wkndICS = cal(ev('s2', 'CAMC 5**', ';VALUE=DATE:20261106', ';VALUE=DATE:20261111'));
  toCalPreview(wkndICS);
  run(`calPreview.rows.forEach(r => { r.code = '5**'; }); approveCalendarImport();`);
  const byDate = Object.fromEntries(camcWeek().map(s => [s.date, Number(s.pay)]));
  t('weekend variant: Fri/Mon/Tue $2,500, Sat/Sun $2,000',
    byDate['2026-11-06'] === 2500 && byDate['2026-11-07'] === 2000 && byDate['2026-11-08'] === 2000 && byDate['2026-11-09'] === 2500 && byDate['2026-11-10'] === 2500,
    JSON.stringify(byDate));
  t('weekend variant total $11,500', sumPay(camcWeek()) === 11500);

  // ---------- 6. HOLZ 24/1st call 3p→3p -> exactly one $4,800 shift ----------
  setup([]);
  const callICS = cal(ev('c1', 'Holzer 24/1st call', ':20261102T150000Z', ':20261103T150000Z'));
  const callParsed = run(`parseICS(${JSON.stringify(callICS)}, 'cal.ics')`);
  t('24h call parses to exactly 1 row', callParsed.rows.length === 1);
  toCalPreview(callICS);
  run(`approveCalendarImport();`);
  const holzShifts = run(`db.shifts.filter(s => s.facility === 'HOLZ')`);
  t('24h call imports as 1 shift at $4,800', holzShifts.length === 1 && Number(holzShifts[0].pay) === 4800, JSON.stringify(holzShifts.map(s => s.pay)));

  // ---------- 7. Night float 7p→7a -> one row (crossing midnight != block) ----------
  setup([]);
  const nfICS = cal(ev('n1', 'Holzer 12-hour shift', ':20261114T190000Z', ':20261115T070000Z'));
  const nfParsed = run(`parseICS(${JSON.stringify(nfICS)}, 'cal.ics')`);
  t('night float parses to exactly 1 row', nfParsed.rows.length === 1 && nfParsed.rows[0].date === '2026-11-14');

  // ---------- 8. Multi-day call BLOCK (Fri–Sun) -> one row, flagged ----------
  setup([]);
  const callBlockICS = cal(ev('c2', 'Holzer 2nd call', ';VALUE=DATE:20261106', ';VALUE=DATE:20261109'));
  const cbParsed = run(`parseICS(${JSON.stringify(callBlockICS)}, 'cal.ics')`);
  t('call block stays 1 row on its first day', cbParsed.rows.length === 1 && cbParsed.rows[0].date === '2026-11-06');
  t('call block row is flagged as a multi-day call', cbParsed.rows[0].flags.some(f => f.includes('multi-day call')), JSON.stringify(cbParsed.rows[0].flags));

  // ---------- 9. PCDO block -> one row per day; coded row settles $0 ----------
  setup([]);
  const pcdoICS = cal(ev('p1', 'HOLZ - PCDO', ';VALUE=DATE:20261102', ';VALUE=DATE:20261105'));
  const pcdoParsed = run(`parseICS(${JSON.stringify(pcdoICS)}, 'cal.ics')`);
  t('PCDO block expands to 3 rows', pcdoParsed.rows.length === 3, 'rows=' + pcdoParsed.rows.length);
  toCalPreview(pcdoICS);
  run(`calPreview.rows.forEach(r => { r.code = 'HOLZ - PCDO'; }); approveCalendarImport();`);
  const pcdoShifts = run(`db.shifts.filter(s => s.facility === 'HOLZ')`);
  t('PCDO days land as 3 shifts at $0 settled (payUnit unpaid)',
    pcdoShifts.length === 3 && pcdoShifts.every(s => String(s.pay) === '0' && s.payUnit === 'unpaid' && !s.incomplete),
    JSON.stringify(pcdoShifts.map(s => [s.date, s.pay, s.payUnit, s.incomplete])));

  // ---------- 10. Expected-gross alignment survives expansion ----------
  setup([]);
  const grossICS = cal(
    ev('g1', 'CAMC 8', ';VALUE=DATE:20261116', ';VALUE=DATE:20261117', 'DESCRIPTION:Expected gross: $1,000\r\n'),
    ev('g2', 'CAMC 10', ';VALUE=DATE:20261102', ';VALUE=DATE:20261107', 'DESCRIPTION:Expected gross: $5,000\r\n'),
  );
  const grossRows = run(`
    (() => {
      const parsed = parseICS(${JSON.stringify(grossICS)}, 'cal.ics');
      const grossByBlock = ${JSON.stringify(grossICS)}.split(/BEGIN:VEVENT/i).slice(1).map(b => { const m = b.match(/Expected gross:\\s*\\$?([\\d\\\\,]+(?:\\.\\d+)?)/i); return m ? m[1].replace(/[\\\\,]/g, '') : ''; });
      return parsed.rows.map((r, ri) => { const gb = grossByBlock[r.blockIndex != null ? r.blockIndex : ri]; return { date: r.date, pay: gb || r.pay, bi: r.blockIndex }; });
    })()
  `);
  t('gross: single-day row reads its own block ($1,000)', grossRows.filter(r => r.bi === 0).length === 1 && grossRows[0].pay === '1000', JSON.stringify(grossRows));
  t('gross: all 5 block rows read the block gross ($5,000), none shifted', grossRows.filter(r => r.bi === 1).length === 5 && grossRows.filter(r => r.bi === 1).every(r => r.pay === '5000'));

  console.log(fails ? `\n${fails} FAILING` : '\nALL PASS');
})();
