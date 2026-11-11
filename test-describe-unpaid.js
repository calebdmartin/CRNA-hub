// Nov 10, 2026 — the describe-in-words reader learns "no pay".
//
// Caleb's live report (branch preview, v106, QGenda import "First
// time at HOLZ? Tell us how it pays"): his rules text said
// "Holz PCDO=post call day off=no pay" and the read-back priced
// PCDO anyway — "HOLZ - PCDO" (8-hour day): $250/hr × 8 paid hours
// = $2,000. Root cause, proven by reproduction before the fix:
// (1) NO negation handling existed anywhere in the parser —
// "no pay" was never scanned; canonicalTypeOf("post call day
// off=no pay") is '', so the def's type fell back to the QGenda
// feed's own row type, '8-hour day'; (2) with that type, the
// facility hourly default ($250, from the day-shift line) counted
// as coverage, and the summary's hourly fill printed the $2,000;
// the stated meaning survived only in the label string, which
// nothing prices from; (3) the amount capture keeps only positive
// figures, so even an explicit "$0" vanished; (4) no unpaid
// representation existed end to end — isPricedShift required
// pay > 0, so a stored $0 was "unpriced" by definition and the
// v106 live-pricing / boot-heal would have repriced it from the
// card (the resurrection trap).
//
// The fix: a statement-level no-pay read in describeCodeBlocks
// (explicit denial — "no pay", "unpaid", "not paid", a stated
// $0 — or a day-off meaning with no positive amount attached)
// resolves the code to an UNPAID definition: no priced canonical
// type attaches, the read-back states "no pay", and the def
// carries unpaid:true onto the saved codeMap. Pricing returns
// exactly $0 stamped payUnit 'unpaid' — a final marker in the
// same family as a manual entry / stub actual: isPricedShift
// counts it priced, isW2SalaryShift yields to it, and the heal,
// the live pricer and the paycheck totals all treat it as a
// KNOWN $0 that never reprices. A positive amount outranks a
// bare day-off phrase ("post call day off, paid $500 flat" pays
// $500); a positive amount beside an explicit denial with
// nothing settling which governs is the one genuine conflict
// and stays unanswered for the follow-up question. Nothing here
// knows the string "PCDO" — sections 3–5 use other facilities'
// codes throughout.
// Run: node test-describe-unpaid.js
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
const J = (v) => JSON.stringify(v);
const parse = (text, codes, fac) => run(`describeParseLocal(${J(text)}, ${fac ? J(fac) : 'null'}, ${J(codes)})`);

const HOLZER_CODES = [
  { code: 'HOLZ - G Main (8)', ctype: '8-hour day', hours: 8 },
  { code: 'HOLZ - Call 1', ctype: '24-hour call', hours: 24 },
  { code: 'HOLZ - Call 2', ctype: 'Second call', hours: 24 },
  { code: 'HOLZ - G Main (10)', ctype: '10-hour shift', hours: 10 },
  { code: 'HOLZ - PCDO', ctype: '8-hour day', hours: 8 },
];
// Caleb's FULL rules text, Nov 10, 2026 — the v105 lines plus the
// PCDO and weekend lines from the v106 screenshot, verbatim.
const CALEB_FULL = 'Holz-g main (8)= 8hour day shift $250/hour\nHolz-call 1= 24hr call. weekday=$4,800.\nWeekend=$4,200\nHolz-call 2= second call. Weekday=$3,000.\nWeekend=$2,000\nHolz-g main (10)=10hour day shift\nHolz PCDO=post call day off=no pay\n\nWeekend only includes Saturday and Sunday';

// ---------- 1. The pinned failing case: his full text ----------
{
  const p = parse(CALEB_FULL, HOLZER_CODES);
  const s = run(`describeSummaryText('HOLZ', ${J(p)}, null)`);
  t('pinned: PCDO resolves UNPAID', !!(p.defs['HOLZ - PCDO'] && p.defs['HOLZ - PCDO'].unpaid === true), J(p.defs['HOLZ - PCDO']));
  t('pinned: PCDO def carries NO priced canonical type (the feed guess cannot attach)', (p.defs['HOLZ - PCDO'] || {}).canonicalType === '', J(p.defs['HOLZ - PCDO']));
  t('pinned: PCDO label keeps his meaning, denial trimmed', (p.defs['HOLZ - PCDO'] || {}).label === 'post call day off', J(p.defs['HOLZ - PCDO']));
  t('pinned: nothing is unanswered — an unpaid code is known, not unknown', p.unanswered.length === 0 && !p.question, J(p.unanswered));
  t('pinned: read-back states PCDO as no pay', s.includes('“HOLZ - PCDO”: no pay — post call day off.'), s);
  t('pinned: read-back never prices PCDO', !s.includes('“HOLZ - PCDO” (8-hour day)'), s);
  t('pinned: the other four read-back lines are byte-identical to the live screenshot', s.includes('“HOLZ - G Main (8)” (8-hour day): $250/hr × 8 paid hours = $2,000.')
    && s.includes('“HOLZ - Call 1” (1st call): $4,800 on weekdays, $4,200 on weekends.')
    && s.includes('“HOLZ - Call 2” (2nd call): $3,000 on weekdays, $2,000 on weekends.')
    && s.includes('“HOLZ - G Main (10)” (10-hour shift): $250/hr × 10 paid hours = $2,500.'), s);
  t('pinned: weekend line still lands (Saturday and Sunday)', s.includes('Weekend means Saturday and Sunday.'), s);
  t('pinned: rates unchanged', p.rates.hourlyRate === 250 && p.rates.rate24 === 4800 && p.rates.weekendRate24 === 4200 && p.rates.rateSecond === 3000 && p.rates.weekendRateSecond === 2000, J(p.rates));
}

