import { expect, it } from "vitest";
import { lastSettledStepDay } from "@/src/lib/settled-step-day";

it.each([
  ["2026-11-05T07:00:00-05:00", "America/New_York", "2026-11-03"],
  ["2026-11-05T07:59:59-05:00", "America/New_York", "2026-11-03"],
  ["2026-11-05T08:00:00-05:00", "America/New_York", "2026-11-04"],
  ["2026-11-05T09:00:00-05:00", "America/New_York", "2026-11-04"],
  ["2026-01-01T07:59:59+14:00", "Pacific/Kiritimati", "2025-12-30"],
  ["2026-01-01T08:00:00+14:00", "Pacific/Kiritimati", "2025-12-31"],
  // Eight elapsed hours after midnight crosses the spring and fall clock changes.
  ["2026-03-08T08:59:59-04:00", "America/New_York", "2026-03-06"],
  ["2026-03-08T09:00:00-04:00", "America/New_York", "2026-03-07"],
  ["2026-11-01T06:59:59-05:00", "America/New_York", "2026-10-30"],
  ["2026-11-01T07:00:00-05:00", "America/New_York", "2026-10-31"],
])("settles step days at %s in %s", (instant, timeZone, expected) => {
  expect(lastSettledStepDay(new Date(instant), timeZone)).toBe(expected);
});
