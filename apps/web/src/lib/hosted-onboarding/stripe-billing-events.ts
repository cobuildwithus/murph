import {
  HostedBillingStatus,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
} from "./billing";
import { isHostedAccessBlockedBillingStatus } from "./entitlement";
import { writeHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import {
  activateHostedMemberForPositiveSource,
} from "./member-activation";
import { normalizeNullableString, type HostedOnboardingPrismaClient } from "./shared";
import {
  findMemberForStripeObject,
  findMemberForStripeReversal,
} from "./stripe-billing-lookup";
import {
  suspendHostedMemberForBillingReversal,
  updateHostedMemberStripeBillingIfFresh,
} from "./stripe-billing-policy";
import {
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";

type HostedStripeActivationOutcome = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
  postCommitProvisionUserId?: string | null;
};

export async function applyStripeCheckoutCompleted(
  session: Stripe.Checkout.Session,
  _dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<HostedStripeActivationOutcome> {
  const member = await findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(session.client_reference_id),
    customerId: coerceStripeObjectId(session.customer),
    memberId: normalizeNullableString(session.metadata?.memberId),
    prisma,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  });

  if (!member) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
    };
  }

  await writeHostedMemberStripeBillingRef({
    memberId: member.core.id,
    prisma,
    stripeCustomerId: coerceStripeObjectId(session.customer) ?? member.billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription) ?? member.billingRef?.stripeSubscriptionId ?? null,
  });

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
  void session;
  void prisma;
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

  await updateHostedMemberStripeBillingIfFresh({
    billingStatus: member.core.billingStatus,
    dispatchContext,
    member,
    prisma,
    stripeCustomerId: coerceStripeObjectId(subscription.customer) ?? member.billingRef?.stripeCustomerId ?? null,
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

  const hadActiveBilling = member.core.billingStatus === HostedBillingStatus.active;
  const startingBillingStatus = member.core.billingStatus;
  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    billingStatus: HostedBillingStatus.active,
    dispatchContext,
    member,
    prisma,
    stripeCustomerId: coerceStripeObjectId(invoice.customer) ?? member.billingRef?.stripeCustomerId ?? null,
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
  });

  return {
    activatedMemberId: activation.activated ? updatedMember.core.id : null,
    createdOrUpdatedRevnetIssuance: false,
    hostedExecutionEventId: activation.hostedExecutionEventId,
    postCommitProvisionUserId: activation.postCommitProvisionUserId,
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
    stripeCustomerId: coerceStripeObjectId(invoice.customer) ?? member.billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: subscriptionId ?? member.billingRef?.stripeSubscriptionId ?? null,
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
