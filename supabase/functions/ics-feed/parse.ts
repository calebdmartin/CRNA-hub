// CRNA Hub — calendar-link (ICS feed) helpers (pure, tested).
//
// A calendar link is a subscription URL the user copies from their
// own calendar app: Google Calendar's "Secret address in iCal
// format", Outlook's published-calendar ICS link, an Apple shared
// calendar's link, or any other app's .ics subscription address.
// The server polls it like any subscribed calendar and returns the
// work shifts it finds for preview-before-save in the app.
//
// The link is a secret — anyone who has it can read the calendar.
// It is validated here (https after normalising webcal://), stored
// encrypted with the same AES-GCM helper as the other provider
// credentials, and only ever shown back masked (host + last 4
// characters). It is never logged and never returned in full.
//
// Parsing is deliberately NOT a second calendar brain: events are
// classified by the shared work-shift parser in _shared/calendar.ts
// (parseWorkShiftEvent — the same reader the Google/Outlook/Apple
// sync uses) and multi-day blocks expand through the shared
// expandSourceEventSpan, exactly as calendar sync's do. Events that
// are not work shifts at all (a dentist appointment on the work
// calendar) are counted, never rowed — the same rule the sync
// applies. An event at a facility the user has not saved DOES
// become a row (facilityKnown=false): the preview asks, exactly
// like the QGenda feed's rows.

import {
  coveredSpanDays,
  expandSourceEventSpan,
  icsValuePiece,
  importStatusForDate,
  parseWorkShiftEvent,
  spanBlockLastDay,
  type FacilityPayRule,
  type ProviderEvent,
} from "../_shared/calendar.ts";

// Parser version, returned with every fetch/status response so the
// client can tell when a preview it is holding was parsed by an
// older reader (same contract as QGENDA_PARSER_VERSION).
// v1, Nov 12, 2026: first reader — shared-parser classification,
// shared span expansion, RRULE events listed at their first
// occurrence only (the same honesty the .ics file import uses).
export const ICS_FEED_PARSER_VERSION = 1;

export interface IcsFeedShift {
  date: string;
  facility: string;
  type: string;
  pay: string;
  facilityKnown: boolean;
  status: "confirmed" | "proposed";
  uid: string;
  // The event's title exactly as read — the preview shows it and
  // the clarification path learns from it, like QGenda's `code`.
  code: string;
  // DTSTART–DTEND duration in hours when both are date-times,
  // rounded to the nearest quarter hour. Null for all-day events.
  hours: number | null;
  spanFrom?: string;
  spanTo?: string;
  spanKept?: "call" | "ambiguous";
  // True when the source event repeats (RRULE): only its first
  // occurrence is listed, and the preview row says so.
  recurring?: boolean;
}

