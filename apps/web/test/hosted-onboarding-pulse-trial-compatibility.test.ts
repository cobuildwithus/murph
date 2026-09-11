import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  classifyHostedPulseTrialCandidateDisposition,
  isHostedPulseTrialSubscriptionForKnownPolicy,
} from "@/src/lib/hosted-onboarding/pulse-trial-compatibility";

const SUBSCRIPTION_ID = "sub_trial";

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

describe("legacy paid Pulse policy validation", () => {
  function knownSubscription() {
    return {
      items: {
        data: [{
          id: "si_legacy",
          price: {
            id: "price_pulse",
            recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
          },
          quantity: 1,
        }],
        has_more: false,
      },
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_legacy",
        trialDurationDays: "14",
        trialPolicyVersion: "pulse-trial-2026-07-15-v3",
        trialUsageLimitUsdMicros: "4500000",
      },
    };
  }

  it("accepts one exact configured recurring price for the known policy", () => {
    expect(isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: "member_legacy",
      priceId: "price_pulse",
      subscription: knownSubscription(),
    })).toBe(true);
  });

  it.each(["empty", "multiple", "paginated", "price", "interval", "metered", "quantity", "member", "policy"])(
    "rejects an ambiguous or mismatched %s shape",
    (shape) => {
      const subscription = knownSubscription();
      const item = subscription.items.data[0]!;
      switch (shape) {
        case "empty": subscription.items.data = []; break;
        case "multiple": subscription.items.data.push({ ...item, id: "si_extra" }); break;
        case "paginated": subscription.items.has_more = true; break;
        case "price": item.price.id = "price_other"; break;
        case "interval": item.price.recurring.interval = "year"; break;
        case "metered": item.price.recurring.usage_type = "metered"; break;
        case "quantity": item.quantity = 2; break;
        case "member": subscription.metadata.memberId = "member_other"; break;
        case "policy": subscription.metadata.trialPolicyVersion = "unknown"; break;
      }
      expect(isHostedPulseTrialSubscriptionForKnownPolicy({
        memberId: "member_legacy",
        priceId: "price_pulse",
        subscription,
      })).toBe(false);
    },
  );
});
