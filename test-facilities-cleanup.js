// CRNA Hub — tests for the Facilities cleanup (Nov 6, 2026):
//   * the numbered "pick a path" list no longer carries an "Upload a
//     contract" item — it only scrolled down to the contract panel
//     below. The list is now 1) Sync your calendar, 2) Manually enter
//     rates, renumbered cleanly by the <ol>;
//   * the contract upload panel itself is untouched and still works
//     end to end (paste text -> preview -> approve -> facility saved);
//   * the developer build-notes block ("Build 2026-11-06 · TDZ fix: …
//     · cache v37" + "Check for update / Still seeing an old build?")
//     is gone from the contract panel — and no user-facing page shows
//     a build-notes/changelog block. The only build stamp left is a
//     tiny version line in Account small print.
// Run: node test-facilities-cleanup.js
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
  FormData: class { *[Symbol.iterator]() {} },
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
  alert: () => {},
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');

// ---------- 1. Numbered list: contract item gone, numbering clean ----------
const paths = run(`facilityThreePathsHTML({id:'sg1', name:'CAMC'})`);
// v121 (Caleb, Nov 11, 2026) SUPERSEDES the Nov 6 two-path cleanup
// for this component: the suggestion card now offers all three rate
// paths inline — upload a contract, describe rates in your words,
// enter the hourly rate manually — because the post-sync handoff
// lands the user right on the card and each path works there.
t('paths are the three inline buttons (contract, words, manual)',
  paths.includes('data-date="contract"') &&
  paths.includes('data-action="facility-suggestion-words"') &&
  paths.includes('data-date="manual"'));
t('paths in order: contract, words, manual',
  paths.indexOf('data-date="contract"') > -1 &&
  paths.indexOf('data-action="facility-suggestion-words"') > paths.indexOf('data-date="contract"') &&
  paths.indexOf('data-date="manual"') > paths.indexOf('data-action="facility-suggestion-words"'));
t('path button labels are Caleb\'s three paths',
  paths.includes('Upload a contract') && paths.includes('Describe rates in your words') &&
  paths.includes('Enter hourly rate manually'));

// ---------- 2. Contract panel: still there, build notes gone ----------
const page = run(`facilitiesPage()`);
t('contract upload panel still on the Facilities page',
  page.includes('id="facility-contract-panel"') && page.includes('Add a facility from a contract') &&
  page.includes('facilityContractForm') && page.includes('Read my contract'));
t('no build-notes block on the Facilities page',
  !page.includes('Build 2026') && !page.includes('TDZ') &&
  !page.includes('Still seeing an old build') && !page.includes('Check for update') &&
  !page.includes('check-app-update') && !page.includes('cache v37') && !page.includes('cache v38'));
t('no build-notes text anywhere in the app.js source',
  !appSrc.includes('TDZ fix') && !appSrc.includes('Still seeing an old build') &&
  !appSrc.includes('Blank-page fix: boot watchdog'));

// ---------- 3. No user-facing page shows a changelog; Account has the tiny version line ----------
const pages = {
  Dashboard: run(`dashboard()`),
  Facilities: page,
  Credentials: run(`credentialsPage()`),
  Mileage: run(`mileagePage()`),
  Assistant: run(`assistantPage()`),
  Account: run(`accountPage()`),
};
for (const [name, html] of Object.entries(pages)) {
  t(`${name} page shows no build-notes/changelog block`,
    !html.includes('TDZ') && !html.includes('Still seeing an old build') &&
    !html.includes('helpers + SHIFT_STATUSES'));
}
t('Account small print carries NO version line (Nov 6 sweep: build stamp removed)',
  (pages.Account.match(/CRNA Hub version:/g) || []).length === 0 &&
  !pages.Account.includes('cache v'));
t('build stamp is gone entirely from the app',
  run(`typeof BUILD_STAMP`) === 'undefined' && !appSrc.includes('checkAppUpdate'));
t('service worker cache bumped to v65', swSrc.includes("crna-hub-shell-v147"));

// ---------- 4. Contract upload still works end to end (pasted text) ----------
(async () => {
  run(`db.facilities = []; facilityContractPreview = null; facilityContractError = '';`);
  elements['f_facilityContractFile'] = el();
  elements['f_facilityContractText'] = el();
  elements['f_facilityContractText'].value =
    'Facility: Holzer\nRate: $250/hr, $1,000 overnight call bonus\n24-hour / 1st call: $4,800';
  await run(`importFacilityContract({preventDefault(){}})`);
  t('pasted contract produces a preview (nothing saved yet)',
    run(`!!facilityContractPreview`) === true && run(`db.facilities.length`) === 0);
  t('preview carries the facility name and the $250/hr rate',
    /Holzer/.test(run(`facilityContractPreview.facilities[0].name`)) &&
    run(`facilityContractPreview.facilities[0].rates.hourlyRate`) === '250');
  await run(`approveFacilityContract()`);
  t('first save of a brand-new contract facility asks for confirmation (facility-choice parity)',
    run(`db.facilities.length`) === 0 && run(`facilityContractConfirmCreate`) === true);
  await run(`approveFacilityContract()`);
  t('approving the preview saves the facility with its rates',
    run(`db.facilities.length`) === 1 &&
    /Holzer/.test(run(`db.facilities[0].name`)) &&
    run(`db.facilities[0].hourlyRate`) === '250');
  console.log('facilities-cleanup test done');
})();
