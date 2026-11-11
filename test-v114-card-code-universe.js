// Nov 10, 2026 (late) — v114: v113 passed its harness but
// FAILED live in a worse way. At the CAMC facility CARD's "Pay
// rules in your words" box (the flow with the AI rule-read in
// the loop), Caleb re-entered the same CAMC text that the v113
// import gate handled. The read-back showed only "7" ($3,000)
// and "5**" ($2,500) — NO "5*" entry and NO "I still don't
// know about" line (v112 at least asked). "5*" was never
// stored; Dec 2/4 stayed unpriced; CAMC December $8,000 not
// $13,000; December headline $48,600 not $53,600.
//
// Root cause (proven by this file failing on v113): the card
// path's code universe. describeParseLocal only ever looks at
// the codes it is HANDED, and the card hands it
// facilityDescribeCodes(fac) — which listed only the keys of
// the facility's SAVED DEFINITIONS. "5*" had shifts on the
// calendar but no saved definition (it was the unresolved code
// from the import gate) — so it was not in the universe, got
// no block, no definition, and — because unanswered is also
// built from that same list — not even a "still don't know".
// The codes most in need of asking about were exactly the
// ones excluded. The v113 harness passed codes explicitly, so
// it never exercised this. (The AI merge is NOT the seam: it
// merges facility RATES only and never sees definitions —
// this file drives the real submitDescribe with a mocked AI
// in the loop to prove the drop happens with it present, and
// pins the union rule in both directions.)
//
// Fixes pinned here:
//  1. facilityDescribeCodes = saved definitions UNION the
//     codes the facility's saved shifts actually carry.
//  2. describeParseLocal augments its code list from the
//     facility the same way for every caller that passes one;
//     a code the augmentation adds is asked about only when
//     the text actually names it (confusion budget intact).
//  3. The AI merge is a UNION at code level: after the rates
//     merge, definitions are recomputed with the merged rates
//     and unioned with the local parse — a locally-resolved
//     code can never be lost, and a code only the merged
//     (AI-supplied) rates can price resolves too. A code
//     resolved by NEITHER parse lands in "still don't know".
//     Read-back coverage = every code named in the text.
//
// Run: node test-v114-card-code-universe.js
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

const CAMC_TEXT = '5** = 10 hour shift, $250/hr. On call 5pm-7pm, paid for hours worked. / 5* = same as 5**: 10 hour shift, $250/hr. On call 5pm-7pm, paid for hours worked. / 7 = 12 hour shift, $250/hr.';
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
// CAMC exactly as the live account held it when the card flow
// failed: saved defs for "5**" and "7" ONLY — "5*" exists only
// as codes on the saved Dec 2/4 shifts.
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

