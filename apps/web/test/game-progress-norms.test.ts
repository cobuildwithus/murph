import { describe, expect, it } from "vitest";
import golden from "./fixtures/progress-age-rank-golden.json";
import { agePercentile, rankAge, rankBetterShare, type AgeProfile, type NormRow } from "../src/lib/game/progress/norms";
import type { COMPANION_HEALTH_METRICS } from "../src/lib/device-sync/companion-numbers";

type GoldenCase = {
  id: string; metric: keyof typeof COMPANION_HEALTH_METRICS; value: number;
  profile: AgeProfile; source: string | null; expected: ReturnType<typeof rankAge>;
};

describe("the shared iOS AgeRankEngine golden cases", () => {
  it.each(golden as GoldenCase[])("$id", test => {
    expect(rankAge(test.metric, test.value, test.profile, test.source)).toEqual(test.expected);
  });
});

it.each([
  { metric: "steps" as const, value: 15, expected: 37.5 },
  { metric: "restingHeartRate" as const, value: 15, expected: 62.5 },
  { metric: "steps" as const, value: 0, expected: 25 },
  { metric: "steps" as const, value: 99, expected: 75 },
])("interpolates the published percentile for $metric at $value", ({ metric, value, expected }) => {
  expect(agePercentile(metric, { top: null, value, lower: 0, upper: 99, position: 0,
    group: "Synthetic", source: "Synthetic", cuts: [
      { percentile: 25, value: 10 }, { percentile: 50, value: 20 }, { percentile: 75, value: 30 },
    ] })).toBe(expected);
});

describe("the NHANES 2021–2023 lab reference", () => {
  const profile: AgeProfile = { age: 26, sex: "male" };

  it.each([
    ["hdlCholesterol", 54, "mg/dL", "higher"],
    ["triglycerides", 57, "mg/dL", "lower"],
    ["ldlCholesterol", 81, "mg/dL", "lower"],
    ["totalCholesterol", 147, "mg/dL", "lower"],
    ["hsCrp", 0.54, "mg/L", "lower"],
    ["fastingInsulin", 5.09, "uIU/mL", "lower"],
    ["hba1c", 5, "%", "lower"],
  ] as const)("ranks %s against its source in the direction of improvement", (metric, value, unit, betterDirection) => {
    const rank = rankAge(metric, value, profile, null);
    expect(rank).toMatchObject({ top: 25, group: "Men 20 to 29", source: expect.stringContaining("August 2021-August 2023"),
      betterDirection, unit });
    expect(agePercentile(metric, rank!)).toBe(75);
    expect(rankBetterShare(metric, rank!)).toBe(75);
  });

  it("requires a matching age and sex", () => {
    expect(rankAge("hdlCholesterol", 54, { ...profile, age: 19 }, null)).toBeNull();
    expect(rankAge("hdlCholesterol", 54, { ...profile, sex: null }, null)).toBeNull();
    expect(rankAge("hdlCholesterol", 54, { age: 70, sex: "female" }, null)?.group).toBe("Women 70 and over");
  });

  it("requires a single sourced row with usable cutoffs", () => {
    const row: NormRow = { metric: "hdlCholesterol", sex: "male", ageFrom: 20, ageTo: 29,
      betterDirection: "higher", source: "Synthetic cohort", percentiles: { 5: 32, 25: 41, 50: 51, 75: 60, 95: 78 } };
    for (const rows of [[row, row], [{ ...row, source: " " }], [{ ...row, percentiles: { 10: 30, 50: 52 } }]]) {
      expect(rankAge("hdlCholesterol", 61, profile, null, rows)).toBeNull();
    }
  });

  it("uses the matched row's direction and gives a tied value the least favorable share", () => {
    const row: NormRow = { metric: "hdlCholesterol", sex: "male", ageFrom: 20, ageTo: 29,
      source: "Synthetic cohort", percentiles: { 5: 2, 10: 2, 50: 4, 75: 6, 95: 6 } };
    const high = rankAge("hdlCholesterol", 6, profile, null, [{ ...row, betterDirection: "higher" }])!;
    const low = rankAge("hdlCholesterol", 2, profile, null, [{ ...row, betterDirection: "lower" }])!;
    expect(rankBetterShare("hdlCholesterol", high)).toBe(75);
    expect(rankBetterShare("hdlCholesterol", low)).toBe(90);
    expect(rankAge("hdlCholesterol", 6, profile, null, [row])).toBeNull();
  });
});
