import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  lockHostedMemberRoutingStateTx,
  readHostedMemberRoutingState,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  isHostedMemberMessagingSetupRequired,
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "@/src/lib/hosted-onboarding/messaging-state";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const telegramThreadId = "456:business:setup";
const telegramUserId = "456";
const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted Telegram routing concurrency proof requires a local DATABASE_URL.",
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

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted Telegram routing PostgreSQL concurrency",
  () => {
    it.each([
      {
        contenderThreadId: null,
        owner: "inbound thread",
        ownerThreadId: telegramThreadId,
      },
      {
        contenderThreadId: telegramThreadId,
        owner: "identity sync",
        ownerThreadId: null,
      },
    ])(
      "retains the observed thread when the $owner writer acquires the row lock first",
      async ({ contenderThreadId, ownerThreadId }) => {
        const fixtureId = randomUUID();
        const memberId = `member_telegram_routing_${fixtureId}`;
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
        const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
        const ownerWritten = createDeferred();
        const releaseOwner = createDeferred();
        const contenderPid = createDeferred<number>();
        let contenderTransaction: Promise<void> | null = null;

        await observer.hostedMember.create({
          data: {
            id: memberId,
          },
        });
        await observer.$transaction(
          (tx) => upsertHostedMemberTelegramRoutingBindingTx({
            memberId,
            prisma: tx,
            telegramUserId,
          }),
          transactionOptions,
        );

        const ownerTransaction = owner.$transaction(async (tx) => {
          await lockHostedMemberRoutingStateTx({
            memberId,
            prisma: tx,
          });
          await upsertHostedMemberTelegramRoutingBindingTx({
            memberId,
            prisma: tx,
            telegramThreadId: ownerThreadId,
            telegramUserId,
          });
          ownerWritten.resolve();
          await releaseOwner.promise;
        }, transactionOptions);

        try {
          await Promise.race([ownerWritten.promise, ownerTransaction]);
          contenderTransaction = contender.$transaction(async (tx) => {
            contenderPid.resolve(await readBackendPid(tx));
            await upsertHostedMemberTelegramRoutingBindingTx({
              memberId,
              prisma: tx,
              telegramThreadId: contenderThreadId,
              telegramUserId,
            });
          }, transactionOptions);

          await waitForBlockedBackend({
            observer,
            pid: await contenderPid.promise,
          });
          releaseOwner.resolve();
          await expect(ownerTransaction).resolves.toBeUndefined();
          await expect(contenderTransaction).resolves.toBeUndefined();

          const routing = await readHostedMemberRoutingState({
            memberId,
            prisma: observer,
          });
          expect(routing?.telegramThreadId).toBe(telegramThreadId);
          expect(isHostedMemberMessagingSetupRequired({
            identity: null,
            routing,
          })).toBe(false);
          const messaging = resolveHostedMemberMessagingState({
            identity: null,
            routing,
          });
          expect(resolveHostedMemberAssistantNotificationRoute({
            linqChatId: null,
            memberId,
            messaging,
          })?.delivery).toEqual({
            kind: "thread",
            target: telegramThreadId,
          });
        } finally {
          releaseOwner.resolve();
          await Promise.allSettled([
            ownerTransaction,
            ...(contenderTransaction ? [contenderTransaction] : []),
          ]);
          await observer.hostedMember.deleteMany({
            where: {
              id: memberId,
            },
          });
          await disconnectClients([observer, owner, contender]);
        }
      },
    );
  },
);

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
  throw new Error("Expected the concurrent Telegram routing writer to wait.");
}

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
