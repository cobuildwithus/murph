import { randomUUID } from "node:crypto";

import { HostedBillingStatus, type PrismaClient } from "@prisma/client";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { describe, expect, it } from "vitest";

import {
  HostedOpsMemberUsageResetStaleError,
  readHostedOpsMemberUsageResetAllWakeBatch,
  resetHostedOpsMemberUsage,
  resetHostedOpsMemberUsageForResetAll,
} from "@/src/lib/hosted-ops/member-usage";
import {
  accountHostedAiUsageForAllowanceTx,
  readHostedAiUsageGate,
} from "@/src/lib/hosted-execution/usage-allowance";
import { getHostedAiUsageMonthlyAllowanceUsdMicros } from "@/src/lib/hosted-onboarding/billing-plans";
import {
  startHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
  buildHostedStarterUsageLifetimePeriod,
  buildHostedStarterUsageSemanticSourceKey,
  buildHostedStarterUsageSourceReferenceLookupKey,
} from "@/src/lib/hosted-onboarding/starter-usage";
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

    it("replays one included reset receipt without clearing usage accrued after commit", async () => {
      const fixtureId = randomUUID();
      const memberId = `hbm_ops_receipt_${fixtureId}`;
      const usageId = `usage_ops_receipt_${fixtureId}`;
      const operationId = randomUUID();
      const differentOperationId = randomUUID();
      const periodStart = new Date("2026-08-01T00:00:00.000Z");
      const periodEnd = new Date("2026-09-01T00:00:00.000Z");
      const resetAt = new Date("2026-08-20T15:00:00.000Z");
      const usageAt = new Date("2026-08-20T15:01:00.000Z");
      const limitUsdMicros =
        getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const record = makeIncludedUsageRecord({
        fixtureId,
        memberId,
        occurredAt: usageAt,
        usageId,
      });

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
              create: {
                billingPlanCode: "launch_monthly",
                blockedAt: new Date(resetAt.getTime() - 60_000),
                limitUsdMicros,
                periodEnd,
                periodStart,
                spentUsdMicros: limitUsdMicros,
              },
            },
            id: memberId,
            usageCreditBalanceUsdMicros: 0n,
            usageCreditLedgerVersion: 0n,
          },
        });

        const concurrent = await Promise.all([
          resetHostedOpsMemberUsageForResetAll({
            memberId,
            now: resetAt,
            operationId,
          }, prisma),
          resetHostedOpsMemberUsageForResetAll({
            memberId,
            now: resetAt,
            operationId,
          }, prisma),
        ]);
        expect(concurrent).toEqual([
          expect.objectContaining({ outcome: "reset" }),
          expect.objectContaining({ outcome: "reset" }),
        ]);
        await expect(prisma.hostedOpsUsageResetReceipt.count({
          where: { memberId, operationId },
        })).resolves.toBe(1);

        await insertIncludedUsageRecord({ prisma, record });
        await prisma.$transaction(async (tx) => {
          await accountHostedAiUsageForAllowanceTx({
            memberId,
            now: usageAt,
            record,
            tx,
          });
        });
        const afterUsage = await prisma.hostedAiUsagePeriod.findUniqueOrThrow({
          select: {
            blockedAt: true,
            lastUsageAt: true,
            spentUsdMicros: true,
            updatedAt: true,
          },
          where: { memberId_periodStart: { memberId, periodStart } },
        });
        expect(afterUsage.spentUsdMicros).toBeGreaterThan(0n);

        await expect(resetHostedOpsMemberUsageForResetAll({
          memberId,
          now: new Date(usageAt.getTime() + 1_000),
          operationId,
        }, prisma)).resolves.toMatchObject({ outcome: "reset" });
        await expect(prisma.hostedAiUsagePeriod.findUniqueOrThrow({
          select: {
            blockedAt: true,
            lastUsageAt: true,
            spentUsdMicros: true,
            updatedAt: true,
          },
          where: { memberId_periodStart: { memberId, periodStart } },
        })).resolves.toEqual(afterUsage);

        await expect(resetHostedOpsMemberUsageForResetAll({
          memberId,
          now: new Date(usageAt.getTime() + 2_000),
          operationId: differentOperationId,
        }, prisma)).resolves.toMatchObject({ outcome: "reset" });
        await expect(prisma.hostedAiUsagePeriod.findUniqueOrThrow({
          select: { spentUsdMicros: true },
          where: { memberId_periodStart: { memberId, periodStart } },
        })).resolves.toEqual({ spentUsdMicros: 0n });
      } finally {
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });

    it("limits wake recovery to existing operation receipts when later members appear", async () => {
      const fixtureId = randomUUID();
      const receiptMemberId = `hbm_ops_wake_receipt_${fixtureId}`;
      const paidMemberId = `hbm_ops_wake_later_paid_${fixtureId}`;
      const starterMemberId = `hbm_ops_wake_later_starter_${fixtureId}`;
      const starterGrantEntryId = `huce_wake_starter_${fixtureId}`;
      const operationId = randomUUID();
      const periodStart = new Date("2026-08-01T00:00:00.000Z");
      const periodEnd = new Date("2026-09-01T00:00:00.000Z");
      const resetAt = new Date("2026-08-20T15:30:00.000Z");
      const starterPeriod = buildHostedStarterUsageLifetimePeriod();
      const paidLimitUsdMicros =
        getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: receiptMemberId,
            opsUsageResetReceipts: {
              create: {
                noticeClaimReleased: false,
                operationId,
                outcome: "unchanged",
                periodStart,
                previousSpentUsdMicros: 0n,
                resetAt,
                resetMode: "included_usage",
                runtimeRecheckRequired: true,
                updatedAt: resetAt,
                usageCreditGrantedUsdMicros: 0n,
              },
            },
          },
        });
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
              create: {
                billingPlanCode: "launch_monthly",
                blockedAt: resetAt,
                limitUsdMicros: paidLimitUsdMicros,
                periodEnd,
                periodStart,
                spentUsdMicros: paidLimitUsdMicros,
              },
            },
            id: paidMemberId,
          },
        });
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            hostedAiUsagePeriods: {
              create: {
                billingPlanCode: "launch_monthly",
                blockedAt: resetAt,
                limitUsdMicros: 0n,
                periodEnd: starterPeriod.periodEnd,
                periodStart: starterPeriod.periodStart,
                spentUsdMicros: 0n,
              },
            },
            id: starterMemberId,
            usageCreditBalanceUsdMicros: 0n,
            usageCreditLedgerVersion: 2n,
          },
        });
        await prisma.hostedUsageCreditEntry.create({
          data: {
            amountUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
            beneficiaryMemberId: starterMemberId,
            beneficiarySequence: 1n,
            effectiveAt: new Date("2026-08-01T12:00:00.000Z"),
            grant: {
              create: {
                beneficiaryMemberId: starterMemberId,
                beneficiarySequence: 1n,
                remainingUsdMicros: 0n,
              },
            },
            id: starterGrantEntryId,
            kind: "starter_grant",
            semanticSourceKey:
              buildHostedStarterUsageSemanticSourceKey(starterMemberId),
            sourceReferenceLookupKey:
              buildHostedStarterUsageSourceReferenceLookupKey(
                "web_onboarding",
              ),
          },
        });
        await prisma.hostedUsageCreditEntry.create({
          data: {
            amountUsdMicros: -HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
            beneficiaryMemberId: starterMemberId,
            beneficiarySequence: 2n,
            effectiveAt: new Date("2026-08-10T12:00:00.000Z"),
            id: `huce_wake_debit_${fixtureId}`,
            kind: "usage_debit",
            parentGrantEntryId: starterGrantEntryId,
            semanticSourceKey: `hosted-usage-credit:usage:wake:${fixtureId}`,
            sourceUsageId: `usage_wake_${fixtureId}`,
          },
        });

        await expect(readHostedOpsMemberUsageResetAllWakeBatch({
          operationId,
          prisma,
        })).resolves.toEqual({
          hasMore: false,
          receipts: [{
            memberId: receiptMemberId,
            timestamp: resetAt.toISOString(),
          }],
        });
        await expect(prisma.hostedOpsUsageResetReceipt.count({
          where: {
            memberId: { in: [paidMemberId, starterMemberId] },
            operationId,
          },
        })).resolves.toBe(0);
        await expect(prisma.hostedAiUsagePeriod.findUniqueOrThrow({
          select: {
            blockedAt: true,
            spentUsdMicros: true,
          },
          where: {
            memberId_periodStart: { memberId: paidMemberId, periodStart },
          },
        })).resolves.toEqual({
          blockedAt: resetAt,
          spentUsdMicros: paidLimitUsdMicros,
        });
        await expect(prisma.hostedMember.findUniqueOrThrow({
          select: {
            usageCreditBalanceUsdMicros: true,
            usageCreditLedgerVersion: true,
          },
          where: { id: starterMemberId },
        })).resolves.toEqual({
          usageCreditBalanceUsdMicros: 0n,
          usageCreditLedgerVersion: 2n,
        });
        await expect(prisma.hostedUsageCreditEntry.count({
          where: { beneficiaryMemberId: starterMemberId },
        })).resolves.toBe(2);
      } finally {
        await prisma.hostedUsageCreditGrant.deleteMany({
          where: { beneficiaryMemberId: starterMemberId },
        });
        await prisma.hostedUsageCreditEntry.deleteMany({
          where: { beneficiaryMemberId: starterMemberId },
        });
        await prisma.hostedMember.deleteMany({
          where: {
            id: { in: [receiptMemberId, paidMemberId, starterMemberId] },
          },
        });
        await prisma.$disconnect();
      }
    });

    it("records stable skips for paid, Family, and group allowances without a materialized period", async () => {
      const fixtureId = randomUUID();
      const ownerMemberId = `hbm_ops_no_period_owner_${fixtureId}`;
      const directMemberId = `hbm_ops_no_period_direct_${fixtureId}`;
      const familyMemberId = `hbm_ops_no_period_family_${fixtureId}`;
      const containerMemberId = `hbm_ops_no_period_container_${fixtureId}`;
      const groupId = `hbag_ops_no_period_${fixtureId}`;
      const periodStart = new Date("2026-08-01T00:00:00.000Z");
      const periodEnd = new Date("2026-09-01T00:00:00.000Z");
      const resetAt = new Date("2026-08-20T16:00:00.000Z");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const operationIds = new Map([
        [directMemberId, randomUUID()],
        [familyMemberId, randomUUID()],
        [containerMemberId, randomUUID()],
      ]);

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: ownerMemberId,
          },
        });
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
            id: directMemberId,
          },
        });
        await prisma.hostedMember.createMany({
          data: [
            { id: familyMemberId },
            { id: containerMemberId },
          ],
        });
        await prisma.hostedAccountGroup.create({
          data: {
            billingRef: {
              create: {
                billedSeatCount: 2,
                currentBillingPhase: "paid",
                currentBillingPlanCode: "launch_family_monthly",
                currentPeriodEnd: periodEnd,
                currentPeriodStart: periodStart,
              },
            },
            billingStatus: HostedBillingStatus.active,
            id: groupId,
            memberships: {
              create: [{
                id: `hbagm_ops_no_period_${fixtureId}`,
                joinedAt: periodStart,
                memberId: familyMemberId,
                planCode: "pulse",
                role: "member",
                status: "active",
              }],
            },
            ownerMemberId,
            planCapacities: {
              create: {
                billedQuantity: 2,
                planCode: "pulse",
              },
            },
          },
        });
        await prisma.hostedThreadContainer.create({
          data: {
            memberId: containerMemberId,
            monthlyUsageLimitUsdMicros: 7_500_000n,
            ownerMemberId,
          },
        });

        await expect(readHostedAiUsageGate({
          memberId: directMemberId,
          now: resetAt,
          prisma,
        })).resolves.toMatchObject({
          allowed: true,
          allowanceSource: "direct_paid_member_plan",
        });
        await expect(readHostedAiUsageGate({
          memberId: familyMemberId,
          now: resetAt,
          prisma,
        })).resolves.toMatchObject({
          allowed: true,
          allowanceSource: "family_sponsored_plan",
        });
        await expect(readHostedAiUsageGate({
          memberId: containerMemberId,
          now: resetAt,
          prisma,
        })).resolves.toMatchObject({
          allowed: true,
          allowanceSource: "thread_container",
        });

        for (const [memberId, operationId] of operationIds) {
          await expect(resetHostedOpsMemberUsageForResetAll({
            memberId,
            now: resetAt,
            operationId,
          }, prisma)).resolves.toMatchObject({
            memberId,
            outcome: "skipped",
            resetMode: null,
            runtimeRecheckRequired: false,
          });
        }

        await expect(prisma.hostedAiUsagePeriod.count({
          where: { memberId: { in: [...operationIds.keys()] } },
        })).resolves.toBe(0);
        await expect(prisma.hostedOpsUsageResetReceipt.count({
          where: { memberId: { in: [...operationIds.keys()] } },
        })).resolves.toBe(3);
      } finally {
        await prisma.hostedAccountGroup.deleteMany({ where: { id: groupId } });
        await prisma.hostedMember.deleteMany({
          where: { id: containerMemberId },
        });
        await prisma.hostedMember.deleteMany({
          where: {
            id: {
              in: [directMemberId, familyMemberId, ownerMemberId],
            },
          },
        });
        await prisma.$disconnect();
      }
    });

    it("preserves both locked orderings between a no-period reset and canonical accounting", async () => {
      const fixtureId = randomUUID();
      const resetFirstMemberId = `hbm_ops_reset_first_${fixtureId}`;
      const accountingFirstMemberId = `hbm_ops_account_first_${fixtureId}`;
      const resetFirstOperationId = randomUUID();
      const accountingFirstOperationId = randomUUID();
      const periodStart = new Date("2026-08-01T00:00:00.000Z");
      const periodEnd = new Date("2026-09-01T00:00:00.000Z");
      const resetAt = new Date("2026-08-20T16:30:00.000Z");
      const usageAt = new Date(resetAt.getTime() + 1_000);
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const resetFirstRecord = makeIncludedUsageRecord({
        fixtureId: `reset_first_${fixtureId}`,
        memberId: resetFirstMemberId,
        occurredAt: usageAt,
        usageId: `usage_ops_reset_first_${fixtureId}`,
      });
      const accountingFirstRecord = makeIncludedUsageRecord({
        fixtureId: `account_first_${fixtureId}`,
        memberId: accountingFirstMemberId,
        occurredAt: usageAt,
        usageId: `usage_ops_account_first_${fixtureId}`,
      });

      try {
        for (const memberId of [resetFirstMemberId, accountingFirstMemberId]) {
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
              id: memberId,
            },
          });
        }

        await expect(resetHostedOpsMemberUsageForResetAll({
          memberId: resetFirstMemberId,
          now: resetAt,
          operationId: resetFirstOperationId,
        }, prisma)).resolves.toMatchObject({ outcome: "skipped" });
        await insertIncludedUsageRecord({ prisma, record: resetFirstRecord });
        await prisma.$transaction(async (tx) => {
          await accountHostedAiUsageForAllowanceTx({
            memberId: resetFirstMemberId,
            now: usageAt,
            record: resetFirstRecord,
            tx,
          });
        });
        const resetFirstPeriod =
          await prisma.hostedAiUsagePeriod.findUniqueOrThrow({
            select: { spentUsdMicros: true },
            where: {
              memberId_periodStart: {
                memberId: resetFirstMemberId,
                periodStart,
              },
            },
          });
        expect(resetFirstPeriod.spentUsdMicros).toBeGreaterThan(0n);
        await expect(resetHostedOpsMemberUsageForResetAll({
          memberId: resetFirstMemberId,
          now: new Date(usageAt.getTime() + 1_000),
          operationId: resetFirstOperationId,
        }, prisma)).resolves.toMatchObject({ outcome: "skipped" });
        await expect(prisma.hostedAiUsagePeriod.findUniqueOrThrow({
          select: { spentUsdMicros: true },
          where: {
            memberId_periodStart: {
              memberId: resetFirstMemberId,
              periodStart,
            },
          },
        })).resolves.toEqual(resetFirstPeriod);

        await insertIncludedUsageRecord({
          prisma,
          record: accountingFirstRecord,
        });
        await prisma.$transaction(async (tx) => {
          await accountHostedAiUsageForAllowanceTx({
            memberId: accountingFirstMemberId,
            now: usageAt,
            record: accountingFirstRecord,
            tx,
          });
        });
        await expect(resetHostedOpsMemberUsageForResetAll({
          memberId: accountingFirstMemberId,
          now: new Date(usageAt.getTime() + 2_000),
          operationId: accountingFirstOperationId,
        }, prisma)).resolves.toMatchObject({ outcome: "reset" });
        await expect(prisma.hostedAiUsagePeriod.findUniqueOrThrow({
          select: { spentUsdMicros: true },
          where: {
            memberId_periodStart: {
              memberId: accountingFirstMemberId,
              periodStart,
            },
          },
        })).resolves.toEqual({ spentUsdMicros: 0n });
      } finally {
        await prisma.hostedMember.deleteMany({
          where: {
            id: { in: [resetFirstMemberId, accountingFirstMemberId] },
          },
        });
        await prisma.$disconnect();
      }
    });

    it("restores exhausted Starter capacity without rewriting prior credit history", async () => {
      const fixtureId = randomUUID();
      const memberId = `hbm_ops_starter_reset_${fixtureId}`;
      const originalGrantEntryId = `huce_starter_${fixtureId}`;
      const originalDebitEntryId = `huce_debit_${fixtureId}`;
      const resetAllOperationId = randomUUID();
      const resetAt = new Date("2026-08-18T15:45:00.000Z");
      const starterPeriod = buildHostedStarterUsageLifetimePeriod();
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            hostedAiUsagePeriods: {
              create: {
                billingPlanCode: "launch_monthly",
                blockedAt: new Date("2026-08-18T15:30:00.000Z"),
                limitUsdMicros: 0n,
                periodEnd: starterPeriod.periodEnd,
                periodStart: starterPeriod.periodStart,
                spentUsdMicros: 0n,
              },
            },
            id: memberId,
            usageCreditBalanceUsdMicros: 0n,
            usageCreditLedgerVersion: 2n,
          },
        });
        await prisma.hostedUsageCreditEntry.create({
          data: {
            amountUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
            beneficiaryMemberId: memberId,
            beneficiarySequence: 1n,
            effectiveAt: new Date("2026-08-01T12:00:00.000Z"),
            grant: {
              create: {
                beneficiaryMemberId: memberId,
                beneficiarySequence: 1n,
                remainingUsdMicros: 0n,
              },
            },
            id: originalGrantEntryId,
            kind: "starter_grant",
            semanticSourceKey:
              buildHostedStarterUsageSemanticSourceKey(memberId),
            sourceReferenceLookupKey:
              buildHostedStarterUsageSourceReferenceLookupKey(
                "web_onboarding",
              ),
          },
        });
        await prisma.hostedUsageCreditEntry.create({
          data: {
            amountUsdMicros: -HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
            beneficiaryMemberId: memberId,
            beneficiarySequence: 2n,
            effectiveAt: new Date("2026-08-10T12:00:00.000Z"),
            id: originalDebitEntryId,
            kind: "usage_debit",
            parentGrantEntryId: originalGrantEntryId,
            semanticSourceKey: `hosted-usage-credit:usage:${fixtureId}`,
            sourceUsageId: `usage_starter_${fixtureId}`,
          },
        });
        const periodBefore = await prisma.hostedAiUsagePeriod.findUniqueOrThrow({
          select: { updatedAt: true },
          where: {
            memberId_periodStart: {
              memberId,
              periodStart: starterPeriod.periodStart,
            },
          },
        });
        const historyBefore = await prisma.hostedUsageCreditEntry.findMany({
          orderBy: { beneficiarySequence: "asc" },
          where: { beneficiaryMemberId: memberId },
        });

        const result = await resetHostedOpsMemberUsage({
          expectedPeriodUpdatedAt: periodBefore.updatedAt,
          expectedUsageCreditLedgerVersion: 2n,
          memberId,
          now: resetAt,
          periodStart: starterPeriod.periodStart,
        }, prisma);

        expect(result).toMatchObject({
          outcome: "reset",
          resetMode: "starter_allowance",
          usageCreditGrantedUsdMicros:
            HOSTED_STARTER_USAGE_GRANT_USD_MICROS.toString(),
        });
        await expect(prisma.hostedMember.findUniqueOrThrow({
          select: {
            usageCreditBalanceUsdMicros: true,
            usageCreditLedgerVersion: true,
          },
          where: { id: memberId },
        })).resolves.toEqual({
          usageCreditBalanceUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
          usageCreditLedgerVersion: 3n,
        });
        const historyAfter = await prisma.hostedUsageCreditEntry.findMany({
          orderBy: { beneficiarySequence: "asc" },
          select: {
            amountUsdMicros: true,
            beneficiarySequence: true,
            id: true,
            kind: true,
            semanticSourceKey: true,
            sourceReferenceLookupKey: true,
          },
          where: { beneficiaryMemberId: memberId },
        });
        expect(historyAfter.slice(0, 2)).toEqual(historyBefore.map((entry) => ({
          amountUsdMicros: entry.amountUsdMicros,
          beneficiarySequence: entry.beneficiarySequence,
          id: entry.id,
          kind: entry.kind,
          semanticSourceKey: entry.semanticSourceKey,
          sourceReferenceLookupKey: entry.sourceReferenceLookupKey,
        })));
        expect(historyAfter[2]).toMatchObject({
          amountUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
          beneficiarySequence: 3n,
          kind: "starter_grant",
          semanticSourceKey:
            `hosted-ops-usage-reset:${memberId}:starter:after-ledger-2:v1`,
          sourceReferenceLookupKey: "hosted-ops-usage-reset:starter:v1",
        });
        await expect(readHostedAiUsageGate({
          memberId,
          now: resetAt,
          prisma,
        })).resolves.toMatchObject({
          allowed: true,
          allowanceSource: "direct_starter",
          remainingUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
          usageCreditLedgerVersion: 3n,
        });

        await expect(resetHostedOpsMemberUsage({
          expectedPeriodUpdatedAt: periodBefore.updatedAt,
          expectedUsageCreditLedgerVersion: 2n,
          memberId,
          now: new Date(resetAt.getTime() + 1_000),
          periodStart: starterPeriod.periodStart,
        }, prisma)).rejects.toBeInstanceOf(
          HostedOpsMemberUsageResetStaleError,
        );
        await expect(prisma.hostedUsageCreditEntry.count({
          where: {
            beneficiaryMemberId: memberId,
            sourceReferenceLookupKey: "hosted-ops-usage-reset:starter:v1",
          },
        })).resolves.toBe(1);

        const firstRecoveryGrantEntryId = historyAfter[2]?.id;
        if (!firstRecoveryGrantEntryId) {
          throw new Error("Expected the first Ops recovery grant.");
        }
        const exhaustedAgainAt = new Date(resetAt.getTime() + 2_000);
        await prisma.$transaction(async (tx) => {
          await tx.hostedUsageCreditGrant.update({
            data: { remainingUsdMicros: 0n },
            where: { entryId: firstRecoveryGrantEntryId },
          });
          await tx.hostedUsageCreditEntry.create({
            data: {
              amountUsdMicros: -HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
              beneficiaryMemberId: memberId,
              beneficiarySequence: 4n,
              effectiveAt: exhaustedAgainAt,
              id: `huce_recovery_debit_${fixtureId}`,
              kind: "usage_debit",
              parentGrantEntryId: firstRecoveryGrantEntryId,
              semanticSourceKey:
                `hosted-usage-credit:usage:ops-recovery:${fixtureId}`,
              sourceUsageId: `usage_ops_recovery_${fixtureId}`,
            },
          });
          await tx.hostedMember.update({
            data: {
              usageCreditBalanceUsdMicros: 0n,
              usageCreditLedgerVersion: 4n,
            },
            where: { id: memberId },
          });
          await tx.hostedAiUsagePeriod.update({
            data: {
              blockedAt: exhaustedAgainAt,
              updatedAt: exhaustedAgainAt,
            },
            where: {
              memberId_periodStart: {
                memberId,
                periodStart: starterPeriod.periodStart,
              },
            },
          });
        });
        const secondResult = await resetHostedOpsMemberUsageForResetAll({
          memberId,
          now: new Date(exhaustedAgainAt.getTime() + 1_000),
          operationId: resetAllOperationId,
        }, prisma);

        expect(secondResult).toMatchObject({
          outcome: "reset",
          resetMode: "starter_allowance",
        });
        await expect(prisma.hostedUsageCreditEntry.count({
          where: {
            beneficiaryMemberId: memberId,
            sourceReferenceLookupKey: "hosted-ops-usage-reset:starter:v1",
          },
        })).resolves.toBe(2);
        await expect(prisma.hostedUsageCreditEntry.findUnique({
          select: { beneficiarySequence: true },
          where: {
            semanticSourceKey:
              `hosted-ops-usage-reset-all:${resetAllOperationId}:${memberId}:starter:v1`,
          },
        })).resolves.toEqual({ beneficiarySequence: 5n });

        const resetAllGrant =
          await prisma.hostedUsageCreditEntry.findUniqueOrThrow({
            select: { id: true },
            where: {
              semanticSourceKey:
                `hosted-ops-usage-reset-all:${resetAllOperationId}:${memberId}:starter:v1`,
            },
          });
        const consumedResetAllGrantAt = new Date(
          exhaustedAgainAt.getTime() + 2_000,
        );
        await prisma.$transaction(async (tx) => {
          await tx.hostedUsageCreditGrant.update({
            data: { remainingUsdMicros: 0n },
            where: { entryId: resetAllGrant.id },
          });
          await tx.hostedUsageCreditEntry.create({
            data: {
              amountUsdMicros: -HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
              beneficiaryMemberId: memberId,
              beneficiarySequence: 6n,
              effectiveAt: consumedResetAllGrantAt,
              id: `huce_reset_all_debit_${fixtureId}`,
              kind: "usage_debit",
              parentGrantEntryId: resetAllGrant.id,
              semanticSourceKey:
                `hosted-usage-credit:usage:ops-reset-all:${fixtureId}`,
              sourceUsageId: `usage_ops_reset_all_${fixtureId}`,
            },
          });
          await tx.hostedMember.update({
            data: {
              usageCreditBalanceUsdMicros: 0n,
              usageCreditLedgerVersion: 6n,
            },
            where: { id: memberId },
          });
          await tx.hostedAiUsagePeriod.update({
            data: {
              blockedAt: consumedResetAllGrantAt,
              updatedAt: consumedResetAllGrantAt,
            },
            where: {
              memberId_periodStart: {
                memberId,
                periodStart: starterPeriod.periodStart,
              },
            },
          });
        });

        await expect(resetHostedOpsMemberUsageForResetAll({
          memberId,
          now: new Date(consumedResetAllGrantAt.getTime() + 1_000),
          operationId: resetAllOperationId,
        }, prisma)).resolves.toEqual(secondResult);
        await expect(prisma.hostedUsageCreditEntry.count({
          where: {
            beneficiaryMemberId: memberId,
            sourceReferenceLookupKey: "hosted-ops-usage-reset:starter:v1",
          },
        })).resolves.toBe(2);
        await expect(prisma.hostedMember.findUniqueOrThrow({
          select: {
            usageCreditBalanceUsdMicros: true,
            usageCreditLedgerVersion: true,
          },
          where: { id: memberId },
        })).resolves.toEqual({
          usageCreditBalanceUsdMicros: 0n,
          usageCreditLedgerVersion: 6n,
        });
      } finally {
        await prisma.hostedUsageCreditGrant.deleteMany({
          where: { beneficiaryMemberId: memberId },
        });
        await prisma.hostedUsageCreditEntry.deleteMany({
          where: {
            beneficiaryMemberId: memberId,
            parentGrantEntryId: { not: null },
          },
        });
        await prisma.hostedUsageCreditEntry.deleteMany({
          where: { beneficiaryMemberId: memberId },
        });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });
  },
);

