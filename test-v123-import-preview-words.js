// CRNA Hub — v123 Request A (Nov 11, 2026): the facility/contract
// IMPORT PREVIEW loses its per-line clarification field grids.
// Caleb, verbatim intent: "Just replace the individual shift
// boxes with this" — the describe-in-your-own-words box (the
// SAME component as the facility card's pay-words box) becomes
// the preview's only clarification path, prefilled with the
// extraction written as plain sentences. Amounts the read could
// not attach surface as one words-level line, never dropped.
//
// Pins:
//  A1 fixture text -> the standing contract rates (Nov 5 read:
//     $2,000 daily / $250 premium / $175 1st call / $1,000
//     weeknight 2nd / $2,000 weekend 2nd); preview HTML has NO
//     grid machinery and DOES have the words box above Save.
//  A2 the prefill prose round-trips through the words reader
//     back to exactly the fixture rates.
//  A3 saving the untouched preview prices identically.
//  A4 HOLZ weekend-24 ($4,200) is expressible as a sentence and
//     saves, with the stated weekend provenance (v122 rules).
//  A5 a made-but-unconfirmed parse still applies at Save
//     (v110 lesson, structural: Save stages it).
//  A6 an unattached $650 surfaces as the words-level question
//     and is saved nowhere.
//  A7 v122 provenance through this surface: weekend-priced
//     words with no stated weekend read back as a LABELED
//     default and save as 'default'; day-only words never
//     mention weekends at all.
// Run: node test-v123-import-preview-words.js
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