// ---------- 2. Saved card + pricing: $0, final, on any day ----------
{
  const p = parse(CALEB_FULL, HOLZER_CODES);
  const fac = run(`(() => { const f = {name:'Holzer'}; applyDescribedRules(f, ${J(p)}); return f; })()`);
  const def = (fac.codeMap || {})['HOLZ - PCDO'] || {};
  t('saved: the codeMap entry carries unpaid:true', def.unpaid === true, J(def));
  t('saved: priced residue cleared (no canonical type, no per-code amounts)', !def.canonicalType && def.weekdayPay == null && def.weekendPay == null, J(def));
  const wed = run(`clarifiedRowPricing(${J(fac)}, {code:'HOLZ - PCDO', type:'8-hour day', date:'2026-11-04'})`);
  const sat = run(`clarifiedRowPricing(${J(fac)}, {code:'HOLZ - PCDO', type:'8-hour day', date:'2026-11-07'})`);
  t('pricing: PCDO prices exactly $0 as a complete price (payUnit unpaid)', wed.pay === '0' && wed.payUnit === 'unpaid' && sat.pay === '0' && sat.payUnit === 'unpaid', J({ wed, sat }));
  const gm = run(`clarifiedRowPricing(${J(fac)}, {code:'HOLZ - G Main (8)', type:'8-hour day', date:'2026-11-04'})`);
  const c1f = run(`facilityPayFor(${J(fac)}, '24-hour call', '2026-11-06')`);
  const c1s = run(`facilityPayFor(${J(fac)}, '24-hour call', '2026-11-07')`);
  t('pricing: the paid codes are untouched (G Main $2,000, Call 1 $4,800 Fri / $4,200 Sat)', gm.pay === '2000' && c1f === 4800 && c1s === 4200, J({ gm: gm.pay, c1f, c1s }));
  // A re-confirm of words that now PRICE the code clears the marker.
  const p2 = parse('Holz PCDO = post call coverage, $300 flat', HOLZER_CODES, fac);
  const fac2 = run(`(() => { const f = ${J(fac)}; applyDescribedRules(f, ${J(p2)}); return f; })()`);
  t('saved: later words that price the code clear unpaid (newest words govern)', !((fac2.codeMap || {})['HOLZ - PCDO'] || {}).unpaid, J((fac2.codeMap || {})['HOLZ - PCDO']));
}

// ---------- 3. Other users' no-pay shapes — nothing PCDO-specific ----------
{
  const codes = [
    { code: 'RGH - OFF', ctype: '', hours: 8 },
    { code: 'RGH - Admin', ctype: '', hours: 4 },
    { code: 'RGH - PTO', ctype: '8-hour day', hours: 8 },
    { code: 'RGH - VAC', ctype: '', hours: 8 },
  ];
  const txt = 'OFF = day off, no pay\nAdmin = unpaid admin time\nPTO = paid time off at $0 from the agency\nVAC is a vacation day. No pay for those.';
  const p = parse(txt, codes);
  for (const c of ['RGH - OFF', 'RGH - Admin', 'RGH - PTO', 'RGH - VAC']) {
    t('shapes: ' + c + ' resolves unpaid', !!(p.defs[c] && p.defs[c].unpaid === true), J(p.defs[c]));
  }
  t('shapes: nothing unanswered', p.unanswered.length === 0, J(p.unanswered));
  const s = run(`describeSummaryText('RGH', ${J(p)}, null)`);
  t('shapes: every read-back line says no pay', (s.match(/no pay —/g) || []).length === 4, s);
  const fac = run(`(() => { const f = {name:'RGH', hourlyRate:'200'}; applyDescribedRules(f, ${J(p)}); return f; })()`);
  const adm = run(`clarifiedRowPricing(${J(fac)}, {code:'RGH - Admin', type:'', date:'2026-11-04'})`);
  t('shapes: an unpaid code prices $0 even where an hourly rate exists to fill in', adm.pay === '0' && adm.payUnit === 'unpaid', J(adm));
}

