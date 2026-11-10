// CRNA Hub — unit tests for the Apple import decisions
// (_shared/calendar.ts). Run: deno test _shared/calendar.test.ts
//
// These cover the Nov 5, 2026 failure directly:
//   * a shift that was paired but never reached the device is REPAIRED,
//     never counted as deleted (absence is not a deletion);
//   * a shift the user genuinely deleted (explicit tombstone or
//     deleted_locally flag) is NEVER re-imported;
//   * a second sync never duplicates a shift that is already here.
// decideImportEvent is the same pure decision the sync-calendar import
// loop runs per source event, so these tests pin the loop's behaviour
// without a database or a live calendar.
//
// Local asserts (no remote deps): this file ships in the functions
// folder, so it must not pull in a remote stdlib at deploy time.
function assertEquals<T>(actual: T, expected: T, msg = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`assertEquals failed${msg ? ": " + msg : ""}\n  actual: ${a}\n  expected: ${e}`);
  }
}
function assert(cond: unknown, msg = "assert failed"): void {
  if (!cond) throw new Error(msg);
}

import {
  chunkArray,
  decideImportEvent,
  decideStaleImportRow,
  findFallbackLocalShift,
  groupFacilitySuggestions,
  heldEventBucket,
  importStatusForDate,
  normalizeFacilityRules,
  parseWorkShiftEvent,
  priceShiftWithFacility,
  sameFacility,
  sbUpsertMany,
  shiftSyncStateFor,
  suggestionAddressForLocation,
} from "./calendar.ts";

const FLAGS_ON = true; // migration 005 has run
const FLAGS_OFF = false; // migration 005 has not run yet

Deno.test("never-delivered shift is repaired, not counted deleted", () => {
  // Row created by a sync whose response never arrived: never seen on
  // the device, not flagged deleted, no tombstone.
  assertEquals(
    decideStaleImportRow({
      deletedLocally: false,
      tombstoned: false,
      keyExistsLocally: false,
      flagsSupported: FLAGS_ON,
    }),
    "repair-create",
  );
  // Same, for a row whose flags were never set at all (defaults).
  assertEquals(
    decideStaleImportRow({
      deletedLocally: undefined,
      tombstoned: false,
      keyExistsLocally: false,
      flagsSupported: FLAGS_ON,
    }),
    "repair-create",
  );
  // End to end through the per-event classifier: the event becomes a
  // repair-create, never a skip.
  assertEquals(
    decideImportEvent({
      parsed: true,
      localExists: false,
      importRow: { deleted_locally: false },
      tombstoned: false,
      keyExistsLocally: false,
      flagsSupported: FLAGS_ON,
    }),
    "repair-create",
  );
});

Deno.test("genuinely deleted shift (explicit tombstone) is never re-imported", () => {
  // Tombstone sent with this sync: the user deleted the shift here.
  assertEquals(
    decideStaleImportRow({
      deletedLocally: false,
      tombstoned: true,
      keyExistsLocally: false,
      flagsSupported: FLAGS_ON,
    }),
    "skip-deleted",
  );
  // Durable flag from an earlier tombstoned sync: still never
  // re-imported, even with no tombstone in this sync.
  assertEquals(
    decideStaleImportRow({
      deletedLocally: true,
      tombstoned: false,
      keyExistsLocally: false,
      flagsSupported: FLAGS_ON,
    }),
    "skip-deleted",
  );
  // A deleted shift that happens to share its date/type with a shift
  // still on the device is still skipped, not re-paired: deletion wins
  // over the local key.
  assertEquals(
    decideImportEvent({
      parsed: true,
      localExists: false,
      importRow: { deleted_locally: true },
      tombstoned: true,
      keyExistsLocally: true,
      flagsSupported: FLAGS_ON,
    }),
    "skip-deleted",
  );
});

Deno.test("pre-005 rows keep the old safe skip, counted apart from deleted", () => {
  // Without the 005 flags, "never delivered" cannot be told from
  // "deleted": keep skipping (never resurrect), but as skip-legacy —
  // the client must not report these as "you deleted".
  assertEquals(
    decideStaleImportRow({
      deletedLocally: undefined,
      tombstoned: false,
      keyExistsLocally: false,
      flagsSupported: FLAGS_OFF,
    }),
    "skip-legacy",
  );
  assertEquals(
    decideImportEvent({
      parsed: true,
      localExists: false,
      importRow: {},
      tombstoned: false,
      keyExistsLocally: false,
      flagsSupported: FLAGS_OFF,
    }),
    "skip-legacy",
  );
});

