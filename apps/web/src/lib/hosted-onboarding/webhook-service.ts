import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  requireHostedLinqMessageReceivedEvent,
  verifyAndParseHostedLinqWebhookRequest,
} from "./linq";
import {
  requireHostedStripeWebhookVerificationConfig,
} from "./runtime";
import { drainHostedExecutionOutboxBestEffort } from "../hosted-execution/outbox";
import {
  reconcileHostedStripeEventById,
  recordHostedStripeEvent,
} from "./stripe-event-reconciliation";
import { drainHostedRevnetIssuanceSubmissionQueue } from "./stripe-revnet-issuance";
import { assertHostedTelegramWebhookSecret, buildHostedTelegramWebhookEventId, parseHostedTelegramWebhookUpdate } from "./telegram";
import {
  claimHostedWebhookReceiptForContinuation,
  continueHostedWebhookReceipt,
  listHostedWebhookReceiptContinuationCandidates,
  runHostedWebhookWithReceipt,
} from "./webhook-receipts";
import {
  planHostedOnboardingLinqWebhook,
  type HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq";
import {
  planHostedOnboardingTelegramWebhook,
  type HostedOnboardingTelegramWebhookResponse,
} from "./webhook-provider-telegram";
import { sanitizeHostedOnboardingLogString } from "./http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import { createHostedWebhookReceiptHandlers } from "./webhook-transport";

export type HostedStripeWebhookResponse = {
  duplicate?: boolean;
  ok: true;
  type: string;
};

export async function handleHostedOnboardingLinqWebhook(input: {
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
  maxInlineDrainMs?: number;
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingLinqWebhookResponse> {
  const timing = startHostedOnboardingTiming("hosted-onboarding.webhook.linq", {
    rawBodyBytes: new TextEncoder().encode(input.rawBody).byteLength,
    signalAbortedAtStart: input.signal?.aborted ?? false,
    signaturePresent: Boolean(input.signature),
    timestampPresent: Boolean(input.timestamp),
  });
  let eventId: string | null = null;
  let eventType: string | null = null;
  let responseReason: string | null = null;

  try {
    const verifyTiming = startHostedOnboardingTiming(
      "hosted-onboarding.webhook.linq.verify-request",
      {
        signaturePresent: Boolean(input.signature),
        timestampPresent: Boolean(input.timestamp),
      },
    );
    const event = verifyAndParseHostedLinqWebhookRequest({
      rawBody: input.rawBody,
      signature: input.signature,
      timestamp: input.timestamp,
    });
    eventId = event.event_id;
    eventType = event.event_type;
    finishHostedOnboardingTiming(verifyTiming, "completed", {
      eventId,
      eventType,
      signalAbortedAfterVerify: input.signal?.aborted ?? false,
    });
    const prisma = input.prisma ?? getPrisma();
    if (event.event_type === "message.received") {
      requireHostedLinqMessageReceivedEvent(event);
    }
    const receiptTiming = startHostedOnboardingTiming(
      "hosted-onboarding.webhook.linq.receipt",
      {
        eventId,
        eventType,
      },
    );
    const response = await runHostedWebhookWithReceipt({
      deferSideEffectDrain: input.defer,
      duplicateResponse: {
        ok: true,
        duplicate: true,
      },
      eventId: event.event_id,
      handlers: createHostedWebhookReceiptHandlers(),
      plan: (transaction) =>
        planHostedOnboardingLinqWebhook({
          event,
          prisma: transaction,
        }),
      prisma,
      signal: input.signal,
      source: "linq",
    });
    responseReason = response.reason ?? null;
    finishHostedOnboardingTiming(receiptTiming, "completed", {
      duplicate: Boolean(response.duplicate),
      eventId,
      eventType,
      responseReason,
    });
    await maybeDrainHostedExecutionWebhookDispatch({
      defer: input.defer,
      eventId: event.event_id,
      maxInlineDrainMs: input.maxInlineDrainMs,
      prisma,
      response,
      source: "linq",
    });
    finishHostedOnboardingTiming(timing, "completed", {
      duplicate: Boolean(response.duplicate),
      eventId,
      eventType,
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
    });
    return response;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      eventId,
      eventType,
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
    });
    throw error;
  }
}

export async function handleHostedOnboardingTelegramWebhook(input: {
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
  maxInlineDrainMs?: number;
  rawBody: string;
  secretToken: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingTelegramWebhookResponse> {
  const prisma = input.prisma ?? getPrisma();

  assertHostedTelegramWebhookSecret(input.secretToken);

  const update = parseHostedTelegramWebhookUpdate(input.rawBody);
  const response = await runHostedWebhookWithReceipt({
    duplicateResponse: {
      ok: true,
      duplicate: true,
    },
    eventId: buildHostedTelegramWebhookEventId(update),
    handlers: createHostedWebhookReceiptHandlers(),
    plan: (transaction) =>
      planHostedOnboardingTelegramWebhook({
        prisma: transaction,
        update,
      }),
    prisma,
    signal: input.signal,
    source: "telegram",
  });
  await maybeDrainHostedExecutionWebhookDispatch({
    defer: input.defer,
    eventId: buildHostedTelegramWebhookEventId(update),
    maxInlineDrainMs: input.maxInlineDrainMs,
    prisma,
    response,
    source: "telegram",
  });
  return response;
}

export async function handleHostedStripeWebhook(input: {
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
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

  if (!recorded.duplicate) {
    const reconciled = await reconcileHostedStripeEventById({
      eventId: event.id,
      prisma,
    });

    if (reconciled?.createdOrUpdatedRevnetIssuance) {
      if (input.defer) {
        await input.defer(() => drainHostedRevnetIssuanceSubmissionQueueBestEffort(prisma));
      } else {
        await drainHostedRevnetIssuanceSubmissionQueueBestEffort(prisma);
      }
    }

    const hostedExecutionEventId = reconciled?.hostedExecutionEventId ?? null;

    if (hostedExecutionEventId) {
      if (input.defer) {
        await input.defer(() =>
          drainHostedExecutionOutboxBestEffort({
            eventIds: [
              hostedExecutionEventId,
            ],
            limit: 1,
            prisma,
          }),
        );
      } else {
        await drainHostedExecutionOutboxBestEffort({
          eventIds: [
            hostedExecutionEventId,
          ],
          limit: 1,
          prisma,
        });
      }
    }
  }

  return {
    duplicate: recorded.duplicate || undefined,
    ok: true,
    type: recorded.type,
  };
}

export async function continueHostedOnboardingWebhookReceiptBestEffort(input: {
  eventId: string;
  prisma?: PrismaClient;
  signal?: AbortSignal;
  source: "linq" | "telegram";
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  try {
    const claimedReceipt = await claimHostedWebhookReceiptForContinuation({
      eventId: input.eventId,
      prisma,
      source: input.source,
    });

    if (!claimedReceipt) {
      return;
    }

    await continueHostedWebhookReceipt({
      claimedReceipt,
      eventId: input.eventId,
      handlers: createHostedWebhookReceiptHandlers(),
      prisma,
      signal: input.signal,
      source: input.source,
    });
  } catch (error) {
    console.error(
      "Hosted webhook receipt continuation failed.",
      sanitizeHostedOnboardingLogString(
        error instanceof Error ? error.message : String(error),
      ) ?? "Unknown error.",
    );
  }
}

export async function drainHostedOnboardingWebhookReceipts(input: {
  limit?: number;
  prisma?: PrismaClient;
} = {}): Promise<Array<{
  eventId: string;
  source: string;
  status: "continued" | "failed" | "skipped";
}>> {
  const prisma = input.prisma ?? getPrisma();
  const candidates = await listHostedWebhookReceiptContinuationCandidates({
    limit: input.limit,
    prisma,
  });
  const drained: Array<{
    eventId: string;
    source: string;
    status: "continued" | "failed" | "skipped";
  }> = [];

  for (const candidate of candidates) {
    let claimedReceipt;

    try {
      claimedReceipt = await claimHostedWebhookReceiptForContinuation({
        eventId: candidate.eventId,
        prisma,
        source: candidate.source,
      });
    } catch (error) {
      if (isHostedWebhookReceiptInProgressError(error)) {
        drained.push({
          eventId: candidate.eventId,
          source: candidate.source,
          status: "skipped",
        });
        continue;
      }

      console.error(
        "Hosted webhook receipt claim failed during cron recovery.",
        sanitizeHostedOnboardingLogString(
          error instanceof Error ? error.message : String(error),
        ) ?? "Unknown error.",
      );
      drained.push({
        eventId: candidate.eventId,
        source: candidate.source,
        status: "failed",
      });
      continue;
    }

    if (!claimedReceipt) {
      drained.push({
        eventId: candidate.eventId,
        source: candidate.source,
        status: "skipped",
      });
      continue;
    }

    try {
      await continueHostedWebhookReceipt({
        claimedReceipt,
        eventId: candidate.eventId,
        handlers: createHostedWebhookReceiptHandlers(),
        prisma,
        source: candidate.source,
      });
      drained.push({
        eventId: candidate.eventId,
        source: candidate.source,
        status: "continued",
      });
    } catch {
      drained.push({
        eventId: candidate.eventId,
        source: candidate.source,
        status: "failed",
      });
    }
  }

  return drained;
}

function isHostedWebhookReceiptInProgressError(error: unknown): boolean {
  return isHostedOnboardingError(error) && error.code === "WEBHOOK_RECEIPT_IN_PROGRESS";
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

async function drainHostedRevnetIssuanceSubmissionQueueBestEffort(
  prisma: PrismaClient,
): Promise<void> {
  try {
    await drainHostedRevnetIssuanceSubmissionQueue({
      limit: 1,
      prisma,
    });
  } catch (error) {
    console.error(
      "Hosted RevNet issuance best-effort drain failed.",
      sanitizeHostedOnboardingLogString(
        error instanceof Error ? error.message : String(error),
      ) ?? "Unknown error.",
    );
  }
}

async function maybeDrainHostedExecutionWebhookDispatch(input: {
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
  eventId: string;
  maxInlineDrainMs?: number;
  prisma: PrismaClient;
  response:
    | HostedOnboardingLinqWebhookResponse
    | HostedOnboardingTelegramWebhookResponse;
  source: "linq" | "telegram";
}): Promise<void> {
  if (input.response.reason !== "dispatched-active-member") {
    return;
  }

  const handoffTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.outbox-handoff`,
    {
      deferred: Boolean(input.defer),
      eventId: input.eventId,
      inlineTimeoutMs: input.maxInlineDrainMs ?? null,
      responseReason: input.response.reason,
    },
  );

  if (typeof input.maxInlineDrainMs === "number" && input.maxInlineDrainMs > 0) {
    const completedInline = await waitForHostedExecutionWebhookDrain({
      eventId: input.eventId,
      prisma: input.prisma,
      responseReason: input.response.reason,
      source: input.source,
      timeoutMs: input.maxInlineDrainMs,
    });

    if (completedInline) {
      finishHostedOnboardingTiming(handoffTiming, "completed", {
        deferred: false,
      });
      return;
    }

    if (input.defer) {
      await input.defer(() =>
        drainHostedExecutionWebhookOutbox({
          deferred: true,
          eventId: input.eventId,
          prisma: input.prisma,
          responseReason: input.response.reason,
          source: input.source,
        }),
      );
      finishHostedOnboardingTiming(handoffTiming, "scheduled", {
        deferred: true,
        timedOut: true,
      });
      return;
    }

    finishHostedOnboardingTiming(handoffTiming, "completed", {
      deferred: false,
      timedOut: true,
    });
    return;
  }

  if (input.defer) {
    await input.defer(() =>
      drainHostedExecutionWebhookOutbox({
        deferred: true,
        eventId: input.eventId,
        prisma: input.prisma,
        responseReason: input.response.reason,
        source: input.source,
      }),
    );
    finishHostedOnboardingTiming(handoffTiming, "scheduled", {
      deferred: true,
    });
    return;
  }

  await drainHostedExecutionWebhookOutbox({
    deferred: false,
    eventId: input.eventId,
    prisma: input.prisma,
    responseReason: input.response.reason,
    source: input.source,
  });
  finishHostedOnboardingTiming(handoffTiming, "completed", {
    deferred: false,
  });
}

async function drainHostedExecutionWebhookOutbox(input: {
  deferred: boolean;
  eventId: string;
  prisma: PrismaClient;
  responseReason: string | undefined;
  source: "linq" | "telegram";
}): Promise<void> {
  const drainTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.outbox-drain`,
    {
      deferred: input.deferred,
      eventId: input.eventId,
      responseReason: input.responseReason,
    },
  );
  await drainHostedExecutionOutboxBestEffort({
    eventIds: [
      input.eventId,
    ],
    limit: 1,
    prisma: input.prisma,
  });
  finishHostedOnboardingTiming(drainTiming, "completed");
}

async function waitForHostedExecutionWebhookDrain(input: {
  eventId: string;
  prisma: PrismaClient;
  responseReason: string | undefined;
  source: "linq" | "telegram";
  timeoutMs: number;
}): Promise<boolean> {
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs));

  if (!Number.isFinite(timeoutMs)) {
    return false;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      drainHostedExecutionWebhookOutbox({
        deferred: false,
        eventId: input.eventId,
        prisma: input.prisma,
        responseReason: input.responseReason,
        source: input.source,
      }).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
