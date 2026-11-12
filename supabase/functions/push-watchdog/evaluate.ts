// CRNA Hub — push watchdog: pure trigger evaluation (Nov 11, 2026).
//
// Caleb's north star (Nov 11, 2026): everything runs in the background
// and the app only interrupts when a human action is genuinely needed.
// This module is the single place every "action needed" outcome is
// decided. It takes one user's SYNCED records (already fetched by
// index.ts) plus the set of trigger keys already sent, and returns the
// notifications that should go out now. It is deliberately pure — no
// fetch, no Deno APIs, no clock reads beyond the inputs — so the exact
// logic that runs in the Edge Function is harness-tested in node.
//
// Dedup contract: every notification carries a stable `triggerKey`.
// index.ts inserts that key into push_sent_log BEFORE sending and
// skips keys already logged, so a notification fires at most once per
// threshold/episode no matter how often evaluation runs or how many
// devices the user has.
//
// Quiet hours: 22:00–06:00 in the USER's timezone (from their push
// subscription). During quiet hours evaluation returns nothing; the
// triggers stay un-logged, so the first run after 06:00 sends them —
// that is the "hold and send after 06:00" behavior.
//
// Honesty rules baked in:
// - CE notifications say "may still need education hours" and cite
//   only what the app actually tracks (NBCRNA MAC Ed/MAC Dev numbers
//   on the profile, or the absence of ANY CE records for a license
//   renewal). The app never claims a deficiency it cannot know.
// - Deadline items are collected and deduped with the same semantics
//   as the app's Dashboard deadline card (collectDeadlineItems /
//   dedupeDeadlines in app.js): NBCRNA renewal, AANA membership,
//   state licenses, certification documents, credentials.

export const PUSH_THRESHOLDS = [90, 60, 30, 7];

export function daysUntilISO(dateStr, todayStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todayStr || ""))) return null;
  const d = Date.parse(dateStr + "T12:00:00Z");
  const t = Date.parse(todayStr + "T12:00:00Z");
  if (Number.isNaN(d) || Number.isNaN(t)) return null;
  return Math.round((d - t) / 864e5);
}

export function deadlineDedupeKey(x) {
  return String(x.date || "") + "|" +
    String(x.label || "").toLowerCase().replace(/\s+/g, " ")
      .replace(/\s+(certification|membership)$/, "").trim();
}

