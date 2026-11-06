import { randomInt, randomUUID } from "node:crypto";

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
import { resolveHostedFamilyInviteTokenForInbound } from "@/src/lib/hosted-onboarding/family-plan";
import { removeHostedMemberLinkedAccountProjectionTx } from "@/src/lib/hosted-onboarding/linked-account-removal";
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
    it("fences an admitted DM after relink and admits a new update for the new owner", async () => {
      await withTelegramReplayFixture(async (f) => {
        const original = await f.plan(f.memberA);
        const rows = await f.rows();
        expect(rows).toHaveLength(1);
        expect(original.wakeHandoffs?.[0]?.mailboxItemId).toBe(rows[0].id);
        await f.prisma.$transaction(f.relink, transactionOptions);
        const replay = await f.plan(f.memberB);
        expect.soft(await f.prisma.hostedMailboxItem.count({ where: { userId: f.memberB } })).toBe(0);
        expectFencedTelegramReplay(replay);
        expect.soft(await f.rows()).toEqual(rows);
        const fresh = await f.plan(f.memberB, buildDirectTelegramUpdate(f.update.update_id + 1));
        expect(fresh.wakeHandoffs?.[0]?.userId).toBe(f.memberB);
        expect(await f.prisma.hostedMailboxItem.count({ where: { userId: f.memberB, dedupeKey: `telegram:update:${f.update.update_id + 1}` } })).toBe(1);
      });
    });

    it("returns the original mailbox pointer for a same-owner retry", async () => {
      await withTelegramReplayFixture(async (f) => {
        const original = await f.plan(f.memberA);
        const rows = await f.rows();
        expect(rows).toHaveLength(1);
        expect(original.wakeHandoffs?.[0]?.mailboxItemId).toBe(rows[0].id);
        const replay = await f.plan(f.memberA);
        expect(replay.wakeHandoffs?.[0]?.mailboxItemId).toBe(original.wakeHandoffs?.[0]?.mailboxItemId);
        expect(await f.rows()).toEqual(rows);
      });
    });

    it("serializes the same update on the event lock while its identity moves", async () => {
      await withTelegramReplayFixture(async (f) => {
        const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const appended = createDeferred();
        const release = createDeferred();
        const contenderPid = createDeferred<number>();
        let second: ReturnType<typeof f.plan> | undefined;
        const first = f.plan(f.memberA, f.update, {
          onPlanned: async (tx) => {
            appended.resolve();
            await release.promise;
            await f.relink(tx);
          },
        });
        try {
          await Promise.race([appended.promise, first]);
          second = f.plan(f.memberB, f.update, {
            prisma: contender,
            beforePlan: async (tx) => { contenderPid.resolve(await readBackendPid(tx)); },
          });
          // Attach a rejection handler while inspecting the blocking backend.
          void second.catch(() => undefined);
          const pid = await contenderPid.promise;
          await waitForBlockedBackend({ observer, pid });
          const locks = await observer.$queryRaw<Array<{ locktype: string }>>`
            SELECT locktype FROM pg_locks WHERE pid = ${pid} AND NOT granted
              AND classid = hashtext('mailbox-telegram-update')::oid
              AND objid = hashtext(${`telegram:update:${f.update.update_id}`})::oid
          `;
          expect(locks).toEqual([{ locktype: "advisory" }]);
          release.resolve();
          await first;
          expectFencedTelegramReplay(await second);
          expect(await f.rows()).toMatchObject([{ userId: f.memberA }]);
          expect(await f.rows()).toHaveLength(1);
        } finally {
          release.resolve();
          await Promise.allSettled([first, ...(second ? [second] : [])]);
          await disconnectClients([observer, contender]);
        }
      });
    });

    it("fences historical conflicting owners without exposing either pointer", async () => {
      await withTelegramReplayFixture(async (f) => {
        await f.plan(f.memberA);
        const [original] = await f.rows();
        await f.prisma.hostedMailboxItem.create({
          data: { ...original, id: `mailbox_conflict_${randomUUID()}`, userId: f.memberB },
        });
        await f.prisma.$transaction(f.relink, transactionOptions);
        const rows = await f.rows();
        expectFencedTelegramReplay(await f.plan(f.memberB));
        expect(await f.rows()).toEqual(rows);
      });
    });

    it("does not reinterpret an admitted DM when its text becomes a family invite", async () => {
      await withTelegramReplayFixture(async (f) => {
        const inviteCode = randomUUID();
        const groupId = `family_replay_${randomUUID()}`;
        const update = buildDirectTelegramUpdate(f.update.update_id, `family_${inviteCode}`);
        const original = await f.plan(f.memberA, update);
        const rows = await f.rows();
        expect(rows).toHaveLength(1);
        await f.prisma.hostedAccountGroup.create({ data: {
          id: groupId, ownerMemberId: f.memberB, billingStatus: HostedBillingStatus.active,
        } });
        try {
          const invite = await f.prisma.hostedAccountGroupInvite.create({ data: {
            id: `family_invite_${randomUUID()}`, groupId, inviteCode, invitedByMemberId: f.memberB,
            expiresAt: new Date("2099-01-01T00:00:00.000Z"),
          } });
          expect(await resolveHostedFamilyInviteTokenForInbound({
            prisma: f.prisma, text: update.message?.text,
          })).toBe(inviteCode);
          const replay = await f.prisma.$transaction((tx) => planHostedOnboardingTelegramWebhook({
            preparedDirectTelegramRouting: { kind: "family", telegramThreadId, telegramUserId },
            prisma: tx, update,
          }), transactionOptions);
          expectFencedTelegramReplay(replay);
          // Without a family preparation, the admitted owner still gets its original pointer.
          const sameOwner = await f.plan(f.memberA, update);
          expect(sameOwner.wakeHandoffs?.[0]?.mailboxItemId).toBe(original.wakeHandoffs?.[0]?.mailboxItemId);
          expect(await f.rows()).toEqual(rows);
          expect(await f.prisma.hostedAccountGroupInvite.findUnique({ where: { id: invite.id } })).toEqual(invite);
          expect(await f.prisma.hostedAccountGroupMembership.count({ where: { groupId } })).toBe(0);
        } finally {
          await f.prisma.hostedAccountGroup.delete({ where: { id: groupId } });
        }
      });
    });

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
  beforePlan?: (tx: Prisma.TransactionClient) => Promise<void>;
  onPlanned?: (tx: Prisma.TransactionClient) => Promise<void>;
}) {
  let preparedDirectTelegramRouting: NonNullable<
    Parameters<typeof planHostedOnboardingTelegramWebhook>[0][
      "preparedDirectTelegramRouting"
    ]
  > | undefined;
  return runHostedOnboardingWebhookTransaction(
    input.prisma,
    async (transaction) => {
      await input.beforePlan?.(transaction);
      if (!preparedDirectTelegramRouting) {
        throw new Error("Expected prepared direct Telegram routing.");
      }
      const plan = await planHostedOnboardingTelegramWebhook({
        preparedDirectTelegramRouting,
        prisma: transaction,
        update: input.update,
      });
      await input.onPlanned?.(transaction);
      return plan;
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

function buildDirectTelegramUpdate(updateId: number, text = "hello") {
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
      text,
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

type TelegramReplayFixture = Awaited<ReturnType<typeof createTelegramReplayFixture>>;

async function createTelegramReplayFixture() {
  const suffix = randomUUID();
  const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const memberA = `telegram_replay_a_${suffix}`;
  const memberB = `telegram_replay_b_${suffix}`;
  const update = buildDirectTelegramUpdate(randomInt(100_000_000, 900_000_000));
  await prisma.hostedMember.createMany({ data: [memberA, memberB].map((id) => ({
    id, billingStatus: HostedBillingStatus.active,
  })) });
  await prisma.$transaction((tx) => upsertHostedMemberTelegramRoutingBindingTx({
    memberId: memberA, prisma: tx, telegramUserId,
  }), transactionOptions);
  const relink = async (tx: Prisma.TransactionClient) => {
    expect(await removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity: telegramUserId, memberId: memberA, method: "telegram", prisma: tx,
    })).toBe(true);
    await upsertHostedMemberTelegramRoutingBindingTx({ memberId: memberB, prisma: tx, telegramUserId });
  };
  return {
    prisma, memberA, memberB, update, relink,
    rows: () => prisma.hostedMailboxItem.findMany({
      where: { dedupeKey: `telegram:update:${update.update_id}` }, orderBy: { id: "asc" },
    }),
    plan: (memberId: string, nextUpdate = update, hooks: Pick<Parameters<typeof runPreparedTelegramPlanTransaction>[0], "beforePlan" | "onPlanned"> & { prisma?: PrismaClient } = {}) => {
      const activeControlRootKeyId = `control_${memberId}`;
      const mailboxRootKeyId = `ingress_${memberId}`;
      rootAuthority.activeRootKeyIdsByDomain.set("control", [activeControlRootKeyId]);
      rootAuthority.activeRootKeyIdsByDomain.set("ingress", [mailboxRootKeyId]);
      return runPreparedTelegramPlanTransaction({
        activeControlRootKeyId, existingControlRootKeyId: null, mailboxRootKeyId,
        memberId, prisma, update: nextUpdate, ...hooks,
      });
    },
  };
}

async function withTelegramReplayFixture(run: (f: TelegramReplayFixture) => Promise<void>) {
  const f = await createTelegramReplayFixture();
  try { await run(f); } finally {
    rootAuthority.activeRootKeyIdsByDomain.clear();
    await f.prisma.hostedMember.deleteMany({ where: { id: { in: [f.memberA, f.memberB] } } });
    await f.prisma.$disconnect();
  }
}

function expectFencedTelegramReplay(plan: Awaited<ReturnType<typeof runPreparedTelegramPlanTransaction>>) {
  expect.soft(plan.response).toEqual({ ok: true, ignored: true, reason: "telegram-update-already-admitted" });
  expect.soft(plan.desiredSideEffects).toEqual([]);
  expect.soft(plan.wakeHandoffs ?? []).toEqual([]);
  expect.soft(JSON.stringify(plan)).not.toContain("mailboxItemId");
}
