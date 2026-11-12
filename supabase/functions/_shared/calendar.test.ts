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
  effectiveConnForSync,
  findFallbackLocalShift,
  groupFacilitySuggestions,
  heldEventBucket,
  importStatusForDate,
  knownFacilityNamed,
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

Deno.test("v120: empty local set makes a stale pairing repair, never skip — even without migration-005 flags", () => {
  // Caleb's Nov 11, 2026 scenario at the decision level: the wipe
  // erased every local shift; a stale import row survives. The sync
  // must repair (re-create), not skip-legacy/skip-deleted.
  assertEquals(
    decideStaleImportRow({ deletedLocally: false, tombstoned: false, keyExistsLocally: false, flagsSupported: false, accountEmpty: true }),
    "repair-create",
  );
  assertEquals(
    decideStaleImportRow({ deletedLocally: false, tombstoned: false, keyExistsLocally: true, flagsSupported: false, accountEmpty: true }),
    "repair-pair",
  );
  // Durable deletion evidence still wins on an empty account.
  assertEquals(
    decideStaleImportRow({ deletedLocally: true, tombstoned: false, keyExistsLocally: false, flagsSupported: false, accountEmpty: true }),
    "skip-deleted",
  );
  assertEquals(
    decideStaleImportRow({ deletedLocally: false, tombstoned: true, keyExistsLocally: false, flagsSupported: true, accountEmpty: true }),
    "skip-deleted",
  );
  // Non-empty accounts keep the legacy behavior exactly.
  assertEquals(
    decideStaleImportRow({ deletedLocally: false, tombstoned: false, keyExistsLocally: false, flagsSupported: false }),
    "skip-legacy",
  );
  // End-to-end through decideImportEvent.
  assertEquals(
    decideImportEvent({ parsed: true, localExists: false, importRow: { deleted_locally: false }, tombstoned: false, keyExistsLocally: false, flagsSupported: false, accountEmpty: true }),
    "repair-create",
  );
  assertEquals(
    decideImportEvent({ parsed: true, localExists: false, importRow: { deleted_locally: true }, tombstoned: false, keyExistsLocally: false, flagsSupported: true, accountEmpty: true }),
    "skip-deleted",
  );
});

Deno.test("v120: a sync with zero local shifts fetches with a full-pull connection (tokens stripped)", () => {
  const conn = { provider: "google", sync_token: "tok-2", delta_link: "dl-9", calendar_id: "cal-1", refresh_token_enc: "enc" };
  const full = effectiveConnForSync(conn, 0);
  assertEquals(full.fullPull, true);
  assertEquals(full.conn.sync_token, null);
  assertEquals(full.conn.delta_link, null);
  // Nothing else about the connection changes: credentials, the
  // dedicated calendar and the provider all survive.
  assertEquals(full.conn.calendar_id, "cal-1");
  assertEquals(full.conn.refresh_token_enc, "enc");
  // The stored row object itself is not mutated.
  assertEquals(conn.sync_token, "tok-2");
  // With any local shift present the connection is used as-is.
  const inc = effectiveConnForSync(conn, 3);
  assertEquals(inc.fullPull, false);
  assertEquals(inc.conn.sync_token, "tok-2");
});

// ---------------------------------------------------------------------------
// v130: multi-day source events (Caleb, Nov 11, 2026 — "Some weeks I
// made one event for the entire week rather than individual days").
// Before this round the repro at the top of the round's notes showed:
// parseIcsEvent -> ONE event dated Monday, DTEND read nowhere, the
// import loop created exactly 1 shift and Tue–Fri never arrived.
// These tests pin the fix at the same layer the loop runs.
// ---------------------------------------------------------------------------

import {
  coveredSpanDays,
  expandSourceEventSpan,
  icsValuePiece,
  spanBlockLastDay,
  spanKindForShiftType,
  spanLastCoveredDay,
  type ProviderEvent,
} from "./calendar.ts";
import { parseIcsEvent } from "./caldav.ts";

