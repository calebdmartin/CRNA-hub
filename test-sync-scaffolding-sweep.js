// CRNA Hub — tests for the Nov 6, 2026 calendar-sync cleanup + whole-app
// dev-scaffolding sweep (Caleb, ~11:30-11:31 AM EST):
//   * The four highlighted paragraphs on the calendar panels are gone or
//     condensed to one line (Google, Outlook, Apple, Your work calendar).
//   * The owner-setup wizard and every trace of it are removed.
//   * No rendered page anywhere in the app carries preview/final-design
//     scaffolding: no "Preview stand-in", no "Final-design status", no
//     build stamp / version line, no model/OCR library names, no
//     owner instructions, no stale "Saved shifts" reference.
//   * Statuses, buttons and the sync itself still work.
// Run: node test-sync-scaffolding-sweep.js
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
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const liveSrc = fs.readFileSync(R + 'live-sync.js', 'utf8');

run(`
  cloudSession = { access_token: 'tok', email: 'c@example.com' };
  liveSyncConfig = { state: 'ready', google: true, outlook: false, apple: true, encryption: true };
  liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
  liveSyncAppleCalendars = [
    { url: 'cal-work', name: 'Caleb Work Schedule', isDedicated: false },
    { url: 'cal-app', name: 'CRNA Hub', isDedicated: true },
  ];
  globalThis.__panel = liveSyncPanelHTML();
  globalThis.__google = liveSyncProviderCard('google');
  globalThis.__outlook = liveSyncProviderCard('outlook');
  globalThis.__apple = liveSyncProviderCard('apple');
`);
const panel = run(`__panel`), google = run(`__google`), outlook = run(`__outlook`), apple = run(`__apple`);

// ---------- 1. The four highlighted blocks ----------
t('Google card: paragraph gone, Connect button intact',
  google.includes('Connect Google Calendar') &&
  !google.includes('One click to the provider consent screen') &&
  !google.includes('No files to upload, no passwords typed'));
t('Outlook card: clean Not-available line, .ics route named, no wizard',
  outlook.includes('Not available yet') &&
  outlook.includes('Use the .ics import/export below for now.') &&
  !outlook.includes('app owner') && !outlook.includes('wizard') && !outlook.includes('Wizard'));
t('owner-setup wizard is gone entirely (function, action, buttons)',
  run(`typeof liveSyncWizardHTML`) === 'undefined' &&
  !liveSrc.includes('live-wizard') && !panel.includes('wizard') && !panel.includes('Wizard'));
t('Apple connected card: only compact status labels remain',
  apple.includes('Last sync:') && apple.includes('Auto-delete: OFF') &&
  apple.includes('Sync now') && apple.includes('Disconnect') &&
  !apple.includes('Shifts you add or edit here go to'));
t('no stale "Saved shifts" reference anywhere in the sync panel',
  !panel.includes('Saved shifts') && !apple.includes('Saved shifts'));
t('work calendar: one condensed line above the picker',
  apple.includes('Your work calendar') &&
  apple.includes('Pick the calendar your shifts live in — we’ll pull from that one only.') &&
  apple.includes('Save work calendar &amp; sync now') &&
  !apple.includes('recognises events') && !apple.includes('held, not imported') &&
  !apple.includes('abbreviations and pay rule'));
t('panel intro is one condensed line',
  panel.includes('Connect once, pick the calendar your shifts live in, and we’ll pull them in.'));

// ---------- 2. Apple disconnected: function kept, scaffolding stripped ----------
run(`
  liveSyncConnections = {};
  liveSyncApplePick = null;
  globalThis.__appleOff = liveSyncProviderCard('apple');
  globalThis.__googleOff = liveSyncProviderCard('google');
`);
const appleOff = run(`__appleOff`), googleOff = run(`__googleOff`);
t('Apple disconnected: app-specific-password flow still works, clean label only',
  appleOff.includes('Connect Apple Calendar') && appleOff.includes('f_liveApplePw') &&
  appleOff.includes('app-specific password') &&
  appleOff.includes('Never enter your normal Apple password here'));
t('Apple disconnected: no preview/finished-app/EventKit scaffolding',
  !appleOff.includes('Preview stand-in') && !appleOff.includes('preview-standin') &&
  !appleOff.includes('finished app') && !appleOff.includes('EventKit') && !appleOff.includes('CalDAV'));
t('Google disconnected: just the Connect button',
  googleOff.includes('Connect Google Calendar') && !googleOff.includes('consent screen'));

// ---------- 3. Whole-app sweep: no scaffolding on any rendered page ----------
run(`
  liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
`);
const pages = {
  Dashboard: run(`dashboard()`),
  Facilities: run(`facilitiesPage()`),
  PTO: run(`ptoPage()`),
  Credentials: run(`credentialsPage()`),
  Mileage: run(`mileagePage()`),
  Assistant: run(`assistantPage()`),
  Account: run(`accountPage()`),
};
const BANNED = ['Preview stand-in', 'preview-standin', 'standin', 'Final-design status',
  'owner-setup', 'Owner-setup', 'EventKit', 'finished app', 'finished native',
  'CRNA Hub version:', 'gpt-4o-mini', 'Tesseract.js', 'Web-preview limit',
  'supabase-config.js', 'migration 005', 'system sign-in sheet', 'Saved shifts'];
for (const [name, html] of Object.entries(pages)) {
  const hit = BANNED.filter((b) => html.includes(b));
  t(`${name} page renders with zero scaffolding strings`, hit.length === 0);
  if (hit.length) console.log('   found:', hit.join(', '));
}
t('build stamp + check-for-update scaffolding gone from the source',
  !appSrc.includes('BUILD_STAMP') && !appSrc.includes('checkAppUpdate') &&
  run(`typeof BUILD_STAMP`) === 'undefined');
t('portal stand-in constants gone from the source',
  run(`typeof PORTAL_STANDIN_LABEL`) === 'undefined' &&
  !liveSrc.includes('const LIVE_SYNC_STANDIN_LABEL'));
t('OCR diagnostics debug readout is gone (function is a no-op)',
  run(`ocrDiagnosticsHTML([{text:'x'}],[{name:'p.jpg'}],'abc')`) === '' &&
  !appSrc.includes('What the app read from your photos'));
t('sync still works: panel lists all three providers with their buttons',
  panel.includes('Google Calendar') && panel.includes('Outlook') && panel.includes('Apple Calendar') &&
  panel.includes('Sync now') && panel.includes('Refresh status &amp; log'));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
