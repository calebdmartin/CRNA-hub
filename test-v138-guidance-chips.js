// CRNA Hub v138 — two phases:
// PHASE 1 — wording guidance inside the describe box (Caleb,
// Nov 11, 2026: "We need to have clear instructions on that
// section. Give clear directions on how to word things to make
// it easier for the ai to read. Clearly state things like PCDO
// clarifications and what not."):
//   * ONE shared block (describeGuideHTML, built from the
//     DESCRIBE_GUIDE_* constants) renders IDENTICALLY inside the
//     shared describe component — pinned on the facility card and
//     the contract-import preview; visible by default (present
//     in the box form, above the textarea).
//   * Every example line is MACHINE-TRUE: it is run through the
//     reader and must resolve to the rule it states. Contexts
//     are the panel's own: a generic facility with an hourly rate
//     on its card, and — for lines about a code — that code in
//     the panel's code list, the way facilityDescribeCodes /
//     facPreviewCodes pass it (a call code carries its type from
//     the shift, exactly as the real call sites build it). Two
//     small reader fixes ride along, each pinned below: the
//     weekend statement accepts "Weekends HERE are …", and a
//     paid-hours statement naming a length no listed code
//     carries lands on the facility's paidHours8 when the length
//     is 8 instead of reading back as unattached.
//   * Three lines also run through the AI-primary path
//     (describeReadWithAI with a faithful stub in the deployed
//     function's answer shape) in the WEAKEST context (no codes
//     listed at all) — the production reader resolves them even
//     there.
// PHASE 2 — hand-added shift chips (Caleb's correction, Nov 11,
// 2026, superseding the v137 borrowed-code design): a
// user-entered shift's chip is the facility name he picked + the
// short type — "Holzer 8hr" — never a borrowed schedule code and
// never a bare duration. Pinned with his EXACT stored rows (the
// Apr 5/6, 2027 proposed shifts — note the ABSENT code key) and
// his exact facility record, pulled from his account the night
// he reported it. Synced shifts keep their code chips; the
// amber proposed treatment is unchanged.
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
const urlStub = { createObjectURL: () => APOLOGY, revokeObjectURL: () => {} }; if (typeof sandbox.URL.createObjectURL !== 'function') Object.assign(sandbox.URL, urlStub);
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let fails = 0; const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra)); if (!cond) fails++; };
const J = (v) => JSON.stringify(v);

/* ================= PHASE 1: rendering ======================== */
const GUIDE = run(`describeGuideHTML()`);
const EXAMPLES = run(`DESCRIBE_GUIDE_EXAMPLES`);
t('G0 guide block: intro, safety-net line, exactly ten examples',
  GUIDE.includes(run(`DESCRIBE_GUIDE_INTRO`)) && GUIDE.includes(run(`DESCRIBE_GUIDE_OUTRO`)) && EXAMPLES.length === 10);
t('G0 guide block contains every example line verbatim',
  EXAMPLES.every(e => GUIDE.includes(run(`escapeHTML(${J(e)})`))),
  GUIDE.slice(0, 200));
t('G0 examples are generic — no real facility name, no user rates',
  !/holzer|camc|martin/i.test(EXAMPLES.join(' ')) && !/\$250|\$2,125|\$4,800/.test(EXAMPLES.join(' ')));

// Card surface: open the pay-rules section on a generic facility.
run(`
  db = empty();
  db.facilities = [{id:'gen', name:'General Hospital', aliases:'', address:'', hourlyRate:'200', paidHours8:'', rate8:'', rate10:'', rate12:'', rate24:'', rateSecond:'', hourlyCall1st:'', callBonus:'', weekendRate24:'', weekendRateSecond:'', distance:'', notes:''}];
  db.shifts = []; persist();
  describeStates = {}; describeOpenFac = 'gen'; describeSavedFlashFac = null;
`);
const cardHTML = run(`facilitiesPage()`);
t('G1 card: the guide renders inside the facility describe box',
  cardHTML.includes(GUIDE) && cardHTML.indexOf(GUIDE) > cardHTML.indexOf('Pay rules at General Hospital'),
  cardHTML.slice(cardHTML.indexOf('Pay rules at'), cardHTML.indexOf('Pay rules at') + 120));
