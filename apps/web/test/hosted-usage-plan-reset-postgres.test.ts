import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type {
  AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import { describe, expect, it } from "vitest";

import {
  accountHostedAiUsageForAllowanceTx,
  reconcileHostedAiUsageAllowancePeriodForMemberTx,
} from "@/src/lib/hosted-execution/usage-allowance";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-execution/usage-limit-notice-claim";
import {
  getHostedAiUsageMonthlyAllowanceUsdMicros,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  upsertHostedMemberTelegramRoutingBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-telegram";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error(
    "The hosted plan-reset PostgreSQL proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type UsageResetFixture = {
  memberId: string;
  observer: PrismaClient;
  periodEnd: Date;
  periodStart: Date;
  record: AssistantUsageRecord;
  resetClient: PrismaClient;
  usageClient: PrismaClient;
  usageId: string;
};

const transactionOptions = {
  maxWait: 10_000,
  timeout: 20_000,
} as const;

describe.skipIf(!runPostgresProof)(
  "hosted plan-reset PostgreSQL ordering",
  () => {
    it.each([
      {
        expectedAllowanceCounted: false,
        ordering: "reset_first" as const,
      },
      {
        expectedAllowanceCounted: true,
        ordering: "usage_first" as const,
      },
    ])(
      "finishes with zero Edge spend when $ordering wins the member lock",
      async ({ expectedAllowanceCounted, ordering }) => {
        const fixture = await createUsageResetFixture();
        const resetAt = new Date("2026-07-12T15:00:00.000Z");

        try {
          if (ordering === "reset_first") {
            await runResetFirstOrdering({ fixture, resetAt });
          } else {
            await runUsageFirstOrdering({ fixture, resetAt });
          }

          await expect(fixture.observer.hostedAiUsagePeriod.findUniqueOrThrow({
            select: {
              billingPlanCode: true,
              blockedAt: true,
              highestBillingPlanCode: true,
              planResetAt: true,
              spentUsdMicros: true,
            },
            where: {
              memberId_periodStart: {
                memberId: fixture.memberId,
                periodStart: fixture.periodStart,
              },
            },
          })).resolves.toEqual({
            billingPlanCode: "launch_edge_monthly",
            blockedAt: null,
            highestBillingPlanCode: "launch_edge_monthly",
            planResetAt: resetAt,
            spentUsdMicros: 0n,
          });
          const usage = await fixture.observer.hostedAiUsage.findUniqueOrThrow({
            select: {
              allowanceAccountedAt: true,
              allowanceCostUsdMicros: true,
              allowanceCounted: true,
              occurredAt: true,
            },
            where: { id: fixture.usageId },
          });
          expect(usage).toMatchObject({
            allowanceAccountedAt: expect.any(Date),
            allowanceCounted: expectedAllowanceCounted,
            occurredAt: new Date(fixture.record.occurredAt),
          });
          expect(usage.allowanceCostUsdMicros).toBeGreaterThan(0n);
          await expect(fixture.observer.hostedMember.findUniqueOrThrow({
            select: {
              usageCreditBalanceUsdMicros: true,
              usageCreditLedgerVersion: true,
            },
            where: { id: fixture.memberId },
          })).resolves.toEqual({
            usageCreditBalanceUsdMicros: 1_000_000n,
            usageCreditLedgerVersion: 3n,
          });
        } finally {
          await cleanupUsageResetFixture(fixture);
        }
      },
    );

    it("rejects a stale notice candidate and grants the reset epoch a fresh identity", async () => {
      const fixture = await createUsageResetFixture();
      const resetAt = new Date("2026-07-12T15:00:00.000Z");
      const attemptedAt = new Date("2026-07-12T16:00:00.000Z");
      const telegramThreadId = randomUUID();
      let deliveryIdempotencyKey: string | null = null;

      try {
        await fixture.observer.$transaction(async (tx) => {
          await upsertHostedMemberTelegramRoutingBindingTx({
            memberId: fixture.memberId,
            prisma: tx,
            telegramThreadId,
            telegramUserId: randomUUID(),
          });
          await applyEdgePlanReset({
            memberId: fixture.memberId,
            resetAt,
            tx,
          });
        }, transactionOptions);

        const staleKey = buildHostedAiUsageGateNoticeIdempotencyKey({
          memberId: fixture.memberId,
          periodStart: fixture.periodStart,
          usageCreditLedgerVersion: 3n,
        });
        await expect(startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
          attemptedAt,
          memberId: fixture.memberId,
          noticeDeliveryTarget: {
            channel: "telegram",
            replyToMessageId: "stale-reset-notice",
            target: telegramThreadId,
          },
          periodStart: fixture.periodStart,
          planResetAt: null,
          prisma: fixture.observer,
          source: "hosted_runtime_ai_usage_limit_notice",
          sourceRef: "stale_" + fixture.memberId,
          targetKind: "telegram_thread",
          usageCreditLedgerVersion: 3n,
        })).resolves.toEqual({ status: "already_notified" });
        const staleLookupKey =
          createHostedLinqDeliveryIdempotencyLookupKey(staleKey);
        if (!staleLookupKey) {
          throw new Error("Expected a stale usage notice lookup key.");
        }
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          where: { idempotencyKey: staleLookupKey },
        })).resolves.toBeNull();

        const edgeLimit =
          getHostedAiUsageMonthlyAllowanceUsdMicros("launch_edge_monthly");
        await fixture.observer.hostedAiUsagePeriod.update({
          data: {
            blockedAt: attemptedAt,
            spentUsdMicros: edgeLimit,
          },
          where: {
            memberId_periodStart: {
              memberId: fixture.memberId,
              periodStart: fixture.periodStart,
            },
          },
        });
        const freshClaim =
          await startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
            attemptedAt,
            memberId: fixture.memberId,
            noticeDeliveryTarget: {
              channel: "telegram",
              replyToMessageId: "fresh-reset-notice",
              target: telegramThreadId,
            },
            periodStart: fixture.periodStart,
            planResetAt: resetAt,
            prisma: fixture.observer,
            source: "hosted_runtime_ai_usage_limit_notice",
            sourceRef: "fresh_" + fixture.memberId,
            targetKind: "telegram_thread",
            usageCreditLedgerVersion: 3n,
          });
        expect(freshClaim.status).toBe("claimed");
        if (freshClaim.status !== "claimed") {
          throw new Error("Expected the reset-epoch usage notice claim.");
        }
        deliveryIdempotencyKey = freshClaim.idempotencyKey;
        expect(freshClaim.idempotencyKey).not.toBe(staleKey);
      } finally {
        if (deliveryIdempotencyKey) {
          const lookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
            deliveryIdempotencyKey,
          );
          if (lookupKey) {
            await fixture.observer.hostedLinqDelivery.deleteMany({
              where: { idempotencyKey: lookupKey },
            });
          }
        }
        await cleanupUsageResetFixture(fixture);
      }
    });
  },
);

