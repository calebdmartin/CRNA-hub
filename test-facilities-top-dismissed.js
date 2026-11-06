// CRNA Hub — Facilities page layout (Nov 6, 2026, Caleb):
//   * "My facilities" is the FIRST section on the Facilities page —
//     above the suggestions card, contract upload, pay stub and manual
//     entry, which keep their order below it.
//   * When every hospital suggestion is dismissed, the "Hospitals
//     noticed in your calendar" card renders NOTHING — no card sits at
//     the top of the page. The dismissed suggestion stays recoverable
//     from a collapsed block at the BOTTOM of the page, with its
//     "Ask again" button; un-dismissing restores the active card.
//   * With an active suggestion, the card shows as before (including
//     the dismissed list folded inside it).
// Run: node test-facilities-top-dismissed.js
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
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) process.exitCode = 1;
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');

run(`
  db.facilities = [{ id: 'f-holzer', name: 'Holzer', aliases: '', address: '', rate8: '2125', rate10: '2625', rate12: '', rate24: '', rateSecond: '3000', weekendRateSecond: '2000', hourlyRate: '250', paidHours8: '8.5', callBonus: '1000', distance: '', notes: '' }];
  db.shifts = [];
  db.facilitySuggestions = [{ id: 'sg-camc', name: 'CAMC', address: '', count: 3, firstDate: '2026-11-05', lastDate: '2026-11-10', provider: 'apple', sourceCalendarName: 'Caleb Work Schedule', dismissed: false, createdAt: '', lastSeenAt: '', sampleTitles: ['CAMC 8'] }];
  editId = null; facilitySuggestionPrefill = null;
`);

// --- 1. My facilities is first; the rest keeps its order below.
const pageActive = run(`facilitiesPage()`);
t('My facilities renders on the page with the saved facility',
  pageActive.includes('id="my-facilities-panel"') && pageActive.includes('Holzer'));
t('My facilities is the FIRST section (before suggestions, contract, pay stub, manual)',
  pageActive.indexOf('id="my-facilities-panel"') > -1 &&
  pageActive.indexOf('id="my-facilities-panel"') < pageActive.indexOf('id="facility-suggestions-panel"') &&
  pageActive.indexOf('id="my-facilities-panel"') < pageActive.indexOf('id="facility-contract-panel"') &&
  pageActive.indexOf('id="my-facilities-panel"') < pageActive.indexOf('id="paystub-panel"') &&
  pageActive.indexOf('id="my-facilities-panel"') < pageActive.indexOf('id="facility-manual-panel"'));
t('sections below keep their order (contract -> pay stub -> manual)',
  pageActive.indexOf('id="facility-contract-panel"') < pageActive.indexOf('id="paystub-panel"') &&
  pageActive.indexOf('id="paystub-panel"') < pageActive.indexOf('id="facility-manual-panel"'));

// --- 2. Active suggestion: card shows as before.
t('active suggestion: the Hospitals noticed card appears',
  pageActive.includes('id="facility-suggestions-panel"') &&
  pageActive.includes('We noticed shifts at CAMC in your calendar. Add it as a facility?'));
t('active suggestion: no bottom dismissed block rendered',
  !pageActive.includes('id="facility-dismissed-panel"'));
t('facilitySuggestionsHTML() is empty only when nothing is active (static check)',
  appSrc.includes("if(!active.length)return '';"));

// --- 3. Dismiss it: the card disappears entirely from the top.
run(`actions('facility-suggestion-dismiss', 'sg-camc');`);
const pageDismissed = run(`facilitiesPage()`);
t('all dismissed: suggestion card renders nothing (no panel, no heading)',
  !pageDismissed.includes('id="facility-suggestions-panel"') &&
  !pageDismissed.includes('Hospitals noticed in your calendar') &&
  !pageDismissed.includes('We noticed shifts at CAMC'));
t('all dismissed: facilitySuggestionsHTML() itself returns empty',
  run(`facilitySuggestionsHTML()`) === '');
t('all dismissed: My facilities is still first on the page',
  pageDismissed.indexOf('id="my-facilities-panel"') > -1 &&
  pageDismissed.indexOf('id="my-facilities-panel"') < pageDismissed.indexOf('id="facility-contract-panel"'));

// --- 4. Dismissed stays recoverable at the BOTTOM, with Ask again.
t('dismissed block sits at the bottom (after the manual panel)',
  pageDismissed.includes('id="facility-dismissed-panel"') &&
  pageDismissed.indexOf('id="facility-dismissed-panel"') > pageDismissed.indexOf('id="facility-manual-panel"'));
t('dismissed block is collapsed and lists the hospital with Ask again',
  pageDismissed.includes('Dismissed suggestions (1) — not asked again on sync') &&
  pageDismissed.includes('CAMC') &&
  pageDismissed.includes('data-action="facility-suggestion-undismiss"') &&
  !pageDismissed.includes('<details open>'));

// --- 5. Ask again restores the active card at the top.
run(`actions('facility-suggestion-undismiss', 'sg-camc');`);
const pageBack = run(`facilitiesPage()`);
t('Ask again restores the Hospitals noticed card',
  pageBack.includes('id="facility-suggestions-panel"') &&
  pageBack.includes('We noticed shifts at CAMC in your calendar. Add it as a facility?') &&
  !pageBack.includes('id="facility-dismissed-panel"'));

// --- 6. Mixed state: one active + one dismissed -> card shows, dismissed folded inside it.
run(`
  db.facilitySuggestions.push({ id: 'sg-new', name: 'New General', address: '', count: 1, firstDate: '2026-11-12', lastDate: '2026-11-12', provider: 'apple', sourceCalendarName: '', dismissed: false, createdAt: '', lastSeenAt: '', sampleTitles: [] });
  actions('facility-suggestion-dismiss', 'sg-camc');
`);
const pageMixed = run(`facilitiesPage()`);
t('mixed: card shows for the active suggestion, dismissed folded inside it, no bottom block',
  pageMixed.includes('We noticed shifts at New General in your calendar. Add it as a facility?') &&
  pageMixed.includes('Dismissed suggestions (1)') &&
  !pageMixed.includes('id="facility-dismissed-panel"'));

// --- 7. Facilities functions intact on the page.
t('contract upload, AI rule chat, pay stub and manual form all still present',
  pageMixed.includes('id="facilityContractForm"') &&
  pageMixed.includes('id="ruleChatForm"') &&
  pageMixed.includes('id="paystub-panel"') &&
  pageMixed.includes('id="f_name"'));

t('service worker cache bumped to v45', swSrc.includes('crna-hub-shell-v45'));
