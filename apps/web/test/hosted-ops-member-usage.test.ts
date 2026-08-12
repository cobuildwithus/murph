import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const usageAllowanceMocks = vi.hoisted(() => ({
  readHostedAiUsageGate: vi.fn(),
  readHostedAiUsageGateSnapshots: vi.fn(),
}));

vi.mock("../src/lib/hosted-execution/usage-allowance", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/hosted-execution/usage-allowance")
  >("../src/lib/hosted-execution/usage-allowance");
  return {
    ...actual,
    readHostedAiUsageGate: usageAllowanceMocks.readHostedAiUsageGate,
    readHostedAiUsageGateSnapshots:
      usageAllowanceMocks.readHostedAiUsageGateSnapshots,
  };
});

import {
  HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
  HostedOpsMemberUsageResetNotFoundError,
  HostedOpsMemberUsageResetNoticeInFlightError,
  HostedOpsMemberUsageResetStaleError,
  readHostedOpsMemberUsage,
  resetHostedOpsMemberUsage,
} from "../src/lib/hosted-ops/member-usage";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
} from "../src/lib/hosted-onboarding/linq-delivery-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "../src/lib/hosted-onboarding/linq-observability-identifiers";

const NOW = new Date("2026-07-22T18:00:00.000Z");
const PERIOD_START = new Date("2026-07-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-08-01T00:00:00.000Z");
const PERIOD_UPDATED_AT = new Date("2026-07-22T17:30:00.000Z");
const PLAN_RESET_AT = new Date("2026-07-12T15:00:00.000Z");

