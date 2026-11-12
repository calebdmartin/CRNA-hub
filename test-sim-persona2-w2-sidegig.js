'use strict';
// SIMULATED USER P2 — "Sam Reyes", W-2 staff CRNA with a 1099
// weekend side gig. Standing simulated-user pass (approved by
// Caleb Nov 11, 2026). Run directly or via test-sim-run-all.js.
// See hidden_files/simulated-user-pass.md.
//
// JOURNEY: employment type "both". The W-2 job (University
// Medical Center) has NO pay rules — salary is not shift money.
// Its workdays arrive by calendar import and stay unpriced; its
// PTO salary day is added by hand (type "Off / PTO", the app's
// salary-day path) with a $6,000 salary value typed on it. The
// side gig (Lakeside Surgery) gets words-set rates, Saturday
// shifts by feed import, and a biweekly pay schedule.
//
// HAND MATH — Lakeside, $180/hr: LS10 $1,800, LS8 $1,440.
//   Saturdays: May 1 LS10 1800 · May 8 LS8 1440 · May 15 LS10 1800
//   · May 22 LS8 1440 -> side-gig total $6,480.
//   Paychecks (biweekly, periods Mon-Sun): Tue May 18 pays the
//   Apr 26 - May 9 period = 1800 + 1440 = $3,240; Tue Jun 1 pays
//   May 10 - 23 = 1800 + 1440 = $3,240.
//   C/P for 2027 (year and May month splits): C = P = $6,480 —
//   the W-2 job contributes NOTHING: its 3 workdays are unpriced,
//   its PTO day is a W-2 salary day (counted as w2Salary, priced
//   w2SalaryPriced, and in NO money total) even with $6,000 typed
//   on it. Never double-counting W-2 salary is the Nov 6, 2026
//   rule this persona exists to hold.
// NOTE: the month HEADLINE banner is deliberately not asserted
// here — see test-sim-found-bugs.js FB1, where the headline's
// treatment of that same $6,000 is pinned as a found bug.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) { return { id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [], dataset: {}, style: {}, _listeners: {}, _entries: null, addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }, append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [] }; }
const elements = {}; const getEl = (id) => elements[id] || (elements[id] = el(id));
class FakeFormData { constructor(f) { this._map = (f && f._map) || {}; this._e = (f && f._entries) || []; } get(k) { return k in this._map ? this._map[k] : null; } *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; } }
const sandbox = { console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math, crypto: require('crypto').webcrypto, FormData: FakeFormData, localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }, document: { getElementById: (id) => getEl(id), querySelectorAll: () => [], createElement: () => el(), body: { append() {} }, addEventListener() {} }, window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' }, alert: () => {}, confirm: () => true, fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }), history: { replaceState() {} } };
sandbox.window = sandbox; sandbox.window.scrollTo = () => {};
if (typeof sandbox.URL.createObjectURL !== 'function') Object.assign(sandbox.URL, { createObjectURL: () => 'data:,', revokeObjectURL: () => {} });
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra)); if (!cond) { fails++; process.exitCode = 1; } };
const J = (v) => JSON.stringify(v);
const BLANK_CARD = { address: '', hourlyRate: '', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', rateSecond: '', hourlyCall1st: '', callBonus: '', weekendRate24: '', weekendRateSecond: '', distance: '', notes: '' };

run(`
  db = empty(); db.settings.scheduleName = 'Reyes'; db.settings.employmentType = 'both';
  db.facilities = [
    { id:'umc', name:'University Medical Center', aliases:'University Medical Center, UMC', ${J(BLANK_CARD).slice(1, -1)} },
    { id:'lks', name:'Lakeside Surgery', aliases:'Lakeside Surgery, LS', ${J(BLANK_CARD).slice(1, -1)} }
  ];
  db.shifts = []; db.payStubs = []; persist();
`);
t('P2 profile: hybrid employment reads as W-2 + 1099, and 1099 income is switched on',
  run(`employmentType()`) === 'both' && run(`employmentIncludes1099()`) === true);

/* ================= Side gig: words + Saturday feed ============== */
const LK_WORDS = ['Day shifts pay $180/hr', 'LS8 = an 8-hour shift', 'LS10 is a 10-hour shift'].join('\n');
const LK_CODES = [{ code: 'LS8', ctype: '8-hour day', hours: 8 }, { code: 'LS10', ctype: '10-hour shift', hours: 10 }];
run(`applyDescribedRules(db.facilities[1], describeParseLocal(${J(LK_WORDS)}, db.facilities[1], ${J(LK_CODES)})); persist();`);
t('P2 gig card: $180/hr saved from words', run(`db.facilities[1].hourlyRate`) === '180');
const FEED = [
  ['2027-05-01', 'LS10', '10-hour shift'], ['2027-05-08', 'LS8', '8-hour day'],
  ['2027-05-15', 'LS10', '10-hour shift'], ['2027-05-22', 'LS8', '8-hour day'],
].map(([date, code, type]) => ({ date, facility: 'Lakeside Surgery', type, code, pay: '', name: 'Reyes', matchedName: 'Reyes', match: 'matched', include: true, duplicate: false, flags: [], source: 'qgenda-feed' }));
run(`schedulePreview = { fileName:'qgenda', matchedName:'Reyes', source:'qgenda-feed', rows: ${J(FEED)} }; approveScheduleImport();`);
t('P2 gig feed: 4 Saturdays land at hand prices ($1,800 / $1,440 alternating)',
  run(`db.shifts.filter(x => x.facility === 'Lakeside Surgery').map(x => x.pay).join(',')`) === '1800,1440,1800,1440',
  run(`db.shifts.filter(x => x.facility === 'Lakeside Surgery').map(x => x.pay).join(',')`));

/* ================= W-2 job: calendar workdays =================== */
const ev = (uid, s, ds, de) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${s}\r\nDTSTART${ds}\r\nDTEND${de}\r\nEND:VEVENT\r\n`;
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
  ev('u1', 'UMC Day Shift', ':20270503T070000Z', ':20270503T150000Z') +
  ev('u2', 'UMC Day Shift', ':20270504T070000Z', ':20270504T150000Z') +
  ev('u3', 'UMC Day Shift', ':20270505T070000Z', ':20270505T150000Z') +
  'END:VCALENDAR';
run(`(() => { const parsed = parseICS(${J(ICS)}, 'cal.ics');
  const rows = parsed.rows.map((r) => ({ ...r, source:'calendar-file', sourceLabel:'Calendar file', include:true, duplicate:false, incomplete: !String(r.pay || '').trim(), note:'Imported from Calendar file (.ics): cal.ics' }));
  calPreview = { fileName:'cal.ics', sourceLabel:'Calendar file', sourceCode:'calendar-file', rows }; })();
  approveCalendarImport();`);
t('P2 W-2 import: 3 workdays land confirmed and UNPRICED (a salary job has no rate card)',
  run(`db.shifts.filter(x => x.facility === 'University Medical Center').length`) === 3 &&
  run(`db.shifts.filter(x => x.facility === 'University Medical Center').every(x => x.status === 'confirmed' && x.pay === '' && x.incomplete === true)`) === true,
  J(run(`db.shifts.filter(x => x.facility === 'University Medical Center').map(x => [x.date, x.pay, x.incomplete])`)));

/* ================= The PTO salary day, added by hand ============ */
run(`__submitShift = (map) => { const form = { dataset: { kind: 'shifts' }, _map: map }; submitEntry({ preventDefault(){}, currentTarget: form }); };`);
run(`month = new Date(2027, 4, 1); selected = '2027-05-06'; dayViewOpen = false; showShiftForm = false; editId = null; flashDay = ''; tab = 'Dashboard'; persist(); actions('add-shift');`);
run(`__submitShift({ date:'2027-05-06', facility:'University Medical Center', type:'Off / PTO', status:'confirmed', pay:'6000', note:'' });`);
t('P2 PTO: the hand-added day is a W-2 salary day (type Off / PTO, $6,000 typed on it)',
  run(`db.shifts.filter(x => /pto/i.test(x.type)).length`) === 1 &&
  run(`isW2SalaryShift(db.shifts.find(x => /pto/i.test(x.type)))`) === true &&
  run(`db.shifts.find(x => /pto/i.test(x.type)).pay`) === '6000');

/* ================= Gig pay schedule + paychecks ================= */
run(`db.payStubs = [{ id:'ls-sched', agency:'Lakeside Anesthesia Group', facility:'Lakeside Surgery', frequency:'biweekly', periodStart:'2027-04-26', periodEnd:'2027-05-09', payDate:'2027-05-18', gross:'', net:'', source:'manual' }]; persist();`);
const occMay = run(`paystubOccurrences(db.payStubs[0], '2027-05-01', '2027-05-31').find(o => o.date === '2027-05-18')`);
const occJun = run(`paystubOccurrences(db.payStubs[0], '2027-06-01', '2027-06-30').find(o => o.date === '2027-06-01')`);
t('P2 paychecks: May 18 = $3,240 and Jun 1 = $3,240 — side gig only, periods claimed exactly',
  !!occMay && occMay.total === 3240 && occMay.shiftCount === 2 && !!occJun && occJun.total === 3240 && occJun.shiftCount === 2,
  J([occMay, occJun]));

/* ================= C/P: salary never double-counted ============= */
const ms = run(`monthIncomeSplit('2027-05')`);
t('P2 month split: May C = P = $6,480 (gig only); W-2 days counted apart, workdays unpriced',
  ms.c === 6480 && ms.p === 6480 && ms.w2Salary === 1 && ms.unpriced === 3, J(ms));
const ys = run(`yearIncomeSplit(2027, '2027-05-01')`);
t('P2 year split: C predicted = P predicted = $6,480; the $6,000 PTO value is in NO total',
  ys.c.predicted === 6480 && ys.p.predicted === 6480 && ys.w2Salary === 1 && ys.w2SalaryPriced === 1 && ys.unpriced === 3,
  J({ c: ys.c.predicted, p: ys.p.predicted, w2: ys.w2Salary, w2p: ys.w2SalaryPriced, un: ys.unpriced }));
run(`selected = '2027-05-06'; month = new Date(2027, 4, 1); dayViewOpen = true;`);
t('P2 day sheet: the PTO day carries the "W-2 salary day — excluded from income totals" label',
  run(`dayViewHTML()`).includes('W-2 salary day — excluded from income totals'));

/* ============ Month headline, worked basis (promoted FB1) =======
   Promoted from test-sim-found-bugs.js (fixed in v139). The
   journey above runs May on a pay schedule (paycheck basis);
   with NO schedule the banner is the worked sum, and that loop
   counted the W-2 salary day's typed value too — a hybrid
   user's headline double-counted salary ($6,800 shown for an
   $800 gig month). monthHeadline now skips isW2SalaryShift
   like every other total. Minimal repro, exactly the pin. */
run(`
  db = empty(); db.settings.employmentType = 'both';
  db.facilities = [{ id:'gig', name:'Gig Hospital', aliases:'', hourlyRate:'100' }];
  db.shifts = [
    { id:'g1', date:'2027-05-15', facility:'Gig Hospital', type:'8-hour day', pay:'800', payUnit:'facility', status:'confirmed', incomplete:false, source:'qgenda-feed' },
    { id:'w1', date:'2027-05-06', facility:'Gig Hospital', type:'Off / PTO', pay:'6000', status:'confirmed', incomplete:false, source:'user-entered' }
  ];
  db.payStubs = []; persist();
`);
const fb1HeadP2 = run(`monthHeadline('2027-05')`);
t('P2 headline (worked basis): $800 gig month + $6,000 PTO value -> headline $800, banner agrees with the split',
  fb1HeadP2.gross === 800 && run(`monthIncomeSplit('2027-05')`).p === 800,
  J({ headline: fb1HeadP2.gross, worked: fb1HeadP2.worked }));

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
