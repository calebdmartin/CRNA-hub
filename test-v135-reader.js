// CRNA Hub — v135: the words reader on Caleb's live failure.
//
// Caleb's screenshot (Nov 11, 2026, ~7:00 PM ET, CAMC card):
//   "Day shifts pay $250/hr. 8s is an 8-hour shift. 8hr is
//    an 8-hour shift. 12s is a 12-hour shift. 10s is 10 hour
//    shift. 5* and 5** are 10 hour shifts"
// read back 8s/8hr/12s but declared 'I still don't know
// about: "10s", "5* and 5**"' — with an AI clarifying
// question attached, so the AI had answered and its
// readings for those codes never landed.
//
// Diagnosis (proven against the LIVE function, Nov 11):
// the deployed extract-contract v32 answers this text
// PERFECTLY (all six codes, verbatim quotes, no unknowns)
// and the v134 merge resolves it in every context tried.
// The screenshot is reproduced byte-for-byte by the
// FALLBACK path: rules-mode failed on his phone (transient)
// and the weaker reader presented its partial read as the
// full read, silently. Three real defects, all fixed here:
//  A. Silent degradation — a failed AI read now retries
//     once, and a read that still falls back SAYS SO in the
//     panel ("basic read" line, parsed.aiBasic).
//  B. The deterministic reader could not bind two natural
//     shapes: article-less unhyphenated lengths ("10s is
//     10 hour shift") and plural-copula glue ("5* and 5**
//     are 10 hour shifts") for codes outside the known
//     universe. It now binds stated lengths for named
//     subjects (copula sweep + a global statement scan),
//     splits glued subjects everywhere (defs, coverage,
//     unknown naming), and drops facility-name fragments.
//  C. Glued AI candidates ("5* and 5**" as one string)
//     survived coverage as phantom unknowns even when the
//     AI had resolved both codes — coverage now splits
//     candidates and folds plural twins ("8s" ~ "8").
//  Also: a code whose name IS a duration spelling ("8HR")
//  no longer steals the previous code's definition in the
//  block reader (duration-mention drop), "$250 an hour" no
//  longer donates a $250 flat to the first code's chunk,
//  and the label-first hourly form ("The hourly is $250")
//  reads as a last-resort fallback in contract extraction.
//  Pinned boundaries (deliberate, asserted below): on a
//  code-less surface, telegraphic "=" lists stay ask-first
//  (v128); a multi-word name fragment ("Holz-g main (8")
//  is NAMED, never defined (v125); run-on prose with no
//  sentence breaks and spelled-out numbers are AI-path
//  shapes — the local reader must still NAME their codes,
//  never drop them silently.
//
// The AI-path corpus proof for paraphrases runs against
// the REAL deployed function (live harness, recorded in
// the round report); in this suite the AI path is pinned
// with the REAL captured v32 response for the fixture and
// hand-written stubs for the merge mechanics.
// Run: node test-v135-reader.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) { return { id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [], dataset: {}, style: {}, _listeners: {}, _entries: null, addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }, append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [] }; }
const elements = {};
const getEl = (id) => elements[id] || (elements[id] = el(id));
class FakeFormData { constructor(f) { this._e = (f && f._entries) || []; } *[Symbol.iterator]() { yield* this._e; } }
const sandbox = { console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math, crypto: require('crypto').webcrypto, FormData: FakeFormData, localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }, document: { getElementById: (id) => getEl(id), querySelectorAll: () => [], createElement: () => el(), body: { append() {} }, addEventListener() {} }, window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' }, alert: () => {}, confirm: () => true, fetch: async () => ({ status: 401, ok: false, text: async () => '{}', json: async () => ({}) }), history: { replaceState() {} } };
sandbox.window = sandbox; sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (c) => vm.runInContext(c, sandbox);
const J = (v) => JSON.stringify(v);
let pass = 0, fail = 0; const fails = [];
function t(name, cond, extra) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; fails.push(name); console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); } }

