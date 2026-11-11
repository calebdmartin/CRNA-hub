// CRNA Hub — v120: the source-calendar picker + full-pull-after-wipe
// round (Caleb live finding, Nov 11, 2026 ~9:43 AM).
//
// Caleb erased (Testing tools → ERASE), reconnected Apple Calendar,
// and got a green "Connected · Last sync 9:43 AM" with ZERO shifts
// imported and no calendar choice ever offered. Two seams, both
// proven against the real code paths:
//
//  Seam A (server state): the Apple connect upsert replaced only the
//  fields it listed — PostgREST merge-upsert PRESERVES the rest, so
//  a surviving row's sync token / source choice rode into the fresh
//  connect; fetch then ran incrementally against a wiped local set
//  (empty delta, imports nothing, reports success), and Google/
//  Outlook connects had the same hole (delta_link / sync_token).
//  The client half: the picker lived inside a COLLAPSED card behind
//  a <select>, and when no source was set the server returned
//  imported:null and the client rendered NO import line at all —
//  a silent green success.
//  Seam B (no source at all): Google/Outlook had NO import source —
//  their fetch read only the dedicated CRNA Hub calendar. There was
//  nothing to pick and nothing to import from.
//
// Pins below:
//  - server: reconnect upserts reset tokens+source (all 3 providers,
//    via the shared upsertFreshConnection cascade); a sync with zero
//    local shifts fetches through effectiveConnForSync (tokens
//    stripped) and passes accountEmpty into the import decision;
//    set-source-calendars verifies refs, rejects the dedicated
//    calendar, and REQUIRES a tick for "chosen"; sources generalize
//    (connectionSources) with perSource tallies; /api/fn allowlists
//    the two new actions; migration 014 carries the columns + the
//    push_sent_log delete policy.
//  - client (Caleb's exact scenario): post-wipe reconnect state
//    (connected, no source) renders the card EXPANDED with "One more
//    step", the picker unticked (neutral), the CRNA Hub calendar
//    disabled and labelled "app writes here — not a source"; saving
//    with no tick is refused; ticking "Caleb Work Schedule" saves via
//    set-source-calendars and the sync result states "Synced 'Caleb
//    Work Schedule': saw N events, imported M shifts"; the card then
//    rests collapsed showing "Pulling from: Caleb Work Schedule" +
//    Change, and Change reopens the same picker pre-ticked; a
//    zero-event calendar reports the loud zero; a sync with no pick
//    says so; Google gets the same picker and an explicit
//    "app calendar only" answer sticks.
// Run: node test-v120-sync-source.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
}

// ---------------- server-source pins ----------------
const syncSrc = fs.readFileSync(R + 'supabase/functions/sync-calendar/index.ts', 'utf8');
const sharedSrc = fs.readFileSync(R + 'supabase/functions/_shared/calendar.ts', 'utf8');
const gAuthSrc = fs.readFileSync(R + 'supabase/functions/google-auth/index.ts', 'utf8');
const oAuthSrc = fs.readFileSync(R + 'supabase/functions/outlook-auth/index.ts', 'utf8');
const fnSrc = fs.readFileSync(R + 'api/fn.js', 'utf8');
const mig014 = fs.readFileSync(R + 'supabase/supabase-schema-014.sql', 'utf8');

t('server: shared fresh-connect upsert clears tokens + source (cascade)',
  sharedSrc.includes('export async function upsertFreshConnection') &&
  sharedSrc.includes('sync_token: null') && sharedSrc.includes('delta_link: null') &&
  sharedSrc.includes('source_calendars: null') && sharedSrc.includes('source_choice: null'));
t('server: Apple connect uses the fresh-connect upsert', syncSrc.includes('await upsertFreshConnection({'));
t('server: Google connect uses the fresh-connect upsert', gAuthSrc.includes('await upsertFreshConnection(conn)'));
t('server: Outlook connect uses the fresh-connect upsert', oAuthSrc.includes('await upsertFreshConnection(conn)'));
t('server: empty local set fetches through the token-stripped connection',
  syncSrc.includes('effectiveConnForSync(conn, localShifts.length)') &&
  syncSrc.includes('fetchGoogle(fetchConn)') && syncSrc.includes('fetchOutlook(fetchConn)') &&
  syncSrc.includes('fetchApple(fetchConn)'));
t('server: import decision receives accountEmpty', syncSrc.includes('accountEmpty,'));
t('server: stale-row decision repairs on an empty account, deletions still win',
  sharedSrc.includes('opts.accountEmpty') && sharedSrc.includes('if (opts.deletedLocally === true || opts.tombstoned) return "skip-deleted";'));
