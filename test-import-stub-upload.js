// CRNA Hub — pay stub upload inside the import pay-schedule section,
// and the one-component convergence round (Nov 10, 2026, v110).
//
// Caleb (screenshot, QGenda import): the pay-schedule section —
// "Want paychecks for these shifts on your calendar?" — offered ONLY
// manual fields. "There should be a place to upload the paystub in
// this section." The section now carries the SAME upload component
// as the facility card and the general panel (one renderer —
// paystubUploadFormHTML — same labels, same layout, same button),
// running the SAME pipeline (runPaystubRead →
// paystubPreviewFromParsed), bound to the import: the stub's named
// payer wins for the agency, the schedule links to the import's
// facility, and a stub naming no payer defaults to the section's
// agency — stated in the section. (v131: the read lands in the
// section's own form — see the update note below — and the
// import's approve saves the one schedule from it.)
//
// Convergence pinned here too (Caleb's rule the same day: "anywhere
// we have redundancies they should all look and feel the same"):
// the stub upload form is byte-identical across panel / card /
// import modulo its form attributes and field ids, and the
// pay-schedule fields block renders one shared grid — identical
// label sequence and helper copy in the import section and on the
// facility card.
//
// v131 UPDATE (Nov 11, 2026, disclosed behavior change): the flow
// this file originally pinned — read → separate stub preview →
// approvePaystub → paySchedStubSaved stamp — stacked TWO data
// forms in the import preview (Caleb's live screenshots: the
// section's own fields kept their prefill while a second form
// below held the stub's payer with frequency and period empty,
// and the import's Save never read that form). The import-context
// flow is now: the read lands IN the section's one form (draft
// filled from the stub, gross/net as this check's actual, binding
// stated in the section's note), and the import's approve saves
// exactly ONE stub-backed schedule from that draft. The pins
// below assert that flow; the END-STATE pins (one schedule,
// Nov 10 actual $12,757.50, Nov 24 $27,075, headline $39,832.50)
// are unchanged. The full v131 pin set lives in
// test-v131-preview-surfaces.js.
// Run: node test-import-stub-upload.js
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

