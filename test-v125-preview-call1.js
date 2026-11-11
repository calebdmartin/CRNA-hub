// CRNA Hub — v125 (Nov 11, 2026): the contract IMPORT PREVIEW
// silently dropped Call 1 from Caleb's own pay words. His box
// (screenshot, Nov 11, 2026 ~11:48 AM ET) held exactly:
//   Holz-g main (8)=8hr day shift $250/hr
//   Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200
//   Holz-call 2=2nd call weekday=$3,000 weekend $2,000
// and the read-back accounted for 2nd call and day shifts but
// NOT Call 1 — a named, priced code vanished (the confusion-
// budget defect class). The same words price Call 1 correctly
// on the facility CARD, whose code list feeds the statement
// reader; the preview hands the reader NO codes, so Call 1
// rides on describeCallAmounts — whose statement window stopped
// at ANY '.', amputating the statement at "24hr call" before
// its amounts ("Weekday=$4,800…") ever entered the segment.
// contractExtractRates misses the shape twice over (its flat
// pass reads only weekend-free lines; its per-line "24h" needs
// a word boundary "24hr" does not give it).
//
// Pins:
//  B1 the exact screenshot text through the preview path
//     parses ALL THREE codes' money: $250/hr, Call 1
//     $4,800/$4,200, Call 2 $3,000/$2,000 — and the rendered
//     read-back says so.
//  B2 weekend provenance on this surface: the text prices
//     weekends but never defines them, so the read-back
//     carries the LABELED default (never "Weekend means
//     Saturday and Sunday." as fact) and the save records
//     weekendDaysSource 'default'.
//  B3 confirm + Save prices a weekday Call 1 at $4,800 and a
//     weekend Call 1 at $4,200 from the saved facility.
//  B4 the same text with ", paid for 8.5 hours" on the G Main
//     line (Caleb: "I'll be sure to clarify the 8.5 in the
//     next upload") prices an 8-hour day at $2,125.
//  B5 the facility-CARD path with the same text is unchanged.
//  B6 describeCallAmounts: the '.' continuation keeps scope-
//     led and amount-led clauses and decimals, and still cuts
//     at a genuinely new sentence (no sweeping a neighbour's
//     money) and at the next call statement.
// Run: node test-v125-preview-call1.js
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
const CALEB = [
  'Holz-g main (8)=8hr day shift $250/hr',
  'Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200',
  'Holz-call 2=2nd call weekday=$3,000 weekend $2,000',
].join('\n');
const FIXTURE = [
  'Facility: Riverside General Hospital',
  'Regular daily rate: $2,000',
  'Premium hourly rate: $250',
  '1st call hourly rate: $175',
  '2nd call weeknight: $1,000',
  '2nd call weekend: $2,000',
].join('\n');
const RESET = `
  db = empty(); editId = null; facilitySuggestionPrefill = null;
  facilityContractPreview = null; facilityContractError = ''; facilityContractOcrStatus = '';
  facilityContractPendingImages = []; facilityContractOcrPages = []; facilityContractConfirmCreate = false;
  describeStates = {};
`;
// Caleb's live preview entry: the addendum read had already
// filled the entry's rates (that's how "paid for 8 hours" — the
// contract's figure, not his words — reached his read-back).
const HOLZER_ENTRY = `
  facilityContractPreview.facilities[0].name = 'Holzer';
  facilityContractPreview.facilities[0].aliases = 'HOLZ';
  facilityContractPreview.facilities[0].rates = { hourlyRate: '250', paidHours8: '8', hourlyCall1st: '175', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000' };
`;

