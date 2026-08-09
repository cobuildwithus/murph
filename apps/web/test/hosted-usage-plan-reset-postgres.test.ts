import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  createAssistantUsageId,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import { describe, expect, it } from "vitest";

import {
  accountHostedAiUsageForAllowanceTx,
  reconcileHostedAiUsageAllowancePeriodForMemberTx,
  resolveHostedAiUsageGate,
} from "@/src/lib/hosted-execution/usage-allowance";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-execution/usage-limit-notice-claim";
import {
  getHostedAiUsageMonthlyAllowanceUsdMicros,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  readHostedMemberBillingSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  upsertHostedMemberTelegramRoutingBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-telegram";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  writeHostedMemberStripeBillingTx,
} from "@/src/lib/hosted-onboarding/stripe-billing-policy";
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

    it("bridges an old Web billing write without granting a second reset", async () => {
      const fixture = await createUsageResetFixture();
      const resetAt = new Date("2026-07-12T15:00:00.000Z");
      const postResetSpendUsdMicros = 700_000n;

      try {
        await fixture.observer.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE "hosted_member_billing_ref"
            SET
              "current_billing_plan_code" = 'launch_edge_monthly',
              "last_stripe_event_created_at" = ${resetAt}
            WHERE "member_id" = ${fixture.memberId}
          `;
          await tx.$executeRaw`
            UPDATE "hosted_ai_usage_period"
            SET
              "billing_plan_code" = 'launch_edge_monthly',
              "blocked_at" = NULL,
              "limit_usd_micros" = ${getHostedAiUsageMonthlyAllowanceUsdMicros("launch_edge_monthly")},
              "spent_usd_micros" = ${postResetSpendUsdMicros}
            WHERE "member_id" = ${fixture.memberId}
              AND "period_start" = ${fixture.periodStart}
          `;
        }, transactionOptions);

        await fixture.observer.$transaction(async (tx) => {
          await reconcileHostedAiUsageAllowancePeriodForMemberTx({
            memberId: fixture.memberId,
            now: new Date("2026-07-12T15:05:00.000Z"),
            tx,
          });
        }, transactionOptions);

        await expect(fixture.observer.hostedMemberBillingRef.findUniqueOrThrow({
          select: {
            usagePlanTransitionAt: true,
            usagePlanTransitionFromCode: true,
            usagePlanTransitionKind: true,
            usagePlanTransitionToCode: true,
          },
          where: { memberId: fixture.memberId },
        })).resolves.toEqual({
          usagePlanTransitionAt: resetAt,
          usagePlanTransitionFromCode: "launch_monthly",
          usagePlanTransitionKind: "plan_upgrade",
          usagePlanTransitionToCode: "launch_edge_monthly",
        });
        await expect(fixture.observer.hostedAiUsagePeriod.findUniqueOrThrow({
          select: {
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
          highestBillingPlanCode: "launch_edge_monthly",
          planResetAt: resetAt,
          spentUsdMicros: postResetSpendUsdMicros,
        });
      } finally {
        await cleanupUsageResetFixture(fixture);
      }
    });

    it.each(["direct", "family"] as const)(
      "seeds an old Web %s allowance insert and separates reused-child turns across the cutover",
      async (allowanceSource) => {
        const fixture = await createUsageResetFixture();
        const resetAt = new Date("2026-07-12T15:00:00.000Z");
        const downgradeAt = new Date("2026-07-12T15:10:00.000Z");
        const reupgradeAt = new Date("2026-07-12T15:15:00.000Z");
        const postResetRecord: AssistantUsageRecord = {
          ...fixture.record,
          occurredAt: "2026-07-12T15:00:01.000Z",
          providerRequestId: null,
          providerRequestOrdinal: 1,
          usageId: createAssistantUsageId({
            attemptCount: fixture.record.attemptCount,
            providerRequestOrdinal: 1,
            turnId: fixture.record.turnId,
          }),
        };
        const groupId = "family_old_writer_" + randomUUID();
        const membershipId = "family_old_writer_membership_" + randomUUID();
        const ownerMemberId = "family_old_writer_owner_" + randomUUID();

        try {
          await fixture.observer.hostedAiUsagePeriod.delete({
            where: {
              memberId_periodStart: {
                memberId: fixture.memberId,
                periodStart: fixture.periodStart,
              },
            },
          });
          await fixture.observer.$executeRaw`
            INSERT INTO "hosted_ai_usage_period" (
              "member_id",
              "period_start",
              "period_end",
              "billing_plan_code",
              "limit_usd_micros",
              "spent_usd_micros",
              "blocked_at",
              "updated_at"
            ) VALUES (
              ${fixture.memberId},
              ${fixture.periodStart},
              ${fixture.periodEnd},
              'launch_monthly',
              ${getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly")},
              ${6_000_000n},
              ${new Date("2026-07-12T14:58:00.000Z")},
              ${new Date("2026-07-12T14:59:00.000Z")}
            )
          `;
          await expect(fixture.observer.hostedAiUsagePeriod.findUniqueOrThrow({
            select: { highestBillingPlanCode: true, planResetAt: true },
            where: {
              memberId_periodStart: {
                memberId: fixture.memberId,
                periodStart: fixture.periodStart,
              },
            },
          })).resolves.toEqual({
            highestBillingPlanCode: "launch_monthly",
            planResetAt: null,
          });

          if (allowanceSource === "direct") {
            await applyOldWebDirectPlanTransition({
              at: resetAt,
              memberId: fixture.memberId,
              planCode: "launch_edge_monthly",
              prisma: fixture.observer,
            });
          } else {
            await fixture.observer.hostedMember.create({
              data: { id: ownerMemberId },
            });
            await fixture.observer.hostedMemberBillingRef.update({
              data: { currentBillingPhase: null },
              where: { memberId: fixture.memberId },
            });
            await fixture.observer.hostedAccountGroup.create({
              data: {
                billingStatus: HostedBillingStatus.active,
                id: groupId,
                memberships: {
                  create: {
                    id: membershipId,
                    memberId: fixture.memberId,
                    planCode: "pulse",
                    role: "member",
                    status: "active",
                  },
                },
                ownerMemberId,
              },
            });
            await applyOldWebFamilyPlanTransition({
              at: resetAt,
              membershipId,
              planCode: "edge",
              prisma: fixture.observer,
            });
          }

          await expect(resolveHostedAiUsageGate({
            memberId: fixture.memberId,
            now: "2026-07-12T15:00:05.000Z",
            prisma: fixture.observer,
          })).resolves.toMatchObject({
            allowed: true,
            billingPlanCode: "launch_edge_monthly",
            spentUsdMicros: 0n,
          });
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

          await fixture.observer.$transaction(async (tx) => {
            await accountHostedAiUsageForAllowanceTx({
              memberId: fixture.memberId,
              now: new Date("2026-07-12T15:00:06.000Z"),
              record: fixture.record,
              tx,
            });
          }, transactionOptions);
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
          await insertUsageResetRecord({
            prisma: fixture.observer,
            record: postResetRecord,
          });
          await fixture.observer.$transaction(async (tx) => {
            await accountHostedAiUsageForAllowanceTx({
              memberId: fixture.memberId,
              now: new Date("2026-07-12T15:00:07.000Z"),
              record: postResetRecord,
              tx,
            });
          }, transactionOptions);

          const [preResetUsage, postResetUsage, periodAfterPostResetUsage] =
            await Promise.all([
              fixture.observer.hostedAiUsage.findUniqueOrThrow({
                select: {
                  allowanceCounted: true,
                  allowancePricingSnapshotJson: true,
                  providerRequestOrdinal: true,
                  turnId: true,
                },
                where: { id: fixture.record.usageId },
              }),
              fixture.observer.hostedAiUsage.findUniqueOrThrow({
                select: {
                  allowanceCounted: true,
                  providerRequestOrdinal: true,
                  turnId: true,
                },
                where: { id: postResetRecord.usageId },
              }),
              fixture.observer.hostedAiUsagePeriod.findUniqueOrThrow({
                select: { spentUsdMicros: true },
                where: {
                  memberId_periodStart: {
                    memberId: fixture.memberId,
                    periodStart: fixture.periodStart,
                  },
                },
              }),
            ]);
          expect(preResetUsage).toMatchObject({
            allowanceCounted: false,
            allowancePricingSnapshotJson: {
              allowanceDisposition: "forgiven_plan_reset",
              planResetAt: resetAt.toISOString(),
            },
            providerRequestOrdinal: 0,
            turnId: fixture.record.turnId,
          });
          expect(postResetUsage).toMatchObject({
            allowanceCounted: true,
            providerRequestOrdinal: 1,
            turnId: fixture.record.turnId,
          });
          expect(periodAfterPostResetUsage.spentUsdMicros).toBeGreaterThan(0n);
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

          if (allowanceSource === "direct") {
            await applyOldWebDirectPlanTransition({
              at: downgradeAt,
              memberId: fixture.memberId,
              planCode: "launch_monthly",
              prisma: fixture.observer,
            });
          } else {
            await applyOldWebFamilyPlanTransition({
              at: downgradeAt,
              membershipId,
              planCode: "pulse",
              prisma: fixture.observer,
            });
          }
          await resolveHostedAiUsageGate({
            memberId: fixture.memberId,
            now: downgradeAt.toISOString(),
            prisma: fixture.observer,
          });

          if (allowanceSource === "direct") {
            await applyOldWebDirectPlanTransition({
              at: reupgradeAt,
              memberId: fixture.memberId,
              planCode: "launch_edge_monthly",
              prisma: fixture.observer,
            });
          } else {
            await applyOldWebFamilyPlanTransition({
              at: reupgradeAt,
              membershipId,
              planCode: "edge",
              prisma: fixture.observer,
            });
          }
          await resolveHostedAiUsageGate({
            memberId: fixture.memberId,
            now: reupgradeAt.toISOString(),
            prisma: fixture.observer,
          });

          await expect(fixture.observer.hostedAiUsagePeriod.findUniqueOrThrow({
            select: {
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
            highestBillingPlanCode: "launch_edge_monthly",
            planResetAt: resetAt,
            spentUsdMicros: periodAfterPostResetUsage.spentUsdMicros,
          });
        } finally {
          await fixture.observer.hostedAccountGroup.deleteMany({
            where: { id: groupId },
          });
          await fixture.observer.hostedMember.deleteMany({
            where: { id: ownerMemberId },
          });
          await cleanupUsageResetFixture(fixture);
        }
      },
    );

    it("captures an old Web Family membership cutover", async () => {
      const fixture = await createUsageResetFixture();
      const groupId = "family_plan_reset_" + randomUUID();
      const membershipId = "family_membership_plan_reset_" + randomUUID();
      const resetAt = new Date("2026-07-12T15:00:00.000Z");

      try {
        await fixture.observer.hostedAccountGroup.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: groupId,
            memberships: {
              create: {
                id: membershipId,
                memberId: fixture.memberId,
                planCode: "pulse",
                role: "member",
                status: "active",
              },
            },
            ownerMemberId: fixture.memberId,
          },
        });
        await fixture.observer.$executeRaw`
          UPDATE "hosted_account_group_membership"
          SET
            "plan_code" = 'edge',
            "updated_at" = ${resetAt}
          WHERE "id" = ${membershipId}
        `;

        await expect(
          fixture.observer.hostedAccountGroupMembership.findUniqueOrThrow({
            select: {
              usagePlanTransitionAt: true,
              usagePlanTransitionFromCode: true,
              usagePlanTransitionKind: true,
              usagePlanTransitionToCode: true,
            },
            where: { id: membershipId },
          }),
        ).resolves.toEqual({
          usagePlanTransitionAt: resetAt,
          usagePlanTransitionFromCode: "launch_monthly",
          usagePlanTransitionKind: "plan_upgrade",
          usagePlanTransitionToCode: "launch_edge_monthly",
        });
      } finally {
        await fixture.observer.hostedAccountGroup.deleteMany({
          where: { id: groupId },
        });
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
  const member = await readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (!member) {
    throw new Error("Hosted member fixture disappeared before plan reset.");
  }
  await writeHostedMemberStripeBillingTx({
    billingStatus: HostedBillingStatus.active,
    canonicalBillingStatus: HostedBillingStatus.active,
    currentBillingPhase: "paid",
    currentBillingPlanCode: "launch_edge_monthly",
    currentPeriodEnd: member.billingRef?.currentPeriodEnd ?? null,
    currentPeriodStart: member.billingRef?.currentPeriodStart ?? null,
    dispatchContext: {
      eventCreatedAt: input.resetAt,
      occurredAt: input.resetAt.toISOString(),
      sourceEventId: `evt_plan_reset_${input.memberId}`,
      sourceType: "stripe.customer.subscription.updated",
    },
    member,
    tx: input.tx,
  });
  await reconcileHostedAiUsageAllowancePeriodForMemberTx({
    memberId: input.memberId,
    now: input.resetAt,
    tx: input.tx,
  });
}

async function applyOldWebDirectPlanTransition(input: {
  at: Date;
  memberId: string;
  planCode: "launch_edge_monthly" | "launch_monthly";
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.$executeRaw`
    UPDATE "hosted_member_billing_ref"
    SET
      "current_billing_plan_code" = ${input.planCode},
      "last_stripe_event_created_at" = ${input.at}
    WHERE "member_id" = ${input.memberId}
  `;
}

async function applyOldWebFamilyPlanTransition(input: {
  at: Date;
  membershipId: string;
  planCode: "edge" | "max" | "pulse";
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.$executeRaw`
    UPDATE "hosted_account_group_membership"
    SET
      "plan_code" = ${input.planCode},
      "updated_at" = ${input.at}
    WHERE "id" = ${input.membershipId}
  `;
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
  await insertUsageResetRecord({
    prisma: observer,
    record,
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

async function insertUsageResetRecord(input: {
  prisma: PrismaClient;
  record: AssistantUsageRecord;
}): Promise<void> {
  const { record } = input;
  if (!record.memberId) {
    throw new Error("Usage reset proof records require a member id.");
  }
  await input.prisma.hostedAiUsage.create({
    data: {
      attemptCount: record.attemptCount,
      cachedInputTokens: record.cachedInputTokens,
      credentialSource: record.credentialSource,
      id: record.usageId,
      inputTokens: record.inputTokens,
      memberId: record.memberId,
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
