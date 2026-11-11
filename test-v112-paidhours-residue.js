// Nov 10, 2026 (late evening) — v112: ONE narrow defect left,
// proven LIVE twice on Caleb's QGenda test account (branch
// preview, SW v111): on an EXISTING facility, re-parsing his
// words still read G Main (10) back as "$250/hr × 8.5 paid
// hours = $2,125", and the saved Oct 6, 2026 G Main (10) shift
// stayed $2,125 after "Use these rules — save & reprice".
//
// The same text on a FRESH card parses correctly under v111
// (pinned in test-v111-live-fixes.js) — the fault is specific
// to the existing-facility path. The state below is the live
// one: the HOLZ facility and its definitions were created by
// the v110 QGenda IMPORT approve (applyDescribedRules — the
// definitions carry viaWords), and the v110 parse stamped the
// facility's paidHours8 (8.5, the 8-HOUR shift's paid hours)
// onto the 10-hour code's definition as per-code paidHours.
//
// Root cause (proven by this file failing on v111):
//  1. describeParseLocal's definition builder INHERITS the
//     saved definition's paidHours for any non-8-hour day code
//     whose own statement states none — so the residue is
//     re-supplied by the parse itself, the read-back shows it,
//     and applyDescribedRules' v111 retraction (which only
//     fires when the parse states NO paid hours) never fires.
//  2. The heal/repair pass heals rate FLATS with that
//     signature but never looks at definition paidHours, so on
//     plain open clarifiedRowPricing keeps pricing the code
//     at hourly x 8.5 = $2,125.
//
// The rule the fix encodes (general — no facility, code or
// figure is special-cased): facility paidHours8 is a property
// of 8-HOUR shifts only. It may never become a per-code
// paid-hours value, a read-back line, or a price input for a
// code whose own statement/type is not 8-hour — UNLESS that
// code's own captured words or fields state paid hours (a
// code whose own statement says "paid for 10.5 hours" keeps
// 10.5, marked as its own; a per-code paid-hours answer typed
// into the clarification fields is marked field-captured and
// preserved). The residue signature is exact: a words-created
// (viaWords) non-8-hour day definition whose paidHours EQUALS
// the facility's paidHours8 and carries no own-statement
// marker. Both the re-parse (don't inherit it) and the heal
// (retract it on open, then reprice in the same pass) key on
// that signature.
// Run: node test-v112-paidhours-residue.js
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
const J = (v) => JSON.stringify(v);

const CODES = [
  { code: 'HOLZ - G Main (8)', ctype: '8-hour day', hours: 8 },
  { code: 'HOLZ - Call 1', ctype: '24-hour call', hours: 24 },
  { code: 'HOLZ - Call 2', ctype: 'Second call', hours: 24 },
  { code: 'HOLZ - G Main (10)', ctype: '10-hour shift', hours: 10 },
  { code: 'HOLZ - PCDO', ctype: '8-hour day', hours: 8 },
];
const WORDS_LINES = 'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours\nHolz-call 1=24hr call. Weekday=$4,800 weekend $4,200\nHolz-call 2=2nd call weekday=$3,000 weekend $2,000\nHolz-g main (10)=10hour day shift\nHolz PCDO=post call day off=no pay\nWeekends only include Saturday and Sunday.';

