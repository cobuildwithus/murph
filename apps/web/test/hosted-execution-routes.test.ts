import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  buildHostedSharePageData: vi.fn(),
  drainHostedAiUsageStripeMetering: vi.fn(),
  getPrisma: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  getPrivyMemberAuth: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-execution/stripe-metering", () => ({
  drainHostedAiUsageStripeMetering: mocks.drainHostedAiUsageStripeMetering,
}));

vi.mock("@/src/lib/hosted-share/service", () => ({
  buildHostedSharePageData: mocks.buildHostedSharePageData,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  getPrivyMemberAuth: mocks.getPrivyMemberAuth,
}));

type HostedExecutionUsageCronRouteModule = typeof import("../app/api/internal/hosted-execution/usage/cron/route");
type HostedShareStatusRouteModule = typeof import("../app/api/hosted-share/[shareCode]/status/route");

let hostedExecutionUsageCronRoute: HostedExecutionUsageCronRouteModule;
let hostedShareStatusRoute: HostedShareStatusRouteModule;

describe("hosted execution async routes", () => {
  beforeAll(async () => {
    hostedExecutionUsageCronRoute = await import("../app/api/internal/hosted-execution/usage/cron/route");
    hostedShareStatusRoute = await import("../app/api/hosted-share/[shareCode]/status/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.getPrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.buildHostedSharePageData.mockResolvedValue({
      inviteCode: "invite-code",
      session: {
        active: true,
        authenticated: true,
      },
      share: null,
      stage: "invalid",
    });
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

  it("decodes shareCode, forwards inviteCode, and passes the resolved auth member into the share status route", async () => {
    const prisma = {
      prisma: true,
    };
    const auth = {
      member: {
        id: "member_123",
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.getPrivyMemberAuth.mockResolvedValue(auth);
    mocks.buildHostedSharePageData.mockResolvedValue({
      inviteCode: "invite code",
      session: {
        active: true,
        authenticated: true,
      },
      share: null,
      stage: "invalid",
    });

    const response = await hostedShareStatusRoute.GET(
      new Request("https://join.example.test/api/hosted-share/share%20code/status?invite=invite%20code"),
      {
        params: Promise.resolve({
          shareCode: "share%20code",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getPrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request), prisma);
    expect(mocks.buildHostedSharePageData).toHaveBeenCalledWith({
      authenticatedMember: { id: "member_123" },
      inviteCode: "invite code",
      prisma,
      shareCode: "share code",
    });
  });

  it("maps hosted share status errors through jsonError", async () => {
    mocks.buildHostedSharePageData.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_SHARE_NOT_FOUND",
      httpStatus: 404,
      message: "That share link is not valid.",
    }));

    const response = await hostedShareStatusRoute.GET(
      new Request("https://join.example.test/api/hosted-share/share/status"),
      {
        params: Promise.resolve({
          shareCode: "share",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_SHARE_NOT_FOUND",
        message: "That share link is not valid.",
        retryable: false,
      },
    });
  });
});
