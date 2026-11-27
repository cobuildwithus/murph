import { expect, it } from "vitest";
import { bedtimePoint, dailyReading, formatReading, workingRow } from "./factors";

it("compares only the selected interval, retains stale evidence and limits a partial baseline", () => {
  const today = "2026-07-30";
  const daily = dailyReading([{ date: "2026-04-01", value: 30 }, { date: "2026-06-02", value: 49 },
    { date: "2026-06-04", value: 58 }, { date: "2026-07-14", value: 53 }, { date: "2026-07-31", value: 33 }], today);
  const current = workingRow("restingHeartRate", "2026-06-03", today, daily, true);
  expect(current).toMatchObject({ startText: "Jun 4 · 58", latestText: "Jul 14 · 53", change: "−5", better: true, stale: true, cheered: true });
  expect(current.series).toHaveLength(2);
  expect(workingRow("steps", "2026-04-01", today, daily, false)).toMatchObject({ partial: true, change: "", startText: "Since Apr 1" });
  expect(workingRow("steps", today, today, daily, false)).toEqual({ factor: "steps", title: "Steps", cheered: false, state: "pending" });
});
it("withholds the entire series without a grant and distinguishes pending publication", () => {
  for (const [state, expected] of [["not_shared", "notShared"], ["pending", "pending"]] as const) {
    expect(workingRow("bedtime", "2026-04-04", "2026-04-13", { state }, false)).toEqual({ factor: "bedtime", title: "Bedtime", cheered: false, state: expected });
  }
});
it("keeps measurements on opposite sides of midnight close on a local sleep night", () => {
  const a = bedtimePoint("2026-04-04", "2026-04-04T06:55:00Z", "America/Los_Angeles");
  const b = bedtimePoint("2026-04-05", "2026-04-05T07:05:00Z", "America/Los_Angeles");
  expect(b.value - a.value).toBe(10);
  expect(formatReading("bedtime", b.value)).toBe("12:05 AM");
});
