import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";

const DAY_MS = 86_400_000;

export const HOSTED_RUN_LOG_RETENTION_MS = 14 * DAY_MS;
export const HOSTED_MAILBOX_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_WEB_SESSION_RETENTION_MS = 30 * DAY_MS;

export interface HostedRetentionCleanupResult {
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

  return {
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
  await tombstoneExpiredUnconsumedConversationMailboxPayloads({
    cutoff,
    now: input.now,
    prisma: input.prisma,
  });
  return await input.prisma.$executeRaw`
    DELETE FROM "hosted_mailbox_item" AS hmi
    WHERE (
      hmi."expires_at" <= ${input.now}
      OR hmi."created_at" < ${cutoff}
    )
    AND (
      hmi."lane" <> 'conversation'
      OR hmi."lane_seq" <= COALESCE((
        SELECT counter."consumed_seq"
        FROM "hosted_mailbox_lane_counter" AS counter
        WHERE counter."user_id" = hmi."user_id"
          AND counter."lane" = hmi."lane"
      ), 0)
    )
  `;
}

async function tombstoneExpiredUnconsumedConversationMailboxPayloads(input: {
  cutoff: Date;
  now: Date;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.$executeRaw`
    WITH tombstoned AS (
      UPDATE "hosted_mailbox_item" AS hmi
      SET "payload_inline_ciphertext" = NULL,
          "payload_ref" = NULL,
          "updated_at" = ${input.now}
      WHERE (
        hmi."expires_at" <= ${input.now}
        OR hmi."created_at" < ${input.cutoff}
      )
      AND hmi."lane" = 'conversation'
      AND hmi."lane_seq" > COALESCE((
        SELECT counter."consumed_seq"
        FROM "hosted_mailbox_lane_counter" AS counter
        WHERE counter."user_id" = hmi."user_id"
          AND counter."lane" = hmi."lane"
      ), 0)
      AND (
        hmi."payload_inline_ciphertext" IS NOT NULL
        OR hmi."payload_ref" IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM "hosted_mailbox_payload" AS hmp
          WHERE hmp."mailbox_item_id" = hmi."id"
            AND hmp."user_id" = hmi."user_id"
        )
      )
      RETURNING hmi."id", hmi."user_id"
    )
    DELETE FROM "hosted_mailbox_payload" AS hmp
    USING tombstoned
    WHERE hmp."mailbox_item_id" = tombstoned."id"
      AND hmp."user_id" = tombstoned."user_id"
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
