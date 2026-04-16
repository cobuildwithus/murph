import type { Prisma, PrismaClient } from "@prisma/client";

import {
  markHostedWebhookReceiptCompleted,
  markHostedWebhookReceiptFailed,
  queueHostedWebhookReceiptSideEffects,
  recordHostedWebhookReceipt,
  updateHostedWebhookReceiptClaim,
} from "./webhook-receipt-store";
import { buildHostedWebhookDispatchFromPayload } from "./webhook-receipt-dispatch";
import {
  getHostedWebhookSideEffect,
  markHostedWebhookReceiptSideEffectSent,
  markHostedWebhookReceiptSideEffectFailed,
  markHostedWebhookReceiptSideEffectSentUnconfirmed,
  startHostedWebhookReceiptSideEffect,
} from "./webhook-receipt-transitions";
import type {
  HostedWebhookDispatchSideEffect,
  HostedWebhookPlan,
  HostedWebhookReceiptClaim,
  HostedWebhookReceiptHandlers,
  HostedWebhookReceiptLocalSideEffect,
  HostedWebhookResponsePayload,
  HostedWebhookReceiptSideEffectDrainError,
} from "./webhook-receipt-types";
import { HostedWebhookReceiptSideEffectDrainError as ReceiptSideEffectDrainError } from "./webhook-receipt-types";
import { hostedOnboardingError } from "./errors";
import { sanitizeHostedOnboardingLogString } from "./http";

