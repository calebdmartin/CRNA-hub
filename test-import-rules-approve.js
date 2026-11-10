// CRNA Hub — import rules must price on EVERY approve path (Nov 10, 2026).
//
// Caleb's live bug (~2:24 PM, production): "It also didn't calculate
// any pay after I uploaded my rules." He re-ran the QGenda import,
// typed his pay rules in the describe box (the read-back was right),
// then approved the import with the preview's own "Approve selected"
// button. The paycheck layer then said Nov 24 was "incomplete":
// applyImportDescribed only applied a parse the user had ALSO
// confirmed via the describe box's separate button, so the typed
// rules were silently discarded — no facility, no rate card, every
// shift unpriced — while the already-saved Premier stub still
// claimed the shifts for its paychecks. Proven root cause, pinned
// here end to end:
//   B  — words parsed, bottom approve (NO confirm) now prices
//        everything: Nov 24 = $26,200 on this flow's card (his text
//        this time stated no paid hours, so G Main prices at 8 paid
//        hours — the $27,075 figure belongs to the 8.5-hour card),
//        Nov 10 stays the $12,757.50 stub actual alone, headline
//        $38,957.50, and the approve message says the rates saved.
//   B2 — same, with the facility question answered "Holzer" first.
//   S  — an explicit "Skip for now" on the rates prompt still wins:
//        no rules saved even with a parse on screen.
//   H  — the identity heal for accounts already saved in a variant
//        state: rules on "HOLZ", unpriced shifts saying "Holzer"
//        (or resolving to a blank "HOLZ" record) price on plain
//        open through the ONE matcher — an alias link, or a
//        re-point of the unpriced shifts. Priced shifts and
//        unpriceable codes are never touched.
// Run: node test-import-rules-approve.js
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

