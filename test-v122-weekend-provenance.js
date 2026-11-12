// Nov 11, 2026 — v122: the phantom weekend line. On the CAMC
// facility card Caleb typed pay words that stated NO weekend
// rule ("$250/hour · 8=8hr shifts · 10=10hr shifts · 5* and
// 5**=10hr shifts · 12=12 hr shifts") and the read-back still
// asserted "Weekend means Saturday and Sunday." — a fact he
// never stated, presented as his own rule. Per the standing
// neutrality rule (Nov 9–10, 2026) the read-back may state as
// fact ONLY what the user's text stated:
//   stated weekend            → stated as fact ("Weekend means …")
//   unstated + weekend-priced → labeled default/open point
//     ("You didn't say which days count as the weekend — I'll
//      use Saturday and Sunday unless you tell me otherwise.")
//   unstated + nothing prices weekends differently → NO mention
// The facility records the provenance (weekendDaysSource:
// 'stated' vs 'default') so a later read-back/prefill never
// presents a default as the user's own words. Pricing does not
// change: Sat/Sun remains the working default when a weekend
// definition is genuinely needed and unstated (v103 semantics).
//
// This file also pins the NEW text shape from Caleb's CAMC
// screenshot — in particular the combined statement
// "5* and 5**=10hr shifts" must bind BOTH codes.
//
// Run against v121 code, the weekend checks fail (the line is
// asserted unconditionally in describeSummaryText and in
// describePrefillText) — that is the reproduction.
//
// Run: node test-v122-weekend-provenance.js
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

// Caleb's CAMC words, exactly as typed on the card Nov 11, 2026
// (line breaks as in the box; the first line is partly cut off
// in the screenshot — "$250/hour").
const CAMC_TEXT = '$250/hour\n8=8hr shifts\n10=10hr shifts\n5* and 5**=10hr shifts\n12=12 hr shifts';
const CAMC_CODES = [{ code: '8' }, { code: '10' }, { code: '5*' }, { code: '5**' }, { code: '12' }];
const freshFac = (id, name) => ({
  id, name, aliases: '', address: '', hourlyRate: '', paidHours8: '',
  rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '',
  rateSecond: '', weekendRateSecond: '', callBonus: '', hourlyCall1st: '',
  weekendDays: null, ratesSource: 'manual', codeMap: {},
});
// Caleb's HOLZ words (test version, 8.5 authorized Nov 10, 2026).
const HOLZ_TEXT = 'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours\nHolz-call 1=24hr call. Weekday=$4,800 weekend $4,200\nHolz-call 2=2nd call weekday=$3,000 weekend $2,000\nHolz-g main (10)=10hour day shift\nHolz PCDO=post call day off=no pay\nWeekends only include Saturday and Sunday.';
const HOLZ_CODES = [{ code: 'HOLZ - G Main (8)' }, { code: 'HOLZ - Call 1' }, { code: 'HOLZ - Call 2' }, { code: 'HOLZ - G Main (10)' }, { code: 'HOLZ - PCDO' }];
// Weekend-differentiated pricing, NO weekend definition stated.
const SPLIT_TEXT = 'Day shifts pay $250/hr. Call 2 is $3,000 on weekdays, $2,000 on weekends.';

run(`db = empty(); persist();`);

// ---------- A. CAMC new text shape: parse, price, silent weekend ----------
{
  const fac = freshFac('camc-a', 'CAMC');
  run(`db.facilities = [${J(fac)}]; db.shifts = []; persist();`);
  const p = run(`describeParseLocal(${J(CAMC_TEXT)}, db.facilities[0], ${J(CAMC_CODES)})`);
  t('A1: all five codes resolve', ['8', '10', '5*', '5**', '12'].every(c => p.defs[c]), J(Object.keys(p.defs)));
  t('A2: nothing named is unanswered', p.unanswered.length === 0, J(p.unanswered));
  t('A3: combined "5* and 5**=" binds BOTH codes as 10-hour', p.defs['5*'] && p.defs['5**'] && p.defs['5*'].canonicalType === '10-hour shift' && p.defs['5**'].canonicalType === '10-hour shift', J({ a: p.defs['5*'], b: p.defs['5**'] }));
  const s = run(`describeSummaryText('CAMC', describeParseLocal(${J(CAMC_TEXT)}, db.facilities[0], ${J(CAMC_CODES)}), db.facilities[0])`);
  t('A4: read-back accounts for every code', ['8', '10', '5*', '5**', '12'].every(c => s.includes('“' + c + '”')), s);
  t('A5: read-back shows the prices ($2,000 / $2,500 / $3,000)', s.includes('$2,000') && s.includes('$2,500') && s.includes('$3,000'), s);
  t('A6: read-back has NO weekend mention (nothing prices weekends differently)', !/weekend/i.test(s), s);
  // Apply for real and price each code off the saved card.
  run(`(() => { const f = db.facilities[0]; const p = describeParseLocal(${J(CAMC_TEXT)}, f, ${J(CAMC_CODES)}); applyDescribedRules(f, p); })()`);
  const prices = {};
  for (const c of ['8', '10', '5*', '5**', '12']) {
    prices[c] = run(`(() => { const f = db.facilities[0]; const d = codeDefFor(f, '${c}'); return d ? facilityPayFor(f, d.canonicalType, '2026-12-01') : null; })()`);
  }
  t('A7: code 8 prices $2,000', prices['8'] === 2000, J(prices));
  t('A8: code 10 prices $2,500', prices['10'] === 2500, J(prices));
  t('A9: code 5* prices $2,500', prices['5*'] === 2500, J(prices));
  t('A10: code 5** prices $2,500', prices['5**'] === 2500, J(prices));
  t('A11: code 12 prices $3,000', prices['12'] === 3000, J(prices));
  const src = run(`db.facilities[0].weekendDaysSource`);
  t('A12: no weekend provenance invented for an all-day-shift card', src == null, J(src));
  const pre = run(`describePrefillText(db.facilities[0], facilityDescribeCodes(db.facilities[0]))`);
  t('A13: prefill for CAMC has NO weekend sentence', !/weekend/i.test(pre), pre);
}