const FAC = `{id:'f1',name:'HOLZ',aliases:'Holzer',address:'100 Jackson Pike, Gallipolis, OH 45631',hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'',rate12:'',rate24:'4800',weekendRate24:'4200',rateSecond:'3000',weekendRateSecond:'2000',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}}`;
const PREMIER_TEXT = ['Employer: Premier Anesthesia Group, PC', 'Pay Period: 10/19/2026 - 11/01/2026', 'Pay Date: 11/10/2026', 'Gross Pay: $12,757.50'].join('\n');
const NOPAYER_TEXT = ['Pay Period: 10/19/2026 - 11/01/2026', 'Pay Date: 11/10/2026', 'Gross Pay: $12,757.50'].join('\n');
const NOV = [['2026-11-02', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-03', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-04', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-05', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-06', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-07', '24-hour call', 'HOLZ - Call 1', 24], ['2026-11-08', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-10', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-11', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-12', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-13', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-16', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-17', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-18', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-19', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-20', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-30', '8-hour day', 'HOLZ - G Main (8)', 8]];
function seedQgenda() {
  run(`db=empty();db.settings.scheduleName='Martin';db.facilities=[${FAC}];db.payStubs=[];tab='Facilities';`);
  const rows = NOV.map(([date, type, code, hours]) => ({ date, facility: 'HOLZ', type, code, hours, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed', incomplete: true }));
  run(`schedulePreview={fileName:'QGenda feed',source:'qgenda-feed',matchedName:'Martin',rows:${JSON.stringify(rows)},noNamesInFile:false,ai:false,parserVersion:6};scheduleImportContext='qgenda';paystubPreview=null;paystubError='';paystubStatus='';paystubCardFacId='';paystubImportCtx=null;`);
}
async function readStubFromSection(kind, text) {
  getEl('f_paystubImpFile_' + kind).files = [];
  getEl('f_paystubImpText_' + kind).value = text;
  await run(`importPaystubImport({preventDefault(){}},'${kind}')`);
}
function occNov() { return run(`paystubOccurrencesInMonth('2026-11').map(o=>({date:o.date,isActual:!!o.isActual,total:paystubOccurrenceAmount(o)}))`); }
function formOf(html, marker) {
  const i = html.indexOf(marker); if (i < 0) return '';
  const start = html.lastIndexOf('<form', i); const end = html.indexOf('</form>', i);
  return html.slice(start, end + 7);
}
function normalizeForm(f) {
  return f.replace(/<form[^>]*>/, '<form>').replace(/id="[^"]*"/g, 'id="X"').replace(/for="[^"]*"/g, 'for="X"');
}
function labelSeq(html) { return [...html.matchAll(/<label for="[^"]*">([^<]+)<\/label>/g)].map(m => m[1]); }

(async () => {
  // ---------- Convergence: ONE upload component, three surfaces ----------
  seedQgenda();
  const panelHTML = run(`facilitiesPage()`);
  const cardHTML = run(`paystubCardOpenFac='f1';facilitiesPage()`);
  const importHTML = run(`importPaySchedHTML(schedulePreview,'sched')`);
  const fPanel = formOf(panelHTML, 'id="paystubForm"');
  const fCard = formOf(cardHTML, 'paystubCardForm');
  const fImport = formOf(importHTML, 'paystubImportForm');
  t('conv: all three surfaces render the stub upload form', !!fPanel && !!fCard && !!fImport);
  t('conv: the form is IDENTICAL across panel / card / import (modulo form attrs + field ids)',
    normalizeForm(fPanel) === normalizeForm(fCard) && normalizeForm(fCard) === normalizeForm(fImport),
    normalizeForm(fPanel).slice(0, 120) + ' || ' + normalizeForm(fImport).slice(0, 120));
  t('conv: one shared intro sentence on panel and card', panelHTML.includes('One stub per agency — it sets the pay dates') && cardHTML.includes('One stub per agency — it sets the pay dates') && !cardHTML.includes('uploaded here, it sets the pay dates'));
  t('conv: import section carries the divider into the same component', importHTML.includes('— or upload a pay stub and we\'ll fill this in from it —'));

  // ---------- Convergence: ONE pay-schedule fields block ----------
  const cardSchedHTML = run(`db.facilities.push({id:'f2',name:'CAMC',aliases:'',address:'',hourlyRate:'250',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',rateSecond:'',weekendRateSecond:'',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}});db.shifts.push({id:'cx',date:'2026-11-05',facility:'CAMC',type:'8-hour day',code:'',pay:'2000',payUnit:'facility',status:'confirmed',source:'calendar-sync',sources:['calendar-sync'],incomplete:false,note:'',updatedAt:null});facilityPaySchedHTML(db.facilities[1])`);
  t('conv: card pay-schedule offer renders for a facility with shifts and no schedule', cardSchedHTML.includes('Want paychecks for CAMC on your calendar?'), cardSchedHTML.slice(0, 120));
  const six = ['Agency / employer', 'Facility (if it applies)', 'Pay frequency', 'A pay date you know (one real payday)', 'Pay period start (for that payday, if you know it)', 'Pay period end (for that payday, if you know it)'];
  t('conv: identical six-field label sequence in import section and on the card',
    JSON.stringify(labelSeq(importHTML).slice(0, 6)) === JSON.stringify(six) && JSON.stringify(labelSeq(cardSchedHTML).slice(0, 6)) === JSON.stringify(six),
    JSON.stringify(labelSeq(importHTML).slice(0, 6)) + ' vs ' + JSON.stringify(labelSeq(cardSchedHTML).slice(0, 6)));
  t('conv: the period helper line now appears on BOTH surfaces', importHTML.includes('The period dates anchor') && cardSchedHTML.includes('The period dates anchor'));
  t('conv: one shared intro sentence on both surfaces', importHTML.includes('Tell us how HOLZ pays you') && cardSchedHTML.includes('Tell us how CAMC pays you') && !cardSchedHTML.includes('These shifts have no pay schedule yet'));

  // ---------- (a) Caleb's flow: Premier stub from the QGenda section (v131: one form) ----------
  seedQgenda();
  const secA = run(`importPaySchedHTML(schedulePreview,'sched')`);
  t('(a) section renders with fields AND the stub upload', secA.includes('Want paychecks for these shifts on your calendar?') && secA.includes('paystubImportForm') && secA.includes('Skip — no pay schedule'));
  await readStubFromSection('sched', PREMIER_TEXT);
  t('(a) v131: NO separate stub preview — the read landed in the section\'s one form', run(`paystubPreview`) === null);
  const draftA = run(`schedulePreview.paySchedDraft`);
  t('(a) the form itself holds the stub: payer wins, facility linked, frequency + FULL period + amounts',
    !!draftA && draftA.agency === 'Premier Anesthesia Group, PC' && draftA.facility === 'HOLZ' && draftA.frequency === 'biweekly' && draftA.payDate === '2026-11-10' && draftA.periodStart === '2026-10-19' && draftA.periodEnd === '2026-11-01' && String(draftA.gross) === '12757.5', JSON.stringify(draftA));
  const secA2 = run(`importPaySchedHTML(schedulePreview,'sched')`);
  t('(a) the section renders exactly ONE form and states the binding in its note', !secA2.includes('f_payPrev_') && secA2.includes('Premier Anesthesia Group, PC as the payer') && secA2.includes('linked to HOLZ') && secA2.includes('Gross on this stub'), secA2.slice(0, 200));
  run(`approveScheduleImport()`);
  t('(a) import approve completes; exactly ONE stub-backed schedule saved (no double-save)',
    run(`db.payStubs.length`) === 1 && run(`db.shifts.length`) === 17 && run(`db.payStubs[0].agency`) === 'Premier Anesthesia Group, PC' && run(`db.payStubs[0].facility`) === 'HOLZ' && run(`db.payStubs[0].source`) === 'text-parse' && run(`db.payStubs[0].gross`) === '12757.5', JSON.stringify(run(`db.payStubs.map(s => ({ a: s.agency, src: s.source }))`)));
  const occA = occNov();
  t('(a) Nov 10 is the stub actual only — $12,757.50', occA.find(o => o.date === '2026-11-10').total === 12757.5 && occA.find(o => o.date === '2026-11-10').isActual === true);
  t('(a) Nov 24 estimate is $27,075 (8.5-paid-hour card)', occA.find(o => o.date === '2026-11-24').total === 27075, JSON.stringify(occA));
  t('(a) headline $39,832.50, one unified schedule', run(`monthHeadline('2026-11').gross`) === 39832.5 && run(`paystubSchedules().length`) === 1);

  // ---------- (b) schedule-upload flow: same section, same result ----------
  run(`db=empty();db.settings.scheduleName='Martin';db.facilities=[${FAC}];db.payStubs=[];tab='Facilities';paystubPreview=null;paystubError='';paystubStatus='';paystubCardFacId='';paystubImportCtx=null;`);
  const csv = ['Date,Name,Facility,Shift', '2026-11-02,Martin,HOLZ,8-hour day', '2026-11-03,Martin,HOLZ,Second call', '2026-11-07,Martin,HOLZ,24-hour call'].join('\n');
  run(`schedulePreview=parseScheduleText(${JSON.stringify(csv)},'sched.csv');scheduleImportContext='upload';`);
  const secB = run(`importPaySchedHTML(schedulePreview,'sched')`);
  t('(b) schedule-upload preview renders the same section with the upload', secB.includes('Want paychecks for these shifts on your calendar?') && secB.includes('paystubImportForm'));
  await readStubFromSection('sched', PREMIER_TEXT);
  t('(b) v131: the read landed in this import\'s form too (no separate preview)', run(`paystubPreview`) === null && run(`schedulePreview.paySchedDraft.agency`) === 'Premier Anesthesia Group, PC');
  run(`approveScheduleImport()`);
  t('(b) import completes with one stub-backed schedule (facility HOLZ); period prices (2125+3000+4200=9325 across Nov 2–8)',
    run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].facility`) === 'HOLZ' && run(`db.shifts.length`) === 3 && occNov().find(o => o.date === '2026-11-24').total === 9325, JSON.stringify(occNov()));

  // ---------- (e) no-payer stub: agency defaults to the section's ----------
  seedQgenda();
  await readStubFromSection('sched', NOPAYER_TEXT);
  t('(e) no payer named: the form\'s agency defaults to the section agency', run(`schedulePreview.paySchedDraft.agency`) === 'HOLZ' && run(`!!schedulePreview.paySchedStub`) === true && run(`schedulePreview.paySchedStub.agencyFromImport`) === true, JSON.stringify(run(`schedulePreview.paySchedDraft`)));
  const secE = run(`importPaySchedHTML(schedulePreview,'sched')`);
  t('(e) the section note says so', secE.includes('name a payer') && secE.includes('saved under HOLZ'), secE.slice(secE.indexOf('pay stub'), secE.indexOf('pay stub') + 300));

  // ---------- Edited after a stub read: the form's values win ----------
  // v131: there is no separate preview to discard — the read IS
  // form content, so the "abandon" of the old flow is now simply
  // editing every field by hand (amounts cleared included). The
  // saved record takes the edited values; only the provenance
  // remembers a stub filled the form first.
  seedQgenda();
  await readStubFromSection('sched', PREMIER_TEXT);
  run(`schedulePreview.paySchedDraft={agency:'Holzer',facility:'Holzer',frequency:'biweekly',payDate:'2026-11-10',periodStart:'2026-10-19',periodEnd:'2026-11-01',gross:'',net:''};`);
  run(`approveScheduleImport()`);
  t('edited: the form\'s values save exactly one schedule — edited agency, amounts cleared (no stub actual)',
    run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].agency`) === 'Holzer' && run(`db.payStubs[0].gross`) === '' && !occNov().some(o => o.date === '2026-11-10' && o.isActual) && occNov().find(o => o.date === '2026-11-24').total === 27075, JSON.stringify(run(`db.payStubs.map(s=>({a:s.agency,g:s.gross}))`)));

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
})();