function spanEvent(partial: Partial<ProviderEvent>): ProviderEvent {
  return {
    providerEventId: "ev-1",
    date: "2026-11-02",
    facility: "",
    type: "Shift",
    pay: "",
    note: "",
    shiftId: null,
    updatedAt: null,
    cancelled: false,
    rawUpdatedAt: null,
    summary: "",
    ...partial,
  };
}

const camcRules = normalizeFacilityRules([
  { name: "CAMC", aliases: [], hourlyRate: 250 },
]);
const holzRules = normalizeFacilityRules([
  {
    name: "Holzer",
    aliases: ["HOLZ"],
    hourlyRate: 250,
    paidHours8: 8.5,
    rate24: 4800,
    weekendRate24: 4200,
    rateSecond: 3000,
    weekendRateSecond: 2000,
  },
]);

Deno.test("v130: span end semantics — all-day exclusive, midnight rule, timed end", () => {
  // All-day: DTEND is exclusive (Mon + end Sat covers Mon–Fri).
  assertEquals(spanLastCoveredDay({ date: "2026-11-07" }), "2026-11-06");
  // Timed end at exactly midnight does not claim that day.
  assertEquals(spanLastCoveredDay({ dateTime: "2026-11-03T00:00:00Z" }), "2026-11-02");
  // Any other timed end covers its date (3p next day covers Tue).
  assertEquals(spanLastCoveredDay({ dateTime: "2026-11-03T15:00:00Z" }), "2026-11-03");
  // ICS raw values adapt to the same pieces.
  assertEquals(spanLastCoveredDay(icsValuePiece("20261107")), "2026-11-06");
  assertEquals(spanLastCoveredDay(icsValuePiece("20261103T150000Z")), "2026-11-03");
  assertEquals(spanLastCoveredDay(icsValuePiece("")), "");
  assertEquals(coveredSpanDays("2026-11-02", "2026-11-06"), [
    "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
  ]);
  // A span over the cap is not a shift block: no covered days.
  assertEquals(coveredSpanDays("2026-11-02", "2027-02-01"), []);
  assertEquals(spanKindForShiftType("10-hour shift"), "day");
  assertEquals(spanKindForShiftType("24-hour call"), "call");
  assertEquals(spanKindForShiftType("Shift"), "other");
});

Deno.test("v130: Mon–Fri CAMC week block expands to 5 shifts at $2,500 = $12,500", () => {
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
    "UID:weekblock-1@caleb", "SUMMARY:CAMC 10",
    "DTSTART;VALUE=DATE:20261102", "DTEND;VALUE=DATE:20261107",
    "LAST-MODIFIED:20261101T120000Z", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const ev = parseIcsEvent(ics, "href");
  assert(ev, "event parses");
  assertEquals(ev!.endDate, "2026-11-06");
  assertEquals(ev!.endDateAllDay, true);
  const ex = expandSourceEventSpan(ev!, camcRules);
  assertEquals(ex.blocks, 1);
  assertEquals(ex.extraDays, 4);
  // Deterministic per-day identity: first day keeps the source id,
  // later days derive from it — a re-sync re-derives the same ids.
  assertEquals(ex.events.map((e) => e.providerEventId), [
    "weekblock-1@caleb",
    "weekblock-1@caleb#2026-11-03",
    "weekblock-1@caleb#2026-11-04",
    "weekblock-1@caleb#2026-11-05",
    "weekblock-1@caleb#2026-11-06",
  ]);
  // The import loop's own parse per derived event prices each day.
  let total = 0;
  for (const dayEv of ex.events) {
    const p = parseWorkShiftEvent(dayEv.summary ?? "", dayEv.location ?? "", dayEv.date, camcRules);
    assert(p, "each day parses");
    assertEquals(p!.type, "10-hour shift");
    total += Number(p!.pay);
  }
  assertEquals(total, 12500);
  // Expansion is a pure function of the source event: expanding the
  // same event again yields the identical event list (re-sync adds 0).
  const again = expandSourceEventSpan(ev!, camcRules);
  assertEquals(
    again.events.map((e) => `${e.providerEventId}|${e.date}`),
    ex.events.map((e) => `${e.providerEventId}|${e.date}`),
  );
});

