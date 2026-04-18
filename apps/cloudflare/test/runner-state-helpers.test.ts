import { describe, expect, it, vi } from "vitest";

import {
  resolveRunnerNextWakeAt,
} from "../src/user-runner/runner-state-helpers.js";

describe("resolveRunnerNextWakeAt", () => {
  it("clamps overdue preferred wakes to an immediate hosted follow-up", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-10T00:00:05.000Z"));

      expect(resolveRunnerNextWakeAt({
        preferredWakeAt: "2026-04-10T00:00:01.000Z",
      })).toBe("2026-04-10T00:00:05.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});