describe("hosted ops member usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usageAllowanceMocks.readHostedAiUsageGate.mockResolvedValue(
      makeUsageGateDecision({
        usageCreditBalanceUsdMicros: 0n,
        usageCreditLedgerVersion: 4n,
      }),
    );
    usageAllowanceMocks.readHostedAiUsageGateSnapshots.mockResolvedValue(
      new Map(),
    );
  });

  test("rejects ambiguous cursor directions before database work", async () => {
    const findMembers = vi.fn();
    const prisma = asPrismaClientForHostedOpsTest({
      hostedMember: { findMany: findMembers },
    });

    await expect(readHostedOpsMemberUsage({
      after: "hbm_025",
      before: "hbm_051",
      now: NOW,
      prisma,
    })).rejects.toThrow(
      "Hosted ops usage pagination cannot specify both after and before cursors.",
    );

    expect(findMembers).not.toHaveBeenCalled();
  });

  test("reports members and containers from canonical retained and immutable rows", async () => {
    const readSummary = vi.fn(async () => makeSummaryRows());
    const groupMessages = vi.fn()
      .mockResolvedValueOnce([{
        _count: { _all: 18 },
        userId: "hbm_container",
      }, {
        _count: { _all: 4 },
        userId: "hbm_person",
      }])
      .mockResolvedValueOnce([{
        _count: { _all: 7 },
        userId: "hbm_container",
      }]);
    const findDeliveries = vi.fn(async (input: {
      where: { idempotencyKey: { in: string[] } };
    }) => [{
      idempotencyKey: input.where.idempotencyKey.in[0] ?? null,
      status: "accepted",
    }]);
    const groupUsage = vi.fn(async () => [{
      _sum: { allowanceCostUsdMicros: 7_250_000n },
      memberId: "hbm_container",
    }, {
      _sum: { allowanceCostUsdMicros: 1_250_000n },
      memberId: "hbm_person",
    }]);
    const memberDetails = [
      makeMember({
        id: "hbm_container",
        identity: null,
        threadContainer: {
          _count: { participants: 2 },
          ownerMemberId: "hbm_person",
        },
        usageCreditBalanceUsdMicros: 500_000n,
        usageCreditLedgerVersion: 3n,
      }),
      makeMember({ id: "hbm_person" }),
    ];
    const findMembers = createPagedMemberFindManyMock(memberDetails);
    usageAllowanceMocks.readHostedAiUsageGateSnapshots.mockResolvedValue(
      new Map([
        ["hbm_container", {
          decision: makeUsageGateDecision({ allowed: true }),
          periodPersistedAt: PERIOD_UPDATED_AT,
        }],
        ["hbm_person", {
          decision: makeUsageGateDecision({
            allowed: true,
            memberId: "hbm_person",
            remainingUsdMicros: 4_500_000n,
            spentUsdMicros: 0n,
            usageCreditLedgerVersion: 0n,
          }),
          periodPersistedAt: null,
        }],
      ]),
    );
    const prisma = asPrismaClientForHostedOpsTest({
      $queryRaw: readSummary,
      hostedAiUsage: {
        groupBy: groupUsage,
      },
      hostedLinqDelivery: { findMany: findDeliveries },
      hostedMailboxItem: {
        groupBy: groupMessages,
      },
      hostedMember: {
        findMany: findMembers,
      },
    });

    const dashboard = await readHostedOpsMemberUsage({ now: NOW, prisma });

    expect(dashboard.rows.map((row) => row.memberId)).toEqual([
      "hbm_container",
      "hbm_person",
    ]);
    expect(dashboard.rows[0]).toMatchObject({
      allowanceStatus: "available",
      allTimeUsageUsdMicros: "7250000",
      containerOwnerMemberId: "hbm_person",
      memberKind: "group_container",
      messagesDailyAverage7Days: 1,
      messagesLast7Days: 7,
      messagesRetained: 18,
      participantCount: 2,
    });
    expect(dashboard.rows[0]?.currentPeriod).toMatchObject({
      blocked: false,
      idempotencyClaimStatus: "accepted",
      remainingUsdMicros: "500000",
      usageCreditBalanceUsdMicros: "500000",
      usageCreditLedgerVersion: "3",
    });
    expect(dashboard.rows[1]?.currentPeriod).toMatchObject({
      blocked: false,
    });
    expect(dashboard.rows[1]).toMatchObject({
      allTimeUsageUsdMicros: "1250000",
      memberKind: "member",
      messagesDailyAverage7Days: 0,
      messagesLast7Days: 0,
      messagesRetained: 4,
    });
    expect(dashboard.summary).toEqual({
      activeEntitiesLast7Days: 1,
      groupContainers: 1,
      members: 1,
      totalAllTimeUsageUsdMicros: "8500000",
    });
    expect(dashboard.pagination).toEqual({
      nextCursor: null,
      pageSize: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
      previousCursor: null,
    });
    expect(groupMessages).toHaveBeenNthCalledWith(1, {
      by: ["userId"],
      _count: { _all: true },
      where: {
        kind: "conversation.message",
        occurredAt: {
          gte: new Date("2026-06-22T18:00:00.000Z"),
          lt: NOW,
        },
        userId: { in: ["hbm_container", "hbm_person"] },
      },
    });
    expect(groupMessages).toHaveBeenNthCalledWith(2, {
      by: ["userId"],
      _count: { _all: true },
      where: {
        kind: "conversation.message",
        occurredAt: {
          gte: new Date("2026-07-15T18:00:00.000Z"),
          lt: NOW,
        },
        userId: { in: ["hbm_container", "hbm_person"] },
      },
    });
    expect(groupUsage).toHaveBeenCalledWith({
      by: ["memberId"],
      _sum: { allowanceCostUsdMicros: true },
      where: {
        allowanceCounted: true,
        memberId: { in: ["hbm_container", "hbm_person"] },
      },
    });
    expect(findMembers).toHaveBeenNthCalledWith(1, {
      orderBy: { id: "asc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
    });
    expect(findMembers).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderBy: { id: "asc" },
        select: expect.objectContaining({
          threadContainer: {
            select: {
              ownerMemberId: true,
              _count: {
                select: {
                  participants: {
                    where: { removedAt: null },
                  },
                },
              },
            },
          },
        }),
        where: {
          id: { in: ["hbm_container", "hbm_person"] },
        },
      }),
    );
    expect(findMembers).toHaveBeenCalledTimes(2);
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .toHaveBeenCalledWith({
        memberIds: ["hbm_container", "hbm_person"],
        now: NOW,
        prisma,
      });
    expect(readSummary).toHaveBeenCalledTimes(1);
    const summarySql = readSqlText(readSummary.mock.calls[0]);
    expect(summarySql).toContain('COUNT(DISTINCT "mailbox_item"."user_id")');
    expect(summarySql).toContain('SUM("usage"."allowance_cost_usd_micros")');
    expect(summarySql).not.toContain("GROUP BY");
    expect(findDeliveries).toHaveBeenCalledTimes(1);
  });

  test("projects blocked status from the canonical decision", async () => {
    usageAllowanceMocks.readHostedAiUsageGateSnapshots.mockResolvedValue(
      new Map([["hbm_person", {
        decision: makeUsageGateDecision({ memberId: "hbm_person" }),
        periodPersistedAt: PERIOD_UPDATED_AT,
      }]]),
    );
    const prisma = asPrismaClientForHostedOpsTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedAiUsage: { groupBy: vi.fn(async () => []) },
      hostedLinqDelivery: { findMany: vi.fn(async () => []) },
      hostedMailboxItem: { groupBy: vi.fn(async () => []) },
      hostedMember: {
        findMany: createPagedMemberFindManyMock([
          makeMember({ id: "hbm_person" }),
        ]),
      },
    });

    const dashboard = await readHostedOpsMemberUsage({ now: NOW, prisma });

    expect(dashboard.rows[0]?.currentPeriod).toMatchObject({
      blocked: true,
    });
  });

  test("caps one render at 25 members and scopes every row-level read to that page", async () => {
    const memberCandidates = makeMemberCandidates({ count: 26, start: 1 });
    const admittedIds = memberCandidates
      .slice(0, HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE)
      .map((member) => member.id);
    const offPageMemberId = memberCandidates.at(-1)?.id;
    const readSummary = vi.fn(async () => makeSummaryRows({
      activeEntitiesLast7Days: 312n,
      groupContainers: 204n,
      members: 1_024n,
      totalAllTimeUsageUsdMicros: 9_223_372_036_854_775_808n,
    }));
    const groupMessages = vi.fn(async (_input: unknown) => []);
    const groupUsage = vi.fn(async (_input: unknown) => []);
    const findDeliveries = vi.fn(async () => []);
    const findMembers = createPagedMemberFindManyMock(memberCandidates);
    const prisma = asPrismaClientForHostedOpsTest({
      $queryRaw: readSummary,
      hostedAiUsage: { groupBy: groupUsage },
      hostedLinqDelivery: { findMany: findDeliveries },
      hostedMailboxItem: { groupBy: groupMessages },
      hostedMember: { findMany: findMembers },
    });

    const dashboard = await readHostedOpsMemberUsage({ now: NOW, prisma });

    expect(dashboard.rows.map((row) => row.memberId)).toEqual(admittedIds);
    expect(dashboard.rows).toHaveLength(HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE);
    expect(dashboard.pagination).toEqual({
      nextCursor: admittedIds.at(-1),
      pageSize: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
      previousCursor: null,
    });
    expect(dashboard.summary).toEqual({
      activeEntitiesLast7Days: 312,
      groupContainers: 204,
      members: 1_024,
      totalAllTimeUsageUsdMicros: "9223372036854775808",
    });
    expect(findMembers).toHaveBeenNthCalledWith(1, {
      orderBy: { id: "asc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
    });
    expect(findMembers).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderBy: { id: "asc" },
        where: { id: { in: admittedIds } },
      }),
    );
    expect(findMembers).toHaveBeenCalledTimes(2);
    expect(groupMessages).toHaveBeenCalledTimes(2);
    for (const [query] of groupMessages.mock.calls) {
      expect(query).toEqual(expect.objectContaining({
        where: expect.objectContaining({
          userId: { in: admittedIds },
        }),
      }));
    }
    expect(groupUsage).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        allowanceCounted: true,
        memberId: { in: admittedIds },
      },
    }));
    expect(groupUsage).toHaveBeenCalledTimes(1);
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .toHaveBeenCalledWith({
        memberIds: admittedIds,
        now: NOW,
        prisma,
      });
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .toHaveBeenCalledTimes(1);
    expect(admittedIds).not.toContain(offPageMemberId);
    expect(readSummary).toHaveBeenCalledTimes(1);
    expect(findDeliveries).not.toHaveBeenCalled();
  });

  test("keeps a previous-page recovery cursor when a forward page becomes empty", async () => {
    const findMembers = vi.fn(async () => []);
    const groupMessages = vi.fn();
    const groupUsage = vi.fn();
    const prisma = asPrismaClientForHostedOpsTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedAiUsage: { groupBy: groupUsage },
      hostedLinqDelivery: { findMany: vi.fn() },
      hostedMailboxItem: { groupBy: groupMessages },
      hostedMember: { findMany: findMembers },
    });

    const dashboard = await readHostedOpsMemberUsage({
      after: "hbm_999",
      now: NOW,
      prisma,
    });

    expect(dashboard.rows).toEqual([]);
    expect(dashboard.pagination).toEqual({
      nextCursor: null,
      pageSize: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
      previousCursor: "hbm_999",
    });
    expect(findMembers).toHaveBeenCalledTimes(1);
    expect(groupMessages).not.toHaveBeenCalled();
    expect(groupUsage).not.toHaveBeenCalled();
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .not.toHaveBeenCalled();
  });

  test("uses primary-key cap-plus-one cursors for forward and previous-page traversal", async () => {
    const forwardCandidates = makeMemberCandidates({ count: 26, start: 26 });
    const backwardCandidates = makeMemberCandidates({
      count: 26,
      descending: true,
      start: 25,
    });
    const expectedPageDetails = makeMemberCandidates({ count: 25, start: 26 });
    const expectedPageIds = expectedPageDetails.map((member) => member.id);
    const findMembers = vi.fn()
      .mockResolvedValueOnce(forwardCandidates.map(({ id }) => ({ id })))
      .mockResolvedValueOnce(expectedPageDetails)
      .mockResolvedValueOnce(backwardCandidates.map(({ id }) => ({ id })))
      .mockResolvedValueOnce(expectedPageDetails);
    const prisma = asPrismaClientForHostedOpsTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedAiUsage: { groupBy: vi.fn(async () => []) },
      hostedLinqDelivery: { findMany: vi.fn(async () => []) },
      hostedMailboxItem: { groupBy: vi.fn(async () => []) },
      hostedMember: { findMany: findMembers },
    });

    const forward = await readHostedOpsMemberUsage({
      after: "hbm_025",
      now: NOW,
      prisma,
    });
    const previous = await readHostedOpsMemberUsage({
      before: "hbm_051",
      now: NOW,
      prisma,
    });

    expect(forward.rows.map((row) => row.memberId)).toEqual(expectedPageIds);
    expect(previous.rows.map((row) => row.memberId)).toEqual(expectedPageIds);
    expect(forward.pagination).toEqual({
      nextCursor: "hbm_050",
      pageSize: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
      previousCursor: "hbm_026",
    });
    expect(previous.pagination).toEqual({
      nextCursor: "hbm_050",
      pageSize: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
      previousCursor: "hbm_026",
    });
    expect(findMembers).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: { id: "asc" },
        select: { id: true },
        take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
        where: { id: { gt: "hbm_025" } },
      }),
    );
    expect(findMembers).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderBy: { id: "asc" },
        where: { id: { in: expectedPageIds } },
      }),
    );
    expect(findMembers).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        orderBy: { id: "desc" },
        select: { id: true },
        take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
        where: { id: { lt: "hbm_051" } },
      }),
    );
    expect(findMembers).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        orderBy: { id: "asc" },
        where: { id: { in: expectedPageIds } },
      }),
    );
    expect(findMembers).toHaveBeenCalledTimes(4);
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .toHaveBeenNthCalledWith(1, {
        memberIds: expectedPageIds,
        now: NOW,
        prisma,
      });
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .toHaveBeenNthCalledWith(2, {
        memberIds: expectedPageIds,
        now: NOW,
        prisma,
      });
  });

  test("atomically clears included spend and releases only the current notice claim", async () => {
    const tx = createResetTransactionFixture({
      delivery: makeDelivery({ status: "accepted" }),
    });
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx)),
    });

    const result = await resetHostedOpsMemberUsage({
      expectedPeriodUpdatedAt: PERIOD_UPDATED_AT,
      expectedUsageCreditLedgerVersion: 4n,
      memberId: "hbm_container",
      now: NOW,
      periodStart: PERIOD_START,
    }, prisma);

    expect(result).toEqual({
      memberId: "hbm_container",
      noticeClaimReleased: true,
      outcome: "reset",
      periodStart: PERIOD_START.toISOString(),
      previousSpentUsdMicros: "4522964",
      resetAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(tx.hostedLinqDelivery.update).toHaveBeenCalledWith({
      data: { idempotencyKey: null },
      where: { id: "delivery_1" },
    });
    expect(tx.hostedAiUsagePeriod.updateMany).toHaveBeenCalledWith({
      data: {
        blockedAt: null,
        spentUsdMicros: 0n,
        updatedAt: NOW,
      },
      where: {
        memberId: "hbm_container",
        periodStart: PERIOD_START,
        updatedAt: PERIOD_UPDATED_AT,
      },
    });
    const expectedNoticeLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
      buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: "hbm_container",
        periodStart: PERIOD_START,
        planResetAt: PLAN_RESET_AT,
        usageCreditLedgerVersion: 4n,
      }),
    );
    expect(tx.$queryRaw.mock.calls[2]?.[1]).toBe(expectedNoticeLookupKey);
  });

  test("rejects a stale credit epoch before reading or releasing a notice claim", async () => {
    const tx = createResetTransactionFixture({
      usageCreditLedgerVersion: 5n,
    });
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx)),
    });

    await expect(resetHostedOpsMemberUsage({
      expectedPeriodUpdatedAt: PERIOD_UPDATED_AT,
      expectedUsageCreditLedgerVersion: 4n,
      memberId: "hbm_container",
      now: NOW,
      periodStart: PERIOD_START,
    }, prisma)).rejects.toBeInstanceOf(HostedOpsMemberUsageResetStaleError);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.hostedLinqDelivery.update).not.toHaveBeenCalled();
    expect(tx.hostedAiUsagePeriod.updateMany).not.toHaveBeenCalled();
  });

  test("rejects a date-active row that is no longer the canonical period", async () => {
    usageAllowanceMocks.readHostedAiUsageGate.mockResolvedValueOnce(
      makeUsageGateDecision({
        periodEnd: new Date("2026-07-25T00:00:00.000Z"),
        periodStart: new Date("2026-06-25T00:00:00.000Z"),
        usageCreditBalanceUsdMicros: 0n,
        usageCreditLedgerVersion: 4n,
      }),
    );
    const tx = createResetTransactionFixture();
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx)),
    });

    await expect(resetHostedOpsMemberUsage({
      expectedPeriodUpdatedAt: PERIOD_UPDATED_AT,
      expectedUsageCreditLedgerVersion: 4n,
      memberId: "hbm_container",
      now: NOW,
      periodStart: PERIOD_START,
    }, prisma)).rejects.toBeInstanceOf(HostedOpsMemberUsageResetStaleError);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.hostedLinqDelivery.update).not.toHaveBeenCalled();
    expect(tx.hostedAiUsagePeriod.updateMany).not.toHaveBeenCalled();
  });

  test("rejects a stale row before releasing its notice claim", async () => {
    const tx = createResetTransactionFixture({
      periodUpdatedAt: new Date(PERIOD_UPDATED_AT.getTime() + 1_000),
    });
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx)),
    });

    await expect(resetHostedOpsMemberUsage({
      expectedPeriodUpdatedAt: PERIOD_UPDATED_AT,
      expectedUsageCreditLedgerVersion: 4n,
      memberId: "hbm_container",
      now: NOW,
      periodStart: PERIOD_START,
    }, prisma)).rejects.toBeInstanceOf(HostedOpsMemberUsageResetStaleError);
    expect(tx.hostedLinqDelivery.update).not.toHaveBeenCalled();
    expect(tx.hostedAiUsagePeriod.updateMany).not.toHaveBeenCalled();
  });

  test("does not reset while the current quota notice is still dispatching", async () => {
    const tx = createResetTransactionFixture({
      delivery: makeDelivery({
        acceptedAt: null,
        attemptedAt: new Date(NOW.getTime() - 60_000),
        messageLookupKey: null,
        status: "provider_dispatch_started",
      }),
    });
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx)),
    });

    await expect(resetHostedOpsMemberUsage({
      expectedPeriodUpdatedAt: PERIOD_UPDATED_AT,
      expectedUsageCreditLedgerVersion: 4n,
      memberId: "hbm_container",
      now: NOW,
      periodStart: PERIOD_START,
    }, prisma)).rejects.toBeInstanceOf(
      HostedOpsMemberUsageResetNoticeInFlightError,
    );
    expect(tx.hostedLinqDelivery.update).not.toHaveBeenCalled();
    expect(tx.hostedAiUsagePeriod.updateMany).not.toHaveBeenCalled();
  });

  test("returns unchanged without rewriting an already clear period", async () => {
    const tx = createResetTransactionFixture({
      blockedAt: null,
      delivery: null,
      spentUsdMicros: 0n,
    });
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx)),
    });

    const result = await resetHostedOpsMemberUsage({
      expectedPeriodUpdatedAt: PERIOD_UPDATED_AT,
      expectedUsageCreditLedgerVersion: 4n,
      memberId: "hbm_container",
      now: NOW,
      periodStart: PERIOD_START,
    }, prisma);

    expect(result).toMatchObject({
      noticeClaimReleased: false,
      outcome: "unchanged",
      previousSpentUsdMicros: "0",
      updatedAt: PERIOD_UPDATED_AT.toISOString(),
    });
    expect(tx.hostedLinqDelivery.update).not.toHaveBeenCalled();
    expect(tx.hostedAiUsagePeriod.updateMany).not.toHaveBeenCalled();
  });

  test("fails closed when the selected member no longer exists", async () => {
    const tx = createResetTransactionFixture({ memberExists: false });
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx)),
    });

    await expect(resetHostedOpsMemberUsage({
      expectedPeriodUpdatedAt: PERIOD_UPDATED_AT,
      expectedUsageCreditLedgerVersion: 4n,
      memberId: "hbm_container",
      now: NOW,
      periodStart: PERIOD_START,
    }, prisma)).rejects.toBeInstanceOf(HostedOpsMemberUsageResetNotFoundError);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.hostedLinqDelivery.update).not.toHaveBeenCalled();
    expect(tx.hostedAiUsagePeriod.updateMany).not.toHaveBeenCalled();
  });
});

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    billingStatus: "active",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    hostedGroupRuntime: null,
    id: "hbm_person",
    identity: { maskedPhoneNumberHint: "••• 0101" },
    suspendedAt: null,
    threadContainer: null,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    ...overrides,
  };
}

