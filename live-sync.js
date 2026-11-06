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
//      is NEVER written to.
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
//      re-imported; imported shifts arrive as "proposed"; a shift
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

// The label that marks the Apple CalDAV / app-specific-password path
// as a temporary preview stand-in. It appears on the stand-in box
// itself and in every alert the stand-in path shows, so the password
// flow is never mistaken for the designed flow.
const LIVE_SYNC_STANDIN_LABEL = 'Preview stand-in — the finished app uses EventKit, no password needed';

let liveSyncConfig = { state: 'loading', google: false, outlook: false, apple: false, encryption: false };
let liveSyncConnections = {}; // provider -> {status, autoDelete, lastSyncedAt}
let liveSyncLog = [];
let liveSyncWizard = false;
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
let liveSyncPushTimer = null;

function liveSyncStateLoad() {
  try {
    const v = JSON.parse(localStorage.getItem('crna-hub-live-sync') || 'null');
    // repairImport survives a reload: it is a one-shot request, not a
    // completed action, so losing it to a refresh (or to a sync that
    // timed out before the server answered) must not burn the repair.
    if (v && typeof v === 'object') return { pending: Array.isArray(v.pending) ? v.pending : [], tombstones: Array.isArray(v.tombstones) ? v.tombstones : [], lastImport: (v.lastImport && typeof v.lastImport === 'object') ? v.lastImport : null, repairImport: v.repairImport === true, shiftSync: (v.shiftSync && typeof v.shiftSync === 'object') ? v.shiftSync : {} };
  } catch (e) {}
  return { pending: [], tombstones: [], lastImport: null, repairImport: false, shiftSync: {} };
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
  }));
}

