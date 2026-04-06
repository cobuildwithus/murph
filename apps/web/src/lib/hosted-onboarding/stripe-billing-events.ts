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
import { isHostedAccessBlockedBillingStatus } from "./entitlement";

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
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
    };
  }

  const hadActiveBilling = member.billingStatus === HostedBillingStatus.active;
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
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
    };
  }

  // Keep old payment-mode checkout sessions drainable until the persisted rows age out.
  if (mode === HostedBillingMode.payment && paymentSettled) {
    const activation = await activateHostedMemberForPositiveSource({
      billingMode: mode,
      dispatchContext,
      member: updatedMember,
      prisma,
      skipIfBillingAlreadyActive: hadActiveBilling,
      sourceType: "stripe.checkout.session.completed",
    });

    return {
      activatedMemberId: activation.activated ? updatedMember.id : null,
      hostedExecutionEventId: activation.hostedExecutionEventId,
    };
  }

  return {
    activatedMemberId: null,
    hostedExecutionEventId: null,
  };
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

  if (!member) {
    return {
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: null,
    };
  }

  if (!subscriptionId) {
    return {
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: null,
    };
  }

  const hadActiveBilling = member.billingStatus === HostedBillingStatus.active;
  const startingBillingStatus = member.billingStatus;
  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    billingMode: HostedBillingMode.subscription,
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

  if (
    isHostedAccessBlockedBillingStatus(startingBillingStatus)
  ) {
    return {
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      hostedExecutionEventId: null,
    };
  }

  const activation = await activateHostedMemberForPositiveSource({
    billingMode: HostedBillingMode.subscription,
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
    billingMode: HostedBillingMode.subscription,
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
