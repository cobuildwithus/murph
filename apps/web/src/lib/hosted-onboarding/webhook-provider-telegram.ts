import { buildHostedExecutionTelegramMessageReceivedDispatch } from "@murph/hosted-execution";
import { HostedBillingStatus, HostedMemberStatus, type PrismaClient } from "@prisma/client";

import {
  buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "./telegram";
import {
  createHostedWebhookDispatchSideEffect,
  type HostedWebhookDispatchSideEffect,
  type HostedWebhookPlan,
} from "./webhook-receipts";

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
  prisma: PrismaClient;
  update: ReturnType<typeof parseHostedTelegramWebhookUpdate>;
}): Promise<HostedWebhookPlan<HostedOnboardingTelegramWebhookResponse>> {
  const summary = await summarizeHostedTelegramWebhook(input.update);

  if (!summary) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "unsupported-update",
      },
    };
  }

  if (summary.isBotMessage) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "own-message",
      },
    };
  }

  if (!summary.isDirect) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: summary.chatType ?? "unsupported-chat",
      },
    };
  }

  if (!summary.senderTelegramUserId) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "missing-sender",
      },
    };
  }

  const existingMember = await input.prisma.hostedMember.findUnique({
    where: {
      telegramUserId: summary.senderTelegramUserId,
    },
    select: {
      billingStatus: true,
      id: true,
      status: true,
    },
  });

  if (!existingMember) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "unlinked-telegram",
      },
    };
  }

  if (existingMember.billingStatus !== HostedBillingStatus.active) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "inactive-member",
      },
    };
  }

  if (existingMember.status === HostedMemberStatus.suspended) {
    return {
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "suspended-member",
      },
    };
  }

  return {
    desiredSideEffects: [
      createHostedWebhookDispatchSideEffect({
        dispatch: buildHostedExecutionTelegramMessageReceivedDispatch({
          botUserId: summary.botUserId,
          eventId: buildHostedTelegramWebhookEventId(input.update),
          occurredAt: summary.occurredAt,
          telegramUpdate: input.update as unknown as Record<string, unknown>,
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
