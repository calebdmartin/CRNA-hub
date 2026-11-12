'use strict';
// SIMULATED USER P3 — "Dana Whitfield", grid-schedule user.
// Standing simulated-user pass (approved by Caleb Nov 11, 2026).
// Run directly or via test-sim-run-all.js. See
// hidden_files/simulated-user-pass.md.
//
// NEUTRALITY: every fixture in this file is Dana's own — a
// different facility, codes, rates, weekend definition and name
// from every other fixture in the suite (self-checked below).
// Nothing here knows any other user's data; her Friday-inclusive
// weekend is the proof: her C24 on a Friday prices the WEEKEND
// rate because HER card says weekends are Friday-Sunday.
//
// JOURNEY: no facility exists -> she uploads a photo of a paper
// GRID schedule (the AI read is supplied in the extract-contract
// "schedule" mode's own shape, the way the deployed reader
// returns it — codes verbatim, other people's rows present) ->
// preview shows only her row -> she answers the facility
// question -> approve creates Harborview Medical Center and
// saves her 5 shifts UNPRICED -> she sets the pay rules in her
// own words through the production AI-primary read (the deployed
// "rules" mode, stubbed here in its own answer shape with
// verbatim-quote traceability, behind a signed-in session — the
// v133 pattern) -> confirm reprices everything -> the saved
// rules round-trip through the describe prefill.
//
// HAND MATH — Harborview, $210/hr:
//   D6 $210 x 6 = $1,260 · E8 $210 x 8 = $1,680 ·
//   E8X (same as E8) $1,680 · N12 $210 x 12 = $2,520 ·
//   C24 weekday $5,250 / weekend $4,725.
//   Grid week Jun 1-5, 2027: Tue Jun 1 D6 1260 · Wed Jun 2 E8
//   1680 · Thu Jun 3 E8X 1680 · Fri Jun 4 C24 4725 (Friday is
//   HER weekend) · Sat Jun 5 N12 2520. Total $11,865.
// (The deterministic fallback reader's handling of these same
// words is pinned separately in test-sim-found-bugs.js FB2.)
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) { return { id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [], dataset: {}, style: {}, _listeners: {}, _entries: null, addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }, append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [] }; }
const elements = {}; const getEl = (id) => elements[id] || (elements[id] = el(id));
class FakeFormData { constructor(f) { this._map = (f && f._map) || {}; this._e = (f && f._entries) || []; } get(k) { return k in this._map ? this._map[k] : null; } *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; } }
const sandbox = { console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math, crypto: require('crypto').webcrypto, FormData: FakeFormData, localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }, document: { getElementById: (id) => getEl(id), querySelectorAll: () => [], createElement: () => el(), body: { append() {} }, addEventListener() {} }, window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' }, alert: () => {}, confirm: () => true, fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }), history: { replaceState() {} } };
sandbox.window = sandbox; sandbox.window.scrollTo = () => {};
if (typeof sandbox.URL.createObjectURL !== 'function') Object.assign(sandbox.URL, { createObjectURL: () => 'data:,', revokeObjectURL: () => {} });
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra)); if (!cond) { fails++; process.exitCode = 1; } };
const J = (v) => JSON.stringify(v);
const Q = (value, quote) => ({ value, quote });

