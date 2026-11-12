// CRNA Hub — v150 (Nov 12, 2026):
//   Item 1 — State CE requirements in the app. Caleb: "We need to
//     make sure the app can see and pull all required continuing
//     education for all states" + appropriate alerts. Source: the
//     Nov 2026 audit of all 51 jurisdictions
//     (state-ce-requirements.md: 36 verified · 10 likely · 5 conflict
//     — AK, DE, DC, ID, WY assert NO number). The app carries the
//     requirements table, shows each license's requirement + CE
//     progress on its v145 info strip, lets a CE record be assigned
//     to a license (state + type) with a category via two optional
//     pickers on the existing add-CE form, and mirrors per-license
//     progress into settings.watch.ceLicenses for the push watchdog.
//   Item 2 — Dashboard "Upcoming shifts" section removed (Caleb,
//     Nov 12, 2026: "Just to clean things up" — it duplicated the
//     calendar).
// Run: node test-v150-ce-requirements.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, scrollIntoView() {},
  };
}
const elements = {};
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  document: {
    getElementById: (id) => elements[id] || (elements[id] = el()),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
    addEventListener() {}, hidden: false,
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {}, confirm: () => true, prompt: () => null,
  fetch: async (url, opts) => {
    if (((opts && opts.method) || 'GET') === 'GET') return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
    return { status: 201, ok: true, text: async () => '', json: async () => ({}) };
  },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
let failures = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra ? ' — ' + extra : ''));
  if (!cond) { failures++; process.exitCode = 1; }
};
const J = (v) => JSON.stringify(v);

// ---------- 1. Table completeness ----------
const tbl = run(`STATE_CE_REQUIREMENTS`);
t('table has all 51 jurisdictions', tbl.length === 51, 'got ' + tbl.length);
const CONFLICTS = ['Alaska', 'Delaware', 'District of Columbia', 'Idaho', 'Wyoming'];
const hasHours = (r) => r && typeof r === 'object' && typeof r.h === 'number';
t('every non-conflict jurisdiction has an RN rule',
  tbl.every(j => j.conflict ? true : j.rn !== undefined && j.rn !== null));
t('conflicts carry conflict:true, a note, and NO asserted hours',
  CONFLICTS.every(name => {
    const j = tbl.find(x => x.state === name);
    return j && j.conflict === true && String(j.note || '').length > 10 &&
      !hasHours(j.rn) && !hasHours(j.aprn) && !hasHours(j.crna);
  }), J(CONFLICTS.map(n => tbl.find(x => x.state === n))));
t('conflict state set is exactly AK, DE, DC, ID, WY',
  J(tbl.filter(j => j.conflict).map(j => j.state).sort()) === J(CONFLICTS.slice().sort()));

// Anchors — WV (from the WV portal) and OH (board rules).
const wv = run(`stateCeOf('WV')`);
t('WV RN = 12 hrs', wv.rn.h === 12, J(wv.rn));
t('WV APRN = 24 hrs / 2 yrs = 12 pharmacotherapeutics + 12 clinical management',
  wv.aprn.h === 24 && wv.aprn.y === 2 &&
  J(wv.aprn.s) === J([['pharmacotherapeutics', 12], ['clinical management', 12]]), J(wv.aprn));
const oh = run(`stateCeOf('Ohio')`);
t('OH RN = 24 hrs / 2 yrs incl. 1 hr Category A',
  oh.rn.h === 24 && oh.rn.y === 2 && oh.rn.s.some(s => s[0] === 'Category A' && s[1] === 1), J(oh.rn));
t('OH APRN is additive: 24 on top of the RN 24',
  oh.aprn.h === 24 && oh.aprn.add === 24, J(oh.aprn));
t('OH APRN pharmacology sub is flagged noCrna (CRNAs exempt)',
  oh.aprn.s.some(s => s[0] === 'advanced pharmacology' && s[2] === 'noCrna'), J(oh.aprn.s));

// ---------- 2. Requirement text / strip rendering ----------
run(`db = empty();`);
const licText = (lic) => run(`licenseCeText(${J(lic)})`);
t('WV APRN-CRNA strip line',
  licText({ state: 'WV', type: 'APRN-CRNA', expiry: '2027-06-30' }) ===
  'CE 24 hrs / 2 yrs · 12 pharmacotherapeutics · 12 clinical management · CE not tracked yet',
  licText({ state: 'WV', type: 'APRN-CRNA', expiry: '2027-06-30' }));
