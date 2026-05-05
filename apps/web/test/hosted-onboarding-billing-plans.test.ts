import { describe, expect, it } from "vitest";

import {
  formatHostedLandingPricingLongSummary,
  formatHostedLandingPricingShortSummary,
  getHostedBillingPlanDefinition,
  isHostedPulseTrialCheckoutEnabled,
  listHostedBillingPlanPresentations,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
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
  const usagePriceIds = {
    launch_edge_monthly: "price_usage_edge_monthly",
    launch_monthly: "price_usage_monthly",
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

  it("keeps Pulse Trial as a checkout offer instead of a billing plan", () => {
    expect(resolveConfiguredHostedBillingPlanCodes({
      aiUsageBillingMode: "disabled",
      stripePriceIdsByPlan: basePriceIds,
      stripeUsagePriceIdsByPlan: usagePriceIds,
    })).toEqual(["launch_monthly", "launch_edge_monthly"]);
    expect(parseHostedPublicBillingCheckoutOffer("pulse_trial_7d")).toBe("pulse_trial_7d");
    expect(parseHostedPublicBillingCheckoutOffer("standard")).toBeNull();
    expect(parseHostedBillingCheckoutOffer("standard")).toBe("standard");
    expect(parseHostedBillingCheckoutOffer("pulse_trial_7d")).toBe("pulse_trial_7d");
    expect(parseHostedBillingPhase("trial")).toBe("trial");
    expect(parseHostedBillingPhase("paid")).toBe("paid");
    expect(requireHostedPulseTrialPolicy("pulse-trial-2026-05-05-v1")).toEqual({
      durationDays: 7,
      usageLimitUsdMicros: 2_500_000n,
    });
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

  it("requires only a base price for configured plans while AI usage billing is disabled", () => {
    expect(resolveConfiguredHostedBillingPlanCodes({
      aiUsageBillingMode: "disabled",
      stripePriceIdsByPlan: {
        ...basePriceIds,
        launch_edge_monthly: null,
      },
      stripeUsagePriceIdsByPlan: usagePriceIds,
    })).toEqual(["launch_monthly"]);

    expect(resolveConfiguredHostedBillingPlanCodes({
      aiUsageBillingMode: "disabled",
      stripePriceIdsByPlan: basePriceIds,
      stripeUsagePriceIdsByPlan: {
        ...usagePriceIds,
        launch_monthly: null,
      },
    })).toEqual(["launch_monthly", "launch_edge_monthly"]);
  });

  it("requires usage price configuration only when Stripe metering is explicitly enabled", () => {
    expect(resolveConfiguredHostedBillingPlanCodes({
      aiUsageBillingMode: "stripe_meter",
      stripePriceIdsByPlan: basePriceIds,
      stripeUsagePriceIdsByPlan: {
        ...usagePriceIds,
        launch_monthly: null,
      },
    })).toEqual(["launch_edge_monthly"]);
  });

  it("marks billing ready with a base price and Stripe key while AI usage billing is disabled", () => {
    expect(resolveHostedBillingReady({
      aiUsageBillingMode: "disabled",
      stripePriceIdsByPlan: basePriceIds,
      stripeSecretKey: "sk_test_123",
      stripeUsageMeterEventName: null,
      stripeUsagePriceIdsByPlan: {
        launch_edge_monthly: null,
        launch_monthly: null,
      },
    })).toBe(true);

    expect(resolveHostedBillingReady({
      aiUsageBillingMode: "disabled",
      stripePriceIdsByPlan: {
        launch_edge_monthly: null,
        launch_monthly: null,
      },
      stripeSecretKey: "sk_test_123",
      stripeUsageMeterEventName: "murph_ai_tokens",
      stripeUsagePriceIdsByPlan: usagePriceIds,
    })).toBe(false);
  });

  it("does not mark billing ready for Stripe metering unless usage metering and at least one complete plan are configured", () => {
    expect(resolveHostedBillingReady({
      aiUsageBillingMode: "stripe_meter",
      stripePriceIdsByPlan: basePriceIds,
      stripeSecretKey: "sk_test_123",
      stripeUsageMeterEventName: "murph_ai_tokens",
      stripeUsagePriceIdsByPlan: usagePriceIds,
    })).toBe(true);

    expect(resolveHostedBillingReady({
      aiUsageBillingMode: "stripe_meter",
      stripePriceIdsByPlan: basePriceIds,
      stripeSecretKey: "sk_test_123",
      stripeUsageMeterEventName: null,
      stripeUsagePriceIdsByPlan: usagePriceIds,
    })).toBe(false);

    expect(resolveHostedBillingReady({
      aiUsageBillingMode: "stripe_meter",
      stripePriceIdsByPlan: basePriceIds,
      stripeSecretKey: "sk_test_123",
      stripeUsageMeterEventName: "murph_ai_tokens",
      stripeUsagePriceIdsByPlan: {
        launch_edge_monthly: null,
        launch_monthly: null,
      },
    })).toBe(false);
  });

  it("keeps the metered usage price env names with the plan definition", () => {
    expect(getHostedBillingPlanDefinition("launch_monthly").usagePriceIdEnvKey)
      .toBe("HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_MONTHLY");
    expect(getHostedBillingPlanDefinition("launch_edge_monthly").usagePriceIdEnvKey)
      .toBe("HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_EDGE_MONTHLY");
  });

  it("builds checkout with only a licensed base item while usage billing is disabled", () => {
    expect(buildHostedBillingCheckoutLineItems({
      priceId: "price_base_monthly",
      usagePriceId: null,
    })).toEqual([
      {
        price: "price_base_monthly",
        quantity: 1,
      },
    ]);
  });

  it("builds checkout with a licensed base item and a metered usage item when supplied", () => {
    expect(buildHostedBillingCheckoutLineItems({
      priceId: "price_base_monthly",
      usagePriceId: "price_usage_monthly",
    })).toEqual([
      {
        price: "price_base_monthly",
        quantity: 1,
      },
      {
        price: "price_usage_monthly",
      },
    ]);
  });

  it("binds Stripe checkout idempotency to the checkout offer and trial policy", () => {
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
      trialDurationDays: 14,
    })).not.toBe(trial);
    expect(deriveHostedBillingCheckoutOfferBindingKey({
      checkoutOffer: "pulse_trial_7d",
      trialUsageLimitUsdMicros: 5_000_000n,
    })).not.toBe(trial);
  });
});