function createPagedMemberFindManyMock(
  memberCandidates: ReturnType<typeof makeMember>[],
) {
  const admittedMembers = memberCandidates.slice(
    0,
    HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
  );
  return vi.fn()
    .mockResolvedValueOnce(memberCandidates.map(({ id }) => ({ id })))
    .mockResolvedValueOnce(admittedMembers);
}

function makeMemberCandidates(input: {
  count: number;
  descending?: boolean;
  start: number;
}) {
  const candidates = Array.from({ length: input.count }, (_, index) =>
    makeMember({
      id: `hbm_${String(input.start + index).padStart(3, "0")}`,
    })
  );
  return input.descending ? candidates.reverse() : candidates;
}

function makeSummaryRows(input: Partial<{
  activeEntitiesLast7Days: bigint;
  groupContainers: bigint;
  members: bigint;
  totalAllTimeUsageUsdMicros: bigint;
}> = {}) {
  return [{
    activeEntitiesLast7Days: (input.activeEntitiesLast7Days ?? 1n).toString(),
    groupContainers: (input.groupContainers ?? 1n).toString(),
    members: (input.members ?? 1n).toString(),
    totalAllTimeUsageUsdMicros:
      (input.totalAllTimeUsageUsdMicros ?? 8_500_000n).toString(),
  }];
}

