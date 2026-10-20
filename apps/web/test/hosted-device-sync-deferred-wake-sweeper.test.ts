import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("The deferred wake sweeper test must inject its store.");
  }),
}));

import { runHostedDeviceSyncDeferredWakeSweeper } from "@/src/lib/device-sync/deferred-wake-sweeper";

const now = new Date("2026-03-26T12:15:00.000Z");

function dueRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    connectionId: `dsc_${index}`,
    userId: `user-${index}`,
  }));
}

describe("hosted device-sync deferred wake sweeper", () => {
  it("releases or clears each due batch and reports bounded aggregates", async () => {
    const listDueDeferredDirtyConnectionWakes = vi.fn(async () => dueRows(3));
    const release = vi.fn(async (input: { connectionId: string }) => (
      input.connectionId === "dsc_1"
        ? { outcome: "cleared" as const, reason: "superseded" as const }
        : { outcome: "released" as const, wakeInserted: true }
    ));
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(runHostedDeviceSyncDeferredWakeSweeper({
      logger,
      now,
      release,
      releaseLimit: 5,
      store: { listDueDeferredDirtyConnectionWakes, postponeDeferredDirtyConnectionWake: vi.fn(async () => {}) },
    })).resolves.toEqual({
      dueConnections: 3,
      hasMoreDueConnections: false,
      releaseCleared: 1,
      releaseFailed: 0,
      releaseLimit: 5,
      released: 2,
    });

    expect(listDueDeferredDirtyConnectionWakes).toHaveBeenCalledWith({ dueAt: now, limit: 6 });
    expect(release).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledWith({ connectionId: "dsc_0", now, userId: "user-0" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("stops at the release limit and reports remaining due batches", async () => {
    const release = vi.fn(async () => ({ outcome: "released" as const, wakeInserted: true }));

    await expect(runHostedDeviceSyncDeferredWakeSweeper({
      logger: { info: vi.fn(), warn: vi.fn() },
      now,
      release,
      releaseLimit: 2,
      store: {
        listDueDeferredDirtyConnectionWakes: async () => dueRows(3),
        postponeDeferredDirtyConnectionWake: vi.fn(async () => {}),
      },
    })).resolves.toMatchObject({
      dueConnections: 2,
      hasMoreDueConnections: true,
      released: 2,
    });
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("keeps releasing the rest of the batch when one release fails", async () => {
    const release = vi.fn(async (input: { connectionId: string }) => {
      if (input.connectionId === "dsc_0") throw new Error("synthetic release failure");
      return { outcome: "released" as const, wakeInserted: true };
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const postponeDeferredDirtyConnectionWake = vi.fn(async () => {});

    await expect(runHostedDeviceSyncDeferredWakeSweeper({
      logger,
      now,
      release,
      store: {
        listDueDeferredDirtyConnectionWakes: async () => dueRows(2),
        postponeDeferredDirtyConnectionWake,
      },
    })).resolves.toMatchObject({ releaseFailed: 1, released: 1 });
    expect(postponeDeferredDirtyConnectionWake).toHaveBeenCalledOnce();
    expect(postponeDeferredDirtyConnectionWake).toHaveBeenCalledWith({
      connectionId: "dsc_0",
      dueAt: now,
      retryAt: new Date("2026-03-26T12:20:00.000Z"),
      userId: "user-0",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync deferred wake release failed.",
      expect.objectContaining({ errorCode: "HOSTED_DEVICE_SYNC_DEFERRED_WAKE_RELEASE_FAILED" }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("user-0");
  });
});
