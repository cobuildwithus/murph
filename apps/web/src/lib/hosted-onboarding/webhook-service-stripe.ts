import { HostedStripeEventStatus, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import {
  nudgeHostedRunBestEffort,
} from "../hosted-ingress/control";
import { hostedOnboardingError } from "./errors";
import {
  requireHostedStripeWebhookVerificationConfig,
} from "./runtime";
import {
  reconcileHostedStripeEventById,
  recordHostedStripeEvent,
} from "./stripe-event-reconciliation";
import type { HostedStripeWebhookResponse } from "./webhook-service-types";

export async function handleHostedStripeWebhook(input: {
  rawBody: string;
  signature: string | null;
  prisma?: PrismaClient;
}): Promise<HostedStripeWebhookResponse> {
  const prisma = input.prisma ?? getPrisma();
  const { stripe, webhookSecret } = requireHostedStripeWebhookVerificationConfig();

  if (!webhookSecret) {
    throw hostedOnboardingError({
      code: "STRIPE_WEBHOOK_SECRET_REQUIRED",
      message: "STRIPE_WEBHOOK_SECRET must be configured for Stripe webhooks.",
      httpStatus: 500,
    });
  }

  if (!input.signature) {
    throw hostedOnboardingError({
      code: "STRIPE_SIGNATURE_REQUIRED",
      message: "Missing Stripe webhook signature.",
      httpStatus: 401,
    });
  }

  const event = constructStripeWebhookEvent({
    rawBody: input.rawBody,
    signature: input.signature,
    stripe,
    webhookSecret,
  });

  const recorded = await recordHostedStripeEvent({
    event,
    prisma,
  });

  await reconcileHostedStripeWebhookEvent({
    duplicate: recorded.duplicate,
    eventId: event.id,
    prisma,
  });

  return {
    duplicate: recorded.duplicate || undefined,
    ok: true,
    type: recorded.type,
  };
}

async function reconcileHostedStripeWebhookEvent(input: {
  duplicate: boolean;
  eventId: string;
  prisma: PrismaClient;
}): Promise<void> {
  if (input.duplicate) {
    const shouldSkip = await prepareDuplicateHostedStripeWebhookEventForInlineRetry(
      input.eventId,
      input.prisma,
    );

    if (shouldSkip) {
      return;
    }
  }

  let reconciled;

  try {
    reconciled = await reconcileHostedStripeEventById({
      eventId: input.eventId,
      prisma: input.prisma,
    });
  } catch (error) {
    throw buildHostedStripeWebhookReconcileError(input.eventId, error);
  }

  if (!reconciled) {
    if (await shouldAcknowledgeHostedStripeWebhookDuplicate(input.eventId, input.prisma)) {
      return;
    }

    throw buildHostedStripeWebhookReconcileError(input.eventId);
  }

  if (reconciled.status !== "completed") {
    throw buildHostedStripeWebhookReconcileError(input.eventId);
  }

  const hostedExecutionEventId = reconciled.hostedExecutionEventId ?? null;
  const hostedExecutionMemberId = reconciled.activatedMemberId ?? null;

  if (!hostedExecutionEventId || !hostedExecutionMemberId) {
    return;
  }

  await nudgeHostedRunBestEffort({
    context: "stripe.webhook",
    userId: hostedExecutionMemberId,
  });
}

async function prepareDuplicateHostedStripeWebhookEventForInlineRetry(
  eventId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  const now = new Date();
  const storedEvent = await readHostedStripeWebhookEventReceipt(eventId, prisma);

  if (!storedEvent) {
    return false;
  }

  if (shouldAcknowledgeHostedStripeWebhookDuplicateReceipt(storedEvent, now)) {
    return true;
  }

  if (!requiresHostedStripeWebhookInlineRetryReset(storedEvent, now)) {
    return false;
  }

  const reset = await prisma.hostedStripeEvent.updateMany({
    data: buildHostedStripeWebhookInlineRetryReset(storedEvent.status, now),
    where: {
      eventId,
      updatedAt: storedEvent.updatedAt,
    },
  });

  if (reset.count === 1) {
    return false;
  }

  const refreshedEvent = await readHostedStripeWebhookEventReceipt(eventId, prisma);

  return Boolean(
    refreshedEvent
    && shouldAcknowledgeHostedStripeWebhookDuplicateReceipt(refreshedEvent, new Date()),
  );
}

async function shouldAcknowledgeHostedStripeWebhookDuplicate(
  eventId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  const storedEvent = await readHostedStripeWebhookEventReceipt(eventId, prisma);

  return Boolean(
    storedEvent
    && shouldAcknowledgeHostedStripeWebhookDuplicateReceipt(storedEvent, new Date()),
  );
}

async function readHostedStripeWebhookEventReceipt(
  eventId: string,
  prisma: PrismaClient,
) {
  return prisma.hostedStripeEvent.findUnique({
    select: {
      claimExpiresAt: true,
      nextAttemptAt: true,
      status: true,
      updatedAt: true,
    },
    where: {
      eventId,
    },
  });
}

function shouldAcknowledgeHostedStripeWebhookDuplicateReceipt(
  storedEvent: NonNullable<
    Awaited<ReturnType<typeof readHostedStripeWebhookEventReceipt>>
  >,
  now: Date,
): boolean {
  return storedEvent.status === HostedStripeEventStatus.completed
    || isHostedStripeWebhookReceiptFreshlyProcessing(storedEvent, now);
}

function isHostedStripeWebhookReceiptFreshlyProcessing(
  storedEvent: NonNullable<
    Awaited<ReturnType<typeof readHostedStripeWebhookEventReceipt>>
  >,
  now: Date,
): boolean {
  return storedEvent.status === HostedStripeEventStatus.processing
    && storedEvent.claimExpiresAt instanceof Date
    && storedEvent.claimExpiresAt.getTime() > now.getTime();
}

function requiresHostedStripeWebhookInlineRetryReset(
  storedEvent: NonNullable<
    Awaited<ReturnType<typeof readHostedStripeWebhookEventReceipt>>
  >,
  now: Date,
): boolean {
  switch (storedEvent.status) {
    case HostedStripeEventStatus.pending:
    case HostedStripeEventStatus.failed:
      return storedEvent.nextAttemptAt.getTime() > now.getTime();
    case HostedStripeEventStatus.processing:
      return storedEvent.claimExpiresAt === null;
    case HostedStripeEventStatus.poisoned:
      return true;
    default:
      return false;
  }
}

function buildHostedStripeWebhookInlineRetryReset(
  status: HostedStripeEventStatus,
  now: Date,
) {
  return {
    claimExpiresAt: null,
    nextAttemptAt: now,
    ...(status === HostedStripeEventStatus.poisoned
      || status === HostedStripeEventStatus.processing
      ? { status: HostedStripeEventStatus.failed }
      : {}),
  };
}

function buildHostedStripeWebhookReconcileError(
  eventId: string,
  cause?: unknown,
) {
  const error = hostedOnboardingError({
    code: "STRIPE_WEBHOOK_RECONCILE_FAILED",
    details: {
      eventId,
    },
    httpStatus: 500,
    message: "Stripe webhook reconciliation did not complete. Retry later.",
    retryable: true,
  });

  if (cause !== undefined) {
    error.cause = cause;
  }

  return error;
}

function constructStripeWebhookEvent(input: {
  rawBody: string;
  signature: string;
  stripe: ReturnType<typeof requireHostedStripeWebhookVerificationConfig>["stripe"];
  webhookSecret: string;
}): Stripe.Event {
  try {
    return input.stripe.webhooks.constructEvent(input.rawBody, input.signature, input.webhookSecret);
  } catch (error) {
    throw hostedOnboardingError({
      code: "STRIPE_SIGNATURE_INVALID",
      message: error instanceof Error ? error.message : "Invalid Stripe webhook signature.",
      httpStatus: 401,
    });
  }
}
