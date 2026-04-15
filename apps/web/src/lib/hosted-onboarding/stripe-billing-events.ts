import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
} from "./billing";
import { isHostedAccessBlockedBillingStatus } from "./entitlement";
import { writeHostedMemberStripeBillingRefTx } from "./hosted-member-billing-store";
import {
  activateHostedMemberForPositiveSourceTx,
} from "./member-activation";
import { resolveHostedMemberActivationEmailLinked } from "./member-channel-sync";
import { normalizeNullableString } from "./shared";
import {
  findMemberForStripeObject,
  findMemberForStripeReversal,
} from "./stripe-billing-lookup";
import {
  prepareHostedMemberStripeBillingWrite,
  suspendHostedMemberForBillingReversalTx,
  updateHostedMemberStripeBillingIfFreshTx,
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
  prisma: Prisma.TransactionClient,
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

  await writeHostedMemberStripeBillingRefTx({
    memberId: member.core.id,
    stripeCustomerId: coerceStripeObjectId(session.customer) ?? member.billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription) ?? member.billingRef?.stripeSubscriptionId ?? null,
    tx: prisma,
  });

  return {
    activatedMemberId: null,
    hostedExecutionEventId: null,
  };
}

export async function applyStripeCheckoutExpired(
  session: Stripe.Checkout.Session,
  _dispatchContext: HostedStripeDispatchContext,
  prisma: Prisma.TransactionClient,
): Promise<void> {
  void session;
  void prisma;
}

export async function applyStripeSubscriptionUpdated(
  subscription: Stripe.Subscription,
  dispatchContext: HostedStripeDispatchContext,
  prisma: Prisma.TransactionClient,
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

  const { canonicalBillingStatus, member: preparedMember } = await prepareHostedMemberStripeBillingWrite({
    dispatchContext,
    member,
    prisma,
    stripeSubscriptionId: subscription.id,
  });

  await updateHostedMemberStripeBillingIfFreshTx({
    billingStatus: member.core.billingStatus,
    canonicalBillingStatus,
    dispatchContext,
    member: preparedMember,
    stripeCustomerId: coerceStripeObjectId(subscription.customer) ?? member.billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: subscription.id,
    tx: prisma,
  });
}

export async function applyStripeInvoicePaid(
  invoice: Stripe.Invoice,
  dispatchContext: HostedStripeDispatchContext,
  prisma: Prisma.TransactionClient,
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
  const { canonicalBillingStatus, member: preparedMember } = await prepareHostedMemberStripeBillingWrite({
    dispatchContext,
    member,
    prisma,
    stripeSubscriptionId: subscriptionId,
  });
  const updatedMember = await updateHostedMemberStripeBillingIfFreshTx({
    billingStatus: HostedBillingStatus.active,
    canonicalBillingStatus,
    dispatchContext,
    member: preparedMember,
    stripeCustomerId: coerceStripeObjectId(invoice.customer) ?? member.billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: subscriptionId,
    tx: prisma,
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

  const activation = await activateHostedMemberForPositiveSourceTx({
    dispatchContext,
    emailLinked: await resolveHostedMemberActivationEmailLinked({
      memberId: updatedMember.core.id,
    }),
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
  prisma: Prisma.TransactionClient,
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

  const { canonicalBillingStatus, member: preparedMember } = await prepareHostedMemberStripeBillingWrite({
    dispatchContext,
    member,
    prisma,
    stripeSubscriptionId: subscriptionId ?? member.billingRef?.stripeSubscriptionId ?? null,
  });

  await updateHostedMemberStripeBillingIfFreshTx({
    billingStatus: HostedBillingStatus.past_due,
    canonicalBillingStatus,
    dispatchContext,
    member: preparedMember,
    stripeCustomerId: coerceStripeObjectId(invoice.customer) ?? member.billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: subscriptionId ?? member.billingRef?.stripeSubscriptionId ?? null,
    tx: prisma,
  });
}

export async function applyStripeRefundCreated(
  refund: Stripe.Refund,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: Prisma.TransactionClient,
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

  const { canonicalBillingStatus, member: preparedMember } = await prepareHostedMemberStripeBillingWrite({
    dispatchContext: {
      eventCreatedAt: dispatchContext.eventCreatedAt,
      occurredAt: dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: dispatchContext.sourceEventId,
      sourceType: dispatchContext.sourceType,
    },
    member,
    prisma,
    stripeSubscriptionId: member.billingRef?.stripeSubscriptionId ?? null,
  });

  await suspendHostedMemberForBillingReversalTx({
    canonicalBillingStatus,
    dispatchContext,
    member: preparedMember,
    stripeCustomerId: customerId ?? undefined,
    tx: prisma,
  });
}

export async function applyStripeDisputeUpdated(
  dispute: Stripe.Dispute,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: Prisma.TransactionClient,
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

  const { canonicalBillingStatus, member: preparedMember } = await prepareHostedMemberStripeBillingWrite({
    dispatchContext: {
      eventCreatedAt: dispatchContext.eventCreatedAt,
      occurredAt: dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: dispatchContext.sourceEventId,
      sourceType: dispatchContext.sourceType,
    },
    member,
    prisma,
    stripeSubscriptionId: member.billingRef?.stripeSubscriptionId ?? null,
  });

  await suspendHostedMemberForBillingReversalTx({
    canonicalBillingStatus,
    dispatchContext,
    member: preparedMember,
    stripeCustomerId: customerId ?? undefined,
    tx: prisma,
  });
}
