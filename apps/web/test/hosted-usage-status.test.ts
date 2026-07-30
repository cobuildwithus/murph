import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedAiUsageGate: vi.fn(),
  readHostedMemberBillingEligibilityState: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedPersonalUsageCreditOfferCodes: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: () => "https://example.test",
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberBillingEligibilityState: mocks.readHostedMemberBillingEligibilityState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/personal-usage-credit-eligibility", () => ({
  readHostedPersonalUsageCreditOfferCodes:
    mocks.readHostedPersonalUsageCreditOfferCodes,
}));

import {
  projectHostedPersonalAiUsageStatus,
  readHostedPersonalAiUsageStatus,
} from "@/src/lib/hosted-execution/usage-status";
import type {
  HostedAiUsageGateDecisionWithSource,
} from "@/src/lib/hosted-execution/usage-allowance";

const NOW = new Date("2026-07-03T12:00:00.000Z");
const PERIOD_START = new Date("2026-07-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-07-11T00:00:00.000Z");

describe("readHostedPersonalAiUsageStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValue([
      "usage_10_usd",
    ]);
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "active",
      suspendedAt: null,
    });
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
  });

  it("returns an evidence-backed trial forecast and server-selected Pulse action", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_trial",
      limitUsdMicros: 4_500_000n,
      remainingUsdMicros: 2_250_000n,
      spentUsdMicros: 2_250_000n,
    }));
    const prisma = buildPrisma(new Date("2026-07-01T12:00:00.000Z"));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_usage_1",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toEqual({
      accessKind: "trial",
      forecast: {
        estimatedDaysRemaining: 2,
        estimatedExhaustionAt: "2026-07-05T12:00:00.000Z",
      },
      generatedAt: NOW.toISOString(),
      periodEnd: PERIOD_END.toISOString(),
      periodKind: "trial",
      periodStart: PERIOD_START.toISOString(),
      planCode: "launch_monthly",
      planName: "Pulse Trial",
      recommendedAction: {
        kind: "start_pulse",
        label: "Start Pulse now ($8/month)",
        url: "https://example.test/settings#subscription",
      },
      remainingPercent: 50,
      status: "active",
      usedPercent: 50,
    });
  });

  it("recommends adding usage for an eligible paid Pulse member after the usage threshold", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_500_000n,
      spentUsdMicros: 8_500_000n,
    }));

    const result = await readHostedPersonalAiUsageStatus({
      memberId: "member_usage_2",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    });

    expect(result).toMatchObject({
      accessKind: "paid",
      planName: "Pulse",
      recommendedAction: {
        kind: "add_usage",
        label: "Add usage",
        url: "/settings?addUsage=true#subscription",
      },
      remainingPercent: 15,
      status: "active",
      usedPercent: 85,
    });
    expect(JSON.stringify(result)).not.toMatch(/UsdMicros|token|dollar/iu);
    expect(JSON.stringify(result)).not.toContain("price_usage_10");
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).toHaveBeenCalledWith({
      memberId: "member_usage_2",
      prisma: expect.any(Object),
    });
  });

  it("does not recommend adding usage when no canonical offer is configured", async () => {
    mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValue([]);
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_500_000n,
      spentUsdMicros: 8_500_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_usage_no_top_up_offers",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      recommendedAction: null,
      status: "active",
      usedPercent: 85,
    });
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).toHaveBeenCalledTimes(1);
  });

  it("returns current Edge terms for an explicit request below the recommendation threshold", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_usage_explicit_edge",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      recommendedAction: null,
      subscriptionActionQuote: {
        action: "upgrade_edge",
        label: "Upgrade to Edge ($20/month)",
      },
      usedPercent: 10,
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberBillingEligibilityState).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).not.toHaveBeenCalled();
  });

  it("returns current Pulse terms for an explicit trial request below the recommendation threshold", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_trial",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_usage_explicit_pulse",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      recommendedAction: null,
      subscriptionActionQuote: {
        action: "start_pulse_now",
        label: "Start Pulse now ($8/month)",
      },
      usedPercent: 10,
    });
  });

  it("omits the quote field for callers that keep the original empty request shape", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));
    const prisma = buildPrisma(null);

    const result = await readHostedPersonalAiUsageStatus({
      memberId: "member_usage_legacy_shape",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: null,
    });

    expect(result).not.toHaveProperty("subscriptionActionQuote");
    expect(result).toMatchObject({
      recommendedAction: null,
      usedPercent: 10,
    });
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
    expect(prisma.hostedUsageCreditEntry.findMany).not.toHaveBeenCalled();
    expect(prisma.hostedUsageCreditEntry.count).not.toHaveBeenCalled();
    expect(prisma.hostedUsageCreditEntry.groupBy).not.toHaveBeenCalled();
  });

  it("keeps paid add-usage actions available without a public base URL", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_500_000n,
      spentUsdMicros: 8_500_000n,
    }));

    const result = await readHostedPersonalAiUsageStatus({
      memberId: "member_usage_no_public_url",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    });

    expect(result).toMatchObject({
      recommendedAction: {
        kind: "add_usage",
        url: "/settings?addUsage=true#subscription",
      },
      status: "active",
      usedPercent: 85,
    });
    expect(result).not.toHaveProperty("subscriptionActionQuote");
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).toHaveBeenCalledTimes(1);
  });

  it("avoids trial action-state fanout without a public action URL", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      allowanceSource: "direct_trial",
      reason: "trial_expired_pending_billing",
      spentUsdMicros: 0n,
    }));

    const result = await readHostedPersonalAiUsageStatus({
      memberId: "member_trial_no_public_url",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    });

    expect(result).toMatchObject({
      reason: "trial_conversion_pending",
      recommendedAction: null,
      status: "unavailable",
    });
    expect(result).not.toHaveProperty("subscriptionActionQuote");
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
  });

  it("does not recommend adding usage when the paid billing state is ineligible", async () => {
    mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValue([]);
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: null,
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_500_000n,
      spentUsdMicros: 8_500_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_legacy",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      recommendedAction: null,
      status: "active",
    });
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    "does not recommend adding usage with incomplete Stripe billing references",
    async (hasStripeCustomerId, hasStripeSubscriptionId) => {
      mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValue([]);
      mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        hasStripeCustomerId,
        hasStripeSubscriptionId,
      });
      mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
        allowanceSource: "direct_paid_member_plan",
        limitUsdMicros: 10_000_000n,
        remainingUsdMicros: 1_500_000n,
        spentUsdMicros: 8_500_000n,
      }));

      await expect(readHostedPersonalAiUsageStatus({
        includeSubscriptionActionQuote: true,
        memberId: "member_usage_incomplete",
        now: NOW,
        prisma: buildPrisma(null) as never,
        publicBaseUrl: "https://example.test",
      })).resolves.toMatchObject({
        recommendedAction: null,
        subscriptionActionQuote: null,
        usedPercent: 85,
      });
    },
  );

  it("keeps exhausted paid usage available when top-up eligibility cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readHostedPersonalUsageCreditOfferCodes.mockRejectedValueOnce(
      new Error("private eligibility read failed"),
    );
    const prisma = buildPrisma(null);

    try {
      await expect(projectHostedPersonalAiUsageStatus({
        decision: buildDecision({
          allowed: false,
          reason: "ai_usage_limit_exceeded",
          remainingUsdMicros: 0n,
          spentUsdMicros: 10_000_000n,
        }),
        memberId: "member_usage_action_failure",
        now: NOW,
        prisma: prisma as never,
        publicBaseUrl: "https://example.test",
      })).resolves.toMatchObject({
        recommendedAction: null,
        remainingPercent: 0,
        status: "exhausted",
        usedPercent: 100,
      });
      expect(warn).toHaveBeenCalledWith(
        "Hosted personal usage-credit eligibility resolution failed.",
        {
          errorName: "Error",
          planCode: "launch_monthly",
        },
      );
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(
        /member_usage_action_failure|private eligibility read failed/u,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("offers Edge add-usage without inventing a subscription quote or a Family action", async () => {
    const prisma = buildPrisma(null);
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 1_000_000n,
      spentUsdMicros: 24_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_edge",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      accessKind: "paid",
      planName: "Edge",
      recommendedAction: {
        kind: "add_usage",
        label: "Add usage",
        url: "/settings?addUsage=true#subscription",
      },
      subscriptionActionQuote: null,
    });

    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "family_sponsored_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 500_000n,
      spentUsdMicros: 9_500_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_family",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      accessKind: "family_sponsored",
      planName: "Family",
      recommendedAction: null,
      subscriptionActionQuote: null,
    });
  });

  it("represents zero and exhausted usage without percentage overflow", async () => {
    const prisma = buildPrisma(null);
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      remainingUsdMicros: 10_000_000n,
      spentUsdMicros: 0n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_zero",
      now: NOW,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      forecast: null,
      remainingPercent: 100,
      status: "active",
      usedPercent: 0,
    });

    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      spentUsdMicros: 12_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_exhausted",
      now: NOW,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      forecast: null,
      remainingPercent: 0,
      status: "exhausted",
      usedPercent: 100,
    });
  });

  it("omits a forecast until at least one full day of usage is observed", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      remainingUsdMicros: 5_000_000n,
      spentUsdMicros: 5_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_early",
      now: NOW,
      prisma: buildPrisma(new Date("2026-07-03T00:00:00.000Z")) as never,
    })).resolves.toMatchObject({
      forecast: null,
      recommendedAction: null,
    });
  });

  it("omits a forecast when the projected date is outside the JavaScript date range", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 24_999_999n,
      spentUsdMicros: 1n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_low_spend",
      now: NOW,
      prisma: buildPrisma(new Date(NOW.getTime() - (4 * 24 * 60 * 60 * 1_000))) as never,
    })).resolves.toMatchObject({
      forecast: null,
      status: "active",
    });
  });

  it("keeps personal billing details unavailable to thread-container runtimes", async () => {
    const prisma = buildPrisma(null);
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "thread_container",
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      includeTopUpHistory: true,
      memberId: "thread_runtime",
      now: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({
      generatedAt: NOW.toISOString(),
      reason: "group_not_supported",
      recommendedAction: null,
      subscriptionActionQuote: null,
      status: "unavailable",
    });
    expect(prisma.hostedAiUsage.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedUsageCreditEntry.count).not.toHaveBeenCalled();
  });

  it("returns no subscription quote for inactive hosted access", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      reason: "hosted_access_inactive",
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_inactive",
      now: NOW,
      prisma: buildPrisma(null) as never,
    })).resolves.toEqual({
      generatedAt: NOW.toISOString(),
      reason: "hosted_access_inactive",
      recommendedAction: null,
      subscriptionActionQuote: null,
      status: "unavailable",
    });
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
  });

  it("returns a conversion path for an ended trial without inventing usage", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "paused",
      suspendedAt: null,
    });
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      allowanceSource: "direct_trial",
      reason: "trial_expired_pending_billing",
      spentUsdMicros: 0n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_trial_ended",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toEqual({
      generatedAt: NOW.toISOString(),
      reason: "trial_conversion_pending",
      recommendedAction: {
        kind: "start_pulse",
        label: "Start Pulse now ($8/month)",
        url: "https://example.test/settings#subscription",
      },
      subscriptionActionQuote: {
        action: "start_pulse_now",
        label: "Start Pulse now ($8/month)",
      },
      status: "unavailable",
    });
  });

  it("does not recommend trial conversion without complete billing references", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "paused",
      suspendedAt: null,
    });
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: false,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      allowanceSource: "direct_trial",
      reason: "trial_expired_pending_billing",
      spentUsdMicros: 0n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_trial_incomplete",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toEqual({
      generatedAt: NOW.toISOString(),
      reason: "trial_conversion_pending",
      recommendedAction: null,
      subscriptionActionQuote: null,
      status: "unavailable",
    });
  });

  it("keeps trial conversion available when billing action state cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "paused",
      suspendedAt: null,
    });
    mocks.readHostedMemberBillingEligibilityState.mockRejectedValueOnce(
      new Error("private billing read failed"),
    );

    try {
      await expect(projectHostedPersonalAiUsageStatus({
        decision: buildDecision({
          allowed: false,
          allowanceSource: "direct_trial",
          reason: "trial_expired_pending_billing",
          spentUsdMicros: 0n,
        }),
        memberId: "member_trial_action_failure",
        now: NOW,
        prisma: buildPrisma(null) as never,
        publicBaseUrl: "https://example.test",
      })).resolves.toEqual({
        generatedAt: NOW.toISOString(),
        reason: "trial_conversion_pending",
        recommendedAction: null,
        status: "unavailable",
      });
      expect(warn).toHaveBeenCalledWith(
        "Hosted plan usage action resolution failed.",
        {
          accessKind: "trial",
          errorName: "Error",
          planCode: "launch_monthly",
        },
      );
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(
        /member_trial_action_failure|private billing read failed/u,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("projects an already-resolved exhausted allowance without re-reading it", async () => {
    const decision = buildDecision({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      spentUsdMicros: 10_000_000n,
    });

    await expect(projectHostedPersonalAiUsageStatus({
      decision,
      memberId: "member_usage",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      recommendedAction: {
        kind: "add_usage",
        label: "Add usage",
        url: "/settings?addUsage=true#subscription",
      },
      remainingPercent: 0,
      status: "exhausted",
      usedPercent: 100,
    });
    expect(mocks.readHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("folds generic usage credit into one source-agnostic percentage", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 3_000_000n,
      spentUsdMicros: 10_000_000n,
      usageCreditBalanceUsdMicros: 3_000_000n,
      usageCreditLedgerVersion: 4n,
    }));

    const result = await readHostedPersonalAiUsageStatus({
      memberId: "member_credit_backed",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    });

    expect(result).toMatchObject({
      recommendedAction: null,
      remainingPercent: 24,
      status: "active",
      usedPercent: 76,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /included|purchase|referral|usageCredit/iu,
    );
  });

  it("moves the overall usage bar backward immediately after a top-up", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 6_700_000n,
      spentUsdMicros: 8_300_000n,
      usageCreditBalanceUsdMicros: 5_000_000n,
      usageCreditLedgerVersion: 4n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_recent_top_up",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      forecast: null,
      recommendedAction: null,
      remainingPercent: 45,
      status: "active",
      usedPercent: 55,
    });
  });

  it("projects bounded beneficiary top-ups with usage and adjustments", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 6_700_000n,
      spentUsdMicros: 8_300_000n,
      usageCreditBalanceUsdMicros: 5_000_000n,
      usageCreditLedgerVersion: 4n,
    }));
    const prisma = buildPrisma(null);
    prisma.hostedUsageCreditEntry.count.mockResolvedValue(2);
    prisma.hostedUsageCreditEntry.findMany.mockResolvedValue([
      {
        amountUsdMicros: 5_000_000n,
        effectiveAt: new Date("2026-07-29T14:23:42.000Z"),
        grant: { remainingUsdMicros: 3_500_000n },
        id: "grant_self",
        purchase: { payerMemberId: "member_top_up_history" },
      },
      {
        amountUsdMicros: 10_000_000n,
        effectiveAt: new Date("2026-07-27T20:38:45.000Z"),
        grant: { remainingUsdMicros: 0n },
        id: "grant_family",
        purchase: { payerMemberId: "member_family_owner" },
      },
    ]);
    prisma.hostedUsageCreditEntry.groupBy.mockResolvedValue([
      {
        _sum: { amountUsdMicros: -1_200_000n },
        parentGrantEntryId: "grant_self",
      },
      {
        _sum: { amountUsdMicros: -10_000_000n },
        parentGrantEntryId: "grant_family",
      },
    ]);

    const result = await readHostedPersonalAiUsageStatus({
      includeTopUpHistory: true,
      memberId: "member_top_up_history",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: null,
    });

    expect(result).toMatchObject({
      topUpHistory: {
        hasMore: false,
        topUps: [
          {
            addedUsd: "5.000000",
            adjustedUsd: "0.300000",
            creditedAt: "2026-07-29T14:23:42.000Z",
            remainingUsd: "3.500000",
            source: "purchased_by_you",
            usedUsd: "1.200000",
          },
          {
            addedUsd: "10.000000",
            adjustedUsd: "0.000000",
            creditedAt: "2026-07-27T20:38:45.000Z",
            remainingUsd: "0.000000",
            source: "added_for_you",
            usedUsd: "10.000000",
          },
        ],
        totalCount: 2,
      },
    });
    expect(prisma.hostedUsageCreditEntry.count).toHaveBeenCalledWith({
      where: {
        beneficiaryMemberId: "member_top_up_history",
        kind: "purchase_grant",
      },
    });
    expect(prisma.hostedUsageCreditEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        where: {
          beneficiaryMemberId: "member_top_up_history",
          kind: "purchase_grant",
        },
      }),
    );
    expect(prisma.hostedUsageCreditEntry.groupBy).toHaveBeenCalledWith({
      _sum: { amountUsdMicros: true },
      by: ["parentGrantEntryId"],
      where: {
        kind: "usage_debit",
        parentGrantEntryId: {
          in: ["grant_self", "grant_family"],
        },
      },
    });
  });

  it("reads aggregate usage and top-up history in one repeatable snapshot", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision());
    const tx = buildPrisma(null);
    const prisma = {
      ...buildPrisma(null),
      $transaction: vi.fn(async (
        callback: (client: typeof tx) => Promise<unknown>,
        options: { isolationLevel: string },
      ) => callback(tx)),
    };

    await readHostedPersonalAiUsageStatus({
      includeTopUpHistory: true,
      memberId: "member_snapshot",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: null,
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "RepeatableRead" },
    );
    expect(tx.hostedUsageCreditEntry.findMany).toHaveBeenCalledOnce();
    expect(tx.hostedUsageCreditEntry.count).toHaveBeenCalledOnce();
  });

  it("returns the newest 50 top-ups with exact over-limit metadata", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision());
    const prisma = buildPrisma(null);
    const entries = Array.from({ length: 50 }, (_, index) => ({
      amountUsdMicros: 1_000_000n,
      effectiveAt: new Date(Date.UTC(2026, 6, 29 - index)),
      grant: { remainingUsdMicros: 1_000_000n },
      id: `grant_${String(index).padStart(2, "0")}`,
      purchase: { payerMemberId: "member_history_boundary" },
    }));
    prisma.hostedUsageCreditEntry.findMany.mockResolvedValue(entries);
    prisma.hostedUsageCreditEntry.count.mockResolvedValue(51);

    const result = await readHostedPersonalAiUsageStatus({
      includeTopUpHistory: true,
      memberId: "member_history_boundary",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: null,
    });

    expect(prisma.hostedUsageCreditEntry.findMany).toHaveBeenCalledWith({
      orderBy: [
        { beneficiarySequence: "desc" },
        { id: "desc" },
      ],
      select: expect.any(Object),
      take: 50,
      where: {
        beneficiaryMemberId: "member_history_boundary",
        kind: "purchase_grant",
      },
    });
    expect(result).toMatchObject({
      topUpHistory: {
        hasMore: true,
        totalCount: 51,
      },
    });
    if (!("topUpHistory" in result) || !result.topUpHistory) {
      throw new Error("Expected expanded top-up history.");
    }
    expect(result.topUpHistory.topUps).toHaveLength(50);
    expect(result.topUpHistory.topUps[0]?.creditedAt).toBe(
      entries[0]?.effectiveAt.toISOString(),
    );
    expect(result.topUpHistory.topUps[49]?.creditedAt).toBe(
      entries[49]?.effectiveAt.toISOString(),
    );
  });

  it("forecasts exhaustion against overall available capacity", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 7_000_000n,
      spentUsdMicros: 8_000_000n,
      usageCreditBalanceUsdMicros: 5_000_000n,
      usageCreditLedgerVersion: 4n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_credit_forecast",
      now: NOW,
      prisma: buildPrisma(new Date("2026-07-01T12:00:00.000Z")) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      forecast: {
        estimatedDaysRemaining: 2,
        estimatedExhaustionAt: "2026-07-05T06:00:00.000Z",
      },
      remainingPercent: 47,
      status: "active",
      usedPercent: 53,
    });
  });

});

