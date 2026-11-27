import { describe, expect, it } from "vitest";
import type { CombineStation } from "@murphai/contracts";
import { combineResult, stationPercentile } from "./combine";
import { foodWeekQuestions } from "./food-week";

describe("Combine published reference anchors", () => {
  it.each<[CombineStation, number, number, "male" | "female", number]>([
    ["grip_strength", 30.2, 26, "female", 50], ["pushups_max", 24, 24, "male", 50],
    ["pushups_knees", 10, 45, "female", 35], ["chair_stand_30s", 17, 48, "female", 50],
    ["chair_stand_30s", 16, 81, "male", 50], ["march_2min", 75, 83, "female", 50],
    ["step_3min", 102, 23, "male", 50], ["broad_jump", 164.3, 19, "female", 50],
  ])("matches %s at the reference value", (key, value, age, sex, expected) => {
    expect(stationPercentile(key, value, age, sex)).toBeCloseTo(expected, 3);
  });
  it("keeps unranked measurements, leaves out skipped tests and offers a six-week retest", () => {
    const preview = combineResult("session", { instrument: "combine", instrumentVersion: 1, date: "2028-02-17",
      tests: [{ key: "pushups_max", variant: "wall", value: 8 }, { key: "step_3min", skipped: true },
        { key: "pullups_max", value: 2 }] });
    expect(preview.retestOn).toBe("2028-03-30");
    expect(preview.recorded.map(row => row.key)).toEqual(["pushups_wall", "pullups_max"]);
    expect(preview.rank).toBeUndefined();
    expect(preview.years).toBeUndefined();
    expect(stationPercentile("pushups_knees", 30, 30, "male")).toBeUndefined();
    expect(stationPercentile("broad_jump", 100, 65, "female")).toBeUndefined();
  });
  it("serves each research question once", () => {
    expect(foodWeekQuestions).toHaveLength(14);
    expect(new Set(foodWeekQuestions.map(row => row.key)).size).toBe(14);
    expect(foodWeekQuestions.at(-1)?.text).toBe("Standard drinks this week? Most in one sitting?");
  });
});