async function runResetFirstOrdering(input: {
  fixture: UsageResetFixture;
  resetAt: Date;
}): Promise<void> {
  const resetApplied = createDeferred<void>();
  const releaseReset = createDeferred<void>();
  const resetTransaction = input.fixture.resetClient.$transaction(async (tx) => {
    await applyEdgePlanReset({
      memberId: input.fixture.memberId,
      resetAt: input.resetAt,
      tx,
    });
    resetApplied.resolve();
    await releaseReset.promise;
  }, transactionOptions);
  await resetApplied.promise;

  const usagePid = createDeferred<number>();
  const usageTransaction = input.fixture.usageClient.$transaction(async (tx) => {
    usagePid.resolve(await readBackendPid(tx));
    return await accountHostedAiUsageForAllowanceTx({
      memberId: input.fixture.memberId,
      now: new Date("2026-07-12T15:00:05.000Z"),
      record: input.fixture.record,
      tx,
    });
  }, transactionOptions);
  await waitForBlockedBackend({
    observer: input.fixture.observer,
    pid: await usagePid.promise,
  });
  releaseReset.resolve();
  await Promise.all([resetTransaction, usageTransaction]);
}

async function runUsageFirstOrdering(input: {
  fixture: UsageResetFixture;
  resetAt: Date;
}): Promise<void> {
  const usageAccounted = createDeferred<void>();
  const releaseUsage = createDeferred<void>();
  const usageTransaction = input.fixture.usageClient.$transaction(async (tx) => {
    await accountHostedAiUsageForAllowanceTx({
      memberId: input.fixture.memberId,
      now: new Date("2026-07-12T15:00:05.000Z"),
      record: input.fixture.record,
      tx,
    });
    usageAccounted.resolve();
    await releaseUsage.promise;
  }, transactionOptions);
  await usageAccounted.promise;

  const resetPid = createDeferred<number>();
  const resetTransaction = input.fixture.resetClient.$transaction(async (tx) => {
    resetPid.resolve(await readBackendPid(tx));
    await applyEdgePlanReset({
      memberId: input.fixture.memberId,
      resetAt: input.resetAt,
      tx,
    });
  }, transactionOptions);
  await waitForBlockedBackend({
    observer: input.fixture.observer,
    pid: await resetPid.promise,
  });
  releaseUsage.resolve();
  await Promise.all([usageTransaction, resetTransaction]);
}

