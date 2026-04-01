import {
  HostedBillingMode,
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
import { deriveHostedEntitlement } from "./entitlement";
import { isHostedOnboardingRevnetEnabled } from "./revnet";
import { normalizeNullableString } from "./shared";
import { revokeHostedSessionsForMember } from "./session";
import {
  activateHostedMemberForPositiveSource,
  findMemberForStripeObject,
  findMemberForStripeReversal,
  resolveHostedSubscriptionBillingStatus,
  suspendHostedMemberForBillingReversal,
  type HostedStripeDispatchContext,
  updateHostedMemberStripeBillingIfFresh,
} from "./stripe-billing-policy";
import { ensureHostedRevnetIssuanceForStripeInvoice } from "./stripe-revnet-issuance";

type HostedOnboardingPrismaClient = Prisma.TransactionClient;

export async function applyStripeCheckoutCompleted(
  session: Stripe.Checkout.Session,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<void> {
  const member = await findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(session.client_reference_id),
    customerId: coerceStripeObjectId(session.customer),
    memberId: normalizeNullableString(session.metadata?.memberId),
    prisma,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  });
  const mode = session.mode === "subscription" ? HostedBillingMode.subscription : HostedBillingMode.payment;
  const paymentSettled =
    session.payment_status === "paid" || session.payment_status === "no_payment_required";
  const nextBillingStatus = resolveHostedCheckoutCompletedBillingStatus({
    currentBillingStatus: member?.billingStatus ?? null,
    mode,
    paymentSettled,
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
    return;
  }

  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    billingMode: mode,
    billingStatus: nextBillingStatus,
    dispatchContext,
    member,
    prisma,
    stripeCustomerId: coerceStripeObjectId(session.customer) ?? member.stripeCustomerId,
    stripeLatestCheckoutSessionId: session.id,
    stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription) ?? member.stripeSubscriptionId,
  });

  if (!updatedMember) {
    return;
  }

  if (mode === HostedBillingMode.payment && paymentSettled) {
    await activateHostedMemberForPositiveSource({
      billingMode: mode,
      dispatchContext,
      member: updatedMember,
      prisma,
      sourceType: "stripe.checkout.session.completed",
    });
  }
}

export async function applyStripeCheckoutExpired(
  session: Stripe.Checkout.Session,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<void> {
  await expireHostedBillingAttemptBySessionId({
    prisma,
    stripeCheckoutSessionId: session.id,
  });

  const member = await findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(session.client_reference_id),
    customerId: coerceStripeObjectId(session.customer),
    memberId: normalizeNullableString(session.metadata?.memberId),
    prisma,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  });

  if (
    member &&
    member.billingStatus === HostedBillingStatus.checkout_open &&
    member.stripeLatestCheckoutSessionId === session.id
  ) {
    await updateHostedMemberStripeBillingIfFresh({
      billingMode: member.billingMode,
      billingStatus: HostedBillingStatus.not_started,
      dispatchContext,
      member,
      prisma,
      stripeLatestCheckoutSessionId: session.id,
    });
  }
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
  const previousEntitlement = deriveHostedEntitlement({
    billingMode: HostedBillingMode.subscription,
    billingStatus: member.billingStatus,
    memberStatus: member.status,
  });
  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    billingMode: HostedBillingMode.subscription,
    billingStatus: nextBillingStatus,
    dispatchContext,
    member,
    prisma,
    stripeCustomerId: coerceStripeObjectId(subscription.customer) ?? member.stripeCustomerId,
    stripeSubscriptionId: subscription.id,
  });

  if (!updatedMember) {
    return;
  }

  const nextEntitlement = deriveHostedEntitlement({
    billingMode: HostedBillingMode.subscription,
    billingStatus: updatedMember.billingStatus,
    memberStatus: updatedMember.status,
  });

  if (previousEntitlement.accessAllowed && !nextEntitlement.accessAllowed) {
    await revokeHostedSessionsForMember({
      memberId: updatedMember.id,
      now: dispatchContext.eventCreatedAt,
      prisma,
      reason: `billing_status:${updatedMember.billingStatus}`,
    });
  }
}

export async function applyStripeInvoicePaid(
  invoice: Stripe.Invoice,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<boolean> {
  const subscriptionId = coerceStripeInvoiceSubscriptionId(invoice);
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: coerceStripeObjectId(invoice.customer),
    memberId: null,
    prisma,
    subscriptionId,
  });

  if (!member) {
    return false;
  }

  const billingMode = subscriptionId ? HostedBillingMode.subscription : (member.billingMode ?? HostedBillingMode.payment);
  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    billingMode,
    billingStatus:
      billingMode === HostedBillingMode.subscription && isHostedOnboardingRevnetEnabled()
        ? resolveHostedSubscriptionBillingStatus({
          currentBillingStatus: member.billingStatus,
          nextBillingStatus: HostedBillingStatus.active,
        })
        : HostedBillingStatus.active,
    dispatchContext,
    member,
    prisma,
    stripeCustomerId: coerceStripeObjectId(invoice.customer) ?? member.stripeCustomerId,
    stripeSubscriptionId: subscriptionId ?? member.stripeSubscriptionId,
  });

  if (!updatedMember) {
    return false;
  }

  if (billingMode === HostedBillingMode.subscription && isHostedOnboardingRevnetEnabled()) {
    const issuance = await ensureHostedRevnetIssuanceForStripeInvoice({
      invoice,
      member: updatedMember,
      prisma,
    });

    return issuance !== null;
  }

  await activateHostedMemberForPositiveSource({
    billingMode,
    dispatchContext,
    member: updatedMember,
    prisma,
    sourceType: "stripe.invoice.paid",
  });

  return false;
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
    billingMode: member.billingMode,
    billingStatus:
      (member.billingMode ?? HostedBillingMode.payment) === HostedBillingMode.subscription
        ? HostedBillingStatus.past_due
        : HostedBillingStatus.incomplete,
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
    stripeCustomerId: customerId ?? null,
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
    stripeCustomerId: customerId ?? null,
  });
}

function resolveHostedCheckoutCompletedBillingStatus(input: {
  currentBillingStatus: HostedBillingStatus | null;
  mode: HostedBillingMode;
  paymentSettled: boolean;
}): HostedBillingStatus {
  if (input.mode === HostedBillingMode.subscription) {
    return input.currentBillingStatus === HostedBillingStatus.active
      ? HostedBillingStatus.active
      : HostedBillingStatus.incomplete;
  }

  return input.paymentSettled
    ? HostedBillingStatus.active
    : HostedBillingStatus.incomplete;
}
