import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  claimHostedLinqProactiveConversationCapacityTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted Linq home-routing concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const transactionOptions = {
  maxWait: 5_000,
  timeout: 10_000,
} as const;

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted Linq proactive capacity PostgreSQL concurrency",
  () => {
    it("admits only one concurrent claim for the final daily slot", async () => {
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const phoneNumberLookupKey =
        `test:linq-proactive-capacity:${randomUUID()}`;
      const dayUtc = new Date("2026-07-23T00:00:00.000Z");
      const limit = 50;
      const ownerClaimed = createDeferred<boolean>();
      const releaseOwner = createDeferred();
      let contenderTransaction: Promise<boolean> | null = null;
      let ownerTransaction: Promise<boolean> | null = null;
      let rowCreated = false;

      try {
        await owner.hostedLinqLine.create({
          data: {
            phoneNumberHint: "*** test",
            phoneNumberLookupKey,
            proactiveConversationCount: limit - 1,
            proactiveConversationDayUtc: dayUtc,
            source: "test",
          },
        });
        rowCreated = true;

        ownerTransaction = owner.$transaction(async (tx) => {
          const claimed =
            await claimHostedLinqProactiveConversationCapacityTx({
              dayUtc,
              limit,
              phoneNumberLookupKey,
              prisma: tx,
            });
          ownerClaimed.resolve(claimed);
          await releaseOwner.promise;
          return claimed;
        }, transactionOptions);

        await expect(
          Promise.race([ownerClaimed.promise, ownerTransaction]),
        ).resolves.toBe(true);

        contenderTransaction = contender.$transaction(
          (tx) =>
            claimHostedLinqProactiveConversationCapacityTx({
              dayUtc,
              limit,
              phoneNumberLookupKey,
              prisma: tx,
            }),
          transactionOptions,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        releaseOwner.resolve();

        await expect(
          Promise.all([ownerTransaction, contenderTransaction]),
        ).resolves.toEqual([true, false]);
        await expect(owner.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey },
          select: { proactiveConversationCount: true },
        })).resolves.toEqual({
          proactiveConversationCount: limit,
        });
      } finally {
        releaseOwner.resolve();
        await Promise.allSettled(
          [ownerTransaction, contenderTransaction].filter(
            (transaction): transaction is Promise<boolean> =>
              transaction !== null,
          ),
        );
        if (rowCreated) {
          await owner.hostedLinqLine.deleteMany({
            where: { phoneNumberLookupKey },
          });
        }
        await disconnectClients([owner, contender]);
      }
    });
  },
);

async function disconnectClients(clients: PrismaClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.$disconnect()));
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
