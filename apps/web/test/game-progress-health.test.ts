import { describe, expect, it } from "vitest";
import { addDaysToIsoDate } from "@murphai/contracts";
import { healthBaseline, healthMean14, healthSums, progressHealthDays } from "../src/lib/game/progress/health";

const joinedOn = "2026-10-21";
const days = (from: string, count: number, value: number) => Array.from({ length: count }, (_, i) => ({ date: addDaysToIsoDate(from, i), value }));
it("converts canonical sleep minutes once, then sums retained dates since joining", () => {
  const raw = ["2026-10-20", "2026-10-21", "2026-10-23", "2026-10-25"].map(date => ({
    date, value: 420.5, source: "Garmin", observedAt: `${date}T12:00:00Z`,
  }));
  const seconds = progressHealthDays("sleep", raw);
  expect(seconds[0].value).toBe(25230);
  expect(healthSums("sleep", seconds, joinedOn, "2026-10-24")).toEqual([
    { measureId: "sleep", date: "2026-10-21", amount: 25230 },
    { measureId: "sleep", date: "2026-10-23", amount: 25230 },
  ]);
  expect(progressHealthDays("steps", raw).map(point => point.value)).toEqual([420.5, 420.5, 420.5, 420.5]);
});

it("keeps health sums inside the 365-day replica even for an older join", () => {
  expect(healthSums("steps", [
    { date: "2025-11-15", value: 99999 }, { date: "2025-11-16", value: 1000 }, { date: "2026-11-15", value: 2000 },
  ], "2025-01-01", "2026-11-15")).toEqual([
    { measureId: "steps", date: "2025-11-16", amount: 1000 }, { measureId: "steps", date: "2026-11-15", amount: 2000 },
  ]);
});

describe("D4/D5 observed-date coverage", () => {
  it.each([{ count: 19, expected: null }, { count: 20, expected: 70.51 }, { count: 28, expected: 70.51 }])(
    "requires twenty of twenty-eight baseline dates: $count", ({ count, expected }) => {
      const baseline = healthBaseline([
        ...days(addDaysToIsoDate(joinedOn, -29), 1, 999),
        ...days(addDaysToIsoDate(joinedOn, -28), count, 70.51),
        ...days(joinedOn, 3, 999),
      ], joinedOn);
      if (expected === null) expect(baseline).toBeNull();
      else expect(baseline).toBeCloseTo(expected, 10);
    });

  it.each([{ count: 9, mean: null }, { count: 10, mean: 69.53 }])("requires ten of fourteen mean dates: $count", ({ count, mean }) => {
    const series = days(joinedOn, count, 69.53);
    expect(healthMean14(series, series.at(-1)!.date)).toEqual(mean);
  });
});
