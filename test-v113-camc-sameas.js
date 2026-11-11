// Nov 10, 2026 (night) — v113: defects proven LIVE on Caleb's
// test account during Jewel's CAMC schedule-import test (branch
// preview, SW v112). The CAMC grid import itself worked — Martin
// rows Dec 1 "5**", Dec 2 "5*", Dec 3 "5**", Dec 4 "5*", Dec 5
// "7" read exactly, other staff excluded, the facility question
// asked, the pay-schedule section appeared. At the "First time
// at CAMC? Tell us how it pays" gate the user entered the text
// below (CAMC_TEXT, verbatim). The read-back resolved "7"
// ($3,000) and "5**" ($2,500) but said "I still don't know
// about: '5*'" — and after approve, Dec 2 and Dec 4 (the 5*
// shifts) imported unpriced while Dec 1/3 priced $2,500 and
// Dec 5 priced $3,000: December CAMC $8,000 instead of $13,000.
//
// Root causes (proven by this file failing on v112):
//  1. Asterisk codes collapse in describeCodeBlocks: the code
//     tokenizer split on [^a-z0-9]+, so "5*" and "5**" BOTH
//     tokenized to ["5"] and built the same name form — every
//     asterisk-code mention was attributed to whichever code
//     came first in the list ("5**"), "5*" never got a block,
//     and the two codes were indistinguishable end to end.
//  2. No cross-code reference resolution: "X = same as Y"
//     points at Y's definition; the reader had no inheritance,
//     so even a correctly-attributed "same as" statement left
//     X unanswered. The same statement's own definition (after
//     the colon) also bound only to Y, never to the subject X.
//  3. Defect 2 is the same seam as (1): the name match for
//     "5**" ended after the "5", so the phrase slice started
//     at "** = 10 hour shift" — and that mangled phrase became
//     the definition label the Dec 1 shift displays as its type.
//
// The follow-up question item: in the gate flow the read-back's
// question renders as a yellow .hint box. The LOCAL question
// names the unknown codes and says how to answer ("Add a
// sentence … or use these rules as-is"), but submitDescribe
// REPLACED it wholesale with the AI rule read's
// clarifying_question when one came back (live: "Does this
// rule apply on weekends?") — a yes/no-shaped question with
// the answer path deleted. The fix composes instead of
// replacing (describeFollowUpQuestion): the local question
// (codes + how to answer) always stands; the AI's question is
// appended with its own answer cue.
//
// Run: node test-v113-camc-sameas.js
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

// Caleb's CAMC words, verbatim as entered at the import gate.
const CAMC_TEXT = '5** = 10 hour shift, $250/hr. On call 5pm-7pm, paid for hours worked. / 5* = same as 5**: 10 hour shift, $250/hr. On call 5pm-7pm, paid for hours worked. / 7 = 12 hour shift, $250/hr.';
const CAMC_CODES = [{ code: '5**' }, { code: '5*' }, { code: '7' }];

