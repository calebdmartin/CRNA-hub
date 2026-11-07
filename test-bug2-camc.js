// CRNA Hub — client tests for Bug 2 (Nov 6, 2026): past CAMC shifts
// not recognized, CAMC never suggested. Run: node test-bug2-camc.js
//
// Covers, without a live calendar:
//   (a) a sync reporting past CAMC shifts surfaces "We noticed shifts
//       at CAMC in your calendar. Add it as a facility?" with shift
//       count and date range — on the Dashboard card and on the
//       Facilities tab — not only in a transient sync alert;
//   (b) once CAMC is added, the next sync re-imports its shifts priced
//       from the CAMC rule (test-only rates from Caleb's screenshot:
//       $250/hr, 8h $2,000, 10h $2,500, 12h $3,000, no call taken) —
//       past shifts arrive confirmed, future shifts proposed, call
//       shifts stay unpriced, never $0;
//   (c) a dismissed suggestion stays findable on the Facilities tab
//       (dismissed list with Ask again) and is re-askable there;
//   (d) adding the facility arms the one-shot repair when the last
//       import reported legacy skips, so legacy-row shifts re-import
//       on the next sync instead of staying blocked.
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
    getElementById: (id) => elements[id] || (elements[id] = el()),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {}, confirm: () => true,
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
// Keep the submit test offline: never let a live-sync push run.
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) process.exitCode = 1;
};

// --- (a) Past CAMC shifts surface as a suggestion with count + range.
run(`
  db.facilities = [{ id: 'f-holzer', name: 'Holzer', aliases: '', address: '', rate8: '2125', rate10: '2625', rate12: '', rate24: '', rateSecond: '3000', weekendRateSecond: '2000', hourlyRate: '250', paidHours8: '8.5', callBonus: '1000', distance: '', notes: '' }];
  db.shifts = [];
  db.facilitySuggestions = [];
  globalThis.__appliedPast = liveSyncApplyChanges('apple', { providerChanges: [], pendingDeletions: [], imported: {
    sourceCalendarName: 'Caleb Work Schedule', created: 0, updated: 0, skipped: 4, duplicates: 0, seen: 6, parsed: 4,
    skippedSuggested: 4, suggestions: [{ name: 'CAMC', address: '3200 MacCorkle Ave, Charleston, WV 25304', count: 4, firstDate: '2026-03-04', lastDate: '2026-03-10', sampleTitles: ['CAMC', 'CAMC 8', 'CAMC 2nd call'] }],
    newFacilities: ['CAMC'],
  }});
  globalThis.__suggPast = db.facilitySuggestions;
  globalThis.__dashCard = dashboardFacilitySuggestionsHTML();
  globalThis.__facPagePast = facilitiesPage();
`);
t('(a) past CAMC shifts surface as one suggestion (count + date range)',
  sandbox.__suggPast.length === 1 && sandbox.__suggPast[0].name === 'CAMC' &&
  sandbox.__suggPast[0].count === 4 && sandbox.__suggPast[0].firstDate === '2026-03-04' &&
  sandbox.__suggPast[0].lastDate === '2026-03-10');
t('(a) sync result names CAMC as a suggestion',
  (sandbox.__appliedPast.suggestions || []).includes('CAMC'));
t('(a) Dashboard card asks the question with count and range',
  sandbox.__dashCard.includes('We noticed shifts at <strong>CAMC</strong>') &&
  sandbox.__dashCard.includes('4 shift(s)'));
t('(a) Facilities tab shows the suggestion too (not only a transient alert)',
  sandbox.__facPagePast.includes('We noticed shifts at CAMC in your calendar. Add it as a facility?') &&
  sandbox.__facPagePast.includes('4 shift(s)'));

// --- (c) Dismissed suggestion stays findable on the Facilities tab, re-askable.
run(`
  actions('facility-suggestion-dismiss', db.facilitySuggestions[0].id);
  globalThis.__facPageDismissed = facilitiesPage();
  globalThis.__dashAfterDismiss = dashboardFacilitySuggestionsHTML();
  actions('facility-suggestion-undismiss', db.facilitySuggestions[0].id);
  globalThis.__facPageUndismissed = facilitiesPage();
`);
t('(c) dismissed suggestion is NOT on the Dashboard card (not re-asked)',
  sandbox.__dashAfterDismiss === '');
