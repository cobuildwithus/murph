import { Prisma, type PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "./errors";
import {
  readHostedWebhookReceiptState,
  requireHostedWebhookDispatchEffectDispatch,
  toHostedWebhookReceiptJsonInput,
} from "./webhook-receipt-codec";
import {
  claimHostedWebhookReceipt,
  completeHostedWebhookReceipt,
  failHostedWebhookReceipt,
  markHostedWebhookReceiptSideEffectSent,
  queueHostedWebhookReceiptSideEffects as queueHostedWebhookReceiptStateSideEffects,
  toHostedWebhookReceiptClaim,
} from "./webhook-receipt-transitions";
import type {
  HostedWebhookDispatchSideEffect,
  HostedWebhookEventPayload,
  HostedWebhookReceiptClaim,
  HostedWebhookReceiptHandlers,
  HostedWebhookReceiptState,
  HostedWebhookSideEffect,
} from "./webhook-receipt-types";

export async function recordHostedWebhookReceipt(input: {
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim | null> {
  const now = new Date();
  const receipt = claimHostedWebhookReceipt({
    eventPayload: input.eventPayload,
    receivedAt: now,
  });

  try {
    await input.prisma.hostedWebhookReceipt.create({
      data: {
        source: input.source,
        eventId: input.eventId,
        firstReceivedAt: now,
        payloadJson: toHostedWebhookReceiptJsonInput(receipt.payloadJson),
      },
    });
    return receipt;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return reclaimHostedWebhookReceipt(input, now);
    }

    throw error;
  }
}

export async function queueHostedWebhookReceiptSideEffects(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  desiredSideEffects: HostedWebhookSideEffect[];
  eventId: string;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  if (input.desiredSideEffects.length === 0) {
    return input.claimedReceipt;
  }

  return updateHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    mutate: (currentState) =>
      queueHostedWebhookReceiptStateSideEffects(currentState, input.desiredSideEffects),
    prisma: input.prisma,
    source: input.source,
  });
}

export async function markHostedWebhookReceiptCompleted(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    eventPayload: input.eventPayload,
    prisma: input.prisma,
    source: input.source,
    status: "completed",
  });
}

export async function markHostedWebhookReceiptFailed(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  error: unknown;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    error: input.error,
    eventId: input.eventId,
    eventPayload: input.eventPayload,
    prisma: input.prisma,
    source: input.source,
    status: "failed",
  });
}

export async function updateHostedWebhookReceiptClaim(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  mutate: (currentState: HostedWebhookReceiptState) => HostedWebhookReceiptState;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  return compareAndSwapHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    decide: (currentClaim) => {
      const nextState = input.mutate(currentClaim.state);
      const nextClaim = toHostedWebhookReceiptClaim(nextState);

      return {
        nextClaim,
        result: nextClaim,
        type: "compare-and-swap",
      };
    },
    eventId: input.eventId,
    failure: buildHostedWebhookReceiptUpdateError,
    prisma: input.prisma,
    source: input.source,
    updateReceipt: async ({ currentClaim, nextClaim }) =>
      (
        await input.prisma.hostedWebhookReceipt.updateMany({
          where: {
            source: input.source,
            eventId: input.eventId,
            payloadJson: {
              equals: currentClaim.payloadJson ?? Prisma.JsonNull,
            },
          },
          data: {
            payloadJson: toHostedWebhookReceiptJsonInput(nextClaim.payloadJson),
          },
        })
      ).count,
  });
}

export async function markHostedWebhookDispatchEffectQueued(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  dispatchEffect: HostedWebhookDispatchSideEffect;
  enqueueDispatchEffect: HostedWebhookReceiptHandlers["enqueueDispatchEffect"];
  eventId: string;
  prisma: PrismaClient;
  sentAt: string;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  return compareAndSwapHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    decide: (currentClaim) => {
      const nextClaim = toHostedWebhookReceiptClaim(
        markHostedWebhookReceiptSideEffectSent(
          currentClaim.state,
          input.dispatchEffect.effectId,
          { dispatched: true },
          input.sentAt,
        ),
      );

      return {
        nextClaim,
        result: nextClaim,
        type: "compare-and-swap",
      };
    },
    eventId: input.eventId,
    failure: buildHostedWebhookReceiptUpdateError,
    prisma: input.prisma,
    source: input.source,
    updateReceipt: ({ currentClaim, nextClaim }) =>
      input.enqueueDispatchEffect({
        dispatch: requireHostedWebhookDispatchEffectDispatch(input.dispatchEffect),
        eventId: input.eventId,
        nextPayloadJson: toHostedWebhookReceiptJsonInput(nextClaim.payloadJson),
        previousClaim: currentClaim,
        prismaOrTransaction: input.prisma,
        source: input.source,
      }),
  });
}

