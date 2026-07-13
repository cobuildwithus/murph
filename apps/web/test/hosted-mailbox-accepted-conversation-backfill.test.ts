import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  backfillHostedAcceptedConversationAllowancePeriods,
} from "@/src/lib/hosted-mailbox/accepted-conversation-backfill";

const ACCEPTED_AT = new Date("2026-03-29T12:00:00.000Z");
const PERIOD_END = new Date("2026-04-01T00:00:00.000Z");
const PERIOD_START = new Date("2026-03-01T00:00:00.000Z");

describe("backfillHostedAcceptedConversationAllowancePeriods", () => {
  it("reports readiness without mutating rows by default", async () => {
    const { prisma } = createBackfillPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([{ count: 2n }]);

    await expect(backfillHostedAcceptedConversationAllowancePeriods({
      apply: false,
      prisma: prisma as never,
    })).resolves.toEqual({
      bound: 0,
      failed: 0,
      remaining: 2,
      scanned: 0,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("materializes and binds a provable legacy acceptance period", async () => {
    const { prisma, tx } = createBackfillPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "mailbox_legacy_1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0n }]);

    await expect(backfillHostedAcceptedConversationAllowancePeriods({
      apply: true,
      batchSize: 1,
      prisma: prisma as never,
    })).resolves.toEqual({
      bound: 1,
      failed: 0,
      remaining: 0,
      scanned: 1,
    });

    expect(tx.hostedAiUsagePeriod.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: "member_legacy_1",
        periodEnd: PERIOD_END,
        periodStart: PERIOD_START,
      }),
      skipDuplicates: true,
    });
    expect(tx.hostedMailboxItem.updateMany).toHaveBeenCalledWith({
      data: {
        acceptedAllowancePeriodStart: PERIOD_START,
      },
      where: {
        acceptedAllowancePeriodStart: null,
        consumedAt: null,
        id: "mailbox_legacy_1",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: 1n,
        userId: "member_legacy_1",
      },
    });
  });

  it("leaves ambiguous legacy rows unbound and reports replay as not ready", async () => {
    const { prisma, tx } = createBackfillPrisma();
    tx.hostedAiUsagePeriod.findMany.mockResolvedValue([
      createUsagePeriod(),
      createUsagePeriod({
        periodEnd: new Date("2026-04-15T00:00:00.000Z"),
        periodStart: new Date("2026-03-15T00:00:00.000Z"),
      }),
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "mailbox_legacy_1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 1n }]);

    await expect(backfillHostedAcceptedConversationAllowancePeriods({
      apply: true,
      prisma: prisma as never,
    })).resolves.toEqual({
      bound: 0,
      failed: 1,
      remaining: 1,
      scanned: 1,
    });

    expect(tx.hostedAiUsagePeriod.createMany).not.toHaveBeenCalled();
    expect(tx.hostedMailboxItem.updateMany).not.toHaveBeenCalled();
  });
});

function createBackfillPrisma() {
  const tx = {
    hostedAccountGroupBillingRef: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
    hostedAccountGroupMembership: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    hostedAiUsagePeriod: {
      createMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [] as ReturnType<typeof createUsagePeriod>[]),
      findUnique: vi.fn(async () => createUsagePeriod()),
    },
    hostedMailboxItem: {
      findUnique: vi.fn(async () => ({
        acceptedAllowancePeriodStart: null,
        consumedAt: null,
        createdAt: ACCEPTED_AT,
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: 1n,
        userId: "member_legacy_1",
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    hostedMailboxLaneCounter: {
      findUnique: vi.fn(async () => ({ consumedSeq: 0n })),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        billingRef: {
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: null,
          currentPeriodEnd: PERIOD_END,
          currentPeriodStart: PERIOD_START,
          currentTrialEndsAt: null,
          currentTrialStartedAt: null,
          pulseTrialPolicyVersion: null,
          pulseTrialRedeemedAt: null,
        },
        billingStatus: HostedBillingStatus.canceled,
        id: "member_legacy_1",
        threadContainer: null,
      })),
    },
  };
  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      await callback(tx)
    ),
  };
  return { prisma, tx };
}

function createUsagePeriod(input: {
  periodEnd?: Date;
  periodStart?: Date;
} = {}) {
  return {
    billingPlanCode: "launch_monthly",
    blockedAt: null,
    limitUsdMicros: 10_000_000n,
    periodEnd: input.periodEnd ?? PERIOD_END,
    periodStart: input.periodStart ?? PERIOD_START,
    spentUsdMicros: 0n,
  };
}
