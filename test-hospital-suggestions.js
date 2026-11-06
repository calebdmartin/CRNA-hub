// CRNA Hub — client tests for ask-first hospital suggestions from
// calendar sync (Nov 5, 2026), the paths prompt, and the income
// disclaimer. Run: node test-hospital-suggestions.js
//
// Covers the parent task's acceptance checks without a live calendar:
//   * an unknown hospital is suggested once (count + date range), and a
//     repeat sync refreshes it instead of duplicating it;
//   * "Not now" dismisses it — the next sync does not re-ask — and the
//     dismissed suggestion stays visible with an "Ask again" button;
//   * Yes (and each of the path buttons) opens the facility form
//     pre-filled with the hospital name and address;
//   * adding the facility clears its suggestion, so the next sync
//     re-scans the held events and imports them (past confirmed /
//     future proposed — Bug 1, Nov 6, 2026 — unpriced when no rate
//     covers the type, never $0);
//   * personal events are never suggested, and a known facility is
//     never suggested; no facility is ever created silently by a sync;
//   * the income disclaimer shows on the Dashboard (near the totals)
//     and on the Facilities/contract preview — the condensed guide
//     no longer carries it as a step paragraph.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// Run against this checkout (a `repo/` subdir when present, else here) —
// never a stale absolute work-dir path: the Nov 5 snapshot path this file
// used to carry tested code from before the C/S/P and pay-stub work.
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
const DISCLAIMER = 'Income figures are estimates from your own rates and shifts — always double-check them against your actual paystubs. CRNA Hub is not liable for mistakes.';

// --- 1. Unknown hospital suggested once; repeat sync refreshes, never duplicates.
run(`
  db.facilities = [{ id: 'f-holzer', name: 'Holzer', aliases: '', address: '', rate8: '2125', rate10: '2625', rate12: '', rate24: '', rateSecond: '3000', weekendRateSecond: '2000', hourlyRate: '250', paidHours8: '8.5', callBonus: '1000', distance: '', notes: '' }];
  db.shifts = [];
  db.facilitySuggestions = [];
  globalThis.__applied1 = liveSyncApplyChanges('apple', { providerChanges: [], pendingDeletions: [], imported: {
    sourceCalendarName: 'Caleb Work Schedule', created: 0, updated: 0, skipped: 3, duplicates: 0, seen: 5, parsed: 3,
    skippedSuggested: 3, suggestions: [{ name: 'CAMC', address: '3200 MacCorkle Ave, Charleston, WV 25304', count: 2, firstDate: '2026-11-06', lastDate: '2026-11-09', sampleTitles: ['CAMC 8', 'CAMC 2nd call'] }],
    newFacilities: ['CAMC'],
  }});
  globalThis.__applied2 = liveSyncApplyChanges('apple', { providerChanges: [], pendingDeletions: [], imported: {
    sourceCalendarName: 'Caleb Work Schedule', created: 0, updated: 0, skipped: 4, duplicates: 0, seen: 6, parsed: 4,
    skippedSuggested: 4, suggestions: [{ name: 'camc', address: '', count: 3, firstDate: '2026-11-05', lastDate: '2026-11-10', sampleTitles: ['CAMC 10'] }],
    newFacilities: ['CAMC'],
  }});
  globalThis.__sugg = db.facilitySuggestions;
  globalThis.__active = activeFacilitySuggestions();
`);
t('unknown hospital suggested once (repeat sync refreshes, never duplicates)',
  sandbox.__sugg.length === 1 && sandbox.__sugg[0].name === 'CAMC' &&
  sandbox.__sugg[0].count === 3 && sandbox.__sugg[0].firstDate === '2026-11-05' &&
  sandbox.__sugg[0].lastDate === '2026-11-10' &&
  sandbox.__sugg[0].address === '3200 MacCorkle Ave, Charleston, WV 25304');
t('suggestion is active and carries count + date range',
  sandbox.__active.length === 1);
t('no facility created silently by the sync',
  run(`db.facilities.length`) === 1 && run(`db.facilities[0].name`) === 'Holzer');
t('no shift imported for the held hospital',
  run(`db.shifts.length`) === 0);
t('suggestion card asks the question with name, count and date range',
  run(`facilitySuggestionsHTML().includes('We noticed shifts at CAMC in your calendar. Add it as a facility?')`) &&
  run(`facilitySuggestionsHTML().includes('3 shift(s)')`));
t('two paths appear together, in order (sync, manual) \u2014 no contract item (Nov 6 cleanup: it only scrolled to the panel below)',
  (() => {
    const h = run(`facilitySuggestionsHTML()`);
    const a = h.indexOf('Sync your calendar or manually enter a facility');
    const s = h.indexOf('data-date=\"sync\"', a);
    const m = h.indexOf('data-date=\"manual\"', s);
    return a > -1 && s > a && m > s && !h.includes('data-date=\"contract\"') && !h.includes('<strong>Upload a contract</strong>');
  })());
