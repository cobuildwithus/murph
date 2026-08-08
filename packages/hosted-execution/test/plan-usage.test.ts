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
        kind: "change_plan",
        label: "Upgrade to Edge ($20/month)",
        targetPlanCode: "launch_edge_monthly",
        url: "https://example.test/settings#subscription",
      },
      scheduledPlan: {
        code: "launch_group_monthly",
        displayName: "Group",
        effectiveAt: "2026-08-01T00:00:00.000Z",
      },
      subscriptionActionQuote: {
        action: "change_plan",
        expiresAt: "2026-07-03T12:10:00.000Z",
        label: "Upgrade to Edge ($20/month)",
        monthlyPriceUsdCents: 2_000,
        quoteId: "quote_test_edge",
        targetPlanCode: "launch_edge_monthly",
        timing: "immediate",
      },
      remainingPercent: 25,
      status: "active",
      usedPercent: 75,
    })).toMatchObject({
      planName: "Pulse",
      scheduledPlan: {
        code: "launch_group_monthly",
        effectiveAt: "2026-08-01T00:00:00.000Z",
      },
      status: "active",
      usedPercent: 75,
    });
  });

  it("parses the starter-usage display name", () => {
    expect(parseHostedPlanUsageStatus({
      accessKind: "starter",
      availablePlans: [
        {
          code: "launch_group_monthly",
          displayName: "Group",
          monthlyPriceUsdCents: 350,
          selectable: true,
        },
        {
          code: "launch_monthly",
          displayName: "Pulse",
          monthlyPriceUsdCents: 800,
          selectable: true,
        },
      ],
      forecast: null,
      generatedAt: "2026-07-03T12:00:00.000Z",
      periodEnd: "2026-07-10T12:00:00.000Z",
      periodKind: "lifetime",
      periodStart: "2026-07-01T12:00:00.000Z",
      planCode: "launch_monthly",
      planName: "Starter",
      recommendedPlanCode: "launch_group_monthly",
      recommendedAction: null,
      subscriptionActionQuote: {
        action: "change_plan",
        expiresAt: "2026-07-03T12:10:00.000Z",
        label: "Start Group ($3.50/month)",
        monthlyPriceUsdCents: 350,
        quoteId: "quote_test_group",
        targetPlanCode: "launch_group_monthly",
        timing: "now",
      },
      remainingPercent: 75,
      status: "active",
      usedPercent: 25,
    })).toMatchObject({
      accessKind: "starter",
      planName: "Starter",
      recommendedPlanCode: "launch_group_monthly",
      subscriptionActionQuote: {
        action: "change_plan",
        targetPlanCode: "launch_group_monthly",
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
    expect(parseHostedPlanUsageToolRequest({
      includeSubscriptionActionQuote: true,
      subscriptionActionTargetPlanCode: "launch_group_monthly",
    })).toEqual({
      includeSubscriptionActionQuote: true,
      subscriptionActionTargetPlanCode: "launch_group_monthly",
    });
    expect(() => parseHostedPlanUsageToolRequest({
      subscriptionActionTargetPlanCode: "launch_group_monthly",
    })).toThrow();
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
