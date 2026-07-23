import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  HostedMemberStripeMutationLockBusyError,
  withHostedMemberStripeMutationLockForOps,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted member-lock concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const memberLockAcquisitionTimeoutMs = 2_000;
const transactionTimeoutMs = 10_000;

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted member Stripe mutation lock PostgreSQL concurrency",
  () => {
    it("fails a same-member contender within the acquisition budget and allows a later retry", async () => {
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_lock_${randomUUID()}`;
      const ownerAcquired = createDeferred();
      const releaseOwner = createDeferred();
      let contenderRunCount = 0;

      await owner.hostedMember.create({
        data: {
          id: memberId,
        },
      });

      const ownerTransaction = withHostedMemberStripeMutationLockForOps({
        acquisitionTimeoutMs: memberLockAcquisitionTimeoutMs,
        memberId,
        prisma: owner,
        run: async () => {
          ownerAcquired.resolve();
          await releaseOwner.promise;
          return "owner";
        },
        transactionTimeoutMs,
      });

      try {
        await expect(
          Promise.race([
            ownerAcquired.promise,
            ownerTransaction.then(() => {
              throw new Error(
                "The owner transaction completed before holding the member row.",
              );
            }),
          ]),
        ).resolves.toBeUndefined();

        const startedAt = Date.now();
        await expect(
          withHostedMemberStripeMutationLockForOps({
            acquisitionTimeoutMs: memberLockAcquisitionTimeoutMs,
            memberId,
            prisma: contender,
            run: async () => {
              contenderRunCount += 1;
              return "contender";
            },
            transactionTimeoutMs,
          }),
        ).rejects.toBeInstanceOf(HostedMemberStripeMutationLockBusyError);
        expect(Date.now() - startedAt).toBeLessThan(5_000);
        expect(contenderRunCount).toBe(0);

        releaseOwner.resolve();
        await expect(ownerTransaction).resolves.toBe("owner");

        await expect(
          withHostedMemberStripeMutationLockForOps({
            acquisitionTimeoutMs: memberLockAcquisitionTimeoutMs,
            memberId,
            prisma: contender,
            run: async () => {
              contenderRunCount += 1;
              return "contender";
            },
            transactionTimeoutMs,
          }),
        ).resolves.toBe("contender");
        expect(contenderRunCount).toBe(1);
      } finally {
        releaseOwner.resolve();
        await Promise.allSettled([ownerTransaction]);
        await owner.hostedMember.deleteMany({
          where: {
            id: memberId,
          },
        });
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
