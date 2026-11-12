// Nov 10, 2026 (evening) — v111: two defects proven LIVE on
// Caleb's QGenda test account during Jewel's authorized functional
// test (branch preview, SW v110), reproduced here before the fix.
//
// DEFECT 1 — the describe-words reader mangled "paid for 8.5
// hours" and bled one code's numbers into the next:
//   (a) The bare 8.5 resurfaced as a flat $8.50 rate for the
//       8-hour code (the AI rule read files it as flat_rate; the
//       merge's coverage check counts only stated $ amounts, so
//       the phantom flat was adopted whole, and a flat outranks
//       the hourly rule in every pricing path — the card saved
//       rate8 '8.5' and shifts stamped $8.50).
//   (b) The 8.5 also attached to G Main (10), whose statement
//       states NO rate and NO paid hours: paidHours8 is BY
//       DEFINITION the 8-hour shift's paid hours, yet the def
//       builder stamped it onto every day code, and the summary
//       fallback did the same — the (10) read back "$250/hr x
//       8.5 paid hours = $2,125" instead of hourly x 10 = $2,500.
//   Root mechanics, all fixed in the reader: the clause cutter
//   split "8.5" at its decimal point (orphaning "5 hours" onto
//   the next code); "/" was not a clause boundary, so on the
//   one-line shape a carry-forward clause swept into the NEXT
//   named code's chunk and donated its amounts; no per-code
//   paid-hours capture existed. Now: decimals are protected
//   while clauses are cut, " / " is a boundary (with amount-
//   bearing lead-in clauses held for the statement they
//   introduce), paid hours are captured per code statement, the
//   facility paid-hours figure fills ONLY an 8-hour code's def,
//   and a sanitize screen drops day flats that are recognisably
//   not per-shift amounts (equal to the paid-hours figure, equal
//   to the shift's hour count, below the hourly rate, or an
//   amount the text ties to a different code) whenever the text
//   states no per-day/flat phrasing — applied to the local parse
//   AND to the AI-merged rates. Cards already saved with the bad
//   flat heal in the one repair pass: the exact signature (flat
//   value IS a paid-hours figure on the card, below the hourly
//   rate) is cleared, and derived $8.50 stamps reprice to
//   $2,125. A user-typed $8.50 total never moves.
//
// DEFECT 2 — paycheck occurrences claimed NOTHING when the pay
// schedule's facility naming differed from the shifts': 128
// shifts saved under facility "HOLZ"; two stub records naming
// the facility "Holzer" (one agency "Holzer", no amount; one
// "Premier Anesthesia Group, PC", facility "Holzer", the Nov 10
// actual — the actual chip rendered). The schedules unified
// fine, but paystubShiftClaimTier compared normalized name keys
// ("holzer" vs "holz") — tier 0 for every shift — so Nov 24
// reported "No shifts recorded for this pay period yet" and the
// HOLZ card showed no pay schedule, despite 11 priced shifts in
// the period. healFacilityIdentities could not help: it only
// touches UNPRICED shifts, and these were priced. The fix is
// identity, not strings: a new facilityByNameOrVariant (exact
// name/alias, else the ONE close prefix variant — the same rule
// the identity heal uses; ambiguity resolves to null) now backs
// paystubFacilityOf and the claim tier. Both sides resolving to
// the same facility claims at tier 1; two DIFFERENT facilities
// is a hard no, so two payers are never merged by the back door.
//
// Also verified here (minor): the v110 "Rates saved for HOLZ"
// approval message DOES fire on the QGenda/schedule bottom-
// button approve (section E) — the live test simply could not
// capture the browser alert. No change made.
// Run: node test-v111-live-fixes.js
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
// Caleb's exact input from the live test (verbatim fixture) —
// the one-line " / "-separated shape, and the newline shape the
// same words take when typed line by line. Both must read the same.
const WORDS_SLASH = 'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours / Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200 / Holz-call 2=2nd call weekday=$3,000 weekend $2,000 / Holz-g main (10)=10hour day shift / Holz PCDO=post call day off=no pay / Weekends only include Saturday and Sunday.';
const WORDS_LINES = 'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours\nHolz-call 1=24hr call. Weekday=$4,800 weekend $4,200\nHolz-call 2=2nd call weekday=$3,000 weekend $2,000\nHolz-g main (10)=10hour day shift\nHolz PCDO=post call day off=no pay\nWeekends only include Saturday and Sunday.';
const parse = (text, codes) => run(`describeParseLocal(${J(text)}, null, ${J(codes || CODES)})`);

