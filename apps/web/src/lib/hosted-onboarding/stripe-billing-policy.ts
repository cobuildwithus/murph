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
import { requireHostedStripeApi } from "./runtime";

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
const HOSTED_MEMBER_MUTATION_MAX_RETRIES = 4;

export async function activateHostedMemberFromConfirmedRevnetIssuance(input: {
  member: HostedMember;
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

  const dispatch = buildHostedMemberActivationDispatch({
    memberId: input.member.id,
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
  member: HostedMember;
  prisma: HostedOnboardingPrismaClient;
  sourceType: string;
}): Promise<HostedMemberActivationResult> {
  const activated = await tryActivateHostedMemberIfStillAllowed({
    billingMode: input.billingMode,
    member: input.member,
    prisma: input.prisma,
  });

  if (!activated) {
    return {
      activated: false,
      hostedExecutionEventId: null,
      memberId: input.member.id,
    };
  }

  const dispatch = buildHostedMemberActivationDispatch({
    memberId: input.member.id,
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
  member: HostedMember;
  prisma: HostedOnboardingPrismaClient;
  revnetIssuanceStatus?: HostedRevnetIssuanceStatus | null;
  revnetRequired?: boolean;
}): Promise<boolean> {
  let currentMember: HostedMember | null = input.member;

  for (let retryCount = 0; retryCount <= HOSTED_MEMBER_MUTATION_MAX_RETRIES; retryCount += 1) {
    if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.billingStatus)) {
      return false;
    }

    if (currentMember.status === HostedMemberStatus.active) {
      return false;
    }

    const entitlement = deriveHostedEntitlement({
      billingMode: input.billingMode ?? currentMember.billingMode,
      billingStatus: HostedBillingStatus.active,
      memberStatus: currentMember.status,
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
        id: currentMember.id,
        status: {
          not: HostedMemberStatus.suspended,
        },
        stripeLatestBillingEventCreatedAt: currentMember.stripeLatestBillingEventCreatedAt,
        stripeLatestBillingEventId: currentMember.stripeLatestBillingEventId,
      },
      data: {
        billingMode: input.billingMode ?? currentMember.billingMode,
        billingStatus: HostedBillingStatus.active,
        status: HostedMemberStatus.active,
      },
    });

    if (activationResult.count === 1) {
      await input.prisma.hostedInvite.updateMany({
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
    }

    currentMember = await findHostedMemberById(input.prisma, currentMember.id);
  }

  return false;
}

export async function updateHostedMemberStripeBillingIfFresh(input: {
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
  let currentMember = await findHostedMemberById(input.prisma, input.member.id);

  for (let retryCount = 0; retryCount <= HOSTED_MEMBER_MUTATION_MAX_RETRIES; retryCount += 1) {
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

    if (updateResult.count === 1) {
      return findHostedMemberById(input.prisma, currentMember.id);
    }

    currentMember = await findHostedMemberById(input.prisma, currentMember.id);
  }

  return null;
}

async function findHostedMemberById(
  prisma: HostedOnboardingPrismaClient,
  memberId: string,
): Promise<HostedMember | null> {
  return prisma.hostedMember.findUnique({
    where: {
      id: memberId,
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

export async function suspendHostedMemberForBillingReversal(input: {
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
}

export async function findMemberForStripeObject(input: {
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

export async function findMemberForStripeReversal(input: {
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
