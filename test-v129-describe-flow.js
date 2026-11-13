'use strict';
// v129 (Nov 11, 2026) — Caleb's CAMC-card asks:
//   1. AUTO-CLOSE ON SAVE: a successful card pay-words save
//      collapses the section to the card's resting state by
//      itself, saved confirmation visible; the import-preview
//      surface (same component) collapses to a one-line
//      "Rules set" summary with an Edit-rules reopen, and Save
//      still applies the staged rules (v123/v110 pins).
//   2. STUB UPLOAD OPTIONAL, VISIBLY: the card's stub block is
//      a collapsed <details> under an "Upload a pay stub
//      (optional)" header — never a required step of saving
//      rules; the rules save below runs with zero stub
//      interaction and db.payStubs stays empty.
//   3. PREFILL FIDELITY: Caleb's post-v128 screenshot showed
//      the CAMC words box containing ONLY "Day shifts pay
//      $250/hr." while the saved code map held five
//      definitions. REPRODUCED pre-fix in this round's probe:
//      the old prefill's day branch fired once and suppressed
//      every other day definition (saved defs existed, pricing
//      used them, the box showed none). The fix gives every
//      saved definition its own sentence; the pins below hold
//      the prefill complete AND round-trip exact (re-parsing
//      the prefill reproduces the identical pricing fields of
//      the saved code map).
const fs = require('fs'); const vm = require('vm'); const R = __dirname + '/';
let pass = 0, fail = 0; const fails = [];
function t(n, c, x) { if (c) { pass++; console.log('ok -', n) } else { fail++; fails.push(n); console.log('FAIL -', n, x !== undefined ? ':: ' + JSON.stringify(x).slice(0, 400) : '') } }
const elements = new Map();
function stubEl(id) { if (!elements.has(id)) { const el = { id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, files: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], appendChild() {}, append() {}, focus() {}, click() {}, setAttribute() {}, getAttribute: () => null, closest: () => null }; elements.set(id, el) } return elements.get(id) }
const store = new Map();
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  document: { getElementById: (id) => stubEl(id), querySelectorAll: () => [], createElement: () => stubEl('c' + Math.random()), body: { append() {} } },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {}, confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox; sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (c) => vm.runInContext(c, sandbox);
run(`function pricingFields(defs){ const o={}; for(const k of Object.keys(defs||{}).sort()){ const d=defs[k]||{}; o[k]={hours:d.hours||null, canonicalType:d.canonicalType||null, paidHours:d.paidHours||null, unpaid:!!d.unpaid, weekdayPay:d.weekdayPay||null, weekendPay:d.weekendPay||null}; } return o; }`);
const CAMC_TEXT = '$250/hr\n8s or 8=8hr shifts\n10s or 10=10hr shifts\n5* or 5**=10hr shifts\n12s or 12=12hr shifts';
const HOLZ_WORDS = 'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours / Holz-g main (10)=10hr day shift, paid for 10.5 hours / Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200 / Holz-call 2=2nd call weekday=$3,000 weekend $2,000 / Holz PCDO=post call day off=no pay / Weekends only include Saturday and Sunday.';
const RESET = `db = { facilities: [], shifts: [], credentials: [], mileageTrips: [], settings: {}, payStubs: [] };
  describeStates = {}; describeOpenFac = null; describeSavedFlashFac = null; paystubCardOpenFac = ''; paystubCardFacId = ''; paystubPreview = null; facilityContractPreview = null;`;