t('WV RN strip line', licText({ state: 'West Virginia', type: 'RN', expiry: '2028-06-30' }).startsWith('CE 12 hrs'),
  licText({ state: 'West Virginia', type: 'RN', expiry: '2028-06-30' }));
t('OH RN strip line',
  licText({ state: 'OH', type: 'RN', expiry: '2028-06-30' }).startsWith('CE 24 hrs / 2 yrs · 1 Category A'),
  licText({ state: 'OH', type: 'RN', expiry: '2028-06-30' }));
t('OH APRN-CRNA = 48 combined, NO pharmacology sub',
  (() => { const s = licText({ state: 'Ohio', type: 'APRN-CRNA', expiry: '2027-10-31' });
    return s.startsWith('CE 48 hrs / 2 yrs (24 RN + 24 APRN)') && !s.includes('pharmacology'); })(),
  licText({ state: 'Ohio', type: 'APRN-CRNA', expiry: '2027-10-31' }));
t('OH APRN (non-CRNA) keeps the pharmacology sub',
  licText({ state: 'Ohio', type: 'APRN', expiry: '2027-10-31' }).includes('12 advanced pharmacology'),
  licText({ state: 'Ohio', type: 'APRN', expiry: '2027-10-31' }));
t('no-CE state (Montana RN)', licText({ state: 'Montana', type: 'RN', expiry: '2027-10-01' }) === 'No CE required for renewal',
  licText({ state: 'Montana', type: 'RN', expiry: '2027-10-01' }));
t('conflict state (Alaska RN) asserts no number',
  licText({ state: 'Alaska', type: 'RN', expiry: '2027-06-30' }) === 'CE rules unclear — check with your board',
  licText({ state: 'Alaska', type: 'RN', expiry: '2027-06-30' }));
t('PA CRNA practices on the RN license',
  licText({ state: 'Pennsylvania', type: 'APRN-CRNA', expiry: '2027-10-31' }).startsWith('Practices on the RN license — CE 30 hrs'),
  licText({ state: 'Pennsylvania', type: 'APRN-CRNA', expiry: '2027-10-31' }));
t('strip facts carry the CE line (v145 component)',
  run(`licenseStripFacts({state:'WV', type:'APRN-CRNA', number:'103459', status:'Active', expiry:'2027-06-30', reminders:'90,60,30,7'}).join(' · ')`).includes('CE 24 hrs / 2 yrs'));

// ---------- 3. Progress math ----------
run(`
  db = empty();
  db.licenses = [{id:'wv-aprn', state:'WV', type:'APRN-CRNA', number:'103459', status:'Active', expiry:'2027-06-30', reminders:'90,60,30,7'}];
  db.nbcrnaCE = [
    {id:'c1', title:'Pharm course', date:'2026-01-15', credits:'4', licState:'West Virginia', licType:'APRN-CRNA', category:'pharmacotherapeutics'},
    {id:'c2', title:'General course', date:'2026-02-01', credits:'5', licState:'West Virginia', licType:'APRN-CRNA', category:'General'},
    {id:'c3', title:'Old course', date:'2024-01-01', credits:'10', licState:'West Virginia', licType:'APRN-CRNA', category:'pharmacotherapeutics'},
    {id:'c4', title:'Ohio course', date:'2026-03-01', credits:'7', licState:'Ohio', licType:'RN', category:'General'},
    {id:'c5', title:'Unassigned', date:'2026-03-05', credits:'3'}
  ];
  db.aanaCE = [];
`);
const prog = run(`ceProgressFor(db.licenses[0], ceRequirementFor(db.licenses[0]))`);
t('progress: in-window assigned hours only (4 + 5 = 9 of 24)', prog && prog.total === 9, J(prog));
t('progress: sub counts category-matching records only (pharmacotherapeutics 4 of 12)',
  prog && prog.subs.find(s => s.label === 'pharmacotherapeutics').have === 4 &&
  prog.subs.find(s => s.label === 'clinical management').have === 0, J(prog && prog.subs));
t('progress text on the strip',
  licText({ state: 'WV', type: 'APRN-CRNA', expiry: '2027-06-30' }) ===
  'CE 24 hrs / 2 yrs · 12 pharmacotherapeutics · 12 clinical management · CE on file: 9 of 24 hrs · pharmacotherapeutics 4 of 12 · clinical management 0 of 12',
  licText({ state: 'WV', type: 'APRN-CRNA', expiry: '2027-06-30' }));
