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

(async () => {
  const lastAlert = () => alerts[alerts.length - 1] || '';
  const mkRow = (o) => Object.assign({date:'2026-12-07', facility:'CAMC', type:'8-hour day', pay:'', name:'Martin', matchedName:'Martin', match:'matched', include:true, duplicate:false, flags:[], source:'schedule-import'}, o || {});
  const mkPreview = (rows, extra) => Object.assign({fileName:'sched.csv', matchedName:'Martin', source:'schedule-import', rows}, extra || {});

  // ---------- Case 1: pay unit — hourly converts, daily is the default total ----------
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[{id:'f1',name:'CAMC',aliases:'',address:'',hourlyRate:'',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyCall1st:'',callBonus:'',weekendRate24:'',weekendRateSecond:'',distance:'',notes:''}]; db.shifts=[]; persist();`);
  run(`schedulePreview = ${JSON.stringify(mkPreview([mkRow({pay:'250'})]))};`);
  t('pay-unit control renders in the schedule preview', run(`schedulePreviewHTML().includes('previewPayUnit')`));
  t('default unit is labelled per-shift total', run(`schedulePreviewHTML().includes('Pay ($ per shift)')`));
  run(`schedulePreview.payUnit='hourly';`);
  t('hourly unit relabels the Pay header', run(`schedulePreviewHTML().includes('Pay ($/hr)')`));
  run(`approveScheduleImport();`);
  t('hourly 250 x 8h lands as a 2000 total', run(`db.shifts.length`) === 1 && run(`db.shifts[0].pay`) === '2000');
  t('the entered rate + unit persist on the shift', run(`db.shifts[0].payRate`) === '250' && run(`db.shifts[0].payUnit`) === 'hourly');

  run(`db = empty(); db.facilities=[{id:'f1',name:'CAMC',aliases:'',hourlyRate:'',rate8:''}]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({type:'12-hour shift', pay:'100'})]))}; schedulePreview.payUnit='hourly'; approveScheduleImport();`);
  t('hourly 100 x 12h lands as 1200', run(`db.shifts[0].pay`) === '1200' && run(`db.shifts[0].payUnit`) === 'hourly');

  run(`db = empty(); db.facilities=[{id:'f1',name:'CAMC',aliases:'',hourlyRate:'',rate8:''}]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({pay:'2000'})]))}; approveScheduleImport();`);
  t('daily (default) keeps the typed amount as the shift total', run(`db.shifts[0].pay`) === '2000' && run(`db.shifts[0].payUnit`) === 'daily' && run(`db.shifts[0].payRate`) === '2000');

  // ---------- Case 2:  // ---------- Case 2: narrow clarification — fresh account, grid codes ----------
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({facility:'', type:'5**', code:'5**'}), mkRow({facility:'', type:'5*', code:'5*', date:'2026-12-08'})]))}; schedulePreview.facilityAll='CAMC';`);
  const html2 = run(`schedulePreviewHTML()`);
  // Nov 9, 2026 (evening): clarification is ONE describe-in-words
  // box — it lists the codes on this schedule and the user answers
  // in sentences. No per-code fields, no separate hourly box.
  t('prompt appears for a brand-new facility', html2.includes('First time at CAMC') && html2.includes('Skip for now'));
  t('prompt lists ONLY the codes on this schedule', html2.includes('5**') && html2.includes('5*') && !html2.includes('importRateEdit') && !html2.includes('Weekend 24-hour call rate'));
  t('prompt is ONE words box, not a field grid', (html2.match(/describeText/g) || []).length === 1 && html2.includes('Make my rules') && !html2.includes('clarifyCode') && !html2.includes('clarifyHourly'));
  run(`schedulePreview.describe={text:"5** is an 8-hour day shift. Day shifts pay $250/hr and I'm paid for 8.5 hours.",parsed:describeParseLocal("5** is an 8-hour day shift. Day shifts pay $250/hr and I'm paid for 8.5 hours.",null,unclarifiedCodes(schedulePreview,importRatesTarget(schedulePreview))),confirmed:true}; approveScheduleImport();`);
  // In the words model the 8.5 lives where it belongs — the PAID
  // hours (what prices the shift); the definition keeps the label
  // the user stated, in their words.
  t('facility is created with the hourly rate + the code definition', run(`db.facilities.length`) === 1 && run(`db.facilities[0].hourlyRate`) === '250' && run(`db.facilities[0].codeMap['5**'].label`) === '8-hour day shift' && run(`db.facilities[0].codeMap['5**'].paidHours`) === '8.5');
  t('the clarified code prices immediately (250 x 8.5) and takes its label', run(`db.shifts.length`) === 2 && run(`db.shifts[0].pay`) === '2125' && run(`db.shifts[0].type`) === '8-hour day shift' && run(`db.shifts[0].payUnit`) === 'facility' && run(`db.shifts[0].incomplete`) === false);
  // payUnit note (Nov 9, 2026): the label "8-hour day shift" names a
  // canonical type, so clarified pricing now routes through the
  // facility rule (hourly x paidHours8 — the same 250 x 8.5 = 2125)
  // and stamps 'facility' instead of 'hourly'. Both markers are
  // derived pays for the reprice pass; the amount is unchanged.
  t('partial clarification: the untouched code stays unpriced, approval not blocked', run(`db.shifts[1].pay`) === '' && run(`db.shifts[1].incomplete`) === true && run(`db.shifts[1].type`) === '5*');
  t('approval message says rates were saved', lastAlert().includes('Rates saved for CAMC'));

  // ---------- Case 2b: second import of a known code — no re-prompt, auto-prices ----------
  run(`schedulePreview = ${JSON.stringify(mkPreview([mkRow({facility:'CAMC', type:'5**', code:'5**', date:'2026-12-09'})]))};`);
  t('a known code does not re-prompt', !run(`schedulePreviewHTML().includes('First time at')`));
  run(`approveScheduleImport();`);
  t('the known code prices automatically from the saved definition', run(`db.shifts.length`) === 3 && run(`db.shifts[2].pay`) === '2125' && run(`db.shifts[2].type`) === '8-hour day shift');

  // ---------- Case 3: no prompt when the facility already prices the rows ----------
  run(`db = empty(); db.facilities=[{id:'f1',name:'CAMC',aliases:'',hourlyRate:'250',rate8:'2000'}]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({})]))};`);
  t('no clarification prompt for an already-priced facility', !run(`schedulePreviewHTML().includes('First time at')`));
  run(`approveScheduleImport();`);
  t('blank pay still prices from the saved facility rates', run(`db.shifts[0].pay`) === '2000');

  // ---------- Case 4: saved facility with NO rates — prompt lists the row type, hourly alone suffices ----------
  run(`db = empty(); db.facilities=[{id:'f1',name:'CAMC',aliases:'',hourlyRate:'',rate8:''}]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({})]))};`);
  const html4 = run(`schedulePreviewHTML()`);
  t('prompt appears for a saved facility with no rates, listing only the type present', html4.includes('First time at CAMC') && html4.includes('8-hour day') && !html4.includes('5**'));
  run(`schedulePreview.describe={text:"Day shifts pay $250/hr.",parsed:describeParseLocal("Day shifts pay $250/hr.",facilityByNameOrAlias('CAMC'),unclarifiedCodes(schedulePreview,importRatesTarget(schedulePreview))),confirmed:true}; approveScheduleImport();`);
  t('hourly rate merges onto the existing facility (no duplicate)', run(`db.facilities.length`) === 1 && run(`db.facilities[0].hourlyRate`) === '250');
  t('shift prices from the just-entered hourly rate', run(`db.shifts[0].pay`) === '2000');

  // ---------- Case 5: skip path — unpriced, explained, never nags again ----------
  run(`db = empty(); db.facilities=[]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({facility:'', type:'5**', code:'5**'})]))}; schedulePreview.facilityAll='Mercer';`);
  run(`actions('import-rates-skip','sched');`);
  t('skip dismisses the prompt', !run(`schedulePreviewHTML().includes('First time at')`));
  run(`approveScheduleImport();`);
  t('skipped shifts land named but unpriced', run(`db.shifts.length`) === 1 && run(`db.shifts[0].facility`) === 'Mercer' && run(`db.shifts[0].pay`) === '' && run(`db.shifts[0].incomplete`) === true);
  t('approval message explains rates can be set later on Facilities', lastAlert().includes('No rates for Mercer yet') && lastAlert().includes('Facilities tab'));
  t('the created facility remembers the skip', run(`db.facilities[0].ratesPromptSkipped`) === true);
  run(`schedulePreview = ${JSON.stringify(mkPreview([mkRow({facility:'Mercer', type:'5**', code:'5**', date:'2026-12-08'})]))};`);
  t('a later import for the same facility does not nag', !run(`schedulePreviewHTML().includes('First time at')`));

  // ---------- Case 6: QGenda parity (shared preview + approve) ----------
  run(`db = empty(); db.facilities=[]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({facility:'', type:'5*', code:'5*', source:'qgenda-feed'})], {fileName:'QGenda feed', source:'qgenda-feed'}))}; schedulePreview.facilityAll='CAMC';`);
  t('QGenda preview shows the pay-unit control and the narrow prompt', run(`schedulePreviewHTML().includes('previewPayUnit') && schedulePreviewHTML().includes('First time at CAMC') && schedulePreviewHTML().includes('5*')`));
  run(`schedulePreview.describe={text:"5* is a 10-hour shift. Day shifts pay $250/hr.",parsed:describeParseLocal("5* is a 10-hour shift. Day shifts pay $250/hr.",null,unclarifiedCodes(schedulePreview,importRatesTarget(schedulePreview))),confirmed:true}; approveScheduleImport();`);
  t('QGenda shifts price from the clarification', run(`db.shifts.length`) === 1 && run(`db.shifts[0].pay`) === '2500' && run(`db.shifts[0].type`) === '10-hour shift' && run(`db.facilities[0].codeMap['5*'].hours`) === '10');

  // ---------- Case 7: .ics preview parity ----------
  run(`db = empty(); db.facilities=[]; db.shifts=[]; persist();
       calPreview = {fileName:'cal.ics', sourceLabel:'Calendar file', sourceCode:'calendar-file', rows:[{date:'2026-12-07', facility:'CAMC', type:'8-hour day', pay:'', flags:[], include:true, duplicate:false, source:'calendar-file', note:'Imported from Calendar file (.ics): cal.ics'}]};`);
  t('.ics preview shows the pay-unit control and the narrow prompt', run(`calPreviewHTML().includes('previewPayUnit') && calPreviewHTML().includes('First time at CAMC') && calPreviewHTML().includes('8-hour day')`));
  run(`calPreview.describe={text:"Day shifts pay $250/hr.",parsed:describeParseLocal("Day shifts pay $250/hr.",null,unclarifiedCodes(calPreview,importRatesTarget(calPreview))),confirmed:true}; approveCalendarImport();`);
  t('.ics approve creates the facility with the hourly rate and prices the shift', run(`db.facilities.length`) === 1 && run(`db.facilities[0].hourlyRate`) === '250' && run(`db.shifts.length`) === 1 && run(`db.shifts[0].pay`) === '2000');

  // ---------- Case 8: contract flow — clarify ONLY what the read extracted ----------
  run(`db = empty(); db.facilities=[{id:'f1',name:'CAMC',aliases:'',hourlyRate:'',rate8:''}]; db.shifts=[]; db.contracts=[]; persist();
       facilityContractPreview = { fileName:'camc.pdf', isPhoto:false, aiRead:true, contract:{id:'ct-n', facility:'CAMC', rates:{hourlyRate:'250', rate8:'2000'}}, facilities:[{include:true, name:'CAMC', aliases:'', address:'', effectiveStart:'', effectiveEnd:'', rates:{hourlyRate:'250', rate8:'2000'}, found:['Hourly rate $250.00','8-hour shift rate $2,000.00'], missing:['10-hour shift rate','12-hour shift rate','24-hour call rate','1st call hourly rate','Second call rate','Overnight call bonus','Weekend 24-hour call rate','Weekend second call rate','Paid hours for an 8-hour shift'], unreadable:[]}] };
       facilityContractPendingImages = []; facilityContractConfirmCreate = false;`);
  const html8 = run(`facilityContractPreviewHTML()`);
  // v123 expectation change (Caleb, Nov 11, 2026 — disclosed, not
  // silent): the per-line clarification grids ("What is this
  // rate?" selector + $ input per extracted line) are REPLACED by
  // the describe-in-your-own-words box, prefilled with the
  // extracted rates as plain sentences. Correcting a rate is now
  // editing the prose and re-making the rules; the full flow is
  // pinned in test-v123-import-preview-words.js.
  t('contract preview clarifies through the words box, not field grids', html8.includes('Pay rules at CAMC — in your words') && html8.includes('Make my rules') && !html8.includes('facContractKind') && !html8.includes('What is this rate?') && !html8.includes('f_facPrev_0_hourlyRate') && !html8.includes('f_facPrev_0_rate8'));
  t('words box is prefilled with the extracted rates as sentences', html8.includes('Day shifts pay $250/hr') && html8.includes('An 8-hour shift pays $2,000 per shift.'));
  t('contract lines the read never mentioned never appear in the prose', !/10-hour shift pays/.test(html8) && !/12-hour shift pays/.test(html8) && !/Call 1 is/.test(html8) && !/Call 2 is/.test(html8) && !html8.includes('Overnight call bonus is'));
  run(`facilityContractPreview.facilities[0].rates.rate8 = '2100';`);
  await run(`approveFacilityContract()`);
  t('confirm/correct saves only the extracted rates onto the facility', run(`db.facilities.length`) === 1 && run(`db.facilities[0].rate8`) === '2100' && run(`db.facilities[0].hourlyRate`) === '250' && run(`db.facilities[0].rate24 == null || db.facilities[0].rate24 === ''`));
  t('the corrected contract rates price shifts', run(`facilityPayFor(db.facilities[0],'8-hour day','2026-12-07')`) === 2100);

  console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL PASS');
})();
