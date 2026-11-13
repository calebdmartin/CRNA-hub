// CRNA Hub — tests for the Account sync-area split (Nov 6, 2026, branch
// muse/credentialing). Run: node test-sync-panels-split.js
//
// Live calendar sync, QGenda, and Upload a schedule used to live inside
// one long scrolling <section>. They are now three separate sibling
// <details class="panel collapse-panel"> panels on the Account page,
// each expanding/collapsing independently:
//
//   * Order: Live calendar sync, QGenda, Upload a schedule — none of
//     them nested inside another's panel.
//   * Live calendar sync panel holds the provider cards (with their
//     own collapse behavior), the sync log, pending deletions, and the
//     conflict-rule line. It starts open while the user still needs to
//     act (fresh user, onboarding step 2 in progress, a provider needs
//     reconnecting, deletions waiting) and rests collapsed once a
//     provider is connected and nothing is waiting.
//   * QGenda panel holds the subscription-URL connect and the signed-in
//     fallback; it rests collapsed and opens when a connect/fetch just
//     reported back (status/error to show).
//   * Upload a schedule panel holds the upload form and the .ics
//     manual fallback inside it; its open logic is unchanged (open for
//     a fresh user or mid-import, else collapsed).
//   * All underlying controls stay present and wired when expanded.
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
class FakeFormData {
  constructor(form) { this._map = (form && form._map) || {}; this._e = (form && form._entries) || []; }
  get(k) { return k in this._map ? this._map[k] : null; }
  *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; }
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
const SESSION = `cloudSession = { access_token: 'x', email: 'crna@example.com' };`;
const RESET = `
  onboardStep = 0;
  liveSyncConfig = { state: 'ready', google: true, outlook: false, apple: true, encryption: true };
  liveSyncConnections = {};
  liveSyncAppleCalendars = [];
  liveSyncShowOthers = false;
  liveSyncState.pending = [];
  liveSyncLog = [];
  liveSyncError = '';
  qgendaStatusError = '';
  schedulePreview = null; scheduleImportError = ''; scheduleAiStatus = ''; scheduleImportContext = '';
  db.settings.scheduleImported = false;
  db.settings.qgendaConnected = false;
`;
function segments(html) {
  const iLive = html.indexOf('id="live-sync-panel"');
  const iQ = html.indexOf('id="qgenda-panel"');
  const iU = html.indexOf('id="schedule-import-panel"');
  return {
    iLive, iQ, iU,
    live: iLive >= 0 ? html.slice(iLive, iQ > iLive ? iQ : undefined) : '',
    qgenda: iQ >= 0 ? html.slice(iQ, iU > iQ ? iU : undefined) : '',
    upload: iU >= 0 ? html.slice(iU) : '',
  };
}