const HW_WORDS = [
  'Day shifts pay $210/hr',
  'D6 = a 6-hour shift',
  'E8 is an 8-hour shift',
  'N12 is a 12-hour night shift',
  'C24 = 24-hour call. It pays $5,250 on weekdays and $4,725 on weekends',
  'E8X is the same as E8',
  'Weekends here are Friday, Saturday and Sunday',
].join('\n');
// The deployed rules-mode read of HW_WORDS, in the function's
// own answer shape (type vocabulary per its prompt; a 6-hour
// shift is none of the named types, so type null + hours 6).
// Every quote is a verbatim substring of HW_WORDS carrying its
// figure — the client's traceability check demands exactly that.
const READ_HW = {
  hourly_rate: Q(210, 'Day shifts pay $210/hr'),
  paid_hours_8: null, paid_hours_by_length: [], first_call_hourly_rate: null, call_bonus: null,
  weekend: { days: ['Friday', 'Saturday', 'Sunday'], stated: true, quote: 'Weekends here are Friday, Saturday and Sunday' },
  codes: [
    { code: 'D6', label: 'a 6-hour shift', type: null, hours: 6, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: 'D6 = a 6-hour shift' },
    { code: 'E8', label: 'an 8-hour shift', type: '8-hour day', hours: 8, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: 'E8 is an 8-hour shift' },
    { code: 'N12', label: 'a 12-hour night shift', type: '12-hour shift', hours: 12, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: 'N12 is a 12-hour night shift' },
    { code: 'C24', label: '24-hour call', type: '24-hour call', hours: 24, paid_hours: null, weekday_pay: Q(5250, 'It pays $5,250 on weekdays'), weekend_pay: Q(4725, '$4,725 on weekends'), unpaid: false, quote: 'C24 = 24-hour call. It pays $5,250 on weekdays and $4,725 on weekends' },
    { code: 'E8X', label: 'the same as E8', type: '8-hour day', hours: 8, paid_hours: null, weekday_pay: null, weekend_pay: null, unpaid: false, quote: 'E8X is the same as E8' },
  ],
  unknown: [], clarifying_question: null,
};
const GRID = { ok: true, mode: 'schedule', shifts: [
  { date: '2027-06-01', facility: '', type: 'D6', code: 'D6', name: 'Whitfield', pay: '' },
  { date: '2027-06-02', facility: '', type: 'E8', code: 'E8', name: 'Whitfield', pay: '' },
  { date: '2027-06-03', facility: '', type: 'E8X', code: 'E8X', name: 'Whitfield', pay: '' },
  { date: '2027-06-04', facility: '', type: 'C24', code: 'C24', name: 'Whitfield', pay: '' },
  { date: '2027-06-05', facility: '', type: 'N12', code: 'N12', name: 'Whitfield', pay: '' },
  { date: '2027-06-02', facility: '', type: 'E8', code: 'E8', name: 'Osei', pay: '' },
], raw_text: 'grid' };

t('P3 neutrality: no other user\'s names, facilities, agencies or signature rates anywhere in these fixtures',
  !/holzer|camc|martin|premier|northstar/i.test(HW_WORDS + J(GRID) + J(READ_HW)) &&
  !/\$250\/hr|\$2,125|\$4,800/.test(HW_WORDS));

/* ================= Grid upload: preview before save ============= */
run(`db = empty(); db.settings.scheduleName = 'Whitfield'; db.settings.employmentType = '1099'; db.facilities = []; db.shifts = []; db.payStubs = []; persist();`);
run(`globalThis.__ok = applyAiToSchedulePreview(${J(GRID)}, 'harborview-grid.jpg');`);
t('P3 grid: the read previews 6 rows — her 5 matched, the other person\'s row marked other',
  run(`__ok`) === true && run(`schedulePreview.rows.length`) === 6 &&
  run(`schedulePreview.rows.filter(r => r.match === 'matched').length`) === 5 &&
  run(`schedulePreview.rows.filter(r => r.match === 'other').length`) === 1);
t('P3 grid: preview-before-save — nothing is in the app yet, no facility exists',
  run(`db.shifts.length`) === 0 && run(`db.facilities.length`) === 0);
run(`schedulePreview.facilityAll = 'Harborview Medical Center'; approveScheduleImport();`);
t('P3 grid: approve saves exactly her 5 shifts (the Osei row stays out), confirmed, codes verbatim',
  run(`db.shifts.length`) === 5 && run(`db.shifts.every(x => x.status === 'confirmed')`) === true &&
  run(`db.shifts.map(x => x.code).join(',')`) === 'D6,E8,E8X,C24,N12',
  run(`db.shifts.map(x => x.code).join(',')`));
t('P3 grid: the facility question created Harborview; grid codes save UNPRICED until rules exist',
  run(`db.facilities.length`) === 1 && run(`db.facilities[0].name`) === 'Harborview Medical Center' &&
  run(`db.shifts.every(x => x.pay === '' && x.incomplete === true)`) === true);

