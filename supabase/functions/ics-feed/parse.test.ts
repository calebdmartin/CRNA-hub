// CRNA Hub — calendar-link (ICS feed) helpers (pure).
// Run: deno test --allow-read supabase/functions/ics-feed/parse.test.ts

import { assertEquals } from "jsr:@std/assert";
import {
  ICS_FEED_PARSER_VERSION,
  isIcsFeedUrl,
  maskIcsFeedUrl,
  normalizeIcsFeedUrl,
  parseIcsFeedICS,
} from "./parse.ts";
import { normalizeFacilityRules } from "../_shared/calendar.ts";

// The user's captured Holzer card (same fixture the QGenda feed
// tests carry — the parser holds no rates of its own).
const HOLZER = normalizeFacilityRules([
  {
    name: "Holzer",
    aliases: [],
    hourlyRate: 250,
    rate8: 2125,
    rate10: 2625,
    rate12: "",
    rate24: 4800,
    weekendRate24: 4200,
    hourlyCall1st: 175,
    rateSecond: 3000,
    weekendRateSecond: 2000,
    callBonus: 1000,
    paidHours8: 8.5,
  },
]);

function feed(events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fixture//EN", ...events, "END:VCALENDAR"].join("\r\n");
}
function ev(lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
}

Deno.test("normalizeIcsFeedUrl: webcal and http become https, junk is rejected", () => {
  assertEquals(
    normalizeIcsFeedUrl("webcal://calendar.google.com/calendar/ical/abc/private-deadbeef/basic.ics"),
    "https://calendar.google.com/calendar/ical/abc/private-deadbeef/basic.ics",
  );
  assertEquals(
    normalizeIcsFeedUrl("  https://outlook.live.com/owa/calendar/xyz/calendar.ics  "),
    "https://outlook.live.com/owa/calendar/xyz/calendar.ics",
  );
  assertEquals(normalizeIcsFeedUrl("http://example.com/cal.ics"), "https://example.com/cal.ics");
  assertEquals(normalizeIcsFeedUrl("not a url"), null);
  assertEquals(normalizeIcsFeedUrl(""), null);
  assertEquals(normalizeIcsFeedUrl("ftp://example.com/cal.ics"), null);
  assertEquals(normalizeIcsFeedUrl("javascript:alert(1)"), null);
  assertEquals(isIcsFeedUrl("https://example.com/cal.ics"), true);
  assertEquals(isIcsFeedUrl("webcal://example.com/cal.ics"), false);
});

Deno.test("maskIcsFeedUrl: host plus last 4 chars only, never the secret", () => {
  const url = "https://calendar.google.com/calendar/ical/abc/private-deadbeef/basic.ics";
  const masked = maskIcsFeedUrl(url);
  assertEquals(masked.includes("deadbeef"), false);
  assertEquals(masked.includes("private"), false);
  assertEquals(masked.includes("calendar.google.com"), true);
});

// The fixture feed: a Google-secret-address-shaped work calendar.
// Nov 16 2026 is a Monday; Nov 20 a Friday; Nov 23 a Monday.
const FIXTURE = feed([
  // 1. One timed day shift.
  ev(["UID:ev1@fixture", "DTSTART:20261116T063000Z", "DTEND:20261116T150000Z", "SUMMARY:Holzer 8", "LOCATION:Holzer"]),
  // 2. A multi-day TIMED block of day shifts (Mon 07:00 -> Wed 15:00).
  ev(["UID:ev2@fixture", "DTSTART:20261116T070000Z", "DTEND:20261118T150000Z", "SUMMARY:Holzer 8", "LOCATION:Holzer"]),
  // 3. One all-day shift.
  ev(["UID:ev3@fixture", "DTSTART;VALUE=DATE:20261120", "DTEND;VALUE=DATE:20261121", "SUMMARY:Holzer 10", "LOCATION:Holzer"]),
  // 4. A shift at a facility the user has not saved.
  ev(["UID:ev4@fixture", "DTSTART:20261119T070000Z", "DTEND:20261119T150000Z", "SUMMARY:Riverside General 8-hour shift"]),
  // 5. Not a work shift at all.
  ev(["UID:ev5@fixture", "DTSTART:20261119T170000Z", "DTEND:20261119T180000Z", "SUMMARY:Dentist appointment"]),
  // 6. An all-day two-day block (Mon-Tue).
  ev(["UID:ev6@fixture", "DTSTART;VALUE=DATE:20261123", "DTEND;VALUE=DATE:20261125", "SUMMARY:Holzer 8", "LOCATION:Holzer"]),
  // 7. A multi-day call block (Fri 15:00 -> Sun 15:00): one assignment.
  ev(["UID:ev7@fixture", "DTSTART:20261120T150000Z", "DTEND:20261122T150000Z", "SUMMARY:Holzer 1st call", "LOCATION:Holzer"]),
  // 8. A cancelled event.
  ev(["UID:ev8@fixture", "STATUS:CANCELLED", "DTSTART:20261121T070000Z", "DTEND:20261121T150000Z", "SUMMARY:Holzer 8", "LOCATION:Holzer"]),
  // 9. A recurring event: first occurrence only, flagged.
  ev(["UID:ev9@fixture", "RRULE:FREQ=WEEKLY", "DTSTART:20261117T063000Z", "DTEND:20261117T150000Z", "SUMMARY:Holzer 8", "LOCATION:Holzer"]),
]);