// ---------- A. Fresh CAMC parse (defects 1 + 2) ----------
{
  const blocks = run(`describeCodeBlocks(${J(CAMC_TEXT)}, ${J(CAMC_CODES)})`);
  t('A1: a block exists for "5*"', !!blocks['5*'], J(Object.keys(blocks)));
  t('A2: the "5*" block phrase is the 10-hour definition', !!blocks['5*'] && blocks['5*'].phrase === '10 hour shift', blocks['5*'] && blocks['5*'].phrase);
  t('A3: the "5**" block phrase is "10 hour shift" (no "** =" mangling)', !!blocks['5**'] && blocks['5**'].phrase === '10 hour shift', blocks['5**'] && blocks['5**'].phrase);
  const p = run(`describeParseLocal(${J(CAMC_TEXT)}, null, ${J(CAMC_CODES)})`);
  t('A4: nothing unanswered', Array.isArray(p.unanswered) && p.unanswered.length === 0, J(p.unanswered));
  t('A5: "5*" def is a 10-hour shift', !!p.defs['5*'] && p.defs['5*'].canonicalType === '10-hour shift', J(p.defs['5*']));
  t('A6: "5*" def hours are 10', !!p.defs['5*'] && String(p.defs['5*'].hours) === '10', J(p.defs['5*']));
  t('A7: "5**" def label is "10 hour shift"', !!p.defs['5**'] && p.defs['5**'].label === '10 hour shift', J(p.defs['5**']));
  t('A8: "7" def is a 12-hour shift', !!p.defs['7'] && p.defs['7'].canonicalType === '12-hour shift', J(p.defs['7']));
  const s = run(`describeSummaryText('CAMC', ${J(p)}, null)`);
  t('A9: summary prices "5*" at $2,500', s.includes('“5*” (10-hour shift): $250/hr × 10 paid hours = $2,500'), s);
  t('A10: summary prices "7" at $3,000', s.includes('“7” (12-hour shift): $250/hr × 12 paid hours = $3,000'), s);
  t('A11: summary has no "still don\'t know"', !s.includes('still don\'t know'), s);
}

// ---------- B. Reference shapes (non-Caleb + order variants) ----------
{
  // B1: "same as" pointing at a code defined LATER in the text.
  const p1 = run(`describeParseLocal('B = same as C\\nC = 12 hour shift, $180/hr', null, [{code:'B'},{code:'C'}])`);
  t('B1: forward reference resolves', !!p1.defs['B'] && p1.defs['B'].canonicalType === '12-hour shift' && p1.unanswered.length === 0, J(p1.unanswered));
  const s1 = run(`describeSummaryText('RGH', ${J(p1)}, null)`);
  t('B1b: the inheriting code prices from the target ($180 x 12 = $2,160)', s1.includes('“B” (12-hour shift): $180/hr × 12 paid hours = $2,160'), s1);
  // B2: "same as above" + asterisk distinctness (A* vs A**).
  const p2 = run(`describeParseLocal('A** = 10 hour shift, $200/hr\\nA* = same as above', null, [{code:'A**'},{code:'A*'}])`);
  t('B2: "same as above" resolves to the code named just before', !!p2.defs['A*'] && p2.defs['A*'].canonicalType === '10-hour shift' && p2.unanswered.length === 0, J(p2.unanswered));
  // B3: ditto / identical to / like.
  const p3 = run(`describeParseLocal('D1 = 8 hour shift, $150/hr\\nD2 = ditto\\nD3 = identical to D1\\nD4 = like D1', null, [{code:'D1'},{code:'D2'},{code:'D3'},{code:'D4'}])`);
  t('B3: ditto / identical to / like all resolve', ['D2', 'D3', 'D4'].every(c => p3.defs[c] && p3.defs[c].canonicalType === '8-hour day') && p3.unanswered.length === 0, J(p3.unanswered));
  // B4: asterisk codes with DIFFERENT definitions stay distinct, either order.
  const p4 = run(`describeParseLocal('A** = 8 hour shift, $100/hr\\nA* = 12 hour shift, $100/hr', null, [{code:'A**'},{code:'A*'}])`);
  t('B4: A** is 8-hour and A* is 12-hour (no conflation)', !!p4.defs['A**'] && p4.defs['A**'].canonicalType === '8-hour day' && !!p4.defs['A*'] && p4.defs['A*'].canonicalType === '12-hour shift' && p4.unanswered.length === 0, J(p4.unanswered));
  const p5 = run(`describeParseLocal('A* = 12 hour shift, $100/hr\\nA** = 8 hour shift, $100/hr', null, [{code:'A*'},{code:'A**'}])`);
  t('B5: reversed order stays distinct too', !!p5.defs['A**'] && p5.defs['A**'].canonicalType === '8-hour day' && !!p5.defs['A*'] && p5.defs['A*'].canonicalType === '12-hour shift' && p5.unanswered.length === 0, J(p5.unanswered));
  // B6: a code with its OWN definition mentioning another code is NOT overridden by the reference.
  const p6 = run(`describeParseLocal('E1 = 8 hour shift, $150/hr\\nE2 = 12 hour shift, $150/hr, same as E1 on weekends', null, [{code:'E1'},{code:'E2'}])`);
  t('B6: own statement wins over a passing reference', !!p6.defs['E2'] && p6.defs['E2'].canonicalType === '12-hour shift', J(p6.defs['E2']));
}

