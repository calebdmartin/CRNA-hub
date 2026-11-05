// CRNA Hub — live calendar sync engine (Edge Function).
//
// Endpoints (all under /functions/v1/sync-calendar):
//   GET  ?action=config   (public, booleans only — no user data)
//        -> { ok, google, outlook, apple, encryption }
//        google/outlook are true only when the owner has set that
//        provider's client ID + secret as function secrets. apple is true
//        whenever this function is reachable, because Apple needs no
//        owner-registered OAuth app — only the user's one-time
//        app-specific password (see connect-apple below).
//   GET  ?action=status   (auth) -> per-provider connection status.
//   GET  ?action=log      (auth) -> recent sync_log rows for this user.
//   POST { action: "sync", provider, localShifts, tombstones } (auth)
//        -> two-way sync for one provider (see algorithm below).
//   POST { action: "connect-apple", appleId, appSpecificPassword } (auth)
//        -> validates the password with CalDAV, then stores ONLY its
//           AES-GCM ciphertext server-side. The plaintext is never logged,
//           never returned, and never stored in the browser.
//   POST { action: "disconnect", provider } (auth)
//   POST { action: "set-auto-delete", provider, autoDelete } (auth)
//        -> autoDelete defaults to false; see the deletion rule below.
//   POST { action: "resolve-deletion", provider, shiftId, deleteProvider? }
//        -> drops the sync-map row for a flagged deletion. The browser
//           has already decided delete-local or keep-local; dropping the
//           row stops re-flagging. Keep-local shifts are re-created on
//           the provider at the next sync; delete-local shifts are gone
//           on both sides only after the user confirmed. With
//           deleteProvider=true (local-missing flags), the provider event
//           is deleted too.
//
// Sync algorithm — newest edit wins, deletions never silent:
//   * One dedicated provider calendar named "CRNA Hub" per provider.
//     Other calendars are never read, written, or deleted.
//   * The `calendar_sync_map` table pairs a CRNA Hub shift id with a
//     provider event id, plus the last-seen updated timestamps on both
//     sides. A shift and an event are the same record only through that
//     map (plus a date+facility+type dedupe guard on first sight).
//   * Provider change newer than the local shift -> returned to the
//     browser as a providerChange to apply. Local change newer than the
//     provider event -> written to the provider now. Equal timestamps
//     -> no change (the local copy stands).
//   * A provider-side deletion (cancelled event / delta @removed /
//     CalDAV 404) is NEVER applied silently: it is returned as a
//     pendingDeletion for the user to confirm, unless the user has
//     explicitly turned auto-delete on for that provider. The same rule
//     applies to a mapped provider event whose local shift is missing
//     without a tombstone.
//   * A browser-confirmed local deletion arrives as a tombstone
//     ({ shiftId, providerEventId }) and IS applied to the provider,
//     because the user already confirmed that deletion in the app.
//   * Google uses sync tokens (full re-sync on 410 Gone), Outlook uses
//     Graph delta links, Apple uses CalDAV sync-collection with a full
//     etag scan fallback. iCloud supports sync-collection, so Apple
//     deletions are normally detected; the fallback scan cannot see
//     deletions (an event simply stops appearing) and therefore never
//     deletes on that basis alone.
//
// Architecture note — why the browser sends its shifts:
//   CRNA Hub is local-first: shifts live in the browser's storage, not in
//   a Supabase shifts table (credential sync covers credentials only).
//   This function therefore cannot push into a closed browser. The sync
//   runs when the app is open: on load for connected providers, on
//   "Sync now", and shortly after a shift is added, edited, or deleted.
//   The function is still the real sync engine — it owns the provider
//   tokens, the dedicated calendars, the map, and the log — and the
//   browser is the local store it syncs against. A future server-side
//   shifts table would let a scheduled invocation sync while the app is
//   closed; that table does not exist yet and is listed as such in the
//   README, not papered over here.

