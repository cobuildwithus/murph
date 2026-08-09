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
  resolveHostedRecognizedInboundAccess,
  type HostedRecognizedInboundAccessResolution,
} from "../hosted-onboarding/recognized-inbound-access";
import {
  buildInactiveMemberAccessNoticeResponse,
  buildSignupLinkResponse,
} from "../hosted-onboarding/webhook-provider-linq-shared";
import {
  drainHostedLinqSideEffectsDirect,
} from "../hosted-onboarding/webhook-transport";
import { getPrisma } from "../prisma";
import {
  readHostedRuntimeReconciliationFacts,
} from "./runtime-reconciliation-facts";

const HOSTED_VISIBLE_ACCESS_RETRY_MS = 30_000;
type HostedRuntimeReconciliationFacts = Awaited<
  ReturnType<typeof readHostedRuntimeReconciliationFacts>
>;

export async function readHostedRuntimeReconciliationFactsWithVisibleAccess(
  input: Parameters<typeof readHostedRuntimeReconciliationFacts>[0],
): Promise<HostedRuntimeReconciliationFacts> {
  const reconciledAt = new Date();
  const facts = await readHostedRuntimeReconciliationFacts(input);
  const blockedReason = facts.blocked?.reason;
  if (
    blockedReason !== "user_not_active"
    && blockedReason !== "ai_usage_denied"
    && blockedReason !== "health_data_consent_withdrawn"
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
  if (!wake || !isHostedVisibleDirectConversationWake(wake)) {
    return facts;
  }
  if (
    blockedReason === "ai_usage_denied"
    && isHostedLinqConversationMessageWake(wake)
  ) {
    // The canonical reconciliation path already owns Linq usage notices.
    // This adapter exists only to fill the missing Telegram channel and to
    // explain access loss that happened after either channel admitted a message.
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

  // Entitlement must be judged at the same clock the canonical reconciliation
  // just used. The wake timestamp is message metadata; access can change between
  // admission and runtime processing, which is exactly the case this adapter
  // exists to explain.
  const access = await resolveHostedRecognizedInboundAccess({
    allowSignupFallback: true,
    inviteChannel: isHostedLinqConversationMessageWake(wake) ? "linq" : "web",
    member,
    noticeSeed: wake.eventId,
    now: reconciledAt,
    prisma,
  });
  if (access.kind === "allowed") {
    return blockedReason === "user_not_active"
        || blockedReason === "health_data_consent_withdrawn"
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

  if (!isHostedTelegramConversationMessageWake(wake)) {
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
      : new Date(reconciledAt.getTime() + HOSTED_VISIBLE_ACCESS_RETRY_MS),
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

function withHostedVisibleAccessRetryAt(
  facts: HostedRuntimeReconciliationFacts,
  retryAt: Date,
): HostedRuntimeReconciliationFacts {
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
