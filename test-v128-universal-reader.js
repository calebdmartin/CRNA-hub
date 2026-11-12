// Nov 11, 2026 — v128: the universal-reader round. Caleb's
// CAMC card text named five codes with "or" lists and
// pluralized spellings ("8s or 8=8hr shifts", "5* or
// 5**=10hr shifts", "12s or 12=12hr shifts"); the read-back
// came back as a bare "Day shifts pay $250/hr." — every
// definition dropped, and on save only the hourly rate
// persisted. His direction, verbatim: "The app just needs
// to be prepared for any and everything a user can write in
// that section and be able to read it."
//
// This file is the VARIATION CORPUS for the pay-words
// reader: Caleb's CAMC rules and his HOLZ rules, each
// expressed in many phrasings — and/or/comma/slash/ampersand
// subject lists, pluralized codes, prefixed codes, both
// spellings on the schedule at once, "means / is / are /
// pays / =", amounts before vs after the code, "$250 an
// hour" / "$250 per hour" / "250/hr" / "$250 hourly",
// one-line run-ons, mixed order, codes with spaces and
// hyphens ("call 1", "Call-1"), light unit typos. EVERY
// variation must resolve to the same rate card +
// definitions and price the same shifts, or surface as an
// explicit unresolved item — never a silent drop. Cases
// marked SURFACE assert the surfacing branch: the name is
// in "still don't know", and nothing was fabricated.
//
// Fixes it pins (all at the general layer):
//  1. Subject lists bind through the whole glue family —
//     and / or / & / comma / slash / bare space — with "is /
//     are / means" as assignment verbs, via the same
//     inheritance machinery v122 built for "and".
//  2. Plural code names ("8s") match their code at lower
//     priority than any exact form; a code literally named
//     "8s" keeps its own mentions.
//  3. Shortened names are general: every token suffix of a
//     multi-token code, plus its final token when it carries
//     the identity ("8" for "CAMC 8", "Main 8" for "G Main
//     (8)") — the old rule only fired for names containing
//     " - ", which is why "CAMC 8" had no short form and
//     bare-name text matched nothing at all.
//  4. Glue is never a phrase: "5* or 5**=…" left the bare
//     word "or" as 5*'s label, pricing nothing.
//  5. A spaced slash is a list joiner, not a sentence
//     break: a names-only clause before " / " is held as the
//     head of the next clause's list.
//  6. A glue-joined list shares its read wherever the
//     slicing put it ("$2,500 for 5* and 5**" — the amount
//     precedes both names and lands on the first).
//  7. A numeric code's digits fold back into an hour phrase
//     ("8-hour shift" — the code mention consumed the "8").
//  8. Mentions ending at a protected decimal are number
//     fragments, not names ("paid for 8.5 hours").
//  9. THE NET (the confusion budget, mechanically, for ANY
//     input): an assignment-shaped subject that looks like
//     a code and matches nothing known is named in
//     unanswered exactly as written — a fresh facility whose
//     codes the reader has never seen surfaces its subjects
//     instead of returning a bare hourly rate.
// 10. The AI merge is a union for the unanswered list too:
//     a name either reading left unresolved and neither
//     resolved is asked about; the old recompute iterated
//     only the caller's code list and filtered net names
//     out of the question entirely.
//
// Run: node test-v128-universal-reader.js
// Initial-failure count: CRNAHUB_TREE=<v127 tree> node test-v128-universal-reader.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = (process.env.CRNAHUB_TREE || __dirname) + path.sep;
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

