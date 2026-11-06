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
