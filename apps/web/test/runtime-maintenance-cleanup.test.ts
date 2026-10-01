import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteExpiredHostedRuntimeLogs: vi.fn(),
  isHostedRuntimeLogDatabaseConfigured: vi.fn(),
  runHostedRuntimeSignalRetentionCleanup: vi.fn(),
}));

vi.mock("@/src/lib/hosted-runtime-log/database", () => ({
  isHostedRuntimeLogDatabaseConfigured:
    mocks.isHostedRuntimeLogDatabaseConfigured,
}));

vi.mock("@/src/lib/hosted-runtime-log/store", () => ({
  deleteExpiredHostedRuntimeLogs: mocks.deleteExpiredHostedRuntimeLogs,
}));

vi.mock("@/src/lib/hosted-retention/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-retention/cleanup")>()),
  runHostedRuntimeSignalRetentionCleanup:
    mocks.runHostedRuntimeSignalRetentionCleanup,
}));

import { runHostedRuntimeMaintenanceCleanup } from "@/src/lib/hosted-retention/runtime-maintenance-cleanup";

describe("hosted runtime maintenance retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(true);
    mocks.deleteExpiredHostedRuntimeLogs.mockResolvedValue(5);
    mocks.runHostedRuntimeSignalRetentionCleanup.mockResolvedValue({
      inboxMediaRetentionRuntimeSignalFailures: 1,
      inboxMediaRetentionRuntimeSignalsSent: 3,
    });
  });

  it("signals runtimes before cleaning the isolated log database", async () => {
    const events: string[] = [];
    const prisma = {};
    const now = new Date("2026-07-29T00:00:00.000Z");
    const signalRuntimeRecheck = vi.fn();
    mocks.deleteExpiredHostedRuntimeLogs.mockImplementationOnce(async () => {
      events.push("logs");
      return 5;
    });
    mocks.runHostedRuntimeSignalRetentionCleanup
      .mockImplementationOnce(async () => {
        events.push("signals");
        return {
          inboxMediaRetentionRuntimeSignalFailures: 1,
          inboxMediaRetentionRuntimeSignalsSent: 3,
        };
      });

    await expect(runHostedRuntimeMaintenanceCleanup({
      now,
      prisma: prisma as never,
      signalRuntimeRecheck,
    })).resolves.toEqual({
      inboxMediaRetentionRuntimeSignalFailures: 1,
      inboxMediaRetentionRuntimeSignalsSent: 3,
      oldRuntimeLogsDeleted: 5,
    });

    expect(events).toEqual(["signals", "logs"]);
    expect(mocks.deleteExpiredHostedRuntimeLogs).toHaveBeenCalledWith({
      batchSize: 5_000,
      maxBatches: 4,
      retentionCutoff: new Date("2026-07-15T00:00:00.000Z"),
      verboseCutoff: new Date("2026-07-22T00:00:00.000Z"),
    });
    expect(mocks.runHostedRuntimeSignalRetentionCleanup).toHaveBeenCalledWith({
      now,
      prisma,
      signalRuntimeRecheck,
    });
  });

  it("still signals runtimes when optional log retention fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.deleteExpiredHostedRuntimeLogs.mockRejectedValueOnce(
      new Error("isolated database unavailable"),
    );

    await expect(runHostedRuntimeMaintenanceCleanup()).resolves.toMatchObject({
      inboxMediaRetentionRuntimeSignalsSent: 3,
      oldRuntimeLogsDeleted: 0,
    });
    expect(mocks.runHostedRuntimeSignalRetentionCleanup).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted runtime log database retention failed.",
      expect.objectContaining({ errorCode: expect.any(String) }),
    );
    consoleWarn.mockRestore();
  });

  it("skips only log retention when the dedicated database is absent", async () => {
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValueOnce(false);

    await expect(runHostedRuntimeMaintenanceCleanup()).resolves.toMatchObject({
      inboxMediaRetentionRuntimeSignalsSent: 3,
      oldRuntimeLogsDeleted: 0,
    });
    expect(mocks.deleteExpiredHostedRuntimeLogs).not.toHaveBeenCalled();
    expect(mocks.runHostedRuntimeSignalRetentionCleanup).toHaveBeenCalledTimes(1);
  });
});
