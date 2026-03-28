import { HostedBillingStatus } from "@prisma/client";

import {
  buildHostedInviteReply,
  type HostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  resolveHostedLinqOccurredAt,
  summarizeHostedLinqMessage,
} from "./linq";
import {
  buildHostedInviteUrl,
  ensureHostedMemberForPhone,
  issueHostedInvite,
} from "./member-service";
import { normalizePhoneNumber, shouldStartHostedOnboarding } from "./shared";
import {
  createHostedWebhookDispatchSideEffect,
  createHostedWebhookLinqMessageSideEffect,
  type HostedWebhookDispatchSideEffect,
  type HostedWebhookLinqMessageSideEffect,
  type HostedWebhookPlan,
  type HostedWebhookReceiptPersistenceClient,
} from "./webhook-receipts";
import { buildHostedExecutionLinqMessageReceivedDispatch } from "@murph/hosted-execution";

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
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: input.event.event_type,
      },
    };
  }

  const messageEvent = requireHostedLinqMessageReceivedEvent(input.event);
  const summary = summarizeHostedLinqMessage(messageEvent);

  if (summary.isFromMe) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "own-message",
      },
    };
  }

  const normalizedPhoneNumber = normalizePhoneNumber(summary.phoneNumber);

  if (!normalizedPhoneNumber) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "invalid-phone",
      },
    };
  }

  const existingMember = await input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber,
    },
  });

  if (existingMember?.billingStatus === HostedBillingStatus.active) {
    return {
      desiredSideEffects: [
        createHostedWebhookDispatchSideEffect({
          dispatch: buildHostedExecutionLinqMessageReceivedDispatch({
            eventId: input.event.event_id,
            linqEvent: messageEvent as unknown as Record<string, unknown>,
            normalizedPhoneNumber,
            occurredAt: resolveHostedLinqOccurredAt(messageEvent),
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

  if (existingMember && !shouldStartHostedOnboarding(summary.text)) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "no-trigger",
      },
    };
  }

  const member = await ensureHostedMemberForPhone({
    linqChatId: summary.chatId,
    normalizedPhoneNumber,
    originalPhoneNumber: summary.phoneNumber,
    prisma: input.prisma,
  });
  const invite = await issueHostedInvite({
    channel: "linq",
    linqChatId: summary.chatId,
    linqEventId: input.event.event_id,
    memberId: member.id,
    prisma: input.prisma,
    triggerText: summary.text,
  });
  const joinUrl = buildHostedInviteUrl(invite.inviteCode);

  return {
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: summary.chatId,
        inviteId: invite.id,
        message: buildHostedInviteReply({
          activeSubscription: member.billingStatus === HostedBillingStatus.active,
          joinUrl,
        }),
        replyToMessageId: summary.messageId,
        sourceEventId: input.event.event_id,
      }),
    ],
    response: {
      ok: true,
      inviteCode: invite.inviteCode,
      joinUrl,
    },
  };
}
