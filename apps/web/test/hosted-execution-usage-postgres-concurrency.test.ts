import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { recordHostedAiUsageRecords } from "@/src/lib/hosted-execution/usage";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted usage PostgreSQL concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the PostgreSQL usage replay to wait on the first writer.");
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted usage PostgreSQL idempotency",
  () => {
    it("converges concurrent first writes on one immutable usage row", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_usage_replay_${fixtureId}`;
      const turnId = `turn_usage_replay_${fixtureId}`;
      const usageId = `${turnId}.attempt-1`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const replayClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const firstWritten = createDeferred();
      const releaseFirstWriter = createDeferred();
      const replayPid = createDeferred<number>();
      const usage = [{
        attemptCount: 1,
        credentialSource: "platform",
        memberId,
        occurredAt: "2026-07-22T16:30:05.000Z",
        provider: "retell",
        routeId: null,
        schema: "murph.assistant-usage.v1",
        sessionId: turnId,
        stripeMeterSource: "murph",
        totalTokens: null,
        turnId,
        usageId,
      }];
      let replayTransaction: Promise<Awaited<ReturnType<
        typeof recordHostedAiUsageRecords
      >>> | null = null;

      await observer.hostedMember.create({
        data: { billingStatus: "active", id: memberId },
      });
      const firstTransaction = firstClient.$transaction(async (tx) => {
        const result = await recordHostedAiUsageRecords({
          prisma: tx,
          trustedUserId: memberId,
          usage,
        });
        firstWritten.resolve();
        await releaseFirstWriter.promise;
        return result;
      }, transactionOptions);

      try {
        await Promise.race([firstWritten.promise, firstTransaction]);
        replayTransaction = replayClient.$transaction(async (tx) => {
          replayPid.resolve(await readBackendPid(tx));
          return recordHostedAiUsageRecords({
            prisma: tx,
            trustedUserId: memberId,
            usage,
          });
        }, transactionOptions);

        await waitForBlockedBackend({
          observer,
          pid: await replayPid.promise,
        });
        releaseFirstWriter.resolve();

        await expect(firstTransaction).resolves.toEqual({ recordedIds: [usageId] });
        await expect(replayTransaction).resolves.toEqual({ recordedIds: [usageId] });
        await expect(observer.hostedAiUsage.findMany({
          select: {
            memberId: true,
            provider: true,
            stripeMeterStatus: true,
            turnId: true,
          },
          where: { id: usageId },
        })).resolves.toEqual([{
          memberId,
          provider: "retell",
          stripeMeterStatus: "skipped",
          turnId,
        }]);
      } finally {
        releaseFirstWriter.resolve();
        await Promise.allSettled([
          firstTransaction,
          ...(replayTransaction ? [replayTransaction] : []),
        ]);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        await Promise.all([
          firstClient.$disconnect(),
          replayClient.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    });

    it("rejects a conflicting concurrent replay and rolls its identity update back", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_usage_conflict_${fixtureId}`;
      const turnId = `turn_usage_conflict_${fixtureId}`;
      const usageId = `${turnId}.attempt-1`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const replayClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const firstWritten = createDeferred();
      const releaseFirstWriter = createDeferred();
      const replayPid = createDeferred<number>();
      const occurredAt = "2026-07-22T16:30:05.000Z";
      const usage = [{
        attemptCount: 1,
        credentialSource: "platform",
        memberId,
        occurredAt,
        provider: "retell",
        routeId: null,
        schema: "murph.assistant-usage.v1",
        sessionId: turnId,
        stripeMeterSource: "murph",
        totalTokens: null,
        turnId,
        usageId,
      }];
      let replayTransaction: Promise<Awaited<ReturnType<
        typeof recordHostedAiUsageRecords
      >>> | null = null;

      await observer.hostedMember.create({
        data: { billingStatus: "active", id: memberId },
      });
      const firstTransaction = firstClient.$transaction(async (tx) => {
        const result = await recordHostedAiUsageRecords({
          prisma: tx,
          trustedUserId: memberId,
          usage,
        });
        const stored = await tx.hostedAiUsage.findUniqueOrThrow({
          select: { updatedAt: true },
          where: { id: usageId },
        });
        firstWritten.resolve();
        await releaseFirstWriter.promise;
        return { result, updatedAt: stored.updatedAt };
      }, transactionOptions);

      try {
        await Promise.race([firstWritten.promise, firstTransaction]);
        replayTransaction = replayClient.$transaction(async (tx) => {
          replayPid.resolve(await readBackendPid(tx));
          return recordHostedAiUsageRecords({
            prisma: tx,
            trustedUserId: memberId,
            usage: [{
              ...usage[0],
              occurredAt: "2026-07-22T16:30:06.000Z",
            }],
          });
        }, transactionOptions);

        await waitForBlockedBackend({
          observer,
          pid: await replayPid.promise,
        });
        releaseFirstWriter.resolve();

        const firstResult = await firstTransaction;
        expect(firstResult.result).toEqual({ recordedIds: [usageId] });
        await expect(replayTransaction).rejects.toThrow(
          "Hosted AI usage already exists with different immutable fields: occurredAt.",
        );
        await expect(observer.hostedAiUsage.findMany({
          select: {
            occurredAt: true,
            updatedAt: true,
          },
          where: { id: usageId },
        })).resolves.toEqual([{
          occurredAt: new Date(occurredAt),
          updatedAt: firstResult.updatedAt,
        }]);
      } finally {
        releaseFirstWriter.resolve();
        await Promise.allSettled([
          firstTransaction,
          ...(replayTransaction ? [replayTransaction] : []),
        ]);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        await Promise.all([
          firstClient.$disconnect(),
          replayClient.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    });

    it("preserves historical terminal Stripe meter state on an exact replay", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_usage_terminal_${fixtureId}`;
      const turnId = `turn_usage_terminal_${fixtureId}`;
      const usageId = `${turnId}.attempt-1`;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const meteredAt = new Date("2026-07-22T16:31:00.000Z");
      const usage = [{
        attemptCount: 1,
        credentialSource: "platform",
        memberId,
        occurredAt: "2026-07-22T16:30:05.000Z",
        provider: "retell",
        routeId: null,
        schema: "murph.assistant-usage.v1",
        sessionId: turnId,
        stripeMeterSource: "murph",
        totalTokens: null,
        turnId,
        usageId,
      }];

      await prisma.hostedMember.create({
        data: { billingStatus: "active", id: memberId },
      });

      try {
        await recordHostedAiUsageRecords({
          prisma,
          trustedUserId: memberId,
          usage,
        });
        await prisma.hostedAiUsage.update({
          data: {
            stripeMeterError: null,
            stripeMeterIdentifier: `meter_${fixtureId}`,
            stripeMeterLastAttemptedAt: meteredAt,
            stripeMeterNextAttemptAt: null,
            stripeMeterStatus: "metered",
            stripeMeteredAt: meteredAt,
          },
          where: { id: usageId },
        });

        await expect(recordHostedAiUsageRecords({
          prisma,
          trustedUserId: memberId,
          usage,
        })).resolves.toEqual({ recordedIds: [usageId] });
        await expect(prisma.hostedAiUsage.findUniqueOrThrow({
          select: {
            stripeMeterError: true,
            stripeMeterIdentifier: true,
            stripeMeterLastAttemptedAt: true,
            stripeMeterNextAttemptAt: true,
            stripeMeterStatus: true,
            stripeMeteredAt: true,
          },
          where: { id: usageId },
        })).resolves.toEqual({
          stripeMeterError: null,
          stripeMeterIdentifier: `meter_${fixtureId}`,
          stripeMeterLastAttemptedAt: meteredAt,
          stripeMeterNextAttemptAt: null,
          stripeMeterStatus: "metered",
          stripeMeteredAt: meteredAt,
        });
      } finally {
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });
  },
);