(async () => {
  // ---------- A1: fixture preview — no grids, words box present ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(FIXTURE)}, 'addendum.pdf');`);
  t('A1 fixture extracts the standing rates',
    run(`JSON.stringify(facilityContractPreview.facilities[0].rates)`) ===
    JSON.stringify({ rateSecond: '1000', hourlyCall1st: '175', rate8: '2000', hourlyRate: '250', weekendRateSecond: '2000' }),
    run(`JSON.stringify(facilityContractPreview.facilities[0].rates)`));
  const html = run(`facilityContractPreviewHTML()`);
  t('A1 preview has NO per-line grid machinery',
    !html.includes('facContractKind') && !html.includes('What is this rate?') &&
    !html.includes('f_facPrev_0_hourlyRate') && !html.includes('f_facPrev_0_rate8') &&
    !html.includes('Found:') && !html.includes('per shift — flat'));
  t('A1 preview has the shared words box (card component), above Save',
    html.includes('data-key="imp:facprev:0"') && html.includes('Make my rules') &&
    html.includes('Pay rules at Riverside General Hospital — in your words') &&
    html.indexOf('Make my rules') < html.indexOf('Save facilities — I checked this'));
  t('A1 the page no longer renders the retired rule chat',
    !run(`facilitiesPage()`).includes('ruleChatForm') && !run(`facilitiesPage()`).includes('Make my rule with AI'));

  // ---------- A2: prefill prose round-trips ----------
  const prose = run(`contractRatesProse(facilityContractPreview.facilities[0])`);
  t('A2 prefill prose states every fixture rate as a sentence',
    prose === "Day shifts pay $250/hr. An 8-hour shift pays $2,000 per shift. The 1st call hourly rate is $175/hr. Call 2 is $1,000 on weekdays and $2,000 on weekends.",
    prose);
  const rt = run(`describeParseLocal(${JSON.stringify("Day shifts pay $250/hr. An 8-hour shift pays $2,000 per shift. The 1st call hourly rate is $175/hr. Call 2 is $1,000 on weekdays and $2,000 on weekends.")}, null, []).rates`);
  t('A2 prose round-trips to exactly the fixture rates',
    rt.hourlyRate === 250 && rt.rate8 === 2000 && rt.hourlyCall1st === 175 &&
    rt.rateSecond === 1000 && rt.weekendRateSecond === 2000 && Object.keys(rt).length === 5,
    JSON.stringify(rt));
  t('A2 the box renders prefilled with that prose',
    html.includes('Day shifts pay $250/hr. An 8-hour shift pays $2,000 per shift.'));

  // ---------- A3: untouched save prices identically ----------
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`); // second tap passes the create-new-facility confirmation gate
  t('A3 save creates the facility with the fixture rates',
    run(`db.facilities.length`) === 1 && run(`db.facilities[0].hourlyRate`) === '250' &&
    run(`db.facilities[0].rate8`) === '2000' && run(`db.facilities[0].hourlyCall1st`) === '175' &&
    run(`db.facilities[0].rateSecond`) === '1000' && run(`db.facilities[0].weekendRateSecond`) === '2000');
  t('A3 engine prices identically (day $2,000; 1st call $4,800/$4,200; 2nd call $1,000/$2,000)',
    run(`facilityPayFor(db.facilities[0],'8-hour day','2026-01-05')`) === 2000 &&
    run(`facilityPayFor(db.facilities[0],'24-hour call','2026-01-05')`) === 4800 &&
    run(`facilityPayFor(db.facilities[0],'24-hour call','2026-01-03')`) === 4200 &&
    run(`facilityPayFor(db.facilities[0],'Second call','2026-01-05')`) === 1000 &&
    run(`facilityPayFor(db.facilities[0],'Second call','2026-01-03')`) === 2000);

  // ---------- A4: weekend-24 as a sentence, stated provenance ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(FIXTURE)}, 'addendum.pdf');`);
  const holzWords = "Day shifts pay $250/hr and I'm paid for 8.5 hours. Call 1 is $4,800 on weekdays and $4,200 on weekends. Weekends are Saturday and Sunday.";
  run(`{ const st = describeState('imp:facprev:0'); st.text = ${JSON.stringify(holzWords)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  t('A4 words parse captures the weekend-24 sentence (the old selector had no such option)',
    run(`describeState('imp:facprev:0').parsed.rates.weekendRate24`) === 4200 &&
    run(`describeState('imp:facprev:0').parsed.rates.rate24`) === 4800 &&
    run(`describeState('imp:facprev:0').parsed.weekendStated`) === true);
  t('A4 read-back shows the $4,200 weekend figure and the stated weekend as fact',
    run(`facilityContractPreviewHTML()`).includes("Here's what I'll use:") &&
    run(`facilityContractPreviewHTML()`).includes('$4,200 on weekends') &&
    run(`facilityContractPreviewHTML()`).includes('Weekend means Saturday and Sunday.'));
  run(`confirmDescribe('imp:facprev:0')`);
  t('A4 confirm stages the rates into the preview entry',
    run(`facilityContractPreview.facilities[0].rates.weekendRate24`) === '4200' &&
    run(`!!facilityContractPreview.facilities[0].describedParsed`) === true);
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`); // second tap passes the create-new-facility confirmation gate
  t('A4 save lands weekendRate24 $4,200 with stated weekend provenance',
    run(`db.facilities[0].weekendRate24`) === '4200' && run(`db.facilities[0].rate24`) === '4800' &&
    run(`db.facilities[0].weekendDaysSource`) === 'stated' &&
    run(`facilityPayFor(db.facilities[0],'24-hour call','2026-01-03')`) === 4200);

  // ---------- A5: unconfirmed parse still applies at Save ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(FIXTURE)}, 'addendum.pdf');`);
  run(`{ const st = describeState('imp:facprev:0'); st.text = "Call 1 is $4,800 on weekdays and $4,200 on weekends."; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  t('A5 parse exists but was never confirmed',
    run(`!!describeState('imp:facprev:0').parsed`) === true &&
    run(`describeState('imp:facprev:0').confirmed`) === false);
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`); // second tap passes the create-new-facility confirmation gate
  t('A5 Save applies the unconfirmed parse anyway (typed rules are never discarded)',
    run(`db.facilities[0].weekendRate24`) === '4200' && run(`db.facilities[0].rate24`) === '4800');

  // ---------- A6: unattached amount ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(FIXTURE + '\nMileage reimbursement: $650 per month.')}, 'addendum.pdf');`);
  t('A6 the $650 is recorded as unattached at parse time',
    JSON.stringify(run(`facilityContractPreview.facilities[0].unattached`)) === '[650]',
    JSON.stringify(run(`facilityContractPreview.facilities[0].unattached`)));
  const html6 = run(`facilityContractPreviewHTML()`);
  t('A6 preview asks about it in words, under the box',
    html6.includes('also mentions $650') && html6.includes("couldn't tell what it's for") &&
    html6.indexOf('also mentions $650') > html6.indexOf('Make my rules'));
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`); // second tap passes the create-new-facility confirmation gate
  t('A6 nothing saves for the unattached amount (no rate field holds 650)',
    run(`db.facilities.length`) === 1 &&
    !Object.values(run(`db.facilities[0]`)).some((v) => String(v) === '650'));

  // ---------- A7: v122 provenance through this surface ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(FIXTURE)}, 'addendum.pdf');`);
  run(`{ const st = describeState('imp:facprev:0'); st.text = "Call 2 is $3,000 on weekdays and $2,000 on weekends."; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  t('A7 weekend-priced words, no stated weekend: read-back labels the default',
    // (&#39; is the rendered form of the apostrophe in "didn't".)
    run(`facilityContractPreviewHTML()`).includes("You didn&#39;t say which days count as the weekend"));
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`); // second tap passes the create-new-facility confirmation gate
  t('A7 the saved weekend is marked defaulted, never stated',
    run(`db.facilities[0].weekendDaysSource`) === 'default' &&
    run(`db.facilities[0].rateSecond`) === '3000');
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(FIXTURE)}, 'addendum.pdf');`);
  run(`{ const st = describeState('imp:facprev:0'); st.text = "Day shifts pay $250/hr."; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  t('A7 day-only words: the read-back never mentions weekends',
    !/weekend/i.test(run(`describeSummaryText('Riverside General Hospital', describeState('imp:facprev:0').parsed, null)`)));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
})();
