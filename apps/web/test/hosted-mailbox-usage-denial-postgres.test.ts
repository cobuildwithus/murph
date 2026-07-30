import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  tryMarkHostedMailboxConversationAiUsageDenied,
} from "@/src/lib/hosted-mailbox/store";
import {
  readHostedRuntimeLatencyHealth,
} from "@/src/lib/hosted-runtime-latency/alert-monitor";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The mailbox usage-denial proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted mailbox usage-denial snapshot",
  () => {
    it("marks only the observed sequence window with valid database chronology", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw(Prisma.sql`
            CREATE TEMP TABLE hosted_mailbox_item (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              lane TEXT NOT NULL,
              lane_seq BIGINT NOT NULL,
              consumed_at TIMESTAMP(3),
              ai_usage_denied_at TIMESTAMP(3),
              created_at TIMESTAMP(3) NOT NULL
            ) ON COMMIT DROP
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE TEMP TABLE hosted_linq_delivery (
              id TEXT PRIMARY KEY,
              accepted_at TIMESTAMP(3) NOT NULL
            ) ON COMMIT DROP
          `);
          await tx.$executeRaw(Prisma.sql`
            CREATE TEMP TABLE hosted_ingress_latency_trace (
              user_id TEXT NOT NULL,
              mailbox_item_id TEXT NOT NULL,
              source TEXT NOT NULL,
              accepted_at TIMESTAMP(3) NOT NULL,
              assistant_input_staged_at TIMESTAMP(3),
              provider_start_at TIMESTAMP(3),
              phase_breakdown_json JSONB,
              provider_request_ordinal INTEGER,
              runtime_attempt_id TEXT,
              linq_delivery_id TEXT
            ) ON COMMIT DROP
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_mailbox_item (
              id,
              user_id,
              lane,
              lane_seq,
              created_at
            )
            VALUES (
              'mailbox-observed',
              'member-mailbox-window',
              'conversation',
              1,
              statement_timestamp() AT TIME ZONE 'UTC'
            )
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_ingress_latency_trace (
              user_id,
              mailbox_item_id,
              source,
              accepted_at
            )
            VALUES (
              'member-mailbox-window',
              'mailbox-observed',
              'linq',
              statement_timestamp() AT TIME ZONE 'UTC' - INTERVAL '10 minutes'
            )
          `);
          const snapshot = await tx.$queryRaw<Array<{ maxSeq: bigint }>>(
            Prisma.sql`
              SELECT MAX(lane_seq) AS "maxSeq"
              FROM hosted_mailbox_item
              WHERE user_id = 'member-mailbox-window'
                AND lane = 'conversation'
            `,
          );
          expect(snapshot[0]?.maxSeq).toBe(1n);

          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_mailbox_item (
              id,
              user_id,
              lane,
              lane_seq,
              created_at
            )
            VALUES (
              'mailbox-after-snapshot',
              'member-mailbox-window',
              'conversation',
              2,
              statement_timestamp() AT TIME ZONE 'UTC'
            )
          `);

          await expect(tryMarkHostedMailboxConversationAiUsageDenied({
            afterConversationLaneSeq: 0n,
            prisma: tx,
            throughConversationLaneSeq: 1n,
            userId: "member-mailbox-window",
          })).resolves.toBe(true);

          const firstPass = await readRows(tx);
          expect(firstPass[0]?.aiUsageDeniedAt?.getTime()).toBeGreaterThanOrEqual(
            firstPass[0]?.createdAt.getTime() ?? Number.POSITIVE_INFINITY,
          );
          expect(firstPass[1]?.aiUsageDeniedAt).toBeNull();
          const deniedAt = requireDate(firstPass[0]?.aiUsageDeniedAt);
          const monitorNow = deniedAt;
          const historicalAcceptedAt = new Date(
            monitorNow.getTime() - 24 * 60 * 60_000 - 1,
          );
          const historicalDeniedAt = new Date(
            historicalAcceptedAt.getTime() + 1,
          );
          const resumedAt = new Date(monitorNow.getTime() - 5 * 60_000);

          await tx.$executeRaw(Prisma.sql`
            UPDATE hosted_ingress_latency_trace
            SET accepted_at = ${historicalAcceptedAt}
            WHERE mailbox_item_id = 'mailbox-observed'
          `);
          await tx.$executeRaw(Prisma.sql`
            UPDATE hosted_mailbox_item
            SET ai_usage_denied_at = ${historicalDeniedAt}
            WHERE id = 'mailbox-observed'
          `);
          await expect(readHostedRuntimeLatencyHealth({
            now: monitorNow,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: false,
            unresolvedReplyCount: 0,
          });

          await tx.$executeRaw(Prisma.sql`
            UPDATE hosted_ingress_latency_trace
            SET assistant_input_staged_at = ${resumedAt}
            WHERE mailbox_item_id = 'mailbox-observed'
          `);
          await expect(readHostedRuntimeLatencyHealth({
            now: monitorNow,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: true,
            oldestUnresolvedAgeMs: 5 * 60_000,
            unresolvedReplyCount: 1,
          });

          const progressAt = new Date(resumedAt.getTime() + 29_999);
          await tx.$executeRaw(Prisma.sql`
            UPDATE hosted_ingress_latency_trace
            SET phase_breakdown_json = ${JSON.stringify({
              assistant: {
                progressUpdateAcceptedAtEpochMs: progressAt.getTime(),
              },
              schemaVersion: 1,
            })}::jsonb
            WHERE mailbox_item_id = 'mailbox-observed'
          `);
          await expect(readHostedRuntimeLatencyHealth({
            now: monitorNow,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: false,
            recentSlowInitialResponseCount: 0,
            unresolvedReplyCount: 0,
          });

          const deliveryAt = new Date(resumedAt.getTime() + 40_000);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_linq_delivery (id, accepted_at)
            VALUES ('delivery-after-resume', ${deliveryAt})
          `);
          await tx.$executeRaw(Prisma.sql`
            UPDATE hosted_ingress_latency_trace
            SET
              linq_delivery_id = 'delivery-after-resume',
              phase_breakdown_json = NULL
            WHERE mailbox_item_id = 'mailbox-observed'
          `);
          await tx.$executeRaw(Prisma.sql`
            UPDATE hosted_mailbox_item
            SET consumed_at = ${deliveryAt}
            WHERE id = 'mailbox-observed'
          `);
          await expect(readHostedRuntimeLatencyHealth({
            now: monitorNow,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: true,
            maxFirstVisibleResponseLatencyMs: 40_000,
            recentCompletedReplyCount: 1,
            recentSlowInitialResponseCount: 1,
          });

          const recentAcceptedAt = new Date(monitorNow.getTime() - 2 * 60_000);
          const stagedBeforeDenialAt = new Date(
            recentAcceptedAt.getTime() + 1_000,
          );
          const denialAfterStagingAt = new Date(
            stagedBeforeDenialAt.getTime() + 1_000,
          );
          await tx.$executeRaw(Prisma.sql`
            DELETE FROM hosted_linq_delivery
            WHERE id = 'delivery-after-resume'
          `);
          await tx.$executeRaw(Prisma.sql`
            UPDATE hosted_ingress_latency_trace
            SET
              accepted_at = ${recentAcceptedAt},
              assistant_input_staged_at = ${stagedBeforeDenialAt},
              linq_delivery_id = NULL
            WHERE mailbox_item_id = 'mailbox-observed'
          `);
          await tx.$executeRaw(Prisma.sql`
            UPDATE hosted_mailbox_item
            SET
              ai_usage_denied_at = ${denialAfterStagingAt},
              consumed_at = NULL
            WHERE id = 'mailbox-observed'
          `);
          await expect(readHostedRuntimeLatencyHealth({
            now: monitorNow,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: true,
            oldestUnresolvedAgeMs: 2 * 60_000,
            unresolvedReplyCount: 1,
          });

          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_mailbox_item (
              id,
              user_id,
              lane,
              lane_seq,
              ai_usage_denied_at,
              created_at
            )
            SELECT
              'cap-mailbox-' || ordinal,
              'cap-member-' || ordinal,
              'conversation',
              ordinal,
              ${historicalDeniedAt},
              ${historicalAcceptedAt}
            FROM generate_series(1, 20000) AS ordinal
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_ingress_latency_trace (
              user_id,
              mailbox_item_id,
              source,
              accepted_at,
              assistant_input_staged_at
            )
            SELECT
              'cap-member-' || ordinal,
              'cap-mailbox-' || ordinal,
              'linq',
              ${historicalAcceptedAt},
              ${new Date(monitorNow.getTime() - 60_000)}
            FROM generate_series(1, 20000) AS ordinal
          `);
          await expect(readHostedRuntimeLatencyHealth({
            now: monitorNow,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: true,
            scanTruncated: true,
          });

          await expect(tryMarkHostedMailboxConversationAiUsageDenied({
            afterConversationLaneSeq: 1n,
            prisma: tx,
            throughConversationLaneSeq: 2n,
            userId: "member-mailbox-window",
          })).resolves.toBe(true);

          const secondPass = await readRows(tx);
          expect(secondPass[1]?.aiUsageDeniedAt?.getTime()).toBeGreaterThanOrEqual(
            secondPass[1]?.createdAt.getTime() ?? Number.POSITIVE_INFINITY,
          );
        });
      } finally {
        await prisma.$disconnect();
      }
    });
  },
);

function readRows(prisma: PrismaClient | Prisma.TransactionClient) {
  return prisma.$queryRaw<Array<{
    aiUsageDeniedAt: Date | null;
    createdAt: Date;
  }>>(Prisma.sql`
    SELECT
      ai_usage_denied_at AS "aiUsageDeniedAt",
      created_at AS "createdAt"
    FROM hosted_mailbox_item
    WHERE user_id = 'member-mailbox-window'
    ORDER BY lane_seq ASC
  `);
}

function requireDate(value: Date | null | undefined): Date {
  if (!(value instanceof Date)) {
    throw new TypeError("Expected a PostgreSQL timestamp.");
  }
  return value;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
