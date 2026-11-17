import { describe, expect, it } from "vitest";
import { addDaysToIsoDate } from "@murphai/contracts";
import { healthAgeShare, healthBaseline, healthMeans, healthSteps, healthSums, heldHealthLevels, progressHealthDays,
  type HealthAchievementContext } from "../src/lib/game/progress/health";

const joinedOn = "2026-10-21";
const days = (from: string, count: number, value: number) => Array.from({ length: count }, (_, i) => ({ date: addDaysToIsoDate(from, i), value }));
const context = (baseline: number, current: number): HealthAchievementContext => ({
  metric: "restingHeartRate", joinedOn, baseline, step: 1, direction: -1,
  profile: { age: 35, sex: "female" },
  means: days(joinedOn, 14, current).map(point => ({ ...point, source: "Apple Watch", observedAt: `${point.date}T12:00:00Z` })),
});

it.each([{ baseline: 70.51, current: 69.53, levels: [] }, { baseline: 74, current: 71, levels: [1, 2, 3] }])(
  "scores raw improvement $baseline to $current", ({ baseline, current, levels }) => {
    const awards = healthSteps(context(baseline, current));
    expect(awards.map(award => award.data.level)).toEqual(levels);
    expect(awards.every(award => award.on === "2026-10-27")).toBe(true);
  });

it("does not award an age line that the baseline already beat", () => {
  const crossed = healthAgeShare(context(100, 20));
  expect(crossed.map(award => award.data.percentile)).toEqual([25, 100 / 3, 50]);
  expect(crossed.map(award => [award.data.title, award.data.detail])).toEqual([
    ["Beat 1 in 4", "women your age"], ["Beat 1 in 3", "women your age"], ["Beat half", "women your age"],
  ]);
  expect(crossed.every(award => award.on === "2026-10-27")).toBe(true);
  expect(healthAgeShare(context(20, 19))).toEqual([]);
});

it("has no Sleep age wins and requires original-device evidence for HR", () => {
  expect(healthAgeShare({ ...context(100, 20), metric: "sleep" })).toEqual([]);
  expect(healthAgeShare({ ...context(100, 20), means: context(100, 20).means.map(point => ({ ...point, source: "Apple Health" })) })).toEqual([]);
});

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
    const result = healthMeans(days(joinedOn, count, 69.53));
    if (mean === null) expect(result).toEqual([]);
    else expect(result[0].value).toBeCloseTo(mean, 10);
  });

  it.each([{ missing: [1, 3], awards: 1 }, { missing: [1, 3, 4], awards: 0 }])(
    "holds only with five observed endpoints: $missing", ({ missing, awards }) => {
      expect(heldHealthLevels(days(joinedOn, 7, 1).filter((_, i) => !missing.includes(i)), joinedOn))
        .toHaveLength(awards);
    });

  it("dates the level on the day the full week is held and preserves a multi-level leap", () => {
    const held = heldHealthLevels(days(joinedOn, 7, 3), joinedOn);
    expect(held).toEqual([{ date: "2026-10-27", value: 3 }]);
  });

  it("does not treat a single low endpoint or an incomplete week as held", () => {
    expect(heldHealthLevels(days(joinedOn, 6, 3), joinedOn)).toEqual([]);
    expect(heldHealthLevels([...days(joinedOn, 6, 3), ...days("2026-10-27", 1, 0)], joinedOn))
      .toEqual([{ date: "2026-10-27", value: 0 }]);
  });

  it("does not round 70.51 to 69.53 into a whole bpm improvement", () => {
    const baseline = healthBaseline(days(addDaysToIsoDate(joinedOn, -28), 28, 70.51), joinedOn)!;
    const levels = healthMeans(days(joinedOn, 30, 69.53))
      .map(point => ({ ...point, value: Math.floor(baseline - point.value) }));
    expect(heldHealthLevels(levels, joinedOn).every(point => point.value === 0)).toBe(true);
  });
});

