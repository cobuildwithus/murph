import { HostedStripeEventStatus, type PrismaClient } from "@prisma/client";

import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
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

export type HostedStripeWebhookReconciliationResult = {
  activatedMemberId: string | null;
  eventId: string;
  eventType: string;
  hostedExecutionEventId: string | null;
};

export type HostedStripeWebhookRunnerNudgeResult = {
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

    throw buildHostedStripeWebhookReconcileError(input.eventId);
  }

  if (reconciled.status !== "completed") {
    throw buildHostedStripeWebhookReconcileError(input.eventId);
  }

  return {
    activatedMemberId: reconciled.activatedMemberId ?? null,
    eventId: reconciled.eventId,
    eventType: storedEvent.type,
    hostedExecutionEventId: reconciled.hostedExecutionEventId ?? null,
  };
}

export async function processRecordedHostedStripeWebhookEvent(input: {
  eventId: string;
  prisma?: PrismaClient;
  timeoutMs?: number;
}): Promise<HostedStripeWebhookRunnerNudgeResult> {
  const reconciliation = await reconcileRecordedHostedStripeWebhookEvent({
    eventId: input.eventId,
    prisma: input.prisma,
  });

  return nudgeHostedStripeWebhookActivationRunner({
    ...reconciliation,
    timeoutMs: input.timeoutMs,
  });
}

export async function nudgeHostedStripeWebhookActivationRunner(input: {
  activatedMemberId: string | null;
  eventId: string;
  eventType: string;
  hostedExecutionEventId: string | null;
  timeoutMs?: number;
}): Promise<HostedStripeWebhookRunnerNudgeResult> {
  const hostedExecutionEventId = input.hostedExecutionEventId ?? null;
  const hostedExecutionMemberId = input.activatedMemberId ?? null;

  if (!hostedExecutionEventId || !hostedExecutionMemberId) {
    return {
      accepted: true,
      required: false,
    };
  }

  const nudgeTiming = startHostedOnboardingTiming(
    "hosted-onboarding.stripe.runner-nudge",
    {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      eventType: input.eventType,
      hostedExecutionEventIdPresent: true,
      hostedExecutionEventIdSuffix: toHostedOnboardingLogIdSuffix(hostedExecutionEventId),
      hostedExecutionMemberIdPresent: true,
      hostedExecutionMemberIdSuffix: toHostedOnboardingLogIdSuffix(hostedExecutionMemberId),
    },
  );
  const result = await nudgeHostedRunnerUserBestEffortResult({
    context: "stripe.webhook:workflow",
    timeoutMs: input.timeoutMs,
    userId: hostedExecutionMemberId,
  });
  finishHostedOnboardingTiming(nudgeTiming, result.accepted ? "accepted" : "not-accepted", {
    accepted: result.accepted,
    alarmScheduled: result.alarmScheduled,
    alreadyRunning: result.alreadyRunning,
    configured: result.configured,
    errorCode: result.errorCode,
    inFlight: result.inFlight,
    nextAlarmAtPresent: result.nextAlarmAtPresent,
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
    }
    : {
      activatedMemberId: null,
      eventId: input.eventId,
      eventType: input.eventType,
      hostedExecutionEventId: null,
    };
}

async function readHostedStripeActivationMailboxItemForCompletedEvent(input: {
  eventId: string;
  eventType: string;
  prisma: PrismaClient;
}): Promise<{ dedupeKey: string; userId: string } | null> {
  for (const sourceEventId of await resolveHostedStripeActivationSourceEventIds(input.eventId)) {
    const activation = await input.prisma.hostedMailboxItem.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        dedupeKey: true,
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
