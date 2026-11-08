// CRNA Hub — QGenda subscription-feed helpers (pure).
// Run: deno test --allow-read supabase/functions/qgenda-feed/parse.test.ts

import { assertEquals } from "jsr:@std/assert";
import {
  cleanQgendaShiftName,
  isQgendaFeedUrl,
  maskFeedUrl,
  parseQgendaICS,
  qgendaShiftName,
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
  // code carries the event's real shift name; date-only events have
  // no duration, so hours is null.
  assertEquals(shifts[0].code, "Holzer 8");
  assertEquals(shifts[0].hours, null);
  assertEquals(shifts[1].code, "Holzer 8/2nd call");
  assertEquals(shifts[1].hours, null);
  assertEquals(shifts[2].code, "St. Mary 12-hour shift");
  // Status model (Nov 6, 2026 — supersedes the Bug 1 date rule this
  // test originally asserted): a shift arriving from a calendar /
  // schedule source is 'confirmed' WHATEVER its date; the old
  // past->confirmed / future->proposed expectation was stale and
  // failed against the current shared parser. Updated Nov 8, 2026.
  for (const sh of shifts) {
    assertEquals(sh.status, "confirmed");
  }
});

Deno.test("parseQgendaICS: non-ICS text yields no shifts", () => {
  const { shifts, eventCount } = parseQgendaICS("hello, not a calendar", HOLZER);
  assertEquals(eventCount, 0);
  assertEquals(shifts.length, 0);
});

