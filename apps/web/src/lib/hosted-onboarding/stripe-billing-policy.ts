import {
  HostedBillingMode,
  HostedBillingStatus,
  HostedInviteStatus,
  HostedMemberStatus,
  HostedRevnetIssuanceStatus,
  type Prisma,
} from "@prisma/client";
import type Stripe from "stripe";

import { provisionManagedUserCryptoInHostedExecution } from "../hosted-execution/control";
import { enqueueHostedExecutionOutbox } from "../hosted-execution/outbox";
import {
  coerceStripeObjectId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import {
  buildHostedMemberActivationDispatch,
} from "./member-activation";
import {
  deriveHostedEntitlement,
  isHostedAccessBlockedBillingStatus,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  type HostedMemberAggregate,
  findHostedMemberByStripeCustomerId,
  findHostedMemberByStripeSubscriptionId,
  readHostedMemberAggregate,
  writeHostedMemberStripeBillingRef,
} from "./hosted-member-store";
import { requireHostedStripeApi } from "./runtime";
import {
  lockHostedMemberRow,
  withHostedOnboardingTransaction,
} from "./shared";

export type HostedStripeDispatchContext = {
  eventCreatedAt: Date;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
};

export type HostedMemberActivationResult = {
  activated: boolean;
  hostedExecutionEventId: string | null;
  memberId: string;
};

type HostedOnboardingPrismaClient = Prisma.TransactionClient;

export async function activateHostedMemberFromConfirmedRevnetIssuance(input: {
  member: HostedMemberAggregate;
  occurredAt: string;
  prisma: HostedOnboardingPrismaClient;
  sourceEventId: string;
  sourceType: string;
}): Promise<HostedMemberActivationResult> {
  const activated = await tryActivateHostedMemberIfStillAllowed({
    billingMode: input.member.billingMode,
    member: input.member,
    prisma: input.prisma,
    revnetIssuanceStatus: HostedRevnetIssuanceStatus.confirmed,
    revnetRequired: true,
  });

  if (!activated) {
    return {
      activated: false,
      hostedExecutionEventId: null,
      memberId: input.member.id,
    };
  }

  await provisionManagedUserCryptoInHostedExecution(input.member.id);

  const dispatch = buildHostedMemberActivationDispatch({
    linqChatId: input.member.linqChatId,
    memberId: input.member.id,
    phoneLookupKey: input.member.phoneLookupKey,
    occurredAt: input.occurredAt,
    sourceEventId: input.sourceEventId,
    sourceType: input.sourceType,
  });
  await enqueueHostedExecutionOutbox({
    dispatch,
    sourceId: input.sourceEventId,
    sourceType: "hosted_revnet_issuance",
    tx: input.prisma,
  });

  return {
    activated: true,
    hostedExecutionEventId: dispatch.eventId,
    memberId: input.member.id,
  };
}

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

export async function activateHostedMemberForPositiveSource(input: {
  billingMode: HostedBillingMode;
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberAggregate;
  prisma: HostedOnboardingPrismaClient;
  skipIfBillingAlreadyActive?: boolean;
  sourceType: string;
}): Promise<HostedMemberActivationResult> {
  const activated = await tryActivateHostedMemberIfStillAllowed({
    billingMode: input.billingMode,
    member: input.member,
    prisma: input.prisma,
    skipIfBillingAlreadyActive: input.skipIfBillingAlreadyActive ?? false,
  });

  if (!activated) {
    return {
      activated: false,
      hostedExecutionEventId: null,
      memberId: input.member.id,
    };
  }

  await provisionManagedUserCryptoInHostedExecution(input.member.id);

  const dispatch = buildHostedMemberActivationDispatch({
    linqChatId: input.member.linqChatId,
    memberId: input.member.id,
    phoneLookupKey: input.member.phoneLookupKey,
    occurredAt: input.dispatchContext.occurredAt,
    sourceEventId: input.dispatchContext.sourceEventId,
    sourceType: input.sourceType,
  });
  await enqueueHostedExecutionOutbox({
    dispatch,
    sourceId: `stripe:${input.dispatchContext.sourceEventId}`,
    sourceType: "hosted_stripe_event",
    tx: input.prisma,
  });

  return {
    activated: true,
    hostedExecutionEventId: dispatch.eventId,
    memberId: input.member.id,
  };
}

async function tryActivateHostedMemberIfStillAllowed(input: {
  billingMode: HostedBillingMode | null;
  member: HostedMemberAggregate;
  prisma: HostedOnboardingPrismaClient;
  revnetIssuanceStatus?: HostedRevnetIssuanceStatus | null;
  revnetRequired?: boolean;
  skipIfBillingAlreadyActive?: boolean;
}): Promise<boolean> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.id);

    const currentMember = await findHostedMemberById(tx, input.member.id);

    if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.billingStatus)) {
      return false;
    }

    if (
      input.skipIfBillingAlreadyActive &&
      currentMember.billingStatus === HostedBillingStatus.active
    ) {
      return false;
    }

    const entitlement = deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      memberStatus: currentMember.status,
      revnetIssuanceStatus: input.revnetIssuanceStatus,
      revnetRequired: input.revnetRequired,
    });

    if (!entitlement.activationReady) {
      return false;
    }

    await tx.hostedMember.update({
      where: {
        id: currentMember.id,
      },
      data: {
        billingMode: input.billingMode ?? currentMember.billingMode,
        billingStatus: HostedBillingStatus.active,
        status: HostedMemberStatus.registered,
      },
    });

    await tx.hostedInvite.updateMany({
      where: {
        memberId: currentMember.id,
        paidAt: null,
      },
      data: {
        paidAt: new Date(),
        status: HostedInviteStatus.paid,
      },
    });

    return true;
  });
}

