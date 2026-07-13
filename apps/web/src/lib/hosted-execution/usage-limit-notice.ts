import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  HostedLinqThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import {
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
  type HostedLinqAiUsageQuotaClaimToken,
} from "../hosted-onboarding/webhook-transport";
import type {
  HostedAiUsageGateNoticeCode,
  HostedAiUsageLimitNoticeCode,
} from "./usage-allowance";

type HostedAiUsageLimitNoticeClient = PrismaClient | Prisma.TransactionClient;

export type HostedAiUsageLimitNoticeDeliveryResult =
  | { status: "already_notified" }
  | { retryAt?: Date; status: "in_flight" }
  | { status: "not_applicable" }
  | { status: "sent" };

export async function sendClaimedHostedAiUsageLimitNoticeToLinqChat(input: {
  chatId: string;
  claimToken: HostedLinqAiUsageQuotaClaimToken;
  memberId: string;
  message: string;
  noticeCode: HostedAiUsageLimitNoticeCode;
  occurredAt: string;
  prisma: HostedAiUsageLimitNoticeClient;
  replyToMessageId?: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  signal?: AbortSignal;
  sourceEventId: string;
}): Promise<HostedAiUsageLimitNoticeDeliveryResult> {
  const result = await drainHostedLinqSideEffectsDirect({
    prisma: input.prisma,
    sideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        claimToken: input.claimToken,
        memberId: input.memberId,
        message: input.message,
        noticeCode: input.noticeCode,
        occurredAt: input.occurredAt,
        replyToMessageId: input.replyToMessageId ?? null,
        ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
        sourceEventId: input.sourceEventId,
        template: "ai_usage_quota",
      }),
    ],
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (result.sentCount > 0) {
    return { status: "sent" };
  }

  const usageNoticeSkip = result.skipped.find((skip) => skip.template === "ai_usage_quota");
  switch (usageNoticeSkip?.reason) {
    case "notice_already_claimed":
      return { status: "already_notified" };
    case "notice_in_flight":
      return {
        ...(usageNoticeSkip.retryAt ? { retryAt: usageNoticeSkip.retryAt } : {}),
        status: "in_flight",
      };
    default:
      return { status: "not_applicable" };
  }
}

export async function sendHostedTrialConversionNoticeToLinqChat(input: {
  chatId: string;
  memberId: string;
  message: string;
  occurredAt: string;
  prisma: HostedAiUsageLimitNoticeClient;
  replyToMessageId?: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  signal?: AbortSignal;
  sourceEventId: string;
}): Promise<void> {
  await sendHostedAiUsageDeniedResponseToLinqChat({
    ...input,
    noticeCode: "trial_conversion_pending",
  });
}

export async function sendHostedAiUsageDeniedResponseToLinqChat(input: {
  chatId: string;
  memberId: string;
  message: string;
  noticeCode: HostedAiUsageGateNoticeCode;
  occurredAt: string;
  prisma: HostedAiUsageLimitNoticeClient;
  replyToMessageId?: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  signal?: AbortSignal;
  sourceEventId: string;
}): Promise<HostedAiUsageLimitNoticeDeliveryResult> {
  const result = await drainHostedLinqSideEffectsDirect({
    prisma: input.prisma,
    sideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        claimToken: null,
        memberId: input.memberId,
        message: input.message,
        noticeCode: input.noticeCode,
        occurredAt: input.occurredAt,
        replyToMessageId: input.replyToMessageId ?? null,
        ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
        sourceEventId: input.sourceEventId,
        template: "ai_usage_quota",
      }),
    ],
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (result.sentCount > 0) {
    return { status: "sent" };
  }
  const inFlight = result.skipped.find((skip) => skip.reason === "notice_in_flight");
  return inFlight
    ? {
        ...(inFlight.retryAt ? { retryAt: inFlight.retryAt } : {}),
        status: "in_flight",
      }
    : result.skipped.some((skip) => skip.reason === "notice_already_claimed")
      ? { status: "already_notified" }
      : { status: "not_applicable" };
}