t('G1 card: guide sits above the words box (directions before writing)',
  cardHTML.indexOf(GUIDE) < cardHTML.indexOf('id="describe_fac_gen"'));

// Preview surface: a staged contract import for the same facility.
run(`
  db = empty(); editId = null; facilitySuggestionPrefill = null;
  facilityContractPreview = null; facilityContractError = ''; facilityContractOcrStatus = '';
  facilityContractPendingImages = []; facilityContractOcrPages = []; facilityContractConfirmCreate = false;
  describeStates = {};
  facilityContractPreview = parseFacilityContract('Facility: General Hospital\\nPremium hourly rate: $200', 'contract.txt');
`);
const prevHTML = run(`facilityContractPreviewHTML()`);
t('G2 preview: the guide renders inside the preview describe box',
  prevHTML.includes(GUIDE), prevHTML.slice(0, 160));
t('G2 card and preview carry the IDENTICAL guide block',
  cardHTML.includes(GUIDE) && prevHTML.includes(GUIDE) && GUIDE.length > 200);

/* ================= PHASE 1: examples are machine-true ======== */
// The panel's context: a generic facility with an hourly rate.
const GEN = `{id:'gen',name:'General Hospital',aliases:'',hourlyRate:'200',paidHours8:'',rate8:'',rate10:'',rate12:'',rate24:'',rateSecond:'',hourlyCall1st:'',callBonus:'',weekendRate24:'',weekendRateSecond:'',codeMap:{}}`;
run(`db = empty(); db.facilities = [${GEN}]; persist();`);
const FAC = `db.facilities[0]`;
const parse = (text, codes) => run(`describeParseLocal(${J(text)}, ${FAC}, ${J(codes)})`);
const E = {}; EXAMPLES.forEach((e, i) => { E[i] = e; });

// 0 — hourly
{ const p = parse(E[0], []); t('E0 hourly: "$200/hr" lands as the hourly rate', p.rates.hourlyRate === 200 && !p.unanswered.length, J(p)); }
// 1 — paid hours ≠ shift length (the v138 reader fix: no code
// of that length is listed, so the figure takes its facility
// home instead of reading back as unattached)
{ const p = parse(E[1], []); t('E1 paid hours: 8.5 paid hours for the 8-hour shift lands on paidHours8',
  p.rates.paidHours8 === 8.5 && !p.unanswered.length, J(p)); }
// 2 — named code, "=" form (the code is on the schedule, so the
// panel lists it)
{ const p = parse(E[2], [{ code: 'D8' }]); const d = p.defs.D8 || {};
  t('E2 code "=": D8 defines as an 8-hour day', String(d.hours) === '8' && d.canonicalType === '8-hour day' && !p.unanswered.length, J(p)); }
// 3 — named code, sentence form
{ const p = parse(E[3], [{ code: 'Main 10' }]); const d = p.defs['Main 10'] || {};
  t('E3 code sentence: Main 10 defines as a 10-hour shift', String(d.hours) === '10' && d.canonicalType === '10-hour shift' && !p.unanswered.length, J(p)); }
// 4 — 1st call, weekday/weekend split (the panel's call code
// carries its type from the shift, as the real call sites build)
{ const p = parse(E[4], [{ code: 'Call 1', ctype: '24-hour call', hours: 24 }]);
  t('E4 call split: $4,500 weekday / $3,900 weekend land on the 24h-call rates',
    p.rates.rate24 === 4500 && p.rates.weekendRate24 === 3900 && !p.unanswered.length, J(p)); }
// 5 — 2nd call flat
{ const p = parse(E[5], []); t('E5 second call flat: $2,800 lands', p.rates.rateSecond === 2800 && !p.unanswered.length, J(p)); }
// 6 — unpaid code, stated explicitly (the PCDO clarification)
{ const p = parse(E[6], [{ code: 'PCDO' }]); const d = p.defs.PCDO || {};
  t('E6 unpaid code: PCDO defines as no pay', d.unpaid === true && /post call day off/i.test(d.label || '') && !p.unanswered.length, J(p)); }
