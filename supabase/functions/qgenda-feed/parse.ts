// CRNA Hub — QGenda subscription-feed helpers (pure, tested).
//
// A QGenda "Your Subscription URL" is a personal ICS feed: one URL per
// user, listing only that user's shifts. The server polls it like any
// subscribed calendar; the client never sees the URL and the feed is
// never fetched from the browser (QGenda does not send CORS headers).
//
// The URL is a secret: validated here (https + qgenda host + a feed-like
// path), stored encrypted with the same AES-GCM helper as the other
// provider credentials, and only ever shown back masked (host + last 4
// characters). It is never logged and never returned in full.

import {
  parseWorkShiftEvent,
  type FacilityPayRule,
} from "../_shared/calendar.ts";

export interface QgendaShift {
  date: string;
  facility: string;
  type: string;
  pay: string;
  facilityKnown: boolean;
  // Import status from the shared parser (Bug 1, Nov 6, 2026): a shift
  // dated before today already happened, so it arrives 'confirmed';
  // future shifts arrive 'proposed'. The client applies the same rule
  // from the local date when it saves the shift.
  status: "confirmed" | "proposed";
  uid: string;
}

export function isQgendaFeedUrl(url: string): boolean {
  try {
    const u = new URL(String(url || "").trim());
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (!(h === "qgenda.com" || h.endsWith(".qgenda.com"))) return false;
    const p = (u.pathname + u.search).toLowerCase();
    return (
      p.includes("ical") ||
      p.includes("ics") ||
      p.includes("sync") ||
      p.includes("calendar") ||
      p.includes("subscription")
    );
  } catch {
    return false;
  }
}

// Host + last 4 characters only — enough to recognise which feed is
// connected, never enough to use it.
export function maskFeedUrl(url: string): string {
  try {
    const u = new URL(String(url || "").trim());
    const tail = String(url).trim().slice(-4);
    return `${u.protocol}//${u.hostname}/…••••${tail}`;
  } catch {
    return "https://app.qgenda.com/…••••";
  }
}

function unfoldIcs(text: string): string {
  return String(text || "")
    .replace(/\r\n[ \t]/g, "")
    .replace(/\r?\n[ \t]/g, "");
}

function icsDateToIso(v: string): string {
  const t = String(v || "").trim();
  const m = t.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

// Parse a QGenda ICS feed into shift rows with the same
// facilities-driven parser the calendar sync uses, so a QGenda event
// and a work-calendar event for the same shift read identically.
// Events that do not parse as shifts (no facility + shift pattern)
// are skipped, never invented. Unknown facilities come back with
// facilityKnown false and pay blank — the client reports them as
// ask-first suggestions, never as priced shifts.
export function parseQgendaICS(
  icsText: string,
  facilities: FacilityPayRule[],
): {
  shifts: QgendaShift[];
  unknownFacilities: string[];
  eventCount: number;
} {
  const clean = unfoldIcs(icsText);
  const blocks = clean.split(/BEGIN:VEVENT/i).slice(1);
  const shifts: QgendaShift[] = [];
  const unknown = new Map<string, number>();
  for (const b of blocks) {
    const get = (k: string): string => {
      const m = b.match(new RegExp(k + "(?:;[^:]*)?:(.*)", "i"));
      return m ? m[1].trim().replace(/\\n/g, " ") : "";
    };
    const date = icsDateToIso(get("DTSTART"));
    if (!date) continue;
    const summary = get("SUMMARY");
    const location = get("LOCATION");
    const uid = get("UID") || `${date}|${summary}|${location}`;
    const parsed = parseWorkShiftEvent(summary, location, date, facilities);
    if (!parsed) continue;
    shifts.push({
      date,
      facility: parsed.facility,
      type: parsed.type,
      pay: parsed.pay,
      facilityKnown: parsed.facilityKnown,
      status: parsed.status,
      uid,
    });
    if (!parsed.facilityKnown) {
      unknown.set(parsed.facility, (unknown.get(parsed.facility) ?? 0) + 1);
    }
  }
  return { shifts, unknownFacilities: [...unknown.keys()], eventCount: blocks.length };
}