function liveSyncFacilityKnown(name) {
  if (typeof facilityByNameOrAlias === 'function') return !!facilityByNameOrAlias(name);
  return (db.facilities || []).some((g) => String(g.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());
}

function liveSyncApplyChanges(provider, data) {
  const changes = data.providerChanges || [];
  let created = 0, updated = 0, deleted = 0;
  const suggestions = [];
  changes.forEach((ch) => {
    if (ch.action === 'create' && ch.shift) {
      const s = ch.shift;
      if (db.shifts.some((x) => x.date === s.date && x.facility === s.facility && x.type === s.type)) return;
      // Imported shifts arrive with source 'apple-import' (and a note
      // naming the calendar they came from); shifts from the app-owned
      // calendar carry no source and default to 'calendar-<provider>'.
      db.shifts.push({ id: s.id, date: s.date, facility: s.facility, type: s.type, pay: s.pay ? String(s.pay) : '', note: s.note || '', source: s.source || ('calendar-' + provider), status: 'proposed', incomplete: !String(s.pay || '').trim(), updatedAt: s.updatedAt || null });
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
      x.date = s.date; x.facility = s.facility; x.type = s.type;
      if (s.pay) { x.pay = String(s.pay); x.incomplete = false; }
      x.note = s.note || '';
      x.source = s.source || x.source || ('calendar-' + provider); x.updatedAt = s.updatedAt || x.updatedAt;
      updated++;
    } else if (ch.action === 'delete' && ch.shiftId) {
      db.shifts = db.shifts.filter((x) => x.id !== ch.shiftId);
      liveSyncDropShiftState(ch.shiftId);
      deleted++;
    }
  });
  // Remember the last Apple import result so the panel can say
  // "imported N shifts from Caleb Work Schedule" after the alert closes.
  if (data.imported && typeof data.imported === 'object') {
    liveSyncState.lastImport = { provider, sourceName: data.imported.sourceCalendarName || '', created: data.imported.created || 0, updated: data.imported.updated || 0, skipped: data.imported.skipped || 0, duplicates: data.imported.duplicates || 0, seen: data.imported.seen || 0, parsed: data.imported.parsed || 0, fetchMethod: data.imported.fetchMethod || null, error: data.imported.error || null, skippedNotShift: data.imported.skippedNotShift || 0, skippedDeleted: data.imported.skippedDeleted || 0, skippedLegacy: data.imported.skippedLegacy || 0, repaired: data.imported.repaired || 0, unpriced: data.imported.unpriced || 0, skippedSuggested: data.imported.skippedSuggested || 0, suggestions: Array.isArray(data.imported.suggestions) ? data.imported.suggestions : [], newFacilities: Array.isArray(data.imported.newFacilities) ? data.imported.newFacilities : [], at: new Date().toISOString() };
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
  (data.pendingDeletions || []).forEach((p) => {
    if (!liveSyncState.pending.some((q) => q.provider === p.provider && q.shiftId === p.shiftId)) {
      liveSyncState.pending.push({ provider: p.provider, shiftId: p.shiftId, date: p.date || '', facility: p.facility || '', type: p.type || '', localMissing: !!p.localMissing });
    }
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
  return { created, updated, deleted, flagged: (data.pendingDeletions || []).length, newFacilities: suggestions, suggestions };
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
          msg += ' Imported ' + imp.created + ' shift(s) from “' + imp.sourceCalendarName + '”' + (imp.updated ? ', ' + imp.updated + ' updated' : '') + (imp.duplicates ? ', ' + imp.duplicates + ' already here' : '') + (typeof imp.seen === 'number' ? ' (' + imp.seen + ' event(s) seen, ' + (imp.parsed || 0) + ' looked like shifts' + (skipBits.length ? ', ' + skipBits.join(', ') + ' skipped' : '') + ')' : (imp.skipped ? ' (' + imp.skipped + ' event(s) skipped)' : '')) + '.';
          if (imp.unpriced) msg += ' ' + imp.unpriced + ' imported shift(s) have no pay rule yet — set the rate on the Facilities tab and the next sync prices them.';
          if (applied.suggestions && applied.suggestions.length) msg += ' We noticed shifts at ' + applied.suggestions.join(', ') + ' in your calendar. Add it as a facility? Sync your calendar, upload a contract, or manually enter the facility\'s hourly rate — see the Facilities tab.';
        }
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
  if (typeof SUPABASE_CONFIGURED !== 'undefined' && !SUPABASE_CONFIGURED) { alert('Supabase is not configured yet — sign-in is unavailable, so live calendar sync cannot start. See the Account tab.'); return; }
  if (typeof cloudSession === 'undefined' || !cloudSession) { alert('Sign in on the Account tab first — live calendar sync is per-user, so it needs your signed-in account.'); if (typeof setTab === 'function') setTab('Account'); return; }
  if (provider !== 'apple' && liveSyncConfig.state === 'ready' && !liveSyncConfig[provider]) {
    liveSyncWizard = true;
    render();
    alert('Live sync setup is not finished by the app owner yet for ' + liveSyncLabel(provider) + '. The owner-setup wizard below shows exactly what is still missing.');
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
  const password = pwEl ? pwEl.value : '';
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
    alert('Apple Calendar connected (' + LIVE_SYNC_STANDIN_LABEL + '). Now pick your work calendar below — for example “Caleb Work Schedule” — and sync: shifts are pulled from that calendar only. The app keeps its own calendar behind the scenes for shifts you add here.');
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
      alert('Apple Calendar connection failed: ' + e.message + '. Check the Apple ID and app-specific password (not your normal Apple password), then try again. Nothing was stored. (' + LIVE_SYNC_STANDIN_LABEL + ')');
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
// Explicit repair for shifts lost to an earlier undelivered sync:
// the server clears stale import records (paired shifts that never
// reached this device) and pulls them in fresh on this sync. Rows
// flagged as user-deleted are never cleared. Until migration 005 runs
// this can also bring back an imported shift the user deleted here —
// delete it again afterwards if it is not wanted.
async function liveSyncRepairImport() {
  if (!confirm('Re-import missing shifts from “' + (liveSyncConnections.apple && liveSyncConnections.apple.sourceCalendarName ? liveSyncConnections.apple.sourceCalendarName : 'your work calendar') + '”? Shifts that were paired by an earlier sync but never arrived will be pulled in again. Shifts you deleted on purpose stay deleted.')) return;
  liveSyncState.repairImport = true;
  liveSyncStateSave();
  await liveSyncNow('apple', false);
}
// Save the Apple work calendar picked in the connected Apple card,
// then sync immediately so the result ("imported N shifts from …")
// is visible at once instead of waiting for the next app open. Only
// the calendar URL + name are sent; the password is never involved
// here. In the final model this picker IS the connection: the user
// picks the existing calendar their shifts live in, and the app pulls
// from that calendar only.
async function liveSyncAppleSourceSave() {
  const sel = document.getElementById('f_liveAppleSource');
  const calendarUrl = sel ? sel.value : '';
  const picked = liveSyncAppleCalendars.find((c) => c.url === calendarUrl);
  const calendarName = picked ? (picked.name || '') : '';
  try {
    await liveSyncPost('sync-calendar', { action: 'set-apple-source-calendar', calendarUrl, calendarName });
    await liveSyncFetchStatus();
    await liveSyncFetchAppleCalendars();
    render();
    if (!calendarUrl) {
      alert('Work calendar cleared — Apple sync now uses the app’s own calendar only.');
      return;
    }
    await liveSyncNow('apple', false);
  } catch (e) {
    render();
    if (e.message === 'migration_004_required') {
      alert('The app owner still needs to run migration 004 (supabase-schema-004.sql) in the Supabase SQL Editor before a work calendar can be saved. Sync itself is unaffected — it still uses the app’s own calendar.');
    } else if (e.message === 'source_is_dedicated_calendar') {
      alert('That is the app’s own calendar — pick your work calendar instead.');
    } else {
      alert('Could not save that work calendar: ' + e.message + '. Nothing was changed.');
    }
  }
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

function liveSyncAction(action, entry) {
  if (action === 'live-connect') return liveSyncConnect(entry);
  if (action === 'live-disconnect') return liveSyncDisconnect(entry);
  if (action === 'live-sync-now') return liveSyncNow(entry, false);
  if (action === 'live-auto-delete') return liveSyncToggleAutoDelete(entry);
  if (action === 'live-apple-connect') return liveSyncAppleConnect();
  if (action === 'live-apple-pick') return liveSyncApplePickUse();
  if (action === 'live-apple-pick-cancel') { liveSyncApplePick = null; return render(); }
  if (action === 'live-apple-calendars') { liveSyncFetchAppleCalendars().then(() => render()); return; }
  if (action === 'live-apple-source-save') return liveSyncAppleSourceSave();
  if (action === 'live-apple-repair-import') return liveSyncRepairImport();
  if (action === 'live-wizard') { liveSyncWizard = !liveSyncWizard; return render(); }
  if (action === 'live-refresh') {
    liveSyncFetchConfig().then(() => liveSyncFetchStatus()).then(() => liveSyncFetchAppleCalendars()).then(() => liveSyncFetchLog()).then(() => render());
    return;
  }
  if (action === 'live-confirm-delete') return liveSyncResolvePending(entry, 'delete');
  if (action === 'live-keep') return liveSyncResolvePending(entry, 'keep');
}

function liveSyncProviderCard(provider) {
  const label = liveSyncLabel(provider);
  const conn = liveSyncConnections[provider];
  const configured = provider === 'apple' ? (liveSyncConfig.state === 'ready') : !!liveSyncConfig[provider];
  if (liveSyncConfig.state === 'unreachable') {
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Live sync could not be reached from this browser</span></div><div class="muted">The sync service did not answer from this browser — check your connection and tap “Refresh status &amp; log” below. No connection is faked.</div></div>';
  }
  if (liveSyncConfig.state === 'loading') {
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Checking setup…</span></div></div>';
  }
  if (!configured) {
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Live sync setup not finished by the app owner yet</span></div><div class="muted">The app owner has not registered this provider yet (see the owner-setup wizard below). Until then, use the manual .ics import/export below.</div><div class="item-actions"><button type="button" class="tiny secondary" data-action="live-wizard">Show owner-setup wizard</button></div></div>';
  }
  if (conn && conn.status === 'needs_reauth') {
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Needs reconnecting</span></div><div class="muted">Access expired or was revoked. Reconnect to restore sync. Nothing was deleted.</div><div class="item-actions"><button type="button" class="tiny" data-action="live-connect" data-id="' + provider + '">Reconnect</button></div></div>';
  }
  if (conn && conn.status === 'connected') {
    let card = '<div class="item"><div class="item-title">' + label + ' — <span class="pill">Connected</span></div><div class="muted">Last automatic sync: ' + escapeHTML(liveSyncWhen(conn.lastSyncedAt)) + ' · Auto-delete: ' + (conn.autoDelete ? 'ON (deletions apply without asking)' : 'OFF (deletions ask first)') + ' · Shifts you add or edit here go to the app’s own calendar, kept behind the scenes — your work calendar is never written to. Each shift shows its calendar state on Dashboard → Saved shifts.</div><div class="item-actions"><button type="button" class="tiny" data-action="live-sync-now" data-id="' + provider + '">' + (liveSyncBusy === provider ? 'Syncing…' : 'Sync now') + '</button><button type="button" class="tiny secondary" data-action="live-auto-delete" data-id="' + provider + '">' + (conn.autoDelete ? 'Turn auto-delete off' : 'Turn auto-delete on') + '</button><button type="button" class="tiny secondary" data-action="live-disconnect" data-id="' + provider + '">Disconnect</button></div>';
    if (provider === 'apple') {
      // Work calendar (final model): the user picks the ONE existing
      // calendar their shifts already live in — e.g. "Caleb Work
      // Schedule" — and each sync pulls from that calendar only.
      // Read-only pull: events are recognised as shifts from the
      // Facilities list (name or abbreviation, in the title or the
      // location — even just the facility name) and from other
      // facility-like shift titles; anything else is skipped, and
      // nothing is ever written back. A shift whose facility has no pay
      // rule yet imports unpriced — set the rule on the Facilities tab
      // and the next sync prices it; adding a facility also re-scans
      // events that were skipped before it existed.
      const current = conn.sourceCalendarUrl || '';
      const importable = liveSyncAppleCalendars.filter((c) => !c.isDedicated);
      let picker;
      if (!liveSyncAppleCalendars.length) {
        picker = '<p class="muted">Your iCloud calendars could not be listed yet.</p><div class="item-actions"><button type="button" class="tiny secondary" data-action="live-apple-calendars">Load my calendars</button></div>';
      } else if (!importable.length) {
        picker = '<p class="muted">No other iCloud calendar was found — only the app’s own calendar exists. Your shifts need to live in one of your own calendars for the app to pull them in.</p>';
      } else {
        const opts = '<option value="">No work calendar — app calendar only</option>' + importable.map((c) => '<option value="' + escapeHTML(c.url) + '"' + (c.url === current ? ' selected' : '') + '>' + escapeHTML(c.name || 'Unnamed calendar') + '</option>').join('');
        picker = '<div class="form-grid"><div class="field"><label for="f_liveAppleSource">Your work calendar</label><select id="f_liveAppleSource">' + opts + '</select></div></div><div class="item-actions"><button type="button" class="tiny" data-action="live-apple-source-save">Save work calendar &amp; sync now</button></div>';
      }
      card += '<div style="margin-top:10px"><div class="item-title">Your work calendar</div><div class="muted">Pick the calendar your shifts already live in — for example “Caleb Work Schedule” — and each sync pulls from that calendar only. The app recognises events from your Facilities tab (add each hospital first, with its abbreviations and pay rule): an event titled with the facility name or abbreviation — even just the facility name — imports as a shift, and other shift-like titles (e.g. “CAMC 8”) import too, but only for hospitals already on your Facilities tab. Shifts at a hospital that is not listed yet are held, not imported: the sync suggests the hospital, and once you add it with its pay rule, the next sync pulls those shifts in and prices them. Events that are not work shifts are skipped. Nothing is ever written back to that calendar, and a shift you delete here is never re-imported.</div>' + picker + '</div>';
      const li = liveSyncState.lastImport;
      if (li && li.provider === 'apple') {
        const skipBits = [];
        if (li.skippedNotShift) skipBits.push(li.skippedNotShift + ' not shifts');
        if (li.skippedDeleted) skipBits.push(li.skippedDeleted + ' you deleted');
        if (li.skippedLegacy) skipBits.push(li.skippedLegacy + ' skipped until migration 005 runs');
        if (li.repaired) skipBits.push(li.repaired + ' re-imported after a missed sync');
        if (li.unpriced) skipBits.push(li.unpriced + ' unpriced — set the pay rule on the Facilities tab');
        if (li.skippedSuggested) skipBits.push(li.skippedSuggested + ' held — new hospital suggestion, see Facilities tab');
        if (li.suggestions && li.suggestions.length) skipBits.push('suggested: ' + li.suggestions.map((x) => x.name || x).join(', '));
        card += '<p class="muted">Last import' + (li.at ? ' (' + escapeHTML(liveSyncWhen(li.at)) + ')' : '') + ': ' + (li.error ? 'failed (' + escapeHTML(li.error) + ')' : 'imported ' + li.created + ' shift(s) from “' + escapeHTML(li.sourceName || '') + '”' + (li.updated ? ', ' + li.updated + ' updated' : '') + (li.duplicates ? ', ' + li.duplicates + ' already here' : '') + (typeof li.seen === 'number' ? ' (' + li.seen + ' event(s) seen, ' + (li.parsed || 0) + ' looked like shifts' + (skipBits.length ? ', ' + skipBits.join(', ') + ' skipped' : (li.skipped ? ', ' + li.skipped + ' skipped' : '')) + ')' : (li.skipped ? ', ' + li.skipped + ' event(s) skipped (not shifts)' : ''))) + '.</p>';
        // An import that skipped shifts usually means an earlier sync
        // paired them without ever delivering them. Offer the explicit
        // repair whenever anything was skipped as deleted/legacy (not
        // only when nothing was created — a partial import like 12
        // created / 219 skipped still needs it).
        if (!li.error && ((li.skippedDeleted || 0) > 0 || (li.skippedLegacy || 0) > 0 || (li.created === 0 && (li.skipped || 0) > 0 && (li.parsed || 0) > 0))) {
          card += '<div class="item-actions"><button type="button" class="tiny secondary" data-action="live-apple-repair-import">Re-import missing shifts</button></div><p class="muted">Use this if shifts you expect are still missing: it clears the stale records from the earlier interrupted sync and pulls them in again. Shifts you deleted on purpose stay deleted.</p>';
        }
      } else if (current) {
        card += '<p class="muted">Work calendar: “' + escapeHTML(conn.sourceCalendarName || current) + '”. No import has run yet — tap “Sync now”.</p>';
      }
    }
    return card + '</div>';
  }
  if (provider === 'apple') {
    if (liveSyncApplePick && liveSyncApplePick.calendars.length) {
      const opts = liveSyncApplePick.calendars.map((c) => '<option value="' + escapeHTML(c.url) + '">' + escapeHTML(c.name || 'Unnamed calendar') + '</option>').join('');
      return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Pick your work calendar</span></div><div class="muted">In the finished app this picker is the whole connection: grant calendar access, pick the calendar your shifts already live in, and the app pulls from that calendar only. The app keeps its own calendar behind the scenes — you never create or label one. (In this preview your sign-in already worked, but iCloud would not let the preview create its own calendar, so pick one of your existing calendars below. CRNA Hub only writes its own shifts there — it will not read, move, or delete your other events.)</div><div class="form-grid"><div class="field"><label for="f_liveApplePick">Your work calendar</label><select id="f_liveApplePick">' + opts + '</select></div></div><div class="item-actions"><button type="button" class="tiny" data-action="live-apple-pick">Connect to this calendar</button><button type="button" class="tiny secondary" data-action="live-apple-pick-cancel">Cancel</button></div></div>';
    }
    // Final flow, stated first: one tap, grant access, pick the work
    // calendar. The password form below it is fenced off as a
    // PREVIEW STAND-IN — a web page cannot use EventKit, so this
    // preview connects through CalDAV with a one-time app-specific
    // password instead. It is never presented as the designed path.
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Not connected</span></div><div class="muted">In the finished app this is one tap: grant calendar access, pick the calendar your shifts already live in, and the app pulls from that calendar only. The app keeps its own calendar behind the scenes — you never create or label one, and your work calendar is never written to.</div><div class="preview-standin"><div class="item-title"><span class="pill warn">' + LIVE_SYNC_STANDIN_LABEL + '</span></div><div class="muted">This web preview cannot use EventKit, so Apple connects here through a one-time <strong>app-specific password</strong> instead: create one in your Apple account (appleid.apple.com → Sign-In and Security → App-Specific Passwords), then enter it here once. It goes straight to the server-side sync function, is stored encrypted there, and is never stored on this device or shown again. Revoking it disconnects sync at once. Never enter your normal Apple password here.</div><div class="form-grid"><div class="field"><label for="f_liveAppleId">Apple ID</label><input id="f_liveAppleId" type="email" autocomplete="username" placeholder="you@icloud.com"></div><div class="field"><label for="f_liveApplePw">App-specific password (one-time)</label><input id="f_liveApplePw" type="password" autocomplete="off" placeholder="xxxx-xxxx-xxxx-xxxx"></div></div><div class="item-actions"><button type="button" class="tiny" data-action="live-apple-connect">Connect Apple Calendar</button></div></div></div>';
  }
  return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Not connected</span></div><div class="muted">One click to the provider consent screen, then back here — pick the calendar your shifts already live in and the app pulls from that calendar only. No files to upload, no passwords typed into this app. The app keeps its own calendar behind the scenes — you never create or label one.</div><div class="item-actions"><button type="button" class="tiny" data-action="live-connect" data-id="' + provider + '">Connect ' + label + '</button></div></div>';
}

function liveSyncWizardHTML() {
  const base = liveSyncProjectUrl();
  const googleUri = base + '/functions/v1/google-auth';
  const outlookUri = base + '/functions/v1/outlook-auth';
  return '<div class="panel" style="margin-top:14px"><h3>Owner-setup wizard — what is still missing, and nothing else</h3>'
    + '<p class="muted">Live sync turns on the moment the owner finishes these steps — no app change is needed. End users never see this wizard unless setup is unfinished.</p>'
    + '<ol>'
    + '<li><strong>Run migration 003</strong> in the Supabase SQL Editor: <code>supabase/supabase-schema-003.sql</code> (tables for connections, sync map, OAuth state, pending deletions, sync log).</li>'
    + '<li><strong>Run migration 004</strong> in the Supabase SQL Editor: <code>supabase/supabase-schema-004.sql</code> (Apple work-calendar choice + import pairing table). Without it, sync still works, but the Apple work-calendar picker cannot save a choice.</li>'
    + '<li><strong>Run migration 005</strong> in the Supabase SQL Editor: <code>supabase/supabase-schema-005.sql</code> (delivery flags on the import pairing table, so a shift lost to an interrupted sync is repaired instead of skipped forever as if deleted). Without it, sync still works, but the Apple card offers a manual “Re-import missing shifts” button instead of repairing automatically.</li>'
    + '<li><strong>Deploy the functions:</strong> <code>supabase link --project-ref xgoghgihfhtnyevgapyp</code>, then <code>supabase functions deploy google-auth outlook-auth sync-calendar</code> (or <code>sh supabase/deploy-calendar-sync.sh</code>).</li>'
    + '<li><strong>Set function secrets</strong> (server side only, never in this repo): <code>APP_URL</code> = the URL users open, <code>CALENDAR_ENCRYPTION_KEY</code> = output of <code>openssl rand -hex 32</code>, plus the provider IDs/secrets below.</li>'
    + '<li><strong>Google Cloud (once):</strong> enable the Google Calendar API; create a Web OAuth client; authorized redirect URI (exact): <code>' + escapeHTML(googleUri) + '</code>; scope: <code>https://www.googleapis.com/auth/calendar</code>. Copy the client ID + secret into function secrets as <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code>. Add test users if Google requires verification.</li>'
    + '<li><strong>Microsoft Entra (once):</strong> new app registration, Web redirect URI (exact): <code>' + escapeHTML(outlookUri) + '</code>; delegated Graph permissions <code>Calendars.ReadWrite</code>, <code>offline_access</code>, <code>openid</code>, <code>profile</code>. Copy the client ID + secret into function secrets as <code>OUTLOOK_CLIENT_ID</code> / <code>OUTLOOK_CLIENT_SECRET</code>.</li>'
    + '<li><strong>Apple: nothing for the owner to register — and in the finished native app, nothing for the user to type either.</strong> The finished app uses EventKit on the device (no password, no CalDAV, no owner setup). In this web preview only, each user creates their own app-specific password once — see the “Preview stand-in” box on the Apple card — because a web page cannot use EventKit. That password path is a preview stand-in, not the designed flow.</li>'
    + '</ol>'
    + '<p class="muted">How the app knows: it calls the sync function’s public config check. If the function is unreachable, or a provider’s ID/secret is not set, that provider says “Live sync setup not finished by the app owner yet” instead of faking a connection. Full steps: <code>supabase/functions/README.md</code>.</p>'
    + '<div class="toolbar"><button type="button" class="secondary tiny" data-action="live-refresh">Recheck setup now</button><button type="button" class="secondary tiny" data-action="live-wizard">Hide wizard</button></div></div>';
}

function liveSyncPanelHTML() {
  let html = '<h2>Live calendar sync</h2>';
  if (typeof SUPABASE_CONFIGURED !== 'undefined' && !SUPABASE_CONFIGURED) {
    html += '<p><strong>Sign-in is not configured yet, so live sync cannot start.</strong> It needs a signed-in account (see the Account tab). The manual .ics import/export below works without sign-in.</p>';
    html += '<p class="muted">Conflict rule, once connected: newest edit wins; deletions never happen silently — they wait below in Pending deletions unless auto-delete was explicitly turned on (default off).</p>';
  } else if (typeof cloudSession === 'undefined' || !cloudSession) {
    html += '<p><strong>Sign in on the Account tab first.</strong> Live calendar sync is per-user — your provider connection and tokens belong to your signed-in account, so there is nothing to connect until then.</p>';
    html += '<div class="toolbar"><button type="button" class="secondary" data-action="goto-account">Go to Account tab</button><button type="button" class="secondary" data-action="live-wizard">Owner-setup wizard</button></div>';
    if (liveSyncWizard) html += liveSyncWizardHTML();
    html += '<p class="muted">Manual fallback (works today, no sign-in): .ics import/export below.</p>';
  } else {
    html += '<p class="muted">Connect once per provider, then pick the calendar your shifts already live in — the app pulls from that calendar only. The app keeps its own calendar behind the scenes for the shifts you add here: you never create or label a calendar, and your work calendar is never written to. Sync runs when you open the app, on “Sync now”, and shortly after you add, edit, or delete a shift. It cannot run while the app is closed — shifts live on this device, not in a server-side table yet. (Apple in this web preview still connects through the “Preview stand-in” box on its card — the finished native app uses EventKit, no password needed.)</p>';
    if (liveSyncError) html += '<p class="hint">Last sync problem: ' + escapeHTML(liveSyncError) + '</p>';
    if (typeof facilitySuggestionsHTML === 'function') html += facilitySuggestionsHTML();
    html += liveSyncProviderCard('google') + liveSyncProviderCard('outlook') + liveSyncProviderCard('apple');
    html += '<div class="toolbar"><button type="button" class="secondary tiny" data-action="live-refresh">Refresh status &amp; log</button>' + (liveSyncConfig.state === 'ready' ? '' : '<button type="button" class="secondary tiny" data-action="live-wizard">' + (liveSyncWizard ? 'Hide owner-setup wizard' : 'Owner-setup wizard') + '</button>') + '</div>';
    if (liveSyncWizard && liveSyncConfig.state !== 'ready') html += liveSyncWizardHTML();
    if (liveSyncState.pending.length) {
      html += '<h3>Pending deletions — your confirmation needed</h3><p class="muted">These shifts were deleted (or went missing) on the provider side. Nothing has been deleted here yet. “Delete here too” removes the CRNA Hub shift; “Keep here” keeps it and re-creates it in the calendar at the next sync.</p>';
      liveSyncState.pending.forEach((p) => {
        const key = p.provider + '|' + p.shiftId;
        html += '<div class="item"><div class="item-title">' + escapeHTML(p.date || '') + ' · ' + escapeHTML(p.facility || '') + ' · ' + escapeHTML(p.type || '') + '</div><div class="muted">' + escapeHTML(liveSyncLabel(p.provider)) + (p.localMissing ? ' · shift no longer on this device — delete it from the calendar, or stop tracking it' : ' · deleted in the calendar') + '</div><div class="item-actions"><button type="button" class="tiny danger" data-action="live-confirm-delete" data-id="' + escapeHTML(key) + '">' + (p.localMissing ? 'Delete from calendar' : 'Delete here too') + '</button><button type="button" class="tiny secondary" data-action="live-keep" data-id="' + escapeHTML(key) + '">' + (p.localMissing ? 'Stop tracking it' : 'Keep here') + '</button></div></div>';
      });
    }
    html += '<h3>Sync log</h3>';
    if (!liveSyncLog.length) {
      html += '<p class="muted">No sync runs yet.</p>';
    } else {
      html += liveSyncLog.slice(0, 15).map((r) => '<div class="item"><div class="muted">' + escapeHTML(liveSyncWhen(r.created_at)) + ' · ' + escapeHTML(r.provider) + ' · ' + escapeHTML(r.direction || 'both') + ' · created ' + (r.shifts_created || 0) + ' · updated ' + (r.shifts_updated || 0) + ' · flagged ' + (r.shifts_flagged || 0) + ' · deleted ' + (r.shifts_deleted || 0) + (r.error ? ' · error: ' + escapeHTML(r.error) : '') + '</div></div>').join('');
    }
    html += '<p class="muted">Conflict rule: newest edit wins. Deletions wait above unless auto-delete is on for that provider.</p>';
  }
  return html;
}

async function liveSyncInit() {
  // Handle the return from a provider consent screen.
  try {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('calendar_connected');
    const failed = params.get('calendar_error');
    if (connected || failed) {
      window.history.replaceState({}, '', window.location.pathname);
      if (connected) alert(liveSyncLabel(connected) + ' connected — live sync is on.');
      if (failed) alert('Calendar connection failed: ' + failed + '. Nothing was stored. Try Connect again.');
    }
  } catch (e) {}
  if (typeof SUPABASE_CONFIGURED === 'undefined' || !SUPABASE_CONFIGURED) return;
  if (typeof cloudSession === 'undefined' || !cloudSession) return;
  await liveSyncFetchConfig();
  await liveSyncFetchStatus();
  await liveSyncFetchAppleCalendars();
  await liveSyncFetchLog();
  const connected = liveSyncConnectedProviders();
  if (connected.length) {
    // Automatic sync on open, silent: failures surface in the panel/log,
    // never as a blocking popup on every load.
    for (const p of connected) await liveSyncNow(p, true);
  }
  render();
}

// Expose the one entry point app.js hooks call after shift changes.
if (typeof window !== 'undefined') {
  window.liveSyncInit = liveSyncInit;
  window.liveSyncSchedulePush = liveSyncSchedulePush;
  window.liveSyncRecordTombstone = liveSyncRecordTombstone;
  window.liveSyncShiftSyncLabel = liveSyncShiftSyncLabel;
  window.liveSyncMarkShiftNotSynced = liveSyncMarkShiftNotSynced;
}
liveSyncInit();
