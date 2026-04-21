import { describe, expect, it } from "vitest";

import {
  formatHostedLandingAnnualEquivalentSummary,
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
    launch_annual: "price_base_annual",
    launch_monthly: "price_base_monthly",
  };
  const usagePriceIds = {
    launch_annual: "price_usage_annual",
    launch_monthly: "price_usage_monthly",
  };

  it("exposes the updated monthly and annual launch pricing", () => {
    expect(getHostedBillingPlanDefinition("launch_monthly")).toMatchObject({
      badge: null,
      recurringAmountUsdCents: 800,
    });
    expect(getHostedBillingPlanDefinition("launch_annual")).toMatchObject({
      badge: "2 months free",
      recurringAmountUsdCents: 8_000,
    });
  });

  it("formats the homepage pricing summaries from the shared plan definitions", () => {
    expect(formatHostedLandingPricingShortSummary()).toBe("$8/mo");
    expect(formatHostedLandingPricingLongSummary()).toBe("$8/month");
    expect(formatHostedLandingAnnualEquivalentSummary()).toBe(
      "$6.67/month billed yearly",
    );
  });

  it("builds plan presentations with the updated displayed amounts", () => {
    expect(listHostedBillingPlanPresentations()).toEqual([
      {
        badge: null,
        code: "launch_monthly",
        displayName: "Monthly",
        interval: "month",
        recurringAmountLabel: "$8",
        recurringAmountUsdCents: 800,
        recurringSummary: "$8/mo",
      },
      {
        badge: "2 months free",
        code: "launch_annual",
        displayName: "Annual",
        interval: "year",
        recurringAmountLabel: "$80",
        recurringAmountUsdCents: 8_000,
        recurringSummary: "$80/yr",
      },
    ]);
  });

  it("requires both a base price and a metered usage price for each configured plan", () => {
    expect(resolveConfiguredHostedBillingPlanCodes({
      stripePriceIdsByPlan: {
        ...basePriceIds,
        launch_annual: null,
      },
      stripeUsagePriceIdsByPlan: usagePriceIds,
    })).toEqual(["launch_monthly"]);

    expect(resolveConfiguredHostedBillingPlanCodes({
      stripePriceIdsByPlan: basePriceIds,
      stripeUsagePriceIdsByPlan: {
        ...usagePriceIds,
        launch_monthly: null,
      },
    })).toEqual(["launch_annual"]);
  });

  it("does not mark billing ready unless usage metering and at least one complete plan are configured", () => {
    expect(resolveHostedBillingReady({
      stripePriceIdsByPlan: basePriceIds,
      stripeSecretKey: "sk_test_123",
      stripeUsageMeterEventName: "murph_ai_tokens",
      stripeUsagePriceIdsByPlan: usagePriceIds,
    })).toBe(true);

    expect(resolveHostedBillingReady({
      stripePriceIdsByPlan: basePriceIds,
      stripeSecretKey: "sk_test_123",
      stripeUsageMeterEventName: null,
      stripeUsagePriceIdsByPlan: usagePriceIds,
    })).toBe(false);

    expect(resolveHostedBillingReady({
      stripePriceIdsByPlan: basePriceIds,
      stripeSecretKey: "sk_test_123",
      stripeUsageMeterEventName: "murph_ai_tokens",
      stripeUsagePriceIdsByPlan: {
        launch_annual: null,
        launch_monthly: null,
      },
    })).toBe(false);
  });

  it("keeps the metered usage price env names with the plan definition", () => {
    expect(getHostedBillingPlanDefinition("launch_monthly").usagePriceIdEnvKey)
      .toBe("HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_MONTHLY");
    expect(getHostedBillingPlanDefinition("launch_annual").usagePriceIdEnvKey)
      .toBe("HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_ANNUAL");
  });

  it("builds checkout with a licensed base item and a metered usage item", () => {
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
