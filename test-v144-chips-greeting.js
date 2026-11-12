// CRNA Hub v144 — two fixes in one round.
//
// FIX 1 — hand-added chip names (Caleb, Nov 12, 2026, screenshot of
// April 2027): his hand-added PROPOSED shifts showed inconsistent
// chips — Apr 5 read "Holzer 8hr" (the v138 composition) but Apr
// 6/7/8/9 read bare "8hr". Diagnosis (reproduced below on his real
// rows before the fix): shiftChipLabel's v138 hand-added branch
// required EVERY recorded source to be 'user-entered', and
// shiftSourcesList unions the `sources` array with the scalar
// `source` — so a hand-added row that later merged with a feed row
// fell out of the branch into the v137 code-map borrow and came
// back wearing the first matching duration-named definition
// ("8hr"/"8s"), or the "HOLZ · type" fallback. His stored shapes:
//   Apr 5: source 'user-entered', sources ['user-entered'] — OK.
//   Apr 6: sources ['user-entered','calendar-apple'] — merged.
//   Apr 9: facility 'Holzer ' (trailing space) and the scalar
//          `source` carrying the merged feed origin.
// The fix: the chip keys off the row's PRIMARY origin — `source`
// is 'user-entered' OR sources[0] is — and later merges never
// rename what he typed in. Purely feed-sourced code-less rows keep
// the borrow (pinned below). A boot/merge heal also trims stored
// facility strings (and facility names on save), so "Holzer "
// folds into "Holzer" in storage, not just in matching.
// Money cross-check from the same screenshot: the Apr 27, 2027
// estimated paycheck reads $10,625 — exactly the period Apr 5–18
// holding only his five proposed shifts at $2,125. Priced below
// through the real occurrence engine on his real rows.
//
// FIX 2 — return greeting (Caleb, Nov 12, 2026): leaving to sign
// in at a portal stamps a departure (source + time, this device);
// when the app is seen again with that departure still pending,
// the Credentials view greets him once at the top — "Welcome back
// — tap to run your <Source> read" — the button performing exactly
// the v143 portalRequestRead. Cleared when the read is requested,
// the banner is dismissed, a guided check starts, or a result
// lands. One showing per departure.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) { return { id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [], dataset: {}, style: {}, _listeners: {}, _entries: null, addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }, append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [] }; }
const elements = {}; const getEl = (id) => elements[id] || (elements[id] = el(id));
class FakeFormData { constructor(f) { this._e = (f && f._entries) || []; } *[Symbol.iterator]() { yield* this._e; } }
const localStorageStub = { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const sandbox = { console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math, crypto: require('crypto').webcrypto, FormData: FakeFormData, localStorage: localStorageStub, document: { getElementById: (id) => getEl(id), querySelectorAll: () => [], createElement: () => el(), body: { append() {} }, addEventListener() {} }, window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' }, alert: () => {}, confirm: () => true, fetch: async () => ({ status: 401, ok: false, text: async () => '{}', json: async () => ({}) }), history: { replaceState() {} } };
sandbox.window = sandbox; sandbox.window.scrollTo = () => {};
const APOLOGY = 'data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==';
if (typeof sandbox.URL.createObjectURL !== 'function') Object.assign(sandbox.URL, { createObjectURL: () => APOLOGY, revokeObjectURL: () => {} });
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let fails = 0; const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra)); if (!cond) fails++; };
const J = (v) => JSON.stringify(v);

