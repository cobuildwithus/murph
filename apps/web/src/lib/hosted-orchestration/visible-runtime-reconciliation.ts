import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";

import {
  sendHostedTelegramAccessNotice,
} from "../hosted-execution/telegram-access-notice";
import {
  readHostedMailboxLatestPendingConversationItem,
  readHostedMailboxWakeByItemId,
} from "../hosted-mailbox/store";
import {
  buildInactiveMemberAccessNoticeResponse,
  buildSignupLinkResponse,
} from "../hosted-onboarding/webhook-provider-linq-shared";
import {
  resolveHostedRecognizedInboundAccess,
  type HostedRecognizedInboundAccessResolution,
} from "../hosted-onboarding/recognized-inbound-access";
import {
  drainHostedLinqSideEffectsDirect,
} from "../hosted-onboarding/webhook-transport";
import { getPrisma } from "../prisma";
import {
  readHostedRuntimeReconciliationFacts,
} from "./runtime-reconciliation-facts";

const HOSTED_VISIBLE_ACCESS_RETRY_MS = 30_000;

export async function readHostedRuntimeReconciliationFactsWithVisibleAccess(
  input: Parameters<typeof readHostedRuntimeReconciliationFacts>[0],
): Promise<Awaited<ReturnType<typeof readHostedRuntimeReconciliationFacts>>> {
  const facts = await readHostedRuntimeReconciliationFacts(input);
  if (
    facts.blocked?.reason !== "user_not_active"
    && facts.blocked?.reason !== "ai_usage_denied"
  ) {
    return facts;
  }

  const prisma = getPrisma();
  const item = await readHostedMailboxLatestPendingConversationItem({
    afterSeq: 0n,
    prisma,
    userId: input.userId,
  });
  if (!item) {
    return facts;
  }

  const wake = await readHostedMailboxWakeByItemId({
    mailboxItemId: item.id,
    prisma,
  });
  if (
    !wake
    || !isHostedVisibleDirectConversationWake(wake)
  ) {
    return facts;
  }

  const member = await prisma.hostedMember.findUnique({
    select: {
      id: true,
      suspendedAt: true,
      threadContainer: {
        select: { memberId: true },
      },
    },
    where: { id: input.userId },
  });
  if (!member || member.threadContainer) {
    return facts;
  }

  const access = await resolveHostedRecognizedInboundAccess({
    allowSignupFallback: true,
    inviteChannel: isHostedLinqConversationMessageWake(wake) ? "linq" : "web",
    member,
    noticeSeed: wake.eventId,
    now: new Date(wake.occurredAt),
    prisma,
  });
  if (access.kind === "allowed") {
    return facts.blocked.reason === "user_not_active"
      ? await readHostedRuntimeReconciliationFacts(input)
      : facts;
  }
  if (access.kind === "silent") {
    return facts;
  }

  if (isHostedLinqConversationMessageWake(wake)) {
    const plan = access.kind === "access_notice"
      ? buildInactiveMemberAccessNoticeResponse({
          chatId: wake.message.linqMessage.chatId,
          memberId: input.userId,
          message: access.message,
          messageId: wake.message.linqMessage.messageId,
          noticeCode: access.noticeCode,
          occurredAt: wake.occurredAt,
          sourceEventId: wake.eventId,
        })
      : buildSignupLinkResponse({
          chatId: wake.message.linqMessage.chatId,
          inviteCode: access.inviteCode,
          inviteId: access.inviteId,
          memberId: input.userId,
          messageId: wake.message.linqMessage.messageId,
          occurredAt: wake.occurredAt,
          service: wake.message.linqMessage.service ?? null,
          sourceEventId: wake.eventId,
          threadIsDirect: true,
        });
    await drainHostedLinqSideEffectsDirect({
      prisma,
      sideEffects: plan.desiredSideEffects,
    });
    return facts;
  }

  const delivery = await sendHostedTelegramAccessNotice({
    memberId: input.userId,
    message: access.message,
    noticeCode: readHostedRecognizedInboundNoticeCode(access),
    prisma,
    replyToMessageId: wake.message.telegramMessage.messageId,
    sourceEventId: wake.eventId,
    target: wake.message.telegramMessage.threadId,
  });
  if (delivery.status !== "in_flight" && delivery.status !== "not_applicable") {
    return facts;
  }

  return withHostedVisibleAccessRetryAt(
    facts,
    delivery.status === "in_flight"
      ? delivery.retryAt
      : new Date(Date.now() + HOSTED_VISIBLE_ACCESS_RETRY_MS),
  );
}

function isHostedVisibleDirectConversationWake(
  wake: NonNullable<
    Awaited<ReturnType<typeof readHostedMailboxWakeByItemId>>
  >,
): boolean {
  if (isHostedLinqConversationMessageWake(wake)) {
    return wake.message.linqMessage.threadIsDirect !== false;
  }
  if (isHostedTelegramConversationMessageWake(wake)) {
    return wake.message.telegramMessage.threadIsDirect !== false;
  }
  return false;
}

function readHostedRecognizedInboundNoticeCode(
  access: Exclude<
    HostedRecognizedInboundAccessResolution,
    { kind: "allowed" | "silent" }
  >,
): string {
  return access.kind === "access_notice"
    ? access.noticeCode
    : "signup_required";
}

function withHostedVisibleAccessRetryAt<T extends {
  blocked: { reason: string; retryAt: string | null } | null;
}>(facts: T, retryAt: Date): T {
  if (!facts.blocked) {
    return facts;
  }

  const existingRetryAt = facts.blocked.retryAt
    ? new Date(facts.blocked.retryAt)
    : null;
  const resolvedRetryAt = existingRetryAt
    && !Number.isNaN(existingRetryAt.getTime())
    && existingRetryAt.getTime() < retryAt.getTime()
    ? existingRetryAt
    : retryAt;

  return {
    ...facts,
    blocked: {
      ...facts.blocked,
      retryAt: resolvedRetryAt.toISOString(),
    },
  };
}
