// Nov 24 "est. $0.00" bug (Caleb, Nov 10, 2026, live screenshot):
// he connected QGenda, entered pay rules in the describe box, and
// uploaded a pay stub — the November calendar showed the Nov 10 stub
// actual ($12,757.50) but "Premier Anesthesia Group, PC est. $0.00"
// for Nov 24, and the headline was the stub actual alone.
//
// Proven root cause (this file pins the fix):
// - The straight-through import flow prices shifts at approve
//   (sections 1–2): with the card his words actually created
//   ($250/hr, paid hours unstated → 8) Nov 24 is $26,200 and the
//   headline $38,957.50. The import path was never the zero.
// - The zero appears whenever the SAVED shifts' stored pay is blank
//   — or stamped but still flagged incomplete — while a complete
//   facility card exists (sections 3–5): paystubPeriodTotals summed
//   stored pay only (isPricedShift), so every claimed shift added
//   exactly $0; paystubOccurrenceAmount returned 0 (not null) when
//   shiftCount > 0, so the chip printed "est. $0.00"; and because
//   the shifts WERE claimed by the stub's schedule, monthHeadline's
//   worked bucket excluded them — they vanished from both buckets
//   and the headline collapsed to the stub actual. Nothing at read
//   time or at boot ever priced them from the card.
// - Fix: paystubPeriodTotals prices an unusable-stamp shift LIVE
//   from its facility rate card (paystubLiveShiftPrice) before
//   counting it unpriced; healUnpricedShiftPays stamps blank pays
//   from the card on plain open (and clears an incomplete flag whose
//   stored amount equals the card price); a period whose shifts are
//   ALL genuinely unpriceable reports no amount (chip: "incomplete")
//   instead of $0.00.
// - The "[Martin]" chip suffix is a DISPLAY-path artifact: the
//   stored code can carry the feed's raw bracketed assignee, and
//   normalizeCodeKey only drops the bracket when this device knows
//   the schedule name. The chip now also drops a trailing name-like
//   bracket group (letters/spaces only); digit brackets stay.
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
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + (extra ?? ''))); if (!cond) fails++; };

