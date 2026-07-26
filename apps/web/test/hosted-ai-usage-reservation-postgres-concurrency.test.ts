import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { describe, expect, it } from "vitest";

import { recordHostedAiUsageRecords } from "@/src/lib/hosted-execution/usage";
import {
  accountHostedAiUsageForAllowanceTx,
  HOSTED_AI_USAGE_RESERVATION_PRE_DISPATCH_TTL_MS,
  markHostedAiUsageReservationDispatched,
  readHostedAiUsageGate,
  reserveHostedImageGenerationCapacity,
  type HostedImageGenerationCapacityReservationDecision,
} from "@/src/lib/hosted-execution/usage-allowance";
import {
  grantHostedUsageCreditForPurchaseTx,
  reconcileHostedUsageCreditRefundNetReversalTx,
} from "@/src/lib/hosted-execution/usage-credits";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted AI usage reservation PostgreSQL concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type ReservationFixture = {
  blocker: PrismaClient;
  first: PrismaClient;
  memberId: string;
  observer: PrismaClient;
  second: PrismaClient;
  usageCreditPurchaseId: string | null;
};

const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

const now = new Date("2026-07-25T20:00:00.000Z");
const availableCapacityUsdMicros = 300_000n;
const periodStart = new Date("2026-07-01T00:00:00.000Z");
const periodEnd = new Date("2026-08-01T00:00:00.000Z");
const imageSpec = {
  model: "gpt-image-2",
  promptUtf8Bytes: 100,
  quality: "high",
  referenceImageCount: 0,
  size: "1024x1024",
} as const;

function buildImageUsageRecord(input: {
  memberId: string;
  occurredAt: Date;
  usageId: string;
}): AssistantUsageRecord {
  return {
    apiKeyEnv: "OPENAI_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.openai.com/v1",
    cacheWriteTokens: null,
    cachedInputTokens: 0,
    credentialSource: "platform",
    featureKey: "assistant_generated_image",
    gatewayTags: [],
    inputTokens: 1_300,
    memberId: input.memberId,
    occurredAt: input.occurredAt.toISOString(),
    outputTokens: 400,
    provider: "openai-images",
    providerName: "OpenAI Images",
    providerRequestId: `request_${randomUUID()}`,
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: {
      input_tokens: 1_300,
      input_tokens_details: {
        cached_tokens: 0,
        image_tokens: 1_000,
        text_tokens: 300,
      },
      output_tokens: 400,
      output_tokens_details: {
        image_tokens: 400,
        reasoning_tokens: 0,
        text_tokens: 0,
      },
      total_tokens: 1_700,
    },
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: input.memberId,
    requestedModel: "gpt-image-2",
    routeId: null,
    schema: "murph.assistant-usage.v1",
    servedModel: null,
    sessionId: `session_${randomUUID()}`,
    stripeMeterSource: "murph",
    surface: "hosted-runtime",
    tokenPricingBasis: "standard",
    totalTokens: 1_700,
    triggerKind: "image-generation",
    turnId: input.usageId.split(".attempt-")[0] ?? input.usageId,
    turnProfileJson: null,
    usageExtractionSourcePath: "openai.images.generate",
    usageExtractionVersion: "openai-images-v1",
    usageId: input.usageId,
  };
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createReservationFixture(input: {
  availableCapacityUsdMicros?: bigint;
  usageCreditGrantUsdMicros?: bigint;
} = {}): Promise<ReservationFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
  }

  const fixtureId = randomUUID();
  const memberId = `member_ai_reservation_${fixtureId}`;
  const fixtureAvailableCapacityUsdMicros =
    input.availableCapacityUsdMicros ?? availableCapacityUsdMicros;
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const blocker = createPrismaClient({ databaseUrl, poolMax: 1 });
  const first = createPrismaClient({ databaseUrl, poolMax: 1 });
  const second = createPrismaClient({ databaseUrl, poolMax: 1 });

  await observer.hostedMember.create({
    data: {
      billingStatus: "active",
      id: memberId,
    },
  });
  await observer.hostedMemberBillingRef.create({
    data: {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentPeriodEnd: periodEnd,
      currentPeriodStart: periodStart,
      memberId,
    },
  });
  await observer.hostedAiUsagePeriod.create({
    data: {
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 10_000_000n,
      memberId,
      periodEnd,
      periodStart,
      spentUsdMicros: 10_000_000n - fixtureAvailableCapacityUsdMicros,
    },
  });
  const usageCreditGrantUsdMicros = input.usageCreditGrantUsdMicros ?? 0n;
  let usageCreditPurchaseId: string | null = null;
  if (usageCreditGrantUsdMicros > 0n) {
    const purchaseId = `hucp_ai_reservation_${fixtureId}`;
    usageCreditPurchaseId = purchaseId;
    await observer.hostedUsageCreditPurchase.create({
      data: {
        beneficiaryMemberId: memberId,
        cashAmountMinor: 500,
        cashCurrency: "usd",
        checkoutCancelUrl: "https://example.test/settings?usage=cancelled",
        checkoutExpiresAt: new Date(now.getTime() + 30 * 60_000),
        checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v1",
        checkoutSuccessUrl: "https://example.test/settings?usage=return",
        clientRequestKey: `request:${fixtureId}`,
        grantUsdMicros: usageCreditGrantUsdMicros,
        id: purchaseId,
        offerCode: "usage_test",
        payerMemberId: memberId,
        stripeCustomerIdEncrypted: `encrypted-customer:${fixtureId}`,
        stripeCustomerLookupKey: `customer-lookup:${fixtureId}`,
        stripeLiveMode: false,
        stripePriceIdEncrypted: `encrypted-price:${fixtureId}`,
        stripePriceLookupKey: `price-lookup:${fixtureId}`,
      },
    });
    await observer.$transaction(async (tx) =>
      grantHostedUsageCreditForPurchaseTx({
        paidAt: now,
        purchaseId,
        tx,
      })
    );
  }

  return {
    blocker,
    first,
    memberId,
    observer,
    second,
    usageCreditPurchaseId,
  };
}

