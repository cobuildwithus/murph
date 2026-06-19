import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVercelCronRequest: vi.fn(),
  runHostedRetentionCleanup: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
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
    mocks.runHostedRetentionCleanup.mockResolvedValue({
      expiredComputerRunsCleanedUp: 4,
      expiredMailboxItemsDeleted: 7,
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
    await expect(response.json()).resolves.toEqual({
      cleanup: {
        expiredComputerRunsCleanedUp: 4,
        expiredMailboxItemsDeleted: 7,
        oldRuntimeLogsDeleted: 6,
        staleWebSessionsDeleted: 5,
      },
    });
  });
});
