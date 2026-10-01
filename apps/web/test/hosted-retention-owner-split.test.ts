import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupExpiredRuns: vi.fn(),
  runHostedRuntimeResourceCleanup: vi.fn(),
  deleteExpiredHostedBrowserAssertionNonces: vi.fn(),
  deleteExpiredHostedCallbackRequestNonces: vi.fn(),
  drainHostedAccountDeletionCleanupBatch: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/runtime-resource-cleanup", () => ({ runHostedRuntimeResourceCleanup: mocks.runHostedRuntimeResourceCleanup }));

vi.mock("@/src/lib/computer-use/service", () => ({
  ComputerUseService: class {
    cleanupExpiredRuns(input: { now: Date }) {
      return mocks.cleanupExpiredRuns(input);
    }
  },
}));

vi.mock("@/src/lib/computer-use/store", () => ({
  PrismaComputerUseStore: class {},
}));

vi.mock("@/src/lib/hosted-privacy/account-deletion-cleanup", () => ({
  drainHostedAccountDeletionCleanupBatch:
    mocks.drainHostedAccountDeletionCleanupBatch,
}));

vi.mock("@/src/lib/hosted-retention/browser-assertion-nonces", () => ({
  deleteExpiredHostedBrowserAssertionNonces:
    mocks.deleteExpiredHostedBrowserAssertionNonces,
}));

vi.mock("@/src/lib/hosted-retention/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-retention/cleanup")>()),
  deleteExpiredHostedCallbackRequestNonces:
    mocks.deleteExpiredHostedCallbackRequestNonces,
}));

import { runHostedExternalRetentionCleanup } from "@/src/lib/hosted-retention/external-cleanup";
import { runHostedNonceRetentionCleanup } from "@/src/lib/hosted-retention/nonce-cleanup";

describe("hosted retention owner split", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runHostedRuntimeResourceCleanup.mockResolvedValue({ configured: true, deleted: 2, failed: 0 });
    mocks.cleanupExpiredRuns.mockResolvedValue({ expiredRuns: 4 });
    mocks.deleteExpiredHostedBrowserAssertionNonces.mockResolvedValue(3);
    mocks.deleteExpiredHostedCallbackRequestNonces.mockResolvedValue(8);
    mocks.drainHostedAccountDeletionCleanupBatch.mockResolvedValue({
      completed: 1,
      failed: 0,
      pending: 2,
      selected: 3,
    });
  });

  it("keeps high-volume and browser nonces in one database-only owner", async () => {
    const events: string[] = [];
    const prisma = {};
    const now = new Date("2026-08-30T12:00:00.000Z");
    mocks.deleteExpiredHostedCallbackRequestNonces
      .mockImplementationOnce(async () => {
        events.push("callback");
        return 8;
      });
    mocks.deleteExpiredHostedBrowserAssertionNonces
      .mockImplementationOnce(async () => {
        events.push("browser");
        return 3;
      });

    await expect(runHostedNonceRetentionCleanup({
      now,
      prisma: prisma as never,
    })).resolves.toEqual({
      expiredBrowserAssertionNoncesDeleted: 3,
      expiredCallbackRequestNoncesDeleted: 8,
    });

    expect(events).toEqual(["browser", "callback"]);
    expect(mocks.deleteExpiredHostedCallbackRequestNonces).toHaveBeenCalledWith({
      prisma,
    });
    expect(mocks.deleteExpiredHostedBrowserAssertionNonces).toHaveBeenCalledWith({
      now,
      prisma,
    });
  });

  it("runs each external cleanup owner once and sequentially outside transactions", async () => {
    const prisma = { $transaction: vi.fn() };
    const now = new Date("2026-08-30T12:00:00.000Z");
    mocks.drainHostedAccountDeletionCleanupBatch.mockImplementationOnce(async () => {
      await Promise.resolve();
      expect(mocks.cleanupExpiredRuns).not.toHaveBeenCalled();
      expect(mocks.runHostedRuntimeResourceCleanup).not.toHaveBeenCalled();
      return { completed: 1, failed: 0, pending: 2, selected: 3 };
    });
    mocks.cleanupExpiredRuns.mockImplementationOnce(async () => {
      await Promise.resolve();
      expect(mocks.runHostedRuntimeResourceCleanup).not.toHaveBeenCalled();
      return { expiredRuns: 4 };
    });

    await expect(runHostedExternalRetentionCleanup({
      now,
      prisma: prisma as never,
    })).resolves.toEqual({
      accountDeletionCleanup: {
        completed: 1,
        failed: 0,
        pending: 2,
        selected: 3,
      },
      expiredComputerRunsCleanedUp: 4,
      runtimeResourceCleanup: { configured: true, deleted: 2, failed: 0 },
    });

    expect(mocks.drainHostedAccountDeletionCleanupBatch).toHaveBeenCalledWith({
      now,
      prisma,
    });
    expect(mocks.cleanupExpiredRuns).toHaveBeenCalledWith({ now });
    expect(mocks.runHostedRuntimeResourceCleanup).toHaveBeenCalledWith({ now, prisma });
    expect(mocks.drainHostedAccountDeletionCleanupBatch).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupExpiredRuns).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedRuntimeResourceCleanup).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.deleteExpiredHostedCallbackRequestNonces).not.toHaveBeenCalled();
    expect(mocks.deleteExpiredHostedBrowserAssertionNonces).not.toHaveBeenCalled();
  });
});
