import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteExpiredHostedRuntimeLogs: vi.fn(),
  isHostedRuntimeLogDatabaseConfigured: vi.fn(),
  runHostedRetentionCleanup: vi.fn(),
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
  runHostedRetentionCleanup: mocks.runHostedRetentionCleanup,
}));

import {
  runHostedRetentionCleanupWithRuntimeLogDatabase,
} from "@/src/lib/hosted-retention/runtime-log-database-cleanup";

describe("hosted runtime log database retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(true);
    mocks.runHostedRetentionCleanup.mockResolvedValue({
      oldRuntimeLogsDeleted: 0,
    });
    mocks.deleteExpiredHostedRuntimeLogs.mockResolvedValue(5);
  });

  it("reports the dedicated retention count", async () => {
    const events: string[] = [];
    mocks.runHostedRetentionCleanup.mockImplementationOnce(async () => {
      events.push("base");
      return { oldRuntimeLogsDeleted: 0 };
    });
    mocks.deleteExpiredHostedRuntimeLogs.mockImplementationOnce(async () => {
      events.push("isolated");
      return 5;
    });

    await expect(runHostedRetentionCleanupWithRuntimeLogDatabase({
      now: new Date("2026-07-29T00:00:00.000Z"),
    })).resolves.toMatchObject({
      oldRuntimeLogsDeleted: 5,
    });

    expect(events).toEqual(["base", "isolated"]);
    expect(mocks.deleteExpiredHostedRuntimeLogs).toHaveBeenCalledWith({
      batchSize: 5_000,
      maxBatches: 4,
      retentionCutoff: new Date("2026-07-15T00:00:00.000Z"),
      verboseCutoff: new Date("2026-07-22T00:00:00.000Z"),
    });
  });

  it("preserves completed base cleanup when dedicated retention fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.deleteExpiredHostedRuntimeLogs.mockRejectedValueOnce(
      new Error("isolated database unavailable"),
    );

    await expect(runHostedRetentionCleanupWithRuntimeLogDatabase()).resolves.toMatchObject({
      oldRuntimeLogsDeleted: 0,
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted runtime log database retention failed.",
      expect.objectContaining({
        errorCode: expect.any(String),
      }),
    );
    consoleWarn.mockRestore();
  });

  it("skips isolated retention when the database is not configured", async () => {
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValueOnce(false);

    await expect(runHostedRetentionCleanupWithRuntimeLogDatabase()).resolves.toMatchObject({
      oldRuntimeLogsDeleted: 0,
    });
    expect(mocks.deleteExpiredHostedRuntimeLogs).not.toHaveBeenCalled();
  });
});