import {
  CORS,
  LocalShift,
  ProviderEvent,
  authUserId,
  decryptSecret,
  encryptSecret,
  encryptionConfigured,
  err,
  getConnection,
  getMapRows,
  json,
  nextDay,
  parseDescription,
  parseTitle,
  sbDelete,
  sbGet,
  sbInsert,
  sbPatch,
  sbUpsert,
  shiftDescription,
  shiftTitle,
  writeSyncLog,
} from "../_shared/calendar.ts";
import {
  GOOGLE_API,
  ensureGoogleCalendar,
  googleAccessToken,
  googleFetch,
  revokeGoogle,
} from "../_shared/google.ts";
import {
  GRAPH_API,
  ensureOutlookCalendar,
  graphFetch,
  outlookAccessToken,
} from "../_shared/outlook.ts";
import {
  deleteAppleEvent,
  ensureAppleCalendar,
  fetchAppleEvents,
  putAppleEvent,
} from "../_shared/caldav.ts";

type Conn = Record<string, unknown>;

type Provider = "google" | "outlook" | "apple";

function isProvider(p: unknown): p is Provider {
  return p === "google" || p === "outlook" || p === "apple";
}

function providerConfigured(provider: Provider): boolean {
  if (provider === "google") {
    return !!(Deno.env.get("GOOGLE_CLIENT_ID") && Deno.env.get("GOOGLE_CLIENT_SECRET"));
  }
  if (provider === "outlook") {
    return !!(Deno.env.get("OUTLOOK_CLIENT_ID") && Deno.env.get("OUTLOOK_CLIENT_SECRET"));
  }
  return true; // Apple: no owner-registered app; function reachability is enough.
}

function stripHtml(s: string): string {
  return String(s ?? "").replace(/<[^>]*>/g, "").trim();
}

function eventDateOf(start: { date?: string; dateTime?: string }): string {
  if (start.date) return start.date;
  if (start.dateTime) return start.dateTime.slice(0, 10);
  return "";
}

// --- Provider fetch / write ------------------------------------------------

interface Fetched {
  events: ProviderEvent[];
  deletedIds: string[];
  syncToken: string | null;
  deltaLink: string | null;
}

