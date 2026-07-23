import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  tryAcquireHostedMemberHomeLinqRecipientAssignmentLockTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
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
  "hosted Linq home-line pool PostgreSQL concurrency",
  () => {
    it("fails a concurrent try-lock immediately and releases ownership at commit", async () => {
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const ownerAcquired = createDeferred<boolean>();
      const releaseOwner = createDeferred();
      const ownerTransaction = owner.$transaction(async (tx) => {
        const firstAcquisition =
          await tryAcquireHostedMemberHomeLinqRecipientAssignmentLockTx({
            prisma: tx,
          });
        const reentrantAcquisition =
          await tryAcquireHostedMemberHomeLinqRecipientAssignmentLockTx({
            prisma: tx,
          });
        ownerAcquired.resolve(firstAcquisition && reentrantAcquisition);
        await releaseOwner.promise;
        return firstAcquisition && reentrantAcquisition;
      }, transactionOptions);

      try {
        await expect(
          Promise.race([ownerAcquired.promise, ownerTransaction]),
        ).resolves.toBe(true);

        await expect(contender.$transaction(
          (tx) =>
            tryAcquireHostedMemberHomeLinqRecipientAssignmentLockTx({
              prisma: tx,
            }),
          transactionOptions,
        )).resolves.toBe(false);

        releaseOwner.resolve();
        await expect(ownerTransaction).resolves.toBe(true);

        await expect(contender.$transaction(
          (tx) =>
            tryAcquireHostedMemberHomeLinqRecipientAssignmentLockTx({
              prisma: tx,
            }),
          transactionOptions,
        )).resolves.toBe(true);
      } finally {
        releaseOwner.resolve();
        await Promise.allSettled([ownerTransaction]);
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
