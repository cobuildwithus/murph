import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  tryAcquireHostedEmailPublicBootstrapGlobalClaimLockTx,
} from "@/src/lib/hosted-onboarding/hosted-email-public-bootstrap";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted public-email bootstrap proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted public-email bootstrap PostgreSQL concurrency",
  () => {
    it("drops colliding global claims while the winner waits on a member row", async () => {
      const blockerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const webClient = createPrismaClient({ databaseUrl, poolMax: 4 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_public_email_lock_${randomUUID()}`;
      const blockerReady = createDeferred();
      const releaseBlocker = createDeferred();
      const winnerReady = createDeferred<number>();
      let admissions = 0;
      let blocker: Promise<unknown> | null = null;
      let winner: Promise<unknown> | null = null;
      let collisions: Array<Promise<{ acquired: boolean; pid: number }>> = [];

      try {
        await observer.hostedMember.create({ data: { id: memberId } });
        blocker = blockerClient.$transaction(async (tx) => {
          await lockHostedMemberRow(tx, memberId);
          blockerReady.resolve();
          await releaseBlocker.promise;
        }, { maxWait: 2_000, timeout: 10_000 });
        await blockerReady.promise;

        winner = webClient.$transaction(async (tx) => {
          const pid = await readBackendPid(tx);
          const acquired =
            await tryAcquireHostedEmailPublicBootstrapGlobalClaimLockTx(tx);
          expect(acquired).toBe(true);
          admissions += 1;
          winnerReady.resolve(pid);
          await lockHostedMemberRow(tx, memberId);
          return pid;
        }, { maxWait: 2_000, timeout: 10_000 });
        const winnerPid = await winnerReady.promise;
        await waitForBackendLock({ observer, pid: winnerPid });

        collisions = Array.from({ length: 8 }, () =>
          webClient.$transaction(async (tx) => {
            const pid = await readBackendPid(tx);
            const acquired =
              await tryAcquireHostedEmailPublicBootstrapGlobalClaimLockTx(tx);
            if (acquired) {
              admissions += 1;
              await lockHostedMemberRow(tx, memberId);
            }
            return { acquired, pid };
          }, { maxWait: 1_000, timeout: 2_000 })
        );

        const [collisionResults, ordinaryQuery] = await withDeadline(
          Promise.all([
            Promise.all(collisions),
            webClient.$queryRaw<Array<{ value: number }>>`
              SELECT 1::int AS value
            `,
          ]),
          2_000,
        );
        expect(collisionResults).toHaveLength(8);
        expect(collisionResults.every((result) => !result.acquired)).toBe(true);
        expect(ordinaryQuery).toEqual([{ value: 1 }]);
        expect(admissions).toBe(1);

        const contenderPids = [
          winnerPid,
          ...collisionResults.map((result) => result.pid),
        ];
        const [advisoryWaiters] = await observer.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND granted = FALSE
            AND pid IN (${Prisma.join([...new Set(contenderPids)])})
        `;
        expect(advisoryWaiters?.count).toBe(0);

        releaseBlocker.resolve();
        await expect(blocker).resolves.toBeUndefined();
        await expect(winner).resolves.toBe(winnerPid);
      } finally {
        releaseBlocker.resolve();
        await Promise.allSettled([
          ...(blocker ? [blocker] : []),
          ...(winner ? [winner] : []),
          ...collisions,
        ]);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        await disconnectClients([blockerClient, webClient, observer]);
      }
    }, 20_000);
  },
);

type Deferred<T = void> = {
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

async function readBackendPid(
  prisma: Prisma.TransactionClient,
): Promise<number> {
  const [result] = await prisma.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid()::int AS pid
  `;
  if (!result) {
    throw new Error("Expected the PostgreSQL backend id.");
  }
  return result.pid;
}

async function waitForBackendLock(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const [activity] = await input.observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE pid = ${input.pid}
    `;
    if (activity?.waitEventType === "Lock") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the bootstrap winner to wait on the member row.");
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error("PostgreSQL proof exceeded its deadline.")), timeoutMs);
    }),
  ]);
}

async function disconnectClients(clients: PrismaClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.$disconnect()));
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}
