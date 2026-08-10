import { describe, expect, it } from "vitest";

import {
  formatHostedLandingPricingLongSummary,
  formatHostedLandingPricingShortSummary,
  canStartHostedPulseTrialPaidPlan,
  canSwitchHostedBillingPlanToPulse,
  canUpgradeHostedBillingPlanToEdge,
  getHostedAiUsageMonthlyAllowanceUsdMicros,
  getHostedBillingPlanDefinition,
  getHostedFamilyAiUsageMonthlyAllowanceForPlan,
  getHostedFamilyBillingOfferDefinition,
  getHostedFamilyBillingPlanCode,
  getHostedFamilyRuntimePlanCode,
  HOSTED_FAMILY_MAX_SEATS,
  HOSTED_FAMILY_MIN_SEATS,
  HOSTED_FAMILY_PLAN_DISPLAY,
  isHostedAutoPulseTrialEnabled,
  isHostedPulseTrialBillingState,
  isHostedPulseTrialCheckoutEnabled,
  listHostedBillingPlanPresentations,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
  parseHostedFamilyPlanCode,
  parseHostedPublicBillingCheckoutOffer,
  requireHostedPulseTrialPolicy,
  resolveConfiguredHostedBillingPlanCodes,
  resolveHostedBillingReady,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  buildHostedBillingCheckoutLineItems,
  deriveHostedBillingCheckoutOfferBindingKey,
} from "@/src/lib/hosted-onboarding/billing-service";

