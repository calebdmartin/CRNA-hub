// CRNA Hub — push watchdog Edge Function (Nov 11, 2026).
//
// Caleb's north star (Nov 11, 2026): "I want all functions to be
// running in the background as much as possible and send notifications
// when action is needed. That's the whole point of the app. After
// initial set up it should keep an eye on everything for the CRNA."
//
// This function is the single scheduled "watchdog" pass behind that
// promise. It evaluates EVERY push trigger in one place (./evaluate.ts
// holds the pure decision logic) over the records users already sync
// to Supabase, and sends a Web Push only when a human action is
// genuinely required:
//
//   cert      certification/license deadlines at 90/60/30/7 days
//   ce        education hours that may still be needed near renewal
//   calendar  on the 20th: next month has no shifts yet
//   qgenda    the QGenda subscription link was rejected (relink)
//   portal    a portal check is due and needs the user's sign-in
//   sync      a calendar connection needs reconnecting
//
// Actions (POST):
//   { action: "config" }    (user JWT) -> { ok, configured, vapidPublicKey }
//   { action: "test" }      (user JWT) -> sends one test push to the
//                            caller's own subscriptions.
//   { action: "evaluate" }  (header x-watchdog-secret) -> runs the
//                            watchdog for every subscribed user.
//
// Scheduling: call "evaluate" on a timer — pg_cron + pg_net every 6
// hours is the documented path (commented example in migration 013);
// any external scheduler hitting the endpoint works too. The pass is
// IDEMPOTENT: push_sent_log is written before sending, so re-runs,
// overlapping runs, and multi-device users never produce a repeat.
// Quiet hours (22:00–06:00 in each user's timezone, from their push
// subscription) hold notifications unsent; the next run after 06:00
// sends them.
//
// Secrets this function reads (Supabase dashboard → Edge Functions →
// Secrets — set by Caleb, never committed):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…),
//   WATCHDOG_CRON_SECRET (any long random string; the scheduler sends
//   it as the x-watchdog-secret header).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are
// platform-provided, as for the other functions.
//
// Requires migration 013 (push_subscriptions, push_sent_log). Until it
// runs, evaluate/test fail cleanly with push_not_enabled.
//
// Honest limits of the web/PWA form (the architecture is the final-app
// architecture — server-side evaluation — these are input limits):
// - Portal-monitoring state lives on the user's device by design; the
//   app syncs a compact "watch" summary (which checks need sign-in,
//   QGenda link health, calendar-sync health) into user_settings, and
//   the watchdog notifies from that. A device that never opens the app
//   can't refresh that summary — the notification still fires from the
//   last synced state.
// - Hand-entered "other credentials" (db.credentials) have no synced
//   table, so their deadlines are evaluated on-device only today;
//   NBCRNA, AANA, licenses, and certification documents — the synced
//   records — are all covered here.

import {
  CORS,
  json,
  err,
  authUserId,
  sbGet,
  sbInsert,
  sbDelete,
} from "../_shared/calendar.ts";
import { evaluateUser } from "./evaluate.ts";
import { sendWebPush } from "./webpush.ts";

function env(name: string): string {
  return Deno.env.get(name) ?? "";
}

function vapidConfig() {
  const publicKey = env("VAPID_PUBLIC_KEY");
  const privateKey = env("VAPID_PRIVATE_KEY");
  const subject = env("VAPID_SUBJECT") || "mailto:crna-hub@example.com";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

interface SubRow {
  id: string;
  user_id: string;
  endpoint: string;
  keys: { p256dh?: string; auth?: string };
  tz?: string;
}

function localParts(tz: string, now: Date) {
  const fallback = {
    todayStr: now.toISOString().slice(0, 10),
    hour: now.getUTCHours(),
    day: Number(now.toISOString().slice(8, 10)),
  };
  if (!tz) return fallback;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const get = (t: string) =>
      (parts.find((p) => p.type === t) || {}).value || "";
    const todayStr = get("year") + "-" + get("month") + "-" + get("day");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayStr)) return fallback;
    return {
      todayStr,
      hour: parseInt(get("hour"), 10) || 0,
      day: parseInt(get("day"), 10) || 0,
    };
  } catch (_e) {
    return fallback;
  }
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

function nextMonthOf(todayStr: string) {
  const y = Number(todayStr.slice(0, 4));
  const m = Number(todayStr.slice(5, 7));
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  const prefix = ny + "-" + String(nm).padStart(2, "0");
  const after = nm === 12
    ? (ny + 1) + "-01"
    : ny + "-" + String(nm + 1).padStart(2, "0");
  return {
    prefix,
    first: prefix + "-01",
    afterFirst: after + "-01",
    label: MONTH_NAMES[nm - 1] + " " + ny,
  };
}

// Sends one notification to all of a user's subscriptions, pruning
// subscriptions the push service says are gone. Returns true when at
// least one push service accepted a message.
async function deliver(
  subs: SubRow[],
  note: { title: string; body: string; url: string; triggerKey: string },
  vapid: { publicKey: string; privateKey: string; subject: string },
  appBase: string,
): Promise<boolean> {
  let delivered = false;
  for (const sub of subs) {
    try {
      const status = await sendWebPush(sub, {
        title: note.title,
        body: note.body,
        url: appBase + note.url,
        tag: note.triggerKey,
      }, vapid);
      if (status === 404 || status === 410) {
        await sbDelete(
          "push_subscriptions",
          "id=eq." + encodeURIComponent(sub.id),
        ).catch(() => {});
      } else if (status >= 200 && status < 300) {
        delivered = true;
      }
    } catch (_e) { /* one bad endpoint never blocks the others */ }
  }
  return delivered;
}

