import {
  HostedBillingMode,
  HostedBillingStatus,
  HostedInviteStatus,
  HostedMemberStatus,
  HostedRevnetIssuanceStatus,
  type HostedMember,
  type Prisma,
} from "@prisma/client";
import type Stripe from "stripe";

import { enqueueHostedExecutionOutbox } from "../hosted-execution/outbox";
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
import { buildHostedMemberActivationDispatch } from "./member-activation";
import {
  deriveHostedEntitlement,
  isHostedAccessBlockedBillingStatus,
} from "./entitlement";
import { isHostedOnboardingRevnetEnabled } from "./revnet";
import { hostedOnboardingError } from "./errors";
import { normalizeNullableString } from "./shared";
import { revokeHostedSessionsForMember } from "./session";
import { ensureHostedRevnetIssuanceForStripeInvoice } from "./stripe-revnet-issuance";
import { requireHostedStripeApi } from "./runtime";

export type HostedStripeDispatchContext = {
  eventCreatedAt: Date;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
};

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

export async function activateHostedMemberFromConfirmedRevnetIssuance(input: {
  member: HostedMember;
  occurredAt: string;
  prisma: HostedOnboardingPrismaClient;
  sourceEventId: string;
  sourceType: string;
}): Promise<void> {
  const activated = await tryActivateHostedMemberIfStillAllowed({
    billingMode: input.member.billingMode,
    member: input.member,
    prisma: input.prisma,
    revnetIssuanceStatus: HostedRevnetIssuanceStatus.confirmed,
    revnetRequired: true,
  });

  if (!activated) {
    return;
  }

  await enqueueHostedExecutionOutbox({
    dispatch: buildHostedMemberActivationDispatch({
      memberId: input.member.id,
      occurredAt: input.occurredAt,
      sourceEventId: input.sourceEventId,
      sourceType: input.sourceType,
    }),
    sourceId: input.sourceEventId,
    sourceType: "hosted_revnet_issuance",
    tx: input.prisma,
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

function resolveHostedSubscriptionBillingStatus(input: {
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

async function activateHostedMemberForPositiveSource(input: {
  billingMode: HostedBillingMode;
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMember;
  prisma: HostedOnboardingPrismaClient;
  sourceType: string;
}): Promise<void> {
  const activated = await tryActivateHostedMemberIfStillAllowed({
    billingMode: input.billingMode,
    member: input.member,
    prisma: input.prisma,
  });

  if (!activated) {
    return;
  }

  await enqueueHostedExecutionOutbox({
    dispatch: buildHostedMemberActivationDispatch({
      memberId: input.member.id,
      occurredAt: input.dispatchContext.occurredAt,
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.sourceType,
    }),
    sourceId: `stripe:${input.dispatchContext.sourceEventId}`,
    sourceType: "hosted_stripe_event",
    tx: input.prisma,
  });
}

async function tryActivateHostedMemberIfStillAllowed(input: {
  billingMode: HostedBillingMode | null;
  member: HostedMember;
  prisma: HostedOnboardingPrismaClient;
  revnetIssuanceStatus?: HostedRevnetIssuanceStatus | null;
  revnetRequired?: boolean;
}): Promise<boolean> {
  const entitlement = deriveHostedEntitlement({
    billingMode: input.billingMode ?? input.member.billingMode,
    billingStatus: HostedBillingStatus.active,
    memberStatus: input.member.status,
    revnetIssuanceStatus: input.revnetIssuanceStatus,
    revnetRequired: input.revnetRequired,
  });

  if (!entitlement.activationReady) {
    return false;
  }

  const activationResult = await input.prisma.hostedMember.updateMany({
    where: {
      billingStatus: {
        notIn: [
          HostedBillingStatus.canceled,
          HostedBillingStatus.paused,
          HostedBillingStatus.unpaid,
        ],
      },
      id: input.member.id,
      status: {
        not: HostedMemberStatus.suspended,
      },
      stripeLatestBillingEventCreatedAt: input.member.stripeLatestBillingEventCreatedAt,
      stripeLatestBillingEventId: input.member.stripeLatestBillingEventId,
    },
    data: {
      billingMode: input.billingMode ?? input.member.billingMode,
      billingStatus: HostedBillingStatus.active,
      status: HostedMemberStatus.active,
    },
  });

  if (activationResult.count !== 1) {
    return false;
  }

  await input.prisma.hostedInvite.updateMany({
    where: {
      memberId: input.member.id,
      paidAt: null,
    },
    data: {
      paidAt: new Date(),
      status: HostedInviteStatus.paid,
    },
  });

  return true;
}

async function updateHostedMemberStripeBillingIfFresh(input: {
  billingMode: HostedBillingMode | null;
  billingStatus: HostedBillingStatus;
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMember;
  memberStatusOverride?: HostedMemberStatus;
  prisma: HostedOnboardingPrismaClient;
  stripeCustomerId?: string | null;
  stripeLatestCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<HostedMember | null> {
  const currentMember = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.member.id,
    },
  });

  if (!currentMember) {
    return null;
  }

  const isFresh = await shouldApplyHostedStripeBillingUpdate({
    billingMode: input.billingMode,
    billingStatus: input.billingStatus,
    currentMember,
    dispatchContext: input.dispatchContext,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });

  if (!isFresh) {
    return null;
  }

  const entitlement = deriveHostedEntitlement({
    billingMode: input.billingMode ?? currentMember.billingMode,
    billingStatus: input.billingStatus,
    memberStatus: currentMember.status,
  });
  const updateResult = await input.prisma.hostedMember.updateMany({
    where: buildHostedMemberStripeEventSnapshotWhere(currentMember),
    data: {
      billingMode: input.billingMode,
      billingStatus: input.billingStatus,
      status: input.memberStatusOverride ?? entitlement.memberStatus,
      stripeCustomerId: input.stripeCustomerId,
      stripeLatestBillingEventCreatedAt: input.dispatchContext.eventCreatedAt,
      stripeLatestBillingEventId: input.dispatchContext.sourceEventId,
      ...(input.stripeLatestCheckoutSessionId !== undefined
        ? { stripeLatestCheckoutSessionId: input.stripeLatestCheckoutSessionId }
        : {}),
      ...(input.stripeSubscriptionId !== undefined
        ? { stripeSubscriptionId: input.stripeSubscriptionId }
        : {}),
    },
  });

  if (updateResult.count !== 1) {
    return null;
  }

  return input.prisma.hostedMember.findUnique({
    where: {
      id: currentMember.id,
    },
  });
}

function buildHostedMemberStripeEventSnapshotWhere(
  member: HostedMember,
): Prisma.HostedMemberWhereInput {
  return {
    id: member.id,
    stripeLatestBillingEventCreatedAt: member.stripeLatestBillingEventCreatedAt,
    stripeLatestBillingEventId: member.stripeLatestBillingEventId,
  };
}

async function shouldApplyHostedStripeBillingUpdate(input: {
  billingMode: HostedBillingMode | null;
  billingStatus: HostedBillingStatus;
  currentMember: HostedMember;
  dispatchContext: HostedStripeDispatchContext;
  stripeSubscriptionId?: string | null;
}): Promise<boolean> {
  const currentEventCreatedAt = input.currentMember.stripeLatestBillingEventCreatedAt;

  if (!currentEventCreatedAt) {
    return true;
  }

  const currentEventTime = currentEventCreatedAt.getTime();
  const nextEventTime = input.dispatchContext.eventCreatedAt.getTime();

  if (currentEventTime < nextEventTime) {
    return true;
  }

  if (currentEventTime > nextEventTime) {
    return false;
  }

  if (input.currentMember.stripeLatestBillingEventId === input.dispatchContext.sourceEventId) {
    return true;
  }

  return shouldApplyHostedSameSecondStripeCollision(input);
}

async function shouldApplyHostedSameSecondStripeCollision(input: {
  billingMode: HostedBillingMode | null;
  billingStatus: HostedBillingStatus;
  currentMember: HostedMember;
  dispatchContext: HostedStripeDispatchContext;
  stripeSubscriptionId?: string | null;
}): Promise<boolean> {
  if (isHostedStripeBillingReversalSourceType(input.dispatchContext.sourceType)) {
    return true;
  }

  const canonicalBillingStatus = await resolveHostedCanonicalStripeBillingStatus(input);

  if (canonicalBillingStatus !== null) {
    if (input.billingStatus === canonicalBillingStatus) {
      return true;
    }

    if (
      input.dispatchContext.sourceType === "stripe.invoice.paid" &&
      input.billingStatus ===
        resolveHostedSubscriptionBillingStatus({
          currentBillingStatus: input.currentMember.billingStatus,
          nextBillingStatus: canonicalBillingStatus,
        })
    ) {
      return true;
    }

    if (isHostedStripeSubscriptionSourceType(input.dispatchContext.sourceType)) {
      return (
        input.billingStatus ===
        resolveHostedSubscriptionBillingStatus({
          currentBillingStatus: input.currentMember.billingStatus,
          nextBillingStatus: canonicalBillingStatus,
        })
      );
    }

    return false;
  }

  if (isHostedAccessBlockedBillingStatus(input.billingStatus)) {
    return true;
  }

  return false;
}

async function resolveHostedCanonicalStripeBillingStatus(input: {
  billingMode: HostedBillingMode | null;
  currentMember: HostedMember;
  dispatchContext: HostedStripeDispatchContext;
  stripeSubscriptionId?: string | null;
}): Promise<HostedBillingStatus | null> {
  const subscriptionId = input.stripeSubscriptionId ?? input.currentMember.stripeSubscriptionId;
  const billingMode = input.billingMode ?? input.currentMember.billingMode;

  if (billingMode !== HostedBillingMode.subscription || !subscriptionId) {
    return null;
  }

  try {
    const stripe = requireHostedStripeApi();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status);
  } catch {
    return null;
  }
}

function isHostedStripeBillingReversalSourceType(sourceType: string): boolean {
  return sourceType === "stripe.refund.created" || sourceType.startsWith("stripe.charge.dispute.");
}

function isHostedStripeSubscriptionSourceType(sourceType: string): boolean {
  return sourceType === "stripe.customer.subscription.created" ||
    sourceType === "stripe.customer.subscription.updated" ||
    sourceType === "stripe.customer.subscription.deleted";
}

async function suspendHostedMemberForBillingReversal(input: {
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  member: HostedMember;
  prisma: HostedOnboardingPrismaClient;
  reason: string;
  stripeCustomerId?: string | null;
}): Promise<void> {
  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    billingMode: input.member.billingMode,
    billingStatus: HostedBillingStatus.unpaid,
    dispatchContext: {
      eventCreatedAt: input.dispatchContext.eventCreatedAt,
      occurredAt: input.dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.reason,
    },
    member: input.member,
    memberStatusOverride: HostedMemberStatus.suspended,
    prisma: input.prisma,
    stripeCustomerId: input.stripeCustomerId ?? input.member.stripeCustomerId,
  });

  if (!updatedMember) {
    return;
  }

  await revokeHostedSessionsForMember({
    memberId: updatedMember.id,
    now: input.dispatchContext.eventCreatedAt,
    prisma: input.prisma,
    reason: `billing_reversal:${input.reason}`,
  });
}

async function findMemberForStripeObject(input: {
  clientReferenceId: string | null;
  customerId: string | null;
  memberId: string | null;
  prisma: HostedOnboardingPrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMember | null> {
  if (input.memberId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
    });

    if (member) {
      return member;
    }
  }

  if (input.clientReferenceId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        id: input.clientReferenceId,
      },
    });

    if (member) {
      return member;
    }
  }

  if (input.subscriptionId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        stripeSubscriptionId: input.subscriptionId,
      },
    });

    if (member) {
      return member;
    }
  }

  if (input.customerId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        stripeCustomerId: input.customerId,
      },
    });

    if (member) {
      return member;
    }
  }

  return null;
}