const FIXTURE = "Day shifts pay $250/hr. 8s is an 8-hour shift. 8hr is an 8-hour shift. 12s is a 12-hour shift. 10s is 10 hour shift. 5* and 5** are 10 hour shifts";
// The REAL response of the deployed extract-contract v32
// (mode "rules") for the fixture text, captured live from
// the project on Nov 11, 2026 — embedded verbatim.
const REAL_RESPONSE = {"ok": true, "mode": "rules", "read": {"hourly_rate": {"value": 250, "quote": "$250/hr"}, "paid_hours_8": null, "paid_hours_by_length": [], "first_call_hourly_rate": null, "call_bonus": null, "weekend": {"days": [], "stated": false, "quote": null}, "codes": [{"code": "8s", "label": "8-hour shift", "type": "8-hour day", "hours": 8, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "8s is an 8-hour shift."}, {"code": "8hr", "label": "8-hour shift", "type": "8-hour day", "hours": 8, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "8hr is an 8-hour shift."}, {"code": "12s", "label": "12-hour shift", "type": "12-hour shift", "hours": 12, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "12s is a 12-hour shift."}, {"code": "10s", "label": "10 hour shift", "type": "10-hour shift", "hours": 10, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "10s is 10 hour shift."}, {"code": "5*", "label": "10 hour shift", "type": "10-hour shift", "hours": 10, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "5* and 5** are 10 hour shifts."}, {"code": "5**", "label": "10 hour shift", "type": "10-hour shift", "hours": 10, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "5* and 5** are 10 hour shifts."}], "unknown": [], "clarifying_question": null}, "model": "gpt-4o-mini"};
const CAMC_DERIVED = { '8s': { hours: 8, label: '8-hour shift' }, '8hr': { hours: 8, label: '8-hour shift' }, '12s': { hours: 12, label: '12-hour shift' } };
const mkCamc = (card) => `db.facilities=[{id:'camc',name:'CAMC',aliases:'',hourlyRate:'250',codeMap:${J(card || {})}}];`;
const CTX_RICH = `{fac:db.facilities[0],codes:[{code:'5**',ctype:'10-hour shift',hours:10},{code:'5*',ctype:'10-hour shift',hours:10},{code:'7',ctype:'12-hour shift',hours:12},{code:'8s',ctype:'8-hour day',hours:8},{code:'8hr',ctype:'8-hour day',hours:8},{code:'12s',ctype:'12-hour shift',hours:12},{code:'10s',ctype:'10-hour shift',hours:10}],card:{hourlyRate:250}}`;
const CTX_DERIVED = `{fac:db.facilities[0],codes:[{code:'8s',ctype:'8-hour shift',hours:8},{code:'8hr',ctype:'8-hour shift',hours:8},{code:'12s',ctype:'12-hour shift',hours:12}],card:{hourlyRate:250}}`;
const CTX_EMPTY = `{fac:db.facilities[0],codes:[],card:{}}`;
const WANT_HOURS = { '8s': 8, '8hr': 8, '12s': 12, '10s': 10, '5*': 10, '5**': 10 };
const WANT_PRICE = { '8s': 2000, '8hr': 2000, '12s': 3000, '10s': 2500, '5*': 2500, '5**': 2500 };
function checkFixture(tag, merged) {
  const hours = {}; for (const k of Object.keys(merged.defs)) hours[k] = Number(merged.defs[k].hours);
  t(tag + ': all six codes resolved with their lengths',
    Object.keys(WANT_HOURS).every(k => hours[k] === WANT_HOURS[k]), J(hours));
  t(tag + ': unknown list EMPTY', merged.unanswered.length === 0, J(merged.unanswered));
  t(tag + ': hourly rate lands (length x hourly is the pricing model; end-to-end prices proven in G)',
    merged.rates.hourlyRate === 250, J(merged.rates));
}

