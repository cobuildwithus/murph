import { buildHostedExecutionTelegramMessageReceivedDispatch } from "@murphai/hosted-execution";
import { HostedBillingStatus, HostedMemberStatus } from "@prisma/client";

import {
  createHostedTelegramUserLookupKey,
  sanitizeHostedTelegramUpdateForStorage,
} from "./contact-privacy";
import {
  buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "./telegram";
import { findHostedMemberByTelegramUserLookupKey } from "./hosted-member-store";
import {
  createHostedWebhookDispatchSideEffect,
  type HostedWebhookDispatchSideEffect,
  type HostedWebhookPlan,
  type HostedWebhookReceiptPersistenceClient,
} from "./webhook-receipts";
import { minimizeHostedTelegramUpdate } from "./webhook-event-snapshots";

export type HostedOnboardingTelegramWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  ok: true;
  reason?: string;
};

type HostedOnboardingTelegramWebhookPlan =
  | {
      desiredSideEffects: [];
      response: HostedOnboardingTelegramWebhookResponse;
    }
  | {
      desiredSideEffects: [HostedWebhookDispatchSideEffect];
      response: HostedOnboardingTelegramWebhookResponse;
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

  const telegramUserLookupKey = createHostedTelegramUserLookupKey(
    summary.senderTelegramUserId,
  );
  if (!telegramUserLookupKey) {
    return buildIgnoredTelegramWebhookPlan("missing-sender");
  }

  const existingMember = await findHostedMemberByTelegramUserLookupKey({
    prisma: input.prisma,
    telegramUserId: telegramUserLookupKey,
  });

  if (!existingMember) {
    return buildIgnoredTelegramWebhookPlan("unlinked-telegram");
  }

  if (existingMember.billingStatus !== HostedBillingStatus.active) {
    return buildIgnoredTelegramWebhookPlan("inactive-member");
  }

  if (existingMember.status === HostedMemberStatus.suspended) {
    return buildIgnoredTelegramWebhookPlan("suspended-member");
  }

  return {
    desiredSideEffects: [
      createHostedWebhookDispatchSideEffect({
        dispatch: buildHostedExecutionTelegramMessageReceivedDispatch({
          botUserId: summary.botUserId,
          eventId: buildHostedTelegramWebhookEventId(input.update),
          occurredAt: summary.occurredAt,
          telegramUpdate: sanitizeHostedTelegramUpdateForStorage(
            minimizeHostedTelegramUpdate(input.update),
          ),
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
): HostedOnboardingTelegramWebhookPlan {
  return {
    desiredSideEffects: [],
    response: {
      ok: true,
      ignored: true,
      reason,
    },
  };
}
