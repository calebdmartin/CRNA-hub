// CRNA Hub — v132 (Nov 11, 2026): paid-hours statements that name
// their SHIFT LENGTH were misread on every surface. Caleb's exact
// sentence in his Holzer preview text — "10.5 hours paid for 10
// hour shifts" — priced G Main (10) at hourly x 10 = $2,500
// instead of his confirmed rule (Holzer 10 = 10.5 paid hours x
// $250 = $2,625; Holzer 8 = 8.5 x $250 = $2,125). Mechanism
// (probe-proven on the pre-fix code, section A): the sentence
// rides into G Main (10)'s statement block, and the block's
// paid-hours pattern /paid (for)? N hours/ matched "paid for 10
// hour shifts" — capturing the shift LENGTH (10) as the paid
// hours and never seeing the 10.5 at all. The facility-level
// extractor had the same shape: an isolated "10.5 hours paid for
// 10 hour shifts" set paidHours8 = 10 (the duration, in the
// EIGHT-hour field). The fix generalizes the paid-hours grammar
// in the shared reader: a statement of the form "<paid> hours
// paid for <length> hour shifts" (in any of the natural word
// orders) binds <paid> to the day code(s) whose shift length is
// <length>; the old patterns can no longer capture a duration
// (a figure followed by "hour(s) shift(s)" is a length, not a
// paid-hours figure); a paid-hours figure whose length matches
// NO code in the universe surfaces in the read-back as
// unattached — named, never guessed, never silently dropped.
//
// Run: node test-v132-paid-hours.js
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
const J = (x) => JSON.stringify(x);

// Caleb's exact preview words (the v131 fixture).
const WORDS = [
  'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours',
  'Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200',
  'Holz-call 2=2nd call weekday=$3,000 weekend $2,000',
  'Holz-g main (10)=10hour day shift',
  '10.5 hours paid for 10 hour shifts',
  'Holz PCDO=post call day off=no pay',
  'Weekends only include Saturday and Sunday.',
].join('\n');
const ADDENDUM = [
  'Facility: Holzer Health',
  '100 Jackson Pike, Gallipolis, OH 45631',
  'Assignment schedule:',
  'December 1, 2026 - HOLZ - G Main (8)',
  'December 2, 2026 - HOLZ - PCDO',
  'December 3, 2026 - HOLZ - G Main (10)',
  'December 4, 2026 - HOLZ - Call 1',
  'December 5, 2026 - HOLZ - Call 2',
].join('\n');
const HOLZER_ENTRY = `
  facilityContractPreview.facilities[0].name = 'Holzer';
  facilityContractPreview.facilities[0].aliases = 'HOLZ';
  facilityContractPreview.facilities[0].rates = { hourlyRate: '250', paidHours8: '8', hourlyCall1st: '175', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000' };
`;
const RESET = `
  db = empty(); editId = null; facilitySuggestionPrefill = null;
  facilityContractPreview = null; facilityContractError = ''; facilityContractOcrStatus = '';
  facilityContractPendingImages = []; facilityContractOcrPages = []; facilityContractConfirmCreate = false;
  describeStates = {}; schedulePreview = null; calPreview = null; contractPreview = null;
  paystubPreview = null; paystubError = ''; paystubStatus = ''; paystubCardFacId = ''; paystubCardOpenFac = ''; paystubImportCtx = null;
`;
const CODES_HOLZ = `[{code:'HOLZ - G Main (8)',ctype:'8-hour day',hours:8},{code:'HOLZ - G Main (10)',ctype:'10-hour shift',hours:10},{code:'HOLZ - Call 1',ctype:'24-hour call',hours:24},{code:'HOLZ - Call 2',ctype:'Second call',hours:24},{code:'HOLZ - PCDO',ctype:'',hours:''}]`;

