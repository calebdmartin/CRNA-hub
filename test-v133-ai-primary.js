// CRNA Hub — v133 (Nov 11, 2026): the AI is the primary reader
// for the pay-words box. Caleb's directive: "Make all of the ai
// readers identical to yours. It's still having trouble reading
// simple things."
//
// DIAGNOSIS (probe-proven on v132 before this fix): his live
// read-back for "Day shifts pay $250/hr and I'm paid for 8.5
// hours. An 8-hour shift pays $2,125 per shift. 1st call
// weekday=$4,800. 1st call weekend $4,200. Call 2 weekday is
// $3,000 and $2,000 on weekends." was reproduced BYTE-FOR-BYTE
// by the deterministic parse alone with an empty code universe:
// describeCallAmounts(t,1) returns null on that text (the scope
// word fuses into the subject; the two split sentences defeat
// the statement window), contractExtractRates yields no rate24,
// and the unknown-subject net names "1st call weekday". The AI
// "rule" read WAS invoked but could not rescue it, structurally:
// its schema is ONE rule for ONE shift type, ruleToFacilityRates
// maps only that type's facility rates, and the AI read has no
// channel for code definitions at all — the deterministic parser
// stayed the only defs engine, and its failure was final.
//
// THE FIX: extract-contract mode "rules" reads the WHOLE text
// (every rule, every code, per-value source quotes) and leads;
// the client validates traceability (quote = verbatim substring
// containing the figure) and coverage (every named subject
// resolved or asked about), unions with the deterministic parse
// (AI primary, deterministic fills its gaps), and falls back to
// the exact v132 path when the AI is unavailable. Pricing stays
// deterministic. This harness stubs the AI at liveSyncPost.
//
// Run: node test-v133-ai-primary.js
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
    addEventListener() {},
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
let failures = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : (extra ? ' — ' + extra : '')));
  if (!cond) { failures++; process.exitCode = 1; }
};
const J = (x) => JSON.stringify(x);

