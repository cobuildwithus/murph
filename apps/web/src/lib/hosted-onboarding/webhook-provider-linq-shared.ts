import type { Prisma } from "@prisma/client";

import {
  buildHostedInviteUrl,
} from "./invite-service";
import {
  incrementHostedLinqInboundDailyState,
} from "./linq-daily-state";
import {
  type HostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  resolveHostedLinqOccurredAt,
  resolveHostedLinqParticipantContact,
  resolveHostedLinqParticipantEmailAddress,
  resolveHostedLinqParticipantPhoneNumber,
  resolveHostedLinqRecipientPhoneNumber,
  summarizeHostedLinqMessage,
} from "./linq";
import type { HostedLinqParticipantContact } from "./linq-participant-contact";
import {
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberPendingLinqBindingTx,
} from "./hosted-member-routing-store";
import {
  createHostedWebhookLinqMessageSideEffect,
  type HostedLinqMessageSideEffect,
} from "./webhook-transport";
import type {
  HostedOnboardingLinqDirectPlan,
  HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq-types";
import type { HostedWebhookPlan } from "./webhook-service-types";

type HostedLinqMessageReceivedEvent = ReturnType<typeof requireHostedLinqMessageReceivedEvent>;

export type HostedOnboardingLinqMessageContext = {
  messageEvent: HostedLinqMessageReceivedEvent;
  occurredAt: string;
  participantContact: HostedLinqParticipantContact | null;
  participantEmailAddress: string | null;
  participantPhoneNumber: string | null;
  recipientPhoneNumber: string | null;
  summary: ReturnType<typeof summarizeHostedLinqMessage>;
};

export function isHostedLinqIMessageFirstContact(
  event: HostedLinqMessageReceivedEvent,
): boolean {
  return isHostedLinqIMessageService(event.data.service);
}

export function isHostedLinqIMessageService(
  value: string | null | undefined,
): boolean {
  return normalizeHostedLinqService(value) === "imessage";
}

export function resolveHostedOnboardingLinqMessageContext(
  event: HostedLinqWebhookEvent,
): HostedOnboardingLinqMessageContext {
  const messageEvent = requireHostedLinqMessageReceivedEvent(event);

  return {
    messageEvent,
    occurredAt: resolveHostedLinqOccurredAt(messageEvent),
    participantContact: resolveHostedLinqParticipantContact(messageEvent),
    participantEmailAddress: resolveHostedLinqParticipantEmailAddress(messageEvent),
    participantPhoneNumber: resolveHostedLinqParticipantPhoneNumber(messageEvent),
    recipientPhoneNumber: resolveHostedLinqRecipientPhoneNumber(messageEvent),
    summary: summarizeHostedLinqMessage(messageEvent),
  };
}

export function buildIgnoredLinqWebhookPlan(
  reason: string,
): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [],
    response: {
      ok: true,
      ignored: true,
      reason,
    },
  });
}

export function buildSignupLinkResponse(input: {
  chatId: string;
  inviteCode: string;
  inviteId: string;
  memberId: string;
  messageId: string;
  occurredAt: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  const joinUrl = buildHostedInviteUrl(input.inviteCode);

  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        inviteId: input.inviteId,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
        template: "invite_signup",
      }),
    ],
    response: {
      ok: true,
      inviteCode: input.inviteCode,
      joinUrl,
      reason: "sent-signup-link",
    },
  });
}

export function buildActiveMemberDirectPlan(
  plan: HostedWebhookPlan<HostedOnboardingLinqWebhookResponse, HostedLinqMessageSideEffect>,
): HostedOnboardingLinqDirectPlan {
  return plan;
}

export function buildAiUsageQuotaReplyResponse(input: {
  chatId: string;
  memberId: string;
  message: string;
  messageId: string;
  noticeCode: string;
  occurredAt: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        memberId: input.memberId,
        message: input.message,
        noticeCode: input.noticeCode,
        occurredAt: input.occurredAt,
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
        template: "ai_usage_quota",
      }),
    ],
    response: {
      ok: true,
      reason: "sent-ai-usage-quota-reply",
    },
  });
}

export function buildConversationHomeRedirectResponse(input: {
  chatId: string;
  homeRecipientPhone: string;
  memberId: string;
  messageId: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        // Keep the current home line as an operational fallback so deferred
        // receipt sends do not depend on routing still being present later.
        homeRecipientPhone: input.homeRecipientPhone,
        memberId: input.memberId,
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
        template: "conversation_home_redirect",
      }),
    ],
    response: {
      ok: true,
      reason: "redirected-to-home-line",
    },
  });
}

export function buildQuotaReplyResponse(input: {
  chatId: string;
  memberId: string;
  messageId: string;
  occurredAt: string;
  sourceEventId: string;
}): HostedOnboardingLinqDirectPlan {
  return buildActiveMemberDirectPlan({
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
        template: "daily_quota",
      }),
    ],
    response: {
      ok: true,
      reason: "sent-daily-quota-reply",
    },
  });
}

export async function bindHostedMemberHomeLinqChatAndTrackInbound(input: {
  chatId: string;
  memberId: string;
  occurredAt: string;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}) {
  await upsertHostedMemberHomeLinqBindingTx({
    clearPending: true,
    linqChatId: input.chatId,
    memberId: input.memberId,
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
  });

  return incrementHostedLinqInboundDailyState({
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
  });
}

export async function bindHostedMemberPendingLinqChatAndTrackInbound(input: {
  chatId: string;
  memberId: string;
  occurredAt: string;
  participantContact?: HostedLinqParticipantContact | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}) {
  await upsertHostedMemberPendingLinqBindingTx({
    linqChatId: input.chatId,
    memberId: input.memberId,
    participantContact: input.participantContact ?? null,
    participantContactObservedAt: new Date(input.occurredAt),
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
  });

  return incrementHostedLinqInboundDailyState({
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
  });
}

function normalizeHostedLinqService(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return normalized.length > 0 ? normalized : null;
}
