// Nov 10, 2026 — the describe-in-words reader, UNIVERSALITY round.
//
// Caleb's live report (branch preview, QGenda import "Pay rules at
// Holzer"): he typed rules for five codes; the read-back resolved
// four and said it still didn't know "HOLZ - Call 1" — even though
// his text plainly stated it ("Holz-call 1= 24hr call.
// weekday=$4,800. Weekend=$4,200"). Root cause, proven by
// reproduction before the fix: (1) canonicalTypeOf had no pattern
// for "24hr" (the 24-hour branch required a word-bounded "24" or
// the word "first"/"1st"; Call 2 survived because "second call" is
// a literal canonical phrase); (2) the code-linking step matched
// codes only verbatim, so "Holz-call 1" never linked to the code
// "HOLZ - Call 1", and with an uncanonicalized feed type the
// extracted $4,800 was disowned from the code (the summary even
// printed an orphan "1st call: $4,800" line); (3) the call-amount
// extractor windowed from the first "call N" mention and died at
// the first period, and nothing captured a weekend amount sitting
// on its own following line.
//
// The fix parses STATEMENTS: the text is cut into clauses; a
// clause that NAMES a code (tolerant matching — case, punctuation,
// hyphen spacing, facility prefix optional) binds it, and a clause
// naming no code carries forward to the most recently named code.
// Weekday/weekend keywords (incl. wknd/wkdy/weeknights) scope the
// amount nearest them, so "weekday=$4,800" and "$4,800 weekdays"
// both work in either order. Amounts for canonical call types land
// on the facility split fields (rate24/weekendRate24,
// rateSecond/weekendRateSecond — the fields facilityPayFor reads);
// amounts for any other code stay on its definition
// (weekdayPay/weekendPay) and price through clarifiedRowPricing.
// No facility's codes, names or amounts appear in the parser.
//
// This suite pins: Caleb's exact input verbatim (both feed-type
// shapes), the saved card + a priced Fri/Sat Call 1 pair, a corpus
// of 10+ writing styles expressing equivalent rules, two non-Caleb
// facilities (one with a Friday-inclusive weekend), the confusion
// budget (the reader asks ONLY about what was genuinely never
// priced), and the local/AI merge preference (the reading that
// accounts for more of the user's stated amounts wins).
// Run: node test-describe-universal.js
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
const HOLZER_CODES = [
  { code: 'HOLZ - G Main (8)', ctype: '8-hour day', hours: 8 },
  { code: 'HOLZ - Call 1', ctype: '24-hour call', hours: 24 },
  { code: 'HOLZ - Call 2', ctype: 'Second call', hours: 24 },
  { code: 'HOLZ - G Main (10)', ctype: '10-hour shift', hours: 10 },
  { code: 'HOLZ - PCDO', ctype: '8-hour day', hours: 8 },
];
// Caleb's exact words, verbatim (Nov 10, 2026 screenshot).
const CALEB = 'Holz-g main (8)= 8hour day shift $250/hour\nHolz-call 1= 24hr call. weekday=$4,800.\nWeekend=$4,200\nHolz-call 2= second call. Weekday=$3,000.\nWeekend=$2,000';
const parse = (text, codes) => run(`describeParseLocal(${J(text)}, null, ${J(codes)})`);
const ratesOk = (p, extra) => p.rates.hourlyRate === 250 && p.rates.rate24 === 4800 && p.rates.weekendRate24 === 4200 && p.rates.rateSecond === 3000 && p.rates.weekendRateSecond === 2000;

