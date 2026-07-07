import { type Prisma } from "@prisma/client";
import { buildHostedExecutionTelegramConversationMessageWake } from "@murphai/hosted-execution";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import {
  isHostedMemberSuspended,
} from "./entitlement";
import {
  isHostedOnboardingError,
} from "./errors";
import {
  appendHostedFamilyChatNotificationTx,
  buildHostedFamilyInviteAcceptedReplyText,
  acceptHostedFamilyInviteFromTelegramTx,
  resolveHostedFamilyInviteTokenForInbound,
  resolveHostedFamilyChatNotificationRouteTx,
} from "./family-plan";
import { readActiveHostedMemberAccess } from "./member-access";
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
  const eventId = buildHostedTelegramWebhookEventId(input.update);

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
  const familyInviteTokenPresent = await resolveHostedFamilyInviteTokenForInbound({
    prisma: input.prisma,
    text: telegramMessage?.text ?? null,
  }) !== null;
  let familyInviteNotAccepted = false;
  let familyAcceptance: Awaited<ReturnType<typeof acceptHostedFamilyInviteFromTelegramTx>> = null;
  try {
    familyAcceptance = await acceptHostedFamilyInviteFromTelegramTx({
      now: new Date(summary.occurredAt),
      telegramThreadId: telegramMessage?.threadId ?? null,
      telegramUsername: summary.senderTelegramUsername,
      telegramUserId: summary.senderTelegramUserId,
      text: telegramMessage?.text ?? null,
      tx: input.prisma,
    });
  } catch (error) {
    if (!isExpectedHostedTelegramFamilyInviteAcceptanceMiss(error)) {
      throw error;
    }
    familyInviteNotAccepted = true;
  }
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
      sourceEventId: eventId,
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
            wakeHandoffs: [{ eventId, mailboxItemId: notification.mailboxItemId, source: "telegram", userId: familyAcceptance.memberId }],
          }
        : {}),
    };
  }

  if (familyInviteTokenPresent || familyInviteNotAccepted) {
    return buildIgnoredTelegramWebhookPlan("family-invite-not-accepted");
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

  if (!await readActiveHostedMemberAccess({
    memberId: existingMember.id,
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

  const mailboxAppend = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionTelegramConversationMessageWake({
      eventId,
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
    wakeHandoffs: [{
      eventId, mailboxItemId: mailboxAppend.item.id, source: "telegram", userId: existingMember.id,
      wakeMailboxCheckpoint: { lane: mailboxAppend.item.lane, laneSeq: mailboxAppend.item.laneSeq },
    }],
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

const HOSTED_TELEGRAM_FAMILY_INVITE_ACCEPTANCE_MISS_CODES = new Set([
  "HOSTED_FAMILY_DIRECT_PAID_TRANSFER_REQUIRED",
  "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
  "HOSTED_FAMILY_INVITE_NOT_FOUND",
  "HOSTED_FAMILY_INVITE_TELEGRAM_MISMATCH",
  "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
  "HOSTED_FAMILY_OWNER_ALREADY_IN_GROUP",
  "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
  "HOSTED_FAMILY_TELEGRAM_IDENTITY_AMBIGUOUS",
]);

function isExpectedHostedTelegramFamilyInviteAcceptanceMiss(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && !error.retryable
    && HOSTED_TELEGRAM_FAMILY_INVITE_ACCEPTANCE_MISS_CODES.has(error.code);
}
