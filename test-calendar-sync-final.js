// CRNA Hub — client tests for the FINAL native calendar-sync rework
// (Nov 5, 2026). Run: node test-calendar-sync-final.js
// (from ~/workspace/crna-hub-final-work/calendar-sync/)
//
// Covers, without any live API call (fetch is stubbed; no network):
//   * FINAL-MODEL COPY: the sync panel describes one connection +
//     pick your existing work calendar + pull only that calendar +
//     the app keeps its own calendar behind the scenes. The
//     onboarding step carries only its one-line direction; the long
//     final-model copy lives on the sync panel, not in the guide.
//     No user-facing instruction to create or label a "CRNA Hub"
//     calendar anywhere in the panel.
//   * PREVIEW STAND-IN LABELLING: the Apple CalDAV / app-specific-
//     password path appears ONLY inside a visually distinct
//     .preview-standin box carrying LIVE_SYNC_STANDIN_LABEL
//     ("Preview stand-in — the finished app uses EventKit, no password
//     needed"), and the password field sits inside that box.
//   * FINAL REUSABLE PIECES (client side): facilities-driven import,
//     dedupe (same date+facility+type never doubled), past imports
//     arrive confirmed and future imports proposed (Bug 1, Nov 6,
//     2026), unpriced stays incomplete and never $0,
//     unknown-hospital suggestions merge without creating a facility,
//     pending deletions are recorded for confirmation and never applied
//     silently, tombstones are sent with the sync so a deleted shift is
//     never re-imported, the one-shot repair flag is sent once.
//   * SERVER-OWNED RULES (not re-tested here — covered by
//     supabase/functions/_shared/calendar.test.ts): the facilities
//     parser itself, calendar_import_map dedupe, never-reimport-deleted
//     on the server, newest-wins comparison. This file tests the client
//     half of each rule and the copy around it.
//   * TWO-WAY PUSH (Nov 5, 2026): a confirmed/app-entered shift is
//     pushed to the app-owned calendar (the sync sends it with
//     updatedAt, stamped on every app-side save, so newest-wins can
//     push edits); the sync response's shiftSync is stored per shift
//     and rendered on Saved shifts as "On your calendar" / "Not yet
//     synced" / "Pending deletion"; deleting a shift records a
//     tombstone and drops its stored state, and the next sync sends
//     the tombstone without re-creating the shift; no sync request
//     ever carries the work-calendar URL, so nothing can write to the
//     work calendar.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// Repo root is either this file's directory, or a `repo/` checkout
// beside it (the staging layout earlier workers used).
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
// Stubbed fetch: no live API. Routes the same-origin proxy (/api/fn)
// the client uses for every Edge Function call.
const cannedSync = {
  providerChanges: [
    { action: 'create', shift: { id: 'shift-new-1', date: '2026-11-10', facility: 'Holzer', type: '8-hour day', pay: '2125', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: '2026-11-05T10:00:00Z' } },
    { action: 'create', shift: { id: 'shift-new-2', date: '2026-11-11', facility: 'Holzer', type: 'Second call', pay: '', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
  ],
  pendingDeletions: [
    { provider: 'apple', shiftId: 'shift-old-1', date: '2026-11-03', facility: 'Holzer', type: '8-hour day', localMissing: false },
  ],
  imported: {
    sourceCalendarName: 'Caleb Work Schedule', created: 2, updated: 0, skipped: 0, duplicates: 0,
    seen: 2, parsed: 2, unpriced: 1, skippedSuggested: 0, suggestions: [], newFacilities: [],
  },
  // Per-shift calendar state, derived server-side from
  // calendar_sync_map (see shiftSyncStateFor): the just-imported
  // shift is not on the app-owned calendar yet; the flagged shift's
  // provider copy is gone and unconfirmed.
  shiftSync: [
    { shiftId: 'shift-new-1', state: 'not-synced' },
    { shiftId: 'shift-old-1', state: 'pending-deletion' },
  ],
};
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
    if (body && body.function === 'sync-calendar' && body.action === 'sync') data = cannedSync;
    else if (body && body.function === 'sync-calendar' && body.action === 'status') {
      data = { connections: [{ provider: 'apple', status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' }] };
    } else if (body && body.function === 'sync-calendar' && body.action === 'log') data = { log: [] };
    else if (body && body.function === 'sync-calendar' && body.action === 'apple-calendars') {
      data = { calendars: [
        { url: 'cal-work', name: 'Caleb Work Schedule', isDedicated: false },
        { url: 'cal-app', name: 'CRNA Hub', isDedicated: true },
      ] };
    }
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
// Keep the submit test offline: never let a live-sync push run.
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const HOLZER = `{ id: 'f-holzer', name: 'Holzer', aliases: '', address: '', rate8: '2125', rate10: '2625', rate12: '', rate24: '', rateSecond: '3000', weekendRateSecond: '2000', hourlyRate: '250', paidHours8: '8.5', callBonus: '1000', distance: '', notes: '' }`;

(async () => {
  // --- Setup: signed in, Apple connected, work calendar picked. ---
  run(`
    cloudSession = { access_token: 'test-token', email: 'test@example.com', expires_at: Math.floor(Date.now()/1000) + 3600 };
    liveSyncConfig = { state: 'ready', google: true, outlook: false, apple: true, encryption: true };
    liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
    liveSyncAppleCalendars = [
      { url: 'cal-work', name: 'Caleb Work Schedule', isDedicated: false },
      { url: 'cal-app', name: 'CRNA Hub', isDedicated: true },
    ];
    db.facilities = [${HOLZER}];
    db.shifts = [{ id: 'shift-old-1', date: '2026-11-03', facility: 'Holzer', type: '8-hour day', pay: '2125', note: '', source: 'apple-import', status: 'proposed', incomplete: false, updatedAt: null }];
    db.facilitySuggestions = [];
    liveSyncState.pending = [];
    liveSyncState.tombstones = [];
    globalThis.__panel = liveSyncPanelHTML();
    globalThis.__appleCard = liveSyncProviderCard('apple');
    globalThis.__onboard2 = onboardingSteps()[1];
  `);

  // --- 1. Final-model copy in the panel. ---
  t('panel direction is one condensed line: connect once, pick your calendar',
    sandbox.__panel.includes('Connect once, pick the calendar your shifts live in, and we’ll pull them in.'));
  t('panel carries no preview/final-model scaffolding copy (Nov 6 sweep)',
    !sandbox.__panel.includes('Preview stand-in') && !sandbox.__panel.includes('EventKit') &&
    !sandbox.__panel.includes('behind the scenes') && !sandbox.__panel.includes('owner-setup') &&
    !sandbox.__panel.includes('finished app'));
  t('panel never tells the user to create or label a "CRNA Hub" calendar',
    !sandbox.__panel.includes('dedicated') &&
    !sandbox.__panel.includes('Create a calendar') &&
    !sandbox.__panel.includes('“CRNA Hub” calendar'));
  t('panel names no preview stand-in anywhere (Nov 6 sweep)',
    !sandbox.__panel.includes('Preview stand-in') && !sandbox.__panel.includes('preview-standin'));
  t('Apple card shows Pulling from + Change once a work calendar is picked, not an "import source" picker (v120)',
    sandbox.__appleCard.includes('Pulling from: Caleb Work Schedule') &&
    sandbox.__appleCard.includes('data-action="live-source-change"') &&
    !sandbox.__appleCard.includes('Import shifts from'));
  run(`
    liveSyncCalendarsByProvider = { apple: liveSyncAppleCalendars.map((c) => ({ ref: c.url, name: c.name, isDedicated: c.isDedicated })) };
    liveSyncSourceEdit = { apple: true };
    globalThis.__appleCardEdit = liveSyncProviderCard('apple');
    liveSyncSourceEdit = {};
  `);
  t('work-calendar picker (via Change) lists the work calendar and keeps the app-owned one untickable (v120)',
    sandbox.__appleCardEdit.includes('Save &amp; sync now') &&
    sandbox.__appleCardEdit.includes('Caleb Work Schedule') &&
    sandbox.__appleCardEdit.includes('the app writes here — not a source') &&
    sandbox.__appleCardEdit.includes('type="checkbox" disabled') &&
    !sandbox.__appleCardEdit.includes('value="cal-app"'));
  t('connected card shows only compact status labels: last sync + auto-delete on/off',
    sandbox.__appleCard.includes('Last sync:') && sandbox.__appleCard.includes('Auto-delete: OFF') &&
    !sandbox.__appleCard.includes('Saved shifts') && !sandbox.__appleCard.includes('never written to'));

  // --- 2. Onboarding step 2 is a one-line direction; the final-model
  // copy lives on the sync panel (section 1), not in the guide. ---
  t('onboarding step 2 direction is one short line: connect once, or upload a schedule',
    sandbox.__onboard2.direction === 'Connect a calendar once, or upload a schedule — the app picks out only your shifts.');
  t('onboarding step 2 direction carries no long final-model copy and no stand-in label',
    !sandbox.__onboard2.direction.includes('keeps its own calendar behind the scenes') &&
    !sandbox.__onboard2.direction.includes('Preview stand-in') &&
    !sandbox.__onboard2.direction.includes('app-specific password'));

  // --- 3. Apple disconnected card: stand-in box only. ---
  run(`
    liveSyncConnections = {};
    liveSyncApplePick = null;
    globalThis.__appleOff = liveSyncProviderCard('apple');
    liveSyncApplePick = { appleId: 'a@icloud.com', password: 'pw', calendars: [{ url: 'cal-work', name: 'Caleb Work Schedule' }] };
    globalThis.__applePick = liveSyncProviderCard('apple');
    liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
    liveSyncApplePick = null;
  `);
  t('disconnected Apple card leads with clean app-specific-password guidance, no scaffolding',
    sandbox.__appleOff.includes('app-specific password') &&
    sandbox.__appleOff.includes('Never enter your normal Apple password here') &&
    !sandbox.__appleOff.includes('Preview stand-in') && !sandbox.__appleOff.includes('finished app') &&
    !sandbox.__appleOff.includes('EventKit'));
  t('password field sits inside the Apple card, after the guidance',
    sandbox.__appleOff.indexOf('app-specific password') > -1 &&
    sandbox.__appleOff.indexOf('f_liveApplePw') > sandbox.__appleOff.indexOf('app-specific password'));
  t('disconnected Apple card never presents the password as the designed path',
    !sandbox.__appleOff.includes('Apple has no one-click OAuth') &&
    !sandbox.__appleOff.includes('dedicated'));
  t('pick-a-calendar card is one clean line + the picker, no final-flow framing',
    sandbox.__applePick.includes('Pick your work calendar') &&
    sandbox.__applePick.includes('Pick the calendar your shifts live in — we’ll pull from that one only.') &&
    !sandbox.__applePick.includes('finished app'));

  // --- 4. Legacy connect alert is gone by design (Nov 5 polish): the
  // connect-calendar action now just opens the Account tab, where the
  // live-sync panel describes the final model. ---
  t('connect-calendar action no longer shows a stale "not built yet" alert',
    !appSrc.includes('calSyncAlert') && appSrc.includes("if(action==='connect-calendar'){setTab('Account');return}"));

  // --- 5. Owner-setup wizard is GONE (Nov 6 sweep: dev scaffolding). ---
  t('owner-setup wizard no longer exists and is not rendered',
    run(`typeof liveSyncWizardHTML`) === 'undefined' &&
    !sandbox.__panel.includes('wizard') && !sandbox.__panel.includes('Wizard'));

  // --- 6. Apply changes: dedupe, past-confirmed / future-proposed (Bug 1), unpriced-never-$0, suggestions, pending deletions. ---
  run(`
    db.shifts = [{ id: 'shift-old-1', date: '2026-11-03', facility: 'Holzer', type: '8-hour day', pay: '2125', note: '', source: 'apple-import', status: 'proposed', incomplete: false, updatedAt: null }];
    db.facilitySuggestions = [];
    liveSyncState.pending = [];
    const batch = { providerChanges: [
      { action: 'create', shift: { id: 's0', date: '2026-11-04', facility: 'Holzer', type: '8-hour day', pay: '2125', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
      { action: 'create', shift: { id: 's1', date: '2026-11-07', facility: 'Holzer', type: '8-hour day', pay: '2125', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
      { action: 'create', shift: { id: 's2', date: '2026-11-08', facility: 'Holzer', type: 'Second call', pay: '', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
    ], pendingDeletions: [
      { provider: 'apple', shiftId: 'shift-old-1', date: '2026-11-03', facility: 'Holzer', type: '8-hour day', localMissing: false },
    ], imported: {
      sourceCalendarName: 'Caleb Work Schedule', created: 3, updated: 0, skipped: 1, duplicates: 0, seen: 4, parsed: 4,
      skippedSuggested: 1, unpriced: 1,
      suggestions: [{ name: 'CAMC', address: '', count: 1, firstDate: '2026-11-09', lastDate: '2026-11-09', sampleTitles: ['CAMC 8'] }],
      newFacilities: ['CAMC'],
    }};
    globalThis.__a1 = liveSyncApplyChanges('apple', batch);
    globalThis.__a2 = liveSyncApplyChanges('apple', batch);
    globalThis.__shifts = db.shifts;
    globalThis.__pending = liveSyncState.pending;
    globalThis.__sugg = db.facilitySuggestions;
  `);
  t('imported shifts created once (dedupe: second identical apply adds nothing)',
    sandbox.__a1.created === 3 && sandbox.__a2.created === 0 && sandbox.__shifts.length === 4);
  t('imported shifts arrive confirmed, past and future (status model Nov 6, 2026)',
    run(`db.shifts.filter(x => ['s0','s1','s2'].includes(x.id)).every(x => x.status === 'confirmed')`) &&
    run(`db.shifts.find(x => x.id === 's0').status`) === 'confirmed' &&
    run(`db.shifts.find(x => x.id === 's1').status`) === 'confirmed');
  t('priced shift carries pay; unpriced shift stays incomplete with blank pay — never $0',
    sandbox.__shifts.find((x) => x.id === 's1').pay === '2125' &&
    sandbox.__shifts.find((x) => x.id === 's2').pay === '' &&
    sandbox.__shifts.find((x) => x.id === 's2').incomplete === true);
  t('pending deletion is recorded for confirmation — the shift is NOT deleted silently',
    sandbox.__pending.length === 1 && sandbox.__pending[0].shiftId === 'shift-old-1' &&
    sandbox.__shifts.some((x) => x.id === 'shift-old-1'));
  t('unknown hospital is suggested, not imported and not auto-created as a facility',
    sandbox.__sugg.length === 1 && sandbox.__sugg[0].name === 'CAMC' &&
    !dbHasFacility('CAMC') && !sandbox.__shifts.some((x) => x.facility === 'CAMC'));
  function dbHasFacility(name) { return run(`db.facilities.some(f => f.name === '${name}')`); }

  // --- 7. Update applies pay and clears incomplete (newest-wins, client half). ---
  run(`
    globalThis.__a3 = liveSyncApplyChanges('apple', { providerChanges: [
      { action: 'update', shift: { id: 's2', date: '2026-11-08', facility: 'Holzer', type: 'Second call', pay: '3000', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: '2026-11-05T11:00:00Z' } },
    ], pendingDeletions: [], imported: null });
    globalThis.__s2 = db.shifts.find(x => x.id === 's2');
  `);
  t('provider update prices the shift and clears incomplete',
    sandbox.__a3.updated === 1 && sandbox.__s2.pay === '3000' && sandbox.__s2.incomplete === false);

  // --- 8. Tombstone + one-shot repair go out with the sync (never-reimport-deleted, client half). ---
  fetchCalls.length = 0;
  alerts.length = 0;
  run(`
    liveSyncState.tombstones = [];
    liveSyncRecordTombstone('shift-del-1');
    globalThis.__tombs = liveSyncState.tombstones;
    liveSyncState.repairImport = true;
  `);
  t('deleting a shift records a tombstone for every connected provider',
    sandbox.__tombs.length === 1 && sandbox.__tombs[0].provider === 'apple' && sandbox.__tombs[0].shiftId === 'shift-del-1');
  await run(`liveSyncRepairImport()`);
  const syncCall = fetchCalls.find((c) => c.body && c.body.action === 'sync');
  t('sync sends the tombstone and the one-shot repair flag together',
    !!syncCall && syncCall.body.body.tombstones.some((x) => x.shiftId === 'shift-del-1') &&
    syncCall.body.body.repairStaleImport === true);
  t('sync sends the facilities list so the server can re-scan past events',
    !!syncCall && syncCall.body.body.facilities.some((f) => f.name === 'Holzer'));
  t('after the sync, the repair flag is consumed (a normal sync never re-imports a deleted shift)',
    run(`liveSyncState.repairImport`) === false);
  t('stubbed sync applied the canned import: sourced-confirmed status rule holds, pending deletion flagged',
    run(`db.shifts.some(x => x.id === 'shift-new-1' && x.status === 'confirmed')`) &&
    run(`liveSyncState.pending.some(p => p.shiftId === 'shift-old-1')`));

  // --- 9. Two-way push: confirmed shift on the calendar, edit updates,
  // deletion waits, never writes to the work calendar, labels correct. ---
  fetchCalls.length = 0;
  alerts.length = 0;
  run(`
    db.shifts = [
      { id: 'shift-user-1', date: '2026-11-12', facility: 'Holzer', type: '8-hour day', pay: '2125', note: '', source: 'user-entered', status: 'confirmed', incomplete: false, updatedAt: '2026-11-05T09:00:00Z' },
      { id: 'shift-old-1', date: '2026-11-03', facility: 'Holzer', type: '8-hour day', pay: '2125', note: '', source: 'apple-import', status: 'proposed', incomplete: false, updatedAt: null },
    ];
    db.facilitySuggestions = [];
    liveSyncState.pending = [];
    liveSyncState.tombstones = [];
    liveSyncState.shiftSync = {};
    globalThis.__push = liveSyncApplyChanges('apple', {
      providerChanges: [],
      pendingDeletions: [{ provider: 'apple', shiftId: 'shift-old-1', date: '2026-11-03', facility: 'Holzer', type: '8-hour day', localMissing: false }],
      imported: null,
      shiftSync: [
        { shiftId: 'shift-user-1', state: 'synced' },
        { shiftId: 'shift-old-1', state: 'pending-deletion' },
      ],
    });
    selected = '2026-11-12'; dayViewOpen = true;
    globalThis.__saved = dayViewHTML();
    selected = '2026-11-03';
    globalThis.__saved = globalThis.__saved + dayViewHTML();
  `);
  t('confirmed user-entered shift is stored as synced from the sync response',
    run(`liveSyncShiftState('shift-user-1', 'apple')`) === 'synced');
  t('Saved shifts shows "On your calendar" for the synced shift',
    sandbox.__saved.includes('On your calendar'));
  t('Saved shifts shows "Pending deletion" for the flagged shift — and the shift is still there',
    sandbox.__saved.includes('Pending deletion') && run(`db.shifts.some(x => x.id === 'shift-old-1')`));

  // A fresh shift added locally reads "Not yet synced" until a sync
  // pairs it; marking it dirty after an edit keeps it that way.
  run(`
    db.shifts.push({ id: 'shift-user-2', date: '2026-11-13', facility: 'Holzer', type: '8-hour day', pay: '2125', note: '', source: 'user-entered', status: 'confirmed', incomplete: false, updatedAt: '2026-11-05T09:30:00Z' });
    liveSyncMarkShiftNotSynced('shift-user-2');
    selected = '2026-11-13'; dayViewOpen = true;
    globalThis.__saved2 = dayViewHTML();
    globalThis.__label2 = liveSyncShiftSyncLabel(db.shifts.find(x => x.id === 'shift-user-2'));
    globalThis.__label1 = liveSyncShiftSyncLabel(db.shifts.find(x => x.id === 'shift-user-1'));
  `);
  t('fresh/edited shift reads "Not yet synced" until a sync pairs it',
    sandbox.__label2.includes('Not yet synced') && sandbox.__saved2.includes('Not yet synced'));
  t('synced shift still reads "On your calendar" beside it',
    sandbox.__label1.includes('On your calendar'));

  // Saving a shift in the app stamps updatedAt (newest-wins needs it)
  // and marks it not-synced until its push syncs.
  run(`
    const fakeForm = { dataset: { kind: 'shifts' }, _entries: [['date', '2026-11-14'], ['facility', 'Holzer'], ['type', '8-hour day'], ['pay', '2125']] };
    submitEntry({ preventDefault() {}, currentTarget: fakeForm });
    globalThis.__savedShift = db.shifts[db.shifts.length - 1];
    globalThis.__savedLabel = liveSyncShiftSyncLabel(globalThis.__savedShift);
  `);
  t('saving a shift in the app stamps updatedAt, so the next sync can push the edit',
    !!sandbox.__savedShift && typeof sandbox.__savedShift.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(sandbox.__savedShift.updatedAt));
  t('a shift saved in the app reads "Not yet synced" until its push syncs',
    sandbox.__savedLabel.includes('Not yet synced'));

  // The sync sends the edited shift with its updatedAt — and nothing
  // in any sync request names the work calendar as a target.
  fetchCalls.length = 0;
  await run(`liveSyncNow('apple', true)`);
  const pushCall = fetchCalls.find((c) => c.body && c.body.action === 'sync');
  t('sync sends the edited shift with its updatedAt, so newest-wins can push the edit',
    !!pushCall && pushCall.body.body.localShifts.some((x) => x.id === 'shift-user-2' && x.updatedAt === '2026-11-05T09:30:00Z'));
  t('sync payload sends local shifts + tombstones + facilities, and no calendar URL field',
    !!pushCall && Array.isArray(pushCall.body.body.localShifts) && !('sourceCalendarUrl' in pushCall.body.body) && !('calendarUrl' in pushCall.body.body));
  t('no sync request ever carries the work-calendar URL (it is only ever an import choice, never a write target)',
    !fetchCalls.some((c) => JSON.stringify(c.body).includes('cal-work')));
  t('after the sync, the pushed shift still reads "On your calendar" (stored state survives a response that does not mention it)',
    run(`liveSyncShiftSyncLabel(db.shifts.find(x => x.id === 'shift-user-1'))`).includes('On your calendar'));

  // Deleting a shift in the app records a tombstone (never a silent
  // delete), drops its calendar state, and the next sync sends the
  // tombstone without re-creating the shift.
  fetchCalls.length = 0;
  run(`
    liveSyncRecordTombstone('shift-user-2');
    db.shifts = db.shifts.filter(x => x.id !== 'shift-user-2');
    globalThis.__stateAfterDelete = liveSyncState.shiftSync['shift-user-2'];
    globalThis.__tombs2 = liveSyncState.tombstones;
  `);
  t('deleting a shift records a tombstone and drops its stored calendar state',
    sandbox.__tombs2.some((x) => x.provider === 'apple' && x.shiftId === 'shift-user-2') && sandbox.__stateAfterDelete === undefined);
  await run(`liveSyncNow('apple', true)`);
  const delCall = fetchCalls.find((c) => c.body && c.body.action === 'sync');
  t('the next sync sends the tombstone — and the deleted shift is not re-created by the response',
    !!delCall && delCall.body.body.tombstones.some((x) => x.shiftId === 'shift-user-2') &&
    run(`!db.shifts.some(x => x.id === 'shift-user-2')`));

  // No pill at all when no provider is connected: there is no
  // calendar state to show.
  run(`
    liveSyncConnections = {};
    globalThis.__labelNone = liveSyncShiftSyncLabel(db.shifts.find(x => x.id === 'shift-user-1'));
    liveSyncConnections = { apple: { status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-05T12:00:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' } };
  `);
  t('no sync pill when no provider is connected (no calendar state to show)',
    sandbox.__labelNone === '');

  console.log(failures === 0 ? '\nAll calendar-sync-final checks passed.' : `\n${failures} check(s) FAILED.`);
})().catch((e) => { console.error('TEST ERROR', e); process.exitCode = 1; });
