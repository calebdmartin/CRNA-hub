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
//   GET  ?action=apple-calendars (auth) -> the user's iCloud calendars
//        [{ name, url, isDedicated }] for the import-source picker.
//        Lists server-side with the stored CalDAV credentials; the
//        password is never returned. Apple only.
//   POST { action: "sync", provider, localShifts, tombstones } (auth)
//        -> two-way sync for one provider (see algorithm below).
//   POST { action: "connect-apple", appleId, appSpecificPassword, calendarUrl? } (auth)
//        -> validates the password with CalDAV, then stores ONLY its
//           AES-GCM ciphertext server-side. The plaintext is never logged,
//           never returned, and never stored in the browser.
//           Without calendarUrl it creates a dedicated "CRNA Hub"
//           calendar (UUID address, the form iCloud accepts). If iCloud
//           refuses to create one, it returns
//           { error: "apple_create_forbidden_pick_calendar", calendars }
//           (502) instead of failing outright; the client then lets the
//           user pick an existing calendar and re-calls connect-apple
//           with calendarUrl, which is verified against the account's
//           calendar home-set before anything is stored.
//   POST { action: "set-apple-source-calendar", calendarUrl, calendarName } (auth)
//        -> picks the Apple calendar to IMPORT shifts from (e.g. "Caleb
//           Work Schedule"). The URL is verified against the account's
//           calendar home-set before anything is stored, and the
//           dedicated "CRNA Hub" calendar cannot be picked as its own
//           source. Empty calendarUrl clears the choice. Needs migration
//           004 (source_calendar_url/name on calendar_connections);
//           without it this returns { error: "migration_004_required" }.
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
// Apple import source — the "Caleb Work Schedule" problem:
//   The dedicated "CRNA Hub" calendar starts empty, so a connected Apple
//   account with shifts only in another calendar syncs nothing. The user
//   can therefore pick ONE additional Apple calendar as an import source.
//   On every Apple sync, after the dedicated-calendar two-way sync, the
//   function reads that source calendar (full scan — the source has no
//   sync token of its own) and imports only events whose titles parse as
//   work shifts (parseWorkShiftEvent in ../_shared/calendar.ts): the
//   user's Facilities list first (name or alias, in the title or the
//   location — even a bare facility name), then a generic facility-like
//   title plus a shift pattern. Holzer keeps its exact confirmed rates.
//   Anything else is skipped and counted, never imported as junk, and
//   no other calendar is ever read. Ask-first (Nov 5, 2026): events at
//   a facility with no saved rule are NOT imported — they are held and
//   reported as a suggestion ("We noticed shifts at <Hospital> — add
//   it as a facility?"), with the three paths: sync your calendar,
//   upload a contract, or manually enter the facility's hourly rate.
//   Once the user adds the facility, the next sync re-scans the held
//   events (they leave no import-map row) and imports them, priced.
//   Imported shifts are returned as providerChange creates/updates with
//   source "apple-import" and note "Imported from <calendar name>", and
//   the sync response carries an `imported` summary
//   { sourceCalendarName, created, updated, skipped, duplicates } so the
//   panel can say "imported N shifts from Caleb Work Schedule".
//   Pairing lives in `calendar_import_map` (migration 004), NOT in
//   calendar_sync_map: a shift can be paired with the dedicated calendar
//   AND with its source event at the same time, and the two pairings must
//   never overwrite each other. If that table does not exist yet, the
//   import still works — dedupe then rests on the local date+facility+
//   type guard alone, and source-side edits will not update the local
//   shift. Imported shifts are pushed to the dedicated calendar by the
//   normal local->provider step on the NEXT sync (once the browser sends
//   them back as local shifts); they are never written into the source
//   calendar, and a source event that disappears is never treated as a
//   deletion (a full scan cannot see deletions, and an absence is not
//   evidence). A locally deleted imported shift is never re-imported:
//   its import-map row survives the deletion and blocks resurrection —
//   but ONLY once the deletion is known, via migration 005 flags
//   (seen_locally / deleted_locally on calendar_import_map) or a
//   tombstone sent with this sync. Before 005, a row whose shift never
//   reached the device (an earlier sync's response was lost, e.g. the
//   old 25-second proxy timeout) looked exactly like a deleted shift,
//   so every one of its events was skipped forever — 231 parsed Holzer
//   shifts skipped with 0 imported on Nov 5, 2026. With 005, such a
//   stale row is REPAIRED instead: the shift is re-created with the
//   same id (counted as `repaired`). Until 005 runs, the code keeps the
//   old safe skip behaviour and the client offers an explicit
//   "Re-import missing shifts" button, which clears stale rows (rows
//   whose shift is not on the device and not flagged deleted) so the
//   next pass imports them fresh. Skips are counted by reason
//   (skippedNotShift / skippedDeleted / skippedLegacy / skippedSuggested)
//   instead of one opaque total — "you deleted" now means a genuinely
//   deleted shift (explicit tombstone or deleted_locally flag), never a
//   shift that simply never reached the device, and skippedSuggested
//   counts shifts held for a new-hospital suggestion.
//   Import-map writes are batched (one bulk upsert + chunked deletes
//   after the event loop, never one awaited write per event): 231
//   sequential writes took ~36s on Nov 5, 2026, past the Vercel
//   proxy's 25s limit, so the browser never received the 231 created
//   shifts even though the server had paired them — and the next sync
//   repeated the same slow import. See flushImportMapWrites.
//
// FINAL NATIVE MODEL (agreed with Caleb, Nov 4–5, 2026) — what moves
// on-device vs what this function still owns:
//   * Apple transport moves on-device ENTIRELY: the finished native
//     app reads the user's chosen work calendar via EventKit and
//     creates its own calendar on-device. No CalDAV, no app-specific
//     password, no server-held Apple credential. The connect-apple
//     action, the CalDAV calendar creation, and the apple-calendars
//     listing in this file are a WEB PREVIEW STAND-IN only — the
//     client labels them as such (LIVE_SYNC_STANDIN_LABEL) and they
//     must be deleted, not ported, when the native app ships.
//   * The work-calendar picker itself is final, not a stand-in:
//     set-apple-source-calendar (pick ONE existing calendar, pull
//     from that calendar only, never write to it) is the flow the
//     native picker must reproduce. Google/Outlook still need the
//     equivalent picker built server-side (today only Apple has one).
//   * This function KEEPS, for now: Google/Outlook OAuth + token
//     storage, the sync engine (calendar_sync_map, calendar_import_map,
//     sync log, pending deletions), the facilities-driven parser in
//     ../_shared/calendar.ts, and the ask-first suggestion flow.
//     Once shifts live in a cloud table, the parser/dedupe/suggestion
//     flow can move on-device and this function shrinks to
//     Google/Outlook transport — but no sync rule may change in that
//     move (see the regression checklist in the README's "Final native
//     calendar sync (EventKit) — design" section).
//
// Sync algorithm — newest edit wins, deletions never silent:
//   * One dedicated provider calendar named "CRNA Hub" per provider.
//     Other calendars are never read, written, or deleted — except the
//     Apple import source above, which is read-only: it is never
//     written to, and events are only ever pulled FROM it.
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
  chunkArray,
  decideImportEvent,
  FacilitySuggestion,
  groupFacilitySuggestions,
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
  parseWorkShiftEvent,
  normalizeFacilityRules,
  sameFacility,
  sbDelete,
  sbGet,
  sbInsert,
  sbPatch,
  sbUpsert,
  sbUpsertMany,
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
  discoverAppleCalendars,
  ensureAppleCalendar,
  fetchAppleCalendarRange,
  fetchAppleEvents,
  putAppleEvent,
  verifyAppleCalendar,
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
        summary: String(ev.summary ?? ""),
        location: typeof ev.location === "string" ? ev.location : undefined,
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
        summary: String(ev.subject ?? ""),
        location: ev.location?.displayName ? String(ev.location.displayName) : undefined,
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
  // The dedicated calendar URL is stored on the connection row at
  // connect time: reusing it skips the 3-request discovery round trip
  // on every sync. Only if the stored URL fails do we re-discover
  // (e.g. the calendar was deleted and recreated) and retry once.
  const storedUrl = String(conn.calendar_id ?? "").trim();
  const known = new Map<string, string>();
  const syncToken = conn.sync_token ? String(conn.sync_token) : null;
  let calendarUrl = storedUrl;
  let fetchedEvents: Awaited<ReturnType<typeof fetchAppleEvents>> | null = null;
  if (storedUrl) {
    try {
      fetchedEvents = await fetchAppleEvents(storedUrl, appleId, password, syncToken, known);
    } catch {
      fetchedEvents = null;
    }
  }
  if (!fetchedEvents) {
    calendarUrl = await ensureAppleCalendar(appleId, password);
    fetchedEvents = await fetchAppleEvents(calendarUrl, appleId, password, syncToken, known);
  }
  const { events, deletedIds, syncToken: newSyncToken } = fetchedEvents;
  // The fallback etag scan cannot see deletions (an event simply stops
  // appearing), so deletedIds only ever comes from sync-collection.
  return { events, deletedIds, syncToken: newSyncToken, deltaLink: null };
}