(async () => {
  // ---------- (a) fixture, AI path, REAL captured response ----------
  for (const [tag, setup, ctx] of [
    ['A rich card', mkCamc({ '5**': { hours: 10, label: '10-hour shift' } }), CTX_RICH],
    ['A derived-only card (Caleb\u2019s live surface)', mkCamc(CAMC_DERIVED), CTX_DERIVED],
    ['A empty card', mkCamc({}), CTX_EMPTY]]) {
    run(setup + 'describeStates={};');
    run(`liveSyncPost=async()=>(${J(REAL_RESPONSE)});window.__ctx=${ctx};`);
    const merged = await run(`describeReadWithAI(${J(FIXTURE)}, window.__ctx, describeParseLocal(${J(FIXTURE)}, db.facilities[0], window.__ctx.codes))`);
    checkFixture(tag, merged);
  }

  // ---------- (b) fixture, FALLBACK path (rules down) ----------
  run(mkCamc(CAMC_DERIVED) + 'describeStates={};');
  run(`liveSyncPost=async(slug,body)=>{ if(body&&body.mode==='rules')throw new Error('down'); return {mode:'rule',rates:{},defs:{},question:'Does this rate apply on weekends?'} };`);
  const fbStatus = {};
  run(`window.__fbStatus={responded:false};`);
  const fb = await run(`describeReadWithAI(${J(FIXTURE)}, ${CTX_DERIVED}, describeParseLocal(${J(FIXTURE)}, db.facilities[0], []), window.__fbStatus)`);
  t('B fallback: AI down -> describeReadWithAI returns null (the caller falls back, loudly)',
    fb === null, J(fb));
  t('B fallback: the AI non-answer is RECORDED (status.responded false)',
    run(`window.__fbStatus.responded`) === false, J(run(`window.__fbStatus`)));
  // The panel line: submitDescribe on the facility card,
  // signed out (local path), carries aiBasic and SAYS SO.
  run(mkCamc(CAMC_DERIVED) + 'describeStates={};cloudSession={access_token:"x"};');
  run(`liveSyncPost=async(slug,body)=>{ if(body&&body.mode==='rules')throw new Error('down'); return {mode:'rule',rates:{},defs:{},question:'Does this rate apply on weekends?'} };`);
  await run(`(async()=>{ const st=describeState('fac:camc'); st.text=${J(FIXTURE)}; await submitDescribe('fac:camc'); })()`);
  const parsedB = run(`describeState('fac:camc').parsed`);
  t('B panel: parsed.aiBasic is set on a no-AI read', parsedB.aiBasic === true, J({ aiBasic: parsedB.aiBasic }));
  const htmlB = run(`describeRulesHTML('fac:camc')`);
  t('B panel: the read-back SAYS it is the basic read',
    htmlB.includes('basic read') && htmlB.includes('didn&#39;t answer') || htmlB.includes("basic read"),
    htmlB.slice(0, 300));
  t('B panel: the basic read still resolves all six codes',
    ['8s', '8hr', '12s', '10s', '5*', '5**'].every(c => parsedB.defs[c]), J(Object.keys(parsedB.defs)));
  t('B panel: nothing in "still don\u2019t know"', (parsedB.unanswered || []).length === 0, J(parsedB.unanswered));

  // ---------- (c) retry: rules fails once, then answers ----------
  run(mkCamc(CAMC_DERIVED) + 'describeStates={};');
  run(`window.__calls=0; liveSyncPost=async(slug,body)=>{ if(body&&body.mode==='rules'){ window.__calls++; if(window.__calls===1)throw new Error('flaky'); return ${J(REAL_RESPONSE)}; } return {mode:'rule',rates:{},defs:{},question:''}; };`);
  const rtStatus = {}; run(`window.__rtStatus=${J(rtStatus)};`);
  const rt = await run(`describeReadWithAI(${J(FIXTURE)}, ${CTX_DERIVED}, describeParseLocal(${J(FIXTURE)}, db.facilities[0], []), window.__rtStatus)`);
  t('C retry: the second rules call lands the AI read', run(`window.__calls`) === 2 && run(`window.__rtStatus.responded`) === true, J({ calls: run(`window.__calls`), st: run(`window.__rtStatus`) }));
  checkFixture('C retry', rt);

  // ---------- (d) glued AI entry splits into per-code defs ----------
  run(mkCamc({}) + 'describeStates={};');
  const GLUE_AI = {"ok": true, "mode": "rules", "read": {"hourly_rate": {"value": 250, "quote": "Day shifts pay $250/hr"}, "paid_hours_8": null, "paid_hours_by_length": [], "first_call_hourly_rate": null, "call_bonus": null, "weekend": {"days": [], "stated": false, "quote": null}, "codes": [{"code": "5* and 5**", "label": "10 hour shift", "type": "10-hour shift", "hours": 10, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "5* and 5** are 10 hour shifts"}], "unknown": [], "clarifying_question": null}};
  run(`liveSyncPost=async()=>(${J(GLUE_AI)});`);
  const gm = await run(`describeReadWithAI(${J(FIXTURE)}, ${CTX_EMPTY}, describeParseLocal(${J(FIXTURE)}, db.facilities[0], []))`);
  t('D glue: one glued AI entry becomes TWO defs (5* and 5**)',
    gm.defs['5*'] && gm.defs['5**'] && Number(gm.defs['5*'].hours) === 10 && Number(gm.defs['5**'].hours) === 10,
    J(Object.keys(gm.defs)));
  t('D glue: the glued name itself is never a def key', !gm.defs['5* and 5**'], J(Object.keys(gm.defs)));

  // ---------- (e) glued AI unknowns split in coverage ----------
  run(mkCamc({}) + 'describeStates={};');
  const UNK_AI = {"ok": true, "mode": "rules", "read": {"hourly_rate": {"value": 250, "quote": "$250/hr"}, "paid_hours_8": null, "paid_hours_by_length": [], "first_call_hourly_rate": null, "call_bonus": null, "weekend": {"days": [], "stated": false, "quote": null}, "codes": [{"code": "8s", "label": "8-hour shift", "type": "8-hour day", "hours": 8, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "8s is an 8-hour shift."}, {"code": "8hr", "label": "8-hour shift", "type": "8-hour day", "hours": 8, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "8hr is an 8-hour shift."}, {"code": "12s", "label": "12-hour shift", "type": "12-hour shift", "hours": 12, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "12s is a 12-hour shift."}, {"code": "10s", "label": "10 hour shift", "type": "10-hour shift", "hours": 10, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "10s is 10 hour shift."}, {"code": "5*", "label": "10 hour shift", "type": "10-hour shift", "hours": 10, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "5* and 5** are 10 hour shifts."}, {"code": "5**", "label": "10 hour shift", "type": "10-hour shift", "hours": 10, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": false, "quote": "5* and 5** are 10 hour shifts."}], "unknown": ["5* and 5**"], "clarifying_question": null}, "model": "gpt-4o-mini"};
  run(`liveSyncPost=async()=>(${J(UNK_AI)});`);
  run(`window.__ctx=${CTX_RICH};`);
  const um = await run(`describeReadWithAI(${J(FIXTURE)}, window.__ctx, describeParseLocal(${J(FIXTURE)}, db.facilities[0], window.__ctx.codes))`);
  t('E coverage: a glued unknown whose codes ARE resolved leaves NO phantom unknown',
    um.unanswered.length === 0, J(um.unanswered));
  const BEEPER = 'Day shifts pay $250/hr. 5* and 5** are beeper call.';
  const bm = await run(`describeReadWithAI(${J(BEEPER)}, ${CTX_EMPTY}, describeParseLocal(${J(BEEPER)}, db.facilities[0], []))`);
  t('E coverage: an unresolved glued subject is named PER CODE, never as glue',
    bm.unanswered.includes('5*') && bm.unanswered.includes('5**') && !bm.unanswered.includes('5* and 5**'),
    J(bm.unanswered));

  // ---------- (f) W1 shape: derived card + a "10" shift code ----------
  run(mkCamc(CAMC_DERIVED) + 'describeStates={};');
  run(`liveSyncPost=async()=>(${J(REAL_RESPONSE)});`);
  run(`window.__ctx={fac:db.facilities[0],codes:[{code:'10',shiftOnly:true},{code:'8s',ctype:'8-hour shift',hours:8}],card:{hourlyRate:250}};`);
  const w1 = await run(`describeReadWithAI(${J(FIXTURE)}, window.__ctx, describeParseLocal(${J(FIXTURE)}, db.facilities[0], window.__ctx.codes))`);
  t('F W1: fixture resolves beside a bare "10" shift code, nothing falsely unknown',
    w1.unanswered.length === 0 && w1.defs['10s'] && w1.defs['5*'] && w1.defs['5**'], J({ u: w1.unanswered, d: Object.keys(w1.defs) }));

  // ---------- (g) post-save pricing from the fallback read ----------
  run(mkCamc(CAMC_DERIVED) + 'describeStates={};cloudSession=null;');
  await run(`(async()=>{ const st=describeState('fac:camc'); st.text=${J(FIXTURE)}; await submitDescribe('fac:camc'); confirmDescribe('fac:camc'); })()`);
  const saved = run(`db.facilities[0].codeMap`);
  t('G save: the confirmed card carries all six definitions',
    ['8s', '8hr', '12s', '10s', '5*', '5**'].every(c => saved[c]), J(Object.keys(saved)));
  const priceOf = (code) => run(`resolveShiftPrice(db.facilities[0], {facilityId:'camc',type:${J(code)},date:'2026-08-10'})`);
  t('G pricing: 10s / 5* / 5** price $2,500 off the saved card',
    priceOf('10s').pay === '2500' && priceOf('5*').pay === '2500' && priceOf('5**').pay === '2500',
    J([priceOf('10s'), priceOf('5*'), priceOf('5**')]));
  t('G pricing: 8s prices $2,000 and 12s $3,000',
    priceOf('8s').pay === '2000' && priceOf('12s').pay === '3000', J([priceOf('8s'), priceOf('12s')]));

  // ---------- (h) paraphrase corpus, deterministic path ----------
  // Caleb rephrases on retest — the reader must generalize.
  // Each text runs on a FRESH facility (empty universe)
  // unless noted; full resolution = every code's length +
  // hourly 250 + empty unknown list.
  const CORPUS = [
    ['P1 the fixture itself', FIXTURE, null],
    ['P2 "$250 an hour", articles, means/both', 'CAMC pays $250 an hour. An 8s is an 8 hour day. 8hr means an 8-hour day. A 12s is a 12 hour day. 10s are 10 hour shifts. 5* and 5** are both 10-hour shifts.', null],
    ['P3 ALL-CAPS "=" list, codes known from shifts', 'Hourly rate is $250. 8S = 8hr shift, 8HR = 8hr shift, 12S = 12hr shift, 10S = 10hr shift, 5* = 10hr shift, 5** = 10hr shift.', [{ code: '8S', shiftOnly: true }, { code: '8HR', shiftOnly: true }, { code: '12S', shiftOnly: true }, { code: '10S', shiftOnly: true }, { code: '5*', shiftOnly: true }, { code: '5**', shiftOnly: true }]],
    ['P4 comma list, one sentence', 'Day shifts pay $250/hr. 8s is an 8-hour shift, 8hr is an 8-hour shift, 12s is a 12-hour shift, 10s is a 10-hour shift, and 5* and 5** are 10-hour shifts.', null],
    ['P5 shuffled order, glue first', 'At CAMC it\u2019s $250/hr. 5** and 5* are 10hr shifts. 10s is a 10hr shift. 12s is a 12hr shift. 8hr and 8s are 8hr shifts.', null],
    ['P6 colon list, bare "250/hr"', '250/hr. 8s: 8-hour shift. 8hr: 8-hour shift. 12s: 12-hour shift. 10s: 10-hour shift. 5*: 10-hour shift. 5**: 10-hour shift.', null],
    ['P7 "runs", label-first hourly', 'The hourly is $250. An 8s runs 8 hours. 8hr runs 8 hours. 12s runs 12 hours. 10s runs 10 hours. 5* runs 10 hours and 5** runs 10 hours.', null],
    ['P8 "either one is", or-glue + colons', 'CAMC \u2014 $250/hr across the board. 8s or 8hr: either one is an 8 hour shift. 12s: a 12 hour shift. 10s: a 10 hour shift. 5* or 5**: a 10 hour shift.', null],
    ['P9 ALL CAPS sentences', 'DAY SHIFTS PAY $250/HR. 8S IS AN 8-HOUR SHIFT. 8HR IS AN 8-HOUR SHIFT. 12S IS A 12-HOUR SHIFT. 10S IS 10 HOUR SHIFT. 5* AND 5** ARE 10 HOUR SHIFTS', null],
    ['P10 bare hours, rate last', '8s is 8 hours. 8hr is 8 hours. 12s is 12 hours. 10s is 10 hours. 5* is 10 hours. 5** is 10 hours. Everything pays $250/hr.', null],
    ['P11 slashes between statements', 'Day shifts $250/hr / 8s is an 8-hour shift / 8hr is an 8-hour shift / 12s is a 12-hour shift / 10s is a 10-hour shift / 5* and 5** are 10-hour shifts', null],
    ['P12 semicolons + "means"', 'Rate: $250/hr; 8s means 8 hours; 8hr means 8 hours; 12s means 12 hours; 10s means 10 hours; 5* means 10 hours; 5** means 10 hours', null],
  ];
  for (const [tag, text, codes] of CORPUS) {
    run(mkCamc({}) + 'describeStates={};');
    const p = run(`describeParseLocal(${J(text)}, db.facilities[0], ${J(codes || [])})`);
    const hours = {}; for (const k of Object.keys(p.defs)) { const w = Object.keys(WANT_HOURS).find(x => x.toLowerCase() === k.toLowerCase()); if (w) hours[w] = Number(p.defs[k].hours); }
    t('H corpus ' + tag + ': full resolution',
      Object.keys(WANT_HOURS).every(k => hours[k] === WANT_HOURS[k]) && p.unanswered.length === 0 && p.rates.hourlyRate === 250,
      J({ hours, u: p.unanswered, hr: p.rates.hourlyRate }));
    if (tag.startsWith('P3')) t('H corpus P3: no code inherits a phantom flat from the lead-in',
      Object.values(p.defs).every(d => d.weekdayPay == null && d.weekendPay == null), J(p.defs));
  }
  // Pinned boundaries — named, never silently dropped,
  // never fabricated.
  run(mkCamc({}) + 'describeStates={};');
  const p3b = run(`describeParseLocal('8S = 8hr shifts, 10S = 10hr shifts', db.facilities[0], [])`);
  t('H boundary: "=" list on a code-less surface stays ask-first (subjects named, no defs invented)',
    Object.keys(p3b.defs).length === 0 && p3b.unanswered.length > 0, J({ d: Object.keys(p3b.defs), u: p3b.unanswered }));
  const pRun = run(`describeParseLocal('Codes at CAMC ($250/hr): 8s 8 hours, 10s 10 hours, 5* 10 hours, 5** 10 hours, 12s 12 hours, 8hr 8 hours', db.facilities[0], [])`);
  t('H boundary: header + parenthetical list — every code resolved or NAMED, none dropped',
    ['8s', '8hr', '12s', '10s', '5*', '5**'].every(c => pRun.defs[c] || pRun.unanswered.some(u => String(u).toLowerCase().includes(c))),
    J({ d: Object.keys(pRun.defs), u: pRun.unanswered }));
  const pSpell = run(`describeParseLocal('Day shifts pay $250/hr. 8s is a ten hour shift. 10s is a ten hour shift.', db.facilities[0], [])`);
  t('H boundary: spelled-out lengths are AI-path — locally the codes are NAMED, not dropped, not mispriced',
    ['8s', '10s'].every(c => pSpell.defs[c] || pSpell.unanswered.includes(c)) &&
    !Object.values(pSpell.defs).some(d => Number(d.hours) === 8 && d.weekdayPay != null),
    J({ d: pSpell.defs, u: pSpell.unanswered }));

  // ---------- (i) Holzer content, rephrased ----------
  const CODES_HOLZ = `[{code:'HOLZ - G Main (8)',ctype:'8-hour day',hours:8},{code:'HOLZ - G Main (10)',ctype:'10-hour shift',hours:10},{code:'HOLZ - Call 1',ctype:'24-hour call',hours:24},{code:'HOLZ - Call 2',ctype:'Second call',hours:24},{code:'HOLZ - PCDO',ctype:'',hours:''}]`;
  const MK_HOLZ = `db.facilities=[{id:'holz',name:'Holzer',aliases:'HOLZ',codeMap:{}}];`;
  const H2 = ['Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours', 'Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200', 'Holz-call 2=2nd call weekday=$3,000 weekend $2,000', 'Holz-g main (10)=10hour day shift', '10.5 hours paid for 10 hour shifts', 'Holz PCDO=post call day off=no pay', 'Weekends only include Saturday and Sunday.'].join('\n');
  run(MK_HOLZ + 'describeStates={};');
  const h2 = run(`describeParseLocal(${J(H2)}, db.facilities[0], ${CODES_HOLZ})`);
  t('I Holzer canonical (local): every rate lands, paid-hours targeted',
    h2.rates.hourlyRate === 250 && h2.rates.paidHours8 === 8.5 && h2.rates.rate24 === 4800 && h2.rates.weekendRate24 === 4200 &&
    h2.rates.rateSecond === 3000 && h2.rates.weekendRateSecond === 2000 && h2.unanswered.length === 0,
    J({ r: h2.rates, u: h2.unanswered }));
  const H1 = "Day shifts pay $250/hr and I'm paid for 8.5 hours. An 8-hour shift pays $2,125 per shift. 1st call weekday=$4,800. 1st call weekend $4,200. Call 2 weekday is $3,000 and $2,000 on weekends.";
  const H1_AI = {"ok": true, "mode": "rules", "read": {"hourly_rate": {"value": 250, "quote": "Day shifts pay $250/hr"}, "paid_hours_8": {"value": 8.5, "quote": "I'm paid for 8.5 hours"}, "paid_hours_by_length": [], "first_call_hourly_rate": null, "call_bonus": null, "weekend": {"days": [], "stated": false, "quote": null}, "codes": [{"code": "HOLZ - G Main (8)", "label": "8-hour shift", "type": "8-hour day", "hours": 8, "paid_hours": 8.5, "weekday_pay": 2125, "weekend_pay": null, "unpaid": false, "quote": "An 8-hour shift pays $2,125 per shift"}, {"code": "HOLZ - Call 1", "label": "24-hour call", "hours": 24, "type": "24-hour call", "paid_hours": null, "weekday_pay": 4800, "weekend_pay": 4200, "unpaid": false, "quote": "1st call weekday=$4,800. 1st call weekend $4,200"}, {"code": "HOLZ - Call 2", "label": "2nd call", "hours": null, "type": "Second call", "paid_hours": null, "weekday_pay": 3000, "weekend_pay": 2000, "unpaid": false, "quote": "Call 2 weekday is $3,000 and $2,000 on weekends"}], "unknown": [], "clarifying_question": null}};
  run(`liveSyncPost=async()=>(${J(H1_AI)});`);
  run(`window.__ctx={fac:db.facilities[0],codes:${CODES_HOLZ},card:{}};`);
  const h1 = await run(`describeReadWithAI(${J(H1)}, window.__ctx, describeParseLocal(${J(H1)}, db.facilities[0], window.__ctx.codes))`);
  t('I Holzer prose (AI path): 1st call $4,800/$4,200 present; the codes the text speaks to are all covered',
    h1.rates.rate24 === 4800 && h1.rates.weekendRate24 === 4200 && h1.rates.rateSecond === 3000 && h1.rates.weekendRateSecond === 2000 &&
    !h1.unanswered.includes('HOLZ - Call 1') && !h1.unanswered.includes('HOLZ - Call 2') && !h1.unanswered.includes('HOLZ - G Main (8)'),
    J({ r: h1.rates, u: h1.unanswered }));
  t('I Holzer prose (AI path): PCDO is never mentioned in the text, so it is honestly still asked about',
    h1.unanswered.includes('HOLZ - PCDO'), J(h1.unanswered));
  const H3 = 'Holzer pays $250/hr for day shifts, and I\u2019m paid for 8.5 hours on an 8. A 10-hour day is paid for 10.5 hours. First call is $4,800 on a weekday and $4,200 on a weekend. Second call pays $3,000 weekdays, $2,000 weekends. PCDO means post call day off \u2014 no pay.';
  const H3_AI = {"ok": true, "mode": "rules", "read": {"hourly_rate": {"value": 250, "quote": "Holzer pays $250/hr"}, "paid_hours_8": {"value": 8.5, "quote": "paid for 8.5 hours on an 8"}, "paid_hours_by_length": [{"length": 10, "value": 10.5, "quote": "A 10-hour day is paid for 10.5 hours"}], "first_call_hourly_rate": null, "call_bonus": null, "weekend": {"days": [], "stated": false, "quote": null}, "codes": [{"code": "HOLZ - Call 1", "label": "24-hour call", "type": "24-hour call", "hours": 24, "paid_hours": null, "weekday_pay": 4800, "weekend_pay": 4200, "unpaid": false, "quote": "First call is $4,800 on a weekday and $4,200 on a weekend"}, {"code": "HOLZ - Call 2", "label": "2nd call", "type": "Second call", "hours": null, "paid_hours": null, "weekday_pay": 3000, "weekend_pay": 2000, "unpaid": false, "quote": "Second call pays $3,000 weekdays, $2,000 weekends"}, {"code": "HOLZ - PCDO", "label": "post call day off", "type": null, "hours": null, "paid_hours": null, "weekday_pay": null, "weekend_pay": null, "unpaid": true, "quote": "PCDO means post call day off \u2014 no pay"}], "unknown": [], "clarifying_question": null}};
  run(`liveSyncPost=async()=>(${J(H3_AI)});`);
  const h3 = await run(`describeReadWithAI(${J(H3)}, window.__ctx, describeParseLocal(${J(H3)}, db.facilities[0], window.__ctx.codes))`);
  t('I Holzer prose variant (AI path): call amounts + PCDO unpaid land',
    h3.rates.rate24 === 4800 && h3.rates.weekendRate24 === 4200 && h3.rates.rateSecond === 3000 && h3.rates.weekendRateSecond === 2000 &&
    h3.defs['HOLZ - PCDO'] && h3.defs['HOLZ - PCDO'].unpaid === true,
    J({ r: h3.rates, u: h3.unanswered, pcdo: h3.defs['HOLZ - PCDO'] }));

  // ---------- (j) grid-context words, BASIC path (promoted FB2) ----------
  // Promoted from test-sim-found-bugs.js (fixed in v139, found
  // by sim persona P3). A grid import hands the words reader
  // shift-only code entries ({code, ctype:'', hours:''}); with
  // no AI read, Dana's words lost three codes three ways:
  // (a) "D6 = a 6-hour shift" — a length canonicalTypeOf does
  //     not map, stated hyphenated at a line start: invisible
  //     to the hours matcher AND to the segment finder;
  // (b) at submit, C24 (24-hour call) and E8X (same-as) —
  //     submitDescribe trusted a render side effect for its
  //     context and parsed with no facility / no code
  //     universe, so the per-code reader never ran; the
  //     result also carried no aiBasic marker;
  // (c) the saved D6 definition died on its own prefill
  //     round trip for the same parser reason as (a).
  const GRID_CTX_J = ['D6', 'E8', 'E8X', 'C24', 'N12'].map(code => ({ code, ctype: '', hours: '', shiftOnly: true }));
  const WORDS_J = [
    'Day shifts pay $210/hr',
    'D6 = a 6-hour shift',
    'E8 is an 8-hour shift',
    'N12 is a 12-hour night shift',
    'C24 = 24-hour call. It pays $5,250 on weekdays and $4,725 on weekends',
    'E8X is the same as E8',
    'Weekends here are Friday, Saturday and Sunday',
  ].join('\n');
  const pj = run(`describeParseLocal(${J(WORDS_J)}, {}, ${J(GRID_CTX_J)})`);
  t('J grid words (basic): a 6-hour code binds from its own sentence ("D6 = a 6-hour shift")',
    !!(pj.defs && pj.defs['D6'] && String(pj.defs['D6'].hours) === '6'),
    J({ defs: Object.keys(pj.defs || {}), unanswered: pj.unanswered }));
  run(`
    db = empty(); db.settings.scheduleName = 'Whitfield';
    db.facilities = [{ id:'hw', name:'Harborview Medical Center', aliases:'Harborview Medical Center, HMC', hourlyRate:'' }];
    db.shifts = ['D6','E8','E8X','C24','N12'].map((c, i) => ({ id:'s' + i, date:'2027-06-0' + (i + 1), facility:'Harborview Medical Center', code:c, type:c, pay:'', status:'confirmed', incomplete:true, source:'schedule-import-ai' }));
    db.payStubs = []; persist();
    cloudSession = null; describeStates = {}; describeOpenFac = 'hw';
    { const st = describeState('fac:hw'); st.text = ${J(WORDS_J)}; }
  `);
  await run(`submitDescribe('fac:hw')`);
  const subJ = run(`describeState('fac:hw').parsed`);
  t('J grid words (basic submit): the definitions the local parser produced survive the submit (C24 + E8X)',
    !!(subJ && subJ.defs && subJ.defs['C24'] && subJ.defs['E8X']),
    J({ defs: Object.keys((subJ && subJ.defs) || {}), unanswered: subJ && subJ.unanswered }));
  t('J grid words (basic submit): no AI answered, so the read is marked basic (aiBasic)',
    !!(subJ && subJ.aiBasic === true), J(subJ && subJ.aiBasic));
  run(`
    db = empty();
    db.facilities = [{ id:'hw', name:'Harborview Medical Center', aliases:'', hourlyRate:'210',
      codeMap: { 'D6': { label:'a 6-hour shift', hours:'6', viaWords:true, rulesConfirmed:true } } }];
    db.shifts = [{ id:'d1', date:'2027-06-01', facility:'Harborview Medical Center', code:'D6', type:'D6', pay:'1260', status:'confirmed', incomplete:false, source:'schedule-import-ai' }];
    persist();
  `);
  const rtJ = run(`(function(){ const A = db.facilities[0]; const B = JSON.parse(JSON.stringify(A)); B.id = 'hw2'; B.codeMap = {}; db.facilities = [B];
    const text = describePrefillText(A, facilityDescribeCodes(A));
    const parsed = describeParseLocal(text, B, facilityDescribeCodes(B)); applyDescribedRules(B, parsed);
    return { def: (facilityCodeDefs(B) || {})['D6'] || null, text }; })()`);
  t('J grid words (round trip): the saved 6-hour definition re-reads from its own prefill sentence',
    !!rtJ.def && String(rtJ.def.hours) === '6',
    J(rtJ));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('FAILURES: ' + fails.join(' | ')); process.exit(1); }
  console.log('ALL PASS');
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
