// CRNA Hub — v121: post-sync facility handoff (Caleb, Nov 11, 2026).
// Run: node test-v121-sync-facility-handoff.js
//
// Caleb's fresh-setup retest on v120: an Apple sync of "Caleb Work
// Schedule" saw 327 events, imported 0, and held 253 for hospitals
// with no facility yet — then lumped the hospital names into one
// sentence in an alert and left him to find the Facilities tab
// himself. His ask: "automatically send you to the facility page
// after initial sync to fill out that information."
//
// Pins:
//   * a MANUAL sync finishing with held-for-facility events shows the
//     sync-result SHEET (counts kept), listing each hospital on its
//     own line with its waiting count — never lumped into one
//     sentence — with "Set up facilities" as the primary action;
//   * "Set up facilities" lands on the Facilities tab with the first
//     suggestion card expanded, offering the three paths inline
//     (contract / describe in your words / manual rate) plus a
//     prominent "Not a hospital" dismissal;
//   * saving the facility from a suggestion (pay-words path AND the
//     manual form) re-runs the sync by itself: the waiting shifts
//     import priced, the result reads "Holzer added — N shifts
//     imported", and the next suggestion stays waiting;
//   * a BACKGROUND (silent) sync never yanks the user anywhere: no
//     sheet, no tab change — the Dashboard notice pattern stands;
//   * a dismissed (junk) suggestion is never re-asked.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = fs.existsSync(path.join(__dirname, 'repo', 'app.js'))
  ? path.join(__dirname, 'repo') + path.sep
  : __dirname + path.sep;
