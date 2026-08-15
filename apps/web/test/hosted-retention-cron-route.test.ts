import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteExpiredHostedBrowserAssertionNonces: vi.fn(),
  isHostedRuntimeLogDatabaseConfigured: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  runHostedRetentionCleanup: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-runtime-log/database", () => ({
  isHostedRuntimeLogDatabaseConfigured:
    mocks.isHostedRuntimeLogDatabaseConfigured,
}));

vi.mock("@/src/lib/hosted-retention/browser-assertion-nonces", () => ({
  deleteExpiredHostedBrowserAssertionNonces:
    mocks.deleteExpiredHostedBrowserAssertionNonces,
}));

vi.mock("@/src/lib/hosted-retention/cleanup", () => ({
  runHostedRetentionCleanup: mocks.runHostedRetentionCleanup,
}));

type HostedRetentionCronRouteModule = typeof import("../app/api/internal/hosted-execution/retention/cron/route");

let hostedRetentionCronRoute: HostedRetentionCronRouteModule;

describe("hosted retention cron route", () => {
  beforeAll(async () => {
    hostedRetentionCronRoute = await import("../app/api/internal/hosted-execution/retention/cron/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.isHostedRuntimeLogDatabaseConfigured.mockReturnValue(false);
    mocks.deleteExpiredHostedBrowserAssertionNonces.mockResolvedValue(8);
    mocks.runHostedRetentionCleanup.mockResolvedValue({
      accountDeletionCleanup: {
        completed: 1,
        failed: 0,
        pending: 2,
        selected: 3,
      },
      expiredCallbackRequestNoncesDeleted: 8,
      expiredComputerRunsCleanedUp: 4,
      expiredConversationPolicyNonRepliesRecorded: 1,
      expiredGroupCurrentSenderClarificationsDeleted: 2,
      expiredMailboxContentRetired: 7,
      expiredMailboxTombstonesDeleted: 2,
      inboxMediaRetentionRuntimeSignalFailures: 1,
      inboxMediaRetentionRuntimeSignalsSent: 3,
      oldRuntimeLogsDeleted: 6,
      staleWebSessionsDeleted: 5,
    });
  });

  it("requires the Vercel cron header and returns the cleanup summary", async () => {
    const response = await hostedRetentionCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/retention/cron"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.runHostedRetentionCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.deleteExpiredHostedBrowserAssertionNonces).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      cleanup: {
        accountDeletionCleanup: {
          completed: 1,
          failed: 0,
          pending: 2,
          selected: 3,
        },
        expiredBrowserAssertionNoncesDeleted: 8,
        expiredCallbackRequestNoncesDeleted: 8,
        expiredComputerRunsCleanedUp: 4,
        expiredConversationPolicyNonRepliesRecorded: 1,
        expiredGroupCurrentSenderClarificationsDeleted: 2,
        expiredMailboxContentRetired: 7,
        expiredMailboxTombstonesDeleted: 2,
        inboxMediaRetentionRuntimeSignalFailures: 1,
        inboxMediaRetentionRuntimeSignalsSent: 3,
        oldRuntimeLogsDeleted: 6,
        staleWebSessionsDeleted: 5,
      },
    });
  });
});