export async function runHostedWebhookWithReceipt<TResult extends HostedWebhookResponsePayload>(input: {
  deferSideEffectDrain?: (drain: () => Promise<void>) => Promise<void> | void;
  duplicateResponse: TResult;
  eventId: string;
  handlers: HostedWebhookReceiptHandlers;
  plan: (prisma: Prisma.TransactionClient) => Promise<HostedWebhookPlan<TResult>>;
  prisma: PrismaClient;
  signal?: AbortSignal;
  source: string;
}): Promise<TResult> {
  let claimedReceipt = await recordHostedWebhookReceipt({
    eventId: input.eventId,
    prisma: input.prisma,
    source: input.source,
  });

  if (!claimedReceipt) {
    return input.duplicateResponse;
  }

  let response: TResult | null = null;

  try {
    if (!claimedReceipt.state.plannedAt) {
      const activeClaim = claimedReceipt;
      const plannedResult = await runHostedWebhookReceiptTransaction(input.prisma, async (transaction) => {
        const plan = await input.plan(transaction);
        const {
          dispatchSideEffects,
          receiptSideEffects,
        } = partitionHostedWebhookPlanSideEffects(plan.desiredSideEffects);

        await enqueueHostedWebhookDispatches({
          dispatchSideEffects,
          eventId: input.eventId,
          handlers: input.handlers,
          prisma: transaction,
          source: input.source,
        });

        const nextClaim = await queueHostedWebhookReceiptSideEffects({
          claimedReceipt: activeClaim,
          desiredSideEffects: receiptSideEffects,
          eventId: input.eventId,
          prisma: transaction,
          source: input.source,
        });

        return {
          claimedReceipt: nextClaim,
          response: plan.response,
        };
      });

      claimedReceipt = plannedResult.claimedReceipt;
      response = plannedResult.response;
    }

    if (
      input.deferSideEffectDrain
      && hasDeferredHostedWebhookSideEffects(claimedReceipt)
    ) {
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
        return response ?? input.duplicateResponse;
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

    return response ?? input.duplicateResponse;
  } catch (error) {
    const drainFailure = readHostedWebhookReceiptDrainError(error);
    const failure = drainFailure?.cause ?? error;
    claimedReceipt = drainFailure?.claimedReceipt ?? claimedReceipt;

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

export async function continueHostedWebhookReceipt(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  handlers: HostedWebhookReceiptHandlers;
  markFailure?: boolean;
  prisma: PrismaClient;
  signal?: AbortSignal;
  source: string;
}): Promise<void> {
  let claimedReceipt = input.claimedReceipt;

  try {
    claimedReceipt = await drainHostedWebhookReceiptSideEffects({
      claimedReceipt,
      eventId: input.eventId,
      handlers: input.handlers,
      prisma: input.prisma,
      signal: input.signal,
      source: input.source,
    });

    await markHostedWebhookReceiptCompleted({
      claimedReceipt,
      eventId: input.eventId,
      prisma: input.prisma,
      source: input.source,
    });
  } catch (error) {
    const drainFailure = readHostedWebhookReceiptDrainError(error);
    const failure = drainFailure?.cause ?? error;
    claimedReceipt = drainFailure?.claimedReceipt ?? claimedReceipt;

    if (input.markFailure !== false) {
      await markHostedWebhookReceiptFailed({
        claimedReceipt,
        error: failure,
        eventId: input.eventId,
        prisma: input.prisma,
        source: input.source,
      });
    }
    throw failure;
  }
}

async function enqueueHostedWebhookDispatches(input: {
  dispatchSideEffects: readonly HostedWebhookDispatchSideEffect[];
  eventId: string;
  handlers: HostedWebhookReceiptHandlers;
  prisma: Prisma.TransactionClient;
  source: string;
}): Promise<void> {
  for (const sideEffect of input.dispatchSideEffects) {
    const dispatch = buildHostedWebhookDispatchFromPayload(sideEffect.payload);

    if (!dispatch) {
      throw hostedOnboardingError({
        code: "HOSTED_WEBHOOK_DISPATCH_PAYLOAD_INVALID",
        httpStatus: 500,
        message: `Hosted webhook dispatch side effect ${sideEffect.effectId} must resolve to an inline outbox dispatch.`,
        retryable: false,
      });
    }

    await input.handlers.enqueueDispatch({
      dispatch,
      eventId: input.eventId,
      source: input.source,
      transaction: input.prisma,
    });
  }
}

async function runHostedWebhookReceiptTransaction<TResult>(
  prisma: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction(callback)
    : callback(prisma as unknown as Prisma.TransactionClient);
}

async function drainHostedWebhookReceiptSideEffects(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  handlers: HostedWebhookReceiptHandlers;
  prisma: PrismaClient;
  signal?: AbortSignal;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  let currentClaim = input.claimedReceipt;

  for (const queuedEffect of currentClaim.state.sideEffects) {
    if (queuedEffect.status === "sent_unconfirmed") {
      throw new ReceiptSideEffectDrainError(
        currentClaim,
        buildHostedWebhookUnconfirmedSideEffectError(queuedEffect),
      );
    }

    const startedAt = new Date().toISOString();
    currentClaim = await updateHostedWebhookReceiptClaim({
      claimedReceipt: currentClaim,
      eventId: input.eventId,
      mutate: (currentState) =>
        startHostedWebhookReceiptSideEffect(currentState, queuedEffect.effectId, startedAt),
      prisma: input.prisma,
      source: input.source,
    });

    const effect = getHostedWebhookSideEffect(currentClaim.state, queuedEffect.effectId);

    try {
      if (effect.kind === "hosted_execution_dispatch") {
        throw new ReceiptSideEffectDrainError(
          currentClaim,
          hostedOnboardingError({
            code: "HOSTED_WEBHOOK_RECEIPT_DISPATCH_LEGACY",
            httpStatus: 500,
            message: `Hosted webhook receipt ${input.eventId} still stores a legacy dispatch side effect.`,
            retryable: false,
          }),
        );
      }

      let result;
      try {
        result = await input.handlers.performSideEffect(effect, {
          prisma: input.prisma,
          signal: input.signal,
        });
      } catch (error) {
        currentClaim = await updateHostedWebhookReceiptClaim({
          claimedReceipt: currentClaim,
          eventId: input.eventId,
          mutate: (currentState) =>
            markHostedWebhookReceiptSideEffectFailed(currentState, effect.effectId, error),
          prisma: input.prisma,
          source: input.source,
        });
        throw new ReceiptSideEffectDrainError(currentClaim, error);
      }

      const sentAt = new Date().toISOString();
      try {
        currentClaim = await updateHostedWebhookReceiptClaim({
          claimedReceipt: currentClaim,
          eventId: input.eventId,
          mutate: (currentState) =>
            markHostedWebhookReceiptSideEffectSent(currentState, effect.effectId, result, sentAt),
          prisma: input.prisma,
          source: input.source,
        });
      } catch (error) {
        try {
          currentClaim = await updateHostedWebhookReceiptClaim({
            claimedReceipt: currentClaim,
            eventId: input.eventId,
            mutate: (currentState) =>
              markHostedWebhookReceiptSideEffectSentUnconfirmed(currentState, effect.effectId, {
                error,
                result,
                sentAt,
              }),
            prisma: input.prisma,
            source: input.source,
          });
        } catch (recordingError) {
          throw new ReceiptSideEffectDrainError(
            currentClaim,
            buildHostedWebhookSideEffectDeliveryUncertainError(effect, error, recordingError),
          );
        }
        throw new ReceiptSideEffectDrainError(
          currentClaim,
          buildHostedWebhookSideEffectDeliveryUncertainError(effect, error),
        );
      }

      try {
        if (input.handlers.afterSideEffectSent) {
          await input.handlers.afterSideEffectSent({
            effect,
            prisma: input.prisma,
          });
        }
      } catch (error) {
        throw new ReceiptSideEffectDrainError(currentClaim, error);
      }
    } catch (error) {
      if (error instanceof ReceiptSideEffectDrainError) {
        throw error;
      }

      currentClaim = await updateHostedWebhookReceiptClaim({
        claimedReceipt: currentClaim,
        eventId: input.eventId,
        mutate: (currentState) =>
          markHostedWebhookReceiptSideEffectFailed(currentState, effect.effectId, error),
        prisma: input.prisma,
        source: input.source,
      });
      throw new ReceiptSideEffectDrainError(currentClaim, error);
    }
  }

  return currentClaim;
}

function readHostedWebhookReceiptDrainError(
  error: unknown,
): HostedWebhookReceiptSideEffectDrainError | null {
  return error instanceof ReceiptSideEffectDrainError
    ? error
    : null;
}

function hasDeferredHostedWebhookSideEffects(
  claimedReceipt: HostedWebhookReceiptClaim,
): boolean {
  return claimedReceipt.state.sideEffects.length > 0;
}

function partitionHostedWebhookPlanSideEffects(
  sideEffects: HostedWebhookPlan<HostedWebhookResponsePayload>["desiredSideEffects"],
): {
  dispatchSideEffects: HostedWebhookDispatchSideEffect[];
  receiptSideEffects: HostedWebhookReceiptLocalSideEffect[];
} {
  const dispatchSideEffects: HostedWebhookDispatchSideEffect[] = [];
  const receiptSideEffects: HostedWebhookReceiptLocalSideEffect[] = [];

  for (const sideEffect of sideEffects) {
    if (sideEffect.kind === "hosted_execution_dispatch") {
      dispatchSideEffects.push(sideEffect);
      continue;
    }

    receiptSideEffects.push(sideEffect);
  }

  return {
    dispatchSideEffects,
    receiptSideEffects,
  };
}

function buildHostedWebhookSideEffectDeliveryUncertainError(
  effect: {
    effectId: string;
    kind: string;
  },
  error: unknown,
  sentUnconfirmedError?: unknown,
): Error {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const sentUnconfirmedMessage =
    sentUnconfirmedError instanceof Error
      ? sentUnconfirmedError.message
      : sentUnconfirmedError
        ? String(sentUnconfirmedError)
        : null;

  return hostedOnboardingError({
    code: "hosted_webhook_side_effect_delivery_uncertain",
    details: {
      effectId: effect.effectId,
      effectKind: effect.kind,
      receiptWriteError: errorMessage,
      sentUnconfirmedWriteError: sentUnconfirmedMessage,
    },
    httpStatus: 500,
    message: `Hosted webhook side effect ${effect.effectId} may already have been delivered; automatic retry is blocked until the receipt is reconciled.`,
    retryable: false,
  });
}

function buildHostedWebhookUnconfirmedSideEffectError(effect: {
  effectId: string;
  kind: string;
}): Error {
  return hostedOnboardingError({
    code: "hosted_webhook_side_effect_delivery_uncertain",
    details: {
      effectId: effect.effectId,
      effectKind: effect.kind,
    },
    httpStatus: 500,
    message: `Hosted webhook side effect ${effect.effectId} may already have been delivered; automatic retry is blocked until the receipt is reconciled.`,
    retryable: false,
  });
}