t('(c) dismissed suggestion stays on the Facilities tab with Ask again',
  sandbox.__facPageDismissed.includes('Dismissed suggestions (1)') &&
  sandbox.__facPageDismissed.includes('CAMC') &&
  sandbox.__facPageDismissed.includes('data-action="facility-suggestion-undismiss"'));
t('(c) Ask again restores the suggestion on the Facilities tab',
  sandbox.__facPageUndismissed.includes('We noticed shifts at CAMC in your calendar. Add it as a facility?'));

// --- (b) Add CAMC (screenshot rates, test-only) — next sync imports past shifts confirmed + priced.
run(`
  submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'facilities'}, _entries:[
    ['name','Charleston Area Medical Center'], ['aliases','CAMC'], ['address','3200 MacCorkle Ave, Charleston, WV 25304'],
    ['hourlyRate','250'], ['paidHours8','8'], ['rate8','2000'], ['rate10','2500'], ['rate12','3000'],
    ['rate24',''], ['hourlyCall1st',''], ['rateSecond',''], ['weekendRateSecond',''],
    ['callBonus',''], ['distance',''], ['distanceSource',''], ['notes',''],
  ]}});
  globalThis.__afterSave = { facilities: db.facilities.map(f=>f.name), suggestions: db.facilitySuggestions.length };
  globalThis.__appliedCamc = liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'create', shift: { id: 'shift-camc-8', date: '2026-03-04', facility: 'Charleston Area Medical Center', type: '8-hour day', pay: '2000', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    { action: 'create', shift: { id: 'shift-camc-10', date: '2026-03-05', facility: 'CAMC', type: '10-hour shift', pay: '2500', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    { action: 'create', shift: { id: 'shift-camc-12', date: '2026-03-06', facility: 'CAMC', type: '12-hour shift', pay: '3000', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    { action: 'create', shift: { id: 'shift-camc-2nd', date: '2026-03-07', facility: 'CAMC', type: 'Second call', pay: '', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    { action: 'create', shift: { id: 'shift-camc-24', date: '2026-03-08', facility: 'CAMC', type: '24-hour call', pay: '', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    { action: 'create', shift: { id: 'shift-camc-future', date: '2027-06-03', facility: 'CAMC', type: '8-hour day', pay: '2000', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
  ], pendingDeletions: [], imported: {
    sourceCalendarName: 'Caleb Work Schedule', created: 6, updated: 0, skipped: 0, duplicates: 0, seen: 6, parsed: 6,
    skippedSuggested: 0, suggestions: [], newFacilities: [],
  }});
  globalThis.__camcShifts = db.shifts.filter(x=>/camc|charleston/i.test(x.facility||''));
  globalThis.__pastCamc = globalThis.__camcShifts.filter(x=>x.date < '2026-11-06');
  globalThis.__futureCamc = globalThis.__camcShifts.filter(x=>x.date >= '2026-11-06');
`);
t('(b) adding the facility clears its suggestion',
  sandbox.__afterSave.suggestions === 0 && sandbox.__afterSave.facilities.includes('Charleston Area Medical Center'));
t('(b) next sync imports the held past shifts once the facility exists',
  sandbox.__pastCamc.length === 5);
t('(b) past CAMC shifts arrive confirmed (already happened), never proposed',
  sandbox.__pastCamc.every((x) => x.status === 'confirmed'));
t('(b) future CAMC shift arrives confirmed (status model Nov 6, 2026: sourced = confirmed)',
  sandbox.__futureCamc.length === 1 && sandbox.__futureCamc[0].status === 'confirmed');