// 7 — unpaid, generic subject (the code on the schedule is the
// word itself)
{ const p = parse(E[7], [{ code: 'Orientation' }]); const d = p.defs.Orientation || {};
  t('E7 unpaid days: Orientation defines as no pay', d.unpaid === true && !p.unanswered.length, J(p)); }
// 8 — same-as (its twin is defined in the same words, the way a
// user writes the pair; plus the saved-twin form)
{ const p = parse('N5+ is a 10-hour shift\n' + E[8], [{ code: 'N5' }, { code: 'N5+' }]);
  const a = p.defs.N5 || {}, b = p.defs['N5+'] || {};
  t('E8 same-as: N5 inherits the 10-hour definition from N5+',
    String(a.hours) === '10' && String(b.hours) === '10' && !p.unanswered.length, J(p)); }
{ run(`db.facilities[0].codeMap = {'N5+': {label:'10-hour shift', hours:'10', canonicalType:'10-hour shift', viaWords:true}}; persist();`);
  const p = parse(E[8], [{ code: 'N5' }, { code: 'N5+', ctype: '10-hour shift', hours: 10 }]);
  const a = p.defs.N5 || {};
  t('E8b same-as: with N5+ already saved, the line alone defines N5 from it',
    String(a.hours) === '10' && !p.unanswered.length, J(p));
  run(`db.facilities[0].codeMap = {}; persist();`); }
// 9 — weekend definition (the v138 reader fix: "here")
{ const p = parse(E[9], []); t('E9 weekend: Saturday and Sunday, stated',
  J(p.weekendDays) === '[0,6]' && p.weekendStated === true && !p.unanswered.length, J(p)); }

// The whole set pasted at once — the way a user copies the
// pattern: one rule per line, no periods. Everything resolves;
// nothing cross-files.
{ const ALL = [{ code: 'D8' }, { code: 'Main 10' }, { code: 'Call 1', ctype: '24-hour call', hours: 24 }, { code: 'PCDO' }, { code: 'Orientation' }, { code: 'N5' }, { code: 'N5+' }];
  const text = EXAMPLES.slice(0, 8).concat(['N5+ is a 10-hour shift', EXAMPLES[8], EXAMPLES[9]]).join('\n');
  const p = parse(text, ALL);
  t('SET: hourly + call split + second call all land',
    p.rates.hourlyRate === 200 && p.rates.rate24 === 4500 && p.rates.weekendRate24 === 3900 && p.rates.rateSecond === 2800, J(p.rates));
  t('SET: codes define (D8 paid 8.5, Main 10, PCDO unpaid, N5 pair)',
    String((p.defs.D8 || {}).hours) === '8' && Number((p.defs.D8 || {}).paidHours) === 8.5 &&
    String((p.defs['Main 10'] || {}).hours) === '10' && (p.defs.PCDO || {}).unpaid === true &&
    String((p.defs.N5 || {}).hours) === '10' && String((p.defs['N5+'] || {}).hours) === '10', J(p.defs));
  t('SET: weekend stated; nothing left unanswered',
    p.weekendStated === true && !p.unanswered.length, J(p.unanswered)); }

