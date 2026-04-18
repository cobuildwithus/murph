import type { Prisma } from "@prisma/client";

import { issueHostedInviteTx } from "./invite-service";
import {
  hasHostedMemberActiveAccess,
  isHostedMemberSuspended,
} from "./entitlement";
import { ensureHostedMemberForPhoneTx } from "./member-identity-service";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import {
  incrementHostedLinqOutboundDailyState,
} from "./linq-daily-state";
import {
  type HostedLinqWebhookEvent,
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
import { buildHostedExecutionLinqConversationMessageWake } from "@murphai/hosted-execution";
import {
  bindHostedMemberHomeLinqChatAndTrackInbound,
  bindHostedMemberPendingLinqChatAndTrackInbound,
  buildActiveMemberDirectPlan,
  buildConversationHomeRedirectResponse,
  buildDirectQuotaReplyResponse,
  buildIgnoredLinqWebhookPlan,
  buildQuotaReplyResponse,
  buildSignupLinkResponse,
  resolveHostedOnboardingLinqMessageContext,
} from "./webhook-provider-linq-shared";
export type {
  HostedOnboardingLinqDirectFinalization,
  HostedOnboardingLinqDirectPlan,
  HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq-types";
import type {
  HostedOnboardingLinqDirectPlan,
  HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq-types";
import type { HostedLinqMessageSideEffect } from "./webhook-transport";
import type { HostedWebhookPlan } from "./webhook-service-types";

export async function planHostedOnboardingLinqWebhook(input: {
  event: HostedLinqWebhookEvent;
  prisma: Prisma.TransactionClient;
}): Promise<HostedOnboardingLinqDirectPlan> {
  if (input.event.event_type !== "message.received") {
    return buildIgnoredLinqWebhookPlan(input.event.event_type);
  }

  const context = resolveHostedOnboardingLinqMessageContext(input.event);
  const {
    messageEvent,
    occurredAt,
    participantPhoneNumber,
    recipientPhoneNumber,
    summary,
  } = context;

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
        reason: "wake-appended-active-member",
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

  const invite = await issueHostedInviteTx({
    channel: "linq",
    memberId: member.id,
    prisma: input.prisma,
  });

  return buildActiveMemberDirectPlan(
    buildSignupLinkResponse({
      activeSubscription: hasHostedMemberActiveAccess(member),
      chatId: summary.chatId,
      inviteCode: invite.inviteCode,
      inviteId: invite.id,
      messageId: summary.messageId,
      sourceEventId: input.event.event_id,
    }),
    {
      kind: "mark_onboarding_link_sent",
      memberId: member.id,
      occurredAt,
    },
  );
}
