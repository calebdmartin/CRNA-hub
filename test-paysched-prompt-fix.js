// Pay-schedule prompt — Caleb's live report, Nov 8 2026 ~9:16 AM ET:
// "The calendar looks good now. But it didn't prompt me to add a pay
// schedule." Diagnosis: his CAMC approve ran under v92 — v93 (the
// build carrying the section) was committed at 9:12:59 AM ET, AFTER
// his 9:05 AM screenshot already showed the imported shifts. The
// R0–R3 checks below reproduce his EXACT flow (grid/band photo read
// on a FRESH account: zero facilities, zero pay stubs; rows carry
// grid codes and "check this one" flags; the facility comes ONLY from
// the schedule-level "Which facility is this schedule for?" answer,
// typed: CAMC; the facility does not exist yet at preview time) and
// prove the v93 gating already shows the section in that flow. The
// fix this file guards is the RECOVERY path (R5+): a facility with
// shifts but no pay schedule gets the same offer on its own card in
// My facilities, plus the approval message points there, and a stale
// read banner no longer survives an approve.
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
  // Fresh account: no facilities, no stubs, no shifts. Schedule name Martin.
  run(`db = empty(); db.settings.scheduleName = 'Martin'; db.facilities = []; db.payStubs = []; db.shifts = []; persist();`);
  // Grid/band read rows exactly as applyAiToSchedulePreview builds them:
  // facility blank, type = the grid code, "check this one" flags on
  // disagreed cells, matched + included.
  const gridRow = (date, code, check) => ({date, facility: '', type: code, code, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: ['grid code "' + code + '" — not a known shift type; saved as-is, unpriced (rename it here if you know it)'].concat(check ? ['check this one — the two reads of this photo disagreed here'] : []), source: 'schedule-import-ai', incomplete: true});
  const rows = [gridRow('2026-12-01', '5**', true), gridRow('2026-12-02', '5*', true), gridRow('2026-12-03', '5**', false), gridRow('2026-12-05', '7', false)];
  run(`schedulePreview = {fileName: 'camc-grid.jpg', source: 'schedule-import-ai', matchedName: 'Martin', rows: ${JSON.stringify(rows)}, noNamesInFile: false, ai: true};`);

  const html0 = run(`schedulePreviewHTML()`);
  t('R0 preview renders the facility question', html0.includes('Which facility is this schedule for?'));
  t('R0 no agency resolvable before the facility answer (section not yet shown)', !html0.includes('Want paychecks for these shifts'));

  // He types CAMC into the schedule-level field — the change handler
  // sets facilityAll and re-renders.
  run(`schedulePreview.facilityAll = 'CAMC';`);
  const html1 = run(`schedulePreviewHTML()`);
  t('R1 pay-schedule section APPEARS after the CAMC answer', html1.includes('Want paychecks for these shifts on your calendar?'), html1.includes('impPaySched') ? 'fields present' : 'SECTION MISSING');
  t('R1 ctx resolves agency CAMC', run(`importPaySchedCtx(schedulePreview, 'sched').agency`) === 'CAMC');
  t('R1 target not suppressed (no stub, no dismissal)', run(`importPaySchedTarget(schedulePreview, 'sched') !== null`));

  // Re-renders (ticking a row off/on) must not drop the section.
  run(`schedulePreview.rows[1].include = false;`);
  t('R2 section survives a row untick re-render', run(`schedulePreviewHTML()`).includes('Want paychecks for these shifts'));
  run(`schedulePreview.rows[1].include = true;`);
  t('R2 section survives a row tick re-render', run(`schedulePreviewHTML()`).includes('Want paychecks for these shifts'));

  // Approve with the section left blank (he never saw/filled it):
  // shifts import, CAMC facility is created, no schedule exists.
  run(`scheduleAiStatus = 'Close-up read of your row, double-checked: 2 cell(s) the reads could not agree on are flagged "check this one" in the preview.';`);
  run(`approveScheduleImport();`);
  t('R3 shifts imported', run(`db.shifts.length`) === 4);
  t('R3 CAMC facility created at approve', run(`(db.facilities || []).some(f => f.name === 'CAMC')`));
  t('R3 no pay schedule exists for CAMC', run(`paystubForAgency('CAMC')`) === null);
  t('R4 stale read banner cleared by approve (no more banner over "No schedule parsed yet")', run(`scheduleAiStatus`) === '');
  t('R4 approve message points at the facility card for later', /No pay schedule for CAMC yet — add one any time on its card on the Facilities tab/.test(alerts[alerts.length - 1] || ''), alerts[alerts.length - 1]);

  // ============ RECOVERY: the facility card offers the schedule ============
  const facId = run(`db.facilities.find(f => f.name === 'CAMC').id`);
  const card0 = run(`myFacilitiesHTML()`);
  t('R5 CAMC card carries the pay-schedule offer', card0.includes('Want paychecks for CAMC on your calendar?') && card0.includes('facPaySched') && card0.includes('facility-paysched-save'));
  run(`facPaySchedDrafts['${facId}'] = {agency: 'CAMC', facility: 'CAMC', frequency: 'biweekly', payDate: '2026-12-22', periodStart: '2026-11-30', periodEnd: '2026-12-13'};`);
  run(`actions('facility-paysched-save', '${facId}');`);
  t('R5 saving from the card stores one pay schedule', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].agency`) === 'CAMC' && run(`db.payStubs[0].source`) === 'facility-card');
  const occR = run(`paystubOccurrencesInMonth('2026-12')`);
  t('R5 engine generates CAMC paychecks from the card-saved schedule', Array.isArray(occR) && occR.some(o => o.periodStart <= '2026-12-01' && o.periodEnd >= '2026-12-01'), JSON.stringify(occR && occR.map(o => [o.date, o.periodStart, o.periodEnd])));
  t('R5 offer disappears once a schedule exists', !run(`myFacilitiesHTML()`).includes('Want paychecks for CAMC on your calendar?'));

  // Dismissal on the card silences BOTH surfaces (shared per-agency key).
  run(`db = empty(); db.settings.scheduleName = 'Martin'; db.payStubs = []; db.facilities = [{id: 'f-camc', name: 'CAMC', aliases: '', address: '', hourlyRate: '', paidHours8: '', rate8: '2000', rate10: '', rate12: '', rate24: '', rateSecond: '', hourlyCall1st: '', callBonus: '', weekendRate24: '', weekendRateSecond: '', distance: '', notes: ''}]; db.shifts = [{id: 'sx', date: '2026-12-01', facility: 'CAMC', type: '8-hour day', pay: '2000', status: 'confirmed'}]; persist();`);
  t('R6 offer present before dismissal', run(`myFacilitiesHTML()`).includes('Want paychecks for CAMC on your calendar?'));
  run(`actions('facility-paysched-dismiss', 'f-camc');`);
  t('R6 No thanks removes the card offer', !run(`myFacilitiesHTML()`).includes('Want paychecks for CAMC on your calendar?'));
  run(`schedulePreview = {fileName: 's.csv', matchedName: 'Martin', source: 'schedule-import', rows: [{date: '2026-12-07', facility: 'CAMC', type: '8-hour day', pay: '2000', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'schedule-import'}]};`);
  t('R6 the same dismissal silences the import-preview section', !run(`schedulePreviewHTML()`).includes('Want paychecks for these shifts'));

  // Coverage by the stub's FACILITY field counts (agency name differs).
  run(`db = empty(); db.payStubs = [{id: 'p1', agency: 'Some Agency LLC', facility: 'CAMC', frequency: 'biweekly', payDate: '2026-12-22', periodStart: '', periodEnd: '', gross: '', net: '', source: 'stub'}]; db.facilities = [{id: 'f-camc', name: 'CAMC', aliases: '', address: '', hourlyRate: '', paidHours8: '', rate8: '2000', rate10: '', rate12: '', rate24: '', rateSecond: '', hourlyCall1st: '', callBonus: '', weekendRate24: '', weekendRateSecond: '', distance: '', notes: ''}]; db.shifts = [{id: 'sx', date: '2026-12-01', facility: 'CAMC', type: '8-hour day', pay: '2000', status: 'confirmed'}]; persist();`);
  t('R7 a stub naming the facility covers it (no offer)', !run(`myFacilitiesHTML()`).includes('Want paychecks for CAMC on your calendar?'));

  // A facility with NO shifts gets no offer — nothing to pay yet.
  run(`db = empty(); db.payStubs = []; db.facilities = [{id: 'f-camc', name: 'CAMC', aliases: '', address: '', hourlyRate: '', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', rateSecond: '', hourlyCall1st: '', callBonus: '', weekendRate24: '', weekendRateSecond: '', distance: '', notes: ''}]; db.shifts = []; persist();`);
  t('R8 no offer for a facility with no shifts', !run(`myFacilitiesHTML()`).includes('Want paychecks for CAMC on your calendar?'));

  console.log(fails ? ('\n' + fails + ' check(s) failed') : '\nAll checks passed');
})();
