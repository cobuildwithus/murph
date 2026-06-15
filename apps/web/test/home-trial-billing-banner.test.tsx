import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  resolveHomeTrialBillingBannerVariant,
  TrialBillingBanner,
} from "@/src/components/home/trial-billing-banner";

describe("home trial billing banner", () => {
  it("stays hidden for active Pulse Trial users", () => {
    expect(
      resolveHomeTrialBillingBannerVariant({
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          stripeCustomerId: "cus_trial",
          stripeSubscriptionId: "sub_trial",
        },
        billingStatus: "active",
        suspendedAt: null,
      }),
    ).toBeNull();
  });

  it("shows the billing recovery action for paused Pulse Trial users", () => {
    expect(
      resolveHomeTrialBillingBannerVariant({
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          stripeCustomerId: "cus_trial",
          stripeSubscriptionId: "sub_trial",
        },
        billingStatus: "paused",
        suspendedAt: null,
      }),
    ).toBe("resume");

    const markup = renderToStaticMarkup(createElement(TrialBillingBanner));

    expect(markup).toContain("Resume Pulse billing");
    expect(markup).toContain("Open billing");
    expect(markup).toContain("href=\"/settings\"");
  });

  it("stays hidden for paid Pulse users", () => {
    expect(
      resolveHomeTrialBillingBannerVariant({
        billingRef: {
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "pulse_trial_7d",
          stripeCustomerId: "cus_paid",
          stripeSubscriptionId: "sub_paid",
        },
        billingStatus: "active",
        suspendedAt: null,
      }),
    ).toBeNull();
  });
});
