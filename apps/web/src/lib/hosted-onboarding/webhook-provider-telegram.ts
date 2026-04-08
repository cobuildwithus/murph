import { buildHostedExecutionTelegramMessageReceivedDispatch } from "@murphai/hosted-execution";

import {
  hasHostedMemberActiveAccess,
  isHostedMemberSuspended,
} from "./entitlement";
import {
  buildHostedTelegramMessagePayload,
  buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "./telegram";
import { findHostedMemberByTelegramUserId } from "./hosted-member-routing-store";
import {
  createHostedWebhookDispatchSideEffect,
  type HostedWebhookPlan,
  type HostedWebhookReceiptPersistenceClient,
} from "./webhook-receipts";

export type HostedOnboardingTelegramWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  ok: true;
  reason?: string;
};

export async function planHostedOnboardingTelegramWebhook(input: {
  prisma: HostedWebhookReceiptPersistenceClient;
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

  const existingMember = await findHostedMemberByTelegramUserId({
    prisma: input.prisma,
    telegramUserId: summary.senderTelegramUserId,
  });

  if (!existingMember) {
    return buildIgnoredTelegramWebhookPlan("unlinked-telegram");
  }

  if (isHostedMemberSuspended(existingMember.suspendedAt)) {
    return buildIgnoredTelegramWebhookPlan("suspended-member");
  }

  if (!hasHostedMemberActiveAccess(existingMember)) {
    return buildIgnoredTelegramWebhookPlan("inactive-member");
  }

  const telegramMessage = buildHostedTelegramMessagePayload(input.update);

  if (!telegramMessage) {
    return buildIgnoredTelegramWebhookPlan("unsupported-update");
  }

  return {
    desiredSideEffects: [
      createHostedWebhookDispatchSideEffect({
        dispatch: buildHostedExecutionTelegramMessageReceivedDispatch({
          eventId: buildHostedTelegramWebhookEventId(input.update),
          occurredAt: summary.occurredAt,
          telegramMessage,
          userId: existingMember.id,
        }),
      }),
    ],
    response: {
      ok: true,
      reason: "dispatched-active-member",
    },
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
