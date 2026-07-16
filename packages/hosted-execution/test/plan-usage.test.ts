import { describe, expect, it } from "vitest";

import {
  parseHostedPlanUsageStatus,
  parseHostedPlanUsageToolRequest,
} from "../src/plan-usage.ts";

describe("hosted plan usage contract", () => {
  it("parses the exact active response shape", () => {
    expect(parseHostedPlanUsageStatus({
      accessKind: "paid",
      forecast: {
        estimatedDaysRemaining: 7,
        estimatedExhaustionAt: "2026-07-10T12:00:00.000Z",
      },
      generatedAt: "2026-07-03T12:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodKind: "monthly",
      periodStart: "2026-07-01T00:00:00.000Z",
      planCode: "launch_monthly",
      planName: "Pulse",
      recommendedAction: {
        kind: "upgrade_edge",
        label: "Upgrade to Edge",
        url: "https://example.test/settings#subscription",
      },
      subscriptionActionQuote: {
        action: "upgrade_edge",
        label: "Upgrade to Edge ($20/month)",
      },
      remainingPercent: 25,
      status: "active",
      usedPercent: 75,
    })).toMatchObject({
      planName: "Pulse",
      status: "active",
      usedPercent: 75,
    });
  });

  it("parses the trial display name", () => {
    expect(parseHostedPlanUsageStatus({
      accessKind: "trial",
      forecast: null,
      generatedAt: "2026-07-03T12:00:00.000Z",
      periodEnd: "2026-07-10T12:00:00.000Z",
      periodKind: "trial",
      periodStart: "2026-07-01T12:00:00.000Z",
      planCode: "launch_monthly",
      planName: "Pulse Trial",
      recommendedAction: null,
      subscriptionActionQuote: {
        action: "start_pulse_now",
        label: "Start Pulse now ($8/month)",
      },
      remainingPercent: 75,
      status: "active",
      usedPercent: 25,
    })).toMatchObject({
      accessKind: "trial",
      planName: "Pulse Trial",
      subscriptionActionQuote: {
        action: "start_pulse_now",
      },
    });
  });

  it("accepts add-usage actions only at the canonical Settings target", () => {
    const status = {
      accessKind: "paid",
      forecast: null,
      generatedAt: "2026-07-03T12:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodKind: "monthly",
      periodStart: "2026-07-01T00:00:00.000Z",
      planCode: "launch_monthly",
      planName: "Pulse",
      recommendedAction: {
        kind: "add_usage",
        label: "Add usage",
        url: "/settings?addUsage=true#subscription",
      },
      remainingPercent: 15,
      status: "active",
      usedPercent: 85,
    } as const;

    expect(parseHostedPlanUsageStatus(status)).toMatchObject({
      recommendedAction: {
        kind: "add_usage",
        url: "/settings?addUsage=true#subscription",
      },
    });
    expect(() => parseHostedPlanUsageStatus({
      ...status,
      recommendedAction: {
        ...status.recommendedAction,
        url: "/settings#subscription",
      },
    })).toThrow();
  });

  it("parses unavailable group status without personal billing details", () => {
    expect(parseHostedPlanUsageStatus({
      generatedAt: "2026-07-03T12:00:00.000Z",
      reason: "group_not_supported",
      recommendedAction: null,
      subscriptionActionQuote: null,
      status: "unavailable",
    })).toEqual({
      generatedAt: "2026-07-03T12:00:00.000Z",
      reason: "group_not_supported",
      recommendedAction: null,
      subscriptionActionQuote: null,
      status: "unavailable",
    });
  });

  it("rejects extra request and response fields", () => {
    expect(parseHostedPlanUsageToolRequest({})).toEqual({});
    expect(parseHostedPlanUsageToolRequest({
      includeSubscriptionActionQuote: true,
    })).toEqual({ includeSubscriptionActionQuote: true });
    expect(() => parseHostedPlanUsageToolRequest({
      includeSubscriptionActionQuote: false,
    })).toThrow();
    expect(() => parseHostedPlanUsageToolRequest({ memberId: "not-allowed" }))
      .toThrow();
    expect(() => parseHostedPlanUsageStatus({
      generatedAt: "2026-07-03T12:00:00.000Z",
      internalLimit: "10000000",
      reason: "hosted_access_inactive",
      recommendedAction: null,
      status: "unavailable",
    })).toThrow();
  });
});
