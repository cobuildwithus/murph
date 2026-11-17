import { describe, expect, it } from "vitest";
import golden from "./fixtures/progress-age-rank-golden.json";
import { agePercentile, rankAge, type AgeProfile } from "../src/lib/game/progress/norms";
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