async function cleanupReservationFixture(
  fixture: ReservationFixture,
): Promise<void> {
  try {
    await fixture.observer.hostedUsageCreditEntry.deleteMany({
      where: { beneficiaryMemberId: fixture.memberId },
    });
    await fixture.observer.hostedUsageCreditPurchase.deleteMany({
      where: { beneficiaryMemberId: fixture.memberId },
    });
    await fixture.observer.hostedMember.deleteMany({
      where: { id: fixture.memberId },
    });
  } finally {
    await Promise.all([
      fixture.blocker.$disconnect(),
      fixture.first.$disconnect(),
      fixture.second.$disconnect(),
      fixture.observer.$disconnect(),
    ]);
  }
}

async function readBackendPid(client: PrismaClient): Promise<number> {
  const rows = await client.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function lockMember(
  tx: Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1
    FROM "hosted_member"
    WHERE "id" = ${memberId}
    FOR UPDATE
  `;
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
    "Expected the hosted AI usage reservation to wait on the member lock.",
  );
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

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted AI usage reservation PostgreSQL serialization",
  () => {
    it("serializes concurrent capacity claims and preserves exact replay", async () => {
      const fixture = await createReservationFixture();
      const firstRequestId = `turn_image_first_${randomUUID()}.attempt-1`;
      const secondRequestId = `turn_image_second_${randomUUID()}.attempt-1`;
      const memberLocked = createDeferred();
      const releaseMember = createDeferred();
      let firstReservation: Promise<
        HostedImageGenerationCapacityReservationDecision
      > | null = null;
      let secondReservation: Promise<
        HostedImageGenerationCapacityReservationDecision
      > | null = null;
      const blockerTransaction = fixture.blocker.$transaction(async (tx) => {
        await lockMember(tx, fixture.memberId);
        memberLocked.resolve();
        await releaseMember.promise;
      }, transactionOptions);

      try {
        await Promise.race([memberLocked.promise, blockerTransaction]);
        const firstPid = await readBackendPid(fixture.first);
        const secondPid = await readBackendPid(fixture.second);
        firstReservation = reserveHostedImageGenerationCapacity({
          memberId: fixture.memberId,
          now,
          prisma: fixture.first,
          requestId: firstRequestId,
          spec: imageSpec,
        });
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: firstPid,
        });
        secondReservation = reserveHostedImageGenerationCapacity({
          memberId: fixture.memberId,
          now,
          prisma: fixture.second,
          requestId: secondRequestId,
          spec: imageSpec,
        });
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: secondPid,
        });

        releaseMember.resolve();
        await blockerTransaction;
        const results = await Promise.all([
          firstReservation,
          secondReservation,
        ]);
        const reserved = results.find((result) => result.status === "reserved");
        const deferred = results.find(
          (result) => result.status === "insufficient_capacity",
        );

        expect(reserved).toMatchObject({
          status: "reserved",
        });
        expect(deferred).toMatchObject({
          status: "insufficient_capacity",
        });

        const rows = await fixture.observer.hostedAiUsageReservation.findMany({
          select: {
            estimatedCostUsdMicros: true,
            requestId: true,
          },
          where: { memberId: fixture.memberId },
        });
        expect(rows).toHaveLength(1);
        const stored = rows[0];
        if (!stored || !reserved) {
          throw new Error("Expected one persisted reservation.");
        }
        expect(stored.requestId).toBe(reserved.requestId);

        await expect(reserveHostedImageGenerationCapacity({
          memberId: fixture.memberId,
          now,
          prisma: fixture.observer,
          requestId: reserved.requestId,
          spec: imageSpec,
        })).resolves.toEqual({
          requestId: reserved.requestId,
          status: "reserved",
        });
        await expect(fixture.observer.hostedAiUsageReservation.count({
          where: { memberId: fixture.memberId },
        })).resolves.toBe(1);

        await expect(readHostedAiUsageGate({
          memberId: fixture.memberId,
          now,
          prisma: fixture.observer,
        })).resolves.toMatchObject({
          allowed: true,
          remainingUsdMicros:
            availableCapacityUsdMicros - stored.estimatedCostUsdMicros,
          spentUsdMicros: 10_000_000n - availableCapacityUsdMicros,
        });
      } finally {
        releaseMember.resolve();
        await Promise.allSettled([
          blockerTransaction,
          ...(firstReservation ? [firstReservation] : []),
          ...(secondReservation ? [secondReservation] : []),
        ]);
        await cleanupReservationFixture(fixture);
      }
    });

    it("expires abandoned claims without releasing dispatched capacity", async () => {
      const fixtureCapacityUsdMicros = 500_000n;
      const fixture = await createReservationFixture({
        availableCapacityUsdMicros: fixtureCapacityUsdMicros,
      });
      const abandonedRequestId =
        `turn_image_abandoned_${randomUUID()}.attempt-1`;
      const dispatchedRequestId =
        `turn_image_dispatched_${randomUUID()}.attempt-1`;
      const foreignMemberId = `member_ai_reservation_foreign_${randomUUID()}`;
      const foreignUsageId = `usage_ai_reservation_foreign_${randomUUID()}`;
      const wrongSettlementUsageId =
        `usage_ai_reservation_wrong_settlement_${randomUUID()}`;

      try {
        await fixture.observer.hostedMember.create({
          data: {
            billingStatus: "active",
            id: foreignMemberId,
          },
        });
        await fixture.observer.hostedAiUsage.create({
          data: {
            attemptCount: 1,
            id: foreignUsageId,
            memberId: foreignMemberId,
            occurredAt: now,
            provider: "openai",
            sessionId: `session_ai_reservation_foreign_${randomUUID()}`,
            turnId: `turn_ai_reservation_foreign_${randomUUID()}`,
          },
        });
        await fixture.observer.hostedAiUsage.create({
          data: {
            attemptCount: 1,
            id: wrongSettlementUsageId,
            memberId: fixture.memberId,
            occurredAt: now,
            provider: "openai-images",
            sessionId: `session_ai_reservation_wrong_${randomUUID()}`,
            turnId: `turn_ai_reservation_wrong_${randomUUID()}`,
          },
        });
        await expect(reserveHostedImageGenerationCapacity({
          memberId: fixture.memberId,
          now,
          prisma: fixture.first,
          requestId: abandonedRequestId,
          spec: imageSpec,
        })).resolves.toEqual({
          requestId: abandonedRequestId,
          status: "reserved",
        });
        await expect(reserveHostedImageGenerationCapacity({
          memberId: fixture.memberId,
          now,
          prisma: fixture.second,
          requestId: dispatchedRequestId,
          spec: imageSpec,
        })).resolves.toEqual({
          requestId: dispatchedRequestId,
          status: "reserved",
        });
        await expect(markHostedAiUsageReservationDispatched({
          memberId: fixture.memberId,
          now,
          prisma: fixture.observer,
          requestId: dispatchedRequestId,
        })).resolves.toEqual({
          requestId: dispatchedRequestId,
          status: "dispatched",
        });

        const gateAt = new Date(periodEnd.getTime() - 1_000);
        const staleCreatedAt = new Date(
          gateAt.getTime()
            - HOSTED_AI_USAGE_RESERVATION_PRE_DISPATCH_TTL_MS
            - 1,
        );
        await fixture.observer.hostedAiUsageReservation.updateMany({
          data: { createdAt: staleCreatedAt },
          where: {
            memberId: fixture.memberId,
            requestId: {
              in: [abandonedRequestId, dispatchedRequestId],
            },
          },
        });
        const rows = await fixture.observer.hostedAiUsageReservation.findMany({
          orderBy: { requestId: "asc" },
          select: {
            dispatchedAt: true,
            estimatedCostUsdMicros: true,
            requestId: true,
          },
          where: { memberId: fixture.memberId },
        });
        expect(rows).toHaveLength(2);
        const abandoned = rows.find(
          (reservation) => reservation.requestId === abandonedRequestId,
        );
        const dispatched = rows.find(
          (reservation) => reservation.requestId === dispatchedRequestId,
        );
        expect(abandoned?.dispatchedAt).toBeNull();
        expect(dispatched?.dispatchedAt).not.toBeNull();
        if (!dispatched) {
          throw new Error("Expected the dispatched reservation.");
        }

        await expect(readHostedAiUsageGate({
          memberId: fixture.memberId,
          now: gateAt,
          prisma: fixture.observer,
        })).resolves.toMatchObject({
          allowed: true,
          remainingUsdMicros:
            fixtureCapacityUsdMicros - dispatched.estimatedCostUsdMicros,
          spentUsdMicros: 10_000_000n - fixtureCapacityUsdMicros,
        });

        await expect(fixture.observer.hostedAiUsageReservation.update({
          data: {
            settledUsageId: `usage_ai_reservation_missing_${randomUUID()}`,
          },
          where: { requestId: dispatchedRequestId },
        })).rejects.toThrow();
        await expect(fixture.observer.hostedAiUsageReservation.update({
          data: {
            settledUsageId: foreignUsageId,
          },
          where: { requestId: dispatchedRequestId },
        })).rejects.toThrow();
        await expect(fixture.observer.hostedAiUsageReservation.update({
          data: {
            settledUsageId: wrongSettlementUsageId,
          },
          where: { requestId: dispatchedRequestId },
        })).rejects.toThrow();
        await fixture.observer.hostedAiUsage.create({
          data: {
            attemptCount: 1,
            id: dispatchedRequestId,
            memberId: fixture.memberId,
            occurredAt: now,
            provider: "openai-images",
            sessionId: `session_ai_reservation_exact_${randomUUID()}`,
            turnId: `turn_ai_reservation_exact_${randomUUID()}`,
          },
        });
        await expect(fixture.observer.hostedAiUsageReservation.update({
          data: {
            settledUsageId: dispatchedRequestId,
          },
          where: { requestId: dispatchedRequestId },
        })).resolves.toMatchObject({
          requestId: dispatchedRequestId,
          settledUsageId: dispatchedRequestId,
        });
        await expect(fixture.observer.hostedAiUsageReservation.findUniqueOrThrow({
          select: {
            settledUsageId: true,
          },
          where: { requestId: dispatchedRequestId },
        })).resolves.toEqual({
          settledUsageId: dispatchedRequestId,
        });
      } finally {
        await fixture.observer.hostedMember.deleteMany({
          where: { id: foreignMemberId },
        });
        await cleanupReservationFixture(fixture);
      }
    });

    it("refuses dispatch when a pre-dispatch refund reversal removes its capacity", async () => {
      const usageCreditGrantUsdMicros = 300_000n;
      const fixture = await createReservationFixture({
        availableCapacityUsdMicros: 0n,
        usageCreditGrantUsdMicros,
      });
      const reservationId =
        `turn_image_refund_before_dispatch_${randomUUID()}.attempt-1`;

      try {
        const usageCreditPurchaseId = fixture.usageCreditPurchaseId;
        if (!usageCreditPurchaseId) {
          throw new Error("Expected a usage-credit purchase fixture.");
        }
        await expect(reserveHostedImageGenerationCapacity({
          memberId: fixture.memberId,
          now,
          prisma: fixture.observer,
          requestId: reservationId,
          spec: imageSpec,
        })).resolves.toEqual({
          requestId: reservationId,
          status: "reserved",
        });

        await expect(fixture.observer.$transaction(
          (tx) => reconcileHostedUsageCreditRefundNetReversalTx({
            effectiveAt: now,
            purchaseId: usageCreditPurchaseId,
            sourceReferenceLookupKey: `refund_${randomUUID()}`,
            targetNetReversalUsdMicros: usageCreditGrantUsdMicros,
            tx,
          }),
          transactionOptions,
        )).resolves.toMatchObject({
          balanceUsdMicros: 0n,
          reversedNowUsdMicros: usageCreditGrantUsdMicros,
          unmetTargetUsdMicros: 0n,
        });

        await expect(markHostedAiUsageReservationDispatched({
          memberId: fixture.memberId,
          now,
          prisma: fixture.observer,
          requestId: reservationId,
        })).resolves.toEqual({
          requestId: reservationId,
          status: "not_dispatchable",
        });
        await expect(
          fixture.observer.hostedAiUsageReservation.findUniqueOrThrow({
            select: {
              dispatchedAt: true,
            },
            where: { requestId: reservationId },
          }),
        ).resolves.toEqual({
          dispatchedAt: null,
        });
      } finally {
        await cleanupReservationFixture(fixture);
      }
    });

    it("serializes credit-backed settlement and reservation in member-before-period order", async () => {
      const usageCreditGrantUsdMicros = 2_000_000n;
      const fixture = await createReservationFixture({
        availableCapacityUsdMicros: 0n,
        usageCreditGrantUsdMicros,
      });
      const settledRequestId =
        `turn_image_credit_settlement_${randomUUID()}.attempt-1`;
      const concurrentRequestId =
        `turn_image_credit_reservation_${randomUUID()}.attempt-1`;
      const memberLocked = createDeferred();
      const releaseMember = createDeferred();
      let blockerTransaction: Promise<void> | null = null;
      let concurrentReservation: Promise<
        HostedImageGenerationCapacityReservationDecision
      > | null = null;
      let settlement: Promise<unknown> | null = null;

      try {
        await expect(reserveHostedImageGenerationCapacity({
          memberId: fixture.memberId,
          now,
          prisma: fixture.observer,
          requestId: settledRequestId,
          spec: imageSpec,
        })).resolves.toEqual({
          requestId: settledRequestId,
          status: "reserved",
        });
        await expect(markHostedAiUsageReservationDispatched({
          memberId: fixture.memberId,
          now,
          prisma: fixture.observer,
          requestId: settledRequestId,
        })).resolves.toEqual({
          requestId: settledRequestId,
          status: "dispatched",
        });
        const usage = buildImageUsageRecord({
          memberId: fixture.memberId,
          occurredAt: now,
          usageId: settledRequestId,
        });
        await expect(recordHostedAiUsageRecords({
          prisma: fixture.observer,
          trustedUserId: fixture.memberId,
          usage: [usage],
        })).resolves.toEqual({
          recordedIds: [settledRequestId],
        });

        blockerTransaction = fixture.blocker.$transaction(async (tx) => {
          await lockMember(tx, fixture.memberId);
          memberLocked.resolve();
          await releaseMember.promise;
        }, transactionOptions);
        await Promise.race([memberLocked.promise, blockerTransaction]);

        const reservationPid = await readBackendPid(fixture.first);
        const settlementPid = await readBackendPid(fixture.second);
        concurrentReservation = reserveHostedImageGenerationCapacity({
          memberId: fixture.memberId,
          now,
          prisma: fixture.first,
          requestId: concurrentRequestId,
          spec: imageSpec,
        });
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: reservationPid,
        });
        settlement = fixture.second.$transaction(
          (tx) => accountHostedAiUsageForAllowanceTx({
            memberId: fixture.memberId,
            now,
            record: usage,
            reservationId: settledRequestId,
            tx,
          }),
          transactionOptions,
        );
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: settlementPid,
        });

        releaseMember.resolve();
        await blockerTransaction;
        const [reservationDecision, limitNotice] = await Promise.all([
          concurrentReservation,
          settlement,
        ]);
        expect(reservationDecision).toEqual({
          requestId: concurrentRequestId,
          status: "reserved",
        });
        expect(limitNotice).toBeNull();
        const creditProjection =
          await fixture.observer.hostedMember.findUniqueOrThrow({
          select: {
            usageCreditBalanceUsdMicros: true,
            usageCreditLedgerVersion: true,
          },
          where: { id: fixture.memberId },
        });
        expect(creditProjection.usageCreditBalanceUsdMicros)
          .toBeLessThan(usageCreditGrantUsdMicros);
        expect(creditProjection.usageCreditLedgerVersion).toBe(2n);
        await expect(fixture.observer.hostedUsageCreditEntry.count({
          where: {
            beneficiaryMemberId: fixture.memberId,
            kind: "usage_debit",
            sourceUsageId: settledRequestId,
          },
        })).resolves.toBe(1);
      } finally {
        releaseMember.resolve();
        await Promise.allSettled([
          ...(blockerTransaction ? [blockerTransaction] : []),
          ...(concurrentReservation ? [concurrentReservation] : []),
          ...(settlement ? [settlement] : []),
        ]);
        await cleanupReservationFixture(fixture);
      }
    });

    it("settles exact image usage against the captured admitted period", async () => {
      const fixture = await createReservationFixture({
        availableCapacityUsdMicros: 500_000n,
      });
      const reservationId =
        `turn_image_captured_period_${randomUUID()}.attempt-1`;
      const completedAt = new Date(periodEnd.getTime() + 5_000);
      const nextPeriodEnd = new Date("2026-09-01T00:00:00.000Z");

      try {
        await expect(reserveHostedImageGenerationCapacity({
          memberId: fixture.memberId,
          now,
          prisma: fixture.observer,
          requestId: reservationId,
          spec: imageSpec,
        })).resolves.toEqual({
          requestId: reservationId,
          status: "reserved",
        });
        await expect(markHostedAiUsageReservationDispatched({
          memberId: fixture.memberId,
          now,
          prisma: fixture.observer,
          requestId: reservationId,
        })).resolves.toEqual({
          requestId: reservationId,
          status: "dispatched",
        });
        await fixture.observer.hostedMemberBillingRef.update({
          data: {
            currentPeriodEnd: nextPeriodEnd,
            currentPeriodStart: periodEnd,
          },
          where: { memberId: fixture.memberId },
        });

        const usage = buildImageUsageRecord({
          memberId: fixture.memberId,
          occurredAt: completedAt,
          usageId: reservationId,
        });
        await expect(recordHostedAiUsageRecords({
          accountAllowance: true,
          prisma: fixture.observer,
          reservationId,
          trustedUserId: fixture.memberId,
          usage: [usage],
        })).resolves.toEqual({
          recordedIds: [reservationId],
        });
        await expect(recordHostedAiUsageRecords({
          accountAllowance: true,
          prisma: fixture.observer,
          reservationId,
          trustedUserId: fixture.memberId,
          usage: [usage],
        })).resolves.toEqual({
          recordedIds: [reservationId],
        });
        await expect(fixture.observer.hostedAiUsage.count({
          where: { id: reservationId },
        })).resolves.toBe(1);

        await expect(fixture.observer.hostedAiUsage.findUniqueOrThrow({
          select: {
            allowancePeriodEnd: true,
            allowancePeriodStart: true,
          },
          where: { id: reservationId },
        })).resolves.toEqual({
          allowancePeriodEnd: periodEnd,
          allowancePeriodStart: periodStart,
        });
        await expect(fixture.observer.hostedAiUsageReservation.findUniqueOrThrow({
          select: {
            settledUsageId: true,
          },
          where: { requestId: reservationId },
        })).resolves.toEqual({
          settledUsageId: reservationId,
        });
      } finally {
        await cleanupReservationFixture(fixture);
      }
    });
  },
);
