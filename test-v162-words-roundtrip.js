'use strict';
// v162 (Nov 13, 2026) — THE WORDS ROUND-TRIP DEFECT.
// Found on the sim account during marketing recordings (Caleb's
// account never affected): reopening a facility's pay-rules
// panel regenerated the words box FROM the saved rate card as
// lossy machine prose ("C1 is a 24-hour shift." — the call money
// simply gone). Confirming a re-read of that prose DEGRADED a
// correct card (demo Dec 22 paycheck $30,000 -> $15,750).
// The pins below hold the fix:
//   1. The user's ORIGINAL words are stored on the facility
//      (rulesWords + rulesWordsSource: user | contract |
//      generated) and prefill the box verbatim; contract-derived
//      prose is the baseline only when no user words exist.
//   2. A re-parse runs ONLY when the text was edited (dirty
//      check vs the stored baseline). Saving unedited text is a
//      no-op: the card stays byte-identical.
//   3. Defense in depth: an edited re-parse that would CHANGE a
//      price the card already states (or un-price a code) lists
//      each change in the read-back and needs a second,
//      explicit confirm tap — never applied silently.
const fs = require('fs'); const vm = require('vm'); const R = __dirname + '/';
let pass = 0, fail = 0; const fails = [];
function t(n, c, x) { if (c) { pass++; console.log('ok -', n) } else { fail++; fails.push(n); console.log('FAIL -', n, x !== undefined ? ':: ' + JSON.stringify(x).slice(0, 500) : '') } }
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
const J = JSON.stringify;
run(`function stableStringify(o){ if(o===null||typeof o!=='object')return JSON.stringify(o); if(Array.isArray(o))return '['+o.map(stableStringify).join(',')+']'; return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+stableStringify(o[k])).join(',')+'}'; }
function facSnap(id){ const f=(db.facilities||[]).find(x=>x.id===id); return f?stableStringify(f):null; }
function priceOf(id, code, date){ const f=(db.facilities||[]).find(x=>x.id===id); const r=resolveShiftPrice(f,{code,type:code,date}); return r?Number(r.pay):null; }`);
const RESET = `db = { facilities: [], shifts: [], credentials: [], mileageTrips: [], settings: {}, payStubs: [] };
  describeStates = {}; describeOpenFac = null; describeSavedFlashFac = null; facilityContractPreview = null; facilityContractError = ''; facilityContractPendingImages = []; facilityContractOcrPages = []; facilityContractConfirmCreate = false; cloudSession = null;`;