(async () => {
  // ================= Fresh user: structure + defaults =================
  run(`
    ${SESSION}
    ${RESET}
    liveSyncLog = [
      { created_at: '2026-11-06T12:00:00Z', provider: 'apple', direction: 'both', shifts_created: 3, shifts_updated: 1, shifts_flagged: 0, shifts_deleted: 0 },
    ];
    globalThis.__fresh = syncSectionHTML();
  `);
  const fresh = segments(sandbox.__fresh);
  t('three sibling panels exist, in order Live sync / QGenda / Upload',
    fresh.iLive >= 0 && fresh.iQ > fresh.iLive && fresh.iU > fresh.iQ &&
    sandbox.__fresh.includes('<details class="panel collapse-panel" id="live-sync-panel"') &&
    sandbox.__fresh.includes('<details class="panel collapse-panel" id="qgenda-panel"') &&
    sandbox.__fresh.includes('<details class="panel collapse-panel" id="schedule-import-panel"'));
  t('panel titles live in their summary headers, not as body <h2>s',
    sandbox.__fresh.includes('<span class="collapse-title">Live calendar sync</span>') &&
    sandbox.__fresh.includes('<span class="collapse-title">QGenda</span>') &&
    sandbox.__fresh.includes('<span class="collapse-title">Upload a schedule</span>') &&
    !sandbox.__fresh.includes('<h2>Live calendar sync</h2>') &&
    !sandbox.__fresh.includes('<h2>QGenda</h2>'));
  t('no panel is nested inside another (segments hold only their own controls)',
    fresh.live.includes('Connect Apple Calendar') &&
    !fresh.live.includes('id="qgendaForm"') && !fresh.live.includes('id="scheduleForm"') &&
    fresh.qgenda.includes('id="qgendaForm"') &&
    !fresh.qgenda.includes('id="scheduleForm"') && !fresh.qgenda.includes('Sync log') &&
    fresh.upload.includes('id="scheduleForm"') &&
    !fresh.upload.includes('id="qgendaForm"'));
  t('live sync panel holds providers, the sync log, and the conflict rule',
    fresh.live.includes('Connect Google Calendar') &&
    fresh.live.includes('<details class="collapse-sub sync-log">') &&
    fresh.live.includes('Sync log · last:') &&
    fresh.live.includes('Conflict rule: newest edit wins') &&
    fresh.live.includes('data-action="live-refresh"'));
  t('QGenda panel holds the URL connect and the signed-in fallback',
    fresh.qgenda.includes('Your QGenda Subscription URL') &&
    fresh.qgenda.includes('Connect QGenda feed') &&
    fresh.qgenda.includes('I signed in to QGenda — use my schedule'));
  t('upload panel holds the upload form and the .ics fallback inside it',
    fresh.upload.includes('f_scheduleFile') &&
    fresh.upload.includes('Read schedule — preview only') &&
    fresh.upload.includes('<details><summary>Manual fallback — import or export a .ics file</summary>') &&
    fresh.upload.includes('data-action="export-cal-all"'));
  // v136 (Nov 11, 2026) — pin updated deliberately: Caleb's
  // section-completion rule ("the next incomplete section is the
  // one left open during onboarding") supersedes the Nov 6 default
  // that opened BOTH step-2 panels for a fresh user. In the Account
  // stack, Live calendar sync (the primary) starts expanded and
  // Upload a schedule rests closed behind its header; standalone on
  // the Facilities tab the upload panel keeps its fresh-user open
  // (pinned in test-v136-sections.js).
  t('fresh user: live sync panel starts expanded, upload + QGenda rest collapsed (v136)',
    sandbox.__fresh.includes('<details class="panel collapse-panel" id="live-sync-panel" open>') &&
    sandbox.__fresh.includes('<details class="panel collapse-panel" id="schedule-import-panel">') &&
    sandbox.__fresh.includes('<details class="panel collapse-panel" id="qgenda-panel">'));

  // ================= Connected user: summaries, panels rest =================
  run(`
    ${RESET}
    liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
    liveSyncAppleCalendars = [{ url: 'cal-work', name: 'Caleb Work Schedule', isDedicated: false }];
    globalThis.__conn = syncSectionHTML();
  `);
  const conn = segments(sandbox.__conn);
  t('connected: live sync panel rests collapsed, provider summary inside',
    sandbox.__conn.includes('<details class="panel collapse-panel" id="live-sync-panel">') &&
    conn.live.includes('Apple Calendar · Connected · Pulling from: Caleb Work Schedule · Last sync:') &&
    conn.live.includes('Use a different calendar service') &&
    !conn.live.includes('Connect Google Calendar'));
  t('connected: upload panel rests collapsed too, controls intact inside',
    sandbox.__conn.includes('<details class="panel collapse-panel" id="schedule-import-panel">') &&
    conn.upload.includes('id="scheduleForm"') &&
    conn.upload.includes('f_scheduleFile'));

  // ================= Independence: states computed per panel =================
  run(`
    qgendaStatusError = 'Could not connect the QGenda feed: test problem. Nothing was saved.';
    globalThis.__qgErr = syncSectionHTML();
    qgendaStatusError = '';
  `);
  t('a QGenda result opens only the QGenda panel (live + upload stay collapsed)',
    sandbox.__qgErr.includes('<details class="panel collapse-panel" id="qgenda-panel" open>') &&
    sandbox.__qgErr.includes('<details class="panel collapse-panel" id="live-sync-panel">') &&
    sandbox.__qgErr.includes('<details class="panel collapse-panel" id="schedule-import-panel">') &&
    segments(sandbox.__qgErr).qgenda.includes('Could not connect the QGenda feed'));

  run(`
    liveSyncState.pending = [{ provider: 'apple', shiftId: 's1', date: '2026-12-16', facility: 'Holzer', type: '24-hour call', localMissing: true }];
    globalThis.__pend = syncSectionHTML();
    liveSyncState.pending = [];
  `);
  t('pending deletions reopen the live panel even when connected',
    sandbox.__pend.includes('<details class="panel collapse-panel" id="live-sync-panel" open>') &&
    segments(sandbox.__pend).live.includes('Pending deletions — your confirmation needed'));

  run(`
    liveSyncConnections = { google: { status: 'needs_reauth' } };
    globalThis.__reauth = syncSectionHTML();
    ${RESET}
  `);
  t('a provider needing reconnect reopens the live panel',
    sandbox.__reauth.includes('<details class="panel collapse-panel" id="live-sync-panel" open>'));

  run(`
    ${RESET}
    liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
    liveSyncAppleCalendars = [{ url: 'cal-work', name: 'Caleb Work Schedule', isDedicated: false }];
    onboardStep = 2;
    globalThis.__step2 = syncSectionHTML();
    onboardStep = 0;
  `);
  t('onboarding step 2 in progress: live panel expands so the user can act',
    sandbox.__step2.includes('<details class="panel collapse-panel" id="live-sync-panel" open>'));

  t('service worker cache bumped to v65',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v159'));

  console.log(failures === 0 ? 'sync-panels-split test done: all passed' : 'sync-panels-split test done: FAILURES=' + failures);
})();
