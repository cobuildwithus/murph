import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { normalizeFlexibleTimestamp, parseDelimitedRows } from "../src/csv-parsing.ts";
import { planWorkoutCsvImport } from "../src/workout-csv-planner.ts";

vi.mock("../src/csv-sample-import-planner.ts", () => {
  throw new Error("CSV parsing and workout planning must load without sample planning.");
});
vi.mock("@murphai/core", () => {
  throw new Error("CSV parsing and workout planning must load without the vault runtime.");
});

test.each([
  ["Unix seconds", "1704067200", "UTC", "2024-01-01T00:00:00.000Z"],
  ["Unix milliseconds", "1704067200000", "UTC", "2024-01-01T00:00:00.000Z"],
  ["numeric epoch", 1704067200000, "UTC", "2024-01-01T00:00:00.000Z"],
  ["Date value", new Date("2024-01-01T00:00:00Z"), "UTC", "2024-01-01T00:00:00.000Z"],
  ["explicit offset", "2024-01-01T01:00:00+01:00", "America/Los_Angeles", "2024-01-01T00:00:00.000Z"],
  ["named month wall time", "00:55:47 Apr 17 2026", "UTC", "2026-04-17T00:55:47.000Z"],
  ["naive fractional wall time", "2024-02-29 07:30:00.12", "America/Los_Angeles", "2024-02-29T15:30:00.120Z"],
  ["explicit GMT text", "Mon, 01 Jan 2024 00:00:00 GMT", "UTC", "2024-01-01T00:00:00.000Z"],
  ["invalid calendar date", "2023-02-29 07:30:00", "UTC", undefined],
  ["invalid clock", "2024-01-01 25:30:00", "UTC", undefined],
  ["invalid Date", new Date(Number.NaN), "UTC", undefined],
  ["unrecognized text", "not a timestamp", "UTC", undefined],
  ["empty value", "", "UTC", undefined],
  ["missing value", null, "UTC", undefined],
] as const)("preserves flexible timestamp handling for %s", (_label, value, timeZone, expected) => {
  assert.equal(normalizeFlexibleTimestamp(value, timeZone), expected);
});

test("parses CSV and plans a workout without loading sample planning or the vault runtime", () => {
  const text = [
    "Workout Name,Date,Start Time,Exercise Name,Set Order,Reps",
    '"Upper, A",2026-03-12,07:00,Press,1,8',
  ].join("\n");

  assert.equal(parseDelimitedRows(text)[1]?.[0], "Upper, A");
  const plan = planWorkoutCsvImport({ text, source: "hevy", timeZone: "UTC" });
  assert.equal(plan.importable, true);
  assert.equal(plan.sessions.length, 1);
  assert.equal(plan.sessions[0]?.occurredAt, "2026-03-12T07:00:00.000Z");
});
