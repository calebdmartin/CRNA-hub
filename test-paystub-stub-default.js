// CRNA Hub — a pay stub is always the default (Nov 9, 2026).
//
// Caleb's live report: he entered a pay schedule at QGenda import
// (agency saved as "Holzer" — the facility name the import knew),
// then uploaded a pay stub (agency "Premier Anesthesia Group, PC" —
// the payer named on the document). The save flows' one-schedule-
// per-agency guard matches the agency string exactly, so the two
// records never saw each other, and EACH generated its own
// paycheck series: Nov 10 showed TWO chips — "Holzer est.
// $11,000.00" stacked on "Premier Anesthesia Group, PC actual
// $12,757.50" — and the November headline read $49,957.50
// (12,757.50 actual + 11,000 estimate for the SAME check + 26,200),
// double-counting the stubbed check. His rule: "If a paystub is
// uploaded it should always be the default."
//
// The fix unifies linked records at read time (paystubSchedules):
// one effective schedule per payer — the stub record canonical —
// so every surface (calendar chips, day sheet, Upcoming, headline,
// reconciliations) sees ONE paycheck per payer per pay date, the
// stub's actual wherever a stub exists. Stored records are never
// rewritten, so the result is identical whichever flow ran first.
// Run: node test-paystub-stub-default.js
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

