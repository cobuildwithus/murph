import { randomUUID } from "node:crypto";

import {
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  type HostedCryptoDomain,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  prepareHostedDomainRootForWeb,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  prepareHostedMailboxItemAppendCrypto,
} from "@/src/lib/hosted-mailbox/store";

import {
  readHostedMemberRoutingState,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  isHostedMemberMessagingSetupRequired,
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "@/src/lib/hosted-onboarding/messaging-state";
import {
  parseHostedTelegramWebhookUpdate,
} from "@/src/lib/hosted-onboarding/telegram";
import {
  planHostedOnboardingTelegramWebhook,
} from "@/src/lib/hosted-onboarding/webhook-provider-telegram";
import {
  runHostedOnboardingWebhookTransaction,
} from "@/src/lib/hosted-onboarding/webhook-service";
import { createPrismaClient } from "@/src/lib/prisma";

const rootAuthority = vi.hoisted(() => ({
  activeRootKeyIdsByDomain: new Map<HostedCryptoDomain, string[]>(),
  lockAndReadActiveHostedDomainRootKeyIdTx: vi.fn(
    async (input: { domain: HostedCryptoDomain }) => {
      const rootKeyId = rootAuthority.activeRootKeyIdsByDomain
        .get(input.domain)?.shift();
      if (!rootKeyId) {
        throw new Error(`Missing test ${input.domain} root authority.`);
      }
      return rootKeyId;
    },
  ),
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >("@/src/lib/hosted-crypto/domain-root-store");
  return {
    ...actual,
    lockAndReadActiveHostedDomainRootKeyIdTx:
      rootAuthority.lockAndReadActiveHostedDomainRootKeyIdTx,
    revalidatePreparedHostedDomainRootForWebTx: async (
      input: Parameters<
        typeof actual.revalidatePreparedHostedDomainRootForWebTx
      >[0],
    ) => {
      const local = actual.readPreparedHostedDomainRootForWebLocal(
        input.prepared,
      );
      const activeRootKeyId = await rootAuthority
        .lockAndReadActiveHostedDomainRootKeyIdTx({
          domain: input.prepared.domain,
        });
      if (activeRootKeyId !== input.prepared.rootKeyId) {
        throw new actual.HostedDomainRootPreparationMismatchError();
      }
      return local;
    },
  };
});

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const telegramThreadId = "456:business:setup";
const telegramUserId = "456";
const replacementTelegramUserId = "789";
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
        owner: "inbound planner",
        updateId: 710_001,
      },
      {
        owner: "identity-only sync",
        updateId: 710_002,
      },
    ])(
      "retains the observed thread when the $owner acquires the member lock first",
      async ({ owner: lockOwner, updateId }) => {
        const fixtureId = randomUUID();
        const memberId = `member_telegram_routing_${fixtureId}`;
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
        const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
        const update = buildDirectTelegramUpdate(updateId);
        const inboundOwnsLock = lockOwner === "inbound planner";
        const ownerWritten = createDeferred();
        const releaseOwner = createDeferred();
        const contenderPid = createDeferred<number>();
        let contenderTransaction: Promise<void> | null = null;

        await observer.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
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
          if (inboundOwnsLock) {
            const plan = await planHostedOnboardingTelegramWebhook({
              prisma: tx,
              update,
            });
            expect(plan.response).toEqual({
              ok: true,
              reason: "wake-appended-active-member",
            });
          } else {
            await upsertHostedMemberTelegramRoutingBindingTx({
              memberId,
              prisma: tx,
              telegramUserId,
            });
          }
          ownerWritten.resolve();
          await releaseOwner.promise;
        }, transactionOptions);

        try {
          await Promise.race([ownerWritten.promise, ownerTransaction]);
          contenderTransaction = contender.$transaction(async (tx) => {
            contenderPid.resolve(await readBackendPid(tx));
            if (inboundOwnsLock) {
              await upsertHostedMemberTelegramRoutingBindingTx({
                memberId,
                prisma: tx,
                telegramUserId,
              });
            } else {
              const plan = await planHostedOnboardingTelegramWebhook({
                prisma: tx,
                update,
              });
              expect(plan.response).toEqual({
                ok: true,
                reason: "wake-appended-active-member",
              });
            }
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
          await expect(observer.hostedMailboxItem.count({
            where: {
              kind: "conversation.message",
              userId: memberId,
            },
          })).resolves.toBe(1);
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

    it("emits one route-restoration rearm across concurrent direct messages", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_telegram_route_transition_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const ownerWritten = createDeferred<boolean>();
      const releaseOwner = createDeferred();
      const contenderPid = createDeferred<number>();
      const contenderWritten = createDeferred<boolean>();
      const ownerUpdate = buildDirectTelegramUpdate(710_005);
      const contenderUpdate = buildDirectTelegramUpdate(710_006);
      let contenderTransaction: Promise<void> | null = null;

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
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
        const plan = await planHostedOnboardingTelegramWebhook({
          prisma: tx,
          update: ownerUpdate,
        });
        ownerWritten.resolve(
          plan.postCommitPhoneCallResultRecoveryMemberIds?.includes(memberId)
          ?? false,
        );
        await releaseOwner.promise;
      }, transactionOptions);

      try {
        await Promise.race([ownerWritten.promise, ownerTransaction]);
        contenderTransaction = contender.$transaction(async (tx) => {
          contenderPid.resolve(await readBackendPid(tx));
          const plan = await planHostedOnboardingTelegramWebhook({
            prisma: tx,
            update: contenderUpdate,
          });
          contenderWritten.resolve(
            plan.postCommitPhoneCallResultRecoveryMemberIds?.includes(memberId)
            ?? false,
          );
        }, transactionOptions);

        await waitForBlockedBackend({
          observer,
          pid: await contenderPid.promise,
        });
        await expect(ownerWritten.promise).resolves.toBe(true);
        releaseOwner.resolve();
        await expect(ownerTransaction).resolves.toBeUndefined();
        await expect(contenderTransaction).resolves.toBeUndefined();
        await expect(contenderWritten.promise).resolves.toBe(false);
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
    });

    it("does not let a stale inbound account undo a completed Settings relink", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_telegram_relink_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const update = buildDirectTelegramUpdate(710_003);
      const ownerWritten = createDeferred();
      const releaseOwner = createDeferred();
      const contenderPid = createDeferred<number>();
      let contenderTransaction: Promise<void> | null = null;

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
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
        await upsertHostedMemberTelegramRoutingBindingTx({
          memberId,
          prisma: tx,
          telegramUserId: replacementTelegramUserId,
        });
        ownerWritten.resolve();
        await releaseOwner.promise;
      }, transactionOptions);

      try {
        await Promise.race([ownerWritten.promise, ownerTransaction]);
        contenderTransaction = contender.$transaction(async (tx) => {
          contenderPid.resolve(await readBackendPid(tx));
          const plan = await planHostedOnboardingTelegramWebhook({
            prisma: tx,
            update,
          });
          expect(plan.response).toEqual({
            ignored: true,
            ok: true,
            reason: "telegram-binding-changed",
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
        expect(routing?.telegramUserId).toBe(replacementTelegramUserId);
        expect(routing?.telegramThreadId).toBeNull();
        await expect(observer.hostedMailboxItem.count({
          where: {
            kind: "conversation.message",
            userId: memberId,
          },
        })).resolves.toBe(0);
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
    });

    it("rolls back a route write on mailbox-root drift and commits one stable replay", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_telegram_rollback_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const update = buildDirectTelegramUpdate(710_004);
      const activeControlRootKeyId = `control_${fixtureId}`;
      const mailboxRootKeyId = `ingress_${fixtureId}`;

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
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

      try {
        const routingRecord = await observer.hostedMemberRouting.findUnique({
          select: {
            telegramUserIdEncrypted: true,
          },
          where: { memberId },
        });
        if (!routingRecord?.telegramUserIdEncrypted) {
          throw new Error("Expected an encrypted Telegram routing fixture.");
        }
        rootAuthority.activeRootKeyIdsByDomain.clear();
        rootAuthority.activeRootKeyIdsByDomain.set("control", [
          activeControlRootKeyId,
        ]);
        rootAuthority.activeRootKeyIdsByDomain.set("ingress", [
          `drifted_${mailboxRootKeyId}`,
        ]);
        await expect(runPreparedTelegramPlanTransaction({
          activeControlRootKeyId,
          existingControlRootKeyId: null,
          mailboxRootKeyId,
          memberId,
          prisma: observer,
          update,
        })).rejects.toMatchObject({
          code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
          details: {
            preparationTarget: "direct_telegram_mailbox_root",
          },
        });

        let routing = await readHostedMemberRoutingState({
          memberId,
          prisma: observer,
        });
        expect(routing?.telegramThreadId).toBeNull();
        await expect(observer.hostedMailboxItem.count({
          where: {
            kind: "conversation.message",
            userId: memberId,
          },
        })).resolves.toBe(0);

        rootAuthority.activeRootKeyIdsByDomain.clear();
        rootAuthority.activeRootKeyIdsByDomain.set("control", [
          activeControlRootKeyId,
        ]);
        rootAuthority.activeRootKeyIdsByDomain.set("ingress", [
          mailboxRootKeyId,
        ]);
        await expect(runPreparedTelegramPlanTransaction({
          activeControlRootKeyId,
          existingControlRootKeyId: null,
          mailboxRootKeyId,
          memberId,
          prisma: observer,
          update,
        })).resolves.toMatchObject({
          response: {
            ok: true,
            reason: "wake-appended-active-member",
          },
        });

        routing = await readHostedMemberRoutingState({
          memberId,
          prisma: observer,
        });
        expect(routing?.telegramThreadId).toBe(telegramThreadId);
        await expect(observer.hostedMailboxItem.count({
          where: {
            kind: "conversation.message",
            userId: memberId,
          },
        })).resolves.toBe(1);
      } finally {
        rootAuthority.activeRootKeyIdsByDomain.clear();
        await observer.hostedMember.deleteMany({
          where: {
            id: memberId,
          },
        });
        await observer.$disconnect();
      }
    });
  },
);

