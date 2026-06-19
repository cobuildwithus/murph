import { type Prisma } from "@prisma/client";
import { buildHostedExecutionTelegramConversationMessageWake } from "@murphai/hosted-execution";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import {
  isHostedMemberSuspended,
} from "./entitlement";
import {
  appendHostedFamilyChatNotificationTx,
  buildHostedFamilyInviteAcceptedReplyText,
  acceptHostedFamilyInviteFromTelegramTx,
  hasHostedMemberEffectiveActiveAccessForMember,
  issueHostedFamilyInviteFromOwnerChatTx,
  resolveHostedFamilyChatNotificationRouteTx,
} from "./family-plan";
import {
  buildHostedTelegramMessagePayload,
  buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "./telegram";
import {
  resolveHostedMemberRoutingByTelegramUserId,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-store";
import {
  type HostedWebhookPlan,
} from "./webhook-service-types";

export type HostedOnboardingTelegramWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  ok: true;
  reason?: string;
};

export async function planHostedOnboardingTelegramWebhook(input: {
  prisma: Prisma.TransactionClient;
  update: ReturnType<typeof parseHostedTelegramWebhookUpdate>;
}): Promise<HostedWebhookPlan<HostedOnboardingTelegramWebhookResponse>> {
  const summary = await summarizeHostedTelegramWebhook(input.update);

  if (!summary) {
    return buildIgnoredTelegramWebhookPlan("unsupported-update");
  }

  if (summary.isBotMessage) {
    return buildIgnoredTelegramWebhookPlan("own-message");
  }

  if (!summary.isDirect) {
    return buildIgnoredTelegramWebhookPlan(summary.chatType ?? "unsupported-chat");
  }

  if (!summary.senderTelegramUserId) {
    return buildIgnoredTelegramWebhookPlan("missing-sender");
  }

  const telegramMessage = buildHostedTelegramMessagePayload(input.update);
  const familyAcceptance = await acceptHostedFamilyInviteFromTelegramTx({
    now: new Date(summary.occurredAt),
    telegramThreadId: telegramMessage?.threadId ?? null,
    telegramUserId: summary.senderTelegramUserId,
    text: telegramMessage?.text ?? null,
    tx: input.prisma,
  });
  if (familyAcceptance) {
    const route = await resolveHostedFamilyChatNotificationRouteTx({
      fallbackTelegramThreadId: telegramMessage?.threadId ?? null,
      fallbackTelegramUserId: summary.senderTelegramUserId,
      memberId: familyAcceptance.memberId,
      tx: input.prisma,
    });
    const notification = await appendHostedFamilyChatNotificationTx({
      memberId: familyAcceptance.memberId,
      message: buildHostedFamilyInviteAcceptedReplyText(),
      occurredAt: summary.occurredAt,
      route,
      sourceEventId: buildHostedTelegramWebhookEventId(input.update),
      tx: input.prisma,
    });
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        reason: "family-invite-accepted",
      },
      ...(notification.mailboxItemId
        ? {
            wakeMailboxItemId: notification.mailboxItemId,
            wakeUserId: familyAcceptance.memberId,
          }
        : {}),
    };
  }

  const existingMemberLookup = await resolveHostedMemberRoutingByTelegramUserId({
    prisma: input.prisma,
    telegramUserId: summary.senderTelegramUserId,
  });

  if (existingMemberLookup.status === "ambiguous") {
    return buildIgnoredTelegramWebhookPlan("ambiguous-telegram-binding");
  }

  const existingMember = existingMemberLookup.status === "found"
    ? existingMemberLookup.lookup.core
    : null;

  if (!existingMember) {
    return buildIgnoredTelegramWebhookPlan("unlinked-telegram");
  }

  if (isHostedMemberSuspended(existingMember.suspendedAt)) {
    return buildIgnoredTelegramWebhookPlan("suspended-member");
  }

  if (!await hasHostedMemberEffectiveActiveAccessForMember({
    member: existingMember,
    prisma: input.prisma,
  })) {
    return buildIgnoredTelegramWebhookPlan("inactive-member");
  }

  if (!telegramMessage) {
    return buildIgnoredTelegramWebhookPlan("unsupported-update");
  }

  await upsertHostedMemberTelegramRoutingBindingTx({
    memberId: existingMember.id,
    prisma: input.prisma,
    telegramThreadId: telegramMessage.threadId,
    telegramUserId: summary.senderTelegramUserId,
  });

  const familyInvite = await issueHostedFamilyInviteFromOwnerChatTx({
    now: new Date(summary.occurredAt),
    ownerMemberId: existingMember.id,
    text: telegramMessage.text ?? null,
    tx: input.prisma,
  });
  if (familyInvite) {
    const route = await resolveHostedFamilyChatNotificationRouteTx({
      fallbackTelegramThreadId: telegramMessage.threadId,
      fallbackTelegramUserId: summary.senderTelegramUserId,
      memberId: existingMember.id,
      tx: input.prisma,
    });
    const notification = await appendHostedFamilyChatNotificationTx({
      memberId: existingMember.id,
      message: familyInvite.replyText,
      occurredAt: summary.occurredAt,
      route,
      sourceEventId: buildHostedTelegramWebhookEventId(input.update),
      tx: input.prisma,
    });

    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        reason: "family-invite-created",
      },
      ...(notification.mailboxItemId
        ? {
            wakeMailboxItemId: notification.mailboxItemId,
            wakeUserId: existingMember.id,
          }
        : {}),
    };
  }

  const mailboxAppend = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionTelegramConversationMessageWake({
      eventId: buildHostedTelegramWebhookEventId(input.update),
      occurredAt: summary.occurredAt,
      telegramMessage,
      userId: existingMember.id,
    }),
    tx: input.prisma,
  });

  return {
    desiredSideEffects: [],
    response: {
      ok: true,
      reason: "wake-appended-active-member",
    },
    wakeMailboxItemId: mailboxAppend.item.id,
    wakeUserId: existingMember.id,
  };
}

function buildIgnoredTelegramWebhookPlan(
  reason: string,
): HostedWebhookPlan<HostedOnboardingTelegramWebhookResponse> {
  return {
    desiredSideEffects: [],
    response: {
      ok: true,
      ignored: true,
      reason,
    },
  };
}
