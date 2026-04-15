import { afterEach, describe, expect, it, vi } from "vitest";

import {
  nextConsumedEventExactExpiryIso,
  resolveRunnerNextWakeAt,
} from "../src/user-runner/runner-queue-state.js";
import { CONSUMED_EVENT_EXACT_TTL_MS } from "../src/user-runner/types.js";

describe("consumed event replay retention", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps exact consumed-event tombstones for 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T00:00:00.000Z"));

    expect(CONSUMED_EVENT_EXACT_TTL_MS).toBe(24 * 60 * 60_000);
    expect(nextConsumedEventExactExpiryIso()).toBe("2026-04-07T00:00:00.000Z");
  });
});

describe("resolveRunnerNextWakeAt", () => {
  it("clamps overdue preferred wakes to an immediate hosted follow-up", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-10T00:00:05.000Z"));

      expect(resolveRunnerNextWakeAt({
        nextPendingAvailableAt: null,
        preferredWakeAt: "2026-04-10T00:00:01.000Z",
      })).toBe("2026-04-10T00:00:05.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});
