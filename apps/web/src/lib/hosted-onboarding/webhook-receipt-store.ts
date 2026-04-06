import { Prisma, type PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "./errors";
import {
  readHostedWebhookReceiptState,
  toHostedWebhookReceiptJsonInput,
} from "./webhook-receipt-codec";
import {
  deleteHostedStoredDispatchPayloadBestEffort,
  requireHostedWebhookStoredDispatchSideEffectPayload,
  stageHostedWebhookDispatchSideEffectPayload,
} from "./webhook-dispatch-payload";
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
  HostedWebhookReceiptPersistenceClient,
  HostedWebhookReceiptState,
  HostedWebhookResponsePayload,
  HostedWebhookSideEffect,
  HostedWebhookStoredDispatchSideEffectPayload,
} from "./webhook-receipt-types";

const RECEIPT_CLAIM_LEASE_MS = 10 * 60_000;

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
        ...buildHostedWebhookReceiptLeaseWriteData(receipt.state.status),
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
  prisma: HostedWebhookReceiptPersistenceClient;
  response: HostedWebhookResponsePayload;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  const stagedSideEffects = await stageHostedWebhookReceiptSideEffects(input.desiredSideEffects);

  try {
    return await updateHostedWebhookReceiptClaim({
      claimedReceipt: input.claimedReceipt,
      eventId: input.eventId,
      mutate: (currentState) =>
        queueHostedWebhookReceiptStateSideEffects(currentState, stagedSideEffects.sideEffects, {
          plannedAt: new Date().toISOString(),
          response: input.response,
        }),
      prisma: input.prisma,
      source: input.source,
    });
  } catch (error) {
    await cleanupHostedWebhookReceiptStagedPayloads(stagedSideEffects.cleanupPayloads);
    throw error;
  }
}

export async function markHostedWebhookReceiptCompleted(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: HostedWebhookReceiptPersistenceClient;
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
  prisma: HostedWebhookReceiptPersistenceClient;
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
  prisma: HostedWebhookReceiptPersistenceClient;
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
    readCurrentClaim: readHostedWebhookReceiptClaim,
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
            ...buildHostedWebhookReceiptLeaseWriteData(nextClaim.state.status),
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
  prisma: HostedWebhookReceiptPersistenceClient;
  sentAt: string;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  const payload = requireHostedWebhookStoredDispatchSideEffectPayload(
    input.dispatchEffect.payload,
    input.dispatchEffect.effectId,
  );

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
    readCurrentClaim: readHostedWebhookReceiptClaim,
    source: input.source,
    updateReceipt: ({ currentClaim, nextClaim }) =>
      input.enqueueDispatchEffect({
        eventId: input.eventId,
        nextPayloadJson: toHostedWebhookReceiptJsonInput(nextClaim.payloadJson),
        nextStatus: nextClaim.state.status,
        payload,
        previousClaim: currentClaim,
        prismaOrTransaction: input.prisma,
        source: input.source,
      }),
  });
}

async function stageHostedWebhookReceiptSideEffects(
  desiredSideEffects: readonly HostedWebhookSideEffect[],
): Promise<{
  cleanupPayloads: HostedWebhookStoredDispatchSideEffectPayload[];
  sideEffects: HostedWebhookSideEffect[];
}> {
  const cleanupPayloads: HostedWebhookStoredDispatchSideEffectPayload[] = [];
  const sideEffects: HostedWebhookSideEffect[] = [];

  try {
    for (const effect of desiredSideEffects) {
      if (effect.kind !== "hosted_execution_dispatch") {
        sideEffects.push(effect);
        continue;
      }

      const stagedPayload = await stageHostedWebhookDispatchSideEffectPayload(effect.payload);

      if (effect.payload.storage !== "reference") {
        cleanupPayloads.push(stagedPayload);
      }

      sideEffects.push({
        ...effect,
        payload: stagedPayload,
      });
    }
  } catch (error) {
    await cleanupHostedWebhookReceiptStagedPayloads(cleanupPayloads);
    throw error;
  }

  return {
    cleanupPayloads,
    sideEffects,
  };
}