async function appleWrite(
  conn: Conn,
  s: LocalShift,
  providerEventId: string | null,
  method: "create" | "update" | "delete",
): Promise<void> {
  const appleId = String(conn.provider_account ?? "");
  const password = await decryptSecret(String(conn.encrypted_password ?? ""));
  const calendarUrl = String(conn.calendar_id ?? "").trim()
    || await ensureAppleCalendar(appleId, password);
  if (method === "delete") {
    await deleteAppleEvent(calendarUrl, appleId, password, providerEventId ?? `${s.id}@crna-hub`);
    return;
  }
  await putAppleEvent(calendarUrl, appleId, password, s);
}

// --- Apple import source (calendar_import_map, migration 004) ----------
// All three helpers swallow DB errors on purpose: until the owner runs
// supabase-schema-004.sql the table/columns do not exist, and the import
// must degrade to the local date+facility+type dedupe guard instead of
// failing the whole sync.
async function getImportMapRows(
  userId: string,
  provider: string,
): Promise<Record<string, unknown>[]> {
  try {
    return await sbGet(
      "calendar_import_map",
      `select=*&user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`,
    );
  } catch {
    return [];
  }
}

async function saveImportMapRow(row: Record<string, unknown>): Promise<void> {
  try {
    await sbUpsert("calendar_import_map", row, "user_id,provider,shift_id");
  } catch {
    // Degraded mode (migration 004 not run): the pairing is not stored,
    // so the next sync re-checks the same event against the local dedupe
    // guard instead of against this row. Nothing is double-created.
  }
}

