import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  retireExpiredMailboxContent,
} from "@/src/lib/hosted-retention/cleanup";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The production 500 regression proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted production 500 regressions",
  () => {
    let prisma: PrismaClient | null = null;

    beforeAll(() => {
      prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("deletes an expired legacy row below the consumed floor without updating it", async () => {
      const client = requirePrisma(prisma);
      const cleanupAt = new Date("2026-07-28T12:00:00.000Z");
      const createdAt = new Date("2026-07-13T12:00:00.000Z");

      await client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          CREATE TEMP TABLE "hosted_mailbox_item" (
            "id" TEXT PRIMARY KEY,
            "user_id" TEXT NOT NULL,
            "causal_seq" BIGINT,
            "lane" TEXT NOT NULL,
            "lane_seq" BIGINT NOT NULL,
            "kind" TEXT NOT NULL,
            "payload_inline_ciphertext" TEXT,
            "payload_ref" TEXT,
            "payload_bytes" INTEGER,
            "payload_hash" TEXT,
            "consumed_at" TIMESTAMP(3),
            "expires_at" TIMESTAMP(3),
            "content_retired_at" TIMESTAMP(3),
            "retention_disposition" TEXT,
            "created_at" TIMESTAMP(3) NOT NULL,
            "updated_at" TIMESTAMP(3) NOT NULL
          ) ON COMMIT DROP
        `);
        await tx.$executeRawUnsafe(`
          CREATE TEMP TABLE "hosted_mailbox_payload" (
            "mailbox_item_id" TEXT PRIMARY KEY
              REFERENCES "hosted_mailbox_item" ("id") ON DELETE CASCADE,
            "payload_ciphertext" TEXT NOT NULL
          ) ON COMMIT DROP
        `);
        await tx.$executeRawUnsafe(`
          CREATE TEMP TABLE "hosted_mailbox_lane_counter" (
            "user_id" TEXT NOT NULL,
            "lane" TEXT NOT NULL,
            "next_seq" BIGINT NOT NULL,
            "consumed_seq" BIGINT NOT NULL,
            "updated_at" TIMESTAMP(3) NOT NULL,
            PRIMARY KEY ("user_id", "lane")
          ) ON COMMIT DROP
        `);

        await tx.$executeRaw`
          INSERT INTO "hosted_mailbox_lane_counter" (
            "user_id",
            "lane",
            "next_seq",
            "consumed_seq",
            "updated_at"
          )
          VALUES ('member_retention', 'system', 3, 1, ${createdAt})
        `;
        await tx.$executeRaw`
          INSERT INTO "hosted_mailbox_item" (
            "id",
            "user_id",
            "causal_seq",
            "lane",
            "lane_seq",
            "kind",
            "payload_inline_ciphertext",
            "payload_ref",
            "payload_bytes",
            "payload_hash",
            "consumed_at",
            "expires_at",
            "content_retired_at",
            "retention_disposition",
            "created_at",
            "updated_at"
          )
          VALUES
            (
              'legacy_preference',
              'member_retention',
              NULL,
              'system',
              1,
              'member.preferences.updated',
              NULL,
              'legacy-sidecar',
              24,
              'legacy-hash',
              NULL,
              ${createdAt},
              NULL,
              NULL,
              ${createdAt},
              ${createdAt}
            ),
            (
              'current_preference',
              'member_retention',
              2,
              'system',
              2,
              'member.preferences.updated',
              'current-ciphertext',
              NULL,
              18,
              'current-hash',
              NULL,
              ${createdAt},
              NULL,
              NULL,
              ${createdAt},
              ${createdAt}
            )
        `;
        await tx.$executeRaw`
          INSERT INTO "hosted_mailbox_payload" (
            "mailbox_item_id",
            "payload_ciphertext"
          )
          VALUES ('legacy_preference', 'legacy-ciphertext')
        `;
        await tx.$executeRawUnsafe(`
          ALTER TABLE "hosted_mailbox_item"
          ADD CONSTRAINT "hosted_mailbox_item_preferences_causal_seq_check"
          CHECK (
            "kind" <> 'member.preferences.updated'
            OR "causal_seq" IS NOT NULL
          ) NOT VALID
        `);

        await expect(retireExpiredMailboxContent({
          now: cleanupAt,
          prisma: tx,
        })).resolves.toEqual({
          policyNonReplies: 0,
          retired: 2,
          tombstonesDeleted: 0,
        });
        const retained = await tx.$queryRaw<Array<{
          contentRetiredAt: Date | null;
          id: string;
          payloadBytes: number | null;
          payloadHash: string | null;
          payloadInlineCiphertext: string | null;
        }>>`
          SELECT
            "id",
            "content_retired_at" AS "contentRetiredAt",
            "payload_inline_ciphertext" AS "payloadInlineCiphertext",
            "payload_bytes" AS "payloadBytes",
            "payload_hash" AS "payloadHash"
          FROM "hosted_mailbox_item"
          ORDER BY "id"
        `;
        expect(retained).toEqual([{
          contentRetiredAt: cleanupAt,
          id: "current_preference",
          payloadBytes: null,
          payloadHash: null,
          payloadInlineCiphertext: null,
        }]);
        const payloads = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS "count"
          FROM "hosted_mailbox_payload"
        `;
        expect(payloads).toEqual([{ count: 0n }]);
      });
    });
  },
);

function requirePrisma(prisma: PrismaClient | null): PrismaClient {
  if (!prisma) {
    throw new Error("PostgreSQL test client was not initialized.");
  }
  return prisma;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
