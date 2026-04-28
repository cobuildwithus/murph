import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drainHostedAiUsageStripeMetering: vi.fn(),
  getPrisma: vi.fn(),
  requireVercelCronRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-execution/stripe-metering", () => ({
  drainHostedAiUsageStripeMetering: mocks.drainHostedAiUsageStripeMetering,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type HostedExecutionUsageCronRouteModule = typeof import("../app/api/internal/hosted-execution/usage/cron/route");

let hostedExecutionUsageCronRoute: HostedExecutionUsageCronRouteModule;

describe("hosted execution async routes", () => {
  beforeAll(async () => {
    hostedExecutionUsageCronRoute = await import("../app/api/internal/hosted-execution/usage/cron/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.drainHostedAiUsageStripeMetering.mockResolvedValue({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 1,
    });
  });

  it("returns the hosted Stripe metering cron summary", async () => {
    const response = await hostedExecutionUsageCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/cron"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledTimes(1);
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.drainHostedAiUsageStripeMetering).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      metered: {
        configured: true,
        failed: 0,
        metered: 1,
        skipped: 1,
      },
    });
  });

});
