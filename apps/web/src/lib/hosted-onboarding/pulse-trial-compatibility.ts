import {
  HostedBillingStatus,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  HOSTED_PULSE_TRIAL_OFFER,
  requireHostedPulseTrialPolicy,
} from "./billing-plans";
import {
  createHostedStripeSubscriptionLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
// Active, past_due, and Stripe's unpaid status can represent paid service.
// The drained free-trial states never authorize a new grant or cancellation.
const HOSTED_LEGACY_TRIAL_RETIRED_STATUSES = new Set<Stripe.Subscription.Status>([
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
  "trialing",
]);

export function isHostedLegacyPulseTrialRetiredStatus(
  status: Stripe.Subscription.Status,
): boolean {
  return HOSTED_LEGACY_TRIAL_RETIRED_STATUSES.has(status);
}

export function buildHostedLegacyTrialBillingConflictError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_SUBSCRIPTION_ALREADY_EXISTS",
    httpStatus: 409,
    message:
      "This hosted account already has a subscription. Manage it from Settings instead of starting a new one.",
  });
}

export type HostedPulseTrialCandidateDisposition =
  | "current"
  | "eligible"
  | "loser";

export function classifyHostedPulseTrialCandidateDisposition(input: {
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentStripeSubscriptionId: string | null;
  pulseTrialRedeemedAt: Date | null;
  subscriptionId: string;
}): HostedPulseTrialCandidateDisposition {
  return classifyHostedPulseTrialCandidateDispositionForIdentity({
    billingStatus: input.billingStatus,
    currentBillingPhase: input.currentBillingPhase,
    currentSubscriptionIdentity:
      input.currentStripeSubscriptionId === input.subscriptionId
        ? "candidate"
        : input.currentStripeSubscriptionId
          ? "different"
          : "none",
    pulseTrialRedeemedAt: input.pulseTrialRedeemedAt,
  });
}

export function classifyHostedPulseTrialCandidateDispositionByLookupKey(input: {
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentStripeSubscriptionLookupKey: string | null;
  pulseTrialRedeemedAt: Date | null;
  subscriptionId: string;
}): HostedPulseTrialCandidateDisposition {
  const candidateLookupKeys =
    createHostedStripeSubscriptionLookupKeyReadCandidates(
      input.subscriptionId,
    );
  return classifyHostedPulseTrialCandidateDispositionForIdentity({
    billingStatus: input.billingStatus,
    currentBillingPhase: input.currentBillingPhase,
    currentSubscriptionIdentity:
      input.currentStripeSubscriptionLookupKey === null
        ? "none"
        : candidateLookupKeys.includes(
            input.currentStripeSubscriptionLookupKey,
          )
          ? "candidate"
          : "different",
    pulseTrialRedeemedAt: input.pulseTrialRedeemedAt,
  });
}

function classifyHostedPulseTrialCandidateDispositionForIdentity(input: {
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentSubscriptionIdentity: "candidate" | "different" | "none";
  pulseTrialRedeemedAt: Date | null;
}): HostedPulseTrialCandidateDisposition {
  if (input.currentSubscriptionIdentity === "candidate") {
    return "current";
  }
  // A second legacy trial may never replace an already-bound provider
  // identity. Ignore the delayed candidate and leave the current identity for
  // its own exact delayed-event reconciliation.
  if (input.currentSubscriptionIdentity === "different") {
    return "loser";
  }
  if (
    input.pulseTrialRedeemedAt
    || input.currentBillingPhase === "paid"
    || input.billingStatus === HostedBillingStatus.active
  ) {
    return "loser";
  }
  return "eligible";
}

export function isHostedPulseTrialSubscriptionForKnownPolicy(input: {
  memberId: string;
  priceId: string;
  subscription: {
    items?: {
      data: ReadonlyArray<{
        id: string;
        price?: {
          id?: string;
          metadata?: Record<string, string> | null;
          recurring?: {
            interval?: string;
            interval_count?: number;
            usage_type?: string;
          } | null;
        } | null;
        quantity?: number | null;
      }>;
      has_more?: boolean;
    };
    metadata?: Record<string, string> | null;
  };
}): boolean {
  const policy = requireHostedPulseTrialPolicy(
    input.subscription.metadata?.trialPolicyVersion,
  );
  if (
    !policy ||
    input.subscription.metadata?.memberId !== input.memberId ||
    input.subscription.metadata.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER ||
    input.subscription.metadata.billingPlanCode !== "launch_monthly" ||
    input.subscription.metadata.trialDurationDays !== policy.durationDays.toString() ||
    input.subscription.metadata.trialUsageLimitUsdMicros !==
      policy.usageLimitUsdMicros.toString()
  ) {
    return false;
  }

  if (input.subscription.items?.has_more !== false) {
    return false;
  }
  const items = input.subscription.items.data;
  if (items.length !== 1) {
    return false;
  }
  const baseItem = items[0];
  return Boolean(
    baseItem &&
    baseItem.price?.id === input.priceId &&
    baseItem.price.recurring?.interval === "month" &&
    (baseItem.price.recurring.interval_count ?? 1) === 1 &&
    baseItem.price.recurring.usage_type !== "metered" &&
    baseItem.quantity === 1
  );
}