t('Yes / Not now buttons present on the suggestion card',
  run(`facilitySuggestionsHTML().includes('data-action="facility-suggestion-yes"')`) &&
  run(`facilitySuggestionsHTML().includes('data-action="facility-suggestion-dismiss"')`));

// --- 2. "Not now" dismisses; the next sync does not re-ask; dismissed stays visible.
run(`
  actions('facility-suggestion-dismiss', db.facilitySuggestions[0].id);
  globalThis.__afterDismiss = { active: activeFacilitySuggestions().length, dismissed: dismissedFacilitySuggestions().length };
  liveSyncApplyChanges('apple', { providerChanges: [], pendingDeletions: [], imported: {
    sourceCalendarName: 'Caleb Work Schedule', created: 0, updated: 0, skipped: 5, duplicates: 0, seen: 7, parsed: 5,
    skippedSuggested: 5, suggestions: [{ name: 'CAMC', address: '', count: 4, firstDate: '2026-11-05', lastDate: '2026-11-11', sampleTitles: ['CAMC 8'] }],
    newFacilities: ['CAMC'],
  }});
  globalThis.__afterResync = { active: activeFacilitySuggestions().length, dismissed: dismissedFacilitySuggestions().length, count: db.facilitySuggestions[0].count, stillDismissed: !!db.facilitySuggestions[0].dismissed };
  globalThis.__facPageDismissed = facilitiesPage();
  actions('facility-suggestion-undismiss', db.facilitySuggestions[0].id);
  globalThis.__afterUndismiss = { active: activeFacilitySuggestions().length };
`);
t('Not now dismisses the suggestion', sandbox.__afterDismiss.active === 0 && sandbox.__afterDismiss.dismissed === 1);
t('dismissed hospital is not re-asked on the next sync (count refreshes, stays dismissed)',
  sandbox.__afterResync.active === 0 && sandbox.__afterResync.dismissed === 1 &&
  sandbox.__afterResync.count === 4 && sandbox.__afterResync.stillDismissed === true);
t('dismissed suggestion stays visible later, with Ask again',
  sandbox.__facPageDismissed.includes('Dismissed suggestions (1)') &&
  sandbox.__facPageDismissed.includes('CAMC') &&
  sandbox.__facPageDismissed.includes('data-action="facility-suggestion-undismiss"'));
t('Ask again restores the suggestion', sandbox.__afterUndismiss.active === 1);

// --- 3. Yes pre-fills the facility form (name + address) and shows the paths.
run(`
  actions('facility-suggestion-yes', db.facilitySuggestions[0].id);
  globalThis.__facPageYes = facilitiesPage();
  globalThis.__tabAfterYes = tab;
`);
t('Yes opens the Facilities tab', sandbox.__tabAfterYes === 'Facilities');
t('Yes pre-fills the hospital name in the manual form',
  sandbox.__facPageYes.includes('id="f_name"') && sandbox.__facPageYes.includes('value="CAMC"'));
t('Yes pre-fills the address from the calendar location',
  sandbox.__facPageYes.includes('value="3200 MacCorkle Ave, Charleston, WV 25304"'));
t('facility form shows the paths chooser after Yes',
  sandbox.__facPageYes.includes('id="facility-three-ways-panel"') &&
  sandbox.__facPageYes.includes('Sync your calendar or manually enter a facility'));
t('contract-upload option and manual entry both available on the form',
  sandbox.__facPageYes.includes('id="facility-contract-panel"') &&
  sandbox.__facPageYes.includes('id="facility-manual-panel"'));
t('manual path states it is the fallback for rates the other paths did not provide',
  sandbox.__facPageYes.includes('Manually enter the facility') &&
  sandbox.__facPageYes.includes('the fallback when sync or a contract did not provide them'));
// Path button: manual path pre-fills the form (the contract item was
// removed Nov 6 — it only scrolled to the contract panel below).
run(`
  facilitySuggestionPrefill = null;
  actions('facility-suggestion-path', db.facilitySuggestions[0].id, 'manual');
  globalThis.__facPagePath = facilitiesPage();
`);
t('manual path also pre-fills the form',
  sandbox.__facPagePath.includes('value="CAMC"'));

