import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  createHostedExternalThreadIdentityLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  consumeHostedLinqThreadRouteParticipantAdditionPendingTx,
  markHostedLinqThreadRouteParticipantAdditionPendingTx,
} from "@/src/lib/hosted-routing/thread-route-store";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type RouteFixture = {
  containerMemberId: string;
  observer: PrismaClient;
  participantClient: PrismaClient;
  messageClient: PrismaClient;
  threadId: string;
  threadIdentityLookupKey: string;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createRouteFixture(): Promise<RouteFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
  }

  const fixtureId = randomUUID();
  const ownerMemberId = `member_linq_lock_owner_${fixtureId}`;
  const containerMemberId = `member_linq_lock_container_${fixtureId}`;
  const threadId = `chat_linq_lock_${fixtureId}`;
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: "linq",
    threadId,
  });
  if (!threadIdentityLookupKey) {
    throw new Error("Expected a Linq thread identity lookup key.");
  }

  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const participantClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const messageClient = createPrismaClient({ databaseUrl, poolMax: 1 });

  await observer.hostedMember.createMany({
    data: [
      { id: ownerMemberId },
      { id: containerMemberId },
    ],
  });
  await observer.hostedThreadContainer.create({
    data: {
      memberId: containerMemberId,
      ownerMemberId,
    },
  });
  await observer.hostedThreadRoute.create({
    data: {
      channel: "linq",
      containerMemberId,
      pendingParticipantAddition: false,
      threadIdentityLookupKey,
      threadLookupKey: `linq-lock-proof:${fixtureId}`,
    },
  });

  return {
    containerMemberId,
    messageClient,
    observer,
    participantClient,
    threadId,
    threadIdentityLookupKey,
  };
}

async function cleanupRouteFixture(fixture: RouteFixture): Promise<void> {
  await fixture.observer.hostedThreadRoute.deleteMany({
    where: {
      channel: "linq",
      threadIdentityLookupKey: fixture.threadIdentityLookupKey,
    },
  });
  const container = await fixture.observer.hostedThreadContainer.findUnique({
    select: { ownerMemberId: true },
    where: { memberId: fixture.containerMemberId },
  });
  await fixture.observer.hostedThreadContainer.deleteMany({
    where: { memberId: fixture.containerMemberId },
  });
  await fixture.observer.hostedMember.deleteMany({
    where: {
      id: {
        in: [
          fixture.containerMemberId,
          ...(container ? [container.ownerMemberId] : []),
        ],
      },
    },
  });
  await Promise.all([
    fixture.messageClient.$disconnect(),
    fixture.participantClient.$disconnect(),
    fixture.observer.$disconnect(),
  ]);
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the PostgreSQL transaction to wait on the route-row lock.");
}

async function readPendingParticipantAddition(
  fixture: RouteFixture,
): Promise<boolean | null> {
  const route = await fixture.observer.hostedThreadRoute.findFirst({
    select: { pendingParticipantAddition: true },
    where: {
      channel: "linq",
      threadIdentityLookupKey: fixture.threadIdentityLookupKey,
    },
  });
  return route?.pendingParticipantAddition ?? null;
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "Linq participant-addition PostgreSQL ordering",
  () => {
    it("consumes an addition that commits before the waiting group message", async () => {
      const fixture = await createRouteFixture();
      const markerWritten = createDeferred();
      const releaseMarker = createDeferred();
      const consumerPid = createDeferred<number>();
      let consumerTransaction: Promise<boolean> | null = null;

      const markerTransaction = fixture.participantClient.$transaction(async (tx) => {
        await markHostedLinqThreadRouteParticipantAdditionPendingTx({
          containerMemberId: fixture.containerMemberId,
          prisma: tx,
          threadId: fixture.threadId,
        });
        markerWritten.resolve();
        await releaseMarker.promise;
      });

      try {
        await markerWritten.promise;
        consumerTransaction = fixture.messageClient.$transaction(async (tx) => {
          consumerPid.resolve(await readBackendPid(tx));
          return consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await consumerPid.promise,
        });

        releaseMarker.resolve();
        await markerTransaction;
        await expect(consumerTransaction).resolves.toBe(true);
        await expect(readPendingParticipantAddition(fixture)).resolves.toBe(false);
      } finally {
        releaseMarker.resolve();
        await Promise.allSettled([
          markerTransaction,
          ...(consumerTransaction ? [consumerTransaction] : []),
        ]);
        await cleanupRouteFixture(fixture);
      }
    });

    it("leaves a later addition pending when the group message locks first", async () => {
      const fixture = await createRouteFixture();
      const messageLocked = createDeferred();
      const releaseMessage = createDeferred();
      const markerPid = createDeferred<number>();
      let markerTransaction: Promise<void> | null = null;

      const messageTransaction = fixture.messageClient.$transaction(async (tx) => {
        const consumed =
          await consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        messageLocked.resolve();
        await releaseMessage.promise;
        return consumed;
      });

      try {
        await messageLocked.promise;
        markerTransaction = fixture.participantClient.$transaction(async (tx) => {
          markerPid.resolve(await readBackendPid(tx));
          await markHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await markerPid.promise,
        });

        releaseMessage.resolve();
        await expect(messageTransaction).resolves.toBe(false);
        await markerTransaction;
        await expect(readPendingParticipantAddition(fixture)).resolves.toBe(true);
      } finally {
        releaseMessage.resolve();
        await Promise.allSettled([
          messageTransaction,
          ...(markerTransaction ? [markerTransaction] : []),
        ]);
        await cleanupRouteFixture(fixture);
      }
    });
  },
);
