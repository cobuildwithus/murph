import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { readHostedMailboxProgress } from "@/src/lib/hosted-mailbox/projection";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.search || url.hash) throw new Error("Mailbox progress proof requires local PostgreSQL.");
}

describe.skipIf(!enabled)("Postgres mailbox progress", () => {
  it("reads both lanes in one payload-free statement with exact retention and consumed floors", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }) });
    const now = new Date("2030-04-30T12:00:00Z");
    try {
      await prisma.$transaction(async tx => {
        // No payload columns: selecting payloads here would fail this proof.
        await tx.$executeRaw`CREATE TEMP TABLE hosted_mailbox_item (
          user_id text, lane text, lane_seq bigint, created_at timestamp,
          updated_at timestamp, expires_at timestamp
        ) ON COMMIT DROP`;
        await tx.$executeRaw`CREATE TEMP TABLE hosted_mailbox_lane_counter (
          user_id text, lane text, consumed_seq bigint
        ) ON COMMIT DROP`;
        await tx.$executeRaw`INSERT INTO hosted_mailbox_lane_counter VALUES
          ('synthetic', 'conversation', 2), ('synthetic', 'system', 9007199254740993),
          ('empty', 'conversation', 9)`;
        await tx.$executeRaw`INSERT INTO hosted_mailbox_item VALUES
          ('synthetic', 'conversation', 1, '2030-04-16 12:00:00', '2030-04-30 12:00:00', NULL),
          ('synthetic', 'conversation', 3, '2030-04-30 11:00:00', '2030-04-30 11:00:00', '2030-04-30 12:00:00'),
          ('synthetic', 'conversation', 5, '2030-04-16 12:00:00.001', '2030-04-30 10:00:00', NULL),
          ('synthetic', 'conversation', 8, '2030-04-30 11:00:00', '2030-04-30 11:00:00', '2030-04-30 12:00:00.001'),
          ('synthetic', 'conversation', 10, '2030-04-30 11:00:00', '2030-04-30 11:00:00', '2030-04-30 12:00:00'),
          ('synthetic', 'system', 9007199254740992, '2030-04-30 11:00:00', '2030-04-30 11:00:00', NULL),
          ('synthetic', 'system', 9007199254740994, '2030-04-30 11:00:00', '2030-04-30 11:00:00', NULL),
          ('other', 'conversation', 999, '2030-04-30 11:00:00', '2030-04-30 11:00:00', NULL)`;
        const query = vi.spyOn(tx, "$queryRaw");
        try {
          const result = await readHostedMailboxProgress({ prisma: tx, userId: "synthetic", now });
          expect(query).toHaveBeenCalledTimes(1);
          expect(result).toEqual({
            consumedSeqByLane: [
              { lane: "system", consumedSeq: "9007199254740993" },
              { lane: "conversation", consumedSeq: "4" },
            ],
            maxSeqByLane: [
              { lane: "system", maxSeq: "9007199254740994", maxUpdatedAt: "2030-04-30T11:00:00.000Z" },
              { lane: "conversation", maxSeq: "8", maxUpdatedAt: "2030-04-30T11:00:00.000Z" },
            ],
          });
          query.mockClear();
          expect(await readHostedMailboxProgress({ prisma: tx, userId: "empty", now })).toEqual({
            consumedSeqByLane: [{ lane: "system", consumedSeq: "0" }, { lane: "conversation", consumedSeq: "9" }],
            maxSeqByLane: [
              { lane: "system", maxSeq: "0", maxUpdatedAt: null },
              { lane: "conversation", maxSeq: "0", maxUpdatedAt: null },
            ],
          });
          expect(query).toHaveBeenCalledTimes(1);
        } finally { query.mockRestore(); }
      });
    } finally { await prisma.$disconnect(); }
  });
});
