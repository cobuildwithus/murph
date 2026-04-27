import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  HOSTED_VAULT_SYNC_PAYLOAD_TERMINAL_STATUSES,
} from "../vault-sync/shared";

const DAY_MS = 86_400_000;

export const HOSTED_RUN_LOG_RETENTION_MS = 14 * DAY_MS;
export const HOSTED_MAILBOX_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_EXPIRED_VAULT_SYNC_SESSION_RETENTION_MS = 7 * DAY_MS;

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
  expiredMailboxItemsDeleted: number;
  oldRuntimeLogsDeleted: number;
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
  const expiredMailboxItemsDeleted = await deleteExpiredMailboxItems({
    now,
    prisma,
  });
  const oldRuntimeLogsDeleted = await deleteOldHostedRuntimeLogs({
    now,
    prisma,
  });

  return {
    completedVaultSyncPayloadsDeleted,
    expiredSharePayloadsDeleted,
    expiredVaultSyncPayloadsDeleted,
    expiredVaultSyncSessionsDeleted,
    expiredVaultSyncSessionsMarked,
    expiredMailboxItemsDeleted,
    oldRuntimeLogsDeleted,
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

async function deleteExpiredMailboxItems(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  const result = await input.prisma.hostedMailboxItem.deleteMany({
    where: {
      OR: [
        {
          expiresAt: {
            lte: input.now,
          },
        },
        {
          createdAt: {
            lt: cutoff,
          },
        },
      ],
    },
  });

  return result.count;
}

async function deleteOldHostedRuntimeLogs(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_RUN_LOG_RETENTION_MS);
  const result = await input.prisma.hostedRuntimeLog.deleteMany({
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