// --- 4. Adding the facility clears its suggestion; the next sync imports its shifts.
run(`
  submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'facilities'}, _entries:[
    ['name','CAMC'], ['aliases','Charleston Area Medical Center'], ['address','3200 MacCorkle Ave, Charleston, WV 25304'],
    ['hourlyRate','250'], ['paidHours8','8'], ['rate8','2000'], ['rate10','2500'], ['rate12','3000'],
    ['rate24',''], ['hourlyCall1st',''], ['rateSecond',''], ['weekendRateSecond',''],
    ['callBonus',''], ['distance',''], ['distanceSource',''], ['notes',''],
  ]}});
  globalThis.__afterSave = { facilities: db.facilities.map(f=>f.name), suggestions: db.facilitySuggestions.length };
  // Far-future dates on purpose: the Bug 1 past-shift rule marks a
  // past-dated import confirmed, so these must stay future-dated to pin
  // "future imports arrive proposed".
  globalThis.__applied3 = liveSyncApplyChanges('apple', { providerChanges: [{ action: 'create', shift: {
    id: 'shift-camc-1', date: '2027-06-03', facility: 'CAMC', type: '8-hour day', pay: '2000',
    note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null,
  }}, { action: 'create', shift: {
    id: 'shift-camc-2', date: '2027-06-06', facility: 'CAMC', type: 'Second call', pay: '',
    note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null,
  }}], pendingDeletions: [], imported: {
    sourceCalendarName: 'Caleb Work Schedule', created: 2, updated: 0, skipped: 0, duplicates: 0, seen: 2, parsed: 2,
    skippedSuggested: 0, suggestions: [], newFacilities: [],
  }});
  globalThis.__camcShifts = db.shifts.filter(x=>x.facility==='CAMC');
`);
t('adding the facility clears its suggestion', sandbox.__afterSave.suggestions === 0 && sandbox.__afterSave.facilities.includes('CAMC'));
t('next sync imports the held shifts once the facility exists',
  sandbox.__camcShifts.length === 2);
t('imported shifts arrive confirmed when past, proposed when future (Bug 1)',
  run(`db.shifts.filter(x=>x.facility==='CAMC').every(x => x.status === (x.date < localDate(new Date()) ? 'confirmed' : 'proposed'))`));
t('priced shift carries its pay; unpriced shift stays incomplete, never $0',
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-1').pay === '2000' &&
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-2').pay === '' &&
  sandbox.__camcShifts.find((x) => x.id === 'shift-camc-2').incomplete === true);

// --- 5. Personal events and known facilities are never suggested.
run(`
  db.facilitySuggestions = [];
  mergeFacilitySuggestions('apple', [
    { name: 'Dentist appointment', count: 1, firstDate: '2026-11-06', lastDate: '2026-11-06' },
    { name: 'Team lunch', count: 1, firstDate: '2026-11-06', lastDate: '2026-11-06' },
    { name: 'Holzer', count: 5, firstDate: '2026-11-06', lastDate: '2026-11-10' },
    { name: 'CAMC', count: 1, firstDate: '2026-11-06', lastDate: '2026-11-06' },
  ], 'Caleb Work Schedule');
  globalThis.__guarded = db.facilitySuggestions.map(x=>x.name);
`);
t('personal events are never suggested; a known facility is never suggested',
  JSON.stringify(sandbox.__guarded) === JSON.stringify([]));

// --- 6. Old-server payloads cannot silently create a facility either.
run(`
  db.facilities = db.facilities.filter(f=>f.name==='Holzer');
  db.shifts = [];
  liveSyncApplyChanges('apple', { providerChanges: [{ action: 'create', shift: {
    id: 'shift-old-1', date: '2026-11-06', facility: 'Mystery General', type: '8-hour day', pay: '',
    note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null,
  }}], pendingDeletions: [], imported: {
    sourceCalendarName: 'Caleb Work Schedule', created: 1, updated: 0, skipped: 0, duplicates: 0, seen: 1, parsed: 1,
    skippedSuggested: 0, suggestions: [], newFacilities: ['Mystery General'],
  }});
  globalThis.__oldServer = { facilities: db.facilities.map(f=>f.name), suggestions: db.facilitySuggestions.map(x=>x.name) };
`);
t('old-server newFacilities becomes a suggestion, not a silent facility',
  sandbox.__oldServer.facilities.length === 1 &&
  JSON.stringify(sandbox.__oldServer.suggestions) === JSON.stringify(['Mystery General']));

// --- 7. Income disclaimer: Dashboard, Facilities/contract preview.
// The condensed guide no longer carries it as a step paragraph.
run(`
  globalThis.__dash = dashboard();
  globalThis.__facPage = facilitiesPage();
  globalThis.__onboard3 = onboardingSteps()[2];
  globalThis.__onboardHtml = onboardingHTML();
  globalThis.__buildStamp = BUILD_STAMP;
`);
t('disclaimer shows on the Dashboard near the income totals',
  sandbox.__dash.includes(DISCLAIMER));
t('disclaimer no longer sits in the Facilities main flow (Nov 6 cleanup — it lives in Account small print + collapsed toggles)',
  !(sandbox.__facPage.match(new RegExp(DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length);
t('guide no longer carries the disclaimer as a step paragraph',
  sandbox.__onboard3.title === 'Add facilities & contracts' &&
  !sandbox.__onboard3.direction.includes('Income figures are estimates') &&
  !sandbox.__onboardHtml.includes('Income figures are estimates'));
t('build stamp is a tiny version line (cache v38, no changelog)', sandbox.__buildStamp.includes('cache v38') && !sandbox.__buildStamp.includes('TDZ'));
t('no key-like secrets in app.js',
  !/(sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/.test(fs.readFileSync(R + 'app.js', 'utf8')));
console.log('hospital-suggestion test done');
