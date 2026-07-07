import { describe, expect, it } from "vitest";

import {
  activityTextMatchesKind,
  normalizeActivityKindToken,
} from "../src/index.ts";

describe("activity kind matching", () => {
  it("normalizes activity text and matches aliases by token", () => {
    expect(normalizeActivityKindToken(" Morning Run! ")).toBe("morning-run");
    expect(activityTextMatchesKind("Morning run", "running")).toBe(true);
    expect(activityTextMatchesKind("Trail Run", "running")).toBe(true);
    expect(activityTextMatchesKind("Ride", "cycling")).toBe(true);
    expect(activityTextMatchesKind("Virtual Ride", "cycling")).toBe(true);
    expect(activityTextMatchesKind("Gravel Ride", "cycling")).toBe(true);
    expect(activityTextMatchesKind("Horseback Riding", "cycling")).toBe(false);
    expect(activityTextMatchesKind("Weightlifting", "strength")).toBe(true);
    expect(activityTextMatchesKind("Cycling", "running")).toBe(false);
  });
});
