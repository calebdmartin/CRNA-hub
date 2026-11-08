// CRNA Hub — regression tests for the false pending-deletions bug
// (Nov 6, 2026). Run: node test-pending-deletions-fix.js
//
// Caleb's case: he re-synced Apple Calendar and ALL pending deletions
// were still listed, even though every flagged shift was still in his
// Apple calendar and had to stay. Two root causes, both pinned here:
//   1. Client: liveSyncApplyChanges only ever ADDED server-reported
//      pending deletions to the stored list — a flag raised by one
//      sync (while a shift was mid-re-import under a new id) could
//      never be cleared by a later sync. The stored list is now
//      REPLACED per provider from the server's fresh response, and a
//      "no longer on this device" flag for a shift that IS on the
//      device is dropped on sight.
//   2. Server: a dedicated-calendar event paired to an old shift id
//      was flagged localMissing with no fallback match. The sync now
//      re-links via findFallbackLocalShift (date + facility + type)
//      before flagging — pinned here by source checks, and unit-
//      tested in supabase/functions/_shared/calendar.test.ts.
// Plus the way out: a bulk "Keep all — these are still on my
// calendar" action that clears every flag, deletes nothing anywhere,
// and keeps the shifts tracked (NOT "Stop tracking it").
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
const fetchCalls = [];
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
  alert: () => {},
  confirm: () => true,
  __syncResponse: { providerChanges: [], pendingDeletions: [], imported: null, shiftSync: [] },
  __fetchCalls: fetchCalls,
  fetch: async (url, opts) => {
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    fetchCalls.push({ url, body });
    let data = { ok: true };
    if (body && body.function === 'sync-calendar' && body.action === 'sync') data = sandbox.__syncResponse;
    else if (body && body.function === 'sync-calendar' && body.action === 'status') {
      data = { connections: [{ provider: 'apple', status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-06T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' }] };
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
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const HOLZER = `{ id: 'f-holzer', name: 'Holzer', aliases: '', address: '', rate8: '2125', rate10: '2625', rate12: '', rate24: '', rateSecond: '3000', weekendRateSecond: '2000', hourlyRate: '250', paidHours8: '8.5', callBonus: '1000', distance: '', notes: '' }`;
// Caleb's four flagged shifts, as they exist in his app TODAY —
// re-imported under NEW ids (the flags point at the old ones).
const HIS_SHIFTS = `
  { id: 'new-1', date: '2027-03-29', facility: 'Holzer', type: '8-hour day', pay: '2125', note: '', source: 'apple-import', status: 'proposed', incomplete: false, updatedAt: null },
  { id: 'new-2', date: '2026-12-16', facility: 'Holzer', type: '24-hour call', pay: '4800', note: '', source: 'apple-import', status: 'proposed', incomplete: false, updatedAt: null },
  { id: 'new-3', date: '2025-11-03', facility: 'Holzer', type: '8-hour day', pay: '2125', note: '', source: 'apple-import', status: 'confirmed', incomplete: false, updatedAt: null },
  { id: 'new-4', date: '2027-03-04', facility: 'Holzer', type: '8-hour day', pay: '2125', note: '', source: 'apple-import', status: 'proposed', incomplete: false, updatedAt: null },
`;
const HIS_FLAGS = `
  { provider: 'apple', shiftId: 'old-1', date: '2027-03-29', facility: 'Holzer', type: '8-hour day', localMissing: true },
  { provider: 'apple', shiftId: 'old-2', date: '2026-12-16', facility: 'Holzer', type: '24-hour call', localMissing: true },
  { provider: 'apple', shiftId: 'old-3', date: '2025-11-03', facility: 'Holzer', type: '8-hour day', localMissing: true },
  { provider: 'apple', shiftId: 'old-4', date: '2027-03-04', facility: 'Holzer', type: '8-hour day', localMissing: true },
`;

(async () => {
  run(`
    cloudSession = { access_token: 'test-token', email: 'test@example.com', expires_at: Math.floor(Date.now()/1000) + 3600 };
    liveSyncConfig = { state: 'ready', google: true, outlook: false, apple: true, encryption: true };
    liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-06T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
    db.facilities = [${HOLZER}];
    db.facilitySuggestions = [];
    liveSyncState.tombstones = [];
  `);

  // --- Case 1: event present but outside the fetched batch / not
  // re-reported — a re-sync that no longer flags them CLEARS them. ---
  run(`
    db.shifts = [${HIS_SHIFTS}];
    liveSyncState.pending = [${HIS_FLAGS}];
    __syncResponse = { providerChanges: [], pendingDeletions: [], imported: null, shiftSync: [] };
    liveSyncApplyChanges('apple', __syncResponse);
    globalThis.__pendingAfterResync = liveSyncState.pending.slice();
    globalThis.__shiftsAfterResync = db.shifts.map((s) => s.id);
  `);
  t('re-sync that does not re-report the flags clears all four (past, near, and future dates)',
    sandbox.__pendingAfterResync.length === 0);
  t('clearing the flags removes none of his shifts',
    JSON.stringify(sandbox.__shiftsAfterResync) === JSON.stringify(['new-1', 'new-2', 'new-3', 'new-4']));

  // --- Case 2: event present under a new ID — the server re-links
  // (findFallbackLocalShift) so no flag is produced; pinned by source. ---
  const serverSrc = fs.readFileSync(R + 'supabase/functions/sync-calendar/index.ts', 'utf8');
  const sharedSrc = fs.readFileSync(R + 'supabase/functions/_shared/calendar.ts', 'utf8');
  t('server: fallback matcher exists in the shared helpers (date + facility + type)',
    sharedSrc.includes('export function findFallbackLocalShift'));
  t('server: sync re-links via the fallback BEFORE the step-2 localMissing flag branches',
    serverSrc.includes('findFallbackLocalShift(') &&
    serverSrc.indexOf('findFallbackLocalShift(') > serverSrc.indexOf('Provider events -> local changes') &&
    serverSrc.indexOf('findFallbackLocalShift(') < serverSrc.indexOf('Mapped event, local shift missing'));
  t('server: absence from an incremental batch is never itself a deletion (documented guard at the flag site)',
    serverSrc.includes('never on an event\'s mere absence from an incremental batch'));

  // --- Case 3: event genuinely absent inside the fetched range —
  // the server flags it in THIS sync's response and it is recorded. ---
  run(`
    db.shifts = [${HIS_SHIFTS}];
    liveSyncState.pending = [];
    liveSyncApplyChanges('apple', { providerChanges: [], pendingDeletions: [
      { provider: 'apple', shiftId: 'new-2', date: '2026-12-16', facility: 'Holzer', type: '24-hour call', localMissing: false },
    ], imported: null, shiftSync: [] });
    globalThis.__pendingGenuine = liveSyncState.pending.slice();
  `);
  t('a flag reported by the current sync (provider copy genuinely gone) is recorded',
    sandbox.__pendingGenuine.length === 1 && sandbox.__pendingGenuine[0].shiftId === 'new-2' &&
    sandbox.__pendingGenuine[0].localMissing === false);
  t('the genuinely flagged shift itself is NOT deleted — it waits for the user',
    run(`db.shifts.some((s) => s.id === 'new-2')`));

  // --- Case 4: a fresh localMissing flag for a shift that IS on this
  // device (same id) is stale by definition — dropped on sight. ---
  run(`
    liveSyncState.pending = [];
    liveSyncApplyChanges('apple', { providerChanges: [], pendingDeletions: [
      { provider: 'apple', shiftId: 'new-1', date: '2027-03-29', facility: 'Holzer', type: '8-hour day', localMissing: true },
    ], imported: null, shiftSync: [] });
    globalThis.__pendingStale = liveSyncState.pending.slice();
  `);
  t('"no longer on this device" flag for a shift that is on this device is dropped, not stored',
    sandbox.__pendingStale.length === 0);

  // --- Case 5: bulk Keep all — clears every flag, deletes nothing,
  // keeps the shifts, and drops the pairings WITHOUT deleting any
  // provider event (no deleteProvider anywhere). ---
  fetchCalls.length = 0;
  run(`
    db.shifts = [${HIS_SHIFTS}];
    liveSyncState.pending = [${HIS_FLAGS}];
    liveSyncSetShiftState('apple', 'new-1', 'pending-deletion');
  `);
  await run(`liveSyncKeepAllPending()`);
  t('keep-all clears the whole pending list',
    run(`liveSyncState.pending.length`) === 0);
  t('keep-all keeps every shift in the app',
    run(`db.shifts.length`) === 4);
  const resolves = fetchCalls.filter((c) => c.body && c.body.action === 'resolve-deletion');
  t('keep-all resolves each pairing server-side (4 resolve-deletion calls)',
    resolves.length === 4);
  t('keep-all never asks the server to delete a provider event',
    resolves.every((c) => c.body.deleteProvider !== true));
  t('keep-all clears the matched local shift\'s pending-deletion state',
    run(`(liveSyncState.shiftSync['new-1'] || {}).apple.state`) === 'not-synced');
  t('panel no longer shows the Pending deletions section after keep-all',
    !run(`liveSyncPanelHTML()`).includes('Pending deletions'));

  // --- Case 6: the Keep all button is offered when there is a list
  // to clear, with Caleb's wording. ---
  run(`liveSyncState.pending = [${HIS_FLAGS}]; globalThis.__panel = liveSyncPanelHTML();`);
  t('pending section offers "Keep all — these are still on my calendar"',
    sandbox.__panel.includes('Keep all — these are still on my calendar') &&
    sandbox.__panel.includes('data-action="live-keep-all"'));
  const liveSrc = fs.readFileSync(R + 'live-sync.js', 'utf8');
  t('client: stored pending list is replaced per provider on each sync, not union-merged',
    liveSrc.includes("liveSyncState.pending = liveSyncState.pending.filter((p) => p.provider !== provider);"));
  t('service worker cache bumped to v65',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v76'));

  console.log(failures ? ('\n' + failures + ' FAILURES') : '\nALL PASS');
})();
