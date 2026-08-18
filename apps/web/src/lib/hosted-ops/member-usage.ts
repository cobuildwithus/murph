import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  type HostedAiUsageGateSnapshot,
  readHostedAiUsageGate,
  readHostedAiUsageGateSnapshots,
} from "../hosted-execution/usage-allowance";
import {
  appendHostedUsageCreditGrantTx,
} from "../hosted-execution/usage-credit-grant";
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
import {
  HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
} from "../hosted-onboarding/starter-usage";
import { getPrisma } from "../prisma";

const HOSTED_CONVERSATION_MESSAGE_KIND = "conversation.message";
const HOSTED_MESSAGE_RETENTION_DAYS = 30;
const HOSTED_USAGE_REPORTING_WINDOW_DAYS = 7;
const HOSTED_OPS_STARTER_RESET_SOURCE_REFERENCE_LOOKUP_KEY =
  "hosted-ops-usage-reset:starter:v1";
export const HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE = 25;
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
  resetMode: HostedOpsMemberUsageResetMode | null;
  suspended: boolean;
}

export type HostedOpsMemberUsageResetMode =
  | "included_usage"
  | "starter_allowance";

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
  pagination: {
    nextCursor: string | null;
    pageSize: number;
    previousCursor: string | null;
  };
  rows: HostedOpsMemberUsageRow[];
  summary: {
    activeEntitiesLast7Days: number;
    groupContainers: number;
    members: number;
    totalAllTimeUsageUsdMicros: string;
  };
}

export interface HostedOpsMemberUsageReadInput {
  after?: string | null;
  before?: string | null;
  now?: Date;
  prisma?: PrismaClient;
}