// ---------- B. HOLZ: weekend STATED — read-back keeps his statement ----------
{
  const fac = freshFac('holz-b', 'HOLZ');
  run(`db.facilities = [${J(fac)}]; db.shifts = []; persist();`);
  const p = run(`describeParseLocal(${J(HOLZ_TEXT)}, db.facilities[0], ${J(HOLZ_CODES)})`);
  t('B1: parse marks the weekend as stated', p.weekendStated === true, J(p.weekendDays));
  const s = run(`describeSummaryText('HOLZ', describeParseLocal(${J(HOLZ_TEXT)}, db.facilities[0], ${J(HOLZ_CODES)}), db.facilities[0])`);
  t('B2: read-back states his weekend as fact', s.includes('Weekend means Saturday and Sunday.'), s);
  run(`(() => { const f = db.facilities[0]; const p = describeParseLocal(${J(HOLZ_TEXT)}, f, ${J(HOLZ_CODES)}); applyDescribedRules(f, p); })()`);
  t('B3: facility saves weekendDays [0,6] with stated provenance', J(run(`db.facilities[0].weekendDays`)) === '[0,6]' && run(`db.facilities[0].weekendDaysSource`) === 'stated', J(run(`({ d: db.facilities[0].weekendDays, s: db.facilities[0].weekendDaysSource })`)));
  const pre = run(`describePrefillText(db.facilities[0], facilityDescribeCodes(db.facilities[0]))`);
  t('B4: HOLZ prefill keeps the stated weekend sentence', pre.includes('Weekend is Saturday and Sunday.'), pre);
}

// ---------- C. Weekend-priced, weekend UNSTATED — labeled default ----------
{
  const fac = freshFac('rgh-c', 'RGH');
  run(`db.facilities = [${J(fac)}]; db.shifts = []; persist();`);
  const p = run(`describeParseLocal(${J(SPLIT_TEXT)}, db.facilities[0], [])`);
  t('C1: parse marks the weekend as NOT stated', p.weekendStated === false, J(p.weekendDays));
  const s = run(`describeSummaryText('RGH', describeParseLocal(${J(SPLIT_TEXT)}, db.facilities[0], []), db.facilities[0])`);
  t('C2: read-back does NOT assert the weekend as fact', !s.includes('Weekend means Saturday and Sunday.'), s);
  t('C3: read-back surfaces the labeled default', /didn.t say which days count as the weekend/i.test(s) && s.includes('Saturday and Sunday') && /unless you/i.test(s), s);
  run(`(() => { const f = db.facilities[0]; const p = describeParseLocal(${J(SPLIT_TEXT)}, f, []); applyDescribedRules(f, p); })()`);
  t('C4: facility saves the default marked as defaulted', run(`db.facilities[0].weekendDaysSource`) === 'default', J(run(`db.facilities[0].weekendDaysSource`)));
  t('C5: pricing unchanged — Sat 2nd call $2,000 (default Sat/Sun)', run(`facilityPayFor(db.facilities[0], 'Second call', '2026-12-05')`) === 2000);
  t('C6: pricing unchanged — Tue 2nd call $3,000', run(`facilityPayFor(db.facilities[0], 'Second call', '2026-12-01')`) === 3000);
  const pre = run(`describePrefillText(db.facilities[0], facilityDescribeCodes(db.facilities[0]))`);
  t('C7: prefill phrases the weekend as a default, not his words', /didn.t say which days count as the weekend/i.test(pre) && !pre.includes('Weekend is Saturday and Sunday.'), pre);
}

// ---------- D. A previously STATED weekend survives a silent re-describe ----------
{
  const fac = Object.assign(freshFac('stm-d', 'STM'), { weekendDays: [5, 6], weekendDaysSource: 'stated' });
  run(`db.facilities = [${J(fac)}]; db.shifts = []; persist();`);
  const s = run(`describeSummaryText('STM', describeParseLocal(${J(SPLIT_TEXT)}, db.facilities[0], []), db.facilities[0])`);
  t('D1: read-back states the SAVED stated weekend (Fri/Sat) as fact', s.includes('Weekend means Friday and Saturday.'), s);
  run(`(() => { const f = db.facilities[0]; const p = describeParseLocal(${J(SPLIT_TEXT)}, f, []); applyDescribedRules(f, p); })()`);
  t('D2: silent re-describe keeps stated provenance + days', run(`db.facilities[0].weekendDaysSource`) === 'stated' && J(run(`db.facilities[0].weekendDays`)) === '[5,6]', J(run(`({ d: db.facilities[0].weekendDays, s: db.facilities[0].weekendDaysSource })`)));
}

console.log(fails ? `\n${fails} FAILING` : '\nALL PASS');
