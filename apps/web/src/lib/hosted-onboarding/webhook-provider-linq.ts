import {
  buildHostedInviteUrl,
  issueHostedInvite,
} from "./invite-service";
import {
  hasHostedMemberActiveAccess,
  isHostedMemberSuspended,
} from "./entitlement";
import { ensureHostedMemberForPhone } from "./member-identity-service";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import {
  upsertHostedMemberHomeLinqBinding,
  upsertHostedMemberPendingLinqBinding,
} from "./hosted-member-routing-store";
import {
  claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice,
  incrementHostedLinqInboundDailyState,
  incrementHostedLinqOutboundDailyState,
} from "./linq-daily-state";
import {
  type HostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  resolveHostedLinqOccurredAt,
  resolveHostedLinqParticipantPhoneNumber,
  resolveHostedLinqRecipientPhoneNumber,
  summarizeHostedLinqMessage,
} from "./linq";
import {
  resolveHostedLinqActiveRouteDecision,
  resolveHostedLinqHomeBindingRecipientPhone,
} from "./linq-routing-policy";
import { minimizeLinqMessageReceivedEvent } from "@murphai/messaging-ingress/linq-webhook";
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
  const recipientPhoneNumber = resolveHostedLinqRecipientPhoneNumber(messageEvent);

  if (!participantPhoneNumber) {
    return buildIgnoredLinqWebhookPlan(summary.isFromMe ? "own-message" : "invalid-phone");
  }

  const phoneLookupKey = createHostedPhoneLookupKey(participantPhoneNumber);

  if (!phoneLookupKey) {
    return buildIgnoredLinqWebhookPlan("invalid-phone");
  }

  const existingMemberLookup = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: participantPhoneNumber,
    prisma: input.prisma,
  });
  const existingMember = existingMemberLookup?.core ?? null;

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

  if (existingMember && isHostedMemberSuspended(existingMember.suspendedAt)) {
    return buildIgnoredLinqWebhookPlan("suspended-member");
  }

  if (existingMember && hasHostedMemberActiveAccess(existingMember)) {
    const member = await readHostedMemberSnapshot({
      memberId: existingMember.id,
      prisma: input.prisma,
    });

    if (!member) {
      return buildIgnoredLinqWebhookPlan("missing-member");
    }

    const routeDecision = resolveHostedLinqActiveRouteDecision({
      homeChatId: member.routing?.linqChatId ?? null,
      homeRecipientPhone: member.routing?.linqRecipientPhone ?? null,
      incomingChatId: summary.chatId,
      incomingRecipientPhone: recipientPhoneNumber,
    });

    if (routeDecision.kind === "redirect_to_home") {
      return buildConversationHomeRedirectResponse({
        chatId: summary.chatId,
        homeRecipientPhone: routeDecision.homeRecipientPhone,
        messageId: summary.messageId,
        sourceEventId: input.event.event_id,
      });
    }

    if (routeDecision.kind === "ignore_unknown_home") {
      return buildIgnoredLinqWebhookPlan("unknown-home-line");
    }

    const dailyState = await bindHostedMemberHomeLinqChatAndTrackInbound({
      chatId: summary.chatId,
      memberId: existingMember.id,
      occurredAt,
      prisma: input.prisma,
      recipientPhone: resolveHostedLinqHomeBindingRecipientPhone({
        homeChatId: member.routing?.linqChatId ?? null,
        homeRecipientPhone: member.routing?.linqRecipientPhone ?? null,
        incomingChatId: summary.chatId,
        incomingRecipientPhone: recipientPhoneNumber,
      }),
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
              minimizeLinqMessageReceivedEvent(messageEvent),
              {
                omitRecipientPhone: true,
              },
            ),
            linqMessageId: summary.messageId,
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
  const dailyState = await bindHostedMemberPendingLinqChatAndTrackInbound({
    chatId: summary.chatId,
    memberId: member.id,
    occurredAt,
    prisma: input.prisma,
    recipientPhone: recipientPhoneNumber,
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
    activeSubscription: hasHostedMemberActiveAccess(member),
    chatId: summary.chatId,
    inviteCode: invite.inviteCode,
    inviteId: invite.id,
    messageId: summary.messageId,
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
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
        template: input.activeSubscription ? "invite_signin" : "invite_signup",
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

function buildConversationHomeRedirectResponse(input: {
  chatId: string;
  homeRecipientPhone: string;
  messageId: string;
  sourceEventId: string;
}): HostedWebhookPlan<HostedOnboardingLinqWebhookResponse> {
  return {
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        homeRecipientPhone: input.homeRecipientPhone,
        inviteId: null,
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
        template: "conversation_home_redirect",
      }),
    ],
    response: {
      ok: true,
      reason: "redirected-to-home-line",
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
        replyToMessageId: input.messageId,
        sourceEventId: input.sourceEventId,
        template: "daily_quota",
      }),
    ],
    response: {
      ok: true,
      reason: "sent-daily-quota-reply",
    },
  };
}

async function bindHostedMemberHomeLinqChatAndTrackInbound(input: {
  chatId: string;
  memberId: string;
  occurredAt: string;
  prisma: HostedWebhookReceiptPersistenceClient;
  recipientPhone: string | null;
}) {
  await upsertHostedMemberHomeLinqBinding({
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

async function bindHostedMemberPendingLinqChatAndTrackInbound(input: {
  chatId: string;
  memberId: string;
  occurredAt: string;
  prisma: HostedWebhookReceiptPersistenceClient;
  recipientPhone: string | null;
}) {
  await upsertHostedMemberPendingLinqBinding({
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
