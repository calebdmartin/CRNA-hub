// Edit-form / reprice round (Caleb, Nov 10, 2026, live report): he
// edited his HOLZ facility in the full Edit form to add the ADDRESS
// and got: "9 unpriced shift(s) priced from the HOLZ pay rule. The
// next calendar sync also re-scans past events for this facility."
// His ask: "We need to have the shift rules communicate over to this
// section. Or just fix why it doesn't have pricing for those 9
// shifts."
//
// Proven root causes (traced on the pre-fix code; this file pins the
// fixed behavior):
// - WHICH 9: the shifts whose stored pay was stamped by an earlier
//   wrong formula and still flagged incomplete — 7x "HOLZ - G Main
//   (8)" (Nov 2,4,5,10,11,12,13) stamped $2,000 = $250x8 from before
//   paid hours 8.5 were confirmed (payUnit 'daily'), Tue Nov 3
//   "HOLZ - Call 2" and Sat Nov 7 "HOLZ - Call 1" stamped $6,000 =
//   $250x24 from before the weekday/weekend split landed (payUnit
//   'hourly'). Blank shifts healed fine at boot; these nine did not.
// - WHY THEY SAT UNPRICED: healUnpricedShiftPays stamped only BLANK
//   pays and cleared an incomplete flag only when the stored amount
//   already equalled the resolved price. A derived stamp that
//   disagreed with the current rules kept its flag forever
//   (isPricedShift false), so the shifts counted as unpriced on
//   every open until a facility save ran the one pass that restamps
//   derived amounts. The cloud merge never re-ran the heal either.
// - THE FORM ATE A RULE: RATE_FIELDS includes weekendRate24, but the
//   Edit form rendered no weekendRate24 field. submitEntry built the
//   record from the form alone, then force-normalized every
//   RATE_FIELDS key — record.weekendRate24 was undefined, became '',
//   and the spread merge wrote '' over the saved $4,200. The same
//   save's reprice then restamped the (derived) Saturday Call 1
//   shift from the wiped card: $4,200 -> $4,800, and the Nov 24
//   paycheck moved $27,075 -> $27,675.
// - THE PASSES DISAGREED: the save-time blank loop priced from the
//   card only (facilityPayFor), the boot heal and the paycheck layer
//   priced per-code definitions first. One resolution order now:
//   unpaid def -> clarified per-code def -> card by type
//   (resolveShiftPrice), and ONE repair pass
//   (repairShiftPaysForFacility) behind the boot heal, the facility
//   save, and the post-merge heal.
// - The Edit form also never SHOWED the per-shift rules; it now
//   lists them ("Shift rules from your words") and renders the
//   weekendRate24 field it used to wipe.
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