const FAC0 = (id, name) => ({ id, name, aliases: '', address: '', hourlyRate: '', paidHours8: '', paidHours10: '', paidHours12: '', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', callBonus: '', hourlyCall1st: '', weekendDays: null, ratesSource: '', codeMap: {} });
const HOLZ_TYPES = { 'HOLZ - G Main (8)': '8-hour day', 'HOLZ - Call 1': '24-hour call', 'HOLZ - Call 2': 'Second call', 'HOLZ - G Main (10)': '10-hour shift', 'HOLZ - PCDO': 'HOLZ - PCDO' };
const SH = (facName, facId, i, code, date) => ({ id: 's' + i, date: date || '2026-12-01', facility: facName, facilityId: facId, type: HOLZ_TYPES[code] || code, code, pay: '', payRate: '', payUnit: '', status: 'confirmed', source: 'test', sources: ['test'], incomplete: true, note: '', updatedAt: null });

const CALEB_A = '$250/hr\n8s or 8=8hr shifts\n10s or 10=10hr shifts\n5* or 5**=10hr shifts\n12s or 12=12hr shifts';
const CALEB_B = '$250/hr\n8s or 8=8hr shifts\n10s or 10=10hr shifts\n5* or 5**=10hr shifts\n12s or 12s=12hr shifts';
const CAMC5 = ['8', '10', '5*', '5**', '12'];
const CAMC_PRICES = { '8': 2000, '10': 2500, '5*': 2500, '5**': 2500, '12': 3000 };
const HOLZ5 = ['HOLZ - G Main (8)', 'HOLZ - Call 1', 'HOLZ - Call 2', 'HOLZ - G Main (10)', 'HOLZ - PCDO'];
const HOLZ_RATES = { hourlyRate: 250, rate24: 4800, weekendRate24: 4200, rateSecond: 3000, weekendRateSecond: 2000 };
const HOLZ_RATES_MINUS_HOURLY = { rate24: 4800, weekendRate24: 4200, rateSecond: 3000, weekendRateSecond: 2000 };
const HOLZ_TEXT = 'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours\nHolz-call 1=24hr call. Weekday=$4,800 weekend $4,200\nHolz-call 2=2nd call weekday=$3,000 weekend $2,000\nHolz-g main (10)=10hour day shift\nHolz PCDO=post call day off=no pay\nWeekends only include Saturday and Sunday.';

const CASES = [
  // ---- CAMC: Caleb's rules in many phrasings ----
  { id: 'C1 caleb text A (the live bug, verbatim)', fac: ['camc', 'CAMC'], codes: CAMC5, text: CALEB_A, defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true, rates: { hourlyRate: 250 } },
  { id: 'C2 caleb text B ("12s or 12s" variant)', fac: ['camc', 'CAMC'], codes: CAMC5, text: CALEB_B, defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C3 "and" list (v122 control)', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250/hour\n8=8hr shifts\n10=10hr shifts\n5* and 5**=10hr shifts\n12=12 hr shifts', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C4 comma list', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250/hr\n8 = 8hr shifts, 10 = 10hr shifts\n5*, 5** = 10hr shifts\n12 = 12hr shifts', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C5 ampersand + "are"', fac: ['camc', 'CAMC'], codes: CAMC5, text: 'Day shifts are $250/hr\n8 is an 8 hour shift\n10 is a 10 hour shift\n5* & 5** are 10 hour shifts\n12 is a 12 hour shift', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C6 "means / mean"', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250 per hour\n8 means an 8hr shift\n10 means a 10hr shift\n5* and 5** mean 10hr shifts\n12 means a 12hr shift', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C7 slash, unspaced', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250/hr\n8=8hr shifts\n10=10hr shifts\n5*/5**=10hr shifts\n12=12hr shifts', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C8 slash, spaced (list joiner, not a sentence break)', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250/hr\n8=8hr shifts\n10=10hr shifts\n5* / 5** = 10hr shifts\n12=12hr shifts', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C9 amounts before the codes (flat $ for a code / a list)', fac: ['camc', 'CAMC'], codes: CAMC5, text: 'Day shifts pay $250/hr\n$2,000 for an 8\n$2,500 for a 10\n$2,500 for 5* and 5**\n$3,000 for a 12', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C10 one-line run-on', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250/hr. 8=8hr shifts. 10=10hr shifts. 5* or 5**=10hr shifts. 12=12hr shifts.', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C11 rate line last (mixed order)', fac: ['camc', 'CAMC'], codes: CAMC5, text: '8=8hr shifts\n10=10hr shifts\n5* or 5**=10hr shifts\n12=12hr shifts\nDay shifts pay $250/hr', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C12 plurals as the only names, with "are"', fac: ['camc', 'CAMC'], codes: ['8', '10', '5**', '12'], text: '$250/hr\n8s are 8hr shifts\n10s are 10hr shifts\n5**s are 10hr shifts\n12s are 12hr shifts', defs: ['8', '10', '5**', '12'], prices: { '8': 2000, '10': 2500, '5**': 2500, '12': 3000 }, unansweredEmpty: true },
  { id: 'C13 light unit typos ("housr", "shfits")', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250/hr\n8=8 housr shifts\n10=10hr shfits\n5* or 5**=10hr shifts\n12=12hr shifts', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C14 SURFACE: a code the app has never seen is named, not dropped', fac: ['camc', 'CAMC'], codes: ['8', '10'], text: '$250/hr\n8=8hr shifts\nZZ9=9hr shifts\n10=10hr shifts', defs: ['8', '10'], prices: { '8': 2000, '10': 2500 }, unansweredHas: ['ZZ9'] },
  { id: 'C15 SURFACE: empty universe — every subject named in "still don\'t know", nothing fabricated', fac: ['camc', 'CAMC'], codes: [], text: CALEB_A, defs: [], unansweredHas: ['8', '10', '5*', '12'], noDefs: true },
  { id: 'C16 prefixed codes on the schedule, bare names in the text', fac: ['camc', 'CAMC'], codes: ['CAMC 8', 'CAMC 10', 'CAMC 5*', 'CAMC 5**', 'CAMC 12'], text: CALEB_A, defs: ['CAMC 8', 'CAMC 10', 'CAMC 5*', 'CAMC 5**', 'CAMC 12'], prices: { 'CAMC 8': 2000, 'CAMC 10': 2500, 'CAMC 5*': 2500, 'CAMC 5**': 2500, 'CAMC 12': 3000 }, unansweredEmpty: true },
  { id: 'C17 both spellings on the schedule at once', fac: ['camc', 'CAMC'], codes: ['8s', '8', '10s', '10', '5*', '5**', '12s', '12'], text: CALEB_A, defs: ['8s', '8', '10s', '10', '5*', '5**', '12s', '12'], prices: { '8s': 2000, '8': 2000, '10s': 2500, '10': 2500, '5*': 2500, '5**': 2500, '12s': 3000, '12': 3000 }, unansweredEmpty: true },
  { id: 'C18 "is $X a shift" flats', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250/hr\n8 is $2,000 a shift\n10 is $2,500 a shift\n5* is $2,500 a shift\n5** is $2,500 a shift\n12 is $3,000 a shift', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C19 colon assignments', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250/hr\n8: 8hr shifts\n10: 10hr shifts\n5* and 5**: 10hr shifts\n12: 12hr shifts', defs: CAMC5, prices: CAMC_PRICES, unansweredEmpty: true },
  { id: 'C20 bare "250/hr" (no $)', fac: ['camc', 'CAMC'], codes: CAMC5, text: '250/hr\n8=8hr shifts\n10=10hr shifts\n5* or 5**=10hr shifts\n12=12hr shifts', defs: CAMC5, prices: CAMC_PRICES, rates: { hourlyRate: 250 }, unansweredEmpty: true },
  { id: 'C21 "$250 hourly"', fac: ['camc', 'CAMC'], codes: CAMC5, text: '$250 hourly\n8=8hr shifts\n10=10hr shifts\n5* or 5**=10hr shifts\n12=12hr shifts', defs: CAMC5, prices: CAMC_PRICES, rates: { hourlyRate: 250 }, unansweredEmpty: true },
  // ---- HOLZ: Caleb's Holzer rules in many phrasings ----
  { id: 'H1 baseline fixture (control)', fac: ['holz', 'HOLZ'], codes: HOLZ5, text: HOLZ_TEXT, defs: HOLZ5, rates: HOLZ_RATES, facPays: { d8: 2125, c1w: 4800, c1e: 4200, c2w: 3000, c2e: 2000 }, pcdoUnpaid: true, weekendStated: true, unansweredEmpty: true },
  { id: 'H2 slash-separated run-on', fac: ['holz', 'HOLZ'], codes: HOLZ5, text: 'Holz-g main (8) = 8hr day shift, $250/hr, paid for 8.5 hours / Holz-call 1 = 24hr call, weekday $4,800, weekend $4,200 / Holz-call 2 = 2nd call, weekday $3,000, weekend $2,000 / Holz-g main (10) = 10hour day shift / Holz PCDO = post call day off, no pay / Weekends only include Saturday and Sunday', defs: HOLZ5, rates: HOLZ_RATES, facPays: { c1w: 4800, c1e: 4200, c2w: 3000, c2e: 2000 }, pcdoUnpaid: true, weekendStated: true, unansweredEmpty: true },
  { id: 'H3 call amounts on the lines after the name', fac: ['holz', 'HOLZ'], codes: HOLZ5, text: '$250/hr\nCall 1:\n$4,800 weekdays\n$4,200 weekends\nCall 2:\n$3,000 weekdays\n$2,000 weekends\nG Main (8) is an 8hr day shift paid for 8.5 hours\nG Main (10) is a 10hour day shift\nPCDO is a post call day off, no pay', defs: HOLZ5, rates: HOLZ_RATES, pcdoUnpaid: true, unansweredEmpty: true },
  { id: 'H4 amounts before the names', fac: ['holz', 'HOLZ'], codes: HOLZ5, text: '$4,800 weekdays, $4,200 weekends for Call 1\n$3,000 weekdays, $2,000 weekends for Call 2\n$250/hr for day shifts\nG Main (8) is an 8hr day shift paid for 8.5 hours\nG Main (10) is a 10hour day shift\nPCDO is a post call day off with no pay', defs: HOLZ5, rates: HOLZ_RATES, pcdoUnpaid: true, unansweredEmpty: true },
  { id: 'H5 "pays" + "$250 an hour"', fac: ['holz', 'HOLZ'], codes: HOLZ5, text: 'Day shifts pay $250 an hour\nMain (8) is an 8 hour day shift, paid for 8.5 hours\nCall 1 pays $4,800 on weekdays and $4,200 on weekends\nCall 2 pays $3,000 on weekdays and $2,000 on weekends\nPCDO means post call day off — no pay', defs: HOLZ5, rates: HOLZ_RATES, pcdoUnpaid: true, unansweredEmpty: true },
  { id: 'H6 hyphenated + spaced code names, comma-less amounts', fac: ['holz', 'HOLZ'], codes: ['HOLZ - Call 1', 'HOLZ - Call 2', 'HOLZ - G Main (8)'], text: 'holzer call-1: 24 hour call, $4800 weekdays, $4200 weekends\nholzer call 2: 2nd call, $3000 weekdays, $2000 weekends\nholzer main 8: 8hr day shift at 250/hr, paid 8.5 hrs', defs: ['HOLZ - Call 1', 'HOLZ - Call 2', 'HOLZ - G Main (8)'], rates: HOLZ_RATES, unansweredEmpty: true },
  { id: 'H7 weekend stated as "Sat and Sun"', fac: ['holz', 'HOLZ'], codes: ['HOLZ - Call 1'], text: 'Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200\nWeekend is Sat and Sun', defs: ['HOLZ - Call 1'], rates: { rate24: 4800, weekendRate24: 4200 }, weekendStated: true, unansweredEmpty: true },
  { id: 'H8 contract prose: "First call (24 hour) pays…" — synonyms name the codes, thousands commas are not code mentions', fac: ['holz', 'HOLZ'], codes: ['HOLZ - Call 1', 'HOLZ - Call 2'], text: 'First call (24 hour) pays $4,800 on weekdays and $4,200 on weekends. Second call pays $3,000 weekdays, $2,000 weekends.', defs: ['HOLZ - Call 1', 'HOLZ - Call 2'], rates: HOLZ_RATES_MINUS_HOURLY, unansweredEmpty: true },
];

function runCase(c) {
  const fac = FAC0(c.fac[0], c.fac[1]);
  const shifts = c.codes.map((code, i) => SH(c.fac[1], c.fac[0], i, code));
  run(`db = empty(); db.facilities = [${J(fac)}]; db.shifts = ${J(shifts)}; persist();`);
  return JSON.parse(run(`(() => { const fac = db.facilities[0];
    const parsed = describeParseLocal(${J(c.text)}, fac, facilityDescribeCodes(fac));
    applyDescribedRules(fac, parsed); healUnpricedShiftPays();
    const pays = {}; for (const s of db.shifts) { if (!(s.code in pays)) pays[s.code] = String(s.pay); }
    return JSON.stringify({ defs: Object.keys(parsed.defs || {}), unanswered: parsed.unanswered || [], rates: parsed.rates || {}, pays,
      weekendDays: parsed.weekendDays || null, weekendStated: !!parsed.weekendStated,
      summary: describeSummaryText(fac.name, parsed, fac),
      pcdoUnpaid: !!((parsed.defs || {})['HOLZ - PCDO'] && (parsed.defs || {})['HOLZ - PCDO'].unpaid),
      facPays: { d8: facilityPayFor(fac, '8-hour day', '2026-12-01'), c1w: facilityPayFor(fac, '24-hour call', '2026-12-01'), c1e: facilityPayFor(fac, '24-hour call', '2026-12-05'), c2w: facilityPayFor(fac, 'Second call', '2026-12-01'), c2e: facilityPayFor(fac, 'Second call', '2026-12-05') } });
  })()`));
}

function checkCase(c) {
  let out;
  try { out = runCase(c); } catch (e) { t(c.id, false, 'THREW: ' + (e && e.message)); return; }
  const bad = [];
  for (const d of (c.defs || [])) if (!out.defs.includes(d)) bad.push('missing def ' + d);
  if (c.noDefs && out.defs.length) bad.push('fabricated defs ' + J(out.defs));
  if (c.unansweredEmpty && out.unanswered.length) bad.push('unanswered ' + J(out.unanswered));
  for (const u of (c.unansweredHas || [])) if (!out.unanswered.some(x => String(x).includes(u))) bad.push('not surfaced: ' + u + ' (unanswered=' + J(out.unanswered) + ')');
  for (const [k, v] of Object.entries(c.rates || {})) if (Number(out.rates[k]) !== v) bad.push('rate ' + k + '=' + out.rates[k] + ' want ' + v);
  for (const [k, v] of Object.entries(c.prices || {})) if (Number(out.pays[k]) !== v) bad.push('price ' + k + '=' + out.pays[k] + ' want ' + v);
  for (const [k, v] of Object.entries(c.facPays || {})) if (Number(out.facPays[k]) !== v) bad.push('facPay ' + k + '=' + out.facPays[k] + ' want ' + v);
  if (c.pcdoUnpaid && !out.pcdoUnpaid) bad.push('PCDO not unpaid');
  if (c.weekendStated && !(out.weekendStated === true && J(out.weekendDays) === '[0,6]')) bad.push('weekend not stated [0,6]: stated=' + out.weekendStated + ' ' + J(out.weekendDays));
  t(c.id, bad.length === 0, bad.join('; ') || undefined);
  return out;
}

(async () => {
  for (const c of CASES) checkCase(c);

  // ---- The pinned save, end to end through the real card path ----
  {
    const fac = FAC0('camc', 'CAMC');
    const shifts = CAMC5.map((code, i) => SH('CAMC', 'camc', i, code));
    run(`db = empty(); db.facilities = [${J(fac)}]; db.shifts = ${J(shifts)}; db.payStubs = []; persist();`);
    run(`cloudSession = { user: { id: 't' }, access_token: 'x' };`);
    run(`liveSyncPost = async function () { return { rule: {} }; };`);
    run(`(() => { const fac = db.facilities[0];
      describeStates['fac:camc'] = { text: ${J(CALEB_A)}, parsed: null, error: '', busy: false, confirmed: false,
        ctx: { fac, facName: 'CAMC', codes: facilityDescribeCodes(fac) } }; })()`);
    await run(`submitDescribe('fac:camc')`);
    const p = run(`describeStates['fac:camc'].parsed`);
    t('P1: card-path parse of Caleb\'s text resolves all five codes (AI in the loop, empty read)', !!p && CAMC5.every(c => !!p.defs[c]) && p.unanswered.length === 0, J(p && { defs: Object.keys(p.defs), unanswered: p.unanswered }));
    const s = run(`describeSummaryText('CAMC', describeStates['fac:camc'].parsed, db.facilities[0])`);
    t('P2: read-back names every code with its price', CAMC5.every(c => s.includes('“' + c + '”')) && s.includes('$2,000') && s.includes('$2,500') && s.includes('$3,000'), s);
    run(`confirmDescribe('fac:camc')`);
    run(`healUnpricedShiftPays()`);
    const saved = run(`Object.keys(facilityCodeDefs(db.facilities[0]))`);
    t('P3: SAVED code map contains every named code', CAMC5.every(c => saved.includes(c)), J(saved));
    const pays = {}; for (const sh of run(`db.shifts`)) pays[sh.code] = Number(sh.pay);
    t('P4: saved CAMC shifts price per code (8 $2,000 · 10/5*/5** $2,500 · 12 $3,000)', CAMC5.every(c => pays[c] === CAMC_PRICES[c]), J(pays));
  }

  // ---- AI-merge union (both directions + the unanswered list) ----
  {
    const fac = FAC0('camc', 'CAMC');
    const shifts = [SH('CAMC', 'camc', 0, '8')];
    run(`db = empty(); db.facilities = [${J(fac)}]; db.shifts = ${J(shifts)}; db.payStubs = []; persist();`);
    run(`cloudSession = { user: { id: 't' }, access_token: 'x' };`);
    // U2: a name NEITHER reading can attach to a known code
    // must survive the merge as a question (the old recompute
    // filtered the question down to the caller's code list).
    run(`liveSyncPost = async function () { return { rule: {} }; };`);
    run(`(() => { const fac = db.facilities[0];
      describeStates['fac:u2'] = { text: '$250/hr\\n8=8hr shifts\\nQQ7=7hr shifts', parsed: null, error: '', busy: false, confirmed: false,
        ctx: { fac, facName: 'CAMC', codes: facilityDescribeCodes(fac) } }; })()`);
    await run(`submitDescribe('fac:u2')`);
    const p2 = run(`describeStates['fac:u2'].parsed`);
    t('U2: unknown code named in the text survives the AI merge as "still don\'t know"', !!p2 && p2.unanswered.some(u => String(u).includes('QQ7')) && !!(p2.defs || {})['8'], J(p2 && p2.unanswered));
    // U3: rates union — a rate only the local parse found and
    // a rate only the AI read found BOTH survive.
    run(`(() => { const fac = db.facilities[0];
      describeStates['fac:u3'] = { text: 'Call 2 is $3,000 on weekdays and $2,000 on weekends', parsed: null, error: '', busy: false, confirmed: false,
        ctx: { fac, facName: 'CAMC', codes: [{ code: 'HOLZ - Call 2', ctype: 'Second call' }] } }; })()`);
    run(`liveSyncPost = async function () { return { rule: { shift_type: '24-hour call', flat_rate: 4800, weekend_flat_rate: 4200, hourly_rate: 250 } }; };`);
    await run(`submitDescribe('fac:u3')`);
    const p3 = run(`describeStates['fac:u3'].parsed`);
    t('U3: rate union — local Call 2 rates AND AI Call 1 rates both survive', !!p3 && Number(p3.rates.rateSecond) === 3000 && Number(p3.rates.weekendRateSecond) === 2000 && Number(p3.rates.rate24) === 4800 && Number(p3.rates.weekendRate24) === 4200, J(p3 && p3.rates));
  }

  t('sw: cache bumped to v129', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v139'));
  console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL PASS');
})().catch(e => { console.log('ERROR', e && e.stack || e); process.exitCode = 1; });