/* ============ PHASE 1: AI-primary path, weakest context ===== */
(async () => {
  // The reader posts through the same-origin proxy (/api/fn)
  // and the function's answer arrives under `read`; quoted
  // amounts carry {value, quote} — the deployed answer shape,
  // exactly as the v133 fixtures recorded it.
  const stubAI = (read) => {
    const realFetch = sandbox.fetch;
    sandbox.fetch = async (url, opts) => {
      if (String(url).includes('/api/fn')) {
        const payload = { read };
        return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload };
      }
      return realFetch(url, opts);
    };
    return () => { sandbox.fetch = realFetch; };
  };
  run(`cloudSession = { access_token: 'tok' };`);
  const FAC0 = `{id:'gen0',name:'General Hospital',aliases:'',codeMap:{}}`;
  const CTX0 = (codes) => `{fac:${FAC0},facName:'General Hospital',codes:${J(codes || [])}}`;
  const readAI = async (text, codes) => {
    const local = run(`describeParseLocal(${J(text)}, ${FAC0}, ${J(codes || [])})`);
    return run(`describeReadWithAI(${J(text)}, ${CTX0(codes)}, describeParseLocal(${J(text)}, ${FAC0}, ${J(codes || [])}), {})`);
  };
  // Paid hours, no codes listed anywhere: the AI supplies the
  // facility figure with a verbatim quote.
  { const off = stubAI({ paid_hours_8: { value: 8.5, quote: "I'm paid for 8.5 hours" }, codes: [], unknown: [] });
    const p = await readAI(E[1], []);
    off();
    t('AI E1: paid-hours line resolves with nothing listed', !!p && p.rates.paidHours8 === 8.5 && !(p.unanswered || []).length, J(p && p.rates)); }
  // Call split, no codes listed: the AI names the call itself
  // and supplies both figures on its definition.
  { const off = stubAI({ codes: [{ code: '1st call', label: '24-hour call', weekday_pay: { value: 4500, quote: '1st call pays $4,500 on weekdays' }, weekend_pay: { value: 3900, quote: '$3,900 on weekends' } }], unknown: [] });
    const p = await readAI(E[4], []);
    off();
    const def = p ? Object.values(p.defs || {}).find(d => d.canonicalType === '24-hour call') : null;
    t('AI E4: call-split line resolves with nothing listed',
      !!def && p.rates.rate24 === 4500 && p.rates.weekendRate24 === 3900 && !(p.unanswered || []).length, J(p && p.rates)); }
  // Weekend, no codes listed.
  { const off = stubAI({ codes: [], weekend: { days: ['Sunday', 'Saturday'], stated: true, quote: 'Weekends here are Saturday and Sunday only' }, unknown: [] });
    const p = await readAI(E[9], []);
    off();
    t('AI E9: weekend line resolves stated', !!p && p.weekendStated === true && J(p.weekendDays) === '[0,6]', J(p && p.weekendDays)); }
  run(`cloudSession = null;`);

  /* ================= PHASE 2: chips, his exact bytes ========= */
  // His facility record as pulled from his account tonight
  // (rates + the full code map, PCDO saved by his words re-run).
  const HOLZ = `{id:'holz',name:'Holzer',aliases:'Holzer, HOLZ',address:'100 Jackson Pike, Gallipolis, OH 45631',hourlyRate:'250',paidHours8:'8.5',rate8:'2125',rate10:'',rate12:'',rate24:'4800',rateSecond:'3000',hourlyCall1st:'4800',callBonus:'4200',weekendRate24:'4200',weekendRateSecond:'2000',weekendDays:[0,6],weekendDaysSource:'stated',codeMap:{
    '8s':{hours:'8',label:'8-hour shift',viaWords:true,paidHours:'8.5',canonicalType:'8-hour day',rulesConfirmed:true},
    '8hr':{hours:'8',label:'8-hour shift',viaWords:true,paidHours:'8.5',canonicalType:'8-hour day',rulesConfirmed:true},
    'Call 2':{label:'Call 2 weekday',canonicalType:'Second call'},
    '1st call':{hours:'24',label:'1st call weekday',canonicalType:'24-hour call'},
    'HOLZ - PCDO':{label:'post call day off',unpaid:true,canonicalType:''},
    'HOLZ - Call 1':{label:'24-hour call',canonicalType:'24-hour call'},
    'HOLZ - G Main (8)':{hours:'8',label:'8-hour day',viaWords:true,paidHours:'8.5',canonicalType:'8-hour day',rulesConfirmed:true},
    'HOLZ - G Main (10)':{label:'10-hour shift',canonicalType:'10-hour shift'}}}`;
  // His two rows, byte for byte in shape: NO code key at all.
  const ROW = (id, date) => `{id:'${id}',date:'${date}',facility:'Holzer',type:'8-hour day',pay:'2125',status:'proposed',source:'user-entered',sources:['user-entered'],note:'',payRate:'',payUnit:'',incomplete:false}`;
  run(`
    db = empty();
    db.facilities = [${HOLZ}];
    db.shifts = [${ROW('ce395add-c196-49f0-8aa5-2f35db8e067c', '2027-04-05')}, ${ROW('b041d9bf-93a5-49c4-88f7-bed8765f21fc', '2027-04-06')}];
    db.payStubs = []; db.mileage = [];
    month = new Date(2027, 3, 1); selected = '2027-04-05'; persist();
  `);
  t('C0 his rows really carry no code key', run(`!('code' in db.shifts[0]) && !('code' in db.shifts[1])`));
  t('C1 proposed hand-added 8hr at Holzer: chip is "Holzer 8hr"',
    run(`shiftChipLabel(db.shifts[0])`) === 'Holzer 8hr' && run(`shiftChipLabel(db.shifts[1])`) === 'Holzer 8hr',
    run(`shiftChipLabel(db.shifts[0])`));
  const grid = run(`calendar()`);
  t('C2 grid: both chips read "Holzer 8hr" in the amber proposed treatment',
    (grid.match(/<span class="chip[^"]*proposed[^"]*">Holzer 8hr<\/span>/g) || []).length === 2, grid.slice(grid.indexOf('chip'), grid.indexOf('chip') + 120));
  t('C3 grid: no chip borrows the QGenda code for a hand-added shift',
    !grid.includes('>HOLZ - G Main (8)</span>') && !grid.includes('>8s</span>') && !grid.includes('>8hr</span>'));
  run(`db.shifts[0].status = 'confirmed'; persist();`);
  const grid2 = run(`calendar()`);
  t('C4 confirmed hand-added: same name, normal (non-amber) treatment',
    /<span class="chip[^"]*">Holzer 8hr<\/span>/.test(grid2) &&
    (grid2.match(/<span class="chip[^"]*proposed[^"]*">Holzer 8hr<\/span>/g) || []).length === 1,
    'the confirmed Apr 5 chip loses the amber class; the still-proposed Apr 6 chip keeps it');
  t('C5 hand-added types: 2nd call and 24hr call name the same way',
    run(`shiftChipLabel({facility:'Holzer', type:'Second call', status:'proposed', source:'user-entered'})`) === 'Holzer 2nd call' &&
    run(`shiftChipLabel({facility:'Holzer', type:'24-hour call', status:'proposed', source:'user-entered'})`) === 'Holzer 24hr call');
  // Synced shifts keep their code chips, untouched.
  t('C6 synced shift keeps its code chip',
    run(`shiftChipLabel({facility:'Holzer', code:'HOLZ - G Main (8)', type:'8-hour day', status:'confirmed', source:'calendar-apple'})`) === 'HOLZ - G Main (8)');
  // No code map at all: the facility+type name never depended on
  // borrowing in the first place.
  run(`db.facilities = [{id:'bare',name:'Holzer',aliases:'',hourlyRate:'250'}]; persist();`);
  t('C7 hand-added with an empty code map still reads "Holzer 8hr"',
    run(`shiftChipLabel(db.shifts[1])`) === 'Holzer 8hr', run(`shiftChipLabel(db.shifts[1])`));
  // A code-less FEED shift still resolves through the code map
  // (the v137 borrow survives where it belongs).
  run(`
    db.facilities = [{id:'c1',name:'CAMC',aliases:'',hourlyRate:'250',codeMap:{'5**':{label:'8-hour day shift',hours:'8.5'}}}];
    db.shifts = [{id:'lg',date:'2026-12-01',facility:'CAMC',type:'8-hour day shift',pay:'2125',status:'confirmed',source:'schedule-import'}]; persist();
  `);
  t('C8 code-less feed shift still borrows its clarified code', run(`shiftChipLabel(db.shifts[0])`) === '5**', run(`shiftChipLabel(db.shifts[0])`));

  console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