const G8 = 'HOLZ - G Main (8)', G10 = 'HOLZ - G Main (10)', C1 = 'HOLZ - Call 1', C2 = 'HOLZ - Call 2', PCDO = 'HOLZ - PCDO';
const FAC = `{id:'facH',name:'HOLZ',aliases:'Holzer',address:'',distance:'',notes:'',hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'2625',rate12:'',rate24:'4800',weekendRate24:'4200',hourlyCall1st:'',rateSecond:'3000',weekendRateSecond:'2000',callBonus:'',weekendDays:[0,6],ratesSource:'words',codeMap:{
'${G8}':{label:'8-hour day',hours:'8',paidHours:'8.5',canonicalType:'8-hour day',rulesConfirmed:true,viaWords:true},
'${G10}':{label:'10-hour shift',hours:'10',canonicalType:'10-hour shift',rulesConfirmed:true,viaWords:true},
'${C1}':{label:'24-hour call',canonicalType:'24-hour call',rulesConfirmed:true,viaWords:true},
'${C2}':{label:'Second call',canonicalType:'Second call',rulesConfirmed:true,viaWords:true},
'${PCDO}':{label:'post call day off',unpaid:true,rulesConfirmed:true,viaWords:true}},rulesConfirmed:true}`;
const mkS = (id, date, code, type, pay, payUnit, incomplete, extra) => Object.assign({ id, date, facility: 'HOLZ', type, code, hours: '', pay, payRate: '', payUnit, status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: !!incomplete, createdAt: '2026-11-09T15:00:00.000Z', updatedAt: '2026-11-09T15:00:00.000Z' }, extra || {});
const SHIFTS = [
  // The nine from his toast, in their bug states:
  ...['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d, i) => mkS('g' + i, d, G8, '8-hour day', '2000', 'daily', true)),
  mkS('c2a', '2026-11-03', C2, 'Second call', '6000', 'hourly', true),
  mkS('c1a', '2026-11-07', C1, '24-hour call', '6000', 'hourly', true),
  // Healthy stamps:
  mkS('c2b', '2026-11-06', C2, 'Second call', '3000', 'facility', false),
  mkS('c2c', '2026-11-08', C2, 'Second call', '2000', 'facility', false),
  mkS('g10', '2026-11-30', G10, '10-hour shift', '2625', 'facility', false),
  mkS('pcdo', '2026-11-09', PCDO, 'post call day off', '0', 'unpaid', false),
  // Blank pays:
  ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d, i) => mkS('b' + i, d, G8, '8-hour day', '', '', true)),
];
const STUB = `{id:'stub1',agency:'Premier Anesthesia Group, PC',facility:'',frequency:'biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'2026-11-10',gross:'12757.50',net:'',source:'ai-vision',fileName:'stub.png'}`;
const seed = () => run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${FAC}]; db.shifts=${JSON.stringify(SHIFTS)}; db.payStubs=[${STUB}]; persist();`);
const occ24 = () => run(`(paystubOccurrencesInMonth('2026-11').find(o=>o.date==='2026-11-24')||{}).total`);
const payOf = (id) => run(`(db.shifts.find(s=>s.id==='${id}')||{}).pay`);
const bootSeq = () => run(`dedupeShiftsInPlace(); healDayCallShiftPairs(); healPaystubRecordShapes(); healUnpricedShiftPays();`);
function saveFacilityForm(entries) {
  run(`editId='facH';`);
  const form = getEl('entryForm');
  form.dataset.kind = 'facilities';
  form._entries = entries;
  alerts.length = 0;
  run(`submitEntry({preventDefault(){}, currentTarget: document.getElementById('entryForm')});`);
}
const FORM_BASE = [
  ['name', 'HOLZ'], ['aliases', 'Holzer'], ['address', '100 Jackson Pike, Gallipolis, OH 45631'],
  ['hourlyRate', '250'], ['paidHours8', '8.5'], ['rate8', ''], ['rate10', '2625'], ['rate12', ''],
  ['rate24', '4800'], ['hourlyCall1st', ''], ['rateSecond', '3000'], ['weekendRateSecond', '2000'],
  ['callBonus', ''], ['distance', ''], ['distanceSource', ''], ['notes', ''],
];

// ---------- 1: plain open heals to ZERO unpriced, exact amounts ----------
seed();
t('before open: 13 shifts count as unpriced (9 stale-stamped + 4 blank)', run(`db.shifts.filter(s=>!isPricedShift(s)).length`) === 13, run(`db.shifts.filter(s=>!isPricedShift(s)).length`));
bootSeq();
t('open: zero unpriced HOLZ shifts remain', run(`db.shifts.filter(s=>!isPricedShift(s)).length`) === 0, run(`db.shifts.filter(s=>!isPricedShift(s)).map(s=>s.date+':'+s.pay+':'+s.incomplete).join(';')`));
t('open: the seven stale G Main (8) stamps follow paid hours 8.5 -> $2,125', ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6'].every(id => payOf(id) === '2125'), ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map(payOf).join(','));
t('open: Call 2 Tue Nov 3 follows the split -> $3,000 (was $6,000)', payOf('c2a') === '3000', payOf('c2a'));
t('open: Call 1 Sat Nov 7 follows the weekend rate -> $4,200 (was $6,000)', payOf('c1a') === '4200', payOf('c1a'));
t('open: healthy stamps untouched (Call 2 Fri $3,000 / Sun $2,000, G Main (10) $2,625)', payOf('c2b') === '3000' && payOf('c2c') === '2000' && payOf('g10') === '2625');
t('open: PCDO stays $0 with the unpaid stamp', payOf('pcdo') === '0' && run(`(db.shifts.find(s=>s.id==='pcdo')||{}).payUnit`) === 'unpaid');
t('open: Nov 24 is the pinned $27,075', occ24() === 27075, occ24());
t('open: headline is the pinned $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.5, run(`monthHeadline('2026-11').gross`));

// ---------- 2: the address-only Edit-form save (his exact action) ----------
// Entries mirror the OLD form too (no weekendRate24 input): the saved
// rule must survive even a submit that never mentions it.
saveFacilityForm(FORM_BASE);
t('save: no toast when nothing was left to price', alerts.length === 0, JSON.stringify(alerts));
const facAfter = () => run(`db.facilities[0]`);
t('save: weekendRate24 NOT wiped (still "4200")', facAfter().weekendRate24 === '4200', JSON.stringify(facAfter().weekendRate24));
t('save: every captured rule intact — codeMap (5 codes, PCDO unpaid), weekendDays, paidHours8, card rates',
  Object.keys(facAfter().codeMap || {}).length === 5 && facAfter().codeMap[PCDO].unpaid === true &&
  JSON.stringify(facAfter().weekendDays) === '[0,6]' && facAfter().paidHours8 === '8.5' &&
  facAfter().rate24 === '4800' && facAfter().rateSecond === '3000' && facAfter().weekendRateSecond === '2000' && facAfter().rate10 === '2625');
t('save: the address he added is saved', facAfter().address === '100 Jackson Pike, Gallipolis, OH 45631', facAfter().address);
t('save: Call 1 Sat stays $4,200 (the wipe used to push it to $4,800)', payOf('c1a') === '4200', payOf('c1a'));
t('save: PCDO stays $0/unpaid through a form save', payOf('pcdo') === '0' && run(`(db.shifts.find(s=>s.id==='pcdo')||{}).payUnit`) === 'unpaid');
t('save: Nov 24 still $27,075 and headline still $39,832.50', occ24() === 27075 && run(`monthHeadline('2026-11').gross`) === 39832.5, occ24());

// ---------- 3: the form now OWNS weekendRate24 — a manual edit follows ----------
saveFacilityForm([...FORM_BASE, ['weekendRate24', '4300']]);
t('edit: weekendRate24 saved from the form', facAfter().weekendRate24 === '4300', JSON.stringify(facAfter().weekendRate24));
t('edit: the derived Saturday Call 1 follows the manual rate edit -> $4,300', payOf('c1a') === '4300', payOf('c1a'));
t('edit: the message says what changed, in the new copy', alerts.length === 1 && alerts[0] === 'Updated 1 shift price(s) to match the HOLZ pay rules.', JSON.stringify(alerts));
saveFacilityForm([...FORM_BASE, ['weekendRate24', '4200']]);
t('edit back: weekendRate24 $4,200 and Call 1 back to $4,200; Nov 24 pinned again', facAfter().weekendRate24 === '4200' && payOf('c1a') === '4200' && occ24() === 27075, payOf('c1a') + '/' + occ24());

// ---------- 4: the form shows the words rules + the new field ----------
run(`editId='facH';`);
const page = run(`facilitiesPage()`);
t('form: a Weekend 24-hour call rate field is rendered', page.includes('name="weekendRate24"'));
t('form: the per-shift rules from his words are shown in the Edit form', page.includes('Shift rules from your words') && page.includes('HOLZ - PCDO') && page.includes('no pay'), '');
t('form: the day-shift rule shows its paid-hours answer', page.includes('paid for 8.5 hours'));
run(`editId=null;`);

// ---------- 5: protections — typed facts never move; unpaid traps hold ----------
run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[${FAC}]; db.payStubs=[]; db.shifts=[
  ${JSON.stringify(mkS('typed', '2026-11-02', G8, '8-hour day', '9999', 'daily', false, { sources: ['user-entered'] }))},
  ${JSON.stringify(mkS('pcdoDerived', '2026-11-09', PCDO, 'post call day off', '2000', 'facility', false))},
  ${JSON.stringify(mkS('pcdoTyped', '2026-11-16', PCDO, 'post call day off', '500', 'daily', false, { sources: ['user-entered'] }))},
  ${JSON.stringify(mkS('typedInc', '2026-11-04', 'HOLZ - Other', '8-hour day', '1500', '', true))}
]; persist();`);
bootSeq();
t('protect: a hand-typed per-shift total ($9,999) is never repriced', payOf('typed') === '9999', payOf('typed'));
t('protect: a derived $2,000 stamp on an unpaid code becomes the final $0/unpaid', payOf('pcdoDerived') === '0' && run(`(db.shifts.find(s=>s.id==='pcdoDerived')||{}).payUnit`) === 'unpaid', payOf('pcdoDerived'));
t('protect: a hand-typed total on an unpaid code ($500) is the user\u2019s correction and stands', payOf('pcdoTyped') === '500', payOf('pcdoTyped'));
t('protect: a typed number for a rule-less code stays stored AND flagged (never silently restamped)', payOf('typedInc') === '1500' && run(`(db.shifts.find(s=>s.id==='typedInc')||{}).incomplete`) === true, payOf('typedInc'));

