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

  it("parses bounded beneficiary-scoped top-up history", () => {
    const status = {
      accessKind: "paid",
      forecast: null,
      generatedAt: "2026-07-03T12:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodKind: "monthly",
      periodStart: "2026-07-01T00:00:00.000Z",
      planCode: "launch_monthly",
      planName: "Pulse",
      recommendedAction: null,
      remainingPercent: 50,
      status: "active",
      topUpHistory: {
        hasMore: false,
        latestSelfPurchase: {
          amountUsd: "5.000000",
          attemptedAt: "2026-07-02T12:00:00.000Z",
          status: "fulfilled",
          topUp: {
            addedUsd: "5.000000",
            adjustedUsd: "0.000000",
            creditedAt: "2026-07-02T12:00:00.000Z",
            remainingUsd: "3.750000",
            source: "purchased_by_you",
            usedUsd: "1.250000",
          },
        },
        topUps: [
          {
            addedUsd: "5.000000",
            adjustedUsd: "0.000000",
            creditedAt: "2026-07-02T12:00:00.000Z",
            remainingUsd: "3.750000",
            source: "purchased_by_you",
            usedUsd: "1.250000",
          },
        ],
        totalCount: 1,
      },
      usedPercent: 50,
    } as const;

    expect(parseHostedPlanUsageStatus(status)).toMatchObject({
      topUpHistory: {
        hasMore: false,
        totalCount: 1,
      },
    });
    expect(() => parseHostedPlanUsageStatus({
      ...status,
      topUpHistory: {
        ...status.topUpHistory,
        hasMore: true,
      },
    })).toThrow();
    expect(() => parseHostedPlanUsageStatus({
      ...status,
      topUpHistory: {
        ...status.topUpHistory,
        hasMore: true,
        totalCount: 2,
      },
    })).toThrow();
    const fiftyTopUps = Array.from(
      { length: 50 },
      () => status.topUpHistory.topUps[0],
    );
    expect(parseHostedPlanUsageStatus({
      ...status,
      topUpHistory: {
        hasMore: true,
        latestSelfPurchase: status.topUpHistory.latestSelfPurchase,
        topUps: fiftyTopUps,
        totalCount: 51,
      },
    })).toMatchObject({
      topUpHistory: {
        hasMore: true,
        totalCount: 51,
      },
    });
    expect(() => parseHostedPlanUsageStatus({
      ...status,
      topUpHistory: {
        hasMore: true,
        latestSelfPurchase: status.topUpHistory.latestSelfPurchase,
        topUps: fiftyTopUps.slice(0, 49),
        totalCount: 51,
      },
    })).toThrow();
    expect(parseHostedPlanUsageStatus({
      ...status,
      topUpHistory: {
        ...status.topUpHistory,
        latestSelfPurchase: {
          amountUsd: "25.000000",
          attemptedAt: "2026-07-03T12:00:00.000Z",
          status: "payment_pending",
          topUp: null,
        },
      },
    })).toMatchObject({
      topUpHistory: {
        latestSelfPurchase: {
          status: "payment_pending",
          topUp: null,
        },
      },
    });
    expect(() => parseHostedPlanUsageStatus({
      ...status,
      topUpHistory: {
        ...status.topUpHistory,
        latestSelfPurchase: {
          ...status.topUpHistory.latestSelfPurchase,
          status: "payment_pending",
        },
      },
    })).toThrow();
    expect(() => parseHostedPlanUsageStatus({
      ...status,
      topUpHistory: {
        ...status.topUpHistory,
        latestSelfPurchase: {
          ...status.topUpHistory.latestSelfPurchase,
          topUp: null,
        },
      },
    })).toThrow();
    expect(() => parseHostedPlanUsageStatus({
      ...status,
      topUpHistory: {
        ...status.topUpHistory,
        latestSelfPurchase: {
          ...status.topUpHistory.latestSelfPurchase,
          topUp: {
            ...status.topUpHistory.latestSelfPurchase.topUp,
            source: "added_for_you",
          },
        },
      },
    })).toThrow();
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
    expect(parseHostedPlanUsageToolRequest({
      includeTopUpHistory: true,
    })).toEqual({ includeTopUpHistory: true });
    expect(() => parseHostedPlanUsageToolRequest({
      includeSubscriptionActionQuote: false,
    })).toThrow();
    expect(() => parseHostedPlanUsageToolRequest({
      includeTopUpHistory: false,
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
