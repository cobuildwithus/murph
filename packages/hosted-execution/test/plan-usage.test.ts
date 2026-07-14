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
      remainingPercent: 75,
      status: "active",
      usedPercent: 25,
    })).toMatchObject({
      accessKind: "trial",
      planName: "Pulse Trial",
    });
  });

  it("parses unavailable group status without personal billing details", () => {
    expect(parseHostedPlanUsageStatus({
      generatedAt: "2026-07-03T12:00:00.000Z",
      reason: "group_not_supported",
      recommendedAction: null,
      status: "unavailable",
    })).toEqual({
      generatedAt: "2026-07-03T12:00:00.000Z",
      reason: "group_not_supported",
      recommendedAction: null,
      status: "unavailable",
    });
  });

  it("rejects extra request and response fields", () => {
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
