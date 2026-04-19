import { describe, expect, it } from "vitest";

import {
  formatHostedLandingAnnualEquivalentSummary,
  formatHostedLandingPricingLongSummary,
  formatHostedLandingPricingShortSummary,
  getHostedBillingPlanDefinition,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";

describe("hosted onboarding billing plans", () => {
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
});