async function runPreparedTelegramPlanTransaction(input: {
  activeControlRootKeyId: string;
  existingControlRootKeyId: string | null;
  mailboxRootKeyId: string;
  memberId: string;
  prisma: PrismaClient;
  update: ReturnType<typeof buildDirectTelegramUpdate>;
}) {
  let preparedDirectTelegramRouting: NonNullable<
    Parameters<typeof planHostedOnboardingTelegramWebhook>[0][
      "preparedDirectTelegramRouting"
    ]
  > | undefined;
  return runHostedOnboardingWebhookTransaction(
    input.prisma,
    (transaction) => {
      if (!preparedDirectTelegramRouting) {
        throw new Error("Expected prepared direct Telegram routing.");
      }
      return planHostedOnboardingTelegramWebhook({
        preparedDirectTelegramRouting,
        prisma: transaction,
        update: input.update,
      });
    },
    async () => {
      seedPreparedTelegramRoot({
        domain: "control",
        rootKeyId: input.activeControlRootKeyId,
        userId: input.memberId,
      });
      seedPreparedTelegramRoot({
        domain: "ingress",
        rootKeyId: input.mailboxRootKeyId,
        userId: input.memberId,
      });
      const [preparedControlRoot, preparedMailboxCrypto] = await Promise.all([
        prepareHostedDomainRootForWeb({
          domain: "control",
          prepareMissing: false,
          prisma: input.prisma,
          reason: "test.direct-telegram-control-root",
          userId: input.memberId,
        }),
        prepareHostedMailboxItemAppendCrypto({
          prisma: input.prisma,
          userId: input.memberId,
        }),
      ]);
      preparedDirectTelegramRouting = {
        existingControlRootKeyId: input.existingControlRootKeyId,
        initialSenderResolution: "found",
        kind: "member",
        memberId: input.memberId,
        preparedControlRoot,
        preparedMailboxCrypto,
        senderResolution: "found",
        telegramThreadId,
        telegramUserId,
      };
    },
  );
}

