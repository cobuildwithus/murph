import {
  HostedBillingStatus,
  HostedRevnetIssuanceStatus,
  type Prisma,
} from "@prisma/client";
import type Stripe from "stripe";

import { provisionManagedUserCryptoInHostedExecution } from "../hosted-execution/control";
import {
  enqueueHostedExecutionOutbox,
} from "../hosted-execution/outbox";
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
import {
  type HostedMemberAggregate,
  findHostedMemberByStripeCustomerId,
  findHostedMemberByStripeSubscriptionId,
  readHostedMemberAggregate,
  updateHostedMemberCoreState,
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

export type HostedMemberActivationTransactionResult = HostedMemberActivationResult & {
  postCommitProvisionUserId: string | null;
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
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberAggregate;
  prisma: HostedOnboardingPrismaClient;
  skipIfBillingAlreadyActive?: boolean;
  sourceType: string;
}): Promise<HostedMemberActivationTransactionResult> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.id);

    const currentMember = await findHostedMemberById(tx, input.member.id);

    if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.billingStatus)) {
      return buildHostedInactiveMemberActivationResult(input.member.id);
    }

    const dispatch = buildHostedMemberActivationDispatch({
      linqChatId: currentMember.linqChatId,
      memberId: currentMember.id,
      phoneLookupKey: currentMember.phoneLookupKey,
      occurredAt: input.dispatchContext.occurredAt,
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.sourceType,
    });

    if (
      input.skipIfBillingAlreadyActive &&
      currentMember.billingStatus === HostedBillingStatus.active
    ) {
      const existingDispatch = await tx.executionOutbox.findUnique({
        where: {
          eventId: dispatch.eventId,
        },
        select: {
          eventId: true,
        },
      });

      return existingDispatch
        ? {
            activated: false,
            hostedExecutionEventId: existingDispatch.eventId,
            memberId: currentMember.id,
            postCommitProvisionUserId: currentMember.id,
          }
        : buildHostedInactiveMemberActivationResult(currentMember.id);
    }

    const entitlement = deriveHostedEntitlement({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: currentMember.suspendedAt,
    });

    if (!entitlement.activationReady) {
      return buildHostedInactiveMemberActivationResult(currentMember.id);
    }

    await updateHostedMemberCoreState({
      billingStatus: HostedBillingStatus.active,
      memberId: currentMember.id,
      prisma: tx,
    });

    const outboxRecord = await enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: `stripe:${input.dispatchContext.sourceEventId}`,
      sourceType: "hosted_stripe_event",
      tx,
    });

    return {
      activated: true,
      hostedExecutionEventId: outboxRecord.eventId,
      memberId: currentMember.id,
      postCommitProvisionUserId: currentMember.id,
    };
  });
}

async function tryActivateHostedMemberIfStillAllowed(input: {
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
      revnetIssuanceStatus: input.revnetIssuanceStatus,
      revnetRequired: input.revnetRequired,
      suspendedAt: currentMember.suspendedAt,
    });

    if (!entitlement.activationReady) {
      return false;
    }

    await updateHostedMemberCoreState({
      billingStatus: HostedBillingStatus.active,
      memberId: currentMember.id,
      prisma: tx,
    });

    return true;
  });
}

function buildHostedInactiveMemberActivationResult(
  memberId: string,
): HostedMemberActivationTransactionResult {
  return {
    activated: false,
    hostedExecutionEventId: null,
    memberId,
    postCommitProvisionUserId: null,
  };
}

export async function updateHostedMemberStripeBillingIfFresh(input: {
  billingStatus: HostedBillingStatus;
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberAggregate;
  prisma: HostedOnboardingPrismaClient;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  suspendedAtOverride?: Date | null;
}): Promise<HostedMemberAggregate | null> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.member.id);

    const currentMember = await findHostedMemberById(tx, input.member.id);

    if (!currentMember) {
      return null;
    }

    const nextBillingStatus = await resolveHostedBillingStatusForWrite({
      billingStatus: input.billingStatus,
      currentMember,
      dispatchContext: input.dispatchContext,
      stripeSubscriptionId: input.stripeSubscriptionId,
    });

    await updateHostedMemberCoreState({
      billingStatus: nextBillingStatus,
      memberId: currentMember.id,
      prisma: tx,
      suspendedAt: input.suspendedAtOverride,
    });

    await writeHostedMemberStripeBillingRef({
      memberId: currentMember.id,
      prisma: tx,
      stripeCustomerId: input.stripeCustomerId,
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

async function resolveHostedBillingStatusForWrite(input: {
  billingStatus: HostedBillingStatus;
  currentMember: HostedMemberAggregate;
  dispatchContext: HostedStripeDispatchContext;
  stripeSubscriptionId?: string | null;
}): Promise<HostedBillingStatus> {
  if (isHostedStripeBillingReversalSourceType(input.dispatchContext.sourceType)) {
    return input.billingStatus;
  }

  const canonicalBillingStatus = await resolveHostedCanonicalStripeBillingStatus(input);

  if (canonicalBillingStatus !== null) {
    if (isHostedStripeSubscriptionSourceType(input.dispatchContext.sourceType)) {
      return resolveHostedSubscriptionBillingStatus({
        currentBillingStatus: input.currentMember.billingStatus,
        nextBillingStatus: canonicalBillingStatus,
      });
    }

    if (input.dispatchContext.sourceType === "stripe.invoice.paid") {
      return canonicalBillingStatus === HostedBillingStatus.active
        ? HostedBillingStatus.active
        : canonicalBillingStatus;
    }

    return canonicalBillingStatus;
  }

  if (
    isHostedStripeSubscriptionSourceType(input.dispatchContext.sourceType) ||
    isHostedStripeInvoiceSourceType(input.dispatchContext.sourceType)
  ) {
    throw new Error(
      `Canonical Stripe subscription state is required for ${input.dispatchContext.sourceType}.`,
    );
  }

  return input.billingStatus;
}

async function resolveHostedCanonicalStripeBillingStatus(input: {
  currentMember: HostedMemberAggregate;
  dispatchContext: HostedStripeDispatchContext;
  stripeSubscriptionId?: string | null;
}): Promise<HostedBillingStatus | null> {
  const subscriptionId = input.stripeSubscriptionId ?? input.currentMember.stripeSubscriptionId;

  if (!subscriptionId) {
    return null;
  }

  const stripe = requireHostedStripeApi();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status);
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

export async function suspendHostedMemberForBillingReversal(input: {
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  member: HostedMemberAggregate;
  prisma: HostedOnboardingPrismaClient;
  reason: string;
  stripeCustomerId?: string | null;
}): Promise<void> {
  await updateHostedMemberStripeBillingIfFresh({
    billingStatus: HostedBillingStatus.unpaid,
    dispatchContext: {
      eventCreatedAt: input.dispatchContext.eventCreatedAt,
      occurredAt: input.dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.reason,
    },
    member: input.member,
    prisma: input.prisma,
    stripeCustomerId: input.stripeCustomerId,
    suspendedAtOverride: input.dispatchContext.eventCreatedAt,
  });
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