async function reclaimHostedWebhookReceipt(
  input: {
    eventId: string;
    eventPayload: HostedWebhookEventPayload;
    prisma: PrismaClient;
    source: string;
  },
  receivedAt: Date,
): Promise<HostedWebhookReceiptClaim | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
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

    if (!existingReceipt) {
      const receipt = claimHostedWebhookReceipt({
        eventPayload: input.eventPayload,
        receivedAt,
      });
      try {
        await input.prisma.hostedWebhookReceipt.create({
          data: {
            source: input.source,
            eventId: input.eventId,
            firstReceivedAt: receivedAt,
            payloadJson: toHostedWebhookReceiptJsonInput(receipt.payloadJson),
          },
        });
        return receipt;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }

        throw error;
      }
    }
    return compareAndSwapHostedWebhookReceiptClaim({
      claimedReceipt: {
        payloadJson: existingReceipt.payloadJson,
        state: readHostedWebhookReceiptState(existingReceipt.payloadJson),
      },
      decide: (currentClaim) => {
        if (
          currentClaim.state.status === "completed" ||
          currentClaim.state.status === "processing"
        ) {
          return {
            result: null,
            type: "return",
          };
        }

        const nextClaim = claimHostedWebhookReceipt({
          eventPayload: input.eventPayload,
          previousState: currentClaim.state,
          receivedAt,
        });

        return {
          nextClaim,
          result: nextClaim,
          type: "compare-and-swap",
        };
      },
      eventId: input.eventId,
      failure: buildHostedWebhookReceiptClaimError,
      maxAttempts: 3 - attempt,
      prisma: input.prisma,
      source: input.source,
      updateReceipt: async ({ currentClaim, nextClaim }) =>
        (
          await input.prisma.hostedWebhookReceipt.updateMany({
            where: {
              source: input.source,
              eventId: input.eventId,
              payloadJson: {
                equals: currentClaim.payloadJson ?? Prisma.JsonNull,
              },
            },
            data: {
              payloadJson: toHostedWebhookReceiptJsonInput(nextClaim.payloadJson),
            },
          })
        ).count,
    });
  }

  throw buildHostedWebhookReceiptClaimError();
}

async function updateHostedWebhookReceiptStatus(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  error?: unknown;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
  status: "completed" | "failed";
}): Promise<void> {
  const receivedAt = new Date().toISOString();
  await updateHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    mutate: (currentState) =>
      input.status === "completed"
        ? completeHostedWebhookReceipt(currentState, {
            completedAt: receivedAt,
            eventPayload: input.eventPayload,
          })
        : failHostedWebhookReceipt(currentState, {
            error: input.error,
            eventPayload: input.eventPayload,
            failedAt: receivedAt,
          }),
    prisma: input.prisma,
    source: input.source,
  });
}

type HostedWebhookReceiptCompareAndSwapDecision<TResult> =
  | {
      result: TResult;
      type: "return";
    }
  | {
      nextClaim: HostedWebhookReceiptClaim;
      result: TResult;
      type: "compare-and-swap";
    };

async function compareAndSwapHostedWebhookReceiptClaim<TResult>(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  decide: (
    currentClaim: HostedWebhookReceiptClaim,
  ) => HostedWebhookReceiptCompareAndSwapDecision<TResult>;
  eventId: string;
  failure: () => Error;
  maxAttempts?: number;
  prisma: PrismaClient;
  source: string;
  updateReceipt: (input: {
    currentClaim: HostedWebhookReceiptClaim;
    nextClaim: HostedWebhookReceiptClaim;
  }) => Promise<number>;
}): Promise<TResult> {
  let currentClaim = input.claimedReceipt;
  const maxAttempts = Math.max(Math.trunc(input.maxAttempts ?? 3), 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const decision = input.decide(currentClaim);

    if (decision.type === "return") {
      return decision.result;
    }

    const updatedCount = await input.updateReceipt({
      currentClaim,
      nextClaim: decision.nextClaim,
    });

    if (updatedCount === 1) {
      return decision.result;
    }

    const latestClaim = await readHostedWebhookReceiptClaim({
      eventId: input.eventId,
      prisma: input.prisma,
      source: input.source,
    });

    if (!latestClaim) {
      break;
    }

    currentClaim = latestClaim;
  }

  throw input.failure();
}

async function readHostedWebhookReceiptClaim(input: {
  eventId: string;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim | null> {
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
    return null;
  }

  return {
    payloadJson: latestReceipt.payloadJson,
    state: readHostedWebhookReceiptState(latestReceipt.payloadJson),
  };
}

function buildHostedWebhookReceiptClaimError(): Error {
  return hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_CLAIM_FAILED",
    message: "Hosted webhook receipt could not be claimed safely for processing.",
    httpStatus: 503,
    retryable: true,
  });
}

function buildHostedWebhookReceiptUpdateError(): Error {
  return hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_UPDATE_FAILED",
    message: "Hosted webhook receipt could not be updated safely.",
    httpStatus: 503,
    retryable: true,
  });
}