run(`db.nbcrnaCE = [{id:'c5', title:'Unassigned', date:'2026-03-05', credits:'3'}];`);
t('no assigned records -> progress null, strip says not tracked yet (never a fake shortfall)',
  run(`ceProgressFor(db.licenses[0], ceRequirementFor(db.licenses[0]))`) === null &&
  licText({ state: 'WV', type: 'APRN-CRNA', expiry: '2027-06-30' }).endsWith('CE not tracked yet'));

// Assignment sidecar: rebuild from records, strip fields, re-attach.
run(`
  db.nbcrnaCE = [{id:'c1', title:'Pharm course', date:'2026-01-15', credits:'4', licState:'West Virginia', licType:'APRN-CRNA', category:'pharmacotherapeutics'}];
  ceAssignRebuild();
`);
t('ceAssignRebuild writes the settings sidecar',
  run(`(db.settings.ceAssign||{}).c1 && db.settings.ceAssign.c1.s`) === 'West Virginia' &&
  run(`db.settings.ceAssign.c1.c`) === 'pharmacotherapeutics', J(run(`db.settings.ceAssign`)));
run(`delete db.nbcrnaCE[0].licState; delete db.nbcrnaCE[0].licType; delete db.nbcrnaCE[0].category; ceAssignAttach();`);
t('ceAssignAttach restores assignment + category after a cloud round-trip',
  run(`db.nbcrnaCE[0].licState`) === 'West Virginia' && run(`db.nbcrnaCE[0].category`) === 'pharmacotherapeutics');

// Form: two optional pickers on the EXISTING add-CE form; submitEntry splits countsToward.
const form = run(`ceForm('nbcrnaCE', 'NBCRNA CE', {})`);
t('add-CE form has the Counts toward + Category pickers',
  form.includes('name="countsToward"') && form.includes('name="category"') && form.includes('Counts toward a license (optional)'), form.slice(0, 200));
t('submitEntry splits countsToward into licState/licType (source pin)',
  appSrc.includes("record.licState=ix>=0?tw.slice(0,ix):''") && appSrc.includes('delete record.countsToward'));

// Watchdog mirror (client side).
run(`
  db = empty();
  db.licenses = [
    {id:'wv-aprn', state:'WV', type:'APRN-CRNA', expiry:'2027-06-30', reminders:'90,60,30,7'},
    {id:'ak-rn', state:'AK', type:'RN', expiry:'2027-06-30', reminders:'90,60,30,7'}
  ];
  db.nbcrnaCE = [{id:'c1', title:'Pharm course', date:'2026-01-15', credits:'4', licState:'West Virginia', licType:'APRN-CRNA', category:'pharmacotherapeutics'}];
  pushWatchRefreshCE();
`);
const mirror = run(`db.settings.watch.ceLicenses`);
t('mirror: WV entry carries requirement + tracked progress',
  mirror.some(e => e.key === 'WV|APRN-CRNA' && e.total === 24 && e.tracked && e.tracked.total === 4), J(mirror));
t('mirror: conflict license is flagged excluded (watchdog never alerts it)',
  mirror.some(e => e.key === 'AK|RN' && e.excluded === true), J(mirror));

// Provenance line under the State Licenses card.
t('provenance line renders in the State Licenses card',
  run(`stateLicensesCardHTML()`).includes("Requirements from each state board's published rules, checked Nov 2026. Your board is the final word."));

// ---------- 4. Dashboard: no Upcoming shifts ----------
run(`db = empty(); month = new Date(); month.setDate(1); selected = localDate(new Date());`);
const dash = run(`dashboard()`);
t('Dashboard renders with NO Upcoming shifts section', !dash.includes('Upcoming shifts'));
t('Dashboard keeps Overview + Quick actions', dash.includes('Overview') && dash.includes('Quick actions'));
t('app source no longer computes the upcoming list', !appSrc.includes('upcoming=db.shifts'));

