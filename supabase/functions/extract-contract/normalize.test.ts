// CRNA Hub — extract-contract schedule-mode normalizer (pure).
// Run: deno test --allow-read supabase/functions/extract-contract/normalize.test.ts

import { assertEquals } from "jsr:@std/assert";
import { normalizeAiSchedule } from "./normalize.ts";

Deno.test("normalizeAiSchedule: keeps dated rows for the named person, drops the rest", () => {
  const out = normalizeAiSchedule({
    shifts: [
      { date: "2026-11-10", facility: "Holzer", type: "8-hour day", name: "C. Martin" },
      { date: "11/12/2026", facility: "Holzer", type: "Second call", name: "Martin, Caleb" },
      { date: "not a date", facility: "Holzer", type: "8-hour day", name: "C. Martin" },
      { date: "2026-11-13", facility: "", type: "8-hour day", name: "C. Martin" },
      { date: "2026-11-14", facility: "Holzer", type: "8-hour day" },
      "junk",
      null,
    ],
    raw_text: "schedule",
  });
  assertEquals(out.length, 3);
  assertEquals(out[0], {
    date: "2026-11-10",
    facility: "Holzer",
    type: "8-hour day",
    name: "C. Martin",
    pay: "",
  });
  assertEquals(out[1].date, "2026-11-12");
  assertEquals(out[1].name, "Martin, Caleb");
  assertEquals(out[2].name, "");
});

Deno.test("normalizeAiSchedule: non-object input yields no shifts", () => {
  assertEquals(normalizeAiSchedule(null), []);
  assertEquals(normalizeAiSchedule({}), []);
  assertEquals(normalizeAiSchedule({ shifts: "nope" }), []);
});

// ---------- Pay-stub mode (Nov 5, 2026) ----------
import { normalizeAiPaystub } from "./normalize.ts";
import { normalizeAiPortalCheck } from "./normalize.ts";

Deno.test("normalizeAiPaystub: full stub normalises dates, frequency and amounts", () => {
  const out = normalizeAiPaystub({
    employer: " Premier Anesthesia Group ",
    facility: "Holzer",
    frequency: "Biweekly",
    period_start: "10/19/2026",
    period_end: "11/01/2026",
    pay_date: "Nov 6, 2026",
    gross_pay: "$3,200.00",
    net_pay: 2400,
    raw_text: "stub",
  });
  assertEquals(out, {
    employer: "Premier Anesthesia Group",
    facility: "Holzer",
    frequency: "biweekly",
    period_start: "2026-10-19",
    period_end: "2026-11-01",
    pay_date: "2026-11-06",
    gross_pay: 3200,
    net_pay: 2400,
    raw_text: "stub",
  });
});

Deno.test("normalizeAiPaystub: frequency variants coerce; unknown frequency is null, never guessed", () => {
  assertEquals(normalizeAiPaystub({ frequency: "every 2 weeks" }).frequency, "biweekly");
  assertEquals(normalizeAiPaystub({ frequency: "twice a month" }).frequency, "semi-monthly");
  assertEquals(normalizeAiPaystub({ frequency: "semimonthly" }).frequency, "semi-monthly");
  assertEquals(normalizeAiPaystub({ frequency: "weekly" }).frequency, "weekly");
  assertEquals(normalizeAiPaystub({ frequency: "monthly" }).frequency, "monthly");
  assertEquals(normalizeAiPaystub({ frequency: "whenever" }).frequency, null);
  assertEquals(normalizeAiPaystub({ frequency: 14 }).frequency, null);
});

Deno.test("normalizeAiPaystub: amounts and dates that are missing, zero, or junk become null", () => {
  const out = normalizeAiPaystub({
    employer: "  ",
    frequency: "weekly",
    period_start: "not a date",
    period_end: "2026-11-01",
    pay_date: "11/6/2026",
    gross_pay: 0,
    net_pay: "n/a",
  });
  assertEquals(out.employer, null);
  assertEquals(out.period_start, null);
  assertEquals(out.period_end, "2026-11-01");
  assertEquals(out.pay_date, "2026-11-06");
  assertEquals(out.gross_pay, null);
  assertEquals(out.net_pay, null);
});

