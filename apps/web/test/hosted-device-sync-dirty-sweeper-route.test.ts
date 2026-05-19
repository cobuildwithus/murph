import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVercelCronRequest: vi.fn(),
  runHostedDeviceSyncDirtySweeper: vi.fn(),
  runHostedDeviceSyncDueReconcileSweeper: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/device-sync/dirty-sweeper", () => ({
  runHostedDeviceSyncDirtySweeper: mocks.runHostedDeviceSyncDirtySweeper,
}));

vi.mock("@/src/lib/device-sync/due-reconcile-sweeper", () => ({
  runHostedDeviceSyncDueReconcileSweeper: mocks.runHostedDeviceSyncDueReconcileSweeper,
}));

type HostedDeviceSyncDirtySweeperCronRoute =
  typeof import("../app/api/internal/device-sync/dirty-sweeper/cron/route");

let route: HostedDeviceSyncDirtySweeperCronRoute;

describe("hosted device-sync dirty sweeper cron route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/device-sync/dirty-sweeper/cron/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.runHostedDeviceSyncDirtySweeper.mockResolvedValue({
      dirtyConnections: 1,
      skippedDirtyConnections: 0,
      staleAfterMs: 30000,
      wakeAppended: 1,
      wakeAttempted: 1,
      wakeLimit: 25,
      wakeNotAppended: 0,
    });
    mocks.runHostedDeviceSyncDueReconcileSweeper.mockResolvedValue({
      dueConnections: 1,
      skippedDueConnections: 0,
      wakeAppended: 1,
      wakeAttempted: 1,
      wakeDuplicate: 0,
      wakeFailed: 0,
      wakeLimit: 25,
      wakeNotAppended: 0,
    });
  });

  it("requires Vercel cron auth and returns the sweep summary", async () => {
    const response = await route.GET(
      new Request("https://join.example.test/api/internal/device-sync/dirty-sweeper/cron"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.runHostedDeviceSyncDirtySweeper).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedDeviceSyncDueReconcileSweeper).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      dueReconcileSweeper: {
        dueConnections: 1,
        skippedDueConnections: 0,
        wakeAppended: 1,
        wakeAttempted: 1,
        wakeDuplicate: 0,
        wakeFailed: 0,
        wakeLimit: 25,
        wakeNotAppended: 0,
      },
      sweeper: {
        dirtyConnections: 1,
        skippedDirtyConnections: 0,
        staleAfterMs: 30000,
        wakeAppended: 1,
        wakeAttempted: 1,
        wakeLimit: 25,
        wakeNotAppended: 0,
      },
    });
  });

  it("still attempts due-reconcile recovery when dirty recovery fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.runHostedDeviceSyncDirtySweeper.mockRejectedValue(new Error("dirty failed"));

    try {
      const response = await route.GET(
        new Request("https://join.example.test/api/internal/device-sync/dirty-sweeper/cron"),
      );

      expect(response.status).toBe(500);
      expect(mocks.runHostedDeviceSyncDirtySweeper).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncDueReconcileSweeper).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Hosted device-sync sweeper cron failed.",
        expect.objectContaining({
          dirtySweeperErrorName: "Error",
          dirtySweeperFailed: true,
          dueReconcileWakeAppendFailed: false,
          dueReconcileWakeNotAppended: 0,
          dueReconcileSweeperErrorName: null,
          dueReconcileSweeperFailed: false,
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("still attempts dirty recovery when due-reconcile recovery fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.runHostedDeviceSyncDueReconcileSweeper.mockRejectedValue(new Error("due failed"));

    try {
      const response = await route.GET(
        new Request("https://join.example.test/api/internal/device-sync/dirty-sweeper/cron"),
      );

      expect(response.status).toBe(500);
      expect(mocks.runHostedDeviceSyncDirtySweeper).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncDueReconcileSweeper).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Hosted device-sync sweeper cron failed.",
        expect.objectContaining({
          dirtySweeperErrorName: null,
          dirtySweeperFailed: false,
          dueReconcileWakeAppendFailed: false,
          dueReconcileWakeNotAppended: null,
          dueReconcileSweeperErrorName: "Error",
          dueReconcileSweeperFailed: true,
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("fails the cron when due-reconcile wake appends report failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.runHostedDeviceSyncDueReconcileSweeper.mockResolvedValue({
      dueConnections: 2,
      skippedDueConnections: 0,
      wakeAppended: 1,
      wakeAttempted: 2,
      wakeDuplicate: 0,
      wakeFailed: 1,
      wakeLimit: 25,
      wakeNotAppended: 1,
    });

    try {
      const response = await route.GET(
        new Request("https://join.example.test/api/internal/device-sync/dirty-sweeper/cron"),
      );

      expect(response.status).toBe(500);
      expect(mocks.runHostedDeviceSyncDirtySweeper).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncDueReconcileSweeper).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Hosted device-sync sweeper cron failed.",
        expect.objectContaining({
          dirtySweeperFailed: false,
          dueReconcileWakeAppendFailed: true,
          dueReconcileWakeNotAppended: 1,
          dueReconcileSweeperFailed: false,
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("logs both failure flags when both sweepers reject", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.runHostedDeviceSyncDirtySweeper.mockRejectedValue(new Error("dirty failed"));
    mocks.runHostedDeviceSyncDueReconcileSweeper.mockRejectedValue(new Error("due failed"));

    try {
      const response = await route.GET(
        new Request("https://join.example.test/api/internal/device-sync/dirty-sweeper/cron"),
      );

      expect(response.status).toBe(500);
      expect(mocks.runHostedDeviceSyncDirtySweeper).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncDueReconcileSweeper).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Hosted device-sync sweeper cron failed.",
        expect.objectContaining({
          dirtySweeperErrorName: "Error",
          dirtySweeperFailed: true,
          dueReconcileWakeAppendFailed: false,
          dueReconcileWakeNotAppended: null,
          dueReconcileSweeperErrorName: "Error",
          dueReconcileSweeperFailed: true,
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
