import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedAiUsageGate: vi.fn(),
  readHostedMemberBillingEligibilityState: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedPersonalUsageCreditOfferCodes: vi.fn(),
  isHostedBillingPlanSelectionAvailable: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  readHostedPublicBaseUrl: () => null,
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

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    stripePriceIdsByPlan: {
      launch_group_monthly: "price_group_test",
    },
  }),
  isHostedBillingPlanSelectionAvailable:
    mocks.isHostedBillingPlanSelectionAvailable,
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
const MAX_PORTAL_CONFIGURATION_ENV =
  "HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_MAX_MONTHLY";
const originalMaxPortalConfiguration =
  process.env[MAX_PORTAL_CONFIGURATION_ENV];

describe("readHostedPersonalAiUsageStatus", () => {
  afterEach(() => {
    if (originalMaxPortalConfiguration === undefined) {
      delete process.env[MAX_PORTAL_CONFIGURATION_ENV];
    } else {
      process.env[MAX_PORTAL_CONFIGURATION_ENV] =
        originalMaxPortalConfiguration;
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHostedBillingPlanSelectionAvailable.mockResolvedValue(true);
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
      currentPeriodEnd: PERIOD_END,
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
    });
  });

  it("projects the authoritative scheduled plan for the private plan tool", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: PERIOD_END,
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingEffectiveAt:
        new Date("2026-08-01T00:00:00.000Z"),
      scheduledBillingPlanCode: "launch_group_monthly",
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeScheduledPlan: true,
      memberId: "member_scheduled_group",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      planCode: "launch_monthly",
      planName: "Pulse",
      scheduledPlan: {
        code: "launch_group_monthly",
        displayName: "Group",
        effectiveAt: "2026-08-01T00:00:00.000Z",
      },
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
      availablePlans: [
        {
          code: "launch_monthly",
          displayName: "Pulse",
          monthlyPriceUsdCents: 800,
          selectable: true,
        },
      ],
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
      recommendedPlanCode: "launch_monthly",
      recommendedAction: {
        kind: "change_plan",
        label: "Keep Pulse after your trial ($8/month)",
        targetPlanCode: "launch_monthly",
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
        action: "change_plan",
        label: "Upgrade to Edge ($20/month)",
        targetPlanCode: "launch_edge_monthly",
        timing: "immediate",
      },
      usedPercent: 10,
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberBillingEligibilityState).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).not.toHaveBeenCalled();
  });

  it.each([
    {
      currentPlanCode: "launch_monthly" as const,
      expectedTiming: "period_end" as const,
      label: "Switch to Core ($3.50/month)",
      requestedTargetPlanCode: "launch_group_monthly" as const,
    },
    {
      currentPlanCode: "launch_group_monthly" as const,
      expectedTiming: "immediate" as const,
      label: "Upgrade to Edge ($20/month)",
      requestedTargetPlanCode: "launch_edge_monthly" as const,
    },
  ])(
    "quotes the explicit paid $currentPlanCode to $requestedTargetPlanCode choice without an advertised catalog",
    async ({
      currentPlanCode,
      expectedTiming,
      label,
      requestedTargetPlanCode,
    }) => {
      mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce({
        currentBillingPhase: "paid",
        currentBillingPlanCode: currentPlanCode,
        currentCheckoutOffer: "standard",
        currentPeriodEnd: PERIOD_END,
        hasStripeCustomerId: true,
        hasStripeSubscriptionId: true,
        scheduledBillingEffectiveAt: null,
        scheduledBillingPlanCode: null,
      });
      mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
        allowanceSource: "direct_paid_member_plan",
        billingPlanCode: currentPlanCode,
        remainingUsdMicros: 9_000_000n,
        spentUsdMicros: 1_000_000n,
      }));

      const result = await readHostedPersonalAiUsageStatus({
        includeSubscriptionActionQuote: true,
        memberId: "member_usage_explicit_paid_choice",
        now: NOW,
        prisma: buildPrisma(null, true) as never,
        publicBaseUrl: null,
        subscriptionActionTargetPlanCode: requestedTargetPlanCode,
      });

      expect(result).toMatchObject({
        subscriptionActionQuote: {
          action: "change_plan",
          label,
          targetPlanCode: requestedTargetPlanCode,
          timing: expectedTiming,
        },
      });
      expect(result).not.toHaveProperty("availablePlans");
    },
  );

  it("quotes Max only from an explicit Edge request with the exact portal configured", async () => {
    process.env[MAX_PORTAL_CONFIGURATION_ENV] = "bpc_max";
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: PERIOD_END,
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      billingPlanCode: "launch_edge_monthly",
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_usage_explicit_max",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
      subscriptionActionTargetPlanCode: "launch_max_monthly",
    })).resolves.toMatchObject({
      recommendedAction: null,
      subscriptionActionQuote: {
        action: "change_plan",
        label: "Upgrade to Max ($50/month)",
        monthlyPriceUsdCents: 5_000,
        targetPlanCode: "launch_max_monthly",
        timing: "immediate",
      },
    });
  });

  it("fails closed when an explicit Max request lacks its exact portal configuration", async () => {
    delete process.env[MAX_PORTAL_CONFIGURATION_ENV];
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: PERIOD_END,
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      billingPlanCode: "launch_edge_monthly",
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_usage_unconfigured_max",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
      subscriptionActionTargetPlanCode: "launch_max_monthly",
    })).resolves.toMatchObject({
      recommendedAction: null,
      subscriptionActionQuote: null,
    });
    expect(mocks.isHostedBillingPlanSelectionAvailable).not.toHaveBeenCalled();
  });

  it("keeps high-usage Edge recovery on add usage instead of auto-recommending Max", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_500_000n,
      spentUsdMicros: 8_500_000n,
    }));

    const result = await readHostedPersonalAiUsageStatus({
      memberId: "member_usage_edge_add_usage",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: "https://example.test",
    });

    expect(result).toMatchObject({
      recommendedAction: {
        kind: "add_usage",
      },
    });
    expect(result).not.toHaveProperty("subscriptionActionQuote");
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
  });

  it("keeps Pulse as the default paid recommendation from Group", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_group_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: PERIOD_END,
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      allowanceSource: "direct_paid_member_plan",
      billingPlanCode: "launch_group_monthly",
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      spentUsdMicros: 10_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_usage_group_default",
      now: NOW,
      prisma: buildPrisma(null, true) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      recommendedAction: {
        kind: "change_plan",
        targetPlanCode: "launch_monthly",
      },
    });
  });

  it("does not quote a second paid plan change while one is scheduled", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      scheduledBillingPlanCode: "launch_group_monthly",
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_usage_scheduled_change",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      recommendedAction: null,
      subscriptionActionQuote: null,
      usedPercent: 10,
    });
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
        action: "change_plan",
        label: "Keep Pulse after your trial ($8/month)",
        targetPlanCode: "launch_monthly",
        timing: "at_trial_end",
      },
      usedPercent: 10,
    });
  });

  it("keeps an exhausted active trial on its natural end-date Group timing", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      allowanceSource: "direct_trial",
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      spentUsdMicros: 10_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      includeSubscriptionActionQuote: true,
      memberId: "member_exhausted_trial_group",
      now: NOW,
      prisma: buildPrisma(null, true) as never,
      publicBaseUrl: "https://example.test",
    })).resolves.toMatchObject({
      recommendedAction: {
        kind: "change_plan",
        targetPlanCode: "launch_group_monthly",
      },
      status: "exhausted",
      subscriptionActionQuote: {
        targetPlanCode: "launch_group_monthly",
        timing: "at_trial_end",
      },
    });
  });

  it("does not resolve an unused plan action for Settings usage status", async () => {
    mocks.readHostedMemberBillingEligibilityState.mockResolvedValue({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    });
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowed: false,
      allowanceSource: "direct_trial",
      reason: "ai_usage_limit_exceeded",
      remainingUsdMicros: 0n,
      spentUsdMicros: 10_000_000n,
    }));

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_exhausted_trial_settings",
      now: NOW,
      prisma: buildPrisma(null, true) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      recommendedAction: null,
      status: "exhausted",
    });
    expect(mocks.isHostedBillingPlanSelectionAvailable).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
  });

  it("omits the quote field for callers that keep the original empty request shape", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      allowanceSource: "direct_paid_member_plan",
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 9_000_000n,
      spentUsdMicros: 1_000_000n,
    }));

    const result = await readHostedPersonalAiUsageStatus({
      memberId: "member_usage_legacy_shape",
      now: NOW,
      prisma: buildPrisma(null) as never,
      publicBaseUrl: null,
    });

    expect(result).not.toHaveProperty("subscriptionActionQuote");
    expect(result).toMatchObject({
      recommendedAction: null,
      usedPercent: 10,
    });
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingEligibilityState).not.toHaveBeenCalled();
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
    })).resolves.toMatchObject({
      availablePlans: [
        {
          code: "launch_monthly",
          displayName: "Pulse",
          monthlyPriceUsdCents: 800,
          selectable: true,
        },
      ],
      generatedAt: NOW.toISOString(),
      reason: "trial_conversion_pending",
      recommendedPlanCode: "launch_monthly",
      recommendedAction: {
        kind: "change_plan",
        label: "Start Pulse now ($8/month)",
        targetPlanCode: "launch_monthly",
        url: "https://example.test/settings#subscription",
      },
      subscriptionActionQuote: {
        action: "change_plan",
        label: "Start Pulse now ($8/month)",
        monthlyPriceUsdCents: 800,
        targetPlanCode: "launch_monthly",
        timing: "now",
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

  it("starts a fresh overall usage meter immediately after a top-up", async () => {
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
      prisma: buildPrisma(null, {
        latestPurchaseGrantAt: new Date("2026-07-03T11:00:00.000Z"),
        spentSincePurchaseUsdMicros: 0n,
      }) as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      forecast: null,
      recommendedAction: null,
      remainingPercent: 100,
      status: "active",
      usedPercent: 0,
    });
  });

  it("advances the fresh meter only with usage recorded after the top-up", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 3_000_000n,
      spentUsdMicros: 10_000_000n,
      usageCreditBalanceUsdMicros: 3_000_000n,
      usageCreditLedgerVersion: 6n,
    }));
    const prisma = buildPrisma(
      new Date("2026-07-03T11:30:00.000Z"),
      {
        latestPurchaseGrantAt: new Date("2026-07-03T11:00:00.000Z"),
        spentSincePurchaseUsdMicros: 2_000_000n,
      },
    );

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_recent_top_up_usage",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      forecast: null,
      remainingPercent: 60,
      status: "active",
      usedPercent: 40,
    });
    expect(prisma.hostedUsageCreditEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          beneficiarySequence: { lte: 6n },
          kind: "purchase_grant",
        }),
      }),
    );
    expect(prisma.hostedAiUsage.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          occurredAt: {
            gt: new Date("2026-07-03T11:00:00.000Z"),
            lte: NOW,
          },
        }),
      }),
    );
  });

  it("uses the later plan reset as the usage meter boundary", async () => {
    const planResetAt = new Date("2026-07-03T12:00:00.000Z");
    mocks.readHostedAiUsageGate.mockResolvedValue(buildDecision({
      limitUsdMicros: 16_000_000n,
      planResetAt,
      remainingUsdMicros: 12_000_000n,
      spentUsdMicros: 4_000_000n,
      usageCreditBalanceUsdMicros: 5_000_000n,
      usageCreditLedgerVersion: 6n,
    }));
    const prisma = buildPrisma(null, {
      latestPurchaseGrantAt: new Date("2026-07-02T12:00:00.000Z"),
      spentSincePurchaseUsdMicros: 4_000_000n,
    });

    await expect(readHostedPersonalAiUsageStatus({
      memberId: "member_plan_reset_usage",
      now: NOW,
      prisma: prisma as never,
      publicBaseUrl: null,
    })).resolves.toMatchObject({
      remainingPercent: 75,
      usedPercent: 25,
    });

    expect(prisma.hostedAiUsage.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          occurredAt: {
            gt: planResetAt,
            lte: NOW,
          },
        }),
      }),
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