const HIS_TEXT = "Holz-g main (8)= 8hour day shift $250/hour\nHolz-call 1= 24hr call. weekday=$4,800.\nWeekend=$4,200\nHolz-call 2= second call. Weekday=$3,000.\nWeekend=$2,000";
const G = 'HOLZ - G Main (8)', C2 = 'HOLZ - Call 2', C1 = 'HOLZ - Call 1';
const mkRow = (date, code, type, hours) => ({ date, facility: 'HOLZ', type, code, hours, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed', incomplete: true });
const NOV_ROWS = [
  ...['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-30'].map(d => mkRow(d, G, '8-hour day', 8)),
  mkRow('2026-11-03', C2, 'Second call', null),
  mkRow('2026-11-06', C2, 'Second call', null),
  mkRow('2026-11-08', C2, 'Second call', null),
  mkRow('2026-11-07', C1, '24-hour call', 24),
];
const STUB = `{id:'stub1',agency:'Premier Anesthesia Group, PC',facility:'',frequency:'biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'2026-11-10',gross:'12757.50',net:'',source:'ai-vision',fileName:'stub.png'}`;
const occ = (pd) => run(`paystubOccurrencesInMonth('2026-11')`).find(o => o.date === pd) || {};
const amt = (pd) => run(`paystubOccurrenceAmount(paystubOccurrencesInMonth('2026-11').find(o=>o.date==='${pd}'))`);
function runImportFlow() {
  run(`schedulePreview = {fileName:'QGenda feed', source:'qgenda-feed', matchedName:'Martin', rows:${JSON.stringify(NOV_ROWS)}, noNamesInFile:false, ai:false, parserVersion:6, facilityAll:'Holzer'};`);
  run(`window.__parsed = describeParseLocal(${JSON.stringify(HIS_TEXT)}, null, importRatesTarget(schedulePreview).codes);`);
  run(`schedulePreview.describe = {text:${JSON.stringify(HIS_TEXT)}, parsed:window.__parsed, error:'', busy:false, confirmed:true};`);
  run(`approveScheduleImport();`);
}

// ---------- 1: his exact flow, stub AFTER import (words card: paid hours 8) ----------
run(`db = empty(); db.settings.scheduleName='Martin'; persist();`);
runImportFlow();
run(`db.payStubs = [${STUB}]; persist();`);
t('flow: the import priced the shifts from his words (G Main $2,000 at the stated card)', run(`(db.shifts.find(s=>s.date==='2026-11-02')||{}).pay`) === '2000', run(`(db.shifts.find(s=>s.date==='2026-11-02')||{}).pay`));
t('flow: Nov 24 estimate is $26,200 under the card his words created (paid hours 8)', occ('2026-11-24').total === 26200 && amt('2026-11-24') === 26200, JSON.stringify(occ('2026-11-24')));
t('flow: Nov 10 stays the stub actual only (stub-as-default intact)', occ('2026-11-10').isActual === true && amt('2026-11-10') === 12757.5);
t('flow: headline is actual + estimate = $38,957.50', run(`monthHeadline('2026-11').gross`) === 38957.5, run(`monthHeadline('2026-11').gross`));

// ---------- 2: the other ordering — stub BEFORE the import ----------
run(`db = empty(); db.settings.scheduleName='Martin'; db.payStubs = [${STUB}]; persist();`);
runImportFlow();
t('order: stub-first flow lands the same Nov 24 estimate', occ('2026-11-24').total === 26200 && amt('2026-11-24') === 26200, JSON.stringify(occ('2026-11-24')));
t('order: headline identical in both orderings', run(`monthHeadline('2026-11').gross`) === 38957.5, run(`monthHeadline('2026-11').gross`));

// ---------- 3: his broken stored state heals on PLAIN OPEN (blank pays, 8.5 card) ----------
const FAC85 = `{id:'fac1',name:'Holzer',aliases:'',address:'',distance:'',hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'2625',rate12:'',rate24:'4800',weekendRate24:'4200',hourlyCall1st:'',rateSecond:'3000',weekendRateSecond:'2000',callBonus:'',codeMap:{'${G}':{label:'8-hour day',hours:'8',canonicalType:'8-hour day',rulesConfirmed:true,viaWords:true},'${C2}':{label:'Second call',weekdayPay:'3000',weekendPay:'2000',canonicalType:'Second call',rulesConfirmed:true,viaWords:true},'${C1}':{label:'24-hour call',weekdayPay:'4800',weekendPay:'4200',canonicalType:'24-hour call',rulesConfirmed:true,viaWords:true}},rulesConfirmed:true}`;
const mkS = (id, date, code, type, pay, incomplete) => ({ id, date, facility: 'Holzer', type, code, hours: '', pay, payUnit: pay ? 'facility' : '', status: 'confirmed', source: 'qgenda-feed', incomplete: !!incomplete, createdAt: '2026-11-10T13:00:00.000Z', updatedAt: '2026-11-10T13:00:00.000Z' });
const BLANK_SHIFTS = [
  ...['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-30'].map((d, i) => mkS('g' + i, d, G, '8-hour day', '', false)),
  mkS('c2a', '2026-11-03', C2, 'Second call', '', false),
  mkS('c2b', '2026-11-06', C2, 'Second call', '', false),
  mkS('c2c', '2026-11-08', C2, 'Second call', '', false),
  mkS('c1a', '2026-11-07', C1, '24-hour call', '', false),
];
run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${FAC85}]; db.shifts=${JSON.stringify(BLANK_SHIFTS)}; db.payStubs=[${STUB}]; persist(); month=new Date(2026,10,1);`);
// The exact boot sequence app.js runs on open:
run(`healDayCallShiftPairs(); healPaystubRecordShapes(); healUnpricedShiftPays();`);
t('heal: blank pays are stamped from the card on open (G Main $2,125 at paid hours 8.5)', run(`(db.shifts.find(s=>s.date==='2026-11-02')||{}).pay`) === '2125', run(`(db.shifts.find(s=>s.date==='2026-11-02')||{}).pay`));
t('heal: call splits stamped by day of week (Call 2 Tue $3,000 / Sun $2,000, Call 1 Sat $4,200)', run(`(db.shifts.find(s=>s.id==='c2a')||{}).pay`) === '3000' && run(`(db.shifts.find(s=>s.id==='c2c')||{}).pay`) === '2000' && run(`(db.shifts.find(s=>s.id==='c1a')||{}).pay`) === '4200');
t('heal: Nov 24 estimate is $27,075', occ('2026-11-24').total === 27075 && amt('2026-11-24') === 27075, JSON.stringify(occ('2026-11-24')));
t('heal: headline is $39,832.50 (actual + healed estimate)', run(`monthHeadline('2026-11').gross`) === 39832.5, run(`monthHeadline('2026-11').gross`));
t('heal: Nov 10 still shows ONLY the stub actual', occ('2026-11-10').isActual === true && amt('2026-11-10') === 12757.5);
t('heal: Dec 8 occurrence prices at the pinned $10,625', (run(`paystubOccurrencesInMonth('2026-12')`).find(o => o.date === '2026-12-08') || {}).total === 10625);
t('heal: the calendar chip reads est. $27,075.00 and never est. $0.00', run(`calendar()`).includes('est. $27,075.00') && !run(`calendar()`).includes('est. $0.00'));
t('heal: Upcoming paychecks agree', JSON.stringify(run(`paystubUpcoming().filter(x=>x.date==='2026-11-24').map(x=>paystubOccurrenceAmount(x))`)) === '[27075]');
t('heal: the day-sheet paycheck line shows the real estimate', run(`paystubPaycheckLineHTML(paystubOccurrencesInMonth('2026-11').find(o=>o.date==='2026-11-24'))`).includes('Estimated $27,075.00'));

// ---------- 4: read-time safety net — same state, heal NEVER run ----------
run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${FAC85}]; db.shifts=${JSON.stringify(BLANK_SHIFTS)}; db.payStubs=[${STUB}]; persist();`);
t('net: even unhealed, the occurrence prices live from the card — $27,075, not $0.00', occ('2026-11-24').total === 27075 && occ('2026-11-24').unpriced === 0, JSON.stringify(occ('2026-11-24')));
t('net: headline is whole without any stored stamps', run(`monthHeadline('2026-11').gross`) === 39832.5, run(`monthHeadline('2026-11').gross`));
t('net: the stored records are untouched by the read (no silent rewrite)', run(`db.shifts.every(s=>s.pay==='')`));

