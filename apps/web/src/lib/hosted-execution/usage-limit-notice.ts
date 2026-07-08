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
  HostedAiUsageLimitNoticeCode,
} from "./usage-allowance";

type HostedAiUsageLimitNoticeClient = PrismaClient | Prisma.TransactionClient;

export type HostedAiUsageLimitNoticeDeliveryResult =
  | { status: "already_notified" }
  | { status: "in_flight" }
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
    collectResult: true,
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
      return { status: "in_flight" };
    default:
      return { status: "not_applicable" };
  }
}