const WORDS = 'Day shifts pay $250/hr and I\'m paid for 8 hours. RG8 is an 8-hour shift. RG10 is a 10-hour shift, paid for 10.5 hours. C2 is 2nd call, $3,000 on weekdays and $2,000 on weekends. PCDO is post call day off — no pay.';
(async () => {
  // ============ S1: the incident — legacy card, generated prefill ============
  run(RESET + `
    db.facilities = [{ id: 'rgh', name: 'Riverside General', hourlyRate: '250', weekendDays: [0,6], weekendDaysSource: 'stated', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000', codeMap: {
      'RG8': { label: '8-hour shift', canonicalType: '8-hour shift', hours: '8', weekdayPay: '2000', rulesConfirmed: true, viaWords: true },
      'RG10': { label: '10-hour shift', canonicalType: '10-hour shift', hours: '10', paidHours: '10.5', viaWords: true },
      'C1': { label: '1st call', canonicalType: '24-hour call', rulesConfirmed: true, viaWords: true },
      'C2': { label: '2nd call', canonicalType: 'Second call', rulesConfirmed: true, viaWords: true } } }];
    db.shifts = [
      { id: 'a1', facility: 'Riverside General', code: 'RG8', type: 'RG8', date: '2026-12-07', status: 'confirmed', pay: '' },
      { id: 'a2', facility: 'Riverside General', code: 'RG8', type: 'RG8', date: '2026-12-14', status: 'confirmed', pay: '' },
      { id: 'a3', facility: 'Riverside General', code: 'RG10', type: 'RG10', date: '2026-12-09', status: 'confirmed', pay: '' },
      { id: 'a4', facility: 'Riverside General', code: 'C1', type: 'C1', date: '2026-12-14', status: 'confirmed', pay: '' },
      { id: 'a5', facility: 'Riverside General', code: 'C2', type: 'C2', date: '2026-12-08', status: 'confirmed', pay: '' } ];
    healUnpricedShiftPays();
  `);
  const s1Pays = run(`db.shifts.map(s => s.pay)`);
  t('S1 setup: the incident card prices RG8 $2,000 · RG10 $2,625 · C1 $4,800 · C2 $3,000',
    JSON.stringify(s1Pays) === JSON.stringify(['2000', '2000', '2625', '4800', '3000']), s1Pays);
  const s1Snap = run(`facSnap('rgh')`);
  run(`actions('describe-facility','rgh'); void facilitiesPage();`);
  const s1St = run(`describeState('fac:rgh')`);
  t('S1: reopening prefills the GENERATED prose and marks it generated (no stored words yet)',
    s1St.baselineSource === 'generated' && s1St.text === run(`describePrefillText(db.facilities[0], facilityDescribeCodes(db.facilities[0]))`),
    { src: s1St.baselineSource, text: s1St.text });
  await run(`submitDescribe('fac:rgh')`);
  t('S1: “Make my rules” on UNEDITED generated prose does not re-parse — the saved card is shown instead',
    run(`describeState('fac:rgh').unchanged`) === true, run(`describeState('fac:rgh').parsed && Object.keys(describeState('fac:rgh').parsed.rates || {})`));
  run(`confirmDescribe('fac:rgh')`);
  t('S1: confirming the unedited box leaves the card BYTE-IDENTICAL (no degradation)',
    run(`facSnap('rgh')`) === s1Snap);
  t('S1: and every price survives (RG10 $2,625 · C1 $4,800 · C2 $3,000)',
    run(`priceOf('rgh','RG10','2026-12-09')`) === 2625 && run(`priceOf('rgh','C1','2026-12-14')`) === 4800 && run(`priceOf('rgh','C2','2026-12-08')`) === 3000 &&
    JSON.stringify(run(`db.shifts.map(s => s.pay)`)) === JSON.stringify(s1Pays));

  // ============ S2: the user's own words are kept verbatim ============
  run(RESET + `
    db.facilities = [{ id: 'rg2', name: 'Riverside General', codeMap: {} }];
    db.shifts = [
      { id: 'b1', facility: 'Riverside General', code: 'RG8', type: 'RG8', date: '2026-12-07', status: 'confirmed', pay: '' },
      { id: 'b2', facility: 'Riverside General', code: 'RG10', type: 'RG10', date: '2026-12-09', status: 'confirmed', pay: '' },
      { id: 'b3', facility: 'Riverside General', code: 'C2', type: 'C2', date: '2026-12-08', status: 'confirmed', pay: '' },
      { id: 'b4', facility: 'Riverside General', code: 'PCDO', type: 'PCDO', date: '2026-12-10', status: 'confirmed', pay: '' } ];
  `);
  run(`actions('describe-facility','rg2'); void facilitiesPage(); { const st = describeState('fac:rg2'); st.text = ${J(WORDS)}; }`);
  await run(`submitDescribe('fac:rg2')`);
  run(`confirmDescribe('fac:rg2')`);
  t('S2: first save prices from the words (RG8 $2,000 · RG10 $2,625 · C2 $3,000 · PCDO $0)',
    run(`priceOf('rg2','RG8','2026-12-07')`) === 2000 && run(`priceOf('rg2','RG10','2026-12-09')`) === 2625 &&
    run(`priceOf('rg2','C2','2026-12-08')`) === 3000 && run(`priceOf('rg2','PCDO','2026-12-10')`) === 0,
    run(`db.facilities[0].codeMap`));
  t('S2: the facility stores the user\'s EXACT words, sourced as the user\'s',
    run(`db.facilities[0].rulesWords`) === WORDS && run(`db.facilities[0].rulesWordsSource`) === 'user',
    { w: run(`db.facilities[0].rulesWords`), s: run(`db.facilities[0].rulesWordsSource`) });
  run(`describeStates = {}; actions('describe-facility','rg2'); void facilitiesPage();`);
  t('S2: reopening shows the user\'s own words verbatim — never regenerated prose',
    run(`describeState('fac:rg2').text`) === WORDS && run(`describeState('fac:rg2').baselineSource`) === 'user',
    run(`describeState('fac:rg2').text`));
  const s2Snap = run(`facSnap('rg2')`);
  await run(`submitDescribe('fac:rg2')`);
  run(`confirmDescribe('fac:rg2')`);
  t('S2: saving the unedited own words is a no-op — card byte-identical, totals unchanged',
    run(`facSnap('rg2')`) === s2Snap && run(`priceOf('rg2','RG10','2026-12-09')`) === 2625);

  // ============ S3: one edited amount — diff callout + explicit confirm ============
  const EDITED = WORDS.replace('$3,000 on weekdays', '$3,200 on weekdays');
  run(`describeStates = {}; actions('describe-facility','rg2'); void facilitiesPage(); { const st = describeState('fac:rg2'); st.text = ${J(EDITED)}; }`);
  await run(`submitDescribe('fac:rg2')`);
  const s3 = run(`describeState('fac:rg2')`);
  t('S3: an edited re-parse computes the price diff — exactly one change (C2 weekday $3,000 → $3,200)',
    Array.isArray(s3.changes) && s3.changes.length === 1 && s3.changes[0].code === 'C2' &&
    s3.changes[0].oldWd === 3000 && s3.changes[0].newWd === 3200 && s3.changes[0].oldWe === 2000 && s3.changes[0].newWe === 2000,
    s3.changes);
  const s3Html = run(`describeRulesHTML('fac:rg2', { facName: 'Riverside General', codes: facilityDescribeCodes(db.facilities[0]), fac: db.facilities[0] })`);
  t('S3: the read-back calls the change out in words (was $3,000 — now $3,200), unchanged codes not re-listed',
    s3Html.includes('Heads up') && s3Html.includes('C2') && s3Html.includes('$3,000') && s3Html.includes('$3,200') && !/RG8[^\n]{0,120}was/.test(s3Html), s3Html.slice(s3Html.indexOf('Heads up') - 40, s3Html.indexOf('Heads up') + 320));
  run(`confirmDescribe('fac:rg2')`);
  t('S3: the first confirm tap does NOT apply a price change — it asks for the explicit second tap',
    run(`priceOf('rg2','C2','2026-12-08')`) === 3000 && run(`describeState('fac:rg2').ackChanges`) === true);
  run(`confirmDescribe('fac:rg2')`);
  t('S3: the second tap applies ONLY that change (C2 $3,200 · RG8 $2,000 · RG10 $2,625 · PCDO $0)',
    run(`priceOf('rg2','C2','2026-12-08')`) === 3200 && run(`priceOf('rg2','RG8','2026-12-07')`) === 2000 &&
    run(`priceOf('rg2','RG10','2026-12-09')`) === 2625 && run(`priceOf('rg2','PCDO','2026-12-10')`) === 0 &&
    run(`db.facilities[0].rulesWords`) === EDITED && run(`db.facilities[0].rulesWordsSource`) === 'user');

  // ============ S4: contract read — prose baseline, flagged contract ============
  const FIXTURE = ['Facility: Riverside General Hospital', 'Regular daily rate: $2,000', 'Premium hourly rate: $250', '1st call hourly rate: $175', '2nd call weeknight: $1,000', '2nd call weekend: $2,000'].join('\n');
  run(RESET + `facilityContractPreview = parseFacilityContract(${J(FIXTURE)}, 'addendum.pdf');
    facilityContractPreview.facilities[0].name = 'Riverside General';
    facilityContractPreview.facilities[0].rates = { hourlyRate: '250', paidHours8: '8.5', rate8: '2000' };`);
  run(`void facilityContractPreviewHTML();`);
  const prose = run(`contractRatesProse(facilityContractPreview.facilities[0])`);
  const s4St = run(`describeState('imp:facprev:0')`);
  t('S4: the contract preview box is baselined on the contract prose, flagged as contract-derived',
    s4St.text === prose && s4St.baselineSource === 'contract', { src: s4St.baselineSource, text: s4St.text, prose });
  await run(`submitDescribe('imp:facprev:0')`);
  t('S4: saving the contract prose UNEDITED does not re-parse it either',
    run(`describeState('imp:facprev:0').unchanged`) === true && run(`facilityContractPreview.facilities[0].describedParsed`) == null);
  run(`confirmDescribe('imp:facprev:0')`);
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`);
  t('S4: the saved facility carries the contract words, flagged contract (not the user\'s)',
    run(`db.facilities.length`) === 1 && run(`db.facilities[0].rulesWords`) === prose && run(`db.facilities[0].rulesWordsSource`) === 'contract' &&
    run(`db.facilities[0].hourlyRate`) === '250',
    { w: run(`db.facilities[0] && db.facilities[0].rulesWords`), s: run(`db.facilities[0] && db.facilities[0].rulesWordsSource`) });
  run(`describeStates = {}; actions('describe-facility', db.facilities[0].id); void facilitiesPage();`);
  t('S4: reopening that facility shows the contract sentences as the baseline',
    run(`describeState('fac:' + db.facilities[0].id).text`) === prose && run(`describeState('fac:' + db.facilities[0].id).baselineSource`) === 'contract',
    run(`describeState('fac:' + db.facilities[0].id).text`));
  const s4Snap = run(`facSnap(db.facilities[0].id)`);
  await run(`submitDescribe('fac:' + db.facilities[0].id)`);
  run(`confirmDescribe('fac:' + db.facilities[0].id)`);
  t('S4: an unedited re-save on the contract-built card is a byte-identical no-op',
    run(`facSnap(db.facilities[0].id)`) === s4Snap);
  t('sw: cache bumped', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v163'));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('FAILS:', fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2) });
