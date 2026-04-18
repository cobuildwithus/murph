import { Prisma, type PrismaClient } from "@prisma/client";

import {
  completeHostedWebhookReceipt,
  failHostedWebhookReceipt,
  queueHostedWebhookReceiptSideEffects as queueHostedWebhookReceiptStateSideEffects,
} from "./webhook-receipt-transitions";
import type {
  HostedWebhookReceiptClaim,
  HostedWebhookReceiptLocalSideEffect,
  HostedWebhookReceiptPersistenceClient,
  HostedWebhookReceiptState,
} from "./webhook-receipt-types";
import {
  buildHostedWebhookReceiptCreateData,
  buildHostedWebhookReceiptUpdateError,
  claimExistingHostedWebhookReceipt,
  compareAndSwapHostedWebhookReceiptClaim,
  isHostedWebhookReceiptClaimExpired,
  readHostedWebhookReceiptClaim,
  toHostedWebhookReceiptClaim,
  writeHostedWebhookReceiptClaimState,
} from "./webhook-receipt-store-core";
import { claimHostedWebhookReceipt } from "./webhook-receipt-transitions";

const TERMINAL_WEBHOOK_RECEIPT_RETENTION_DAYS = 30;

type HostedWebhookReceiptReplayLookupClient = {
  hostedWebhookReceipt: Pick<PrismaClient["hostedWebhookReceipt"], "findUnique">;
};

type HostedWebhookReceiptReplayLookupRecord = {
  claimExpiresAt: Date | null;
  lastErrorRetryable: boolean | null;
  status: HostedWebhookReceiptState["status"];
  updatedAt: Date;
} | null;

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

export async function isHostedWebhookReceiptReplayBlocked(input: {
  eventId: string;
  prisma: HostedWebhookReceiptReplayLookupClient;
  source: string;
  now?: string;
}): Promise<boolean> {
  const now = new Date(input.now ?? new Date().toISOString());
  const receipt: HostedWebhookReceiptReplayLookupRecord = await input.prisma.hostedWebhookReceipt.findUnique({
    where: {
      source_eventId: {
        eventId: input.eventId,
        source: input.source,
      },
    },
    select: {
      claimExpiresAt: true,
      lastErrorRetryable: true,
      status: true,
      updatedAt: true,
    },
  });

  return isHostedWebhookReceiptReplayBlockedState(receipt, now);
}

export function isHostedWebhookReceiptReplayBlockedState(
  receipt: HostedWebhookReceiptReplayLookupRecord,
  now: Date,
): boolean {
  if (!receipt) {
    return false;
  }

  if (receipt.status === "completed") {
    return true;
  }

  if (receipt.status === "failed") {
    return receipt.lastErrorRetryable === false;
  }

  if (receipt.status !== "processing") {
    return false;
  }

  return !isHostedWebhookReceiptClaimExpired(receipt.claimExpiresAt, receipt.updatedAt, now);
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

export async function pruneHostedWebhookReceiptHistory(input: {
  now?: string;
  prisma: PrismaClient;
}): Promise<number> {
  const now = new Date(input.now ?? new Date().toISOString());
  const cutoff = new Date(
    now.getTime() - (TERMINAL_WEBHOOK_RECEIPT_RETENTION_DAYS * 24 * 60 * 60_000),
  );
  const deleted = await input.prisma.hostedWebhookReceipt.deleteMany({
    where: {
      lastReceivedAt: {
        lt: cutoff,
      },
      OR: [
        {
          status: "completed",
        },
        {
          status: "failed",
          OR: [
            {
              lastErrorRetryable: false,
            },
            {
              lastErrorRetryable: null,
            },
          ],
        },
      ],
    },
  });

  return deleted.count;
}

export async function queueHostedWebhookReceiptSideEffects(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  desiredSideEffects: HostedWebhookReceiptLocalSideEffect[];
  eventId: string;
  prisma: HostedWebhookReceiptPersistenceClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  return updateHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    mutate: (currentState) =>
      queueHostedWebhookReceiptStateSideEffects(currentState, input.desiredSideEffects, {
        plannedAt: new Date().toISOString(),
      }),
    prisma: input.prisma,
    source: input.source,
  });
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
        currentClaim,
        nextClaim,
        prisma: input.prisma,
      }),
  });
}

export { buildHostedWebhookReceiptLeaseWriteData } from "./webhook-receipt-store-core";