// Batched write for the import loop: one PostgREST round-trip for all
// collected rows, falling back to one row at a time if the bulk call
// fails (same swallow semantics as saveImportMapRow). The loop must
// NOT await a DB write per event: 231 sequential upserts took ~36s on
// Nov 5, 2026, past the proxy's 25s limit, so the browser never
// received the 231 created shifts even though the server had paired
// them. Deletes run before upserts: a repaired event re-pairs the same
// source_event_id under a new shift id, and the table's unique
// (user_id, provider, source_event_id) would reject the upsert while
// the stale row still stands. Rows listed for deletion are never
// upserted in the same flush.
async function flushImportMapWrites(
  rows: Record<string, unknown>[],
  deleteShiftIds: string[],
  userId: string,
  provider: string,
): Promise<void> {
  const doomed = new Set(deleteShiftIds);
  if (deleteShiftIds.length) {
    // Chunked `in.(...)` deletes: one request per 50 ids instead of
    // one per row (same 25s timeout as above).
    for (const chunk of chunkArray(deleteShiftIds, 50)) {
      const list = chunk.map((id) => encodeURIComponent(id)).join(",");
      try {
        await sbDelete(
          "calendar_import_map",
          `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}&shift_id=in.(${list})`,
        );
      } catch {
        for (const id of chunk) await deleteImportMapRow(userId, provider, id);
      }
    }
  }
  const saves = rows.filter((r) => !doomed.has(String(r.shift_id ?? "")));
  if (!saves.length) return;
  try {
    await sbUpsertMany("calendar_import_map", saves);
  } catch {
    for (const row of saves) await saveImportMapRow(row);
  }
}

async function deleteImportMapRow(userId: string, provider: string, shiftId: string): Promise<void> {
  try {
    await sbDelete(
      "calendar_import_map",
      `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${provider}&shift_id=eq.${encodeURIComponent(shiftId)}`,
    );
  } catch {
    // Degraded mode (migration 004 not run): nothing to delete.
  }
}

// decideStaleImportRow / decideImportEvent live in
// ../_shared/calendar.ts (pure, exported for unit tests) — they decide
// what happens to an import-map row whose paired shift is not on the
// device, and what one parsed source event becomes.

// Full scan of the user's chosen Apple import-source calendar. The source
// has no sync token of its own (conn.sync_token belongs to the dedicated
// calendar), and the event count is small (tens of shifts), so a full
// scan each sync is the correct trade: it also means a source event that
// disappears is simply absent, never a deletion signal.
async function fetchAppleSourceEvents(
  conn: Conn,
  sourceUrl: string,
): Promise<{ events: ProviderEvent[]; fetchMethod: string }> {
  const appleId = String(conn.provider_account ?? "");
  const password = await decryptSecret(String(conn.encrypted_password ?? ""));
  // One REPORT returns the whole calendar inline; the old path did a
  // PROPFIND plus one sequential GET per event, which took 30-80s on a
  // 100+ event work calendar and tripped the proxy's 25s limit
  // ("upstream_unreachable" on Sync now).
  //
  // The REPORT is unfiltered on purpose (see fetchAppleCalendarRange):
  // it returns the FULL history iCloud holds, past dates included, so
  // shifts from earlier in the year come over — not just a 2025–2028
  // window. There is no date filter anywhere in the import path, and
  // the parser is date-window-free.
  //
  // Fall back to the etag scan (now parallel-batched) not only when the
  // server refuses the REPORT, but ALSO when it succeeds with 0 events:
  // a 0-event reply for a calendar the user just picked as their work
  // calendar is not credible — it is how a time-range/DATE mismatch (or
  // a missing Depth header) used to surface, silently importing nothing.
  const ranged = await fetchAppleCalendarRange(sourceUrl, appleId, password);
  if (ranged && ranged.length > 0) {
    return { events: ranged, fetchMethod: "range" };
  }
  const { events } = await fetchAppleEvents(sourceUrl, appleId, password, null, new Map());
  return {
    events,
    fetchMethod: ranged === null ? "scan" : "range-empty-fallback-scan",
  };
}

// --- Sync ------------------------------------------------------------------