async function findMemberForStripeReversal(input: {
  chargeId: string | null;
  customerId: string | null;
  paymentIntentId: string | null;
  prisma: HostedOnboardingPrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMember | null> {
  const directMember = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: input.customerId,
    memberId: null,
    prisma: input.prisma,
    subscriptionId: input.subscriptionId,
  });

  if (directMember) {
    return directMember;
  }

  if (!input.chargeId && !input.paymentIntentId) {
    return null;
  }

  const issuance = await input.prisma.hostedRevnetIssuance.findFirst({
    where: {
      OR: [
        ...(input.chargeId
          ? [
            {
              stripeChargeId: input.chargeId,
            },
          ]
          : []),
        ...(input.paymentIntentId
          ? [
            {
              stripePaymentIntentId: input.paymentIntentId,
            },
          ]
          : []),
      ],
    },
    include: {
      member: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return issuance?.member ?? null;
}

export async function resolveStripeCustomerContext(input: {
  chargeId: string | null;
  paymentIntentId: string | null;
}): Promise<{ customerId: string | null }> {
  const stripe = requireHostedStripeApi();

  if (input.chargeId) {
    const charge = await stripe.charges.retrieve(input.chargeId);

    return {
      customerId: coerceStripeObjectId((charge as Stripe.Charge & { customer?: unknown }).customer ?? null),
    };
  }

  if (input.paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(input.paymentIntentId);

    return {
      customerId: coerceStripeObjectId(
        (paymentIntent as Stripe.PaymentIntent & { customer?: unknown }).customer ?? null,
      ),
    };
  }

  return {
    customerId: null,
  };
}

export function requireHostedStripeEventPayload(payloadJson: Prisma.JsonValue): {
  object: Record<string, unknown>;
  type: string;
} {
  if (!payloadJson || typeof payloadJson !== "object" || Array.isArray(payloadJson)) {
    throw hostedOnboardingError({
      code: "STRIPE_EVENT_PAYLOAD_INVALID",
      message: "Stored hosted Stripe event payload must be an object.",
      httpStatus: 500,
    });
  }

  const payload = payloadJson as Record<string, unknown>;

  if (!payload.object || typeof payload.object !== "object" || Array.isArray(payload.object)) {
    throw hostedOnboardingError({
      code: "STRIPE_EVENT_PAYLOAD_INVALID",
      message: "Stored hosted Stripe event payload is missing its object snapshot.",
      httpStatus: 500,
    });
  }

  if (typeof payload.type !== "string") {
    throw hostedOnboardingError({
      code: "STRIPE_EVENT_PAYLOAD_INVALID",
      message: "Stored hosted Stripe event payload is missing its type.",
      httpStatus: 500,
    });
  }

  return {
    object: payload.object as Record<string, unknown>,
    type: payload.type,
  };
}
