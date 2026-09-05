import { describe, expect, it } from "vitest";

import { toReaderFacingGoalPhrase } from "@/src/lib/goals/goal-copy";

describe("goal SEO copy", () => {
  it("turns a first-person goal phrase toward the reader", () => {
    expect(toReaderFacingGoalPhrase("lower my resting heart rate")).toBe(
      "lower your resting heart rate",
    );
  });

  it("leaves a neutral goal phrase unchanged", () => {
    expect(toReaderFacingGoalPhrase("run an Ironman")).toBe("run an Ironman");
  });

  it("turns mixed first-person phrases fully toward the reader", () => {
    expect(toReaderFacingGoalPhrase("keep my brain healthy as I age")).toBe(
      "keep your brain healthy as you age",
    );
    expect(toReaderFacingGoalPhrase("reconnect with people I care about")).toBe(
      "reconnect with people you care about",
    );
  });
});