async function fetchGoogle(
  conn: Conn,
): Promise<{ fetched: Fetched; tokenRow: Conn }> {
  const { accessToken, row: refreshed } = await googleAccessToken(conn);
  const calendarId = await ensureGoogleCalendar(accessToken, conn);
  const base = `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  let url: string;
  let useToken = !!conn.sync_token;
  const from = new Date();
  from.setMonth(from.getMonth() - 12);
  if (useToken) {
    url = `${base}?syncToken=${encodeURIComponent(String(conn.sync_token))}&showDeleted=true&singleEvents=true&maxResults=2500`;
  } else {
    url = `${base}?timeMin=${encodeURIComponent(from.toISOString())}&showDeleted=true&singleEvents=true&maxResults=2500`;
  }
  const events: ProviderEvent[] = [];
  let nextSyncToken: string | null = null;
  let pageToken: string | null = null;
  for (let pages = 0; pages < 20; pages++) {
    const pageUrl = pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url;
    const r = await googleFetch(pageUrl, accessToken);
    if (r.status === 410 && useToken) {
      // Sync token expired: full re-sync once, then continue.
      useToken = false;
      url = `${base}?timeMin=${encodeURIComponent(from.toISOString())}&showDeleted=true&singleEvents=true&maxResults=2500`;
      pageToken = null;
      events.length = 0;
      continue;
    }
    if (r.status === 401) throw new Error("google_refresh_failed");
    if (!r.ok) throw new Error("google_fetch_failed");
    const data = await r.json();
    for (const ev of data.items ?? []) {
      const desc = String(ev.description ?? "");
      const parsed = parseDescription(desc);
      const { facility, type } = parseTitle(String(ev.summary ?? ""));
      const ext = ev.extendedProperties?.private ?? {};
      events.push({
        providerEventId: String(ev.id),
        date: eventDateOf(ev.start ?? {}),
        facility,
        type: parsed.type || type,
        pay: parsed.pay,
        note: parsed.note,
        shiftId: ext.crnaHubShiftId ?? parsed.shiftId,
        updatedAt: ev.updated ?? null,
        cancelled: ev.status === "cancelled",
        rawUpdatedAt: ev.updated ?? null,
      });
    }
    nextSyncToken = data.nextSyncToken ?? nextSyncToken;
    pageToken = data.nextPageToken ?? null;
    if (!pageToken) break;
  }
  return {
    fetched: { events, deletedIds: [], syncToken: nextSyncToken, deltaLink: null },
    tokenRow: refreshed,
  };
}

async function googleWrite(
  accessToken: string,
  calendarId: string,
  s: LocalShift,
  providerEventId: string | null,
  method: "create" | "update" | "delete",
): Promise<string | null> {
  const base = `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  if (method === "delete" && providerEventId) {
    const r = await googleFetch(`${base}/${encodeURIComponent(providerEventId)}`, accessToken, { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new Error("google_delete_failed");
    return null;
  }
  const body = {
    summary: shiftTitle(s),
    description: shiftDescription(s),
    start: { date: s.date },
    end: { date: nextDay(s.date) },
    extendedProperties: {
      private: {
        crnaHubShiftId: s.id,
        crnaHubUpdatedAt: s.updatedAt ?? new Date().toISOString(),
      },
    },
  };
  const r = await googleFetch(
    method === "create" ? base : `${base}/${encodeURIComponent(providerEventId ?? "")}`,
    accessToken,
    { method: method === "create" ? "POST" : "PATCH", body: JSON.stringify(body) },
  );
  if (!r.ok) throw new Error("google_write_failed");
  const data = await r.json();
  return String(data.id);
}

async function fetchOutlook(
  conn: Conn,
): Promise<{ fetched: Fetched; tokenRow: Conn }> {
  const { accessToken, row: refreshed } = await outlookAccessToken(conn);
  const calendarId = await ensureOutlookCalendar(accessToken, conn);
  let url = conn.delta_link
    ? String(conn.delta_link)
    : `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/events/delta`;
  const events: ProviderEvent[] = [];
  let deltaLink: string | null = null;
  for (let pages = 0; pages < 20; pages++) {
    const r = await graphFetch(url, accessToken);
    if (r.status === 401) throw new Error("outlook_refresh_failed");
    if (!r.ok) throw new Error("outlook_fetch_failed");
    const data = await r.json();
    for (const ev of data.value ?? []) {
      const bodyText = stripHtml(ev.body?.content ?? "");
      const parsed = parseDescription(bodyText);
      const { facility, type } = parseTitle(String(ev.subject ?? ""));
      const removed = !!ev["@removed"];
      events.push({
        providerEventId: String(ev.id),
        date: eventDateOf({
          dateTime: ev.start?.dateTime,
          date: ev.isAllDay ? (ev.start?.dateTime ?? "").slice(0, 10) : undefined,
        }),
        facility,
        type: parsed.type || type,
        pay: parsed.pay,
        note: parsed.note,
        shiftId: parsed.shiftId,
        updatedAt: ev.lastModifiedDateTime ?? null,
        cancelled: removed,
        rawUpdatedAt: ev.lastModifiedDateTime ?? null,
      });
    }
    if (data["@odata.deltaLink"]) {
      deltaLink = String(data["@odata.deltaLink"]);
      break;
    }
    const next = data["@odata.nextLink"];
    if (!next) break;
    url = String(next);
  }
  return { fetched: { events, deletedIds: [], syncToken: null, deltaLink }, tokenRow: refreshed };
}

async function outlookWrite(
  accessToken: string,
  calendarId: string,
  s: LocalShift,
  providerEventId: string | null,
  method: "create" | "update" | "delete",
): Promise<string | null> {
  const base = `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/events`;
  if (method === "delete" && providerEventId) {
    const r = await graphFetch(`${base}/${encodeURIComponent(providerEventId)}`, accessToken, { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new Error("outlook_delete_failed");
    return null;
  }
  const body = {
    subject: shiftTitle(s),
    body: { contentType: "text", content: shiftDescription(s) },
    start: { dateTime: `${s.date}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(s.date)}T00:00:00`, timeZone: "UTC" },
    isAllDay: true,
  };
  const r = await graphFetch(
    method === "create" ? base : `${base}/${encodeURIComponent(providerEventId ?? "")}`,
    accessToken,
    { method: method === "create" ? "POST" : "PATCH", body: JSON.stringify(body) },
  );
  if (!r.ok) throw new Error("outlook_write_failed");
  const data = await r.json();
  return String(data.id);
}

async function fetchApple(
  conn: Conn,
): Promise<Fetched> {
  const appleId = String(conn.provider_account ?? "");
  const password = await decryptSecret(String(conn.encrypted_password ?? ""));
  const calendarUrl = await ensureAppleCalendar(appleId, password);
  const known = new Map<string, string>();
  const { events, deletedIds, syncToken } = await fetchAppleEvents(
    calendarUrl,
    appleId,
    password,
    conn.sync_token ? String(conn.sync_token) : null,
    known,
  );
  // The fallback etag scan cannot see deletions (an event simply stops
  // appearing), so deletedIds only ever comes from sync-collection.
  return { events, deletedIds, syncToken, deltaLink: null };
}

async function appleWrite(
  conn: Conn,
  s: LocalShift,
  providerEventId: string | null,
  method: "create" | "update" | "delete",
): Promise<void> {
  const appleId = String(conn.provider_account ?? "");
  const password = await decryptSecret(String(conn.encrypted_password ?? ""));
  const calendarUrl = await ensureAppleCalendar(appleId, password);
  if (method === "delete") {
    await deleteAppleEvent(calendarUrl, appleId, password, providerEventId ?? `${s.id}@crna-hub`);
    return;
  }
  await putAppleEvent(calendarUrl, appleId, password, s);
}

// --- Sync ------------------------------------------------------------------

interface SyncBody {
  provider?: unknown;
  localShifts?: LocalShift[];
  tombstones?: { shiftId?: string; providerEventId?: string }[];
}

async function handleSync(userId: string, body: SyncBody): Promise<Response> {
  if (!isProvider(body.provider)) return err("unknown_provider", 400);
  const provider = body.provider;
  if (provider !== "apple" && !providerConfigured(provider)) {
    return err("provider_not_configured", 503);
  }
  const conn = await getConnection(userId, provider);
  if (!conn || conn.status !== "connected") return err("not_connected", 409);
  const localShifts: LocalShift[] = Array.isArray(body.localShifts)
    ? body.localShifts.filter((s) => s && typeof s.id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date ?? ""))
    : [];
  const localById = new Map(localShifts.map((s) => [s.id, s]));
  const mapRows = await getMapRows(userId, provider);
  const mapByEvent = new Map<string, Conn>();
  const mapByShift = new Map<string, Conn>();
  for (const m of mapRows) {
    mapByEvent.set(String(m.provider_event_id), m as Conn);
    mapByShift.set(String(m.shift_id), m as Conn);
  }

  // Provider access + fetch.
  let fetched: Fetched;
  let tokenRow: Conn = conn;
  let accessToken = "";
  let calendarId = String(conn.calendar_id ?? "");
  try {
    if (provider === "google") {
      const res = await fetchGoogle(conn);
      fetched = res.fetched;
      tokenRow = res.tokenRow;
      accessToken = (await googleAccessToken(tokenRow)).accessToken;
      calendarId = await ensureGoogleCalendar(accessToken, tokenRow);
    } else if (provider === "outlook") {
      const res = await fetchOutlook(conn);
      fetched = res.fetched;
      tokenRow = res.tokenRow;
      accessToken = (await outlookAccessToken(tokenRow)).accessToken;
      calendarId = await ensureOutlookCalendar(accessToken, tokenRow);
    } else {
      fetched = await fetchApple(conn);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync_failed";
    if (msg.endsWith("refresh_failed") || msg.startsWith("apple_auth_failed")) {
      await sbPatch(
        "calendar_connections",
        `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${provider}`,
        { status: "needs_reauth" },
      );
      await writeSyncLog(userId, provider, "both", {}, "needs_reauth");
      return err("needs_reauth", 401);
    }
    await writeSyncLog(userId, provider, "both", {}, "provider_fetch_failed");
    return err("provider_fetch_failed", 502);
  }

  const counts = { created: 0, updated: 0, flagged: 0, deleted: 0 };
  let providerCreated = 0;
  let providerUpdated = 0;
  const providerChanges: Record<string, unknown>[] = [];
  const pendingDeletions: Record<string, unknown>[] = [];
  const handledLocal = new Set<string>();
  const autoDelete = conn.auto_delete === true;

  const dropMap = async (shiftId: string) => {
    await sbDelete(
      "calendar_sync_map",
      `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${provider}&shift_id=eq.${encodeURIComponent(shiftId)}`,
    );
  };
  const saveMap = async (row: Record<string, unknown>) => {
    await sbUpsert("calendar_sync_map", row, "user_id,provider,shift_id");
  };
  const writeProvider = async (
    s: LocalShift,
    providerEventId: string | null,
    method: "create" | "update" | "delete",
  ): Promise<string | null> => {
    if (provider === "google") return await googleWrite(accessToken, calendarId, s, providerEventId, method);
    if (provider === "outlook") return await outlookWrite(accessToken, calendarId, s, providerEventId, method);
    await appleWrite(conn, s, providerEventId, method);
    return providerEventId ?? `${s.id}@crna-hub`;
  };

  // 1. User-confirmed local deletions (tombstones) -> delete on provider.
  for (const t of Array.isArray(body.tombstones) ? body.tombstones : []) {
    if (!t.shiftId) continue;
    try {
      const local = localById.get(t.shiftId);
      await writeProvider(
        local ?? { id: t.shiftId, date: "2000-01-01", facility: "", type: "" },
        t.providerEventId ?? mapByShift.get(t.shiftId)?.provider_event_id as string ?? null,
        "delete",
      );
    } catch {
      // Keep the tombstone: the browser resends it next sync.
      continue;
    }
    await dropMap(t.shiftId);
    counts.deleted++;
  }

  // 2a. Provider-side deletions reported by id only (Apple
  // sync-collection 404s). The href ends in "<shift id>.ics" for events
  // this sync created, which is how the href maps back to a shift.
  for (const href of fetched.deletedIds ?? []) {
    const base = href.split("/").pop() ?? "";
    const shiftId = base.replace(/\.ics$/i, "");
    const mapRow = mapByShift.get(shiftId);
    const local = localById.get(shiftId);
    if (local) {
      if (autoDelete) {
        providerChanges.push({ action: "delete", shiftId: local.id });
        await dropMap(local.id);
        counts.deleted++;
      } else {
        pendingDeletions.push({
          shiftId: local.id,
          date: local.date,
          facility: local.facility,
          type: local.type,
          provider,
          localMissing: false,
        });
        counts.flagged++;
      }
    } else if (mapRow) {
      pendingDeletions.push({
        shiftId,
        date: "",
        facility: "",
        type: "",
        provider,
        localMissing: true,
      });
      counts.flagged++;
    }
  }

  // 2. Provider events -> local changes, provider updates, or flags.
  for (const ev of fetched.events) {
    if (!ev.date) continue;
    const mapRow = mapByEvent.get(ev.providerEventId)
      ?? (ev.shiftId ? mapByShift.get(ev.shiftId) : undefined);
    const local = mapRow ? localById.get(String(mapRow.shift_id)) : undefined;
    if (ev.cancelled) {
      if (local) {
        if (autoDelete) {
          providerChanges.push({ action: "delete", shiftId: local.id });
          await dropMap(local.id);
          counts.deleted++;
        } else {
          pendingDeletions.push({
            shiftId: local.id,
            date: local.date,
            facility: local.facility,
            type: local.type,
            provider,
            localMissing: false,
          });
          counts.flagged++;
        }
      } else if (mapRow) {
        // Local shift already gone, no tombstone: flag, never silently
        // delete the provider event on the basis of an absence.
        pendingDeletions.push({
          shiftId: String(mapRow.shift_id),
          date: ev.date,
          facility: ev.facility,
          type: ev.type,
          provider,
          localMissing: true,
        });
        counts.flagged++;
      }
      continue;
    }
    if (mapRow && local) {
      handledLocal.add(local.id);
      const localUpdated = String(local.updatedAt ?? "");
      const providerUpdatedAt = String(ev.updatedAt ?? "");
      const lastLocal = String(mapRow.local_updated_at ?? "");
      const lastProvider = String(mapRow.provider_updated_at ?? "");
      const providerNewer = providerUpdatedAt && providerUpdatedAt > localUpdated
        && providerUpdatedAt !== lastProvider;
      const localNewer = localUpdated && localUpdated > lastLocal
        && localUpdated > providerUpdatedAt;
      if (providerNewer) {
        providerChanges.push({
          action: "update",
          shift: {
            id: local.id,
            date: ev.date,
            facility: ev.facility,
            type: ev.type,
            pay: ev.pay,
            note: ev.note,
            updatedAt: providerUpdatedAt,
          },
        });
        counts.updated++;
        await saveMap({
          ...mapRow,
          provider_updated_at: providerUpdatedAt,
          local_updated_at: providerUpdatedAt,
        });
      } else if (localNewer) {
        const newId = await writeProvider(local, ev.providerEventId, "update");
        providerUpdated++;
        await saveMap({
          ...mapRow,
          provider_event_id: newId ?? ev.providerEventId,
          provider_updated_at: localUpdated,
          local_updated_at: localUpdated,
        });
      }
      continue;
    }
    if (mapRow && !local) {
      // Mapped event, local shift missing, event NOT cancelled: leave the
      // provider event alone and flag it (same rule as cancelled above).
      pendingDeletions.push({
        shiftId: String(mapRow.shift_id),
        date: ev.date,
        facility: ev.facility,
        type: ev.type,
        provider,
        localMissing: true,
      });
      counts.flagged++;
      continue;
    }
    // Unmapped provider event: dedupe guard, then a new local shift.
    const dupe = localShifts.find(
      (s) => s.date === ev.date && s.facility === ev.facility && s.type === ev.type,
    );
    if (dupe) {
      await saveMap({
        user_id: userId,
        provider,
        shift_id: dupe.id,
        provider_event_id: ev.providerEventId,
        provider_updated_at: ev.updatedAt,
        local_updated_at: dupe.updatedAt ?? null,
      });
      handledLocal.add(dupe.id);
      continue;
    }
    const newId = crypto.randomUUID();
    await saveMap({
      user_id: userId,
      provider,
      shift_id: newId,
      provider_event_id: ev.providerEventId,
      provider_updated_at: ev.updatedAt,
      local_updated_at: ev.updatedAt,
    });
    providerChanges.push({
      action: "create",
      shift: {
        id: newId,
        date: ev.date,
        facility: ev.facility,
        type: ev.type,
        pay: ev.pay,
        note: ev.note,
        updatedAt: ev.updatedAt,
      },
    });
    counts.created++;
  }

  // 3. Local shifts -> provider creates / updates.
  for (const s of localShifts) {
    if (handledLocal.has(s.id)) continue;
    const mapRow = mapByShift.get(s.id);
    if (mapRow) {
      // Mapped but not in this provider batch (unchanged in an
      // incremental sync): push only a genuinely newer local edit.
      const lastLocal = String(mapRow.local_updated_at ?? "");
      if (s.updatedAt && s.updatedAt > lastLocal) {
        const newId = await writeProvider(s, String(mapRow.provider_event_id), "update");
        providerUpdated++;
        await saveMap({
          ...mapRow,
          provider_event_id: newId ?? String(mapRow.provider_event_id),
          provider_updated_at: s.updatedAt,
          local_updated_at: s.updatedAt,
        });
      }
      continue;
    }
    // Unmapped local shift: dedupe against this batch's provider events
    // (a provider event created elsewhere with the same details).
    const dupe = fetched.events.find(
      (ev) => !ev.cancelled && ev.date === s.date && ev.facility === s.facility && ev.type === s.type,
    );
    if (dupe) {
      await saveMap({
        user_id: userId,
        provider,
        shift_id: s.id,
        provider_event_id: dupe.providerEventId,
        provider_updated_at: dupe.updatedAt,
        local_updated_at: s.updatedAt ?? null,
      });
      continue;
    }
    const newId = await writeProvider(s, null, "create");
    providerCreated++;
    await saveMap({
      user_id: userId,
      provider,
      shift_id: s.id,
      provider_event_id: newId ?? `${s.id}@crna-hub`,
      provider_updated_at: s.updatedAt ?? null,
      local_updated_at: s.updatedAt ?? null,
    });
  }

  // 4. Persist connection state + log.
  const connPatch: Conn = {
    last_synced_at: new Date().toISOString(),
    status: "connected",
  };
  if (provider === "google") {
    if (tokenRow.encrypted_access_token) {
      connPatch.encrypted_access_token = tokenRow.encrypted_access_token;
      connPatch.access_token_expires_at = tokenRow.access_token_expires_at;
    }
    if (tokenRow.encrypted_refresh_token) {
      connPatch.encrypted_refresh_token = tokenRow.encrypted_refresh_token;
    }
    if (fetched.syncToken) connPatch.sync_token = fetched.syncToken;
    if (calendarId) connPatch.calendar_id = calendarId;
  }
  if (provider === "outlook") {
    if (tokenRow.encrypted_access_token) {
      connPatch.encrypted_access_token = tokenRow.encrypted_access_token;
      connPatch.access_token_expires_at = tokenRow.access_token_expires_at;
    }
    if (tokenRow.encrypted_refresh_token) {
      connPatch.encrypted_refresh_token = tokenRow.encrypted_refresh_token;
    }
    if (fetched.deltaLink) connPatch.delta_link = fetched.deltaLink;
    if (calendarId) connPatch.calendar_id = calendarId;
  }
  if (provider === "apple" && fetched.syncToken) {
    connPatch.sync_token = fetched.syncToken;
  }
  await sbPatch(
    "calendar_connections",
    `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${provider}`,
    connPatch,
  );
  await writeSyncLog(userId, provider, "both", counts, null);
  return json({
    ok: true,
    provider,
    providerChanges,
    pendingDeletions,
    counts: { ...counts, providerCreated, providerUpdated },
    lastSyncedAt: String(connPatch.last_synced_at),
  });
}

// --- Other actions -----------------------------------------------------------

async function handleConnectApple(userId: string, body: Record<string, unknown>): Promise<Response> {
  const appleId = String(body.appleId ?? "").trim();
  const password = String(body.appSpecificPassword ?? "");
  if (!appleId || !password) return err("apple_credentials_required", 400);
  if (!encryptionConfigured()) return err("encryption_not_configured", 503);
  let calendarUrl: string;
  try {
    calendarUrl = await ensureAppleCalendar(appleId, password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "apple_auth_failed") return err("apple_auth_failed", 401);
    // Pass discovery errors through verbatim (apple_principal_failed_<status>,
    // apple_principal_missing, apple_home_failed_<status>, apple_home_missing,
    // apple_list_failed_<status>, apple_calendar_create_failed_<status>) so the
    // client message names the failing step instead of collapsing to a generic
    // apple_dav_failed. The password is never included in any of these codes.
    if (msg.startsWith("apple_")) return err(msg, 502);
    return err("apple_dav_failed", 502);
  }
  const existing = await getConnection(userId, "apple");
  await sbUpsert("calendar_connections", {
    user_id: userId,
    provider: "apple",
    provider_account: appleId,
    encrypted_password: await encryptSecret(password),
    calendar_id: calendarUrl,
    status: "connected",
    auto_delete: existing?.auto_delete === true,
  }, "user_id,provider");
  await writeSyncLog(userId, "apple", "connect", {}, null);
  return json({ ok: true, provider: "apple" });
}

async function handleDisconnect(userId: string, provider: Provider): Promise<Response> {
  const conn = await getConnection(userId, provider);
  if (conn && provider === "google" && conn.encrypted_refresh_token) {
    try {
      await revokeGoogle(await decryptSecret(String(conn.encrypted_refresh_token)));
    } catch { /* best-effort */ }
  }
  await sbDelete(
    "calendar_sync_map",
    `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${provider}`,
  );
  await sbDelete(
    "calendar_connections",
    `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${provider}`,
  );
  await writeSyncLog(userId, provider, "disconnect", {}, null);
  return json({ ok: true, provider });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const action = url.searchParams.get("action");
      if (action === "config") {
        return json({
          ok: true,
          google: providerConfigured("google"),
          outlook: providerConfigured("outlook"),
          apple: true,
          encryption: encryptionConfigured(),
        });
      }
      const userId = await authUserId(req);
      if (!userId) return err("not_signed_in", 401);
      if (action === "status") {
        const rows = await sbGet(
          "calendar_connections",
          `select=provider,status,auto_delete,last_synced_at&user_id=eq.${encodeURIComponent(userId)}`,
        );
        return json({
          ok: true,
          connections: rows.map((r) => ({
            provider: r.provider,
            status: r.status,
            autoDelete: r.auto_delete === true,
            lastSyncedAt: r.last_synced_at ?? null,
          })),
        });
      }
      if (action === "log") {
        const rows = await sbGet(
          "sync_log",
          `select=provider,direction,shifts_created,shifts_updated,shifts_flagged,shifts_deleted,error,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=30`,
        );
        return json({ ok: true, log: rows });
      }
      return err("unknown_action", 400);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const userId = await authUserId(req);
      if (!userId) return err("not_signed_in", 401);
      if (body.action === "sync") return await handleSync(userId, body);
      if (body.action === "connect-apple") {
        return await handleConnectApple(userId, body);
      }
      if (body.action === "disconnect" && isProvider(body.provider)) {
        return await handleDisconnect(userId, body.provider);
      }
      if (body.action === "set-auto-delete" && isProvider(body.provider)) {
        await sbPatch(
          "calendar_connections",
          `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${body.provider}`,
          { auto_delete: body.autoDelete === true },
        );
        return json({ ok: true, provider: body.provider, autoDelete: body.autoDelete === true });
      }
      if (body.action === "resolve-deletion" && isProvider(body.provider) && body.shiftId) {
        // Browser decision already made (delete-local or keep-local).
        // Dropping the map row stops re-flagging; a kept shift is
        // re-created on the provider at the next sync. For a
        // local-missing flag, deleteProvider=true also deletes the
        // provider event (the shift is already gone locally).
        if (body.deleteProvider === true) {
          const conn = await getConnection(userId, body.provider);
          const maps = await getMapRows(userId, body.provider);
          const mapRow = maps.find((m) => String(m.shift_id) === String(body.shiftId));
          if (conn && mapRow) {
            try {
              if (body.provider === "google") {
                const { accessToken } = await googleAccessToken(conn);
                const calendarId = await ensureGoogleCalendar(accessToken, conn);
                await googleWrite(accessToken, calendarId, { id: String(body.shiftId), date: "2000-01-01", facility: "", type: "" }, String(mapRow.provider_event_id), "delete");
              } else if (body.provider === "outlook") {
                const { accessToken } = await outlookAccessToken(conn);
                const calendarId = await ensureOutlookCalendar(accessToken, conn);
                await outlookWrite(accessToken, calendarId, { id: String(body.shiftId), date: "2000-01-01", facility: "", type: "" }, String(mapRow.provider_event_id), "delete");
              } else {
                const appleId = String(conn.provider_account ?? "");
                const password = await decryptSecret(String(conn.encrypted_password ?? ""));
                const calendarUrl = await ensureAppleCalendar(appleId, password);
                await deleteAppleEvent(calendarUrl, appleId, password, String(mapRow.provider_event_id));
              }
            } catch {
              return err("provider_delete_failed", 502);
            }
          }
        }
        await sbDelete(
          "calendar_sync_map",
          `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${body.provider}&shift_id=eq.${encodeURIComponent(String(body.shiftId))}`,
        );
        return json({ ok: true });
      }
      return err("unknown_action", 400);
    }
    return err("method_not_allowed", 405);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync_failed";
    if (msg === "encryption_not_configured") return err(msg, 503);
    return err("sync_failed", 502);
  }
});
