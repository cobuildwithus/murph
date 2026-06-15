import type { PrismaClient } from "@prisma/client";

import { readHostedMemberHomeLinqRoute } from "../hosted-onboarding/hosted-member-routing-store";
import { sendHostedLinqChatMessage } from "../hosted-onboarding/linq";
import { getPrisma } from "../prisma";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  claimHostedAiUsageLimitNotice,
  releaseHostedAiUsageLimitNotice,
  type HostedAiUsageGateDecision,
  type HostedAiUsageGateUserNotice,
} from "./usage-allowance";

type HostedAiUsageGateNoticeClient = PrismaClient;
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

  return sendHostedAiUsageLimitNotice({
    memberId: input.memberId,
    notice: input.decision.userNotice,
    periodStart: input.decision.periodStart,
    prisma: input.prisma,
  });
}

export async function sendHostedAiUsageLimitNotice(input: {
  memberId: string;
  notice: HostedAiUsageGateUserNotice;
  periodStart: Date;
  prisma?: HostedAiUsageGateNoticeClient;
}): Promise<HostedAiUsageGateDeniedNoticeResult> {
  const noticeCode = input.notice.code;
  const prisma = input.prisma ?? getPrisma();
  assertHostedAiUsageGateNoticeClient(prisma);
  let claimAcquired = false;
  let claimSentAt: Date | null = null;

  try {
    const routing = await readHostedMemberHomeLinqRoute({
      memberId: input.memberId,
      prisma,
    });
    if (!routing?.linqChatId) {
      return { status: "no_route" };
    }

    claimSentAt = new Date();
    const claimedNotice = await claimHostedAiUsageLimitNotice({
      memberId: input.memberId,
      periodStart: input.periodStart,
      prisma,
      sentAt: claimSentAt,
    });
    if (!claimedNotice) {
      return { status: "already_claimed" };
    }
    claimAcquired = true;

    await sendHostedLinqChatMessage({
      chatId: routing.linqChatId,
      idempotencyKey: buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: input.memberId,
        noticeCode,
        periodStart: input.periodStart,
      }),
      message: input.notice.message,
    });
  } catch (error) {
    console.warn("Hosted AI usage gate notice delivery failed.", {
      errorName: error instanceof Error ? error.name : "unknown",
      noticeCode,
    });
    // Release the once-per-period claim so a later gate denial retries the
    // notice instead of suppressing it for the rest of the period. The exact
    // sentAt match keeps a competing successful claim untouched.
    if (claimAcquired && claimSentAt) {
      try {
        await releaseHostedAiUsageLimitNotice({
          memberId: input.memberId,
          periodStart: input.periodStart,
          prisma,
          sentAt: claimSentAt,
        });
      } catch {
        console.warn("Hosted AI usage gate notice claim release failed.", {
          noticeCode,
        });
      }
    }
    return { status: "failed" };
  }

  return { status: "sent" };
}

function assertHostedAiUsageGateNoticeClient(
  prisma: unknown,
): asserts prisma is HostedAiUsageGateNoticeClient {
  if (typeof (prisma as { $transaction?: unknown }).$transaction !== "function") {
    throw new TypeError(
      "Hosted AI usage limit notice delivery requires a PrismaClient owner.",
    );
  }
}