(async () => {
  // ---------- B1: the exact screenshot text, preview path ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(FIXTURE)}, 'addendum.pdf');` + HOLZER_ENTRY);
  run(`{ const st = describeState('imp:facprev:0'); st.text = ${JSON.stringify(CALEB)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const rates = run(`describeState('imp:facprev:0').parsed.rates`);
  t('B1 preview parse captures Call 1 from his exact words ($4,800 / $4,200)',
    rates.rate24 === 4800 && rates.weekendRate24 === 4200, JSON.stringify(rates));
  t('B1 preview parse keeps the rest (hourly $250, Call 2 $3,000 / $2,000)',
    rates.hourlyRate === 250 && rates.rateSecond === 3000 && rates.weekendRateSecond === 2000,
    JSON.stringify(rates));
  const html1 = run(`facilityContractPreviewHTML()`);
  t('B1 read-back accounts for all three: 1st call $4,800/$4,200, 2nd call $3,000/$2,000, day $250/hr',
    html1.includes('1st call: $4,800 on weekdays, $4,200 on weekends') &&
    html1.includes('2nd call: $3,000 on weekdays, $2,000 on weekends') &&
    html1.includes('Day shifts pay $250/hr'),
    html1.slice(html1.indexOf("Here's what"), html1.indexOf("Here's what") + 400));

  // ---------- B2: weekend provenance on this surface ----------
  t('B2 the text stated no weekend definition (parsed weekendDays null)',
    run(`describeState('imp:facprev:0').parsed.weekendDays`) === null &&
    run(`describeState('imp:facprev:0').parsed.weekendStated`) === false);
  t('B2 read-back labels the weekend default — never states it as his rule',
    html1.includes("You didn&#39;t say which days count as the weekend") &&
    !html1.includes('Weekend means Saturday and Sunday.'),
    html1.slice(html1.indexOf("Here's what"), html1.indexOf("Here's what") + 500));

  // ---------- B3: confirm + Save prices Call 1 ----------
  run(`confirmDescribe('imp:facprev:0')`);
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`); // second tap passes the create-new-facility confirmation gate
  t('B3 saved facility carries the words\u2019 Call 1 rates',
    run(`db.facilities.length`) === 1 && run(`db.facilities[0].rate24`) === '4800' &&
    run(`db.facilities[0].weekendRate24`) === '4200',
    run(`JSON.stringify(db.facilities[0])`));
  t('B3 engine prices Call 1: weekday $4,800, weekend $4,200 (2nd call $3,000 / $2,000)',
    run(`facilityPayFor(db.facilities[0],'24-hour call','2026-01-05')`) === 4800 &&
    run(`facilityPayFor(db.facilities[0],'24-hour call','2026-01-03')`) === 4200 &&
    run(`facilityPayFor(db.facilities[0],'Second call','2026-01-05')`) === 3000 &&
    run(`facilityPayFor(db.facilities[0],'Second call','2026-01-03')`) === 2000);
  t('B3 the unstated weekend saves as defaulted provenance, never stated',
    run(`db.facilities[0].weekendDaysSource`) === 'default',
    run(`db.facilities[0].weekendDaysSource`));

  // ---------- B4: the 8.5 clarification prices $2,125 ----------
  const CALEB85 = [
    'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours',
    'Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200',
    'Holz-call 2=2nd call weekday=$3,000 weekend $2,000',
  ].join('\n');
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(FIXTURE)}, 'addendum.pdf');` + HOLZER_ENTRY);
  run(`{ const st = describeState('imp:facprev:0'); st.text = ${JSON.stringify(CALEB85)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  t('B4 the 8.5-hour clarification is read (paidHours8 8.5, Call 1 intact)',
    run(`describeState('imp:facprev:0').parsed.rates.paidHours8`) === 8.5 &&
    run(`describeState('imp:facprev:0').parsed.rates.rate24`) === 4800,
    JSON.stringify(run(`describeState('imp:facprev:0').parsed.rates`)));
  run(`confirmDescribe('imp:facprev:0')`);
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`);
  t('B4 an 8-hour day prices $2,125 through the preview path (250 x 8.5)',
    run(`facilityPayFor(db.facilities[0],'8-hour day','2026-01-05')`) === 2125,
    run(`facilityPayFor(db.facilities[0],'8-hour day','2026-01-05')`));

  // ---------- B5: the facility-card path is unchanged ----------
  run(RESET + `
    db.facilities.push({ id: 'fac-holz', name: 'HOLZ', codeMap: {
      'HOLZ - G Main (8)': { label: '8hr day shift', hours: '8', canonicalType: '8-hour day' },
      'HOLZ - Call 1': { label: '24hr call', hours: '24', canonicalType: '24-hour call' },
      'HOLZ - Call 2': { label: '2nd call', hours: '', canonicalType: 'Second call' } } });
    db.shifts.push(
      { id: 's1', date: '2026-11-24', facility: 'HOLZ', type: 'HOLZ - Call 1', status: 'confirmed' },
      { id: 's3', date: '2026-11-25', facility: 'HOLZ', type: 'HOLZ - G Main (8)', status: 'confirmed' });
  `);
  const card = run(`describeParseLocal(${JSON.stringify(CALEB)}, db.facilities[0], facilityDescribeCodes(db.facilities[0]))`);
  t('B5 card path still resolves all three codes with Call 1 priced',
    card.rates.rate24 === 4800 && card.rates.weekendRate24 === 4200 &&
    !!card.defs['HOLZ - Call 1'] && !!card.defs['HOLZ - Call 2'] && !!card.defs['HOLZ - G Main (8)'],
    JSON.stringify(card.rates));
  t('B5 card read-back still names Call 1 with both figures',
    run(`describeSummaryText('HOLZ', describeParseLocal(${JSON.stringify(CALEB)}, db.facilities[0], facilityDescribeCodes(db.facilities[0])), db.facilities[0])`)
      .includes('“HOLZ - Call 1” (1st call): $4,800 on weekdays, $4,200 on weekends'));

  // ---------- B6: describeCallAmounts statement window ----------
  const ca = (txt, n) => run(`describeCallAmounts(${JSON.stringify(txt)}, ${n})`);
  t('B6 the screenshot Call 1 line reads across its period',
    JSON.stringify(ca('Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200', 1)) === JSON.stringify({ wd: 4800, we: 4200 }),
    JSON.stringify(ca('Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200', 1)));
  t('B6 an amount-led continuation also binds ("…call. $4,200 on weekends")',
    JSON.stringify(ca('Call 1 is 24hr call. $4,200 on weekends', 1)) === JSON.stringify({ we: 4200 }),
    JSON.stringify(ca('Call 1 is 24hr call. $4,200 on weekends', 1)));
  t('B6 a genuinely new sentence is NOT swept in ("…call. The stipend is $500")',
    ca('Call 1 is 24hr call. The parking stipend is $500.', 1) === null,
    JSON.stringify(ca('Call 1 is 24hr call. The parking stipend is $500.', 1)));
  t('B6 the next call statement still bounds the window (one-line neighbours)',
    JSON.stringify(ca('Call 1 is $4,800 on weekdays. Call 2 is $3,000 on weekdays, $2,000 on weekends.', 1)) === JSON.stringify({ wd: 4800 }) &&
    JSON.stringify(ca('Call 1 is $4,800 on weekdays. Call 2 is $3,000 on weekdays, $2,000 on weekends.', 2)) === JSON.stringify({ wd: 3000, we: 2000 }),
    JSON.stringify(ca('Call 1 is $4,800 on weekdays. Call 2 is $3,000 on weekdays, $2,000 on weekends.', 1)));
  t('B6 the long-standing shapes are unchanged',
    JSON.stringify(ca('Call 2 is $3,000 on weekdays, $2,000 on weekends', 2)) === JSON.stringify({ wd: 3000, we: 2000 }) &&
    JSON.stringify(ca('Holz-call 2=2nd call weekday=$3,000 weekend $2,000', 2)) === JSON.stringify({ wd: 3000, we: 2000 }));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
})();
