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
    if (
      error === targetNotAuthorized
      || (isHostedOnboardingError(error) && error.httpStatus === 403)
    ) {
      return { status: "not_authorized" };
    }
    throw error;
  }
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
