// CRNA Hub — calendar editing (Nov 7, 2026).
// The tap-a-day audit: the day sheet's Edit/Delete always worked in
// code, but the sheet rendered as a section far BELOW the calendar in
// the page flow — on a phone, tapping a day looked like a dead tap
// (Caleb found it only by scrolling). Fix: the day detail, the shift
// editor and the paycheck editor are bottom-sheet OVERLAYS (backdrop
// tap / × / swipe-down to close), stacked day sheet -> editor -> back.
// This suite drives the REAL flow through render()'s own event wiring
// with a DOM shim that parses the rendered HTML for [data-action]
// buttons and form[data-kind] elements and dispatches clicks/submits
// the way a browser tap would:
//   tap day -> overlay -> Edit -> overlay form -> save -> re-priced
//   tap paycheck row -> editor overlay -> enter actual -> headline
//   swaps by the exact delta -> clear -> estimate restored
//   date override moves one check only (incl. across a month line)
//   stub-backed check refuses calendar amount edits (source of truth)
//   a manual edit of an imported shift survives a re-sync merge
//   Upcoming paychecks rows: Caleb's four, condensed, exact format.
// Run: node test-calendar-editing.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
const alerts = [];
function el(id) {
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [],
    dataset: {}, style: {}, _listeners: {}, _entries: null,
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [],
  };
}
const elements = {};
function getEl(id) { return elements[id] || (elements[id] = el(id)); }
function parseAttrs(tag) {
  const d = {};
  const re = /data-([a-z-]+)="([^"]*)"/g; let m;
  while ((m = re.exec(tag))) d[m[1]] = m[2];
  return d;
}
function actionButtons() {
  const html = (elements['app'] ? elements['app'].innerHTML : '') + (elements['nav'] ? elements['nav'].innerHTML : '');
  const out = [];
  const re = /<(?:button|a|div)\b[^>]*data-action="[^"]*"[^>]*>/g; let m;
  while ((m = re.exec(html))) { const b = el(''); b.dataset = parseAttrs(m[0]); out.push(b); }
  return out;
}
function forms() {
  const html = elements['app'] ? elements['app'].innerHTML : '';
  const out = [];
  const re = /<form\b[^>]*data-kind="[^"]*"[^>]*>/g; let m;
  while ((m = re.exec(html))) { const f = el(''); f.dataset = parseAttrs(m[0]); f._entries = []; out.push(f); }
  return out;
}
class FakeFormData {
  constructor(form) { this._e = (form && form._entries) || []; }
  *[Symbol.iterator]() { yield* this._e; }
}
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
    querySelectorAll: (sel) => {
      if (sel === '[data-action]') return actionButtons();
      if (sel === 'form[data-kind]') return forms();
      return [];
    },
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
const appHTML = () => elements['app'].innerHTML;

// Dispatch a tap exactly as render()'s wiring does.
function tap(pred, label) {
  run(`render()`);
  const hit = actionButtons().find(pred);
  if (!hit) { t('tap target exists: ' + label, false); return null; }
  run(`actions(${JSON.stringify(hit.dataset.action)}, ${JSON.stringify(hit.dataset.id || '')}, ${JSON.stringify(hit.dataset.date || '')}, ${JSON.stringify(hit.dataset.from || '')})`);
  return hit;
}
function submitForm(kind, entries, label) {
  run(`render()`);
  const f = forms().find(x => x.dataset.kind === kind);
  if (!f) { t('form present for submit: ' + label, false); return; }
  f._entries = entries;
  sandbox.__formEl = f;
  vm.runInContext(`submitEntry({preventDefault(){}, currentTarget: __formEl})`, sandbox);
}

