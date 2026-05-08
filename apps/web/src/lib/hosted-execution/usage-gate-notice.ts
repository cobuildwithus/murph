import type { Prisma, PrismaClient } from "@prisma/client";

import { readHostedMemberHomeLinqRoute } from "../hosted-onboarding/hosted-member-routing-store";
import { sendHostedLinqChatMessage } from "../hosted-onboarding/linq";
import { getPrisma } from "../prisma";
import { sha256Hex } from "../primitives";
import {
  claimHostedAiUsageLimitNotice,
  type HostedAiUsageGateDecision,
} from "./usage-allowance";

type HostedAiUsageGateNoticeClient = PrismaClient | Prisma.TransactionClient;
type HostedAiUsageGateDeniedDecision = Extract<HostedAiUsageGateDecision, { allowed: false }>;

export type HostedAiUsageGateDeniedNoticeResult =
  | { status: "already_claimed" }
  | { status: "failed" }
  | { status: "no_route" }
  | { status: "not_applicable" }
  | { status: "sent" };

export async function notifyHostedAiUsageGateDeniedForPendingNudge(input: {
  decision: HostedAiUsageGateDeniedDecision;
  memberId: string;
  prisma?: HostedAiUsageGateNoticeClient;
}): Promise<HostedAiUsageGateDeniedNoticeResult> {
  if (
    input.decision.reason !== "ai_usage_limit_exceeded" ||
    !input.decision.userNotice
  ) {
    return { status: "not_applicable" };
  }

  const noticeCode = input.decision.userNotice.code;
  try {
    const prisma = input.prisma ?? getPrisma();
    const routing = await readHostedMemberHomeLinqRoute({
      memberId: input.memberId,
      prisma,
    });
    if (!routing?.linqChatId) {
      return { status: "no_route" };
    }

    const claimedNotice = await claimHostedAiUsageLimitNotice({
      memberId: input.memberId,
      periodStart: input.decision.periodStart,
      prisma,
    });
    if (!claimedNotice) {
      return { status: "already_claimed" };
    }

    await sendHostedLinqChatMessage({
      chatId: routing.linqChatId,
      idempotencyKey: buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: input.memberId,
        noticeCode,
        periodStart: input.decision.periodStart,
      }),
      message: input.decision.userNotice.message,
    });
  } catch (error) {
    console.warn("Hosted AI usage gate notice delivery failed.", {
      errorName: error instanceof Error ? error.name : "unknown",
      noticeCode,
    });
    return { status: "failed" };
  }

  return { status: "sent" };
}

function buildHostedAiUsageGateNoticeIdempotencyKey(input: {
  memberId: string;
  noticeCode: string;
  periodStart: Date;
}): string {
  return `ai-usage-gate:${sha256Hex(JSON.stringify({
    memberId: input.memberId,
    noticeCode: input.noticeCode,
    periodStart: input.periodStart.toISOString(),
  })).slice(0, 32)}`;
}
