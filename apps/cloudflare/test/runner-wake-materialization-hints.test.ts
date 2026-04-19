import { describe, expect, it, vi } from "vitest";

import { RunnerStateStore } from "../src/user-runner/runner-state-store.js";
import { createTestSqlStorage } from "./sql-storage.js";

describe("RunnerStateStore wake materialization hints", () => {
  it("persists hints across Durable Object reloads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T10:00:00.000Z"));
    const state = createState();
    const store = new RunnerStateStore(state as never);

    try {
      await store.bootstrapUser("member_123");

      const scheduled = await store.syncNextWake({
        preferredWakeAt: null,
        wakeMaterializationHints: {
          assistantWakeAt: "2026-04-18T10:05:00.000Z",
          deviceSyncWakeAt: "2026-04-18T10:07:00.000Z",
        },
      });

      expect(scheduled.nextWakeAt).toBe("2026-04-18T10:05:00.000Z");
      expect(await store.readWakeMaterializationHints()).toEqual({
        assistantWakeAt: "2026-04-18T10:05:00.000Z",
        deviceSyncWakeAt: "2026-04-18T10:07:00.000Z",
      });

      const reloaded = new RunnerStateStore(state as never);
      expect(await reloaded.readWakeMaterializationHints()).toEqual({
        assistantWakeAt: "2026-04-18T10:05:00.000Z",
        deviceSyncWakeAt: "2026-04-18T10:07:00.000Z",
      });
      expect((await reloaded.readState()).nextWakeAt).toBe("2026-04-18T10:05:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});

function createState() {
  return {
    storage: {
      sql: createTestSqlStorage(),
    },
  };
}
