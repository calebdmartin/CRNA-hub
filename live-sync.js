'use strict';
// CRNA Hub — live calendar sync client (Google / Outlook / Apple).
//
// Loaded after app.js (see index.html). All provider tokens live
// server-side only, in the Supabase Edge Functions in supabase/functions/.
// This file NEVER holds, stores, or logs a token, client secret, or
// app-specific password:
//   - Google/Outlook: the browser is redirected to the provider's consent
//     screen; tokens are exchanged and stored by the Edge Function.
//   - Apple: the app-specific password is sent once, over HTTPS, to the
//     Edge Function's connect-apple action, which validates it and stores
//     only its AES-GCM ciphertext. The password field is cleared
//     immediately after sending, and the value is never written to
//     localStorage, a backup, or the repo.
// What IS kept on this device (localStorage key 'crna-hub-live-sync'):
//   pending deletions awaiting the user's decision, and tombstones for
//   locally deleted shifts (shift id + provider only — no credentials).
// Sync runs when the app is open: on load for connected providers, on
// "Sync now", and shortly after a shift is added, edited, or deleted.
// It cannot run while the app is closed, because shifts live on this
// device, not in a server-side shifts table (see the README).
// Conflict rule: newest edit wins (updatedAt timestamps, both sides);
// deletions are never silent — a provider-side deletion waits in
// "Pending deletions" until the user confirms it, unless auto-delete was
// explicitly turned on for that provider (default off).

let liveSyncConfig = { state: 'loading', google: false, outlook: false, apple: false, encryption: false };
let liveSyncConnections = {}; // provider -> {status, autoDelete, lastSyncedAt}
let liveSyncLog = [];
let liveSyncWizard = false;
let liveSyncError = '';
let liveSyncBusy = '';
// Pending Apple pick-an-existing-calendar flow: iCloud refused to create
// a new calendar, so the user chooses one of their existing calendars.
// Holds the Apple ID + app-specific password only until the pick is made
// or cancelled; never persisted, never stored on this device.
let liveSyncApplePick = null; // { appleId, password, calendars: [{url, name}] }
// Apple import-source picker: the user's iCloud calendars, listed
// server-side (never the password). Empty until fetched for a connected
// Apple account; the dedicated "CRNA Hub" calendar is flagged on each
// entry (isDedicated) and excluded from the picker.
let liveSyncAppleCalendars = [];
let liveSyncPushTimer = null;