const store = new Map();
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, scrollIntoView() {},
  };
}
const elements = {};
class FakeFormData {
  constructor(form) { this._e = (form && form._entries) || []; }
  *[Symbol.iterator]() { yield* this._e; }
}
const alerts = [];
const fetchCalls = [];
let canned = { ok: true };
const sandbox = {
  console, setTimeout, clearTimeout, AbortController, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  FormData: FakeFormData,
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  document: {
    getElementById: (id) => elements[id] || (elements[id] = el()),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  __alerts: alerts, __fetchCalls: fetchCalls,
  confirm: () => true,
  fetch: async (url, opts) => {
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    fetchCalls.push({ url, body });
    let data = { ok: true };
    if (body && body.function === 'sync-calendar' && body.action === 'sync') data = canned;
    else if (body && body.function === 'sync-calendar' && body.action === 'status') {
      data = { connections: [{ provider: 'apple', status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-11T14:14:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' }] };
    } else if (body && body.function === 'sync-calendar' && body.action === 'log') data = { log: [] };
    return { status: 200, ok: true, text: async () => JSON.stringify(data) };
  },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const settle = () => new Promise((r) => setTimeout(r, 200));

const SUGGESTIONS = [
  { name: 'Holzer', address: '', count: 240, firstDate: '2026-11-02', lastDate: '2027-04-02', sampleTitles: ['HOLZ - G Main (8)'] },
  { name: 'CAMC', address: '', count: 12, firstDate: '2026-12-01', lastDate: '2026-12-05', sampleTitles: ['CAMC 5**'] },
  { name: 'Spinal and epidural training Clearwater', address: '', count: 1, firstDate: '2026-11-20', lastDate: '2026-11-20', sampleTitles: ['Spinal and epidural training'] },
];
const syncHeld = {
  providerChanges: [], pendingDeletions: [],
  imported: {
    sourceCalendarName: 'Caleb Work Schedule', created: 0, updated: 0, skipped: 327, duplicates: 0,
    seen: 327, parsed: 253, skippedNotShift: 74, skippedDeleted: 0, skippedLegacy: 0, repaired: 0,
    skippedSuggested: 253, unpriced: 0, suggestions: SUGGESTIONS,
    newFacilities: ['Holzer', 'CAMC', 'Spinal and epidural training Clearwater'],
  },
};

(async () => {
  run(`
    cloudSession = { access_token: 'test-token', email: 'test@example.com', expires_at: Math.floor(Date.now()/1000) + 3600 };
    liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-11T14:14:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
    db.facilities = []; db.shifts = []; db.facilitySuggestions = [];
    tab = 'Account';
  `);

  // --- 1. Manual sync with holds -> result SHEET, per-hospital list.
  canned = syncHeld;
  const alertsBefore = alerts.length;
  await run(`liveSyncNow('apple', false)`);
  t('manual sync with held hospitals opens the sync-result sheet (no plain alert)',
    run(`!!syncResultSheet`) === true && alerts.length === alertsBefore);
  const sheet = run(`syncResultSheetHTML()`);
  t('sheet keeps the sync counts (saw 327 events, imported 0)',
    sheet.includes('327') && sheet.toLowerCase().includes('imported 0'));
  t('sheet lists each hospital per line with its waiting count',
    sheet.includes('Holzer') && sheet.includes('240 shift(s) waiting') &&
    sheet.includes('CAMC') && sheet.includes('12 shift(s) waiting'));
  t('sheet does NOT lump hospital names into one sentence',
    !sheet.includes('Holzer, CAMC') && !sheet.includes('We noticed shifts at Holzer'));
  t('"Set up facilities" is the sheet primary action',
    sheet.includes('data-action="sync-result-setup"') && sheet.includes('Set up facilities'));

  // --- 2. Set up facilities -> Facilities tab, first card expanded.
  run(`actions('sync-result-setup')`);
  t('setup action closes the sheet and lands on Facilities',
    run(`syncResultSheet`) === null && run(`tab`) === 'Facilities');
  const facPage1 = run(`facilitiesPage()`);
  t('suggestions panel lists hospitals per card with waiting counts',
    facPage1.includes('id="facility-suggestions-panel"') &&
    facPage1.includes('Holzer') && facPage1.includes('240 shift(s) waiting') &&
    facPage1.includes('CAMC') && facPage1.includes('12 shift(s) waiting'));
  t('first card is expanded with the three paths inline',
    facPage1.includes('Upload a contract') && facPage1.includes('Describe rates in your words') &&
    facPage1.includes('Enter hourly rate manually'));
  t('"Not a hospital" dismissal is on the card, as prominent as the paths',
    facPage1.includes('Not a hospital') && facPage1.includes('data-action="facility-suggestion-dismiss"'));

  // --- 3. Pay-words path: shell + describe confirm -> auto-rescan.
  const holzerId = run(`(db.facilitySuggestions.find(x=>x.name==='Holzer')||{}).id`);
  run(`actions('facility-suggestion-words', '${holzerId}')`);
  t('words path creates the Holzer facility shell and clears its suggestion',
    run(`db.facilities.some(f=>f.name==='Holzer')`) === true &&
    run(`activeFacilitySuggestions().some(x=>x.name==='Holzer')`) === false);
  t('words path opens the pay-words box for the new facility',
    run(`describeOpenFac === (db.facilities.find(f=>f.name==='Holzer')||{}).id`) === true);
  // The rescan sync: the server now prices + releases the held Holzer
  // events (its rates travel with the sync payload — asserted below).
  canned = {
    providerChanges: [
      { action: 'create', shift: { id: 'h-1', date: '2026-11-02', facility: 'Holzer', type: 'HOLZ - G Main (8)', code: 'HOLZ - G Main (8)', pay: '2125', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
      { action: 'create', shift: { id: 'h-2', date: '2026-11-03', facility: 'Holzer', type: 'HOLZ - Call 1', code: 'HOLZ - Call 1', pay: '4800', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    ],
    pendingDeletions: [],
    imported: {
      sourceCalendarName: 'Caleb Work Schedule', created: 2, updated: 0, skipped: 13, duplicates: 0,
      seen: 327, parsed: 15, skippedNotShift: 74, skippedSuggested: 13, unpriced: 0,
      suggestions: [SUGGESTIONS[1], SUGGESTIONS[2]], newFacilities: ['CAMC', 'Spinal and epidural training Clearwater'],
    },
  };
  fetchCalls.length = 0;
  run(`
    const fac = db.facilities.find(f=>f.name==='Holzer');
    const WORDS = 'Holz-g main (8)=8hr day shift $250/hr, paid for 8.5 hours / Holz-call 1=24hr call. Weekday=$4,800 weekend $4,200 / Holz-call 2=2nd call weekday=$3,000 weekend $2,000 / Holz PCDO=post call day off=no pay / Weekends only include Saturday and Sunday.';
    const codes = [{code:'HOLZ - G Main (8)'},{code:'HOLZ - Call 1'},{code:'HOLZ - Call 2'},{code:'HOLZ - PCDO'}];
    const parsed = describeParseLocal(WORDS, fac, codes);
    describeStates['fac:'+fac.id] = { text: WORDS, parsed, error:'', busy:false, confirmed:false, ctx:{ fac, facName:'Holzer', codes } };
    confirmDescribe('fac:'+fac.id);
  `);
  await settle();
  const holzerShifts = run(`db.shifts.filter(s=>s.facility==='Holzer')`);
  t('confirming the words re-runs the sync by itself — held shifts import',
    holzerShifts.length === 2);
  t('imported shifts are priced from the words (G Main (8) $2,125 · Call 1 weekday $4,800)',
    holzerShifts.some((s) => s.pay === '2125') && holzerShifts.some((s) => s.pay === '4800'));
  const rescanCall = fetchCalls.find((c) => c.body && c.body.function === 'sync-calendar' && c.body.action === 'sync');
  t('the rescan sync payload carries the words-built rate card (paid 8.5 hrs, Call 1 $4,800)',
    !!rescanCall && JSON.stringify(rescanCall.body).includes('8.5') && JSON.stringify(rescanCall.body).includes('4800'));
  t('result reads "Holzer added — 2 shifts imported" on the Facilities page',
    run(`!!facilityRescanResult && facilityRescanResult.name==='Holzer' && facilityRescanResult.imported===2`) === true &&
    run(`facilitiesPage()`).includes('Holzer added — 2 shift(s) imported'));
  t('CAMC stays waiting for its own setup',
    run(`activeFacilitySuggestions().some(x=>x.name==='CAMC')`) === true &&
    run(`facilitiesPage()`).includes('CAMC'));

  // --- 4. Junk suggestion: dismiss -> never re-asked.
  const junkId = run(`(db.facilitySuggestions.find(x=>x.name.indexOf('Spinal')===0)||{}).id`);
  run(`actions('facility-suggestion-dismiss', '${junkId}')`);
  run(`mergeFacilitySuggestions('apple', [{ name:'Spinal and epidural training Clearwater', count: 2, firstDate:'2026-11-20', lastDate:'2026-11-21' }], 'Caleb Work Schedule')`);
  t('dismissed junk suggestion is never re-asked on later syncs',
    run(`activeFacilitySuggestions().some(x=>x.name.indexOf('Spinal')===0)`) === false &&
    run(`dismissedFacilitySuggestions().some(x=>x.name.indexOf('Spinal')===0)`) === true);

  // --- 5. Manual-form path also closes the loop (CAMC).
  const camcId = run(`(db.facilitySuggestions.find(x=>x.name==='CAMC')||{}).id`);
  canned = {
    providerChanges: [
      { action: 'create', shift: { id: 'c-1', date: '2026-12-01', facility: 'CAMC', type: '10-hour day', code: '5**', pay: '2500', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    ],
    pendingDeletions: [],
    imported: {
      sourceCalendarName: 'Caleb Work Schedule', created: 1, updated: 0, skipped: 0, duplicates: 0,
      seen: 327, parsed: 1, skippedSuggested: 0, unpriced: 0, suggestions: [], newFacilities: [],
    },
  };
  run(`actions('facility-suggestion-path', '${camcId}', 'manual')`);
  run(`
    submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'facilities'}, _entries:[
      ['name','CAMC'], ['aliases',''], ['address',''], ['contactEmail',''],
      ['hourlyRate','250'], ['paidHours8',''], ['rate8','2000'], ['rate10','2500'], ['rate12','3000'],
      ['rate24',''], ['weekendRate24',''], ['hourlyCall1st',''], ['rateSecond',''], ['weekendRateSecond',''],
      ['callBonus',''], ['distance',''], ['distanceSource',''], ['notes',''],
    ]}});
  `);
  await settle();
  t('saving CAMC from the form re-runs the sync — its waiting shift imports priced',
    run(`db.shifts.some(s=>s.facility==='CAMC' && s.pay==='2500')`) === true &&
    run(`!!facilityRescanResult && facilityRescanResult.name==='CAMC' && facilityRescanResult.imported===1`) === true);
  t('no suggestions remain -> the result panel says All set',
    run(`activeFacilitySuggestions().length`) === 0 &&
    run(`facilitiesPage()`).includes('All set'));

  // --- 6. Background sync never interrupts.
  run(`tab='Dashboard'; syncResultSheet=null; facilityRescanResult=null;`);
  canned = {
    providerChanges: [], pendingDeletions: [],
    imported: {
      sourceCalendarName: 'Caleb Work Schedule', created: 0, updated: 0, skipped: 3, duplicates: 0,
      seen: 3, parsed: 3, skippedSuggested: 3, unpriced: 0,
      suggestions: [{ name: 'Riverside General', count: 3, firstDate: '2026-12-10', lastDate: '2026-12-12' }],
      newFacilities: ['Riverside General'],
    },
  };
  await run(`liveSyncNow('apple', true)`);
  t('background sync with new holds opens NO sheet and does NOT navigate',
    run(`syncResultSheet`) === null && run(`tab`) === 'Dashboard');
  t('background sync still records the suggestion (Dashboard notice pattern)',
    run(`activeFacilitySuggestions().some(x=>x.name==='Riverside General')`) === true &&
    run(`dashboardFacilitySuggestionsHTML()`).includes('Riverside General'));

  console.log(failures === 0 ? '\nAll v121 sync-facility-handoff checks passed.' : `\n${failures} check(s) FAILED.`);
})().catch((e) => { console.error('TEST ERROR', e); process.exitCode = 1; });
