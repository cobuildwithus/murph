import type { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  HOSTED_VAULT_SYNC_PAYLOAD_TERMINAL_STATUSES,
} from "../vault-sync/shared";

const DAY_MS = 86_400_000;

export const HOSTED_RUN_LOG_RETENTION_MS = 14 * DAY_MS;
export const HOSTED_TERMINAL_INGRESS_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_EXPIRED_VAULT_SYNC_SESSION_RETENTION_MS = 7 * DAY_MS;

const HOSTED_STALE_INGRESS_QUARANTINE_CODE = "retention_expired";
const HOSTED_STALE_INGRESS_SKIP_BATCH_SIZE = 500;

const EXPIRABLE_VAULT_SYNC_SESSION_STATUSES = [
  "pending",
  "exchanged",
  "uploaded",
  "queued",
] as const;

export interface HostedRetentionCleanupResult {
  completedVaultSyncPayloadsDeleted: number;
  expiredSharePayloadsDeleted: number;
  expiredVaultSyncPayloadsDeleted: number;
  expiredVaultSyncSessionsDeleted: number;
  expiredVaultSyncSessionsMarked: number;
  oldRunLogsDeleted: number;
  staleIngressEventsDeleted: number;
  staleIngressEventsQuarantined: number;
}

export async function runHostedRetentionCleanup(input: {
  now?: Date | string;
  prisma?: PrismaClient;
} = {}): Promise<HostedRetentionCleanupResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeRetentionDate(input.now ?? new Date());
  const expiredSharePayloadsDeleted = await deleteExpiredSharePayloads({
    now,
    prisma,
  });
  const expiredVaultSyncSessionsMarked = await markExpiredVaultSyncSessions({
    now,
    prisma,
  });
  const expiredVaultSyncPayloadsDeleted = await deleteExpiredVaultSyncPayloads({
    now,
    prisma,
  });
  const completedVaultSyncPayloadsDeleted = await deleteCompletedVaultSyncPayloads({
    prisma,
  });
  const expiredVaultSyncSessionsDeleted = await deleteOldExpiredVaultSyncSessions({
    now,
    prisma,
  });
  const staleIngressEventsQuarantined = await quarantineStalePendingIngressEvents({
    now,
    prisma,
  });
  const staleIngressEventsDeleted = await deleteStaleTerminalIngressEvents({
    now,
    prisma,
  });
  const oldRunLogsDeleted = await deleteOldHostedRunLogs({
    now,
    prisma,
  });

  return {
    completedVaultSyncPayloadsDeleted,
    expiredSharePayloadsDeleted,
    expiredVaultSyncPayloadsDeleted,
    expiredVaultSyncSessionsDeleted,
    expiredVaultSyncSessionsMarked,
    oldRunLogsDeleted,
    staleIngressEventsDeleted,
    staleIngressEventsQuarantined,
  };
}

async function deleteExpiredSharePayloads(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const result = await input.prisma.hostedSharePayload.deleteMany({
    where: {
      OR: [
        {
          share: {
            is: {
              expiresAt: {
                lte: input.now,
              },
            },
          },
        },
        {
          share: {
            is: {
              consumedAt: {
                not: null,
              },
            },
          },
        },
      ],
    },
  });

  return result.count;
}

async function markExpiredVaultSyncSessions(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const result = await input.prisma.hostedVaultSyncSession.updateMany({
    where: {
      expiresAt: {
        lte: input.now,
      },
      status: {
        in: [...EXPIRABLE_VAULT_SYNC_SESSION_STATUSES],
      },
    },
    data: {
      agentTokenHash: null,
      pairingCodeHash: null,
      status: "expired",
    },
  });

  return result.count;
}

async function deleteExpiredVaultSyncPayloads(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const result = await input.prisma.hostedVaultSyncPayload.deleteMany({
    where: {
      session: {
        is: {
          expiresAt: {
            lte: input.now,
          },
        },
      },
    },
  });

  return result.count;
}

async function deleteCompletedVaultSyncPayloads(input: {
  prisma: PrismaClient;
}): Promise<number> {
  const result = await input.prisma.hostedVaultSyncPayload.deleteMany({
    where: {
      session: {
        is: {
          status: {
            in: [...HOSTED_VAULT_SYNC_PAYLOAD_TERMINAL_STATUSES],
          },
        },
      },
    },
  });

  return result.count;
}

async function deleteOldExpiredVaultSyncSessions(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_EXPIRED_VAULT_SYNC_SESSION_RETENTION_MS);
  const result = await input.prisma.hostedVaultSyncSession.deleteMany({
    where: {
      status: {
        in: ["expired", "revoked"],
      },
      updatedAt: {
        lt: cutoff,
      },
    },
  });

  return result.count;
}