// ---------- 5. Watchdog evaluation (real evaluate.ts) ----------
function loadModule(file) {
  const src = fs.readFileSync(R + file, 'utf8').replace(/^export\s+/gm, '');
  const sb = { console, URL, TextEncoder, TextDecoder, Date, JSON, Math, crypto: require('crypto').webcrypto, fetch: null };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return sb;
}
const ev = loadModule('supabase/functions/push-watchdog/evaluate.ts');
const TODAY = '2026-11-12';
const plusDays = (n) => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const baseInput = (over) => Object.assign({
  todayStr: TODAY, localHour: 10, isTwentieth: false,
  nextMonthPrefix: '2026-12', nextMonthLabel: 'December 2026', nextMonthShiftCount: 3,
  settings: {}, rows: { nbcrna: {}, aana: {}, licenses: [], documents: [], credentials: [] },
  ceRecordCount: 5, sentKeys: [],
}, over || {});
const ceEntry = (over) => Object.assign({
  label: 'West Virginia APRN-CRNA', key: 'WV|APRN-CRNA', expiry: plusDays(80), total: 24,
  subs: [{ label: 'pharmacotherapeutics', need: 12 }, { label: 'clinical management', need: 12 }],
  tracked: { total: 9, subs: [{ label: 'pharmacotherapeutics', need: 12, have: 4 }, { label: 'clinical management', need: 12, have: 5 }] },
}, over || {});
const withWatch = (entries, over) => baseInput(Object.assign({
  settings: { watch: { ceLicenses: entries } },
}, over || {}));
const ceAlerts = (out) => out.filter(n => n.triggerKey.startsWith('ce|license-hours|'));

let out = ev.evaluateUser(withWatch([ceEntry()]));
t('watchdog: tracked-but-short at the 90 window fires once, with the numbers',
  ceAlerts(out).length === 1 && ceAlerts(out)[0].triggerKey.endsWith('|90') &&
  ceAlerts(out)[0].body.includes('9 of 24') && ceAlerts(out)[0].body.includes('pharmacotherapeutics 4 of 12'),
  J(ceAlerts(out)));
t('watchdog: the fired key in sentKeys silences the repeat',
  ceAlerts(ev.evaluateUser(withWatch([ceEntry()], { sentKeys: [ceAlerts(out)[0].triggerKey] }))).length === 0);
out = ev.evaluateUser(withWatch([ceEntry({ expiry: plusDays(25) })]));
t('watchdog: short at the 30 window keys to that window',
  ceAlerts(out).length === 1 && ceAlerts(out)[0].triggerKey.endsWith('|30'), J(ceAlerts(out)));
out = ev.evaluateUser(withWatch([ceEntry({ tracked: null })]));
t('watchdog: untracked fires at the 90 window only',
  ceAlerts(out).length === 1 && ceAlerts(out)[0].triggerKey.endsWith('|untracked'), J(ceAlerts(out)));
out = ev.evaluateUser(withWatch([ceEntry({ tracked: null, expiry: plusDays(50) })]));
t('watchdog: untracked is silent at the 60 window', ceAlerts(out).length === 0, J(ceAlerts(out)));
out = ev.evaluateUser(withWatch([ceEntry({ tracked: { total: 24, subs: [{ label: 'pharmacotherapeutics', need: 12, have: 12 }, { label: 'clinical management', need: 12, have: 12 }] } })]));
t('watchdog: fully met is silent', ceAlerts(out).length === 0, J(ceAlerts(out)));
out = ev.evaluateUser(withWatch([ceEntry({ excluded: true, tracked: null })]));
t('watchdog: conflict/excluded is silent', ceAlerts(out).length === 0, J(ceAlerts(out)));
// Legacy no-records block must not double-fire for a mirrored license.
const licRow = { state: 'WV', license_type: 'APRN-CRNA', expiration_date: plusDays(80) };
out = ev.evaluateUser(withWatch([ceEntry({ tracked: null })], {
  ceRecordCount: 0,
  rows: { nbcrna: {}, aana: {}, licenses: [licRow], documents: [], credentials: [] },
}));
t('watchdog: legacy no-records alert skips mirrored licenses (no double fire)',
  !out.some(n => n.body.includes("don't have education (CE) records on file")) &&
  ceAlerts(out).length === 1, J(out.map(n => n.triggerKey)));
out = ev.evaluateUser(baseInput({
  ceRecordCount: 0,
  rows: { nbcrna: {}, aana: {}, licenses: [licRow], documents: [], credentials: [] },
}));
t('watchdog: legacy no-records alert still fires when the license is NOT mirrored',
  out.some(n => n.body.includes("don't have education (CE) records on file")), J(out.map(n => n.triggerKey)));

console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
