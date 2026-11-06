// CRNA Hub — QGenda subscription-feed helpers (pure).
// Run: deno test --allow-read supabase/functions/qgenda-feed/parse.test.ts

import { assertEquals } from "jsr:@std/assert";
import {
  isQgendaFeedUrl,
  maskFeedUrl,
  parseQgendaICS,
} from "./parse.ts";
import { normalizeFacilityRules } from "../_shared/calendar.ts";

const HOLZER = normalizeFacilityRules([
  {
    name: "Holzer",
    aliases: [],
    hourlyRate: 250,
    rate8: 2125,
    rate10: 2625,
    rate12: "",
    rate24: "",
    rateSecond: 3000,
    weekendRateSecond: 2000,
    callBonus: 1000,
    paidHours8: 8.5,
  },
]);

Deno.test("isQgendaFeedUrl: real subscription URLs pass, everything else fails", () => {
  assertEquals(
    isQgendaFeedUrl("https://app.qgenda.com/ical/user/abc123.ics?token=xyz"),
    true,
  );
  assertEquals(
    isQgendaFeedUrl("https://app.qgenda.com/sync/subscription/abc"),
    true,
  );
  assertEquals(isQgendaFeedUrl("http://app.qgenda.com/ical/x.ics"), false);
  assertEquals(isQgendaFeedUrl("https://evil.com/ical/x.ics"), false);
  assertEquals(isQgendaFeedUrl("https://app.qgenda.com/schedule"), false);
  assertEquals(isQgendaFeedUrl("not a url"), false);
  assertEquals(isQgendaFeedUrl(""), false);
});

Deno.test("maskFeedUrl: host plus last 4 chars only, never the token", () => {
  const url = "https://app.qgenda.com/ical/user/abc123.ics?token=secret-token-9876";
  const masked = maskFeedUrl(url);
  assertEquals(masked.includes("secret-token"), false);
  assertEquals(masked.includes("app.qgenda.com"), true);
  assertEquals(masked.endsWith("9876"), true);
  assertEquals(masked.includes("••••"), true);
});

const FEED = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//QGenda//EN\r
BEGIN:VEVENT\r
UID:qg-1@qgenda.com\r
DTSTART;VALUE=DATE:20261110\r
DTEND;VALUE=DATE:20261111\r
SUMMARY:Holzer 8\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:qg-2@qgenda.com\r
DTSTART;VALUE=DATE:20261112\r
DTEND;VALUE=DATE:20261113\r
SUMMARY:Holzer 8/2nd call\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:qg-3@qgenda.com\r
DTSTART;VALUE=DATE:20261114\r
DTEND;VALUE=DATE:20261115\r
SUMMARY:St. Mary 12-hour shift\r
LOCATION:Huntington, WV\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:qg-4@qgenda.com\r
DTSTART;VALUE=DATE:20261115\r
DTEND;VALUE=DATE:20261116\r
SUMMARY:Team lunch\r
LOCATION:Huntington, WV\r
END:VEVENT\r
END:VCALENDAR\r
`;

Deno.test("parseQgendaICS: Holzer shifts priced, unknown facility flagged, lunch skipped", () => {
  const { shifts, unknownFacilities, eventCount } = parseQgendaICS(FEED, HOLZER);
  assertEquals(eventCount, 4);
  assertEquals(shifts.length, 3);
  assertEquals(shifts[0].date, "2026-11-10");
  assertEquals(shifts[0].facility, "Holzer");
  assertEquals(shifts[0].type, "8-hour day");
  assertEquals(shifts[0].pay, "2125");
  assertEquals(shifts[0].facilityKnown, true);
  assertEquals(shifts[1].type, "Second call");
  assertEquals(shifts[1].pay, "3000");
  assertEquals(shifts[2].facility, "St. Mary");
  assertEquals(shifts[2].facilityKnown, false);
  assertEquals(shifts[2].pay, "");
  assertEquals(unknownFacilities, ["St. Mary"]);
});

Deno.test("parseQgendaICS: non-ICS text yields no shifts", () => {
  const { shifts, eventCount } = parseQgendaICS("hello, not a calendar", HOLZER);
  assertEquals(eventCount, 0);
  assertEquals(shifts.length, 0);
});
