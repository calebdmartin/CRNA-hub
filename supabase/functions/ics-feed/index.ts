// CRNA Hub — calendar-link (ICS feed) Edge Function.
//
// The universal calendar door (Nov 12, 2026): whatever app an
// Android (or any) user keeps their schedule in, it can hand out a
// subscription link — Google Calendar's "Secret address in iCal
// format", Outlook's published-calendar ICS link, an Apple shared
// calendar's link. The user pastes that link here; this function
// stores it encrypted and polls the feed like any subscribed
// calendar, returning the work shifts it finds for
// preview-before-save in the app. A link calendar is READ-ONLY by
// nature: nothing is ever written back through it.
//
// Security model — same as the QGenda feed:
// - The link is a secret (anyone who has it can read the calendar).
//   It is stored encrypted (AES-GCM under CALENDAR_ENCRYPTION_KEY)
//   in `calendar_connections` with provider='ics', in the
//   encrypted_password column — the column that holds "this
//   connection's secret". It is never stored on the device, never
//   returned in full (masked only), and never logged.
// - Every request validates the Supabase Auth JWT and scopes rows
//   to that user_id. The fetch runs server-side only (calendar
//   hosts do not send CORS headers for browsers to read feeds).
// - The fetched feed is validated as ICS (BEGIN:VCALENDAR). Unlike
//   QGenda there is no host allowlist — any calendar app may host a
//   feed — but the final URL after redirects must still be https.
//   Errors carry a short code, never a provider response body or
//   the link.
//
// Actions (POST, auth):
//   { action: "status" }            -> { ok, connected, masked, lastFetchedAt }
//   { action: "save", url }         -> { ok, connected, masked }
//   { action: "fetch", facilities } -> { ok, shifts, unknownFacilities, eventCount, masked, fetchedAt }
//   { action: "disconnect" }        -> { ok, connected: false }
//
// Requires migration 016 (calendar_connections provider check gains
// 'ics'). Until 016 runs, save fails cleanly with ics_not_enabled
// instead of a database error — the same contract QGenda shipped
// under before migration 006.

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
  isIcsFeedUrl,
  maskIcsFeedUrl,
  normalizeIcsFeedUrl,
  parseIcsFeedICS,
  ICS_FEED_PARSER_VERSION,
} from "./parse.ts";

const PROVIDER = "ics";

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
          parserVersion: ICS_FEED_PARSER_VERSION,
        });
      }
      let masked: string | null = null;
      try {
        masked = maskIcsFeedUrl(
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
        parserVersion: ICS_FEED_PARSER_VERSION,
      });
    }

    if (action === "save") {
      const url = normalizeIcsFeedUrl(
        typeof body.url === "string" ? body.url : "",
      );
      if (!url) return err("invalid_feed_url", 400);
      if (!encryptionConfigured()) return err("encryption_not_configured", 503);
      try {
        await sbUpsert("calendar_connections", {
          user_id: userId,
          provider: PROVIDER,
          provider_account: "Calendar link",
          encrypted_password: await encryptSecret(url),
          status: "connected",
        }, "user_id,provider");
      } catch (_e) {
        return json(
          {
            ok: false,
            error: "ics_not_enabled",
            message:
              "Calendar links are not enabled on this project yet — run migration 016 (supabase-schema-016.sql) in the Supabase SQL Editor, then try again.",
          },
          503,
        );
      }
      return json({ ok: true, connected: true, masked: maskIcsFeedUrl(url) });
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
      if (!isIcsFeedUrl(url)) return err("invalid_feed_url", 400);
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
        // A revoked/reset secret address answers 401/403/404 — that
        // is a RELINK problem, not a transient outage. 5xx and
        // network failures stay feed_unreachable.
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          return err("feed_link_rejected", 502);
        }
        return err("feed_unreachable", 502);
      }
      try {
        const finalUrl = new URL(res.url);
        if (finalUrl.protocol !== "https:") {
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
      const parsed = parseIcsFeedICS(text, facilities);
      await sbUpsert("calendar_connections", {
        user_id: userId,
        provider: PROVIDER,
        last_synced_at: new Date().toISOString(),
      }, "user_id,provider");
      return json({
        ok: true,
        shifts: parsed.shifts,
        derivedCodes: parsed.derivedCodes,
        unknownFacilities: parsed.unknownFacilities,
        eventCount: parsed.eventCount,
        droppedNonShift: parsed.droppedNonShift,
        droppedNoDate: parsed.droppedNoDate,
        droppedCancelled: parsed.droppedCancelled,
        masked: maskIcsFeedUrl(url),
        fetchedAt: new Date().toISOString(),
        parserVersion: ICS_FEED_PARSER_VERSION,
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
    return err("ics_failed", 502);
  }
});