async function applyEdgePlanReset(input: {
  memberId: string;
  resetAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedMemberBillingRef.update({
    data: {
      currentBillingPlanCode: "launch_edge_monthly",
      updatedAt: input.resetAt,
    },
    where: { memberId: input.memberId },
  });
  await reconcileHostedAiUsageAllowancePeriodForMemberTx({
    memberId: input.memberId,
    now: input.resetAt,
    tx: input.tx,
  });
}

async function createUsageResetFixture(): Promise<UsageResetFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL ordering proof.");
  }
  const fixtureId = randomUUID();
  const memberId = "member_plan_reset_" + fixtureId;
  const usageId = "usage_plan_reset_" + fixtureId;
  const periodStart = new Date("2026-07-01T00:00:00.000Z");
  const periodEnd = new Date("2026-08-01T00:00:00.000Z");
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const resetClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const usageClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const record = {
    apiKeyEnv: "OPENAI_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.openai.com/v1",
    cacheWriteTokens: null,
    cachedInputTokens: 12,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: [],
    inputTokens: 120,
    memberId,
    occurredAt: "2026-07-12T14:59:59.000Z",
    outputTokens: 45,
    provider: "codex-cli",
    providerName: "openai",
    providerRequestId: "request_" + fixtureId,
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: memberId,
    requestedModel: "gpt-5.6-terra",
    routeId: "primary",
    schema: "murph.assistant-usage.v1",
    servedModel: "gpt-5.6-terra",
    sessionId: "session_" + fixtureId,
    stripeMeterSource: "murph",
    surface: "hosted-runner",
    tokenPricingBasis: "standard",
    totalTokens: 165,
    triggerKind: "user-message",
    turnId: "turn_" + fixtureId,
    turnProfileJson: null,
    usageExtractionSourcePath: null,
    usageExtractionVersion: "codex-usage-v1",
    usageId,
  } satisfies AssistantUsageRecord;

  await observer.hostedMember.create({
    data: {
      billingRef: {
        create: {
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_monthly",
          currentPeriodEnd: periodEnd,
          currentPeriodStart: periodStart,
        },
      },
      billingStatus: HostedBillingStatus.active,
      hostedAiUsagePeriods: {
        create: {
          billingPlanCode: "launch_monthly",
          blockedAt: new Date("2026-07-12T14:58:00.000Z"),
          highestBillingPlanCode: "launch_monthly",
          limitUsdMicros:
            getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly"),
          periodEnd,
          periodStart,
          spentUsdMicros: 6_000_000n,
        },
      },
      id: memberId,
      usageCreditBalanceUsdMicros: 1_000_000n,
      usageCreditLedgerVersion: 3n,
    },
  });
  await observer.hostedAiUsage.create({
    data: {
      attemptCount: record.attemptCount,
      cachedInputTokens: record.cachedInputTokens,
      credentialSource: record.credentialSource,
      id: record.usageId,
      inputTokens: record.inputTokens,
      memberId,
      occurredAt: new Date(record.occurredAt),
      outputTokens: record.outputTokens,
      provider: record.provider,
      providerName: record.providerName,
      providerRequestId: record.providerRequestId,
      providerRequestOrdinal: record.providerRequestOrdinal,
      requestedModel: record.requestedModel,
      servedModel: record.servedModel,
      sessionId: record.sessionId,
      totalTokens: record.totalTokens,
      turnId: record.turnId,
      usageExtractionVersion: record.usageExtractionVersion,
    },
  });

  return {
    memberId,
    observer,
    periodEnd,
    periodStart,
    record,
    resetClient,
    usageClient,
    usageId,
  };
}

async function cleanupUsageResetFixture(
  fixture: UsageResetFixture,
): Promise<void> {
  await fixture.observer.hostedMember.deleteMany({
    where: { id: fixture.memberId },
  });
  await Promise.all([
    fixture.observer.$disconnect(),
    fixture.resetClient.$disconnect(),
    fixture.usageClient.$disconnect(),
  ]);
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid()::integer AS "pid"
  `;
  if (!row) {
    throw new Error("Expected a PostgreSQL backend id.");
  }
  return row.pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS "blocked"
    `;
    if (row?.blocked === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the contender transaction to block on the member row.");
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