t('server: sources generalize to every provider (connectionSources, legacy + multi)',
  syncSrc.includes('function connectionSources(conn: Conn)') &&
  syncSrc.includes('conn.source_calendars') && syncSrc.includes('conn.source_calendar_url'));
t('server: dedicated calendar filtered out of sources',
  syncSrc.includes('norm(s.ref) !== norm(dedicated)'));
t('server: set-source-calendars requires a tick for "chosen"',
  syncSrc.includes('handleSetSourceCalendars') && syncSrc.includes('source_calendar_required'));
t('server: set-source-calendars rejects the dedicated calendar + unknown refs',
  syncSrc.includes('source_is_dedicated_calendar') && syncSrc.includes('source_calendar_not_found'));
t('server: per-source tallies ride the sync response', syncSrc.includes('perSource: []') && syncSrc.includes('imported.perSource.push'));
t('server: generic calendar list for the picker (all providers)',
  syncSrc.includes('listProviderCalendars') && syncSrc.includes('handleCalendars'));
t('server: Google/Outlook source fetches exist (full-scan list/calendarView)',
  syncSrc.includes('fetchGoogleSourceEvents') && syncSrc.includes('fetchOutlookSourceEvents'));
t('proxy: /api/fn allowlists calendars + set-source-calendars',
  fnSrc.includes("'calendars'") && fnSrc.includes("'set-source-calendars'"));
t('migration 014: source columns + push_sent_log delete policy',
  mig014.includes('source_calendars jsonb') && mig014.includes('source_choice text') &&
  mig014.includes('push_sent_log') && mig014.includes('for delete'));

// ---------------- client world ----------------
const WORK = 'https://p42-caldav.icloud.com/123456/calendars/work/';
const HUB = 'https://p42-caldav.icloud.com/123456/calendars/hub/';
const PLAIN = 'https://p42-caldav.icloud.com/123456/calendars/plain/';
const APPLE_CALS = [
  { url: WORK, name: 'Caleb Work Schedule', isDedicated: false },
  { url: HUB, name: 'CRNA Hub', isDedicated: true },
  { url: PLAIN, name: 'Calendar', isDedicated: false },
];
const GOOGLE_CALS = [
  { ref: 'g-work', name: 'Caleb Work Schedule', isDedicated: false },
  { ref: 'g-hub', name: 'CRNA Hub', isDedicated: true },
];
function makeWorld() {
  const store = new Map();
  const state = {
    connections: [],
    calls: [],
    syncResponse: { providerChanges: [], pendingDeletions: [], imported: null, shiftSync: [] },
    checked: [], // refs the DOM stub reports as ticked
  };
  function el(id) {
    return {
      id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [],
      dataset: {}, style: {}, _listeners: {},
      addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
      append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [],
    };
  }
  const elements = {};
  const alerts = [];
  class FakeFormData { constructor(f) { this._e = (f && f._entries) || []; } *[Symbol.iterator]() { yield* this._e; } }
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
      getElementById: (id) => elements[id] || (elements[id] = el(id)),
      querySelectorAll: (sel) => {
        const m = /data-provider="(\w+)"/.exec(sel || '');
        if ((sel || '').includes(':checked') && m) {
          return state.checked.filter((c) => c.provider === m[1]).map((c) => ({ value: c.ref }));
        }
        return [];
      },
      createElement: () => el(), body: { append() {} },
    },
    window: null, navigator: {},
    location: { protocol: 'https:', search: '', pathname: '/' },
    alert: (m) => { alerts.push(String(m)); },
    confirm: () => true,
    fetch: async (url, opts) => {
      let body = null;
      try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
      let data = { ok: true };
      if (body && body.function === 'sync-calendar') {
        const action = body.action;
        state.calls.push({ action, body: body.body || null });
        if (action === 'status') data = { connections: state.connections };
        else if (action === 'log') data = { log: [] };
        else if (action === 'config') data = { google: true, outlook: true, apple: true, encryption: true };
        else if (action === 'apple-calendars') data = { calendars: APPLE_CALS };
        else if (action === 'calendars') data = { calendars: body.body && body.body.provider === 'google' ? GOOGLE_CALS : [] };
        else if (action === 'set-source-calendars') {
          const b = body.body;
          const cur = state.connections.find((c) => c.provider === b.provider) || {};
          Object.assign(cur, {
            sourceCalendars: b.choice === 'chosen' ? b.calendars : null,
            sourceChoice: b.choice,
            sourceCalendarUrl: b.calendars && b.calendars[0] ? b.calendars[0].ref : null,
            sourceCalendarName: b.calendars && b.calendars[0] ? b.calendars[0].name : null,
          });
          data = { ok: true, provider: b.provider };
        } else if (action === 'sync') data = state.syncResponse;
      }
      return { status: 200, ok: true, text: async () => JSON.stringify(data) };
    },
    history: { replaceState() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  return { run, alerts, state, store };
}
const drain = async () => { for (let i = 0; i < 16; i++) await new Promise((r) => setImmediate(r)); };
const J = (v) => JSON.stringify(v);

