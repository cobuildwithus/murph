import { randomUUID } from "node:crypto";

import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { resetHostedOpsMemberUsage } from "@/src/lib/hosted-ops/member-usage";
import { getHostedAiUsageMonthlyAllowanceUsdMicros } from "@/src/lib/hosted-onboarding/billing-plans";
import {
  startHostedAiUsageLimitNoticeDispatchTx,
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
    "The hosted ops usage reset PostgreSQL proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted ops usage reset PostgreSQL completion",
  () => {
    it("retains history and creates one fresh same-epoch notice attempt after reset", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_ops_usage_reset_${fixtureId}`;
      const usageId = `usage_ops_reset_${fixtureId}`;
      const periodStart = new Date("2026-07-01T00:00:00.000Z");
      const periodEnd = new Date("2026-08-01T00:00:00.000Z");
      const historicalPeriodStart = new Date("2026-06-01T00:00:00.000Z");
      const historicalPeriodEnd = periodStart;
      const firstAttemptedAt = new Date("2026-07-22T17:00:00.000Z");
      const planResetAt = new Date("2026-07-12T15:00:00.000Z");
      const resetAt = new Date("2026-07-22T18:00:00.000Z");
      const reblockedAt = new Date("2026-07-22T18:01:00.000Z");
      const secondAttemptedAt = new Date("2026-07-22T18:02:00.000Z");
      const limitUsdMicros =
        getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly");
      const usageCreditBalanceUsdMicros = 1_250_000n;
      const usageCreditLedgerVersion = 7n;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      let firstDeliveryId: string | null = null;
      let noticeLookupKey: string | null = null;

      try {
        await prisma.hostedMember.create({
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
              create: [{
                billingPlanCode: "launch_monthly",
                blockedAt: firstAttemptedAt,
                limitUsdMicros,
                periodEnd,
                periodStart,
                planResetAt,
                spentUsdMicros: limitUsdMicros,
              }, {
                billingPlanCode: "launch_monthly",
                limitUsdMicros,
                periodEnd: historicalPeriodEnd,
                periodStart: historicalPeriodStart,
                spentUsdMicros: 1_200_000n,
              }],
            },
            id: memberId,
            usageCreditBalanceUsdMicros,
            usageCreditLedgerVersion,
          },
        });
        await prisma.hostedAiUsage.create({
          data: {
            allowanceAccountedAt: firstAttemptedAt,
            allowanceCostUsdMicros: limitUsdMicros,
            allowanceCounted: true,
            allowancePeriodEnd: periodEnd,
            allowancePeriodStart: periodStart,
            attemptCount: 1,
            id: usageId,
            memberId,
            occurredAt: firstAttemptedAt,
            provider: "codex-cli",
            sessionId: `session_${fixtureId}`,
            turnId: `turn_${fixtureId}`,
          },
        });
        const immutableUsageBefore = await prisma.hostedAiUsage.findUniqueOrThrow({
          select: {
            allowanceCostUsdMicros: true,
            allowanceCounted: true,
            memberId: true,
            occurredAt: true,
          },
          where: { id: usageId },
        });
        const historicalPeriodBefore =
          await prisma.hostedAiUsagePeriod.findUniqueOrThrow({
            where: {
              memberId_periodStart: { memberId, periodStart: historicalPeriodStart },
            },
          });
        const firstClaim = await startHostedAiUsageLimitNoticeDispatchTx({
          attemptedAt: firstAttemptedAt,
          memberId,
          periodStart,
          planResetAt,
          prisma,
          source: "hosted_webhook_side_effect",
          sourceRef: `source_first_${fixtureId}`,
          targetKind: "thread",
          usageCreditLedgerVersion,
        });
        if (firstClaim.status !== "claimed") {
          throw new Error("Expected the first usage notice claim.");
        }
        noticeLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
          firstClaim.idempotencyKey,
        );
        if (!noticeLookupKey) {
          throw new Error("Expected the usage notice lookup key.");
        }
        const firstDelivery = await prisma.hostedLinqDelivery.findUniqueOrThrow({
          select: { id: true },
          where: { idempotencyKey: noticeLookupKey },
        });
        firstDeliveryId = firstDelivery.id;
        await prisma.hostedLinqDelivery.update({
          data: {
            acceptedAt: firstAttemptedAt,
            status: "accepted",
          },
          where: { id: firstDelivery.id },
        });
        const periodBeforeReset = await prisma.hostedAiUsagePeriod.findUniqueOrThrow({
          select: { updatedAt: true },
          where: {
            memberId_periodStart: { memberId, periodStart },
          },
        });

        await expect(resetHostedOpsMemberUsage({
          expectedPeriodUpdatedAt: periodBeforeReset.updatedAt,
          expectedUsageCreditLedgerVersion: usageCreditLedgerVersion,
          memberId,
          now: resetAt,
          periodStart,
        }, prisma)).resolves.toMatchObject({
          noticeClaimReleased: true,
          outcome: "reset",
          previousSpentUsdMicros: limitUsdMicros.toString(),
        });
        await expect(prisma.hostedLinqDelivery.findUnique({
          where: { id: firstDelivery.id },
        })).resolves.toMatchObject({
          id: firstDelivery.id,
          idempotencyKey: null,
          status: "accepted",
        });
        await expect(prisma.hostedAiUsage.findUniqueOrThrow({
          select: {
            allowanceCostUsdMicros: true,
            allowanceCounted: true,
            memberId: true,
            occurredAt: true,
          },
          where: { id: usageId },
        })).resolves.toEqual(immutableUsageBefore);
        await expect(prisma.hostedMember.findUniqueOrThrow({
          select: {
            usageCreditBalanceUsdMicros: true,
            usageCreditLedgerVersion: true,
          },
          where: { id: memberId },
        })).resolves.toEqual({
          usageCreditBalanceUsdMicros,
          usageCreditLedgerVersion,
        });
        await expect(prisma.hostedAiUsagePeriod.findUniqueOrThrow({
          where: {
            memberId_periodStart: { memberId, periodStart: historicalPeriodStart },
          },
        })).resolves.toEqual(historicalPeriodBefore);

        await prisma.hostedAiUsagePeriod.update({
          data: {
            blockedAt: reblockedAt,
            spentUsdMicros: limitUsdMicros,
            updatedAt: reblockedAt,
          },
          where: {
            memberId_periodStart: { memberId, periodStart },
          },
        });
        const claimInput = {
          attemptedAt: secondAttemptedAt,
          memberId,
          periodStart,
          planResetAt,
          prisma,
          source: "hosted_webhook_side_effect" as const,
          sourceRef: `source_second_${fixtureId}`,
          targetKind: "thread",
          usageCreditLedgerVersion,
        };
        const concurrentClaims = await Promise.all([
          startHostedAiUsageLimitNoticeDispatchTx(claimInput),
          startHostedAiUsageLimitNoticeDispatchTx(claimInput),
        ]);
        const claimed = concurrentClaims.filter((claim) =>
          claim.status === "claimed"
        );
        expect(claimed).toHaveLength(1);
        expect(concurrentClaims.some((claim) =>
          claim.status === "in_flight" || claim.status === "already_notified"
        )).toBe(true);
        const secondClaim = claimed[0];
        if (!secondClaim || secondClaim.status !== "claimed") {
          throw new Error("Expected one fresh usage notice attempt.");
        }
        expect(secondClaim.idempotencyKey).toBe(firstClaim.idempotencyKey);
        expect(secondClaim.providerIdempotencyKey).not.toBe(
          firstClaim.providerIdempotencyKey,
        );
        const deliveries = await prisma.hostedLinqDelivery.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            idempotencyKey: true,
          },
          where: {
            OR: [
              { id: firstDelivery.id },
              { idempotencyKey: noticeLookupKey },
            ],
          },
        });
        expect(deliveries).toHaveLength(2);
        expect(new Set(deliveries.map((delivery) => delivery.id)).size).toBe(2);
        expect(deliveries.filter((delivery) =>
          delivery.idempotencyKey === noticeLookupKey
        )).toHaveLength(1);
      } finally {
        if (noticeLookupKey || firstDeliveryId) {
          await prisma.hostedLinqDelivery.deleteMany({
            where: {
              OR: [
                ...(firstDeliveryId ? [{ id: firstDeliveryId }] : []),
                ...(noticeLookupKey
                  ? [{ idempotencyKey: noticeLookupKey }]
                  : []),
              ],
            },
          });
        }
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });
  },
);

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