(async () => {
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [${J(HOLZ_FAC)}, ${J(CAMC_FAC_LIVE)}];
    db.shifts = [...${J(NOV_SHIFTS)}, ...${J(DEC_SHIFTS)}, ...${J(CAMC_SHIFTS_LIVE)}];
    db.payStubs = [${J(REC_A)}, ${J(REC_B)}];
    persist();`);
  t('setup: broken state reproduces — December headline $48,600', run(`monthHeadline('2026-12').gross`) === 48600, String(run(`monthHeadline('2026-12').gross`)));

  // ---------- A. The code universe the card hands the parse ----------
  {
    const codes = run(`facilityDescribeCodes(db.facilities.find(f => f.id === 'camc'))`);
    const names = codes.map(c => c.code);
    t('A1: card code universe includes the shift-only code "5*"', names.includes('5*'), J(names));
    t('A2: universe still includes the defined codes', names.includes('5**') && names.includes('7'), J(names));
    t('A3: no duplicate codes in the universe', names.length === new Set(names).size, J(names));
  }

  // ---------- B. The real card path: submitDescribe with a mocked AI ----------
  {
    run(`cloudSession = { user: { id: 't' }, access_token: 'x' };`);
    // Plausible live AI rule-read: ONE shift-type rule covering
    // the 10-hour reading only — nothing about "5*" as a code
    // (the AI read speaks facility rates, never definitions).
    run(`liveSyncPost = async function () { return { rule: { shift_type: '10-hour shift', flat_rate: 2500, hourly_rate: 250 } }; };`);
    run(`(() => { const fac = db.facilities.find(f => f.id === 'camc');
      describeStates['fac:camc'] = { text: ${J(CAMC_TEXT)}, parsed: null, error: '', busy: false, confirmed: false,
        ctx: { fac, facName: 'CAMC', codes: facilityDescribeCodes(fac) } }; })()`);
    await run(`submitDescribe('fac:camc')`);
    const p = run(`describeStates['fac:camc'].parsed`);
    t('B1: parse resolved "5*" through the card path', !!p && !!p.defs['5*'] && p.defs['5*'].canonicalType === '10-hour shift', J(p && Object.keys(p.defs)));
    t('B2: nothing named in the text is unanswered', !!p && p.unanswered.length === 0, J(p && p.unanswered));
    const s = run(`describeSummaryText('CAMC', describeStates['fac:camc'].parsed, db.facilities.find(f => f.id === 'camc'))`);
    t('B3: read-back covers EVERY code named in the text', ['5**', '5*', '7'].every(c => s.includes('“' + c + '”')), s);
    t('B4: read-back prices "5*" at $2,500', s.includes('“5*”') && s.includes('$2,500'), s);
    t('B5: read-back prices "7" at $3,000', s.includes('“7”') && s.includes('$3,000'), s);
    t('B6: no silent drop — no code is missing AND unasked', !!p && ['5**', '5*', '7'].every(c => p.defs[c] || p.unanswered.includes(c)), J(p && { defs: Object.keys(p.defs), unanswered: p.unanswered }));

    // Confirm through the card path and heal.
    run(`confirmDescribe('fac:camc')`);
    run(`healUnpricedShiftPays()`);
    t('B7: "5*" is now STORED on the facility', !!run(`codeDefFor(db.facilities.find(f => f.id === 'camc'), '5*')`), J(run(`Object.keys(facilityCodeDefs(db.facilities.find(f => f.id === 'camc')))`)));
    t('B8: Dec 2 (5*) repriced to $2,500', (() => { const x = run(`db.shifts.find(x => x.id === 'c2')`); return String(x.pay) === '2500' && x.incomplete === false; })(), J(run(`db.shifts.find(x => x.id === 'c2')`)));
    t('B9: Dec 4 (5*) repriced to $2,500', (() => { const x = run(`db.shifts.find(x => x.id === 'c4')`); return String(x.pay) === '2500' && x.incomplete === false; })());
    t('B10: CAMC December total is $13,000', run(`db.shifts.filter(x => x.facility === 'CAMC' && x.date.startsWith('2026-12')).reduce((a, x) => a + num(x.pay), 0)`) === 13000);
    t('B11: December headline is $53,600', run(`monthHeadline('2026-12').gross`) === 53600, String(run(`monthHeadline('2026-12').gross`)));
    const occN = run(`paystubOccurrencesInMonth('2026-11')`);
    const nov24 = occN.find(o => o.date === '2026-11-24');
    t('B12: HOLZ Nov 24 still $27,075', !!nov24 && run(`paystubOccurrenceAmount(${J(nov24)})`) === 27075);
    t('B13: HOLZ November headline still $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.5, String(run(`monthHeadline('2026-11').gross`)));
  }

  // ---------- C. Union, AI side: a partial AI read can never lose a local code ----------
  {
    run(`describeStates['fac:camc2'] = { text: ${J(CAMC_TEXT)}, parsed: null, error: '', busy: false, confirmed: false,
      ctx: { fac: db.facilities.find(f => f.id === 'camc'), facName: 'CAMC', codes: [{ code: '5**' }, { code: '5*' }, { code: '7' }] } };`);
    // AI restates ONLY the 12-hour code's reading ("7").
    run(`liveSyncPost = async function () { return { rule: { shift_type: '12-hour shift', flat_rate: 3000, hourly_rate: 250 } }; };`);
    await run(`submitDescribe('fac:camc2')`);
    const p = run(`describeStates['fac:camc2'].parsed`);
    t('C1: partial AI read — all three local codes survive the merge', !!p && ['5**', '5*', '7'].every(c => !!p.defs[c]), J(p && Object.keys(p.defs)));
    const s = run(`describeSummaryText('CAMC', describeStates['fac:camc2'].parsed, db.facilities.find(f => f.id === 'camc'))`);
    t('C2: read-back still prices "5*" at $2,500', s.includes('“5*”') && s.includes('$2,500'), s);
  }

  // ---------- D. Union, other direction: AI-supplied rates resolve a code the local parse cannot ----------
  {
    const faceless = { id: 'rgh2', name: 'RGH2', aliases: '', address: '', hourlyRate: '', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', callBonus: '', hourlyCall1st: '', weekendDays: [0, 6], codeMap: {} };
    run(`db.facilities.push(${J(faceless)}); persist();`);
    const TXT = 'NOC = 24hr call, paid at the usual first-call arrangement';
    const localOnly = run(`describeParseLocal(${J(TXT)}, db.facilities.find(f => f.id === 'rgh2'), [{ code: 'NOC', ctype: '24-hour call' }])`);
    t('D1: local parse alone cannot resolve NOC (precondition)', localOnly.unanswered.includes('NOC'), J(localOnly.unanswered));
    run(`describeStates['fac:rgh2'] = { text: ${J(TXT)}, parsed: null, error: '', busy: false, confirmed: false,
      ctx: { fac: db.facilities.find(f => f.id === 'rgh2'), facName: 'RGH2', codes: [{ code: 'NOC', ctype: '24-hour call' }] } };`);
    run(`liveSyncPost = async function () { return { rule: { shift_type: '24-hour call', flat_rate: 4800, weekend_flat_rate: 4200, first_call_hourly_rate: 175, hourly_rate: 250 } }; };`);
    await run(`submitDescribe('fac:rgh2')`);
    const p = run(`describeStates['fac:rgh2'].parsed`);
    t('D2: with the AI rates merged, NOC resolves', !!p && !!p.defs['NOC'] && !p.unanswered.includes('NOC'), J(p && { defs: Object.keys(p.defs), unanswered: p.unanswered }));
    const s = run(`describeSummaryText('RGH2', describeStates['fac:rgh2'].parsed, db.facilities.find(f => f.id === 'rgh2'))`);
    t('D3: read-back prices NOC from the AI-supplied rates ($4,800 / $4,200)', s.includes('“NOC”') && s.includes('$4,800') && s.includes('$4,200'), s);
  }

  // ---------- E. Resolved by NEITHER: named, priced by nobody → asked, never dropped ----------
  {
    run(`describeStates['fac:rgh3'] = { text: '9 = the mystery shift, ask the office', parsed: null, error: '', busy: false, confirmed: false,
      ctx: { fac: db.facilities.find(f => f.id === 'rgh2'), facName: 'RGH2', codes: [{ code: '9' }] } };`);
    run(`liveSyncPost = async function () { return { rule: {} }; };`);
    await run(`submitDescribe('fac:rgh3')`);
    const p = run(`describeStates['fac:rgh3'].parsed`);
    const s = p ? run(`describeSummaryText('RGH2', describeStates['fac:rgh3'].parsed, db.facilities.find(f => f.id === 'rgh2'))`) : '';
    t('E1: the unresolved named code is in unanswered', !!p && p.unanswered.includes('9'), J(p && p.unanswered));
    t('E2: read-back names it in the "still don\'t know" line', s.includes('still don\'t know') && s.includes('“9”'), s);
    t('E3: the follow-up question names it too', !!p && !!p.question && p.question.includes('“9”'), p && p.question);
  }

  // ---------- F. Confusion budget: an unmentioned shift-only code is NOT newly asked about ----------
  {
    // CAMC holds a shift code the text never mentions; a parse
    // of HOLZ-only words at CAMC must not invent a question
    // about it (augmentation is mention-gated).
    run(`db.shifts.push({ id: 'c9', date: '2026-12-09', facility: 'CAMC', type: 'ZZ9', code: 'ZZ9', pay: '', payRate: '', payUnit: '', status: 'confirmed', source: 'schedule-photo', sources: ['schedule-photo'], incomplete: true, note: '', updatedAt: null }); persist();`);
    const p = run(`describeParseLocal('Day shifts pay $250/hr.', db.facilities.find(f => f.id === 'camc'), facilityDescribeCodes(db.facilities.find(f => f.id === 'camc')))`);
    t('F1: unmentioned shift-only code is not in unanswered', !p.unanswered.includes('ZZ9'), J(p.unanswered));
    const p2 = run(`describeParseLocal('ZZ9 = 10 hour shift, $250/hr.', db.facilities.find(f => f.id === 'camc'), [{ code: '5**' }])`);
    t('F2: but once NAMED in the text it resolves even when the caller listed other codes', !!p2.defs['ZZ9'] && !p2.unanswered.includes('ZZ9'), J({ defs: Object.keys(p2.defs), unanswered: p2.unanswered }));
  }

  // ---------- G. HOLZ fresh parse unchanged ----------
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
    t('G1: HOLZ parse still complete', p.unanswered.length === 0, J(p.unanswered));
    t('G2: G Main (8) still $250/hr × 8.5 = $2,125 in the summary', s.includes('“HOLZ - G Main (8)” (8-hour day): $250/hr × 8.5 paid hours = $2,125'), s);
    t('G3: PCDO still no pay', s.includes('“HOLZ - PCDO”: no pay'), s);
  }
  t('sw: cache bumped to v114', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v133'));
  console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL PASS');
})().catch(e => { console.log('ERROR', e && e.stack || e); process.exitCode = 1; });