// --- Realistic QGenda-style fixture (Nov 8, 2026) -------------------
// Mixed Holzer shifts as QGenda actually emits them: date-time
// DTSTART/DTEND, LOCATION naming the medical center, and the real
// shift name living in SUMMARY / DESCRIPTION / CATEGORIES depending
// on the event. Before the code/hours fix, every one of these
// collapsed into the canonical buckets ("Call (unclassified)" /
// "Shift") and the client never saw the real name.
// Note on two events: per spec, an event parseWorkShiftEvent cannot
// classify at all is still skipped — so the DESCRIPTION event's
// location also carries its "12-hour shift" pattern (the canonical
// parser reads the location), and the nameless event's location
// carries an "8-hour shift" pattern. Their NAMES still come only
// from DESCRIPTION / nowhere, which is what these tests pin.
const QGENDA_FEED = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//QGenda//EN\r
BEGIN:VEVENT\r
UID:mix-1@qgenda.com\r
DTSTART:20261109T070000\r
DTEND:20261109T153000\r
SUMMARY:Holzer 8\r
LOCATION:Holzer Medical Center, Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:mix-2@qgenda.com\r
DTSTART:20261110T070000\r
DTEND:20261110T173000\r
SUMMARY:Holzer 10\r
LOCATION:Holzer Medical Center, Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:mix-3@qgenda.com\r
DTSTART:20261111T070000\r
DTEND:20261111T150000\r
SUMMARY:8/2nd call\r
LOCATION:Holzer Medical Center, Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:mix-4@qgenda.com\r
DTSTART:20261112T070000\r
DTEND:20261113T070000\r
SUMMARY:Holzer 24/1st call\r
LOCATION:Holzer Medical Center, Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:mix-5@qgenda.com\r
DTSTART:20261113T070000\r
DTEND:20261113T150000\r
SUMMARY:Martin - 8/2nd call\r
LOCATION:Holzer Medical Center, Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:mix-6@qgenda.com\r
DTSTART:20261114T190000\r
DTEND:20261115T070000\r
SUMMARY:Shift\r
DESCRIPTION:Task: Night Float\\nStaff: Caleb Martin\r
LOCATION:Holzer Medical Center - 12-hour shift, Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:mix-7@qgenda.com\r
DTSTART:20261115T070000\r
DTEND:20261115T190000\r
SUMMARY:Holzer\r
CATEGORIES:Weekend Coverage\r
LOCATION:Holzer Medical Center, Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:mix-8@qgenda.com\r
DTSTART:20261116T070000\r
DTEND:20261116T153000\r
SUMMARY:Gallipolis 8\r
LOCATION:Holzer Medical Center, Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:mix-9@qgenda.com\r
DTSTART:20261117T070000\r
DTEND:20261117T153000\r
LOCATION:Holzer Medical Center - 8-hour shift, Gallipolis, OH\r
END:VEVENT\r
END:VCALENDAR\r
`;

Deno.test("parseQgendaICS: QGenda fixture keeps distinct codes, canonical types, hours", () => {
  const { shifts, unknownFacilities, eventCount } = parseQgendaICS(
    QGENDA_FEED,
    HOLZER,
    { name: "Caleb Martin" },
  );
  assertEquals(eventCount, 9);
  assertEquals(shifts.length, 9);
  assertEquals(unknownFacilities, []);
  const byUid = new Map(shifts.map((s) => [s.uid, s]));
  const pick = (uid: string) => {
    const s = byUid.get(uid);
    if (!s) throw new Error(`missing shift ${uid}`);
    return { code: s.code, type: s.type, pay: s.pay, hours: s.hours, facility: s.facility, facilityKnown: s.facilityKnown };
  };
  // SUMMARY-carried names, priced by the canonical type.
  assertEquals(pick("mix-1@qgenda.com"), { code: "Holzer 8", type: "8-hour day", pay: "2125", hours: 8.5, facility: "Holzer", facilityKnown: true });
  assertEquals(pick("mix-2@qgenda.com"), { code: "Holzer 10", type: "10-hour shift", pay: "2625", hours: 10.5, facility: "Holzer", facilityKnown: true });
  // Shift name in the summary, facility only in the location.
  assertEquals(pick("mix-3@qgenda.com"), { code: "8/2nd call", type: "Second call", pay: "3000", hours: 8, facility: "Holzer", facilityKnown: true });
  assertEquals(pick("mix-4@qgenda.com"), { code: "Holzer 24/1st call", type: "24-hour call", pay: "4800", hours: 24, facility: "Holzer", facilityKnown: true });
  // Owner-name prefix stripped by the name option — the same real
  // shift name as mix-3, on a different day.
  assertEquals(pick("mix-5@qgenda.com"), { code: "8/2nd call", type: "Second call", pay: "3000", hours: 8, facility: "Holzer", facilityKnown: true });
  // Generic SUMMARY "Shift": the name comes from DESCRIPTION's Task line.
  assertEquals(pick("mix-6@qgenda.com"), { code: "Night Float", type: "12-hour shift", pay: "3000", hours: 12, facility: "Holzer", facilityKnown: true });
  // SUMMARY is just the facility name: the name comes from CATEGORIES.
  assertEquals(pick("mix-7@qgenda.com"), { code: "Weekend Coverage", type: "Shift", pay: "", hours: 12, facility: "Holzer", facilityKnown: true });
  // Location rescue: title led with a place word, location names Holzer.
  assertEquals(pick("mix-8@qgenda.com"), { code: "Gallipolis 8", type: "8-hour day", pay: "2125", hours: 8.5, facility: "Holzer", facilityKnown: true });
  // Genuinely nameless: code falls back to the canonical type.
  assertEquals(pick("mix-9@qgenda.com"), { code: "8-hour day", type: "8-hour day", pay: "2125", hours: 8.5, facility: "Holzer", facilityKnown: true });
  // No two distinct names collapse into one bucket: 9 events carry 8
  // distinct codes (mix-3/mix-5 are the same name once the owner
  // prefix is stripped), and none of the named events lands in the
  // old "Call (unclassified)"/"Shift" code buckets.
  const codes = shifts.map((s) => s.code);
  assertEquals(new Set(codes).size, 8);
  assertEquals(codes.includes("Call (unclassified)"), false);
  assertEquals(codes.filter((c) => c === "Shift").length, 0);
  for (const sh of shifts) assertEquals(sh.status, "confirmed");
});

Deno.test("qgendaShiftName: priority, cleaning, and no mangling of shift words", () => {
  // Cleaning never mangles the shift words themselves.
  assertEquals(cleanQgendaShiftName("8/2nd call", "Caleb Martin"), "8/2nd call");
  // Full name, reversed name, and single-part names all strip.
  assertEquals(cleanQgendaShiftName("Caleb Martin - Holzer 8", "Caleb Martin"), "Holzer 8");
  assertEquals(cleanQgendaShiftName("Martin, Caleb: Holzer 8", "Caleb Martin"), "Holzer 8");
  assertEquals(cleanQgendaShiftName("Martin - Holzer 8", "Martin"), "Holzer 8");
  // Date noise strips; the shift pattern survives.
  assertEquals(cleanQgendaShiftName("Holzer 8 - Monday Nov 9 2026", ""), "Holzer 8");
  // DESCRIPTION first usable line when there is no Task line, and
  // Name:/Staff:/URL lines are skipped.
  assertEquals(
    qgendaShiftName({
      summary: "Schedule",
      description: "Name: Caleb Martin\nhttps://example.com/x\nOR Night",
      facility: "Holzer",
      name: "Caleb Martin",
    }),
    "OR Night",
  );
  // Nothing usable anywhere -> "".
  assertEquals(
    qgendaShiftName({ summary: "Shift", description: "", categories: [], facility: "Holzer" }),
    "",
  );
});