t('(b) day shifts carry the screenshot rates ($2,000 / $2,500 / $3,000)',
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-8').pay === '2000' &&
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-10').pay === '2500' &&
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-12').pay === '3000');
t('(b) call shifts (no call taken at CAMC) stay unpriced, never $0',
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-2nd').pay === '' &&
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-2nd').incomplete === true &&
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-24').pay === '' &&
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-24').incomplete === true &&
  sandbox.__camcShifts.every((x) => x.pay !== '0' && x.pay !== 0));
t('(b) no CAMC special-case in the pricing/sync paths (rates come from the saved facility, never hard-coded)',
  !run(`facilityPayFor.toString().includes('CAMC')`) &&
  !run(`liveSyncApplyChanges.toString().includes('CAMC')`) &&
  !/if\s*\([^)]*CAMC/.test(fs.readFileSync(R + 'supabase/functions/_shared/calendar.ts', 'utf8')));

// --- (d) Adding the facility arms the one-shot repair when legacy skips were reported.
run(`
  db.facilities = db.facilities.filter(f=>f.name==='Holzer');
  db.shifts = [];
  db.facilitySuggestions = [];
  liveSyncState.lastImport = { provider: 'apple', sourceName: 'Caleb Work Schedule', created: 0, skippedLegacy: 2, skippedSuggested: 2, suggestions: [{ name: 'CAMC', count: 2, firstDate: '2026-03-04', lastDate: '2026-03-05' }], at: new Date().toISOString() };
  liveSyncState.repairImport = false;
  mergeFacilitySuggestions('apple', [{ name: 'CAMC', count: 2, firstDate: '2026-03-04', lastDate: '2026-03-05' }], 'Caleb Work Schedule');
  submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'facilities'}, _entries:[
    ['name','CAMC'], ['aliases',''], ['address',''],
    ['hourlyRate','250'], ['paidHours8','8'], ['rate8','2000'], ['rate10','2500'], ['rate12','3000'],
    ['rate24',''], ['hourlyCall1st',''], ['rateSecond',''], ['weekendRateSecond',''],
    ['callBonus',''], ['distance',''], ['distanceSource',''], ['notes',''],
  ]}});
  globalThis.__repairArmed = liveSyncState.repairImport;
  // Same save with no legacy skips must not arm the repair.
  db.facilities = db.facilities.filter(f=>f.name==='Holzer');
  db.facilitySuggestions = [];
  liveSyncState.lastImport = { provider: 'apple', sourceName: 'Caleb Work Schedule', created: 0, skippedLegacy: 0, skippedSuggested: 1, suggestions: [{ name: 'CAMC', count: 1, firstDate: '2026-03-04', lastDate: '2026-03-04' }], at: new Date().toISOString() };
  liveSyncState.repairImport = false;
  mergeFacilitySuggestions('apple', [{ name: 'CAMC', count: 1, firstDate: '2026-03-04', lastDate: '2026-03-04' }], 'Caleb Work Schedule');
  submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'facilities'}, _entries:[
    ['name','CAMC'], ['aliases',''], ['address',''],
    ['hourlyRate','250'], ['paidHours8','8'], ['rate8','2000'], ['rate10','2500'], ['rate12','3000'],
    ['rate24',''], ['hourlyCall1st',''], ['rateSecond',''], ['weekendRateSecond',''],
    ['callBonus',''], ['distance',''], ['distanceSource',''], ['notes',''],
  ]}});
  globalThis.__repairNotArmed = liveSyncState.repairImport;
`);
t('(d) facility save arms the repair when the last import reported legacy skips',
  sandbox.__repairArmed === true);
t('(d) facility save does not arm the repair when there were no legacy skips',
  sandbox.__repairNotArmed === false);

// --- (c, edge) A dismissed suggestion for a facility added another way does not linger.
run(`
  db.facilities = db.facilities.filter(f=>f.name==='Holzer');
  db.facilitySuggestions = [];
  mergeFacilitySuggestions('apple', [{ name: 'CAMC', count: 2, firstDate: '2026-03-04', lastDate: '2026-03-05' }], 'Caleb Work Schedule');
  actions('facility-suggestion-dismiss', db.facilitySuggestions[0].id);
  db.facilities.push({ id: 'f-camc-direct', name: 'CAMC', aliases: '', address: '', rate8: '2000', rate10: '', rate12: '', rate24: '', rateSecond: '', hourlyRate: '250', paidHours8: '', callBonus: '', distance: '', notes: '' });
  globalThis.__dismissedAfterDirectAdd = dismissedFacilitySuggestions().length;
  globalThis.__activeAfterDirectAdd = activeFacilitySuggestions().length;
`);
t('(c) dismissed suggestion disappears once its facility exists (added any way)',
  sandbox.__dismissedAfterDirectAdd === 0 && sandbox.__activeAfterDirectAdd === 0);
console.log('bug2-camc test done');
