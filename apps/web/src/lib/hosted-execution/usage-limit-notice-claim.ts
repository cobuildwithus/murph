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
import type { HostedAiUsageLimitNoticeCode } from "./usage-allowance";
import {
  assertHostedThreadRouteEgressAuthority,
  lockHostedThreadRouteByThreadIdentityTx,
} from "../hosted-routing/thread-route-store";

export type HostedAiUsageLimitNoticeAuthorizedDeliveryClaim =
  | HostedAiUsageLimitNoticeDeliveryClaim
  | { status: "not_authorized" };

export async function startAuthorizedHostedAiUsageLimitNoticeDispatchTx(input: {
  assertDispatchAuthority?: (
    prisma: Prisma.TransactionClient,
  ) => Promise<void>;
  attemptedAt: Date;
  memberId: string;
  noticeCode?: HostedAiUsageLimitNoticeCode;
  noticeDeliveryTarget: HostedRuntimeUsageNoticeDeliveryTarget;
  periodStart: Date;
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

  try {
    return await input.prisma.$transaction(async (prisma) => {
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
            noticeCode: input.noticeCode ?? "thread_usage_limit_reached",
            periodStart: input.periodStart,
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
        ...(input.noticeCode ? { noticeCode: input.noticeCode } : {}),
        periodStart: input.periodStart,
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
    throw error;
  }
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
  noticeCode: HostedAiUsageLimitNoticeCode;
  periodStart: Date;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const rows = input.noticeCode === "thread_usage_low"
    ? await input.tx.$queryRaw<Array<{ eligible: boolean }>>`
        SELECT TRUE AS "eligible"
        FROM "hosted_ai_usage_period" AS "period"
        INNER JOIN "hosted_member" AS "member"
          ON "member"."id" = "period"."member_id"
        INNER JOIN "hosted_thread_container" AS "container"
          ON "container"."member_id" = "member"."id"
        WHERE "period"."member_id" = ${input.memberId}
          AND "period"."period_start" = ${input.periodStart}
          AND "period"."period_start" <= ${input.attemptedAt}
          AND "period"."period_end" > ${input.attemptedAt}
          AND "period"."blocked_at" IS NULL
          AND GREATEST(
            "period"."limit_usd_micros" - "period"."spent_usd_micros",
            0
          ) + COALESCE("member"."usage_credit_balance_usd_micros", 0) > 0
          AND GREATEST(
            "period"."limit_usd_micros" - "period"."spent_usd_micros",
            0
          ) + COALESCE("member"."usage_credit_balance_usd_micros", 0)
            <= ("period"."limit_usd_micros" + 4) / 5
        FOR UPDATE OF "period"
      `
    : await input.tx.$queryRaw<Array<{ eligible: boolean }>>`
        SELECT TRUE AS "eligible"
        FROM "hosted_ai_usage_period"
        WHERE "member_id" = ${input.memberId}
          AND "period_start" = ${input.periodStart}
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