/* ================= FIX 1: chips, his exact shapes ============ */
// His facility record (same fixture the v138 pins run on).
const HOLZ = `{id:'holz',name:'Holzer',aliases:'Holzer, HOLZ',address:'100 Jackson Pike, Gallipolis, OH 45631',hourlyRate:'250',paidHours8:'8.5',rate8:'2125',rate10:'',rate12:'',rate24:'4800',rateSecond:'3000',hourlyCall1st:'4800',callBonus:'4200',weekendRate24:'4200',weekendRateSecond:'2000',weekendDays:[0,6],weekendDaysSource:'stated',codeMap:{
  '8s':{hours:'8',label:'8-hour shift',viaWords:true,paidHours:'8.5',canonicalType:'8-hour day',rulesConfirmed:true},
  '8hr':{hours:'8',label:'8-hour shift',viaWords:true,paidHours:'8.5',canonicalType:'8-hour day',rulesConfirmed:true},
  'Call 2':{label:'Call 2 weekday',canonicalType:'Second call'},
  '1st call':{hours:'24',label:'1st call weekday',canonicalType:'24-hour call'},
  'HOLZ - PCDO':{label:'post call day off',unpaid:true,canonicalType:''},
  'HOLZ - Call 1':{label:'24-hour call',canonicalType:'24-hour call'},
  'HOLZ - G Main (8)':{hours:'8',label:'8-hour day',viaWords:true,paidHours:'8.5',canonicalType:'8-hour day',rulesConfirmed:true},
  'HOLZ - G Main (10)':{label:'10-hour shift',canonicalType:'10-hour shift'}}}`;
// The five April rows in the shape classes pulled from his account:
// NO code key anywhere; pay '2125'; status proposed.
const ROWS = `
  {id:'apr5',date:'2027-04-05',facility:'Holzer',type:'8-hour day',pay:'2125',status:'proposed',source:'user-entered',sources:['user-entered'],note:'',payRate:'',payUnit:'',incomplete:false},
  {id:'apr6',date:'2027-04-06',facility:'Holzer',type:'8-hour day',pay:'2125',status:'proposed',source:'user-entered',sources:['user-entered','calendar-apple'],note:'',payRate:'',payUnit:'',incomplete:false},
  {id:'apr7',date:'2027-04-07',facility:'Holzer',type:'8-hour day',pay:'2125',status:'proposed',source:'user-entered',sources:['user-entered','qgenda-feed'],note:'',payRate:'',payUnit:'',incomplete:false},
  {id:'apr8',date:'2027-04-08',facility:'Holzer',type:'8-hour day',pay:'2125',status:'proposed',source:'calendar-google',sources:['user-entered','calendar-google'],note:'',payRate:'',payUnit:'',incomplete:false},
  {id:'apr9',date:'2027-04-09',facility:'Holzer ',type:'8-hour day',pay:'2125',status:'proposed',source:'calendar-apple',sources:['user-entered'],note:'',payRate:'',payUnit:'',incomplete:false}`;
