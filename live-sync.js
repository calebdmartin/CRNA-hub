'use strict';
// CRNA Hub — live calendar sync client (Google / Outlook / Apple).
//
// FINAL NATIVE MODEL (agreed with Caleb, Nov 4–5, 2026) — what this
// panel describes and what the finished iOS app must do:
//   1. The user connects ONCE per provider and picks which EXISTING
//      calendar is their work calendar (e.g. "Caleb Work Schedule").
//      The app pulls shifts from that calendar ONLY — no other
//      calendar is ever read.
//   2. The app creates its OWN calendar behind the scenes, for the
//      shifts the user adds in CRNA Hub. The user never creates a
//      calendar, never labels anything "CRNA Hub", and never sees the
//      app-owned calendar as something to manage. The work calendar
//      is NEVER written to — with exactly one user-confirmed
//      exception (Nov 7, 2026): when deleting an imported shift, the
//      user may tick "Also remove it from my <calendar> calendar" in
//      the delete confirmation, and only then does the app delete
//      that one paired source event (liveSyncDeleteSourceEvent).
//      Sync itself never writes to, edits, or deletes from the work
//      calendar.
//   3. Apple, native: EventKit (EKEventStore) on the device —
//      requestFullAccessToEvents, an EKCalendarChooser for the work
//      calendar, a private EKCalendar for the app's own shifts.
//      No app-specific password, no CalDAV, no server-held Apple
//      credential. Google/Outlook, native: the same one-connection
//      + pick-your-work-calendar flow via their OAuth consent
//      screens; tokens stay in the device keychain / server session,
//      never in the app's own storage.
//   4. Sync rules that never change, preview or final (see the
//      server engine in supabase/functions/sync-calendar/index.ts
//      and the shared parser in supabase/functions/_shared/calendar.ts):
//      facilities drive recognition and pricing; dedupe via
//      calendar_import_map; a shift the user deleted is never
//      re-imported; imported shifts arrive as "confirmed" when dated
//      before today (they already happened) and "proposed" when dated
//      today or later (Bug 1, Nov 6, 2026); a shift
//      with no pay rule stays unpriced (pay blank, incomplete) —
//      never $0; an unknown hospital is held and suggested once
//      ("We noticed shifts at <Hospital> — add it as a facility?"),
//      never imported and never auto-created; newest edit wins;
//      deletions wait in Pending deletions unless auto-delete was
//      explicitly turned on (default off).
//
// PREVIEW STAND-IN (this web preview only): a web page cannot use
// EventKit, so the Apple path below still connects through CalDAV
// with a one-time app-specific password, and the app-owned calendar
// is created server-side through CalDAV instead of on-device. That
// path is fenced off in the UI as a clearly-labelled "Preview
// stand-in" box (LIVE_SYNC_STANDIN_LABEL) and is NEVER presented as
// the designed flow. Everything else in this file — the work-calendar
// picker, the facilities-driven import, the suggestion flow, the
// pending-deletion rules — is the final flow, not a stand-in.
//
// This file NEVER holds, stores, or logs a token, client secret, or
// app-specific password:
//   - Google/Outlook: the browser is redirected to the provider's consent
//     screen; tokens are exchanged and stored by the Edge Function.
//   - Apple (preview stand-in only): the app-specific password is sent
//     once, over HTTPS, to the Edge Function's connect-apple action,
//     which validates it and stores only its AES-GCM ciphertext. The
//     password field is cleared immediately after sending, and the value
//     is never written to localStorage, a backup, or the repo.
// What IS kept on this device (localStorage key 'crna-hub-live-sync'):
//   pending deletions awaiting the user's decision, and tombstones for
//   locally deleted shifts (shift id + provider only — no credentials).
// Sync runs when the app is open: on load for connected providers, on
// "Sync now", and shortly after a shift is added, edited, or deleted.
// It cannot run while the app is closed, because shifts live on this
// device, not in a server-side shifts table (see the README).
// Per-shift calendar state: every sync response carries `shiftSync`
// (one { shiftId, state } per shift, derived server-side from
// calendar_sync_map — see shiftSyncStateFor in
// supabase/functions/_shared/calendar.ts). The client stores it per
// shift per provider in liveSyncState.shiftSync and renders it on
// Dashboard → Saved shifts as "On your calendar" / "Not yet synced" /
// "Pending deletion" (liveSyncShiftSyncLabel). A shift added or edited
// in the app is marked "not-synced" until the next sync response
// pairs it; a shift the user deletes loses its stored state with its
// tombstone. No label is shown when no provider is connected — there
// is no calendar state to show.
// Conflict rule: newest edit wins (updatedAt timestamps, both sides);
// deletions are never silent — a provider-side deletion waits in
// "Pending deletions" until the user confirms it, unless auto-delete was
// explicitly turned on for that provider (default off).
//
// The full native design — what the native layer must do, what the
// server still owns, and what moves on-device — is documented in the
// README section "Final native calendar sync (EventKit) — design".


let liveSyncConfig = { state: 'loading', google: false, outlook: false, apple: false, encryption: false };
let liveSyncConnections = {}; // provider -> {status, autoDelete, lastSyncedAt}
let liveSyncLog = [];
let liveSyncShowOthers = false; // unchosen providers' connect cards revealed via "Use a different calendar service"
let liveSyncError = '';
let liveSyncBusy = '';
// Pending Apple pick-a-work-calendar flow (preview stand-in only):
// iCloud refused to create the app-owned calendar through CalDAV, so
// the user chooses one of their existing calendars instead. In the
// finished native app this picker is the PRIMARY flow — it appears
// right after the user grants calendar access, with no password step
// and no calendar-creation step at all — so the pick itself is final;
// only the password that precedes it here is the stand-in.
// Holds the Apple ID + app-specific password only until the pick is made
// or cancelled; never persisted, never stored on this device.
let liveSyncApplePick = null; // { appleId, password, calendars: [{url, name}] }
// Apple work-calendar picker: the user's iCloud calendars, listed
// server-side (never the password). Empty until fetched for a connected
// Apple account; the app-owned calendar is flagged on each entry
// (isDedicated) and excluded from the picker — it is the calendar the
// app keeps behind the scenes, never a calendar the user picks.
let liveSyncAppleCalendars = [];
// Source picker state (v120), every provider: the account's calendars
// in the picker's unified shape ({ ref, name, isDedicated } — ref is
// the CalDAV URL for Apple, the calendar id for Google/Outlook), and
// which providers are mid-"Change" (picker open with current picks
// pre-ticked).
let liveSyncCalendarsByProvider = {};
let liveSyncSourceEdit = {};
let liveSyncPushTimer = null;