const FAC = `{ id:'f1', name:'Holzer', aliases:'', address:'100 Jackson Pike, Gallipolis, OH 45631', hourlyRate:'250', paidHours8:'8.5', rate8:'2125', rate10:'2625', rateSecond:'3000', weekendRateSecond:'2000', rate24:'4800', weekendRate24:'4200', hourlyCall1st:'175', callBonus:'' }`;
const FAC2 = `{ id:'f2', name:'CAMC', aliases:'', address:'3200 MacCorkle Ave SE, Charleston, WV 25304', hourlyRate:'250', paidHours8:'', rate8:'2000', rate10:'2500', rateSecond:'', weekendRateSecond:'', rate24:'', weekendRate24:'', hourlyCall1st:'', callBonus:'' }`;
const sh = (id, date, type, code, pay, fac) => ({ id, date, facility: fac || 'Holzer', type, code, pay, status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], note: '', updatedAt: null });
// Caleb's November, priced (post-v100 rates): the Oct 19 – Nov 1
// period's shift math is $11,000 (the estimate his screenshot
// showed); Nov 2 – 15 is $27,075; Nov 16 – 29 is $10,625.
const SHIFTS = [
  sh('s1', '2026-10-24', '24-hour call', 'HOLZ - Call 1', '4200'),
  sh('s2', '2026-10-27', '24-hour call', 'HOLZ - Call 1', '4800'),
  sh('s3', '2026-11-01', 'Second call', 'HOLZ - Call 2', '2000'),
  ...['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d, i) => sh('g' + i, d, '8-hour day', 'HOLZ - G Main (8)', '2125')),
  sh('s4', '2026-11-03', 'Second call', 'HOLZ - Call 2', '3000'),
  sh('s5', '2026-11-06', 'Second call', 'HOLZ - Call 2', '3000'),
  sh('s6', '2026-11-08', 'Second call', 'HOLZ - Call 2', '2000'),
  sh('s7', '2026-11-07', '24-hour call', 'HOLZ - Call 1', '4200'),
  ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map((d, i) => sh('h' + i, d, '8-hour day', 'HOLZ - G Main (8)', '2125')),
  sh('s8', '2026-11-30', '8-hour day', 'HOLZ - G Main (8)', '2125'),
];
const IMPORT_REC = `{ id:'ps-import', agency:'Holzer', facility:'Holzer', frequency:'biweekly', periodStart:'2026-11-02', periodEnd:'2026-11-15', payDate:'2026-11-24', gross:'', net:'', source:'import', fileName:'' }`;
const STUB_REC = `{ id:'ps-stub', agency:'Premier Anesthesia Group, PC', facility:'', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'12757.50', net:'', source:'ai-vision', fileName:'stub.jpg' }`;
const STUB2_REC = `{ id:'ps-stub2', agency:'Premier Anesthesia Group, PC', facility:'', frequency:'biweekly', periodStart:'2026-11-16', periodEnd:'2026-11-29', payDate:'2026-12-08', gross:'10900', net:'', source:'ai-vision', fileName:'stub2.jpg' }`;
const CAMC_REC = `{ id:'ps-camc', agency:'CAMC', facility:'CAMC', frequency:'biweekly', periodStart:'2026-10-30', periodEnd:'2026-11-12', payDate:'2026-11-13', gross:'', net:'', source:'import', fileName:'' }`;

function seed(records, extraShifts) {
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [${FAC}, ${FAC2}];
    db.shifts = ${JSON.stringify(SHIFTS.concat(extraShifts || []))};
    db.payStubs = [${records.join(',')}]; persist();`);
}
const novOcc = () => run(`paystubOccurrencesInMonth('2026-11')`);
const onDate = (d) => run(`paystubOccurrencesOn('${d}')`);
const headline = () => run(`monthHeadline('2026-11')`);

function assertUnifiedNovember(label) {
  const occ = novOcc();
  t(label + ': November has exactly two paychecks', occ.length === 2, 'got ' + occ.map((o) => o.date).join(','));
  const n10 = occ.find((o) => o.date === '2026-11-10') || {};
  t(label + ': Nov 10 is the stub actual only', n10.isActual === true && n10.stubBacked === true && n10.actual === 12757.5, JSON.stringify(n10));
  t(label + ': Nov 10 wears the stub payer label', n10.agency === 'Premier Anesthesia Group, PC', n10.agency);
  const n24 = occ.find((o) => o.date === '2026-11-24') || {};
  t(label + ': Nov 24 stays the calculated estimate', n24.isActual === false && n24.total === 27075, JSON.stringify(n24));
  t(label + ': one chip on Nov 10 (day sheet source)', onDate('2026-11-10').length === 1);
  const h = headline();
  t(label + ': headline counts the check once — $39,832.50', h.gross === 39832.5 && h.paychecks === 2 && h.anyActual === true, JSON.stringify(h));
}

(async () => {
  // ---------- (a) import schedule first, stub second ----------
  seed([IMPORT_REC, STUB_REC]);
  t('a: the two stored records unify into one effective schedule', run(`paystubSchedules().length`) === 1, 'got ' + run(`paystubSchedules().length`));
  t('a: stored records are untouched (read-time unification)', run(`db.payStubs.length`) === 2);
  t('a: the unified schedule fills the facility from the import record', run(`paystubSchedules()[0].facility`) === 'Holzer');
  assertUnifiedNovember('a');
  const sheet = run(`dayPaycheckSectionHTML(paystubOccurrencesOn('2026-11-10'))`);
  t('a: day sheet shows the actual, never the suppressed estimate', sheet.includes('12,757.50') && !sheet.includes('11,000'), sheet.slice(0, 200));
  const up = run(`paystubUpcoming(4, '2026-11-09')`);
  t('a: Upcoming lists Nov 10 once, as the actual', up.filter((x) => x.date === '2026-11-10').length === 1 && up[0].date === '2026-11-10' && up[0].isActual === true, JSON.stringify(up.map((x) => x.date)));
  const dec = run(`paystubOccurrencesInMonth('2026-12')`);
  t('a: the one series continues — Dec 8 estimate $10,625, once', dec.filter((o) => o.date === '2026-12-08').length === 1 && (dec.find((o) => o.date === '2026-12-08') || {}).total === 10625, JSON.stringify(dec.map((o) => o.date)));
  const recs = run(`paystubReconciliations()`);
  t('a: reconciliation delta is actual minus the period shift sum', recs.length === 1 && recs[0].actual === 12757.5 && recs[0].shiftSum === 11000 && recs[0].delta === 1757.5, JSON.stringify(recs));

  // ---------- (b) stub first, import schedule second — same result ----------
  seed([STUB_REC, IMPORT_REC]);
  t('b: order-independent unification', run(`paystubSchedules().length`) === 1);
  assertUnifiedNovember('b');

  // ---------- (e) editing/deleting shifts in the stubbed period resurrects nothing ----------
  seed([IMPORT_REC, STUB_REC]);
  run(`db.shifts = db.shifts.filter(x => x.id !== 's2'); const s1 = db.shifts.find(x => x.id === 's1'); s1.pay = '9999'; persist();`);
  const occE = novOcc();
  const n10e = occE.find((o) => o.date === '2026-11-10') || {};
  t('e: Nov 10 is still one paycheck, still the stub actual', occE.filter((o) => o.date === '2026-11-10').length === 1 && n10e.isActual === true && n10e.actual === 12757.5, JSON.stringify(n10e));
  t('e: headline unchanged after the edits', headline().gross === 39832.5, JSON.stringify(headline()));

  // ---------- (c) two stubs for the same payer, different dates ----------
  seed([IMPORT_REC, STUB_REC, STUB2_REC]);
  t('c: three records, one payer, one schedule', run(`paystubSchedules().length`) === 1, 'got ' + run(`paystubSchedules().length`));
  const n10c = (novOcc().find((o) => o.date === '2026-11-10') || {});
  t('c: the earlier stub still shows as an actual', n10c.isActual === true && n10c.stubBacked === true && n10c.actual === 12757.5, JSON.stringify(n10c));
  const decC = run(`paystubOccurrencesInMonth('2026-12')`);
  const d8 = decC.find((o) => o.date === '2026-12-08') || {};
  t('c: the later stub shows as its actual (not the $10,625 math)', decC.filter((o) => o.date === '2026-12-08').length === 1 && d8.isActual === true && d8.stubBacked === true && d8.actual === 10900, JSON.stringify(d8));
  t('c: November headline still $39,832.50', headline().gross === 39832.5, JSON.stringify(headline()));
  const recsC = run(`paystubReconciliations()`);
  t('c: both stubs reconcile their own periods', recsC.length === 2 && recsC.some((r) => r.payday === '2026-11-10' && r.actual === 12757.5) && recsC.some((r) => r.payday === '2026-12-08' && r.actual === 10900), JSON.stringify(recsC.map((r) => r.payday)));

  // ---------- (c2) sequential stub uploads through the real save flow ----------
  seed([IMPORT_REC, STUB_REC]);
  run(`paystubPreview = { id: '', agency: 'Premier Anesthesia Group, PC', facility: '', frequency: 'biweekly', payDate: '2026-12-08', periodStart: '2026-11-16', periodEnd: '2026-11-29', gross: '10900', net: '', source: 'ai-vision', fileName: 'stub2.jpg' };`);
  run(`approvePaystub()`);
  t('c2: the replaced stub record is gone, the import record remains', run(`db.payStubs.length`) === 2 && run(`db.payStubs.some(x => x.id === 'ps-stub')`) === false);
  t('c2: the first stub actual rides on the new record', run(`String((db.payStubs.find(x => x.gross === '10900') || {}).occOverrides['2026-11-10'].actual)`) === '12757.5');
  const n10f = (novOcc().find((o) => o.date === '2026-11-10') || {});
  t('c2: Nov 10 still shows the first stub actual', novOcc().filter((o) => o.date === '2026-11-10').length === 1 && n10f.isActual === true && n10f.actual === 12757.5, JSON.stringify(n10f));
  t('c2: headline still $39,832.50', headline().gross === 39832.5, JSON.stringify(headline()));

  // ---------- (f) a genuinely different payer never unifies ----------
  seed([IMPORT_REC, STUB_REC, CAMC_REC], [sh('c1', '2026-11-05', '8-hour day', 'CAMC 8', '2000', 'CAMC'), sh('c2', '2026-11-06', '8-hour day', 'CAMC 8', '2000', 'CAMC')]);
  t('f: two payers stay two schedules', run(`paystubSchedules().length`) === 2, 'got ' + run(`paystubSchedules().length`));
  const occF = novOcc();
  t('f: November shows both payers’ checks, nothing suppressed', occF.filter((o) => o.date === '2026-11-13').length === 1 && occF.some((o) => o.date === '2026-11-13' && o.total === 4000), JSON.stringify(occF.map((o) => o.date + ':' + o.agency)));
  t('f: the Holzer headline component is unchanged', (occF.find((o) => o.date === '2026-11-10') || {}).actual === 12757.5 && (occF.find((o) => o.date === '2026-11-24') || {}).total === 27075);

  // ---------- (g) two payers for the SAME facility stay separate ----------
  // Both state amounts and share the facility and even the exact
  // series — a shared facility is never enough to merge money.
  seed([`{ id:'ps-a1', agency:'Agency One LLC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'5000', net:'', source:'ai-vision', fileName:'' }`,
        `{ id:'ps-a2', agency:'Agency Two LLC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'7000', net:'', source:'ai-vision', fileName:'' }`]);
  t('g: two payers, one facility, identical series — still two schedules', run(`paystubSchedules().length`) === 2, 'got ' + run(`paystubSchedules().length`));
  t('g: both Nov 10 actuals show, one per payer', onDate('2026-11-10').length === 2);

  // ---------- (h) the same payer named two ways on two stubs links by name ----------
  seed([`{ id:'ps-n1', agency:'Premier Anesthesia', facility:'', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'12757.50', net:'', source:'ai-vision', fileName:'' }`,
        `{ id:'ps-n2', agency:'Premier Anesthesia Group, PC', facility:'', frequency:'biweekly', periodStart:'2026-11-16', periodEnd:'2026-11-29', payDate:'2026-12-08', gross:'10900', net:'', source:'ai-vision', fileName:'' }`]);
  t('h: agency name variation unifies the two stubs', run(`paystubSchedules().length`) === 1, 'got ' + run(`paystubSchedules().length`));
  const n10h = (novOcc().find((o) => o.date === '2026-11-10') || {});
  t('h: the earlier stub still shows as an actual', n10h.isActual === true && n10h.actual === 12757.5, JSON.stringify(n10h));

  console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
})();
