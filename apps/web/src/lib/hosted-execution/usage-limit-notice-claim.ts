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

export async function startAuthorizedHostedAiUsageLimitNoticeDispatchTx(input: {
  assertDispatchAuthority?: (
    prisma: Prisma.TransactionClient,
  ) => Promise<void>;
  attemptedAt: Date;
  memberId: string;
  noticeDeliveryTarget: HostedRuntimeUsageNoticeDeliveryTarget;
  periodStart: Date;
  prisma: PrismaClient;
  source: HostedAiUsageLimitNoticeDeliverySource;
  sourceRef: string;
  targetKind: string;
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
        prisma,
        source: input.source,
        sourceRef: input.sourceRef,
        targetKind: input.targetKind,
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

async function lockHostedAiUsageLimitNoticeEligibilityTx(input: {
  attemptedAt: Date;
  memberId: string;
  periodStart: Date;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const rows = await input.tx.$queryRaw<Array<{ eligible: boolean }>>`
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