Deno.test("parseIcsFeedICS: fixture feed parses through the shared parser into preview rows", () => {
  const out = parseIcsFeedICS(FIXTURE, HOLZER);
  assertEquals(out.eventCount, 9);
  assertEquals(out.droppedNonShift, 1);
  assertEquals(out.droppedCancelled, 1);
  assertEquals(out.droppedNoDate, 0);
  // 1 + 3 (block) + 1 + 1 + 2 (all-day block) + 1 (call) + 1 (recurring) = 10 rows.
  assertEquals(out.shifts.length, 10);
  assertEquals(out.unknownFacilities, ["Riverside General"]);
  assertEquals(ICS_FEED_PARSER_VERSION, 1);

  const day = out.shifts.find((s) => s.uid === "ev1@fixture");
  assertEquals(day?.date, "2026-11-16");
  assertEquals(day?.type, "8-hour day");
  assertEquals(day?.pay, "2125");
  assertEquals(day?.facilityKnown, true);
  assertEquals(day?.status, "confirmed");
  assertEquals(day?.hours, 8.5);

  const block = out.shifts.filter((s) => s.uid.startsWith("ev2@fixture"));
  assertEquals(block.map((s) => s.date), ["2026-11-16", "2026-11-17", "2026-11-18"]);
  assertEquals(block.every((s) => s.pay === "2125" && s.spanFrom === "2026-11-16" && s.spanTo === "2026-11-18" && !s.spanKept), true);

  const allDay = out.shifts.find((s) => s.uid === "ev3@fixture");
  assertEquals(allDay?.date, "2026-11-20");
  assertEquals(allDay?.type, "10-hour shift");
  assertEquals(allDay?.pay, "2625");
  assertEquals(allDay?.hours, null);

  const unknown = out.shifts.find((s) => s.uid === "ev4@fixture");
  assertEquals(unknown?.facility, "Riverside General");
  assertEquals(unknown?.facilityKnown, false);
  assertEquals(unknown?.pay, "");

  const allDayBlock = out.shifts.filter((s) => s.uid.startsWith("ev6@fixture"));
  assertEquals(allDayBlock.map((s) => s.date), ["2026-11-23", "2026-11-24"]);

  const call = out.shifts.find((s) => s.uid === "ev7@fixture");
  assertEquals(call?.date, "2026-11-20");
  assertEquals(call?.type, "24-hour call");
  assertEquals(call?.pay, "4800");
  assertEquals(call?.spanKept, "call");

  const recurring = out.shifts.find((s) => s.uid === "ev9@fixture");
  assertEquals(recurring?.date, "2026-11-17");
  assertEquals(recurring?.recurring, true);
  // No row exists for the dentist appointment or the cancelled event.
  assertEquals(out.shifts.some((s) => s.code.includes("Dentist")), false);
  assertEquals(out.shifts.some((s) => s.uid === "ev8@fixture"), false);
});

Deno.test("parseIcsFeedICS: an empty feed and a non-feed both row nothing", () => {
  const empty = parseIcsFeedICS(feed([]), HOLZER);
  assertEquals(empty.shifts.length, 0);
  assertEquals(empty.eventCount, 0);
  const junk = parseIcsFeedICS("BEGIN:VCALENDAR\r\nEND:VCALENDAR", HOLZER);
  assertEquals(junk.shifts.length, 0);
});
