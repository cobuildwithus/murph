import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  tryMarkHostedMailboxConversationAiUsageDenied,
} from "@/src/lib/hosted-mailbox/store";
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
    ORDER BY lane_seq ASC
  `);
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
