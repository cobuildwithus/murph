import {
  HostedRevnetIssuanceStatus,
  HostedStripeEventStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  activateHostedMemberFromConfirmedRevnetIssuance,
  applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired,
  applyStripeDisputeUpdated,
  applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated,
  applyStripeSubscriptionUpdated,
  requireHostedStripeEventPayload,
  resolveStripeCustomerContext,
  type HostedStripeDispatchContext,
} from "./stripe-billing-policy";
import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
} from "./billing";
import { readHostedRevnetPaymentReceipt } from "./revnet";
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

export async function recordHostedStripeEvent(input: {
  event: Stripe.Event;
  prisma: PrismaClient;
}): Promise<{ duplicate: boolean; type: string }> {
  const normalized = normalizeHostedStripeEventFact(input.event);

  try {
    await input.prisma.hostedStripeEvent.create({
      data: {
        attemptCount: 0,
        chargeId: normalized.chargeId,
        checkoutSessionId: normalized.checkoutSessionId,
        customerId: normalized.customerId,
        eventId: input.event.id,
        invoiceId: normalized.invoiceId,
        nextAttemptAt: new Date(),
        paymentIntentId: normalized.paymentIntentId,
        payloadJson: normalized.payloadJson,
        receivedAt: new Date(),
        status: HostedStripeEventStatus.pending,
        stripeCreatedAt: normalized.stripeCreatedAt,
        subscriptionId: normalized.subscriptionId,
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

export async function drainHostedStripeEventQueue(input: {
  limit?: number;
  prisma: PrismaClient;
}): Promise<string[]> {
  const drainedEventIds: string[] = [];
  let shouldDrainRevnetIssuances = false;
  const candidates = await input.prisma.hostedStripeEvent.findMany({
    where: {
      OR: [
        {
          nextAttemptAt: {
            lte: new Date(),
          },
          status: HostedStripeEventStatus.pending,
        },
        {
          nextAttemptAt: {
            lte: new Date(),
          },
          status: HostedStripeEventStatus.failed,
        },
        {
          status: HostedStripeEventStatus.processing,
          claimExpiresAt: {
            lte: new Date(),
          },
        },
      ],
    },
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
      prisma: input.prisma,
      updatedAt: candidate.updatedAt,
    });

    if (!claimed) {
      continue;
    }

    try {
      const processingContext = await prepareHostedStripeEventProcessingContext(claimed);
      await input.prisma.$transaction(async (transaction) => {
        const result = await processHostedStripeEventRecord(
          claimed,
          processingContext,
          transaction as Prisma.TransactionClient,
        );
        await transaction.hostedStripeEvent.update({
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

        shouldDrainRevnetIssuances ||= result.createdOrUpdatedRevnetIssuance;
      });
      drainedEventIds.push(claimed.eventId);
    } catch (error) {
      await input.prisma.hostedStripeEvent.update({
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
    }
  }

  if (shouldDrainRevnetIssuances) {
    await drainHostedRevnetIssuanceSubmissionQueue({
      limit: input.limit,
      prisma: input.prisma,
    });
  }

  return drainedEventIds;
}

export async function reconcileSubmittedHostedRevnetIssuances(input: {
  limit?: number;
  prisma: PrismaClient;
}): Promise<string[]> {
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

      const member = await transaction.hostedMember.findUnique({
        where: {
          id: issuance.memberId,
        },
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

function normalizeHostedStripeEventFact(event: Stripe.Event): {
  chargeId: string | null;
  checkoutSessionId: string | null;
  customerId: string | null;
  invoiceId: string | null;
  paymentIntentId: string | null;
  payloadJson: Prisma.InputJsonValue;
  stripeCreatedAt: Date;
  subscriptionId: string | null;
} {
  const object = event.data.object as unknown as Record<string, unknown>;
  const type = event.type;
  const stripeCreatedAt = Number.isFinite(event.created)
    ? new Date(event.created * 1000)
    : new Date();

  return {
    chargeId: readHostedStripeEventChargeId(type, object),
    checkoutSessionId: type.startsWith("checkout.session.") ? coerceStripeObjectId(object.id as never) : null,
    customerId: readHostedStripeEventCustomerId(type, object),
    invoiceId: type.startsWith("invoice.") ? coerceStripeObjectId(object.id as never) : null,
    paymentIntentId: readHostedStripeEventPaymentIntentId(type, object),
    payloadJson: {
      object: object as unknown as Prisma.InputJsonValue,
      type,
    } satisfies Prisma.InputJsonValue,
    stripeCreatedAt,
    subscriptionId: readHostedStripeEventSubscriptionId(type, object),
  };
}

async function claimHostedStripeEvent(input: {
  eventId: string;
  prisma: PrismaClient;
  updatedAt: Date;
}) {
  const result = await input.prisma.hostedStripeEvent.updateMany({
    where: {
      eventId: input.eventId,
      updatedAt: input.updatedAt,
    },
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
  event: NonNullable<Awaited<ReturnType<typeof claimHostedStripeEvent>>>,
  processingContext: HostedStripeEventProcessingContext,
  prisma: Prisma.TransactionClient,
): Promise<{ createdOrUpdatedRevnetIssuance: boolean }> {
  const payload = requireHostedStripeEventPayload(event.payloadJson);
  const dispatchContext: HostedStripeDispatchContext = {
    eventCreatedAt: event.stripeCreatedAt,
    occurredAt: event.stripeCreatedAt.toISOString(),
    sourceEventId: event.eventId,
    sourceType: normalizeHostedStripeDispatchSourceType(event.type),
  };

  switch (event.type) {
    case "checkout.session.completed":
      await applyStripeCheckoutCompleted(payload.object as unknown as Stripe.Checkout.Session, dispatchContext, prisma);
      return { createdOrUpdatedRevnetIssuance: false };
    case "checkout.session.expired":
      await applyStripeCheckoutExpired(payload.object as unknown as Stripe.Checkout.Session, dispatchContext, prisma);
      return { createdOrUpdatedRevnetIssuance: false };
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applyStripeSubscriptionUpdated(payload.object as unknown as Stripe.Subscription, dispatchContext, prisma);
      return { createdOrUpdatedRevnetIssuance: false };
    case "invoice.paid":
      return {
        createdOrUpdatedRevnetIssuance: await applyStripeInvoicePaid(
          payload.object as unknown as Stripe.Invoice,
          dispatchContext,
          prisma,
        ),
      };
    case "invoice.payment_failed":
      await applyStripeInvoicePaymentFailed(payload.object as unknown as Stripe.Invoice, dispatchContext, prisma);
      return { createdOrUpdatedRevnetIssuance: false };
    case "refund.created":
      await applyStripeRefundCreated(
        payload.object as unknown as Stripe.Refund,
        dispatchContext,
        prisma,
        processingContext.customerId,
      );
      return { createdOrUpdatedRevnetIssuance: false };
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_reinstated":
    case "charge.dispute.funds_withdrawn":
      await applyStripeDisputeUpdated(
        payload.object as unknown as Stripe.Dispute,
        dispatchContext,
        prisma,
        processingContext.customerId,
      );
      return { createdOrUpdatedRevnetIssuance: false };
    default:
      return { createdOrUpdatedRevnetIssuance: false };
  }
}

type HostedStripeEventProcessingContext = {
  customerId: string | null;
};

async function prepareHostedStripeEventProcessingContext(
  event: NonNullable<Awaited<ReturnType<typeof claimHostedStripeEvent>>>,
): Promise<HostedStripeEventProcessingContext> {
  if (event.type !== "refund.created" && !event.type.startsWith("charge.dispute.")) {
    return {
      customerId: null,
    };
  }

  const customerContext = await resolveStripeCustomerContext({
    chargeId: event.chargeId,
    paymentIntentId: event.paymentIntentId,
  });

  return {
    customerId: customerContext.customerId,
  };
}

function normalizeHostedStripeDispatchSourceType(eventType: string): string {
  return `stripe.${eventType}`;
}

function readHostedStripeEventCustomerId(type: string, object: Record<string, unknown>): string | null {
  if (type.startsWith("checkout.session.")) {
    return coerceStripeObjectId(object.customer as never);
  }

  if (type.startsWith("customer.subscription.")) {
    return coerceStripeObjectId(object.customer as never);
  }

  if (type.startsWith("invoice.")) {
    return coerceStripeObjectId(object.customer as never);
  }

  if (type === "refund.created") {
    return null;
  }

  if (type.startsWith("charge.dispute.")) {
    return null;
  }

  return null;
}

function readHostedStripeEventSubscriptionId(type: string, object: Record<string, unknown>): string | null {
  if (type.startsWith("checkout.session.")) {
    return coerceStripeSubscriptionId(object.subscription as never);
  }

  if (type.startsWith("customer.subscription.")) {
    return coerceStripeSubscriptionId(object.id as never);
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    return coerceStripeInvoiceSubscriptionId(object as never);
  }

  return null;
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
