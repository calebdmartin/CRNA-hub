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
run(`const blankFac = (name) => ({id:'f-' + name, name, aliases:'', address:'', hourlyRate:'', paidHours8:'', rate8:'2000', rate10:'', rate12:'', rate24:'', rateSecond:'', hourlyCall1st:'', callBonus:'', weekendRate24:'', weekendRateSecond:'', distance:'', notes:''});`);
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) { fails++; process.exitCode = 1; } };

(async () => {
  const lastAlert = () => alerts[alerts.length - 1] || '';
  const mkRow = (o) => Object.assign({date:'2026-12-07', facility:'CAMC', type:'8-hour day', pay:'', name:'Martin', matchedName:'Martin', match:'matched', include:true, duplicate:false, flags:[], source:'schedule-import'}, o || {});
  const mkPreview = (rows, extra) => Object.assign({fileName:'sched.csv', matchedName:'Martin', source:'schedule-import', rows}, extra || {});
  const blankFac = (name) => ({id:'f-' + name, name, aliases:'', address:'', hourlyRate:'', paidHours8:'', rate8:'2000', rate10:'', rate12:'', rate24:'', rateSecond:'', hourlyCall1st:'', callBonus:'', weekendRate24:'', weekendRateSecond:'', distance:'', notes:''});

  // ================= CHANGE A: chip = code only =================
  // A1: clarified code — the shift's type became the clarified label,
  // but the chip must show the CODE, never the label.
  run(`db = empty(); db.shifts=[{id:'s1', date:'2026-12-01', facility:'CAMC', type:'8-hour day shift', code:'5**', pay:'2125', status:'confirmed'}]; persist();`);
  t('A1 clarified code: chip is the code, not the label', run(`shiftChipLabel(db.shifts[0])`) === '5**');
  run(`db.shifts[0].code='7';`);
  t('A1b chip follows the stored code', run(`shiftChipLabel(db.shifts[0])`) === '7');

  // A2: legacy shift with NO stored code but a type that IS a clarified
  // label resolves back to the code through the facility codeMap.
  run(`db = empty(); db.facilities=[{id:'f1', name:'CAMC', aliases:'', address:'', hourlyRate:'', paidHours8:'', rate8:'2000', rate10:'', rate12:'', rate24:'', rateSecond:'', hourlyCall1st:'', callBonus:'', weekendRate24:'', weekendRateSecond:'', distance:'', notes:'', codeMap:{'5**':{label:'8-hour day shift', hours:'8.5'}}}];
       db.shifts=[{id:'s2', date:'2026-12-01', facility:'CAMC', type:'8-hour day shift', pay:'2125', status:'confirmed'}]; persist();`);
  t('A2 legacy shift resolves its code via the facility codeMap', run(`shiftChipLabel(db.shifts[0])`) === '5**');

  // A3: codeless shift (calendar sync / manual) shows its short type alone.
  run(`db = empty(); db.shifts=[{id:'s3', date:'2026-12-02', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed'}]; persist();`);
  t('A3 codeless shift shows short type', run(`shiftChipLabel(db.shifts[0])`) === '8-hour day');

  // A4: the paragraph case from Caleb's screenshot — a long prose type
  // with times + a rate + call notes collapses to just what the shift is.
  run(`db.shifts=[{id:'s4', date:'2026-12-03', facility:'CAMC', type:'7am-5pm $250/hr. On call from 5pm-7pm only paid if hours worked.', pay:'2500', status:'confirmed'}]; persist();`);
  const chip4 = run(`shiftChipLabel(db.shifts[0])`);
  t('A4 prose type collapses to the shift itself', chip4 === '7am-5pm', chip4);
  t('A4 chip carries no rate / facility / call notes', !/\$|250|CAMC|On call/i.test(chip4), chip4);

  // A5: the rendered month grid uses the minimal chip — no facility
  // name, no <br> type paragraph inside the shift chip.
  run(`db = empty(); db.settings.featurePaychecks=false;
       db.shifts=[{id:'s5', date:'2026-12-01', facility:'CAMC', type:'8-hour day shift', code:'5**', pay:'2125', status:'confirmed'}];
       month = new Date(2026, 11, 1); selected='2026-12-01'; persist();`);
  const grid = run(`calendar()`);
  t('A5 grid chip renders the code', grid.includes('>5**</span>'));
  t('A5 grid chip has no facility+type paragraph', !grid.includes('CAMC<br>') && !grid.includes('8-hour day shift</span>'));

  // A6: import approve stores the original code on the shift.
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[blankFac('CAMC')]; db.shifts=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({type:'5**', code:'5**'})]))}; approveScheduleImport();`);
  t('A6 schedule approve stores the row code on the shift', run(`db.shifts.length`) === 1 && run(`db.shifts[0].code`) === '5**');
  t('A6 chip for the freshly imported shift is its code', run(`shiftChipLabel(db.shifts[0])`) === '5**');

  // ================= CHANGE B: pay schedule at import =================
  // B1: section appears when the agency has no schedule (schedule upload).
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[blankFac('CAMC')]; db.shifts=[]; db.payStubs=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({pay:'2000'})]))};`);
  const htmlB1 = run(`schedulePreviewHTML()`);
  t('B1 pay-schedule section appears for an agency with no schedule', htmlB1.includes('Want paychecks for these shifts on your calendar?') && htmlB1.includes('impPaySched'));
  t('B1 section carries the existing pay-schedule fields', ['agency','facility','frequency','payDate','periodStart','periodEnd'].every(f => htmlB1.includes('data-field="' + f + '"')));

  // B2: saving it with the import creates the schedule AND the real
  // engine generates paycheck estimates covering the imported shifts.
  run(`schedulePreview.paySchedDraft = {agency:'CAMC', facility:'CAMC', frequency:'biweekly', payDate:'2026-12-22', periodStart:'2026-11-30', periodEnd:'2026-12-13'}; approveScheduleImport();`);
  t('B2 import saved one pay schedule', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].agency`) === 'CAMC' && run(`db.payStubs[0].frequency`) === 'biweekly' && run(`db.payStubs[0].source`) === 'import');
  t('B2 approve message names the saved schedule', /Pay schedule saved for CAMC/.test(lastAlert()), lastAlert());
  const occ = run(`paystubOccurrencesInMonth('2026-12')`);
  t('B2 engine generates paychecks from the import-saved schedule', Array.isArray(occ) && occ.length >= 1, JSON.stringify(occ && occ.map(o => [o.date, o.total, o.shiftCount])));
  const cover = occ.find(o => o.periodStart <= '2026-12-07' && o.periodEnd >= '2026-12-07');
  t('B2 a generated paycheck covers the imported shift', !!cover && cover.shiftCount >= 1 && cover.total === 2000, cover ? JSON.stringify([cover.date, cover.periodStart, cover.periodEnd, cover.total]) : 'none');
  t('B2 upcoming paychecks see it too', run(`paystubUpcoming(6, '2026-12-01').length`) >= 1);

  // B3: an agency WITH a schedule shows no section.
  run(`schedulePreview = ${JSON.stringify(mkPreview([mkRow({date:'2026-12-09', pay:'2000'})]))};`);
  t('B3 no section when a schedule already exists', !run(`schedulePreviewHTML()`).includes('Want paychecks for these shifts'));

  // B4: skip path — nothing created, imports fine, never re-prompted.
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[blankFac('CAMC')]; db.shifts=[]; db.payStubs=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({pay:'2000'})]))}; schedulePreviewHTML(); actions('import-paysched-skip','sched');`);
  t('B4 skip marks the preview skipped', run(`schedulePreview.paySchedSkipped`) === true);
  t('B4 skip records the per-agency dismissal', run(`!!(db.settings.paySchedPromptDismissed||{})['camc']`) === true);
  run(`approveScheduleImport();`);
  t('B4 skip imports the shifts and creates no schedule', run(`db.shifts.length`) === 1 && run(`db.payStubs.length`) === 0);
  run(`schedulePreview = ${JSON.stringify(mkPreview([mkRow({date:'2026-12-10', pay:'2000'})]))};`);
  t('B4 a later import for that agency does not re-prompt', !run(`schedulePreviewHTML()`).includes('Want paychecks for these shifts'));

  // B5: leaving the section blank also imports with no schedule.
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[blankFac('CAMC')]; db.shifts=[]; db.payStubs=[]; persist();
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({pay:'2000'})]))}; approveScheduleImport();`);
  t('B5 blank section imports with no schedule created', run(`db.shifts.length`) === 1 && run(`db.payStubs.length`) === 0);

  // B6: QGenda parity — the QGenda flow is the same schedule preview.
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[blankFac('CAMC')]; db.shifts=[]; db.payStubs=[]; persist();
       scheduleImportContext='qgenda';
       schedulePreview = ${JSON.stringify(mkPreview([mkRow({pay:'2000', source:'qgenda'})], {source:'qgenda'}))};`);
  t('B6 QGenda preview shows the pay-schedule section too', run(`schedulePreviewHTML()`).includes('Want paychecks for these shifts'));
  run(`scheduleImportContext='upload';`);

  // B7: .ics / calendar import parity.
  run(`db = empty(); db.facilities=[blankFac('CAMC')]; db.shifts=[]; db.payStubs=[]; persist();
       calPreview = {fileName:'cal.ics', sourceLabel:'Calendar file', rows:[{date:'2026-12-07', facility:'CAMC', type:'8-hour day', pay:'2000', include:true, duplicate:false, flags:[], source:'calendar-file'}]};`);
  t('B7 calendar import preview shows the section', run(`calPreviewHTML()`).includes('Want paychecks for these shifts'));
  run(`calPreview.paySchedDraft = {agency:'CAMC', facility:'CAMC', frequency:'biweekly', payDate:'2026-12-22', periodStart:'2026-11-30', periodEnd:'2026-12-13'}; approveCalendarImport();`);
  t('B7 calendar approve saves the schedule and the engine prices a check', run(`db.payStubs.length`) === 1 && run(`paystubOccurrencesInMonth('2026-12').some(o=>o.total===2000)`) === true);

  // B8: contract (shifts) import parity.
  run(`db = empty(); db.facilities=[blankFac('CAMC')]; db.shifts=[]; db.payStubs=[]; db.contracts=[]; persist();
       contractPreview = {fileName:'c.txt', contract:{id:'ct1', facility:'CAMC', effectiveStart:'', effectiveEnd:'', rates:{}}, rows:[{date:'2026-12-07', facility:'CAMC', type:'8-hour day', pay:'2000', include:true, flags:[], source:'extracted-from-contract'}]};`);
  t('B8 contract preview shows the section', run(`contractPreviewHTML()`).includes('Want paychecks for these shifts'));
  run(`contractPreview.paySchedDraft = {agency:'CAMC', facility:'CAMC', frequency:'biweekly', payDate:'2026-12-22', periodStart:'2026-11-30', periodEnd:'2026-12-13'};`);
  await run(`approveContractImport()`);
  t('B8 contract approve saves the schedule and the engine prices a check', run(`db.payStubs.length`) === 1 && run(`paystubOccurrencesInMonth('2026-12').some(o=>o.total===2000)`) === true);

  // B9: facility-contract parity — section renders, approve saves.
  run(`db = empty(); db.facilities=[]; db.shifts=[]; db.payStubs=[]; db.contracts=[]; persist();
       facilityContractPreview = {facilities:[{name:'CAMC', aliases:'', address:'', rates:{rate8:'2000'}, found:['8-hour shift rate'], include:true, unreadable:[]}], contract:{id:'fc1', rates:{rate8:'2000'}}, fileName:'fc.txt', isPhoto:false}; facilityContractConfirmCreate=false;`);
  t('B9 facility-contract preview shows the section', run(`facilityContractPreviewHTML()`).includes('Want paychecks for these shifts'));
  run(`facilityContractPreview.paySchedDraft = {agency:'CAMC', facility:'CAMC', frequency:'biweekly', payDate:'2026-12-22', periodStart:'', periodEnd:''};`);
  await run(`approveFacilityContract()`); // first attempt stops at the create-facility confirmation, as designed
  await run(`approveFacilityContract()`); // confirming attempt saves
  t('B9 facility-contract approve saves the pay schedule', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].agency`) === 'CAMC');

  console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL PASS');
})();
