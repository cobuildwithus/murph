import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  buildHostedSharePageData: vi.fn(),
  drainHostedPendingAiUsageImports: vi.fn(),
  drainHostedExecutionOutbox: vi.fn(),
  drainHostedAiUsageStripeMetering: vi.fn(),
  drainHostedOnboardingWebhookReceipts: vi.fn(),
  getPrisma: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  resolveHostedPrivyRequestAuthContext: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
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

vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  drainHostedOnboardingWebhookReceipts: mocks.drainHostedOnboardingWebhookReceipts,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  resolveHostedPrivyRequestAuthContext: mocks.resolveHostedPrivyRequestAuthContext,
}));

type HostedExecutionCronRouteModule = typeof import("../app/api/internal/hosted-execution/outbox/cron/route");
type HostedExecutionUsageCronRouteModule = typeof import("../app/api/internal/hosted-execution/usage/cron/route");
type HostedOnboardingWebhookReceiptCronRouteModule = typeof import("../app/api/internal/hosted-onboarding/webhook-receipts/cron/route");
type HostedShareStatusRouteModule = typeof import("../app/api/hosted-share/[shareCode]/status/route");

let hostedExecutionCronRoute: HostedExecutionCronRouteModule;
let hostedExecutionUsageCronRoute: HostedExecutionUsageCronRouteModule;
let hostedOnboardingWebhookReceiptCronRoute: HostedOnboardingWebhookReceiptCronRouteModule;
let hostedShareStatusRoute: HostedShareStatusRouteModule;

describe("hosted execution async routes", () => {
  beforeAll(async () => {
    hostedExecutionCronRoute = await import("../app/api/internal/hosted-execution/outbox/cron/route");
    hostedExecutionUsageCronRoute = await import("../app/api/internal/hosted-execution/usage/cron/route");
    hostedOnboardingWebhookReceiptCronRoute = await import("../app/api/internal/hosted-onboarding/webhook-receipts/cron/route");
    hostedShareStatusRoute = await import("../app/api/hosted-share/[shareCode]/status/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
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
    mocks.drainHostedOnboardingWebhookReceipts.mockResolvedValue([
      {
        eventId: "evt_linq",
        source: "linq",
        status: "continued",
      },
      {
        eventId: "evt_telegram",
        source: "telegram",
        status: "skipped",
      },
      {
        eventId: "evt_failed",
        source: "linq",
        status: "failed",
      },
    ]);
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
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledTimes(1);
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
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
    mocks.requireVercelCronRequest.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "CRON_SECRET_REQUIRED",
        httpStatus: 500,
        message: "CRON_SECRET must be configured for hosted cron routes.",
      });
    });

    const response = await hostedExecutionCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CRON_SECRET_REQUIRED",
        message: "CRON_SECRET must be configured for hosted cron routes.",
        retryable: false,
      },
    });
  });

  it("maps a bad Vercel cron request to a 401", async () => {
    mocks.requireVercelCronRequest.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "VERCEL_CRON_UNAUTHORIZED",
        httpStatus: 401,
        message: "Unauthorized Vercel cron request.",
      });
    });

    const response = await hostedExecutionCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VERCEL_CRON_UNAUTHORIZED",
        message: "Unauthorized Vercel cron request.",
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
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledTimes(1);
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(expect.any(Request));
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

  it("returns hosted webhook receipt continuation counts and statuses from the cron route", async () => {
    const response = await hostedOnboardingWebhookReceiptCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-onboarding/webhook-receipts/cron", {
        headers: {
          authorization: "Bearer cron-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedOnboardingWebhookReceipts).toHaveBeenCalledWith({
      prisma: {
        prisma: true,
      },
    });
    await expect(response.json()).resolves.toEqual({
      continued: 1,
      failed: 1,
      receipts: [
        {
          eventId: "evt_linq",
          source: "linq",
          status: "continued",
        },
        {
          eventId: "evt_telegram",
          source: "telegram",
          status: "skipped",
        },
        {
          eventId: "evt_failed",
          source: "linq",
          status: "failed",
        },
      ],
      skipped: 1,
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
