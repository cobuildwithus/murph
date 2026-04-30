import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";

const DAY_MS = 86_400_000;

export const HOSTED_RUN_LOG_RETENTION_MS = 14 * DAY_MS;
export const HOSTED_MAILBOX_RETENTION_MS = 30 * DAY_MS;

export interface HostedRetentionCleanupResult {
  expiredMailboxItemsDeleted: number;
  oldRuntimeLogsDeleted: number;
}

export async function runHostedRetentionCleanup(input: {
  now?: Date | string;
  prisma?: PrismaClient;
} = {}): Promise<HostedRetentionCleanupResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeRetentionDate(input.now ?? new Date());
  const expiredMailboxItemsDeleted = await deleteExpiredMailboxItems({
    now,
    prisma,
  });
  const oldRuntimeLogsDeleted = await deleteOldHostedRuntimeLogs({
    now,
    prisma,
  });

  return {
    expiredMailboxItemsDeleted,
    oldRuntimeLogsDeleted,
  };
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
