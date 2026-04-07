import {
  HostedRevnetIssuanceStatus,
  HostedStripeEventStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { provisionManagedUserCryptoInHostedExecution } from "../hosted-execution/control";
import {
  applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired,
  applyStripeDisputeUpdated,
  applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated,
  applyStripeSubscriptionUpdated,
} from "./stripe-billing-events";
import {
  activateHostedMemberFromConfirmedRevnetIssuance,
  resolveStripeCustomerContext,
  type HostedStripeDispatchContext,
} from "./stripe-billing-policy";
import {
  coerceStripeObjectId,
} from "./billing";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import {
  isHostedOnboardingRevnetEnabled,
  readHostedRevnetPaymentReceipt,
} from "./revnet";
import { requireHostedStripeApi } from "./runtime";
import { drainHostedRevnetIssuanceSubmissionQueue } from "./stripe-revnet-issuance";

const STRIPE_EVENT_LEASE_MS = 10 * 60_000;
const STRIPE_EVENT_MAX_ATTEMPTS = 6;
const STRIPE_EVENT_RETRY_DELAYS_MS = [
  15 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
] as const;

export type HostedStripeEventReconcileResult = {
  activatedMemberId: string | null;
  createdOrUpdatedRevnetIssuance: boolean;
  eventId: string;
  hostedExecutionEventId: string | null;
  status: "completed" | "failed";
};

export async function recordHostedStripeEvent(input: {
  event: Stripe.Event;
  prisma: PrismaClient;
}): Promise<{ duplicate: boolean; type: string }> {
  const stripeCreatedAt = Number.isFinite(input.event.created)
    ? new Date(input.event.created * 1000)
    : new Date();

  try {
    await input.prisma.hostedStripeEvent.create({
      data: {
        attemptCount: 0,
        eventId: input.event.id,
        nextAttemptAt: new Date(),
        receivedAt: new Date(),
        status: HostedStripeEventStatus.pending,
        stripeCreatedAt,
        type: input.event.type,
      },
    });

    return {
      duplicate: false,
      type: input.event.type,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        duplicate: true,
        type: input.event.type,
      };
    }

    throw error;
  }
}