// ---------- 6: the reverse divergence — a price that lives ONLY in a per-code def ----------
const NF = 'HOLZ - Night float';
run(`db = empty(); db.settings.scheduleName='Martin'; db.payStubs=[]; db.facilities=[Object.assign({}, ${FAC}, {codeMap: Object.assign({}, (${FAC}).codeMap, {'${NF}':{label:'Night float',weekdayPay:'1500',weekendPay:'1800',rulesConfirmed:true,viaWords:true}})})]; db.shifts=[
  ${JSON.stringify(mkS('nfFri', '2026-11-20', NF, 'Night float', '', '', true))},
  ${JSON.stringify(mkS('nfSat', '2026-11-21', NF, 'Night float', '', '', true))}
]; persist();`);
t('setup: the card alone cannot price Night float (facilityPayFor = 0)', run(`facilityPayFor(db.facilities[0],'Night float','2026-11-20')`) === 0);
const rep = run(`repairShiftPaysForFacility(db.facilities[0])`);
t('save pass: per-code amounts price the blanks (Fri $1,500 / Sat $1,800)', rep.priced === 2 && payOf('nfFri') === '1500' && payOf('nfSat') === '1800', JSON.stringify(rep) + ' ' + payOf('nfFri') + '/' + payOf('nfSat'));

// ---------- 7: wiring pins ----------
const src = fs.readFileSync(R + 'app.js', 'utf8');
t('wiring: the cloud merge runs the same heal after merging', /cloudAutoMerge\(\)[^]*?healUnpricedShiftPays\(\)/.test(src.slice(src.indexOf('async function cloudAutoMerge'), src.indexOf('async function cloudAutoMerge') + 800)));
t('wiring: the paycheck live price and the repair pass share resolveShiftPrice', src.includes('function resolveShiftPrice') && (src.match(/resolveShiftPrice\(/g) || []).length >= 3);
t('sw: cache bumped to v109', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v132'));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