function seedPreparedTelegramRoot(input: {
  domain: HostedCryptoDomain;
  rootKeyId: string;
  userId: string;
}): void {
  const timestamp = "2026-08-12T00:00:00.000Z";
  const envelope: HostedDomainRootKeyEnvelopeV1 = {
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256",
      keyVersionName: "test-authority-key",
      signature: "test-signature",
      signedAt: timestamp,
    },
    createdAt: timestamp,
    domain: input.domain,
    generation: 1,
    rootKeyId: input.rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: timestamp,
    userId: input.userId,
    wraps: [],
  };
  const pendingRoot = Promise.resolve({
    envelope,
    rootKey: new Uint8Array(32),
  });
  const cache = getHostedDomainRootUnwrapCache();
  if (!cache) {
    throw new Error("Expected a scoped hosted root cache.");
  }
  cache.set(`${input.userId}|${input.domain}|@active`, pendingRoot);
  cache.set(
    `${input.userId}|${input.domain}|${input.rootKeyId}`,
    pendingRoot,
  );
}

function buildDirectTelegramUpdate(updateId: number) {
  return parseHostedTelegramWebhookUpdate(JSON.stringify({
    message: {
      business_connection_id: "setup",
      chat: {
        id: Number(telegramUserId),
        type: "private",
      },
      date: 1_774_522_600,
      from: {
        first_name: "Test",
        id: Number(telegramUserId),
      },
      message_id: updateId,
      text: "hello",
    },
    update_id: updateId,
  }));
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