// ---------- C. Live heal state: re-confirm prices the saved 5* shifts ----------
const HS = (id, date, type, code, pay) => ({ id, date, facility: 'HOLZ', type, code, pay, payUnit: 'facility', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], note: '', updatedAt: null });
const NOV_SHIFTS = [
  ...['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d, i) => HS('g' + i, d, '8-hour day', 'HOLZ - G Main (8)', '2125')),
  HS('n1', '2026-11-03', 'Second call', 'HOLZ - Call 2', '3000'),
  HS('n2', '2026-11-06', 'Second call', 'HOLZ - Call 2', '3000'),
  HS('n3', '2026-11-08', 'Second call', 'HOLZ - Call 2', '2000'),
  HS('n4', '2026-11-07', '24-hour call', 'HOLZ - Call 1', '4200'),
  ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map((d, i) => HS('d' + i, d, '8-hour day', 'HOLZ - G Main (8)', '2125')),
  HS('n5', '2026-11-30', '8-hour day', 'HOLZ - G Main (8)', '2125'),
];
const DEC_SHIFTS = [
  HS('x1', '2026-12-01', '8-hour day', 'HOLZ - G Main (8)', '2125'),
  HS('x2', '2026-12-02', 'Second call', 'HOLZ - Call 2', '3000'),
  HS('x3', '2026-12-03', '8-hour day', 'HOLZ - G Main (8)', '2125'),
  HS('x4', '2026-12-04', '24-hour call', 'HOLZ - Call 1', '4800'),
  HS('x5', '2026-12-05', 'Second call', 'HOLZ - Call 2', '2000'),
  HS('x6', '2026-12-06', '24-hour call', 'HOLZ - Call 1', '4200'),
  HS('x7', '2026-12-08', '24-hour call', 'HOLZ - Call 1', '4800'),
  HS('x8', '2026-12-10', '24-hour call', 'HOLZ - Call 1', '4800'),
  HS('x9', '2026-12-14', '24-hour call', 'HOLZ - Call 1', '4800'),
  HS('x10', '2026-12-16', '24-hour call', 'HOLZ - Call 1', '4800'),
  HS('x11', '2026-12-18', '24-hour call', 'HOLZ - Call 1', '4800'),
];
const HOLZ_FAC = {
  id: 'holz', name: 'HOLZ', aliases: '', address: '', hourlyRate: '250', paidHours8: '8.5',
  rate8: '', rate10: '', rate12: '', rate24: '4800', weekendRate24: '4200',
  rateSecond: '3000', weekendRateSecond: '2000', callBonus: '', hourlyCall1st: '',
  weekendDays: [0, 6], ratesSource: 'manual',
  codeMap: {
    'HOLZ - G Main (8)': { label: '8hr day shift', hours: '8', canonicalType: '8-hour day', paidHours: '8.5', rulesConfirmed: true, viaWords: true },
    'HOLZ - Call 1': { label: '24hr call', hours: '24', canonicalType: '24-hour call', rulesConfirmed: true, viaWords: true },
    'HOLZ - Call 2': { label: '2nd call', hours: '24', canonicalType: 'Second call', rulesConfirmed: true, viaWords: true },
    'HOLZ - G Main (10)': { label: '10hour day shift', hours: '10', canonicalType: '10-hour shift', rulesConfirmed: true, viaWords: true },
    'HOLZ - PCDO': { label: 'post call day off', hours: '8', canonicalType: '', rulesConfirmed: true, viaWords: true, unpaid: true },
  },
};
// CAMC as the broken live approve saved it: defs for 5** (with
// the mangled label) and 7 only; no def for 5*.
const CAMC_FAC_LIVE = {
  id: 'camc', name: 'CAMC', aliases: '', address: '', hourlyRate: '250', paidHours8: '',
  rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '',
  rateSecond: '', weekendRateSecond: '', callBonus: '', hourlyCall1st: '',
  weekendDays: [0, 6], ratesSource: 'manual',
  codeMap: {
    '5**': { label: '** = 10 hour shift', hours: '10', canonicalType: '10-hour shift', rulesConfirmed: true, viaWords: true },
    '7': { label: '12 hour shift', hours: '12', canonicalType: '12-hour shift', rulesConfirmed: true, viaWords: true },
  },
};
const CS = (id, date, code, type, pay, incomplete) => ({ id, date, facility: 'CAMC', type, code, pay, payRate: '', payUnit: incomplete ? '' : 'facility', status: 'confirmed', source: 'schedule-photo', sources: ['schedule-photo'], incomplete: !!incomplete, note: '', updatedAt: null });
const CAMC_SHIFTS_LIVE = [
  CS('c1', '2026-12-01', '5**', '** = 10 hour shift', '2500', false),
  CS('c2', '2026-12-02', '5*', '5*', '', true),
  CS('c3', '2026-12-03', '5**', '** = 10 hour shift', '2500', false),
  CS('c4', '2026-12-04', '5*', '5*', '', true),
  CS('c5', '2026-12-05', '7', '12 hour shift', '3000', false),
];
const REC_A = { id: 'ps-a', agency: 'Holzer', facility: '', frequency: 'biweekly', payDate: '2026-11-10', periodStart: '', periodEnd: '', gross: '', net: '', source: 'import', fileName: '' };
const REC_B = { id: 'ps-b', agency: 'Premier Anesthesia Group, PC', facility: 'Holzer', frequency: 'biweekly', payDate: '2026-11-10', periodStart: '2026-10-19', periodEnd: '2026-11-01', gross: '12757.50', net: '', source: 'stub', fileName: '' };
{
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [${J(HOLZ_FAC)}, ${J(CAMC_FAC_LIVE)}];
    db.shifts = [...${J(NOV_SHIFTS)}, ...${J(DEC_SHIFTS)}, ...${J(CAMC_SHIFTS_LIVE)}];
    db.payStubs = [${J(REC_A)}, ${J(REC_B)}];
    persist();`);
  t('C0: broken state reproduces — December headline is $48,600 before the re-confirm', run(`monthHeadline('2026-12').gross`) === 48600, String(run(`monthHeadline('2026-12').gross`)));
  const camc = run(`db.facilities.find(f => f.id === 'camc')`);
  const p = run(`describeParseLocal(${J(CAMC_TEXT)}, ${J(camc)}, ${J(CAMC_CODES)})`);
  t('C1: re-confirm parse leaves nothing unanswered', p.unanswered.length === 0, J(p.unanswered));
  run(`(() => { const f = db.facilities.find(x => x.id === 'camc'); applyDescribedRules(f, ${J(p)}); })()`);
  run(`healUnpricedShiftPays()`);
  const c2 = run(`db.shifts.find(x => x.id === 'c2')`);
  const c4 = run(`db.shifts.find(x => x.id === 'c4')`);
  t('C2: Dec 2 (5*) repriced to $2,500', String(c2.pay) === '2500' && c2.incomplete === false, J({ pay: c2.pay, incomplete: c2.incomplete }));
  t('C3: Dec 4 (5*) repriced to $2,500', String(c4.pay) === '2500' && c4.incomplete === false, J({ pay: c4.pay, incomplete: c4.incomplete }));
  t('C4: CAMC December total is $13,000', run(`db.shifts.filter(x => x.facility === 'CAMC' && x.date.startsWith('2026-12')).reduce((a, x) => a + num(x.pay), 0)`) === 13000);
  t('C5: the saved "5**" def label is healed to "10 hour shift"', run(`(codeDefFor(db.facilities.find(f => f.id === 'camc'), '5**') || {}).label`) === '10 hour shift', run(`(codeDefFor(db.facilities.find(f => f.id === 'camc'), '5**') || {}).label`));
  t('C6: December headline is $53,600 (HOLZ $40,600 + CAMC $13,000)', run(`monthHeadline('2026-12').gross`) === 53600, String(run(`monthHeadline('2026-12').gross`)));
  const occN = run(`paystubOccurrencesInMonth('2026-11')`);
  const nov24 = occN.find(o => o.date === '2026-11-24');
  t('C7: HOLZ Nov 24 still $27,075', !!nov24 && run(`paystubOccurrenceAmount(${J(nov24)})`) === 27075);
  const dec8 = run(`paystubOccurrencesInMonth('2026-12')`).find(o => o.date === '2026-12-08');
  t('C8: HOLZ Dec 8 still $10,625', !!dec8 && run(`paystubOccurrenceAmount(${J(dec8)})`) === 10625);
  t('C9: HOLZ November headline still $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.5, String(run(`monthHeadline('2026-11').gross`)));
}

// ---------- D. Follow-up question composition ----------
{
  t('D1: describeFollowUpQuestion exists', run(`typeof describeFollowUpQuestion`) === 'function');
  const local = 'One thing I couldn\'t tell from that: what is “5*” — and how does it pay? Add a sentence about it and make the rules again, or use these rules as-is.';
  const composed = run(`describeFollowUpQuestion(${J(local)}, 'Does this rule apply on weekends?')`);
  t('D2: composed question keeps the local code + answer path', composed.includes('“5*”') && composed.includes('use these rules as-is'), composed);
  t('D3: composed question also carries the AI question', composed.includes('Does this rule apply on weekends?'), composed);
  t('D4: no AI question → local question unchanged', run(`describeFollowUpQuestion(${J(local)}, '')`) === local);
  t('D5: AI question only → still states how to answer', run(`describeFollowUpQuestion('', 'Does this rule apply on weekends?')`).includes('use these rules as-is'));
}
// ---------- E. HOLZ fresh parse unchanged ----------
{
  const CODES = [
    { code: 'HOLZ - G Main (8)', ctype: '8-hour day', hours: 8 },
    { code: 'HOLZ - Call 1', ctype: '24-hour call', hours: 24 },
    { code: 'HOLZ - Call 2', ctype: 'Second call', hours: 24 },
    { code: 'HOLZ - G Main (10)', ctype: '10-hour shift', hours: 10 },
    { code: 'HOLZ - PCDO', ctype: '8-hour day', hours: 8 },
  ];
  const WORDS = 'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours\nHolz-call 1=24hr call. Weekday=$4,800 weekend $4,200\nHolz-call 2=2nd call weekday=$3,000 weekend $2,000\nHolz-g main (10)=10hour day shift\nHolz PCDO=post call day off=no pay\nWeekends only include Saturday and Sunday.';
  const p = run(`describeParseLocal(${J(WORDS)}, null, ${J(CODES)})`);
  const s = run(`describeSummaryText('HOLZ', ${J(p)}, null)`);
  t('E1: HOLZ parse still complete', p.unanswered.length === 0, J(p.unanswered));
  t('E2: G Main (8) still $250/hr × 8.5 = $2,125 in the summary', s.includes('“HOLZ - G Main (8)” (8-hour day): $250/hr × 8.5 paid hours = $2,125'), s);
  t('E3: PCDO still no pay', s.includes('“HOLZ - PCDO”: no pay'), s);
}
t('sw: cache bumped to v113', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v124'));
console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL PASS');
