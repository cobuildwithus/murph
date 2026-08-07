import { HostedBillingStatus } from "@prisma/client";

import { HOSTED_PULSE_TRIAL_OFFER } from "./billing-plans";

export function resolveHostedSubscriptionBillingStatus(input: {
  currentBillingPhase?: string | null;
  currentBillingStatus: HostedBillingStatus;
  currentCheckoutOffer?: string | null;
  currentTrialEndsAt?: Date | null;
  eventCreatedAt?: Date | null;
  nextBillingStatus: HostedBillingStatus;
  sourceType?: string | null;
}): HostedBillingStatus {
  if (input.nextBillingStatus === HostedBillingStatus.active) {
    if (isExpiredPulseTrialSubscriptionStatusWrite(input)) {
      return HostedBillingStatus.incomplete;
    }

    return input.currentBillingStatus === HostedBillingStatus.active
      ? HostedBillingStatus.active
      : HostedBillingStatus.incomplete;
  }

  return input.nextBillingStatus;
}

export function requiresHostedCanonicalStripeBillingStatus(sourceType: string): boolean {
  return isHostedStripeSubscriptionSourceType(sourceType) ||
    isHostedStripeInvoiceSourceType(sourceType);
}

export function resolveHostedStripeBillingStatusForWrite(input: {
  billingStatus: HostedBillingStatus;
  canonicalBillingStatus: HostedBillingStatus | null;
  currentBillingPhase?: string | null;
  currentBillingStatus: HostedBillingStatus;
  currentCheckoutOffer?: string | null;
  currentTrialEndsAt?: Date | null;
  eventCreatedAt?: Date | null;
  sourceType: string;
}): HostedBillingStatus {
  if (isHostedStripeBillingReversalSourceType(input.sourceType)) {
    return input.billingStatus;
  }

  if (input.canonicalBillingStatus !== null) {
    if (isHostedStripeSubscriptionSourceType(input.sourceType)) {
      return resolveHostedSubscriptionBillingStatus({
        currentBillingPhase: input.currentBillingPhase,
        currentBillingStatus: input.currentBillingStatus,
        currentCheckoutOffer: input.currentCheckoutOffer,
        currentTrialEndsAt: input.currentTrialEndsAt,
        eventCreatedAt: input.eventCreatedAt,
        nextBillingStatus: input.canonicalBillingStatus,
        sourceType: input.sourceType,
      });
    }

    if (input.sourceType === "stripe.invoice.paid") {
      return input.canonicalBillingStatus === HostedBillingStatus.active
        ? HostedBillingStatus.active
        : input.canonicalBillingStatus;
    }

    if (input.sourceType === "stripe.invoice.payment_failed") {
      return input.canonicalBillingStatus === HostedBillingStatus.active
        ? resolveHostedInvoicePaymentFailedBillingStatus(input.currentBillingStatus)
        : input.canonicalBillingStatus;
    }

    return input.canonicalBillingStatus;
  }

  if (requiresHostedCanonicalStripeBillingStatus(input.sourceType)) {
    throw new Error(
      `Canonical Stripe subscription state is required for ${input.sourceType}.`,
    );
  }

  return input.billingStatus;
}

function isHostedStripeBillingReversalSourceType(sourceType: string): boolean {
  return sourceType === "stripe.refund.created" ||
    sourceType === "stripe.refund.updated" ||
    sourceType.startsWith("stripe.charge.dispute.");
}

function isHostedStripeSubscriptionSourceType(sourceType: string): boolean {
  return sourceType === "stripe.customer.subscription.created" ||
    sourceType === "stripe.customer.subscription.updated" ||
    sourceType === "stripe.customer.subscription.deleted" ||
    sourceType === "stripe.customer.subscription.paused" ||
    sourceType === "stripe.customer.subscription.resumed";
}

function isExpiredPulseTrialSubscriptionStatusWrite(input: {
  currentBillingPhase?: string | null;
  currentCheckoutOffer?: string | null;
  currentTrialEndsAt?: Date | null;
  eventCreatedAt?: Date | null;
  sourceType?: string | null;
}): boolean {
  if (
    input.currentBillingPhase !== "trial" ||
    input.currentCheckoutOffer !== HOSTED_PULSE_TRIAL_OFFER ||
    !input.currentTrialEndsAt ||
    !input.eventCreatedAt
  ) {
    return false;
  }

  return input.currentTrialEndsAt.getTime() <= input.eventCreatedAt.getTime();
}

function isHostedStripeInvoiceSourceType(sourceType: string): boolean {
  return sourceType === "stripe.invoice.paid" ||
    sourceType === "stripe.invoice.payment_failed";
}

function resolveHostedInvoicePaymentFailedBillingStatus(
  currentBillingStatus: HostedBillingStatus,
): HostedBillingStatus {
  return currentBillingStatus === HostedBillingStatus.active
    ? HostedBillingStatus.active
    : currentBillingStatus;
}