function checkFixture(label, text) {
  const p = parse(text);
  t(label + ': all five codes resolved, no follow-up', p.unanswered.length === 0 && !p.question, J(p.unanswered));
  t(label + ': rates — hourly 250, paidHours8 8.5, call splits, NO day flat anywhere',
    p.rates.hourlyRate === 250 && p.rates.paidHours8 === 8.5 && p.rates.rate24 === 4800 && p.rates.weekendRate24 === 4200 &&
    p.rates.rateSecond === 3000 && p.rates.weekendRateSecond === 2000 && p.rates.rate8 == null && p.rates.rate10 == null && p.rates.rate12 == null, J(p.rates));
  t(label + ': G Main (8) def — 8-hour day, paidHours 8.5 (its own statement)',
    p.defs['HOLZ - G Main (8)'] && p.defs['HOLZ - G Main (8)'].canonicalType === '8-hour day' && p.defs['HOLZ - G Main (8)'].paidHours === 8.5, J(p.defs['HOLZ - G Main (8)']));
  t(label + ': G Main (10) def — NO inherited paid hours',
    p.defs['HOLZ - G Main (10)'] && p.defs['HOLZ - G Main (10)'].canonicalType === '10-hour shift' && p.defs['HOLZ - G Main (10)'].paidHours == null, J(p.defs['HOLZ - G Main (10)']));
  t(label + ': PCDO unpaid; weekend captured as Sat/Sun from his sentence',
    !!(p.defs['HOLZ - PCDO'] && p.defs['HOLZ - PCDO'].unpaid) && J(p.weekendDays) === J([0, 6]), J(p.weekendDays));
  const s = run(`describeSummaryText('HOLZ', ${J(p)}, null)`);
  t(label + ': read-back — (8) at $250/hr x 8.5 = $2,125; (10) at hourly x 10 = $2,500; no $8.5 flat',
    s.includes('“HOLZ - G Main (8)” (8-hour day): $250/hr × 8.5 paid hours = $2,125.') &&
    s.includes('“HOLZ - G Main (10)” (10-hour shift): $250/hr × 10 paid hours = $2,500.') &&
    !s.includes('$8.5 per shift') && !s.includes('G Main (10)” (10-hour shift): $250/hr × 8.5'), s);
  const fac = run(`(() => { const f = { name: 'HOLZ' }; applyDescribedRules(f, ${J(p)}); return f; })()`);
  t(label + ': saved card — hourly 250 + paidHours8 8.5, rate8/rate10 blank',
    fac.hourlyRate === '250' && fac.paidHours8 === '8.5' && !fac.rate8 && !fac.rate10, J({ h: fac.hourlyRate, ph: fac.paidHours8, r8: fac.rate8, r10: fac.rate10 }));
  t(label + ': prices — 8-hour day $2,125, 10-hour shift $2,500 (generic path)',
    run(`facilityPayFor(${J(fac)}, '8-hour day', '2026-11-02')`) === 2125 && run(`facilityPayFor(${J(fac)}, '10-hour shift', '2026-11-02')`) === 2500);
  const cp10 = run(`clarifiedRowPricing(${J(fac)}, { code: 'HOLZ - G Main (10)', date: '2026-11-02', type: '10-hour shift' })`);
  t(label + ': clarified G Main (10) prices $2,500, not $2,125', !!cp10 && cp10.pay === '2500', J(cp10));
}

