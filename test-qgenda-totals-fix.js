// Nov 9, 2026 — QGenda November totals bug round.
// Caleb's live report: after connecting QGenda and entering a pay
// schedule at import, November showed headline $52,000, Nov 10 est
// $14,000, Nov 24 est $38,000 — every shift priced hourly x the
// event-span hours (G Main $2,000, Call 2 $6,000 on a Tuesday AND a
// Sunday, Call 1 $6,000), because the clarification flow stored one
// hourly rate and per-code hours and nothing else: the weekday /
// weekend split for call types was never captured, and the clarified
// pricing flattened every code to hourly x hours even when the code
// named a canonical type the facility pricer handles by day of week.
// This suite pins the fix end to end:
//   A. fresh QGenda import WITH split answers -> Nov 24 $27,075,
//      November worked $39,825, Call 2 Tue $3,000 / Sun $2,000.
//   B. the same account plus the real Nov 10 stub -> headline
//      $39,832.50 with Nov 10 an actual.
//   C. the heal: an account already saved with the flat prices
//      heals on plain open through the Dashboard describe-in-words
//      prompt (Nov 9, 2026 evening redesign — no re-import), and
//      every derived amount corrects with no duplicates.
//   D. legacy "[ ]" code artifacts still display and match clean.
//   E. a server-priced QGenda row is marked facility-derived and
//      reprices when the facility's paid hours are corrected.
//   F. the facility pricer's own split (already correct) is pinned.
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
  // Rows exactly as fetchQgendaFeed builds them from the v13/v14
  // server parse of Caleb's feed: clean codes, canonical types,
  // grammar hours, no pay (his facility did not exist server-side
  // at first fetch). November: 13 G Main (8), Call 2 on Tue Nov 3 /
  // Fri Nov 6 / Sun Nov 8, Call 1 on Sat Nov 7. October rows are the
  // illustrative Oct 19 - Nov 1 period mix (4 G Main + Fri Call 2).
  const qrow = (date, code, type, hours) => ({ date, facility: 'Holzer', type, code, hours, pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda' });
  const G = 'HOLZ - G Main (8)', C2 = 'HOLZ - Call 2', C1 = 'HOLZ - Call 1';
  const rows = [];
  for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']) rows.push(qrow(d, G, '8-hour day', 8));
  rows.push(qrow('2026-10-23', C2, 'Second call', 24));
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-30']) rows.push(qrow(d, G, '8-hour day', 8));
  rows.push(qrow('2026-11-03', C2, 'Second call', 24), qrow('2026-11-06', C2, 'Second call', 24), qrow('2026-11-08', C2, 'Second call', 24), qrow('2026-11-07', C1, '24-hour call', 24));
  const mkPreview = () => ({ fileName: 'QGenda feed', matchedName: 'Martin', source: 'qgenda', facilityAll: 'Holzer', rows: rows.map(r => ({ ...r })) });
  const paySched = { agency: 'Holzer', facility: 'Holzer', frequency: 'biweekly', payDate: '2026-11-10', periodStart: '2026-10-19', periodEnd: '2026-11-01', dismissed: false };
  const shiftOn = (date, code) => run(`(db.shifts||[]).filter(x=>x.date==='${date}'&&x.code==='${code}')`)[0] || {};
  const novWorked = () => run(`(db.shifts||[]).filter(x=>x.date>='2026-11-01'&&x.date<='2026-11-30').reduce((a,x)=>a+(parseFloat(x.pay)||0),0)`);
  const occ = (ym, pd) => run(`paystubOccurrencesInMonth('${ym}')`).find(o => o.date === pd) || {};

  // ---------- F: the facility pricer's split was never broken ----------
  // The totals encoding: rateSecond / rate24 hold the WEEKDAY TOTAL
  // for one call shift, weekendRate* the weekend flat — the shape
  // the contract flow saves and the shape Caleb's live $27,075
  // paycheck was calculated from.
  run(`window.__HF={hourlyRate:'250',paidHours8:'8.5',rate8:'',rate10:'',rate12:'',rateSecond:'3000',callBonus:'',weekendRateSecond:'2000',rate24:'4800',weekendRate24:'4200',hourlyCall1st:'175'}`);
  t('F facilityPayFor: Second call Tue $3,000 / Sun $2,000', run(`facilityPayFor(window.__HF,'Second call','2026-11-03')`) === 3000 && run(`facilityPayFor(window.__HF,'Second call','2026-11-08')`) === 2000);
  t('F facilityPayFor: 24-hour call Wed $4,800 / Sat $4,200', run(`facilityPayFor(window.__HF,'24-hour call','2026-11-04')`) === 4800 && run(`facilityPayFor(window.__HF,'24-hour call','2026-11-07')`) === 4200);
  t('F facilityPayFor: 8-hour day $2,125 (hourly x 8.5 paid hours)', run(`facilityPayFor(window.__HF,'8-hour day','2026-11-02')`) === 2125);
  t('F canonicalTypeOf names the call types', run(`canonicalTypeOf('Second call')`) === 'Second call' && run(`canonicalTypeOf('24-hour call')`) === '24-hour call' && run(`canonicalTypeOf('8/2nd call')`) === 'Second call' && run(`canonicalTypeOf('1st call')`) === '24-hour call' && run(`canonicalTypeOf('Night float')`) === '');
  t('F normalizeCodeKey drops only emptied brackets', run(`normalizeCodeKey('HOLZ - G Main (8) [ ]')`) === 'HOLZ - G Main (8)' && run(`normalizeCodeKey('Ward [North]')`) === 'Ward [North]');

  // ---------- A: fresh import with split answers ----------
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[]; db.shifts=[]; persist();`);
  run(`schedulePreview = ${JSON.stringify(mkPreview())};`);
  const codesA = run(`unclarifiedCodes(schedulePreview, importRatesTarget(schedulePreview))`);
  t('A prompt covers exactly the three read codes', codesA.length === 3 && codesA.map(c => c.code).join('|') === [G, C2, C1].join('|'), JSON.stringify(codesA.map(c => c.code)));
  t('A both call codes flagged for the split question', codesA.find(c => c.code === C2).splitType === 'Second call' && codesA.find(c => c.code === C1).splitType === '24-hour call');
  t('A the day code is NOT asked a weekend question', codesA.find(c => c.code === G).splitType === '');
  const htmlA = run(`schedulePreviewHTML()`);
  // Nov 9, 2026 (evening): the prompt is ONE describe-in-words box
  // listing the three codes — the weekday/weekend splits are
  // answered in sentences now, not per-code fields.
  t('A prompt is one words box listing the three codes (no field grid)', htmlA.includes('describeText') && htmlA.includes('Make my rules') && !htmlA.includes('clarifyCodeWeekday') && htmlA.includes(G) && htmlA.includes(C2) && htmlA.includes(C1));
  const WORDS_A = "Day shifts pay $250/hr and I'm paid for 8.5 hours. Call 2 is $3,000 on weekdays, $2,000 on weekends. Call 1 is $4,800 weekdays, $4,200 weekends.";
  run(`schedulePreview.describe={text:${JSON.stringify(WORDS_A)},parsed:describeParseLocal(${JSON.stringify(WORDS_A)},null,unclarifiedCodes(schedulePreview,importRatesTarget(schedulePreview))),confirmed:true}; schedulePreview.paySchedDraft=${JSON.stringify(paySched)}; approveScheduleImport();`);
  const facA = run(`db.facilities[0]`);
  t('A split answers saved into the facility rate fields', facA.rateSecond === '3000' && facA.weekendRateSecond === '2000' && facA.rate24 === '4800' && facA.weekendRate24 === '4200', JSON.stringify({ r2: facA.rateSecond, w2: facA.weekendRateSecond, r24: facA.rate24, w24: facA.weekendRate24 }));
  t('A hourly rate + 8.5 paid hours saved', facA.hourlyRate === '250' && facA.paidHours8 === '8.5');
  t('A 22 shifts saved, none doubled', run(`db.shifts.length`) === 22, 'got ' + run(`db.shifts.length`));
  t('A G Main prices $2,125', shiftOn('2026-11-02', G).pay === '2125', shiftOn('2026-11-02', G).pay);
  t('A Call 2 Tue Nov 3 prices $3,000', shiftOn('2026-11-03', C2).pay === '3000', shiftOn('2026-11-03', C2).pay);
  t('A Call 2 Fri Nov 6 prices $3,000', shiftOn('2026-11-06', C2).pay === '3000');
  t('A Call 2 Sun Nov 8 prices $2,000', shiftOn('2026-11-08', C2).pay === '2000', shiftOn('2026-11-08', C2).pay);
  t('A Call 1 Sat Nov 7 prices $4,200', shiftOn('2026-11-07', C1).pay === '4200', shiftOn('2026-11-07', C1).pay);
  t('A November worked total is $39,825', novWorked() === 39825, 'got ' + novWorked());
  t('A Nov 24 paycheck (period Nov 2-15) is $27,075', occ('2026-11', '2026-11-24').total === 27075, 'got ' + occ('2026-11', '2026-11-24').total);
  t('A Nov 10 estimate prices the October period at the same rules ($11,500)', occ('2026-11', '2026-11-10').total === 11500 && occ('2026-11', '2026-11-10').isActual === false, 'got ' + occ('2026-11', '2026-11-10').total);
  t('A headline is paychecks only — no worked-basis double count', run(`monthHeadline('2026-11').gross`) === 38575, 'got ' + run(`monthHeadline('2026-11').gross`));

  // ---------- B: with the real stub, the headline is $39,832.50 ----------
  // The main-account shape: the stub record IS the pay schedule for
  // the agency (no separate import-entered record alongside it).
  run(`db.payStubs = db.payStubs.filter(s=>s.source!=='import'); db.payStubs.push({id:'stub1',agency:'Holzer',facility:'Holzer',frequency:'biweekly',payDate:'2026-11-10',periodStart:'2026-10-19',periodEnd:'2026-11-01',gross:'12757.50',net:'',source:'stub'}); persist();`);
  t('B Nov 10 becomes the stub actual', occ('2026-11', '2026-11-10').isActual === true && run(`paystubOccurrenceAmount(paystubOccurrencesInMonth('2026-11').find(o=>o.date==='2026-11-10'))`) === 12757.5);
  t('B headline is $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.5, 'got ' + run(`monthHeadline('2026-11').gross`));

  // ---------- C: the heal — broken account, healed in words ----------
  // Nov 9, 2026 (evening) redesign: the broken account below is the
  // state the OLD field clarifier saved (one hourly rate + per-code
  // hours, no splits, pays stamped hourly x span). It no longer
  // heals through a re-import: on plain open the Dashboard surfaces
  // ONE describe-in-words prompt, and confirming the read-back
  // reprices everything. The broken figures are constructed as
  // saved state because the current import flow can no longer
  // produce them (an unconfirmed approve saves no rules at all).
  const brokenFac = { id: 'f1', name: 'Holzer', aliases: '', address: '', hourlyRate: '250', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', hourlyCall1st: '', callBonus: '', distance: '', notes: '', codeMap: { [G]: { label: '8-hour day', hours: '8.5' }, [C2]: { label: 'Second call', hours: '24' }, [C1]: { label: '24-hour call', hours: '24' } } };
  const brokenShifts = rows.map((r, i) => ({ id: 'c' + i, date: r.date, facility: 'Holzer', type: r.type, code: r.code, pay: r.code === G ? '2000' : '6000', payRate: '250', payUnit: 'hourly', status: 'confirmed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: false, note: '' }));
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=${JSON.stringify([brokenFac])}; db.shifts=${JSON.stringify(brokenShifts)}; db.payStubs=[{id:'ps1',agency:'Holzer',facility:'Holzer',frequency:'biweekly',payDate:'2026-11-10',periodStart:'2026-10-19',periodEnd:'2026-11-01',gross:'',net:'',source:'import',fileName:''}]; persist();`);
  t('C broken state reproduces: Call 2 flat $6,000 Tue and Sun', shiftOn('2026-11-03', C2).pay === '6000' && shiftOn('2026-11-08', C2).pay === '6000', shiftOn('2026-11-03', C2).pay + '/' + shiftOn('2026-11-08', C2).pay);
  t('C broken state reproduces: G Main $2,000, Call 1 $6,000', shiftOn('2026-11-02', G).pay === '2000' && shiftOn('2026-11-07', C1).pay === '6000');
  t('C broken paychecks reproduce the live figures ($14,000 / $38,000 / $52,000)', occ('2026-11', '2026-11-10').total === 14000 && occ('2026-11', '2026-11-24').total === 38000 && run(`monthHeadline('2026-11').gross`) === 52000);
  const htmlC = run(`dashboardRulesHealHTML()`);
  t('C the Dashboard surfaces the words prompt on plain open (no re-import)', htmlC.includes('Quick check — pay rules at Holzer') && htmlC.includes('describeText'), htmlC.slice(0, 100));
  t('C the prompt asks about all three unverified codes', run(`facilityRulesUnverified(db.facilities[0]).codes.length`) === 3, JSON.stringify(run(`facilityRulesUnverified(db.facilities[0]).codes.map(c=>c.code)`)));
  run(`window.__parsedC = describeParseLocal(${JSON.stringify(WORDS_A)}, db.facilities[0], facilityRulesUnverified(db.facilities[0]).codes); applyDescribedRules(db.facilities[0], window.__parsedC); persist();`);
  t('C healing adds no duplicates', run(`db.shifts.length`) === 22, 'got ' + run(`db.shifts.length`));
  t('C saved definitions kept their labels through the words heal', run(`codeDefFor(db.facilities[0],'${C2}').canonicalType`) === 'Second call');
  t('C Call 2 healed by day of week', shiftOn('2026-11-03', C2).pay === '3000' && shiftOn('2026-11-08', C2).pay === '2000', shiftOn('2026-11-03', C2).pay + '/' + shiftOn('2026-11-08', C2).pay);
  t('C Call 1 healed to the weekend flat', shiftOn('2026-11-07', C1).pay === '4200');
  t('C G Main healed to $2,125 in the same pass (paid hours came from the same sentence)', shiftOn('2026-11-02', G).pay === '2125');
  t('C November worked total healed to $39,825', novWorked() === 39825, 'got ' + novWorked());
  t('C Nov 24 healed to $27,075', occ('2026-11', '2026-11-24').total === 27075);
  t('C the prompt is gone once the rules are confirmed', run(`dashboardRulesHealHTML()`) === '');
  run(`db.payStubs = db.payStubs.filter(s=>s.source!=='import'); db.payStubs.push({id:'stub1',agency:'Holzer',facility:'Holzer',frequency:'biweekly',payDate:'2026-11-10',periodStart:'2026-10-19',periodEnd:'2026-11-01',gross:'12757.50',net:'',source:'stub'}); persist();`);
  t('C healed headline with the stub is $39,832.50', run(`monthHeadline('2026-11').gross`) === 39832.5, 'got ' + run(`monthHeadline('2026-11').gross`));

  // ---------- D: legacy "[ ]" artifacts ----------
  t('D chip label strips the emptied brackets from a saved code', run(`shiftChipLabel({code:'HOLZ - G Main (8) [ ]',type:'8-hour day',facility:'Holzer'})`) === 'HOLZ - G Main (8)');
  run(`db = empty(); db.facilities=[{id:'f9',name:'Holzer',codeMap:{'HOLZ - Call 2 [ ]':{label:'Second call',hours:'24'}}}]; persist();`);
  t('D a def saved under a bracketed key is found by the clean code', run(`!!codeDefFor(db.facilities[0],'HOLZ - Call 2')`) === true);
  t('D dedupe type key ignores the artifact', run(`shiftTypeKeyOf({type:'HOLZ - Call 2 [ ]'})`) === run(`shiftTypeKeyOf({type:'HOLZ - Call 2'})`));

  // ---------- E: server-priced QGenda rows are derived, and heal ----------
  run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=[{id:'f1',name:'Holzer',aliases:'',hourlyRate:'250',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyCall1st:'',callBonus:'',weekendRate24:'',weekendRateSecond:'',codeMap:{},distance:'',notes:''}]; db.shifts=[]; persist();`);
  const eRow = qrow('2026-11-02', G, '8-hour day', 8); eRow.pay = '2000';
  run(`schedulePreview = ${JSON.stringify({ fileName: 'QGenda feed', matchedName: 'Martin', source: 'qgenda', rows: [eRow] })}; approveScheduleImport();`);
  t('E server-priced row saved as facility-derived', run(`db.shifts[0].pay`) === '2000' && run(`db.shifts[0].payUnit`) === 'facility', run(`db.shifts[0].payUnit`));
  run(`const fE=db.facilities[0]; fE.paidHours8='8.5'; repriceUnpricedShiftsForFacility(fE);`);
  t('E paid-hours correction reprices it to $2,125', run(`db.shifts[0].pay`) === '2125');

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
})();