function buildPrisma(firstUsageAt: Date | null) {
  return {
    hostedAiUsage: {
      findFirst: vi.fn(async () => firstUsageAt
        ? { occurredAt: firstUsageAt }
        : null),
    },
    hostedUsageCreditEntry: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      groupBy: vi.fn(async (): Promise<unknown[]> => []),
    },
  };
}

function buildDecision(input: {
  allowed?: boolean;
  allowanceSource?:
    | "direct_paid_member_plan"
    | "direct_trial"
    | "family_sponsored_plan"
    | "thread_container";
  billingPlanCode?: "launch_edge_monthly" | "launch_monthly";
  limitUsdMicros?: bigint;
  reason?:
    | "ai_usage_limit_exceeded"
    | "hosted_access_inactive"
    | "trial_expired_pending_billing";
  remainingUsdMicros?: bigint;
  spentUsdMicros?: bigint;
  usageCreditBalanceUsdMicros?: bigint;
  usageCreditLedgerVersion?: bigint;
} = {}): HostedAiUsageGateDecisionWithSource {
  const allowed = input.allowed ?? true;
  const common = {
    allowanceSource: input.allowanceSource ?? "direct_paid_member_plan",
    billingPlanCode: input.billingPlanCode ?? "launch_monthly",
    limitUsdMicros: input.limitUsdMicros ?? 10_000_000n,
    memberId: "member_usage",
    periodEnd: PERIOD_END,
    periodStart: PERIOD_START,
    remainingUsdMicros: input.remainingUsdMicros ?? 5_000_000n,
    spentUsdMicros: input.spentUsdMicros ?? 5_000_000n,
    usageCreditBalanceUsdMicros: input.usageCreditBalanceUsdMicros ?? 0n,
    usageCreditLedgerVersion: input.usageCreditLedgerVersion ?? 0n,
  };
  if (allowed) {
    return {
      ...common,
      allowed: true,
    };
  }

  const reason = input.reason ?? "hosted_access_inactive";
  if (reason === "ai_usage_limit_exceeded") {
    return {
      ...common,
      allowed: false,
      reason,
      retryAfter: PERIOD_END,
      userNotice: {
        code: common.allowanceSource === "direct_trial"
          ? "trial_usage_limit_reached"
          : common.billingPlanCode === "launch_edge_monthly"
            ? "edge_usage_limit_reached"
            : "pulse_upgrade_edge",
        message: "Included usage is exhausted.",
      },
    };
  }

  return {
    ...common,
    allowed: false,
    reason,
    retryAfter: PERIOD_END,
    userNotice: null,
  };
}
