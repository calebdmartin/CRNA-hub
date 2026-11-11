// CRNA Hub — QGenda subscription-feed Edge Function.
//
// Easiest legal v1 for QGenda (Nov 5, 2026): the user copies their
// personal "Your Subscription URL" from app.qgenda.com (Sync button) and
// pastes it into CRNA Hub. This function stores it encrypted and polls
// the ICS feed like any subscribed calendar, returning only that user's
// shifts for preview-before-save in the app.
//
// Security model — same as the other calendar connections:
// - The URL is a secret. It is stored encrypted (AES-GCM under
//   CALENDAR_ENCRYPTION_KEY) in `calendar_connections` with
//   provider='qgenda', in the encrypted_password column — the column
//   that holds "this connection's secret" (Apple's app-specific
//   password for Apple, the feed URL for QGenda). It is never stored on
//   the device, never returned in full (masked only), and never logged.
// - Every request validates the Supabase Auth JWT and scopes rows to
//   that user_id. The fetch runs server-side only.
// - The fetched feed is validated as ICS (BEGIN:VCALENDAR) and its
//   final host must still be qgenda.com after redirects. Errors carry a
//   short code, never a provider response body or the URL.
//
// Actions (POST, auth):
//   { action: "status" }            -> { ok, connected, masked, lastFetchedAt }
//   { action: "save", url }         -> { ok, connected, masked }
//   { action: "fetch", facilities } -> { ok, shifts, unknownFacilities, eventCount, masked, fetchedAt }
//   { action: "disconnect" }        -> { ok, connected: false }
//
// NOT built here: the official QGenda REST API. It needs a per-hospital
// API account + Company Key from QGenda, a written agreement, and fees —
// a later per-hospital step. This function never logs into QGenda, never
// stores a QGenda password, and never touches any other user's shifts:
// the subscription URL belongs to one person.
//
// Requires migration 006 (calendar_connections provider check gains
// 'qgenda'). Until 006 runs, save fails cleanly with
// qgenda_not_enabled instead of a database error.

import {
  CORS,
  json,
  err,
  authUserId,
  sbUpsert,
  sbDelete,
  encryptSecret,
  decryptSecret,
  encryptionConfigured,
  getConnection,
  normalizeFacilityRules,
} from "../_shared/calendar.ts";
import {
  isQgendaFeedUrl,
  maskFeedUrl,
  parseQgendaICS,
  QGENDA_PARSER_VERSION,
} from "./parse.ts";

const PROVIDER = "qgenda";

async function loadRow(userId: string) {
  return await getConnection(userId, PROVIDER);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") return err("method_not_allowed", 405);
  try {
    const userId = await authUserId(req);
    if (!userId) return err("not_signed_in", 401);
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") return err("bad_request", 400);
    const action = String(body.action || "");

    if (action === "status") {
      const row = await loadRow(userId);
      if (!row) {
        return json({
          ok: true,
          connected: false,
          masked: null,
          parserVersion: QGENDA_PARSER_VERSION,
        });
      }
      let masked: string | null = null;
      try {
        masked = maskFeedUrl(
          await decryptSecret(String(row.encrypted_password ?? "")),
        );
      } catch (_e) {
        masked = null;
      }
      return json({
        ok: true,
        connected: true,
        masked,
        lastFetchedAt: String(row.last_synced_at ?? ""),
        parserVersion: QGENDA_PARSER_VERSION,
      });
    }

    if (action === "save") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) return err("missing_url", 400);
      if (!isQgendaFeedUrl(url)) return err("invalid_feed_url", 400);
      if (!encryptionConfigured()) return err("encryption_not_configured", 503);
      try {
        await sbUpsert("calendar_connections", {
          user_id: userId,
          provider: PROVIDER,
          provider_account: "QGenda feed",
          encrypted_password: await encryptSecret(url),
          status: "connected",
        }, "user_id,provider");
      } catch (_e) {
        return json(
          {
            ok: false,
            error: "qgenda_not_enabled",
            message:
              "QGenda is not enabled on this project yet — run migration 006 (supabase-schema-006.sql) in the Supabase SQL Editor, then try again.",
          },
          503,
        );
      }
      return json({ ok: true, connected: true, masked: maskFeedUrl(url) });
    }

    if (action === "fetch") {
      const row = await loadRow(userId);
      if (!row) return err("not_connected", 400);
      if (!encryptionConfigured()) return err("encryption_not_configured", 503);
      let url = "";
      try {
        url = await decryptSecret(String(row.encrypted_password ?? ""));
      } catch (_e) {
        return err("feed_unreadable", 502);
      }
      if (!isQgendaFeedUrl(url)) return err("invalid_feed_url", 400);
      let res: Response;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          res = await fetch(url, {
            headers: { Accept: "text/calendar" },
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (_e) {
        return err("feed_unreachable", 502);
      }
      if (!res.ok) {
        // v118: an expired/rotated subscription URL answers 401/403/
        // 404 — that is a RELINK problem (the push watchdog notifies
        // once per episode), not a transient outage. 5xx and network
        // failures stay feed_unreachable and never trigger a relink
        // notification.
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          return err("feed_link_rejected", 502);
        }
        return err("feed_unreachable", 502);
      }
      try {
        const finalHost = new URL(res.url).hostname.toLowerCase();
        if (
          !(finalHost === "qgenda.com" || finalHost.endsWith(".qgenda.com"))
        ) {
          return err("feed_redirected", 502);
        }
      } catch (_e) {
        return err("feed_unreachable", 502);
      }
      const text = await res.text();
      if (!/^BEGIN:VCALENDAR/i.test(text.trim())) {
        return err("feed_not_ics", 502);
      }
      const facilities = normalizeFacilityRules(body.facilities ?? []);
      const parsed = parseQgendaICS(text, facilities, {
        name: typeof body.name === "string" ? body.name : "",
      });
      await sbUpsert("calendar_connections", {
        user_id: userId,
        provider: PROVIDER,
        last_synced_at: new Date().toISOString(),
      }, "user_id,provider");
      return json({
        ok: true,
        shifts: parsed.shifts,
        unknownFacilities: parsed.unknownFacilities,
        eventCount: parsed.eventCount,
        droppedHousekeeping: parsed.droppedHousekeeping,
        droppedNoDate: parsed.droppedNoDate,
        masked: maskFeedUrl(url),
        fetchedAt: new Date().toISOString(),
        parserVersion: QGENDA_PARSER_VERSION,
      });
    }

    if (action === "disconnect") {
      await sbDelete(
        "calendar_connections",
        `user_id=eq.${encodeURIComponent(userId)}&provider=eq.${PROVIDER}`,
      );
      return json({ ok: true, connected: false });
    }

    return err("unknown_action", 400);
  } catch (e) {
    if (e instanceof Error && e.message === "encryption_not_configured") {
      return err("encryption_not_configured", 503);
    }
    return err("qgenda_failed", 502);
  }
});
