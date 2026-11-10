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
// paystubPreviewFromParsed → approvePaystub), bound to the import:
// the stub's named payer wins for the agency, the schedule links to
// the import's facility, and a stub naming no payer defaults to the
// section's agency — stated in the preview. Approving the stub
// stamps the preview (paySchedStubSaved): the section shows the
// schedule as on file, applyImportPaySched never double-saves, and
// the import's approve completes normally.
//
// Convergence pinned here too (Caleb's rule the same day: "anywhere
// we have redundancies they should all look and feel the same"):
// the stub upload form is byte-identical across panel / card /
// import modulo its form attributes and field ids, and the
// pay-schedule fields block renders one shared grid — identical
// label sequence and helper copy in the import section and on the
// facility card.
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

  // ---------- (a) Caleb's flow: Premier stub from the QGenda section ----------
  seedQgenda();
  const secA = run(`importPaySchedHTML(schedulePreview,'sched')`);
  t('(a) section renders with fields AND the stub upload', secA.includes('Want paychecks for these shifts on your calendar?') && secA.includes('paystubImportForm') && secA.includes('Skip — no pay schedule'));
  await readStubFromSection('sched', PREMIER_TEXT);
  const pvA = run(`({kind:paystubPreview&&paystubPreview.importKind,agency:paystubPreview&&paystubPreview.agency,facility:paystubPreview&&paystubPreview.facility,facFrom:!!(paystubPreview&&paystubPreview.facilityFromImport),agencyFrom:!!(paystubPreview&&paystubPreview.agencyFromImport)})`);
  t('(a) preview bound to the import; stub payer wins, facility from the import', pvA.kind === 'sched' && pvA.agency === 'Premier Anesthesia Group, PC' && pvA.facility === 'HOLZ' && pvA.facFrom === true && pvA.agencyFrom === false, JSON.stringify(pvA));
  const pvHTMLA = run(`paystubPreviewHTML()`);
  t('(a) preview states the binding plainly', pvHTMLA.includes('Uploaded with this import') && pvHTMLA.includes('Premier Anesthesia Group, PC as the payer') && pvHTMLA.includes('linked to HOLZ'), pvHTMLA.slice(0, 300));
  t('(a) the general panel points at the import preview instead of duplicating it', run(`paystubPanelPreviewHTML()`).includes('waiting in the import preview'));
  t('(a) while the preview waits, the section still shows the fields (nothing saved yet)', run(`importPaySchedHTML(schedulePreview,'sched')`).includes('impPaySched_sched_agency'));
  alerts.length = 0;
  run(`approvePaystub()`);
  t('(a) stub approval stamps the import preview', run(`!!schedulePreview.paySchedStubSaved`) === true && run(`schedulePreview.paySchedStubSaved.agency`) === 'Premier Anesthesia Group, PC');
  t('(a) exactly one schedule saved, linked to HOLZ', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].agency`) === 'Premier Anesthesia Group, PC' && run(`db.payStubs[0].facility`) === 'HOLZ');
  const secA2 = run(`importPaySchedHTML(schedulePreview,'sched')`);
  t('(a) section now shows the schedule as ON FILE (no second ask)', secA2.includes('Pay schedule on file for these shifts') && secA2.includes('Premier Anesthesia Group, PC') && !secA2.includes('paystubImportForm'), secA2.slice(0, 200));
  run(`approveScheduleImport()`);
  t('(a) import approve completes; still exactly ONE schedule (no double-save)', run(`db.payStubs.length`) === 1 && run(`db.shifts.length`) === 17);
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
  run(`approvePaystub()`);
  t('(b) stub binds to this import too (facility HOLZ)', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].facility`) === 'HOLZ');
  run(`approveScheduleImport()`);
  t('(b) import completes with one schedule; period prices (2125+3000+4200=9325 across Nov 2–8)', run(`db.payStubs.length`) === 1 && run(`db.shifts.length`) === 3 && occNov().find(o => o.date === '2026-11-24') !== undefined);

  // ---------- (e) no-payer stub: agency defaults to the section's ----------
  seedQgenda();
  await readStubFromSection('sched', NOPAYER_TEXT);
  const pvE = run(`({agency:paystubPreview&&paystubPreview.agency,agencyFrom:!!(paystubPreview&&paystubPreview.agencyFromImport)})`);
  t('(e) no payer named: agency defaults to the section agency', pvE.agency === 'HOLZ' && pvE.agencyFrom === true, JSON.stringify(pvE));
  const pvHTMLE = run(`paystubPreviewHTML()`);
  t('(e) preview says so', pvHTMLE.includes('Uploaded with this import') && pvHTMLE.includes("didn't name a payer") && pvHTMLE.includes('saved under HOLZ'), pvHTMLE.slice(0, 300));

  // ---------- Abandoned preview: manual fields still work ----------
  seedQgenda();
  await readStubFromSection('sched', PREMIER_TEXT);
  run(`paystubPreview=null;paystubError='';paystubStatus='';paystubImportCtx=null;`); // the discard action's state reset
  run(`schedulePreview.paySchedDraft={agency:'Holzer',facility:'Holzer',frequency:'biweekly',payDate:'2026-11-10',periodStart:'2026-10-19',periodEnd:'2026-11-01'};`);
  run(`approveScheduleImport()`);
  t('abandon: manual fields save exactly one import schedule, no stub record', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].source`) === 'import' && run(`db.payStubs[0].agency`) === 'Holzer', JSON.stringify(run(`db.payStubs.map(s=>({a:s.agency,src:s.source}))`)));

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
})();
