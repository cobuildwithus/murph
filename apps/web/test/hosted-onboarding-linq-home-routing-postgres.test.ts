import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  claimHostedLinqProactiveConversationCapacityTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import { appendHostedMailboxItemTx } from "@/src/lib/hosted-mailbox/store";
import {
  acquireHostedMemberHomeLinqRouteLockTx,
  upsertHostedMemberPendingLinqBindingTx,
  upsertHostedMemberPendingLinqParticipantContactTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { createHostedLinqParticipantContact } from "@/src/lib/hosted-onboarding/linq-participant-contact";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
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
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    "Expected the PostgreSQL contender to wait on its current owner.",
  );
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted Linq home-routing PostgreSQL concurrency",
  () => {
    it("admits only one concurrent claim for the final daily slot", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const phoneNumberLookupKey =
        `test:linq-proactive-capacity:${randomUUID()}`;
      const dayUtc = new Date("2026-07-23T00:00:00.000Z");
      const limit = 50;
      const ownerClaimed = createDeferred<boolean>();
      const contenderPid = createDeferred<number>();
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

        contenderTransaction = contender.$transaction(async (tx) => {
          contenderPid.resolve(await readBackendPid(tx));
          return claimHostedLinqProactiveConversationCapacityTx({
            dayUtc,
            limit,
            phoneNumberLookupKey,
            prisma: tx,
          });
        }, transactionOptions);
        await waitForBlockedBackend({
          observer,
          pid: await contenderPid.promise,
        });
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
        await disconnectClients([observer, owner, contender]);
      }
    });

    it.each([
      ["activation", "first-contact"],
      ["first-contact", "activation"],
    ] as const)(
      "serializes %s then %s through the member-row owner",
      async (ownerRole, contenderRole) => {
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
        const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
        const memberId = `hbm_linq_route_order_${randomUUID()}`;
        const ownerLocked = createDeferred();
        const contenderPid = createDeferred<number>();
        const releaseOwner = createDeferred();
        let contenderTransaction: Promise<string> | null = null;
        let ownerTransaction: Promise<string> | null = null;
        let memberCreated = false;

        const lockRole = (
          tx: Prisma.TransactionClient,
          role: typeof ownerRole | typeof contenderRole,
        ) => role === "activation"
          ? lockHostedMemberRow(tx, memberId)
          : acquireHostedMemberHomeLinqRouteLockTx({
              memberId,
              prisma: tx,
            });

        try {
          await observer.hostedMember.create({
            data: { id: memberId },
          });
          memberCreated = true;

          ownerTransaction = owner.$transaction(async (tx) => {
            await lockRole(tx, ownerRole);
            ownerLocked.resolve();
            await releaseOwner.promise;
            return ownerRole;
          }, transactionOptions);
          await ownerLocked.promise;

          contenderTransaction = contender.$transaction(async (tx) => {
            contenderPid.resolve(await readBackendPid(tx));
            await lockRole(tx, contenderRole);
            return contenderRole;
          }, transactionOptions);
          await waitForBlockedBackend({
            observer,
            pid: await contenderPid.promise,
          });

          releaseOwner.resolve();
          await expect(
            Promise.all([ownerTransaction, contenderTransaction]),
          ).resolves.toEqual([ownerRole, contenderRole]);
        } finally {
          releaseOwner.resolve();
          await Promise.allSettled(
            [ownerTransaction, contenderTransaction].filter(
              (transaction): transaction is Promise<string> =>
                transaction !== null,
            ),
          );
          if (memberCreated) {
            await observer.hostedMember.deleteMany({
              where: { id: memberId },
            });
          }
          await disconnectClients([observer, owner, contender]);
        }
      },
    );

    it.each([
      ["reclassified-message", "active-message"],
      ["active-message", "reclassified-message"],
    ] as const)(
      "serializes %s then %s through the member row before mailbox append",
      async (ownerRole, contenderRole) => {
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
        const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
        const memberId = `hbm_linq_route_mailbox_${randomUUID()}`;
        const ownerLocked = createDeferred();
        const contenderPid = createDeferred<number>();
        const releaseOwner = createDeferred();
        let ownerTransaction: Promise<string> | null = null;
        let contenderTransaction: Promise<string> | null = null;
        let memberCreated = false;

        const runMessage = async (
          tx: Prisma.TransactionClient,
          role: typeof ownerRole | typeof contenderRole,
        ): Promise<string> => {
          if (role === "reclassified-message") {
            await lockHostedMemberRow(tx, memberId);
          }
          await acquireHostedMemberHomeLinqRouteLockTx({
            memberId,
            prisma: tx,
          });
          await appendHostedMailboxItemTx({
            dedupeKey: `linq-route-mailbox:${role}:${randomUUID()}`,
            kind: "conversation.message",
            lane: "conversation",
            occurredAt: new Date(),
            payloadSerializedJson: JSON.stringify({ kind: "lock-proof" }),
            tx,
            userId: memberId,
          });
          return role;
        };

        try {
          await observer.hostedMember.create({
            data: { id: memberId },
          });
          memberCreated = true;

          ownerTransaction = owner.$transaction(async (tx) => {
            const result = await runMessage(tx, ownerRole);
            ownerLocked.resolve();
            await releaseOwner.promise;
            return result;
          }, transactionOptions);
          await ownerLocked.promise;

          contenderTransaction = contender.$transaction(async (tx) => {
            contenderPid.resolve(await readBackendPid(tx));
            return runMessage(tx, contenderRole);
          }, transactionOptions);
          await waitForBlockedBackend({
            observer,
            pid: await contenderPid.promise,
          });

          releaseOwner.resolve();
          await expect(
            Promise.all([ownerTransaction, contenderTransaction]),
          ).resolves.toEqual([ownerRole, contenderRole]);
        } finally {
          releaseOwner.resolve();
          await Promise.allSettled(
            [ownerTransaction, contenderTransaction].filter(
              (transaction): transaction is Promise<string> =>
                transaction !== null,
            ),
          );
          if (memberCreated) {
            await observer.hostedMailboxItem.deleteMany({
              where: { userId: memberId },
            });
            await observer.hostedMember.deleteMany({
              where: { id: memberId },
            });
          }
          await disconnectClients([observer, owner, contender]);
        }
      },
    );

    it("takes the member owner before a participant-contact routing claim", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_linq_participant_order_${randomUUID()}`;
      const contact = createHostedLinqParticipantContact({
        kind: "email",
        value: `${randomUUID()}@example.test`,
      });
      if (!contact) {
        throw new Error("Expected the participant contact to normalize.");
      }
      const ownerLocked = createDeferred();
      const contenderPid = createDeferred<number>();
      const releaseOwner = createDeferred();
      let ownerTransaction: Promise<void> | null = null;
      let contenderTransaction: Promise<void> | null = null;
      let memberCreated = false;

      try {
        await observer.hostedMember.create({
          data: { id: memberId },
        });
        memberCreated = true;

        ownerTransaction = owner.$transaction(async (tx) => {
          await acquireHostedMemberHomeLinqRouteLockTx({
            memberId,
            prisma: tx,
          });
          ownerLocked.resolve();
          await releaseOwner.promise;
          await upsertHostedMemberPendingLinqBindingTx({
            homeLineAssignedAt: new Date(),
            linqChatId: `linq-participant-order-${randomUUID()}`,
            memberId,
            participantContact: contact,
            participantContactObservedAt: new Date(),
            prisma: tx,
            recipientPhone: "+15550100001",
          });
        }, transactionOptions);
        await ownerLocked.promise;

        contenderTransaction = contender.$transaction(async (tx) => {
          contenderPid.resolve(await readBackendPid(tx));
          await upsertHostedMemberPendingLinqParticipantContactTx({
            contact,
            memberId,
            observedAt: new Date(),
            prisma: tx,
          });
        }, transactionOptions);
        await waitForBlockedBackend({
          observer,
          pid: await contenderPid.promise,
        });

        releaseOwner.resolve();
        await expect(
          Promise.all([ownerTransaction, contenderTransaction]),
        ).resolves.toEqual([undefined, undefined]);
      } finally {
        releaseOwner.resolve();
        await Promise.allSettled(
          [ownerTransaction, contenderTransaction].filter(
            (transaction): transaction is Promise<void> =>
              transaction !== null,
          ),
        );
        if (memberCreated) {
          await observer.hostedMemberRouting.deleteMany({
            where: { memberId },
          });
          await observer.hostedMember.deleteMany({
            where: { id: memberId },
          });
        }
        await disconnectClients([observer, owner, contender]);
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
