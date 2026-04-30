import { describe, expect, it } from "vitest";

import {
  formatHostedLandingPricingLongSummary,
  formatHostedLandingPricingShortSummary,
  getHostedBillingPlanDefinition,
  listHostedBillingPlanPresentations,
  resolveConfiguredHostedBillingPlanCodes,
  resolveHostedBillingReady,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { buildHostedBillingCheckoutLineItems } from "@/src/lib/hosted-onboarding/billing-service";

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
});