Deno.test("v130: block test — an overnight shift is not a block; 48h+ timed is", () => {
  const piece = icsValuePiece;
  // Night float 7p -> 7a (12h): one shift, no block.
  assertEquals(spanBlockLastDay(piece("20261114T190000Z"), piece("20261115T070000Z")), "");
  // 24-hour call 3p -> 3p (24h): one shift, no block.
  assertEquals(spanBlockLastDay(piece("20261102T150000Z"), piece("20261103T150000Z")), "");
  // Mon 7a -> Wed 3p (56h): a block covering Mon–Wed.
  assertEquals(spanBlockLastDay(piece("20261102T070000Z"), piece("20261104T150000Z")), "2026-11-04");
  // Midnight-to-midnight, exactly 48h: a block covering Mon–Tue.
  assertEquals(spanBlockLastDay(piece("20261102T000000Z"), piece("20261104T000000Z")), "2026-11-03");
  // All-day Mon with DTEND Sat: a block covering Mon–Fri.
  assertEquals(spanBlockLastDay(piece("20261102"), piece("20261107")), "2026-11-06");
  // Single all-day event (DTEND next day): no block.
  assertEquals(spanBlockLastDay(piece("20261102"), piece("20261103")), "");
});

Deno.test("v130: a HOLZ 24/1st call 3p→3p is one ordinary shift — no endDate, no marker", () => {
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
    "UID:call-1@caleb", "SUMMARY:Holzer 24/1st call",
    "DTSTART:20261102T150000Z", "DTEND:20261103T150000Z",
    "LAST-MODIFIED:20261101T120000Z", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const ev = parseIcsEvent(ics, "href");
  assert(ev, "event parses");
  // 24h is one shift crossing midnight, not a block: the fetcher
  // reports no span end at all.
  assertEquals(ev!.endDate, undefined);
  const ex = expandSourceEventSpan(ev!, holzRules);
  assertEquals(ex.events.length, 1);
  assertEquals(ex.blocks, 0);
  assertEquals(ex.keptCallBlocks, 0);
  const p = parseWorkShiftEvent("Holzer 24/1st call", "", "2026-11-02", holzRules);
  assertEquals(p!.pay, "4800");
});

Deno.test("v130: a multi-day call block stays single; per-day calls are never invented", () => {
  // Fri–Sun 2nd-call block (all-day Fri, DTEND Mon): one assignment.
  const ex = expandSourceEventSpan(spanEvent({
    providerEventId: "call-block",
    date: "2026-11-06",
    summary: "Holzer 2nd call",
    endDate: "2026-11-08",
    endDateAllDay: true,
  }), holzRules);
  assertEquals(ex.events.length, 1);
  assertEquals(ex.keptCallBlocks, 1);
  assertEquals(ex.events[0].date, "2026-11-06");
});

Deno.test("v130: all-day unclassified block at a known facility expands (PCDO shape)", () => {
  // "HOLZ - PCDO" parses to the generic bucket server-side; the days
  // still expand because the event is all-day at a known facility —
  // each day is then classified/priced by the same per-day machinery
  // as a single-day import (PCDO settles $0 on the client).
  const ex = expandSourceEventSpan(spanEvent({
    providerEventId: "pcdo-block",
    date: "2026-11-02",
    summary: "HOLZ - PCDO",
    endDate: "2026-11-04",
    endDateAllDay: true,
  }), holzRules);
  assertEquals(ex.blocks, 1);
  assertEquals(ex.events.map((e) => e.date), ["2026-11-02", "2026-11-03", "2026-11-04"]);
  // The same title as a TIMED span is ambiguous: kept single, marked.
  const timed = expandSourceEventSpan(spanEvent({
    providerEventId: "pcdo-timed",
    date: "2026-11-02",
    summary: "HOLZ - PCDO",
    endDate: "2026-11-04",
  }), holzRules);
  assertEquals(timed.events.length, 1);
  assertEquals(timed.ambiguousBlocks, 1);
  assertEquals(timed.events[0].spanAmbiguous, true);
});

