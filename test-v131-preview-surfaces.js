// CRNA Hub — v131 (Nov 11, 2026): two defects on the CONTRACT /
// IMPORT PREVIEW surfaces, both reported live by Caleb within the
// hour.
//
// DEFECT 1 (~1:35 PM ET screenshot): his pay words in the Holzer
// contract preview resolved Call 1, Call 2, day shifts and the
// weekend — but the read-back still asked about "Holz PCDO",
// though the line "Holz PCDO=post call day off=no pay" resolves
// UNPAID on the facility card (v107) and his text states it
// outright. MECHANISM (proven by probe on the pre-fix code): the
// preview hands the words reader NO code universe at all —
// describeRulesHTML is called with codes:[] and facPreviewOverlay
// carries codeMap:{} — so the per-code machinery (the statement
// blocks, the unpaid classifier, per-code pay) never runs on this
// surface; only the facility-level extractors (contractExtractRates
// + describeCallAmounts, which need no universe) resolve, which is
// why the call money survived and PCDO — whose only expression is
// a code statement — fell to the unknown-subject net. With the
// contract's own codes handed in, the SAME reader resolves PCDO
// unpaid immediately: the name-form difference ("Holz PCDO" vs
// the document's "HOLZ - PCDO") was never the failure. The fix
// gives the preview the contract's code universe (extracted from
// the document's shift listing, plus the saved facility's codes
// when the entry resolves to one) and puts code identity on ONE
// normalization (codeIdentityKey + facility-prefix stripping), so
// a code binds the same way regardless of which surface spelled
// it — including at pricing time (a calendar-spelled shift code
// "Holzer PCDO" must find the def saved as "HOLZ - PCDO").
//
// DEFECT 2 (~1:39 PM ET screenshots): uploading a pay stub inside
// an import's pay-schedule section left TWO data forms stacked —
// the section's own fields (draft: agency "Holzer", etc.) and,
// below them, the separate stub-preview form holding the stub's
// values — divergent, and the stub's frequency/period never
// reached the form that the import's Save actually reads
// (applyImportPaySched reads ONLY the draft). The fix: in the
// import context a stub read lands IN the section's one form —
// stub-stated values fill the draft (payer wins for the agency,
// facility stays linked, frequency derived from the period when
// unstated), gross/net appear in that same form as this check's
// actual, no second form renders, and the import's Save stores
// exactly ONE stub-backed schedule. Card + general-panel stub
// flows keep the shared preview component exactly as before.
//
// Run: node test-v131-preview-surfaces.js
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

// Caleb's exact preview words (Nov 11, 2026 ~1:35 PM ET screenshot
// text, full canonical version incl. the added 10-hour lines).
const WORDS = [
  'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours',
  'Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200',
  'Holz-call 2=2nd call weekday=$3,000 weekend $2,000',
  'Holz-g main (10)=10hour day shift',
  '10.5 hours paid for 10 hour shifts',
  'Holz PCDO=post call day off=no pay',
  'Weekends only include Saturday and Sunday.',
].join('\n');
// The Holzer addendum, shaped as the document reads: header, then
// the assignment listing naming the facility's codes in the
// document's own spelling ("HOLZ - ...", the QGenda task names).
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
// The addendum's extracted rates, as the live read filled them
// (the v125/v129 harness pattern — the rate prose extraction is
// pinned elsewhere; this round is about the code universe).
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

