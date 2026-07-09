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
}): Promise<void> {
  await sendHostedAiUsageNoticeToLinqChat({
    ...input,
    claimToken: input.claimToken,
  });
}

export async function sendHostedAiUsageNoticeToLinqChat(input: {
  chatId: string;
  claimToken?: HostedLinqAiUsageQuotaClaimToken | null;
  memberId: string;
  message: string;
  noticeCode: HostedAiUsageGateNoticeCode;
  occurredAt: string;
  prisma: HostedAiUsageLimitNoticeClient;
  replyToMessageId?: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  signal?: AbortSignal;
  sourceEventId: string;
}): Promise<void> {
  const noticeCode = input.noticeCode;

  if (noticeCode === "trial_conversion_pending") {
    await drainHostedLinqSideEffectsDirect({
      prisma: input.prisma,
      sideEffects: [
        createHostedWebhookLinqMessageSideEffect({
          chatId: input.chatId,
          claimToken: null,
          memberId: input.memberId,
          message: input.message,
          noticeCode,
          occurredAt: input.occurredAt,
          replyToMessageId: input.replyToMessageId ?? null,
          ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
          sourceEventId: input.sourceEventId,
          template: "ai_usage_quota",
        }),
      ],
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return;
  }

  await drainHostedLinqSideEffectsDirect({
    prisma: input.prisma,
    sideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        claimToken: requireHostedAiUsageLimitNoticeClaimToken({
          claimToken: input.claimToken,
          noticeCode,
        }),
        memberId: input.memberId,
        message: input.message,
        noticeCode,
        occurredAt: input.occurredAt,
        replyToMessageId: input.replyToMessageId ?? null,
        ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
        sourceEventId: input.sourceEventId,
        template: "ai_usage_quota",
      }),
    ],
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

function requireHostedAiUsageLimitNoticeClaimToken(input: {
  claimToken?: HostedLinqAiUsageQuotaClaimToken | null;
  noticeCode: Exclude<HostedAiUsageGateNoticeCode, "trial_conversion_pending">;
}): HostedLinqAiUsageQuotaClaimToken {
  if (!input.claimToken) {
    throw new TypeError(
      `Hosted AI usage notice ${input.noticeCode} requires claim metadata.`,
    );
  }
  return input.claimToken;
}