// The LIVE existing-facility state: card + definitions as the
// v110 import approve saved them (words-created, viaWords),
// including the paidHours residue on G Main (10).
const LIVE_FAC = `{
  id:'f1', name:'HOLZ', aliases:'', address:'', hourlyRate:'250', paidHours8:'8.5',
  rate8:'', rate10:'', rate12:'', rate24:'4800', weekendRate24:'4200',
  rateSecond:'3000', weekendRateSecond:'2000', callBonus:'', hourlyCall1st:'',
  weekendDays:[0,6], ratesSource:'manual',
  codeMap:{
    'HOLZ - G Main (8)':{ label:'8hr day shift', hours:'8', canonicalType:'8-hour day', paidHours:'8.5', rulesConfirmed:true, viaWords:true },
    'HOLZ - Call 1':{ label:'24hr call', hours:'24', canonicalType:'24-hour call', rulesConfirmed:true, viaWords:true },
    'HOLZ - Call 2':{ label:'2nd call', hours:'24', canonicalType:'Second call', rulesConfirmed:true, viaWords:true },
    'HOLZ - G Main (10)':{ label:'10hour day shift', hours:'10', canonicalType:'10-hour shift', paidHours:'8.5', rulesConfirmed:true, viaWords:true },
    'HOLZ - PCDO':{ label:'post call day off', hours:'8', canonicalType:'', rulesConfirmed:true, viaWords:true, unpaid:true }
  } }`;
