import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVercelCronRequest: vi.fn(),
  runHostedMailboxLagSweeper: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/lag-sweeper", () => ({
  runHostedMailboxLagSweeper: mocks.runHostedMailboxLagSweeper,
}));

type HostedMailboxLagSweeperCronRoute =
  typeof import("../app/api/internal/hosted-mailbox/lag-sweeper/cron/route");

let route: HostedMailboxLagSweeperCronRoute;

describe("hosted mailbox lag sweeper cron route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/hosted-mailbox/lag-sweeper/cron/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.runHostedMailboxLagSweeper.mockResolvedValue({
      candidateCounters: 4,
      currentCounters: 2,
      invalidLaneCounters: 0,
      laggedCounters: 2,
      laggedUsers: 1,
      nudgeAccepted: 1,
      nudgeAttempted: 1,
      nudgeLimit: 50,
      nudgeNotAccepted: 0,
      skippedLaggedUsers: 0,
    });
  });

  it("requires Vercel cron auth and returns the sweep summary", async () => {
    const response = await route.GET(
      new Request("https://join.example.test/api/internal/hosted-mailbox/lag-sweeper/cron"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.runHostedMailboxLagSweeper).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      sweeper: {
        candidateCounters: 4,
        currentCounters: 2,
        invalidLaneCounters: 0,
        laggedCounters: 2,
        laggedUsers: 1,
        nudgeAccepted: 1,
        nudgeAttempted: 1,
        nudgeLimit: 50,
        nudgeNotAccepted: 0,
        skippedLaggedUsers: 0,
      },
    });
  });
});
