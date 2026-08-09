import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteExpiredHostedBrowserAssertionNonces: vi.fn(),
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

vi.mock("@/src/lib/hosted-retention/browser-assertion-nonces", () => ({
  deleteExpiredHostedBrowserAssertionNonces:
    mocks.deleteExpiredHostedBrowserAssertionNonces,
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
    mocks.deleteExpiredHostedBrowserAssertionNonces.mockResolvedValue(7);
    mocks.deleteExpiredHostedRuntimeLogs.mockResolvedValue(5);
  });

  it("runs primary retention before the isolated runtime-log cleanup", async () => {
    const events: string[] = [];
    const prisma = {};
    const now = new Date("2026-07-29T00:00:00.000Z");
    mocks.runHostedRetentionCleanup.mockImplementationOnce(async () => {
      events.push("base");
      return { oldRuntimeLogsDeleted: 0 };
    });
    mocks.deleteExpiredHostedBrowserAssertionNonces
      .mockImplementationOnce(async () => {
        events.push("browser");
        return 7;
      });
    mocks.deleteExpiredHostedRuntimeLogs.mockImplementationOnce(async () => {
      events.push("isolated");
      return 5;
    });

    await expect(runHostedRetentionCleanupWithRuntimeLogDatabase({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      expiredBrowserAssertionNoncesDeleted: 7,
      oldRuntimeLogsDeleted: 5,
    });

    expect(events).toEqual(["base", "browser", "isolated"]);
    expect(mocks.deleteExpiredHostedBrowserAssertionNonces).toHaveBeenCalledWith({
      now,
      prisma,
    });
    expect(mocks.deleteExpiredHostedRuntimeLogs).toHaveBeenCalledWith({
      batchSize: 5_000,
      maxBatches: 4,
      retentionCutoff: new Date("2026-07-15T00:00:00.000Z"),
      verboseCutoff: new Date("2026-07-22T00:00:00.000Z"),
    });
  });

  it("preserves completed primary cleanup when dedicated retention fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.deleteExpiredHostedRuntimeLogs.mockRejectedValueOnce(
      new Error("isolated database unavailable"),
    );

    await expect(runHostedRetentionCleanupWithRuntimeLogDatabase()).resolves.toMatchObject({
      expiredBrowserAssertionNoncesDeleted: 7,
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

  it("runs browser nonce cleanup when the runtime-log database is absent", async () => {
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValueOnce(false);

    await expect(runHostedRetentionCleanupWithRuntimeLogDatabase()).resolves.toMatchObject({
      expiredBrowserAssertionNoncesDeleted: 7,
      oldRuntimeLogsDeleted: 0,
    });
    expect(mocks.deleteExpiredHostedBrowserAssertionNonces).toHaveBeenCalledTimes(1);
    expect(mocks.deleteExpiredHostedRuntimeLogs).not.toHaveBeenCalled();
  });

  it("fails the hourly owner when primary browser nonce cleanup fails", async () => {
    const failure = new Error("primary database unavailable");
    mocks.deleteExpiredHostedBrowserAssertionNonces.mockRejectedValueOnce(failure);

    await expect(
      runHostedRetentionCleanupWithRuntimeLogDatabase(),
    ).rejects.toBe(failure);
    expect(mocks.deleteExpiredHostedRuntimeLogs).not.toHaveBeenCalled();
  });
});
