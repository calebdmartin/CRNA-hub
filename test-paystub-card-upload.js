// CRNA Hub — pay stub upload on a facility's own card (Nov 10, 2026).
//
// Caleb: "Under facilities I entered the pay rules but I would like
// to be able to upload the pay stub in that section as well." Each
// My-facilities card gains an "Upload a pay stub" section running
// the SAME pipeline as the general panel (same reader, preview and
// approve — no second implementation). A card-started read is
// BOUND to that facility: the stub read still names the payer
// (Premier Anesthesia Group, PC), but the saved schedule's facility
// is the card's (HOLZ), so read-time unification and shift claims
// link it to that facility — never a second unlinked schedule for
// the same facility (the Nov 9 agency-string bug shape). A stub
// naming no payer defaults the schedule's agency to the card's
// facility, and the preview says so either way.
//
// Also pinned here (Caleb, same day): the Facilities panel order —
// contract, pay stub, QGenda, Upload a schedule, and "Add a
// facility manually" LAST (manual entry is the backup path).
// Run: node test-paystub-card-upload.js
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

const FAC = `{ id:'f1', name:'HOLZ', aliases:'Holzer', address:'100 Jackson Pike, Gallipolis, OH 45631', hourlyRate:'250', paidHours8:'8.5', rate8:'2125', rate10:'2625', rateSecond:'3000', weekendRateSecond:'2000', rate24:'4800', weekendRate24:'4200', hourlyCall1st:'175', callBonus:'' }`;
const sh = (id, date, type, code, pay) => ({ id, date, facility: 'HOLZ', type, code, pay, status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], note: '', updatedAt: null });
const SHIFTS = [
  sh('s1', '2026-10-24', '24-hour call', 'HOLZ - Call 1', '4200'),
  sh('s2', '2026-10-27', '24-hour call', 'HOLZ - Call 1', '4800'),
  sh('s3', '2026-11-01', 'Second call', 'HOLZ - Call 2', '2000'),
  ...['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d, i) => sh('g' + i, d, '8-hour day', 'HOLZ - G Main (8)', '2125')),
  sh('s4', '2026-11-03', 'Second call', 'HOLZ - Call 2', '3000'),
  sh('s5', '2026-11-06', 'Second call', 'HOLZ - Call 2', '3000'),
  sh('s6', '2026-11-08', 'Second call', 'HOLZ - Call 2', '2000'),
  sh('s7', '2026-11-07', '24-hour call', 'HOLZ - Call 1', '4200'),
  sh('s8', '2026-11-30', '8-hour day', 'HOLZ - G Main (8)', '2125'),
];
const PREMIER_TEXT = ['Employer: Premier Anesthesia Group, PC', 'Pay Period: 10/19/2026 - 11/01/2026', 'Pay Date: 11/10/2026', 'Gross Pay: $12,757.50'].join('\n');
const NOAGENCY_TEXT = ['Pay Period: 10/19/2026 - 11/01/2026', 'Pay Date: 11/10/2026', 'Gross Pay: $12,757.50'].join('\n');
const LATER_TEXT = ['Employer: Premier Anesthesia Group, PC', 'Pay Period: 11/16/2026 - 11/29/2026', 'Pay Date: 12/08/2026', 'Gross Pay: $10,900.00'].join('\n');
const IMPORT_REC = `{ id:'ps-import', agency:'HOLZ', facility:'HOLZ', frequency:'biweekly', periodStart:'2026-11-02', periodEnd:'2026-11-15', payDate:'2026-11-24', gross:'', net:'', source:'import', fileName:'' }`;

function seed(records) {
  run(`db = empty(); db.settings.scheduleName = 'Martin';
    db.facilities = [${FAC}];
    db.shifts = ${JSON.stringify(SHIFTS)};
    db.payStubs = [${(records || []).join(',')}];
    paystubPreview = null; paystubError = ''; paystubStatus = ''; paystubCardFacId = ''; paystubCardOpenFac = '';
    persist();`);
}
function assertNovember(label) {
  const occ = run(`paystubOccurrencesInMonth('2026-11')`);
  t(label + ': November has exactly two paychecks', occ.length === 2, occ.map((o) => o.date).join(','));
  const n10 = occ.find((o) => o.date === '2026-11-10') || {};
  t(label + ': Nov 10 is the stub actual only — $12,757.50', n10.isActual === true && n10.actual === 12757.5, JSON.stringify(n10));
  const n24 = occ.find((o) => o.date === '2026-11-24') || {};
  t(label + ': Nov 24 estimate prices off the card — $27,075', n24.isActual === false && n24.total === 27075, JSON.stringify(n24));
  const h = run(`monthHeadline('2026-11')`);
  t(label + ': headline $39,832.50, counted once', h.gross === 39832.5 && h.paychecks === 2 && h.anyActual === true, JSON.stringify(h));
  t(label + ': exactly ONE unified schedule', run(`paystubSchedules().length`) === 1);
}

(async () => {
  // ---------- Card UI: toggle, collapsed default, feature off ----------
  seed([]);
  const page = run(`facilitiesPage()`);
  // v129 (Nov 11, 2026): the card's stub upload is a collapsible
  // panel under its own header — "Upload a pay stub (optional)",
  // the general panel's pattern — instead of a toggle button.
  // The three pins below changed shape with it (the toggle
  // action is gone; collapsed now means a closed <details>, its
  // body in the DOM but shut, exactly like every other panel).
  t('card carries the collapsible "Upload a pay stub (optional)" header', page.includes('id="paystub-card-f1"') && page.includes('Upload a pay stub (optional)') && page.includes('collapse-title'));
  t('card upload section is collapsed by default (details not open)', !page.includes('id="paystub-card-f1" open'));
  t('no pay-schedule line on the card before any stub', !page.includes('Pay schedule: '));
  const opened = run(`paystubCardOpenFac = 'f1'; facilitiesPage()`);
  t('open card section renders its own form (file + paste text + Read)', opened.includes('id="paystub-card-f1" open') && opened.includes('paystubCardForm') && opened.includes('id="f_paystubCardFile_f1"') && opened.includes('id="f_paystubCardText_f1"') && opened.includes('Read my pay stub'));
  t('open card section says the stub is never stored', opened.includes('The stub itself is never stored.'));
  run(`paystubCardOpenFac = ''; db.settings.featurePaychecks = false;`);
  const offSection = run(`paystubCardSectionHTML(db.facilities[0])`);
  t('feature off: card entry point collapses to the off line with a Turn on button',
    offSection.includes('Paycheck estimates are off') && offSection.includes('data-action="feature-toggle"') && !offSection.includes('paystub-card-f1'));
  t('feature off: no pay-schedule line on the card', run(`facilityPaystubLineHTML(db.facilities[0])`) === '');
  run(`db.settings.featurePaychecks = true;`);

  // ---------- Facilities panel order (manual add LAST) ----------
  const ordered = run(`facilitiesPage()`);
  const idx = (s) => ordered.indexOf(s);
  t('panel order: contract < pay stub < QGenda < upload a schedule < manual add (LAST)',
    idx('id="facility-contract-panel"') > -1 &&
    idx('id="facility-contract-panel"') < idx('id="paystub-panel"') &&
    idx('id="paystub-panel"') < idx('id="qgenda-panel"') &&
    idx('id="qgenda-panel"') < idx('id="schedule-import-panel"') &&
    idx('id="schedule-import-panel"') < idx('id="facility-manual-panel"'));
  t('manual panel still renders once, fully formed', (ordered.match(/id="facility-manual-panel"/g) || []).length === 1 && ordered.includes('Add a facility manually') && ordered.includes('Hospital / facility name'));

  // ---------- (a) Caleb's flow: Premier stub from the HOLZ card ----------
  seed([]);
  run(`paystubCardFacId = 'f1';
    paystubPreview = paystubPreviewFromParsed(parsePaystubText(${JSON.stringify(PREMIER_TEXT)}), 'stub.txt', 'test', false);
    globalThis.__pv = { cardFacId: paystubPreview.cardFacId, agency: paystubPreview.agency, facility: paystubPreview.facility, facilityFromCard: !!paystubPreview.facilityFromCard, agencyFromCard: !!paystubPreview.agencyFromCard };`);
  t('(a) preview is bound to the HOLZ card', sandbox.__pv.cardFacId === 'f1');
  t('(a) stub payer wins; facility defaults from the card', sandbox.__pv.agency === 'Premier Anesthesia Group, PC' && sandbox.__pv.facility === 'HOLZ' && sandbox.__pv.facilityFromCard === true && sandbox.__pv.agencyFromCard === false, JSON.stringify(sandbox.__pv));
  const pvHTML = run(`paystubPreviewHTML()`);
  t('(a) preview states the payer AND the card it came from', pvHTML.includes('Uploaded from the HOLZ card') && pvHTML.includes('Premier Anesthesia Group, PC as the payer') && pvHTML.includes('linked to HOLZ'), pvHTML.slice(0, 400));
  const panelPv = run(`paystubPanelPreviewHTML()`);
  t('(a) general panel points at the card instead of duplicating the preview', panelPv.includes('waiting on the HOLZ card above') && !panelPv.includes('f_payPrev_agency'));
  run(`approvePaystub(); globalThis.__rec = db.payStubs[0] || null; globalThis.__ctx = paystubCardFacId;`);
  t('(a) approve saves ONE record: payer from the stub, facility = the card', !!sandbox.__rec && run(`db.payStubs.length`) === 1 && sandbox.__rec.agency === 'Premier Anesthesia Group, PC' && sandbox.__rec.facility === 'HOLZ' && sandbox.__rec.gross === '12757.5' && !('cardFacId' in sandbox.__rec), JSON.stringify(sandbox.__rec));
  t('(a) card context cleared after save', sandbox.__ctx === '');
  assertNovember('(a)');
  const line = run(`facilityPaystubLineHTML(db.facilities[0])`);
  t('(a) card now shows its pay schedule + stub on file', line.includes('Pay schedule: Premier Anesthesia Group, PC') && line.includes('pay stub on file') && line.includes('$12,757.50'), line);

  // ---------- (a2) same upload with an import-time schedule already on file ----------
  seed([IMPORT_REC]);
  run(`paystubCardFacId = 'f1';
    paystubPreview = paystubPreviewFromParsed(parsePaystubText(${JSON.stringify(PREMIER_TEXT)}), 'stub.txt', 'test', false);
    approvePaystub();`);
  t('(a2) both stored records remain (import + stub)', run(`db.payStubs.length`) === 2);
  assertNovember('(a2)');

  // ---------- (b) stub naming NO payer, from the card ----------
  seed([]);
  run(`paystubCardFacId = 'f1';
    paystubPreview = paystubPreviewFromParsed(parsePaystubText(${JSON.stringify(NOAGENCY_TEXT)}), 'stub.txt', 'test', false);
    globalThis.__pv2 = { agency: paystubPreview.agency, agencyFromCard: !!paystubPreview.agencyFromCard, facility: paystubPreview.facility };`);
  t('(b) payer defaults to the card facility and is flagged as such', sandbox.__pv2.agency === 'HOLZ' && sandbox.__pv2.agencyFromCard === true && sandbox.__pv2.facility === 'HOLZ', JSON.stringify(sandbox.__pv2));
  const pv2HTML = run(`paystubPreviewHTML()`);
  t('(b) preview says the stub named no payer and the schedule uses HOLZ', pv2HTML.includes('Uploaded from the HOLZ card') && pv2HTML.includes('saved under HOLZ'), pv2HTML.slice(0, 400));
  run(`approvePaystub();`);
  t('(b) saved schedule belongs to HOLZ', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].agency`) === 'HOLZ' && run(`db.payStubs[0].facility`) === 'HOLZ');
  assertNovember('(b)');

  // ---------- (c) second stub from the same card, later period ----------
  // Continues from (a)'s state: the Premier record is on file (reseeded
  // here), then a later Premier stub arrives from the same card.
  seed([]);
  run(`paystubCardFacId = 'f1';
    paystubPreview = paystubPreviewFromParsed(parsePaystubText(${JSON.stringify(PREMIER_TEXT)}), 'stub.txt', 'test', false);
    approvePaystub();
    paystubCardFacId = 'f1';
    paystubPreview = paystubPreviewFromParsed(parsePaystubText(${JSON.stringify(LATER_TEXT)}), 'stub2.txt', 'test', false);
    approvePaystub();`);
  t('(c) still one stored record for the payer (replaced, actual carried)', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].gross`) === '10900' && run(`db.payStubs[0].payDate`) === '2026-12-08');
  t('(c) still one unified schedule', run(`paystubSchedules().length`) === 1);
  const dec8 = (run(`paystubOccurrencesInMonth('2026-12')`).find((o) => o.date === '2026-12-08') || {});
  t('(c) Dec 8 shows the new stub actual $10,900', dec8.isActual === true && dec8.actual === 10900, JSON.stringify(dec8));
  const n10c = (run(`paystubOccurrencesInMonth('2026-11')`).find((o) => o.date === '2026-11-10') || {});
  t('(c) Nov 10 still shows its $12,757.50 actual (carried, not lost)', n10c.isActual === true && n10c.actual === 12757.5, JSON.stringify(n10c));

  // ---------- (d) general panel flow unchanged (no card context) ----------
  seed([]);
  run(`paystubPreview = paystubPreviewFromParsed(parsePaystubText(${JSON.stringify(PREMIER_TEXT)}), 'stub.txt', 'test', false);
    globalThis.__pv3 = { cardFacId: paystubPreview.cardFacId || '', facility: paystubPreview.facility };`);
  t('(d) general read carries no card binding and no facility default', sandbox.__pv3.cardFacId === '' && sandbox.__pv3.facility === '');
  t('(d) general panel renders the preview itself', run(`paystubPanelPreviewHTML()`).includes('f_payPrev_agency'));
  run(`approvePaystub();`);
  t('(d) saved record keeps the legacy shape (facility blank)', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].facility`) === '');
  assertNovember('(d)');

  console.log(fails ? ('FAILURES: ' + fails) : 'ALL PASS');
})();
