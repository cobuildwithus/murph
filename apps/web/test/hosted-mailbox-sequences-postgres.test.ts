import { randomUUID } from "node:crypto";
import { buildHostedExecutionTelegramConversationMessageWake } from "@murphai/hosted-execution";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireHostedMailboxCausalAppendLockTx,
  appendHostedMailboxEnvelopeTx,
  appendHostedMailboxEnvelopeWithIdentityTx,
  appendPreparedHostedMailboxEnvelopeTx,
  prepareHostedMailboxEnvelopeAppend,
  readHostedMailboxMaxSeqByLane,
} from "@/src/lib/hosted-mailbox/store";
import { createPrismaClient } from "@/src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)
    || url.search || url.hash) throw new Error("Mailbox sequence proof requires local test PostgreSQL.");
}
const options = { maxWait: 5_000, timeout: 15_000 };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!enabled)("Postgres mailbox sequence allocation", () => {
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
  const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
  let userId: string;
  beforeEach(async () => {
    userId = `hbm_mailbox_sequence_${randomUUID()}`;
    await observer.hostedMember.create({ data: { id: userId } });
    await observer.hostedWorkspace.create({ data: { userId } });
  });
  afterEach(async () => {
    await observer.hostedMember.delete({ where: { id: userId } });
    await Promise.all([owner, contender, observer].map(db => db.$disconnect()));
  });

  function envelope(eventId: string) {
    return buildHostedExecutionTelegramConversationMessageWake({
      eventId, userId, occurredAt: new Date().toISOString(),
      telegramMessage: {
        messageId: eventId, schema: "murph.hosted-telegram-message.v1",
        text: "synthetic sequence proof", threadId: "123", threadIsDirect: true,
      },
    });
  }
  async function appender(mode: "envelope" | "prepared", eventId: string) {
    const wake = envelope(eventId);
    const prepared = mode === "prepared"
      ? await prepareHostedMailboxEnvelopeAppend({ envelope: wake, prisma: observer }) : null;
    return async (tx: Prisma.TransactionClient) => {
      if (prepared) {
        const result = await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
        return tx.hostedMailboxItem.findUniqueOrThrow({
          where: { id: result.mailboxItemId }, select: { causalSeq: true, laneSeq: true },
        });
      }
      const { item } = await appendHostedMailboxEnvelopeTx({ envelope: wake, tx });
      return { causalSeq: BigInt(item.causalSeq!), laneSeq: BigInt(item.laneSeq) };
    };
  }
  async function waitForLock(pid: number, locktype: "advisory" | "transactionid") {
    await vi.waitFor(async () => {
      const locks = await observer.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_locks
          WHERE pid = ${pid} AND locktype = ${locktype} AND NOT granted) AS waiting
      `;
      expect(locks[0]?.waiting).toBe(true);
    }, { timeout: 5_000, interval: 10 });
  }
  async function counters() {
    return observer.hostedMailboxLaneCounter.findMany({
      where: { userId }, orderBy: { lane: "asc" }, select: { lane: true, nextSeq: true },
    });
  }
  async function seed() {
    await observer.hostedMailboxLaneCounter.createMany({ data: [
      { userId, lane: "causal", nextSeq: 40n },
      { userId, lane: "conversation", nextSeq: 8n },
    ] });
  }

  describe.each(["envelope", "prepared"] as const)("%s append", mode => {
    it.each([true, false])("waits before touching counters (seeded=%s) and allocates in commit order", async seeded => {
      if (seeded) await seed();
      const first = await appender(mode, "first");
      const second = await appender(mode, "second");
      const locked = deferred(), release = deferred(), pid = deferred<number>();
      const a = owner.$transaction(async tx => {
        await acquireHostedMailboxCausalAppendLockTx({ tx, userId });
        locked.resolve();
        await release.promise;
        return first(tx);
      }, options);
      let b: Promise<unknown> | undefined;
      try {
        await locked.promise;
        const pending = contender.$transaction(async tx => {
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          pid.resolve(backend!.pid);
          return second(tx);
        }, options);
        b = pending;
        await waitForLock(await pid.promise, "advisory");
        if (seeded) {
          // An unchanged read cannot detect uncommitted writes. NOWAIT can.
          await observer.$transaction(async tx => {
            const rows = await tx.$queryRaw<Array<{ lane: string }>>`
              SELECT lane FROM hosted_mailbox_lane_counter WHERE user_id = ${userId}
                AND lane IN ('causal', 'conversation') FOR UPDATE NOWAIT
            `;
            expect(rows.map(row => row.lane).sort()).toEqual(["causal", "conversation"]);
          }, options);
        } else {
          // Unique-key insertion waits on even invisible, uncommitted inserts.
          // Roll this probe back so A and B must still create absent counters.
          const rollback = new Error("rollback absence probe");
          await expect(observer.$transaction(async tx => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
            expect(await tx.$executeRaw`
              INSERT INTO hosted_mailbox_lane_counter (user_id, lane, next_seq, updated_at)
              VALUES (${userId}, 'causal', 2, NOW()), (${userId}, 'conversation', 2, NOW())
            `).toBe(2);
            throw rollback;
          }, options)).rejects.toBe(rollback);
        }
        release.resolve();
        expect(await a).toEqual({ causalSeq: seeded ? 40n : 1n, laneSeq: seeded ? 8n : 1n });
        expect(await pending).toEqual({ causalSeq: seeded ? 41n : 2n, laneSeq: seeded ? 9n : 2n });
        expect(await counters()).toEqual([
          { lane: "causal", nextSeq: seeded ? 42n : 3n },
          { lane: "conversation", nextSeq: seeded ? 10n : 3n },
        ]);
      } finally {
        release.resolve();
        await Promise.allSettled([a, b]);
      }
    });

    it("does not touch the lane counter while waiting for the causal counter row", async () => {
      await seed();
      const append = await appender(mode, "causal-row-order");
      const locked = deferred(), release = deferred(), pid = deferred<number>();
      const a = owner.$transaction(async tx => {
        await tx.$queryRaw`SELECT lane FROM hosted_mailbox_lane_counter
          WHERE user_id = ${userId} AND lane = 'causal' FOR UPDATE`;
        locked.resolve();
        await release.promise;
      }, options);
      let b: Promise<unknown> | undefined;
      try {
        await locked.promise;
        b = contender.$transaction(async tx => {
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          pid.resolve(backend!.pid);
          return append(tx);
        }, options);
        await waitForLock(await pid.promise, "transactionid");
        await observer.$transaction(async tx => {
          expect(await tx.$queryRaw`SELECT lane FROM hosted_mailbox_lane_counter
            WHERE user_id = ${userId} AND lane = 'conversation' FOR UPDATE NOWAIT`
          ).toHaveLength(1);
        }, options);
        release.resolve();
        await a;
        expect(await b).toEqual({ causalSeq: 40n, laneSeq: 8n });
      } finally {
        release.resolve();
        await Promise.allSettled([a, b]);
      }
    });

    it("rolls back both counter increments on an item identity conflict", async () => {
      await seed();
      const original = await observer.$transaction(tx => appendHostedMailboxEnvelopeTx({
        envelope: envelope("original"), tx,
      }), options);
      const before = await counters();
      const wake = envelope(original.item.id);
      const prepared = await prepareHostedMailboxEnvelopeAppend({ envelope: wake, prisma: observer });
      if (prepared.mode !== "prepared") throw new Error("Expected a fresh prepared append.");
      await expect(contender.$transaction(async tx => {
        if (mode === "prepared") {
          await appendPreparedHostedMailboxEnvelopeTx({ prepared: { ...prepared, itemId: original.item.id }, tx });
        } else {
          await appendHostedMailboxEnvelopeWithIdentityTx({ envelope: wake, itemId: wake.eventId, expiresAt: null, tx });
        }
      }, options)).rejects.toMatchObject({ code: "P2010", meta: {
        driverAdapterError: { cause: { originalCode: "23505", constraint: { fields: ["id"] } } },
      } });
      expect(await counters()).toEqual(before);
      expect(await observer.hostedMailboxItem.count({ where: { userId } })).toBe(1);
    });

    it("holds the causal lock until commit before a freshness reader can see the append", async () => {
      const append = await appender(mode, "before-freshness-read");
      const appended = deferred(), release = deferred(), pid = deferred<number>();
      const a = owner.$transaction(async tx => {
        await append(tx);
        appended.resolve();
        await release.promise;
      }, options);
      let b: Promise<unknown> | undefined;
      try {
        await appended.promise;
        b = contender.$transaction(async tx => {
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          pid.resolve(backend!.pid);
          await acquireHostedMailboxCausalAppendLockTx({ tx, userId });
          return readHostedMailboxMaxSeqByLane({ prisma: tx, userId, lanes: ["conversation"] });
        }, options);
        await waitForLock(await pid.promise, "advisory");
        release.resolve();
        await a;
        expect(await b).toMatchObject([{ lane: "conversation", maxSeq: "1" }]);
      } finally {
        release.resolve();
        await Promise.allSettled([a, b]);
      }
    });
  });

  it("rolls back allocation when a prepared insert loses a dedupe race", async () => {
    await seed();
    const wake = envelope("dedupe-conflict");
    const prepared = await prepareHostedMailboxEnvelopeAppend({ envelope: wake, prisma: observer });
    if (prepared.mode !== "prepared") throw new Error("Expected a fresh prepared append.");
    // A query-only hook preserves the client's public operations and transaction owner.
    const racing = contender.$extends({ query: { hostedMailboxItem: {
      async findUnique({ args, query }) {
        const absent = await query(args);
        // Simulate a writer that bypassed the advisory dedupe lock after our read.
        await observer.hostedMailboxItem.create({ data: {
          id: randomUUID(), userId, dedupeKey: wake.eventId,
          causalSeq: 39n, lane: prepared.lane, laneSeq: 7n,
          kind: prepared.itemKind, occurredAt: prepared.occurredAt,
          payloadSchema: prepared.payloadSchema,
          payloadInlineCiphertext: prepared.payloadStorage.payloadInlineCiphertext,
          payloadBytes: prepared.payloadBytes, payloadHash: prepared.payloadHash,
        } });
        return absent;
      },
    } } }) as typeof contender;
    await expect(racing.$transaction(tx => appendPreparedHostedMailboxEnvelopeTx({ prepared, tx }), options))
      .rejects.toThrow("Hosted mailbox prepared append conflict could not be resolved.");
    expect(await counters()).toEqual([
      { lane: "causal", nextSeq: 40n }, { lane: "conversation", nextSeq: 8n },
    ]);
    expect(await observer.hostedMailboxItem.count({ where: { userId } })).toBe(1);
  });
});
