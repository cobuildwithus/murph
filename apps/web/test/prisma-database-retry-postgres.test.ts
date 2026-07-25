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
 * the policy against the errors Prisma and adapter-pg actually raise, which is
 * the only place the "a retry cannot duplicate an effect" invariant can be
 * checked end to end: that the callback runs exactly once and that exactly one
 * row lands.
 */
describe.skipIf(!runPostgresRetryProof)(
  "hosted web database retry (real PostgreSQL)",
  () => {
    it("retries a real transaction-start timeout and runs the callback exactly once", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

      try {
        const { holding, release } = await holdTheOnlyConnection(prisma);
        let callbackRuns = 0;

        // Free the pool while the second transaction is between attempts.
        setTimeout(() => release(), 2_000);

        const result = await prisma.$transaction(async (tx) => {
          callbackRuns += 1;
          await tx.$queryRaw`select 1`;
          return "committed";
        }, { maxWait: 900, timeout: 10_000 });
        await holding;

        expect(result).toBe("committed");
        // Failed attempts never entered the callback, so no side effect repeated.
        expect(callbackRuns).toBe(1);
        expect(loggedCategories(warn)).toContain("transaction_start_timeout");
      } finally {
        await prisma.$disconnect();
        warn.mockRestore();
      }
    }, 60_000);

    it("persists exactly one row when a real write is retried", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const setup = createPrismaClient({ databaseUrl, poolMax: 2 });
      const table = `murph_retry_proof_${randomUUID().replace(/-/g, "")}`;
      await setup.$executeRawUnsafe(
        `create table "${table}" (id text primary key)`,
      );

      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      try {
        const { holding, release } = await holdTheOnlyConnection(prisma);
        setTimeout(() => release(), 2_000);

        const rowId = randomUUID();
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `insert into "${table}" (id) values ($1)`,
            rowId,
          );
        }, { maxWait: 900, timeout: 10_000 });
        await holding;

        const rows = await setup.$queryRawUnsafe<{ id: string }[]>(
          `select id from "${table}"`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(rowId);
        expect(loggedCategories(warn)).toContain("transaction_start_timeout");
      } finally {
        await prisma.$disconnect();
        await setup.$executeRawUnsafe(`drop table if exists "${table}"`);
        await setup.$disconnect();
        warn.mockRestore();
      }
    }, 60_000);

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