function liveSyncStateLoad() {
  try {
    const v = JSON.parse(localStorage.getItem('crna-hub-live-sync') || 'null');
    if (v && typeof v === 'object') return { pending: Array.isArray(v.pending) ? v.pending : [], tombstones: Array.isArray(v.tombstones) ? v.tombstones : [], lastImport: (v.lastImport && typeof v.lastImport === 'object') ? v.lastImport : null };
  } catch (e) {}
  return { pending: [], tombstones: [], lastImport: null };
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

function liveSyncApplyChanges(provider, data) {
  const changes = data.providerChanges || [];
  let created = 0, updated = 0, deleted = 0;
  changes.forEach((ch) => {
    if (ch.action === 'create' && ch.shift) {
      const s = ch.shift;
      if (db.shifts.some((x) => x.date === s.date && x.facility === s.facility && x.type === s.type)) return;
      // Imported shifts arrive with source 'apple-import' (and a note
      // naming the calendar they came from); dedicated-calendar shifts
      // carry no source and default to 'calendar-<provider>'.
      db.shifts.push({ id: s.id, date: s.date, facility: s.facility, type: s.type, pay: s.pay ? String(s.pay) : '', note: s.note || '', source: s.source || ('calendar-' + provider), status: 'proposed', incomplete: !String(s.pay || '').trim(), updatedAt: s.updatedAt || null });
      created++;
    } else if (ch.action === 'update' && ch.shift) {
      const s = ch.shift, x = db.shifts.find((y) => y.id === s.id);
      if (!x) return;
      x.date = s.date; x.facility = s.facility; x.type = s.type;
      x.pay = s.pay ? String(s.pay) : x.pay; x.note = s.note || '';
      x.source = s.source || x.source || ('calendar-' + provider); x.updatedAt = s.updatedAt || x.updatedAt;
      updated++;
    } else if (ch.action === 'delete' && ch.shiftId) {
      db.shifts = db.shifts.filter((x) => x.id !== ch.shiftId);
      deleted++;
    }
  });
  // Remember the last Apple import result so the panel can say
  // "imported N shifts from Caleb Work Schedule" after the alert closes.
  if (data.imported && typeof data.imported === 'object') {
    liveSyncState.lastImport = { provider, sourceName: data.imported.sourceCalendarName || '', created: data.imported.created || 0, updated: data.imported.updated || 0, skipped: data.imported.skipped || 0, duplicates: data.imported.duplicates || 0, error: data.imported.error || null, at: new Date().toISOString() };
  }
  (data.pendingDeletions || []).forEach((p) => {
    if (!liveSyncState.pending.some((q) => q.provider === p.provider && q.shiftId === p.shiftId)) {
      liveSyncState.pending.push({ provider: p.provider, shiftId: p.shiftId, date: p.date || '', facility: p.facility || '', type: p.type || '', localMissing: !!p.localMissing });
    }
  });
  // Tombstones for this provider are cleared after a successful sync.
  // If the server failed to delete a provider event, the next sync flags
  // it as a pending deletion instead — nothing is silently lost.
  liveSyncState.tombstones = liveSyncState.tombstones.filter((t) => t.provider !== provider);
  liveSyncStateSave();
  persist();
  return { created, updated, deleted, flagged: (data.pendingDeletions || []).length };
}

async function liveSyncNow(provider, silent) {
  if (typeof cloudSession === 'undefined' || !cloudSession) return;
  liveSyncBusy = provider;
  liveSyncError = '';
  try {
    const payload = {
      action: 'sync',
      provider,
      localShifts: db.shifts.map((x) => ({ id: x.id, date: x.date, facility: x.facility, type: x.type, pay: x.pay, note: x.note || '', updatedAt: x.updatedAt || null })),
      tombstones: liveSyncState.tombstones.filter((t) => t.provider === provider).map((t) => ({ shiftId: t.shiftId })),
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
          msg += ' Import from “' + data.imported.sourceCalendarName + '” failed (' + data.imported.error + ') — the dedicated-calendar sync above still ran; try Sync now again.';
        } else {
          msg += ' Imported ' + data.imported.created + ' shift(s) from “' + data.imported.sourceCalendarName + '”' + (data.imported.updated ? ', ' + data.imported.updated + ' updated' : '') + (data.imported.duplicates ? ', ' + data.imported.duplicates + ' already here' : '') + (data.imported.skipped ? ' (' + data.imported.skipped + ' event(s) in that calendar were not shifts and were skipped)' : '') + '.';
        }
      }
      alert(msg);
    }
  } catch (e) {
    liveSyncBusy = '';
    liveSyncError = e.message;
    if (e.message === 'needs_reauth' || e.message === 'not_connected') {
      await liveSyncFetchStatus();
      render();
      if (!silent) alert(liveSyncLabel(provider) + ' needs reconnecting — click Connect again and approve access. Nothing was deleted.');
    } else if (!silent) {
      alert('Sync with ' + liveSyncLabel(provider) + ' failed: ' + e.message + '. Nothing was deleted. See the sync log below.');
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
    alert('Apple Calendar connected. Shifts will sync with your dedicated “CRNA Hub” calendar. If your shifts live in another calendar (for example “Caleb Work Schedule”), pick it below under “Import shifts from” and sync — those shifts will be pulled in.');
  } catch (e) {
    // iCloud refused to create a new calendar: offer the user's
    // existing calendars instead of failing the whole connect.
    const cals = e.data && Array.isArray(e.data.calendars) ? e.data.calendars : null;
    if (e.message === 'apple_create_forbidden_pick_calendar' && cals) {
      liveSyncApplePick = { appleId, password, calendars: cals };
      render();
      if (!cals.length) {
        alert('iCloud would not let CRNA Hub create a new calendar, and no existing calendars were found. Create a calendar in the Apple Calendar app first, then try connecting again. Nothing was stored.');
      } else {
        alert('iCloud would not let CRNA Hub create a new calendar — your sign-in is fine. Pick one of your existing calendars below to sync with instead. Nothing was stored yet.');
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
// Save the Apple import-source calendar picked in the connected Apple
// card, then sync immediately so the result ("imported N shifts from …")
// is visible at once instead of waiting for the next app open. Only the
// calendar URL + name are sent; the password is never involved here.
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
      alert('Import source cleared — Apple sync now uses the dedicated “CRNA Hub” calendar only.');
      return;
    }
    await liveSyncNow('apple', false);
  } catch (e) {
    render();
    if (e.message === 'migration_004_required') {
      alert('The app owner still needs to run migration 004 (supabase-schema-004.sql) in the Supabase SQL Editor before an import source can be saved. Sync itself is unaffected — it still uses the dedicated “CRNA Hub” calendar.');
    } else if (e.message === 'source_is_dedicated_calendar') {
      alert('That is the dedicated “CRNA Hub” calendar — pick a different calendar to import from.');
    } else {
      alert('Could not save that import source: ' + e.message + '. Nothing was changed.');
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
    let card = '<div class="item"><div class="item-title">' + label + ' — <span class="pill">Connected</span></div><div class="muted">Last automatic sync: ' + escapeHTML(liveSyncWhen(conn.lastSyncedAt)) + ' · Auto-delete: ' + (conn.autoDelete ? 'ON (deletions apply without asking)' : 'OFF (deletions ask first)') + ' · Shifts you add or edit here go to the dedicated “CRNA Hub” calendar only.</div><div class="item-actions"><button type="button" class="tiny" data-action="live-sync-now" data-id="' + provider + '">' + (liveSyncBusy === provider ? 'Syncing…' : 'Sync now') + '</button><button type="button" class="tiny secondary" data-action="live-auto-delete" data-id="' + provider + '">' + (conn.autoDelete ? 'Turn auto-delete off' : 'Turn auto-delete on') + '</button><button type="button" class="tiny secondary" data-action="live-disconnect" data-id="' + provider + '">Disconnect</button></div>';
    if (provider === 'apple') {
      // Import source: the dedicated calendar starts empty, so shifts
      // that live in another iCloud calendar (e.g. "Caleb Work
      // Schedule") never arrive unless the user picks that calendar
      // here. Read-only pull: only Holzer-titled events become shifts,
      // anything else is skipped, and nothing is ever written back.
      const current = conn.sourceCalendarUrl || '';
      const importable = liveSyncAppleCalendars.filter((c) => !c.isDedicated);
      let picker;
      if (!liveSyncAppleCalendars.length) {
        picker = '<p class="muted">Your iCloud calendars could not be listed yet.</p><div class="item-actions"><button type="button" class="tiny secondary" data-action="live-apple-calendars">Load my calendars</button></div>';
      } else if (!importable.length) {
        picker = '<p class="muted">No other iCloud calendar was found to import from — only the dedicated “CRNA Hub” calendar exists.</p>';
      } else {
        const opts = '<option value="">No import — “CRNA Hub” calendar only</option>' + importable.map((c) => '<option value="' + escapeHTML(c.url) + '"' + (c.url === current ? ' selected' : '') + '>' + escapeHTML(c.name || 'Unnamed calendar') + '</option>').join('');
        picker = '<div class="form-grid"><div class="field"><label for="f_liveAppleSource">Import shifts from</label><select id="f_liveAppleSource">' + opts + '</select></div></div><div class="item-actions"><button type="button" class="tiny" data-action="live-apple-source-save">Save import source &amp; sync now</button></div>';
      }
      card += '<div style="margin-top:10px"><div class="item-title">Import shifts from another calendar</div><div class="muted">Your work shifts live in “Caleb Work Schedule”, not in the empty “CRNA Hub” calendar — pick it here and each sync pulls its Holzer shifts in (Holzer 8, Holzer 8/2nd call, Holzer 24/1st call, Holzer 10…). Events that are not Holzer shifts are skipped, never imported. Nothing is ever written back to that calendar, and a shift you delete here is never re-imported.</div>' + picker + '</div>';
      const li = liveSyncState.lastImport;
      if (li && li.provider === 'apple') {
        card += '<p class="muted">Last import' + (li.at ? ' (' + escapeHTML(liveSyncWhen(li.at)) + ')' : '') + ': ' + (li.error ? 'failed (' + escapeHTML(li.error) + ')' : 'imported ' + li.created + ' shift(s) from “' + escapeHTML(li.sourceName || '') + '”' + (li.updated ? ', ' + li.updated + ' updated' : '') + (li.duplicates ? ', ' + li.duplicates + ' already here' : '') + (li.skipped ? ', ' + li.skipped + ' event(s) skipped (not shifts)' : '')) + '.</p>';
      } else if (current) {
        card += '<p class="muted">Import source: “' + escapeHTML(conn.sourceCalendarName || current) + '”. No import has run yet — tap “Sync now”.</p>';
      }
    }
    return card + '</div>';
  }
  if (provider === 'apple') {
    if (liveSyncApplePick && liveSyncApplePick.calendars.length) {
      const opts = liveSyncApplePick.calendars.map((c) => '<option value="' + escapeHTML(c.url) + '">' + escapeHTML(c.name || 'Unnamed calendar') + '</option>').join('');
      return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Pick a calendar</span></div><div class="muted">iCloud would not let CRNA Hub create a new calendar, but your sign-in worked. Choose one of your existing calendars to sync shifts with — CRNA Hub will only write its own shifts there, and will not read, move, or delete your other events.</div><div class="form-grid"><div class="field"><label for="f_liveApplePick">Use this calendar</label><select id="f_liveApplePick">' + opts + '</select></div></div><div class="item-actions"><button type="button" class="tiny" data-action="live-apple-pick">Connect to this calendar</button><button type="button" class="tiny secondary" data-action="live-apple-pick-cancel">Cancel</button></div></div>';
    }
    return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Not connected</span></div><div class="muted">Apple has no one-click OAuth for calendar apps, so this one is honestly different: create an <strong>app-specific password</strong> once in your Apple account (appleid.apple.com → Sign-In and Security → App-Specific Passwords), then enter it here once. It goes straight to the server-side sync function, is stored encrypted there, and is never stored on this device or shown again. Revoking it in your Apple account disconnects sync at once. Never enter your normal Apple password here.</div><div class="form-grid"><div class="field"><label for="f_liveAppleId">Apple ID</label><input id="f_liveAppleId" type="email" autocomplete="username" placeholder="you@icloud.com"></div><div class="field"><label for="f_liveApplePw">App-specific password (one-time)</label><input id="f_liveApplePw" type="password" autocomplete="off" placeholder="xxxx-xxxx-xxxx-xxxx"></div></div><div class="item-actions"><button type="button" class="tiny" data-action="live-apple-connect">Connect Apple Calendar</button></div></div>';
  }
  return '<div class="item"><div class="item-title">' + label + ' — <span class="pill warn">Not connected</span></div><div class="muted">One click to the provider consent screen, then back here — no files to upload, no passwords typed into this app. Syncs to the dedicated “CRNA Hub” calendar only.</div><div class="item-actions"><button type="button" class="tiny" data-action="live-connect" data-id="' + provider + '">Connect ' + label + '</button></div></div>';
}

function liveSyncWizardHTML() {
  const base = liveSyncProjectUrl();
  const googleUri = base + '/functions/v1/google-auth';
  const outlookUri = base + '/functions/v1/outlook-auth';
  return '<div class="panel" style="margin-top:14px"><h3>Owner-setup wizard — what is still missing, and nothing else</h3>'
    + '<p class="muted">Everything in the app and the Edge Functions is already built. Live sync turns on the moment the owner finishes these steps — no app change is needed after that. End users never see this wizard unless setup is unfinished.</p>'
    + '<ol>'
    + '<li><strong>Run migration 003</strong> in the Supabase SQL Editor: <code>supabase/supabase-schema-003.sql</code> (tables for connections, sync map, OAuth state, pending deletions, sync log).</li>'
    + '<li><strong>Run migration 004</strong> in the Supabase SQL Editor: <code>supabase/supabase-schema-004.sql</code> (Apple import-source calendar choice + import pairing table). Without it, sync still works, but the Apple “Import shifts from” picker cannot save a source.</li>'
    + '<li><strong>Deploy the functions:</strong> <code>supabase link --project-ref xgoghgihfhtnyevgapyp</code>, then <code>supabase functions deploy google-auth outlook-auth sync-calendar</code> (or <code>sh supabase/deploy-calendar-sync.sh</code>).</li>'
    + '<li><strong>Set function secrets</strong> (server side only, never in this repo): <code>APP_URL</code> = the URL users open, <code>CALENDAR_ENCRYPTION_KEY</code> = output of <code>openssl rand -hex 32</code>, plus the provider IDs/secrets below.</li>'
    + '<li><strong>Google Cloud (once):</strong> enable the Google Calendar API; create a Web OAuth client; authorized redirect URI (exact): <code>' + escapeHTML(googleUri) + '</code>; scope: <code>https://www.googleapis.com/auth/calendar</code>. Copy the client ID + secret into function secrets as <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code>. Add test users if Google requires verification.</li>'
    + '<li><strong>Microsoft Entra (once):</strong> new app registration, Web redirect URI (exact): <code>' + escapeHTML(outlookUri) + '</code>; delegated Graph permissions <code>Calendars.ReadWrite</code>, <code>offline_access</code>, <code>openid</code>, <code>profile</code>. Copy the client ID + secret into function secrets as <code>OUTLOOK_CLIENT_ID</code> / <code>OUTLOOK_CLIENT_SECRET</code>.</li>'
    + '<li><strong>Apple: nothing for the owner to register.</strong> Each user creates their own app-specific password once (see the Apple card above). That is the one step that cannot be one-click OAuth, because Apple does not offer OAuth for third-party calendar apps.</li>'
    + '</ol>'
    + '<p class="muted">How the app knows: it calls the sync function’s public config check. If the function is unreachable, or a provider’s ID/secret is not set, that provider’s button says “Live sync setup not finished by the app owner yet” instead of faking a connection. Full steps: <code>supabase/functions/README.md</code>.</p>'
    + '<div class="toolbar"><button type="button" class="secondary tiny" data-action="live-refresh">Recheck setup now</button><button type="button" class="secondary tiny" data-action="live-wizard">Hide wizard</button></div></div>';
}

function liveSyncPanelHTML() {
  let html = '<h2>Live calendar sync</h2>';
  if (typeof SUPABASE_CONFIGURED !== 'undefined' && !SUPABASE_CONFIGURED) {
    html += '<p><strong>Sign-in is not configured yet, so live sync cannot start.</strong> Live sync is per-user and needs a signed-in account (see the Account tab). The manual .ics import/export below works without sign-in.</p>';
    html += '<p class="muted">Conflict rule, once connected: newest edit wins; deletions never happen silently — they wait below in Pending deletions unless auto-delete was explicitly turned on (default off).</p>';
  } else if (typeof cloudSession === 'undefined' || !cloudSession) {
    html += '<p><strong>Sign in on the Account tab first.</strong> Live calendar sync is per-user: your provider connection and tokens belong to your signed-in account, so there is nothing to connect until you are signed in.</p>';
    html += '<div class="toolbar"><button type="button" class="secondary" data-action="goto-account">Go to Account tab</button><button type="button" class="secondary" data-action="live-wizard">Owner-setup wizard</button></div>';
    if (liveSyncWizard) html += liveSyncWizardHTML();
    html += '<p class="muted">Manual fallback (works today, no sign-in): .ics import/export below.</p>';
  } else {
    html += '<p class="muted">Connect once per provider — then sync runs automatically when you open the app, on “Sync now”, and shortly after you add, edit, or delete a shift. It cannot run while the app is closed: shifts live on this device, not in a server-side table yet. Syncs write to a dedicated “CRNA Hub” calendar in each provider; your other calendars are never written to. Apple can also <strong>read</strong> one calendar you pick (see the Apple card) to pull your existing shifts in.</p>';
    if (liveSyncError) html += '<p class="hint">Last sync problem: ' + escapeHTML(liveSyncError) + '</p>';
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
    html += '<p class="muted">Conflict rule: newest edit wins (timestamps on both sides; equal timestamps keep the local copy). Deletions wait above unless auto-delete is on for that provider.</p>';
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
}
liveSyncInit();
