import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  completeHostedBillingAttemptBySessionId,
  expireHostedBillingAttemptBySessionId,
} from "./billing-attempts";
import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import { isHostedAccessBlockedBillingStatus } from "./entitlement";
import { normalizeNullableString } from "./shared";
import {
  activateHostedMemberForPositiveSource,
  findMemberForStripeObject,
  findMemberForStripeReversal,
  resolveHostedSubscriptionBillingStatus,
  suspendHostedMemberForBillingReversal,
  type HostedStripeDispatchContext,
  updateHostedMemberStripeBillingIfFresh,
} from "./stripe-billing-policy";

type HostedOnboardingPrismaClient = Prisma.TransactionClient;

type HostedStripeActivationOutcome = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
};

export async function applyStripeCheckoutCompleted(
  session: Stripe.Checkout.Session,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<HostedStripeActivationOutcome> {
  const member = await findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(session.client_reference_id),
    customerId: coerceStripeObjectId(session.customer),
    memberId: normalizeNullableString(session.metadata?.memberId),
    prisma,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  });
  const nextBillingStatus = resolveHostedCheckoutCompletedBillingStatus({
    currentBillingStatus: member?.billingStatus ?? null,
  });

  await completeHostedBillingAttemptBySessionId({
    amountTotal: session.amount_total ?? null,
    currency: normalizeNullableString(session.currency),
    prisma,
    stripeCheckoutSessionId: session.id,
    stripeCustomerId: coerceStripeObjectId(session.customer),
    stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription),
  });

  if (!member) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
    };
  }

  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    billingStatus: nextBillingStatus,
    dispatchContext,
    member,
    prisma,
    stripeCustomerId: coerceStripeObjectId(session.customer) ?? member.stripeCustomerId,
    stripeLatestCheckoutSessionId: session.id,
    stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription) ?? member.stripeSubscriptionId,
  });

  if (!updatedMember) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
    };
  }

  return {
    activatedMemberId: null,
    hostedExecutionEventId: null,
  };
}

export async function applyStripeCheckoutExpired(
  session: Stripe.Checkout.Session,
  _dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<void> {
  await expireHostedBillingAttemptBySessionId({
    prisma,
    stripeCheckoutSessionId: session.id,
  });
}

export async function applyStripeSubscriptionUpdated(
  subscription: Stripe.Subscription,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<void> {
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: coerceStripeObjectId(subscription.customer),
    memberId: normalizeNullableString(subscription.metadata?.memberId),
    prisma,
    subscriptionId: subscription.id,
  });

  if (!member) {
    return;
  }

  const nextBillingStatus = resolveHostedSubscriptionBillingStatus({
    currentBillingStatus: member.billingStatus,
    nextBillingStatus: mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status),
  });
  await updateHostedMemberStripeBillingIfFresh({
    billingStatus: nextBillingStatus,
    dispatchContext,
    member,
    prisma,
    stripeCustomerId: coerceStripeObjectId(subscription.customer) ?? member.stripeCustomerId,
    stripeSubscriptionId: subscription.id,
  });
}

export async function applyStripeInvoicePaid(
  invoice: Stripe.Invoice,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<HostedStripeActivationOutcome & { createdOrUpdatedRevnetIssuance: boolean }> {
  const subscriptionId = coerceStripeInvoiceSubscriptionId(invoice);
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: coerceStripeObjectId(invoice.customer),
    memberId: null,
    prisma,
    subscriptionId,
  });

  if (!member || !subscriptionId) {
    return {
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: null,
    };
  }

  const hadActiveBilling = member.billingStatus === HostedBillingStatus.active;
  const startingBillingStatus = member.billingStatus;
  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    billingStatus: HostedBillingStatus.active,
    dispatchContext,
    member,
    prisma,
    stripeCustomerId: coerceStripeObjectId(invoice.customer) ?? member.stripeCustomerId,
    stripeSubscriptionId: subscriptionId,
  });

  if (!updatedMember) {
    return {
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: null,
    };
  }

  if (isHostedAccessBlockedBillingStatus(startingBillingStatus)) {
    return {
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: null,
    };
  }

  const activation = await activateHostedMemberForPositiveSource({
    dispatchContext,
    member: updatedMember,
    prisma,
    skipIfBillingAlreadyActive: hadActiveBilling,
    sourceType: "stripe.invoice.paid",
  });

  return {
    activatedMemberId: activation.activated ? updatedMember.id : null,
    createdOrUpdatedRevnetIssuance: false,
    hostedExecutionEventId: activation.hostedExecutionEventId,
  };
}

export async function applyStripeInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<void> {
  const subscriptionId = coerceStripeInvoiceSubscriptionId(invoice);
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: coerceStripeObjectId(invoice.customer),
    memberId: null,
    prisma,
    subscriptionId,
  });

  if (!member) {
    return;
  }

  await updateHostedMemberStripeBillingIfFresh({
    billingStatus: HostedBillingStatus.past_due,
    dispatchContext,
    member,
    prisma,
    stripeCustomerId: coerceStripeObjectId(invoice.customer) ?? member.stripeCustomerId,
    stripeSubscriptionId: subscriptionId ?? member.stripeSubscriptionId,
  });
}

export async function applyStripeRefundCreated(
  refund: Stripe.Refund,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: HostedOnboardingPrismaClient,
  customerId?: string | null,
): Promise<void> {
  const member = await findMemberForStripeReversal({
    chargeId: coerceStripeObjectId(refund.charge),
    customerId: customerId ?? null,
    paymentIntentId: coerceStripeObjectId(refund.payment_intent),
    prisma,
    subscriptionId: null,
  });

  if (!member) {
    return;
  }

  await suspendHostedMemberForBillingReversal({
    dispatchContext,
    member,
    prisma,
    reason: dispatchContext.sourceType,
    stripeCustomerId: customerId ?? undefined,
  });
}

export async function applyStripeDisputeUpdated(
  dispute: Stripe.Dispute,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: HostedOnboardingPrismaClient,
  customerId?: string | null,
): Promise<void> {
  const member = await findMemberForStripeReversal({
    chargeId: coerceStripeObjectId(dispute.charge),
    customerId: customerId ?? null,
    paymentIntentId: coerceStripeObjectId(dispute.payment_intent),
    prisma,
    subscriptionId: null,
  });

  if (!member) {
    return;
  }

  await suspendHostedMemberForBillingReversal({
    dispatchContext,
    member,
    prisma,
    reason: dispatchContext.sourceType,
    stripeCustomerId: customerId ?? undefined,
  });
}

function resolveHostedCheckoutCompletedBillingStatus(input: {
  currentBillingStatus: HostedBillingStatus | null;
}): HostedBillingStatus {
  return input.currentBillingStatus === HostedBillingStatus.active
    ? HostedBillingStatus.active
    : HostedBillingStatus.incomplete;
}
