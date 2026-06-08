import { HostedStripeEventStatus, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import {
  reconcileHostedStripeEventById,
} from "./stripe-event-reconciliation";
import {
  normalizeHostedStripeDispatchSourceType,
} from "./stripe-dispatch";
import {
  requireHostedStripeApi,
} from "./runtime";
import {
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "./member-activation-runtime-wake";

export const HOSTED_STRIPE_WEBHOOK_WORKFLOW_RETRY_AFTER_DETAIL_KEY = "workflowRetryAfter";

const HOSTED_STRIPE_WEBHOOK_WORKFLOW_DEFAULT_RETRY_AFTER = "1m";
const HOSTED_STRIPE_WEBHOOK_WORKFLOW_MIN_RETRY_AFTER_SECONDS = 5;
const HOSTED_STRIPE_WEBHOOK_WORKFLOW_MAX_RETRY_AFTER_SECONDS = 60 * 60;

export type HostedStripeWebhookReconciliationResult = {
  activatedMemberId: string | null;
  eventId: string;
  eventType: string;
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId: string | null;
};

export type HostedStripeWebhookRuntimeWakeResult = {
  accepted: boolean;
  required: boolean;
};

export async function prepareDuplicateHostedStripeWebhookEventForWorkflowRetry(
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

  if (!requiresHostedStripeWebhookInlineRetryReset(storedEvent)) {
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

export async function reconcileRecordedHostedStripeWebhookEvent(input: {
  eventId: string;
  prisma?: PrismaClient;
}): Promise<HostedStripeWebhookReconciliationResult> {
  const prisma = input.prisma ?? getPrisma();
  const storedEvent = await readHostedStripeWebhookEventReceipt(input.eventId, prisma);

  if (!storedEvent) {
    throw buildHostedStripeWebhookReceiptMissingError(input.eventId);
  }

  let reconciled;

  try {
    reconciled = await reconcileHostedStripeEventById({
      eventId: input.eventId,
      prisma,
    });
  } catch (error) {
    throw buildHostedStripeWebhookReconcileError(input.eventId, error);
  }

  if (!reconciled) {
    const refreshedEvent = await readHostedStripeWebhookEventReceipt(input.eventId, prisma);

    if (!refreshedEvent) {
      throw buildHostedStripeWebhookReceiptMissingError(input.eventId);
    }

    if (refreshedEvent.status === HostedStripeEventStatus.completed) {
      return await resolveCompletedHostedStripeWebhookActivationResult({
        eventId: input.eventId,
        eventType: refreshedEvent.type,
        prisma,
      });
    }

    throw buildHostedStripeWebhookReconcileDeferredError({
      eventId: input.eventId,
      now: new Date(),
      storedEvent: refreshedEvent,
    });
  }

  if (reconciled.status !== "completed") {
    const refreshedEvent = await readHostedStripeWebhookEventReceipt(input.eventId, prisma);

    if (!refreshedEvent) {
      throw buildHostedStripeWebhookReceiptMissingError(input.eventId);
    }

    throw buildHostedStripeWebhookReconcileDeferredError({
      eventId: input.eventId,
      now: new Date(),
      storedEvent: refreshedEvent,
    });
  }

  return {
    activatedMemberId: reconciled.activatedMemberId ?? null,
    eventId: reconciled.eventId,
    eventType: storedEvent.type,
    hostedExecutionEventId: reconciled.hostedExecutionEventId ?? null,
    hostedExecutionMailboxItemId: null,
  };
}

export async function processRecordedHostedStripeWebhookEvent(input: {
  eventId: string;
  prisma?: PrismaClient;
  timeoutMs?: number;
}): Promise<HostedStripeWebhookRuntimeWakeResult> {
  const reconciliation = await reconcileRecordedHostedStripeWebhookEvent({
    eventId: input.eventId,
    prisma: input.prisma,
  });

  return signalHostedStripeWebhookActivationRuntimeWake({
    ...reconciliation,
    prisma: input.prisma,
    timeoutMs: input.timeoutMs,
  });
}

export async function signalHostedStripeWebhookActivationRuntimeWake(input: {
  activatedMemberId: string | null;
  eventId: string;
  eventType: string;
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId?: string | null;
  prisma?: PrismaClient;
  timeoutMs?: number;
}): Promise<HostedStripeWebhookRuntimeWakeResult> {
  const hostedExecutionEventId = input.hostedExecutionEventId ?? null;
  const hostedExecutionMemberId = input.activatedMemberId ?? null;

  if (!hostedExecutionEventId || !hostedExecutionMemberId) {
    return {
      accepted: true,
      required: false,
    };
  }

  const runtimeWakeTiming = startHostedOnboardingTiming(
    "hosted-onboarding.stripe.runtime-wake",
    {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      eventType: input.eventType,
      hostedExecutionEventIdPresent: true,
      hostedExecutionEventIdSuffix: toHostedOnboardingLogIdSuffix(hostedExecutionEventId),
      hostedExecutionMemberIdPresent: true,
      hostedExecutionMemberIdSuffix: toHostedOnboardingLogIdSuffix(hostedExecutionMemberId),
    },
  );
  const result = await signalHostedMemberActivationRuntimeWakeBestEffortResult({
    hostedExecutionEventId,
    mailboxItemId: input.hostedExecutionMailboxItemId ?? null,
    memberId: hostedExecutionMemberId,
    prisma: input.prisma,
    source: "stripe.webhook.activation",
    timeoutMs: input.timeoutMs,
  });
  finishHostedOnboardingTiming(runtimeWakeTiming, result.accepted ? "accepted" : "not-accepted", {
    accepted: result.accepted,
    configured: result.configured,
    errorCode: result.errorCode,
    mailboxItemIdPresent: result.mailboxItemIdPresent,
    signalAccepted: result.signalAccepted,
    workflowIdPresent: result.workflowIdPresent,
  });

  return {
    accepted: result.accepted,
    required: true,
  };
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
      type: true,
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
  return isHostedStripeWebhookReceiptFreshlyProcessing(storedEvent, now);
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
): boolean {
  switch (storedEvent.status) {
    case HostedStripeEventStatus.processing:
      return storedEvent.claimExpiresAt === null;
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
    ...(status === HostedStripeEventStatus.processing
      ? { status: HostedStripeEventStatus.failed }
      : {}),
  };
}

async function resolveCompletedHostedStripeWebhookActivationResult(input: {
  eventId: string;
  eventType: string;
  prisma: PrismaClient;
}): Promise<HostedStripeWebhookReconciliationResult> {
  const activation = await readHostedStripeActivationMailboxItemForCompletedEvent(input);

  return activation
    ? {
      activatedMemberId: activation.userId,
      eventId: input.eventId,
      eventType: input.eventType,
      hostedExecutionEventId: activation.dedupeKey,
      hostedExecutionMailboxItemId: activation.id,
    }
    : {
      activatedMemberId: null,
      eventId: input.eventId,
      eventType: input.eventType,
      hostedExecutionEventId: null,
      hostedExecutionMailboxItemId: null,
    };
}

async function readHostedStripeActivationMailboxItemForCompletedEvent(input: {
  eventId: string;
  eventType: string;
  prisma: PrismaClient;
}): Promise<{ dedupeKey: string; id: string; userId: string } | null> {
  for (const sourceEventId of await resolveHostedStripeActivationSourceEventIds(input.eventId)) {
    const activation = await input.prisma.hostedMailboxItem.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        dedupeKey: true,
        id: true,
        userId: true,
      },
      where: {
        dedupeKey: {
          endsWith: `:${sourceEventId}`,
          startsWith: `member.activated:${normalizeHostedStripeDispatchSourceType(input.eventType)}:`,
        },
        kind: "member.activated",
      },
    });

    if (activation) {
      return activation;
    }
  }

  return null;
}

async function resolveHostedStripeActivationSourceEventIds(eventId: string): Promise<string[]> {
  const stripeEvent = await requireHostedStripeApi().events.retrieve(eventId);
  const sourceEventIds = [eventId];

  if (stripeEvent.type === "invoice.paid") {
    const invoiceId = readHostedStripeEventPayloadObjectId(stripeEvent);

    if (invoiceId) {
      sourceEventIds.unshift(`invoice:${invoiceId}`);
    }
  }

  return sourceEventIds;
}

function readHostedStripeEventPayloadObjectId(event: {
  data?: {
    object?: unknown;
  };
}): string | null {
  const value = event.data?.object;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function buildHostedStripeWebhookReceiptMissingError(eventId: string) {
  return hostedOnboardingError({
    code: "STRIPE_WEBHOOK_RECEIPT_MISSING",
    details: {
      eventId,
    },
    httpStatus: 500,
    message: "Stripe webhook receipt is missing.",
    retryable: false,
  });
}

type HostedStripeWebhookEventReceipt = NonNullable<
  Awaited<ReturnType<typeof readHostedStripeWebhookEventReceipt>>
>;

function buildHostedStripeWebhookReconcileDeferredError(input: {
  eventId: string;
  now: Date;
  storedEvent: HostedStripeWebhookEventReceipt;
}) {
  if (input.storedEvent.status === HostedStripeEventStatus.poisoned) {
    return buildHostedStripeWebhookReconcilePoisonedError(input.eventId);
  }

  return buildHostedStripeWebhookReconcileError(input.eventId, undefined, {
    [HOSTED_STRIPE_WEBHOOK_WORKFLOW_RETRY_AFTER_DETAIL_KEY]:
      resolveHostedStripeWebhookWorkflowRetryAfter(input.storedEvent, input.now),
    stripeEventStatus: input.storedEvent.status,
  });
}

function buildHostedStripeWebhookReconcileError(
  eventId: string,
  cause?: unknown,
  details: Record<string, unknown> = {},
) {
  const error = hostedOnboardingError({
    code: "STRIPE_WEBHOOK_RECONCILE_FAILED",
    details: {
      eventId,
      ...details,
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

function buildHostedStripeWebhookReconcilePoisonedError(eventId: string) {
  return hostedOnboardingError({
    code: "STRIPE_WEBHOOK_RECONCILE_POISONED",
    details: {
      eventId,
    },
    httpStatus: 500,
    message: "Stripe webhook reconciliation is poisoned and cannot be retried automatically.",
    retryable: false,
  });
}

function resolveHostedStripeWebhookWorkflowRetryAfter(
  storedEvent: HostedStripeWebhookEventReceipt,
  now: Date,
): string {
  const nextAttemptAt = resolveHostedStripeWebhookNextWorkflowAttemptAt(storedEvent);

  if (!nextAttemptAt) {
    return HOSTED_STRIPE_WEBHOOK_WORKFLOW_DEFAULT_RETRY_AFTER;
  }

  const delayMs = nextAttemptAt.getTime() - now.getTime();

  if (!Number.isFinite(delayMs)) {
    return HOSTED_STRIPE_WEBHOOK_WORKFLOW_DEFAULT_RETRY_AFTER;
  }

  const retryAfterSeconds = Math.min(
    HOSTED_STRIPE_WEBHOOK_WORKFLOW_MAX_RETRY_AFTER_SECONDS,
    Math.max(
      HOSTED_STRIPE_WEBHOOK_WORKFLOW_MIN_RETRY_AFTER_SECONDS,
      Math.ceil(delayMs / 1000),
    ),
  );

  return `${retryAfterSeconds}s`;
}

function resolveHostedStripeWebhookNextWorkflowAttemptAt(
  storedEvent: HostedStripeWebhookEventReceipt,
): Date | null {
  switch (storedEvent.status) {
    case HostedStripeEventStatus.pending:
    case HostedStripeEventStatus.failed:
      return storedEvent.nextAttemptAt;
    case HostedStripeEventStatus.processing:
      return storedEvent.claimExpiresAt ?? storedEvent.nextAttemptAt;
    case HostedStripeEventStatus.completed:
    case HostedStripeEventStatus.poisoned:
      return null;
    default:
      return null;
  }
}
