import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  provisionHostedCryptoDomainRootsForUserTx,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  markHostedAiUsageLimitNoticeDeliveryRetryableTx,
  startHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-execution/usage-limit-notice-claim";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  ensureHostedThreadContainerRouteTx,
} from "@/src/lib/hosted-routing/thread-container-service";
import {
  consumeHostedLinqThreadRouteParticipantAdditionPendingTx,
  lockHostedThreadRouteByThreadIdentityTx,
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
  messageClient: PrismaClient;
  observer: PrismaClient;
  ownerMemberId: string;
  participantClient: PrismaClient;
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
  await observer.$transaction(async (tx) => {
    await provisionHostedCryptoDomainRootsForUserTx({
      reason: "test.hosted-thread-route",
      tx,
      userId: containerMemberId,
    });
    await tx.hostedThreadContainer.create({
      data: {
        memberId: containerMemberId,
        ownerMemberId,
      },
    });
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
    ownerMemberId,
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
  throw new Error("Expected the PostgreSQL transaction to wait on a held lock.");
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

function configureHostedContactPrivacyKeyringForTest(currentVersion: string): void {
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = [
    `v1:${Buffer.alloc(32, 3).toString("base64url")}`,
    `v2:${Buffer.alloc(32, 4).toString("base64url")}`,
  ].join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = currentVersion;
  clearHostedOnboardingEnvCache();
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function pauseHostedThreadRouteUpdateAfterWrite(input: {
  release: Deferred<void>;
  tx: Prisma.TransactionClient;
  updated: Deferred<void>;
}): Prisma.TransactionClient {
  const hostedThreadRoute = new Proxy(input.tx.hostedThreadRoute, {
    get(target, property) {
      if (property === "update") {
        return async (args: Prisma.HostedThreadRouteUpdateArgs) => {
          const route = await target.update(args);
          input.updated.resolve();
          await input.release.promise;
          return route;
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "hostedThreadRoute") {
        return hostedThreadRoute;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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

    it("serializes a routed message behind routed usage-limit dispatch without deadlock", async () => {
      const fixture = await createRouteFixture();
      const attemptedAt = new Date("2026-07-13T12:00:00.000Z");
      const periodStart = new Date("2026-07-01T00:00:00.000Z");
      const usageSourceRef = `usage-lock-proof:${fixture.containerMemberId}`;
      const usageIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: fixture.containerMemberId,
        periodStart,
        usageCreditLedgerVersion: 0n,
      });
      const usageDeliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(usageIdempotencyKey);
      if (!usageDeliveryLookupKey) {
        throw new Error("Expected a usage-limit delivery lookup key.");
      }

      await fixture.observer.hostedThreadRoute.updateMany({
        data: { pendingParticipantAddition: true },
        where: {
          channel: "linq",
          containerMemberId: fixture.containerMemberId,
          threadIdentityLookupKey: fixture.threadIdentityLookupKey,
        },
      });
      await fixture.observer.hostedAiUsagePeriod.create({
        data: {
          billingPlanCode: "test",
          blockedAt: attemptedAt,
          limitUsdMicros: 1n,
          memberId: fixture.containerMemberId,
          periodEnd: new Date("2026-08-01T00:00:00.000Z"),
          periodStart,
        },
      });

      const usageOwnerLocked = createDeferred();
      const releaseUsageAuthorityCheck = createDeferred();
      const consumerPid = createDeferred<number>();
      let consumerTransaction: Promise<boolean> | null = null;
      let usageTransaction: Promise<Awaited<ReturnType<
        typeof startHostedAiUsageLimitNoticeDispatchTx
      >>> | null = null;

      try {
        usageTransaction = fixture.participantClient.$transaction(async (tx) => {
          return startHostedAiUsageLimitNoticeDispatchTx({
            assertDispatchAuthority: async (claimTx) => {
              usageOwnerLocked.resolve();
              await releaseUsageAuthorityCheck.promise;
              await lockHostedThreadRouteByThreadIdentityTx({
                authority: {
                  channel: "linq",
                  containerMemberId: fixture.containerMemberId,
                  threadId: fixture.threadId,
                },
                prisma: claimTx,
              });
            },
            attemptedAt,
            linqChatId: fixture.threadId,
            memberId: fixture.containerMemberId,
            periodStart,
            prisma: tx,
            source: "hosted_webhook_side_effect",
            sourceRef: usageSourceRef,
            targetKind: "thread",
            usageCreditLedgerVersion: 0n,
          });
        });

        await usageOwnerLocked.promise;
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

        releaseUsageAuthorityCheck.resolve();
        await expect(usageTransaction).resolves.toEqual({
          idempotencyKey: usageIdempotencyKey,
          providerIdempotencyKey: expect.stringMatching(
            /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
          ),
          status: "claimed",
        });
        await expect(consumerTransaction).resolves.toBe(true);

        const delivery = await fixture.observer.hostedLinqDelivery.findUnique({
          select: {
            source: true,
            status: true,
            template: true,
          },
          where: { idempotencyKey: usageDeliveryLookupKey },
        });
        expect(delivery).toEqual({
          source: "hosted_webhook_side_effect",
          status: "provider_dispatch_started",
          template: "ai_usage_quota",
        });
        await expect(readPendingParticipantAddition(fixture)).resolves.toBe(false);
      } finally {
        releaseUsageAuthorityCheck.resolve();
        await Promise.allSettled([
          ...(usageTransaction ? [usageTransaction] : []),
          ...(consumerTransaction ? [consumerTransaction] : []),
        ]);
        await fixture.observer.hostedLinqDelivery.deleteMany({
          where: { idempotencyKey: usageDeliveryLookupKey },
        });
        await fixture.observer.hostedAiUsagePeriod.deleteMany({
          where: {
            memberId: fixture.containerMemberId,
            periodStart,
          },
        });
        await cleanupRouteFixture(fixture);
      }
    });

    it("rejects stale candidates and gives a re-exhaustion crossing a fresh delivery identity", async () => {
      const fixture = await createRouteFixture();
      const attemptedAt = new Date("2026-07-13T12:00:00.000Z");
      const retryableAttemptedAt = new Date("2026-07-13T12:05:00.000Z");
      const retryAfterAt = new Date("2026-07-13T12:10:00.000Z");
      const staleRetryAttemptedAt = new Date("2026-07-13T12:15:00.000Z");
      const currentAttemptedAt = new Date("2026-07-13T12:20:00.000Z");
      const periodStart = new Date("2026-07-01T00:00:00.000Z");
      const periodEnd = new Date("2026-08-01T00:00:00.000Z");
      const retryableSourceRef = `retryable-usage:${fixture.containerMemberId}`;
      const usageIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: fixture.containerMemberId,
        periodStart,
        usageCreditLedgerVersion: 0n,
      });
      const reexhaustionSourceRef = `usage-after-plan-change:${fixture.containerMemberId}`;
      const reexhaustionIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: fixture.containerMemberId,
        periodStart,
        usageCreditLedgerVersion: 2n,
      });
      const usageDeliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(usageIdempotencyKey);
      if (!usageDeliveryLookupKey) {
        throw new Error("Expected a usage-limit delivery lookup key.");
      }
      const claimUsageNotice = (input: {
        attemptedAt: Date;
        prisma?: PrismaClient;
        sourceRef: string;
        usageCreditLedgerVersion?: bigint;
      }) => startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
        attemptedAt: input.attemptedAt,
        memberId: fixture.containerMemberId,
        noticeDeliveryTarget: {
          channel: "linq",
          replyToMessageId: input.sourceRef,
          routeAuthority: {
            channel: "linq",
            containerMemberId: fixture.containerMemberId,
            threadId: fixture.threadId,
          },
          target: fixture.threadId,
        },
        periodStart,
        prisma: input.prisma ?? fixture.participantClient,
        source: "hosted_webhook_side_effect",
        sourceRef: input.sourceRef,
        targetKind: "thread",
        usageCreditLedgerVersion: input.usageCreditLedgerVersion ?? 0n,
      });
      const setBlockedAt = (blockedAt: Date | null) =>
        fixture.observer.hostedAiUsagePeriod.update({
          data: { blockedAt },
          where: {
            memberId_periodStart: {
              memberId: fixture.containerMemberId,
              periodStart,
            },
          },
        });

      await fixture.observer.hostedMember.updateMany({
        data: { billingStatus: "active" },
        where: {
          id: {
            in: [fixture.containerMemberId, fixture.ownerMemberId],
          },
        },
      });
      await fixture.observer.hostedAiUsagePeriod.create({
        data: {
          billingPlanCode: "launch_monthly",
          blockedAt: attemptedAt,
          limitUsdMicros: 10_000_000n,
          memberId: fixture.containerMemberId,
          periodEnd,
          periodStart,
          spentUsdMicros: 10_000_000n,
        },
      });

      const candidateReady = createDeferred();
      const releaseClaim = createDeferred();
      let staleClaim: ReturnType<
        typeof startAuthorizedHostedAiUsageLimitNoticeDispatchTx
      > | null = null;

      try {
        await expect(claimUsageNotice({
          attemptedAt: new Date(periodStart.getTime() - 1),
          sourceRef: "usage-before-period",
        })).resolves.toEqual({ status: "already_notified" });
        await expect(claimUsageNotice({
          attemptedAt: periodEnd,
          sourceRef: "usage-at-period-end",
        })).resolves.toEqual({ status: "already_notified" });
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          where: { idempotencyKey: usageDeliveryLookupKey },
        })).resolves.toBeNull();

        staleClaim = (async () => {
          candidateReady.resolve();
          await releaseClaim.promise;
          return claimUsageNotice({
            attemptedAt,
            sourceRef: `usage-before-plan-change:${fixture.containerMemberId}`,
          });
        })();

        await candidateReady.promise;
        await fixture.observer.hostedAiUsagePeriod.update({
          data: {
            billingPlanCode: "launch_edge_monthly",
            blockedAt: null,
            limitUsdMicros: 25_000_000n,
          },
          where: {
            memberId_periodStart: {
              memberId: fixture.containerMemberId,
              periodStart,
            },
          },
        });
        releaseClaim.resolve();

        await expect(staleClaim).resolves.toEqual({ status: "already_notified" });
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          where: { idempotencyKey: usageDeliveryLookupKey },
        })).resolves.toBeNull();

        await setBlockedAt(retryableAttemptedAt);

        await expect(startHostedAiUsageLimitNoticeDispatchTx({
          attemptedAt: retryableAttemptedAt,
          memberId: fixture.containerMemberId,
          periodStart,
          prisma: fixture.messageClient,
          source: "hosted_runtime_ai_usage_limit_notice",
          sourceRef: retryableSourceRef,
          targetKind: "telegram_thread",
          usageCreditLedgerVersion: 0n,
        })).resolves.toEqual({
          idempotencyKey: usageIdempotencyKey,
          providerIdempotencyKey: expect.stringMatching(
            /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
          ),
          status: "claimed",
        });
        await expect(markHostedAiUsageLimitNoticeDeliveryRetryableTx({
          expectedAttemptedAt: retryableAttemptedAt,
          failedAt: retryableAttemptedAt,
          idempotencyKey: usageIdempotencyKey,
          prisma: fixture.messageClient,
          retryAfterAt,
        })).resolves.toBe(true);
        await setBlockedAt(null);

        await expect(claimUsageNotice({
          attemptedAt: staleRetryAttemptedAt,
          sourceRef: retryableSourceRef,
        })).resolves.toEqual({ status: "already_notified" });
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          select: {
            attemptedAt: true,
            retryAfterAt: true,
            status: true,
          },
          where: { idempotencyKey: usageDeliveryLookupKey },
        })).resolves.toEqual({
          attemptedAt: retryableAttemptedAt,
          retryAfterAt,
          status: "failed",
        });
        await setBlockedAt(currentAttemptedAt);
        await fixture.observer.hostedMember.update({
          data: {
            usageCreditBalanceUsdMicros: 0n,
            usageCreditLedgerVersion: 2n,
          },
          where: { id: fixture.containerMemberId },
        });

        await expect(claimUsageNotice({
          attemptedAt: currentAttemptedAt,
          prisma: fixture.messageClient,
          sourceRef: retryableSourceRef,
          usageCreditLedgerVersion: 0n,
        })).resolves.toEqual({ status: "already_notified" });

        await expect(claimUsageNotice({
          attemptedAt: currentAttemptedAt,
          prisma: fixture.messageClient,
          sourceRef: reexhaustionSourceRef,
          usageCreditLedgerVersion: 2n,
        })).resolves.toEqual({
          idempotencyKey: reexhaustionIdempotencyKey,
          providerIdempotencyKey: expect.stringMatching(
            /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
          ),
          status: "claimed",
        });
        expect(reexhaustionIdempotencyKey).not.toBe(usageIdempotencyKey);
      } finally {
        releaseClaim.resolve();
        await Promise.allSettled(staleClaim ? [staleClaim] : []);
        await fixture.observer.hostedLinqDelivery.deleteMany({
          where: {
            idempotencyKey: {
              in: [
                usageDeliveryLookupKey,
                createHostedLinqDeliveryIdempotencyLookupKey(
                  reexhaustionIdempotencyKey,
                ),
              ].filter((value): value is string => value !== null),
            },
          },
        });
        await fixture.observer.hostedAiUsagePeriod.deleteMany({
          where: {
            memberId: fixture.containerMemberId,
            periodStart,
          },
        });
        await cleanupRouteFixture(fixture);
      }
    });

    it("serializes participant-context consumption behind a route authority rekey", async () => {
      const previousPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
      const previousPrivacyCurrentVersion =
        process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
      const routeRekeyed = createDeferred();
      const releaseRouteRekey = createDeferred();
      const consumerPid = createDeferred<number>();
      let fixture: RouteFixture | null = null;
      let consumerTransaction: Promise<boolean> | null = null;
      let rekeyTransaction: ReturnType<
        typeof ensureHostedThreadContainerRouteTx
      > | null = null;

      configureHostedContactPrivacyKeyringForTest("v1");
      try {
        fixture = await createRouteFixture();
        const activeFixture = fixture;
        const priorAccountLookupKey = "account_lookup_prior";
        const priorThreadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: priorAccountLookupKey,
          channel: "linq",
          threadId: activeFixture.threadId,
        });
        if (!priorThreadLookupKey) {
          throw new Error("Expected a prior Linq thread lookup key.");
        }
        await activeFixture.observer.hostedMember.update({
          data: { billingStatus: "active" },
          where: { id: activeFixture.ownerMemberId },
        });
        await activeFixture.observer.hostedThreadRoute.update({
          data: {
            pendingParticipantAddition: true,
            threadLookupKey: priorThreadLookupKey,
          },
          where: {
            channel_threadIdentityLookupKey: {
              channel: "linq",
              threadIdentityLookupKey: activeFixture.threadIdentityLookupKey,
            },
          },
        });

        configureHostedContactPrivacyKeyringForTest("v2");
        const currentAccountLookupKey = "account_lookup_current";
        const currentThreadIdentityLookupKey =
          createHostedExternalThreadIdentityLookupKey({
            channel: "linq",
            threadId: activeFixture.threadId,
          });
        const currentThreadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: currentAccountLookupKey,
          channel: "linq",
          threadId: activeFixture.threadId,
        });
        if (!currentThreadIdentityLookupKey || !currentThreadLookupKey) {
          throw new Error("Expected current Linq thread lookup keys.");
        }

        rekeyTransaction = activeFixture.participantClient.$transaction(async (tx) => {
          return ensureHostedThreadContainerRouteTx({
            accountLookupKey: currentAccountLookupKey,
            accountLookupKeys: [
              currentAccountLookupKey,
              priorAccountLookupKey,
            ],
            channel: "linq",
            containerMemberId: activeFixture.containerMemberId,
            occurredAt: new Date("2026-07-13T12:00:00.000Z"),
            ownerMemberId: activeFixture.ownerMemberId,
            prisma: pauseHostedThreadRouteUpdateAfterWrite({
              release: releaseRouteRekey,
              tx,
              updated: routeRekeyed,
            }),
            threadId: activeFixture.threadId,
          });
        });

        await routeRekeyed.promise;
        consumerTransaction = activeFixture.messageClient.$transaction(async (tx) => {
          consumerPid.resolve(await readBackendPid(tx));
          return consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: activeFixture.containerMemberId,
            prisma: tx,
            threadId: activeFixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await consumerPid.promise,
        });

        releaseRouteRekey.resolve();
        await expect(rekeyTransaction).resolves.toMatchObject({
          containerMemberId: activeFixture.containerMemberId,
          created: false,
        });
        await expect(consumerTransaction).resolves.toBe(true);

        await expect(activeFixture.observer.hostedThreadRoute.findUnique({
          select: {
            containerMemberId: true,
            pendingParticipantAddition: true,
            threadLookupKey: true,
          },
          where: {
            channel_threadIdentityLookupKey: {
              channel: "linq",
              threadIdentityLookupKey: currentThreadIdentityLookupKey,
            },
          },
        })).resolves.toEqual({
          containerMemberId: activeFixture.containerMemberId,
          pendingParticipantAddition: false,
          threadLookupKey: currentThreadLookupKey,
        });
      } finally {
        releaseRouteRekey.resolve();
        await Promise.allSettled([
          ...(rekeyTransaction ? [rekeyTransaction] : []),
          ...(consumerTransaction ? [consumerTransaction] : []),
        ]);
        restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousPrivacyKeys);
        restoreEnvValue(
          "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
          previousPrivacyCurrentVersion,
        );
        clearHostedOnboardingEnvCache();
        if (fixture) {
          await fixture.observer.hostedThreadRoute.deleteMany({
            where: { containerMemberId: fixture.containerMemberId },
          });
          await cleanupRouteFixture(fixture);
        }
      }
    });
  },
);
