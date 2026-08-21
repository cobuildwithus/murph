import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const usageAllowanceMocks = vi.hoisted(() => ({
  readHostedAiUsageGate: vi.fn(),
  readHostedAiUsageGateSnapshots: vi.fn(),
}));
const usageCreditGrantMocks = vi.hoisted(() => ({
  appendHostedUsageCreditGrantTx: vi.fn(),
}));
const contactPrivacyMocks = vi.hoisted(() => ({
  createHostedEmailLookupKeyReadCandidates: vi.fn(),
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

vi.mock("../src/lib/hosted-execution/usage-credit-grant", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/hosted-execution/usage-credit-grant")
  >("../src/lib/hosted-execution/usage-credit-grant");
  return {
    ...actual,
    appendHostedUsageCreditGrantTx:
      usageCreditGrantMocks.appendHostedUsageCreditGrantTx,
  };
});

vi.mock("../src/lib/hosted-onboarding/contact-privacy", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/hosted-onboarding/contact-privacy")
  >("../src/lib/hosted-onboarding/contact-privacy");
  return {
    ...actual,
    createHostedEmailLookupKeyReadCandidates:
      contactPrivacyMocks.createHostedEmailLookupKeyReadCandidates,
  };
});

import {
  HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
  HOSTED_OPS_MEMBER_USAGE_RESET_ALL_BATCH_SIZE,
  HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT,
  HostedOpsMemberUsageResetNotFoundError,
  HostedOpsMemberUsageResetNoticeInFlightError,
  HostedOpsMemberUsageResetStaleError,
  readHostedOpsMemberUsage,
  readHostedOpsMemberUsageResetAllBatch,
  resetHostedOpsMemberUsage,
  resetHostedOpsMemberUsageForResetAll,
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
const RESET_ALL_OPERATION_ID = "12345678-1234-4abc-8def-1234567890ab";

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
    contactPrivacyMocks.createHostedEmailLookupKeyReadCandidates
      .mockReturnValue(["hbidx:email:v2:design", "hbidx:email:v1:design"]);
    usageCreditGrantMocks.appendHostedUsageCreditGrantTx.mockResolvedValue({
      balanceUsdMicros: 4_500_000n,
      entryId: "huce_ops_starter_reset",
      granted: true,
      ledgerVersion: 5n,
    });
  });

  test("rejects ambiguous cursor directions before database work", async () => {
    const findMembers = vi.fn();
    const prisma = asPrismaClientForHostedOpsDashboardTest({
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

  test("searches an exact verified email only through blind-index candidates", async () => {
    const findEmailMatches = vi.fn(async () => [{ memberId: "hbm_email" }]);
    const findMembers = vi.fn(async () => [makeMember({ id: "hbm_email" })]);
    const prisma = asPrismaClientForHostedOpsDashboardTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedAiUsage: { groupBy: vi.fn(async () => []) },
      hostedLinqDelivery: { findMany: vi.fn(async () => []) },
      hostedMailboxItem: { groupBy: vi.fn(async () => []) },
      hostedMember: { findMany: findMembers },
      hostedMemberEmailAuthorization: { findMany: findEmailMatches },
    });

    const dashboard = await readHostedOpsMemberUsage({
      after: "hbm_ignored",
      now: NOW,
      prisma,
      search: "Verified@Example.com",
    });

    expect(contactPrivacyMocks.createHostedEmailLookupKeyReadCandidates)
      .toHaveBeenCalledWith("verified@example.com");
    expect(findEmailMatches).toHaveBeenCalledWith({
      orderBy: { memberId: "asc" },
      select: { memberId: true },
      take: HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT + 1,
      where: {
        verifiedEmailLookupKey: {
          in: ["hbidx:email:v2:design", "hbidx:email:v1:design"],
        },
        verifiedEmailVerifiedAt: { not: null },
      },
    });
    expect(JSON.stringify(findEmailMatches.mock.calls)).not.toContain(
      "verifiedEmailAddressEncrypted",
    );
    expect(findMembers).toHaveBeenCalledTimes(1);
    expect(dashboard.rows.map((row) => row.memberId)).toEqual(["hbm_email"]);
    expect(dashboard.pagination).toEqual({
      nextCursor: null,
      pageSize: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
      previousCursor: null,
    });
    expect(dashboard.search).toEqual({
      cap: HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT,
      capped: false,
      error: null,
      kind: "email",
      query: "Verified@Example.com",
      resultCount: 1,
    });
  });

  test("searches a complete final-four phone set up to an explicit cap", async () => {
    const candidateIds = Array.from(
      { length: HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT + 1 },
      (_, index) => `hbm_phone_${String(index + 1).padStart(3, "0")}`,
    );
    const findPhoneMatches = vi.fn(async () =>
      candidateIds.map((memberId) => ({ memberId }))
    );
    const admittedIds = candidateIds.slice(0, HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT);
    const findMembers = vi.fn(async () =>
      admittedIds.map((id) => makeMember({ id }))
    );
    const prisma = asPrismaClientForHostedOpsDashboardTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedAiUsage: { groupBy: vi.fn(async () => []) },
      hostedLinqDelivery: { findMany: vi.fn(async () => []) },
      hostedMailboxItem: { groupBy: vi.fn(async () => []) },
      hostedMember: { findMany: findMembers },
      hostedMemberIdentity: { findMany: findPhoneMatches },
    });

    const dashboard = await readHostedOpsMemberUsage({
      now: NOW,
      prisma,
      search: "0101",
    });

    expect(findPhoneMatches).toHaveBeenCalledWith({
      orderBy: { memberId: "asc" },
      select: { memberId: true },
      take: HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT + 1,
      where: { maskedPhoneNumberHint: { endsWith: "0101" } },
    });
    expect(dashboard.rows).toHaveLength(HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT);
    expect(dashboard.rows.map((row) => row.memberId)).toEqual(admittedIds);
    expect(dashboard.search).toEqual({
      cap: HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT,
      capped: true,
      error: null,
      kind: "phone_last_four",
      query: "0101",
      resultCount: HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT,
    });
  });

  test("keeps hosted member ID search in the hosted-member owner", async () => {
    const findMembers = vi.fn()
      .mockResolvedValueOnce([{ id: "hbm_exact" }])
      .mockResolvedValueOnce([makeMember({ id: "hbm_exact" })]);
    const prisma = asPrismaClientForHostedOpsDashboardTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedAiUsage: { groupBy: vi.fn(async () => []) },
      hostedLinqDelivery: { findMany: vi.fn(async () => []) },
      hostedMailboxItem: { groupBy: vi.fn(async () => []) },
      hostedMember: { findMany: findMembers },
    });

    const dashboard = await readHostedOpsMemberUsage({
      now: NOW,
      prisma,
      search: "hbm_exact",
    });

    expect(findMembers).toHaveBeenNthCalledWith(1, {
      orderBy: { id: "asc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_SEARCH_LIMIT + 1,
      where: { id: "hbm_exact" },
    });
    expect(dashboard.rows.map((row) => row.memberId)).toEqual(["hbm_exact"]);
  });

  test("returns an inline search error without scanning members", async () => {
    const findMembers = vi.fn();
    const prisma = asPrismaClientForHostedOpsDashboardTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedMember: { findMany: findMembers },
    });

    const dashboard = await readHostedOpsMemberUsage({
      now: NOW,
      prisma,
      search: "12",
    });

    expect(findMembers).not.toHaveBeenCalled();
    expect(dashboard.rows).toEqual([]);
    expect(dashboard.search.error).toContain("complete hosted member/container ID");
    expect(dashboard.summary).toEqual({
      activeEntitiesLast7Days: 1,
      groupContainers: 1,
      members: 1,
      totalAllTimeUsageUsdMicros: "8500000",
    });
  });

  test("reads one fixed ID-ordered reset-everyone batch after the acknowledged cursor", async () => {
    const candidates = Array.from(
      { length: HOSTED_OPS_MEMBER_USAGE_RESET_ALL_BATCH_SIZE + 1 },
      (_, index) => ({
        id: `hbm_reset_${String(index + 11).padStart(3, "0")}`,
      }),
    );
    const findMembers = vi.fn(async () => candidates);
    const prisma = asPrismaClientForHostedOpsTest({
      hostedMember: { findMany: findMembers },
    });

    const batch = await readHostedOpsMemberUsageResetAllBatch({
      afterMemberId: "hbm_reset_010",
      prisma,
    });

    expect(findMembers).toHaveBeenCalledWith({
      orderBy: { id: "asc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_RESET_ALL_BATCH_SIZE + 1,
      where: { id: { gt: "hbm_reset_010" } },
    });
    expect(batch).toEqual({
      hasMore: true,
      memberIds: candidates
        .slice(0, HOSTED_OPS_MEMBER_USAGE_RESET_ALL_BATCH_SIZE)
        .map((candidate) => candidate.id),
    });
  });

  test("reuses active Starter wake recovery instead of granting again", async () => {
    const decision = makeUsageGateDecision({
          allowed: true,
          allowanceSource: "direct_starter",
          limitUsdMicros: 0n,
          memberId: "hbm_starter",
          periodEnd: new Date("2099-12-31T23:59:59.999Z"),
          periodStart: new Date(0),
          planResetAt: null,
          remainingUsdMicros: 4_500_000n,
          spentUsdMicros: 0n,
          usageCreditBalanceUsdMicros: 4_500_000n,
          usageCreditLedgerVersion: 44n,
        });
    usageAllowanceMocks.readHostedAiUsageGateSnapshots.mockResolvedValueOnce(
      new Map([["hbm_starter", {
        decision,
        periodPersistedAt: PERIOD_UPDATED_AT,
      }]]),
    );
    usageAllowanceMocks.readHostedAiUsageGate.mockResolvedValueOnce(decision);
    const findOperationGrant = vi.fn(async () => null);
    const findResetGrants = vi.fn(async () => [{
      beneficiaryMemberId: "hbm_starter",
    }]);
    const findStalledMailboxItems = vi.fn(async () => [{
      userId: "hbm_starter",
    }]);
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "hbm_starter" }]),
      hostedMailboxItem: { findMany: findStalledMailboxItems },
      hostedOpsUsageResetReceipt: {
        create: vi.fn(async ({ data }) => data),
        findUnique: vi.fn(async () => null),
      },
      hostedUsageCreditEntry: {
        findMany: findResetGrants,
        findUnique: findOperationGrant,
      },
    };
    const transaction = vi.fn(async (
      run: (client: typeof tx) => Promise<unknown>,
    ) => run(tx));
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: transaction,
      hostedMailboxItem: { findMany: findStalledMailboxItems },
      hostedUsageCreditEntry: {
        findMany: findResetGrants,
        findUnique: findOperationGrant,
      },
    });

    const result = await resetHostedOpsMemberUsageForResetAll({
      memberId: "hbm_starter",
      now: NOW,
      operationId: RESET_ALL_OPERATION_ID,
    }, prisma);

    expect(result).toEqual({
      memberId: "hbm_starter",
      outcome: "unchanged",
      resetMode: "starter_allowance",
      runtimeRecheckRequired: true,
      timestamp: NOW.toISOString(),
    });
    expect(findOperationGrant).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        semanticSourceKey:
          `hosted-ops-usage-reset-all:${RESET_ALL_OPERATION_ID}:hbm_starter:starter:v1`,
      },
    }));
    expect(findResetGrants).toHaveBeenCalledWith({
      select: { beneficiaryMemberId: true },
      take: 1,
      where: {
        beneficiaryMemberId: "hbm_starter",
        grant: { remainingUsdMicros: { gt: 0n } },
        kind: "starter_grant",
        sourceReferenceLookupKey: "hosted-ops-usage-reset:starter:v1",
      },
    });
    expect(findStalledMailboxItems).toHaveBeenCalledWith({
      select: { userId: true },
      take: 1,
      where: {
        aiUsageDeniedAt: { not: null },
        consumedAt: null,
        userId: "hbm_starter",
      },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.hostedOpsUsageResetReceipt.create).toHaveBeenCalledTimes(1);
    expect(usageCreditGrantMocks.appendHostedUsageCreditGrantTx)
      .not.toHaveBeenCalled();
  });

  test("does not append a second reset-everyone Starter grant after the first was consumed", async () => {
    const decision = makeUsageGateDecision({
          allowanceSource: "direct_starter",
          limitUsdMicros: 0n,
          memberId: "hbm_starter",
          periodEnd: new Date("2099-12-31T23:59:59.999Z"),
          periodStart: new Date(0),
          planResetAt: null,
          remainingUsdMicros: 0n,
          spentUsdMicros: 0n,
          usageCreditBalanceUsdMicros: 0n,
          usageCreditLedgerVersion: 45n,
        });
    usageAllowanceMocks.readHostedAiUsageGateSnapshots.mockResolvedValueOnce(
      new Map([["hbm_starter", {
        decision,
        periodPersistedAt: PERIOD_UPDATED_AT,
      }]]),
    );
    usageAllowanceMocks.readHostedAiUsageGate.mockResolvedValueOnce(decision);
    const findOperationGrant = vi.fn(async () => ({
      amountUsdMicros: 4_500_000n,
      beneficiaryMemberId: "hbm_starter",
      beneficiarySequence: 44n,
      grant: {
        beneficiaryMemberId: "hbm_starter",
        beneficiarySequence: 44n,
        remainingUsdMicros: 0n,
      },
      kind: "starter_grant",
      parentGrantEntryId: null,
      purchaseId: null,
      referralId: null,
      sourceReferenceLookupKey: "hosted-ops-usage-reset:starter:v1",
    }));
    const findResetGrants = vi.fn(async () => []);
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "hbm_starter" }]),
      hostedMailboxItem: { findMany: vi.fn(async () => []) },
      hostedOpsUsageResetReceipt: {
        create: vi.fn(async ({ data }) => data),
        findUnique: vi.fn(async () => null),
      },
      hostedUsageCreditEntry: {
        findMany: findResetGrants,
        findUnique: findOperationGrant,
      },
    };
    const transaction = vi.fn(async (
      run: (client: typeof tx) => Promise<unknown>,
    ) => run(tx));
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: transaction,
      hostedUsageCreditEntry: {
        findMany: findResetGrants,
        findUnique: findOperationGrant,
      },
    });

    const result = await resetHostedOpsMemberUsageForResetAll({
      memberId: "hbm_starter",
      now: NOW,
      operationId: RESET_ALL_OPERATION_ID,
    }, prisma);

    expect(result).toEqual({
      memberId: "hbm_starter",
      outcome: "unchanged",
      resetMode: "starter_allowance",
      runtimeRecheckRequired: false,
      timestamp: NOW.toISOString(),
    });
    expect(findOperationGrant).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        semanticSourceKey:
          `hosted-ops-usage-reset-all:${RESET_ALL_OPERATION_ID}:hbm_starter:starter:v1`,
      },
    }));
    expect(findResetGrants).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.hostedOpsUsageResetReceipt.create).toHaveBeenCalledTimes(1);
    expect(usageCreditGrantMocks.appendHostedUsageCreditGrantTx)
      .not.toHaveBeenCalled();
  });

  test("replays one included-usage receipt without re-reading mutable allowance", async () => {
    const transaction = vi.fn();
    const findReceipt = vi.fn(async () => ({
      createdAt: NOW,
      memberId: "hbm_container",
      noticeClaimReleased: true,
      operationId: RESET_ALL_OPERATION_ID,
      outcome: "reset",
      periodStart: PERIOD_START,
      previousSpentUsdMicros: 4_522_964n,
      resetAt: NOW,
      resetMode: "included_usage",
      runtimeRecheckRequired: true,
      updatedAt: NOW,
      usageCreditGrantedUsdMicros: 0n,
    }));
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: transaction,
      hostedOpsUsageResetReceipt: {
        create: vi.fn(),
        findUnique: findReceipt,
      },
    });

    await expect(resetHostedOpsMemberUsageForResetAll({
      memberId: "hbm_container",
      now: new Date(NOW.getTime() + 60_000),
      operationId: RESET_ALL_OPERATION_ID,
    }, prisma)).resolves.toEqual({
      memberId: "hbm_container",
      outcome: "reset",
      resetMode: "included_usage",
      runtimeRecheckRequired: true,
      timestamp: NOW.toISOString(),
    });
    expect(findReceipt).toHaveBeenCalledWith({
      where: {
        operationId_memberId: {
          memberId: "hbm_container",
          operationId: RESET_ALL_OPERATION_ID,
        },
      },
    });
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
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
    const prisma = asPrismaClientForHostedOpsDashboardTest({
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
      resetMode: "included_usage",
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
    const prisma = asPrismaClientForHostedOpsDashboardTest({
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
    expect(dashboard.rows[0]?.resetMode).toBe("included_usage");
  });

  test("projects a distinct reset mode only for an exhausted Starter allowance", async () => {
    usageAllowanceMocks.readHostedAiUsageGateSnapshots.mockResolvedValue(
      new Map([["hbm_person", {
        decision: makeUsageGateDecision({
          allowanceSource: "direct_starter",
          limitUsdMicros: 0n,
          memberId: "hbm_person",
          periodEnd: new Date("2099-12-31T23:59:59.999Z"),
          periodStart: new Date(0),
          planResetAt: null,
          remainingUsdMicros: 0n,
          spentUsdMicros: 0n,
          usageCreditBalanceUsdMicros: 0n,
          usageCreditLedgerVersion: 43n,
        }),
        periodPersistedAt: PERIOD_UPDATED_AT,
      }]]),
    );
    const prisma = asPrismaClientForHostedOpsDashboardTest({
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

    expect(dashboard.rows[0]).toMatchObject({
      resetMode: "starter_allowance",
      runtimeRecheckAvailable: false,
      currentPeriod: {
        blocked: true,
        limitUsdMicros: "0",
        remainingUsdMicros: "0",
        usageCreditLedgerVersion: "43",
      },
    });
  });

  test("reconstructs Starter wake recovery from active Ops credit and stalled work", async () => {
    usageAllowanceMocks.readHostedAiUsageGateSnapshots.mockResolvedValue(
      new Map([["hbm_person", {
        decision: makeUsageGateDecision({
          allowed: true,
          allowanceSource: "direct_starter",
          limitUsdMicros: 0n,
          memberId: "hbm_person",
          periodEnd: new Date("2099-12-31T23:59:59.999Z"),
          periodStart: new Date(0),
          planResetAt: null,
          remainingUsdMicros: 4_500_000n,
          spentUsdMicros: 0n,
          usageCreditBalanceUsdMicros: 4_500_000n,
          usageCreditLedgerVersion: 44n,
        }),
        periodPersistedAt: PERIOD_UPDATED_AT,
      }]]),
    );
    const findOpsResetGrants = vi.fn(async () => [{
      beneficiaryMemberId: "hbm_person",
    }]);
    const findStalledMailboxItems = vi.fn(async () => [{
      userId: "hbm_person",
    }]);
    const prisma = asPrismaClientForHostedOpsDashboardTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedAiUsage: { groupBy: vi.fn(async () => []) },
      hostedLinqDelivery: { findMany: vi.fn(async () => []) },
      hostedMailboxItem: {
        findMany: findStalledMailboxItems,
        groupBy: vi.fn(async () => []),
      },
      hostedMember: {
        findMany: createPagedMemberFindManyMock([
          makeMember({ id: "hbm_person" }),
        ]),
      },
      hostedUsageCreditEntry: { findMany: findOpsResetGrants },
    });

    const dashboard = await readHostedOpsMemberUsage({ now: NOW, prisma });

    expect(dashboard.rows[0]).toMatchObject({
      resetMode: null,
      runtimeRecheckAvailable: true,
    });
    expect(findOpsResetGrants).toHaveBeenCalledWith({
      select: { beneficiaryMemberId: true },
      where: {
        beneficiaryMemberId: { in: ["hbm_person"] },
        grant: { remainingUsdMicros: { gt: 0n } },
        kind: "starter_grant",
        sourceReferenceLookupKey: "hosted-ops-usage-reset:starter:v1",
      },
    });
    expect(findStalledMailboxItems).toHaveBeenCalledWith({
      distinct: ["userId"],
      select: { userId: true },
      where: {
        aiUsageDeniedAt: { not: null },
        consumedAt: null,
        userId: { in: ["hbm_person"] },
      },
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
    const groupMessages = vi.fn(async (query: unknown) => {
      void query;
      return [];
    });
    const groupUsage = vi.fn(async () => []);
    const findDeliveries = vi.fn(async () => []);
    const findOpsResetGrants = vi.fn(async () => admittedIds.map(
      (beneficiaryMemberId) => ({ beneficiaryMemberId }),
    ));
    const findStalledMailboxItems = vi.fn(async () => admittedIds.map(
      (userId) => ({ userId }),
    ));
    const findMembers = createPagedMemberFindManyMock(memberCandidates);
    const prisma = asPrismaClientForHostedOpsDashboardTest({
      $queryRaw: readSummary,
      hostedAiUsage: { groupBy: groupUsage },
      hostedLinqDelivery: { findMany: findDeliveries },
      hostedMailboxItem: {
        findMany: findStalledMailboxItems,
        groupBy: groupMessages,
      },
      hostedMember: { findMany: findMembers },
      hostedUsageCreditEntry: { findMany: findOpsResetGrants },
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
    expect(findOpsResetGrants).toHaveBeenCalledWith({
      select: { beneficiaryMemberId: true },
      where: {
        beneficiaryMemberId: { in: admittedIds },
        grant: { remainingUsdMicros: { gt: 0n } },
        kind: "starter_grant",
        sourceReferenceLookupKey: "hosted-ops-usage-reset:starter:v1",
      },
    });
    expect(findOpsResetGrants).toHaveBeenCalledTimes(1);
    expect(findStalledMailboxItems).toHaveBeenCalledWith({
      distinct: ["userId"],
      select: { userId: true },
      where: {
        aiUsageDeniedAt: { not: null },
        consumedAt: null,
        userId: { in: admittedIds },
      },
    });
    expect(findStalledMailboxItems).toHaveBeenCalledTimes(1);
    expect(admittedIds).not.toContain(offPageMemberId);
    expect(readSummary).toHaveBeenCalledTimes(1);
    expect(findDeliveries).not.toHaveBeenCalled();
  });

  test("recovers an empty forward boundary onto the final page without dropping the cursor member", async () => {
    const fallbackCandidates = makeMemberCandidates({
      count: 26,
      descending: true,
      start: 26,
    });
    const expectedPageDetails = makeMemberCandidates({ count: 25, start: 27 });
    const expectedPageIds = expectedPageDetails.map((member) => member.id);
    const findMembers = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(fallbackCandidates.map(({ id }) => ({ id })))
      .mockResolvedValueOnce(expectedPageDetails);
    const prisma = asPrismaClientForHostedOpsDashboardTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedAiUsage: { groupBy: vi.fn(async () => []) },
      hostedLinqDelivery: { findMany: vi.fn(async () => []) },
      hostedMailboxItem: { groupBy: vi.fn(async () => []) },
      hostedMember: { findMany: findMembers },
    });

    const dashboard = await readHostedOpsMemberUsage({
      after: "hbm_051",
      now: NOW,
      prisma,
    });

    expect(dashboard.rows.map((row) => row.memberId)).toEqual(expectedPageIds);
    expect(dashboard.rows.map((row) => row.memberId)).toContain("hbm_051");
    expect(dashboard.rows.map((row) => row.memberId)).not.toContain("hbm_026");
    expect(dashboard.pagination).toEqual({
      nextCursor: null,
      pageSize: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
      previousCursor: "hbm_027",
    });
    expect(findMembers).toHaveBeenNthCalledWith(1, {
      orderBy: { id: "asc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
      where: { id: { gt: "hbm_051" } },
    });
    expect(findMembers).toHaveBeenNthCalledWith(2, {
      orderBy: { id: "desc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
      where: { id: { lte: "hbm_051" } },
    });
    expect(findMembers).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        orderBy: { id: "asc" },
        where: { id: { in: expectedPageIds } },
      }),
    );
    expect(findMembers).toHaveBeenCalledTimes(3);
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .toHaveBeenCalledWith({
        memberIds: expectedPageIds,
        now: NOW,
        prisma,
      });
  });

  test("recovers an empty backward boundary onto the first page without dropping the cursor member", async () => {
    const fallbackCandidates = makeMemberCandidates({ count: 26, start: 1 });
    const expectedPageDetails = makeMemberCandidates({ count: 25, start: 1 });
    const expectedPageIds = expectedPageDetails.map((member) => member.id);
    const findMembers = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(fallbackCandidates.map(({ id }) => ({ id })))
      .mockResolvedValueOnce(expectedPageDetails);
    const prisma = asPrismaClientForHostedOpsDashboardTest({
      $queryRaw: vi.fn(async () => makeSummaryRows()),
      hostedAiUsage: { groupBy: vi.fn(async () => []) },
      hostedLinqDelivery: { findMany: vi.fn(async () => []) },
      hostedMailboxItem: { groupBy: vi.fn(async () => []) },
      hostedMember: { findMany: findMembers },
    });

    const dashboard = await readHostedOpsMemberUsage({
      before: "hbm_001",
      now: NOW,
      prisma,
    });

    expect(dashboard.rows.map((row) => row.memberId)).toEqual(expectedPageIds);
    expect(dashboard.rows.map((row) => row.memberId)).toContain("hbm_001");
    expect(dashboard.rows.map((row) => row.memberId)).not.toContain("hbm_026");
    expect(dashboard.pagination).toEqual({
      nextCursor: "hbm_025",
      pageSize: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
      previousCursor: null,
    });
    expect(findMembers).toHaveBeenNthCalledWith(1, {
      orderBy: { id: "desc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
      where: { id: { lt: "hbm_001" } },
    });
    expect(findMembers).toHaveBeenNthCalledWith(2, {
      orderBy: { id: "asc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
      where: { id: { gte: "hbm_001" } },
    });
    expect(findMembers).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        orderBy: { id: "asc" },
        where: { id: { in: expectedPageIds } },
      }),
    );
    expect(findMembers).toHaveBeenCalledTimes(3);
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .toHaveBeenCalledWith({
        memberIds: expectedPageIds,
        now: NOW,
        prisma,
      });
  });

  test("returns an empty page only when both bounded boundary scans find no members", async () => {
    const findMembers = vi.fn(async () => []);
    const groupMessages = vi.fn();
    const groupUsage = vi.fn();
    const prisma = asPrismaClientForHostedOpsDashboardTest({
      $queryRaw: vi.fn(async () => makeSummaryRows({
        activeEntitiesLast7Days: 0n,
        groupContainers: 0n,
        members: 0n,
        totalAllTimeUsageUsdMicros: 0n,
      })),
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
      previousCursor: null,
    });
    expect(findMembers).toHaveBeenNthCalledWith(1, {
      orderBy: { id: "asc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
      where: { id: { gt: "hbm_999" } },
    });
    expect(findMembers).toHaveBeenNthCalledWith(2, {
      orderBy: { id: "desc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
      where: { id: { lte: "hbm_999" } },
    });
    expect(findMembers).toHaveBeenCalledTimes(2);
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
    const prisma = asPrismaClientForHostedOpsDashboardTest({
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

  test("re-reads one stale reset-everyone member before applying the canonical reset", async () => {
    const refreshedPeriodUpdatedAt = new Date(
      PERIOD_UPDATED_AT.getTime() + 1_000,
    );
    usageAllowanceMocks.readHostedAiUsageGateSnapshots
      .mockResolvedValueOnce(new Map([["hbm_container", {
        decision: makeUsageGateDecision({
          usageCreditBalanceUsdMicros: 0n,
          usageCreditLedgerVersion: 4n,
        }),
        periodPersistedAt: PERIOD_UPDATED_AT,
      }]]))
      .mockResolvedValueOnce(new Map([["hbm_container", {
        decision: makeUsageGateDecision({
          usageCreditBalanceUsdMicros: 0n,
          usageCreditLedgerVersion: 5n,
        }),
        periodPersistedAt: refreshedPeriodUpdatedAt,
      }]]));
    usageAllowanceMocks.readHostedAiUsageGate.mockResolvedValueOnce(
      makeUsageGateDecision({
        usageCreditBalanceUsdMicros: 0n,
        usageCreditLedgerVersion: 5n,
      }),
    );
    const staleTx = createResetTransactionFixture({
      usageCreditLedgerVersion: 5n,
    });
    const refreshedTx = createResetTransactionFixture({
      periodUpdatedAt: refreshedPeriodUpdatedAt,
      usageCreditLedgerVersion: 5n,
    });
    const transaction = vi.fn()
      .mockImplementationOnce(async (
        run: (client: typeof staleTx) => Promise<unknown>,
      ) => run(staleTx))
      .mockImplementationOnce(async (
        run: (client: typeof refreshedTx) => Promise<unknown>,
      ) => run(refreshedTx));
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: transaction,
    });

    const result = await resetHostedOpsMemberUsageForResetAll({
      memberId: "hbm_container",
      now: NOW,
      operationId: RESET_ALL_OPERATION_ID,
    }, prisma);

    expect(result).toMatchObject({
      memberId: "hbm_container",
      outcome: "reset",
      resetMode: "included_usage",
      runtimeRecheckRequired: true,
    });
    expect(usageAllowanceMocks.readHostedAiUsageGateSnapshots)
      .toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(staleTx.hostedLinqDelivery.update).not.toHaveBeenCalled();
    expect(refreshedTx.hostedAiUsagePeriod.updateMany).toHaveBeenCalledTimes(1);
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
      resetMode: "included_usage",
      updatedAt: NOW.toISOString(),
      usageCreditGrantedUsdMicros: "0",
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
    expect(usageCreditGrantMocks.appendHostedUsageCreditGrantTx)
      .not.toHaveBeenCalled();
  });

  test("appends one fresh Starter grant under the displayed credit epoch", async () => {
    usageAllowanceMocks.readHostedAiUsageGate.mockResolvedValueOnce(
      makeUsageGateDecision({
        allowanceSource: "direct_starter",
        limitUsdMicros: 0n,
        periodEnd: new Date("2099-12-31T23:59:59.999Z"),
        periodStart: PERIOD_START,
        planResetAt: null,
        remainingUsdMicros: 0n,
        spentUsdMicros: 0n,
        usageCreditBalanceUsdMicros: 0n,
        usageCreditLedgerVersion: 4n,
      }),
    );
    const tx = createResetTransactionFixture({
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
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
      outcome: "reset",
      previousSpentUsdMicros: "0",
      resetMode: "starter_allowance",
      usageCreditGrantedUsdMicros: "4500000",
    });
    expect(usageCreditGrantMocks.appendHostedUsageCreditGrantTx)
      .toHaveBeenCalledWith({
        effectiveAt: NOW,
        grantUsdMicros: 4_500_000n,
        lockedBeneficiary: {
          balanceUsdMicros: 0n,
          beneficiaryMemberId: "hbm_container",
          ledgerVersion: 4n,
        },
        semanticSourceKey:
          "hosted-ops-usage-reset:hbm_container:starter:after-ledger-4:v1",
        source: {
          kind: "starter",
          sourceReferenceLookupKey: "hosted-ops-usage-reset:starter:v1",
        },
        tx,
      });
    expect(
      usageCreditGrantMocks.appendHostedUsageCreditGrantTx
        .mock.invocationCallOrder[0],
    )
      .toBeLessThan(
        Number(
          tx.hostedAiUsagePeriod.updateMany.mock.invocationCallOrder[0],
        ),
      );
  });

  test("keys a reset-everyone Starter grant to its operation UUID", async () => {
    usageAllowanceMocks.readHostedAiUsageGate.mockResolvedValueOnce(
      makeUsageGateDecision({
        allowanceSource: "direct_starter",
        limitUsdMicros: 0n,
        periodEnd: new Date("2099-12-31T23:59:59.999Z"),
        periodStart: PERIOD_START,
        planResetAt: null,
        remainingUsdMicros: 0n,
        spentUsdMicros: 0n,
        usageCreditBalanceUsdMicros: 0n,
        usageCreditLedgerVersion: 4n,
      }),
    );
    const tx = createResetTransactionFixture({
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
    });
    const prisma = asPrismaClientForHostedOpsTest({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx)),
    });

    await resetHostedOpsMemberUsage({
      expectedPeriodUpdatedAt: PERIOD_UPDATED_AT,
      expectedUsageCreditLedgerVersion: 4n,
      memberId: "hbm_container",
      now: NOW,
      periodStart: PERIOD_START,
      resetAllOperationId: RESET_ALL_OPERATION_ID,
    }, prisma);

    expect(usageCreditGrantMocks.appendHostedUsageCreditGrantTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        semanticSourceKey:
          `hosted-ops-usage-reset-all:${RESET_ALL_OPERATION_ID}:hbm_container:starter:v1`,
      }));
  });

  test("refuses to grant another Starter allowance while credit remains", async () => {
    usageAllowanceMocks.readHostedAiUsageGate.mockResolvedValueOnce(
      makeUsageGateDecision({
        allowed: true,
        allowanceSource: "direct_starter",
        limitUsdMicros: 0n,
        remainingUsdMicros: 500_000n,
        spentUsdMicros: 0n,
        usageCreditBalanceUsdMicros: 500_000n,
        usageCreditLedgerVersion: 4n,
      }),
    );
    const tx = createResetTransactionFixture({
      usageCreditBalanceUsdMicros: 500_000n,
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
    expect(usageCreditGrantMocks.appendHostedUsageCreditGrantTx)
      .not.toHaveBeenCalled();
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
  usageCreditBalanceUsdMicros?: bigint;
  usageCreditLedgerVersion?: bigint;
} = {}) {
  const rows = [
    input.memberExists === false
      ? []
      : [{
          hasActiveUsageCreditGrant: false,
          usageCreditBalanceUsdMicros:
            input.usageCreditBalanceUsdMicros ?? 0n,
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
    hostedOpsUsageResetReceipt: {
      create: vi.fn(async ({ data }) => data),
      findUnique: vi.fn(async () => null),
    },
  };
}

/**
 * Dashboard reads always include the page-scoped Starter recovery lookups.
 * Individual tests override either delegate only when that state matters.
 */
function asPrismaClientForHostedOpsDashboardTest(
  value: Record<string, object>,
): PrismaClient {
  const mailboxDelegate = value.hostedMailboxItem ?? {};
  const usageCreditEntryDelegate = value.hostedUsageCreditEntry ?? {};
  return asPrismaClientForHostedOpsTest({
    ...value,
    hostedMailboxItem: {
      findMany: vi.fn(async () => []),
      ...mailboxDelegate,
    },
    hostedUsageCreditEntry: {
      findMany: vi.fn(async () => []),
      ...usageCreditEntryDelegate,
    },
  });
}

/**
 * This fixture assertion is limited to the delegates exercised by this file.
 * The production queries remain checked against the generated Prisma client.
 */
function asPrismaClientForHostedOpsTest(value: object): PrismaClient {
  if (!("hostedOpsUsageResetReceipt" in value)) {
    Object.assign(value, {
      hostedOpsUsageResetReceipt: {
        create: vi.fn(async ({ data }) => data),
        findUnique: vi.fn(async () => null),
      },
    });
  }
  return value as PrismaClient;
}
