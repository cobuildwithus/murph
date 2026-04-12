import { HostedBillingStatus } from "@prisma/client";

export function resolveHostedSubscriptionBillingStatus(input: {
  currentBillingStatus: HostedBillingStatus;
  nextBillingStatus: HostedBillingStatus;
}): HostedBillingStatus {
  if (input.nextBillingStatus === HostedBillingStatus.active) {
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
  currentBillingStatus: HostedBillingStatus;
  sourceType: string;
}): HostedBillingStatus {
  if (isHostedStripeBillingReversalSourceType(input.sourceType)) {
    return input.billingStatus;
  }

  if (input.canonicalBillingStatus !== null) {
    if (isHostedStripeSubscriptionSourceType(input.sourceType)) {
      return resolveHostedSubscriptionBillingStatus({
        currentBillingStatus: input.currentBillingStatus,
        nextBillingStatus: input.canonicalBillingStatus,
      });
    }

    if (input.sourceType === "stripe.invoice.paid") {
      return input.canonicalBillingStatus === HostedBillingStatus.active
        ? HostedBillingStatus.active
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
  return sourceType === "stripe.refund.created" || sourceType.startsWith("stripe.charge.dispute.");
}

function isHostedStripeSubscriptionSourceType(sourceType: string): boolean {
  return sourceType === "stripe.customer.subscription.created" ||
    sourceType === "stripe.customer.subscription.updated" ||
    sourceType === "stripe.customer.subscription.deleted";
}

function isHostedStripeInvoiceSourceType(sourceType: string): boolean {
  return sourceType === "stripe.invoice.paid" ||
    sourceType === "stripe.invoice.payment_failed";
}