function liveSyncStateLoad() {
  try {
    const v = JSON.parse(localStorage.getItem('crna-hub-live-sync') || 'null');
    // repairImport survives a reload: it is a one-shot request, not a
    // completed action, so losing it to a refresh (or to a sync that
    // timed out before the server answered) must not burn the repair.
    if (v && typeof v === 'object') return { pending: Array.isArray(v.pending) ? v.pending : [], tombstones: Array.isArray(v.tombstones) ? v.tombstones : [], lastImport: (v.lastImport && typeof v.lastImport === 'object') ? v.lastImport : null, repairImport: v.repairImport === true, shiftSync: (v.shiftSync && typeof v.shiftSync === 'object') ? v.shiftSync : {}, sourceLocal: (v.sourceLocal && typeof v.sourceLocal === 'object') ? v.sourceLocal : {} };
  } catch (e) {}
  return { pending: [], tombstones: [], lastImport: null, repairImport: false, shiftSync: {}, sourceLocal: {} };
}
let liveSyncState = liveSyncStateLoad();
function liveSyncStateSave() {
  try { localStorage.setItem('crna-hub-live-sync', JSON.stringify(liveSyncState)); } catch (e) {}
}
function liveSyncFn(name) {
  const base = (typeof SUPABASE_CFG !== 'undefined' && SUPABASE_CFG.url) || 'https://xgoghgihfhtnyevgapyp.supabase.com';
  return base.replace(/\/$/, '') + '/functions/v1/' + name;
}
function liveSyncProjectUrl() {
  return ((typeof SUPABASE_CFG !== 'undefined' && SUPABASE_CFG.url) || 'https://xgoghgihfhtnyevgapyp.supabase.com').replace(/\/$/, '');
}
async function liveSyncHeaders() {
  if (typeof cloudEnsureToken === 'function') await cloudEnsureToken();
  const token = (typeof cloudSession !== 'undefined' && cloudSession) ? cloudSession.access_token : '';
  const anon = (typeof SUPABASE_CFG !== 'undefined') ? SUPABASE_CFG.anonKey : '';
  return { apikey: anon, 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
}
async function liveSyncProxyToken() {
  try {
    if (typeof cloudEnsureToken === 'function') await cloudEnsureToken();
  } catch (e) {}
  return (typeof cloudSession !== 'undefined' && cloudSession) ? cloudSession.access_token : '';
}
async function liveSyncProxyRequest(name, method, action, body) {
  // Same-origin proxy first (see api/fn.js): the browser only talks to
  // its own origin, and the Vercel function forwards to Supabase
  // server-side. Returns {r, data} when the proxy answered, or null on
  // a network failure — in which case the caller falls back to direct.
  const token = await liveSyncProxyToken();
  const payload = { function: name, method, action, body: body || null };
  if (token) payload.token = token;
  try {
    const pr = await fetch('/api/fn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (pr.status === 404 || pr.status === 501) return null;
    const text = await pr.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    return { r: pr, data };
  } catch (e) {
    return null;
  }
}
async function liveSyncFnRequest(name, method, action, body) {
  // Proxy first, direct only on a network failure or 404/501 (proxy
  // absent, e.g. an older preview) — never on an upstream error status,
  // so a sync/connect call is never submitted twice.
  const pr = await liveSyncProxyRequest(name, method, action, body);
  if (pr) return pr;
  const url = method === 'GET'
    ? liveSyncFn(name) + '?action=' + encodeURIComponent(action)
    : liveSyncFn(name);
  const r = await fetch(url, { method, headers: await liveSyncHeaders(), body: method === 'POST' ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { r, data };
}
async function liveSyncGet(name, action) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const { r, data } = await liveSyncFnRequest(name, 'GET', action, null);
    if (!r.ok) throw new Error((data && data.error) || ('request failed (' + r.status + ')'));
    return data;
  } finally { clearTimeout(timer); }
}
async function liveSyncPost(name, body) {
  const { r, data } = await liveSyncFnRequest(name, 'POST', body && body.action, body);
  if (!r.ok) {
    // Keep the response body on the error: some failures carry extra
    // data the caller needs (e.g. connect-apple returning the user's
    // existing calendars when iCloud refuses to create a new one).
    const e = new Error((data && data.error) || ('request failed (' + r.status + ')'));
    e.data = data;
    throw e;
  }
  return data;
}
function liveSyncConnectedProviders() {
  return Object.keys(liveSyncConnections).filter((p) => liveSyncConnections[p].status === 'connected');
}
// --- Import sources (v120): which calendars this provider pulls from.
// The server stores the pick (source_calendars / source_choice,
// migration 014; legacy single source mirrored from the first entry).
// Until the server can store it (migration not run), a pick the
// server rejected with migration_014_required is remembered on this
// device (liveSyncState.sourceLocal) so the required step is still
// done — the server copy wins whenever it exists.
function liveSyncSources(conn) {
  if (!conn) return [];
  if (Array.isArray(conn.sourceCalendars) && conn.sourceCalendars.length) {
    return conn.sourceCalendars.map((c) => ({ ref: String((c && (c.ref || c.url || c.id)) || ''), name: String((c && c.name) || '') })).filter((c) => c.ref);
  }
  if (conn.sourceCalendarUrl) return [{ ref: conn.sourceCalendarUrl, name: conn.sourceCalendarName || conn.sourceCalendarUrl }];
  return [];
}
function liveSyncLocalSourceChoice(provider) {
  const l = liveSyncState.sourceLocal && liveSyncState.sourceLocal[provider];
  return l && typeof l === 'object' ? l : null;
}
function liveSyncEffectiveSources(provider) {
  const conn = liveSyncConnections[provider];
  const fromServer = liveSyncSources(conn);
  if (fromServer.length) return fromServer;
  if (conn && conn.sourceChoice === 'none') return [];
  const local = liveSyncLocalSourceChoice(provider);
  if (local && local.choice === 'chosen' && Array.isArray(local.calendars)) return local.calendars;
  return [];
}
function liveSyncSourceChoiceMade(provider) {
  const conn = liveSyncConnections[provider];
  if (!conn) return false;
  if (liveSyncSources(conn).length) return true;
  if (conn.sourceChoice === 'chosen' || conn.sourceChoice === 'none') return true;
  return !!liveSyncLocalSourceChoice(provider);
}
// Connected but the required pick was never made: nothing is pulled
// in for this provider until the user ticks a calendar (or chooses
// "app calendar only"). A reconnect resets the server pick, so this
// is also the post-wipe state Caleb hit on Nov 11, 2026.
function liveSyncSourcePending(provider) {
  const conn = liveSyncConnections[provider];
  return !!(conn && conn.status === 'connected' && !liveSyncSourceChoiceMade(provider));
}
function liveSyncSourceSummary(provider) {
  const srcs = liveSyncEffectiveSources(provider);
  if (!srcs.length) return 'App calendar only';
  return srcs.map((s) => s.name || s.ref).join(' + ');
}
function liveSyncLabel(provider) {
  return provider === 'google' ? 'Google Calendar' : provider === 'outlook' ? 'Outlook' : 'Apple Calendar';
}
// Per-shift calendar state, from the server's shiftSync array in the
// last sync response (the pairing, not a guess — see the header note).
// Stored per shift per provider, so a shift synced to one provider
// and not another is not mislabelled by a single flag.
function liveSyncShiftState(shiftId, provider) {
  const per = liveSyncState.shiftSync && liveSyncState.shiftSync[shiftId];
  const rec = per && provider ? per[provider] : null;
  return rec && rec.state ? rec.state : null;
}
function liveSyncSetShiftState(provider, shiftId, state) {
  if (!shiftId || !provider || !state) return;
  liveSyncState.shiftSync = liveSyncState.shiftSync || {};
  const per = liveSyncState.shiftSync[shiftId] || {};
  per[provider] = { state, at: new Date().toISOString() };
  liveSyncState.shiftSync[shiftId] = per;
  liveSyncStateSave();
}
function liveSyncDropShiftState(shiftId) {
  if (liveSyncState.shiftSync && liveSyncState.shiftSync[shiftId]) {
    delete liveSyncState.shiftSync[shiftId];
    liveSyncStateSave();
  }
}
// Label for one shift on Dashboard → Saved shifts, or '' when it does
// not apply (no provider connected — there is no calendar state to
// show). Pending deletion wins over synced: the provider copy is gone
// and the user has not confirmed yet. Synced on any connected provider
// counts as on the calendar; otherwise a connected provider means the
// shift has not been pushed yet.
function liveSyncShiftSyncLabel(shift) {
  if (!shift || !shift.id) return '';
  const connected = liveSyncConnectedProviders();
  if (!connected.length) return '';
  if (liveSyncState.pending.some((p) => p.shiftId === shift.id)) return ' · <span class="pill warn">Pending deletion</span>';
  for (const p of connected) {
    if (liveSyncShiftState(shift.id, p) === 'synced') return ' · <span class="pill">On your calendar</span>';
  }
  return ' · <span class="pill warn">Not yet synced</span>';
}
// Called when a shift is added or edited in the app, before the
// delayed push runs: the stored state is stale until the next sync
// response pairs the edited shift, so it reads "not-synced" meanwhile
// instead of claiming an outdated copy is on the calendar.
function liveSyncMarkShiftNotSynced(shiftId) {
  liveSyncConnectedProviders().forEach((p) => liveSyncSetShiftState(p, shiftId, 'not-synced'));
}
function liveSyncWhen(iso) {
  if (!iso) return 'never';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
}

async function liveSyncFetchConfig() {
  try {
    const { r, data } = await liveSyncFnRequest('sync-calendar', 'GET', 'config', null);
    if (!r.ok) throw new Error('config unavailable');
    liveSyncConfig = { state: 'ready', google: !!data.google, outlook: !!data.outlook, apple: !!data.apple, encryption: !!data.encryption };
  } catch (e) {
    liveSyncConfig = { state: 'unreachable', google: false, outlook: false, apple: false, encryption: false };
  }
}
async function liveSyncFetchStatus() {
  try {
    const data = await liveSyncGet('sync-calendar', 'status');
    const map = {};
    (data.connections || []).forEach((c) => { map[c.provider] = c; });
    liveSyncConnections = map;
    // v118: mirror sync health into the app's push "watch" summary so
    // the watchdog can notify (once per episode) when a connection
    // needs reconnecting. app.js owns the writer; absent = no-op.
    if (typeof window !== 'undefined' && typeof window.__crnaWatchSyncHealth === 'function') { try { window.__crnaWatchSyncHealth(); } catch (e) {} }
  } catch (e) { liveSyncConnections = {}; }
}
async function liveSyncFetchLog() {
  try {
    const data = await liveSyncGet('sync-calendar', 'log');
    liveSyncLog = Array.isArray(data.log) ? data.log : [];
  } catch (e) { liveSyncLog = []; }
}
async function liveSyncFetchAppleCalendars() {
  // Only for a connected Apple account; anything else leaves the list
  // empty and the picker hidden. A failure here is not a sync failure —
  // the picker just shows "could not load calendars" with a retry.
  if (!liveSyncConnections.apple || liveSyncConnections.apple.status !== 'connected') { liveSyncAppleCalendars = []; return; }
  try {
    const data = await liveSyncGet('sync-calendar', 'apple-calendars');
    liveSyncAppleCalendars = Array.isArray(data.calendars) ? data.calendars : [];
  } catch (e) { liveSyncAppleCalendars = []; }
  liveSyncCalendarsByProvider.apple = liveSyncAppleCalendars.map((c) => ({ ref: c.url, name: c.name || 'Unnamed calendar', isDedicated: !!c.isDedicated }));
}
async function liveSyncFetchCalendars(provider) {
  if (provider === 'apple') { await liveSyncFetchAppleCalendars(); return; }
  const conn = liveSyncConnections[provider];
  if (!conn || conn.status !== 'connected') { liveSyncCalendarsByProvider[provider] = []; return; }
  try {
    const data = await liveSyncPost('sync-calendar', { action: 'calendars', provider });
    liveSyncCalendarsByProvider[provider] = Array.isArray(data.calendars) ? data.calendars : [];
  } catch (e) { liveSyncCalendarsByProvider[provider] = liveSyncCalendarsByProvider[provider] || []; }
}
async function liveSyncFetchAllCalendars() {
  for (const p of ['google', 'outlook', 'apple']) {
    if (liveSyncConnections[p] && liveSyncConnections[p].status === 'connected') await liveSyncFetchCalendars(p);
  }
}

function liveSyncFacilitiesPayload() {
  // The Facilities list is the source of truth for import recognition:
  // the server matches event titles/locations against these names and
  // aliases and prices shifts from these pay rules. Facilities live
  // on-device, like shifts — the server stores none of this, it only
  // uses the list for this sync. Sending it every sync is what makes a
  // facility added after an import re-scan past events on the next sync.
  return (db.facilities || []).map((f) => ({
    name: f.name || '',
    aliases: typeof facilityAliases === 'function' ? facilityAliases(f) : String(f.aliases || '').split(',').map((s) => s.trim()).filter(Boolean),
    rate8: num(f.rate8) || null,
    rate10: num(f.rate10) || null,
    rate12: num(f.rate12) || null,
    rate24: num(f.rate24) || null,
    rateSecond: num(f.rateSecond) || null,
    weekendRateSecond: num(f.weekendRateSecond) || null,
    hourlyCall1st: num(f.hourlyCall1st) || null,
    weekendRate24: num(f.weekendRate24) || null,
    hourlyRate: num(f.hourlyRate) || null,
    paidHours8: num(f.paidHours8) || null,
    callBonus: num(f.callBonus) || null,
    weekendDays: Array.isArray(f.weekendDays) ? f.weekendDays.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : null,
  }));
}

function liveSyncFacilityKnown(name) {
  if (typeof facilityByNameOrAlias === 'function') return !!facilityByNameOrAlias(name);
  return (db.facilities || []).some((g) => String(g.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());
}

// Import status (Nov 6, 2026 status model — supersedes the Bug 1
// date rule): a shift arriving from a calendar sync is on a real
// schedule, so it arrives 'confirmed' whatever its date; a missing/
// invalid date stays 'proposed'. The server stamps the same rule into
// the shift it sends (see importStatusForDate in
// supabase/functions/_shared/calendar.ts). A stored status is never
// rewritten by an update: only creates are stamped.
function liveSyncImportStatusForDate(date) {
  const d = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'proposed';
  return 'confirmed';
}

function liveSyncApplyChanges(provider, data) {
  const changes = data.providerChanges || [];
  let created = 0, updated = 0, deleted = 0;
  const suggestions = [];
  const conflictsHeld = [];
  // Sourced-status rule (Nov 6, 2026 status model): a shift arriving
  // from a calendar sync is on a real schedule, so it arrives
  // confirmed whatever its date — liveSyncImportStatusForDate (above),
  // one implementation, not two.
  changes.forEach((ch) => {
    if (ch.action === 'create' && ch.shift) {
      const s = ch.shift;
      // Cross-source dedupe (Nov 6, 2026): the same shift may already
      // be here from QGenda, an upload, or a manual add — under the
      // shared identity rule (date + facility + type) it merges into
      // that ONE record (sources linked, richest data wins, status
      // never downgrades) instead of landing as a second copy. A
      // create carrying an id we already hold merges the same way.
      const srcIn = s.source || ('calendar-' + provider);
      const recIn = { id: s.id, date: s.date, facility: s.facility, type: s.type, pay: s.pay ? String(s.pay) : '', note: s.note || '', source: srcIn, sources: [srcIn], status: liveSyncImportStatusForDate(s.date), incomplete: !String(s.pay || '').trim(), updatedAt: s.updatedAt || null };
      const byIdIn = db.shifts.find((x) => x.id === s.id);
      const twinIn = !byIdIn && typeof findSameShift === 'function' ? findSameShift(recIn, db.shifts) : null;
      if (byIdIn || twinIn) {
        if (typeof mergeShiftInto === 'function') mergeShiftInto(byIdIn || twinIn, recIn);
        updated++;
        return;
      }
      // Double-booking guard (v115): a synced event landing on a
      // day that already holds a DIFFERENT shift is held out and
      // reported in the sync result — never silently stacked onto
      // the day. It stays on the source calendar; the user can add
      // it by hand (with the same warning and override) if real.
      const ccIn = typeof shiftConflictCandidate === 'function' ? shiftConflictCandidate(recIn, db.shifts) : null;
      if (ccIn) {
        conflictsHeld.push({ date: recIn.date, text: typeof conflictTextFor === 'function' ? conflictTextFor(recIn, ccIn) : recIn.date });
        // A cross-hospital clash held at this door still alerts,
        // persistently, on the Dashboard (v116) — the user is
        // booked at both hospitals that day even though the app
        // saved only one side.
        if (typeof recordHeldDayConflict === 'function') { try { recordHeldDayConflict(recIn, ccIn); } catch (e) {} }
        return;
      }
      // Imported shifts arrive with source 'apple-import' (and a note
      // naming the calendar they came from); shifts from the app-owned
      // calendar carry no source and default to 'calendar-<provider>'.
      // Status: sync imports arrive confirmed (Nov 6, 2026 status
      // model — see above); the server stamps the same rule into the
      // payload.
      db.shifts.push(recIn);
      // Not on the app-owned calendar yet: an imported shift reaches
      // it only on the next sync, once the browser sends it back as a
      // local shift. The shiftSync application below overrides this
      // when the server says otherwise (an event found in the
      // app-owned calendar is already synced).
      liveSyncSetShiftState(provider, s.id, 'not-synced');
      created++;
      // No auto-created facility here (ask-first, Nov 5, 2026): a shift
      // for a hospital with no saved record cannot arrive — the server
      // holds it and reports the hospital as a suggestion instead, and
      // the suggestion flow below is the only way the facility appears.
      // If an older server still sends such a shift, its facility is
      // NOT created silently; the user adds it from the Facilities tab.
    } else if (ch.action === 'update' && ch.shift) {
      const s = ch.shift, x = db.shifts.find((y) => y.id === s.id);
      if (!x) return;
      // Newest edit wins (Nov 7, 2026) — the rule stated at the top of
      // this file. When the user's local copy carries a STRICTLY NEWER
      // edit stamp than the incoming provider copy, the "update" is
      // the pre-edit version coming back around; applying it would
      // silently revert a manual edit (type, pay, date, facility).
      // Skip the field overwrite in that case — the source merge and
      // the updated count below still run. When either stamp is
      // missing, the provider copy applies as before.
      const localNewer = !!(x.updatedAt && s.updatedAt && String(x.updatedAt) > String(s.updatedAt));
      if (!localNewer) {
      x.date = s.date; x.facility = s.facility; x.type = s.type;
      if (s.pay) { x.pay = String(s.pay); x.incomplete = false; }
      x.note = s.note || '';
      x.source = s.source || x.source || ('calendar-' + provider); x.updatedAt = s.updatedAt || x.updatedAt;
      }
      if (typeof shiftSourcesList === 'function') { const sl = shiftSourcesList(x); const ns = s.source || ('calendar-' + provider); if (!sl.includes(ns)) { sl.push(ns); x.sources = sl; } }
      updated++;
    } else if (ch.action === 'delete' && ch.shiftId) {
      // Source-aware delete (cross-source dedupe, Nov 6, 2026): if
      // another source still shows this shift (QGenda, an upload, the
      // user's own entry), the record stays — only this provider's
      // source is unlinked, and its calendar state is dropped so the
      // surviving record can re-pair cleanly. The record is deleted
      // only when the removing source was its last one.
      const rec = db.shifts.find((x) => x.id === ch.shiftId);
      const tags = ['calendar-' + provider, provider + '-import'];
      const srcs = rec && typeof shiftSourcesList === 'function' ? shiftSourcesList(rec) : [];
      const others = srcs.filter((v) => !tags.includes(v));
      if (rec && others.length) {
        rec.sources = others;
        if (tags.includes(rec.source)) rec.source = others[0];
        liveSyncSetShiftState(provider, rec.id, 'not-synced');
        updated++;
      } else {
        db.shifts = db.shifts.filter((x) => x.id !== ch.shiftId);
        liveSyncDropShiftState(ch.shiftId);
        deleted++;
      }
    }
  });
  // Remember the last Apple import result so the panel can say
  // "imported N shifts from Caleb Work Schedule" after the alert closes.
  if (data.imported && typeof data.imported === 'object') {
    liveSyncState.lastImport = { provider, sourceName: data.imported.sourceCalendarName || '', created: data.imported.created || 0, updated: data.imported.updated || 0, skipped: data.imported.skipped || 0, duplicates: data.imported.duplicates || 0, seen: data.imported.seen || 0, parsed: data.imported.parsed || 0, fetchMethod: data.imported.fetchMethod || null, error: data.imported.error || null, skippedNotShift: data.imported.skippedNotShift || 0, skippedDeleted: data.imported.skippedDeleted || 0, skippedLegacy: data.imported.skippedLegacy || 0, repaired: data.imported.repaired || 0, unpriced: data.imported.unpriced || 0, skippedSuggested: data.imported.skippedSuggested || 0, perSource: Array.isArray(data.imported.perSource) ? data.imported.perSource : [], suggestions: Array.isArray(data.imported.suggestions) ? data.imported.suggestions : [], newFacilities: Array.isArray(data.imported.newFacilities) ? data.imported.newFacilities : [], at: new Date().toISOString() };
    // Facility suggestions (ask-first): merge the server's held
    // hospitals into db.facilitySuggestions — counted, dated, and
    // dismissable — without creating any facility. A dismissal survives
    // the merge (the next sync only refreshes its counts). Older
    // servers send only newFacilities names; those become minimal
    // suggestions (count unknown) rather than silent facilities.
    if (typeof mergeFacilitySuggestions === 'function') {
      const sug = Array.isArray(data.imported.suggestions) ? data.imported.suggestions : [];
      if (sug.length) {
        mergeFacilitySuggestions(provider, sug, data.imported.sourceCalendarName || '');
        sug.forEach((x) => { if (x && x.name) suggestions.push(x.name); });
      } else if (Array.isArray(data.imported.newFacilities) && data.imported.newFacilities.length) {
        mergeFacilitySuggestions(provider, data.imported.newFacilities.map((n) => ({ name: n })), data.imported.sourceCalendarName || '');
        data.imported.newFacilities.forEach((n) => { if (n) suggestions.push(n); });
      }
    }
  }
  // Pending deletions are recomputed by the server on EVERY sync
  // from current state, so the stored list for this provider is
  // REPLACED, never union-merged (Nov 6, 2026 fix). The old add-only
  // behaviour meant a flag raised by one sync — e.g. while a shift
  // was mid-re-import under a new id — stayed on screen forever: no
  // re-sync could clear it, even though the shift was still on the
  // user's calendar the whole time. A "no longer on this device"
  // flag for a shift that IS on this device now is stale by
  // definition and is dropped on sight.
  liveSyncState.pending = liveSyncState.pending.filter((p) => p.provider !== provider);
  (data.pendingDeletions || []).forEach((p) => {
    if (p.localMissing && db.shifts.some((x) => x.id === p.shiftId)) return;
    liveSyncState.pending.push({ provider: p.provider, shiftId: p.shiftId, date: p.date || '', facility: p.facility || '', type: p.type || '', localMissing: !!p.localMissing });
    liveSyncSetShiftState(p.provider || provider, p.shiftId, 'pending-deletion');
  });
  // Per-shift calendar state from this sync's response (server-derived
  // from calendar_sync_map). Applied AFTER the providerChanges above,
  // so the server's pairing wins over the interim 'not-synced' set
  // while applying creates. An older server sends no shiftSync — the
  // stored states and the 'not-synced' default then stand.
  if (Array.isArray(data.shiftSync)) {
    data.shiftSync.forEach((entry) => {
      if (!entry || !entry.shiftId || !entry.state) return;
      liveSyncSetShiftState(provider, entry.shiftId, entry.state);
    });
  }
  // Drop stored states for shifts no longer on this device, so a
  // deleted shift keeps no stale "On your calendar".
  if (liveSyncState.shiftSync) {
    Object.keys(liveSyncState.shiftSync).forEach((id) => {
      if (!db.shifts.some((x) => x.id === id)) delete liveSyncState.shiftSync[id];
    });
  }
  // Tombstones for this provider are cleared after a successful sync.
  // If the server failed to delete a provider event, the next sync flags
  // it as a pending deletion instead — nothing is silently lost.
  liveSyncState.tombstones = liveSyncState.tombstones.filter((t) => t.provider !== provider);
  liveSyncStateSave();
  persist();
  // Post-materialization heal (v116): a sync can apply changes
  // after the boot/cloud heals already ran — collapse any pair it
  // completed (same shift arriving under a renamed code) in the
  // SAME session instead of leaving doubled totals until the next
  // reload.
  if (typeof healShiftsAfterChange === 'function') { try { healShiftsAfterChange(); } catch (e) {} }
  return { created, updated, deleted, flagged: (data.pendingDeletions || []).length, newFacilities: suggestions, suggestions, conflicts: conflictsHeld };
}

async function liveSyncNow(provider, silent) {
  if (typeof cloudSession === 'undefined' || !cloudSession) return;
  liveSyncBusy = provider;
  liveSyncError = '';
  // One-shot repair flag: set by the "Re-import missing shifts" button
  // when an earlier sync lost shifts. Cleared as soon as it is sent, so
  // a normal sync never re-imports a shift the user deleted on purpose.
  const repairStaleImport = !!liveSyncState.repairImport;
  liveSyncState.repairImport = false;
  liveSyncStateSave();
  try {
    const payload = {
      action: 'sync',
      provider,
      localShifts: db.shifts.map((x) => ({ id: x.id, date: x.date, facility: x.facility, type: x.type, pay: x.pay, note: x.note || '', updatedAt: x.updatedAt || null })),
      tombstones: liveSyncState.tombstones.filter((t) => t.provider === provider).map((t) => ({ shiftId: t.shiftId })),
      repairStaleImport,
      facilities: liveSyncFacilitiesPayload(),
    };
    const data = await liveSyncPost('sync-calendar', payload);
    const applied = liveSyncApplyChanges(provider, data);
    await liveSyncFetchStatus();
    await liveSyncFetchLog();
    liveSyncBusy = '';
    render();
    if (!silent) {
      let msg = 'Synced ' + liveSyncLabel(provider) + ': ' + applied.created + ' created, ' + applied.updated + ' updated, ' + applied.deleted + ' deleted, ' + applied.flagged + ' flagged for your confirmation (see Pending deletions below).';
      if (applied.conflicts && applied.conflicts.length) msg += ' Looks like you\u2019re double-booking yourself: ' + applied.conflicts.length + ' synced shift(s) were NOT added because those days already have a shift (' + applied.conflicts.map((c) => c.text).join('; ') + '). Add one by hand from the calendar if you really have both.';
      if (data.imported && typeof data.imported === 'object') {
        if (data.imported.error) {
          msg += ' Import from “' + data.imported.sourceCalendarName + '” failed (' + data.imported.error + ') — the app-calendar sync above still ran; try Sync now again.';
        } else {
          // Skips are reported by reason, not as one opaque total: not
          // shifts, shifts the user deleted, shifts skipped only
          // because migration 005 has not run yet (legacy — "never
          // delivered" cannot be told from "deleted" without it), and
          // shifts repaired after an earlier sync lost them (see
          // decideStaleImportRow).
          const imp = data.imported;
          const skipBits = [];
          if (imp.skippedNotShift) skipBits.push(imp.skippedNotShift + ' not shifts');
          if (imp.skippedDeleted) skipBits.push(imp.skippedDeleted + ' you deleted');
          if (imp.skippedLegacy) skipBits.push(imp.skippedLegacy + ' skipped until migration 005 runs');
          if (imp.repaired) skipBits.push(imp.repaired + ' re-imported after a missed sync');
          if (imp.skippedSuggested) skipBits.push(imp.skippedSuggested + ' held for a new-hospital suggestion');
          if (Array.isArray(imp.perSource) && imp.perSource.length) {
            // Plain per-source truth (v120): what each picked
            // calendar held and what came in from it. A zero is said
            // LOUDLY, with the way out — never folded into a green
            // "Connected" the way Caleb's empty pull was on Nov 11,
            // 2026.
            imp.perSource.forEach((ps) => {
              if (ps.error) msg += ' Import from “' + ps.name + '” failed (' + ps.error + ') — the app-calendar sync above still ran; try Sync now again.';
              else if (!ps.seen) msg += ' Saw 0 events in “' + ps.name + '” — if your shifts live in a different calendar, tap Change on the ' + liveSyncLabel(provider) + ' card and pick the right one.';
              else msg += ' Synced “' + ps.name + '”: saw ' + ps.seen + ' events, imported ' + ps.created + ' shift(s)' + (ps.updated ? ', ' + ps.updated + ' updated' : '') + (ps.duplicates ? ', ' + ps.duplicates + ' already here' : '') + '.';
            });
            if (skipBits.length) msg += ' Skipped: ' + skipBits.join(', ') + '.';
          } else {
            msg += ' Imported ' + imp.created + ' shift(s) from “' + imp.sourceCalendarName + '”' + (imp.updated ? ', ' + imp.updated + ' updated' : '') + (imp.duplicates ? ', ' + imp.duplicates + ' already here' : '') + (typeof imp.seen === 'number' ? ' (' + imp.seen + ' event(s) seen, ' + (imp.parsed || 0) + ' looked like shifts' + (skipBits.length ? ', ' + skipBits.join(', ') + ' skipped' : '') + ')' : (imp.skipped ? ' (' + imp.skipped + ' event(s) skipped)' : '')) + '.';
          }
          if (imp.unpriced) msg += ' ' + imp.unpriced + ' imported shift(s) have no pay rule yet — set the rate on the Facilities tab and the next sync prices them.';
          if (applied.suggestions && applied.suggestions.length) msg += ' We noticed shifts at ' + applied.suggestions.join(', ') + ' in your calendar. Add it as a facility? Sync your calendar, upload a contract, or manually enter the facility\'s hourly rate — see the Facilities tab.';
        }
      }
      if ((!data.imported || typeof data.imported !== 'object') && liveSyncSourcePending(provider)) {
        msg += ' No work calendar is picked yet, so only the app’s own calendar was synced — pick the calendar your shifts live in on the ' + liveSyncLabel(provider) + ' card to pull them in.';
      }
      alert(msg);
    }
  } catch (e) {
    liveSyncBusy = '';
    liveSyncError = e.message;
    // A failed sync never proves the server got (or acted on) the
    // repair request — and on a timeout the server may still have
    // been working. Keep the one-shot repair flag so the next sync
    // re-sends it instead of silently dropping the repair.
    if (repairStaleImport) {
      liveSyncState.repairImport = true;
      liveSyncStateSave();
    }
    if (e.message === 'needs_reauth' || e.message === 'not_connected') {
      await liveSyncFetchStatus();
      render();
      if (!silent) alert(liveSyncLabel(provider) + ' needs reconnecting — click Connect again and approve access. Nothing was deleted.');
    } else if (!silent) {
      if (e.message === 'sync_timed_out') {
        alert('Sync with ' + liveSyncLabel(provider) + ' timed out before the calendar service answered. Nothing was deleted. Tap Sync now again — the next attempt usually finishes faster.');
      } else {
        alert('Sync with ' + liveSyncLabel(provider) + ' failed: ' + e.message + '. Nothing was deleted. See the sync log below.');
      }
      render();
    }
  }
}

function liveSyncSchedulePush() {
  if (typeof cloudSession === 'undefined' || !cloudSession) return;
  if (!liveSyncConnectedProviders().length) return;
  if (liveSyncPushTimer) clearTimeout(liveSyncPushTimer);
  liveSyncPushTimer = setTimeout(() => {
    liveSyncConnectedProviders().forEach((p) => liveSyncNow(p, true));
  }, 3000);
}
// Delete the SOURCE event of an imported shift from the user's own
// work calendar — the ONE exception to the "work calendar is never
// written to" rule, and only ever called when the user explicitly
// ticked "Also remove it from my <calendar> calendar" in the delete
// confirmation for that specific shift (Caleb, Nov 7, 2026). The
// server resolves the pairing from calendar_import_map and deletes
// exactly that event. Returns true only when the server confirms the
// source event is gone; any failure returns false so the caller can
// say so honestly while still completing the in-app delete. Only the
// Apple import source pairs shifts with source events today —
// Google/Outlook connections have no import source, so this is never
// offered for them: no Google/Outlook source-event delete path is
// built, even though their import sources exist now.
async function liveSyncDeleteSourceEvent(provider, shiftId) {
  try {
    const data = await liveSyncPost('sync-calendar', { action: 'delete-source-event', provider, shiftId });
    return !!(data && data.ok && data.sourceDeleted);
  } catch (e) {
    return false;
  }
}

function liveSyncRecordTombstone(shiftId) {
  liveSyncDropShiftState(shiftId);
  liveSyncConnectedProviders().forEach((p) => {
    if (!liveSyncState.tombstones.some((t) => t.provider === p && t.shiftId === shiftId)) {
      liveSyncState.tombstones.push({ provider: p, shiftId });
    }
  });
  liveSyncStateSave();
}

async function liveSyncConnect(provider) {
  if (typeof SUPABASE_CONFIGURED !== 'undefined' && !SUPABASE_CONFIGURED) { alert('Sign in on the Account tab first — live calendar sync needs your signed-in account.'); return; }
  if (typeof cloudSession === 'undefined' || !cloudSession) { alert('Sign in on the Account tab first — live calendar sync is per-user, so it needs your signed-in account.'); if (typeof setTab === 'function') setTab('Account'); return; }
  if (provider !== 'apple' && liveSyncConfig.state === 'ready' && !liveSyncConfig[provider]) {
    alert(liveSyncLabel(provider) + ' isn’t available yet — use the .ics import/export below for now.');
    return;
  }
  try {
    const data = await liveSyncPost(provider === 'google' ? 'google-auth' : 'outlook-auth', { action: 'start' });
    if (data.authUrl) window.location.href = data.authUrl;
  } catch (e) {
    alert('Could not start ' + liveSyncLabel(provider) + ' sign-in: ' + e.message);
  }
}
async function liveSyncDisconnect(provider) {
  if (!confirm('Disconnect ' + liveSyncLabel(provider) + '? Your shifts stay in CRNA Hub; only the calendar connection and its sync pairing are removed.')) return;
  try {
    await liveSyncPost('sync-calendar', { action: 'disconnect', provider });
    await liveSyncFetchStatus();
    await liveSyncFetchLog();
    // Disconnect deletes the server pairing, so a stored "On your
    // calendar" would be stale — drop this provider's per-shift states.
    if (liveSyncState.shiftSync) {
      Object.keys(liveSyncState.shiftSync).forEach((id) => {
        const per = liveSyncState.shiftSync[id];
        if (per) delete per[provider];
        if (per && !Object.keys(per).length) delete liveSyncState.shiftSync[id];
      });
      liveSyncStateSave();
    }
  } catch (e) { alert('Disconnect failed: ' + e.message); }
  render();
}
async function liveSyncToggleAutoDelete(provider) {
  const current = !!(liveSyncConnections[provider] && liveSyncConnections[provider].autoDelete);
  const next = !current;
  if (next && !confirm('Turn auto-delete ON for ' + liveSyncLabel(provider) + '? From now on, a shift deleted in that calendar will delete the CRNA Hub shift automatically, with no confirmation. The default is off, and this is the only way deletions ever happen without asking.')) return;
  try {
    await liveSyncPost('sync-calendar', { action: 'set-auto-delete', provider, autoDelete: next });
    await liveSyncFetchStatus();
  } catch (e) { alert('Could not change auto-delete: ' + e.message); }
  render();
}
async function liveSyncAppleConnect() {
  const idEl = document.getElementById('f_liveAppleId');
  const pwEl = document.getElementById('f_liveApplePw');
  const appleId = idEl ? idEl.value.trim() : '';
  // Apple shows the password grouped (xxxx-xxxx-xxxx-xxxx); the real
  // password has no separators, so a paste is cleaned before it is sent.
  const password = pwEl ? pwEl.value.replace(/[\s-]+/g, '') : '';
  if (!appleId || !password) { alert('Enter your Apple ID and the app-specific password.'); return; }
  // The password is cleared from the field now but kept in memory only
  // until this connect attempt resolves (it is needed again if iCloud
  // refuses to create a calendar and you pick an existing one instead).
  // It is never stored on this device.
  if (pwEl) pwEl.value = '';
  try {
    await liveSyncPost('sync-calendar', { action: 'connect-apple', appleId, appSpecificPassword: password });
    liveSyncApplePick = null;
    await liveSyncFetchStatus();
    await liveSyncFetchAppleCalendars();
    await liveSyncFetchLog();
    render();
    alert('Apple Calendar connected. One more step: pick the calendar your shifts live in below — your shifts are pulled from that calendar only.');
  } catch (e) {
    // iCloud refused to create the app-owned calendar through CalDAV:
    // offer the user's existing calendars instead of failing the whole
    // connect. In the finished app this picker is the normal flow —
    // pick the calendar your shifts already live in — with no password
    // step before it.
    const cals = e.data && Array.isArray(e.data.calendars) ? e.data.calendars : null;
    if (e.message === 'apple_create_forbidden_pick_calendar' && cals) {
      liveSyncApplePick = { appleId, password, calendars: cals };
      render();
      if (!cals.length) {
        alert('iCloud would not let the preview create its own calendar, and no existing calendars were found. Create a calendar in the Apple Calendar app first, then try connecting again. Nothing was stored.');
      } else {
        alert('iCloud would not let the preview create its own calendar — your sign-in is fine. Pick your work calendar below to sync with instead. Nothing was stored yet.');
      }
      return;
    }
    liveSyncApplePick = null;
    render();
    if (e.message && e.message.startsWith('apple_') && e.message !== 'apple_auth_failed') {
      alert('Apple Calendar connection failed at: ' + e.message + '. That names the failing discovery step and its HTTP status — it is not a password error unless the code says apple_auth_failed. Nothing was stored.');
    } else {
      alert('Apple Calendar connection failed: ' + e.message + '. Check the Apple ID and app-specific password (not your normal Apple password), then try again. Nothing was stored.');
    }
  }
}
async function liveSyncApplePickUse() {
  if (!liveSyncApplePick) return;
  const sel = document.getElementById('f_liveApplePick');
  const calendarUrl = sel ? sel.value : '';
  if (!calendarUrl) { alert('Pick a calendar first.'); return; }
  const picked = liveSyncApplePick.calendars.find((c) => c.url === calendarUrl);
  const { appleId, password } = liveSyncApplePick;
  try {
    await liveSyncPost('sync-calendar', { action: 'connect-apple', appleId, appSpecificPassword: password, calendarUrl });
    liveSyncApplePick = null;
    await liveSyncFetchStatus();
    await liveSyncFetchAppleCalendars();
    await liveSyncFetchLog();
    render();
    alert('Apple Calendar connected to “' + (picked && picked.name ? picked.name : 'your chosen calendar') + '”. Shifts will sync with that calendar.');
  } catch (e) {
    render();
    alert('Could not connect to that calendar: ' + e.message + '. Nothing was stored.');
  }
}
// The source picker (v120) — ONE component for every provider, shown
// on the connected card whenever the pick is missing (required step,
// card stays expanded) and again when the user taps Change (current
// picks pre-ticked). Neutral by rule: on a first pick NOTHING is
// pre-ticked — the user ticks the calendar their shifts live in, or
// explicitly chooses "App calendar only". The dedicated CRNA Hub
// calendar is listed but disabled and labelled — the app writes
// there; it is never a source.
function liveSyncSourcePickerHTML(provider) {
  const cals = liveSyncCalendarsByProvider[provider] || [];
  const editing = !!liveSyncSourceEdit[provider];
  const preTick = editing ? liveSyncEffectiveSources(provider).map((s) => s.ref) : [];
  let list;
  if (!cals.length) {
    list = '<p class="muted">Your calendars could not be listed yet.</p><div class="item-actions"><button type="button" class="tiny secondary" data-action="live-calendars" data-id="' + provider + '">Load my calendars</button></div>';
  } else {
    list = '<div class="form-grid">' + cals.map((c) => {
      if (c.isDedicated) return '<label class="muted"><input type="checkbox" disabled> ' + escapeHTML(c.name || 'CRNA Hub') + ' — CRNA Hub — the app writes here — not a source</label>';
      return '<label><input type="checkbox" class="live-source-pick" data-provider="' + provider + '" value="' + escapeHTML(c.ref) + '"' + (preTick.includes(c.ref) ? ' checked' : '') + '> ' + escapeHTML(c.name || 'Unnamed calendar') + '</label>';
    }).join('') + '</div>';
  }
  return '<div style="margin-top:10px"><div class="item-title">Pick the calendar your shifts live in</div><div class="muted">We’ll pull your shifts from the calendar(s) you tick — and nowhere else. Nothing is ever written to them.</div>' + list + '<div class="item-actions"><button type="button" class="tiny" data-action="live-source-save" data-id="' + provider + '">Save &amp; sync now</button><button type="button" class="tiny secondary" data-action="live-source-none" data-id="' + provider + '">App calendar only — no work calendar</button>' + (editing ? '<button type="button" class="tiny secondary" data-action="live-source-cancel" data-id="' + provider + '">Cancel</button>' : '') + '</div></div>';
}

// The persistent "what the last import did" line, every provider:
// per-source plain truth when the server sent it (including a loud
// zero), else the legacy aggregate line. The repair offer rides
// along whenever the last import skipped shifts as deleted/legacy.
function liveSyncLastImportHTML(provider) {
  const li = liveSyncState.lastImport;
  if (!li || li.provider !== provider) {
    if (liveSyncSourceChoiceMade(provider) && liveSyncEffectiveSources(provider).length) {
      return '<p class="muted">Work calendar: “' + escapeHTML(liveSyncSourceSummary(provider)) + '”. No import has run yet — tap “Sync now”.</p>';
    }
    return '';
  }
  const skipBits = [];
  if (li.skippedNotShift) skipBits.push(li.skippedNotShift + ' not shifts');
  if (li.skippedDeleted) skipBits.push(li.skippedDeleted + ' you deleted');
  if (li.skippedLegacy) skipBits.push(li.skippedLegacy + ' waiting to be re-imported');
  if (li.repaired) skipBits.push(li.repaired + ' re-imported after a missed sync');
  if (li.unpriced) skipBits.push(li.unpriced + ' unpriced — set the pay rule on the Facilities tab');
  if (li.skippedSuggested) skipBits.push(li.skippedSuggested + ' held — new hospital suggestion, see Facilities tab');
  if (li.suggestions && li.suggestions.length) skipBits.push('suggested: ' + li.suggestions.map((x) => x.name || x).join(', '));
  let line;
  if (li.error) {
    line = 'failed (' + escapeHTML(li.error) + ')';
  } else if (Array.isArray(li.perSource) && li.perSource.length) {
    line = li.perSource.map((ps) => {
      if (ps.error) return 'import from “' + escapeHTML(ps.name || '') + '” failed (' + escapeHTML(ps.error) + ')';
      if (!ps.seen) return 'saw 0 events in “' + escapeHTML(ps.name || '') + '” — if your shifts live in a different calendar, tap Change and pick the right one';
      return 'synced “' + escapeHTML(ps.name || '') + '”: saw ' + ps.seen + ' events, imported ' + ps.created + ' shift(s)' + (ps.updated ? ', ' + ps.updated + ' updated' : '') + (ps.duplicates ? ', ' + ps.duplicates + ' already here' : '');
    }).join('; ');
    if (skipBits.length) line += ' (' + skipBits.join(', ') + ' skipped)';
  } else {
    line = 'imported ' + li.created + ' shift(s) from “' + escapeHTML(li.sourceName || '') + '”' + (li.updated ? ', ' + li.updated + ' updated' : '') + (li.duplicates ? ', ' + li.duplicates + ' already here' : '') + (typeof li.seen === 'number' ? ' (' + li.seen + ' event(s) seen, ' + (li.parsed || 0) + ' looked like shifts' + (skipBits.length ? ', ' + skipBits.join(', ') + ' skipped' : (li.skipped ? ', ' + li.skipped + ' skipped' : '')) + ')' : (li.skipped ? ', ' + li.skipped + ' event(s) skipped (not shifts)' : ''));
  }
  let html = '<p class="muted">Last import' + (li.at ? ' (' + escapeHTML(liveSyncWhen(li.at)) + ')' : '') + ': ' + line + '.</p>';
  // An import that skipped shifts usually means an earlier sync
  // paired them without ever delivering them. Offer the explicit
  // repair whenever anything was skipped as deleted/legacy (not
  // only when nothing was created — a partial import like 12
  // created / 219 skipped still needs it).
  if (!li.error && ((li.skippedDeleted || 0) > 0 || (li.skippedLegacy || 0) > 0 || (li.created === 0 && (li.skipped || 0) > 0 && (li.parsed || 0) > 0))) {
    html += '<div class="item-actions"><button type="button" class="tiny secondary" data-action="live-repair-import" data-id="' + provider + '">Re-import missing shifts</button></div><p class="muted">Missing shifts? This pulls them in again — shifts you deleted on purpose stay deleted.</p>';
  }
  return html;
}

// Save the ticked source calendar(s), then sync immediately so the
// result ("Synced 'Caleb Work Schedule': saw N events, imported M
// shifts") is visible at once. Changing the pick re-runs the same
// save, and the sync that follows is a full pull of the newly chosen
// calendar(s) (source reads are always full scans server-side).
async function liveSyncSourceSave(provider) {
  const cals = liveSyncCalendarsByProvider[provider] || [];
  const boxes = document.querySelectorAll('input.live-source-pick[data-provider="' + provider + '"]:checked');
  const picked = Array.prototype.map.call(boxes, (b) => { const c = cals.find((x) => x.ref === b.value); return { ref: b.value, name: c ? (c.name || b.value) : b.value }; });
  if (!picked.length) { alert('Tick the calendar your shifts live in first — or choose “App calendar only” if you don’t have a work calendar.'); return; }
  try {
    await liveSyncPost('sync-calendar', { action: 'set-source-calendars', provider, choice: 'chosen', calendars: picked });
    if (liveSyncState.sourceLocal) delete liveSyncState.sourceLocal[provider];
    liveSyncStateSave();
  } catch (e) {
    if (e.message === 'migration_014_required' || e.message === 'migration_004_required') {
      // Pre-migration server: remember the pick on this device so the
      // required step is still done; the account stores it once the
      // owner runs migration 014. Said out loud, never silent.
      liveSyncState.sourceLocal = liveSyncState.sourceLocal || {};
      liveSyncState.sourceLocal[provider] = { choice: 'chosen', calendars: picked };
      liveSyncStateSave();
      alert('Saved on this device. The app owner still needs to run migration 014 (supabase-schema-014.sql) before the pick is stored in your account — syncing now.');
    } else if (e.message === 'source_is_dedicated_calendar') {
      alert('That is the app’s own calendar — pick your work calendar instead.');
      render();
      return;
    } else {
      alert('Could not save that work calendar: ' + e.message + '. Nothing was changed.');
      render();
      return;
    }
  }
  liveSyncSourceEdit[provider] = false;
  await liveSyncFetchStatus();
  render();
  await liveSyncNow(provider, false);
}

// "App calendar only" is a real answer, not a skipped step: it is
// saved (server-side when it can be, on-device until migration 014
// runs) and the card goes back to resting with "Pulling from: App
// calendar only" until the user taps Change.
async function liveSyncSourceNone(provider) {
  try {
    await liveSyncPost('sync-calendar', { action: 'set-source-calendars', provider, choice: 'none', calendars: [] });
    if (liveSyncState.sourceLocal) delete liveSyncState.sourceLocal[provider];
    liveSyncStateSave();
  } catch (e) {
    if (e.message === 'migration_014_required' || e.message === 'migration_004_required') {
      liveSyncState.sourceLocal = liveSyncState.sourceLocal || {};
      liveSyncState.sourceLocal[provider] = { choice: 'none' };
      liveSyncStateSave();
    } else {
      alert('Could not save that choice: ' + e.message + '. Nothing was changed.');
      render();
      return;
    }
  }
  liveSyncSourceEdit[provider] = false;
  await liveSyncFetchStatus();
  render();
  alert(liveSyncLabel(provider) + ' sync will use the app’s own calendar only. You can pick a work calendar any time with Change.');
}

// Explicit repair for shifts lost to an earlier undelivered sync:
// the server clears stale import records (paired shifts that never
// reached this device) and pulls them in fresh on this sync. Rows
// flagged as user-deleted are never cleared. Until migration 005 runs
// this can also bring back an imported shift the user deleted here —
// delete it again afterwards if it is not wanted.
async function liveSyncRepairImport(provider) {
  provider = provider || 'apple';
  const conn = liveSyncConnections[provider];
  if (!confirm('Re-import missing shifts from “' + (conn && conn.sourceCalendarName ? conn.sourceCalendarName : 'your work calendar') + '”? Shifts that were paired by an earlier sync but never arrived will be pulled in again. Shifts you deleted on purpose stay deleted.')) return;
  liveSyncState.repairImport = true;
  liveSyncStateSave();
  await liveSyncNow(provider, false);
}

async function liveSyncResolvePending(entry, decision) {
  const parts = String(entry || '').split('|');
  const provider = parts[0], shiftId = parts[1];
  const pending = liveSyncState.pending.find((p) => p.provider === provider && p.shiftId === shiftId);
  if (!pending) return;
  try {
    if (decision === 'delete') {
      if (pending.localMissing) {
        // The shift is already gone here; delete the provider event too.
        await liveSyncPost('sync-calendar', { action: 'resolve-deletion', provider, shiftId, deleteProvider: true });
      } else {
        db.shifts = db.shifts.filter((x) => x.id !== shiftId);
        persist();
        await liveSyncPost('sync-calendar', { action: 'resolve-deletion', provider, shiftId });
      }
    } else {
      // Keep: drop the pairing only. The next sync re-creates the
      // provider event from the kept shift.
      await liveSyncPost('sync-calendar', { action: 'resolve-deletion', provider, shiftId });
    }
  } catch (e) {
    alert('Could not resolve that deletion: ' + e.message);
    return;
  }
  liveSyncState.pending = liveSyncState.pending.filter((p) => !(p.provider === provider && p.shiftId === shiftId));
  liveSyncStateSave();
  render();
}

async function liveSyncKeepAllPending() {
  const entries = liveSyncState.pending.slice();
  if (!entries.length) return;
  // Bulk "Keep all — these are still on my calendar": clears every
  // flag and deletes NOTHING anywhere. Each pairing is dropped
  // server-side WITHOUT deleting the provider event
  // (resolve-deletion with no deleteProvider), so the stale pairing
  // that raised the flag cannot re-flag it; the shifts stay in the
  // app, tracked and present, and re-link or re-create on the next
  // sync. This is not "Stop tracking it" — that drops one shift's
  // tracking; this keeps them all.
  for (const p of entries) {
    try {
      await liveSyncPost('sync-calendar', { action: 'resolve-deletion', provider: p.provider, shiftId: p.shiftId });
    } catch (e) {
      alert('Could not clear those flags: ' + e.message);
      return;
    }
    // A local shift matching a cleared flag — by id, or by the
    // flag's date + facility + type when it was re-imported under a
    // new id — is present: clear its pending-deletion state.
    db.shifts.forEach((x) => {
      if (x.id === p.shiftId || (p.date && x.date === p.date && x.facility === p.facility && x.type === p.type)) {
        liveSyncSetShiftState(p.provider, x.id, 'not-synced');
      }
    });
  }
  liveSyncState.pending = [];
  liveSyncStateSave();
  persist();
  render();
}

function liveSyncAction(action, entry) {
  if (action === 'live-toggle-other-calendars') { liveSyncShowOthers = !liveSyncShowOthers; return render(); }
  if (action === 'live-connect') return liveSyncConnect(entry);
  if (action === 'live-disconnect') return liveSyncDisconnect(entry);
  if (action === 'live-sync-now') return liveSyncNow(entry, false);
  if (action === 'live-auto-delete') return liveSyncToggleAutoDelete(entry);
  if (action === 'live-apple-connect') return liveSyncAppleConnect();
  if (action === 'live-apple-pick') return liveSyncApplePickUse();
  if (action === 'live-apple-pick-cancel') { liveSyncApplePick = null; return render(); }
  if (action === 'live-apple-calendars') { liveSyncFetchAppleCalendars().then(() => render()); return; }
  if (action === 'live-calendars') { liveSyncFetchCalendars(entry).then(() => render()); return; }
  if (action === 'live-source-save') return liveSyncSourceSave(entry);
  if (action === 'live-source-none') return liveSyncSourceNone(entry);
  if (action === 'live-source-change') { liveSyncSourceEdit[entry] = true; liveSyncFetchCalendars(entry).then(() => render()); return; }
  if (action === 'live-source-cancel') { liveSyncSourceEdit[entry] = false; return render(); }
  if (action === 'live-repair-import') return liveSyncRepairImport(entry);
  if (action === 'live-apple-repair-import') return liveSyncRepairImport('apple');
  if (action === 'live-refresh') {
    liveSyncFetchConfig().then(() => liveSyncFetchStatus()).then(() => liveSyncFetchAllCalendars()).then(() => liveSyncFetchLog()).then(() => render());
    return;
  }
  if (action === 'live-confirm-delete') return liveSyncResolvePending(entry, 'delete');
  if (action === 'live-keep') return liveSyncResolvePending(entry, 'keep');
  if (action === 'live-keep-all') return liveSyncKeepAllPending();
}

function liveSyncProviderCard(provider) {
  const label = liveSyncLabel(provider);
  const conn = liveSyncConnections[provider];
  const configured = provider === 'apple' ? (liveSyncConfig.state === 'ready') : !!liveSyncConfig[provider];
  if (liveSyncConfig.state === 'unreachable') {
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Couldn’t reach sync</span></div><div class="muted">Check your connection and tap “Refresh status &amp; log” below.</div></div>';
  }
  if (liveSyncConfig.state === 'loading') {
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Checking setup…</span></div></div>';
  }
  if (!configured) {
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Not available yet</span></div><div class="muted">Use the .ics import/export below for now.</div></div>';
  }
  if (conn && conn.status === 'needs_reauth') {
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Needs reconnecting</span></div><div class="muted">Access expired or was revoked. Reconnect to restore sync. Nothing was deleted.</div><div class="item-actions"><button type="button" class="tiny" data-action="live-connect" data-id="' + provider + '">Reconnect</button></div></div>';
  }
  if (conn && conn.status === 'connected') {
    let card = '<div class="item"><div class="item-title">' + label + ' — <span class="pill">Connected</span></div><div class="muted">Last sync: ' + escapeHTML(liveSyncWhen(conn.lastSyncedAt)) + ' · Auto-delete: ' + (conn.autoDelete ? 'ON' : 'OFF') + '</div><div class="item-actions"><button type="button" class="tiny" data-action="live-sync-now" data-id="' + provider + '">' + (liveSyncBusy === provider ? 'Syncing…' : 'Sync now') + '</button><button type="button" class="tiny secondary" data-action="live-auto-delete" data-id="' + provider + '">' + (conn.autoDelete ? 'Turn auto-delete off' : 'Turn auto-delete on') + '</button><button type="button" class="tiny secondary" data-action="live-disconnect" data-id="' + provider + '">Disconnect</button></div>';
    if (liveSyncSourcePending(provider) || liveSyncSourceEdit[provider]) {
      // REQUIRED STEP (v120): until the user ticks a work calendar
      // (or explicitly chooses "app calendar only"), the card stays
      // EXPANDED with the picker in front of them — never collapsed,
      // never skippable. This is the step Caleb never saw on Nov 11,
      // 2026: connected, green, last-sync stamped — and silently
      // pulling from nothing, because the picker sat inside a
      // collapsed card behind a select he never opened. Changing the
      // pick (Change) reopens the same picker, same component.
      if (liveSyncSourcePending(provider)) {
        card += '<p class="hint"><strong>One more step:</strong> pick the calendar your shifts live in. Until you do, ' + label + ' sync only uses the app’s own calendar — none of your shifts are pulled in.</p>';
      }
      card += liveSyncSourcePickerHTML(provider);
      card += liveSyncLastImportHTML(provider);
      return card + '</div>';
    }
    // Pick made: the card rests collapsed (Nov 6, 2026), but the
    // one-line summary now always says what we pull from, and the
    // expanded card leads its source section with the same line plus
    // Change.
    card += '<div style="margin-top:10px"><div class="item-title">Your work calendar</div><p class="muted">Pulling from: ' + escapeHTML(liveSyncSourceSummary(provider)) + '</p><div class="item-actions"><button type="button" class="tiny secondary" data-action="live-source-change" data-id="' + provider + '">Change</button></div></div>';
    card += liveSyncLastImportHTML(provider);
    return '<details class="collapse-sub sync-provider"><summary class="collapse-head"><span class="collapse-title">' + label + ' · Connected · Pulling from: ' + escapeHTML(liveSyncSourceSummary(provider)) + ' · Last sync: ' + escapeHTML(liveSyncWhen(conn.lastSyncedAt)) + '</span><span class="collapse-chevron" aria-hidden="true">▾</span></summary>' + card + '</div></details>';
  }
  if (provider === 'apple') {
    if (liveSyncApplePick && liveSyncApplePick.calendars.length) {
      const opts = liveSyncApplePick.calendars.map((c) => '<option value="' + escapeHTML(c.url) + '">' + escapeHTML(c.name || 'Unnamed calendar') + '</option>').join('');
      return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Pick your work calendar</span></div><div class="muted">Pick the calendar your shifts live in — we’ll pull from that one only.</div><div class="form-grid"><div class="field"><label for="f_liveApplePick">Your work calendar</label><select id="f_liveApplePick">' + opts + '</select></div></div><div class="item-actions"><button type="button" class="tiny" data-action="live-apple-pick">Connect to this calendar</button><button type="button" class="tiny secondary" data-action="live-apple-pick-cancel">Cancel</button></div></div>';
    }
    // Final flow, stated first: one tap, grant access, pick the work
    // calendar. The password form below it is fenced off as a
    // PREVIEW STAND-IN — a web page cannot use EventKit, so this
    // preview connects through CalDAV with a one-time app-specific
    // password instead. It is never presented as the designed path.
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Not connected</span></div><div><div class="item-actions"><a class="button" href="https://appleid.apple.com/account/manage/section/security" target="_blank" rel="noopener">Create it at Apple →</a></div><ol class="muted"><li>Tap the button and sign in at Apple.</li><li>Generate an app-specific password named “CRNA Hub”.</li><li>Paste it here.</li></ol><p class="muted">Beta note: this password step is only for the web version — in the final app you’ll just tap Allow when your iPhone asks.</p><div class="form-grid"><div class="field"><label for="f_liveAppleId">Apple ID</label><input id="f_liveAppleId" type="email" autocomplete="username" placeholder="you@icloud.com"></div><div class="field"><label for="f_liveApplePw">App-specific password (one-time)</label><input id="f_liveApplePw" type="password" autocomplete="off" placeholder="xxxx-xxxx-xxxx-xxxx"></div></div><p class="muted">Stored encrypted and never shown again. Never enter your normal Apple password here.</p><div class="item-actions"><button type="button" class="tiny" data-action="live-apple-connect">Connect Apple Calendar</button></div></div></div>';
  }
  return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Not connected</span></div><div class="item-actions"><button type="button" class="tiny" data-action="live-connect" data-id="' + provider + '">Connect ' + label + '</button></div></div>';
}

// Providers the user has chosen: connected now, or connected before
// and needing a reconnect (its prompt must never be buried).
function liveSyncChosenProviders() {
  return ['google', 'outlook', 'apple'].filter((p) => {
    const c = liveSyncConnections[p];
    return c && (c.status === 'connected' || c.status === 'needs_reauth');
  });
}
// Provider cards for the sync panel (Nov 6, 2026): once at least one
// provider is chosen, the connect prompts for the ones they did NOT
// choose are hidden — display only, nothing disconnected — behind one
// quiet "Use a different calendar service" line that brings them back.
// With nothing chosen yet, all cards show as always (onboarding step 2).
function liveSyncCardsHTML() {
  const chosen = liveSyncChosenProviders();
  const hideOthers = liveSyncConfig.state === 'ready' && chosen.length > 0 && !liveSyncShowOthers;
  let html = '';
  ['google', 'outlook', 'apple'].forEach((p) => {
    if (hideOthers && !chosen.includes(p)) return;
    html += liveSyncProviderCard(p);
  });
  if (liveSyncConfig.state === 'ready' && chosen.length > 0) {
    html += '<p class="muted"><button type="button" class="tiny secondary" data-action="live-toggle-other-calendars">' + (liveSyncShowOthers ? 'Hide other calendar services' : 'Use a different calendar service') + '</button></p>';
  }
  return html;
}

function liveSyncPanelHTML() {
  // Body of the "Live calendar sync" panel only (Nov 6, 2026): Live
  // calendar sync, QGenda, and Upload a schedule are now three separate
  // sibling panels on the Account page, so the panel's own summary
  // header carries this title — no <h2> in the body.
  let html = '';
  if (typeof SUPABASE_CONFIGURED !== 'undefined' && !SUPABASE_CONFIGURED) {
    html += '<p><strong>Live sync needs a signed-in account.</strong> The .ics import/export below works without one.</p>';
  } else if (typeof cloudSession === 'undefined' || !cloudSession) {
    html += '<p><strong>Sign in on the Account tab first.</strong> Live calendar sync is per-user — your provider connection and tokens belong to your signed-in account, so there is nothing to connect until then.</p>';
    html += '<div class="toolbar"><button type="button" class="secondary" data-action="goto-account">Go to Account tab</button></div>';
    html += '<p class="muted">The .ics import/export below works without sign-in.</p>';
  } else {
    html += '<p class="muted">Connect once, pick the calendar your shifts live in, and we’ll pull them in.</p>';
    if (liveSyncError) html += '<p class="hint">Last sync problem: ' + escapeHTML(liveSyncError) + '</p>';
    if (typeof facilitySuggestionsHTML === 'function') html += facilitySuggestionsHTML();
    html += liveSyncCardsHTML();
    html += '<div class="toolbar"><button type="button" class="secondary tiny" data-action="live-refresh">Refresh status &amp; log</button></div>';
    if (liveSyncState.pending.length) {
      html += '<h3>Pending deletions — your confirmation needed</h3><p class="muted">Gone from your calendar — nothing is deleted here until you say so.</p>';
      if (liveSyncState.pending.length > 1) {
        html += '<div class="item-actions"><button type="button" class="tiny secondary" data-action="live-keep-all">Keep all — these are still on my calendar</button></div>';
      }
      liveSyncState.pending.forEach((p) => {
        const key = p.provider + '|' + p.shiftId;
        html += '<div class="item"><div class="item-title">' + escapeHTML(p.date || '') + ' · ' + escapeHTML(p.facility || '') + ' · ' + escapeHTML(p.type || '') + '</div><div class="muted">' + escapeHTML(liveSyncLabel(p.provider)) + (p.localMissing ? ' · shift no longer on this device — delete it from the calendar, or stop tracking it' : ' · deleted in the calendar') + '</div><div class="item-actions"><button type="button" class="tiny danger" data-action="live-confirm-delete" data-id="' + escapeHTML(key) + '">' + (p.localMissing ? 'Delete from calendar' : 'Delete here too') + '</button><button type="button" class="tiny secondary" data-action="live-keep" data-id="' + escapeHTML(key) + '">' + (p.localMissing ? 'Stop tracking it' : 'Keep here') + '</button></div></div>';
      });
    }
    // Sync log is collapsed by default (Nov 6, 2026): the header row
    // carries the latest run's line; tap to expand the full log, tap
    // again to collapse. Syncing itself is unchanged.
    const logLatest = liveSyncLog.length ? liveSyncLog[0] : null;
    const logHead = logLatest ? ('Sync log · last: ' + liveSyncWhen(logLatest.created_at) + ' · ' + escapeHTML(logLatest.provider || '')) : 'Sync log';
    html += '<details class="collapse-sub sync-log"><summary class="collapse-head"><span class="collapse-title">' + logHead + '</span><span class="collapse-chevron" aria-hidden="true">▾</span></summary>';
    if (!liveSyncLog.length) {
      html += '<p class="muted">No sync runs yet.</p>';
    } else {
      html += liveSyncLog.slice(0, 15).map((r) => '<div class="item"><div class="muted">' + escapeHTML(liveSyncWhen(r.created_at)) + ' · ' + escapeHTML(r.provider) + ' · ' + escapeHTML(r.direction || 'both') + ' · created ' + (r.shifts_created || 0) + ' · updated ' + (r.shifts_updated || 0) + ' · flagged ' + (r.shifts_flagged || 0) + ' · deleted ' + (r.shifts_deleted || 0) + (r.error ? ' · error: ' + escapeHTML(r.error) : '') + '</div></div>').join('');
    }
    html += '</details>';
    html += '<p class="muted">Conflict rule: newest edit wins. Deletions wait above unless auto-delete is on for that provider.</p>';
  }
  return html;
}

// Default open state for the Live calendar sync panel (Nov 6, 2026):
// open while the user still needs to act in it — onboarding step 2 in
// progress, nothing connected yet, a provider needs reconnecting, or
// deletions are waiting for confirmation. Once a provider is connected
// and nothing is waiting, the panel rests collapsed on its header and
// the connected provider's summary card inside carries the status.
function liveSyncPanelOpen() {
  if (typeof onboardStep !== 'undefined' && onboardStep === 2) return true;
  if (liveSyncConnectedProviders().some((p) => liveSyncSourcePending(p))) return true;
  if (liveSyncState.pending.length) return true;
  if (liveSyncChosenProviders().some((p) => liveSyncConnections[p] && liveSyncConnections[p].status === 'needs_reauth')) return true;
  return liveSyncConnectedProviders().length === 0;
}

async function liveSyncInit() {
  // Handle the return from a provider consent screen.
  try {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('calendar_connected');
    const failed = params.get('calendar_error');
    if (connected || failed) {
      window.history.replaceState({}, '', window.location.pathname);
      if (connected) alert(liveSyncLabel(connected) + ' connected — live sync is on. One more step: pick the calendar your shifts live in (see the sync panel).');
      if (failed) alert('Calendar connection failed: ' + failed + '. Nothing was stored. Try Connect again.');
    }
  } catch (e) {}
  if (typeof SUPABASE_CONFIGURED === 'undefined' || !SUPABASE_CONFIGURED) return;
  if (typeof cloudSession === 'undefined' || !cloudSession) return;
  await liveSyncFetchConfig();
  await liveSyncFetchStatus();
  await liveSyncFetchAllCalendars();
  await liveSyncFetchLog();
  const connected = liveSyncConnectedProviders();
  if (connected.length) {
    // Automatic sync on open, silent: failures surface in the panel/log,
    // never as a blocking popup on every load.
    for (const p of connected) await liveSyncNow(p, true);
  }
  render();
}

// Sign out & clear this device (Nov 6, 2026): app.js calls this after
// wiping the main database so the calendar-sync side leaves nothing
// behind either — pending deletions awaiting a decision, tombstones,
// the sync log, connection summaries, and any half-finished Apple
// calendar pick all reset to the fresh, signed-out state. Server-side
// calendar connections are NOT touched (they belong to the account);
// they simply stop being shown or used until the next sign-in.
// liveSyncConfig stays: it describes the deployment's capabilities,
// not the user's data.
function liveSyncResetDeviceState() {
  if (liveSyncPushTimer) { try { clearTimeout(liveSyncPushTimer); } catch (e) {} liveSyncPushTimer = null; }
  liveSyncState = { pending: [], tombstones: [], lastImport: null, repairImport: false, shiftSync: {}, sourceLocal: {} };
  try { localStorage.removeItem('crna-hub-live-sync'); } catch (e) {}
  liveSyncConnections = {};
  liveSyncLog = [];
  liveSyncError = '';
  liveSyncBusy = '';
  liveSyncShowOthers = false;
  liveSyncApplePick = null;
  liveSyncAppleCalendars = [];
  liveSyncCalendarsByProvider = {};
  liveSyncSourceEdit = {};
}

// Expose the one entry point app.js hooks call after shift changes.
if (typeof window !== 'undefined') {
  window.liveSyncInit = liveSyncInit;
  window.liveSyncSchedulePush = liveSyncSchedulePush;
  window.liveSyncRecordTombstone = liveSyncRecordTombstone;
  window.liveSyncDeleteSourceEvent = liveSyncDeleteSourceEvent;
  window.liveSyncShiftSyncLabel = liveSyncShiftSyncLabel;
  window.liveSyncMarkShiftNotSynced = liveSyncMarkShiftNotSynced;
  window.liveSyncResetDeviceState = liveSyncResetDeviceState;
}
liveSyncInit();