const WORDS = ['Holz-g main (8)= 8hour day shift $250/hour', 'Holz-call 1= 24hr call. weekday=$4,800.', 'Weekend=$4,200', 'Holz-call 2= second call. Weekday=$3,000.', 'Weekend=$2,000', 'Holz-g main (10)=10hour day shift', 'Holz PCDO=post call day off=no pay', '', 'Weekend only includes Saturday and Sunday'].join('\n');
const NOV = [['2026-11-02', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-03', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-04', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-05', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-06', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-07', '24-hour call', 'HOLZ - Call 1', 24], ['2026-11-08', 'Second call', 'HOLZ - Call 2', 24], ['2026-11-10', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-11', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-12', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-13', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-16', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-17', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-18', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-19', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-20', '8-hour day', 'HOLZ - G Main (8)', 8], ['2026-11-30', '8-hour day', 'HOLZ - G Main (8)', 8]];
const STUB = `{id:'stub1',agency:'Premier Anesthesia Group, PC',facility:'',frequency:'biweekly',periodStart:'2026-10-19',periodEnd:'2026-11-01',payDate:'2026-11-10',gross:'12757.50',net:'',source:'text-parse',fileName:'stub.pdf',updatedAt:new Date().toISOString()}`;
function seedPreview() {
  run(`db=empty();db.settings.scheduleName='Martin';db.payStubs=[${STUB}];`);
  const rows = NOV.map(([date, type, code, hours]) => ({ date, facility: 'HOLZ', type, code, hours, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed', incomplete: true }));
  run(`schedulePreview={fileName:'QGenda feed',source:'qgenda-feed',matchedName:'Martin',rows:${JSON.stringify(rows)},noNamesInFile:false,ai:false,parserVersion:6};scheduleImportContext='qgenda';tab='Facilities';`);
  run(`schedulePreviewHTML();`); // the render that sets the describe context, as in the UI
}
function occNov() { return run(`paystubOccurrencesInMonth('2026-11').map(o=>({date:o.date,isActual:!!o.isActual,total:paystubOccurrenceAmount(o),unpriced:o.unpriced||0}))`); }

(async () => {
  // ---------- B: words parsed, read back, bottom approve ----------
  seedPreview();
  run(`describeState('imp:schedule').text=${JSON.stringify(WORDS)};`);
  await run(`submitDescribe('imp:schedule')`);
  t('B: parse exists and is NOT confirmed (his exact state)', run(`!!describeState('imp:schedule').parsed`) === true && run(`!!describeState('imp:schedule').confirmed`) === false);
  alerts.length = 0;
  run(`approveScheduleImport()`);
  const facB = run(`db.facilities[0]||null`);
  t('B: the facility exists with the typed rules', !!facB && facB.hourlyRate === '250' && facB.rate24 === '4800' && facB.weekendRate24 === '4200' && facB.rateSecond === '3000' && facB.weekendRateSecond === '2000', JSON.stringify(facB && { n: facB.name, wr24: facB.weekendRate24 }));
  t('B: all 17 shifts priced, none incomplete', run(`db.shifts.length`) === 17 && run(`db.shifts.filter(x=>x.incomplete).length`) === 0);
  t('B: PCDO-style splits hold — Call 1 Sat $4,200, Call 2 Sun $2,000', run(`db.shifts.find(x=>x.date==='2026-11-07').pay`) === '4200' && run(`db.shifts.find(x=>x.date==='2026-11-08').pay`) === '2000');
  const occB = occNov();
  t('B: Nov 10 stays the stub actual alone', occB.find(o => o.date === '2026-11-10').total === 12757.5 && occB.find(o => o.date === '2026-11-10').isActual === true);
  t('B: Nov 24 prices — $26,200 on this flow\u2019s 8-paid-hour card, zero unpriced', occB.find(o => o.date === '2026-11-24').total === 26200 && occB.find(o => o.date === '2026-11-24').unpriced === 0, JSON.stringify(occB));
  t('B: headline is actual + estimate — $38,957.50', run(`monthHeadline('2026-11').gross`) === 38957.5);
  t('B: the approve message SAYS the rates saved (nothing silent)', alerts.some(a => a.includes('Rates saved')), alerts.join(' | '));

  // ---------- B2: facility question answered, bottom approve ----------
  seedPreview();
  run(`schedulePreview.facilityAll='Holzer';schedulePreviewHTML();`);
  run(`describeState('imp:schedule').text=${JSON.stringify(WORDS)};`);
  await run(`submitDescribe('imp:schedule')`);
  run(`approveScheduleImport()`);
  t('B2: rules land on the answered facility', run(`db.facilities.length`) === 1 && run(`db.facilities[0].name`) === 'Holzer' && run(`db.facilities[0].weekendRate24`) === '4200');
  t('B2: Nov 24 prices — $26,200, zero unpriced', occNov().find(o => o.date === '2026-11-24').total === 26200 && occNov().find(o => o.date === '2026-11-24').unpriced === 0);

  // ---------- S: explicit Skip for now still wins ----------
  seedPreview();
  run(`describeState('imp:schedule').text=${JSON.stringify(WORDS)};`);
  await run(`submitDescribe('imp:schedule')`);
  run(`schedulePreview.ratesSkipped=true;approveScheduleImport()`);
  t('S: skip wins — no facility carries the typed rates', run(`db.facilities.filter(f=>String(f.hourlyRate||'')==='250').length`) === 0, JSON.stringify(run(`db.facilities.map(f=>({n:f.name,h:f.hourlyRate}))`)));
  t('S: shifts saved unpriced, as a skip means', run(`db.shifts.filter(x=>x.incomplete).length`) === 17);

  // ---------- H: identity heal on plain open ----------
  const RULES_CARD = `{id:'fh',name:'HOLZ',aliases:'',address:'',hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'',rate12:'',rate24:'4800',weekendRate24:'4200',rateSecond:'3000',weekendRateSecond:'2000',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}}`;
  const PERIOD = [['2026-11-02', 'HOLZ - G Main (8)', '8-hour day'], ['2026-11-03', 'HOLZ - Call 2', 'Second call'], ['2026-11-04', 'HOLZ - G Main (8)', '8-hour day'], ['2026-11-05', 'HOLZ - G Main (8)', '8-hour day'], ['2026-11-06', 'HOLZ - Call 2', 'Second call'], ['2026-11-07', 'HOLZ - Call 1', '24-hour call'], ['2026-11-08', 'HOLZ - Call 2', 'Second call'], ['2026-11-10', 'HOLZ - G Main (8)', '8-hour day'], ['2026-11-11', 'HOLZ - G Main (8)', '8-hour day'], ['2026-11-12', 'HOLZ - G Main (8)', '8-hour day'], ['2026-11-13', 'HOLZ - G Main (8)', '8-hour day']];
  const mkShifts = (fac) => PERIOD.map(([date, code, type], i) => ({ id: 'h' + i, date, facility: fac, type, code, pay: '', payUnit: '', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: true, note: '', updatedAt: null }));
  // H1: rules on HOLZ, shifts say "Holzer" (resolves nowhere)
  run(`db=empty();db.settings.scheduleName='Martin';db.facilities=[${RULES_CARD}];db.shifts=${JSON.stringify(mkShifts('Holzer'))};db.payStubs=[${STUB}];`);
  t('H1: before the heal, Nov 24 is the bug — claimed but unpriced', (() => { const o = occNov().find(x => x.date === '2026-11-24'); return o && o.total === null && o.unpriced === 11; })(), JSON.stringify(occNov()));
  run(`healUnpricedShiftPays()`);
  t('H1: heal links the variant as an alias on the rules facility', run(`facilityAliases(db.facilities[0]).includes('Holzer')`) === true, run(`db.facilities[0].aliases`));
  t('H1: after the heal Nov 24 = $27,075 (8.5-hour card), zero unpriced', occNov().find(o => o.date === '2026-11-24').total === 27075 && occNov().find(o => o.date === '2026-11-24').unpriced === 0);
  t('H1: headline back to $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.5);
  // H2: blank HOLZ record + rules on Holzer; shifts say HOLZ
  run(`db=empty();db.settings.scheduleName='Martin';db.facilities=[{id:'fb',name:'HOLZ',aliases:'',address:'',hourlyRate:'',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',weekendRate24:'',rateSecond:'',weekendRateSecond:'',hourlyCall1st:'',callBonus:'',distance:'',notes:'',codeMap:{}},${RULES_CARD.replace(`name:'HOLZ'`, `name:'Holzer'`).replace(`id:'fh'`, `id:'fh2'`)}];db.shifts=${JSON.stringify(mkShifts('HOLZ'))};db.payStubs=[${STUB}];`);
  run(`healUnpricedShiftPays()`);
  t('H2: unpriced shifts re-point to the rules facility and price', run(`db.shifts.every(x=>x.facility==='Holzer')`) === true && occNov().find(o => o.date === '2026-11-24').total === 27075, JSON.stringify(run(`db.shifts.slice(0,2).map(x=>({f:x.facility,p:x.pay}))`)));
  // H3: a priced shift is never touched; an unpriceable code stays unpriced
  run(`db=empty();db.settings.scheduleName='Martin';db.facilities=[${RULES_CARD}];db.shifts=[{id:'p1',date:'2026-11-02',facility:'Holzer',type:'8-hour day',code:'HOLZ - G Main (8)',pay:'9999',payUnit:'daily',status:'confirmed',source:'user-entered',sources:['user-entered'],incomplete:false,note:'',updatedAt:null},{id:'p2',date:'2026-11-03',facility:'Holzer',type:'Off / PTO',code:'',pay:'',payUnit:'',status:'confirmed',source:'qgenda-feed',sources:['qgenda-feed'],incomplete:true,note:'',updatedAt:null}];db.payStubs=[];`);
  run(`healUnpricedShiftPays()`);
  t('H3: priced shift untouched, unpriceable code NOT linked or priced', run(`db.shifts.find(x=>x.id==='p1').pay`) === '9999' && run(`db.shifts.find(x=>x.id==='p2').incomplete`) === true && run(`db.facilities[0].aliases`) === '');

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
})();
