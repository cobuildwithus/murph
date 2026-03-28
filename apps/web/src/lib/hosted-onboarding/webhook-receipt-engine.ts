import { hostedOnboardingError } from "./errors";
import {
  readHostedWebhookReceiptState,
  requireHostedWebhookDispatchEffectDispatch,
  toHostedWebhookReceiptJsonInput,
} from "./webhook-receipt-codec";
import {
  markHostedWebhookReceiptCompleted,
  markHostedWebhookReceiptFailed,
  queueHostedWebhookReceiptSideEffects,
  recordHostedWebhookReceipt,
  updateHostedWebhookReceiptClaim,
} from "./webhook-receipt-store";
import {
  getHostedWebhookSideEffect,
  markHostedWebhookReceiptSideEffectFailed,
  markHostedWebhookReceiptSideEffectSent,
  startHostedWebhookReceiptSideEffect,
  toHostedWebhookReceiptClaim,
} from "./webhook-receipt-transitions";
import type {
  HostedWebhookDispatchSideEffect,
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

async function markHostedWebhookDispatchEffectQueued(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  dispatchEffect: HostedWebhookDispatchSideEffect;
  enqueueDispatchEffect: HostedWebhookReceiptHandlers["enqueueDispatchEffect"];
  eventId: string;
  prisma: import("@prisma/client").PrismaClient;
  sentAt: string;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  let currentClaim = input.claimedReceipt;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextClaim = toHostedWebhookReceiptClaim(
      markHostedWebhookReceiptSideEffectSent(
        currentClaim.state,
        input.dispatchEffect.effectId,
        { dispatched: true },
        input.sentAt,
      ),
    );
    const updatedCount = await input.enqueueDispatchEffect({
      dispatch: requireHostedWebhookDispatchEffectDispatch(input.dispatchEffect),
      eventId: input.eventId,
      nextPayloadJson: toHostedWebhookReceiptJsonInput(nextClaim.payloadJson),
      previousClaim: currentClaim,
      prisma: input.prisma,
      source: input.source,
    });

    if (updatedCount === 1) {
      return nextClaim;
    }

    const latestReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
      where: {
        source_eventId: {
          eventId: input.eventId,
          source: input.source,
        },
      },
      select: {
        payloadJson: true,
      },
    });

    if (!latestReceipt) {
      break;
    }

    currentClaim = {
      payloadJson: latestReceipt.payloadJson,
      state: readHostedWebhookReceiptState(latestReceipt.payloadJson),
    };
  }

  throw hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_UPDATE_FAILED",
    message: "Hosted webhook receipt could not be updated safely.",
    httpStatus: 503,
    retryable: true,
  });
}

function readHostedWebhookReceiptDrainError(
  error: unknown,
): HostedWebhookReceiptSideEffectDrainError | null {
  return error instanceof ReceiptSideEffectDrainError
    ? error
    : null;
}
