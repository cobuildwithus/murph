import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID } from "@/src/lib/hosted-execution/internal";

const mocks = vi.hoisted(() => ({
  buildHostedSharePageData: vi.fn(),
  drainHostedPendingAiUsageImports: vi.fn(),
  drainHostedExecutionOutbox: vi.fn(),
  drainHostedAiUsageStripeMetering: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedWebInternalServiceRequest: vi.fn(),
  resolveHostedPrivyRequestAuthContext: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/internal", () => ({
  HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID: "system:hosted-execution-scheduler",
  requireHostedWebInternalServiceRequest: mocks.requireHostedWebInternalServiceRequest,
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  drainHostedExecutionOutbox: mocks.drainHostedExecutionOutbox,
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  drainHostedPendingAiUsageImports: mocks.drainHostedPendingAiUsageImports,
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
  resolveHostedPrivyRequestAuthContext: mocks.resolveHostedPrivyRequestAuthContext,
}));

type HostedExecutionCronRouteModule = typeof import("../app/api/internal/hosted-execution/outbox/cron/route");
type HostedExecutionUsageCronRouteModule = typeof import("../app/api/internal/hosted-execution/usage/cron/route");
type HostedShareStatusRouteModule = typeof import("../app/api/hosted-share/[shareCode]/status/route");

let hostedExecutionCronRoute: HostedExecutionCronRouteModule;
let hostedExecutionUsageCronRoute: HostedExecutionUsageCronRouteModule;
let hostedShareStatusRoute: HostedShareStatusRouteModule;

describe("hosted execution async routes", () => {
  beforeAll(async () => {
    hostedExecutionCronRoute = await import("../app/api/internal/hosted-execution/outbox/cron/route");
    hostedExecutionUsageCronRoute = await import("../app/api/internal/hosted-execution/usage/cron/route");
    hostedShareStatusRoute = await import("../app/api/hosted-share/[shareCode]/status/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedWebInternalServiceRequest.mockResolvedValue(undefined);
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.resolveHostedPrivyRequestAuthContext.mockResolvedValue({
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
    mocks.drainHostedExecutionOutbox.mockResolvedValue([
      {
        eventId: "evt_1",
        status: "dispatched",
      },
      {
        eventId: "evt_2",
        status: "delivery_failed",
      },
    ]);
    mocks.drainHostedAiUsageStripeMetering.mockResolvedValue({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 1,
    });
    mocks.drainHostedPendingAiUsageImports.mockResolvedValue({
      failedUsers: 0,
      imported: 2,
      scannedUsers: 3,
    });
  });

  it("returns drain counts, event ids, and per-event statuses from the cron route", async () => {
    const response = await hostedExecutionCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron", {
        headers: {
          authorization: "Bearer cron-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedWebInternalServiceRequest).toHaveBeenCalledTimes(1);
    expect(mocks.requireHostedWebInternalServiceRequest).toHaveBeenCalledWith(
      expect.any(Request),
      HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID,
    );
    expect(mocks.drainHostedExecutionOutbox).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      drained: 2,
      eventIds: ["evt_1", "evt_2"],
      statuses: [
        {
          eventId: "evt_1",
          status: "dispatched",
        },
        {
          eventId: "evt_2",
          status: "delivery_failed",
        },
      ],
    });
  });

  it("maps missing signing secret configuration to a 500", async () => {
    mocks.requireHostedWebInternalServiceRequest.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_WEB_INTERNAL_SIGNING_SECRET_REQUIRED",
      httpStatus: 500,
      message:
        "HOSTED_WEB_INTERNAL_SIGNING_SECRET must be configured for Cloudflare-owned hosted web routes.",
    }));

    const response = await hostedExecutionCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_WEB_INTERNAL_SIGNING_SECRET_REQUIRED",
        message:
          "HOSTED_WEB_INTERNAL_SIGNING_SECRET must be configured for Cloudflare-owned hosted web routes.",
        retryable: false,
      },
    });
  });

  it("maps a bad signed scheduler request to a 401", async () => {
    mocks.requireHostedWebInternalServiceRequest.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_WEB_INTERNAL_UNAUTHORIZED",
      httpStatus: 401,
      message: "Unauthorized hosted web internal request.",
    }));

    const response = await hostedExecutionCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_WEB_INTERNAL_UNAUTHORIZED",
        message: "Unauthorized hosted web internal request.",
        retryable: false,
      },
    });
  });

  it("returns the hosted pending-usage import and Stripe metering cron summaries", async () => {
    const response = await hostedExecutionUsageCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/cron"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedWebInternalServiceRequest).toHaveBeenCalledTimes(1);
    expect(mocks.requireHostedWebInternalServiceRequest).toHaveBeenCalledWith(
      expect.any(Request),
      HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID,
    );
    expect(mocks.drainHostedPendingAiUsageImports).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedAiUsageStripeMetering).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      imported: {
        failedUsers: 0,
        imported: 2,
        scannedUsers: 3,
      },
      metered: {
        configured: true,
        failed: 0,
        metered: 1,
        skipped: 1,
      },
    });
  });

  it("continues Stripe metering even when pending-usage import throws", async () => {
    mocks.drainHostedPendingAiUsageImports.mockRejectedValue(new Error("worker unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await hostedExecutionUsageCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/cron"),
    );

    expect(response.status).toBe(200);
    expect(mocks.drainHostedPendingAiUsageImports).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedAiUsageStripeMetering).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "Hosted pending AI usage import failed.",
      "worker unavailable",
    );
    await expect(response.json()).resolves.toEqual({
      importError: "worker unavailable",
      imported: null,
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
    mocks.resolveHostedPrivyRequestAuthContext.mockResolvedValue(auth);
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
    expect(mocks.resolveHostedPrivyRequestAuthContext).toHaveBeenCalledWith(expect.any(Request), prisma);
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