(async () => {
  // ================= A: mechanism probe (diagnostics) =================
  run(RESET);
  run(`window.__probeBlocks = describeCodeBlocks(${JSON.stringify(WORDS)}, ${CODES_HOLZ});`);
  run(`window.__probeParsed = describeParseLocal(${JSON.stringify(WORDS)}, null, ${CODES_HOLZ});`);
  const probeBlk = run(`window.__probeBlocks['HOLZ - G Main (10)']`);
  const probeDef = run(`window.__probeParsed.defs['HOLZ - G Main (10)']`);
  console.log('PROBE block paidHours for G Main (10): ' + J(probeBlk && probeBlk.paidHours));
  console.log('PROBE def for G Main (10): ' + J(probeDef));
  console.log('PROBE rates.paidHours8: ' + J(run(`window.__probeParsed.rates.paidHours8`)));
  console.log('PROBE summary: ' + run(`describeSummaryText('Holzer', window.__probeParsed, null)`));

  // ================= B: the phrasing battery =================
  // Each targeted phrasing, appended after both codes are defined,
  // must bind 10.5 to the 10-hour code ONLY (the 8 keeps its 8.5).
  const BASE = [
    'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours',
    'Holz-g main (10)=10hour day shift',
  ];
  const TARGETED = [
    '10.5 hours paid for 10 hour shifts',          // Caleb's exact sentence
    '10.5 hours paid on 10-hour shifts',
    '10.5 paid hours for 10 hour shifts',
    'paid 10.5 hours for 10-hour shifts',
    'paid for 10.5 hours on 10 hour shifts',
    '10 hour shifts are paid for 10.5 hours',
    '10-hour shifts are paid 10.5 hours',
    '10hr shifts pay 10.5 hours',
  ];
  for (const phrase of TARGETED) {
    run(RESET);
    run(`window.__p = describeParseLocal(${JSON.stringify(BASE.concat([phrase]).join('\n'))}, null, ${CODES_HOLZ});`);
    const d10 = run(`window.__p.defs['HOLZ - G Main (10)']`);
    const d8 = run(`window.__p.defs['HOLZ - G Main (8)']`);
    t('B targeted binds 10.5 to the 10-hour code: "' + phrase + '"',
      !!d10 && Number(d10.paidHours) === 10.5, J(d10));
    t('B targeted leaves the 8-hour code at its own 8.5: "' + phrase + '"',
      !!d8 && Number(d8.paidHours) === 8.5, J(d8));
  }
  // An 8-targeted statement binds the 8 even when it rides in
  // after the 10's line (carry-forward must not poison the 10).
  run(RESET);
  run(`window.__p = describeParseLocal(${JSON.stringify(['Holz-g main (8)=8hr day shift $250/hr', 'Holz-g main (10)=10hour day shift', '8.5 hours paid for 8 hour shifts'].join('\n'))}, null, ${CODES_HOLZ});`);
  t('B an 8-hour-targeted statement binds the 8 (8.5), not the code it rode in on',
    Number((run(`window.__p.defs['HOLZ - G Main (8)']`) || {}).paidHours) === 8.5 &&
    (run(`window.__p.defs['HOLZ - G Main (10)']`) || {}).paidHours == null,
    J(run(`window.__p.defs`)));
  t('B and the facility paidHours8 follows the targeted 8 statement on save',
    run(`window.__p.rates.paidHours8`) == null || Number(run(`window.__p.rates.paidHours8`)) === 8.5,
    J(run(`window.__p.rates`)));
  // Two codes can share a length (CAMC-style 5*/5** are both
  // 10-hour): a length statement binds every code of that length.
  run(RESET);
  run(`window.__p = describeParseLocal(${JSON.stringify('$250/hr\n5**=10hr shifts\n5*=10hr shifts\n10.5 hours paid for 10 hour shifts')}, null, [{code:'5**',ctype:'10-hour shift',hours:10},{code:'5*',ctype:'10-hour shift',hours:10}]);`);
  t('B a length statement binds EVERY day code of that length (5* and 5**)',
    Number((run(`window.__p.defs['5**']`) || {}).paidHours) === 10.5 &&
    Number((run(`window.__p.defs['5*']`) || {}).paidHours) === 10.5, J(run(`window.__p.defs`)));
  // Untargeted forms keep their existing semantics.
  run(RESET);
  run(`window.__p = describeParseLocal(${JSON.stringify('Holz-g main (10)=10hour day shift $250/hr, paid for 10.5 hours')}, null, ${CODES_HOLZ});`);
  t('B untargeted rider still binds its own code ("paid for 10.5 hours" attached)',
    Number((run(`window.__p.defs['HOLZ - G Main (10)']`) || {}).paidHours) === 10.5, J(run(`window.__p.defs['HOLZ - G Main (10)']`)));
  run(RESET);
  run(`window.__p = describeParseLocal(${JSON.stringify(['Holz-g main (10)=10hour day shift $250/hr', 'paid for 10.5 hours'].join('\n'))}, null, ${CODES_HOLZ});`);
  t('B untargeted carry-forward still binds the statement\'s code',
    Number((run(`window.__p.defs['HOLZ - G Main (10)']`) || {}).paidHours) === 10.5, J(run(`window.__p.defs['HOLZ - G Main (10)']`)));
  run(RESET);
  run(`window.__p = describeParseLocal(${JSON.stringify('Holz-g main (10)=10hour day shift, 10.5 paid hours, $250/hr')}, null, ${CODES_HOLZ});`);
  t('B "10.5 paid hours" still binds its own code',
    Number((run(`window.__p.defs['HOLZ - G Main (10)']`) || {}).paidHours) === 10.5, J(run(`window.__p.defs['HOLZ - G Main (10)']`)));

  // ================= C: guards =================
  run(RESET);
  run(`window.__p = describeParseLocal(${JSON.stringify('Holz-g main (10)=10hour day shift, paid $2,500 per shift')}, null, ${CODES_HOLZ});`);
  t('C "paid $2,500" is money, never paid hours',
    (run(`window.__p.defs['HOLZ - G Main (10)']`) || {}).paidHours == null, J(run(`window.__p.defs['HOLZ - G Main (10)']`)));
  // No code of that length in the universe: the figure surfaces
  // as unattached instead of being guessed onto another code.
  run(RESET);
  run(`window.__p = describeParseLocal(${JSON.stringify(['Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours', '10.5 hours paid for 10 hour shifts'].join('\n'))}, null, [{code:'HOLZ - G Main (8)',ctype:'8-hour day',hours:8}]);`);
  t('C a length with NO matching code surfaces as unattached (named in the read-back)',
    (run(`window.__p.unanswered`) || []).some(u => /10\.5/.test(u)), J(run(`window.__p.unanswered`)));
  t('C and it is NOT guessed onto the 8-hour code or the facility figure',
    Number((run(`window.__p.defs['HOLZ - G Main (8)']`) || {}).paidHours) === 8.5 &&
    Number(run(`window.__p.rates.paidHours8`)) === 8.5, J(run(`window.__p.defs['HOLZ - G Main (8)']`)) + ' ' + J(run(`window.__p.rates`)));
  // The contract-prose extractor: an isolated targeted sentence
  // must not file its LENGTH (or its paid figure) as paidHours8.
  const exT = run(`contractExtractRates('10.5 hours paid for 10 hour shifts')`);
  t('C contract prose: a targeted sentence alone sets NO paidHours8',
    exT.paidHours8 == null, J(exT));
  const exU = run(`contractExtractRates("Day shifts pay $250/hr, paid for 8.5 hours")`);
  t('C contract prose: the untargeted figure still lands ("paid for 8.5 hours")',
    exU.paidHours8 === 8.5 && exU.hourly === 250, J(exU));
  const exM = run(`contractExtractRates(${JSON.stringify(WORDS)})`);
  t('C contract prose on Caleb\'s full text: paidHours8 is the 8-hour figure, 8.5',
    exM.paidHours8 === 8.5, J(exM));

  // ================= D: Caleb's exact text through the preview =================
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY);
  run(`void facilityContractPreviewHTML();`);
  run(`{ const st = describeState('imp:facprev:0'); st.text = ${JSON.stringify(WORDS)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const pD = run(`describeState('imp:facprev:0').parsed`);
  t('D preview parse: G Main (10) carries paidHours 10.5 from his sentence',
    Number((pD.defs['HOLZ - G Main (10)'] || {}).paidHours) === 10.5, J(pD.defs['HOLZ - G Main (10)']));
  t('D preview parse: G Main (8) still carries 8.5, PCDO still unpaid, nothing unanswered',
    Number((pD.defs['HOLZ - G Main (8)'] || {}).paidHours) === 8.5 &&
    (pD.defs['HOLZ - PCDO'] || {}).unpaid === true && pD.unanswered.length === 0,
    J(pD.unanswered) + ' ' + J(pD.defs['HOLZ - G Main (8)']));
  const sD = run(`describeSummaryText('Holzer', describeState('imp:facprev:0').parsed, facPreviewOverlay(facilityContractPreview.facilities[0]))`);
  t('D read-back STATES the 10-hour paid hours and the $2,625 price',
    sD.includes('10.5 paid hours') && sD.includes('$2,625'), sD);
  t('D read-back keeps G Main (8) at $2,125 and Call 1 at $4,800/$4,200',
    sD.includes('$2,125') && sD.includes('$4,800 on weekdays, $4,200 on weekends'), sD);
  run(`confirmDescribe('imp:facprev:0')`);
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`);
  const pr8 = run(`resolveShiftPrice(db.facilities[0], { code: 'HOLZ - G Main (8)', type: 'HOLZ - G Main (8)', date: '2026-12-01' })`);
  const pr10 = run(`resolveShiftPrice(db.facilities[0], { code: 'HOLZ - G Main (10)', type: 'HOLZ - G Main (10)', date: '2026-12-03' })`);
  t('D after save: a G Main (8) shift prices $2,125', !!pr8 && Number(pr8.pay) === 2125, J(pr8));
  t('D after save: a G Main (10) shift prices $2,625 (was $2,500 pre-fix)', !!pr10 && Number(pr10.pay) === 2625, J(pr10));

  // ================= E: CAMC corpus unchanged =================
  run(RESET);
  run(`window.__camc = describeParseLocal('$250/hr\\n8=8hr shifts\\n10=10hr shifts\\n5* and 5**=10hr shifts\\n12=12 hr shifts', null, [{code:'8',ctype:'8-hour shift',hours:8},{code:'10',ctype:'10-hour shift',hours:10},{code:'5*',ctype:'10-hour shift',hours:10},{code:'5**',ctype:'10-hour shift',hours:10},{code:'12',ctype:'12-hour shift',hours:12}]);`);
  t('E CAMC text (no paid-hours statements) gains NO paid hours anywhere',
    ['8', '10', '5*', '5**', '12'].every(c => (run(`window.__camc.defs[${JSON.stringify(c)}]`) || {}).paidHours == null),
    J(run(`window.__camc.defs`)));

  // ================= F: money pins through the import path =================
  const FAC = `{id:'f1',name:'HOLZ',aliases:'Holzer',address:'100 Jackson Pike, Gallipolis, OH 45631',hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'',rate12:'',rate24:'4800',weekendRate24:'4200',rateSecond:'3000',weekendRateSecond:'2000',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}}`;
  const PREMIER_TEXT = ['Employer: Premier Anesthesia Group, PC', 'Pay Period: 10/19/2026 - 11/01/2026', 'Pay Date: 11/10/2026', 'Gross Pay: $12,757.50', 'Net Pay: $12,757.50'].join('\n');
  const NOV = [['2026-11-02', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-03', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-04', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-05', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-06', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-07', '24-hour call', 'HOLZ - Call 1', 24], ['2026-11-08', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-10', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-11', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-12', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-13', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-16', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-17', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-18', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-19', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-20', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-30', '8-hour day', 'HOLZ - G Main (8)', 8]];
  run(RESET + `db.settings.scheduleName='Martin';db.facilities=[${FAC}];db.payStubs=[];tab='Facilities';`);
  const rows = NOV.map(([date, type, code, hours]) => ({ date, facility: 'HOLZ', type, code, hours, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed', incomplete: true }));
  run(`schedulePreview={fileName:'QGenda feed',source:'qgenda-feed',matchedName:'Martin',rows:${JSON.stringify(rows)},noNamesInFile:false,ai:false,parserVersion:6};scheduleImportContext='qgenda';`);
  getEl('f_paystubImpFile_sched').files = [];
  getEl('f_paystubImpText_sched').value = PREMIER_TEXT;
  await run(`importPaystubImport({preventDefault(){}},'sched')`);
  run(`approveScheduleImport()`);
  const occ = run(`paystubOccurrencesInMonth('2026-11').map(o=>({date:o.date,isActual:!!o.isActual,total:paystubOccurrenceAmount(o)}))`);
  t('F Nov 10 stub actual $12,757.50 (estimate suppressed)',
    occ.find(o => o.date === '2026-11-10').total === 12757.5 && occ.find(o => o.date === '2026-11-10').isActual === true, J(occ));
  t('F Nov 24 paycheck $27,075 and November headline $39,832.50 — pins hold',
    occ.find(o => o.date === '2026-11-24').total === 27075 && run(`monthHeadline('2026-11').gross`) === 39832.5, J(occ));

  t('sw: cache bumped to v132', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v157'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
