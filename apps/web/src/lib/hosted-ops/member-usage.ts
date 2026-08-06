import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  readHostedAiUsageGate,
  readHostedAiUsageGateSnapshots,
} from "../hosted-execution/usage-allowance";
import {
  HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
  buildHostedAiUsageGateNoticeIdempotencyKey,
} from "../hosted-onboarding/linq-delivery-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "../hosted-onboarding/linq-observability-identifiers";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";

const HOSTED_CONVERSATION_MESSAGE_KIND = "conversation.message";
const HOSTED_MESSAGE_RETENTION_DAYS = 30;
const HOSTED_USAGE_REPORTING_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface HostedOpsMemberUsageRow {
  allowanceStatus: "available" | "unavailable";
  allTimeUsageUsdMicros: string;
  billingStatus: string;
  containerOwnerMemberId: string | null;
  createdAt: string;
  currentPeriod: HostedOpsMemberUsagePeriod | null;
  maskedPhoneNumberHint: string | null;
  memberId: string;
  memberKind: "group_container" | "member";
  messagesDailyAverage7Days: number;
  messagesLast7Days: number;
  messagesRetained: number;
  participantCount: number | null;
  suspended: boolean;
}

export interface HostedOpsMemberUsagePeriod {
  blocked: boolean;
  idempotencyClaimStatus: string | null;
  limitUsdMicros: string;
  periodEnd: string;
  periodStart: string;
  remainingUsdMicros: string;
  spentUsdMicros: string;
  updatedAt: string | null;
  usageCreditBalanceUsdMicros: string;
  usageCreditLedgerVersion: string;
}

export interface HostedOpsMemberUsageDashboard {
  capturedAt: string;
  messageRetentionDays: number;
  rows: HostedOpsMemberUsageRow[];
  summary: {
    activeEntitiesLast7Days: number;
    groupContainers: number;
    members: number;
    totalAllTimeUsageUsdMicros: string;
  };
}

export interface HostedOpsMemberUsageResetInput {
  expectedPeriodUpdatedAt: Date;
  expectedUsageCreditLedgerVersion: bigint;
  memberId: string;
  now?: Date;
  periodStart: Date;
}

export interface HostedOpsMemberUsageResetResult {
  memberId: string;
  noticeClaimReleased: boolean;
  outcome: "reset" | "unchanged";
  periodStart: string;
  previousSpentUsdMicros: string;
  resetAt: string;
  updatedAt: string;
}

export interface HostedOpsMemberUsageResetResponse
  extends HostedOpsMemberUsageResetResult {
  runtimeRecheckStatus: "accepted" | "pending";
}

export class HostedOpsMemberUsageResetNotFoundError extends Error {
  constructor() {
    super("The hosted member or current usage period no longer exists.");
    this.name = "HostedOpsMemberUsageResetNotFoundError";
  }
}

export class HostedOpsMemberUsageResetStaleError extends Error {
  constructor() {
    super("Usage changed after this table loaded. Refresh and review the current row before resetting it.");
    this.name = "HostedOpsMemberUsageResetStaleError";
  }
}

export class HostedOpsMemberUsageResetNoticeInFlightError extends Error {
  readonly retryAt: Date;

  constructor(retryAt: Date) {
    super("A usage-limit notice is currently being sent. Retry after that dispatch settles.");
    this.name = "HostedOpsMemberUsageResetNoticeInFlightError";
    this.retryAt = retryAt;
  }
}