// ---------- 4. A stated amount outranks a bare day-off phrase ----------
{
  const txt = 'Holz PCDO = post call day off, paid $500 flat';
  const p = parse(txt, HOLZER_CODES);
  t('paid variant: NOT unpaid (the stated amount governs)', !(p.defs['HOLZ - PCDO'] || {}).unpaid && !p.unanswered.includes('HOLZ - PCDO'), J(p.defs['HOLZ - PCDO']) + ' / ' + J(p.unanswered));
  const fac = run(`(() => { const f = {name:'Holzer', hourlyRate:'250'}; applyDescribedRules(f, ${J(p)}); return f; })()`);
  const pr = run(`clarifiedRowPricing(${J(fac)}, {code:'HOLZ - PCDO', type:'8-hour day', date:'2026-11-04'})`);
  t('paid variant: prices the stated $500 flat', pr.pay === '500', J(pr));
}

// ---------- 5. Genuine conflict → the one follow-up question ----------
{
  const codes = [HOLZER_CODES[4], HOLZER_CODES[2]];
  const p = parse('Call 2 is $3,000 on weekdays and $2,000 on weekends. PCDO = no pay, $2,000', codes);
  t('conflict: amount + explicit denial with nothing settling it stays unanswered', p.unanswered.length === 1 && p.unanswered[0] === 'HOLZ - PCDO', J(p.unanswered));
  t('conflict: the fully stated code is NOT asked about', !p.unanswered.includes('HOLZ - Call 2') && !!p.question && p.question.includes('HOLZ - PCDO'), p.question || '');
  t('conflict: no unpaid def is saved for a conflicted code', !(p.defs['HOLZ - PCDO'] || {}).unpaid, J(p.defs['HOLZ - PCDO']));
}