function readSqlText(call: readonly unknown[] | undefined): string {
  const template = call?.[0];
  return Array.isArray(template) ? template.join("?") : "";
}

function makeUsageGateDecision(overrides: Record<string, unknown> = {}) {
  return {
    allowed: false,
    allowanceSource: "thread_container",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 4_500_000n,
    memberId: "hbm_container",
    periodEnd: PERIOD_END,
    periodStart: PERIOD_START,
    planResetAt: PLAN_RESET_AT,
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 500_000n,
    retryAfter: PERIOD_END,
    spentUsdMicros: 4_522_964n,
    usageCreditBalanceUsdMicros: 500_000n,
    usageCreditLedgerVersion: 3n,
    userNotice: {
      code: "thread_usage_limit_reached",
      message: "Usage limit reached.",
    },
    ...overrides,
  };
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    acceptedAt: NOW,
    attemptedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    deliveredAt: null,
    failedAt: null,
    id: "delivery_1",
    lastReceiptAt: null,
    messageLookupKey: "message_lookup",
    skippedAt: null,
    status: "accepted",
    ...overrides,
  };
}

function createResetTransactionFixture(input: {
  blockedAt?: Date | null;
  delivery?: ReturnType<typeof makeDelivery> | null;
  memberExists?: boolean;
  periodUpdatedAt?: Date;
  spentUsdMicros?: bigint;
  usageCreditLedgerVersion?: bigint;
} = {}) {
  const rows = [
    input.memberExists === false
      ? []
      : [{
          usageCreditLedgerVersion: input.usageCreditLedgerVersion ?? 4n,
        }],
    [{
      blockedAt: input.blockedAt === undefined
        ? new Date("2026-07-22T17:25:30.000Z")
        : input.blockedAt,
      periodEnd: PERIOD_END,
      spentUsdMicros: input.spentUsdMicros ?? 4_522_964n,
      updatedAt: input.periodUpdatedAt ?? PERIOD_UPDATED_AT,
    }],
    input.delivery === null ? [] : [input.delivery ?? makeDelivery()],
  ];
  return {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce(rows[0])
      .mockResolvedValueOnce(rows[1])
      .mockResolvedValueOnce(rows[2]),
    hostedAiUsagePeriod: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    hostedLinqDelivery: {
      update: vi.fn(async () => ({ id: "delivery_1" })),
    },
  };
}

/**
 * This fixture assertion is limited to the delegates exercised by this file.
 * The production queries remain checked against the generated Prisma client.
 */
function asPrismaClientForHostedOpsTest(value: object): PrismaClient {
  return value as PrismaClient;
}