const OCT6 = `{ id:'oct6', date:'2026-10-06', facility:'HOLZ', type:'10-hour shift', code:'HOLZ - G Main (10)', pay:'2125', payRate:'250', payUnit:'hourly', status:'confirmed', source:'qgenda-feed', sources:['qgenda-feed'], incomplete:false, note:'', updatedAt:null }`;
// November shifts at their correct prices (for the money pins).
const NOV_SH = (id, date, type, code, pay) => ({ id, date, facility: 'HOLZ', type, code, pay, payUnit: 'facility', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], note: '', updatedAt: null });
const NOV_SHIFTS = [
  ...['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d, i) => NOV_SH('g' + i, d, '8-hour day', 'HOLZ - G Main (8)', '2125')),
  NOV_SH('n1', '2026-11-03', 'Second call', 'HOLZ - Call 2', '3000'),
  NOV_SH('n2', '2026-11-06', 'Second call', 'HOLZ - Call 2', '3000'),
  NOV_SH('n3', '2026-11-08', 'Second call', 'HOLZ - Call 2', '2000'),
  NOV_SH('n4', '2026-11-07', '24-hour call', 'HOLZ - Call 1', '4200'),
  ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map((d, i) => NOV_SH('d' + i, d, '8-hour day', 'HOLZ - G Main (8)', '2125')),
  NOV_SH('n5', '2026-11-30', '8-hour day', 'HOLZ - G Main (8)', '2125'),
];
const REC_A = `{ id:'ps-a', agency:'Holzer', facility:'', frequency:'biweekly', payDate:'2026-11-10', periodStart:'', periodEnd:'', gross:'', net:'', source:'import', fileName:'' }`;
const REC_B = `{ id:'ps-b', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', payDate:'2026-11-10', periodStart:'2026-10-19', periodEnd:'2026-11-01', gross:'12757.50', net:'', source:'stub', fileName:'' }`;
const moneyPins = (label) => {
  const occN = run(`paystubOccurrencesInMonth('2026-11')`);
  const nov24 = occN.find(o => o.date === '2026-11-24');
  t(label + ': Nov 24 still $27,075', !!nov24 && run(`paystubOccurrenceAmount(${J(nov24)})`) === 27075, J(nov24 && { total: nov24.total }));
  const dec8 = run(`paystubOccurrencesInMonth('2026-12')`).find(o => o.date === '2026-12-08');
  t(label + ': Dec 8 still $10,625', !!dec8 && run(`paystubOccurrenceAmount(${J(dec8)})`) === 10625, J(dec8 && { total: dec8.total }));
  t(label + ': headline still $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.5, String(run(`monthHeadline('2026-11').gross`)));
};

// ---------- A. Re-confirm on the existing facility ----------
{
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [${LIVE_FAC}];
    db.shifts = [${OCT6}, ...${J(NOV_SHIFTS)}];
    db.payStubs = [${REC_A}, ${REC_B}];
    persist();`);
  const fac = run(`db.facilities[0]`);
  const p = run(`describeParseLocal(${J(WORDS_LINES)}, ${J(fac)}, ${J(CODES)})`);
  t('A: re-parse resolves all five codes', p.unanswered.length === 0, J(p.unanswered));
  t('A: re-parse does NOT inherit the residue — G Main (10) def has no paidHours',
    !!p.defs['HOLZ - G Main (10)'] && p.defs['HOLZ - G Main (10)'].paidHours == null, J(p.defs['HOLZ - G Main (10)']));
  t('A: G Main (8) def keeps its own stated 8.5', !!p.defs['HOLZ - G Main (8)'] && p.defs['HOLZ - G Main (8)'].paidHours === 8.5, J(p.defs['HOLZ - G Main (8)']));
  const s = run(`describeSummaryText('HOLZ', ${J(p)}, ${J(fac)})`);
  const seg10 = (s.match(/“HOLZ - G Main \(10\)”[^.]*/) || [''])[0];
  t('A: read-back — (10) carries NO 8.5 paid-hours line and totals $2,500', !seg10.includes('8.5') && seg10.includes('$2,500'), seg10);
  t('A: read-back — (8) still $250/hr × 8.5 = $2,125; calls and PCDO unchanged',
    s.includes('“HOLZ - G Main (8)” (8-hour day): $250/hr × 8.5 paid hours = $2,125.') &&
    s.includes('$4,800 on weekdays') && s.includes('$4,200 on weekends') && s.includes('no pay'), s);
  run(`(() => { const f = db.facilities[0]; applyDescribedRules(f, ${J(p)}); })()`);
  t('A: after save, the (10) definition holds NO paidHours (residue retracted)',
    run(`db.facilities[0].codeMap['HOLZ - G Main (10)'].paidHours`) === undefined, J(run(`db.facilities[0].codeMap['HOLZ - G Main (10)']`)));
  t('A: the saved Oct 6 G Main (10) shift reprices $2,125 → $2,500',
    run(`db.shifts.find(x=>x.id==='oct6').pay`) === '2500', run(`db.shifts.find(x=>x.id==='oct6').pay`));
  t('A: card untouched where it should be — hourly 250, paidHours8 8.5, call splits intact',
    run(`db.facilities[0].hourlyRate`) === '250' && run(`db.facilities[0].paidHours8`) === '8.5' &&
    run(`db.facilities[0].rate24`) === '4800' && run(`db.facilities[0].weekendRate24`) === '4200', '');
  moneyPins('A');
}

// ---------- B. Heal on plain open (no re-confirm) ----------
{
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [${LIVE_FAC}];
    db.shifts = [${OCT6}];
    db.payStubs = []; persist();`);
  run(`healUnpricedShiftPays()`);
  t('B: heal-on-open retracts the residue from the (10) definition',
    run(`db.facilities[0].codeMap['HOLZ - G Main (10)'].paidHours`) === undefined, J(run(`db.facilities[0].codeMap['HOLZ - G Main (10)']`)));
  t('B: heal-on-open reprices Oct 6 $2,125 → $2,500 in the same pass',
    run(`db.shifts.find(x=>x.id==='oct6').pay`) === '2500', run(`db.shifts.find(x=>x.id==='oct6').pay`));
  t('B: the (8) definition keeps its own 8.5 through the heal',
    run(`db.facilities[0].codeMap['HOLZ - G Main (8)'].paidHours`) === '8.5', '');
}
{
  // Anti-overreach 1: a 10-hour code whose OWN words stated
  // paid hours ("paid for 10.5 hours") — parsed fresh so the
  // own-statement marker is set — must survive the heal and
  // keep pricing $2,625, on re-parse AND on open.
  const codes2 = [CODES[0], CODES[3]];
  const pOwn = run(`describeParseLocal('Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours\\nHolz-g main (10)=10hour day shift, paid for 10.5 hours', null, ${J(codes2)})`);
  t('B: own-statement parse — (10) paidHours is its OWN 10.5', !!pOwn.defs['HOLZ - G Main (10)'] && pOwn.defs['HOLZ - G Main (10)'].paidHours === 10.5, J(pOwn.defs['HOLZ - G Main (10)']));
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [{ id:'f1', name:'HOLZ', aliases:'', hourlyRate:'250', paidHours8:'8.5', rate8:'', rate10:'', codeMap:{} }];
    db.shifts = [{ id:'t10', date:'2026-10-06', facility:'HOLZ', type:'10-hour shift', code:'HOLZ - G Main (10)', pay:'2625', payRate:'250', payUnit:'hourly', status:'confirmed', source:'qgenda-feed', sources:['qgenda-feed'], incomplete:false, note:'', updatedAt:null }];
    db.payStubs = []; persist();`);
  run(`(() => { const f = db.facilities[0]; applyDescribedRules(f, ${J(pOwn)}); })()`);
  run(`healUnpricedShiftPays()`);
  t('B: heal does NOT retract a code\'s own stated paid hours (10.5 stays)',
    run(`db.facilities[0].codeMap['HOLZ - G Main (10)'].paidHours`) === '10.5', J(run(`db.facilities[0].codeMap['HOLZ - G Main (10)']`)));
  t('B: and its shift keeps pricing $2,625', run(`db.shifts.find(x=>x.id==='t10').pay`) === '2625', run(`db.shifts.find(x=>x.id==='t10').pay`));
}
{
  // Anti-overreach 2: a NON-words (field-captured) definition
  // is outside the heal signature — the v111 pin — its
  // paidHours stays through heal and through a re-confirm.
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [{ id:'f1', name:'HOLZ', aliases:'', hourlyRate:'250', paidHours8:'8.5', rate8:'', codeMap:{
      'HOLZ - G Main (12)':{ label:'12hour day shift', hours:'12', canonicalType:'12-hour shift', paidHours:'8.5', rulesConfirmed:true }
    } }];
    db.shifts = []; db.payStubs = []; persist();`);
  run(`healUnpricedShiftPays()`);
  t('B: heal leaves a field-captured (non-words) definition\'s paidHours alone',
    run(`db.facilities[0].codeMap['HOLZ - G Main (12)'].paidHours`) === '8.5', J(run(`db.facilities[0].codeMap['HOLZ - G Main (12)']`)));
}
{
  // Anti-overreach 3 (non-Caleb shape): the residue signature
  // at another facility — RGH, $180/hr, paidHours8 8.5 stamped
  // onto its 10-hour words-created def — heals the same way.
  run(`db = empty(); db.settings.scheduleName = 'Doe';
    db.facilities = [{ id:'f9', name:'RGH', aliases:'', hourlyRate:'180', paidHours8:'8.5', rate8:'', rate10:'', codeMap:{
      'RGH - Ten':{ label:'10 hour day shift', hours:'10', canonicalType:'10-hour shift', paidHours:'8.5', rulesConfirmed:true, viaWords:true }
    } }];
    db.shifts = [{ id:'rgh1', date:'2026-11-02', facility:'RGH', type:'10-hour shift', code:'RGH - Ten', pay:'1530', payRate:'180', payUnit:'hourly', status:'confirmed', source:'qgenda-feed', sources:['qgenda-feed'], incomplete:false, note:'', updatedAt:null }];
    db.payStubs = []; persist();`);
  run(`healUnpricedShiftPays()`);
  t('B: non-Caleb residue heals identically — def retracted, shift $1,530 → $1,800 (180 × 10)',
    run(`db.facilities[0].codeMap['RGH - Ten'].paidHours`) === undefined && run(`db.shifts.find(x=>x.id==='rgh1').pay`) === '1800',
    J({ def: run(`db.facilities[0].codeMap['RGH - Ten']`), pay: run(`db.shifts.find(x=>x.id==='rgh1').pay`) }));
}

t('sw: cache bumped to v112', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v120'));
console.log(fails ? ('FAILURES: ' + fails) : 'ALL PASS');