(async () => {
  // ---------- A. Defect 1: Caleb's exact input, both shapes ----------
  checkFixture('A1 slash shape', WORDS_SLASH);
  checkFixture('A2 newline shape', WORDS_LINES);

  // ---------- B. Corpus variants ----------
  {
    const one = [CODES[0]];
    const p1 = parse('G Main (8) pays $250/hr and I\'m paid for 8.5 hours.', one);
    t('B1 "$250/hr and I\'m paid for 8.5 hours": hourly + paidHours, no flat', p1.rates.hourlyRate === 250 && p1.rates.paidHours8 === 8.5 && p1.rates.rate8 == null && p1.defs['HOLZ - G Main (8)'].paidHours === 8.5, J(p1.rates));
    const p2 = parse('G Main (8) pays $250 an hour, 8.5 paid hours.', one);
    t('B2 "pays $250 an hour, 8.5 paid hours": same reading', p2.rates.hourlyRate === 250 && p2.rates.paidHours8 === 8.5 && p2.rates.rate8 == null && p2.defs['HOLZ - G Main (8)'].paidHours === 8.5, J(p2.rates));
  }
  {
    const two = [CODES[0], CODES[3]];
    const p = parse('Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours / Holz-g main (10)=10hour day shift $250/hr, paid for 10.5 hours', two);
    t('B3 two codes, different paid hours: (8) keeps 8.5, (10) keeps its OWN 10.5',
      p.defs['HOLZ - G Main (8)'].paidHours === 8.5 && p.defs['HOLZ - G Main (10)'].paidHours === 10.5, J(p.defs));
    const fac = run(`(() => { const f = { name: 'HOLZ' }; applyDescribedRules(f, ${J(p)}); return f; })()`);
    t('B3: card paidHours8 follows the 8-hour code only (8.5)', fac.paidHours8 === '8.5', J(fac.paidHours8));
    const c8 = run(`clarifiedRowPricing(${J(fac)}, { code: 'HOLZ - G Main (8)', date: '2026-11-02', type: '8-hour day' })`);
    const c10 = run(`clarifiedRowPricing(${J(fac)}, { code: 'HOLZ - G Main (10)', date: '2026-11-02', type: '10-hour shift' })`);
    t('B3: prices — (8) $2,125, (10) $2,625 (250 x 10.5)', !!c8 && c8.pay === '2125' && !!c10 && c10.pay === '2625', J({ c8, c10 }));
  }
  {
    const codes = [
      { code: 'RGH - Day', ctype: '8-hour day', hours: 8 },
      { code: 'RGH - Ten', ctype: '10-hour shift', hours: 10 },
    ];
    const p = parse('RGH-day = 8 hour day shift $180/hr, paid for 8.5 hours / RGH-ten = 10 hour day shift', codes);
    t('B4 non-Caleb facility: hourly 180, Day paidHours 8.5, Ten none, no flats',
      p.rates.hourlyRate === 180 && p.rates.rate8 == null && p.rates.rate10 == null &&
      p.defs['RGH - Day'].paidHours === 8.5 && p.defs['RGH - Ten'].paidHours == null, J({ r: p.rates, d: p.defs }));
    const fac = run(`(() => { const f = { name: 'RGH' }; applyDescribedRules(f, ${J(p)}); return f; })()`);
    t('B4: prices — Day $1,530 (180 x 8.5), Ten $1,800 (180 x 10)',
      run(`facilityPayFor(${J(fac)}, '8-hour day', '2026-11-02')`) === 1530 && run(`facilityPayFor(${J(fac)}, '10-hour shift', '2026-11-02')`) === 1800);
  }
  {
    // The sanitize screen itself, incl. the AI-merge shape: the
    // phantom flat arrives as a rates object, not from the text.
    const bad = run(`(() => { const r = { hourlyRate: 250, paidHours8: 8.5, rate8: 8.5 }; describeSanitizeRates(r, ${J(WORDS_SLASH)}, null, []); return r; })()`);
    t('B5 sanitize: a flat equal to the paid-hours figure is dropped', bad.rate8 == null && bad.hourlyRate === 250 && bad.paidHours8 === 8.5, J(bad));
    const genuine = run(`(() => { const r = { hourlyRate: 250, paidHours8: 8.5, rate8: 2000 }; describeSanitizeRates(r, 'Day shifts are $2,000 per day and I am paid for 8.5 hours at $250/hr.', null, []); return r; })()`);
    t('B5 sanitize: a genuine per-day flat survives (flat phrasing present)', genuine.rate8 === 2000, J(genuine));
    const otherAmt = run(`(() => { const r = { hourlyRate: 250, paidHours8: 8.5, rate8: 2000 }; describeSanitizeRates(r, ${J(WORDS_SLASH)}, null, []); return r; })()`);
    t('B5 sanitize: an unexplained $2,000 flat with no flat phrasing and no other owner survives', otherAmt.rate8 === 2000, J(otherAmt));
  }

  // ---------- C. Heal: the already-saved bad card ----------
  {
    run(`db = empty(); db.settings.scheduleName = 'Martin';
      db.facilities = [{ id:'f1', name:'HOLZ', aliases:'', hourlyRate:'250', paidHours8:'8.5', rate8:'8.5', rate10:'', rateSecond:'3000', weekendRateSecond:'2000', rate24:'4800', weekendRate24:'4200', codeMap:{ 'HOLZ - G Main (8)':{ label:'8hr day shift', hours:'8', canonicalType:'8-hour day', paidHours:'8.5', rulesConfirmed:true } } }];
      db.shifts = [
        { id:'bad1', date:'2026-11-02', facility:'HOLZ', type:'8-hour day', code:'HOLZ - G Main (8)', pay:'8.5', payUnit:'facility', status:'confirmed', source:'qgenda-feed', sources:['qgenda-feed'], incomplete:true, note:'', updatedAt:null },
        { id:'typed1', date:'2026-11-04', facility:'HOLZ', type:'8-hour day', code:'HOLZ - G Main (8)', pay:'8.5', payUnit:'daily', status:'confirmed', source:'user-entered', sources:['user-entered'], incomplete:false, note:'', updatedAt:null }
      ];
      db.payStubs = []; persist();`);
    run(`healUnpricedShiftPays()`);
    t('C heal: the misread flat is cleared from the card', run(`db.facilities[0].rate8`) === '', run(`db.facilities[0].rate8`));
    t('C heal: the derived $8.50 stamp reprices to $2,125 on open', run(`db.shifts.find(x=>x.id==='bad1').pay`) === '2125' && run(`db.shifts.find(x=>x.id==='bad1').incomplete`) === false, run(`db.shifts.find(x=>x.id==='bad1').pay`));
    t('C heal: a genuinely user-typed $8.50 total never moves', run(`db.shifts.find(x=>x.id==='typed1').pay`) === '8.5', run(`db.shifts.find(x=>x.id==='typed1').pay`));
    run(`db = empty(); db.settings.scheduleName = 'Martin';
      db.facilities = [{ id:'f1', name:'HOLZ', aliases:'', hourlyRate:'250', paidHours8:'8.5', rate8:'2000', codeMap:{} }];
      db.shifts = []; db.payStubs = []; persist();`);
    run(`healUnpricedShiftPays()`);
    t('C heal: a genuine $2,000 flat is NOT the signature — it stays', run(`db.facilities[0].rate8`) === '2000', run(`db.facilities[0].rate8`));
    // The same bad parse also stamped paidHours 8.5 onto the
    // 10-hour code's DEFINITION. Re-confirming the corrected
    // words retracts it — but only for words-created definitions.
    run(`db = empty(); db.settings.scheduleName = 'Martin';
      db.facilities = [{ id:'f1', name:'HOLZ', aliases:'', hourlyRate:'250', paidHours8:'8.5', rate8:'8.5', codeMap:{
        'HOLZ - G Main (10)':{ label:'10hour day shift', hours:'10', canonicalType:'10-hour shift', paidHours:'8.5', rulesConfirmed:true, viaWords:true },
        'HOLZ - G Main (12)':{ label:'12hour day shift', hours:'12', canonicalType:'12-hour shift', paidHours:'8.5', rulesConfirmed:true }
      } }];
      db.shifts = [{ id:'t10', date:'2026-11-02', facility:'HOLZ', type:'10-hour shift', code:'HOLZ - G Main (10)', pay:'2125', payUnit:'facility', status:'confirmed', source:'qgenda-feed', sources:['qgenda-feed'], incomplete:false, note:'', updatedAt:null }];
      db.payStubs = []; persist();`);
    const pFix = parse(WORDS_SLASH + ' / Holz-g main (12)=12hour day shift', [...CODES, { code: 'HOLZ - G Main (12)', ctype: '12-hour shift', hours: 12 }]);
    run(`(() => { const f = db.facilities[0]; applyDescribedRules(f, ${J(pFix)}); })()`);
    t('C heal: re-confirming corrected words retracts the viaWords (10) paidHours residue',
      run(`db.facilities[0].codeMap['HOLZ - G Main (10)'].paidHours`) === undefined, J(run(`db.facilities[0].codeMap['HOLZ - G Main (10)']`)));
    t('C heal: a field-captured (non-words) definition keeps its paidHours unstated by the words',
      run(`db.facilities[0].codeMap['HOLZ - G Main (12)'].paidHours`) === '8.5', J(run(`db.facilities[0].codeMap['HOLZ - G Main (12)']`)));
    t('C heal: the (10) shift reprices to $2,500 once its def is retracted', run(`db.shifts.find(x=>x.id==='t10').pay`) === '2500', run(`db.shifts.find(x=>x.id==='t10').pay`));
  }

  // ---------- D. Defect 2: HOLZ shifts, "Holzer" stub records ----------
  const FAC2 = `{ id:'f1', name:'HOLZ', aliases:'', address:'100 Jackson Pike, Gallipolis, OH 45631', hourlyRate:'250', paidHours8:'8.5', rate10:'', rateSecond:'3000', weekendRateSecond:'2000', rate24:'4800', weekendRate24:'4200', codeMap:{ 'HOLZ - G Main (8)':{label:'8hr day shift',hours:'8',canonicalType:'8-hour day',paidHours:'8.5',rulesConfirmed:true}, 'HOLZ - Call 1':{label:'24hr call',hours:'24',canonicalType:'24-hour call',rulesConfirmed:true}, 'HOLZ - Call 2':{label:'2nd call',hours:'24',canonicalType:'Second call',rulesConfirmed:true} } }`;
  const sh = (id, date, type, code, pay) => ({ id, date, facility: 'HOLZ', type, code, pay, payUnit: 'facility', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], note: '', updatedAt: null });
  const SHIFTS2 = [
    sh('o1', '2026-10-24', '24-hour call', 'HOLZ - Call 1', '4200'),
    sh('o2', '2026-10-27', '24-hour call', 'HOLZ - Call 1', '4800'),
    sh('o3', '2026-11-01', 'Second call', 'HOLZ - Call 2', '2000'),
    ...['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d, i) => sh('g' + i, d, '8-hour day', 'HOLZ - G Main (8)', '2125')),
    sh('n1', '2026-11-03', 'Second call', 'HOLZ - Call 2', '3000'),
    sh('n2', '2026-11-06', 'Second call', 'HOLZ - Call 2', '3000'),
    sh('n3', '2026-11-08', 'Second call', 'HOLZ - Call 2', '2000'),
    sh('n4', '2026-11-07', '24-hour call', 'HOLZ - Call 1', '4200'),
    ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map((d, i) => sh('d' + i, d, '8-hour day', 'HOLZ - G Main (8)', '2125')),
    sh('n5', '2026-11-30', '8-hour day', 'HOLZ - G Main (8)', '2125'),
  ];
  const REC_A = `{ id:'ps-a', agency:'Holzer', facility:'', frequency:'biweekly', payDate:'2026-11-10', periodStart:'', periodEnd:'', gross:'', net:'', source:'import', fileName:'' }`;
  const REC_B = `{ id:'ps-b', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', payDate:'2026-11-10', periodStart:'2026-10-19', periodEnd:'2026-11-01', gross:'12757.50', net:'', source:'stub', fileName:'' }`;
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [${FAC2}];
    db.shifts = ${J(SHIFTS2)};
    db.payStubs = [${REC_A}, ${REC_B}];
    persist();`);
  t('D: the two records still unify into ONE schedule (unification was never the bug)', run(`paystubSchedules().length`) === 1);
  t('D: the stub\'s facility "Holzer" resolves to the HOLZ facility', run(`(paystubFacilityOf(db.payStubs[1])||{}).name`) === 'HOLZ');
  t('D: every shift is claimed (was: 0 of 20)', run(`paystubShiftClaims().size`) === SHIFTS2.length, String(run(`paystubShiftClaims().size`)));
  const occN = run(`paystubOccurrencesInMonth('2026-11')`);
  const nov10 = occN.find(o => o.date === '2026-11-10'), nov24 = occN.find(o => o.date === '2026-11-24');
  t('D: Nov 10 is the stub actual alone', !!nov10 && nov10.isActual === true && run(`paystubOccurrenceAmount(${J(nov10)})`) === 12757.5);
  t('D: Nov 24 claims its 11 shifts and totals $27,075', !!nov24 && nov24.shiftCount === 11 && run(`paystubOccurrenceAmount(${J(nov24)})`) === 27075, J(nov24 && { sc: nov24.shiftCount, total: nov24.total }));
  const dec8 = run(`paystubOccurrencesInMonth('2026-12')`).find(o => o.date === '2026-12-08');
  t('D: Dec 8 totals $10,625', !!dec8 && run(`paystubOccurrenceAmount(${J(dec8)})`) === 10625, J(dec8 && { total: dec8.total }));
  t('D: November headline is $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.5, String(run(`monthHeadline('2026-11').gross`)));
  t('D: the HOLZ card shows its pay schedule', run(`facilityPaystubLineHTML(db.facilities[0])`).includes('Premier Anesthesia Group, PC') && run(`facilityPaystubLineHTML(db.facilities[0])`).includes('$12,757.50'));
  t('D: and the card no longer offers a duplicate setup form', run(`payStubCoversFacility(db.facilities[0])`) === true && run(`facilityPaySchedHTML(db.facilities[0])`) === '');
  {
    // Guards: identity must never become a merge.
    run(`db.facilities.push({ id:'f2', name:'CAMC', aliases:'', hourlyRate:'250', paidHours8:'8', codeMap:{} });
      db.shifts.push({ id:'cx1', date:'2026-11-03', facility:'CAMC', type:'8-hour day', code:'', pay:'2000', payUnit:'facility', status:'confirmed', source:'manual', sources:['manual'], note:'', updatedAt:null });
      persist();`);
    t('D guard: the Premier/Holzer schedule does NOT claim a CAMC shift', run(`paystubShiftClaimTier(paystubSchedules()[0], db.shifts.find(s=>s.id==='cx1'))`) === 0);
    t('D guard: claims for HOLZ shifts survive a second facility existing', run(`paystubShiftClaims().size`) === SHIFTS2.length, String(run(`paystubShiftClaims().size`)));
    run(`db = empty(); db.settings.scheduleName = 'Martin';
      db.facilities = [${FAC2}, { id:'f9', name:'Holzer', aliases:'', hourlyRate:'300', paidHours8:'8', codeMap:{} }];
      db.shifts = ${J(SHIFTS2)}; db.payStubs = [${REC_B}]; persist();`);
    t('D guard: when BOTH HOLZ and Holzer exist, "Holzer" means Holzer — HOLZ shifts unclaimed by it',
      run(`(paystubFacilityOf(db.payStubs[0])||{}).name`) === 'Holzer' && run(`paystubShiftClaims().size`) === 0, String(run(`paystubShiftClaims().size`)));
    run(`db = empty(); db.settings.scheduleName = 'Martin';
      db.facilities = [${FAC2}, { id:'f8', name:'HOLZE', aliases:'', hourlyRate:'300', paidHours8:'8', codeMap:{} }];
      db.shifts = ${J(SHIFTS2)}; db.payStubs = [${REC_B}]; persist();`);
    t('D guard: two variant candidates (HOLZ, HOLZE) = ambiguity = no resolution, no claim',
      run(`facilityByNameOrVariant('Holzer')`) === null && run(`paystubShiftClaims().size`) === 0, String(run(`paystubShiftClaims().size`)));
  }

  // ---------- E. End to end: the live flow, both defects together ----------
  {
    const NOV = [['2026-11-02', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-03', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-04', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-05', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-06', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-07', '24-hour call', 'HOLZ - Call 1', 24], ['2026-11-08', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-10', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-11', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-12', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-13', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-16', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-17', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-18', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-19', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-20', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-30', '8-hour day', 'HOLZ - G Main (8)', 8]];
    run(`db = empty(); db.settings.scheduleName = 'Martin'; db.payStubs = [${REC_A}, ${REC_B}];`);
    const rows = NOV.map(([date, type, code, hours]) => ({ date, facility: 'HOLZ', type, code, hours, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed', incomplete: true }));
    run(`schedulePreview = { fileName: 'QGenda feed', source: 'qgenda-feed', matchedName: 'Martin', rows: ${J(rows)}, noNamesInFile: false, ai: false, parserVersion: 6 }; scheduleImportContext = 'qgenda'; tab = 'Facilities';`);
    run(`schedulePreviewHTML();`);
    run(`describeState('imp:schedule').text = ${J(WORDS_SLASH)};`);
    await run(`submitDescribe('imp:schedule')`);
    alerts.length = 0;
    run(`approveScheduleImport()`);
    t('E: the approve message says the rates saved ("Rates saved for HOLZ")', alerts.some(a => a.includes('Rates saved for HOLZ')), alerts.join(' | '));
    t('E: and does NOT claim there is no pay schedule (the Holzer/Premier records cover HOLZ)', !alerts.some(a => a.includes('No pay schedule for HOLZ yet')), alerts.join(' | '));
    t('E: card saved clean — hourly 250, paidHours8 8.5, NO $8.50 flat', (() => { const f = run(`db.facilities[0] || null`); return !!f && f.hourlyRate === '250' && f.paidHours8 === '8.5' && !f.rate8; })(), J(run(`db.facilities[0] && { r8: db.facilities[0].rate8, ph: db.facilities[0].paidHours8 }`)));
    t('E: all 17 shifts priced from the words, none incomplete', run(`db.shifts.length`) === 17 && run(`db.shifts.filter(x=>x.incomplete).length`) === 0);
    const occE = run(`paystubOccurrencesInMonth('2026-11')`);
    const e24 = occE.find(o => o.date === '2026-11-24');
    t('E: Nov 24 = $27,075 through the once-broken claim path', !!e24 && run(`paystubOccurrenceAmount(${J(e24)})`) === 27075, J(e24 && { sc: e24.shiftCount, total: e24.total }));
    t('E: headline $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.5, String(run(`monthHeadline('2026-11').gross`)));
  }

  t('sw: cache bumped to v111', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v139'));
  console.log(fails ? ('FAILURES: ' + fails) : 'ALL PASS');
})();