// ---------- 6. End-to-end: QGenda import flow with a PCDO row ----------
const G = 'HOLZ - G Main (8)', C2 = 'HOLZ - Call 2', C1 = 'HOLZ - Call 1', PCDO = 'HOLZ - PCDO';
const STUB = `{id:'stub1',agency:'Premier Anesthesia Group, PC',facility:'',frequency:'biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'2026-11-10',gross:'12757.50',net:'',source:'ai-vision',fileName:'stub.png'}`;
const mkRow = (date, code, type, hours) => ({ date, facility: 'HOLZ', type, code, hours, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed', incomplete: true });
const BASE_ROWS = [
  ...['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map(d => mkRow(d, G, '8-hour day', 8)),
  mkRow('2026-11-03', C2, 'Second call', null),
  mkRow('2026-11-06', C2, 'Second call', null),
  mkRow('2026-11-08', C2, 'Second call', null),
  mkRow('2026-11-07', C1, '24-hour call', 24),
];
function runFlow(rows) {
  run(`db = empty(); db.settings.scheduleName='Martin'; persist();`);
  run(`schedulePreview = {fileName:'QGenda feed', source:'qgenda-feed', matchedName:'Martin', rows:${J(rows)}, noNamesInFile:false, ai:false, parserVersion:6, facilityAll:'Holzer'};`);
  run(`window.__parsed = describeParseLocal(${J(CALEB_FULL)}, null, importRatesTarget(schedulePreview).codes);`);
  run(`schedulePreview.describe = {text:${J(CALEB_FULL)}, parsed:window.__parsed, error:'', busy:false, confirmed:true};`);
  run(`approveScheduleImport();`);
  run(`db.payStubs = [${STUB}]; persist();`);
}
{
  runFlow(BASE_ROWS);
  const baseOcc = run(`paystubOccurrencesInMonth('2026-11')`).find(o => o.date === '2026-11-24') || {};
  const baseHead = run(`monthHeadline('2026-11').gross`);
  runFlow([...BASE_ROWS, mkRow('2026-11-09', PCDO, '8-hour day', 8)]);
  const sh = run(`db.shifts.find(s=>s.code===${J(PCDO)})`) || {};
  t('flow: the PCDO shift saves at $0, stamped unpaid, NOT incomplete', sh.pay === '0' && sh.payUnit === 'unpaid' && sh.incomplete === false, J(sh));
  t('flow: isPricedShift counts it priced (a known $0)', run(`isPricedShift(db.shifts.find(s=>s.code===${J(PCDO)}))`) === true);
  t('flow: it is NOT classified a W-2 salary day', run(`isW2SalaryShift(db.shifts.find(s=>s.code===${J(PCDO)}))`) === false);
  const occ = run(`paystubOccurrencesInMonth('2026-11')`).find(o => o.date === '2026-11-24') || {};
  t('flow: the paycheck total is unchanged by the PCDO day in its period', occ.total === baseOcc.total && baseOcc.total === 26200, J({ occ: occ.total, base: baseOcc.total }));
  t('flow: the PCDO day counts as a known shift in the period, never unpriced', occ.unpriced === 0 && occ.shiftCount === baseOcc.shiftCount + 1, J({ occ, base: baseOcc }));
  t('flow: headline unchanged', run(`monthHeadline('2026-11').gross`) === baseHead && baseHead === 38957.5, String(run(`monthHeadline('2026-11').gross`)));
  const mis = run(`monthIncomeSplit('2026-11')`);
  t('flow: month split — PCDO is not in the unpriced count and not a W-2 day', mis.unpriced === 0 && mis.w2Salary === 0, J(mis));
}

// ---------- 7. The heal + live pricer cannot resurrect an unpaid $0 ----------
const FAC85_PC = `{id:'fac1',name:'Holzer',aliases:'',address:'',distance:'',hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'2625',rate12:'',rate24:'4800',weekendRate24:'4200',hourlyCall1st:'',rateSecond:'3000',weekendRateSecond:'2000',callBonus:'',codeMap:{'${PCDO}':{label:'post call day off',hours:'8',canonicalType:'',unpaid:true,rulesConfirmed:true,viaWords:true}},rulesConfirmed:true}`;
const mkPC = (id, pay, payUnit, incomplete) => ({ id, date: '2026-11-09', facility: 'Holzer', type: '8-hour day', code: PCDO, hours: '', pay, payUnit, status: 'confirmed', source: 'qgenda-feed', incomplete: !!incomplete, createdAt: '2026-11-10T17:00:00.000Z', updatedAt: '2026-11-10T17:00:00.000Z' });
{
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${FAC85_PC}]; db.shifts=[${J(mkPC('p1', '2000', 'facility', false))},${J(mkPC('p2', '', '', true))},${J(mkPC('p3', '0', 'unpaid', true))},${J(mkPC('p4', '2000', 'daily', false))}]; persist();`);
  run(`healUnpricedShiftPays();`);
  const g = (id) => run(`db.shifts.find(s=>s.id==='${id}')`) || {};
  t('heal: a derived $2,000 stamp on an unpaid code is corrected to the known $0', g('p1').pay === '0' && g('p1').payUnit === 'unpaid' && g('p1').incomplete === false, J(g('p1')));
  t('heal: a blank-pay unpaid shift is stamped $0/unpaid, not priced from the card', g('p2').pay === '0' && g('p2').payUnit === 'unpaid' && g('p2').incomplete === false, J(g('p2')));
  t('heal: a stale incomplete flag on an unpaid $0 clears', g('p3').pay === '0' && g('p3').incomplete === false, J(g('p3')));
  t('heal: a hand-typed per-shift total (daily) is the user\'s correction and is left alone', g('p4').pay === '2000' && g('p4').payUnit === 'daily', J(g('p4')));
  // Read-time, heal never run: the paycheck layer still cannot price it.
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${FAC85_PC}]; db.shifts=[${J(mkPC('p5', '', '', true))}]; db.payStubs=[${STUB}]; persist();`);
  t('net: live pricer returns 0 for an unpaid code (never the card price for its feed type)', run(`paystubLiveShiftPrice(db.shifts[0])`) === 0);
  const tot = run(`(() => { const claims = paystubShiftClaims(); const stub = paystubSchedules()[0]; return paystubPeriodTotals(stub, '2026-11-02', '2026-11-15', claims); })()`);
  t('net: period totals count it priced-at-$0 — total 0 shifts\' worth, unpriced 0', tot.shiftCount === 1 && tot.pricedCount === 1 && tot.unpriced === 0 && tot.total === 0, J(tot));
}

// ---------- 8. Prefill round-trip: the words box remembers no-pay ----------
{
  const p = parse(CALEB_FULL, HOLZER_CODES);
  const fac = run(`(() => { const f = {name:'Holzer'}; applyDescribedRules(f, ${J(p)}); return f; })()`);
  const pre = run(`describePrefillText(${J(fac)}, facilityDescribeCodes(${J(fac)}))`);
  t('prefill: the generated sentence states the no-pay rule', pre.includes('HOLZ - PCDO is post call day off — no pay.'), pre);
  const p2 = parse(pre, run(`facilityDescribeCodes(${J(fac)})`), fac);
  t('prefill: re-parsing the prefill keeps PCDO unpaid', !!((p2.defs['HOLZ - PCDO'] || {}).unpaid), J(p2.defs['HOLZ - PCDO']));
  t('prefill: re-parsing keeps the rates too', p2.rates.rate24 === 4800 && p2.rates.rateSecond === 3000, J(p2.rates));
}

// ---------- 9. Version pin ----------
t('sw: cache bumped to v107', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v130'));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