function makeIncludedUsageRecord(input: {
  fixtureId: string;
  memberId: string;
  occurredAt: Date;
  usageId: string;
}): AssistantUsageRecord {
  return {
    apiKeyEnv: "OPENAI_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.openai.com/v1",
    cacheWriteTokens: null,
    cachedInputTokens: 12,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: [],
    inputTokens: 120,
    memberId: input.memberId,
    occurredAt: input.occurredAt.toISOString(),
    outputTokens: 45,
    provider: "codex-cli",
    providerName: "openai",
    providerRequestId: `request_${input.fixtureId}`,
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: input.memberId,
    requestedModel: "gpt-5.6-terra",
    routeId: "primary",
    schema: "murph.assistant-usage.v1",
    servedModel: "gpt-5.6-terra",
    sessionId: `session_${input.fixtureId}`,
    stripeMeterSource: "murph",
    surface: "hosted-runner",
    tokenPricingBasis: "standard",
    totalTokens: 165,
    triggerKind: "user-message",
    turnId: `turn_${input.fixtureId}`,
    turnProfileJson: null,
    usageExtractionSourcePath: null,
    usageExtractionVersion: "codex-usage-v1",
    usageId: input.usageId,
  };
}

async function insertIncludedUsageRecord(input: {
  prisma: PrismaClient;
  record: AssistantUsageRecord;
}): Promise<void> {
  const memberId = input.record.memberId;
  if (!memberId) {
    throw new Error("Included usage receipt proof requires a member id.");
  }
  await input.prisma.hostedAiUsage.create({
    data: {
      attemptCount: input.record.attemptCount,
      cachedInputTokens: input.record.cachedInputTokens,
      credentialSource: input.record.credentialSource,
      id: input.record.usageId,
      inputTokens: input.record.inputTokens,
      memberId,
      occurredAt: new Date(input.record.occurredAt),
      outputTokens: input.record.outputTokens,
      provider: input.record.provider,
      providerName: input.record.providerName,
      providerRequestId: input.record.providerRequestId,
      providerRequestOrdinal: input.record.providerRequestOrdinal,
      requestedModel: input.record.requestedModel,
      servedModel: input.record.servedModel,
      sessionId: input.record.sessionId,
      totalTokens: input.record.totalTokens,
      turnId: input.record.turnId,
      usageExtractionVersion: input.record.usageExtractionVersion,
    },
  });
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