describe("hosted billing launch plan Stripe configuration", () => {
  const basePriceIds = {
    launch_edge_monthly: "price_base_edge_monthly",
    launch_monthly: "price_base_monthly",
  };

  it("exposes the two monthly launch plan prices", () => {
    expect(getHostedBillingPlanDefinition("launch_monthly")).toMatchObject({
      badge: null,
      recurringAmountUsdCents: 800,
    });
    expect(getHostedBillingPlanDefinition("launch_edge_monthly")).toMatchObject({
      badge: null,
      recurringAmountUsdCents: 2_000,
    });
  });

  it("exposes Family as per-seat sponsored billing outside direct member plans", () => {
    expect(HOSTED_FAMILY_MIN_SEATS).toBe(2);
    expect(HOSTED_FAMILY_MAX_SEATS).toBe(6);
    expect(HOSTED_FAMILY_PLAN_DISPLAY).toMatchObject({
      displayName: "Family",
      maxSeats: 6,
      minSeats: 2,
      plans: [
        { code: "pulse", recurringAmountUsdCents: 700 },
        { code: "edge", recurringAmountUsdCents: 1_900 },
        { code: "max", recurringAmountUsdCents: 4_900 },
      ],
      recurringAmountUsdCentsPerSeat: 700,
    });
    expect(resolveConfiguredHostedBillingPlanCodes({
      stripePriceIdsByPlan: basePriceIds,
    })).toEqual(["launch_monthly", "launch_edge_monthly"]);
  });

  it("includes 80% of each direct plan and Family seat price as AI usage", () => {
    expect(getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly"))
      .toBe(6_400_000n);
    expect(getHostedAiUsageMonthlyAllowanceUsdMicros("launch_edge_monthly"))
      .toBe(16_000_000n);
    expect(getHostedFamilyAiUsageMonthlyAllowanceForPlan("pulse"))
      .toBe(5_600_000n);
    expect(getHostedFamilyAiUsageMonthlyAllowanceForPlan("edge"))
      .toBe(15_200_000n);
    expect(getHostedFamilyAiUsageMonthlyAllowanceForPlan("max"))
      .toBe(39_200_000n);
  });

  it("maps Family Max billing to the existing Edge runtime capability", () => {
    expect(parseHostedFamilyPlanCode("max")).toBe("max");
    expect(getHostedFamilyBillingOfferDefinition("max")).toMatchObject({
      billingPlanCode: "launch_max_monthly",
      displayName: "Max",
      recurringAmountUsdCents: 4_900,
      runtimePlanCode: "edge",
    });
    expect(getHostedFamilyBillingPlanCode("max")).toBe("launch_max_monthly");
    expect(getHostedFamilyRuntimePlanCode("max")).toBe("edge");
  });

  it("keeps Pulse Trial as a checkout offer instead of a billing plan", () => {
    expect(resolveConfiguredHostedBillingPlanCodes({
      stripePriceIdsByPlan: basePriceIds,
    })).toEqual(["launch_monthly", "launch_edge_monthly"]);
    expect(parseHostedPublicBillingCheckoutOffer("pulse_trial_7d")).toBe("pulse_trial_7d");
    expect(parseHostedPublicBillingCheckoutOffer("standard")).toBeNull();
    expect(parseHostedBillingCheckoutOffer("standard")).toBe("standard");
    expect(parseHostedBillingCheckoutOffer("pulse_trial_7d")).toBe("pulse_trial_7d");
    expect(parseHostedBillingPhase("trial")).toBe("trial");
    expect(parseHostedBillingPhase("paid")).toBe("paid");
    expect(requireHostedPulseTrialPolicy("pulse-trial-2026-07-15-v3")).toEqual({
      durationDays: 14,
      usageLimitUsdMicros: 4_500_000n,
    });
    expect(requireHostedPulseTrialPolicy("pulse-trial-2026-06-30-v2")).toEqual({
      durationDays: 10,
      usageLimitUsdMicros: 4_500_000n,
    });
    expect(requireHostedPulseTrialPolicy("pulse-trial-2026-05-05-v1")).toEqual({
      durationDays: 7,
      usageLimitUsdMicros: 4_500_000n,
    });
  });

  it("keeps Edge upgrade eligibility tied to paid Pulse source state", () => {
    expect(canUpgradeHostedBillingPlanToEdge({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
    })).toBe(true);
    expect(canUpgradeHostedBillingPlanToEdge({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
    })).toBe(false);
    expect(canUpgradeHostedBillingPlanToEdge({
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
    })).toBe(false);
    expect(canUpgradeHostedBillingPlanToEdge({
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
    })).toBe(false);
    expect(isHostedPulseTrialBillingState({
      currentBillingPhase: "paid",
      currentCheckoutOffer: "pulse_trial_7d",
    })).toBe(false);
  });

  it("keeps Pulse switch eligibility tied to paid Edge source state, active access, and Stripe refs", () => {
    expect(canSwitchHostedBillingPlanToPulse({
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    })).toBe(true);
    expect(canSwitchHostedBillingPlanToPulse({
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      suspendedAt: new Date("2026-05-06T00:00:00.000Z"),
    })).toBe(false);
    expect(canSwitchHostedBillingPlanToPulse({
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "",
    })).toBe(false);
    expect(canSwitchHostedBillingPlanToPulse({
      billingStatus: "past_due",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    })).toBe(false);
  });

  it("keeps Start Pulse eligibility tied to recoverable Pulse Trial and Stripe refs", () => {
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "active",
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    })).toBe(true);
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "paused",
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    })).toBe(true);
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "active",
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    })).toBe(false);
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "active",
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    })).toBe(false);
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "active",
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    })).toBe(false);
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "past_due",
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    })).toBe(false);
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "canceled",
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
    })).toBe(false);
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "paused",
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: true,
      suspendedAt: new Date("2026-05-06T00:00:00.000Z"),
    })).toBe(false);
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "active",
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: false,
      hasStripeSubscriptionId: true,
    })).toBe(false);
    expect(canStartHostedPulseTrialPaidPlan({
      billingStatus: "active",
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      hasStripeCustomerId: true,
      hasStripeSubscriptionId: false,
    })).toBe(false);
  });

  it("resolves the Pulse Trial checkout rollout flag from a single helper", () => {
    expect(isHostedPulseTrialCheckoutEnabled({
      HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED: "1",
    })).toBe(true);
    expect(isHostedPulseTrialCheckoutEnabled({
      HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED: "0",
    })).toBe(false);
    expect(isHostedPulseTrialCheckoutEnabled({})).toBe(false);
  });

  it("keeps no-card auto Pulse Trial enabled unless explicitly disabled", () => {
    expect(isHostedAutoPulseTrialEnabled({})).toBe(true);
    expect(isHostedAutoPulseTrialEnabled({
      HOSTED_AUTO_PULSE_TRIAL_ENABLED: "1",
    })).toBe(true);
    expect(isHostedAutoPulseTrialEnabled({
      HOSTED_AUTO_PULSE_TRIAL_ENABLED: "0",
    })).toBe(false);
    expect(isHostedAutoPulseTrialEnabled({
      HOSTED_AUTO_PULSE_TRIAL_ENABLED: "false",
    })).toBe(false);
  });

  it("formats the homepage pricing summaries from the shared plan definitions", () => {
    expect(formatHostedLandingPricingShortSummary()).toBe("$8/mo");
    expect(formatHostedLandingPricingLongSummary()).toBe("$8/month");
  });

  it("builds plan presentations with the updated displayed amounts", () => {
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

  it("requires only a base price for configured plans", () => {
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

  it("marks billing ready with a base price and Stripe key", () => {
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

  it("builds checkout with only a licensed base item", () => {
    expect(buildHostedBillingCheckoutLineItems("price_base_monthly")).toEqual([
      {
        price: "price_base_monthly",
        quantity: 1,
      },
    ]);
  });

  it("binds a durable Checkout attempt to the complete trial policy", () => {
    const standard = deriveHostedBillingCheckoutOfferBindingKey({
      checkoutOffer: "standard",
    });
    const trial = deriveHostedBillingCheckoutOfferBindingKey({
      checkoutOffer: "pulse_trial_7d",
    });

    expect(standard).not.toBe(trial);
    expect(deriveHostedBillingCheckoutOfferBindingKey({
      checkoutOffer: "pulse_trial_7d",
      trialPolicyVersion: "future-policy",
    })).not.toBe(trial);
    expect(deriveHostedBillingCheckoutOfferBindingKey({
      checkoutOffer: "pulse_trial_7d",
      trialDurationDays: 10,
    })).not.toBe(trial);
    expect(deriveHostedBillingCheckoutOfferBindingKey({
      checkoutOffer: "pulse_trial_7d",
      trialUsageLimitUsdMicros: 5_000_000n,
    })).not.toBe(trial);
  });

});
