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
  parseWorkShiftTitle,
  priceShiftWithFacility,
  type FacilityPayRule,
} from "../_shared/calendar.ts";

// Parser version, returned with every fetch/status response so the
// client can tell when a preview it is holding was parsed by an
// older reader and re-read the feed instead of showing stale rows.
// Bump whenever the parse semantics change (v2, Nov 8, 2026: the
// generic "Call (unclassified)"/"Shift" buckets are refined from
// DESCRIPTION text and event timing; v1 returned the raw buckets).
export const QGENDA_PARSER_VERSION = 2;

export interface QgendaShift {
  date: string;
  facility: string;
  type: string;
  pay: string;
  facilityKnown: boolean;
  // Import status from the shared parser (Nov 6, 2026 status model):
  // a shift arriving from a calendar/schedule source is 'confirmed'
  // whatever its date; the shared parser decides, this module just
  // carries its answer through.
  status: "confirmed" | "proposed";
  uid: string;
  // The event's real shift name, cleaned (e.g. "8/2nd call", "Holzer
  // 10", "Night Float"). `type` above is only the canonical pricing
  // classification ("Second call", "10-hour shift", …) — dozens of
  // distinct QGenda shifts collapse into a handful of those buckets,
  // so the client displays/saves `code`, never the bucket alone. When
  // the event carries no usable name anywhere, `code` falls back to
  // the canonical type.
  code: string;
  // DTSTART–DTEND duration in hours when both are date-times,
  // rounded to the nearest quarter hour. Null for all-day /
  // date-only events (and for implausible durations).
  hours: number | null;
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

// Decode ICS text escapes: \n / \N -> newline, \, -> comma,
// \; -> semicolon, \\ -> backslash. (The placeholder keeps an escaped
// backslash from being re-read as the start of another escape.)
function unescapeIcsValue(v: string): string {
  return String(v || "")
    .replace(/\\\\/g, "\u0000")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\u0000/g, "\\");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Local copy of the shared parser's whole-token match (calendar.ts
// does not export its containsToken): true when `needle` appears in
// `haystack` as a whole token, so "CAMC" does not match inside
// another word and "St. Mary" matches "St. Mary's".
function containsToken(haystack: string, needle: string): boolean {
  const n = String(needle || "").trim();
  if (!n) return false;
  const pat = escapeRegExp(n).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Za-z0-9])${pat}([^A-Za-z0-9]|$)`, "i").test(
    String(haystack || ""),
  );
}

const MONTHS_RE =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

// Clean one candidate shift name: strip the user's own name (token-
// wise, each part of length >= 3 — "Martin" in "Martin - 8/2nd call"
// is schedule-owner noise, not part of the shift), strip date noise
// (ISO dates, "Nov 8", weekday names, 4-digit years), strip
// leading/trailing separators, collapse whitespace. The shift words
// themselves are never touched: "8/2nd call" stays "8/2nd call".
export function cleanQgendaShiftName(raw: string, userName = ""): string {
  let s = String(raw || "").replace(/\r/g, " ");
  const parts = String(userName || "")
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  // Full-name phrases first ("Caleb Martin", and the "Martin, Caleb"
  // reversal), then each name part token-wise.
  const phrases = new Set<string>();
  if (parts.length > 1) {
    phrases.add(parts.join(" "));
    phrases.add([...parts].reverse().join(" "));
  }
  for (const phrase of phrases) {
    s = s.replace(
      new RegExp(escapeRegExp(phrase).replace(/\s+/g, "[\\s,]+"), "gi"),
      " ",
    );
  }
  for (const part of parts) {
    s = s.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, "gi"), " ");
  }
  // Date noise.
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  s = s.replace(/\b\d{4}[/.]\d{1,2}[/.]\d{1,2}\b/g, " ");
  s = s.replace(/\b\d{1,2}[/.]\d{1,2}[/.](?:\d{2}|\d{4})\b/g, " ");
  s = s.replace(
    new RegExp(`\\b(?:${MONTHS_RE})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"),
    " ",
  );
  s = s.replace(
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS_RE})\\.?\\b`, "gi"),
    " ",
  );
  s = s.replace(
    /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/gi,
    " ",
  );
  s = s.replace(/\b(?:19|20)\d{2}\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // Leading/trailing separators (possibly several in a row once a
  // name token has been removed: "Martin - X" -> "- X" -> "X").
  s = s.replace(/^[\s\-–—:;,•|/]+/, "").replace(/[\s\-–—:;,•|/]+$/, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// A cleaned candidate is generic when it carries no shift identity:
// empty, just the facility name, or one of the placeholder words
// QGenda puts in SUMMARY when the real name lives elsewhere.
function isGenericShiftName(cleaned: string, facility: string): boolean {
  const l = String(cleaned || "").trim().toLowerCase();
  if (!l) return true;
  if (facility && l === facility.trim().toLowerCase()) return true;
  return l === "shift" || l === "call" || l === "work" || l === "schedule";
}

// The event's real shift name, from the first source that carries
// one, in priority order: (a) SUMMARY, (b) DESCRIPTION — a
// "Task:"/"Shift:"/"Assignment:" line first, else its first usable
// line, (c) the first CATEGORIES entry, (d) "" when nothing does.
export function qgendaShiftName(args: {
  summary?: string;
  description?: string;
  categories?: string[] | string;
  facility?: string;
  name?: string;
}): string {
  const userName = args.name || "";
  const facility = args.facility || "";
  const summaryClean = cleanQgendaShiftName(
    String(args.summary || "").replace(/\n/g, " "),
    userName,
  );
  if (!isGenericShiftName(summaryClean, facility)) return summaryClean;

  const lines = String(args.description || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const m = /^(?:task|shift|assignment)\b[^:]*:\s*(.+)$/i.exec(line);
    if (m) {
      const v = cleanQgendaShiftName(m[1], userName);
      if (!isGenericShiftName(v, facility)) return v;
    }
  }
  for (const line of lines) {
    if (/^https?:\/\//i.test(line) || /^www\./i.test(line)) continue;
    if (/^(?:name|staff)\s*:/i.test(line)) continue;
    const v = cleanQgendaShiftName(line, userName);
    if (!isGenericShiftName(v, facility)) return v;
  }

  const cats = Array.isArray(args.categories)
    ? args.categories
    : String(args.categories || "").split(",");
  for (const cat of cats) {
    const v = cleanQgendaShiftName(String(cat || ""), userName);
    if (!isGenericShiftName(v, facility)) return v;
  }
  return "";
}

// Canonical type from a rescued shift name, after the guessed
// facility's name/aliases are removed. Used only by the location
// rescue below, never on the main parse path.
function deriveTypeFromName(
  name: string,
  rule: FacilityPayRule,
  fallback: string,
): string {
  let rest = String(name || "");
  for (const n of [rule.name, ...(rule.aliases ?? [])]) {
    if (!n) continue;
    rest = rest.replace(
      new RegExp(escapeRegExp(n).replace(/\s+/g, "\\s+"), "i"),
      " ",
    );
  }
  rest = rest.trim().replace(/^[\s\-–—:;,•]+|[\s\-–—:;,•]+$/g, "").trim();
  const s = rest.toLowerCase();
  if (/\b2nd\s*call\b|\bsecond\s*call\b/.test(s)) return "Second call";
  if (/\b1st\s*call\b|\bfirst\s*call\b|\b24\s*\/\s*1st\b/.test(s)) {
    return "24-hour call";
  }
  if (/\b24\s*-?\s*hour\b|\b24h\b/.test(s)) return "24-hour call";
  if (/\b12\s*-?\s*hour\b|\b12h\b/.test(s)) return "12-hour shift";
  if (/\b10\s*-?\s*hour\b|\b10h\b/.test(s)) return "10-hour shift";
  if (/\b8\s*-?\s*hour\b|\b8h\b/.test(s)) return "8-hour day";
  const trail = /(?:^|\s)(8|10|12|24)\s*$/.exec(s);
  const lead = /^\s*(8|10|12|24)(?:\s|$)/.exec(s);
  const num = (trail ?? lead)?.[1];
  if (num === "24") return "24-hour call";
  if (num === "12") return "12-hour shift";
  if (num === "10") return "10-hour shift";
  if (num === "8") return "8-hour day";
  if (/\bcall\b/.test(s)) return "Call (unclassified)";
  return fallback || "Shift";
}

function icsDateToIso(v: string): string {
  const t = String(v || "").trim();
  const m = t.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

// Millisecond timestamp for a date-TIME value ("20261108T070000Z" or
// floating); null for date-only values. Components are read as UTC
// so a start/end pair in the same zone subtracts to the wall-clock
// duration the schedule means.
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

// Wall-clock start of a date-TIME value, in minutes since midnight
// (components read as written, same convention as icsDateTimeMs).
// Null for date-only values — QGenda's classic exports are date-only,
// and for those there is no timing signal to mine.
function icsStartMinutes(v: string): number | null {
  const t = String(v || "").trim();
  const m = t.match(/^\d{8}T(\d{2})(\d{2})/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

// Refine one of the two generic canonical buckets from the event's
// timing, when the feed gave date-TIME start/end. Deliberately
// conservative — it only fires on the buckets, never overrides a
// type the text actually named, and leaves the bucket untouched when
// the timing is ambiguous or absent (date-only events):
//   Call (unclassified): a ~24h span is a 1st-call window
//     ("24-hour call"); a long span starting in the afternoon or
//     evening (14:00+) is an overnight 2nd-call window
//     ("Second call"). A shorter or daytime-start span could be
//     either, so it stays unclassified.
//   Shift (a bare facility/code title): a daytime span prices like
//     the day shift it spans — 7.5–9.5h -> 8-hour day, 9.5–11.5h ->
//     10-hour, 11.5–13.5h -> 12-hour; a ~24h span is a call window.
// The refined value only feeds the canonical `type` (pricing and the
// clarification prompt's already-priced exclusion); the displayed
// name stays the preserved raw `code`.
export function refineQgendaBucketType(
  type: string,
  hours: number | null,
  startMinutes: number | null,
): string {
  if (hours === null) return type;
  if (type === "Call (unclassified)") {
    if (hours >= 20) return "24-hour call";
    if (hours >= 8 && startMinutes !== null && startMinutes >= 14 * 60) {
      return "Second call";
    }
    return type;
  }
  if (type === "Shift") {
    if (hours >= 20) return "24-hour call";
    if (hours >= 11.5 && hours <= 13.5) return "12-hour shift";
    if (hours > 9.5 && hours < 11.5) return "10-hour shift";
    if (hours >= 7.5 && hours <= 9.5) return "8-hour day";
    return type;
  }
  return type;
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
  opts: { name?: string } = {},
): {
  shifts: QgendaShift[];
  unknownFacilities: string[];
  eventCount: number;
} {
  const userName = typeof opts?.name === "string" ? opts.name : "";
  const clean = unfoldIcs(icsText);
  const blocks = clean.split(/BEGIN:VEVENT/i).slice(1);
  const shifts: QgendaShift[] = [];
  const unknown = new Map<string, number>();
  for (const b of blocks) {
    const getRaw = (k: string): string => {
      const m = b.match(new RegExp(k + "(?:;[^:]*)?:(.*)", "i"));
      return m ? m[1].trim() : "";
    };
    const get = (k: string): string => unescapeIcsValue(getRaw(k));
    const dtStartRaw = getRaw("DTSTART");
    const dtEndRaw = getRaw("DTEND");
    const date = icsDateToIso(dtStartRaw);
    if (!date) continue;
    const summary = get("SUMMARY").replace(/\n/g, " ");
    const location = get("LOCATION").replace(/\n/g, " ");
    const description = get("DESCRIPTION");
    // CATEGORIES entries are comma-separated in the raw value;
    // split before unescaping so an escaped comma stays inside its
    // entry.
    const categories = getRaw("CATEGORIES")
      ? getRaw("CATEGORIES").split(/(?<!\\),/).map((c) =>
        unescapeIcsValue(c.trim())
      ).filter(Boolean)
      : [];
    const uid = get("UID") || `${date}|${summary}|${location}`;
    const parsed = parseWorkShiftEvent(summary, location, date, facilities);
    if (!parsed) continue;

    let facility = parsed.facility;
    let type = parsed.type;
    let pay = parsed.pay;
    let facilityKnown = parsed.facilityKnown;

    // The real shift name (before any rescue, so the rescue can
    // derive a type from it).
    const rawName = qgendaShiftName({
      summary,
      description,
      categories,
      facility,
      name: userName,
    });

    // Rescue, ONLY for events the canonical parser priced as an
    // unknown facility while the LOCATION names a known one (a rule
    // name/alias, or Holzer): the generic fallback derives the
    // facility from the title text, so a shift whose title leads
    // with a place word ("Gallipolis 8") comes back unknown even
    // though its location is a facility the user has on file. Trust
    // the location, re-derive the type from the real name, and price
    // from that facility's rule (Holzer via its title parser first).
    if (!facilityKnown && location) {
      let guessedRule: FacilityPayRule | undefined;
      let guessedName = "";
      const rulesByLength = [...facilities].sort((a, b2) => {
        const longest = (r: FacilityPayRule) =>
          Math.max(r.name.length, ...(r.aliases ?? []).map((x) => x.length));
        return longest(b2) - longest(a);
      });
      for (const rule of rulesByLength) {
        const hit = [rule.name, ...(rule.aliases ?? [])].find((n) =>
          containsToken(location, n)
        );
        if (hit) {
          guessedRule = rule;
          guessedName = rule.name;
          break;
        }
      }
      if (!guessedName && containsToken(location, "holzer")) {
        guessedName = "Holzer";
      }
      if (guessedName) {
        const nameForType = rawName ||
          cleanQgendaShiftName(summary, userName);
        if (guessedName.toLowerCase() === "holzer") {
          const ht = parseWorkShiftTitle(`Holzer ${nameForType}`, date);
          type = ht?.type ??
            deriveTypeFromName(
              nameForType,
              guessedRule ?? { name: "Holzer" },
              parsed.type,
            );
          pay = (ht?.pay) ||
            (guessedRule
              ? priceShiftWithFacility(type, guessedRule, date)
              : "");
        } else if (guessedRule) {
          type = deriveTypeFromName(nameForType, guessedRule, parsed.type);
          pay = priceShiftWithFacility(type, guessedRule, date);
        }
        facility = guessedName;
        facilityKnown = true;
      }
    }

    // Bucket refinement (parser v2): when the canonical type is one
    // of the two generic buckets ("Call (unclassified)" / "Shift"),
    // the distinguishing detail — which call, how long a day — can
    // still live in the DESCRIPTION text or in the event's own
    // timing. Explicit text wins over inference: scan the
    // description with the same pattern matcher first, then fall
    // back to the DTSTART/DTEND span. The preserved raw name (`code`
    // below) is never touched — refinement only sharpens the
    // canonical type that pricing reads. When the facility is known
    // and the row was unpriced, price the refined type from its rule.
    const hours = icsDurationHours(dtStartRaw, dtEndRaw);
    if (type === "Call (unclassified)" || type === "Shift") {
      let refined = "";
      if (description) {
        const fromDesc = deriveTypeFromName(
          description.replace(/\n/g, " "),
          { name: facility },
          "",
        );
        if (fromDesc && fromDesc !== "Call (unclassified)" && fromDesc !== "Shift") {
          refined = fromDesc;
        }
      }
      if (!refined) {
        refined = refineQgendaBucketType(type, hours, icsStartMinutes(dtStartRaw));
      }
      if (refined && refined !== type) {
        type = refined;
        if (facilityKnown && !pay) {
          const rule = facilities.find((r) => r.name === facility);
          if (rule) pay = priceShiftWithFacility(type, rule, date);
        }
      }
    }

    // Final name against the final facility (the generic check is
    // facility-relative), then the code fallback chain: a name that
    // is empty/generic, or that is just the facility name alone,
    // falls back to the canonical type.
    const finalName = qgendaShiftName({
      summary,
      description,
      categories,
      facility,
      name: userName,
    });
    const code = finalName &&
        finalName.trim().toLowerCase() !== facility.trim().toLowerCase()
      ? finalName
      : type;

    shifts.push({
      date,
      facility,
      type,
      pay,
      facilityKnown,
      status: parsed.status,
      uid,
      code,
      hours,
    });
    if (!facilityKnown) {
      unknown.set(facility, (unknown.get(facility) ?? 0) + 1);
    }
  }
  return { shifts, unknownFacilities: [...unknown.keys()], eventCount: blocks.length };
}