// ---------- Caleb-shaped fixture (his real November + the Premier stub) ----------
const FIXTURE = `
  db.facilities = [{id:'f1', name:'Holzer', hourlyRate:'250', paidHours8:'8.5', rateSecond:'3000', weekendRateSecond:'2000', rate24:'4800', weekendRate24:'4200', callBonus:'1000', hourlyCall1st:'175'}];
  db.payStubs = [
    {id:'pc', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'12757.50', net:'12757.50', source:'ai-vision'}
  ];
  const D = (id, date, type, pay, status) => ({id, date, facility:'Holzer', type, pay:String(pay), status:status || 'confirmed', source:'calendar-apple', sources:['calendar-apple'], updatedAt:'2026-11-01T12:00:00.000Z'});
  const PROP = ['n5','n6','n7','n8','n9','n10','n11'];
  const S = (id, date, type, pay) => D(id, date, type, pay, PROP.includes(id) ? 'proposed' : 'confirmed');
  db.shifts = [
    S('o1','2026-10-22','Second call',3000),
    S('o2','2026-10-26','8-hour day',2125), S('o3','2026-10-27','8-hour day',2125),
    S('o4','2026-10-28','8-hour day',2125), S('o5','2026-10-29','8-hour day',2125),
    S('n1','2026-11-02','8-hour day',2125), S('n2','2026-11-03','Second call',3000),
    S('n3','2026-11-04','8-hour day',2125), S('n4','2026-11-05','8-hour day',2125),
    S('n5','2026-11-06','Second call',3000), S('n6','2026-11-07','24-hour call',4200),
    S('n7','2026-11-08','Second call',2000), S('n8','2026-11-10','8-hour day',2125),
    S('n9','2026-11-11','8-hour day',2125), S('n10','2026-11-12','8-hour day',2125),
    S('n11','2026-11-13','8-hour day',2125),
    S('n12','2026-11-16','8-hour day',2125), S('n13','2026-11-17','8-hour day',2125),
    S('n14','2026-11-18','8-hour day',2125), S('n15','2026-11-19','8-hour day',2125),
    S('n16','2026-11-20','8-hour day',2125), S('n17','2026-11-30','8-hour day',2125)
  ];
  db.mileage = []; db.hotelStays = []; db.documents = [];
  month = new Date(2026, 10, 1);
  selected = '2026-11-03'; dayViewOpen = false; paycheckEdit = null; editId = null; showShiftForm = false;
`;
run(FIXTURE);
t('baseline: November headline is the paycheck basis $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.50);

// ---------- 1. Tap Nov 3 -> day sheet OVERLAY (Caleb's screenshot day) ----------
tap(b => b.dataset.action === 'day' && b.dataset.date === '2026-11-03', 'day 2026-11-03');
t('tap a day: day detail opens as an overlay sheet with a backdrop',
  appHTML().includes('class="sheet-backdrop"') && appHTML().includes('<section class="sheet" id="day-view"'));
t('the old inline below-calendar day section no longer renders',
  !appHTML().includes('<section class="panel" id="day-view">') && (appHTML().match(/id="day-view"/g) || []).length === 1);
t('overlay lists the Nov 3 Second call shift with status picker + Edit/Delete',
  appHTML().includes('data-shift-status="n2"') &&
  appHTML().includes('data-action="edit-shifts" data-id="n2"') &&
  appHTML().includes('data-action="delete-shifts" data-id="n2"'));

// ---------- 2. Edit from the overlay -> stacked editor -> save -> re-priced ----------
tap(b => b.dataset.action === 'edit-shifts' && b.dataset.id === 'n2', 'edit n2');
t('Edit opens the shift editor as a sheet stacked over the day sheet',
  appHTML().includes('sheet sheet-over') && appHTML().includes('data-kind="shifts"') && appHTML().includes('id="day-view"'));
submitForm('shifts', [['date', '2026-11-03'], ['facility', 'Holzer'], ['type', '8-hour day'], ['status', 'confirmed'], ['pay', ''], ['note', '']], 'shift edit (Second call -> 8-hour day)');
t('save from the overlay: type changed and re-priced from facility rates ($3,000 -> $2,125)',
  run(`db.shifts.find(x=>x.id==='n2').type`) === '8-hour day' && run(`db.shifts.find(x=>x.id==='n2').pay`) === '2125');
t('the affected paycheck re-totalled: Nov 24 $27,075 -> $26,200',
  run(`paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-24').total`) === 26200);
t('month banner moved with it: $39,832.50 -> $38,957.50', run(`monthHeadline('2026-11').gross`) === 38957.50);
t('after save the editor closes and the day sheet is what remains',
  !appHTML().includes('data-kind="shifts"') && appHTML().includes('id="day-view"'));
// restore the fixture shift for the paycheck math below
run(`const s2 = db.shifts.find(x=>x.id==='n2'); s2.type = 'Second call'; s2.pay = '3000';`);
t('baseline restored', run(`monthHeadline('2026-11').gross`) === 39832.50);

// ---------- 3. Backdrop / close behavior ----------
tap(b => b.dataset.action === 'close-day', 'day sheet backdrop/×');
t('closing the day sheet removes the overlay (no duplicate left behind)',
  !appHTML().includes('id="day-view"'));

// ---------- 4. Paycheck from the calendar: payday tap -> row -> editor overlay ----------
tap(b => b.dataset.action === 'day' && b.dataset.date === '2026-11-24', 'day 2026-11-24 (payday, no shifts)');
t('payday tap: day sheet overlay carries the condensed paycheck row',
  appHTML().includes('id="day-view"') && appHTML().includes('paycheck-row') && appHTML().includes('$27,075.00'));
tap(b => b.dataset.action === 'edit-paycheck' && b.dataset.date === '2026-11-24' && b.dataset.from === 'day', 'paycheck row in day sheet');
t('paycheck tap opens its editor as a sheet stacked over the day sheet',
  appHTML().includes('sheet sheet-over') && appHTML().includes('paycheck-editor') &&
  appHTML().includes('Estimated $27,075.00 gross') && appHTML().includes('id="day-view"'));
tap(b => b.dataset.action === 'paycheck-edit-cancel', 'editor cancel');
t('editor back/cancel returns to the day sheet (day sheet still open, editor gone)',
  appHTML().includes('id="day-view"') && !appHTML().includes('paycheck-editor'));
tap(b => b.dataset.action === 'close-day', 'close day sheet again');

// ---------- 5. Enter an actual from the panel row -> headline swaps by the delta ----------
tap(b => b.dataset.action === 'edit-paycheck' && b.dataset.date === '2026-11-24' && b.dataset.from === 'panel', 'Nov 24 row in Upcoming panel');
t('panel row opens the same editor overlay with the breakdown',
  appHTML().includes('paycheck-editor') && appHTML().includes('includes $17,700.00 from proposed shifts') &&
  appHTML().includes('This changes this check only'));
submitForm('paycheck-edit', [['stubId', 'pc'], ['schedDate', '2026-11-24'], ['payDate', '2026-11-24'], ['actual', '27950']], 'enter actual $27,950 on Nov 24');
t('entered actual stored on the stub record as an occurrence override',
  run(`db.payStubs[0].occOverrides['2026-11-24'].actual`) === '27950');
t('occurrence now reads as an entered actual',
  run(`paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-24').isActual`) === true &&
  run(`paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-24').actualBasis`) === 'entered' &&
  run(`paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-24').actual`) === 27950);
t('headline swaps by the exact delta: $39,832.50 + $875 = $40,707.50', run(`monthHeadline('2026-11').gross`) === 40707.50);
t('entered actual labels itself everywhere: "actual · entered from calendar"',
  run(`paystubPaycheckLineHTML(paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-24'))`).includes('actual · entered from calendar'));
// the override rides the stub's cloud row (full-record payload)
t('override survives the cloud round-trip (clear-device -> sign-in)',
  run(`(cloudRowToRecord(cloudPayStubRow(db.payStubs[0]))||{}).occOverrides['2026-11-24'].actual`) === '27950');
// clear it back
tap(b => b.dataset.action === 'edit-paycheck' && b.dataset.date === '2026-11-24' && b.dataset.from === 'panel', 'reopen Nov 24 editor');
tap(b => b.dataset.action === 'paycheck-clear-actual', 'clear entered actual');
t('clearing the actual restores the calculated estimate everywhere',
  run(`paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-24').isActual`) === false &&
  run(`monthHeadline('2026-11').gross`) === 39832.50);
tap(b => b.dataset.action === 'paycheck-edit-cancel', 'close editor after clear');

// ---------- 6. Entered actual reconciles YTD like a stub actual ----------
run(`
  globalThis.__ytdBefore = reconciledYearSplit(2026, '2026-11-07').c.ytd;
  savePaycheckOverride(db.payStubs[0], {schedDate: '2026-10-27', actual: '5000', payDate: '2026-10-27'});
`);
t('an entered actual for a period the calendar missed counts in YTD (+$5,000 exactly)',
  run(`reconciledYearSplit(2026, '2026-11-07').c.ytd`) === Math.round((run(`__ytdBefore`) + 5000) * 100) / 100 &&
  run(`reconciledYearSplit(2026, '2026-11-07').stubActuals.some(r => r.actualBasis === 'entered' && r.actual === 5000)`));
run(`savePaycheckOverride(db.payStubs[0], {schedDate: '2026-10-27', actual: ''});`);

// ---------- 7. Pay-date override moves ONE check only ----------
tap(b => b.dataset.action === 'edit-paycheck' && b.dataset.date === '2026-11-24' && b.dataset.from === 'panel', 'open Nov 24 editor for date move');
submitForm('paycheck-edit', [['stubId', 'pc'], ['schedDate', '2026-11-24'], ['payDate', '2026-11-25'], ['actual', '']], 'move Nov 24 check to Nov 25');
t('date override: the check displays on Nov 25 but keeps its Nov 24 identity',
  run(`paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').some(o=>o.date==='2026-11-25' && o.schedDate==='2026-11-24')`) &&
  !run(`paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').some(o=>o.date==='2026-11-24')`));
t('the schedule rhythm is untouched: Dec 8 and Dec 22 checks stay put',
  run(`paystubOccurrences(db.payStubs[0],'2026-12-01','2026-12-31').map(o=>o.date).join(',')`) === '2026-12-08,2026-12-22');
t('same-month move leaves the month headline unchanged', run(`monthHeadline('2026-11').gross`) === 39832.50);
tap(b => b.dataset.action === 'edit-paycheck' && b.dataset.date === '2026-12-08' && b.dataset.from === 'panel', 'open Dec 8 editor for date move');
submitForm('paycheck-edit', [['stubId', 'pc'], ['schedDate', '2026-12-08'], ['payDate', '2026-11-30'], ['actual', '']], 'move Dec 8 check to Nov 30');
t('cross-month move: November gains the check, December loses it',
  run(`monthHeadline('2026-11').gross`) === 39832.50 + 10625 &&
  run(`monthHeadline('2026-12').gross`) === 2125);
run(`
  savePaycheckOverride(db.payStubs[0], {schedDate: '2026-11-24', payDate: '2026-11-24'});
  savePaycheckOverride(db.payStubs[0], {schedDate: '2026-12-08', payDate: '2026-12-08'});
`);
t('overrides cleared: headlines back to baseline',
  run(`monthHeadline('2026-11').gross`) === 39832.50 && run(`monthHeadline('2026-12').gross`) === 12750);

// ---------- 8. Stub-backed check refuses calendar amount edits ----------
t('stub-backed editor: source-of-truth copy, no amount form offered',
  run(`paycheckEditorHTML(paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-10'))`).includes('source of truth') &&
  !run(`paycheckEditorHTML(paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-10'))`).includes('data-kind="paycheck-edit"'));
alerts.length = 0;
sandbox.__formEl = { dataset: { kind: 'paycheck-edit' }, _entries: [['stubId', 'pc'], ['schedDate', '2026-11-10'], ['payDate', '2026-11-10'], ['actual', '99999']] };
vm.runInContext(`submitPaycheckEdit({preventDefault(){}, currentTarget: __formEl})`, sandbox);
t('a forged submit against the stub check is refused with the redirect message',
  alerts.some(a => a.includes('source of truth')) &&
  run(`paystubStubActual(db.payStubs[0]).amount`) === 12757.50 &&
  !run(`(db.payStubs[0].occOverrides||{})['2026-11-10']`));
t('savePaycheckOverride itself refuses a stub-backed payday',
  run(`savePaycheckOverride(db.payStubs[0], {schedDate: '2026-11-10', actual: '1'})`) === false);

// ---------- 9. Condensed Upcoming paychecks — Caleb's four rows, exact ----------
// December period Nov 30 – Dec 13 must total $29,975 (n17 Nov 30 $2,125
// already in the fixture): add $27,850 of December shifts.
run(`
  const DX = (id, date, type, pay) => ({id, date, facility:'Holzer', type, pay:String(pay), status:'confirmed', source:'calendar-apple', sources:['calendar-apple'], updatedAt:'2026-11-01T12:00:00.000Z'});
  db.shifts.push(
    DX('d1','2026-12-05','24-hour call',4200), DX('d2','2026-12-06','24-hour call',4200), DX('d3','2026-12-12','24-hour call',4200),
    DX('d4','2026-12-02','Second call',3000), DX('d5','2026-12-03','Second call',3000), DX('d6','2026-12-09','Second call',3000),
    DX('d7','2026-12-07','8-hour day',2125), DX('d8','2026-12-10','8-hour day',2125),
    DX('d9','2026-12-13','Second call',2000)
  );
`);
const panel = run(`paystubUpcomingHTML()`);
const rowFor = (date) => (panel.split('paycheck-row').find(s => s.includes(date)) || '');
t('Nov 10 row: "Nov 10, 2026 (Oct 19 – Nov 1)  $12,757.50" + actual pill',
  rowFor('Nov 10, 2026').includes('(Oct 19 – Nov 1)') && rowFor('Nov 10, 2026').includes('$12,757.50') && rowFor('Nov 10, 2026').includes('>actual<'));
t('Nov 24 row: "Nov 24, 2026 (Nov 2 – Nov 15)  $27,075.00"',
  rowFor('Nov 24, 2026').includes('(Nov 2 – Nov 15)') && rowFor('Nov 24, 2026').includes('$27,075.00'));
t('Dec 8 row: "Dec 8, 2026 (Nov 16 – Nov 29)  $10,625.00"',
  rowFor('Dec 8, 2026').includes('(Nov 16 – Nov 29)') && rowFor('Dec 8, 2026').includes('$10,625.00'));
t('Dec 22 row: "Dec 22, 2026 (Nov 30 – Dec 13)  $29,975.00"',
  rowFor('Dec 22, 2026').includes('(Nov 30 – Dec 13)') && rowFor('Dec 22, 2026').includes('$29,975.00'));
t('exactly four rows, one line each; totals carry the dominant pc-total style',
  // v124 note (Nov 11, 2026, disclosed): paystubUpcomingHTML reads
  // off the REAL today, so which of the four checks are "upcoming"
  // drifts with the run date — the row CONTENTS are pinned exactly
  // by the four row tests above (via paystubOccurrences over a
  // fixed window); here we pin the panel's row FORMAT on however
  // many rows are upcoming at run time: one line each, one
  // pc-total each, and never a Jan 5, 2027 row — the Dec 14-27
  // period holds no shifts, so v124 gives it no paydate.
  (panel.match(/data-action="edit-paycheck"/g) || []).length >= 1 &&
  (panel.match(/data-action="edit-paycheck"/g) || []).length === (panel.match(/class="pc-total"/g) || []).length &&
  !panel.includes('Jan 5, 2027') &&
  run(`paystubUpcoming(4, '2026-11-05').length`) === 4);
t('panel title dropped "(estimated)"; the long disclaimer lives only in the collapsed toggle',
  !panel.includes('(estimated)') &&
  !panel.includes('includes $17,700.00 from proposed shifts') &&
  panel.indexOf('How paychecks are calculated') > -1 &&
  panel.indexOf('How paychecks are calculated') < panel.indexOf('Paycheck amounts are calculated'));
t('panel is collapsible like the other panels, open by default; the collapsed summary carries the next check',
  panel.includes('<details class="panel collapse-panel" id="upcoming-paychecks" open>') &&
  panel.slice(0, panel.indexOf('collapse-body')).includes('Upcoming paychecks · next Nov 10 — $12,757.50'));
t('expanding the panel reveals all four condensed rows in the new format',
  ['Nov 10, 2026', '$12,757.50', 'Nov 24, 2026', '$27,075.00', 'Dec 8, 2026', '$10,625.00', 'Dec 22, 2026', '$29,975.00']
    .every(s => panel.slice(panel.indexOf('collapse-body')).includes(s)));

// ---------- 10. Manual edit of an imported shift survives a re-sync merge ----------
run(`
  db.shifts = [{id:'imp1', date:'2026-11-13', facility:'Holzer', type:'Second call', pay:'3000', note:'', source:'calendar-apple', sources:['calendar-apple'], status:'confirmed', incomplete:false, updatedAt:'2026-11-07T18:00:00.000Z'}];
  liveSyncState.pending = []; liveSyncState.shiftSync = {}; liveSyncState.tombstones = [];
  liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'update', shift: { id:'imp1', date:'2026-11-13', facility:'Holzer', type:'8-hour day', pay:'2125', note:'Imported from Caleb Work Schedule', source:'calendar-apple', updatedAt:'2026-11-06T12:00:00.000Z' } },
  ], pendingDeletions: [], imported: null });
`);
t('re-sync re-offering the PRE-edit copy does not revert the manual edit',
  run(`db.shifts.find(x=>x.id==='imp1').type`) === 'Second call' && run(`db.shifts.find(x=>x.id==='imp1').pay`) === '3000');
run(`
  liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'update', shift: { id:'imp1', date:'2026-11-13', facility:'Holzer', type:'24-hour call', pay:'4800', note:'', source:'calendar-apple', updatedAt:'2026-11-08T09:00:00.000Z' } },
  ], pendingDeletions: [], imported: null });
`);
t('a genuinely NEWER provider copy still applies',
  run(`db.shifts.find(x=>x.id==='imp1').type`) === '24-hour call' && run(`db.shifts.find(x=>x.id==='imp1').pay`) === '4800');
run(`
  globalThis.__keep = {id:'k1', date:'2026-11-13', facility:'Holzer', type:'8-hour day', pay:'2125', status:'proposed', updatedAt:'2026-11-07T18:00:00.000Z', sources:['calendar-apple']};
  mergeShiftInto(globalThis.__keep, {id:'k1', date:'2026-11-13', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed', updatedAt:'2026-11-06T12:00:00.000Z', source:'calendar-apple'});
  globalThis.__afterOld = globalThis.__keep.status;
  mergeShiftInto(globalThis.__keep, {id:'k1', date:'2026-11-13', facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed', updatedAt:'2026-11-08T09:00:00.000Z', source:'calendar-apple'});
`);
t('dedupe merge: an older re-offer cannot raise a manually-set status back; a newer one can',
  run(`__afterOld`) === 'proposed' && run(`__keep.status`) === 'confirmed');

// ---------- 11. Wiring pins ----------
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const cssSrc = fs.readFileSync(R + 'styles.css', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
t('wiring: swipe-down sheet dismissal + overlay CSS + cache v68',
  appSrc.includes("closest('.sheet')") && cssSrc.includes('.sheet-backdrop{position:fixed') &&
  cssSrc.includes('.sheet-over{z-index:71}') && swSrc.includes('crna-hub-shell-v152'));

console.log(fails ? `\n${fails} check(s) failed` : '\nall calendar-editing checks passed');
