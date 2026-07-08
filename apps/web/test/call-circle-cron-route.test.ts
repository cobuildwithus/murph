import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVercelCronRequest: vi.fn(),
  runCallCircleScheduler: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/call-circle/scheduler", () => ({
  runCallCircleScheduler: mocks.runCallCircleScheduler,
}));

type CallCircleCronRouteModule =
  typeof import("../app/api/internal/call-circle/cron/route");

let callCircleCronRoute: CallCircleCronRouteModule;

describe("Call Circle cron route", () => {
  beforeAll(async () => {
    callCircleCronRoute = await import("../app/api/internal/call-circle/cron/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.runCallCircleScheduler.mockResolvedValue({
      askedFinal: 2,
      askedMorning: 1,
      bridgeAttempts: 3,
      expired: 4,
      handoffs: 5,
      proposals: 6,
      resultNotifications: 7,
      setupAsks: 8,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires cron auth but skips scheduler work while the rollout gate is off", async () => {
    const response = await callCircleCronRoute.GET(
      new Request("https://join.example.test/api/internal/call-circle/cron"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.runCallCircleScheduler).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      result: {
        reason: "cron_disabled",
        status: "skipped",
      },
    });
  });

  it("runs the scheduler when the rollout gate is explicitly enabled", async () => {
    vi.stubEnv("HOSTED_CALL_CIRCLE_CRON_ENABLED", "1");

    const response = await callCircleCronRoute.GET(
      new Request("https://join.example.test/api/internal/call-circle/cron"),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.runCallCircleScheduler).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      result: {
        scheduler: {
          askedFinal: 2,
          askedMorning: 1,
          bridgeAttempts: 3,
          expired: 4,
          handoffs: 5,
          proposals: 6,
          resultNotifications: 7,
          setupAsks: 8,
        },
        status: "ran",
      },
    });
  });
});
