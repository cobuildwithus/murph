import type { Prisma } from "@prisma/client";

import {
  buildHostedInviteUrl,
  issueHostedInviteTx,
} from "./invite-service";
import {
  hasHostedMemberActiveAccess,
  isHostedMemberSuspended,
} from "./entitlement";
import { ensureHostedMemberForPhoneTx } from "./member-identity-service";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import {
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberPendingLinqBindingTx,
} from "./hosted-member-routing-store";
import {
  claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice,
  incrementHostedLinqInboundDailyState,
  incrementHostedLinqOutboundDailyState,
  resolveHostedLinqDayUtc,
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
import { materializeHostedExecutionWakeTx } from "../hosted-execution/wake-lifecycle";
import {
  createHostedPhoneLookupKey,
  sanitizeHostedLinqEventForStorage,
} from "./contact-privacy";
import {
  createHostedWebhookLinqMessageSideEffect,
  type HostedWebhookPlan,
} from "./webhook-receipts";
import { buildHostedExecutionLinqConversationMessageWake } from "@murphai/hosted-execution";

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
  prisma: Prisma.TransactionClient;
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
        memberId: existingMember.id,
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

    await materializeHostedExecutionWakeTx({
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: input.event.event_id,
        linqEvent: sanitizeHostedLinqEventForStorage(
          minimizeLinqMessageReceivedEvent(messageEvent),
          {
            omitRecipientPhone: true,
            preserveFrom: true,
          },
        ),
        linqMessageId: summary.messageId,
        occurredAt,
        phoneLookupKey,
        userId: existingMember.id,
      }),
      tx: input.prisma,
    });

    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: false,
        reason: "dispatched-active-member",
      },
    };
  }

  const member = existingMember ?? await ensureHostedMemberForPhoneTx({
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

  const invite = await issueHostedInviteTx({
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

export async function tryHandleHostedOnboardingLinqDirectWakeFastPath(input: {
  event: HostedLinqWebhookEvent;
  prisma: Prisma.TransactionClient;
}): Promise<HostedOnboardingLinqWebhookResponse | null> {
  if (input.event.event_type !== "message.received") {
    return null;
  }

  const messageEvent = requireHostedLinqMessageReceivedEvent(input.event);
  const summary = summarizeHostedLinqMessage(messageEvent);
  const occurredAt = resolveHostedLinqOccurredAt(messageEvent);
  const participantPhoneNumber = resolveHostedLinqParticipantPhoneNumber(messageEvent);
  const recipientPhoneNumber = resolveHostedLinqRecipientPhoneNumber(messageEvent);

  if (summary.isFromMe || !participantPhoneNumber) {
    return null;
  }

  const phoneLookupKey = createHostedPhoneLookupKey(participantPhoneNumber);

  if (!phoneLookupKey) {
    return null;
  }

  const existingMemberLookup = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: participantPhoneNumber,
    prisma: input.prisma,
  });
  const existingMember = existingMemberLookup?.core ?? null;

  if (
    !existingMember
    || isHostedMemberSuspended(existingMember.suspendedAt)
    || !hasHostedMemberActiveAccess(existingMember)
  ) {
    return null;
  }

  const member = await readHostedMemberSnapshot({
    memberId: existingMember.id,
    prisma: input.prisma,
  });

  if (!member) {
    return null;
  }

  const routeDecision = resolveHostedLinqActiveRouteDecision({
    homeChatId: member.routing?.linqChatId ?? null,
    homeRecipientPhone: member.routing?.linqRecipientPhone ?? null,
    incomingChatId: summary.chatId,
    incomingRecipientPhone: recipientPhoneNumber,
  });

  if (routeDecision.kind === "redirect_to_home") {
    return null;
  }

  if (routeDecision.kind === "ignore_unknown_home") {
    return buildIgnoredLinqWebhookPlan("unknown-home-line").response;
  }

  const dailyState = await input.prisma.hostedLinqDailyState.findUnique({
    where: {
      memberId_dayUtc: {
        dayUtc: resolveHostedLinqDayUtc(occurredAt),
        memberId: existingMember.id,
      },
    },
  });
  const nextInboundCount = (dailyState?.inboundCount ?? 0) + 1;

  if (nextInboundCount > 100) {
    if (!dailyState?.quotaReplySentAt) {
      return null;
    }

    await bindHostedMemberHomeLinqChatAndTrackInbound({
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

    return buildIgnoredLinqWebhookPlan("daily-quota-reached").response;
  }

  await bindHostedMemberHomeLinqChatAndTrackInbound({
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

  await materializeHostedExecutionWakeTx({
    wake: buildHostedExecutionLinqConversationMessageWake({
      eventId: input.event.event_id,
      linqEvent: sanitizeHostedLinqEventForStorage(
        minimizeLinqMessageReceivedEvent(messageEvent),
        {
          omitRecipientPhone: true,
          preserveFrom: true,
        },
      ),
      linqMessageId: summary.messageId,
      occurredAt,
      phoneLookupKey,
      userId: existingMember.id,
    }),
    tx: input.prisma,
  });

  return {
    ok: true,
    ignored: false,
    reason: "dispatched-active-member",
  };
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
  memberId: string;
  messageId: string;
  sourceEventId: string;
}): HostedWebhookPlan<HostedOnboardingLinqWebhookResponse> {
  return {
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

async function bindHostedMemberPendingLinqChatAndTrackInbound(input: {
  chatId: string;
  memberId: string;
  occurredAt: string;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}) {
  await upsertHostedMemberPendingLinqBindingTx({
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
