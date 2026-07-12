import "server-only";

import type { Prisma } from "@prisma/client";
import {
  isHostedCallCircleCancelableNotificationEventId,
  type HostedCallCircleNotificationDeliveryClaimRequest,
} from "@murphai/hosted-execution/call-circle";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import {
  readCallCircleConfirmNotificationAnchor,
  readCallCircleSetupNotificationGroupId,
} from "./notifications";
import { canUseActiveCallCircleParticipant } from "./participant-store";

export async function claimCallCircleNotificationDelivery(input: {
  memberId: string;
  now?: Date;
  prisma: Prisma.TransactionClient;
  request: HostedCallCircleNotificationDeliveryClaimRequest;
}): Promise<void> {
  if (!isHostedCallCircleCancelableNotificationEventId(
    input.request.deliveryIdempotencyKey,
  )) {
    return;
  }

  await lockHostedMemberRow(input.prisma, input.memberId);
  if (!await canDeliverCurrentCallCircleNotification(input)) {
    throwCallCircleNotificationSuperseded();
  }

  const mailboxItemIds = [...new Set(input.request.answeredMailboxItemIds)].sort();
  const now = input.now ?? new Date();
  await input.prisma.hostedMailboxItem.updateMany({
    data: { consumedAt: now },
    where: {
      consumedAt: null,
      dedupeKey: input.request.deliveryIdempotencyKey,
      id: { in: mailboxItemIds },
      kind: "assistant.notification.requested",
      userId: input.memberId,
    },
  });

  const notification = await input.prisma.hostedMailboxItem.findUnique({
    select: {
      consumedAt: true,
      id: true,
      kind: true,
    },
    where: {
      userId_dedupeKey: {
        dedupeKey: input.request.deliveryIdempotencyKey,
        userId: input.memberId,
      },
    },
  });
  if (
    notification
    && mailboxItemIds.includes(notification.id)
    && notification.kind === "assistant.notification.requested"
    && notification.consumedAt !== null
  ) {
    return;
  }

  throwCallCircleNotificationSuperseded();
}

async function canDeliverCurrentCallCircleNotification(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  request: HostedCallCircleNotificationDeliveryClaimRequest;
}): Promise<boolean> {
  const setupGroupId = readCallCircleSetupNotificationGroupId({
    eventId: input.request.deliveryIdempotencyKey,
    memberId: input.memberId,
  });
  if (setupGroupId) {
    return canUseActiveCallCircleParticipant({
      groupId: setupGroupId,
      memberId: input.memberId,
      prisma: input.prisma,
    });
  }

  const anchor = readCallCircleConfirmNotificationAnchor({
    eventId: input.request.deliveryIdempotencyKey,
    memberId: input.memberId,
  });
  if (!anchor) return false;
  const match = await input.prisma.hostedCallCircleMatch.findUnique({
    select: {
      amAskedAt: true,
      finalAskedAt: true,
      groupId: true,
      memberAId: true,
      memberBId: true,
      sideAResponse: true,
      sideBResponse: true,
      status: true,
      windowStartAt: true,
    },
    where: { id: anchor.matchId },
  });
  if (
    !match
    || match.status !== "asking"
    || match.windowStartAt.getTime() !== anchor.windowStartAt.getTime()
    || (anchor.stage === "am" ? !match.amAskedAt : !match.finalAskedAt)
  ) {
    return false;
  }
  const responseIsPending = match.memberAId === input.memberId
    ? match.sideAResponse === "pending"
    : match.memberBId === input.memberId && match.sideBResponse === "pending";
  if (!responseIsPending) return false;
  return canUseActiveCallCircleParticipant({
    groupId: match.groupId,
    memberId: input.memberId,
    prisma: input.prisma,
  });
}

function throwCallCircleNotificationSuperseded(): never {
  throw hostedOnboardingError({
    code: "HOSTED_CALL_CIRCLE_NOTIFICATION_SUPERSEDED",
    httpStatus: 409,
    message: "That Call Circle notification is no longer current.",
    retryable: false,
  });
}
