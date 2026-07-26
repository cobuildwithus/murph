import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresRetryProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresRetryProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted database retry PostgreSQL proof requires a local DATABASE_URL.",
  );
}

/**
 * The unit suite proves the retry policy against fabricated errors. This proves
 * that real local saturation is returned as backpressure without re-entering
 * the pool queue, and that a callback which already ran is never replayed.
 */
describe.skipIf(!runPostgresRetryProof)(
  "hosted web database retry (real PostgreSQL)",
  () => {
    it("does not retry a real transaction-start timeout under local saturation", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

      try {
        const { holding, release } = await holdTheOnlyConnection(prisma);
        let callbackRuns = 0;

        try {
          await expect(prisma.$transaction(async (tx) => {
            callbackRuns += 1;
            await tx.$queryRaw`select 1`;
          }, { maxWait: 900, timeout: 10_000 })).rejects.toMatchObject({
            code: "P2028",
          });
        } finally {
          release();
          await holding;
        }

        expect(callbackRuns).toBe(0);
        expect(loggedCategories(warn)).toEqual(["transaction_start_timeout"]);
      } finally {
        await prisma.$disconnect();
        warn.mockRestore();
      }
    }, 60_000);

    it("does not retry a real checkout timeout or persist the write", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const setup = createPrismaClient({ databaseUrl, poolMax: 2 });
      const table = `murph_retry_proof_${randomUUID().replace(/-/g, "")}`;
      await setup.$executeRawUnsafe(
        `create table "${table}" (id text primary key)`,
      );

      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      try {
        const { holding, release } = await holdTheOnlyConnection(prisma);

        const rowId = randomUUID();
        // Not a transaction: this goes through the $allOperations seam.
        try {
          await expect(prisma.$executeRawUnsafe(
            `insert into "${table}" (id) values ($1)`,
            rowId,
          )).rejects.toThrow();
        } finally {
          release();
          await holding;
        }

        const rows = await setup.$queryRawUnsafe<{ id: string }[]>(
          `select id from "${table}"`,
        );
        expect(rows).toEqual([]);
        expect(loggedCategories(warn)).toEqual(["pool_checkout_timeout"]);
      } finally {
        await prisma.$disconnect();
        await setup.$executeRawUnsafe(`drop table if exists "${table}"`);
        await setup.$disconnect();
        warn.mockRestore();
      }
    }, 90_000);

    it("never replays a real transaction that opened and then expired", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      let callbackRuns = 0;

      try {
        // A transaction that outlives its own timeout closes with P2028 too, but
        // its callback already ran, so replaying it could duplicate an effect.
        await expect(prisma.$transaction(async (tx) => {
          callbackRuns += 1;
          await tx.$queryRaw`select 1`;
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          await tx.$queryRaw`select 2`;
        }, { maxWait: 5_000, timeout: 700 })).rejects.toMatchObject({
          code: "P2028",
        });

        expect(callbackRuns).toBe(1);
        expect(loggedCategories(warn)).not.toContain("transaction_start_timeout");
      } finally {
        await prisma.$disconnect();
        warn.mockRestore();
      }
    }, 60_000);
  },
);

/** Occupies the single pooled connection until the returned release runs. */
async function holdTheOnlyConnection(
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<{ holding: Promise<unknown>; release: () => void }> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select 1`;
    await held;
  }, { maxWait: 10_000, timeout: 60_000 });

  // Let the holder acquire the connection before the contended call starts.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { holding, release };
}

function loggedCategories(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls
    .filter((call) => call[0] === "Hosted web database pool failure.")
    .map((call) => (call[1] as { category: string }).category);
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