async function deleteStaleTerminalIngressEvents(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_TERMINAL_INGRESS_RETENTION_MS);
  const result = await input.prisma.hostedIngressEvent.deleteMany({
    where: {
      OR: [
        {
          completedAt: {
            lt: cutoff,
          },
        },
        {
          quarantinedAt: {
            lt: cutoff,
          },
        },
      ],
    },
  });

  return result.count;
}

async function quarantineStalePendingIngressEvents(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_TERMINAL_INGRESS_RETENTION_MS);
  const users = await input.prisma.hostedIngressEvent.groupBy({
    by: ["userId"],
    where: {
      completedAt: null,
      createdAt: {
        lt: cutoff,
      },
      quarantinedAt: null,
      runId: null,
      state: "pending",
      OR: [
        {
          payloadBytes: {
            not: null,
          },
        },
        {
          payloadInlineCiphertext: {
            not: null,
          },
        },
        {
          payloadRef: {
            not: null,
          },
        },
      ],
    },
  });

  let count = 0;
  for (const user of users) {
    count += await quarantineStalePendingIngressEventsForUser({
      cutoff,
      now: input.now,
      prisma: input.prisma,
      userId: user.userId,
    });
  }

  return count;
}

async function quarantineStalePendingIngressEventsForUser(input: {
  cutoff: Date;
  now: Date;
  prisma: PrismaClient;
  userId: string;
}): Promise<number> {
  try {
    return await input.prisma.$transaction(async (tx) => {
      await lockHostedExecutionCursorForRetentionTx({
        tx,
        userId: input.userId,
      });
      const cursor = await tx.hostedExecutionCursor.findUnique({
        where: {
          userId: input.userId,
        },
        select: {
          committedSeq: true,
          version: true,
        },
      });
      if (!cursor) {
        return 0;
      }

      const rows = await tx.hostedIngressEvent.findMany({
        where: {
          completedAt: null,
          quarantinedAt: null,
          runId: null,
          seq: {
            gt: cursor.committedSeq,
          },
          state: "pending",
          userId: input.userId,
        },
        orderBy: {
          seq: "asc",
        },
        select: {
          createdAt: true,
          id: true,
          payloadRef: true,
          seq: true,
        },
        take: HOSTED_STALE_INGRESS_SKIP_BATCH_SIZE,
      });

      const stalePrefix: typeof rows = [];
      let expectedSeq = cursor.committedSeq + 1n;
      for (const row of rows) {
        if (row.seq !== expectedSeq || row.createdAt >= input.cutoff) {
          break;
        }
        stalePrefix.push(row);
        expectedSeq += 1n;
      }
      if (stalePrefix.length === 0) {
        return 0;
      }

      const payloadRefs = stalePrefix.flatMap((row) => row.payloadRef ? [row.payloadRef] : []);
      if (payloadRefs.length > 0) {
        await tx.hostedIngressPayload.deleteMany({
          where: {
            ingressEventId: {
              in: payloadRefs,
            },
            userId: input.userId,
          },
        });
      }

      const ids = stalePrefix.map((row) => row.id);
      const updated = await tx.hostedIngressEvent.updateMany({
        where: {
          completedAt: null,
          createdAt: {
            lt: input.cutoff,
          },
          id: {
            in: ids,
          },
          quarantinedAt: null,
          runId: null,
          state: "pending",
          userId: input.userId,
        },
        data: {
          completedAt: input.now,
          payloadBytes: null,
          payloadInlineCiphertext: null,
          payloadRef: null,
          quarantineCode: HOSTED_STALE_INGRESS_QUARANTINE_CODE,
          quarantinedAt: input.now,
          state: "quarantined",
        },
      });
      if (updated.count !== stalePrefix.length) {
        throw new HostedRetentionCleanupRaceError();
      }

      const cursorUpdated = await tx.hostedExecutionCursor.updateMany({
        where: {
          committedSeq: cursor.committedSeq,
          userId: input.userId,
          version: cursor.version,
        },
        data: {
          committedSeq: stalePrefix[stalePrefix.length - 1]!.seq,
          version: {
            increment: 1,
          },
        },
      });
      if (cursorUpdated.count !== 1) {
        throw new HostedRetentionCleanupRaceError();
      }

      return stalePrefix.length;
    });
  } catch (error) {
    if (error instanceof HostedRetentionCleanupRaceError) {
      return 0;
    }
    throw error;
  }
}

async function lockHostedExecutionCursorForRetentionTx(input: {
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  await input.tx.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id
    FROM hosted_execution_cursor
    WHERE user_id = ${input.userId}
    FOR UPDATE
  `;
}

async function deleteOldHostedRunLogs(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_RUN_LOG_RETENTION_MS);
  const result = await input.prisma.hostedRunLog.deleteMany({
    where: {
      at: {
        lt: cutoff,
      },
    },
  });

  return result.count;
}

function normalizeRetentionDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Hosted retention cleanup date must be valid.");
  }

  return date;
}

class HostedRetentionCleanupRaceError extends Error {}
