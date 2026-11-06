import { describe, expect, it } from "vitest";
import { getNutritionCardGoalStatus } from "../src/assistant.js";

describe("nutrition card goal status", () => {
  it.each([
    [0, "far_under_target"],
    [59.99, "far_under_target"],
    [60, "under_target"],
    [60.01, "under_target"],
    [89.99, "under_target"],
    [90, "on_target"],
    [90.01, "on_target"],
    [100, "on_target"],
    [109.99, "on_target"],
    [110, "on_target"],
    [110.01, "over_target"],
    [139.99, "over_target"],
    [140, "over_target"],
    [140.01, "far_over_target"],
    [200, "far_over_target"],
  ] as const)("classifies %s percent as %s", (total, status) => {
    expect(getNutritionCardGoalStatus({ total, mealCount: 3 }, 3, 100)).toBe(status);
  });

  it("requires a total and complete metric coverage", () => {
    expect(getNutritionCardGoalStatus({ total: null, mealCount: 0 }, 3, 100)).toBe("unavailable");
    expect(getNutritionCardGoalStatus({ total: 100, mealCount: 2 }, 3, 100)).toBe("unavailable");
  });
});