Deno.test("second sync does not duplicate a shift that is already here", () => {
  // The paired shift arrived: the event is already-here, never a
  // create — even if the source looks newer is handled by the loop's
  // update check, not by creating a second shift.
  assertEquals(
    decideImportEvent({
      parsed: true,
      localExists: true,
      importRow: { deleted_locally: false },
      tombstoned: false,
      keyExistsLocally: true,
      flagsSupported: FLAGS_ON,
    }),
    "already-here",
  );
  // Never-paired event whose shift is already on the device (entered
  // by hand, or created from the dedicated calendar): pair it, never
  // create a second copy.
  assertEquals(
    decideImportEvent({
      parsed: true,
      localExists: false,
      importRow: null,
      tombstoned: false,
      keyExistsLocally: true,
      flagsSupported: FLAGS_ON,
    }),
    "duplicate",
  );
  // Stale row whose shift is here under a different id: re-pair the
  // shift that is here, never create another one.
  assertEquals(
    decideStaleImportRow({
      deletedLocally: false,
      tombstoned: false,
      keyExistsLocally: true,
      flagsSupported: FLAGS_ON,
    }),
    "repair-pair",
  );
  // Fresh event, nothing on the device: the only path that creates.
  assertEquals(
    decideImportEvent({
      parsed: true,
      localExists: false,
      importRow: null,
      tombstoned: false,
      keyExistsLocally: false,
      flagsSupported: FLAGS_ON,
    }),
    "create",
  );
});

