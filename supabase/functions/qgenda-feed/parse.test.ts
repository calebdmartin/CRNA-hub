// CRNA Hub — QGenda subscription-feed helpers (pure).
// Run: deno test --allow-read supabase/functions/qgenda-feed/parse.test.ts

import { assertEquals } from "jsr:@std/assert";
import {
  cleanQgendaShiftName,
  isQgendaFeedUrl,
  maskFeedUrl,
  parseQgendaICS,
  QGENDA_PARSER_VERSION,
  qgendaShiftName,
  refineQgendaBucketType,
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

Deno.test("parseQgendaICS: Holzer shifts priced, unknown facility flagged, lunch lands as an unclassified row", () => {
  const { shifts, unknownFacilities, eventCount } = parseQgendaICS(FEED, HOLZER);
  assertEquals(eventCount, 4);
  // Parser v3 (Nov 8, 2026): no silent skips — the "Team lunch"
  // event that used to vanish now rides in as an unclassified row
  // (facility "", named as read, unpriced) for the clarification
  // prompt, so FOUR rows come back for four dated events. Its
  // facility stays "" — the parser never invents one.
  assertEquals(shifts.length, 4);
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
  // The v3 unclassified row for the lunch: raw name as code AND
  // type, no facility guessed, unpriced, still a confirmed import.
  assertEquals(shifts[3].date, "2026-11-15");
  assertEquals(shifts[3].code, "Team lunch");
  assertEquals(shifts[3].type, "Team lunch");
  assertEquals(shifts[3].facility, "");
  assertEquals(shifts[3].facilityKnown, false);
  assertEquals(shifts[3].pay, "");
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
  // Round 2 (parser v2): its canonical type no longer stays the bare
  // "Shift" bucket — a 12h timed span refines it to "12-hour shift"
  // and the facility rule prices it (hourly x 12). The preserved name
  // is unchanged.
  assertEquals(pick("mix-7@qgenda.com"), { code: "Weekend Coverage", type: "12-hour shift", pay: "3000", hours: 12, facility: "Holzer", facilityKnown: true });
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

// --- Round 2 (Nov 8, 2026): terse facility-code titles -------------
// Caleb's REAL feed does not spell "Holzer 8" in its summaries — the
// observed output (facility column "HOLZ", every call row bucketed
// "Call (unclassified)") is exactly what the shared parser's generic
// fallback produces for terse code-style titles: "HOLZ Call" and
// plain "HOLZ". Round 1's fixture used full-name summaries, so this
// shape was never exercised. These events pin it:
//  - the raw name survives in `code` ("HOLZ Call") even though the
//    canonical `type` starts out a bucket;
//  - a bucket type is refined from explicit DESCRIPTION text first,
//    then from the event's own DTSTART/DTEND span;
//  - date-only events (QGenda's classic export) carry no timing, so
//    their buckets honestly stay buckets — the raw name is what the
//    user sees and clarifies.
const HOLZ_FEED = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//QGenda//EN\r
BEGIN:VEVENT\r
UID:holz-1@qgenda.com\r
DTSTART;VALUE=DATE:20260822\r
DTEND;VALUE=DATE:20260823\r
SUMMARY:HOLZ Call\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holz-2@qgenda.com\r
DTSTART;VALUE=DATE:20260823\r
DTEND;VALUE=DATE:20260824\r
SUMMARY:HOLZ\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holz-3@qgenda.com\r
DTSTART:20260909T070000\r
DTEND:20260910T070000\r
SUMMARY:HOLZ Call\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holz-4@qgenda.com\r
DTSTART:20260915T170000\r
DTEND:20260916T070000\r
SUMMARY:HOLZ Call\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holz-5@qgenda.com\r
DTSTART:20260917T070000\r
DTEND:20260917T150000\r
SUMMARY:HOLZ Call\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holz-6@qgenda.com\r
DTSTART:20261007T063000\r
DTEND:20261007T150000\r
SUMMARY:HOLZ\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holz-7@qgenda.com\r
DTSTART:20261009T070000\r
DTEND:20261009T173000\r
SUMMARY:HOLZ\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holz-8@qgenda.com\r
DTSTART:20261010T070000\r
DTEND:20261010T150000\r
SUMMARY:HOLZ Call\r
DESCRIPTION:Task: HOLZ Call\\n2nd call coverage for the group\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:holz-9@qgenda.com\r
DTSTART:20261020T170000\r
DTEND:20261021T070000\r
SUMMARY:Holzer Call\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
END:VCALENDAR\r
`;

Deno.test("parseQgendaICS: terse HOLZ titles keep raw code; buckets refined from text/timing", () => {
  const { shifts, unknownFacilities } = parseQgendaICS(HOLZ_FEED, HOLZER, {
    name: "Caleb Martin",
  });
  assertEquals(shifts.length, 9);
  assertEquals(unknownFacilities, ["HOLZ"]);
  const byUid = new Map(shifts.map((s) => [s.uid, s]));
  const pick = (uid: string) => {
    const s = byUid.get(uid);
    if (!s) throw new Error(`missing shift ${uid}`);
    return { code: s.code, type: s.type, pay: s.pay, hours: s.hours, facility: s.facility, facilityKnown: s.facilityKnown };
  };
  // Date-only call: no timing anywhere — bucket stays, raw name kept.
  assertEquals(pick("holz-1@qgenda.com"), { code: "HOLZ Call", type: "Call (unclassified)", pay: "", hours: null, facility: "HOLZ", facilityKnown: false });
  // Date-only bare code title: an unclassifiable day row, honestly.
  assertEquals(pick("holz-2@qgenda.com"), { code: "Shift", type: "Shift", pay: "", hours: null, facility: "HOLZ", facilityKnown: false });
  // 24h span -> 1st-call window; the displayed name stays raw.
  assertEquals(pick("holz-3@qgenda.com"), { code: "HOLZ Call", type: "24-hour call", pay: "", hours: 24, facility: "HOLZ", facilityKnown: false });
  // Evening-start 14h overnight span -> 2nd-call window.
  assertEquals(pick("holz-4@qgenda.com"), { code: "HOLZ Call", type: "Second call", pay: "", hours: 14, facility: "HOLZ", facilityKnown: false });
  // Daytime 8h "call" span is ambiguous — bucket honestly stays.
  assertEquals(pick("holz-5@qgenda.com"), { code: "HOLZ Call", type: "Call (unclassified)", pay: "", hours: 8, facility: "HOLZ", facilityKnown: false });
  // Bare code titles with daytime spans refine to the day types;
  // with no name anywhere, code falls back to the refined type.
  assertEquals(pick("holz-6@qgenda.com"), { code: "8-hour day", type: "8-hour day", pay: "", hours: 8.5, facility: "HOLZ", facilityKnown: false });
  assertEquals(pick("holz-7@qgenda.com"), { code: "10-hour shift", type: "10-hour shift", pay: "", hours: 10.5, facility: "HOLZ", facilityKnown: false });
  // DESCRIPTION text beats timing inference (daytime span, but the
  // description says 2nd call outright).
  assertEquals(pick("holz-8@qgenda.com"), { code: "HOLZ Call", type: "Second call", pay: "", hours: 8, facility: "HOLZ", facilityKnown: false });
  // Known facility, evening span: refined AND priced from its rule.
  assertEquals(pick("holz-9@qgenda.com"), { code: "Holzer Call", type: "Second call", pay: "3000", hours: 14, facility: "Holzer", facilityKnown: true });
});

Deno.test("refineQgendaBucketType: conservative edges", () => {
  // No timing -> untouched, whatever the bucket.
  assertEquals(refineQgendaBucketType("Call (unclassified)", null, null), "Call (unclassified)");
  assertEquals(refineQgendaBucketType("Shift", null, null), "Shift");
  // Non-bucket types are never overridden.
  assertEquals(refineQgendaBucketType("Second call", 24, 420), "Second call");
  assertEquals(refineQgendaBucketType("8-hour day", 14, 1020), "8-hour day");
  // Call: 24h window from a morning start is still the 1st-call span.
  assertEquals(refineQgendaBucketType("Call (unclassified)", 24, 420), "24-hour call");
  // Call: evening start is required for the 2nd-call inference.
  assertEquals(refineQgendaBucketType("Call (unclassified)", 14, 420), "Call (unclassified)");
  // Shift: out-of-band durations stay unclassified.
  assertEquals(refineQgendaBucketType("Shift", 6, 420), "Shift");
  assertEquals(refineQgendaBucketType("Shift", 16, 420), "Shift");
});

// HOLZER mirrors the test rules plus the contract's 1st-call terms
// (Nov 8, 2026: hourlyCall1st 175 alongside the premium hourly 250)
// so "24-hour call" prices by the shared formula — the same rule a
// contract import saves for Caleb's real Holzer facility.
const HOLZER_FULL = normalizeFacilityRules([
  {
    name: "Holzer",
    aliases: [],
    hourlyRate: 250,
    hourlyCall1st: 175,
    rate8: 2125,
    rate10: 2625,
    rateSecond: 3000,
    weekendRateSecond: 2000,
    callBonus: 1000,
    paidHours8: 8.5,
  },
]);

// --- Round 3 (Nov 8, 2026): QGenda's real task grammar ------------
// Ground truth from Caleb's own QGenda app (screenshots, Nov 8,
// 2026): tasks are "<FACILITY CODE> - <Task>" — "HOLZ - G Main (8)"
// for his regular day shifts (Tue Nov 10 – Fri Nov 13 in the app,
// Holzer 8 on his calendar) and "HOLZ - Call 2" for second call
// (Sun Nov 8). Under parser v2 every "G Main (8)" event died inside
// parseWorkShiftEvent ("HOLZ" hits no facility rule, "(8)" is no
// hour pattern, "G Main" matches nothing) and parseQgendaICS
// skipped the null — ONLY the call events (reachable through the
// bare word "call") ever appeared in his preview. v3 parses the
// grammar in the QGenda path, and the location is Gallipolis — note
// it does NOT name Holzer, so the facility resolution below comes
// from the code alone.
// Dates chosen against the 2026 calendar: Nov 8, 2026 is a SUNDAY
// (weekend Call 2 = $2,000), Nov 7 a Saturday (weekend Call 1 =
// 175 x 24 = $4,200); Nov 10 Tue / Nov 11 Wed / Nov 12 Thu are
// weekday G Main (8) at $2,125; Aug 22 Sat is a bare "Call" (stays
// unclassified); Aug 20/21 are a "Backup" pair under an UNKNOWN
// code (XYZ) — nothing classifies them, and v3 must still carry
// them in as unclassified rows instead of dropping them.
const GRAMMAR_FEED = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//QGenda//EN\r
BEGIN:VEVENT\r
UID:g-1@qgenda.com\r
DTSTART;VALUE=DATE:20261108\r
DTEND;VALUE=DATE:20261109\r
SUMMARY:HOLZ - Call 2\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:g-2@qgenda.com\r
DTSTART;VALUE=DATE:20261110\r
DTEND;VALUE=DATE:20261111\r
SUMMARY:HOLZ - G Main (8)\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:g-3@qgenda.com\r
DTSTART;VALUE=DATE:20261111\r
DTEND;VALUE=DATE:20261112\r
SUMMARY:HOLZ - G Main (8)\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:g-4@qgenda.com\r
DTSTART;VALUE=DATE:20261112\r
DTEND;VALUE=DATE:20261113\r
SUMMARY:Martin - HOLZ - G Main (8)\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:g-5@qgenda.com\r
DTSTART;VALUE=DATE:20261107\r
DTEND;VALUE=DATE:20261108\r
SUMMARY:HOLZ - Call 1\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:g-6@qgenda.com\r
DTSTART;VALUE=DATE:20260822\r
DTEND;VALUE=DATE:20260823\r
SUMMARY:HOLZ - Call\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:g-7@qgenda.com\r
DTSTART:20260915T070000\r
DTEND:20260915T153000\r
SUMMARY:HOLZ - G Main (10)\r
LOCATION:Gallipolis, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:g-8@qgenda.com\r
DTSTART;VALUE=DATE:20260820\r
DTEND;VALUE=DATE:20260821\r
SUMMARY:XYZ - Backup\r
LOCATION:Somewhere, OH\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:g-9@qgenda.com\r
DTSTART;VALUE=DATE:20260821\r
DTEND;VALUE=DATE:20260822\r
SUMMARY:XYZ - Backup\r
LOCATION:Somewhere, OH\r
END:VEVENT\r
END:VCALENDAR\r
`;

Deno.test("parseQgendaICS: real QGenda grammar — G Main (8) lands priced, Call 1/2 classified, nothing dated dropped", () => {
  const { shifts, unknownFacilities, eventCount } = parseQgendaICS(
    GRAMMAR_FEED,
    HOLZER_FULL,
    { name: "Caleb Martin" },
  );
  // No silent skips: every dated event is a row.
  assertEquals(eventCount, 9);
  assertEquals(shifts.length, 9);
  assertEquals(unknownFacilities, ["XYZ"]);
  const byUid = new Map(shifts.map((s) => [s.uid, s]));
  const pick = (uid: string) => {
    const s = byUid.get(uid);
    if (!s) throw new Error(`missing shift ${uid}`);
    return { date: s.date, code: s.code, type: s.type, pay: s.pay, hours: s.hours, facility: s.facility, facilityKnown: s.facilityKnown };
  };
  // Sun Nov 8 — "Call 2" is Second call; weekend rate from the rule.
  assertEquals(pick("g-1@qgenda.com"), { date: "2026-11-08", code: "HOLZ - Call 2", type: "Second call", pay: "2000", hours: null, facility: "Holzer", facilityKnown: true });
  // Tue/Wed Nov 10/11 — the day shifts that used to vanish: 8-hour
  // day at the facility's confirmed rate; hours stated by "(8)".
  assertEquals(pick("g-2@qgenda.com"), { date: "2026-11-10", code: "HOLZ - G Main (8)", type: "8-hour day", pay: "2125", hours: 8, facility: "Holzer", facilityKnown: true });
  assertEquals(pick("g-3@qgenda.com"), { date: "2026-11-11", code: "HOLZ - G Main (8)", type: "8-hour day", pay: "2125", hours: 8, facility: "Holzer", facilityKnown: true });
  // Assignee prefix on the ICS summary: the name strips, the task
  // name — call number included — survives whole.
  assertEquals(pick("g-4@qgenda.com"), { date: "2026-11-12", code: "HOLZ - G Main (8)", type: "8-hour day", pay: "2125", hours: 8, facility: "Holzer", facilityKnown: true });
  // Sat Nov 7 — "Call 1" is First call (canonical 24-hour call);
  // weekend price = 1st-call hourly x 24 from the contract terms.
  assertEquals(pick("g-5@qgenda.com"), { date: "2026-11-07", code: "HOLZ - Call 1", type: "24-hour call", pay: "4200", hours: 24, facility: "Holzer", facilityKnown: true });
  // Bare "Call": honestly unclassified — the prompt will ask.
  assertEquals(pick("g-6@qgenda.com"), { date: "2026-08-22", code: "HOLZ - Call", type: "Call (unclassified)", pay: "", hours: null, facility: "Holzer", facilityKnown: true });
  // A (10) main prices as the 10-hour shift.
  assertEquals(pick("g-7@qgenda.com"), { date: "2026-09-15", code: "HOLZ - G Main (10)", type: "10-hour shift", pay: "2625", hours: 10, facility: "Holzer", facilityKnown: true });
  // Unknown code + unrecognisable task: STILL rows — unclassified,
  // named as read, facility as read, unpriced.
  assertEquals(pick("g-8@qgenda.com"), { date: "2026-08-20", code: "XYZ - Backup", type: "XYZ - Backup", pay: "", hours: null, facility: "XYZ", facilityKnown: false });
  assertEquals(pick("g-9@qgenda.com"), { date: "2026-08-21", code: "XYZ - Backup", type: "XYZ - Backup", pay: "", hours: null, facility: "XYZ", facilityKnown: false });
  // The codes the clarification prompt will ask about for the
  // UNPRICED rows are per distinct raw name — never a bucket.
  const promptCodes = [...new Set(shifts.filter((s) => !s.pay).map((s) => s.code))].sort();
  assertEquals(promptCodes, ["HOLZ - Call", "XYZ - Backup"]);
  for (const sh of shifts) assertEquals(sh.status, "confirmed");
});

// --- A different facility's grammar (generality, Nov 8, 2026) -----
// Caleb's design question: "how will this work for a user who has
// different grammar at a different facility?" Answer pinned here:
// the parser holds NO "STM" knowledge — an invented facility code
// and task words it has never seen. Every row must still land, the
// unrecognised names must be exactly what the clarification prompt
// asks about (server side: type = the raw name, unpriced), and the
// one generic pattern present ("NOC 12" — the shared night/12-hour
// token rule every source uses) is the only head start given.
const STM_FEED = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//QGenda//EN\r
BEGIN:VEVENT\r
UID:stm-1@qgenda.com\r
DTSTART;VALUE=DATE:20261110\r
DTEND;VALUE=DATE:20261111\r
SUMMARY:STM - OR Day\r
LOCATION:St. Mary Campus\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:stm-2@qgenda.com\r
DTSTART;VALUE=DATE:20261111\r
DTEND;VALUE=DATE:20261112\r
SUMMARY:STM - NOC 12\r
LOCATION:St. Mary Campus\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:stm-3@qgenda.com\r
DTSTART;VALUE=DATE:20261112\r
DTEND;VALUE=DATE:20261113\r
SUMMARY:STM - Backup\r
LOCATION:St. Mary Campus\r
END:VEVENT\r
END:VCALENDAR\r
`;

Deno.test("parseQgendaICS: an unfamiliar grammar (STM) — all rows land, unknown names stay raw for the prompt", () => {
  const { shifts, unknownFacilities, eventCount } = parseQgendaICS(
    STM_FEED,
    HOLZER_FULL,
    { name: "Caleb Martin" },
  );
  assertEquals(eventCount, 3);
  assertEquals(shifts.length, 3);
  assertEquals(unknownFacilities, ["STM"]);
  const byUid = new Map(shifts.map((s) => [s.uid, s]));
  const pick = (uid: string) => {
    const s = byUid.get(uid);
    if (!s) throw new Error(`missing shift ${uid}`);
    return { code: s.code, type: s.type, pay: s.pay, facility: s.facility, facilityKnown: s.facilityKnown };
  };
  // No pattern in "OR Day" the generic table claims: raw, unpriced.
  assertEquals(pick("stm-1@qgenda.com"), { code: "STM - OR Day", type: "STM - OR Day", pay: "", facility: "STM", facilityKnown: false });
  // "NOC 12": the generic 12-hour token rule recognises the shape
  // (a head start, not a price — the facility is unknown).
  assertEquals(pick("stm-2@qgenda.com"), { code: "STM - NOC 12", type: "12-hour shift", pay: "", facility: "STM", facilityKnown: false });
  assertEquals(pick("stm-3@qgenda.com"), { code: "STM - Backup", type: "STM - Backup", pay: "", facility: "STM", facilityKnown: false });
  // Prompt codes = the raw names themselves, distinct.
  const promptCodes = [...new Set(shifts.map((s) => s.code))].sort();
  assertEquals(promptCodes, ["STM - Backup", "STM - NOC 12", "STM - OR Day"]);
});

Deno.test("parser version is exported for client staleness checks", () => {
  assertEquals(QGENDA_PARSER_VERSION, 3);
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
