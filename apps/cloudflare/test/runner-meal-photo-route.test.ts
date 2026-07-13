import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionRunnerMealPhotoPath,
  matchHostedExecutionRunnerMealPhotoPath,
} from "../src/runner-meal-photo-route.ts";

describe("hosted runner meal-photo routes", () => {
  it("builds and matches only opaque meal-photo keys", () => {
    const key = "a".repeat(40);
    const path = buildHostedExecutionRunnerMealPhotoPath(key);

    expect(path).toBe(`/meal-photos/${key}`);
    expect(matchHostedExecutionRunnerMealPhotoPath(path)).toBe(key);
    expect(matchHostedExecutionRunnerMealPhotoPath("/meal-photos/not-a-key")).toBeNull();
    expect(() => buildHostedExecutionRunnerMealPhotoPath("not-a-key")).toThrow(
      "Hosted meal photo key is invalid.",
    );
  });
});
