import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupExpiredRuns: vi.fn(),
  deleteExpiredHostedBrowserAssertionNonces: vi.fn(),
  deleteExpiredHostedCallbackRequestNonces: vi.fn(),
  drainHostedAccountDeletionCleanupBatch: vi.fn(),
}));

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

    expect(events).toEqual(["callback", "browser"]);
    expect(mocks.deleteExpiredHostedCallbackRequestNonces).toHaveBeenCalledWith({
      prisma,
    });
    expect(mocks.deleteExpiredHostedBrowserAssertionNonces).toHaveBeenCalledWith({
      now,
      prisma,
    });
  });

  it("keeps external provider cleanup out of every database-only owner", async () => {
    const prisma = {};
    const now = new Date("2026-08-30T12:00:00.000Z");

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
    });

    expect(mocks.drainHostedAccountDeletionCleanupBatch).toHaveBeenCalledWith({
      now,
      prisma,
    });
    expect(mocks.cleanupExpiredRuns).toHaveBeenCalledWith({ now });
    expect(mocks.deleteExpiredHostedCallbackRequestNonces).not.toHaveBeenCalled();
    expect(mocks.deleteExpiredHostedBrowserAssertionNonces).not.toHaveBeenCalled();
  });
});