interface SyncBody {
  provider?: unknown;
  localShifts?: LocalShift[];
  tombstones?: { shiftId?: string; providerEventId?: string }[];
  // Explicit client repair: clear stale import-map rows (paired shifts
  // that never reached the device) so they import fresh on this sync.
  // Rows flagged deleted_locally (migration 005) and tombstoned shifts
  // are never cleared by this. Until 005 runs this is the only way to
  // recover shifts lost to an earlier undelivered sync response.
  repairStaleImport?: boolean;
  // The user's Facilities list, sent by the browser with every sync
  // (name, aliases, pay rule per facility). Facilities live on-device,
  // like shifts — the server stores none of this; it only uses the
  // list to recognise and price imported shifts on this sync. When the
  // user adds a facility, the next sync re-scans the source calendar
  // with it (skipped events leave no import-map row, so nothing is
  // permanently excluded) and re-prices shifts imported unpriced.
  facilities?: unknown;
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
  // Facilities the user saved on the Facilities tab (name + aliases +
  // pay rule), sent with this sync so the Apple import can recognise
  // and price their shifts. Validated, never trusted blindly — see
  // normalizeFacilityRules. The server stores nothing from this list.
  const facilityRules = normalizeFacilityRules(body.facilities);
  const localById = new Map(localShifts.map((s) => [s.id, s]));
  // Shifts the user deleted in the app, sent with this sync. They are
  // applied to the provider in step 1 — and they are also the durable
  // proof that an imported shift was deleted on purpose (see the import
  // section: a tombstone is what separates "deleted" from "never
  // delivered"). The client clears its tombstones after a successful
  // sync, so a tombstoned import row is also flagged deleted_locally
  // (migration 005) in the import section below.
  const tombstonedIds = new Set(
    (Array.isArray(body.tombstones) ? body.tombstones : [])
      .map((t) => t.shiftId)
      .filter((id): id is string => typeof id === "string" && !!id),
  );
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

  // Apple import source, if the user picked one. The columns come from
  // migration 004; until the owner runs supabase-schema-004.sql they are
  // simply absent from the row, so this is unset and the sync behaves
  // exactly as before. The dedicated calendar can never be its own
  // import source (a stale stored value is ignored, not acted on).
  const normUrl = (u: string) => String(u ?? "").replace(/\/$/, "");
  const sourceCalendarUrl = provider === "apple"
    ? String(conn.source_calendar_url ?? "").trim()
    : "";
  const sourceCalendarName = provider === "apple"
    ? String(conn.source_calendar_name ?? "").trim()
    : "";
  const hasSource = provider === "apple" && !!sourceCalendarUrl &&
    normUrl(sourceCalendarUrl) !== normUrl(String(conn.calendar_id ?? ""));
  let imported: {
    sourceCalendarName: string;
    created: number;
    updated: number;
    skipped: number;
    duplicates: number;
    seen: number;
    parsed: number;
    fetchMethod: string | null;
    error: string | null;
    // Skip reasons (skipped is the total): not-shift events, shifts
    // the user genuinely deleted (explicit tombstone or
    // deleted_locally flag — never mere absence), and legacy skips
    // (migration 005 not run yet, so "never delivered" cannot be told
    // from "deleted"). repaired counts stale rows re-created because
    // their shift never reached the device.
    skippedNotShift: number;
    skippedDeleted: number;
    skippedLegacy: number;
    repaired: number;
    // Unpriced imports: shifts created/repaired in this import whose
    // facility has no pay rule yet (never $0 — the client counts them
    // in the totals as unpriced). suggestions: hospitals seen in this
    // import that no saved facility rule covers — ask-first, Nov 5,
    // 2026: their shifts are HELD, not imported, and the client asks
    // "We noticed shifts at <Hospital> in your calendar. Add it as a
    // facility?" with the three paths (sync your calendar, upload a
    // contract, or manually enter the facility's hourly rate). Once
    // the user adds the facility, the next sync re-scans the held
    // events and imports them, priced. skippedSuggested counts the
    // held shifts. newFacilities keeps the suggestion names for
    // older clients.
    unpriced: number;
    suggestions: FacilitySuggestion[];
    skippedSuggested: number;
    newFacilities: string[];
  } | null = null;

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