(async () => {
  // ---------- 1. Caleb's exact input, feed types canonicalized ----------
  {
    const p = parse(CALEB, HOLZER_CODES);
    t('fixture: all five codes resolved, no follow-up', p.unanswered.length === 0 && !p.question, J(p.unanswered));
    t('fixture: rates complete incl. weekend splits', ratesOk(p), J(p.rates));
    t('fixture: Call 1 def is the 24-hour call', p.defs['HOLZ - Call 1'] && p.defs['HOLZ - Call 1'].canonicalType === '24-hour call');
    const s = run(`describeSummaryText('Holzer', ${J(p)}, null)`);
    t('fixture: read-back states Call 1 weekday/weekend', s.includes('“HOLZ - Call 1” (1st call): $4,800 on weekdays, $4,200 on weekends.'));
    t('fixture: read-back states Call 2 unchanged', s.includes('“HOLZ - Call 2” (2nd call): $3,000 on weekdays, $2,000 on weekends.'));
    t('fixture: read-back has no "still don\'t know"', !s.includes('still don’t know') && !s.includes("still don't know"));
  }
  // ---------- 2. The live shape: Call 1's feed type never canonicalized ----------
  {
    const codes = HOLZER_CODES.map(c => c.code === 'HOLZ - Call 1' ? { ...c, ctype: '' } : c);
    const p = parse(CALEB, codes);
    t('live shape (ctype blank): all five codes resolved', p.unanswered.length === 0, J(p.unanswered));
    t('live shape: rates complete', ratesOk(p), J(p.rates));
    t('live shape: Call 1 def canonicalized from the words', p.defs['HOLZ - Call 1'] && p.defs['HOLZ - Call 1'].canonicalType === '24-hour call');
  }
  // ---------- 3. Saved card + priced Fri/Sat Call 1 pair ----------
  {
    const p = parse(CALEB, HOLZER_CODES);
    const fac = run(`(() => { const f = {}; applyDescribedRules(f, ${J(p)}); return f; })()`);
    t('saved card: rate24/weekendRate24 on the facility', fac.rate24 === '4800' && fac.weekendRate24 === '4200', J({ r: fac.rate24, w: fac.weekendRate24 }));
    t('saved card: rateSecond/weekendRateSecond', fac.rateSecond === '3000' && fac.weekendRateSecond === '2000');
    const fri = run(`facilityPayFor(${J(fac)}, '24-hour call', '2026-11-06')`);
    const sat = run(`facilityPayFor(${J(fac)}, '24-hour call', '2026-11-07')`);
    t('priced pair: Friday Call 1 = $4,800 (weekday at a Sat/Sun facility)', fri === 4800, String(fri));
    t('priced pair: Saturday Call 1 = $4,200 (weekend)', sat === 4200, String(sat));
  }
  // ---------- 4. Reordered: weekend amount stated before weekday ----------
  {
    const txt = 'Holz-g main (8)= 8hour day shift $250/hour\nHolz-call 1= 24hr call. Weekend=$4,200.\nWeekday=$4,800.\nHolz-call 2= second call. Weekend=$2,000.\nWeekday=$3,000.';
    const p = parse(txt, HOLZER_CODES);
    t('reordered: all resolved', p.unanswered.length === 0, J(p.unanswered));
    t('reordered: same rates', ratesOk(p), J(p.rates));
  }
  // ---------- 5. One-line comma style ----------
  {
    const txt = 'Call 1 is 24 hour call, $4800 weekdays and $4200 weekends. Call 2 is second call, $3000 weekdays and $2000 weekends. G Main (8) is an 8-hour day at $250/hour.';
    const p = parse(txt, HOLZER_CODES);
    t('one-line: all resolved', p.unanswered.length === 0, J(p.unanswered));
    t('one-line: same rates', ratesOk(p), J(p.rates));
  }
  // ---------- 6. Full prose sentences ----------
  {
    const txt = 'At Holzer, G Main (8) is an 8-hour day shift paid at $250 per hour. Call 1 is a 24-hour call paying $4,800 on weekdays and $4,200 on weekends. Call 2 is second call: $3,000 on weekdays, $2,000 on weekends.';
    const p = parse(txt, HOLZER_CODES);
    t('prose: all resolved', p.unanswered.length === 0, J(p.unanswered));
    t('prose: same rates', ratesOk(p), J(p.rates));
  }
  // ---------- 7. Amounts before the name ----------
  {
    const txt = '$4,800 weekdays / $4,200 weekends for Call 1 (24-hour call). $3,000 weekdays, $2,000 weekends for Call 2 (second call). Day shifts are $250/hr.';
    const p = parse(txt, HOLZER_CODES);
    t('amounts-first: all resolved', p.unanswered.length === 0, J(p.unanswered));
    t('amounts-first: same rates', ratesOk(p), J(p.rates));
  }
  // ---------- 8. Label on the next line ----------
  {
    const txt = 'Holz-call 1=\n24hr call, $4,800 weekdays, $4,200 weekends\nHolz-call 2=\nsecond call, $3,000 weekdays, $2,000 weekends\nHolz-g main (8)=\n8hour day shift, $250/hour';
    const p = parse(txt, HOLZER_CODES);
    t('next-line labels: all resolved', p.unanswered.length === 0, J(p.unanswered));
    t('next-line labels: same rates', ratesOk(p), J(p.rates));
  }
  // ---------- 9. Abbreviations + shouting case ----------
  {
    const txt = 'CALL 1 = 24HR CALL. WKND $4,200. WKDY $4,800. CALL 2 = 2ND CALL. WKDY $3,000. WKND $2,000. DAY SHIFTS $250/HR.';
    const p = parse(txt, HOLZER_CODES);
    t('abbreviations: all resolved', p.unanswered.length === 0, J(p.unanswered));
    t('abbreviations: same rates', ratesOk(p), J(p.rates));
  }
  // ---------- 10. Colon headers, parenthesized day types ----------
  {
    const txt = 'HOLZ - Call 1: 24-hour call — $4,800 (weekday), $4,200 (weekend)\nHOLZ - Call 2: second call — $3,000 (weekday), $2,000 (weekend)\nDay rate $250/hr';
    const p = parse(txt, HOLZER_CODES);
    t('colon style: all resolved', p.unanswered.length === 0, J(p.unanswered));
    t('colon style: same rates', ratesOk(p), J(p.rates));
  }
  // ---------- 11. Non-Caleb facility: invented codes, per-code pay ----------
  {
    const codes = [
      { code: 'STM - NOC', ctype: '', hours: 8 },
      { code: 'STM - OR Day', ctype: '', hours: 8 },
      { code: 'STM - Backup', ctype: '', hours: 8 },
    ];
    const txt = 'NOC is night call — weeknights $1,800, weekends $2,200. OR Day pays $200/hr. Backup is $900 flat.';
    const p = parse(txt, codes);
    t('STM: all three codes resolved', p.unanswered.length === 0, J(p.unanswered));
    t('STM: NOC carries its own weekday/weekend pay', p.defs['STM - NOC'] && p.defs['STM - NOC'].weekdayPay === 1800 && p.defs['STM - NOC'].weekendPay === 2200, J(p.defs['STM - NOC']));
    const s = run(`describeSummaryText('Holzer', ${J(p)}, null)`);
    t('STM: read-back states NOC amounts', s.includes('$1,800 on weekdays') && s.includes('$2,200 on weekends'), s);
    const fac = run(`(() => { const f = {}; applyDescribedRules(f, ${J(p)}); return f; })()`);
    t('STM: hourly saved from OR Day', fac.hourlyRate === '200', J(fac));
    const nocFri = run(`clarifiedRowPricing(${J(fac)}, { code: 'STM - NOC', date: '2026-11-06' })`);
    const nocSat = run(`clarifiedRowPricing(${J(fac)}, { code: 'STM - NOC', date: '2026-11-07' })`);
    const orDay = run(`clarifiedRowPricing(${J(fac)}, { code: 'STM - OR Day', date: '2026-11-06' })`);
    const backup = run(`clarifiedRowPricing(${J(fac)}, { code: 'STM - Backup', date: '2026-11-07' })`);
    t('STM: NOC prices $1,800 Fri / $2,200 Sat', Number(nocFri.pay) === 1800 && Number(nocSat.pay) === 2200, J({ f: nocFri.pay, s: nocSat.pay }));
    t('STM: OR Day prices $200/hr x 8 = $1,600', Number(orDay.pay) === 1600, String(orDay.pay));
    t('STM: Backup prices its flat $900 any day', Number(backup.pay) === 900, String(backup.pay));
  }
  // ---------- 12. Non-Caleb facility: Friday-inclusive weekend ----------
  {
    const codes = [{ code: 'RGH - Call A', ctype: '', hours: 24 }];
    const txt = 'Weekend is Friday and Saturday. Call A is first call: $3,600 weekdays, $3,000 weekends.';
    const p = parse(txt, codes);
    t('RGH: code resolved', p.unanswered.length === 0, J(p.unanswered));
    t('RGH: weekend captured as Friday+Saturday', J(p.weekendDays) === J([5, 6]), J(p.weekendDays));
    t('RGH: first call rates captured', p.rates.rate24 === 3600 && p.rates.weekendRate24 === 3000, J(p.rates));
    const fac = run(`(() => { const f = {}; applyDescribedRules(f, ${J(p)}); return f; })()`);
    const fri = run(`facilityPayFor(${J(fac)}, '24-hour call', '2026-11-06')`);
    const sun = run(`facilityPayFor(${J(fac)}, '24-hour call', '2026-11-08')`);
    t('RGH: Friday prices at the WEEKEND rate there', fri === 3000, String(fri));
    t('RGH: Sunday prices at the WEEKDAY rate there', sun === 3600, String(sun));
  }
  // ---------- 13. Confusion budget: ask only about what was never priced ----------
  {
    const codes = [HOLZER_CODES[1], HOLZER_CODES[2]];
    const p = parse('Call 2 is $3,000 on weekdays and $2,000 on weekends. Call 1 is the overnight one.', codes);
    t('budget: the stated code is NOT asked about', !p.unanswered.includes('HOLZ - Call 2'));
    t('budget: the genuinely unpriced code IS asked about', p.unanswered.length === 1 && p.unanswered[0] === 'HOLZ - Call 1', J(p.unanswered));
    t('budget: the one question names only that code', !!p.question && p.question.includes('HOLZ - Call 1') && !p.question.includes('Call 2'), p.question || '');
  }
  // ---------- 14. A stray amount never reprices a stated code ----------
  {
    const codes = [HOLZER_CODES[2]];
    const p = parse('Call 2 is $3,000 on weekdays, $2,000 on weekends. There is also a $500 bonus thing.', codes);
    t('stray amount: Call 2 rates unchanged', p.rates.rateSecond === 3000 && p.rates.weekendRateSecond === 2000, J(p.rates));
  }
  // ---------- 15. AI merge: the reading covering more stated amounts wins ----------
  {
    run(`cloudSession = { user: { id: 't' }, access_token: 'x' };`);
    run(`describeStates['fac:aitest'] = { text: ${J(CALEB)}, parsed: null, error: '', busy: false, confirmed: false, ctx: { fac: null, facName: 'Holzer', codes: ${J(HOLZER_CODES)} } };`);
    // AI confuses the 1st-call hourly for the flat: merging would
    // LOSE the stated $4,800 — the local reading must stand.
    run(`liveSyncPost = async function () { return { rule: { shift_type: '24-hour call', flat_rate: 175 } }; };`);
    await run(`submitDescribe('fac:aitest')`);
    const kept = run(`describeStates['fac:aitest'].parsed.rates.rate24`);
    t('AI merge: local $4,800 kept over the AI 175 (more stated amounts covered)', kept === 4800, String(kept));
    // AI agrees on the flats and ADDS the 1st-call hourly: merge
    // loses nothing, so the addition is adopted.
    run(`describeStates['fac:aitest'].parsed = null;`);
    run(`liveSyncPost = async function () { return { rule: { shift_type: '24-hour call', flat_rate: 4800, weekend_flat_rate: 4200, first_call_hourly_rate: 175 } }; };`);
    await run(`submitDescribe('fac:aitest')`);
    const merged = run(`describeStates['fac:aitest'].parsed.rates`);
    t('AI merge: gap-filling AI values adopted when nothing stated is lost', merged.rate24 === 4800 && merged.weekendRate24 === 4200 && merged.hourlyCall1st === 175, J(merged));
  }

  console.log(fails === 0 ? 'ALL PASS' : ('FAILURES: ' + fails));
})();