// Normalise what the user pasted into the https URL the server
// fetches. Calendar apps hand out webcal:// links for the very same
// feeds; some hand out http://. Both become https://. Anything that
// is not a URL at all, or not http(s)/webcal, returns null — the
// caller answers with a plain "that does not look like a calendar
// link" instead of storing junk.
export function normalizeIcsFeedUrl(raw: string): string | null {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (/^webcal:\/\//i.test(s)) s = "https://" + s.slice("webcal://".length);
  else if (/^http:\/\//i.test(s)) s = "https://" + s.slice("http://".length);
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function isIcsFeedUrl(url: string): boolean {
  return normalizeIcsFeedUrl(url) === String(url || "").trim();
}

// Host + last 4 characters only — enough to recognise which link is
// connected, never enough to use it. (Same masking contract as the
// QGenda feed's maskFeedUrl.)
export function maskIcsFeedUrl(url: string): string {
  try {
    const u = new URL(String(url || "").trim());
    const tail = String(url).trim().slice(-4);
    return `${u.protocol}//${u.hostname}/…••••${tail}`;
  } catch {
    return "https://…••••";
  }
}

function unfoldIcs(text: string): string {
  return String(text || "")
    .replace(/\r\n[ \t]/g, "")
    .replace(/\r?\n[ \t]/g, "");
}

// Decode ICS text escapes: \n / \N -> newline, \, -> comma,
// \; -> semicolon, \\ -> backslash.
function unescapeIcsValue(v: string): string {
  return String(v || "")
    .replace(/\\\\/g, "\u0000")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\u0000/g, "\\");
}

function icsDateToIso(v: string): string {
  const t = String(v || "").trim();
  const m = t.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

function icsDateTimeMs(v: string): number | null {
  const t = String(v || "").trim();
  const m = t.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

function icsDurationHours(startRaw: string, endRaw: string): number | null {
  const start = icsDateTimeMs(startRaw);
  const end = icsDateTimeMs(endRaw);
  if (start === null || end === null) return null;
  const h = Math.round(((end - start) / 3600000) * 4) / 4;
  return h > 0 && h <= 36 ? h : null;
}

// Parse a calendar-link ICS feed into preview rows through the
// shared work-shift parser. Returns only dated work-shift events;
// everything else is counted so the fetch stays auditable:
//   eventCount = shifts (pre-expansion events counted once) is not
//   the invariant here — rows are post-expansion, so the counts are
//   reported alongside: droppedNonShift (dated, not a work shift),
//   droppedNoDate (no usable DTSTART), droppedCancelled.
export function parseIcsFeedICS(
  icsText: string,
  facilities: FacilityPayRule[],
): {
  shifts: IcsFeedShift[];
  unknownFacilities: string[];
  eventCount: number;
  droppedNonShift: number;
  droppedNoDate: number;
  droppedCancelled: number;
  // Self-describing codes read off their own names in this feed —
  // the client persists them as derived definitions (same contract
  // as the QGenda feed).
  derivedCodes: { facility: string; code: string; hours: number }[];
} {
  const clean = unfoldIcs(String(icsText || ""));
  const blocks = clean.split(/BEGIN:VEVENT/i).slice(1);
  const shifts: IcsFeedShift[] = [];
  const derivedCodes: { facility: string; code: string; hours: number }[] = [];
  const unknown = new Map<string, number>();
  let droppedNonShift = 0;
  let droppedNoDate = 0;
  let droppedCancelled = 0;
  for (const b of blocks) {
    const getRaw = (k: string): string => {
      const m = b.match(new RegExp(k + "(?:;[^:]*)?:(.*)", "i"));
      return m ? m[1].trim() : "";
    };
    const get = (k: string): string => unescapeIcsValue(getRaw(k));
    if (/^CANCELLED$/i.test(get("STATUS"))) {
      droppedCancelled++;
      continue;
    }
    const dtStartRaw = getRaw("DTSTART");
    const dtEndRaw = getRaw("DTEND");
    const date = icsDateToIso(dtStartRaw);
    if (!date) {
      droppedNoDate++;
      continue;
    }
    const summary = get("SUMMARY").replace(/\n/g, " ").trim();
    const location = get("LOCATION").replace(/\n/g, " ").trim();
    const uid = get("UID") || `${date}|${summary}|${location}`;
    const hours = icsDurationHours(dtStartRaw, dtEndRaw);
    const recurring = /(^|\n)RRULE[:;]/i.test(b);
    // Multi-day span: the block's last covered day, through the
    // shared span rule (an overnight shift is one shift, not a
    // block; an all-day end at/after +2 days is a block).
    const lastDay = spanBlockLastDay(
      icsValuePiece(dtStartRaw),
      icsValuePiece(dtEndRaw),
    );
    const allDay = /^\d{8}$/.test(dtStartRaw.trim());
    const ev: ProviderEvent = {
      providerEventId: uid,
      date,
      facility: "",
      type: "",
      pay: "",
      note: "",
      shiftId: null,
      updatedAt: null,
      cancelled: false,
      rawUpdatedAt: null,
      summary,
      location,
      ...(lastDay ? { endDate: lastDay } : {}),
      ...(lastDay && allDay ? { endDateAllDay: true } : {}),
    };
    // Shared span expansion: day blocks become one event per day,
    // call blocks stay single and marked, unclassified timed blocks
    // stay single and marked — exactly calendar sync's behaviour.
    const expanded = expandSourceEventSpan(ev, facilities).events;
    let rowed = false;
    for (const sev of expanded) {
      const parsed = parseWorkShiftEvent(
        sev.summary ?? "",
        sev.location ?? "",
        sev.date,
        facilities,
      );
      if (!parsed) continue;
      const spanDays = sev.spanStartDate && sev.spanEndDate
        ? coveredSpanDays(sev.spanStartDate, sev.spanEndDate)
        : [];
      const spanFields = spanDays.length > 1
        ? {
          spanFrom: spanDays[0],
          spanTo: spanDays[spanDays.length - 1],
          ...(sev.spanKeptCall
            ? { spanKept: "call" as const }
            : sev.spanAmbiguous
            ? { spanKept: "ambiguous" as const }
            : {}),
        }
        : {};
      shifts.push({
        date: sev.date,
        facility: parsed.facility,
        type: parsed.type,
        pay: parsed.pay,
        facilityKnown: parsed.facilityKnown,
        status: importStatusForDate(sev.date),
        uid: sev.providerEventId,
        code: summary || parsed.type,
        hours,
        ...(recurring ? { recurring: true } : {}),
        ...spanFields,
      });
      rowed = true;
      if (!parsed.facilityKnown) {
        unknown.set(parsed.facility, (unknown.get(parsed.facility) ?? 0) + 1);
      }
      if (parsed.derivedCode) {
        const dc = parsed.derivedCode;
        if (
          !derivedCodes.some((d) => d.facility === parsed.facility && d.code === dc.code)
        ) {
          derivedCodes.push({ facility: parsed.facility, code: dc.code, hours: dc.hours });
        }
      }
    }
    if (!rowed) droppedNonShift++;
  }
  return {
    shifts,
    unknownFacilities: [...unknown.keys()],
    eventCount: blocks.length,
    droppedNonShift,
    droppedNoDate,
    droppedCancelled,
    derivedCodes,
  };
}