// ---------- 5: stamped but still flagged incomplete ----------
const PRICES = { '2026-11-02': '2125', '2026-11-04': '2125', '2026-11-05': '2125', '2026-11-10': '2125', '2026-11-11': '2125', '2026-11-12': '2125', '2026-11-13': '2125', '2026-11-16': '2125', '2026-11-17': '2125', '2026-11-18': '2125', '2026-11-19': '2125', '2026-11-20': '2125', '2026-11-30': '2125', '2026-11-03': '3000', '2026-11-06': '3000', '2026-11-08': '2000', '2026-11-07': '4200' };
const INC_SHIFTS = BLANK_SHIFTS.map(s => ({ ...s, pay: PRICES[s.date], payUnit: 'facility', incomplete: true }));
run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${FAC85}]; db.shifts=${JSON.stringify(INC_SHIFTS)}; db.payStubs=[${STUB}]; persist();`);
t('incomplete: read-time, the occurrence still prices ($27,075) — the flag cannot zero a check', occ('2026-11-24').total === 27075, JSON.stringify(occ('2026-11-24')));
run(`healUnpricedShiftPays();`);
t('incomplete: the heal clears flags whose stored amount equals the card price', run(`db.shifts.every(s=>!s.incomplete)`));
t('incomplete: stored amounts were not moved by the heal', run(`db.shifts.every(s=>s.pay===${JSON.stringify(PRICES)}[s.date])`));

// ---------- 6: genuinely unpriceable — "incomplete", never $0.00 ----------
const BARE_FAC = `{id:'fac9',name:'Holzer',aliases:'',hourlyRate:'',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',hourlyCall1st:'',rateSecond:'',weekendRateSecond:'',callBonus:'',codeMap:{}}`;
run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${BARE_FAC}]; db.shifts=${JSON.stringify(BLANK_SHIFTS)}; db.payStubs=[${STUB}]; persist(); month=new Date(2026,10,1);`);
t('unpriceable: the occurrence amount is null (no card can price these shifts)', amt('2026-11-24') === null, JSON.stringify(occ('2026-11-24')));
t('unpriceable: the calendar chip says "incomplete", never "est. $0.00"', run(`calendar()`).includes('incomplete') && !run(`calendar()`).includes('est. $0.00'));
t('unpriceable: the day-sheet line says not priced yet, not Estimated $0.00', run(`paystubPaycheckLineHTML(paystubOccurrencesInMonth('2026-11').find(o=>o.date==='2026-11-24'))`).includes('Not priced yet') && !run(`paystubPaycheckLineHTML(paystubOccurrencesInMonth('2026-11').find(o=>o.date==='2026-11-24'))`).includes('Estimated $0.00'));
t('unpriceable: the stub actual is unaffected', amt('2026-11-10') === 12757.5);

// ---------- 7: the [Martin] chip suffix is display-only ----------
run(`db = empty(); db.settings.scheduleName=''; db.facilities=[${FAC85}]; persist();`);
t('chip: with the schedule name unknown on this device, the chip still drops "[Martin]"', run(`shiftChipLabel({code:'HOLZ - G Main (8) [Martin]',type:'8-hour day',facility:'Holzer'})`) === 'HOLZ - G Main (8)', run(`shiftChipLabel({code:'HOLZ - G Main (8) [Martin]',type:'8-hour day',facility:'Holzer'})`));
t('chip: a bracket holding digits is real code text and stays', run(`shiftChipLabel({code:'HOLZ - G Main (8) [OR2]',type:'8-hour day',facility:'Holzer'})`) === 'HOLZ - G Main (8) [OR2]');
t('chip: pricing lookups were never affected — the def resolves with or without the bracket', !!run(`codeDefFor(db.facilities[0],'HOLZ - G Main (8) [Martin]')`) === !!run(`codeDefFor(db.facilities[0],'HOLZ - G Main (8)')`));

// ---------- 8: version pin ----------
t('sw: cache bumped to v106', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v131'));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
