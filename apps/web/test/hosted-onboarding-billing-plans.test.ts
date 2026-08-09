import { describe, expect, it } from "vitest";

import {
  canScheduleHostedBillingPlanChange,
  canUpgradeHostedBillingPlan,
  formatHostedLandingPricingLongSummary,
  formatHostedLandingPricingShortSummary,
  getHostedAiUsageMonthlyAllowanceUsdMicros,
  getHostedBillingPlanDefinition,
  getHostedFamilyAiUsageMonthlyAllowanceForPlan,
  HOSTED_FAMILY_MAX_SEATS,
  HOSTED_FAMILY_MIN_SEATS,
  HOSTED_FAMILY_PLAN_DISPLAY,
  isHostedBillingPlanScheduledDowngrade,
  listHostedBillingPlanPresentations,
  parseHostedBillingCheckoutOffer,
  requireHostedPulseTrialPolicy,
  resolveConfiguredHostedBillingPlanCodes,
  resolveHostedBillingReady,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  buildHostedBillingCheckoutLineItems,
} from "@/src/lib/hosted-onboarding/billing-service";

describe("hosted billing plans", () => {
  const basePriceIds = {
    launch_edge_monthly: "price_base_edge_monthly",
    launch_monthly: "price_base_monthly",
  };

  it("keeps pricing and paid allowance definitions canonical", () => {
    expect(getHostedBillingPlanDefinition("launch_monthly")).toMatchObject({
      badge: null,
      displayName: "Pulse",
      recurringAmountUsdCents: 800,
    });
    expect(getHostedBillingPlanDefinition("launch_edge_monthly")).toMatchObject({
      badge: null,
      displayName: "Edge",
      recurringAmountUsdCents: 2_000,
    });
    expect(getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly"))
      .toBe(6_400_000n);
    expect(getHostedAiUsageMonthlyAllowanceUsdMicros("launch_edge_monthly"))
      .toBe(16_000_000n);
  });

  it("keeps Family as per-seat sponsored billing outside direct plans", () => {
    expect(HOSTED_FAMILY_MIN_SEATS).toBe(2);
    expect(HOSTED_FAMILY_MAX_SEATS).toBe(6);
    expect(HOSTED_FAMILY_PLAN_DISPLAY).toMatchObject({
      displayName: "Family",
      maxSeats: 6,
      minSeats: 2,
      plans: [
        { code: "pulse", recurringAmountUsdCents: 700 },
        { code: "edge", recurringAmountUsdCents: 1_900 },
      ],
      recurringAmountUsdCentsPerSeat: 700,
    });
    expect(getHostedFamilyAiUsageMonthlyAllowanceForPlan("pulse"))
      .toBe(5_600_000n);
    expect(getHostedFamilyAiUsageMonthlyAllowanceForPlan("edge"))
      .toBe(15_200_000n);
  });

  it("allows only paid subscriptions to manage plan transitions", () => {
    expect(canUpgradeHostedBillingPlan({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      targetPlanCode: "launch_edge_monthly",
    })).toBe(true);
    expect(canUpgradeHostedBillingPlan({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      targetPlanCode: "launch_edge_monthly",
    })).toBe(false);
    expect(canScheduleHostedBillingPlanChange({
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      targetPlanCode: "launch_monthly",
    })).toBe(true);
    expect(canScheduleHostedBillingPlanChange({
      billingStatus: "active",
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_edge_monthly",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      targetPlanCode: "launch_monthly",
    })).toBe(false);
  });

  it("keeps old trial metadata parseable only for rollout compatibility", () => {
    expect(parseHostedBillingCheckoutOffer("pulse_trial_7d"))
      .toBe("pulse_trial_7d");
    expect(requireHostedPulseTrialPolicy("pulse-trial-2026-07-15-v3"))
      .toEqual({ durationDays: 14, usageLimitUsdMicros: 4_500_000n });
  });

  it("orders paid downgrades without a trial branch", () => {
    expect(isHostedBillingPlanScheduledDowngrade({
      currentPlanCode: "launch_edge_monthly",
      targetPlanCode: "launch_monthly",
    })).toBe(true);
  });

  it("formats homepage pricing from shared paid-plan definitions", () => {
    expect(formatHostedLandingPricingShortSummary()).toBe("$8/mo");
    expect(formatHostedLandingPricingLongSummary()).toBe("$8/month");
  });

  it("builds direct-plan presentations with canonical prices", () => {
    expect(listHostedBillingPlanPresentations()).toEqual([
      {
        badge: null,
        code: "launch_monthly",
        displayName: "Pulse",
        interval: "month",
        recurringAmountLabel: "$8",
        recurringAmountUsdCents: 800,
        recurringSummary: "$8/mo",
      },
      {
        badge: null,
        code: "launch_edge_monthly",
        displayName: "Edge",
        interval: "month",
        recurringAmountLabel: "$20",
        recurringAmountUsdCents: 2_000,
        recurringSummary: "$20/mo",
      },
    ]);
  });

  it("requires only configured direct-plan prices", () => {
    expect(resolveConfiguredHostedBillingPlanCodes({
      stripePriceIdsByPlan: {
        ...basePriceIds,
        launch_edge_monthly: null,
      },
    })).toEqual(["launch_monthly"]);
    expect(resolveConfiguredHostedBillingPlanCodes({
      stripePriceIdsByPlan: basePriceIds,
    })).toEqual(["launch_monthly", "launch_edge_monthly"]);
  });

  it("marks billing ready with a configured price and Stripe key", () => {
    expect(resolveHostedBillingReady({
      stripePriceIdsByPlan: basePriceIds,
      stripeSecretKey: "sk_test_123",
    })).toBe(true);
    expect(resolveHostedBillingReady({
      stripePriceIdsByPlan: {
        launch_edge_monthly: null,
        launch_monthly: null,
      },
      stripeSecretKey: "sk_test_123",
    })).toBe(false);
  });

  it("builds checkout with only one licensed base item", () => {
    expect(buildHostedBillingCheckoutLineItems("price_base_monthly")).toEqual([
      {
        price: "price_base_monthly",
        quantity: 1,
      },
    ]);
  });
});
