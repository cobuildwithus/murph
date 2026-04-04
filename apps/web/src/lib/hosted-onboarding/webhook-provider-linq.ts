import { HostedBillingStatus, HostedMemberStatus } from "@prisma/client";

import {
  buildHostedDailyQuotaReply,
  buildHostedInviteReply,
  type HostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  resolveHostedLinqOccurredAt,
  resolveHostedLinqParticipantPhoneNumber,
  summarizeHostedLinqMessage,
} from "./linq";
import {
  buildHostedInviteUrl,
  issueHostedInvite,
} from "./invite-service";
import {
  ensureHostedMemberForPhone,
  persistHostedMemberLinqChatBinding,
} from "./member-identity-service";
import {
  claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice,
  incrementHostedLinqInboundDailyState,
  incrementHostedLinqOutboundDailyState,
} from "./linq-daily-state";
import { minimizeHostedLinqMessageReceivedEvent } from "./webhook-event-snapshots";
import {
  createHostedPhoneLookupKey,
  sanitizeHostedLinqEventForStorage,
} from "./contact-privacy";
import {
  createHostedWebhookDispatchSideEffect,
  createHostedWebhookLinqMessageSideEffect,
  type HostedWebhookPlan,
  type HostedWebhookReceiptPersistenceClient,
} from "./webhook-receipts";
import { buildHostedExecutionLinqMessageReceivedDispatch } from "@murphai/hosted-execution";

export type HostedOnboardingLinqWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  inviteCode?: string;
  joinUrl?: string;
  ok: true;
  reason?: string;
};

export async function planHostedOnboardingLinqWebhook(input: {
  event: HostedLinqWebhookEvent;
  prisma: HostedWebhookReceiptPersistenceClient;
}): Promise<HostedWebhookPlan<HostedOnboardingLinqWebhookResponse>> {
  if (input.event.event_type !== "message.received") {
    return buildIgnoredLinqWebhookPlan(input.event.event_type);
  }

  const messageEvent = requireHostedLinqMessageReceivedEvent(input.event);
  const summary = summarizeHostedLinqMessage(messageEvent);
  const occurredAt = resolveHostedLinqOccurredAt(messageEvent);
  const participantPhoneNumber = resolveHostedLinqParticipantPhoneNumber(messageEvent);
  if (!participantPhoneNumber) {
    return buildIgnoredLinqWebhookPlan(summary.isFromMe ? "own-message" : "invalid-phone");
  }
  const phoneLookupKey = createHostedPhoneLookupKey(participantPhoneNumber);
  if (!phoneLookupKey) {
    return buildIgnoredLinqWebhookPlan("invalid-phone");
  }

  const existingMember = await input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber: phoneLookupKey,
    },
  });

  if (summary.isFromMe) {
    if (existingMember) {
      await incrementHostedLinqOutboundDailyState({
        memberId: existingMember.id,
        occurredAt,
        prisma: input.prisma,
      });
    }

    return buildIgnoredLinqWebhookPlan("own-message");
  }

  if (existingMember?.status === HostedMemberStatus.suspended) {
    return buildIgnoredLinqWebhookPlan("suspended-member");
  }

  if (existingMember?.billingStatus === HostedBillingStatus.active) {
    await persistHostedMemberLinqChatBinding({
      linqChatId: summary.chatId,
      memberId: existingMember.id,
      prisma: input.prisma,
    });
    const dailyState = await incrementHostedLinqInboundDailyState({
      memberId: existingMember.id,
      occurredAt,
      prisma: input.prisma,
    });

    if (dailyState.inboundCount > 100) {
      const shouldReply = await claimHostedLinqQuotaReplyNotice({
        memberId: existingMember.id,
        occurredAt,
        prisma: input.prisma,
      });

      if (!shouldReply) {
        return buildIgnoredLinqWebhookPlan("daily-quota-reached");
      }

      return buildQuotaReplyResponse({
        chatId: summary.chatId,
        messageId: summary.messageId,
        sourceEventId: input.event.event_id,
      });
    }

    return {
      desiredSideEffects: [
        createHostedWebhookDispatchSideEffect({
          dispatch: buildHostedExecutionLinqMessageReceivedDispatch({
            eventId: input.event.event_id,
            linqEvent: sanitizeHostedLinqEventForStorage(
              minimizeHostedLinqMessageReceivedEvent(messageEvent),
              {
                omitRecipientPhone: true,
              },
            ),
            occurredAt,
            phoneLookupKey,
            userId: existingMember.id,
          }),
        }),
      ],
      response: {
        ok: true,
        ignored: false,
        reason: "dispatched-active-member",
      },
    };
  }

  const member = existingMember ?? await ensureHostedMemberForPhone({
    phoneNumber: participantPhoneNumber,
    prisma: input.prisma,
  });
  await persistHostedMemberLinqChatBinding({
    linqChatId: summary.chatId,
    memberId: member.id,
    prisma: input.prisma,
  });
  const dailyState = await incrementHostedLinqInboundDailyState({
    memberId: member.id,
    occurredAt,
    prisma: input.prisma,
  });

  if (dailyState.onboardingLinkSentAt) {
    return buildIgnoredLinqWebhookPlan("signup-link-already-sent");
  }

  const shouldSendInvite = await claimHostedLinqOnboardingLinkNotice({
    memberId: member.id,
    occurredAt,
    prisma: input.prisma,
  });

  if (!shouldSendInvite) {
    return buildIgnoredLinqWebhookPlan("signup-link-already-sent");
  }

  const invite = await issueHostedInvite({
    channel: "linq",
    memberId: member.id,
    prisma: input.prisma,
  });

  return buildSignupLinkResponse({
    activeSubscription: member.billingStatus === HostedBillingStatus.active,
    inviteCode: invite.inviteCode,
    inviteId: invite.id,
    messageId: summary.messageId,
    chatId: summary.chatId,
    sourceEventId: input.event.event_id,
  });
}

function buildIgnoredLinqWebhookPlan(
  reason: string,
): HostedWebhookPlan<HostedOnboardingLinqWebhookResponse> {
  return {
    desiredSideEffects: [],
    response: {
      ok: true,
      ignored: true,
      reason,
    },
  };
}

function buildSignupLinkResponse(input: {
  activeSubscription: boolean;
  chatId: string;
  inviteCode: string;
  inviteId: string;
  messageId: string;
  sourceEventId: string;
}): HostedWebhookPlan<HostedOnboardingLinqWebhookResponse> {
  const joinUrl = buildHostedInviteUrl(input.inviteCode);

  return {
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        inviteId: input.inviteId,
        message: buildHostedInviteReply({
          activeSubscription: input.activeSubscription,
          joinUrl,
        }),
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
      }),
    ],
    response: {
      ok: true,
      inviteCode: input.inviteCode,
      joinUrl,
      reason: "sent-signup-link",
    },
  };
}

function buildQuotaReplyResponse(input: {
  chatId: string;
  messageId: string;
  sourceEventId: string;
}): HostedWebhookPlan<HostedOnboardingLinqWebhookResponse> {
  return {
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        inviteId: null,
        message: buildHostedDailyQuotaReply(),
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
      }),
    ],
    response: {
      ok: true,
      reason: "sent-daily-quota-reply",
    },
  };
}