export async function updateHostedMemberStripeBillingIfFresh(input: {
  billingMode: HostedBillingMode | null;
  billingStatus: HostedBillingStatus;
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberAggregate;
  memberStatusOverride?: HostedMemberStatus;
  prisma: HostedOnboardingPrismaClient;
  stripeCustomerId?: string | null;
  stripeLatestCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<HostedMemberAggregate | null> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.id);

    const currentMember = await findHostedMemberById(tx, input.member.id);

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
      billingStatus: input.billingStatus,
      memberStatus: currentMember.status,
    });

    await tx.hostedMember.update({
      where: {
        id: currentMember.id,
      },
      data: {
        billingMode: input.billingMode,
        billingStatus: input.billingStatus,
        status: input.memberStatusOverride ?? entitlement.memberStatus,
      },
    });

    await writeHostedMemberStripeBillingRef({
      memberId: currentMember.id,
      prisma: tx,
      stripeCustomerId: input.stripeCustomerId,
      stripeLatestBillingEventCreatedAt: input.dispatchContext.eventCreatedAt,
      stripeLatestBillingEventId: input.dispatchContext.sourceEventId,
      stripeLatestCheckoutSessionId: input.stripeLatestCheckoutSessionId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    });

    return findHostedMemberById(tx, currentMember.id);
  });
}

async function findHostedMemberById(
  prisma: HostedOnboardingPrismaClient,
  memberId: string,
): Promise<HostedMemberAggregate | null> {
  return readHostedMemberAggregate({
    memberId,
    prisma,
  });
}

async function shouldApplyHostedStripeBillingUpdate(input: {
  billingMode: HostedBillingMode | null;
  billingStatus: HostedBillingStatus;
  currentMember: HostedMemberAggregate;
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
  currentMember: HostedMemberAggregate;
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
  currentMember: HostedMemberAggregate;
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

export async function suspendHostedMemberForBillingReversal(input: {
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  member: HostedMemberAggregate;
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
    stripeCustomerId: input.stripeCustomerId,
  });

  if (!updatedMember) {
    return;
  }
}

export async function findMemberForStripeObject(input: {
  clientReferenceId: string | null;
  customerId: string | null;
  memberId: string | null;
  prisma: HostedOnboardingPrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMemberAggregate | null> {
  if (input.memberId) {
    const member = await findHostedMemberById(input.prisma, input.memberId);

    if (member) {
      return member;
    }
  }

  if (input.clientReferenceId) {
    const member = await findHostedMemberById(input.prisma, input.clientReferenceId);

    if (member) {
      return member;
    }
  }

  if (input.subscriptionId) {
    const member = await findHostedMemberByStripeSubscriptionId({
      prisma: input.prisma,
      stripeSubscriptionId: input.subscriptionId,
    });

    if (member) {
      return findHostedMemberById(input.prisma, member.id);
    }
  }

  if (input.customerId) {
    const member = await findHostedMemberByStripeCustomerId({
      prisma: input.prisma,
      stripeCustomerId: input.customerId,
    });

    if (member) {
      return findHostedMemberById(input.prisma, member.id);
    }
  }

  return null;
}

export async function findMemberForStripeReversal(input: {
  chargeId: string | null;
  customerId: string | null;
  paymentIntentId: string | null;
  prisma: HostedOnboardingPrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMemberAggregate | null> {
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

  return issuance?.member
    ? findHostedMemberById(input.prisma, issuance.member.id)
    : null;
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