// rows: { nbcrna, aana, licenses[], documents[], credentials[] } —
// the synced table shapes (typed columns, as PostgREST returns them;
// credentials arrive via their `data` payloads).
export function collectDeadlineItemsFromRows(rows, todayStr) {
  const items = [];
  const add = (label, date, source) => {
    const days = daysUntilISO(date, todayStr);
    if (days === null) return;
    items.push({ label, date, days, source });
  };
  const n = (rows && rows.nbcrna) || {};
  add("NBCRNA certification", n.renewal_deadline || n.period_end, "NBCRNA");
  const a = (rows && rows.aana) || {};
  add("AANA membership", a.expiration, "AANA");
  ((rows && rows.licenses) || []).forEach((x) =>
    add(((x.state || "License") + " " + (x.license_type || "")).trim(),
      x.expiration_date, "State license")
  );
  ((rows && rows.documents) || []).forEach((x) =>
    add((x.cert_type || "Certification") + " certification",
      x.expiration_date, "Certification document")
  );
  ((rows && rows.credentials) || []).forEach((x) =>
    add(x.name || "Credential", x.expiry, "Credential")
  );
  const seen = new Set();
  const out = [];
  for (const x of items) {
    const k = deadlineDedupeKey(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out.sort((x, y) => String(x.date).localeCompare(String(y.date)));
}

// The threshold a deadline fires at today: the smallest threshold the
// remaining days have crossed (daily evaluation crosses each threshold
// exactly once), 0 for already-expired (fires once), or null when no
// threshold has been crossed yet.
export function thresholdFor(days) {
  if (days === null || days === undefined) return null;
  if (days < 0) return 0;
  let hit = null;
  for (const t of PUSH_THRESHOLDS) if (days <= t) hit = t;
  return hit;
}

export function fmtDateLong(dateStr) {
  const d = new Date(String(dateStr || "") + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return String(dateStr || "");
  return d.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function pushTypesOf(settings) {
  const t = (settings && settings.pushTypes) || {};
  const on = (k) => t[k] !== false;
  return {
    cert: on("cert"), ce: on("ce"), calendar: on("calendar"),
    qgenda: on("qgenda"), portal: on("portal"), sync: on("sync"),
  };
}

// input: {
//   todayStr, localHour,           // user-local today + hour (0-23)
//   isTwentieth, nextMonthPrefix, nextMonthLabel, nextMonthShiftCount,
//   settings,                      // user_settings.data
//   rows,                          // synced tables (see above)
//   ceRecordCount,                 // ce_records rows for this user
//   sentKeys,                      // Set/array of logged trigger keys
// }
// Returns [{triggerKey, type, title, body, url}] — unsent only.
export function evaluateUser(input) {
  const out = [];
  if (!input || typeof input !== "object") return out;
  const hour = input.localHour;
  if (typeof hour === "number" && (hour >= 22 || hour < 6)) return out;
  const settings = input.settings || {};
  if (settings.featurePush === false) return out;
  const types = pushTypesOf(settings);
  const sent = new Set(input.sentKeys || []);
  const todayStr = input.todayStr;
  const due = (n) => { if (!sent.has(n.triggerKey)) out.push(n); };

  // (a) Certification & license expirations at 90/60/30/7 days.
  if (types.cert) {
    const items = collectDeadlineItemsFromRows(input.rows || {}, todayStr);
    for (const item of items) {
      const th = thresholdFor(item.days);
      if (th === null) continue;
      const body = item.days < 0
        ? item.label + " expired " + Math.abs(item.days) + " day" +
          (Math.abs(item.days) === 1 ? "" : "s") + " ago (" +
          fmtDateLong(item.date) + "). Time to renew."
        : item.label + " is due " + fmtDateLong(item.date) + " — " +
          item.days + " day" + (item.days === 1 ? "" : "s") + " left.";
      due({
        triggerKey: "cert|" + deadlineDedupeKey(item) + "|" + th,
        type: "cert",
        title: item.days < 0
          ? item.label + " expired"
          : item.label + " — " + item.days + " days left",
        body,
        url: "?go=credentials",
      });
    }
  }

  // (b) Education / CE — only what the app tracks, phrased honestly.
  if (types.ce) {
    const rows = input.rows || {};
    const n = rows.nbcrna || {};
    const cycleEnd = n.renewal_deadline || n.period_end || "";
    const cycleDays = daysUntilISO(cycleEnd, todayStr);
    if (cycleDays !== null && cycleDays <= 90) {
      const edReq = Number(n.mac_ed_required) || 60;
      const devReq = Number(n.mac_dev_required) || 40;
      const ed = Number(n.mac_ed_credits) || 0;
      const dev = Number(n.mac_dev_credits) || 0;
      if (ed < edReq || dev < devReq) {
        due({
          triggerKey: "ce|nbcrna|" + cycleEnd,
          type: "ce",
          title: "NBCRNA education hours",
          body: "Your NBCRNA cycle ends " + fmtDateLong(cycleEnd) +
            " and our records show MAC Ed " + ed + "/" + edReq +
            " · MAC Dev " + dev + "/" + devReq +
            " — you may still need education hours.",
          url: "?go=credentials",
        });
      }
    }
    // State licenses: the app holds no per-license CE linkage, so the
    // honest signal is "renewal is near and we have no CE records on
    // file at all" — never a claimed deficiency.
    // v150: licenses the app mirrors CE progress for
    // (settings.watch.ceLicenses) are handled by the per-license block
    // (g) below — never double-alert for the same license here.
    const ceMirrorKeys = new Set((((settings.watch || {}).ceLicenses) || []).map((e) => String((e && e.key) || "")));
    if (!input.ceRecordCount) {
      for (const lic of rows.licenses || []) {
        const licKey = (String(lic.state || "").trim().toUpperCase() + "|" + String(lic.license_type || "").trim().toUpperCase());
        if (ceMirrorKeys.has(licKey)) continue;
        const days = daysUntilISO(lic.expiration_date, todayStr);
        if (days === null || days > 90 || days < 0) continue;
        const label = ((lic.state || "License") + " " +
          (lic.license_type || "")).trim();
        due({
          triggerKey: "ce|license|" + label + "|" + lic.expiration_date,
          type: "ce",
          title: label + " renewal coming up",
          body: label + " renews " + fmtDateLong(lic.expiration_date) +
            " and we don't have education (CE) records on file for " +
            "this renewal yet — you may still need hours.",
          url: "?go=credentials",
        });
      }
    }
  }

  // (c) Empty calendar: on the 20th, next month has zero shifts.
  if (types.calendar && input.isTwentieth &&
    input.nextMonthShiftCount === 0) {
    due({
      triggerKey: "calendar|" + (input.nextMonthPrefix || ""),
      type: "calendar",
      title: "No shifts scheduled next month",
      body: "We see you have no scheduled dates for " +
        (input.nextMonthLabel || "next month") +
        " — want to add them?",
      url: "?go=dashboard",
    });
  }

  const watch = settings.watch || {};

  // (d) QGenda link rejected (expired/changed subscription URL) —
  // once per failure episode; the episode id is set by the client when
  // the failure starts and cleared on the next successful check.
  if (types.qgenda && watch.qgendaLink &&
    watch.qgendaLink.state === "auth_failed" && watch.qgendaLink.episode) {
    due({
      triggerKey: "qgenda|" + watch.qgendaLink.episode,
      type: "qgenda",
      title: "QGenda link needs a refresh",
      body: "Your QGenda link needs a refresh — reconnect it so your " +
        "schedule keeps syncing itself.",
      url: "?go=facilities",
    });
  }

  // (e) Portal checks that need the user's sign-in — one per due
  // cycle per source (the client records key + cycle from the same
  // monitor state that drives the in-app "Checks due" prompts).
  if (types.portal && Array.isArray(watch.portalSignin)) {
    for (const p of watch.portalSignin) {
      if (!p || !p.key || !p.cycle) continue;
      due({
        triggerKey: "portal|" + p.key + "|" + p.cycle,
        type: "portal",
        title: "Portal check needs your sign-in",
        body: (p.label || "A portal") +
          " check is due and needs your sign-in — it only takes a minute.",
        url: "?go=credentials",
      });
    }
  }

  // (f) Calendar sync needs reconnecting — once per episode.
  if (types.sync && watch.syncHealth &&
    watch.syncHealth.state === "needs_reauth" && watch.syncHealth.episode) {
    due({
      triggerKey: "sync|" + watch.syncHealth.episode,
      type: "sync",
      title: "Calendar sync needs reconnecting",
      body: "Your calendar sync needs reconnecting — tap to reconnect " +
        "so your shifts keep flowing both ways.",
      url: "?go=account",
    });
  }

  // (g) v150 — per-license state CE progress, mirrored by the app in
  // settings.watch.ceLicenses (built from the state requirements table
  // + the CE records the user assigned to each license). Hours-rule
  // licenses only: conflict / no-CE / competency-model licenses arrive
  // flagged `excluded` and are never alerted. Tracked-but-short fires
  // once per reminder window (90/60/30/7) with the numbers; nothing
  // tracked fires once, at the 90-day window only; fully met is silent.
  if (types.ce && Array.isArray(watch.ceLicenses)) {
    for (const e of watch.ceLicenses) {
      if (!e || e.excluded || !e.label || !e.expiry) continue;
      const days = daysUntilISO(e.expiry, todayStr);
      if (days === null || days < 0) continue;
      const th = thresholdFor(days);
      if (th === null) continue;
      if (!e.tracked) {
        if (th !== 90) continue;
        due({
          triggerKey: "ce|license-hours|" + e.label + "|" + e.expiry +
            "|untracked",
          type: "ce",
          title: e.label + " — CE not tracked yet",
          body: e.label + " renews " + fmtDateLong(e.expiry) +
            " and needs " + e.total + " CE hours, but no courses are " +
            "counted toward it in the app yet — add them so we can " +
            "watch the hours for you.",
          url: "?go=credentials",
        });
        continue;
      }
      const shortSubs = (e.tracked.subs || [])
        .filter((s) => Number(s.have || 0) < Number(s.need || 0));
      const shortTotal = Number(e.tracked.total || 0) < Number(e.total || 0);
      if (!shortTotal && !shortSubs.length) continue;
      const parts = ["CE on file: " + Number(e.tracked.total || 0) +
        " of " + e.total + " hrs"];
      for (const s of shortSubs) {
        parts.push(s.label + " " + Number(s.have || 0) + " of " + s.need);
      }
      due({
        triggerKey: "ce|license-hours|" + e.label + "|" + e.expiry +
          "|" + th,
        type: "ce",
        title: e.label + " CE behind",
        body: e.label + " renews " + fmtDateLong(e.expiry) + ". " +
          parts.join(" · ") + ".",
        url: "?go=credentials",
      });
    }
  }

  return out;
}
