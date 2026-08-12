import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "@/src/lib/prisma";
import {
  deleteExpiredDeviceOauthSessions,
} from "@/src/lib/hosted-retention/cleanup";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted retention concurrency proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted control-artifact retention concurrency",
  () => {
    let cleanupClient: PrismaClient | null = null;
    let lockClient: PrismaClient | null = null;

    beforeAll(() => {
      cleanupClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      lockClient = createPrismaClient({ databaseUrl, poolMax: 1 });
    });

    afterAll(async () => {
      await Promise.all([
        cleanupClient?.$disconnect(),
        lockClient?.$disconnect(),
      ]);
    });

    it("skips a concurrently locked expired row and retires other eligible work", async () => {
      const cleanup = requirePrisma(cleanupClient);
      const locker = requirePrisma(lockClient);
      const suffix = randomUUID();
      const lockedState = `retention-locked-${suffix}`;
      const freeState = `retention-free-${suffix}`;
      const now = new Date("2026-08-11T12:00:00.000Z");
      const expiredAt = new Date("2026-08-11T11:00:00.000Z");
      let releaseLock = (): void => undefined;
      const lockGate = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let markLocked = (): void => undefined;
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve;
      });

      await cleanup.deviceOauthSession.createMany({
        data: [lockedState, freeState].map((state) => ({
          createdAt: expiredAt,
          expiresAt: expiredAt,
          provider: "retention-proof",
          state,
        })),
      });

      const holder = locker.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "state"
          FROM "device_oauth_session"
          WHERE "state" = ${lockedState}
          FOR UPDATE
        `;
        markLocked();
        await lockGate;
      });

      try {
        await locked;
        await cleanup.$executeRawUnsafe("SET statement_timeout = '1s'");
        await expect(deleteExpiredDeviceOauthSessions({
          now,
          prisma: cleanup,
        })).resolves.toBe(1);
        await expect(cleanup.deviceOauthSession.findMany({
          orderBy: { state: "asc" },
          select: { state: true },
          where: { state: { in: [lockedState, freeState] } },
        })).resolves.toEqual([{ state: lockedState }]);

        releaseLock();
        await holder;
        await expect(deleteExpiredDeviceOauthSessions({
          now,
          prisma: cleanup,
        })).resolves.toBe(1);
      } finally {
        releaseLock();
        await holder.catch(() => undefined);
        await cleanup.deviceOauthSession.deleteMany({
          where: { state: { in: [lockedState, freeState] } },
        });
      }
    });
  },
);

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("PostgreSQL test client was not initialized.");
  }
  return value;
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
