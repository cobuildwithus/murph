import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";

const DAY_MS = 86_400_000;

export const HOSTED_RUN_LOG_RETENTION_MS = 14 * DAY_MS;
export const HOSTED_MAILBOX_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_WEB_SESSION_RETENTION_MS = 30 * DAY_MS;

export interface HostedRetentionCleanupResult {
  expiredComputerRunsCleanedUp: number;
  expiredMailboxItemsDeleted: number;
  oldRuntimeLogsDeleted: number;
  staleWebSessionsDeleted: number;
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
  const staleWebSessionsDeleted = await deleteStaleHostedWebSessions({
    now,
    prisma,
  });
  const expiredComputerRunsCleanedUp = await new ComputerUseService({
    now: () => now,
    store: new PrismaComputerUseStore(prisma),
  }).cleanupExpiredRuns({ now }).then((result) => result.expiredRuns);

  return {
    expiredComputerRunsCleanedUp,
    expiredMailboxItemsDeleted,
    oldRuntimeLogsDeleted,
    staleWebSessionsDeleted,
  };
}

async function deleteExpiredMailboxItems(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  return await input.prisma.$executeRaw`
    DELETE FROM "hosted_mailbox_item"
    WHERE "expires_at" <= ${input.now}
       OR "created_at" < ${cutoff}
  `;
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

async function deleteStaleHostedWebSessions(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_WEB_SESSION_RETENTION_MS);
  const result = await input.prisma.hostedWebSession.deleteMany({
    where: {
      OR: [
        {
          expiresAt: {
            lt: cutoff,
          },
        },
        {
          revokedAt: {
            lt: cutoff,
          },
        },
      ],
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