Deno.test("v130: single-day and non-shift events pass through untouched", () => {
  const single = expandSourceEventSpan(spanEvent({ summary: "CAMC 10" }), camcRules);
  assertEquals(single.events.length, 1);
  assertEquals(single.blocks, 0);
  const personal = expandSourceEventSpan(spanEvent({
    summary: "Dentist appointment",
    endDate: "2026-11-05",
    endDateAllDay: true,
  }), camcRules);
  assertEquals(personal.events.length, 1);
  assertEquals(personal.blocks, 0);
  const cancelled = expandSourceEventSpan(spanEvent({
    summary: "CAMC 10",
    endDate: "2026-11-06",
    endDateAllDay: true,
    cancelled: true,
  }), camcRules);
  assertEquals(cancelled.events.length, 1);
  assertEquals(cancelled.blocks, 0);
});

Deno.test("v130: a held (unknown-facility) day block still expands per day for suggestions", () => {
  const ex = expandSourceEventSpan(spanEvent({
    providerEventId: "held-1",
    summary: "CAMC 10",
    endDate: "2026-11-06",
    endDateAllDay: true,
  }), []); // no rules at all — CAMC not yet a facility
  assertEquals(ex.blocks, 1);
  assertEquals(ex.events.length, 5);
});

// ---------------------------------------------------------------------------
// v134: multi-day TIMED blocks of facility-defined codes + the
// self-describing-code rule (Caleb, Nov 11, 2026). His live calendar
// holds NINE timed CAMC blocks (fixture:
// caleb-camc-calendar-blocks-2026-11-11.md); on v132 code, driving
// them through the loop's own path produced 4 shifts / $8,000 of the
// 37 / $77,000 the blocks actually cover — the codes ("8s", "12s")
// were classifiable only via the facility's CLIENT-side codeMap,
// which the server never saw, and timed blocks expand only when the
// server classifies them. These tests pin the fix at the same layer.
// ---------------------------------------------------------------------------

import {
  matchFacilityCodeDef,
  selfDescribingCodeHours,
} from "./calendar.ts";

const camcDefs = [
  { code: "8", label: "8-hour shift", hours: 8, canonicalType: "8-hour day" },
  { code: "10", label: "10-hour shift", hours: 10, canonicalType: "10-hour shift" },
  { code: "12", label: "12-hour shift", hours: 12, canonicalType: "12-hour shift" },
  { code: "5**", label: "10-hour shift", hours: 10, canonicalType: "10-hour shift" },
  { code: "5*", label: "10-hour shift", hours: 10, canonicalType: "10-hour shift" },
  { code: "7", label: "12-hour shift", hours: 12, canonicalType: "12-hour shift" },
];
const camcWithDefs = normalizeFacilityRules([
  { name: "CAMC", aliases: [], hourlyRate: 250, codeDefs: camcDefs },
]);
const camcHourlyOnly = normalizeFacilityRules([
  { name: "CAMC", aliases: [], hourlyRate: 250 },
]);