run(`
  db = empty();
  db.facilities = [${HOLZ}];
  db.shifts = [${ROWS},
    {id:'apr1',date:'2027-04-01',facility:'Holzer',code:'HOLZ - G Main (8)',type:'8-hour day',pay:'2125',status:'confirmed',source:'calendar-apple',sources:['calendar-apple'],note:'',payRate:'',payUnit:'',incomplete:false},
    {id:'apr2',date:'2027-04-02',facility:'Holzer',code:'HOLZ - G Main (8)',type:'8-hour day',pay:'2125',status:'confirmed',source:'calendar-apple',sources:['calendar-apple'],note:'',payRate:'',payUnit:'',incomplete:false}];
  db.payStubs = [{ id:'ps-apr', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2027-04-05', periodEnd:'2027-04-18', payDate:'2027-04-27', gross:'', net:'', source:'import', fileName:'' }];
  db.mileage = [];
  month = new Date(2027, 3, 1); selected = '2027-04-05'; persist();
`);
const chip = (id) => run(`shiftChipLabel(db.shifts.find(s=>s.id==='${id}'))`);
t('A1 Apr 5 (pure user-entered): "Holzer 8hr"', chip('apr5') === 'Holzer 8hr', chip('apr5'));
t('A2 Apr 6 (sources merged with calendar-apple): "Holzer 8hr"', chip('apr6') === 'Holzer 8hr', chip('apr6'));
t('A3 Apr 7 (sources merged with qgenda-feed): "Holzer 8hr"', chip('apr7') === 'Holzer 8hr', chip('apr7'));
t('A4 Apr 8 (scalar source is the feed; sources[0] is his entry): "Holzer 8hr"', chip('apr8') === 'Holzer 8hr', chip('apr8'));
t('A5 Apr 9 (trailing-space facility + scalar source poisoned): "Holzer 8hr"', chip('apr9') === 'Holzer 8hr', chip('apr9'));
const grid = run(`calendar()`);
t('A6 grid: five amber "Holzer 8hr" chips, no bare duration chips',
  (grid.match(/<span class="chip[^"]*proposed[^"]*">Holzer 8hr<\/span>/g) || []).length === 5 &&
  !grid.includes('>8hr</span>') && !grid.includes('>8s</span>') && !grid.includes('HOLZ ·'),
  (grid.match(/chip[^"]*">[^<]*<\/span>/g) || []).join(' | '));
t('A7 merged user-entered call shifts name the same way',
  run(`shiftChipLabel({facility:'Holzer',type:'Second call',status:'proposed',source:'user-entered',sources:['user-entered','calendar-apple']})`) === 'Holzer 2nd call' &&
  run(`shiftChipLabel({facility:'Holzer',type:'24-hour call',status:'proposed',source:'calendar-apple',sources:['user-entered']})`) === 'Holzer 24hr call');
t('A8 synced coded rows keep their code chips',
  chip('apr1') === 'HOLZ - G Main (8)' && chip('apr2') === 'HOLZ - G Main (8)', chip('apr1'));
// The screenshot's money: the Apr 27 estimate prices his five
// proposed shifts — and only them — at $2,125 through the engine.
t('A9 Apr 27, 2027 estimated paycheck on his rows = $10,625',
  run(`(()=>{const occ=paystubOccurrencesInMonth('2027-04').find(p=>p.date==='2027-04-27');return occ?paystubOccurrenceTotal(occ):-1})()`) === 10625,
  run(`J=>J`,'') || run(`JSON.stringify(paystubOccurrencesInMonth('2027-04').map(p=>[p.date,paystubOccurrenceTotal(p)]))`));
// A purely feed-sourced code-less row still borrows (v137/v138 C8).
run(`
  db.facilities = [{id:'c1',name:'CAMC',aliases:'',hourlyRate:'250',codeMap:{'5**':{label:'8-hour day shift',hours:'8.5'}}}];
  db.shifts = [{id:'lg',date:'2026-12-01',facility:'CAMC',type:'8-hour day shift',pay:'2125',status:'confirmed',source:'schedule-import',sources:['schedule-import']}]; persist();
`);
t('A10 feed-only code-less row still borrows its clarified code', run(`shiftChipLabel(db.shifts[0])`) === '5**', run(`shiftChipLabel(db.shifts[0])`));

/* ================= FIX 1b: whitespace heal =================== */
run(`
  db = empty();
  db.facilities = [${HOLZ}];
  db.shifts = [${ROWS}];
  db.payStubs = []; db.mileage = []; persist();
`);
t('B1 heal trims the stored trailing space ("Holzer " -> "Holzer")',
  run(`healFacilityWhitespace()`) >= 1 && run(`db.shifts.find(s=>s.id==='apr9').facility`) === 'Holzer',
  run(`db.shifts.find(s=>s.id==='apr9').facility`));
t('B2 heal is idempotent on clean data', run(`healFacilityWhitespace()`) === 0);
run(`db.shifts[0].facility = '  Holzer'; persist();`);
t('B3 healShiftsAfterChange trims too (the merge/sync path)',
  run(`healShiftsAfterChange(); db.shifts[0].facility`) === 'Holzer', run(`db.shifts[0].facility`));
run(`db.facilities = [{id:'w1',name:' Holzer  Health ',aliases:'',hourlyRate:'250'}]; persist();`);
t('B4 facility record names trim at the edges only (interior spacing kept)',
  run(`healFacilityWhitespace(); db.facilities[0].name`) === 'Holzer  Health', run(`db.facilities[0].name`));
// Save paths trim on the way in.
run(`db = empty(); db.facilities = []; db.shifts = []; db.payStubs = []; db.mileage = []; editId = null; persist();`);
sandbox.__formEl = { dataset: { kind: 'facilities' }, _entries: [['name', ' Holzer '], ['aliases', ''], ['address', ''], ['hourlyRate', '250']] };
vm.runInContext(`submitEntry({preventDefault(){}, currentTarget: __formEl})`, sandbox);
t('B5 facility saved with a padded name stores it trimmed',
  run(`(db.facilities[0]||{}).name`) === 'Holzer', J(run(`(db.facilities[0]||{}).name`)));
sandbox.__formEl = { dataset: { kind: 'shifts' }, _entries: [['date', '2027-05-03'], ['facility', 'Holzer '], ['type', '8-hour day'], ['status', 'proposed'], ['pay', ''], ['note', '']] };
vm.runInContext(`submitEntry({preventDefault(){}, currentTarget: __formEl})`, sandbox);
t('B6 hand-added shift saved with a padded facility stores it trimmed — and chips as his entry',
  run(`(db.shifts[0]||{}).facility`) === 'Holzer' && run(`shiftChipLabel(db.shifts[0])`) === 'Holzer 8hr',
  J(run(`(db.shifts[0]||{}).facility`)) + ' / ' + run(`db.shifts.length ? shiftChipLabel(db.shifts[0]) : 'no shift'`));

/* ================= FIX 2: return greeting ==================== */
run(`
  localStorage.removeItem('crna-hub-portal-departure');
  portalDepartureLoaded = false; portalDepartureCache = null;
  db = empty(); db.payStubs = []; db.mileage = []; persist();
  cloudSession = null;
`);
t('C1 no departure: no greeting anywhere',
  run(`portalReturnGreetingHTML()`) === '' && !run(`credentialsPage()`).includes('Welcome back'));
run(`portalDepartureStamp('nbcrna');`);
t('C2 stamped but not yet back: still no greeting', run(`portalReturnGreetingHTML()`) === '');
run(`portalNoteReturn();`);
t('C3 return surfaces the greeting once, on Credentials, naming the source',
  run(`portalReturnSurface()`) === false &&
  run(`portalReturnGreetingHTML()`).includes('Welcome back — tap to run your NBCRNA read') &&
  run(`credentialsPage()`).includes('portal-return-greeting') &&
  run(`credentialsPage()`).includes('data-action="portal-return-read" data-id="nbcrna"'));
run(`actions('portal-return-read', 'nbcrna');`);
t('C4 the greeting button IS the read-request action (request stamped, greeting + stamp gone)',
  !!run(`portalReadRequests['nbcrna']`) && run(`portalReturnGreetingHTML()`) === '' &&
  run(`localStorage.getItem('crna-hub-portal-departure')`) === null,
  J(run(`portalReadRequests`)));
run(`portalDepartureStamp('aana'); portalNoteReturn();`);
const greetA = run(`portalReturnGreetingHTML()`);
run(`actions('portal-return-dismiss', '');`);
run(`portalNoteReturn();`);
t('C5 dismiss: gone, and the same departure never re-greets',
  greetA.includes('run your AANA read') && run(`portalReturnGreetingHTML()`) === '' &&
  run(`portalDeparturePending()`) === null);
run(`portalDepartureStamp('aana'); portalRequestRead('aana');`);
t('C6 a read requested from the card clears the departure (no greeting on return)',
  run(`portalReturnSurface()`) === false && run(`portalReturnGreetingHTML()`) === '' &&
  run(`localStorage.getItem('crna-hub-portal-departure')`) === null);
// (C4's NBCRNA request is still outstanding in the local map — the
// real service filing that read is what closes it; simulate that
// landing first, or the pending request rightly suppresses a new
// greeting: no greeting is owed while a read is already queued.)
run(`portalReadFileResult('nbcrna', '', 'read');`);
run(`portalDepartureStamp('nbcrna'); portalNoteReturn();`);
const greetB = run(`portalReturnGreetingHTML()`);
run(`applyPortalAgentRead('nbcrna', { outcome: 'read', readAt: '2026-11-12T15:00:00.000Z', fields: { status: 'Certified', periodEnd: '2027-04-30' } });`);
t('C7 a filed read result clears the departure (no stale greeting)',
  greetB.includes('Welcome back') && run(`portalReturnGreetingHTML()`) === '' &&
  run(`localStorage.getItem('crna-hub-portal-departure')`) === null);
run(`portalDepartureStamp('nbcrna'); portalNoteReturn();`);
const greetC = run(`portalReturnGreetingHTML()`);
run(`startPortalCheck('nbcrna'); portalCheck = null; portalStatePersist();`);
t('C8 starting the guided check instead also clears it',
  greetC.includes('Welcome back') && run(`portalReturnGreetingHTML()`) === '');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
