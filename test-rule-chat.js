// CRNA Hub — AI rule conversion (describe-in-words system).
//
// v123 (Nov 11, 2026): the standalone "Your pay rule, in your
// own words" + "Make my rule with AI" chat that lived on the
// Facilities page is RETIRED — the describe-in-your-words box
// (one component, used on facility cards, the Edit form, and
// the contract import preview) is the only words-to-rates path.
// What remains pinned here is the reusable converter the words
// box's AI merge still calls, ruleToFacilityRates, plus the
// retirement itself:
//  - Caleb's example rule ("Day shifts pay $250 an hour. 1st
//    call is $175 an hour for all 24 hours. I'm paid for the
//    full 24.") converts to hourlyRate 250 + hourlyCall1st 175,
//    and the ENGINE prices a 24-hour call at $4,800 weekday /
//    $4,200 weekend ($250 first 8, $175 after; weekend flat
//    hourly) — the Holzer 1st-call shape.
//  - A second-call/weekend rule maps to rateSecond /
//    weekendRateSecond.
//  - An empty rule converts to nothing (no invented rates).
//  - The retired chat UI is gone: no ruleChatForm, no
//    submitRuleChat handler in the source.
// Run: node test-rule-chat.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, scrollIntoView() {},
  };
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
  alert: () => {},
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
sandbox.liveSyncPost = async () => ({ ok: true, body: {} });
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : (extra ? ' — ' + extra : '')));
  if (!cond) { failures++; process.exitCode = 1; }
};
const APP = fs.readFileSync(R + 'app.js', 'utf8');

run('db = empty();');
// The structured rule the AI returns for Caleb's example words
// ("Day shifts pay $250 an hour. 1st call is $175 an hour for all
// 24 hours. I'm paid for the full 24.") — the same shape the old
// chat's stubbed AI returned.
const exampleRule = {
  shift_type: '24-hour call',
  hourly_rate: 250, first_call_hourly_rate: 175,
  flat_rate: null, weekend_flat_rate: null,
  second_call_rate: null, weekend_second_call_rate: null, call_bonus: null,
  segments: [
    { hours: 8, rate: 250, from: null, to: null, label: 'first 8 hours' },
    { hours: 16, rate: 175, from: '15:00', to: '07:00', label: 'after 3pm until 7am' },
  ],
};
const rates = run(`ruleToFacilityRates(${JSON.stringify(exampleRule)})`);
t("conversion: day-shift hourly maps to hourlyRate '250'", rates.hourlyRate === '250', JSON.stringify(rates));
t("conversion: 1st-call hourly maps to hourlyCall1st '175'", rates.hourlyCall1st === '175');
t('conversion: no invented flat rates', rates.rate24 === undefined && rates.rate8 === undefined);
run(`db.facilities = [{ id: 'fac', name: 'Rule Hospital', ...ruleToFacilityRates(${JSON.stringify(exampleRule)}), weekendDays: [0, 6] }];`);
t('engine: weekday 24-hour call prices $4,800 ($250 x 8 + $175 x 16)',
  run(`facilityPayFor(db.facilities[0], '24-hour call', '2026-11-02')`) === 4800,
  String(run(`facilityPayFor(db.facilities[0], '24-hour call', '2026-11-02')`)));
t('engine: weekend 24-hour call prices $4,200 ($175 x 24)',
  run(`facilityPayFor(db.facilities[0], '24-hour call', '2026-11-01')`) === 4200);
const rates2 = run(`ruleToFacilityRates({shift_type:'Second call',second_call_rate:1000,weekend_second_call_rate:2000,call_bonus:null,segments:[]})`);
t('conversion: second call maps to rateSecond / weekendRateSecond',
  rates2.rateSecond === '1000' && rates2.weekendRateSecond === '2000', JSON.stringify(rates2));
t('conversion: a rule stating nothing converts to no rates at all',
  Object.keys(run(`ruleToFacilityRates({shift_type:'Other',segments:[]})`)).length === 0);
t('v123: the retired chat UI is absent from the Facilities page',
  !run(`facilitiesPage()`).includes('ruleChatForm') && !run(`facilitiesPage()`).includes('Make my rule with AI'));
t('v123: the retired chat handlers are gone from the source',
  !APP.includes('submitRuleChat') && !APP.includes('ruleChatHTML') && !APP.includes('useRuleChatPreview'));

console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
