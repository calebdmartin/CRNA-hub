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
