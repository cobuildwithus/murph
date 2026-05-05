import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVercelCronRequest: vi.fn(),
  runHostedDeviceSyncDirtySweeper: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/device-sync/dirty-sweeper", () => ({
  runHostedDeviceSyncDirtySweeper: mocks.runHostedDeviceSyncDirtySweeper,
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
      dirtyUsers: 1,
      nudgeAccepted: 1,
      nudgeAttempted: 1,
      nudgeLimit: 25,
      nudgeNotAccepted: 0,
      skippedDirtyUsers: 0,
      staleAfterMs: 30000,
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
    await expect(response.json()).resolves.toEqual({
      sweeper: {
        dirtyUsers: 1,
        nudgeAccepted: 1,
        nudgeAttempted: 1,
        nudgeLimit: 25,
        nudgeNotAccepted: 0,
        skippedDirtyUsers: 0,
        staleAfterMs: 30000,
      },
    });
  });
});
