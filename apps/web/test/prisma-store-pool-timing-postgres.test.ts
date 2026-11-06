import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/lib/prisma";
import { runWithPrismaOperationTimings, type PrismaPoolAcquisitionTiming, type PrismaQueryTiming, type PrismaOperationTiming } from "../src/lib/prisma-operation-timing";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname) || url.search) {
    throw new Error("Pool timing proof requires an isolated loopback test database.");
  }
}

describe.skipIf(!enabled)("actual Prisma pool timing", () => {
  it("attributes first connection and a queued checkout through the production pool wrapper", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    const fresh: PrismaPoolAcquisitionTiming[] = [];
    const contended: PrismaPoolAcquisitionTiming[] = [];
    const freshQueries: PrismaQueryTiming[] = [];
    const contendedQueries: PrismaQueryTiming[] = [];
    const operations: PrismaOperationTiming[] = [];
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { entered = resolve; });
    let transaction: Promise<unknown> | undefined;
    let query: Promise<unknown> | undefined;
    try {
      await runWithPrismaOperationTimings(operations, () => prisma.$queryRaw`SELECT 1`, fresh, freshQueries);
      expect(freshQueries).toHaveLength(1);
      expect(freshQueries[0]!.failed).toBe(false);
      expect(operations[0]!.startMs).toBeLessThanOrEqual(fresh[0]!.startMs!);
      expect(freshQueries[0]!.startMs).toBeGreaterThanOrEqual(fresh[0]!.startMs! + fresh[0]!.ms);
      expect(fresh).toHaveLength(1);
      expect(fresh[0]).toMatchObject({ totalConnections: 0, idleConnections: 0, waitingRequests: 0 });
      transaction = prisma.$transaction(async () => { entered(); await held; });
      await acquired;
      query = runWithPrismaOperationTimings([], () => prisma.$queryRaw`SELECT 1`, contended, contendedQueries);
      // Deliberately hold the sole test connection to exercise the real pg queue.
      await delay(100);
      expect(contended).toHaveLength(0);
      expect(contendedQueries).toHaveLength(0);
      release();
      await Promise.all([query, transaction]);
      expect(contended).toHaveLength(1);
      expect(contended[0]).toMatchObject({ totalConnections: 1, idleConnections: 0, waitingRequests: 0 });
      expect(contended[0]!.ms).toBeGreaterThanOrEqual(50);
      expect(contendedQueries).toHaveLength(1);
      expect(contendedQueries[0]!.startMs).toBeGreaterThanOrEqual(contended[0]!.ms);
      expect(freshQueries).toHaveLength(1);
    } finally {
      release();
      await Promise.allSettled([transaction, query]);
      await prisma.$disconnect();
    }
  });
  it("separates slow SQL from checkout, captures errors, and sees transaction statements", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    const queries: PrismaQueryTiming[] = [];
    const checkouts: PrismaPoolAcquisitionTiming[] = [];
    try {
      await runWithPrismaOperationTimings([], async () => {
        await prisma.$queryRaw`SELECT 1 FROM pg_sleep(0.1)`;
        await expect(prisma.$queryRaw`SELECT 1 / 0`).rejects.toThrow();
        await prisma.$transaction(async tx => { await tx.$queryRaw`SELECT 1`; });
      }, checkouts, queries);
      expect(checkouts).toHaveLength(3);
      expect(queries).toHaveLength(5); // SELECT, failed SELECT, BEGIN, SELECT, COMMIT.
      expect(queries.map(sample => sample.failed)).toEqual([false, true, false, false, false]);
      expect(queries[0]!.ms).toBeGreaterThanOrEqual(90);
      expect(queries[0]!.startMs).toBeGreaterThanOrEqual(checkouts[0]!.startMs! + checkouts[0]!.ms);
      expect(JSON.stringify(queries)).not.toMatch(/SELECT|pg_sleep|division|postgres/);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("keeps overlapping queries attributed to their requesting collector", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
    const slow: PrismaQueryTiming[] = [];
    const fast: PrismaQueryTiming[] = [];
    try {
      await prisma.$connect();
      await Promise.all([
        runWithPrismaOperationTimings([], () => prisma.$queryRaw`SELECT 1 FROM pg_sleep(0.15)`, [], slow),
        runWithPrismaOperationTimings([], () => prisma.$queryRaw`SELECT 2`, [], fast),
      ]);
      expect(slow).toHaveLength(1);
      expect(fast).toHaveLength(1);
      expect(slow[0]!.ms).toBeGreaterThanOrEqual(140);
      expect(fast[0]!.ms).toBeLessThan(slow[0]!.ms);
    } finally {
      await prisma.$disconnect();
    }
  });
  it("does not attribute an untraced waiter to the traced request releasing its connection", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    const queries: PrismaQueryTiming[] = [];
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { entered = resolve; });
    let transaction: Promise<unknown> | undefined;
    let waiter: Promise<unknown> | undefined;
    try {
      transaction = runWithPrismaOperationTimings([], () => prisma.$transaction(async () => {
        entered();
        await held;
      }), [], queries);
      await acquired;
      waiter = Promise.resolve(prisma.$queryRaw`SELECT 1`);
      await delay(50);
      release();
      await Promise.all([transaction, waiter]);
      expect(queries).toHaveLength(2); // Only this collector's BEGIN and COMMIT.
    } finally {
      release();
      await Promise.allSettled([transaction, waiter]);
      await prisma.$disconnect();
    }
  });

});
