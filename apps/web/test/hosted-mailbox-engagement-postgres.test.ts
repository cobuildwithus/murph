import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { hasHostedMailboxAutomationEngagementSince } from "@/src/lib/hosted-mailbox/store";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("Mailbox engagement proof requires local PostgreSQL.");
  }
}

describe.skipIf(!runPostgresProof)("hosted mailbox automation engagement", () => {
  it("counts accepted Telegram activity without treating other mailbox work as engagement", async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, max: 1 },
        { schema: "pg_temp" },
      ),
    });
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          CREATE TEMP TABLE hosted_mailbox_item (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            lane TEXT NOT NULL,
            dedupe_key TEXT NOT NULL,
            created_at TIMESTAMP(3) NOT NULL,
            consumed_at TIMESTAMP(3),
            content_retired_at TIMESTAMP(3)
          ) ON COMMIT DROP
        `);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO hosted_mailbox_item
            (id, user_id, kind, lane, dedupe_key, created_at, consumed_at, content_retired_at)
          VALUES
            ('recent', 'member-telegram', 'conversation.message', 'conversation',
             'telegram:update:101', '2030-04-29 12:00:00', '2030-04-29 12:01:00', NULL),
            ('boundary', 'member-boundary', 'conversation.message', 'conversation',
             'telegram:update:102', '2030-04-02 12:00:00', '2030-04-02 12:01:00', '2030-04-20 12:00:00'),
            ('old', 'member-old', 'conversation.message', 'conversation',
             'telegram:update:103', '2030-04-02 11:59:59.999', NULL, NULL),
            ('email', 'member-email', 'conversation.message', 'conversation',
             'email:104', '2030-04-29 12:00:00', NULL, NULL),
            ('system', 'member-system', 'runtime.maintenance-requested', 'system',
             'telegram:update:105', '2030-04-29 12:00:00', NULL, NULL),
            ('wrong-lane', 'member-wrong-lane', 'conversation.message', 'system',
             'telegram:update:106', '2030-04-29 12:00:00', NULL, NULL),
            ('capture', 'member-capture', 'meal-photo.captured', 'system',
             'meal-photo:107', '2030-04-29 12:00:00', NULL, NULL)
        `);
        for (const [userId, expected] of [
          ["member-telegram", true],
          ["member-boundary", true],
          ["member-old", false],
          ["member-email", false],
          ["member-system", false],
          ["member-wrong-lane", false],
          ["member-capture", true],
          ["member-unrelated", false],
        ] as const) {
          await expect(hasHostedMailboxAutomationEngagementSince({
            prisma: tx,
            since: new Date("2030-04-02T12:00:00.000Z"),
            userId,
          }), userId).resolves.toBe(expected);
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