(async () => {
  // ================= DEFECT 1 =================
  // ---------- D1a: the preview entry carries the document's codes ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY);
  const docCodes = run(`(facilityContractPreview.facilities[0].codes || []).map(c => c.code)`);
  t('D1a the contract extraction hands the preview the codes the document names',
    ['HOLZ - G Main (8)', 'HOLZ - G Main (10)', 'HOLZ - Call 1', 'HOLZ - Call 2', 'HOLZ - PCDO'].every(c => (docCodes || []).includes(c)),
    J(docCodes));

  // ---------- D1b: Caleb's exact words through the preview path ----------
  run(`void facilityContractPreviewHTML();`);
  run(`{ const st = describeState('imp:facprev:0'); st.text = ${JSON.stringify(WORDS)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const p1 = run(`describeState('imp:facprev:0').parsed`);
  t('D1b preview parse resolves PCDO to an UNPAID definition',
    !!(p1 && p1.defs['HOLZ - PCDO'] && p1.defs['HOLZ - PCDO'].unpaid === true), J(p1 && p1.defs['HOLZ - PCDO']));
  t('D1b PCDO label keeps his meaning, denial trimmed',
    (p1 && p1.defs['HOLZ - PCDO'] || {}).label === 'post call day off', J(p1 && p1.defs['HOLZ - PCDO']));
  t('D1b nothing is left unanswered (no "still don\'t know" — PCDO least of all)',
    !!p1 && p1.unanswered.length === 0, J(p1 && p1.unanswered));
  const s1 = run(`describeSummaryText('Holzer', describeState('imp:facprev:0').parsed, facPreviewOverlay(facilityContractPreview.facilities[0]))`);
  t('D1b read-back states PCDO as no pay',
    s1.includes('“HOLZ - PCDO”: no pay — post call day off.'), s1);
  t('D1b read-back keeps Call 1 $4,800/$4,200 and G Main (8) at $2,125 (the whole universe audited)',
    s1.includes('“HOLZ - Call 1” (1st call): $4,800 on weekdays, $4,200 on weekends') && s1.includes('$2,125'), s1);
  t('D1b read-back never prices PCDO', !s1.includes('“HOLZ - PCDO” (8-hour day)'), s1);

  // ---------- D1c: the chained-equals denial alone, preview path ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY);
  run(`void facilityContractPreviewHTML();`);
  run(`{ const st = describeState('imp:facprev:0'); st.text = 'Holz PCDO=post call day off=no pay'; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const p2 = run(`describeState('imp:facprev:0').parsed`);
  t('D1c "Holz PCDO=post call day off=no pay" alone resolves UNPAID through the preview',
    !!(p2 && p2.defs['HOLZ - PCDO'] && p2.defs['HOLZ - PCDO'].unpaid === true), J(p2 && p2.defs));
  t('D1c and never lands in the unanswered list under either spelling',
    !!p2 && !p2.unanswered.some(u => /pcdo/i.test(u)), J(p2 && p2.unanswered));

  // ---------- D1d: confirm + Save — the def lands and prices both spellings ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY);
  run(`void facilityContractPreviewHTML();`);
  run(`{ const st = describeState('imp:facprev:0'); st.text = ${JSON.stringify(WORDS)}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  run(`confirmDescribe('imp:facprev:0')`);
  await run(`approveFacilityContract()`); await run(`approveFacilityContract()`);
  const savedDef = run(`(db.facilities[0] && db.facilities[0].codeMap && db.facilities[0].codeMap['HOLZ - PCDO']) || null`);
  t('D1d the saved facility carries the PCDO definition, unpaid, under the document spelling',
    !!savedDef && savedDef.unpaid === true, J(savedDef));
  const priceDoc = run(`resolveShiftPrice(db.facilities[0], { code: 'HOLZ - PCDO', type: 'HOLZ - PCDO', date: '2026-12-02' })`);
  const priceCal = run(`resolveShiftPrice(db.facilities[0], { code: 'Holzer PCDO', type: 'Holzer PCDO', date: '2026-12-02' })`);
  t('D1d a shift coded with the document spelling prices $0 settled (unpaid)',
    !!priceDoc && priceDoc.pay === '0' && priceDoc.payUnit === 'unpaid', J(priceDoc));
  t('D1d a shift coded with the CALENDAR spelling ("Holzer PCDO") finds the same def — one identity',
    !!priceCal && priceCal.pay === '0' && priceCal.payUnit === 'unpaid', J(priceCal));

  // ---------- D1e: one universe entry per code on the card, any spelling ----------
  run(RESET + `db.facilities = [{ id: 'hz', name: 'Holzer', aliases: 'HOLZ', hourlyRate: '250', codeMap: { 'HOLZ - PCDO': { label: 'post call day off', unpaid: true, rulesConfirmed: true, viaWords: true } } }];
    db.shifts = [{ id: 's1', facility: 'Holzer', code: 'Holzer PCDO', type: 'Holzer PCDO', date: '2026-12-02', status: 'confirmed', pay: '' }];`);
  const uni = run(`facilityDescribeCodes(db.facilities[0]).map(c => c.code)`);
  t('D1e the card universe lists PCDO once, though the def and the shift spell it differently',
    (uni || []).filter(c => /pcdo/i.test(c)).length === 1, J(uni));

  // ---------- D1f: the net still asks about a genuinely unknown code ----------
  run(RESET + `facilityContractPreview = parseFacilityContract(${JSON.stringify(ADDENDUM)}, 'addendum.pdf');` + HOLZER_ENTRY);
  run(`void facilityContractPreviewHTML();`);
  run(`{ const st = describeState('imp:facprev:0'); st.text = ${JSON.stringify(WORDS + '\nHolz XYZ9=9hr shifts')}; }`);
  await run(`submitDescribe('imp:facprev:0')`);
  const p6 = run(`describeState('imp:facprev:0').parsed`);
  t('D1f a code nobody knows is still NAMED and asked about (the net is intact)',
    !!p6 && p6.unanswered.some(u => /XYZ9/.test(u)) && !p6.unanswered.some(u => /pcdo/i.test(u)), J(p6 && p6.unanswered));

  // ================= DEFECT 2 =================
  const FAC = `{id:'f1',name:'HOLZ',aliases:'Holzer',address:'100 Jackson Pike, Gallipolis, OH 45631',hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'',rate12:'',rate24:'4800',weekendRate24:'4200',rateSecond:'3000',weekendRateSecond:'2000',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}}`;
  const PREMIER_TEXT = ['Employer: Premier Anesthesia Group, PC', 'Pay Period: 10/19/2026 - 11/01/2026', 'Pay Date: 11/10/2026', 'Gross Pay: $12,757.50', 'Net Pay: $12,757.50'].join('\n');
  const NOV = [['2026-11-02', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-03', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-04', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-05', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-06', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-07', '24-hour call', 'HOLZ - Call 1', 24], ['2026-11-08', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-10', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-11', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-12', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-13', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-16', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-17', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-18', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-19', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-20', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-30', '8-hour day', 'HOLZ - G Main (8)', 8]];
  const seedQgenda = () => {
    run(RESET + `db.settings.scheduleName='Martin';db.facilities=[${FAC}];db.payStubs=[];tab='Facilities';`);
    const rows = NOV.map(([date, type, code, hours]) => ({ date, facility: 'HOLZ', type, code, hours, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed', incomplete: true }));
    run(`schedulePreview={fileName:'QGenda feed',source:'qgenda-feed',matchedName:'Martin',rows:${JSON.stringify(rows)},noNamesInFile:false,ai:false,parserVersion:6};scheduleImportContext='qgenda';`);
  };
  const readStub = async (kind, text) => {
    getEl('f_paystubImpFile_' + kind).files = [];
    getEl('f_paystubImpText_' + kind).value = text;
    await run(`importPaystubImport({preventDefault(){}},'${kind}')`);
  };
  const occNov = () => run(`paystubOccurrencesInMonth('2026-11').map(o=>({date:o.date,isActual:!!o.isActual,total:paystubOccurrenceAmount(o)}))`);

  // ---------- D2a: the section before any stub ----------
  seedQgenda();
  const sec0 = run(`importPaySchedHTML(schedulePreview,'sched')`);
  t('D2a the section renders its one form plus the stub upload',
    sec0.includes('impPaySched_sched_agency') && sec0.includes('paystubImportForm') && !sec0.includes('f_payPrev_'), sec0.slice(0, 160));

  // ---------- D2b: the stub read lands IN the one form ----------
  await readStub('sched', PREMIER_TEXT);
  t('D2b no separate stub preview exists after an import-context read',
    run(`paystubPreview`) === null, J(run(`paystubPreview && paystubPreview.agency`)));
  const sec1 = run(`importPaySchedHTML(schedulePreview,'sched')`);
  t('D2b the section renders exactly ONE data form (no f_payPrev_* fields stacked under it)',
    !sec1.includes('f_payPrev_') && (sec1.match(/id="impPaySched_sched_agency"/g) || []).length === 1, '');
  const draft = run(`schedulePreview.paySchedDraft`);
  t('D2b the stub filled THE form: payer agency, linked facility, derived frequency, pay date, FULL period',
    !!draft && draft.agency === 'Premier Anesthesia Group, PC' && draft.facility === 'HOLZ' &&
    draft.frequency === 'biweekly' && draft.payDate === '2026-11-10' &&
    draft.periodStart === '2026-10-19' && draft.periodEnd === '2026-11-01', J(draft));
  t('D2b the stub gross/net are in that same form as this check\'s actual',
    !!draft && String(draft.gross) === '12757.5' && String(draft.net) === '12757.5' &&
    sec1.includes('Gross on this stub') && sec1.includes('value="12757.5"'), J(draft));
  t('D2b the section says where the values came from (stub names Premier; schedule linked to HOLZ)',
    sec1.includes('Premier Anesthesia Group, PC as the payer') && sec1.includes('linked to HOLZ'), sec1.slice(sec1.indexOf('pay stub'), sec1.indexOf('pay stub') + 320));

  // ---------- D2c: the user's edits in the one form win ----------
  run(`schedulePreview.paySchedDraft = schedulePreview.paySchedDraft || {}; schedulePreview.paySchedDraft.net = '12000';`);
  run(`approveScheduleImport()`);
  t('D2c the import saves exactly ONE schedule, stub-backed, with the user\'s edit kept',
    run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].agency`) === 'Premier Anesthesia Group, PC' &&
    run(`db.payStubs[0].facility`) === 'HOLZ' && run(`db.payStubs[0].frequency`) === 'biweekly' &&
    run(`db.payStubs[0].gross`) === '12757.5' && run(`db.payStubs[0].net`) === '12000' &&
    run(`db.payStubs[0].source`) === 'text-parse', J(run(`db.payStubs`)));
  const occ = occNov();
  t('D2c Nov 10 shows ONLY the stub actual $12,757.50 (estimate suppressed)',
    occ.find(o => o.date === '2026-11-10').total === 12757.5 && occ.find(o => o.date === '2026-11-10').isActual === true, J(occ));
  t('D2c Nov 24 estimate $27,075 and headline $39,832.50 (money pins through the new path)',
    occ.find(o => o.date === '2026-11-24').total === 27075 && run(`monthHeadline('2026-11').gross`) === 39832.5, J(occ));

  // ---------- D2d: an AI-shaped read lands the same way ----------
  seedQgenda();
  run(`paystubImportCtx = { kind: 'sched', agency: 'HOLZ', facility: 'HOLZ' };`);
  run(`applyAiToPaystubPreview({ paystub: { employer: 'Premier Anesthesia Group, PC', pay_date: '2026-11-10', period_start: '2026-10-19', period_end: '2026-11-01', gross_pay: 12757.5, net_pay: 12757.5 } }, 'stub.jpg')`);
  const draftAI = run(`schedulePreview.paySchedDraft`);
  t('D2d the AI read also lands in the one form (frequency derived from the period)',
    run(`paystubPreview`) === null && !!draftAI && draftAI.agency === 'Premier Anesthesia Group, PC' &&
    draftAI.frequency === 'biweekly' && draftAI.periodStart === '2026-10-19' && draftAI.periodEnd === '2026-11-01' &&
    String(draftAI.gross) === '12757.5', J(draftAI));

  // ---------- D2e: no stub — the manual form saves exactly as before ----------
  seedQgenda();
  run(`schedulePreview.paySchedDraft = { agency: 'Holzer', facility: 'Holzer', frequency: 'biweekly', payDate: '2026-11-10', periodStart: '2026-10-19', periodEnd: '2026-11-01' };`);
  run(`approveScheduleImport()`);
  t('D2e manual fields alone still save one plain import schedule (no stub amounts)',
    run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].source`) === 'import' && run(`db.payStubs[0].gross`) === '', J(run(`db.payStubs.map(s => ({ a: s.agency, src: s.source }))`)));

  // ---------- D2f: card + general stub flows keep the shared preview ----------
  run(RESET + `db.facilities=[${FAC}];db.payStubs=[];tab='Facilities';`);
  getEl('f_paystubCardFile_f1').files = [];
  getEl('f_paystubCardText_f1').value = PREMIER_TEXT;
  await run(`importPaystubCard({preventDefault(){}},'f1')`);
  t('D2f a card-started read still produces the shared stub preview, bound to the card',
    run(`!!paystubPreview`) === true && run(`paystubPreview.cardFacId`) === 'f1' &&
    run(`paystubPreviewHTML()`).includes('f_payPrev_agency'), J(run(`paystubPreview && paystubPreview.agency`)));
  run(`approvePaystub()`);
  t('D2f the card flow still saves its one schedule (Premier / HOLZ, Nov 10 actual)',
    run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].agency`) === 'Premier Anesthesia Group, PC' &&
    occNov().find(o => o.date === '2026-11-10').total === 12757.5, J(run(`db.payStubs.map(s => s.agency)`)));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
