import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  classifyHostedPulseTrialCandidateDisposition,
  retrieveHostedPulseTrialCleanupTarget,
} from "@/src/lib/hosted-onboarding/pulse-trial-subscription-cleanup";

const MEMBER_ID = "member_target";
const PRICE_ID = "price_launch_monthly";
const CUSTOMER_ID = "cus_trial";
const SUBSCRIPTION_ID = "sub_trial";

type StripeSubscriptionRetrieveMock = (
  ...args: Parameters<Stripe["subscriptions"]["retrieve"]>
) => Promise<Stripe.Subscription>;

describe("retrieveHostedPulseTrialCleanupTarget", () => {
  it("expands the customer within the bounded authority read", async () => {
    const subscription = makeKnownPulseTrialSubscription();
    const retrieve = vi.fn<StripeSubscriptionRetrieveMock>().mockResolvedValue(subscription);
    const requestOptions = {
      maxNetworkRetries: 0,
      timeout: 5_000,
    };

    await expect(retrieveHostedPulseTrialCleanupTarget({
      expandCustomer: true,
      expectedCustomerId: CUSTOMER_ID,
      memberId: MEMBER_ID,
      priceId: PRICE_ID,
      requestOptions,
      stripe: {
        subscriptions: {
          retrieve,
        },
      },
      subscriptionId: SUBSCRIPTION_ID,
    })).resolves.toBe(subscription);

    expect(retrieve).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      { expand: ["customer"] },
      requestOptions,
    );
  });

  it("preserves the parameter-free retrieve shape for existing callers", async () => {
    const subscription = makeKnownPulseTrialSubscription();
    const retrieve = vi.fn<StripeSubscriptionRetrieveMock>().mockResolvedValue(subscription);

    await expect(retrieveHostedPulseTrialCleanupTarget({
      expectedCustomerId: CUSTOMER_ID,
      memberId: MEMBER_ID,
      priceId: PRICE_ID,
      stripe: {
        subscriptions: {
          retrieve,
        },
      },
      subscriptionId: SUBSCRIPTION_ID,
    })).resolves.toBe(subscription);

    expect(retrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
  });
});



describe("classifyHostedPulseTrialCandidateDisposition", () => {
  it("keeps the exact current identity authoritative", () => {
    expect(classifyHostedPulseTrialCandidateDisposition({
      billingStatus: HostedBillingStatus.incomplete,
      currentBillingPhase: null,
      currentStripeSubscriptionId: SUBSCRIPTION_ID,
      pulseTrialRedeemedAt: null,
      subscriptionId: SUBSCRIPTION_ID,
    })).toBe("current");
  });

  it("never lets a delayed second trial replace an existing identity", () => {
    expect(classifyHostedPulseTrialCandidateDisposition({
      billingStatus: HostedBillingStatus.incomplete,
      currentBillingPhase: null,
      currentStripeSubscriptionId: "sub_existing",
      pulseTrialRedeemedAt: null,
      subscriptionId: SUBSCRIPTION_ID,
    })).toBe("loser");
  });

  it("allows only a clean pre-activation row to adopt the exact legacy event", () => {
    expect(classifyHostedPulseTrialCandidateDisposition({
      billingStatus: HostedBillingStatus.incomplete,
      currentBillingPhase: null,
      currentStripeSubscriptionId: null,
      pulseTrialRedeemedAt: null,
      subscriptionId: SUBSCRIPTION_ID,
    })).toBe("eligible");
    expect(classifyHostedPulseTrialCandidateDisposition({
      billingStatus: HostedBillingStatus.active,
      currentBillingPhase: null,
      currentStripeSubscriptionId: null,
      pulseTrialRedeemedAt: null,
      subscriptionId: SUBSCRIPTION_ID,
    })).toBe("loser");
  });
});

function makeKnownPulseTrialSubscription(): Stripe.Subscription {
  return defineStripeSubscriptionFixture({
    customer: {
      id: CUSTOMER_ID,
    },
    id: SUBSCRIPTION_ID,
    items: {
      data: [
        {
          id: "si_trial",
          price: {
            id: PRICE_ID,
            recurring: {
              interval: "month",
              interval_count: 1,
              usage_type: "licensed",
            },
          },
          quantity: 1,
        },
      ],
      has_more: false,
    },
    metadata: {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: MEMBER_ID,
      trialDurationDays: "14",
      trialPolicyVersion: "pulse-trial-2026-07-15-v3",
      trialUsageLimitUsdMicros: "4500000",
    },
  });
}

function defineStripeSubscriptionFixture<T extends object>(
  subscription: T,
): T & Stripe.Subscription {
  // Response-only Stripe fields are irrelevant here; request arguments remain
  // derived from the official retrieve method signature above.
  return subscription as T & Stripe.Subscription;
}