async function cleanupHostedWebhookReceiptStagedPayloads(
  payloads: readonly HostedWebhookStoredDispatchSideEffectPayload[],
): Promise<void> {
  await Promise.all(
    payloads.map((payload) => deleteHostedStoredDispatchPayloadBestEffort(payload)),
  );
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
        claimExpiresAt: true,
        payloadJson: true,
        updatedAt: true,
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
            ...buildHostedWebhookReceiptLeaseWriteData(receipt.state.status),
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
    const existingClaim: HostedWebhookReceiptStoredClaim = {
      claimExpiresAt: existingReceipt.claimExpiresAt,
      payloadJson: existingReceipt.payloadJson,
      state: readHostedWebhookReceiptState(existingReceipt.payloadJson),
      updatedAt: existingReceipt.updatedAt,
    };

    return compareAndSwapHostedWebhookReceiptClaim<
      HostedWebhookReceiptClaim | null,
      HostedWebhookReceiptStoredClaim
    >({
      claimedReceipt: existingClaim,
      decide: (currentClaim) => {
        if (currentClaim.state.status === "completed") {
          return {
            result: null,
            type: "return",
          };
        }

        if (isHostedWebhookReceiptAutomaticReplayBlocked(currentClaim)) {
          return {
            result: null,
            type: "return",
          };
        }

        if (
          currentClaim.state.status === "processing" &&
          !isHostedWebhookReceiptClaimExpired(currentClaim.claimExpiresAt, currentClaim.updatedAt, receivedAt)
        ) {
          throw buildHostedWebhookReceiptInProgressError();
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
      readCurrentClaim: readHostedWebhookReceiptStoredClaim,
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
              ...buildHostedWebhookReceiptLeaseWriteData(nextClaim.state.status),
            },
          })
        ).count,
    });
  }

  throw buildHostedWebhookReceiptClaimError();
}

function isHostedWebhookReceiptAutomaticReplayBlocked(
  claim: HostedWebhookReceiptClaim,
): boolean {
  return claim.state.status === "failed" && claim.state.lastError?.retryable === false;
}

async function updateHostedWebhookReceiptStatus(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  error?: unknown;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: HostedWebhookReceiptPersistenceClient;
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

interface HostedWebhookReceiptStoredClaim extends HostedWebhookReceiptClaim {
  claimExpiresAt: Date | null;
  updatedAt: Date | null;
}

async function compareAndSwapHostedWebhookReceiptClaim<
  TResult,
  TCurrentClaim extends HostedWebhookReceiptClaim = HostedWebhookReceiptClaim,
>(input: {
  claimedReceipt: TCurrentClaim;
  decide: (
    currentClaim: TCurrentClaim,
  ) => HostedWebhookReceiptCompareAndSwapDecision<TResult>;
  eventId: string;
  failure: () => Error;
  maxAttempts?: number;
  prisma: HostedWebhookReceiptPersistenceClient;
  readCurrentClaim: (input: {
    eventId: string;
    prisma: HostedWebhookReceiptPersistenceClient;
    source: string;
  }) => Promise<TCurrentClaim | null>;
  source: string;
  updateReceipt: (input: {
    currentClaim: TCurrentClaim;
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

    const latestClaim = await input.readCurrentClaim({
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
  prisma: HostedWebhookReceiptPersistenceClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim | null> {
  const latestReceipt = await readHostedWebhookReceiptStoredClaim(input);

  if (!latestReceipt) {
    return null;
  }

  return {
    payloadJson: latestReceipt.payloadJson,
    state: latestReceipt.state,
  };
}

async function readHostedWebhookReceiptStoredClaim(input: {
  eventId: string;
  prisma: HostedWebhookReceiptPersistenceClient;
  source: string;
}): Promise<HostedWebhookReceiptStoredClaim | null> {
  const latestReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
    where: {
      source_eventId: {
        eventId: input.eventId,
        source: input.source,
      },
    },
    select: {
      claimExpiresAt: true,
      payloadJson: true,
      updatedAt: true,
    },
  });

  if (!latestReceipt) {
    return null;
  }

  return {
    claimExpiresAt: latestReceipt.claimExpiresAt,
    payloadJson: latestReceipt.payloadJson,
    state: readHostedWebhookReceiptState(latestReceipt.payloadJson),
    updatedAt: latestReceipt.updatedAt,
  };
}

function buildHostedWebhookReceiptInProgressError(): Error {
  return hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_IN_PROGRESS",
    message: "Hosted webhook receipt is already being processed.",
    httpStatus: 503,
    retryable: true,
  });
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

export function buildHostedWebhookReceiptLeaseWriteData(
  status: HostedWebhookReceiptState["status"],
): {
  claimExpiresAt: Date | null;
} {
  return {
    claimExpiresAt:
      status === "processing"
        ? new Date(Date.now() + RECEIPT_CLAIM_LEASE_MS)
        : null,
  };
}

function isHostedWebhookReceiptClaimExpired(
  claimExpiresAt: Date | null | undefined,
  updatedAt: Date | null | undefined,
  now: Date,
): boolean {
  if (claimExpiresAt) {
    return claimExpiresAt.getTime() <= now.getTime();
  }

  if (updatedAt) {
    return updatedAt.getTime() + RECEIPT_CLAIM_LEASE_MS <= now.getTime();
  }

  return false;
}