export async function reconcileDueHostedStripeEvents(input: {
  limit?: number;
  prisma: PrismaClient;
}): Promise<string[]> {
  const reconciledEventIds: string[] = [];
  let shouldDrainRevnetIssuances = false;
  const now = new Date();
  const candidates = await input.prisma.hostedStripeEvent.findMany({
    where: buildDueHostedStripeEventWhere(now),
    orderBy: [
      {
        stripeCreatedAt: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    take: input.limit ?? 25,
  });

  for (const candidate of candidates) {
    const claimed = await claimHostedStripeEvent({
      eventId: candidate.eventId,
      now,
      prisma: input.prisma,
      updatedAt: candidate.updatedAt,
    });

    if (!claimed) {
      continue;
    }

    const result = await processClaimedHostedStripeEvent(claimed, input.prisma);
    shouldDrainRevnetIssuances ||= result.createdOrUpdatedRevnetIssuance;
    if (result.status === "completed") {
      reconciledEventIds.push(result.eventId);
    }
  }

  if (shouldDrainRevnetIssuances) {
    await drainHostedRevnetIssuanceSubmissionQueue({
      limit: input.limit,
      prisma: input.prisma,
    });
  }

  return reconciledEventIds;
}

export async function reconcileHostedStripeEventById(input: {
  eventId: string;
  prisma: PrismaClient;
}): Promise<HostedStripeEventReconcileResult | null> {
  const now = new Date();
  const candidate = await input.prisma.hostedStripeEvent.findUnique({
    where: {
      eventId: input.eventId,
    },
  });

  if (!candidate) {
    return null;
  }

  const claimed = await claimHostedStripeEvent({
    eventId: candidate.eventId,
    now,
    prisma: input.prisma,
    updatedAt: candidate.updatedAt,
  });

  if (!claimed) {
    return null;
  }

  return processClaimedHostedStripeEvent(claimed, input.prisma);
}

export async function reconcileSubmittedHostedRevnetIssuances(input: {
  limit?: number;
  prisma: PrismaClient;
}): Promise<string[]> {
  if (!isHostedOnboardingRevnetEnabled()) {
    return [];
  }

  const confirmedIssuanceIds: string[] = [];
  const issuances = await input.prisma.hostedRevnetIssuance.findMany({
    where: {
      payTxHash: {
        not: null,
      },
      status: HostedRevnetIssuanceStatus.submitted,
    },
    orderBy: [
      {
        createdAt: "asc",
      },
    ],
    take: input.limit ?? 25,
  });

  for (const issuance of issuances) {
    const receipt = await readHostedRevnetPaymentReceipt({
      chainId: issuance.chainId,
      payTxHash: issuance.payTxHash as `0x${string}`,
    });

    if (!receipt) {
      continue;
    }

    if (receipt.status === "reverted") {
      await input.prisma.hostedRevnetIssuance.update({
        where: {
          id: issuance.id,
        },
        data: {
          failureCode: "REVNET_PAYMENT_REVERTED",
          failureMessage: "The submitted Hosted RevNet payment reverted onchain.",
          status: HostedRevnetIssuanceStatus.failed,
        },
      });
      continue;
    }

    await input.prisma.$transaction(async (transaction) => {
      await transaction.hostedRevnetIssuance.update({
        where: {
          id: issuance.id,
        },
        data: {
          confirmedAt: new Date(),
          failureCode: null,
          failureMessage: null,
          status: HostedRevnetIssuanceStatus.confirmed,
        },
      });

      const member = await readHostedMemberSnapshot({
        memberId: issuance.memberId,
        prisma: transaction,
      });

      if (!member) {
        return;
      }

      await activateHostedMemberFromConfirmedRevnetIssuance({
        member,
        occurredAt: new Date().toISOString(),
        prisma: transaction as Prisma.TransactionClient,
        sourceEventId: issuance.id,
        sourceType: "hosted.revnet.issuance.confirmed",
      });
    });

    confirmedIssuanceIds.push(issuance.id);
  }

  return confirmedIssuanceIds;
}

async function claimHostedStripeEvent(input: {
  eventId: string;
  now: Date;
  prisma: PrismaClient;
  updatedAt: Date;
}) {
  const result = await input.prisma.hostedStripeEvent.updateMany({
    where: buildClaimableHostedStripeEventWhere(input),
    data: {
      attemptCount: {
        increment: 1,
      },
      claimExpiresAt: new Date(Date.now() + STRIPE_EVENT_LEASE_MS),
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: new Date(),
      status: HostedStripeEventStatus.processing,
    },
  });

  if (result.count !== 1) {
    return null;
  }

  return input.prisma.hostedStripeEvent.findUnique({
    where: {
      eventId: input.eventId,
    },
  });
}

async function processHostedStripeEventRecord(
  event: Stripe.Event,
  processingContext: HostedStripeEventProcessingContext,
  prisma: Prisma.TransactionClient,
): Promise<{
  activatedMemberId: string | null;
  createdOrUpdatedRevnetIssuance: boolean;
  hostedExecutionEventId: string | null;
  postCommitProvisionUserId: string | null;
}> {
  const payload = event.data.object;
  const dispatchContext: HostedStripeDispatchContext = {
    eventCreatedAt: Number.isFinite(event.created) ? new Date(event.created * 1000) : new Date(),
    occurredAt: Number.isFinite(event.created)
      ? new Date(event.created * 1000).toISOString()
      : new Date().toISOString(),
    sourceEventId: event.id,
    sourceType: normalizeHostedStripeDispatchSourceType(event.type),
  };

  switch (event.type) {
    case "checkout.session.completed":
      return mapHostedStripeActivationOutcome(
        await applyStripeCheckoutCompleted(
          payload as Stripe.Checkout.Session,
          dispatchContext,
          prisma,
        ),
      );
    case "checkout.session.expired":
      await applyStripeCheckoutExpired(payload as Stripe.Checkout.Session, dispatchContext, prisma);
      return buildEmptyHostedStripeEventProcessingResult();
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applyStripeSubscriptionUpdated(payload as Stripe.Subscription, dispatchContext, prisma);
      return buildEmptyHostedStripeEventProcessingResult();
    case "invoice.paid":
      return mapHostedStripeActivationOutcome(
        await applyStripeInvoicePaid(
          payload as Stripe.Invoice,
          dispatchContext,
          prisma,
        ),
      );
    case "invoice.payment_failed":
      await applyStripeInvoicePaymentFailed(payload as Stripe.Invoice, dispatchContext, prisma);
      return buildEmptyHostedStripeEventProcessingResult();
    case "refund.created":
      await applyStripeRefundCreated(
        payload as Stripe.Refund,
        dispatchContext,
        prisma,
        processingContext.customerId,
      );
      return buildEmptyHostedStripeEventProcessingResult();
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_reinstated":
    case "charge.dispute.funds_withdrawn":
      await applyStripeDisputeUpdated(
        payload as Stripe.Dispute,
        dispatchContext,
        prisma,
        processingContext.customerId,
      );
      return buildEmptyHostedStripeEventProcessingResult();
    default:
      return buildEmptyHostedStripeEventProcessingResult();
  }
}

type HostedStripeEventProcessingContext = {
  customerId: string | null;
};

async function prepareHostedStripeEventProcessingContext(
  event: Stripe.Event,
): Promise<HostedStripeEventProcessingContext> {
  if (event.type !== "refund.created" && !event.type.startsWith("charge.dispute.")) {
    return {
      customerId: null,
    };
  }

  const object = event.data.object as unknown as Record<string, unknown>;
  const customerContext = await resolveStripeCustomerContext({
    chargeId: readHostedStripeEventChargeId(event.type, object),
    paymentIntentId: readHostedStripeEventPaymentIntentId(event.type, object),
  });

  return {
    customerId: customerContext.customerId,
  };
}

function normalizeHostedStripeDispatchSourceType(eventType: string): string {
  return `stripe.${eventType}`;
}

function readHostedStripeEventChargeId(type: string, object: Record<string, unknown>): string | null {
  if (type === "refund.created") {
    return coerceStripeObjectId(object.charge as never);
  }

  if (type.startsWith("charge.dispute.")) {
    return coerceStripeObjectId(object.charge as never);
  }

  if (type === "invoice.paid") {
    return coerceStripeObjectId(object.charge as never);
  }

  return null;
}

function readHostedStripeEventPaymentIntentId(type: string, object: Record<string, unknown>): string | null {
  if (type === "refund.created") {
    return coerceStripeObjectId(object.payment_intent as never);
  }

  if (type.startsWith("charge.dispute.")) {
    return coerceStripeObjectId(object.payment_intent as never);
  }

  if (type === "invoice.paid") {
    return coerceStripeObjectId(object.payment_intent as never);
  }

  return null;
}

function deriveHostedStripeEventErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  if (error instanceof Error && error.name) {
    return error.name;
  }

  return "HOSTED_STRIPE_EVENT_FAILED";
}

function computeHostedStripeEventNextAttemptAt(attemptCount: number, now = new Date()): Date {
  const delayMs =
    STRIPE_EVENT_RETRY_DELAYS_MS[
      Math.min(Math.max(attemptCount - 1, 0), STRIPE_EVENT_RETRY_DELAYS_MS.length - 1)
    ];
  return new Date(now.getTime() + delayMs);
}

async function processClaimedHostedStripeEvent(
  claimed: NonNullable<Awaited<ReturnType<typeof claimHostedStripeEvent>>>,
  prisma: PrismaClient,
): Promise<HostedStripeEventReconcileResult> {
  try {
    const stripeEvent = await fetchHostedStripeEventForReconciliation(claimed.eventId);
    const processingContext = await prepareHostedStripeEventProcessingContext(stripeEvent);
    let result!: Awaited<ReturnType<typeof processHostedStripeEventRecord>>;
    await prisma.$transaction(async (transaction) => {
      result = await processHostedStripeEventRecord(
        stripeEvent,
        processingContext,
        transaction as Prisma.TransactionClient,
      );
    });
    await runHostedStripeEventPostCommitEffects(result);
    await prisma.hostedStripeEvent.update({
      where: {
        eventId: claimed.eventId,
      },
      data: {
        claimExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        processedAt: new Date(),
        status: HostedStripeEventStatus.completed,
      },
    });

    return {
      activatedMemberId: result.activatedMemberId,
      createdOrUpdatedRevnetIssuance: result.createdOrUpdatedRevnetIssuance,
      eventId: claimed.eventId,
      hostedExecutionEventId: result.hostedExecutionEventId,
      status: "completed",
    };
  } catch (error) {
    await prisma.hostedStripeEvent.update({
      where: {
        eventId: claimed.eventId,
      },
      data: {
        claimExpiresAt: null,
        lastErrorCode: deriveHostedStripeEventErrorCode(error),
        lastErrorMessage: error instanceof Error ? error.message : String(error),
        nextAttemptAt: computeHostedStripeEventNextAttemptAt(claimed.attemptCount),
        status:
          claimed.attemptCount >= STRIPE_EVENT_MAX_ATTEMPTS
            ? HostedStripeEventStatus.poisoned
            : HostedStripeEventStatus.failed,
      },
    });

    return {
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: false,
      eventId: claimed.eventId,
      hostedExecutionEventId: null,
      status: "failed",
    };
  }
}

async function fetchHostedStripeEventForReconciliation(eventId: string): Promise<Stripe.Event> {
  return requireHostedStripeApi().events.retrieve(eventId);
}

async function runHostedStripeEventPostCommitEffects(input: {
  postCommitProvisionUserId: string | null;
}): Promise<void> {
  if (!input.postCommitProvisionUserId) {
    return;
  }

  await provisionManagedUserCryptoInHostedExecution(input.postCommitProvisionUserId);
}

function buildDueHostedStripeEventWhere(now: Date): Prisma.HostedStripeEventWhereInput {
  return {
    OR: [
      {
        nextAttemptAt: {
          lte: now,
        },
        status: HostedStripeEventStatus.pending,
      },
      {
        nextAttemptAt: {
          lte: now,
        },
        status: HostedStripeEventStatus.failed,
      },
      {
        status: HostedStripeEventStatus.processing,
        claimExpiresAt: {
          lte: now,
        },
      },
    ],
  };
}

function mapHostedStripeActivationOutcome(
  outcome: {
    activatedMemberId: string | null;
    createdOrUpdatedRevnetIssuance?: boolean;
    hostedExecutionEventId: string | null;
    postCommitProvisionUserId?: string | null;
  },
): {
  activatedMemberId: string | null;
  createdOrUpdatedRevnetIssuance: boolean;
  hostedExecutionEventId: string | null;
  postCommitProvisionUserId: string | null;
} {
  return {
    activatedMemberId: outcome.activatedMemberId,
    createdOrUpdatedRevnetIssuance: outcome.createdOrUpdatedRevnetIssuance ?? false,
    hostedExecutionEventId: outcome.hostedExecutionEventId,
    postCommitProvisionUserId: outcome.postCommitProvisionUserId ?? null,
  };
}

function buildEmptyHostedStripeEventProcessingResult(): {
  activatedMemberId: string | null;
  createdOrUpdatedRevnetIssuance: boolean;
  hostedExecutionEventId: string | null;
  postCommitProvisionUserId: string | null;
} {
  return {
    activatedMemberId: null,
    createdOrUpdatedRevnetIssuance: false,
    hostedExecutionEventId: null,
    postCommitProvisionUserId: null,
  };
}

function buildClaimableHostedStripeEventWhere(input: {
  eventId: string;
  now: Date;
  updatedAt: Date;
}): Prisma.HostedStripeEventWhereInput {
  return {
    eventId: input.eventId,
    updatedAt: input.updatedAt,
    ...buildDueHostedStripeEventWhere(input.now),
  };
}