export async function readHostedOpsMemberUsage(
  now = new Date(),
  prisma: PrismaClient = getPrisma(),
): Promise<HostedOpsMemberUsageDashboard> {
  assertValidDate(now, "Hosted ops usage reporting timestamp is invalid.");
  const last7DaysStart = new Date(
    now.getTime() - HOSTED_USAGE_REPORTING_WINDOW_DAYS * DAY_MS,
  );
  const retentionWindowStart = new Date(
    now.getTime() - HOSTED_MESSAGE_RETENTION_DAYS * DAY_MS,
  );

  const members = await prisma.hostedMember.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      billingStatus: true,
      createdAt: true,
      hostedGroupRuntime: {
        select: {
          ownerMemberId: true,
          _count: {
            select: { members: true },
          },
        },
      },
      id: true,
      identity: {
        select: { maskedPhoneNumberHint: true },
      },
      suspendedAt: true,
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
    },
  });
  const [
    retainedMessageCounts,
    last7DayMessageCounts,
    usageTotals,
    usageGateSnapshots,
  ] = await Promise.all([
      prisma.hostedMailboxItem.groupBy({
        by: ["userId"],
        _count: { _all: true },
        where: {
          kind: HOSTED_CONVERSATION_MESSAGE_KIND,
          occurredAt: { gte: retentionWindowStart, lt: now },
        },
      }),
      prisma.hostedMailboxItem.groupBy({
        by: ["userId"],
        _count: { _all: true },
        where: {
          kind: HOSTED_CONVERSATION_MESSAGE_KIND,
          occurredAt: { gte: last7DaysStart, lt: now },
        },
      }),
      prisma.hostedAiUsage.groupBy({
        by: ["memberId"],
        _sum: { allowanceCostUsdMicros: true },
        where: { allowanceCounted: true },
      }),
      readHostedAiUsageGateSnapshots({
        memberIds: members.map((member) => member.id),
        now,
        prisma,
      }),
    ]);

  const retainedByMember = new Map(
    retainedMessageCounts.map((row) => [row.userId, row._count._all]),
  );
  const last7DaysByMember = new Map(
    last7DayMessageCounts.map((row) => [row.userId, row._count._all]),
  );
  const usageByMember = new Map(
    usageTotals.map((row) => [
      row.memberId,
      row._sum.allowanceCostUsdMicros ?? 0n,
    ]),
  );

  const claimLookupKeys = members.flatMap((member) => {
    const snapshot = usageGateSnapshots.get(member.id);
    const decision = snapshot?.decision;
    if (
      !snapshot?.periodPersistedAt
      || !decision
      || (!decision.allowed && decision.reason !== "ai_usage_limit_exceeded")
    ) {
      return [];
    }
    const key = buildHostedUsageNoticeLookupKey({
      memberId: member.id,
      periodStart: decision.periodStart,
      planResetAt: decision.planResetAt,
      usageCreditLedgerVersion: decision.usageCreditLedgerVersion,
    });
    return key ? [key] : [];
  });
  const noticeClaims = claimLookupKeys.length > 0
    ? await prisma.hostedLinqDelivery.findMany({
        select: {
          idempotencyKey: true,
          status: true,
        },
        where: {
          idempotencyKey: { in: claimLookupKeys },
        },
      })
    : [];
  const noticeStatusByLookupKey = new Map(
    noticeClaims.flatMap((claim) => claim.idempotencyKey
      ? [[claim.idempotencyKey, claim.status] as const]
      : []),
  );

  const rows = members.map((member): HostedOpsMemberUsageRow => {
    const retained = retainedByMember.get(member.id) ?? 0;
    const last7Days = last7DaysByMember.get(member.id) ?? 0;
    const snapshot = usageGateSnapshots.get(member.id) ?? null;
    const decision = snapshot?.decision ?? null;
    const allowanceAvailable = decision !== null && (
      decision.allowed || decision.reason === "ai_usage_limit_exceeded"
    );
    const noticeLookupKey = allowanceAvailable && snapshot?.periodPersistedAt
      ? buildHostedUsageNoticeLookupKey({
          memberId: member.id,
          periodStart: decision.periodStart,
          planResetAt: decision.planResetAt,
          usageCreditLedgerVersion: decision.usageCreditLedgerVersion,
        })
      : null;
    const threadContainer = member.threadContainer;
    const legacyGroupContainer = member.hostedGroupRuntime;
    const isContainer = threadContainer !== null || legacyGroupContainer !== null;

    return {
      allowanceStatus: allowanceAvailable ? "available" : "unavailable",
      allTimeUsageUsdMicros: (usageByMember.get(member.id) ?? 0n).toString(),
      billingStatus: member.billingStatus,
      containerOwnerMemberId:
        threadContainer?.ownerMemberId
        ?? legacyGroupContainer?.ownerMemberId
        ?? null,
      createdAt: member.createdAt.toISOString(),
      currentPeriod: allowanceAvailable && decision && snapshot
        ? {
            blocked: !decision.allowed
              && decision.reason === "ai_usage_limit_exceeded",
            idempotencyClaimStatus: noticeLookupKey
              ? noticeStatusByLookupKey.get(noticeLookupKey) ?? null
              : null,
            limitUsdMicros: decision.limitUsdMicros.toString(),
            periodEnd: decision.periodEnd.toISOString(),
            periodStart: decision.periodStart.toISOString(),
            remainingUsdMicros: decision.remainingUsdMicros.toString(),
            spentUsdMicros: decision.spentUsdMicros.toString(),
            updatedAt: snapshot.periodPersistedAt?.toISOString() ?? null,
            usageCreditBalanceUsdMicros:
              decision.usageCreditBalanceUsdMicros.toString(),
            usageCreditLedgerVersion:
              decision.usageCreditLedgerVersion.toString(),
          }
        : null,
      maskedPhoneNumberHint: member.identity?.maskedPhoneNumberHint ?? null,
      memberId: member.id,
      memberKind: isContainer ? "group_container" : "member",
      messagesDailyAverage7Days: last7Days /
        HOSTED_USAGE_REPORTING_WINDOW_DAYS,
      messagesLast7Days: last7Days,
      messagesRetained: retained,
      participantCount: threadContainer?._count.participants
        ?? legacyGroupContainer?._count.members
        ?? null,
      suspended: member.suspendedAt !== null,
    };
  }).sort(compareHostedOpsUsageRows);

  const totalAllTimeUsageUsdMicros = rows.reduce(
    (total, row) => total + BigInt(row.allTimeUsageUsdMicros),
    0n,
  );

  return {
    capturedAt: now.toISOString(),
    messageRetentionDays: HOSTED_MESSAGE_RETENTION_DAYS,
    rows,
    summary: {
      activeEntitiesLast7Days: rows.filter((row) => row.messagesLast7Days > 0)
        .length,
      groupContainers: rows.filter((row) => row.memberKind === "group_container")
        .length,
      members: rows.filter((row) => row.memberKind === "member").length,
      totalAllTimeUsageUsdMicros: totalAllTimeUsageUsdMicros.toString(),
    },
  };
}