Deno.test("normalizeAiPaystub: non-object input yields all nulls; agency alias accepted", () => {
  assertEquals(normalizeAiPaystub(null).employer, null);
  assertEquals(normalizeAiPaystub({}).frequency, null);
  assertEquals(normalizeAiPaystub({ agency: "Acme Staffing" }).employer, "Acme Staffing");
});

// ---------- Plain-language rule mode (Nov 6, 2026) ----------
import { normalizeAiRule } from "./normalize.ts";

Deno.test("normalizeAiRule: Caleb's 24hr call example parses to the right fields", () => {
  const out = normalizeAiRule({
    shift_type: "24hr call",
    applies_to: null,
    hourly_rate: 250,
    first_call_hourly_rate: 175,
    segments: [
      { hours: 8, rate: 250, from: null, to: null, label: "first 8 hours" },
      { hours: 16, rate: 175, from: "15:00", to: "07:00", label: "after 3pm until 7am" },
    ],
    summary: "24-hour call: first 8 hours at $250/hr, then $175/hr from 3pm to 7am.",
    clarifying_question: "Does this same pattern apply on weekends too, or is the weekend rate different?",
    missing: ["weekend rate"],
  });
  assertEquals(out.shift_type, "24-hour call");
  assertEquals(out.hourly_rate, 250);
  assertEquals(out.first_call_hourly_rate, 175);
  assertEquals(out.segments.length, 2);
  assertEquals(out.segments[1].from, "15:00");
  assertEquals(out.clarifying_question, "Does this same pattern apply on weekends too, or is the weekend rate different?");
});

Deno.test("normalizeAiRule: junk and zeroes become null, never $0", () => {
  const out = normalizeAiRule({ shift_type: "nonsense", hourly_rate: 0, flat_rate: "abc", segments: "nope", missing: [1, null] });
  assertEquals(out.shift_type, null);
  assertEquals(out.hourly_rate, null);
  assertEquals(out.flat_rate, null);
  assertEquals(out.segments, []);
  assertEquals(normalizeAiRule(null).clarifying_question, null);
});

Deno.test("normalizeAiPortalCheck: NBCRNA page normalises status, period, and MAC progress", () => {
  const out = normalizeAiPortalCheck({
    status: "Certified",
    number: "126402",
    period_start: "May 1, 2023",
    period_end: "2027-04-30",
    class_a: 103,
    class_b: 2,
    mac_ed: 60,
    mac_dev: 40,
    raw_text: "NBCRNA Certification Record",
  });
  assertEquals(out.status, "Certified");
  assertEquals(out.number, "126402");
  assertEquals(out.period_start, "2023-05-01");
  assertEquals(out.period_end, "2027-04-30");
  assertEquals(out.class_a, 103);
  assertEquals(out.mac_ed, 60);
  assertEquals(out.mac_dev, 40);
  assertEquals(out.license_type, null);
});

Deno.test("normalizeAiPortalCheck: license page coerces type and dates; junk is null, never invented", () => {
  const out = normalizeAiPortalCheck({
    status: "Active",
    license_number: "RN86131",
    license_type: "APRN-CRNA",
    issue_date: "07/02/2013",
    expiry: "June 30, 2028",
    state: "West Virginia",
  });
  assertEquals(out.number, "RN86131");
  assertEquals(out.license_type, "APRN");
  assertEquals(out.issue_date, "2013-07-02");
  assertEquals(out.expiry, "2028-06-30");
  const empty = normalizeAiPortalCheck({ status: 42, mac_ed: "abc", period_start: "not a date" });
  assertEquals(empty.status, null);
  assertEquals(empty.mac_ed, null);
  assertEquals(empty.period_start, null);
  assertEquals(normalizeAiPortalCheck(null).status, null);
});