function buildPrisma(
  firstUsageAt: Date | null,
  usageContext: boolean | {
    latestPurchaseGrantAt: Date;
    spentSincePurchaseUsdMicros: bigint;
  } | null = null,
) {
  const hasConfirmedGroupMembership = usageContext === true;
  const usageMeter =
    usageContext !== null && typeof usageContext === "object"
      ? usageContext
      : null;
  return {
    hostedAiUsage: {
      aggregate: vi.fn(async () => ({
        _sum: {
          allowanceCostUsdMicros:
            usageMeter?.spentSincePurchaseUsdMicros ?? null,
        },
      })),
      findFirst: vi.fn(async () => firstUsageAt
        ? { occurredAt: firstUsageAt }
        : null),
    },
    hostedUsageCreditEntry: {
      findFirst: vi.fn(async () => usageMeter
        ? { effectiveAt: usageMeter.latestPurchaseGrantAt }
        : null),
    },
    hostedGroupMember: {
      findFirst: vi.fn(async () =>
        hasConfirmedGroupMembership ? { id: "hgm_confirmed" } : null),
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
  billingPlanCode?:
    | "launch_edge_monthly"
    | "launch_group_monthly"
    | "launch_monthly";
  limitUsdMicros?: bigint;
  reason?:
    | "ai_usage_limit_exceeded"
    | "hosted_access_inactive"
    | "trial_expired_pending_billing";
  remainingUsdMicros?: bigint;
  planResetAt?: Date | null;
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
    planResetAt: input.planResetAt ?? null,
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
            : common.billingPlanCode === "launch_group_monthly"
              ? "group_upgrade_pulse"
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