// Caleb's screenshot text (Nov 11, 2026 ~6:11 PM ET).
const SHOT = "Day shifts pay $250/hr and I'm paid for 8.5 hours. An 8-hour shift pays $2,125 per shift. 1st call weekday=$4,800. 1st call weekend $4,200. Call 2 weekday is $3,000 and $2,000 on weekends.";
// Caleb's canonical 7-line text.
const WORDS = [
  'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours',
  'Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200',
  'Holz-call 2=2nd call weekday=$3,000 weekend $2,000',
  'Holz-g main (10)=10hour day shift',
  '10.5 hours paid for 10 hour shifts',
  'Holz PCDO=post call day off=no pay',
  'Weekends only include Saturday and Sunday.',
].join('\n');
const ADDENDUM = [
  'Facility: Holzer Health',
  '100 Jackson Pike, Gallipolis, OH 45631',
  'Assignment schedule:',
  'December 1, 2026 - HOLZ - G Main (8)',
  'December 2, 2026 - HOLZ - PCDO',
  'December 3, 2026 - HOLZ - G Main (10)',
  'December 4, 2026 - HOLZ - Call 1',
  'December 5, 2026 - HOLZ - Call 2',
].join('\n');
const HOLZER_ENTRY = `
  facilityContractPreview.facilities[0].name = 'Holzer';
  facilityContractPreview.facilities[0].aliases = 'HOLZ';
  facilityContractPreview.facilities[0].rates = { hourlyRate: '250', paidHours8: '8', hourlyCall1st: '175', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000' };
`;
const RESET = `
  db = empty(); editId = null; facilitySuggestionPrefill = null;
  facilityContractPreview = null; facilityContractError = ''; facilityContractOcrStatus = '';
  facilityContractPendingImages = []; facilityContractOcrPages = []; facilityContractConfirmCreate = false;
  describeStates = {}; schedulePreview = null; calPreview = null; contractPreview = null;
  paystubPreview = null; paystubError = ''; paystubStatus = ''; paystubCardFacId = ''; paystubCardOpenFac = ''; paystubImportCtx = null;
  cloudSession = { access_token: 'x', email: 'crna@example.com' };
`;
const Q = (value, quote) => ({ value, quote });
const READ_SHOT = {
  hourly_rate: Q(250, 'Day shifts pay $250/hr'),
  paid_hours_8: Q(8.5, "I'm paid for 8.5 hours"),
  paid_hours_by_length: [], first_call_hourly_rate: null, call_bonus: null,
  weekend: { days: [], stated: false, quote: null },
  codes: [
    { code: '8-hour shift', label: '8-hour shift', type: '8-hour day', hours: 8, paid_hours: null, weekday_pay: Q(2125, 'An 8-hour shift pays $2,125 per shift'), weekend_pay: null, unpaid: false, quote: 'An 8-hour shift pays $2,125 per shift.' },
    { code: '1st call', label: '1st call', type: '24-hour call', hours: 24, paid_hours: null, weekday_pay: Q(4800, '1st call weekday=$4,800'), weekend_pay: Q(4200, '1st call weekend $4,200'), unpaid: false, quote: '1st call weekday=$4,800. 1st call weekend $4,200.' },
    { code: 'Call 2', label: '2nd call', type: 'Second call', hours: 24, paid_hours: null, weekday_pay: Q(3000, 'Call 2 weekday is $3,000'), weekend_pay: Q(2000, '$2,000 on weekends'), unpaid: false, quote: 'Call 2 weekday is $3,000 and $2,000 on weekends.' },
  ],
  unknown: [], clarifying_question: null,
};
const READ_WORDS = {
  hourly_rate: Q(250, '$250/hr'),
  paid_hours_8: null,
  paid_hours_by_length: [{ length: 10, value: Q(10.5, '10.5 hours paid for 10 hour shifts') }],
  first_call_hourly_rate: null, call_bonus: null,
  weekend: { days: ['Saturday', 'Sunday'], stated: true, quote: 'Weekends only include Saturday and Sunday' },
  codes: [
    { code: 'HOLZ - G Main (8)', label: '8hr day shift', type: '8-hour day', hours: 8, paid_hours: Q(8.5, 'paid for 8.5 hours'), weekday_pay: null, weekend_pay: null, unpaid: false, quote: 'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours' },
    { code: 'HOLZ - Call 1', label: '24hr call', type: '24-hour call', hours: 24, paid_hours: null, weekday_pay: Q(4800, 'Weekday=$4,800'), weekend_pay: Q(4200, 'weekend $4,200'), unpaid: false, quote: 'Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200' },
    { code: 'HOLZ - Call 2', label: '2nd call', type: 'Second call', hours: 24, paid_hours: null, weekday_pay: Q(3000, 'weekday=$3,000'), weekend_pay: Q(2000, 'weekend $2,000'), unpaid: false, quote: 'Holz-call 2=2nd call weekday=$3,000 weekend $2,000' },
    { code: 'HOLZ - G Main (10)', label: '10hour day shift', type: '10-hour shift', hours: 10, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: 'Holz-g main (10)=10hour day shift' },
    { code: 'HOLZ - PCDO', label: 'post call day off', type: null, hours: null, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: true, quote: 'Holz PCDO=post call day off=no pay' },
  ],
  unknown: [], clarifying_question: null,
};
const stubAI = (read) => `
  window.__aiModes = [];
  liveSyncPost = async function (name, body) {
    window.__aiModes.push(body && body.mode);
    if (body && body.mode === 'rules') return { ok: true, mode: 'rules', read: ${J(read)} };
    throw new Error('old rule mode must not be needed');
  };
`;

