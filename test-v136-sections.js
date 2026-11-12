'use strict';
// v136 Phase 2 (Nov 11, 2026) — the section-completion rule (Caleb:
// "as each one of these sections have information added to them and
// are completed that they close that section, signaling
// completion"). Pins:
//   1. Account step-2 stack: exactly ONE incomplete section rests
//      open — Live calendar sync (the primary). QGenda and Upload a
//      schedule rest closed behind their headers, one tap away.
//      (Standalone on Facilities, Upload keeps its fresh-user open.)
//   2. QGenda connected: the CLOSED header carries the completion
//      summary ("QGenda · Connected"); an error re-opens it (a
//      problem never hides behind a closed section).
//   3. Facility-card stub section: header gains "· on file" once a
//      stub actual is saved for the facility; closed either way.
//   4. Completing a schedule import clears the import context, so
//      the Upload panel closes on the completion transition instead
//      of staying "busy" open forever (the QGenda-path leak).
//   5. Reopen works: every panel is a <details> with a tappable
//      <summary> header — one tap reopens, no state to lose.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) {
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [],
    dataset: {}, style: {}, _listeners: {}, _entries: null,
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [],
  };
}
const elements = {};
const getEl = (id) => elements[id] || (elements[id] = el(id));
class FakeFormData {
  constructor(form) { this._map = (form && form._map) || {}; this._e = (form && form._entries) || []; }
  get(k) { return k in this._map ? this._map[k] : null; }
  *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; }
}
const alerts = [];
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
    getElementById: (id) => getEl(id),
    querySelectorAll: () => [],
    createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
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
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) { fails++; process.exitCode = 1; } };

const SESSION = `cloudSession = { access_token: 'tok', refresh_token: 'rtok', email: 't@example.com', user: { id: 'u1' } }; cloudActive = true;`;
const RESET = `
  onboardStep = 0;
  liveSyncConfig = { state: 'ready', google: true, outlook: false, apple: true, encryption: true };
  liveSyncConnections = {};
  liveSyncAppleCalendars = [];
  liveSyncShowOthers = false;
  liveSyncState.pending = [];
  liveSyncLog = [];
  liveSyncError = '';
  qgendaStatusError = ''; qgendaPendingNew = 0;
  schedulePreview = null; scheduleImportError = ''; scheduleAiStatus = ''; scheduleImportContext = '';
  db.settings.scheduleImported = false;
  db.settings.qgendaConnected = false;
`;
const panelOpen = (html, id) => new RegExp('id="' + id + '" open').test(html);
const seg = (html, id) => { const i = html.indexOf('id="' + id + '"'); return i < 0 ? '' : html.slice(i, i + 400); };

// ---------- 1. Step-2 stack: one incomplete section open ----------
run(`${SESSION} db = empty(); db.settings.scheduleName='Martin'; persist(); ${RESET}`);
const stack = run(`syncSectionHTML()`);
t('fresh stack: Live calendar sync rests open (the incomplete primary)',
  panelOpen(stack, 'live-sync-panel'));
t('fresh stack: Upload a schedule rests CLOSED behind its header',
  !panelOpen(stack, 'schedule-import-panel') && stack.includes('<span class="collapse-title">Upload a schedule</span>'));
t('fresh stack: QGenda rests CLOSED',
  !panelOpen(stack, 'qgenda-panel'));
t('standalone Upload (Facilities home) keeps its fresh-user open',
  panelOpen(run(`scheduleImportHTML()`), 'schedule-import-panel'));
// Everything done: calendar connected + source picked + schedule imported.
run(`
  liveSyncConnections = { apple: { provider: 'apple', status: 'connected', sourceChoice: 'chosen', sourceCalendars: [{ name: 'Work', ref: 'x' }] } };
  db.settings.scheduleImported = true;
`);
const doneStack = run(`syncSectionHTML()`);
t('completed stack: Live calendar sync rests closed too',
  !panelOpen(doneStack, 'live-sync-panel'));