interface HostedOpsMemberUsageSummaryRow {
  activeEntitiesLast7Days: string;
  groupContainers: string;
  members: string;
  totalAllTimeUsageUsdMicros: string;
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
  resetMode: HostedOpsMemberUsageResetMode;
  updatedAt: string;
  usageCreditGrantedUsdMicros: string;
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
  input: HostedOpsMemberUsageReadInput = {},
): Promise<HostedOpsMemberUsageDashboard> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  assertValidDate(now, "Hosted ops usage reporting timestamp is invalid.");
  const after = normalizeHostedOpsMemberUsageCursor(input.after);
  const before = normalizeHostedOpsMemberUsageCursor(input.before);
  if (after && before) {
    throw new TypeError(
      "Hosted ops usage pagination cannot specify both after and before cursors.",
    );
  }
  const last7DaysStart = new Date(
    now.getTime() - HOSTED_USAGE_REPORTING_WINDOW_DAYS * DAY_MS,
  );
  const retentionWindowStart = new Date(
    now.getTime() - HOSTED_MESSAGE_RETENTION_DAYS * DAY_MS,
  );
  const requestedDescending = before !== null;
  const cursor = before ?? after;
  let pageDescending = requestedDescending;
  let recoveredBoundaryPage = false;

  let memberKeyCandidates = await prisma.hostedMember.findMany({
    ...(cursor
      ? {
          where: {
            id: requestedDescending ? { lt: cursor } : { gt: cursor },
          },
        }
      : {}),
    orderBy: { id: requestedDescending ? "desc" : "asc" },
    select: { id: true },
    take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
  });
  // A strict cursor can become empty at a real endpoint or after deletions.
  // Re-anchor with one opposite-direction inclusive cap-plus-one scan so the
  // boundary member is not skipped when the operator navigates back.
  if (cursor && memberKeyCandidates.length === 0) {
    recoveredBoundaryPage = true;
    pageDescending = !requestedDescending;
    memberKeyCandidates = await prisma.hostedMember.findMany({
      orderBy: { id: pageDescending ? "desc" : "asc" },
      select: { id: true },
      take: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE + 1,
      where: {
        id: pageDescending ? { lte: cursor } : { gte: cursor },
      },
    });
  }
  const hasMoreInReadDirection =
    memberKeyCandidates.length > HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE;
  const selectedMemberKeys = memberKeyCandidates.slice(
    0,
    HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
  );
  const pageMemberIds = (
    pageDescending ? selectedMemberKeys.reverse() : selectedMemberKeys
  ).map((member) => member.id);
  const members = pageMemberIds.length > 0
    ? await prisma.hostedMember.findMany({
        orderBy: { id: "asc" },
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
        where: { id: { in: pageMemberIds } },
      })
    : [];
  const memberIds = members.map((member) => member.id);

  const summaryRows = await prisma.$queryRaw<HostedOpsMemberUsageSummaryRow[]>`
    WITH "member_counts" AS (
      SELECT
        COUNT(*) FILTER (
          WHERE "thread_container"."member_id" IS NULL
            AND "legacy_group"."runtime_member_id" IS NULL
        )::text AS "members",
        COUNT(*) FILTER (
          WHERE "thread_container"."member_id" IS NOT NULL
            OR "legacy_group"."runtime_member_id" IS NOT NULL
        )::text AS "groupContainers"
      FROM "hosted_member" AS "hosted_member"
      LEFT JOIN "hosted_thread_container" AS "thread_container"
        ON "thread_container"."member_id" = "hosted_member"."id"
      LEFT JOIN "hosted_group" AS "legacy_group"
        ON "legacy_group"."runtime_member_id" = "hosted_member"."id"
    )
    SELECT
      "member_counts"."members",
      "member_counts"."groupContainers",
      (
        SELECT COUNT(DISTINCT "mailbox_item"."user_id")::text
        FROM "hosted_mailbox_item" AS "mailbox_item"
        WHERE "mailbox_item"."kind" = ${HOSTED_CONVERSATION_MESSAGE_KIND}
          AND "mailbox_item"."occurred_at" >= ${last7DaysStart}
          AND "mailbox_item"."occurred_at" < ${now}
      ) AS "activeEntitiesLast7Days",
      (
        SELECT COALESCE(
          SUM("usage"."allowance_cost_usd_micros"),
          0
        )::text
        FROM "hosted_ai_usage" AS "usage"
        WHERE "usage"."allowance_counted" = TRUE
      ) AS "totalAllTimeUsageUsdMicros"
    FROM "member_counts"
  `;
  const summary = normalizeHostedOpsMemberUsageSummary(summaryRows[0]);

  const retainedMessageCounts = memberIds.length > 0
    ? await prisma.hostedMailboxItem.groupBy({
        by: ["userId"],
        _count: { _all: true },
        where: {
          kind: HOSTED_CONVERSATION_MESSAGE_KIND,
          occurredAt: { gte: retentionWindowStart, lt: now },
          userId: { in: memberIds },
        },
      })
    : [];
  const last7DayMessageCounts = memberIds.length > 0
    ? await prisma.hostedMailboxItem.groupBy({
        by: ["userId"],
        _count: { _all: true },
        where: {
          kind: HOSTED_CONVERSATION_MESSAGE_KIND,
          occurredAt: { gte: last7DaysStart, lt: now },
          userId: { in: memberIds },
        },
      })
    : [];
  const usageTotals = memberIds.length > 0
    ? await prisma.hostedAiUsage.groupBy({
        by: ["memberId"],
        _sum: { allowanceCostUsdMicros: true },
        where: {
          allowanceCounted: true,
          memberId: { in: memberIds },
        },
      })
    : [];
  const usageGateSnapshots = memberIds.length > 0
    ? await readHostedAiUsageGateSnapshots({
        memberIds,
        now,
        prisma,
      })
    : new Map<string, HostedAiUsageGateSnapshot>();

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
    const resetMode = allowanceAvailable && decision && snapshot?.periodPersistedAt
      ? decision.allowanceSource === "direct_starter"
        ? !decision.allowed && decision.reason === "ai_usage_limit_exceeded"
          ? "starter_allowance"
          : null
        : "included_usage"
      : null;
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
      resetMode,
      suspended: member.suspendedAt !== null,
    };
  });

  const firstMemberId = pageMemberIds[0] ?? null;
  const lastMemberId = pageMemberIds.at(-1) ?? null;
  let nextCursor: string | null;
  let previousCursor: string | null;
  if (recoveredBoundaryPage) {
    nextCursor = pageDescending
      ? null
      : hasMoreInReadDirection
        ? lastMemberId
        : null;
    previousCursor = pageDescending && hasMoreInReadDirection
      ? firstMemberId
      : null;
  } else if (requestedDescending) {
    nextCursor = lastMemberId ?? before;
    previousCursor = hasMoreInReadDirection ? firstMemberId : null;
  } else {
    nextCursor = hasMoreInReadDirection ? lastMemberId : null;
    previousCursor = after ? firstMemberId ?? after : null;
  }

  return {
    capturedAt: now.toISOString(),
    messageRetentionDays: HOSTED_MESSAGE_RETENTION_DAYS,
    pagination: {
      nextCursor,
      pageSize: HOSTED_OPS_MEMBER_USAGE_PAGE_SIZE,
      previousCursor,
    },
    rows,
    summary,
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
      hasActiveUsageCreditGrant: boolean;
      usageCreditBalanceUsdMicros: bigint | null;
      usageCreditLedgerVersion: bigint | null;
    }>>`
      SELECT
        EXISTS (
          SELECT 1
          FROM "hosted_usage_credit_grant" AS "grant_projection"
          WHERE "grant_projection"."beneficiary_member_id" = "hosted_member"."id"
            AND "grant_projection"."remaining_usd_micros" > 0
        ) AS "hasActiveUsageCreditGrant",
        "usage_credit_balance_usd_micros" AS "usageCreditBalanceUsdMicros",
        "usage_credit_ledger_version" AS "usageCreditLedgerVersion"
      FROM "hosted_member" AS "hosted_member"
      WHERE "hosted_member"."id" = ${input.memberId}
      FOR UPDATE
    `;
    const member = memberRows[0];
    if (!member) {
      throw new HostedOpsMemberUsageResetNotFoundError();
    }
    const usageCreditLedgerVersion = normalizeNonNegativeBigInt(
      member.usageCreditLedgerVersion,
    );
    const usageCreditBalanceUsdMicros = normalizeNonNegativeBigInt(
      member.usageCreditBalanceUsdMicros,
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
      || canonicalGate.usageCreditBalanceUsdMicros
        !== usageCreditBalanceUsdMicros
      || canonicalGate.usageCreditLedgerVersion
        !== input.expectedUsageCreditLedgerVersion
    ) {
      throw new HostedOpsMemberUsageResetStaleError();
    }
    const resetMode: HostedOpsMemberUsageResetMode =
      canonicalGate.allowanceSource === "direct_starter"
        ? "starter_allowance"
        : "included_usage";
    if (
      resetMode === "starter_allowance"
      && (
        canonicalGate.allowed
        || canonicalGate.reason !== "ai_usage_limit_exceeded"
        || usageCreditBalanceUsdMicros !== 0n
      )
    ) {
      throw new HostedOpsMemberUsageResetStaleError();
    }
    if (
      resetMode === "starter_allowance"
      && member.hasActiveUsageCreditGrant
    ) {
      throw new TypeError(
        "Hosted ops Starter reset found active credit with a zero balance.",
      );
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

    const outcome = resetMode === "included_usage"
        && period.spentUsdMicros === 0n
        && period.blockedAt === null
        && delivery === null
      ? "unchanged"
      : "reset";
    let usageCreditGrantedUsdMicros = 0n;
    if (resetMode === "starter_allowance") {
      const grant = await appendHostedUsageCreditGrantTx({
        effectiveAt: now,
        grantUsdMicros: HOSTED_STARTER_USAGE_GRANT_USD_MICROS,
        lockedBeneficiary: {
          balanceUsdMicros: usageCreditBalanceUsdMicros,
          beneficiaryMemberId: input.memberId,
          ledgerVersion: usageCreditLedgerVersion,
        },
        semanticSourceKey: buildHostedOpsStarterResetSemanticSourceKey({
          memberId: input.memberId,
          usageCreditLedgerVersion,
        }),
        source: {
          kind: "starter",
          sourceReferenceLookupKey:
            HOSTED_OPS_STARTER_RESET_SOURCE_REFERENCE_LOOKUP_KEY,
        },
        tx,
      });
      if (!grant.granted) {
        throw new TypeError(
          "Hosted ops Starter reset unexpectedly replayed an existing grant.",
        );
      }
      usageCreditGrantedUsdMicros = HOSTED_STARTER_USAGE_GRANT_USD_MICROS;
    }
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
          ...(resetMode === "included_usage"
            ? { updatedAt: period.updatedAt }
            : {}),
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
      resetMode,
      updatedAt: outcome === "reset"
        ? now.toISOString()
        : period.updatedAt.toISOString(),
      usageCreditGrantedUsdMicros: usageCreditGrantedUsdMicros.toString(),
    };
  }, {
    ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

function buildHostedOpsStarterResetSemanticSourceKey(input: {
  memberId: string;
  usageCreditLedgerVersion: bigint;
}): string {
  return [
    "hosted-ops-usage-reset",
    input.memberId,
    "starter",
    `after-ledger-${input.usageCreditLedgerVersion.toString()}`,
    "v1",
  ].join(":");
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

function normalizeHostedOpsMemberUsageCursor(
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError("Hosted ops usage pagination cursor is invalid.");
  }
  return normalized;
}

function normalizeHostedOpsMemberUsageSummary(
  row: HostedOpsMemberUsageSummaryRow | undefined,
): HostedOpsMemberUsageDashboard["summary"] {
  if (!row) {
    throw new TypeError("Hosted ops usage summary query returned no row.");
  }
  return {
    activeEntitiesLast7Days: normalizeHostedOpsMemberUsageCount(
      row.activeEntitiesLast7Days,
    ),
    groupContainers: normalizeHostedOpsMemberUsageCount(row.groupContainers),
    members: normalizeHostedOpsMemberUsageCount(row.members),
    totalAllTimeUsageUsdMicros: parseHostedOpsMemberUsageSummaryBigInt(
      row.totalAllTimeUsageUsdMicros,
    ).toString(),
  };
}

function normalizeHostedOpsMemberUsageCount(value: string): number {
  const normalized = parseHostedOpsMemberUsageSummaryBigInt(value);
  if (normalized > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("Hosted ops usage summary count exceeds safe range.");
  }
  return Number(normalized);
}

function parseHostedOpsMemberUsageSummaryBigInt(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new TypeError("Hosted ops usage summary value is invalid.");
  }
  return BigInt(value);
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
