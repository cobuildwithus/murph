import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  PrismaHostedBrowserAssertionNonceStore,
} from "@/src/lib/device-sync/prisma-store/browser-assertion-nonces";
import {
  deleteExpiredHostedBrowserAssertionNonces,
} from "@/src/lib/hosted-retention/browser-assertion-nonces";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The browser assertion nonce concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("PostgreSQL concurrency proof timed out.")),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
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

async function disconnectAll(clients: PrismaClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.$disconnect()));
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "browser assertion nonce PostgreSQL concurrency",
  () => {
    it("admits exactly one simultaneous insert of the same nonce", async () => {
      const fixtureId = randomUUID();
      const nonceHash = `browser_nonce_same_${fixtureId}`;
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const clients = [firstClient, secondClient, observer];
      let insertions: Promise<[boolean, boolean]> | null = null;
      const input = {
        expiresAt: "2026-08-09T12:46:00.000Z",
        method: "POST",
        nonceHash,
        now: "2026-08-09T12:45:00.000Z",
        path: "/api/device-sync/agents/pair",
        userId: `member_browser_nonce_${fixtureId}`,
      };

      try {
        insertions = Promise.all([
          new PrismaHostedBrowserAssertionNonceStore(firstClient)
            .consumeBrowserAssertionNonce(input),
          new PrismaHostedBrowserAssertionNonceStore(secondClient)
            .consumeBrowserAssertionNonce(input),
        ]);
        const results = await withDeadline(insertions, 5_000);

        expect(results.filter(Boolean)).toHaveLength(1);
        expect(results.filter((result) => !result)).toHaveLength(1);
        await expect(observer.deviceBrowserAssertionNonce.count({
          where: { nonceHash },
        })).resolves.toBe(1);
      } finally {
        if (insertions) {
          await Promise.allSettled([insertions]);
        }
        try {
          await observer.deviceBrowserAssertionNonce.deleteMany({
            where: { nonceHash },
          });
        } finally {
          await disconnectAll(clients);
        }
      }
    }, 15_000);

    it("skips a locked expired row while an unrelated insert proceeds", async () => {
      const fixtureId = randomUUID();
      const lockedNonceHash = `browser_nonce_locked_${fixtureId}`;
      const freshNonceHash = `browser_nonce_fresh_${fixtureId}`;
      const lockedAt = new Date("0001-01-01T00:00:00.000Z");
      const cleanupAt = new Date("0001-01-02T00:00:00.000Z");
      const freshExpiresAt = new Date("0001-01-03T00:00:00.000Z");
      const lockClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const retentionClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const insertClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const clients = [lockClient, retentionClient, insertClient, observer];
      const rowLocked = createDeferred();
      const releaseRow = createDeferred();
      let lockTransaction: Promise<void> | null = null;
      let concurrentWork: Promise<[number, boolean]> | null = null;

      try {
        await observer.deviceBrowserAssertionNonce.create({
          data: {
            createdAt: lockedAt,
            expiresAt: lockedAt,
            method: "POST",
            nonceHash: lockedNonceHash,
            path: "/api/device-sync/agents/pair",
            userId: `member_browser_locked_${fixtureId}`,
          },
        });
        lockTransaction = lockClient.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<Array<{ nonceHash: string }>>`
            SELECT "nonce_hash" AS "nonceHash"
            FROM "device_browser_assertion_nonce"
            WHERE "nonce_hash" = ${lockedNonceHash}
            FOR UPDATE
          `;
          expect(rows).toEqual([{ nonceHash: lockedNonceHash }]);
          rowLocked.resolve();
          await releaseRow.promise;
        }, transactionOptions);
        await Promise.race([
          rowLocked.promise,
          lockTransaction.then(() => {
            throw new Error("Expected the browser nonce row lock to remain held.");
          }),
        ]);

        concurrentWork = Promise.all([
          deleteExpiredHostedBrowserAssertionNonces({
            now: cleanupAt,
            prisma: retentionClient,
          }),
          new PrismaHostedBrowserAssertionNonceStore(insertClient)
            .consumeBrowserAssertionNonce({
              expiresAt: freshExpiresAt.toISOString(),
              method: "POST",
              nonceHash: freshNonceHash,
              now: cleanupAt.toISOString(),
              path: "/api/device-sync/agents/pair",
              userId: `member_browser_fresh_${fixtureId}`,
            }),
        ]);
        const [deletedWhileLocked, freshInserted] = await withDeadline(
          concurrentWork,
          5_000,
        );

        expect(deletedWhileLocked).toBe(0);
        expect(freshInserted).toBe(true);
        await expect(observer.deviceBrowserAssertionNonce.count({
          where: {
            nonceHash: { in: [lockedNonceHash, freshNonceHash] },
          },
        })).resolves.toBe(2);

        releaseRow.resolve();
        await lockTransaction;
        await expect(deleteExpiredHostedBrowserAssertionNonces({
          now: cleanupAt,
          prisma: retentionClient,
        })).resolves.toBe(1);
        await expect(observer.deviceBrowserAssertionNonce.findMany({
          orderBy: { nonceHash: "asc" },
          select: { nonceHash: true },
          where: {
            nonceHash: { in: [lockedNonceHash, freshNonceHash] },
          },
        })).resolves.toEqual([{ nonceHash: freshNonceHash }]);
      } finally {
        releaseRow.resolve();
        if (lockTransaction) {
          await Promise.allSettled([lockTransaction]);
        }
        if (concurrentWork) {
          await Promise.allSettled([concurrentWork]);
        }
        try {
          await observer.deviceBrowserAssertionNonce.deleteMany({
            where: {
              nonceHash: { in: [lockedNonceHash, freshNonceHash] },
            },
          });
        } finally {
          await disconnectAll(clients);
        }
      }
    }, 20_000);
  },
);
