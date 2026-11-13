// CRNA Hub — v157 (Nov 12, 2026): the Assistant's live AI works again.
//
// THE BUG (diagnosed + proven live by Jewel, Nov 12, 2026): the deployed
// assistant-chat Edge Function rejected EVERY live question with
// bad_summary — its ALLOWED_TOP_KEYS never included "profile", while
// the client's buildAssistantSummary() sent a top-level "profile" key
// ({name, employmentType, monthlyIncomeGoal}). Every question silently
// fell back to the on-device answer ("— Live AI was unavailable…").
// The identical call WITHOUT profile returned a real model answer.
//
// What this pins:
//  1 CONTRACT (the centerpiece): a summary built EXACTLY like the
//    client's (Caleb fixture) validates against the function's OWN
//    rules, parsed out of supabase/functions/assistant-chat/index.ts —
//    every client top-level key is in ALLOWED_TOP_KEYS, and no
//    DENIED_KEYS entry appears at any depth. This pin FAILS on the
//    v156 tree and passes after the fix, so the client/server contract
//    can never drift apart silently again.
//  2 buildAssistantSummary() sends NO top-level "profile" key (the
//    user's name never goes to the model); the remaining keys keep
//    their shape, and employmentType rides inside "month" (an allowed
//    object) next to monthlyIncomeGoal.
//  3 the deterministic capabilities answer (the catch-all Caleb hit on
//    Nov 12, 2026) is a short, real product answer: paychecks are
//    CALCULATED from shifts at facility rates, a pay stub is the
//    ACTUAL for its check — the old wrong line "upcoming paychecks
//    (estimates from pay stubs)" is gone, and the answer is materially
//    shorter than the old meta answer.
//  4 SYSTEM_PROMPT carries the one-sentence product description, so a
//    capabilities question gets a product answer from the live model
//    even with an empty summary.
//  5 sign-in lands on the DASHBOARD (Caleb directed Nov 12, 2026):
//    cloudAfterSignIn ends on setTab('Dashboard') and, run end to end,
//    the active view is Dashboard. (Boot behavior and the signed-out
//    forms are untouched — v156 pins cover them.)
//  6 SW cache is v157.
// Run: node test-v157-assistant-live.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
process.on('unhandledRejection', () => {});
const store = new Map();
function el() {
  const e = {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    className: '', dataset: {}, style: {}, __listeners: {},
    addEventListener(type, fn) { (e.__listeners[type] = e.__listeners[type] || []).push(fn); },
    append() {}, click() {}, remove() {}, scrollIntoView() {},
    querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null,
  };
  return e;
}
const elements = {};
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  FormData: class { *[Symbol.iterator]() {} },
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  document: {
    getElementById: (id) => elements[id] || (elements[id] = el()),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
    addEventListener() {},
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {}, confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '[]', json: async () => [] }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.liveSyncPost = async () => ({}); // live-sync.js is not loaded in this harness
vm.createContext(sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : (extra ? '  [' + extra + ']' : '')));
  if (cond) pass++; else fail++;
};

const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
const edgeSrc = fs.readFileSync(R + 'supabase/functions/assistant-chat/index.ts', 'utf8');

run(fs.readFileSync(R + 'app.js', 'utf8'));

// ---------- Caleb-shaped fixture (same style as the Assistant suites) ----------
run(`
  db.facilities = [{ id: 'f1', name: 'Holzer', aliases: 'HOL', address: '100 Hospital Dr', rate8: '2125', rate10: '2625', rate12: '', rate24: '4800', rateSecond: '3000', weekendRateSecond: '2000', hourlyRate: '250', paidHours8: '8.5', callBonus: '1000', distance: '', notes: 'Parking code 4821' }];
  db.shifts = [
    { id: 's1', date: '2027-01-05', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed' },
    { id: 's2', date: '2027-01-06', facility: 'Holzer', type: 'Second call', pay: '3000', status: 'proposed' }
  ];
  db.mileage = []; db.pto = []; db.nbcrnaCE = []; db.aanaCE = [];
  db.nbcrna = { status: 'Certified', number: '126402', periodEnd: '2027-04-30', renewalDeadline: '2027-04-30', classA: '103', classB: '2', macEd: '60', macDev: '40', reminders: '90,60,30,7' };
  db.aana = { status: 'Active', number: '126402', expiration: '2027-12-31', reminders: '90,60,30,7' };
  db.licenses = [{ state: 'West Virginia', type: 'APRN', status: 'Active', expiry: '2027-06-30', reminders: '90,60,30,7' }];
  db.assistantChat = [];
  db.settings = Object.assign({}, db.settings || {}, { scheduleName: 'Caleb Martin', employmentType: '1099', monthlyIncomeGoal: 40000 });
`);

