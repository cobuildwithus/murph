import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import type { HostedWebhookWakeHandoff } from "../hosted-onboarding/webhook-service-types";
import {
  resolveHostedAssistantNotificationDestination,
  type HostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";
import {
  isHostedSignupReferralPolicyVersion,
} from "./signup-referral-policy";
import {
  buildHostedUsageReferralRewardLabel,
} from "./usage-referral";

export async function appendHostedSignupReferralRewardNotice(input: {
  prisma: PrismaClient;
  referralId: string;
}): Promise<HostedWebhookWakeHandoff | null> {
  const referral = await input.prisma.hostedUsageReferral.findUnique({
    select: {
      beneficiaryMemberId: true,
      celebrationQueuedAt: true,
      policyVersion: true,
      referrerMemberId: true,
      rewardUsdMicros: true,
      rewardedAt: true,
      status: true,
    },
    where: { id: input.referralId },
  });
  if (
    !referral
    || referral.status !== "rewarded"
    || !referral.rewardedAt
    || referral.celebrationQueuedAt
    || referral.referrerMemberId !== referral.beneficiaryMemberId
    || !isHostedSignupReferralPolicyVersion(referral.policyVersion)
  ) {
    return null;
  }

  const destination = await resolveHostedAssistantNotificationDestination({
    memberId: referral.beneficiaryMemberId,
    prisma: input.prisma,
  });
  if (!destination) {
    await rotateHostedSignupReferralRewardNoticeRetry({
      prisma: input.prisma,
      referralId: input.referralId,
    });
    return null;
  }

  const rewardedAt = referral.rewardedAt;
  const notificationKey = `usage-referral-reward:${input.referralId}`;
  const celebrationQueuedAt = new Date(
    Math.max(Date.now(), rewardedAt.getTime()),
  );
  const appended = await input.prisma.$transaction(async (tx) => {
    const mailbox = await appendHostedMailboxEnvelopeTx({
      envelope: buildHostedSignupReferralRewardNoticeWake({
        beneficiaryMemberId: referral.beneficiaryMemberId,
        destination,
        notificationKey,
        rewardLabel: buildHostedUsageReferralRewardLabel({
          destinationKind: "personal",
          policyCode: "new_person_activation_v1",
          policyVersion: referral.policyVersion,
          rewardUsdMicros: referral.rewardUsdMicros,
        }),
        rewardedAt,
      }),
      tx,
    });
    const queued = await tx.hostedUsageReferral.updateMany({
      data: {
        celebrationQueuedAt,
        sourceConversationJson: Prisma.DbNull,
      },
      where: {
        beneficiaryMemberId: referral.beneficiaryMemberId,
        celebrationQueuedAt: null,
        id: input.referralId,
        policyVersion: referral.policyVersion,
        referrerMemberId: referral.referrerMemberId,
        rewardedAt,
        status: "rewarded",
      },
    });
    if (queued.count !== 1) {
      throw new TypeError(
        "Hosted signup-referral notice lost its rewarded referral.",
      );
    }
    return mailbox;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return {
    eventId: appended.item.dedupeKey,
    ...(destination.route.channel === "linq"
      && destination.route.delivery.kind === "thread"
      ? { linqChatId: destination.route.delivery.target }
      : {}),
    mailboxItemId: appended.item.id,
    source: destination.route.channel === "telegram" ? "telegram" : "linq",
    userId: referral.beneficiaryMemberId,
    wakeMailboxCheckpoint: {
      lane: appended.item.lane,
      laneSeq: appended.item.laneSeq,
    },
  };
}

export function buildHostedSignupReferralRewardNoticeWake(input: {
  beneficiaryMemberId: string;
  destination: HostedAssistantNotificationDestination;
  notificationKey: string;
  rewardLabel: string;
  rewardedAt: Date;
}) {
  const routeAuthority = input.destination.externalThreadRouteAuthority
    ?? (
      input.destination.conversationShape === "direct-member"
        && input.destination.route.channel === "telegram"
        && input.destination.route.threadIsDirect === true
        ? {
            channel: "telegram" as const,
            containerMemberId: input.beneficiaryMemberId,
            threadId: input.destination.route.delivery.target,
          }
        : null
    );
  const route =
    input.destination.conversationShape === "direct-member"
    && input.destination.route.channel === "linq"
    && input.destination.route.delivery.kind === "thread"
      ? {
          ...input.destination.route,
          delivery: {
            ...input.destination.route.delivery,
            kind: "explicit" as const,
          },
        }
      : input.destination.route;

  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: `assistant.notification.requested:${input.notificationKey}`,
    memberId: input.beneficiaryMemberId,
    notification: {
      deliveryDedupeToken: input.notificationKey,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: input.notificationKey,
      ...(routeAuthority
        ? { externalThreadRouteAuthority: routeAuthority }
        : {}),
      instructions: [
        "Tell the member that someone completed Murph setup through their referral link.",
        `The member has already received ${input.rewardLabel}.`,
        `Final message: include "${input.rewardLabel}" exactly and say it is already applied.`,
        "Celebrate in one concise sentence and make clear that the reward is already applied.",
        "Do not identify, name, or guess who joined.",
        "Do not mention internal accounting, qualification checks, caps, or server policy.",
        "Do not ask the member to complete another step.",
      ].join(" "),
      responsePolicy: { kind: "require_send" },
      route,
    },
    occurredAt: input.rewardedAt.toISOString(),
  });
}

async function rotateHostedSignupReferralRewardNoticeRetry(input: {
  prisma: PrismaClient;
  referralId: string;
}): Promise<void> {
  await input.prisma.hostedUsageReferral.updateMany({
    data: { updatedAt: new Date() },
    where: {
      celebrationQueuedAt: null,
      id: input.referralId,
      status: "rewarded",
    },
  });
}