/* ================= Her words, through the AI-primary read ======= */
(async () => {
  run(`cloudSession = { access_token: 'x', email: 'dana@example.com' }; window.__aiModes = [];
    liveSyncPost = async function (name, body) { window.__aiModes.push(body && body.mode); if (body && body.mode === 'rules') return { ok: true, mode: 'rules', read: ${J(READ_HW)} }; throw new Error('unexpected mode'); };`);
  run(`describeStates = {}; describeOpenFac = db.facilities[0].id; { const st = describeState('fac:' + db.facilities[0].id); st.text = ${J(HW_WORDS)}; }`);
  await run(`submitDescribe('fac:' + db.facilities[0].id)`);
  t('P3 words: the AI-primary read ran (mode "rules") and resolved EVERYTHING — no unknowns, no basic-read fallback',
    J(run(`window.__aiModes`)) === '["rules"]' &&
    run(`describeState('fac:' + db.facilities[0].id).parsed.unanswered.length`) === 0 &&
    !run(`describeState('fac:' + db.facilities[0].id).parsed.aiBasic`),
    J(run(`describeState('fac:' + db.facilities[0].id).parsed.unanswered`)));
  const summary = run(`describeSummaryText('Harborview Medical Center', describeState('fac:' + db.facilities[0].id).parsed, db.facilities[0])`);
  t('P3 words: read-back states all five codes, the call split, and HER Friday-inclusive weekend',
    summary.includes('$210/hr × 8 paid hours = $1,680') && summary.includes('$5,250 on weekdays, $4,725 on weekends') &&
    summary.includes('Weekend means Friday and Saturday and Sunday') && summary.includes('D6'), summary);
  run(`confirmDescribe('fac:' + db.facilities[0].id)`);
  t('P3 save: all five definitions on the card; weekend saved as STATED [Fri, Sat, Sun]',
    J(run(`Object.keys(db.facilities[0].codeMap).sort()`)) === '["C24","D6","E8","E8X","N12"]' &&
    J(run(`db.facilities[0].weekendDays`)) === '[0,5,6]' && run(`db.facilities[0].weekendDaysSource`) === 'stated',
    J(run(`db.facilities[0].codeMap`)));
  const EXPECTED = { '2027-06-01': '1260', '2027-06-02': '1680', '2027-06-03': '1680', '2027-06-04': '4725', '2027-06-05': '2520' };
  t('P3 pricing: every imported shift reprices to the hand figure — Friday C24 at the WEEKEND rate',
    run(`db.shifts.every(x => String(x.pay) === ${J(EXPECTED)}[x.date] && x.incomplete === false)`) === true &&
    run(`db.shifts.reduce((a, x) => a + num(x.pay), 0)`) === 11865,
    run(`db.shifts.map(x => x.date + '=' + x.pay).join(' ')`));
  t('P3 headline: June expected gross is the hand total $11,865',
    run(`monthHeadline('2027-06').gross`) === 11865, J(run(`monthHeadline('2027-06')`)));

  /* ================= The describe-words round trip ============== */
  run(`function pricingFields(defs){ const o = {}; for (const k of Object.keys(defs || {}).sort()) { const d = defs[k] || {}; o[k] = { hours: d.hours || null, canonicalType: d.canonicalType || null, unpaid: !!d.unpaid }; } return o; }`);
  const rt = run(`(function(){ const A = db.facilities[0]; const B = JSON.parse(JSON.stringify(A)); B.id = 'hw2'; B.codeMap = {}; db.facilities = [B];
    const text = describePrefillText(A, facilityDescribeCodes(A));
    const parsed = describeParseLocal(text, B, facilityDescribeCodes(B)); applyDescribedRules(B, parsed);
    return { a: pricingFields(facilityCodeDefs(A)), b: pricingFields(facilityCodeDefs(B)), text, weekendB: B.weekendDays, hourlyB: B.hourlyRate }; })()`);
  t('P3 round trip: the prefill voices every saved rule as its own sentence (5 codes, weekend, hourly)',
    ['Day shifts pay $210/hr.', 'D6 is a 6-hour shift.', 'E8 is an 8-hour shift.', 'N12 is a 12-hour shift.', 'E8X is an 8-hour shift.', 'Weekend is Friday and Saturday and Sunday.'].every(s => rt.text.includes(s)), rt.text);
  t('P3 round trip: re-parsing the prefill reproduces E8 / E8X / N12 definitions field for field',
    ['E8', 'E8X', 'N12'].every(k => J(rt.a[k]) === J(rt.b[k])), J(rt.b));
  t('P3 round trip: weekend and hourly survive; C24 still prices at her Friday weekend rate off the card',
    J(rt.weekendB) === '[0,5,6]' && rt.hourlyB === '210' &&
    run(`(clarifiedRowPricing(db.facilities[0], { code:'C24', date:'2027-06-04' }) || {}).pay`) === '4725',
    J(rt.weekendB) + ' ' + rt.hourlyB);
  // D6's round-trip loss is a pinned found bug — see
  // test-sim-found-bugs.js FB2 (same root as the fallback gap).

  console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
})();
