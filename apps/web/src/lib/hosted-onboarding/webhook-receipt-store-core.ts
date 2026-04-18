import { Prisma, type PrismaClient } from "@prisma/client";
import { hostedOnboardingError } from "./errors";
import {
  readHostedWebhookReceiptState,
  serializeHostedWebhookReceiptErrorState,
  serializeHostedWebhookReceiptSideEffect,
} from "./webhook-receipt-codec";
import { claimHostedWebhookReceipt } from "./webhook-receipt-transitions";
import type { HostedWebhookReceiptClaim, HostedWebhookReceiptPersistenceClient, HostedWebhookReceiptState } from "./webhook-receipt-types";

const RECEIPT_CLAIM_LEASE_MS = 10 * 60_000;

export type HostedWebhookReceiptWriteResult = { updatedCount: number };

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

export interface HostedWebhookReceiptStoredClaim extends HostedWebhookReceiptClaim {
  claimExpiresAt: Date | null;
  updatedAt: Date | null;
}

export async function claimExistingHostedWebhookReceipt(
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

export async function compareAndSwapHostedWebhookReceiptClaim<
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

export async function readHostedWebhookReceiptClaim(input: {
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

function isHostedWebhookReceiptAutomaticReplayBlocked(
  claim: HostedWebhookReceiptClaim,
): boolean {
  return claim.state.status === "failed" && claim.state.lastError?.retryable === false;
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

function buildHostedWebhookReceiptInProgressError(): Error {
  return hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_IN_PROGRESS",
    message: "Hosted webhook receipt is already being processed.",
    httpStatus: 503,
    retryable: true,
  });
}

export function buildHostedWebhookReceiptClaimError(): Error {
  return hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_CLAIM_FAILED",
    message: "Hosted webhook receipt could not be claimed safely for processing.",
    httpStatus: 503,
    retryable: true,
  });
}

export function buildHostedWebhookReceiptUpdateError(): Error {
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

export function isHostedWebhookReceiptClaimExpired(
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

export function toHostedWebhookReceiptClaim(input: {
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

export function buildHostedWebhookReceiptCreateData(
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

export async function writeHostedWebhookReceiptClaimState(input: {
  currentClaim: HostedWebhookReceiptClaim;
  nextClaim: HostedWebhookReceiptClaim;
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
    return 1;
  });

  return {
    updatedCount,
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
