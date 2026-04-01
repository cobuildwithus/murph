import { HostedBillingStatus, HostedInviteStatus } from "@prisma/client";

import {
  buildHostedGetStartedReply,
  buildHostedInviteReply,
  type HostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  resolveHostedLinqOccurredAt,
  summarizeHostedLinqMessage,
} from "./linq";
import {
  buildHostedInviteUrl,
  issueHostedInvite,
} from "./invite-service";
import {
  ensureHostedMemberForPhone,
} from "./member-identity-service";
import { minimizeHostedLinqMessageReceivedEvent } from "./webhook-event-snapshots";
import {
  createHostedPhoneLookupKey,
  sanitizeHostedLinqEventForStorage,
} from "./contact-privacy";
import {
  createHostedWebhookDispatchSideEffect,
  createHostedWebhookLinqMessageSideEffect,
  type HostedWebhookDispatchSideEffect,
  type HostedWebhookLinqMessageSideEffect,
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

  if (summary.isFromMe) {
    return buildIgnoredLinqWebhookPlan("own-message");
  }

  const phoneLookupKey = createHostedPhoneLookupKey(summary.phoneNumber);
  if (!phoneLookupKey) {
    return buildIgnoredLinqWebhookPlan("invalid-phone");
  }

  const existingMember = await input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber: phoneLookupKey,
    },
  });

  if (existingMember?.billingStatus === HostedBillingStatus.active) {
    return {
      desiredSideEffects: [
        createHostedWebhookDispatchSideEffect({
          dispatch: buildHostedExecutionLinqMessageReceivedDispatch({
            eventId: input.event.event_id,
            linqEvent: sanitizeHostedLinqEventForStorage(
              minimizeHostedLinqMessageReceivedEvent(messageEvent),
            ),
            occurredAt: resolveHostedLinqOccurredAt(messageEvent),
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

  const reusableInvite = existingMember
    ? await findReusableHostedInvite({
        memberId: existingMember.id,
        prisma: input.prisma,
      })
    : null;

  if (reusableInvite && !reusableInvite.sentAt) {
    return buildSignupLinkResponse({
      activeSubscription: false,
      inviteCode: reusableInvite.inviteCode,
      inviteId: reusableInvite.id,
      messageId: summary.messageId,
      chatId: summary.chatId,
      sourceEventId: input.event.event_id,
    });
  }

  const member = await ensureHostedMemberForPhone({
    phoneNumber: summary.phoneNumber,
    prisma: input.prisma,
  });
  const invite = await issueHostedInvite({
    channel: "linq",
    linqChatId: null,
    linqEventId: null,
    memberId: member.id,
    prisma: input.prisma,
    triggerText: null,
  });

  if (invite.sentAt) {
    return buildSignupLinkResponse({
      activeSubscription: member.billingStatus === HostedBillingStatus.active,
      inviteCode: invite.inviteCode,
      inviteId: invite.id,
      messageId: summary.messageId,
      chatId: summary.chatId,
      sourceEventId: input.event.event_id,
    });
  }

  return {
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: summary.chatId,
        inviteId: null,
        message: buildHostedGetStartedReply(),
        replyToMessageId: summary.messageId,
        sourceEventId: input.event.event_id,
      }),
    ],
    response: {
      ok: true,
      reason: "prompted-get-started",
    },
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

async function findReusableHostedInvite(input: {
  memberId: string;
  prisma: HostedWebhookReceiptPersistenceClient;
}) {
  return input.prisma.hostedInvite.findFirst({
    where: {
      memberId: input.memberId,
      channel: "linq",
      expiresAt: {
        gt: new Date(),
      },
      status: {
        in: [
          HostedInviteStatus.pending,
          HostedInviteStatus.opened,
          HostedInviteStatus.authenticated,
          HostedInviteStatus.paid,
        ],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
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