(async () => {
  // ============ (a) the screenshot text, EMPTY code universe ============
  run(RESET + `facilityContractPreview = parseFacilityContract(${J(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY + `
    facilityContractPreview.facilities[0].codes = [];
    ${stubAI(READ_SHOT)}
    void facilityContractPreviewHTML();
    { const st = describeState('imp:facprev:0'); st.text = ${J(SHOT)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const pa = run(`describeState('imp:facprev:0').parsed`);
  t('A1 the AI read ran FIRST (mode rules), old rule mode untouched',
    JSON.stringify(run(`window.__aiModes`)) === '["rules"]', J(run(`window.__aiModes`)));
  t('A2 Call 1 lands: rate24 $4,800 / weekendRate24 $4,200',
    !!pa && pa.rates.rate24 === 4800 && pa.rates.weekendRate24 === 4200, J(pa && pa.rates));
  t('A3 Call 2 + day: rateSecond $3,000 / weekend $2,000, hourly $250 x 8.5 paid hours, rate8 $2,125',
    !!pa && pa.rates.rateSecond === 3000 && pa.rates.weekendRateSecond === 2000 && pa.rates.hourlyRate === 250 && pa.rates.paidHours8 === 8.5 && pa.rates.rate8 === 2125, J(pa && pa.rates));
  t('A4 a Call 1 DEFINITION exists (the channel the old read lacked)',
    !!pa && Object.values(pa.defs).some(d => d.canonicalType === '24-hour call'), J(pa && pa.defs));
  t('A5 ZERO unknowns — the fused subject "1st call weekday" is covered by the resolution',
    !!pa && pa.unanswered.length === 0, J(pa && pa.unanswered));
  const sa = run(`describeSummaryText('Holzer', describeState('imp:facprev:0').parsed, facPreviewOverlay(facilityContractPreview.facilities[0]))`);
  t('A6 read-back shows 1st call $4,800/$4,200 and the $2,125 day shift',
    sa.includes('$4,800 on weekdays, $4,200 on weekends') && sa.includes('$2,125'), sa);
  t('A7 weekend is the LABELED DEFAULT (he never stated it) — not "Weekend means"',
    sa.includes("You didn't say which days count as the weekend") && !sa.includes('Weekend means'), sa);
  t('A8 read-back asks about nothing', !sa.includes("still don't know"), sa);

  // ============ (b) canonical 7-line text, full save + pricing ============
  run(RESET + `facilityContractPreview = parseFacilityContract(${J(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY + `
    ${stubAI(READ_WORDS)}
    void facilityContractPreviewHTML();
    { const st = describeState('imp:facprev:0'); st.text = ${J(WORDS)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const pb = run(`describeState('imp:facprev:0').parsed`);
  const sb = run(`describeSummaryText('Holzer', describeState('imp:facprev:0').parsed, facPreviewOverlay(facilityContractPreview.facilities[0]))`);
  t('B1 PCDO resolves UNPAID through the AI-primary read',
    !!pb && !!pb.defs['HOLZ - PCDO'] && pb.defs['HOLZ - PCDO'].unpaid === true, J(pb && pb.defs['HOLZ - PCDO']));
  t('B2 (10) binds the length-targeted 10.5 paid hours -> $2,625 in the read-back',
    sb.includes('“HOLZ - G Main (10)” (10-hour shift): $250/hr × 10.5 paid hours = $2,625'), sb);
  t('B3 weekend STATED reads as fact: "Weekend means Saturday and Sunday."',
    sb.includes('Weekend means Saturday and Sunday.'), sb);
  t('B4 nothing unanswered', !!pb && pb.unanswered.length === 0, J(pb && pb.unanswered));
  run(`confirmDescribe('imp:facprev:0')`);
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`);
  const facB = run(`db.facilities[0]`);
  t('B5 the save landed on a Holzer facility', !!facB && /holz/i.test(facB.name + ' ' + (facB.aliases || '')), J(facB && facB.name));
  const price = (code, type, date) => run(`resolveShiftPrice(db.facilities[0], { code: ${J(code)}, type: ${J(type)}, date: ${J(date)} })`);
  const p8 = price('HOLZ - G Main (8)', 'HOLZ - G Main (8)', '2026-12-01');
  const p10 = price('HOLZ - G Main (10)', 'HOLZ - G Main (10)', '2026-12-03');
  const pC1w = price('HOLZ - Call 1', 'HOLZ - Call 1', '2026-12-04');
  const pC1e = price('HOLZ - Call 1', 'HOLZ - Call 1', '2026-12-05');
  const pPC = price('HOLZ - PCDO', 'HOLZ - PCDO', '2026-12-02');
  t('B6 saved prices: (8) $2,125 · (10) $2,625 · Call 1 weekday $4,800 · Call 1 Sat $4,200 · PCDO $0 unpaid',
    p8 && p8.pay === '2125' && p10 && p10.pay === '2625' && pC1w && pC1w.pay === '4800' && pC1e && pC1e.pay === '4200' && pPC && pPC.pay === '0' && pPC.payUnit === 'unpaid',
    J({ p8, p10, pC1w, pC1e, pPC }));
  // The Nov 2-15 paycheck through the AI-saved card: $27,075 pin.
  const NOV = [['2026-11-02', '8-hour day', 'HOLZ - G Main (8)'], ['2026-11-03', 'Second call', 'HOLZ - Call 2'], ['2026-11-04', '8-hour day', 'HOLZ - G Main (8)'], ['2026-11-05', '8-hour day', 'HOLZ - G Main (8)'], ['2026-11-06', 'Second call', 'HOLZ - Call 2'], ['2026-11-07', '24-hour call', 'HOLZ - Call 1'], ['2026-11-08', 'Second call', 'HOLZ - Call 2'], ['2026-11-10', '8-hour day', 'HOLZ - G Main (8)'], ['2026-11-11', '8-hour day', 'HOLZ - G Main (8)'], ['2026-11-12', '8-hour day', 'HOLZ - G Main (8)'], ['2026-11-13', '8-hour day', 'HOLZ - G Main (8)']];
  let novSum = 0; for (const [d, ty, cd] of NOV) { const r = price(cd, cd, d); novSum += r ? Number(r.pay) : NaN; }
  t('B7 money pin through the AI-primary save: Nov 2-15 sums to $27,075', novSum === 27075, String(novSum));

  // ============ (c) CAMC, both phrasings, card surface ============
  const CAMC_CODES = `[{code:'8',ctype:'8-hour day',hours:8},{code:'10',ctype:'10-hour shift',hours:10},{code:'5*',ctype:'10-hour shift',hours:10},{code:'5**',ctype:'10-hour shift',hours:10},{code:'12',ctype:'12-hour shift',hours:12}]`;
  const READ_CAMC = {
    hourly_rate: Q(250, '$250/hr'), paid_hours_8: null, paid_hours_by_length: [],
    first_call_hourly_rate: null, call_bonus: null,
    weekend: { days: [], stated: false, quote: null },
    codes: [
      { code: '8', label: '8hr shifts', type: '8-hour day', hours: 8, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: '8=8hr shifts' },
      { code: '10', label: '10hr shifts', type: '10-hour shift', hours: 10, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: '10=10hr shifts' },
      { code: '5*', label: '10hr shifts', type: '10-hour shift', hours: 10, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: '5*=10hr shifts' },
      { code: '5**', label: '10hr shifts', type: '10-hour shift', hours: 10, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: '5**=10hr shifts' },
      { code: '12', label: '12hr shifts', type: '12-hour shift', hours: 12, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: '12=12hr shifts' },
    ],
    unknown: [], clarifying_question: null,
  };
  const camcRun = async (label, text) => {
    run(RESET + `
      db.facilities = [{ id: 'camc', name: 'CAMC', aliases: '', hourlyRate: '250', codeMap: {} }];
      cloudSession = { access_token: 'x', email: 'crna@example.com' };
      ${stubAI(READ_CAMC)}
      describeStates['fac:camc'] = { text: ${J(text)}, parsed: null, error: '', busy: false, confirmed: false,
        ctx: { fac: db.facilities[0], facName: 'CAMC', codes: ${CAMC_CODES} } };`);
    await run(`submitDescribe('fac:camc')`);
    const p = run(`describeStates['fac:camc'].parsed`);
    t(label + ': all five codes resolved by the AI-primary read, none unknown',
      !!p && ['8', '10', '5*', '5**', '12'].every(c => !!p.defs[c]) && p.unanswered.length === 0,
      J(p && { defs: Object.keys(p.defs), unanswered: p.unanswered }));
    run(`confirmDescribe('fac:camc')`);
    const pr = (code) => run(`resolveShiftPrice(db.facilities[0], { code: ${J(code)}, type: ${J(code)}, date: '2026-12-01' })`);
    const pays = {}; for (const c of ['8', '10', '5*', '5**', '12']) { const r = pr(c); pays[c] = r ? Number(r.pay) : null; }
    t(label + ': saved prices 8 $2,000 · 10/5*/5** $2,500 · 12 $3,000',
      pays['8'] === 2000 && pays['10'] === 2500 && pays['5*'] === 2500 && pays['5**'] === 2500 && pays['12'] === 3000, J(pays));
  };
  await camcRun('C1 CAMC =-list', '$250/hour\n8=8hr shifts\n10=10hr shifts\n5*=10hr shifts\n5**=10hr shifts\n12=12hr shifts');
  await camcRun('C2 CAMC or-list', '$250/hr\n8s or 8=8hr shifts\n10s or 10=10hr shifts\n5* or 5**=10hr shifts\n12s or 12=12hr shifts');

  // ============ (d) AI omits a named code -> coverage names it ============
  const READ_OMIT = JSON.parse(J(READ_WORDS));
  READ_OMIT.codes = READ_OMIT.codes.filter(c => c.code !== 'HOLZ - PCDO');
  run(RESET + `facilityContractPreview = parseFacilityContract(${J(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY + `
    ${stubAI(READ_OMIT)}
    void facilityContractPreviewHTML();
    { const st = describeState('imp:facprev:0'); st.text = ${J(WORDS + '\nHolz ABC3=3hr shifts')}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const pd = run(`describeState('imp:facprev:0').parsed`);
  t('D1 a code the AI omitted but the deterministic side resolved (PCDO) is FILLED, not asked about',
    !!pd && !!pd.defs['HOLZ - PCDO'] && pd.defs['HOLZ - PCDO'].unpaid === true && !pd.unanswered.some(u => /pcdo/i.test(u)),
    J(pd && { defs: Object.keys(pd.defs), unanswered: pd.unanswered }));
  t('D2 a code NEITHER side resolved (ABC3) is NAMED in "still don\'t know"',
    !!pd && pd.unanswered.some(u => /ABC3/.test(u)), J(pd && pd.unanswered));

  // ============ (e) AI invents amounts -> rejected + surfaced ============
  const READ_INVENT = JSON.parse(J(READ_WORDS));
  READ_INVENT.codes = READ_INVENT.codes.map(c => {
    if (c.code === 'HOLZ - Call 1') return { ...c, weekday_pay: Q(9999, 'Weekday=$4,800') };
    if (c.code === 'HOLZ - Call 2') return { ...c, weekend_pay: Q(8888, 'Call 2 pays $8,888 on weekends') };
    return c;
  });
  run(RESET + `facilityContractPreview = parseFacilityContract(${J(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY + `
    ${stubAI(READ_INVENT)}
    void facilityContractPreviewHTML();
    { const st = describeState('imp:facprev:0'); st.text = ${J(WORDS)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const pe = run(`describeState('imp:facprev:0').parsed`);
  t('E1 invented amounts are REJECTED: rates keep the true $4,800 / $2,000 (deterministic cross-check)',
    !!pe && pe.rates.rate24 === 4800 && pe.rates.weekendRateSecond === 2000, J(pe && pe.rates));
  t('E2 the rejections are recorded on the parse',
    !!pe && Array.isArray(pe.aiRejected) && pe.aiRejected.length === 2, J(pe && pe.aiRejected));
  const se = run(`describeSummaryText('Holzer', describeState('imp:facprev:0').parsed, facPreviewOverlay(facilityContractPreview.facilities[0]))`);
  t('E3 the read-back NAMES what was left out and why',
    se.includes('I left out $9,999 for “HOLZ - Call 1” and $8,888 for “HOLZ - Call 2”'), se);
  run(`confirmDescribe('imp:facprev:0')`);
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`);
  t('E4 nothing invented reaches the saved card',
    run(`db.facilities[0].rate24`) === '4800' && run(`db.facilities[0].weekendRateSecond`) === '2000',
    J({ r24: run(`db.facilities[0].rate24`), wes: run(`db.facilities[0].weekendRateSecond`) }));

  // ============ (f) AI endpoint down -> exact v132 fallback ============
  const downRun = async (text, codesSetup) => {
    run(RESET + `facilityContractPreview = parseFacilityContract(${J(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY + `
      ${codesSetup}
      liveSyncPost = async function () { throw new Error('endpoint down'); };
      cloudSession = null;
      void facilityContractPreviewHTML();
      { const st = describeState('imp:facprev:0'); st.text = ${J(text)}; }`);
    const localOnly = run(`describeParseLocal(${J(text)}, facPreviewOverlay(facilityContractPreview.facilities[0]), facPreviewCodes(facilityContractPreview.facilities[0]))`);
    run(`cloudSession = { access_token: 'x', email: 'crna@example.com' };`);
    await run(`submitDescribe('imp:facprev:0')`);
    const p = run(`describeState('imp:facprev:0').parsed`);
    const norm = (x) => { const o = { rates: x.rates, defs: x.defs, unanswered: x.unanswered, weekendDays: x.weekendDays }; return J(o, Object.keys(o).sort()); };
    const sortObj = (x) => { if (Array.isArray(x)) return x.map(sortObj); if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = sortObj(x[k]); return o; } return x; };
    t('F fallback (AI down) reproduces the deterministic parse exactly for: ' + text.slice(0, 34) + '…',
      !!p && J(sortObj({ rates: p.rates, defs: p.defs, unanswered: p.unanswered, weekendDays: p.weekendDays })) === J(sortObj({ rates: localOnly.rates, defs: localOnly.defs, unanswered: localOnly.unanswered, weekendDays: localOnly.weekendDays })),
      J({ got: p && p.unanswered, want: localOnly.unanswered }));
    return p;
  };
  await downRun(WORDS, '');
  const pf2 = await downRun(SHOT, 'facilityContractPreview.facilities[0].codes = [];');
  // v135 supersedes the v132 verbatim pin: the deterministic
  // reader was deliberately strengthened this round (sentence-
  // level weekend filtering in contract extraction, copula
  // length binding), so the fallback now LANDS the 1st-call
  // rates the v132 reader missed and asks about nothing.
  // The F assertion above still guarantees the fallback IS
  // the deterministic parse, exactly.
  t('F2 the screenshot text under fallback now lands weekday 1st call (v135 reader)',
    !!pf2 && pf2.unanswered.length === 0 && pf2.rates.rate24 === 4800,
    J(pf2 && { u: pf2.unanswered, r: pf2.rates }));

  // ============ (g) rules mode missing server-side -> old merge still serves ============
  run(RESET + `facilityContractPreview = parseFacilityContract(${J(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY + `
    facilityContractPreview.facilities[0].codes = [];
    liveSyncPost = async function (name, body) {
      if (body && body.mode === 'rules') throw new Error('unknown mode');
      return { ok: true, mode: 'rule', rule: { shift_type: '24-hour call', flat_rate: 4800, weekend_flat_rate: 4200, applies_to: 'both', summary: 'x', clarifying_question: null, missing: [] } };
    };
    void facilityContractPreviewHTML();
    { const st = describeState('imp:facprev:0'); st.text = ${J(SHOT)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const pg = run(`describeState('imp:facprev:0').parsed`);
  t('G1 when mode "rules" is unavailable the pre-v133 merge still runs (rate24 lands from the old rule read)',
    !!pg && pg.rates.rate24 === 4800 && pg.rates.weekendRate24 === 4200, J(pg && pg.rates));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