(async () => {
  // ---------- Caleb's exact scenario: post-wipe Apple reconnect ----------
  let w = makeWorld();
  w.state.connections = [{ provider: 'apple', status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-11T14:43:00Z', sourceCalendarUrl: null, sourceCalendarName: null, sourceCalendars: null, sourceChoice: null }];
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    liveSyncConfig = { state: 'ready', google: true, outlook: true, apple: true, encryption: true };`);
  await w.run(`liveSyncFetchStatus()`);
  await w.run(`liveSyncFetchAllCalendars()`);
  await drain();
  t('caleb: reconnect with no source reads as PENDING (the pick is owed)',
    w.run(`liveSyncSourcePending('apple')`) === true);
  const card = w.run(`liveSyncProviderCard('apple')`);
  t('caleb: card is EXPANDED while the pick is owed (no collapsed <details>)',
    !card.includes('<details'), card.slice(0, 120));
  t('caleb: card says "One more step" out loud', card.includes('One more step'));
  t('caleb: picker is offered — Caleb Work Schedule is right there',
    card.includes('Pick the calendar your shifts live in') && card.includes('Caleb Work Schedule'));
  t('caleb: NOTHING is pre-ticked (neutral — a tick is required)',
    card.includes('value="' + WORK + '"') && !card.includes('value="' + WORK + '" checked'));
  t('caleb: CRNA Hub calendar is labelled not-a-source and disabled',
    card.includes('the app writes here — not a source') && card.includes('type="checkbox" disabled'));
  t('caleb: panel rests OPEN while the pick is owed', w.run(`liveSyncPanelOpen()`) === true);

  // save with no tick -> refused, nothing posted
  w.state.calls = [];
  w.state.checked = [];
  await w.run(`liveSyncSourceSave('apple')`);
  await drain();
  t('picker: saving with no tick is refused with the plain instruction',
    w.alerts.some((a) => a.includes('Tick the calendar your shifts live in first')));
  t('picker: refused save posts nothing',
    w.state.calls.filter((c) => c.action === 'set-source-calendars').length === 0);

  // tick Caleb Work Schedule -> save -> sync states the plain result
  w.state.syncResponse = {
    providerChanges: [], pendingDeletions: [], shiftSync: [],
    imported: {
      sourceCalendarName: 'Caleb Work Schedule', created: 17, updated: 0, skipped: 40, duplicates: 0,
      seen: 231, parsed: 57, fetchMethod: 'REPORT', error: null, skippedNotShift: 40, skippedDeleted: 0,
      skippedLegacy: 0, repaired: 0, unpriced: 0, suggestions: [], skippedSuggested: 0, newFacilities: [],
      perSource: [{ name: 'Caleb Work Schedule', seen: 231, parsed: 57, created: 17, updated: 0, duplicates: 0, error: null }],
    },
  };
  w.state.checked = [{ provider: 'apple', ref: WORK }];
  w.alerts.length = 0;
  await w.run(`liveSyncSourceSave('apple')`);
  await drain();
  const setCalls = w.state.calls.filter((c) => c.action === 'set-source-calendars');
  t('picker: the tick saves through set-source-calendars with the picked ref + name',
    setCalls.length === 1 && setCalls[0].body.choice === 'chosen' &&
    setCalls[0].body.calendars.length === 1 && setCalls[0].body.calendars[0].ref === WORK &&
    setCalls[0].body.calendars[0].name === 'Caleb Work Schedule', J(setCalls));
  t('sync result states it plainly: Synced "Caleb Work Schedule": saw 231 events, imported 17 shifts',
    w.alerts.some((a) => a.includes('Synced “Caleb Work Schedule”: saw 231 events, imported 17 shift(s)')), J(w.alerts));
  t('caleb: after the pick the card rests collapsed, summary shows Pulling from',
    w.run(`liveSyncSourcePending('apple')`) === false &&
    w.run(`liveSyncProviderCard('apple')`).includes('<details') &&
    w.run(`liveSyncProviderCard('apple')`).includes('Pulling from: Caleb Work Schedule'));
  t('caleb: card body offers Change', w.run(`liveSyncProviderCard('apple')`).includes('data-action="live-source-change"'));

  // Change reopens the same picker, current pick pre-ticked
  w.run(`liveSyncAction('live-source-change', 'apple')`);
  await drain();
  const editCard = w.run(`liveSyncProviderCard('apple')`);
  t('change: same picker reopens, current calendar pre-ticked',
    editCard.includes('Pick the calendar your shifts live in') &&
    editCard.includes('value="' + WORK + '" checked') &&
    editCard.includes('data-action="live-source-cancel"'));

  // ---------- loud zero ----------
  w.state.connections = [{ provider: 'apple', status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-11T14:43:00Z', sourceCalendarUrl: PLAIN, sourceCalendarName: 'Calendar', sourceCalendars: [{ ref: PLAIN, name: 'Calendar' }], sourceChoice: 'chosen' }];
  w.run(`liveSyncConnections = {};`);
  await w.run(`liveSyncFetchStatus()`);
  await drain();
  w.state.syncResponse = {
    providerChanges: [], pendingDeletions: [], shiftSync: [],
    imported: {
      sourceCalendarName: 'Calendar', created: 0, updated: 0, skipped: 0, duplicates: 0, seen: 0, parsed: 0,
      fetchMethod: 'REPORT', error: null, skippedNotShift: 0, skippedDeleted: 0, skippedLegacy: 0,
      repaired: 0, unpriced: 0, suggestions: [], skippedSuggested: 0, newFacilities: [],
      perSource: [{ name: 'Calendar', seen: 0, parsed: 0, created: 0, updated: 0, duplicates: 0, error: null }],
    },
  };
  w.alerts.length = 0;
  await w.run(`liveSyncNow('apple', false)`);
  await drain();
  t('zero: a 0-event pull is LOUD, with the way out (tap Change)',
    w.alerts.some((a) => a.includes('Saw 0 events in “Calendar”') && a.includes('tap Change')), J(w.alerts));
  t('zero: the card last-import line repeats the zero plainly',
    w.run(`liveSyncLastImportHTML('apple')`).includes('saw 0 events in “Calendar”'));

  // ---------- no pick yet: the sync says so ----------
  w = makeWorld();
  w.state.connections = [{ provider: 'apple', status: 'connected', autoDelete: false, lastSyncedAt: null, sourceCalendarUrl: null, sourceCalendarName: null, sourceCalendars: null, sourceChoice: null }];
  w.state.syncResponse = { providerChanges: [], pendingDeletions: [], imported: null, shiftSync: [] };
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    liveSyncConfig = { state: 'ready', google: true, outlook: true, apple: true, encryption: true };`);
  await w.run(`liveSyncFetchStatus()`);
  await drain();
  w.alerts.length = 0;
  await w.run(`liveSyncNow('apple', false)`);
  await drain();
  t('no pick: a sync with nothing picked says so instead of a silent green',
    w.alerts.some((a) => a.includes('No work calendar is picked yet')), J(w.alerts));

  // ---------- Google: same picker, explicit "app calendar only" ----------
  w = makeWorld();
  w.state.connections = [{ provider: 'google', status: 'connected', autoDelete: false, lastSyncedAt: null, sourceCalendarUrl: null, sourceCalendarName: null, sourceCalendars: null, sourceChoice: null }];
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    liveSyncConfig = { state: 'ready', google: true, outlook: true, apple: true, encryption: true };`);
  await w.run(`liveSyncFetchStatus()`);
  await w.run(`liveSyncFetchAllCalendars()`);
  await drain();
  const gCard = w.run(`liveSyncProviderCard('google')`);
  t('google: the picker exists for Google too (was: no source at all)',
    w.run(`liveSyncSourcePending('google')`) === true &&
    gCard.includes('Pick the calendar your shifts live in') && gCard.includes('value="g-work"') &&
    gCard.includes('the app writes here — not a source'));
  w.state.calls = [];
  await w.run(`liveSyncSourceNone('google')`);
  await drain();
  const noneCalls = w.state.calls.filter((c) => c.action === 'set-source-calendars');
  t('google: "app calendar only" posts choice none',
    noneCalls.length === 1 && noneCalls[0].body.choice === 'none' && noneCalls[0].body.provider === 'google');
  t('google: after the explicit none, the card rests with Pulling from: App calendar only',
    w.run(`liveSyncSourcePending('google')`) === false &&
    w.run(`liveSyncProviderCard('google')`).includes('Pulling from: App calendar only'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
