// CRNA Hub — tests for the plain-language AI rule chat box in the
// Facilities contract panel (Nov 6, 2026). Run: node test-rule-chat.js
//
// Covers, without any live API call (liveSyncPost is stubbed):
//   * Caleb's example ("24hr call, first 8 hours $250/hr, then after
//     3pm 175/hr until 7am") maps to hourlyRate 250 + hourlyCall1st 175
//     and the deterministic engine prices it at $4,800 weekday /
//     $4,200 weekend — the AI never does the arithmetic.
//   * An ambiguous rule returns a clarifying question, shown in the
//     chat, instead of a guess.
//   * Preview-before-save: a parsed rule saves NOTHING until the user
//     taps "Use this rule" (merges into the facility contract preview)
//     and then saves that preview.
//   * The chat box renders inside the Facilities contract panel, next
//     to the existing rate boxes, which stay in place.
//   * A follow-up answer is sent with the conversation history so the
//     AI refines the same rule.
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
const alerts = [];
let stubRuleResponse = null;
let lastRuleCall = null;
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
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
  liveSyncPost: async (name, body) => { lastRuleCall = { name, body }; return stubRuleResponse; },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');

// ---------- Mapping: the example rule ----------
const exampleRule = {
  shift_type: '24-hour call', applies_to: null,
  hourly_rate: 250, first_call_hourly_rate: 175,
  flat_rate: null, weekend_flat_rate: null,
  second_call_rate: null, weekend_second_call_rate: null, call_bonus: null,
  segments: [
    { hours: 8, rate: 250, from: null, to: null, label: 'first 8 hours' },
    { hours: 16, rate: 175, from: '15:00', to: '07:00', label: 'after 3pm until 7am' },
  ],
  summary: '24-hour call: first 8 hours at $250/hr, then $175/hr from 3pm to 7am.',
  clarifying_question: 'Does this same pattern apply on weekends too, or is the weekend rate different?',
  missing: ['weekend rate'],
};
run(`globalThis.__rates = ruleToFacilityRates(${JSON.stringify(exampleRule)})`);
t('example rule maps to hourlyRate 250 + hourlyCall1st 175',
  sandbox.__rates.hourlyRate === '250' && sandbox.__rates.hourlyCall1st === '175');
t('engine prices the example rule at $4,800 weekday (8x250 + 16x175)',
  run(`facilityPayFor({hourlyRate:'250',hourlyCall1st:'175'},'24-hour call','2026-01-05')`) === 4800);
t('engine prices the example rule at $4,200 weekend (24x175)',
  run(`facilityPayFor({hourlyRate:'250',hourlyCall1st:'175'},'24-hour call','2026-01-03')`) === 4200);
t('rule totals text shows $4,800 and $4,200, computed by the engine',
  run(`ruleTotalsText(${JSON.stringify(exampleRule)}, ruleToFacilityRates(${JSON.stringify(exampleRule)}))`).includes('$4,800') &&
  run(`ruleTotalsText(${JSON.stringify(exampleRule)}, ruleToFacilityRates(${JSON.stringify(exampleRule)}))`).includes('$4,200'));
t('second-call rule maps weeknight/weekend/bonus separately',
  (() => { const r = run(`ruleToFacilityRates({shift_type:'Second call',second_call_rate:1000,weekend_second_call_rate:2000,call_bonus:null,segments:[]})`); return r.rateSecond === '1000' && r.weekendRateSecond === '2000'; })());
t('a rule stating nothing maps to no rates (never $0)',
  Object.keys(run(`ruleToFacilityRates({shift_type:'Other',segments:[]})`)).length === 0);

// ---------- Chat flow: preview before save, clarifying question ----------
(async () => {
  run(`cloudSession = {email:'test@example.com'}; db.facilities = []; facilityContractPreview = null; ruleChatMessages = []; ruleChatPreview = null;`);
  const facilitiesBefore = run(`db.facilities.length`);
  stubRuleResponse = { ok: true, mode: 'rule', rule: exampleRule, model: 'gpt-4o-mini' };
  elements['f_ruleChatText'] = el();
  elements['f_ruleChatText'].value = '24hr call, first 8 hours $250/hr, then after 3pm 175/hr until 7am';
  await run(`submitRuleChat({preventDefault(){}})`);
  t('chat call went to extract-contract in rule mode with the user text',
    lastRuleCall && lastRuleCall.name === 'extract-contract' && lastRuleCall.body.mode === 'rule' &&
    /24hr call/.test(lastRuleCall.body.ruleText));
  t('parsed rule became a preview (not a save): facilities unchanged, no contract preview created',
    run(`db.facilities.length`) === facilitiesBefore && run(`facilityContractPreview`) === null &&
    run(`!!ruleChatPreview`) === true);
  t('preview carries the mapped rates 250 / 175',
    run(`ruleChatPreview.rates.hourlyRate`) === '250' && run(`ruleChatPreview.rates.hourlyCall1st`) === '175');
  t('clarifying question is in the preview and the chat, not guessed away',
    run(`ruleChatPreview.clarifying_question`) === exampleRule.clarifying_question &&
    run(`ruleChatMessages.some(m=>m.who==='ai' && m.text===${JSON.stringify(exampleRule.clarifying_question)})`));
  const chatHtml = run(`ruleChatHTML()`);
  t('chat preview says "Here\'s the rule I understood" with editable rate fields and totals',
    chatHtml.includes("Here's the rule I understood") && chatHtml.includes('ruleEdit') &&
    chatHtml.includes('$4,800') && chatHtml.includes('Nothing is saved yet'));

  // Follow-up answer refines the same rule, history is sent.
  stubRuleResponse = { ok: true, mode: 'rule', rule: { ...exampleRule, applies_to: 'both', clarifying_question: null, missing: [] }, model: 'gpt-4o-mini' };
  elements['f_ruleChatText'].value = 'Same on weekends';
  await run(`submitRuleChat({preventDefault(){}})`);
  t('follow-up answer sent the conversation history with the new text',
    Array.isArray(lastRuleCall.body.ruleHistory) && lastRuleCall.body.ruleHistory.length >= 2 &&
    lastRuleCall.body.ruleText === 'Same on weekends');
  t('refined preview has no outstanding clarifying question',
    run(`ruleChatPreview.clarifying_question`) === null && run(`ruleChatPreview.rule.applies_to`) === 'both');

  // Use this rule -> merges into the facility contract preview only.
  run(`useRuleChatPreview()`);
  t('"Use this rule" merges rates into the facility contract preview, still saving nothing',
    run(`db.facilities.length`) === facilitiesBefore &&
    run(`facilityContractPreview.facilities[0].rates.hourlyRate`) === '250' &&
    run(`facilityContractPreview.facilities[0].rates.hourlyCall1st`) === '175' &&
    run(`ruleChatPreview`) === null);

  // Panel rendering: chat box sits in the contract panel; rate boxes stay.
  run(`tab='Facilities'`);
  const page = run(`facilitiesPage()`);
  t('Facilities page renders the chat box inside the contract panel, after the contract preview',
    page.includes('Describe it in your own words') && page.includes('ruleChatForm') &&
    page.indexOf('Describe it in your own words') > page.indexOf('facility-contract-panel'));
  t('existing rate boxes are still on the page (chat is an addition, not a replacement)',
    page.includes('Hourly rate ($)') && page.includes('1st call hourly rate ($/hr)') && page.includes('Read my contract'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