  // 2b. Apple import source: pull work shifts from the calendar the
  // user picked (e.g. "Caleb Work Schedule"). Read-only — nothing here
  // ever writes to the source calendar, and a source event that
  // disappears is never treated as a deletion. Runs after the
  // dedicated-calendar loop so its dedupe keys also cover shifts the
  // dedicated loop just created in this same sync.
  if (hasSource) {
    imported = {
      sourceCalendarName: sourceCalendarName || sourceCalendarUrl,
      created: 0,
      updated: 0,
      skipped: 0,
      duplicates: 0,
      seen: 0,
      parsed: 0,
      fetchMethod: null,
      error: null,
      skippedNotShift: 0,
      skippedDeleted: 0,
      skippedLegacy: 0,
      repaired: 0,
      unpriced: 0,
      suggestions: [],
      skippedSuggested: 0,
      newFacilities: [],
    };
    let sourceEvents: ProviderEvent[] = [];
    try {
      const res = await fetchAppleSourceEvents(conn, sourceCalendarUrl);
      sourceEvents = res.events;
      imported.fetchMethod = res.fetchMethod;
      imported.seen = sourceEvents.length;
    } catch {
      // A source read failure must not fail the dedicated-calendar sync
      // that already succeeded above; it is reported, not hidden.
      imported.error = "source_fetch_failed";
    }
    if (!imported.error) {
      const importRows = await getImportMapRows(userId, provider);
      // Migration 005 flags exist only if a returned row carries them
      // (select=* returns every column). With no rows there is nothing
      // stale to repair, so the distinction does not matter.
      const hasImportFlags = importRows.length > 0 &&
        Object.prototype.hasOwnProperty.call(importRows[0], "deleted_locally");
      let importByEvent = new Map(
        importRows.map((r) => [String(r.source_event_id), r as Conn]),
      );
      // Batched import-map writes for this sync: the event loop below
      // only COLLECTS rows to save / shift ids to delete, and one
      // flush after the loop writes them (deletes first, then a single
      // bulk upsert). Awaiting one write per event took ~36s for 231
      // shifts on Nov 5, 2026 — past the proxy's 25s limit — so the
      // browser never received the created shifts even though the
      // server had paired them. Nothing in the loop re-reads the DB,
      // so deferring the writes changes no decision.
      const importSaves: Record<string, unknown>[] = [];
      const importDeletes: string[] = [];
      // A paired shift that IS on the device was delivered: mark it
      // seen so a later deletion is recognised as a deletion, not as
      // "never delivered". Collected, not awaited per row (see above);
      // if migration 005 has not run, the upsert fails on the unknown
      // column and is swallowed at flush time.
      for (const r of importRows) {
        const sid = String(r.shift_id ?? "");
        if (sid && localById.has(sid) && r.seen_locally !== true) {
          importSaves.push({ ...r, seen_locally: true });
        }
      }
      // A tombstone for an imported shift is proof the user deleted it
      // on purpose. Flag it durably: the client clears its tombstones
      // after this sync, so without the flag the next sync would treat
      // the row as stale and resurrect the shift.
      for (const r of importRows) {
        const sid = String(r.shift_id ?? "");
        if (sid && tombstonedIds.has(sid) && r.deleted_locally !== true) {
          importSaves.push({ ...r, deleted_locally: true });
        }
      }
      // Explicit client repair ("Re-import missing shifts"): clear
      // stale rows — paired shifts that are not on the device, not
      // flagged deleted, and not tombstoned with this sync — so the
      // events below import fresh. This is the recovery path until
      // migration 005 runs (after 005, stale rows repair themselves
      // in the loop below and this button is rarely needed). The
      // in-memory map is cleared at once so the loop sees the events
      // as unpaired; the DB delete is part of the batch flush below.
      if (body.repairStaleImport === true) {
        for (const r of importRows) {
          const sid = String(r.shift_id ?? "");
          if (
            sid && !localById.has(sid) && r.deleted_locally !== true &&
            !tombstonedIds.has(sid)
          ) {
            importDeletes.push(sid);
            importByEvent.delete(String(r.source_event_id));
          }
        }
      }
      // Dedupe: local shifts as sent, plus shifts created from the
      // dedicated calendar earlier in this same sync. Facility names
      // match through sameFacility, so a shift first imported under an
      // alias ("CAMC") is not re-created under the canonical facility
      // name ("Charleston Area Medical Center") once that facility is
      // saved. Reads providerChanges live, so shifts this loop creates
      // also dedupe later events in the same sync.
      const findImportDupe = (
        date: string,
        facility: string,
        type: string,
      ): LocalShift | undefined => {
        const all: LocalShift[] = [...localShifts];
        for (const ch of providerChanges) {
          const sh = (ch as { action?: string; shift?: LocalShift }).shift;
          if ((ch as { action?: string }).action === "create" && sh) all.push(sh);
        }
        return all.find(
          (s) =>
            s.date === date && s.type === type &&
            sameFacility(s.facility, facility, facilityRules),
        );
      };
      // Shifts at a facility no saved rule covers are HELD for a
      // suggestion, not imported (see the per-event collection below):
      // their events are grouped after the loop into `suggestions`.
      // Held events leave no import-map row, so adding the facility
      // later re-scans them on the next sync instead of excluding
      // them forever.
      const suggestedEvents: { facility: string; date: string; title: string; location: string }[] = [];
      for (const ev of sourceEvents) {
        if (!ev.date || ev.cancelled) {
          imported.skipped++;
          imported.skippedNotShift++;
          continue;
        }
        // Facilities list first, then the generic fallback — title AND
        // location are both read, so "CAMC" alone, "CAMC 8", and a bare
        // "8" with CAMC in the location all parse. Skipped events leave
        // no import-map row, so adding a facility later re-scans them
        // on the next sync instead of excluding them forever.
        const parsed = parseWorkShiftEvent(
          ev.summary ?? "",
          ev.location ?? "",
          ev.date,
          facilityRules,
        );
        if (parsed) imported.parsed++;
        const pay = parsed ? (parsed.pay || ev.pay || "") : "";
        const importRow = parsed ? importByEvent.get(ev.providerEventId) : undefined;
        const local = importRow
          ? localById.get(String(importRow.shift_id))
          : undefined;
        // One pure decision per event (see decideImportEvent): a shift
        // already on the device is never re-created, a stale pairing
        // is repaired unless it is genuinely deleted, and only an
        // unpaired event with no local match is a fresh create. Mere
        // absence from the device is never, by itself, a deletion.
        const decision = decideImportEvent({
          parsed: !!parsed,
          localExists: !!local,
          importRow: importRow ?? null,
          tombstoned: importRow ? tombstonedIds.has(String(importRow.shift_id)) : false,
          keyExistsLocally: parsed
            ? !!findImportDupe(ev.date, parsed.facility, parsed.type)
            : false,
          flagsSupported: hasImportFlags,
        });
        if (decision === "skip-not-shift") {
          // Not a work shift (personal event, holiday, reminder…):
          // skipped and counted, never imported as a junk shift — and
          // never suggested as a facility, either.
          imported.skipped++;
          imported.skippedNotShift++;
          continue;
        }
        // Unknown facility, not a deleted shift: remember the event for
        // the suggestion (name, count, date range, address). This runs
        // for every live decision — create, duplicate, already-here,
        // repair — so a hospital is suggested once however its shifts
        // arrived; skip-deleted / skip-legacy shifts are genuinely
        // deleted, so suggesting them would nag the user to re-add
        // shifts they removed on purpose.
        if (
          parsed && !parsed.facilityKnown &&
          decision !== "skip-deleted" && decision !== "skip-legacy"
        ) {
          suggestedEvents.push({
            facility: parsed.facility,
            date: ev.date,
            title: ev.summary ?? "",
            location: ev.location ?? "",
          });
        }
        if (!parsed) continue; // Unreachable: decideImportEvent
        // returns skip-not-shift for every unparsed event, above.
        if (decision === "already-here" && local) {
          // Already imported: only a genuinely newer source edit flows
          // back (newest edit wins, same rule as the dedicated sync) —
          // plus one more case: the shift came in unpriced, and its
          // facility has since gained a pay rule (added on the
          // Facilities tab, or edited). That re-prices it now, without
          // waiting for a source-side edit that may never come.
          const sourceUpdated = String(ev.updatedAt ?? "");
          const localUpdated = String(local.updatedAt ?? "");
          if (!String(local.pay || "").trim() && pay) {
            providerChanges.push({
              action: "update",
              shift: {
                id: local.id,
                date: ev.date,
                facility: parsed.facility,
                type: parsed.type,
                pay,
                note: local.note ||
                  `Imported from ${imported.sourceCalendarName}`,
                source: "apple-import",
                updatedAt: sourceUpdated || localUpdated || null,
              },
            });
            counts.updated++;
            imported.updated++;
            continue;
          }
          if (
            sourceUpdated && sourceUpdated > localUpdated &&
            sourceUpdated !== String(importRow?.source_updated_at ?? "")
          ) {
            providerChanges.push({
              action: "update",
              shift: {
                id: local.id,
                date: ev.date,
                facility: parsed.facility,
                type: parsed.type,
                pay,
                note: local.note ||
                  `Imported from ${imported.sourceCalendarName}`,
                source: "apple-import",
                updatedAt: sourceUpdated,
              },
            });
            counts.updated++;
            imported.updated++;
            importSaves.push({
              ...importRow,
              source_updated_at: sourceUpdated,
            });
          }
          continue;
        }
        if (decision === "skip-deleted" || decision === "skip-legacy") {
          // Genuinely deleted (explicit tombstone / deleted_locally)
          // vs legacy (migration 005 not run, so "never delivered"
          // cannot be told from "deleted"): counted apart, so "you
          // deleted" never again covers shifts that were only never
          // delivered.
          imported.skipped++;
          if (decision === "skip-deleted") imported.skippedDeleted++;
          else imported.skippedLegacy++;
          continue;
        }
        if (decision === "repair-pair") {
          // The shift is already here under another id: drop the
          // phantom row and pair the shift that is actually here, so
          // future source edits update it instead of re-creating it.
          const dupe = findImportDupe(ev.date, parsed.facility, parsed.type);
          if (dupe && importRow) {
            importDeletes.push(String(importRow.shift_id));
            importSaves.push({
              user_id: userId,
              provider,
              shift_id: dupe.id,
              source_calendar_url: sourceCalendarUrl,
              source_event_id: ev.providerEventId,
              source_updated_at: ev.updatedAt,
            });
          }
          imported.duplicates++;
          continue;
        }
        if (decision === "repair-create" && importRow) {
          // The shift was paired but never reached the device (an
          // earlier sync's response was lost). Re-create it with the
          // SAME id so the pairing stays valid; the next sync will
          // see it in localShifts and mark it seen.
          providerChanges.push({
            action: "create",
            shift: {
              id: String(importRow.shift_id),
              date: ev.date,
              facility: parsed.facility,
              type: parsed.type,
              pay,
              note: `Imported from ${imported.sourceCalendarName}`,
              source: "apple-import",
              updatedAt: ev.updatedAt,
            },
          });
          counts.created++;
          imported.created++;
          imported.repaired++;
          if (!pay) imported.unpriced++;
          importSaves.push({
            ...importRow,
            source_updated_at: ev.updatedAt,
          });
          continue;
        }
        if (decision === "duplicate") {
          // Same shift already on this device (user-entered, or created
          // from the dedicated calendar this sync): pair it so future
          // source edits can update it, but never create a second copy.
          // And as in already-here above: if it is unpriced and its
          // facility now has a pay rule, price it in the same pass.
          const dupe = findImportDupe(ev.date, parsed.facility, parsed.type);
          if (dupe) {
            importSaves.push({
              user_id: userId,
              provider,
              shift_id: dupe.id,
              source_calendar_url: sourceCalendarUrl,
              source_event_id: ev.providerEventId,
              source_updated_at: ev.updatedAt,
            });
            if (!String(dupe.pay || "").trim() && pay) {
              providerChanges.push({
                action: "update",
                shift: {
                  id: dupe.id,
                  date: ev.date,
                  facility: parsed.facility,
                  type: parsed.type,
                  pay,
                  note: dupe.note ||
                    `Imported from ${imported.sourceCalendarName}`,
                  source: "apple-import",
                  updatedAt: ev.updatedAt,
                },
              });
              counts.updated++;
              imported.updated++;
            }
          }
          imported.duplicates++;
          continue;
        }
        // Ask-first (Nov 5, 2026): a shift at a facility with no saved
        // rule is HELD, not imported — the client suggests the hospital
        // ("We noticed shifts at <Hospital> — add it as a facility?")
        // and the next sync re-scans this event. No import-map row is
        // written for it, so nothing is permanently excluded; once the
        // user adds the facility, the next sync imports it, priced.
        if (!parsed.facilityKnown) {
          imported.skipped++;
          imported.skippedSuggested++;
          continue;
        }
        const newId = crypto.randomUUID();
        importSaves.push({
          user_id: userId,
          provider,
          shift_id: newId,
          source_calendar_url: sourceCalendarUrl,
          source_event_id: ev.providerEventId,
          source_updated_at: ev.updatedAt,
        });
        providerChanges.push({
          action: "create",
          shift: {
            id: newId,
            date: ev.date,
            facility: parsed.facility,
            type: parsed.type,
            pay,
            note: `Imported from ${imported.sourceCalendarName}`,
            source: "apple-import",
            updatedAt: ev.updatedAt,
          },
        });
        counts.created++;
        imported.created++;
        if (!pay) imported.unpriced++;
      }
      imported.suggestions = groupFacilitySuggestions(suggestedEvents);
      imported.newFacilities = imported.suggestions.map((x) => x.name);
      // One flush for every import-map write this sync (see the note
      // above importSaves): deletes first, then the bulk upsert.
      await flushImportMapWrites(importSaves, importDeletes, userId, provider);
    }
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
    // Null when no Apple import source is picked; otherwise the panel
    // renders "imported N shifts from <name>" from this object.
    imported,
    lastSyncedAt: String(connPatch.last_synced_at),
  });
}

