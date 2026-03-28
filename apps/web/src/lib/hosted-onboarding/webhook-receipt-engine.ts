import {
  markHostedWebhookDispatchEffectQueued,
  markHostedWebhookReceiptCompleted,
  markHostedWebhookReceiptFailed,
  queueHostedWebhookReceiptSideEffects,
  recordHostedWebhookReceipt,
  updateHostedWebhookReceiptClaim,
} from "./webhook-receipt-store";
import {
  getHostedWebhookSideEffect,
  markHostedWebhookReceiptSideEffectSent,
  markHostedWebhookReceiptSideEffectFailed,
  startHostedWebhookReceiptSideEffect,
} from "./webhook-receipt-transitions";
import type {
  HostedWebhookEventPayload,
  HostedWebhookPlan,
  HostedWebhookReceiptClaim,
  HostedWebhookReceiptHandlers,
  HostedWebhookReceiptSideEffectDrainError,
} from "./webhook-receipt-types";
import { HostedWebhookReceiptSideEffectDrainError as ReceiptSideEffectDrainError } from "./webhook-receipt-types";

export async function runHostedWebhookWithReceipt<TResult>(input: {
  duplicateResponse: TResult;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  handlers: HostedWebhookReceiptHandlers;
  plan: () => Promise<HostedWebhookPlan<TResult>>;
  prisma: import("@prisma/client").PrismaClient;
  signal?: AbortSignal;
  source: string;
}): Promise<TResult> {
  let claimedReceipt = await recordHostedWebhookReceipt({
    eventId: input.eventId,
    eventPayload: input.eventPayload,
    prisma: input.prisma,
    source: input.source,
  });

  if (!claimedReceipt) {
    return input.duplicateResponse;
  }

  try {
    const plan = await input.plan();

    claimedReceipt = await queueHostedWebhookReceiptSideEffects({
      claimedReceipt,
      desiredSideEffects: plan.desiredSideEffects,
      eventId: input.eventId,
      prisma: input.prisma,
      source: input.source,
    });
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
      eventPayload: input.eventPayload,
      prisma: input.prisma,
      source: input.source,
    });

    return plan.response;
  } catch (error) {
    const drainFailure = readHostedWebhookReceiptDrainError(error);
    const failure = drainFailure?.cause ?? error;
    claimedReceipt = drainFailure?.claimedReceipt ?? claimedReceipt;

    await markHostedWebhookReceiptFailed({
      claimedReceipt,
      error: failure,
      eventId: input.eventId,
      eventPayload: input.eventPayload,
      prisma: input.prisma,
      source: input.source,
    });
    throw failure;
  }
}

async function drainHostedWebhookReceiptSideEffects(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  handlers: HostedWebhookReceiptHandlers;
  prisma: import("@prisma/client").PrismaClient;
  signal?: AbortSignal;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  let currentClaim = input.claimedReceipt;

  for (const queuedEffect of currentClaim.state.sideEffects) {
    if (queuedEffect.status === "sent") {
      continue;
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
        currentClaim = await markHostedWebhookDispatchEffectQueued({
          claimedReceipt: currentClaim,
          dispatchEffect: effect,
          enqueueDispatchEffect: input.handlers.enqueueDispatchEffect,
          eventId: input.eventId,
          prisma: input.prisma,
          sentAt: new Date().toISOString(),
          source: input.source,
        });
        continue;
      }

      const result = await input.handlers.performSideEffect(effect, {
        signal: input.signal,
      });
      const sentAt = new Date().toISOString();
      currentClaim = await updateHostedWebhookReceiptClaim({
        claimedReceipt: currentClaim,
        eventId: input.eventId,
        mutate: (currentState) =>
          markHostedWebhookReceiptSideEffectSent(currentState, effect.effectId, result, sentAt),
        prisma: input.prisma,
        source: input.source,
      });

      if (input.handlers.afterSideEffectSent) {
        await input.handlers.afterSideEffectSent({
          effect,
          prisma: input.prisma,
        });
      }
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