async function evaluateOneUser(
  userId: string,
  subs: SubRow[],
  vapid: { publicKey: string; privateKey: string; subject: string },
  appBase: string,
): Promise<{ sent: number; held: number }> {
  const tz = (subs.find((s) => s.tz) || {}).tz || "";
  const parts = localParts(tz, new Date());
  const uid = "user_id=eq." + encodeURIComponent(userId);
  const [settingsRows, nbcrna, aana, licenses, documents, cePeek, sentRows] =
    await Promise.all([
      sbGet("user_settings", "select=data&" + uid).catch(() => []),
      sbGet("nbcrna_profiles", "select=*&" + uid).catch(() => []),
      sbGet("aana_memberships", "select=*&" + uid).catch(() => []),
      sbGet("licenses", "select=*&" + uid).catch(() => []),
      sbGet("documents", "select=*&" + uid).catch(() => []),
      sbGet("ce_records", "select=id&limit=1&" + uid).catch(() => [{}]),
      sbGet("push_sent_log", "select=trigger_key&" + uid).catch(() => []),
    ]);
  const settings = (settingsRows[0] && settingsRows[0].data) || {};
  const nm = nextMonthOf(parts.todayStr);
  let nextMonthShiftCount = 1; // assume non-empty until checked
  if (parts.day === 20) {
    const peek = await sbGet(
      "shifts",
      "select=id&limit=1&" + uid + "&date=gte." + nm.first +
        "&date=lt." + nm.afterFirst,
    ).catch(() => [{}]);
    nextMonthShiftCount = peek.length;
  }
  const notes = evaluateUser({
    todayStr: parts.todayStr,
    localHour: parts.hour,
    isTwentieth: parts.day === 20,
    nextMonthPrefix: nm.prefix,
    nextMonthLabel: nm.label,
    nextMonthShiftCount,
    settings,
    rows: {
      nbcrna: nbcrna[0] || {},
      aana: aana[0] || {},
      licenses,
      documents,
      credentials: [], // no synced table for hand-entered credentials
    },
    ceRecordCount: cePeek.length,
    sentKeys: sentRows.map((r) => String(r.trigger_key || "")),
  });
  let sent = 0;
  for (const note of notes) {
    // Log BEFORE sending: a crash or an overlapping run can then
    // never produce a duplicate. A delivery that reaches no device
    // (e.g. every endpoint errored) un-logs itself for the next run.
    try {
      await sbInsert("push_sent_log", {
        user_id: userId, trigger_key: note.triggerKey,
      });
    } catch (_e) {
      continue; // already logged by an earlier/overlapping run
    }
    const ok = await deliver(subs, note, vapid, appBase);
    if (ok) {
      sent++;
    } else {
      await sbDelete(
        "push_sent_log",
        "user_id=eq." + encodeURIComponent(userId) +
          "&trigger_key=eq." + encodeURIComponent(note.triggerKey),
      ).catch(() => {});
    }
  }
  return { sent, held: 0 };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") return err("method_not_allowed", 405);
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_e) { /* empty body */ }
  const action = String((body && body.action) || "");
  const vapid = vapidConfig();
  const appBase = (env("APP_URL") || "").replace(/\/$/, "");

  if (action === "config") {
    const userId = await authUserId(req);
    if (!userId) return err("not_signed_in", 401);
    return json({
      ok: true,
      configured: !!vapid,
      vapidPublicKey: vapid ? vapid.publicKey : "",
    });
  }

  if (action === "test") {
    const userId = await authUserId(req);
    if (!userId) return err("not_signed_in", 401);
    if (!vapid) return err("push_not_configured", 503);
    let subs: SubRow[] = [];
    try {
      subs = (await sbGet(
        "push_subscriptions",
        "select=*&user_id=eq." + encodeURIComponent(userId),
      )) as unknown as SubRow[];
    } catch (_e) {
      return err("push_not_enabled", 503);
    }
    if (!subs.length) return err("no_subscription", 400);
    const ok = await deliver(subs, {
      title: "CRNA Hub",
      body: "Test notification — push is working. We'll only message you when something needs your attention.",
      url: "?go=account",
      triggerKey: "test|" + Date.now(),
    }, vapid, appBase);
    return json({ ok: true, delivered: ok, subscriptions: subs.length });
  }

  if (action === "evaluate") {
    const secret = env("WATCHDOG_CRON_SECRET");
    if (!secret || req.headers.get("x-watchdog-secret") !== secret) {
      return err("forbidden", 403);
    }
    if (!vapid) return err("push_not_configured", 503);
    let subs: SubRow[] = [];
    try {
      subs = (await sbGet("push_subscriptions", "select=*")) as unknown as SubRow[];
    } catch (_e) {
      return err("push_not_enabled", 503);
    }
    const byUser = new Map<string, SubRow[]>();
    for (const s of subs) {
      if (!s || !s.user_id || !s.endpoint) continue;
      const list = byUser.get(s.user_id) || [];
      list.push(s);
      byUser.set(s.user_id, list);
    }
    let users = 0, sent = 0;
    for (const [userId, userSubs] of byUser) {
      try {
        const r = await evaluateOneUser(userId, userSubs, vapid, appBase);
        users++;
        sent += r.sent;
      } catch (_e) { /* one user's failure never stops the pass */ }
    }
    return json({ ok: true, users, sent });
  }

  return err("unknown_action", 400);
});
