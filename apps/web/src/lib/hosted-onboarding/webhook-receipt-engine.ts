import type { Prisma, PrismaClient } from "@prisma/client";

import {
  markHostedWebhookReceiptCompleted,
  markHostedWebhookReceiptFailed,
  updateHostedWebhookReceiptClaim,
} from "./webhook-receipt-store";
import {
  getHostedWebhookSideEffect,
  markHostedWebhookReceiptSideEffectSent,
  markHostedWebhookReceiptSideEffectFailed,
  markHostedWebhookReceiptSideEffectSentUnconfirmed,
  startHostedWebhookReceiptSideEffect,
} from "./webhook-receipt-transitions";
import type {
  HostedWebhookReceiptClaim,
  HostedWebhookReceiptHandlers,
  HostedWebhookReceiptSideEffectDrainError,
} from "./webhook-receipt-types";
import { HostedWebhookReceiptSideEffectDrainError as ReceiptSideEffectDrainError } from "./webhook-receipt-types";
import { hostedOnboardingError } from "./errors";

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
