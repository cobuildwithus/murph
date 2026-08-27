import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type {
  HostedRuntimeUsageNoticeDeliveryTarget,
} from "@murphai/hosted-execution/runtime-control";

import {
  lockHostedMemberRoutingStateTx,
  readHostedMemberRoutingState,
} from "../hosted-onboarding/hosted-member-routing-store";
import {
  type HostedAiUsageLimitNoticeDeliveryClaim,
  type HostedAiUsageLimitNoticeDeliverySource,
  startHostedAiUsageLimitNoticeDispatchTx,
} from "../hosted-onboarding/linq-delivery-store";
import {
  assertHostedLinqRouteAuthorityMatchesTarget,
} from "../hosted-onboarding/linq-egress-engagement";
import {
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import {
  assertHostedThreadRouteEgressAuthority,
  lockHostedThreadRouteByThreadIdentityTx,
} from "../hosted-routing/thread-route-store";

export type HostedAiUsageLimitNoticeAuthorizedDeliveryClaim =
  | HostedAiUsageLimitNoticeDeliveryClaim
  | { status: "not_authorized" };

// This transaction is the complete pre-provider claim boundary, so one
// serializable replay is safe while provider delivery remains outside it.
const HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_ATTEMPTS = 2;

export async function startAuthorizedHostedAiUsageLimitNoticeDispatchTx(input: {
  assertDispatchAuthority?: (
    prisma: Prisma.TransactionClient,
  ) => Promise<void>;
  attemptedAt: Date;
  memberId: string;
  noticeDeliveryTarget: HostedRuntimeUsageNoticeDeliveryTarget;
  periodStart: Date;
  planResetAt?: Date | null;
  prisma: PrismaClient;
  source: HostedAiUsageLimitNoticeDeliverySource;
  sourceRef: string;
  targetKind: string;
  usageCreditLedgerVersion: bigint;
}): Promise<HostedAiUsageLimitNoticeAuthorizedDeliveryClaim> {
  const targetNotAuthorized = new Error(
    "Hosted AI usage-limit notice target is no longer authorized.",
  );
  const noticeNotEligible = new Error(
    "Hosted AI usage-limit notice allowance period is no longer blocked.",
  );
  const claim = () => input.prisma.$transaction(async (prisma) => {
    return await startHostedAiUsageLimitNoticeDispatchTx({
      assertDispatchAuthority: async (claimPrisma) => {
        if (!await lockHostedAiUsageLimitNoticeCapacityEpochTx({
          memberId: input.memberId,
          tx: claimPrisma,
          usageCreditLedgerVersion: input.usageCreditLedgerVersion,
        })) {
          throw noticeNotEligible;
        }
        if (!await isHostedAiUsageLimitNoticeTargetAuthorizedTx({
          memberId: input.memberId,
          noticeDeliveryTarget: input.noticeDeliveryTarget,
          prisma: claimPrisma,
        })) {
          throw targetNotAuthorized;
        }
        await input.assertDispatchAuthority?.(claimPrisma);
        if (!await lockHostedAiUsageLimitNoticeEligibilityTx({
          attemptedAt: input.attemptedAt,
          memberId: input.memberId,
          periodStart: input.periodStart,
          planResetAt: input.planResetAt ?? null,
          tx: claimPrisma,
        })) {
          throw noticeNotEligible;
        }
      },
      attemptedAt: input.attemptedAt,
      ...(input.noticeDeliveryTarget.channel === "linq"
        ? { linqChatId: input.noticeDeliveryTarget.target }
        : {}),
      memberId: input.memberId,
      periodStart: input.periodStart,
      planResetAt: input.planResetAt ?? null,
      prisma,
      source: input.source,
      sourceRef: input.sourceRef,
      targetKind: input.targetKind,
      usageCreditLedgerVersion: input.usageCreditLedgerVersion,
    });
  }, {
    ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await claim();
    } catch (error) {
      if (error === noticeNotEligible) {
        return { status: "already_notified" };
      }
      if (
        error === targetNotAuthorized
        || (isHostedOnboardingError(error) && error.httpStatus === 403)
      ) {
        return { status: "not_authorized" };
      }
      if (
        attempt < HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_ATTEMPTS
        && isHostedAiUsageLimitNoticeClaimSerializationConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }
}

function isHostedAiUsageLimitNoticeClaimSerializationConflict(
  error: unknown,
): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  if (error.code === "P2034") {
    return true;
  }
  if (error.code !== "P2010" || !("meta" in error)) {
    return false;
  }

  return readHostedAiUsageLimitNoticeClaimPostgresCode(error.meta) === "40001";
}

function readHostedAiUsageLimitNoticeClaimPostgresCode(
  meta: unknown,
): string | null {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  if ("code" in meta && typeof meta.code === "string") {
    return meta.code;
  }
  if (!("driverAdapterError" in meta)) {
    return null;
  }
  const driverAdapterError = meta.driverAdapterError;
  if (
    !driverAdapterError
    || typeof driverAdapterError !== "object"
    || !("cause" in driverAdapterError)
  ) {
    return null;
  }
  const cause = driverAdapterError.cause;
  if (!cause || typeof cause !== "object") {
    return null;
  }
  if ("originalCode" in cause && typeof cause.originalCode === "string") {
    return cause.originalCode;
  }
  return "code" in cause && typeof cause.code === "string"
    ? cause.code
    : null;
}

async function lockHostedAiUsageLimitNoticeCapacityEpochTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
  usageCreditLedgerVersion: bigint;
}): Promise<boolean> {
  const rows = await input.tx.$queryRaw<Array<{ eligible: boolean }>>`
    SELECT TRUE AS "eligible"
    FROM "hosted_member"
    WHERE "id" = ${input.memberId}
      AND COALESCE("usage_credit_ledger_version", 0) = ${input.usageCreditLedgerVersion}
    FOR UPDATE
  `;

  return rows[0]?.eligible === true;
}