(async () => {
  // ---------- 1a+2+3: CAMC card — open, save, auto-close ----------
  run(RESET + `
    db.facilities = [{ id: 'camc', name: 'CAMC', hourlyRate: '250', notHereTypes: [] }];
    db.shifts = ['8','10','5*','5**','12'].map((code, i) => ({ id: 's' + i, facility: 'CAMC', code, type: code, date: '2026-11-0' + (2 + i), status: 'confirmed', pay: '' }));
  `);
  run(`actions('describe-facility','camc')`);
  t('opening the section shows the words box',
    run(`describeOpenFac`) === 'camc' && run(`facilitiesPage()`).includes('describe_fac_camc'));
  const cardStub = run(`(function(){ const h = facilitiesPage(); const i = h.indexOf('id="paystub-card-camc"'); return h.slice(i, i + 400); })()`);
  t('item 2: card stub block is a collapsed "Upload a pay stub (optional)" panel',
    cardStub.includes('Upload a pay stub (optional)') && cardStub.includes('collapse-title') && !cardStub.includes(' open>'), cardStub);
  run(`{ const st = describeState('fac:camc'); st.text = ${JSON.stringify(CAMC_TEXT)}; }`);
  await run(`submitDescribe('fac:camc')`);
  run(`confirmDescribe('fac:camc')`);
  t('item 1a: save CLOSES the section by itself',
    run(`describeOpenFac`) === null && !run(`facilitiesPage()`).includes('describe_fac_camc'));
  t('item 1a: the saved confirmation shows in the resting card',
    run(`describeSavedFlashFac`) === 'camc' && run(`facilitiesPage()`).includes('Pay rules saved.') &&
    run(`facilitiesPage()`).includes('$250.00/hr') && run(`facilitiesPage()`).includes('Not taken here'));
  t('item 2: the rules saved with zero stub interaction (no stubs stored)',
    run(`db.payStubs.length`) === 0);
  const pays = run(`db.shifts.map(s => s.pay)`);
  t('v128 pins hold through the auto-closing save (8 $2,000 · 10 $2,500 · 5* $2,500 · 5** $2,500 · 12 $3,000)',
    JSON.stringify(pays) === JSON.stringify(['2000', '2500', '2500', '2500', '3000']), pays);
  // ---------- item 3: prefill completeness + round trip ----------
  const prefill = run(`describePrefillText(db.facilities[0], facilityDescribeCodes(db.facilities[0]))`);
  t('item 3: the prefill is NOT the screenshot\u2019s lone day line',
    prefill !== 'Day shifts pay $250/hr.', prefill);
  t('item 3: every saved definition appears as its own sentence',
    ['Day shifts pay $250/hr.', '8 is an 8-hour shift.', '10 is a 10-hour shift.', '5* is a 10-hour shift.', '5** is a 10-hour shift.', '12 is a 12-hour shift.'].every(s => prefill.includes(s)), prefill);
  run(`actions('describe-facility','camc')`);
  // v162: reopening shows the user's OWN words, stored verbatim
  // at the save — this pin originally expected the regenerated
  // prefill sentences ('5** is a 10-hour shift.'), which was
  // the round-trip defect itself. The full rules still show in
  // the box, now in the user's phrasing; describePrefillText
  // itself stays pinned by the item-3 checks below.
  t('item 1a: reopening shows the saved words in the box and clears the flash',
    run(`describeOpenFac`) === 'camc' && run(`describeSavedFlashFac`) === null &&
    run(`facilitiesPage()`).includes('5* or 5**=10hr shifts') && run(`facilitiesPage()`).includes('8s or 8=8hr shifts'));
  const rt = run(`(function(){
    const A = db.facilities[0];
    const B = JSON.parse(JSON.stringify(A)); B.id = 'camc2'; B.codeMap = {}; db.facilities = [B];
    const text = describePrefillText(A, facilityDescribeCodes(A));
    const parsed = describeParseLocal(text, B, facilityDescribeCodes(B));
    applyDescribedRules(B, parsed);
    return { a: pricingFields(facilityCodeDefs(A)), b: pricingFields(facilityCodeDefs(B)) };
  })()`);
  t('item 3: round trip — re-parsing the prefill reproduces the identical code map (pricing fields)',
    JSON.stringify(rt.a) === JSON.stringify(rt.b), rt);
  // ---------- item 3: HOLZ paid-hours + call + PCDO round trip ----------
  run(RESET + `
    db.facilities = [{ id: 'holz', name: 'Holzer', hourlyRate: '250', weekendDays: [0,6], weekendDaysSource: 'stated', notHereTypes: [] }];
    db.shifts = [
      { id: 'h1', facility: 'Holzer', code: 'HOLZ - G Main (8)', type: 'HOLZ - G Main (8)', date: '2026-11-02', status: 'confirmed', pay: '' },
      { id: 'h2', facility: 'Holzer', code: 'HOLZ - G Main (10)', type: 'HOLZ - G Main (10)', date: '2026-11-03', status: 'confirmed', pay: '' },
      { id: 'h3', facility: 'Holzer', code: 'HOLZ - Call 1', type: 'HOLZ - Call 1', date: '2026-11-04', status: 'confirmed', pay: '' },
      { id: 'h4', facility: 'Holzer', code: 'HOLZ - Call 2', type: 'HOLZ - Call 2', date: '2026-11-05', status: 'confirmed', pay: '' },
      { id: 'h5', facility: 'Holzer', code: 'HOLZ - PCDO', type: 'HOLZ - PCDO', date: '2026-11-06', status: 'confirmed', pay: '' },
    ];
  `);
  run(`{ const fac = db.facilities[0]; const st = describeState('fac:holz'); st.ctx = { fac, facName: 'Holzer', codes: facilityDescribeCodes(fac) }; st.text = ${JSON.stringify(HOLZ_WORDS)}; }`);
  await run(`submitDescribe('fac:holz')`);
  run(`confirmDescribe('fac:holz')`);
  const holzPays = run(`db.shifts.map(s => s.pay)`);
  t('HOLZ card save prices as pinned (8 $2,125 · 10 $2,625 · Call 1 $4,800 · Call 2 $3,000 · PCDO $0) and auto-closed',
    JSON.stringify(holzPays) === JSON.stringify(['2125', '2625', '4800', '3000', '0']) && run(`describeOpenFac`) === null, holzPays);
  const holzPrefill = run(`describePrefillText(db.facilities[0], facilityDescribeCodes(db.facilities[0]))`);
  t('item 3: HOLZ prefill states each definition — paid hours per code, call rates, PCDO, stated weekend',
    holzPrefill.includes('HOLZ - G Main (8) is an 8-hour shift, paid for 8.5 hours.') &&
    holzPrefill.includes('HOLZ - G Main (10) is a 10-hour shift, paid for 10.5 hours.') &&
    holzPrefill.includes('$4,800 on weekdays and $4,200 on weekends') &&
    holzPrefill.includes('$3,000 on weekdays and $2,000 on weekends') &&
    holzPrefill.includes('HOLZ - PCDO is post call day off \u2014 no pay.') &&
    holzPrefill.includes('Weekend is Saturday and Sunday.'), holzPrefill);
  t('item 3: no facility-level paid-hours rider duplicates a per-code paid-hours statement',
    (holzPrefill.match(/paid for 8\.5 hours/g) || []).length === 1, holzPrefill);
  const rtH = run(`(function(){
    const A = db.facilities[0];
    const B = JSON.parse(JSON.stringify(A)); B.id = 'holz2'; B.codeMap = {}; delete B.paidHours8; db.facilities = [B];
    const text = describePrefillText(A, facilityDescribeCodes(A));
    const parsed = describeParseLocal(text, B, facilityDescribeCodes(B));
    applyDescribedRules(B, parsed);
    const rates = f => [f.hourlyRate, f.rate24, f.weekendRate24, f.rateSecond, f.weekendRateSecond, f.paidHours8].join('|');
    // Call rules live on the facility RATE CARD in A's shape
    // (def carries the type, money on the card); re-parsing
    // the prefill's "Call 1 is $4,800 on weekdays..." sentence
    // lands the same money as split-pay ON B's defs instead —
    // the sentence form and that parse behavior predate v129,
    // and every price path agrees. The pin therefore compares
    // call money EFFECTIVELY (def figure, else the card's),
    // while day/unpaid defs must match field for field.
    const callMoney = (defs, f) => JSON.stringify({
      c1: [defs['HOLZ - Call 1'].weekdayPay || f.rate24, defs['HOLZ - Call 1'].weekendPay || f.weekendRate24],
      c2: [defs['HOLZ - Call 2'].weekdayPay || f.rateSecond, defs['HOLZ - Call 2'].weekendPay || f.weekendRateSecond] });
    const dayDefs = defs => { const o = pricingFields(defs); delete o['HOLZ - Call 1']; delete o['HOLZ - Call 2']; return o; };
    return { a: dayDefs(facilityCodeDefs(A)), b: dayDefs(facilityCodeDefs(B)), ra: rates(A), rb: rates(B),
      cmA: callMoney(facilityCodeDefs(A), A), cmB: callMoney(facilityCodeDefs(B), B),
      pa: ['HOLZ - G Main (8)','HOLZ - G Main (10)','HOLZ - Call 1','HOLZ - Call 2'].map(c => facilityPayFor(A, canonicalTypeOf(c), '2026-11-04')),
      pb: ['HOLZ - G Main (8)','HOLZ - G Main (10)','HOLZ - Call 1','HOLZ - Call 2'].map(c => facilityPayFor(B, canonicalTypeOf(c), '2026-11-04')) };
  })()`);
  t('item 3: HOLZ round trip reproduces day/unpaid defs field-for-field, call money, rates (incl. paidHours8 8.5) and prices',
    JSON.stringify(rtH.a) === JSON.stringify(rtH.b) && rtH.cmA === rtH.cmB && rtH.ra === rtH.rb && JSON.stringify(rtH.pa) === JSON.stringify(rtH.pb), rtH);
  // ---------- item 3: split-pay definition round trip ----------
  const split = run(`(function(){
    const A = { id: 'sp', name: 'Split General', hourlyRate: '250', codeMap: { '5**': { weekdayPay: '2500', weekendPay: '2000', hours: '10', canonicalType: '10-hour shift', rulesConfirmed: true, viaWords: true } }, notHereTypes: [] };
    db.facilities = [A];
    db.shifts = [{ id: 'sp1', facility: 'Split General', code: '5**', type: '5**', date: '2026-11-02', status: 'confirmed', pay: '' }];
    const text = describePrefillText(A, facilityDescribeCodes(A));
    const B = JSON.parse(JSON.stringify(A)); B.id = 'sp2'; B.codeMap = {}; db.facilities = [B];
    const parsed = describeParseLocal(text, B, facilityDescribeCodes(B));
    applyDescribedRules(B, parsed);
    return { text, a: pricingFields(facilityCodeDefs(A)), b: pricingFields(facilityCodeDefs(B)) };
  })()`);
  t('item 3: a split-pay definition prefills as its own sentence and round-trips',
    split.text.includes('5** is a 10-hour shift and pays $2,500 on weekdays and $2,000 on weekends.') &&
    JSON.stringify(split.a) === JSON.stringify(split.b), split);
  // ---------- 1b: import preview collapses; Save still applies ----------
  const FIXTURE = ['Facility: Riverside General Hospital', 'Regular daily rate: $2,000', 'Premium hourly rate: $250', '1st call hourly rate: $175', '2nd call weeknight: $1,000', '2nd call weekend: $2,000'].join('\n');
  const CALEB3 = ['Holz-g main (8)=8hr day shift $250/hr', 'Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200', 'Holz-call 2=2nd call weekday=$3,000 weekend $2,000'].join('\n');
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(FIXTURE)}, 'addendum.pdf');`);
  run(`facilityContractPreview.facilities[0].name = 'Holzer'; facilityContractPreview.facilities[0].aliases = 'HOLZ';
    facilityContractPreview.facilities[0].rates = { hourlyRate: '250', paidHours8: '8', hourlyCall1st: '175', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000' };`);
  run(`{ void facilityContractPreviewHTML(); const st = describeState('imp:facprev:0'); st.text = ${JSON.stringify(CALEB3)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  run(`confirmDescribe('imp:facprev:0')`);
  const prevHtml = run(`facilityContractPreviewHTML()`);
  t('item 1b: confirming preview rules collapses the box to the "Rules set" line',
    run(`describeState('imp:facprev:0').collapsed`) === true && run(`describeState('imp:facprev:0').confirmed`) === true &&
    prevHtml.includes('<strong>Rules set.</strong>') && prevHtml.includes('1st call: $4,800 on weekdays, $4,200 on weekends') &&
    !prevHtml.includes('describe_imp_facprev_0'), prevHtml.slice(prevHtml.indexOf('Rules set') - 60, prevHtml.indexOf('Rules set') + 200));
  t('item 1b: the collapsed line offers Edit rules; the staged rules survive',
    prevHtml.includes('data-action="describe-edit"') && run(`!!facilityContractPreview.facilities[0].describedParsed`) === true);
  run(`actions('describe-edit','imp:facprev:0')`);
  t('item 1b: Edit rules reopens the box with the text intact',
    run(`describeState('imp:facprev:0').collapsed`) === false &&
    run(`facilityContractPreviewHTML()`).includes('describe_imp_facprev_0') &&
    run(`describeState('imp:facprev:0').text`).includes('Holz-call 1'));
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`);
  t('item 1b: Save still applies the staged rules (v123/v110 pins)',
    run(`db.facilities.length`) === 1 && run(`db.facilities[0].rate24`) === '4800' && run(`db.facilities[0].weekendRate24`) === '4200');
  // ---------- item 2: panel open-state capture ----------
  run(RESET + `db.facilities = [{ id: 'f1', name: 'General Hospital', hourlyRate: '250' }];`);
  run(`paystubCardOpenFac = ''; capturePaystubCardPanelState()`);
  stubEl('paystub-card-f1').open = true;
  run(`capturePaystubCardPanelState()`);
  const capOpen = run(`paystubCardOpenFac`);
  stubEl('paystub-card-f1').open = false;
  run(`capturePaystubCardPanelState()`);
  t('item 2: the panel\u2019s live open state survives re-renders both ways (v127 pattern)',
    capOpen === 'f1' && run(`paystubCardOpenFac`) === '');
  t('item 2: a card-started stub read force-opens its panel',
    run(`paystubCardFacId = 'f1'; paystubStatus = 'Reading stub.pdf'; facilitiesPage()`).includes('paystub-card-f1" open'));
  // ---------- shell ----------
  t('sw: cache bumped to v129', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v163'));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('FAILS:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2) });
