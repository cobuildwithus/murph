import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  buildHostedSharePageData: vi.fn(),
  drainHostedExecutionOutbox: vi.fn(),
  drainHostedAiUsageStripeMetering: vi.fn(),
  getPrisma: vi.fn(),
  importHostedAiUsageRecords: vi.fn(),
  requireHostedExecutionInternalToken: vi.fn(),
  requireHostedExecutionSchedulerToken: vi.fn(),
  resolveHostedSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/internal", () => ({
  requireHostedExecutionInternalToken: mocks.requireHostedExecutionInternalToken,
  requireHostedExecutionSchedulerToken: mocks.requireHostedExecutionSchedulerToken,
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  drainHostedExecutionOutbox: mocks.drainHostedExecutionOutbox,
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  importHostedAiUsageRecords: mocks.importHostedAiUsageRecords,
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

vi.mock("@/src/lib/hosted-onboarding/session", () => ({
  resolveHostedSessionFromRequest: mocks.resolveHostedSessionFromRequest,
}));

type HostedExecutionCronRouteModule = typeof import("../app/api/internal/hosted-execution/outbox/cron/route");
type HostedExecutionUsageCronRouteModule = typeof import("../app/api/internal/hosted-execution/usage/cron/route");
type HostedExecutionUsageRecordRouteModule = typeof import("../app/api/internal/hosted-execution/usage/record/route");
type HostedShareStatusRouteModule = typeof import("../app/api/hosted-share/[shareCode]/status/route");

let hostedExecutionCronRoute: HostedExecutionCronRouteModule;
let hostedExecutionUsageCronRoute: HostedExecutionUsageCronRouteModule;
let hostedExecutionUsageRecordRoute: HostedExecutionUsageRecordRouteModule;
let hostedShareStatusRoute: HostedShareStatusRouteModule;

describe("hosted execution async routes", () => {
  beforeAll(async () => {
    hostedExecutionCronRoute = await import("../app/api/internal/hosted-execution/outbox/cron/route");
    hostedExecutionUsageCronRoute = await import("../app/api/internal/hosted-execution/usage/cron/route");
    hostedExecutionUsageRecordRoute = await import("../app/api/internal/hosted-execution/usage/record/route");
    hostedShareStatusRoute = await import("../app/api/hosted-share/[shareCode]/status/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedExecutionInternalToken.mockImplementation(() => {});
    mocks.requireHostedExecutionSchedulerToken.mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.resolveHostedSessionFromRequest.mockResolvedValue({
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
        status: "completed",
      },
      {
        eventId: "evt_2",
        status: "accepted",
      },
    ]);
    mocks.importHostedAiUsageRecords.mockResolvedValue({
      recordedIds: ["usage_1", "usage_2"],
      records: [],
    });
    mocks.drainHostedAiUsageStripeMetering.mockResolvedValue({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 1,
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
    expect(mocks.requireHostedExecutionSchedulerToken).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedExecutionOutbox).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      drained: 2,
      eventIds: ["evt_1", "evt_2"],
      statuses: [
        {
          eventId: "evt_1",
          status: "completed",
        },
        {
          eventId: "evt_2",
          status: "accepted",
        },
      ],
    });
  });

  it("maps missing scheduler token configuration to a 500", async () => {
    mocks.requireHostedExecutionSchedulerToken.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_EXECUTION_SCHEDULER_TOKEN_REQUIRED",
        httpStatus: 500,
        message: "CRON_SECRET must be configured for scheduled hosted execution drains.",
      });
    });

    const response = await hostedExecutionCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EXECUTION_SCHEDULER_TOKEN_REQUIRED",
        message: "CRON_SECRET must be configured for scheduled hosted execution drains.",
        retryable: false,
      },
    });
  });

  it("maps a bad scheduler token to a 401", async () => {
    mocks.requireHostedExecutionSchedulerToken.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_EXECUTION_UNAUTHORIZED",
        httpStatus: 401,
        message: "Unauthorized hosted execution request.",
      });
    });

    const response = await hostedExecutionCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron", {
        headers: {
          authorization: "Bearer wrong-token",
        },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EXECUTION_UNAUTHORIZED",
        message: "Unauthorized hosted execution request.",
        retryable: false,
      },
    });
  });

  it("records posted hosted AI usage rows through the internal route", async () => {
    const response = await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        method: "POST",
        headers: {
          authorization: "Bearer internal-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          usage: [
            {
              usageId: "usage_1",
            },
            {
              usageId: "usage_2",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedExecutionInternalToken).toHaveBeenCalledTimes(1);
    expect(mocks.importHostedAiUsageRecords).toHaveBeenCalledWith({
      usage: [
        {
          usageId: "usage_1",
        },
        {
          usageId: "usage_2",
        },
      ],
    });
    await expect(response.json()).resolves.toEqual({
      recorded: 2,
      usageIds: ["usage_1", "usage_2"],
    });
  });

  it("returns the Stripe usage cron drain summary", async () => {
    const response = await hostedExecutionUsageCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/cron", {
        headers: {
          authorization: "Bearer cron-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedExecutionSchedulerToken).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedAiUsageStripeMetering).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 1,
    });
  });

  it("decodes shareCode, forwards inviteCode, and passes the resolved session into the share status route", async () => {
    const prisma = {
      prisma: true,
    };
    const sessionRecord = {
      member: {
        id: "member_123",
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.resolveHostedSessionFromRequest.mockResolvedValue(sessionRecord);
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
    expect(mocks.resolveHostedSessionFromRequest).toHaveBeenCalledWith(expect.any(Request), prisma);
    expect(mocks.buildHostedSharePageData).toHaveBeenCalledWith({
      inviteCode: "invite code",
      prisma,
      sessionRecord,
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