async function lockHostedAiUsageLimitNoticeEligibilityTx(input: {
  attemptedAt: Date;
  memberId: string;
  periodStart: Date;
  planResetAt: Date | null;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const rows = await input.tx.$queryRaw<Array<{ eligible: boolean }>>`
    SELECT TRUE AS "eligible"
    FROM "hosted_ai_usage_period"
    WHERE "member_id" = ${input.memberId}
      AND "period_start" = ${input.periodStart}
      AND "plan_reset_at" IS NOT DISTINCT FROM ${input.planResetAt}
      AND "period_start" <= ${input.attemptedAt}
      AND "period_end" > ${input.attemptedAt}
      AND "blocked_at" IS NOT NULL
    FOR UPDATE
  `;

  return rows[0]?.eligible === true;
}

async function isHostedAiUsageLimitNoticeTargetAuthorizedTx(input: {
  memberId: string;
  noticeDeliveryTarget: HostedRuntimeUsageNoticeDeliveryTarget;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  if (
    input.noticeDeliveryTarget.channel === "linq"
    && input.noticeDeliveryTarget.routeAuthority
  ) {
    try {
      const authority = assertHostedLinqRouteAuthorityMatchesTarget({
        chatId: input.noticeDeliveryTarget.target,
        memberId: input.memberId,
        routeAuthority: input.noticeDeliveryTarget.routeAuthority,
      });
      await lockHostedThreadRouteByThreadIdentityTx({
        authority,
        prisma: input.prisma,
      });
      await assertHostedThreadRouteEgressAuthority({
        authority,
        prisma: input.prisma,
      });
      return true;
    } catch (error) {
      if (isHostedOnboardingError(error) && error.httpStatus === 403) {
        return false;
      }
      throw error;
    }
  }

  await lockHostedMemberRoutingStateTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const authorizedTarget = input.noticeDeliveryTarget.channel === "linq"
    ? routing?.linqChatId
    : routing?.telegramThreadId;
  return Boolean(
    authorizedTarget
    && authorizedTarget === input.noticeDeliveryTarget.target,
  );
}