// A problem re-opens its section: provider needs reauth.
run(`liveSyncConnections = { apple: { provider: 'apple', status: 'needs_reauth' } };`);
t('problem state: needs-reauth re-opens Live calendar sync',
  panelOpen(run(`syncSectionHTML()`), 'live-sync-panel'));
run(`${RESET}`);

// ---------- 2. QGenda completion summary + problem re-open ----------
run(`db.settings.qgendaConnected = true; db.settings.qgendaMasked = 'app.qgenda.com/…1234';`);
const qConn = run(`qgendaFeedHTML()`);
t('QGenda connected: closed header carries "QGenda · Connected"',
  qConn.includes('<span class="collapse-title">QGenda · Connected</span>') && !panelOpen(qConn, 'qgenda-panel'), seg(qConn, 'qgenda-panel'));
run(`qgendaStatusError = 'That feed did not answer — check the URL.';`);
t('QGenda error: panel force-opens with the problem visible',
  panelOpen(run(`qgendaFeedHTML()`), 'qgenda-panel'));
run(`qgendaStatusError = ''; db.settings.qgendaConnected = false;`);

// ---------- 3. Card stub header completion signal ----------
const HOLZ = {
  id: 'holz', name: 'HOLZ', aliases: 'Holzer', address: '', hourlyRate: '250', paidHours8: '8.5',
  rate8: '', rate10: '2625', rate12: '', rate24: '4800', weekendRate24: '4200',
  rateSecond: '3000', weekendRateSecond: '2000', callBonus: '', hourlyCall1st: '175',
  weekendDays: [0, 6], ratesSource: 'words', codeMap: {},
};
run(`db.facilities = [${JSON.stringify(HOLZ)}]; db.payStubs = [];`);
const cardBare = run(`paystubCardSectionHTML(db.facilities[0])`);
t('card stub: no stub yet — plain header, closed',
  cardBare.includes('Upload a pay stub (optional)</span>') && !/id="paystub-card-holz" open/.test(cardBare));
run(`db.payStubs = [{ id:'ps1', agency:'HOLZ', facility:'HOLZ', frequency:'biweekly', periodStart:'2026-11-02', periodEnd:'2026-11-15', payDate:'2026-11-24', gross:'12757.50', net:'', source:'stub', fileName:'' }];`);
const cardStub = run(`paystubCardSectionHTML(db.facilities[0])`);
t('card stub: stub saved — header reads "· on file", still closed (completion signal)',
  cardStub.includes('Upload a pay stub (optional) · on file</span>') && !/id="paystub-card-holz" open/.test(cardStub), cardStub.slice(0, 300));

// ---------- 4. Import completion closes the Upload section ----------
run(`
  db.payStubs = []; db.shifts = [];
  scheduleImportContext = 'qgenda';
  schedulePreview = { fileName: 'qgenda-shot.png', source: 'photo', rows: [
    { date: '2026-12-08', facility: 'HOLZ', type: '24-hour call', code: 'Holz-call 1', pay: '4800', include: true, duplicate: false, flags: [], incomplete: false }
  ]};
`);
t('mid-import (QGenda path): Upload panel is open (busy, never slammed shut)',
  panelOpen(run(`scheduleImportHTML()`), 'schedule-import-panel'));
run(`approveScheduleImport();`);
t('after approve: import context cleared', run(`scheduleImportContext`) === '');
t('after approve: Upload panel rests CLOSED (completion transition)',
  !panelOpen(run(`scheduleImportHTML()`), 'schedule-import-panel'));

// ---------- 5. Reopen: native details/summary everywhere ----------
t('panels are native <details> with a tappable <summary> (one tap reopens)',
  stack.includes('<details class="panel collapse-panel" id="live-sync-panel"') &&
  stack.includes('<summary class="collapse-head">') &&
  cardStub.includes('<summary class="collapse-head">'));
t('sw: cache bumped to v136', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v140'));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