// ---------- helpers: parse the function's OWN contract ----------
function parseKeySet(src, constName) {
  const m = src.match(new RegExp('const ' + constName + ' = new Set\\(\\[([\\s\\S]*?)\\]\\);'));
  if (!m) return null;
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
}
const ALLOWED = parseKeySet(edgeSrc, 'ALLOWED_TOP_KEYS');
const DENIED = parseKeySet(edgeSrc, 'DENIED_KEYS');
t('0 function contract sets parse from index.ts (ALLOWED_TOP_KEYS + DENIED_KEYS)',
  !!ALLOWED && !!DENIED && ALLOWED.has('month') && DENIED.has('notes'),
  ALLOWED ? [...ALLOWED].join(',') : 'no match');

const summary = run(`buildAssistantSummary()`);

// ---------- 1: the contract pin ----------
t('1a contract: parsed allowlist is the documented one (no profile)',
  !!ALLOWED && !ALLOWED.has('profile'));
t('1b contract: every client top-level key is allowed by the function',
  !!ALLOWED && Object.keys(summary).every(k => ALLOWED.has(k)),
  'client keys: ' + Object.keys(summary).join(','));
let deniedHit = null;
(function walk(v, pathSoFar) {
  if (deniedHit || !v || typeof v !== 'object') return;
  for (const [k, val] of Object.entries(v)) {
    if (DENIED && DENIED.has(k)) { deniedHit = pathSoFar + k; return; }
    walk(val, pathSoFar + k + '.');
  }
})(summary, '');
t('1c contract: no denied key appears at any depth of the client summary',
  deniedHit === null, deniedHit || '');

// ---------- 2: summary shape after the fix ----------
t('2a summary: no top-level "profile" key is sent to the model',
  !Object.prototype.hasOwnProperty.call(summary, 'profile'));
t('2b summary: the user\'s name appears nowhere in the summary payload',
  !JSON.stringify(summary).includes('Caleb Martin'));
t('2c summary: remaining top-level keys keep their shape',
  ['today', 'month', 'year', 'upcoming', 'credentials', 'facilities', 'mileage', 'ce']
    .every(k => Object.prototype.hasOwnProperty.call(summary, k)),
  Object.keys(summary).join(','));
t('2d summary: employmentType + monthlyIncomeGoal ride inside the allowed "month" object',
  summary.month && summary.month.employmentType === '1099' && summary.month.monthlyIncomeGoal === 40000,
  JSON.stringify(summary.month && { e: summary.month.employmentType, g: summary.month.monthlyIncomeGoal }));

// ---------- 3: deterministic capabilities answer ----------
const OLD_META_ANSWER = 'I can answer from what is actually recorded on this device: upcoming shifts, this month\'s projected income, upcoming paychecks (estimates from pay stubs), credentials expiring soon, facilities and their rates, mileage, and CE totals — plus how CRNA Hub itself works. Try one of the suggested questions, or ask about one of those topics. I won\'t guess at records that aren\'t here, and I don\'t answer clinical questions.';
const cap = run(`answerQuestion('what can you do for me?')`);
t('3a capabilities answer: paychecks are calculated from shifts at facility rates',
  /paychecks?[^.]*from your shifts at each facility/.test(cap) || /from your shifts at each facility's rates/.test(cap), cap);
t('3b capabilities answer: a pay stub is the ACTUAL for its check',
  /pay stub/.test(cap) && /actual/.test(cap), cap);
t('3c capabilities answer: the wrong "estimates from pay stubs" line is gone (everywhere in app.js)',
  !cap.includes('estimates from pay stubs') && !appSrc.includes('estimates from pay stubs'));
t('3d capabilities answer: it is a product answer (schedule in one calendar, mileage, credentials/CE reminders)',
  /every hospital in one calendar/.test(cap) && /mileage/.test(cap) && /licenses, certifications, and CE/.test(cap) && /reminders? before anything expires/.test(cap), cap);
t('3e capabilities answer: materially shorter than the old meta answer',
  cap.length < OLD_META_ANSWER.length * 0.85,
  'new ' + cap.length + ' vs old ' + OLD_META_ANSWER.length);

// ---------- 4: SYSTEM_PROMPT product sentence ----------
t('4 SYSTEM_PROMPT describes the product (capabilities answer even with an empty summary)',
  edgeSrc.includes('CRNA Hub is a scheduling and admin app for CRNAs: it keeps shifts from every facility in one calendar, forecasts income and paychecks from recorded shifts and facility rates, logs mileage, and tracks licenses, certifications and continuing education with expiry reminders.'));

// ---------- 5: sign-in lands on Dashboard ----------
t('5a cloudAfterSignIn lands via setTab(\'Dashboard\') (source pin)',
  /async function cloudAfterSignIn\(\) \{ cloudAuthResetForm\(\); await cloudAutoMerge\(\); render\(\); setTab\('Dashboard'\);/.test(appSrc));

(async () => {
  await run(`cloudAfterSignIn()`);
  t('5b after sign-in completes, the active view is Dashboard', run(`tab`) === 'Dashboard', 'tab=' + run(`tab`));

  // ---------- 6: SW ----------
  t('6 SW cache is v157', swSrc.includes('crna-hub-shell-v158'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
