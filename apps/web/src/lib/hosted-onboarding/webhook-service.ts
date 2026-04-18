import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
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
import {
  readHostedExecutionWakeTarget,
} from "../hosted-execution/dispatch-lifecycle";
import {
  handoffHostedExecutionWakeBestEffort,
  triggerHostedWakeUserBestEffort,
} from "../hosted-wake/control";
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
  HostedWebhookReceiptSideEffectDrainError,
  type HostedWebhookPlan,
  type HostedWebhookReceiptClaim,
} from "./webhook-receipts";
import {
  markHostedWebhookReceiptCompleted,
  markHostedWebhookReceiptFailed,
  queueHostedWebhookReceiptSideEffects,
  recordHostedWebhookReceipt,
} from "./webhook-receipt-store";
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

type HostedWebhookServiceResponse =
  | HostedOnboardingLinqWebhookResponse
  | HostedOnboardingTelegramWebhookResponse;

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
  const result = await processHostedOnboardingWebhookPlan({
    deferSideEffectDrain: input.defer,
    duplicateResponse: {
      ok: true,
      duplicate: true,
    },
    eventId: event.event_id,
    fastPathResponse: {
      ignored: false,
      ok: true,
      reason: "dispatched-active-member",
    },
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
    const response = result.response;
    responseReason = response.reason ?? null;
    finishHostedOnboardingTiming(receiptTiming, "completed", {
      duplicate: Boolean(response.duplicate),
      eventId,
      eventType,
      responseReason,
    });
    if (result.fastPathReceiptClaim) {
      try {
        await maybeHandoffHostedExecutionWebhookWake({
          defer: input.defer,
          eventId: event.event_id,
          maxInlineDrainMs: input.maxInlineDrainMs,
          prisma,
          response,
          source: "linq",
        });
        await markHostedWebhookReceiptCompleted({
          claimedReceipt: result.fastPathReceiptClaim,
          eventId: event.event_id,
          prisma,
          source: "linq",
        });
      } catch (error) {
        await markHostedWebhookReceiptFailed({
          claimedReceipt: result.fastPathReceiptClaim,
          error,
          eventId: event.event_id,
          prisma,
          source: "linq",
        });
        throw error;
      }
    } else {
      await maybeHandoffHostedExecutionWebhookWake({
        defer: input.defer,
        eventId: event.event_id,
        maxInlineDrainMs: input.maxInlineDrainMs,
        prisma,
        response,
        source: "linq",
      });
    }
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
  const result = await processHostedOnboardingWebhookPlan({
    duplicateResponse: {
      ok: true,
      duplicate: true,
    },
    eventId: buildHostedTelegramWebhookEventId(update),
    fastPathResponse: {
      ok: true,
      reason: "dispatched-active-member",
    },
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
  if (result.fastPathReceiptClaim) {
    try {
      await maybeHandoffHostedExecutionWebhookWake({
        defer: input.defer,
        eventId: buildHostedTelegramWebhookEventId(update),
        maxInlineDrainMs: input.maxInlineDrainMs,
        prisma,
        response: result.response,
        source: "telegram",
      });
      await markHostedWebhookReceiptCompleted({
        claimedReceipt: result.fastPathReceiptClaim,
        eventId: buildHostedTelegramWebhookEventId(update),
        prisma,
        source: "telegram",
      });
    } catch (error) {
      await markHostedWebhookReceiptFailed({
        claimedReceipt: result.fastPathReceiptClaim,
        error,
        eventId: buildHostedTelegramWebhookEventId(update),
        prisma,
        source: "telegram",
      });
      throw error;
    }
  } else {
    await maybeHandoffHostedExecutionWebhookWake({
      defer: input.defer,
      eventId: buildHostedTelegramWebhookEventId(update),
      maxInlineDrainMs: input.maxInlineDrainMs,
      prisma,
      response: result.response,
      source: "telegram",
    });
  }
  return result.response;
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
        await input.defer(async () => {
          await handoffHostedExecutionWakeBestEffort({
            context: "stripe.webhook",
            eventId: hostedExecutionEventId,
            prisma,
          });
        });
      } else {
        await handoffHostedExecutionWakeBestEffort({
          context: "stripe.webhook",
          eventId: hostedExecutionEventId,
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

async function maybeHandoffHostedExecutionWebhookWake(input: {
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

  const wakeTarget = await readHostedExecutionWakeTarget({
    eventId: input.eventId,
    prisma: input.prisma,
  });

  if (!wakeTarget) {
    return;
  }

  const handoffTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-handoff`,
    {
      deferred: Boolean(input.defer),
      eventId: input.eventId,
      inlineTimeoutMs: input.maxInlineDrainMs ?? null,
      responseReason: input.response.reason,
    },
  );

  if (typeof input.maxInlineDrainMs === "number" && input.maxInlineDrainMs > 0) {
    const completedInline = await waitForHostedExecutionWebhookWake({
      eventId: input.eventId,
      responseReason: input.response.reason,
      source: input.source,
      targetSeqHint: wakeTarget.seq ?? null,
      timeoutMs: input.maxInlineDrainMs,
      userId: wakeTarget.userId,
    });

    if (completedInline) {
      finishHostedOnboardingTiming(handoffTiming, "completed", {
        deferred: false,
      });
      return;
    }

    if (input.defer) {
      await input.defer(() =>
        handoffHostedExecutionWebhookWake({
          deferred: true,
          eventId: input.eventId,
          responseReason: input.response.reason,
          source: input.source,
          targetSeqHint: wakeTarget.seq ?? null,
          userId: wakeTarget.userId,
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
      handoffHostedExecutionWebhookWake({
        deferred: true,
        eventId: input.eventId,
        responseReason: input.response.reason,
        source: input.source,
        targetSeqHint: wakeTarget.seq ?? null,
        userId: wakeTarget.userId,
      }),
    );
    finishHostedOnboardingTiming(handoffTiming, "scheduled", {
      deferred: true,
    });
    return;
  }

  await handoffHostedExecutionWebhookWake({
    deferred: false,
    eventId: input.eventId,
    responseReason: input.response.reason,
    source: input.source,
    targetSeqHint: wakeTarget.seq ?? null,
    userId: wakeTarget.userId,
  });
  finishHostedOnboardingTiming(handoffTiming, "completed", {
    deferred: false,
  });
}

async function handoffHostedExecutionWebhookWake(input: {
  deferred: boolean;
  eventId: string;
  responseReason: string | undefined;
  source: "linq" | "telegram";
  targetSeqHint: string | null;
  userId: string;
}): Promise<void> {
  const drainTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-drain`,
    {
      deferred: input.deferred,
      eventId: input.eventId,
      responseReason: input.responseReason,
      targetSeqHint: input.targetSeqHint,
      userId: input.userId,
    },
  );
  await triggerHostedWakeUserBestEffort({
    context: `webhook:${input.source}`,
    targetSeqHint: input.targetSeqHint,
    userId: input.userId,
  });
  finishHostedOnboardingTiming(drainTiming, "completed");
}

async function waitForHostedExecutionWebhookWake(input: {
  eventId: string;
  responseReason: string | undefined;
  source: "linq" | "telegram";
  targetSeqHint: string | null;
  timeoutMs: number;
  userId: string;
}): Promise<boolean> {
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs));

  if (!Number.isFinite(timeoutMs)) {
    return false;
  }

  return triggerHostedWakeUserBestEffort({
    context: `webhook:${input.source}`,
    targetSeqHint: input.targetSeqHint,
    timeoutMs,
    userId: input.userId,
  });
}

async function processHostedOnboardingWebhookPlan<TResult extends HostedWebhookServiceResponse>(input: {
  deferSideEffectDrain?: (drain: () => Promise<void>) => Promise<void> | void;
  duplicateResponse: TResult;
  eventId: string;
  fastPathResponse: TResult;
  handlers: ReturnType<typeof createHostedWebhookReceiptHandlers>;
  plan: (prisma: Prisma.TransactionClient) => Promise<HostedWebhookPlan<TResult>>;
  prisma: PrismaClient;
  signal?: AbortSignal;
  source: "linq" | "telegram";
}): Promise<{
  fastPathReceiptClaim: HostedWebhookReceiptClaim | null;
  response: TResult;
}> {
  let claimedReceipt = await recordHostedWebhookReceipt({
    eventId: input.eventId,
    prisma: input.prisma,
    source: input.source,
  });

  if (!claimedReceipt) {
    return {
      fastPathReceiptClaim: null,
      response: input.duplicateResponse,
    };
  }

  const activeClaim = claimedReceipt;
  let response: TResult | null = null;

  try {
    if (!activeClaim.state.plannedAt) {
      const plannedResult = await runHostedWebhookReceiptTransaction(input.prisma, async (transaction) => {
        const plan = await input.plan(transaction);

        if (shouldUseHostedWebhookDirectWakeFastPath(plan, activeClaim)) {
          const nextClaim = await queueHostedWebhookReceiptSideEffects({
            claimedReceipt: activeClaim,
            desiredSideEffects: [],
            eventId: input.eventId,
            prisma: transaction,
            source: input.source,
          });

          return {
            claimedReceipt: nextClaim,
            fastPathReceiptClaim: nextClaim,
            response: plan.response,
          };
        }

        const nextClaim = await queueHostedWebhookReceiptSideEffects({
          claimedReceipt: activeClaim,
          desiredSideEffects: plan.desiredSideEffects,
          eventId: input.eventId,
          prisma: transaction,
          source: input.source,
        });

        return {
          claimedReceipt: nextClaim,
          fastPathReceiptClaim: null,
          response: plan.response,
        };
      });

      claimedReceipt = plannedResult.claimedReceipt;
      response = plannedResult.response;

      if (plannedResult.fastPathReceiptClaim) {
        return plannedResult;
      }
    } else if (activeClaim.state.sideEffects.length === 0) {
      const wakeTarget = await readHostedExecutionWakeTarget({
        eventId: input.eventId,
        prisma: input.prisma,
      });

      if (wakeTarget) {
        return {
          fastPathReceiptClaim: activeClaim,
          response: input.fastPathResponse,
        };
      }
    }

    if (input.deferSideEffectDrain && hasDeferredHostedWebhookSideEffects(claimedReceipt)) {
      const deferredClaim = claimedReceipt;

      try {
        await input.deferSideEffectDrain(() =>
          continueHostedWebhookReceipt({
            claimedReceipt: deferredClaim,
            eventId: input.eventId,
            handlers: input.handlers,
            markFailure: true,
            prisma: input.prisma,
            source: input.source,
          }),
        );
        return {
          fastPathReceiptClaim: null,
          response: response ?? input.duplicateResponse,
        };
      } catch (error) {
        console.error(
          "Hosted webhook side-effect drain scheduling failed.",
          sanitizeHostedOnboardingLogString(
            error instanceof Error ? error.message : String(error),
          ) ?? "Unknown error.",
        );
      }
    }

    await continueHostedWebhookReceipt({
      claimedReceipt,
      eventId: input.eventId,
      handlers: input.handlers,
      markFailure: false,
      prisma: input.prisma,
      signal: input.signal,
      source: input.source,
    });

    return {
      fastPathReceiptClaim: null,
      response: response ?? input.duplicateResponse,
    };
  } catch (error) {
    const failure = error instanceof HostedWebhookReceiptSideEffectDrainError
      ? error.cause
      : error;
    claimedReceipt = error instanceof HostedWebhookReceiptSideEffectDrainError
      ? error.claimedReceipt
      : claimedReceipt;

    await markHostedWebhookReceiptFailed({
      claimedReceipt,
      error: failure,
      eventId: input.eventId,
      prisma: input.prisma,
      source: input.source,
    });
    throw failure;
  }
}

async function runHostedWebhookReceiptTransaction<TResult>(
  prisma: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction(callback)
    : callback(prisma as Prisma.TransactionClient);
}

function shouldUseHostedWebhookDirectWakeFastPath(
  plan: HostedWebhookPlan<HostedWebhookServiceResponse>,
  claimedReceipt: HostedWebhookReceiptClaim,
): boolean {
  return plan.response.reason === "dispatched-active-member"
    && plan.desiredSideEffects.length === 0
    && claimedReceipt.state.sideEffects.length === 0;
}

function hasDeferredHostedWebhookSideEffects(
  claimedReceipt: HostedWebhookReceiptClaim,
): boolean {
  return claimedReceipt.state.sideEffects.length > 0;
}
