import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/lib/prisma";
import { runWithPrismaOperationTimings, type PrismaPoolAcquisitionTiming } from "../src/lib/prisma-operation-timing";

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
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { entered = resolve; });
    let transaction: Promise<unknown> | undefined;
    let query: Promise<unknown> | undefined;
    try {
      await runWithPrismaOperationTimings([], () => prisma.$queryRaw`SELECT 1`, fresh);
      expect(fresh).toHaveLength(1);
      expect(fresh[0]).toMatchObject({ totalConnections: 0, idleConnections: 0, waitingRequests: 0 });
      transaction = prisma.$transaction(async () => { entered(); await held; });
      await acquired;
      query = runWithPrismaOperationTimings([], () => prisma.$queryRaw`SELECT 1`, contended);
      // Deliberately hold the sole test connection to exercise the real pg queue.
      await delay(100);
      expect(contended).toHaveLength(0);
      release();
      await Promise.all([query, transaction]);
      expect(contended).toHaveLength(1);
      expect(contended[0]).toMatchObject({ totalConnections: 1, idleConnections: 0, waitingRequests: 0 });
      expect(contended[0]!.ms).toBeGreaterThanOrEqual(50);
    } finally {
      release();
      await Promise.allSettled([transaction, query]);
      await prisma.$disconnect();
    }
  });
});