Deno.test("non-shift events are skipped, never imported", () => {
  assertEquals(
    decideImportEvent({
      parsed: false,
      localExists: false,
      importRow: null,
      tombstoned: false,
      keyExistsLocally: false,
      flagsSupported: FLAGS_ON,
    }),
    "skip-not-shift",
  );
  assertEquals(parseWorkShiftEvent("Team lunch", "", "2026-11-06", []), null);
  // No facility is built into the parser (neutrality, Nov 10, 2026):
  // a Holzer title with no saved rule is an unpriced suggestion,
  // exactly like any other unsaved facility (compare the CAMC test
  // below) — its rates live only in the user's saved facility rule.
  assertEquals(parseWorkShiftEvent("Holzer 8", "", "2026-11-06", []), {
    facility: "Holzer",
    type: "8-hour day",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
});

Deno.test("saved facility rules price every facility — Holzer included (neutrality, Nov 10, 2026)", () => {
  // One user's captured Holzer card, exactly as saved from their
  // contract and their own words: $250/hr, 8-hour day paid 8.5h,
  // 10-hour flat as captured, 2nd call $3,000 weekday / $2,000
  // weekend, 24-hour call $4,800 weekday / $4,200 weekend. The parser
  // holds NONE of these numbers — they arrive with the rule, and the
  // same titles price nothing at all without it (previous test).
  // 2026-11-06 is a Friday; 2026-11-07 is a Saturday.
  const rules = normalizeFacilityRules([
    { name: "Holzer", hourlyRate: 250, paidHours8: 8.5, rate10: 2625, hourlyCall1st: 175, rateSecond: 3000, weekendRateSecond: 2000, rate24: 4800, weekendRate24: 4200 },
  ]);
  assertEquals(parseWorkShiftEvent("Holzer 8", "", "2026-11-06", rules)?.pay, "2125");
  assertEquals(parseWorkShiftEvent("Holzer 8/2nd call", "", "2026-11-06", rules)?.pay, "3000");
  assertEquals(parseWorkShiftEvent("Holzer 8/2nd call", "", "2026-11-07", rules)?.pay, "2000");
  assertEquals(parseWorkShiftEvent("Holzer 24/1st call", "", "2026-11-06", rules)?.pay, "4800");
  assertEquals(parseWorkShiftEvent("Holzer 24/1st call", "", "2026-11-07", rules)?.pay, "4200");
  assertEquals(parseWorkShiftEvent("Holzer 10", "", "2026-11-06", rules)?.pay, "2625");
  // A bare "Holzer" title with no saved rule is a single ordinary
  // capitalised word — a person's name, not a hospital (the same
  // guard that keeps "Ashley" unparsed below).
  assertEquals(parseWorkShiftEvent("Holzer", "", "2026-11-06", []), null);
});

Deno.test("CAMC titles parse as shifts with facility CAMC, pay blank (unknown facility)", () => {
  // The Nov 5, 2026 request: past CAMC dates must come over. The parser
  // is date-window-free — even a 2024 date parses; the import range is
  // the full source-calendar history, not a window.
  assertEquals(parseWorkShiftEvent("CAMC 8", "", "2024-06-03", [], "2026-11-06"), {
    facility: "CAMC",
    type: "8-hour day",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  assertEquals(parseWorkShiftEvent("CAMC 1st call", "", "2026-03-04", [], "2026-11-06"), {
    facility: "CAMC",
    type: "24-hour call",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  assertEquals(parseWorkShiftEvent("CAMC 24", "", "2026-03-04", [], "2026-11-06"), {
    facility: "CAMC",
    type: "24-hour call",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  assertEquals(parseWorkShiftEvent("CAMC 2nd call", "", "2026-03-04", [], "2026-11-06"), {
    facility: "CAMC",
    type: "Second call",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  assertEquals(parseWorkShiftEvent("CAMC 12", "", "2026-03-04", [], "2026-11-06"), {
    facility: "CAMC",
    type: "12-hour shift",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  assertEquals(parseWorkShiftEvent("CAMC 10", "", "2026-03-04", [], "2026-11-06"), {
    facility: "CAMC",
    type: "10-hour shift",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  // A trailing date must never reclassify the shift: "CAMC 8 Nov 24"
  // is not a 24-hour call, and with a date fragment in the facility
  // part it is not a shift at all.
  assertEquals(parseWorkShiftEvent("CAMC 8 Nov 24", "", "2026-03-04"), null);
});

Deno.test("Facilities list drives recognition and pricing (name + aliases)", () => {
  const rules = normalizeFacilityRules([
    { name: "Charleston Area Medical Center", aliases: "CAMC", rate8: 2000, rate24: 4500, rateSecond: 2800, hourlyRate: 250 },
    { name: "WVU Medicine", aliases: ["WVU"], hourlyRate: 200 },
    { name: "Thomas Memorial", aliases: "Thomas", rate8: 1800, callBonus: 1000 },
  ]);
  // Alias in the title, canonical name on the shift, pay from the rule.
  assertEquals(parseWorkShiftEvent("CAMC 8", "", "2026-11-06", rules, "2026-11-06"), {
    facility: "Charleston Area Medical Center",
    type: "8-hour day",
    pay: "2000",
    facilityKnown: true,
    status: "confirmed",
  });
  assertEquals(parseWorkShiftEvent("CAMC 24", "", "2026-11-06", rules)?.pay, "4500");
  assertEquals(parseWorkShiftEvent("CAMC 2nd call", "", "2026-11-06", rules)?.pay, "2800");
  // Hourly rate prices the hours the rule does not flat-price.
  assertEquals(parseWorkShiftEvent("WVU 10", "", "2026-11-06", rules)?.pay, "2000");
  assertEquals(parseWorkShiftEvent("WVU 8", "", "2026-11-06", rules)?.pay, "1600");
  // Second call without a flat second-call rate: day rate + call bonus.
  assertEquals(parseWorkShiftEvent("Thomas 2nd call", "", "2026-11-06", rules)?.pay, "2800");
  // A title that is just the facility name is a shift for that facility
  // — unclassified and unpriced, for the user to confirm, never skipped.
  assertEquals(parseWorkShiftEvent("CAMC", "", "2026-11-06", rules, "2026-11-06"), {
    facility: "Charleston Area Medical Center",
    type: "Shift",
    pay: "",
    facilityKnown: true,
    status: "confirmed",
  });
  // Bug 2 (Nov 6, 2026): the same bare name with no facility saved is
  // ALSO a shift — held for a suggestion, not dropped. The old code
  // returned null here, so past CAMC shifts titled just "CAMC" never
  // even became a suggestion and the hospital stayed invisible. Once
  // the facility is added, the next sync imports it as an unclassified
  // shift, priced when a rule covers it, unpriced otherwise.
  assertEquals(parseWorkShiftEvent("CAMC", "", "2026-11-06", []), {
    facility: "CAMC",
    type: "Shift",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  // Alias spellings dedupe to the same facility, never a second shift.
  assert(sameFacility("CAMC", "Charleston Area Medical Center", rules));
  assert(!sameFacility("CAMC", "Holzer", rules));
  assert(sameFacility("camc", "CAMC", rules));
});

Deno.test("location names the facility for a bare shift pattern", () => {
  assertEquals(parseWorkShiftEvent("8", "CAMC", "2026-11-06", [], "2026-11-06"), {
    facility: "CAMC",
    type: "8-hour day",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  // 2026-11-06 is a Friday; 2026-11-07 is a Saturday. A location that
  // merely CONTAINS a facility's name is not that facility: with no
  // saved rule, "Holzer Memorial Hospital" is its own (unknown)
  // facility and the shift is held unpriced as a suggestion — the
  // parser no longer special-cases the name (neutrality, Nov 10,
  // 2026; this assert used to pin facility "Holzer", priced $3,000
  // from built-in rates, with no rule saved at all).
  assertEquals(parseWorkShiftEvent("2nd call", "Holzer Memorial Hospital", "2026-11-06", [], "2026-11-06"), {
    facility: "Holzer Memorial Hospital",
    type: "Second call",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  assertEquals(parseWorkShiftEvent("8", "Holzer", "2026-11-07", [])?.pay, "");
  assertEquals(parseWorkShiftEvent("8", "Holzer", "2026-11-07", [])?.facilityKnown, false);
  // With the facility saved, the same location matches price from
  // the saved rule — the only pricing source there is.
  const rules = normalizeFacilityRules([
    { name: "Holzer", hourlyRate: 250, paidHours8: 8.5, rateSecond: 3000, weekendRateSecond: 2000 },
  ]);
  assertEquals(parseWorkShiftEvent("2nd call", "Holzer Memorial Hospital", "2026-11-06", rules)?.pay, "3000");
  assertEquals(parseWorkShiftEvent("8", "Holzer", "2026-11-07", rules)?.pay, "2125");
});

Deno.test("non-shift events are still skipped, even when they name a facility", () => {
  assertEquals(parseWorkShiftEvent("Team lunch", "", "2026-11-06"), null);
  assertEquals(parseWorkShiftEvent("Dinner with Jordan", "", "2026-11-06"), null);
  assertEquals(parseWorkShiftEvent("Dentist appointment", "", "2026-11-06"), null);
  assertEquals(parseWorkShiftEvent("Holiday", "", "2026-11-06"), null);
  const rules = normalizeFacilityRules([
    { name: "Charleston Area Medical Center", aliases: "CAMC", rate8: 2000 },
  ]);
  // Facility named, but no shift pattern and not the bare name.
  assertEquals(parseWorkShiftEvent("Lunch at CAMC", "", "2026-11-06", rules), null);
});

Deno.test("saved facility rules win — including for Holzer titles (neutrality, Nov 10, 2026)", () => {
  // This test used to pin the opposite: a built-in Holzer title
  // parser whose rates overrode the Facilities list (a saved rate8
  // of 9999 still priced 2125). That parser is deleted — the saved
  // rule is now the ONLY pricing source, for every facility, this
  // one included.
  // 2026-11-06 is a Friday; 2026-11-07 is a Saturday.
  const rules = normalizeFacilityRules([
    { name: "Holzer", hourlyRate: 250, paidHours8: 8.5, rate10: 2625, hourlyCall1st: 175, rateSecond: 3000, weekendRateSecond: 2000, rate24: 4800, weekendRate24: 4200 },
  ]);
  assertEquals(parseWorkShiftEvent("Holzer 8", "", "2026-11-06", rules, "2026-11-06"), {
    facility: "Holzer",
    type: "8-hour day",
    pay: "2125",
    facilityKnown: true,
    status: "confirmed",
  });
  assertEquals(parseWorkShiftEvent("Holzer 8/2nd call", "", "2026-11-07", rules)?.pay, "2000");
  assertEquals(parseWorkShiftEvent("Holzer 24/1st call", "", "2026-11-06", rules)?.pay, "4800");
  assertEquals(parseWorkShiftEvent("Holzer 10", "", "2026-11-06", rules)?.pay, "2625");
  // A Facilities-list Holzer entry with different rates prices from
  // THOSE rates — the saved rule wins, always.
  const other = normalizeFacilityRules([{ name: "Holzer", rate8: 9999 }]);
  assertEquals(parseWorkShiftEvent("Holzer 8", "", "2026-11-06", other)?.pay, "9999");
});

Deno.test("facility rules normalise, and unpriced types stay blank, never $0", () => {
  const rules = normalizeFacilityRules([
    { name: "  CAMC ", aliases: "CAMC, Charleston", rate8: "2000", rate24: 0, hourlyRate: "250" },
    { name: "", aliases: "Nope" },
    "not-an-object",
    null,
  ]);
  assertEquals(rules.length, 1);
  assertEquals(rules[0].aliases, ["CAMC", "Charleston"]);
  assertEquals(rules[0].rate8, 2000);
  assertEquals(rules[0].rate24, null); // a 0 rate is "no rate", not $0 pay
  assertEquals(priceShiftWithFacility("12-hour shift", rules[0]), "3000"); // hourly fallback
  assertEquals(priceShiftWithFacility("24-hour call", rules[0]), ""); // no rate24 and no hourlyCall1st, so no hourly path for 24h
  assertEquals(priceShiftWithFacility("Second call", { name: "X", rate8: 1800, callBonus: 1000 }), "2800");
  assertEquals(priceShiftWithFacility("Second call", { name: "X", rate8: 1800 }), "");
  assertEquals(priceShiftWithFacility("Shift", rules[0]), "");
});

Deno.test("chunkArray splits batched deletes", () => {
  assertEquals(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunkArray([], 50), []);
  assertEquals(chunkArray([1, 2, 3], 50), [[1, 2, 3]]);
});

Deno.test("sbUpsertMany sends one bulk request, not one per row", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  try {
    await sbUpsertMany("calendar_import_map", [
      { user_id: "u", provider: "apple", shift_id: "a" },
      { user_id: "u", provider: "apple", shift_id: "b" },
      { user_id: "u", provider: "apple", shift_id: "c" },
    ]);
    assertEquals(calls.length, 1);
    const body = JSON.parse(String(calls[0].init.body));
    assert(Array.isArray(body) && body.length === 3);
    const prefer = (calls[0].init.headers as Record<string, string>)["Prefer"];
    assert(prefer.includes("resolution=merge-duplicates"));
    // Empty input sends nothing.
    await sbUpsertMany("calendar_import_map", []);
    assertEquals(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("unknown-facility shifts group into one suggestion per hospital (count + date range)", () => {
  // CAMC 8 / CAMC 2nd call parse as shifts with facilityKnown false;
  // personal events never parse, so they can never become suggestions.
  const camc8 = parseWorkShiftEvent("CAMC 8", "", "2026-11-06", []);
  const camc2nd = parseWorkShiftEvent("CAMC 2nd call", "", "2026-11-09", []);
  assert(camc8 && !camc8.facilityKnown && camc8.facility === "CAMC");
  assert(camc2nd && !camc2nd.facilityKnown);
  assertEquals(parseWorkShiftEvent("Dentist appointment", "", "2026-11-06", []), null);
  assertEquals(parseWorkShiftEvent("Lunch at CAMC", "", "2026-11-06", []), null);
  assertEquals(parseWorkShiftEvent("St. Mary's 1st call", "", "2026-11-07", [])?.facilityKnown, false);
  // Holzer has no built-in status (neutrality, Nov 10, 2026): with
  // no saved rule it is suggested like any other unknown facility.
  assertEquals(parseWorkShiftEvent("Holzer 8", "", "2026-11-06", [])?.facilityKnown, false);
  // A listed facility is known, so it is never suggested either.
  const rules = normalizeFacilityRules([{ name: "Charleston Area Medical Center", aliases: "CAMC", rate8: 2000 }]);
  assertEquals(parseWorkShiftEvent("CAMC 8", "", "2026-11-06", rules)?.facilityKnown, true);
  // Grouping: case-insensitive, one suggestion per hospital, with
  // count, first/last date, and sample titles.
  const grouped = groupFacilitySuggestions([
    { facility: "CAMC", date: "2026-11-09", title: "CAMC 2nd call", location: "" },
    { facility: "CAMC", date: "2026-11-06", title: "CAMC 8", location: "3200 MacCorkle Ave, Charleston, WV 25304" },
    { facility: "Camc", date: "2026-11-07", title: "CAMC 10", location: "" },
    { facility: "St. Mary's", date: "2026-11-08", title: "St. Mary's 1st call", location: "" },
  ]);
  assertEquals(grouped.length, 2);
  assertEquals(grouped[0].name, "CAMC");
  assertEquals(grouped[0].count, 3);
  assertEquals(grouped[0].firstDate, "2026-11-06");
  assertEquals(grouped[0].lastDate, "2026-11-09");
  assertEquals(grouped[0].address, "3200 MacCorkle Ave, Charleston, WV 25304");
  assertEquals(grouped[0].sampleTitles.length, 3);
  assertEquals(grouped[1].name, "St. Mary's");
  assertEquals(grouped[1].count, 1);
  // Undated / unnamed rows are dropped, never suggested.
  assertEquals(groupFacilitySuggestions([
    { facility: "", date: "2026-11-06", title: "CAMC 8" },
    { facility: "CAMC", date: "", title: "CAMC 8" },
    { facility: "CAMC", date: "not-a-date", title: "CAMC 8" },
  ]), []);
});

Deno.test("suggestion address comes only from an address-like location", () => {
  assertEquals(suggestionAddressForLocation("3200 MacCorkle Ave, Charleston, WV 25304", "CAMC"), "3200 MacCorkle Ave, Charleston, WV 25304");
  assertEquals(suggestionAddressForLocation("123 Main St", "St. Mary's"), "123 Main St");
  // A place name as the location is not an address.
  assertEquals(suggestionAddressForLocation("Charleston Area Medical Center", "CAMC"), "");
  assertEquals(suggestionAddressForLocation("CAMC", "CAMC"), "");
  assertEquals(suggestionAddressForLocation("", "CAMC"), "");
});

Deno.test("findFallbackLocalShift: a re-imported shift under a new id re-links instead of flagging", () => {
  // Caleb's case (Nov 6, 2026): the dedicated-calendar event's map row
  // points at an old shift id, but the same Holzer shift is on the
  // device under a new id — past (2025), near (2026), and future
  // (2027) dates alike. The fallback must find it on date + facility
  // + type so the sync re-pairs instead of flagging a deletion.
  const locals = [
    { id: "new-1", date: "2027-03-29", facility: "Holzer", type: "8-hour day" },
    { id: "new-2", date: "2026-12-16", facility: "Holzer", type: "24-hour call" },
    { id: "new-3", date: "2025-11-03", facility: "Holzer", type: "8-hour day" },
  ];
  const paired = new Set(["old-1", "old-2", "old-3"]);
  assertEquals(
    findFallbackLocalShift(locals, { date: "2027-03-29", facility: "Holzer", type: "8-hour day" }, new Set(), paired)?.id,
    "new-1",
  );
  assertEquals(
    findFallbackLocalShift(locals, { date: "2026-12-16", facility: "Holzer", type: "24-hour call" }, new Set(), paired)?.id,
    "new-2",
  );
  // No local match at all: undefined — the caller may then flag on
  // the event's own evidence (present/cancelled in this batch).
  assertEquals(
    findFallbackLocalShift(locals, { date: "2027-03-04", facility: "Holzer", type: "8-hour day" }, new Set(), paired),
    undefined,
  );
  // Same date + facility but a different type is a different shift.
  assertEquals(
    findFallbackLocalShift(locals, { date: "2027-03-29", facility: "Holzer", type: "Second call" }, new Set(), paired),
    undefined,
  );
  // A candidate already handled in this sync, or already paired to
  // another event, is never stolen.
  assertEquals(
    findFallbackLocalShift(locals, { date: "2027-03-29", facility: "Holzer", type: "8-hour day" }, new Set(["new-1"]), paired),
    undefined,
  );
  assertEquals(
    findFallbackLocalShift(locals, { date: "2027-03-29", facility: "Holzer", type: "8-hour day" }, new Set(), new Set(["new-1"])),
    undefined,
  );
  // Undated events never match.
  assertEquals(
    findFallbackLocalShift(locals, { date: "", facility: "Holzer", type: "8-hour day" }, new Set(), paired),
    undefined,
  );
});

Deno.test("shiftSyncStateFor: pending deletion wins, paired is synced, the rest is not-synced", () => {
  // The three states the client renders per shift ("On your calendar" /
  // "Not yet synced" / "Pending deletion"). The sync engine maintains
  // the two sets from calendar_sync_map + pending deletions; this pins
  // the derivation, not the engine's bookkeeping.
  const synced = new Set(["s-paired", "s-flagged"]);
  const pending = new Set(["s-flagged"]);
  // Paired with the dedicated calendar: on the calendar.
  assertEquals(shiftSyncStateFor("s-paired", synced, pending), "synced");
  // Paired AND flagged: the provider copy is gone and unconfirmed, so
  // the flag wins — the label must say Pending deletion, not On your
  // calendar.
  assertEquals(shiftSyncStateFor("s-flagged", synced, pending), "pending-deletion");
  // Flagged without a pairing (local-missing flag): still pending.
  assertEquals(shiftSyncStateFor("s-missing", new Set(), new Set(["s-missing"])), "pending-deletion");
  // Never paired (fresh app-entered shift, or an import not yet pushed
  // to the dedicated calendar): not synced yet.
  assertEquals(shiftSyncStateFor("s-fresh", synced, pending), "not-synced");
  assertEquals(shiftSyncStateFor("s-fresh", new Set(), new Set()), "not-synced");
});

Deno.test("facility rules carry weekend and 1st-call hourly rates; server prices them by date", () => {
  // 2026-11-06 is a Friday; 2026-11-07 is a Saturday.
  const rules = normalizeFacilityRules([
    { name: "CAMC", rateSecond: 3000, weekendRateSecond: 2000, weekendRate24: 4200, hourlyCall1st: 175, hourlyRate: 250, rate24: 0 },
  ]);
  assertEquals(rules[0].weekendRateSecond, 2000);
  assertEquals(rules[0].hourlyCall1st, 175);
  assertEquals(rules[0].weekendRate24, 4200);
  assertEquals(rules[0].rate24, null); // a 0 rate is "no rate", not $0 pay
  assertEquals(priceShiftWithFacility("Second call", rules[0], "2026-11-07"), "2000");
  assertEquals(priceShiftWithFacility("Second call", rules[0], "2026-11-06"), "3000");
  assertEquals(priceShiftWithFacility("24-hour call", rules[0], "2026-11-07"), "4200");
  assertEquals(priceShiftWithFacility("24-hour call", rules[0], "2026-11-06"), "4800"); // 250x8 + 175x16
  // No date: weeknight behaviour, unchanged from before.
  assertEquals(priceShiftWithFacility("Second call", rules[0]), "3000");
  assertEquals(priceShiftWithFacility("24-hour call", rules[0]), "4800");
  // 1st-call hourly alone, no flats: weekend is hourly x 24, weekday
  // with no premium hourly is hourly x 24 too.
  const hourlyOnly = normalizeFacilityRules([{ name: "X", hourlyCall1st: 175 }])[0];
  assertEquals(priceShiftWithFacility("24-hour call", hourlyOnly, "2026-11-07"), "4200");
  assertEquals(priceShiftWithFacility("24-hour call", hourlyOnly, "2026-11-06"), "4200");
  // parseWorkShiftEvent passes the date through, so a QGenda / calendar
  // weekend second call prices at the weekend rate.
  const evRules = normalizeFacilityRules([
    { name: "CAMC", aliases: "CAMC", rateSecond: 3000, weekendRateSecond: 2000 },
  ]);
  assertEquals(parseWorkShiftEvent("CAMC Second call", "", "2026-11-07", evRules)?.pay, "2000");
  assertEquals(parseWorkShiftEvent("CAMC Second call", "", "2026-11-06", evRules)?.pay, "3000");
});

// --- Bug 1 (Nov 6, 2026): imports arrive confirmed, not proposed ---
//
// Caleb's 139 shifts in 2026 all arrived as proposed, so Confirmed (C)
// year-to-date read $0 while Proposed (P) held everything. The fix
// shipped with the two-status model (Nov 6, 2026, later that day):
// only "confirmed" and "proposed" exist, imported/synced shifts
// arrive CONFIRMED whatever their date, and "proposed" is reserved
// for a date that cannot be read at all. (An earlier past/future
// split was superseded the same day; these tests pin the model the
// app actually ships — stale-test repair, Nov 10, 2026, not a
// behaviour change.)
Deno.test("importStatusForDate: any valid date -> confirmed, bad date -> proposed", () => {
  assertEquals(importStatusForDate("2026-11-05", "2026-11-06"), "confirmed");
  assertEquals(importStatusForDate("2024-06-03", "2026-11-06"), "confirmed");
  assertEquals(importStatusForDate("2026-11-06", "2026-11-06"), "confirmed");
  assertEquals(importStatusForDate("2026-11-07", "2026-11-06"), "confirmed");
  assertEquals(importStatusForDate("2027-01-15", "2026-11-06"), "confirmed");
  assertEquals(importStatusForDate("", "2026-11-06"), "proposed");
  assertEquals(importStatusForDate("not-a-date", "2026-11-06"), "proposed");
});

Deno.test("parseWorkShiftEvent carries the import status", () => {
  const rules = normalizeFacilityRules([{ name: "CAMC", rate8: 2000 }]);
  assertEquals(parseWorkShiftEvent("CAMC 8", "", "2026-11-05", rules, "2026-11-06")?.status, "confirmed");
  assertEquals(parseWorkShiftEvent("CAMC 8", "", "2026-11-20", rules, "2026-11-06")?.status, "confirmed");
  assertEquals(parseWorkShiftEvent("CAMC 8", "", "2026-11-05", rules, "2026-11-06")?.pay, "2000");
  // Same for the generic fallback (an unknown facility is still held
  // for a suggestion — its status rides along for when the facility
  // is added and the shift imports).
  assertEquals(parseWorkShiftEvent("Riverside 8", "", "2026-11-05", [], "2026-11-06")?.status, "confirmed");
});

Deno.test("Bug 2: bare facility title is held for a suggestion, not dropped", () => {
  // Nov 6, 2026: past CAMC shifts titled just "CAMC" never became a
  // suggestion — the generic fallback returned null for a title with
  // no shift pattern. A bare facility-like title is now an
  // unclassified shift for that facility (facilityKnown false), so
  // the sync loop holds it and suggests the hospital.
  assertEquals(parseWorkShiftEvent("CAMC", "", "2026-03-04", []), {
    facility: "CAMC",
    type: "Shift",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  // Past dates parse exactly like future ones.
  assertEquals(parseWorkShiftEvent("CAMC", "", "2024-06-03", []), {
    facility: "CAMC",
    type: "Shift",
    pay: "",
    facilityKnown: false,
    status: "confirmed",
  });
  // A multi-word bare facility name, and trailing punctuation.
  assertEquals(parseWorkShiftEvent("Charleston Area Medical Center", "", "2026-03-04", [])?.facility, "Charleston Area Medical Center");
  assertEquals(parseWorkShiftEvent("CAMC:", "", "2026-03-04", [])?.facility, "CAMC");
  // Location still rides along for the suggestion address.
  assertEquals(parseWorkShiftEvent("CAMC", "3200 MacCorkle Ave, Charleston, WV 25304", "2026-03-04", [])?.facilityKnown, false);
  // Guards: a single ordinary word is a person's name, not a hospital.
  assertEquals(parseWorkShiftEvent("Ashley", "", "2026-03-04", []), null);
  assertEquals(parseWorkShiftEvent("Jordan", "", "2026-03-04", []), null);
  // And the old non-shift guards still hold.
  assertEquals(parseWorkShiftEvent("Lunch at CAMC", "", "2026-03-04", []), null);
  assertEquals(parseWorkShiftEvent("CAMC meeting", "", "2026-03-04", []), null);
  assertEquals(parseWorkShiftEvent("CAMC 8 Nov 24", "", "2026-03-04", []), null);
});

Deno.test("Bug 2: past CAMC events group into a suggestion with count + date range", () => {
  // The exact Nov 6 report: past CAMC shifts must surface as one
  // suggestion — "We noticed shifts at CAMC in your calendar. Add it
  // as a facility?" — with a shift count and a date range, not only
  // future ones.
  const grouped = groupFacilitySuggestions([
    { facility: "CAMC", date: "2026-03-04", title: "CAMC", location: "" },
    { facility: "CAMC", date: "2026-03-06", title: "CAMC 8", location: "3200 MacCorkle Ave, Charleston, WV 25304" },
    { facility: "CAMC", date: "2026-03-10", title: "CAMC 2nd call", location: "" },
    { facility: "camc", date: "2026-03-05", title: "CAMC 10", location: "" },
  ]);
  assertEquals(grouped.length, 1);
  assertEquals(grouped[0].name, "CAMC");
  assertEquals(grouped[0].count, 4);
  assertEquals(grouped[0].firstDate, "2026-03-04");
  assertEquals(grouped[0].lastDate, "2026-03-10");
  assertEquals(grouped[0].address, "3200 MacCorkle Ave, Charleston, WV 25304");
});

Deno.test("Bug 2: heldEventBucket — legacy rows at an unsaved facility are suggested, deletions never are", () => {
  // Fresh / duplicate / already-here / repair at an unsaved facility:
  // held for a suggestion.
  assertEquals(heldEventBucket("create", false), "suggested");
  assertEquals(heldEventBucket("duplicate", false), "suggested");
  assertEquals(heldEventBucket("already-here", false), "suggested");
  assertEquals(heldEventBucket("repair-create", false), "suggested");
  assertEquals(heldEventBucket("repair-pair", false), "suggested");
  // Skip-legacy at an unsaved facility: a pairing from an earlier
  // interrupted sync is not proof of deletion, so it is suggested too
  // — the old code excluded it and the hospital stayed invisible.
  assertEquals(heldEventBucket("skip-legacy", false), "suggested");
  // Skip-legacy at a saved facility: stays legacy (migration 005 or
  // the repair button is the way out), never silently re-imported.
  assertEquals(heldEventBucket("skip-legacy", true), "legacy");
  // An explicit deletion is never suggested, saved or not.
  assertEquals(heldEventBucket("skip-deleted", false), "deleted");
  assertEquals(heldEventBucket("skip-deleted", true), "deleted");
  // A known facility on the normal path is not a hold at all.
  assertEquals(heldEventBucket("create", true), null);
  assertEquals(heldEventBucket("already-here", true), null);
  assertEquals(heldEventBucket("repair-create", true), null);
});

Deno.test("Bug 2: CAMC screenshot rates price day shifts, call stays unpriced (never $0)", () => {
  // Test-only rates from Caleb's CAMC screenshot (Nov 6, 2026):
  // $250/hr; 8h $2,000; 10h $2,500; 12h $3,000; no call taken. These
  // live only in this test — no CAMC rate is hard-coded in the app.
  const rules = normalizeFacilityRules([
    { name: "Charleston Area Medical Center", aliases: "CAMC", hourlyRate: 250, rate8: 2000, rate10: 2500, rate12: 3000 },
  ]);
  const rule = rules[0];
  assertEquals(priceShiftWithFacility("8-hour day", rule, "2026-03-04"), "2000");
  assertEquals(priceShiftWithFacility("10-hour shift", rule, "2026-03-05"), "2500");
  assertEquals(priceShiftWithFacility("12-hour shift", rule, "2026-03-06"), "3000");
  // No call taken at CAMC: no rate at all — blank, never $0.
  assertEquals(priceShiftWithFacility("Second call", rule, "2026-03-07"), "");
  assertEquals(priceShiftWithFacility("24-hour call", rule, "2026-03-08"), "");
  // End to end through the parser once the facility is saved: past
  // CAMC shifts price from the rule.
  assertEquals(parseWorkShiftEvent("CAMC 8", "", "2026-03-04", rules)?.pay, "2000");
  assertEquals(parseWorkShiftEvent("CAMC 10", "", "2026-03-05", rules)?.pay, "2500");
  assertEquals(parseWorkShiftEvent("CAMC 12", "", "2026-03-06", rules)?.pay, "3000");
  assertEquals(parseWorkShiftEvent("CAMC 2nd call", "", "2026-03-07", rules)?.pay, "");
  assertEquals(parseWorkShiftEvent("CAMC 2nd call", "", "2026-03-07", rules)?.facilityKnown, true);
});

Deno.test("weekendDays is per-facility data: a Friday-weekend facility prices Friday at weekend rates", () => {
  // Nov 9, 2026: the weekend definition is the facility's own rule
  // (captured in the user's words), never a global constant.
  // 2026-11-06 is a Friday.
  const fri = normalizeFacilityRules([
    { name: "FRIWKND", rateSecond: 3000, weekendRateSecond: 2000, rate24: 4800, weekendRate24: 4200, weekendDays: [0, 5, 6] },
  ]);
  assertEquals(fri[0].weekendDays, [0, 5, 6]);
  assertEquals(priceShiftWithFacility("Second call", fri[0], "2026-11-06"), "2000");
  assertEquals(priceShiftWithFacility("24-hour call", fri[0], "2026-11-06"), "4200");
  // The same rates WITHOUT a stated weekend keep the Sat/Sun
  // default: Friday prices as a weekday.
  const def = normalizeFacilityRules([
    { name: "DEFAULT", rateSecond: 3000, weekendRateSecond: 2000, rate24: 4800, weekendRate24: 4200 },
  ]);
  assertEquals(def[0].weekendDays, null);
  assertEquals(priceShiftWithFacility("Second call", def[0], "2026-11-06"), "3000");
  assertEquals(priceShiftWithFacility("24-hour call", def[0], "2026-11-06"), "4800");
  // Malformed entries are dropped, never honored.
  const bad = normalizeFacilityRules([{ name: "BAD", weekendDays: [5, 9, -1, "x"] }]);
  assertEquals(bad[0].weekendDays, [5]);
});

Deno.test("synthetic other user: invented facilities and rates price end-to-end, no built-in data (neutrality)", () => {
  // A brand-new user whose world shares nothing with any example in
  // this file: different facility names, different rates, and a
  // weekend that includes Friday. Everything prices from their own
  // saved rules — and only from them.
  // 2026-11-06 is a Friday; 2026-11-09 is a Monday.
  const rules = normalizeFacilityRules([
    { name: "Riverside General", aliases: "RGH", hourlyRate: 180, paidHours8: 8, rateSecond: 2200, weekendRateSecond: 1600, hourlyCall1st: 150, weekendDays: [0, 5, 6] },
    { name: "Northgate Surgery Center", hourlyRate: 210, rate12: 2700 },
  ]);
  assertEquals(parseWorkShiftEvent("RGH 8", "", "2026-11-09", rules)?.pay, "1440"); // 180 x 8 paid hours
  assertEquals(parseWorkShiftEvent("RGH 2nd call", "", "2026-11-09", rules)?.pay, "2200"); // Monday: weekday rate
  assertEquals(parseWorkShiftEvent("RGH 2nd call", "", "2026-11-06", rules)?.pay, "1600"); // Friday: THEIR weekend rate
  assertEquals(parseWorkShiftEvent("RGH 1st call", "", "2026-11-09", rules)?.pay, "3840"); // 180x8 + 150x16 segmented formula
  assertEquals(parseWorkShiftEvent("Northgate Surgery Center 12", "", "2026-11-09", rules)?.pay, "2700");
  // The same titles with NO saved rule price nothing at all.
  assertEquals(parseWorkShiftEvent("RGH 8", "", "2026-11-09", [])?.pay, "");
  assertEquals(parseWorkShiftEvent("RGH 8", "", "2026-11-09", [])?.facilityKnown, false);
});
