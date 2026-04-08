import { Prisma, type PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "./errors";
import {
  readHostedWebhookReceiptState,
  serializeHostedWebhookReceiptErrorState,
  serializeHostedWebhookReceiptSideEffect,
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
} from "./webhook-receipt-transitions";
import type {
  HostedWebhookDispatchSideEffect,
  HostedWebhookReceiptClaim,
  HostedWebhookReceiptHandlers,
  HostedWebhookReceiptPersistenceClient,
  HostedWebhookReceiptState,
  HostedWebhookSideEffect,
  HostedWebhookStoredDispatchSideEffectPayload,
} from "./webhook-receipt-types";

const RECEIPT_CLAIM_LEASE_MS = 10 * 60_000;

type HostedWebhookReceiptWriteResult = {
  cleanupPayloads?: HostedWebhookStoredDispatchSideEffectPayload[];
  updatedCount: number;
};

export async function recordHostedWebhookReceipt(input: {
  eventId: string;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim | null> {
  const now = new Date();
  const state = claimHostedWebhookReceipt({
    receivedAt: now,
  });
  const receipt = toHostedWebhookReceiptClaim({
    eventId: input.eventId,
    source: input.source,
    state,
    version: 1,
  });

  try {
    await input.prisma.hostedWebhookReceipt.create({
      data: buildHostedWebhookReceiptCreateData(receipt, now),
    });
    return receipt;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return claimExistingHostedWebhookReceipt(
        input,
        now,
        {
          createIfMissing: true,
        },
      );
    }

    throw error;
  }
}

export async function claimHostedWebhookReceiptForContinuation(input: {
  eventId: string;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim | null> {
  return claimExistingHostedWebhookReceipt(
    input,
    new Date(),
    {
      createIfMissing: false,
    },
  );
}

export async function listHostedWebhookReceiptContinuationCandidates(input: {
  limit?: number;
  now?: string;
  prisma: PrismaClient;
}): Promise<Array<{ eventId: string; source: string }>> {
  const now = new Date(input.now ?? new Date().toISOString());
  const candidates = await input.prisma.hostedWebhookReceipt.findMany({
    where: {
      plannedAt: {
        not: null,
      },
      sideEffects: {
        some: {},
      },
      OR: [
        {
          status: "failed",
          lastErrorRetryable: true,
        },
        {
          status: "processing",
          OR: [
            {
              claimExpiresAt: null,
            },
            {
              claimExpiresAt: {
                lt: now,
              },
            },
          ],
        },
      ],
    },
    orderBy: [
      {
        updatedAt: "asc",
      },
      {
        firstReceivedAt: "asc",
      },
    ],
    select: {
      eventId: true,
      source: true,
    },
    take: Math.max(Math.trunc(input.limit ?? 16), 1),
  });

  return candidates;
}

export async function queueHostedWebhookReceiptSideEffects(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  desiredSideEffects: HostedWebhookSideEffect[];
  eventId: string;
  prisma: HostedWebhookReceiptPersistenceClient;
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
  prisma: HostedWebhookReceiptPersistenceClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    prisma: input.prisma,
    source: input.source,
    status: "completed",
  });
}

export async function markHostedWebhookReceiptFailed(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  error: unknown;
  eventId: string;
  prisma: HostedWebhookReceiptPersistenceClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    error: input.error,
    eventId: input.eventId,
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
      const nextClaim = toHostedWebhookReceiptClaim({
        eventId: currentClaim.eventId,
        source: currentClaim.source,
        state: nextState,
        version: currentClaim.version + 1,
      });

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
      writeHostedWebhookReceiptClaimState({
        currentClaim,
        nextClaim,
        prisma: input.prisma,
      }),
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
      const nextClaim = toHostedWebhookReceiptClaim({
        eventId: currentClaim.eventId,
        source: currentClaim.source,
        state: markHostedWebhookReceiptSideEffectSent(
          currentClaim.state,
          input.dispatchEffect.effectId,
          { dispatched: true },
          input.sentAt,
        ),
        version: currentClaim.version + 1,
      });

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
      writeQueuedHostedWebhookDispatchEffect({
        currentClaim,
        enqueueDispatchEffect: input.enqueueDispatchEffect,
        nextClaim,
        payload,
        prisma: input.prisma,
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

async function cleanupHostedWebhookReceiptStagedPayloadsBestEffort(
  payloads: readonly HostedWebhookStoredDispatchSideEffectPayload[],
): Promise<void> {
  await Promise.allSettled(
    payloads.map((payload) => deleteHostedStoredDispatchPayloadBestEffort(payload)),
  );
}

async function claimExistingHostedWebhookReceipt(
  input: {
    eventId: string;
    prisma: PrismaClient;
    source: string;
  },
  receivedAt: Date,
  options: {
    createIfMissing: boolean;
  },
): Promise<HostedWebhookReceiptClaim | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
      where: {
        source_eventId: {
          eventId: input.eventId,
          source: input.source,
        },
      },
      include: {
        sideEffects: true,
      },
    });

    if (!existingReceipt) {
      if (!options.createIfMissing) {
        return null;
      }

      const state = claimHostedWebhookReceipt({
        receivedAt,
      });
      const receipt = toHostedWebhookReceiptClaim({
        eventId: input.eventId,
        source: input.source,
        state,
        version: 1,
      });

      try {
        await input.prisma.hostedWebhookReceipt.create({
          data: buildHostedWebhookReceiptCreateData(receipt, receivedAt),
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
      ...buildHostedWebhookStoredClaimFromRecord(existingReceipt, receivedAt),
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
          currentClaim.state.status === "processing"
          && !isHostedWebhookReceiptClaimExpired(currentClaim.claimExpiresAt, currentClaim.updatedAt, receivedAt)
        ) {
          throw buildHostedWebhookReceiptInProgressError();
        }

        const nextState = claimHostedWebhookReceipt({
          previousState: currentClaim.state,
          receivedAt,
        });
        const nextClaim = toHostedWebhookReceiptClaim({
          eventId: currentClaim.eventId,
          source: currentClaim.source,
          state: nextState,
          version: currentClaim.version + 1,
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
      updateReceipt: ({ currentClaim, nextClaim }) =>
        writeHostedWebhookReceiptClaimState({
          currentClaim,
          nextClaim,
          prisma: input.prisma,
        }),
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
  prisma: HostedWebhookReceiptPersistenceClient;
  source: string;
  status: "completed" | "failed";
}): Promise<void> {
  const receivedAt = new Date().toISOString();
  await compareAndSwapHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    decide: (currentClaim) => {
      const nextState =
        input.status === "completed"
          ? completeHostedWebhookReceipt(currentClaim.state, {
              completedAt: receivedAt,
            })
          : failHostedWebhookReceipt(currentClaim.state, {
              error: input.error,
              failedAt: receivedAt,
            });
      const nextClaim = toHostedWebhookReceiptClaim({
        eventId: currentClaim.eventId,
        source: currentClaim.source,
        state: nextState,
        version: currentClaim.version + 1,
      });

      return {
        nextClaim,
        result: undefined,
        type: "compare-and-swap",
      };
    },
    eventId: input.eventId,
    failure: buildHostedWebhookReceiptUpdateError,
    prisma: input.prisma,
    readCurrentClaim: readHostedWebhookReceiptClaim,
    source: input.source,
    updateReceipt: ({ currentClaim, nextClaim }) =>
      writeHostedWebhookReceiptClaimState({
        cleanupRemovedDispatchPayloads:
          input.status === "failed" && nextClaim.state.lastError?.retryable === false,
        currentClaim,
        nextClaim,
        prisma: input.prisma,
      }),
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

function buildHostedWebhookStoredClaimFromRecord(
  existingReceipt: Awaited<ReturnType<PrismaClient["hostedWebhookReceipt"]["findUnique"]>> & {
    sideEffects: NonNullable<Parameters<typeof readHostedWebhookReceiptState>[0]["sideEffects"]>;
  },
  receivedAt: Date,
): HostedWebhookReceiptStoredClaim {
  try {
    return {
      claimExpiresAt: existingReceipt.claimExpiresAt,
      eventId: existingReceipt.eventId,
      source: existingReceipt.source,
      state: readHostedWebhookReceiptState({
        receipt: existingReceipt,
        sideEffects: existingReceipt.sideEffects,
      }),
      updatedAt: existingReceipt.updatedAt,
      version: existingReceipt.version,
    };
  } catch {
    return {
      claimExpiresAt: existingReceipt.claimExpiresAt,
      eventId: existingReceipt.eventId,
      source: existingReceipt.source,
      state: {
        attemptCount: Math.max(Math.trunc(existingReceipt.attemptCount), 1),
        attemptId: existingReceipt.attemptId,
        completedAt: null,
        lastError: null,
        lastReceivedAt:
          existingReceipt.lastReceivedAt instanceof Date
            ? existingReceipt.lastReceivedAt.toISOString()
            : receivedAt.toISOString(),
        plannedAt: null,
        sideEffects: [],
        status: "failed",
      },
      updatedAt: existingReceipt.updatedAt,
      version: existingReceipt.version,
    };
  }
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
  }) => Promise<HostedWebhookReceiptWriteResult>;
}): Promise<TResult> {
  let currentClaim = input.claimedReceipt;
  const maxAttempts = Math.max(Math.trunc(input.maxAttempts ?? 3), 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const decision = input.decide(currentClaim);

    if (decision.type === "return") {
      return decision.result;
    }

    const writeResult = await input.updateReceipt({
      currentClaim,
      nextClaim: decision.nextClaim,
    });

    if (writeResult.updatedCount === 1) {
      if ((writeResult.cleanupPayloads?.length ?? 0) > 0) {
        await cleanupHostedWebhookReceiptStagedPayloadsBestEffort(writeResult.cleanupPayloads ?? []);
      }

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
    eventId: latestReceipt.eventId,
    source: latestReceipt.source,
    state: latestReceipt.state,
    version: latestReceipt.version,
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
    include: {
      sideEffects: true,
    },
  });

  if (!latestReceipt) {
    return null;
  }

  return buildHostedWebhookStoredClaimFromRecord(latestReceipt, new Date());
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

function toHostedWebhookReceiptClaim(input: {
  eventId: string;
  source: string;
  state: HostedWebhookReceiptState;
  version: number;
}): HostedWebhookReceiptClaim {
  return {
    eventId: input.eventId,
    source: input.source,
    state: input.state,
    version: input.version,
  };
}

function buildHostedWebhookReceiptCreateData(
  claim: HostedWebhookReceiptClaim,
  receivedAt: Date,
): Prisma.HostedWebhookReceiptCreateInput {
  return {
    attemptCount: claim.state.attemptCount,
    attemptId: claim.state.attemptId,
    claimExpiresAt: buildHostedWebhookReceiptLeaseWriteData(claim.state.status).claimExpiresAt,
    completedAt: null,
    createdAt: receivedAt,
    eventId: claim.eventId,
    firstReceivedAt: receivedAt,
    lastReceivedAt: receivedAt,
    ...serializeHostedWebhookReceiptErrorState(null),
    plannedAt: null,
    source: claim.source,
    status: claim.state.status,
    updatedAt: receivedAt,
    version: claim.version,
  };
}

function buildHostedWebhookReceiptStateUpdateData(
  state: HostedWebhookReceiptState,
): Prisma.HostedWebhookReceiptUpdateManyMutationInput {
  return {
    attemptCount: state.attemptCount,
    attemptId: state.attemptId,
    completedAt: toDateOrNull(state.completedAt),
    ...serializeHostedWebhookReceiptErrorState(state.lastError),
    lastReceivedAt: new Date(state.lastReceivedAt),
    plannedAt: toDateOrNull(state.plannedAt),
    status: state.status,
  };
}

async function writeHostedWebhookReceiptClaimState(input: {
  cleanupRemovedDispatchPayloads?: boolean;
  currentClaim: HostedWebhookReceiptClaim;
  nextClaim: HostedWebhookReceiptClaim;
  prisma: HostedWebhookReceiptPersistenceClient;
}): Promise<HostedWebhookReceiptWriteResult> {
  const cleanupPayloads = input.cleanupRemovedDispatchPayloads
    ? collectRemovedDispatchCleanupPayloads(input.currentClaim.state.sideEffects, input.nextClaim.state.sideEffects)
    : [];

  const updatedCount = await runHostedWebhookReceiptTransaction(input.prisma, async (transaction) => {
    const updated = await transaction.hostedWebhookReceipt.updateMany({
      where: {
        source: input.currentClaim.source,
        eventId: input.currentClaim.eventId,
        version: input.currentClaim.version,
      },
      data: {
        ...buildHostedWebhookReceiptLeaseWriteData(input.nextClaim.state.status),
        ...buildHostedWebhookReceiptStateUpdateData(input.nextClaim.state),
        version: {
          increment: 1,
        },
      },
    });

    if (updated.count !== 1) {
      return 0;
    }

    await syncHostedWebhookReceiptSideEffects(transaction, input.nextClaim);
    return 1;
  });

  return {
    cleanupPayloads,
    updatedCount,
  };
}

async function writeQueuedHostedWebhookDispatchEffect(input: {
  currentClaim: HostedWebhookReceiptClaim;
  enqueueDispatchEffect: HostedWebhookReceiptHandlers["enqueueDispatchEffect"];
  nextClaim: HostedWebhookReceiptClaim;
  payload: HostedWebhookStoredDispatchSideEffectPayload;
  prisma: HostedWebhookReceiptPersistenceClient;
}): Promise<HostedWebhookReceiptWriteResult> {
  const updatedCount = await runHostedWebhookReceiptTransaction(input.prisma, async (transaction) => {
    const updated = await transaction.hostedWebhookReceipt.updateMany({
      where: {
        source: input.currentClaim.source,
        eventId: input.currentClaim.eventId,
        version: input.currentClaim.version,
      },
      data: {
        ...buildHostedWebhookReceiptLeaseWriteData(input.nextClaim.state.status),
        ...buildHostedWebhookReceiptStateUpdateData(input.nextClaim.state),
        version: {
          increment: 1,
        },
      },
    });

    if (updated.count !== 1) {
      return 0;
    }

    await syncHostedWebhookReceiptSideEffects(transaction, input.nextClaim);
    await input.enqueueDispatchEffect({
      eventId: input.currentClaim.eventId,
      payload: input.payload,
      prismaOrTransaction: transaction,
      source: input.currentClaim.source,
    });
    return 1;
  });

  return {
    updatedCount,
  };
}

async function syncHostedWebhookReceiptSideEffects(
  transaction: Prisma.TransactionClient,
  claim: HostedWebhookReceiptClaim,
): Promise<void> {
  const effectIds = claim.state.sideEffects.map((effect) => effect.effectId);

  if (effectIds.length === 0) {
    await transaction.hostedWebhookReceiptSideEffect.deleteMany({
      where: {
        source: claim.source,
        eventId: claim.eventId,
      },
    });
    return;
  }

  await transaction.hostedWebhookReceiptSideEffect.deleteMany({
    where: {
      source: claim.source,
      eventId: claim.eventId,
      effectId: {
        notIn: effectIds,
      },
    },
  });

  for (const effect of claim.state.sideEffects) {
    const serialized = serializeHostedWebhookReceiptSideEffect(effect);
    await transaction.hostedWebhookReceiptSideEffect.upsert({
      where: {
        source_eventId_effectId: {
          source: claim.source,
          eventId: claim.eventId,
          effectId: effect.effectId,
        },
      },
      create: {
        source: claim.source,
        eventId: claim.eventId,
        effectId: effect.effectId,
        ...serialized,
      },
      update: serialized,
    });
  }
}

function collectRemovedDispatchCleanupPayloads(
  currentSideEffects: readonly HostedWebhookSideEffect[],
  nextSideEffects: readonly HostedWebhookSideEffect[],
): HostedWebhookStoredDispatchSideEffectPayload[] {
  const nextIds = new Set(nextSideEffects.map((effect) => effect.effectId));
  const payloads: HostedWebhookStoredDispatchSideEffectPayload[] = [];

  for (const effect of currentSideEffects) {
    if (effect.kind !== "hosted_execution_dispatch" || nextIds.has(effect.effectId)) {
      continue;
    }

    const payload = requireHostedWebhookStoredDispatchSideEffectPayload(effect.payload, effect.effectId);
    payloads.push(payload);
  }

  return payloads;
}

async function runHostedWebhookReceiptTransaction<TResult>(
  prisma: HostedWebhookReceiptPersistenceClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction(callback)
    : callback(prisma as Prisma.TransactionClient);
}

function toDateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null;
}