// --- Other actions -----------------------------------------------------------

async function handleConnectApple(userId: string, body: Record<string, unknown>): Promise<Response> {
  const appleId = String(body.appleId ?? "").trim();
  const password = String(body.appSpecificPassword ?? "");
  if (!appleId || !password) return err("apple_credentials_required", 400);
  if (!encryptionConfigured()) return err("encryption_not_configured", 503);
  const pickedUrl = String(body.calendarUrl ?? "").trim();
  let calendarUrl: string;
  try {
    if (pickedUrl) {
      // Pick-an-existing-calendar path: the URL must be an iCloud URL
      // under this account's calendar home-set and actually be a
      // calendar collection; anything else is rejected before storage.
      if (!/^https:\/\/[A-Za-z0-9-]+\.icloud\.com\//.test(pickedUrl)) {
        return err("apple_calendar_not_found", 400);
      }
      calendarUrl = await verifyAppleCalendar(appleId, password, pickedUrl);
    } else {
      calendarUrl = await ensureAppleCalendar(appleId, password);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "apple_auth_failed") return err("apple_auth_failed", 401);
    // iCloud refused to create a calendar (observed: 403 for a
    // non-UUID collection name). Do not fail the whole connect: hand
    // the discovered calendars back so the user can pick an existing
    // one instead. The password is never included in any of these codes.
    if (msg.startsWith("apple_calendar_create_failed")) {
      const cals = (e as unknown as { calendars?: unknown }).calendars;
      if (Array.isArray(cals)) {
        return json({ ok: false, error: "apple_create_forbidden_pick_calendar", calendars: cals }, 502);
      }
    }
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
  // Import pairings go too (a fresh connect re-imports from the source
  // calendar); the table may not exist yet if migration 004 never ran.
  try {
    await sbDelete(
      "calendar_import_map",
      `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${provider}`,
    );
  } catch { /* table absent: nothing to delete */ }
  await sbDelete(
    "calendar_connections",
    `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${provider}`,
  );
  await writeSyncLog(userId, provider, "disconnect", {}, null);
  return json({ ok: true, provider });
}

// List the user's iCloud calendars (server-side, with the stored CalDAV
// credentials) for the import-source picker. Returns only names and
// URLs — never the Apple ID or password. The dedicated calendar is
// flagged so the client can exclude it from the picker.
async function handleAppleCalendars(userId: string): Promise<Response> {
  const conn = await getConnection(userId, "apple");
  if (!conn || conn.status !== "connected") return err("not_connected", 409);
  try {
    const appleId = String(conn.provider_account ?? "");
    const password = await decryptSecret(String(conn.encrypted_password ?? ""));
    const { calendars } = await discoverAppleCalendars(appleId, password);
    const dedicated = String(conn.calendar_id ?? "").replace(/\/$/, "");
    return json({
      ok: true,
      calendars: calendars.map((c) => ({
        name: c.name ?? "Unnamed calendar",
        url: c.url,
        isDedicated: c.url.replace(/\/$/, "") === dedicated,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "apple_auth_failed") return err("needs_reauth", 401);
    return err("apple_dav_failed", 502);
  }
}

// Pick (or clear) the Apple import-source calendar. The URL is verified
// against the account's calendar home-set before anything is stored, so
// a made-up or foreign URL can never become a source. The dedicated
// "CRNA Hub" calendar cannot be picked as its own source. Only the URL
// and display name are stored — no credentials change here.
async function handleSetAppleSourceCalendar(
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const conn = await getConnection(userId, "apple");
  if (!conn || conn.status !== "connected") return err("not_connected", 409);
  const calendarUrl = String(body.calendarUrl ?? "").trim();
  const calendarName = String(body.calendarName ?? "").trim();
  if (!calendarUrl) {
    try {
      await sbPatch(
        "calendar_connections",
        `user_id=eq.${encodeURIComponent(userId)}&provider=eq.apple`,
        { source_calendar_url: null, source_calendar_name: null },
      );
    } catch {
      return err("migration_004_required", 503);
    }
    return json({ ok: true, provider: "apple", sourceCalendarUrl: null, sourceCalendarName: null });
  }
  if (!/^https:\/\/[A-Za-z0-9-]+\.icloud\.com\//.test(calendarUrl)) {
    return err("apple_calendar_not_found", 400);
  }
  if (calendarUrl.replace(/\/$/, "") === String(conn.calendar_id ?? "").replace(/\/$/, "")) {
    return err("source_is_dedicated_calendar", 400);
  }
  try {
    const appleId = String(conn.provider_account ?? "");
    const password = await decryptSecret(String(conn.encrypted_password ?? ""));
    const verified = await verifyAppleCalendar(appleId, password, calendarUrl);
    try {
      await sbPatch(
        "calendar_connections",
        `user_id=eq.${encodeURIComponent(userId)}&provider=eq.apple`,
        { source_calendar_url: verified, source_calendar_name: calendarName || null },
      );
    } catch {
      // The columns come from migration 004; without it the PATCH is
      // rejected. Say so plainly instead of a generic write failure.
      return err("migration_004_required", 503);
    }
    return json({
      ok: true,
      provider: "apple",
      sourceCalendarUrl: verified,
      sourceCalendarName: calendarName || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "apple_auth_failed") return err("needs_reauth", 401);
    if (msg === "apple_calendar_not_found") return err("apple_calendar_not_found", 400);
    return err("apple_dav_failed", 502);
  }
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
        // select=* (mapped to safe fields only below): the 004 columns
        // source_calendar_url/name may not exist yet, and an explicit
        // select naming them would fail the whole status call until the
        // owner runs migration 004. Encrypted tokens are read server-side
        // only and never leave this function.
        const rows = await sbGet(
          "calendar_connections",
          `select=*&user_id=eq.${encodeURIComponent(userId)}`,
        );
        return json({
          ok: true,
          connections: rows.map((r) => ({
            provider: r.provider,
            status: r.status,
            autoDelete: r.auto_delete === true,
            lastSyncedAt: r.last_synced_at ?? null,
            sourceCalendarUrl: (r.source_calendar_url as string | null) ?? null,
            sourceCalendarName: (r.source_calendar_name as string | null) ?? null,
          })),
        });
      }
      if (action === "apple-calendars") {
        return await handleAppleCalendars(userId);
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
      if (body.action === "set-apple-source-calendar") {
        return await handleSetAppleSourceCalendar(userId, body);
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