export async function resetHostedOpsMemberUsage(
  input: HostedOpsMemberUsageResetInput,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedOpsMemberUsageResetResult> {
  const now = input.now ?? new Date();
  assertValidDate(now, "Hosted ops usage reset timestamp is invalid.");
  assertValidDate(
    input.periodStart,
    "Hosted ops usage reset period start is invalid.",
  );
  assertValidDate(
    input.expectedPeriodUpdatedAt,
    "Hosted ops usage reset expected update timestamp is invalid.",
  );
  if (input.expectedUsageCreditLedgerVersion < 0n) {
    throw new TypeError("Hosted ops usage reset ledger version is invalid.");
  }

  return prisma.$transaction(async (tx) => {
    const memberRows = await tx.$queryRaw<Array<{
      usageCreditLedgerVersion: bigint | null;
    }>>`
      SELECT
        "usage_credit_ledger_version" AS "usageCreditLedgerVersion"
      FROM "hosted_member"
      WHERE "id" = ${input.memberId}
      FOR UPDATE
    `;
    const member = memberRows[0];
    if (!member) {
      throw new HostedOpsMemberUsageResetNotFoundError();
    }
    const usageCreditLedgerVersion = normalizeNonNegativeBigInt(
      member.usageCreditLedgerVersion,
    );
    if (
      usageCreditLedgerVersion !== input.expectedUsageCreditLedgerVersion
    ) {
      throw new HostedOpsMemberUsageResetStaleError();
    }

    const canonicalGate = await readHostedAiUsageGate({
      memberId: input.memberId,
      now,
      prisma: tx,
    });
    if (
      (!canonicalGate.allowed
        && canonicalGate.reason !== "ai_usage_limit_exceeded")
      || canonicalGate.periodStart.getTime() !== input.periodStart.getTime()
      || canonicalGate.usageCreditLedgerVersion
        !== input.expectedUsageCreditLedgerVersion
    ) {
      throw new HostedOpsMemberUsageResetStaleError();
    }

    const periodRows = await tx.$queryRaw<Array<{
      blockedAt: Date | null;
      periodEnd: Date;
      spentUsdMicros: bigint;
      updatedAt: Date;
    }>>`
      SELECT
        "blocked_at" AS "blockedAt",
        "period_end" AS "periodEnd",
        "spent_usd_micros" AS "spentUsdMicros",
        "updated_at" AS "updatedAt"
      FROM "hosted_ai_usage_period"
      WHERE "member_id" = ${input.memberId}
        AND "period_start" = ${input.periodStart}
      FOR UPDATE
    `;
    const period = periodRows[0];
    if (!period) {
      throw new HostedOpsMemberUsageResetNotFoundError();
    }
    if (
      period.updatedAt.getTime() !== input.expectedPeriodUpdatedAt.getTime()
    ) {
      throw new HostedOpsMemberUsageResetStaleError();
    }

    const noticeLookupKey = buildHostedUsageNoticeLookupKey({
      memberId: input.memberId,
      periodStart: input.periodStart,
      planResetAt: canonicalGate.planResetAt,
      usageCreditLedgerVersion,
    });
    const deliveryRows = noticeLookupKey
      ? await tx.$queryRaw<Array<{
          acceptedAt: Date | null;
          attemptedAt: Date;
          deliveredAt: Date | null;
          failedAt: Date | null;
          id: string;
          lastReceiptAt: Date | null;
          messageLookupKey: string | null;
          skippedAt: Date | null;
          status: string;
        }>>`
          SELECT
            "accepted_at" AS "acceptedAt",
            "attempted_at" AS "attemptedAt",
            "delivered_at" AS "deliveredAt",
            "failed_at" AS "failedAt",
            "id",
            "last_receipt_at" AS "lastReceiptAt",
            "message_lookup_key" AS "messageLookupKey",
            "skipped_at" AS "skippedAt",
            "status"
          FROM "hosted_linq_delivery"
          WHERE "idempotency_key" = ${noticeLookupKey}
          FOR UPDATE
        `
      : [];
    const delivery = deliveryRows[0] ?? null;
    if (delivery && isHostedUsageNoticeDispatchInFlight({ delivery, now })) {
      throw new HostedOpsMemberUsageResetNoticeInFlightError(
        new Date(
          delivery.attemptedAt.getTime()
            + HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
        ),
      );
    }

    if (delivery) {
      await tx.hostedLinqDelivery.update({
        data: { idempotencyKey: null },
        where: { id: delivery.id },
      });
    }

    const outcome = period.spentUsdMicros === 0n
        && period.blockedAt === null
        && delivery === null
      ? "unchanged"
      : "reset";
    if (outcome === "reset") {
      const updated = await tx.hostedAiUsagePeriod.updateMany({
        data: {
          blockedAt: null,
          spentUsdMicros: 0n,
          updatedAt: now,
        },
        where: {
          memberId: input.memberId,
          periodStart: input.periodStart,
          updatedAt: period.updatedAt,
        },
      });
      if (updated.count !== 1) {
        throw new HostedOpsMemberUsageResetStaleError();
      }
    }

    return {
      memberId: input.memberId,
      noticeClaimReleased: delivery !== null,
      outcome,
      periodStart: input.periodStart.toISOString(),
      previousSpentUsdMicros: period.spentUsdMicros.toString(),
      resetAt: now.toISOString(),
      updatedAt: outcome === "reset"
        ? now.toISOString()
        : period.updatedAt.toISOString(),
    };
  }, {
    ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

function buildHostedUsageNoticeLookupKey(input: {
  memberId: string;
  periodStart: Date;
  planResetAt: Date | null;
  usageCreditLedgerVersion: bigint;
}): string | null {
  return createHostedLinqDeliveryIdempotencyLookupKey(
    buildHostedAiUsageGateNoticeIdempotencyKey(input),
  );
}

function normalizeNonNegativeBigInt(value: bigint | null): bigint {
  const normalized = value ?? 0n;
  if (normalized < 0n) {
    throw new TypeError("Hosted usage projection cannot be negative.");
  }
  return normalized;
}

function compareHostedOpsUsageRows(
  left: HostedOpsMemberUsageRow,
  right: HostedOpsMemberUsageRow,
): number {
  if (left.memberKind !== right.memberKind) {
    return left.memberKind === "group_container" ? -1 : 1;
  }
  if (left.messagesLast7Days !== right.messagesLast7Days) {
    return right.messagesLast7Days - left.messagesLast7Days;
  }
  return left.memberId.localeCompare(right.memberId);
}

function isHostedUsageNoticeDispatchInFlight(input: {
  delivery: {
    acceptedAt: Date | null;
    attemptedAt: Date;
    deliveredAt: Date | null;
    failedAt: Date | null;
    lastReceiptAt: Date | null;
    messageLookupKey: string | null;
    skippedAt: Date | null;
    status: string;
  };
  now: Date;
}): boolean {
  const delivery = input.delivery;
  const preProvider = delivery.acceptedAt === null
    && delivery.deliveredAt === null
    && delivery.failedAt === null
    && delivery.lastReceiptAt === null
    && delivery.messageLookupKey === null
    && delivery.skippedAt === null
    && (
      delivery.status === "attempted"
      || delivery.status === "provider_dispatch_started"
    );
  return preProvider
    && delivery.attemptedAt.getTime()
      > input.now.getTime() - HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS;
}

function assertValidDate(value: Date, message: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(message);
  }
}