function timedBlockIcs(uid: string, summary: string, start: string, end: string): string {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
    `UID:${uid}`, `SUMMARY:${summary}`,
    `DTSTART;TZID=America/New_York:${start}`,
    `DTEND;TZID=America/New_York:${end}`,
    "LAST-MODIFIED:20261101T120000Z", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

// Drive one source event through the import loop's own path:
// parseIcsEvent -> expandSourceEventSpan -> per-day parse.
function loopShifts(ics: string, rules: ReturnType<typeof normalizeFacilityRules>) {
  const ev = parseIcsEvent(ics, "href");
  assert(ev, "event parses");
  const ex = expandSourceEventSpan(ev!, rules);
  const out: { date: string; type: string; pay: string; id: string }[] = [];
  for (const dayEv of ex.events) {
    const p = parseWorkShiftEvent(dayEv.summary ?? "", dayEv.location ?? "", dayEv.date, rules);
    if (p) out.push({ date: dayEv.date, type: p.type, pay: p.pay, id: dayEv.providerEventId });
  }
  return { ex, out, ev: ev! };
}

Deno.test("v134: Caleb's nine real CAMC blocks expand to 37 priced day-shifts", () => {
  const specs: { uid: string; summary: string; start: string; end: string; days: number; perDay: number }[] = [
    { uid: "blk1@caleb", summary: "Camc 12s ", start: "20260113T150000", end: "20260115T160000", days: 3, perDay: 3000 },
    { uid: "blk3@caleb", summary: "CAMC 8s", start: "20260414T070000", end: "20260417T080000", days: 4, perDay: 2000 },
    { uid: "blk4@caleb", summary: "Camc 8", start: "20260518T160000", end: "20260521T170000", days: 4, perDay: 2000 },
    { uid: "blk5@caleb", summary: "CAMC 8s", start: "20260609T070000", end: "20260612T150000", days: 4, perDay: 2000 },
    { uid: "blk6@caleb", summary: "CAMC 8s", start: "20260615T073000", end: "20260617T153000", days: 3, perDay: 2000 },
    { uid: "blk7@caleb", summary: "CAMC 8s", start: "20260720T070000", end: "20260724T080000", days: 5, perDay: 2000 },
    { uid: "blk8@caleb", summary: "CAMC 8s", start: "20260804T070000", end: "20260807T080000", days: 4, perDay: 2000 },
    { uid: "blk9@caleb", summary: "CAMC 8s", start: "20260810T070000", end: "20260814T080000", days: 5, perDay: 2000 },
    { uid: "blk10@caleb", summary: "CAMC 8s", start: "20260831T070000", end: "20260904T080000", days: 5, perDay: 2000 },
  ];
  let totalShifts = 0;
  let totalPay = 0;
  for (const s of specs) {
    const { ex, out } = loopShifts(timedBlockIcs(s.uid, s.summary, s.start, s.end), camcWithDefs);
    assertEquals(ex.blocks, 1, s.uid + " counts as one block");
    assertEquals(out.length, s.days, s.uid + " day count");
    for (const sh of out) {
      assertEquals(Number(sh.pay), s.perDay, s.uid + " " + sh.date + " price");
      totalPay += Number(sh.pay);
    }
    totalShifts += out.length;
    // Re-expansion is deterministic: a re-sync re-derives the same
    // per-day ids and adds zero.
    const again = loopShifts(timedBlockIcs(s.uid, s.summary, s.start, s.end), camcWithDefs);
    assertEquals(
      again.out.map((x) => x.id + "|" + x.date),
      out.map((x) => x.id + "|" + x.date),
      s.uid + " re-sync identity",
    );
  }
  assertEquals(totalShifts, 37);
  assertEquals(totalPay, 77000);
});

Deno.test("v134: the week Caleb flagged — Aug 10–14 lands as five individual days", () => {
  const { out } = loopShifts(
    timedBlockIcs("flag@caleb", "CAMC 8s", "20260810T070000", "20260814T080000"),
    camcWithDefs,
  );
  assertEquals(out.map((x) => x.date), [
    "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
  ]);
  assertEquals(out.map((x) => x.type), [
    "8-hour day", "8-hour day", "8-hour day", "8-hour day", "8-hour day",
  ]);
});

Deno.test("v134: hourly-only card — pure-duration codes describe themselves", () => {
  // Single events first (Caleb's exact question, Nov 11, 2026).
  const p8 = parseWorkShiftEvent("CAMC 8s", "", "2026-08-10", camcHourlyOnly);
  assertEquals(p8?.type, "8-hour day");
  assertEquals(p8?.pay, "2000");
  assertEquals(p8?.derivedCode, { code: "8s", hours: 8 });
  const p10 = parseWorkShiftEvent("CAMC 10s", "", "2026-08-10", camcHourlyOnly);
  assertEquals(p10?.pay, "2500");
  assertEquals(p10?.derivedCode, { code: "10s", hours: 10 });
  const p12 = parseWorkShiftEvent("CAMC 12s", "", "2026-08-10", camcHourlyOnly);
  assertEquals(p12?.pay, "3000");
  assertEquals(p12?.derivedCode, { code: "12s", hours: 12 });
  // And the Aug 10–14 block expands on the derived reading too.
  const { out } = loopShifts(
    timedBlockIcs("self@caleb", "CAMC 8s", "20260810T070000", "20260814T080000"),
    camcHourlyOnly,
  );
  assertEquals(out.length, 5);
  assertEquals(out.reduce((a, x) => a + Number(x.pay), 0), 10000);
});

Deno.test("v134: hard guards — asterisk codes and facility codes never self-price", () => {
  // 5** at CAMC is a 10-hour shift BY DEFINITION, not 5 hours:
  // with no definition it does not parse at all (client surfaces
  // it for clarification) — and never as $1,250.
  assertEquals(parseWorkShiftEvent("CAMC 5**", "", "2026-08-10", camcHourlyOnly), null);
  assertEquals(parseWorkShiftEvent("CAMC 5*", "", "2026-08-10", camcHourlyOnly), null);
  // Bare "7" never self-prices (at CAMC it is a defined 12-hour code).
  assertEquals(parseWorkShiftEvent("CAMC 7", "", "2026-08-10", camcHourlyOnly), null);
  // Non-duration characters never self-price.
  assertEquals(parseWorkShiftEvent("CAMC 10hr ENDO", "", "2026-08-10", camcHourlyOnly), null);
  // With definitions shipped, the same titles price BY DEFINITION.
  const d5 = parseWorkShiftEvent("CAMC 5**", "", "2026-08-10", camcWithDefs);
  assertEquals(d5?.type, "10-hour shift");
  assertEquals(d5?.pay, "2500");
  assertEquals(d5?.derivedCode, undefined);
  const d7 = parseWorkShiftEvent("CAMC 7", "", "2026-08-10", camcWithDefs);
  assertEquals(d7?.pay, "3000");
  // A saved definition outranks the derived reading even for the
  // plural form: "7s" folds onto the saved "7" (a 12-hour code),
  // it does NOT become a derived 7-hour shift.
  const d7s = parseWorkShiftEvent("CAMC 7s", "", "2026-08-10", camcWithDefs);
  assertEquals(d7s?.pay, "3000");
  assertEquals(d7s?.derivedCode, undefined);
});

Deno.test("v134: selfDescribingCodeHours forms and bounds", () => {
  assertEquals(selfDescribingCodeHours("8"), 8);
  assertEquals(selfDescribingCodeHours("8s"), 8);
  assertEquals(selfDescribingCodeHours("8hr"), 8);
  assertEquals(selfDescribingCodeHours("8 hr"), 8);
  assertEquals(selfDescribingCodeHours("8-hour"), 8);
  assertEquals(selfDescribingCodeHours("8 hours"), 8);
  assertEquals(selfDescribingCodeHours("12S"), 12);
  assertEquals(selfDescribingCodeHours("9s"), 9);
  assertEquals(selfDescribingCodeHours("7s"), 7);
  assertEquals(selfDescribingCodeHours("7"), null);
  assertEquals(selfDescribingCodeHours("5**"), null);
  assertEquals(selfDescribingCodeHours("5*"), null);
  assertEquals(selfDescribingCodeHours("24"), null);
  assertEquals(selfDescribingCodeHours("24s"), null);
  assertEquals(selfDescribingCodeHours("3s"), null);
  assertEquals(selfDescribingCodeHours("17s"), null);
  assertEquals(selfDescribingCodeHours("10hr ENDO"), null);
  assertEquals(selfDescribingCodeHours("call 2"), null);
  assertEquals(selfDescribingCodeHours(""), null);
});

Deno.test("v134: matchFacilityCodeDef — plural-tolerant, unique or nothing", () => {
  const rule = camcWithDefs[0];
  assertEquals(matchFacilityCodeDef(rule, "8s")?.code, "8");
  assertEquals(matchFacilityCodeDef(rule, "CAMC 12s")?.code, "12");
  assertEquals(matchFacilityCodeDef(rule, "5**")?.code, "5**");
  assertEquals(matchFacilityCodeDef(rule, "nope"), null);
  // Normalize: the shipped payload coerces defs; junk is dropped.
  const coerced = normalizeFacilityRules([
    { name: "X", codeDefs: [{ code: "8", hours: "8" }, { code: "" }, { hours: 3 }, "junk"] },
  ]);
  assertEquals(coerced[0].codeDefs?.length, 1);
  assertEquals(coerced[0].codeDefs?.[0].hours, 8);
});

Deno.test("v134: defined call blocks stay single; defined day blocks expand", () => {
  const callRules = normalizeFacilityRules([{
    name: "CAMC",
    hourlyRate: 250,
    codeDefs: [
      { code: "Call 1", label: "24hr call", canonicalType: "24-hour call", weekdayPay: 4800, weekendPay: 4200 },
      { code: "PCDO", label: "post call day off", unpaid: true },
    ],
  }]);
  const call = parseWorkShiftEvent("CAMC Call 1", "", "2026-08-10", callRules);
  assertEquals(call?.type, "24-hour call");
  assertEquals(call?.pay, "4800"); // 2026-08-10 is a Monday
  assertEquals(call?.spanKind, "call");
  const { ex } = loopShifts(
    timedBlockIcs("call@caleb", "CAMC Call 1", "20260810T070000", "20260812T080000"),
    callRules,
  );
  assertEquals(ex.blocks, 0);
  assertEquals(ex.events.length, 1);
  // An unpaid defined code prices exactly $0 as a settled price.
  const pcdo = parseWorkShiftEvent("CAMC PCDO", "", "2026-08-10", callRules);
  assertEquals(pcdo?.pay, "0");
});

// ------------------------------------------------------------------
// v136: bare ordinal call references ("Holzer 1st " — trailing space,
// no word "call") bind to the facility's own call definitions, and
// a facility-named event that still binds no code is NAMED for the
// sync result (knownFacilityNamed) — never a silent skip. The
// December fixture is Caleb's real calendar (Oct 17, 2026 baseline):
// Dec 8/14/18 are the only "Holzer 1st" titles; before this round
// they parsed to null and vanished into skippedNotShift.
const holzCardV136 = normalizeFacilityRules([{
  name: "HOLZ",
  aliases: ["Holzer"],
  hourlyRate: 250,
  paidHours8: 8.5,
  rate10: 2625,
  hourlyCall1st: 175,
  rateSecond: 3000,
  weekendRateSecond: 2000,
  rate24: 4800,
  weekendRate24: 4200,
  codeDefs: [
    { code: "Holz-call 1", label: "24hr call", canonicalType: "24-hour call", weekdayPay: 4800, weekendPay: 4200 },
    { code: "Holz-call 2", label: "2nd call", canonicalType: "Second call", weekdayPay: 3000, weekendPay: 2000 },
    { code: "Holz-g main (8)", label: "8hr day shift", hours: 8, paidHours: 8.5 },
    { code: "Holz-g main (10)", label: "10hour day shift", hours: 10, paidHours: 10.5 },
    { code: "Holz PCDO", label: "post call day off", unpaid: true },
  ],
}]);

Deno.test("v136: Caleb's December imports whole — bare 'Holzer 1st' binds Call 1 at $4,800", () => {
  const dec: [string, string, string][] = [
    ["2026-11-30", "Holzer 8", "2125"], ["2026-12-01", "Holzer 8", "2125"],
    ["2026-12-02", "Holzer 8 2nd call", "3000"], ["2026-12-03", "Holzer 8", "2125"],
    ["2026-12-04", "Holzer 1st call", "4800"], ["2026-12-05", "Holzer 8 2nd call", "2000"],
    ["2026-12-06", "Holzer 1st call", "4200"], ["2026-12-08", "Holzer 1st ", "4800"],
    ["2026-12-10", "Holzer 1st call", "4800"], ["2026-12-14", "Holzer 1st ", "4800"],
    ["2026-12-16", "Holzer 1st call", "4800"], ["2026-12-18", "Holzer 1st ", "4800"],
    ["2026-12-28", "Holzer 8 2nd call", "3000"], ["2026-12-29", "Holzer 8", "2125"],
    ["2026-12-30", "Holzer 8", "2125"],
  ];
  let period = 0; // pay period Nov 30 – Dec 13 (the Dec 22 check)
  for (const [d, title, pay] of dec) {
    const p = parseWorkShiftEvent(title, "", d, holzCardV136);
    assert(p !== null, `December event did not import: ${d} ${JSON.stringify(title)}`);
    assertEquals(p?.pay, pay, `${d} ${JSON.stringify(title)}`);
    if (d >= "2026-11-30" && d <= "2026-12-13") period += Number(p?.pay);
  }
  // The pinned Dec 22 occurrence, restored by the Dec 8 shift.
  assertEquals(period, 29975);
  for (const d of ["2026-12-08", "2026-12-14", "2026-12-18"]) {
    const p = parseWorkShiftEvent("Holzer 1st ", "", d, holzCardV136);
    assertEquals(p?.type, "24-hour call", d);
    assertEquals(p?.facility, "HOLZ", d);
  }
});

Deno.test("v136: ordinal title variants bind or are named — none silent", () => {
  const binds: [string, string, string][] = [
    ["Holzer 1st", "24-hour call", "4800"], ["Holzer 1st ", "24-hour call", "4800"],
    ["HOLZER FIRST", "24-hour call", "4800"], ["Holzer first", "24-hour call", "4800"],
    ["Holzer 2nd", "Second call", "3000"], ["Holzer second call", "Second call", "3000"],
    ["1st call Holzer", "24-hour call", "4800"], ["1st Holzer", "24-hour call", "4800"],
    ["Holzer FIRST CALL", "24-hour call", "4800"],
  ];
  for (const [title, type, pay] of binds) {
    const p = parseWorkShiftEvent(title, "", "2026-12-08", holzCardV136);
    assertEquals(p?.type, type, title);
    assertEquals(p?.pay, pay, title);
  }
  // Facility rates alone (no definitions) classify the ordinal too.
  const ratesOnly = normalizeFacilityRules([{
    name: "HOLZ", aliases: ["Holzer"], hourlyRate: 250, rate24: 4800,
    weekendRate24: 4200, rateSecond: 3000, weekendRateSecond: 2000,
  }]);
  assertEquals(parseWorkShiftEvent("Holzer 1st", "", "2026-12-08", ratesOnly)?.pay, "4800");
  assertEquals(parseWorkShiftEvent("Holzer 2nd", "", "2026-12-08", ratesOnly)?.pay, "3000");
  // No definition and no call rate: unbound — but NAMED for the
  // sync result, never silently skipped.
  const bare = normalizeFacilityRules([{ name: "HOLZ", aliases: ["Holzer"], hourlyRate: 250 }]);
  assertEquals(parseWorkShiftEvent("Holzer 1st", "", "2026-12-08", bare), null);
  assertEquals(knownFacilityNamed("Holzer 1st", "", bare), "HOLZ");
  // Genuinely ambiguous (two 1st-call definitions): unbound + named.
  const amb = normalizeFacilityRules([{
    name: "HOLZ", aliases: ["Holzer"], hourlyRate: 250, rate24: 4800,
    codeDefs: [
      { code: "Holz-call 1", label: "24hr call", canonicalType: "24-hour call", weekdayPay: 4800 },
      { code: "Call 1 wknd", label: "1st call weekends", canonicalType: "24-hour call", weekendPay: 4200 },
    ],
  }]);
  assertEquals(parseWorkShiftEvent("Holzer 1st", "", "2026-12-08", amb), null);
  assertEquals(knownFacilityNamed("Holzer 1st", "", amb), "HOLZ");
  // A facility-named non-shift stays unimported but is named; an
  // event naming no known facility is not the facility's business.
  assertEquals(parseWorkShiftEvent("Lunch at Holzer", "", "2026-12-08", holzCardV136), null);
  assertEquals(knownFacilityNamed("Lunch at Holzer", "", holzCardV136), "HOLZ");
  assertEquals(knownFacilityNamed("Team lunch", "", holzCardV136), null);
});
