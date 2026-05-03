import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  runHostedStaleRunnerCleanup: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/stale-runner-cleanup", () => ({
  runHostedStaleRunnerCleanup: mocks.runHostedStaleRunnerCleanup,
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type HostedStaleRunnerCleanupCronRoute =
  typeof import("../app/api/internal/hosted-execution/stale-runner-cleanup/cron/route");

let route: HostedStaleRunnerCleanupCronRoute;

describe("hosted stale runner cleanup cron route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/hosted-execution/stale-runner-cleanup/cron/route");
  });

  beforeEach(() => {
    const prisma = { model: "prisma" };

    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.runHostedStaleRunnerCleanup.mockResolvedValue({
      activeMemberSkipCount: 1,
      candidateCount: 2,
      configured: true,
      deletedCount: 1,
      failedCount: 0,
      results: [
        {
          action: "skipped_active_member",
          alarmCleared: null,
          candidateIndex: 0,
          errorCode: null,
          r2DeletedObjectCount: null,
          runnerStateDeleted: null,
        },
        {
          action: "deleted",
          alarmCleared: true,
          candidateIndex: 1,
          errorCode: null,
          r2DeletedObjectCount: 0,
          runnerStateDeleted: true,
        },
      ],
    });
  });

  it("requires Vercel cron auth, uses Prisma, and returns the cleanup summary", async () => {
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/stale-runner-cleanup/cron",
    );
    const response = await route.GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(request);
    expect(mocks.getPrisma).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedStaleRunnerCleanup).toHaveBeenCalledWith({
      prisma: { model: "prisma" },
    });
    await expect(response.json()).resolves.toEqual({
      cleanup: {
        activeMemberSkipCount: 1,
        candidateCount: 2,
        configured: true,
        deletedCount: 1,
        failedCount: 0,
        results: [
          {
            action: "skipped_active_member",
            alarmCleared: null,
            candidateIndex: 0,
            errorCode: null,
            r2DeletedObjectCount: null,
            runnerStateDeleted: null,
          },
          {
            action: "deleted",
            alarmCleared: true,
            candidateIndex: 1,
            errorCode: null,
            r2DeletedObjectCount: 0,
            runnerStateDeleted: true,
          },
        ],
      },
    });
  });
});
