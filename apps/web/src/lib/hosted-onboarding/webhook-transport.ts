import type { Prisma, PrismaClient } from "@prisma/client";

import { enqueueHostedExecutionOutboxPayload } from "../hosted-execution/outbox";
import { hostedOnboardingError } from "./errors";
import { sanitizeHostedOnboardingLogString } from "./http";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import { buildHostedInviteUrl } from "./invite-service";
import {
  buildHostedDailyQuotaReply,
  buildHostedInviteReply,
  buildHostedLinqConversationHomeRedirectReply,
  sendHostedLinqChatMessage,
} from "./linq";
import { maybeIssueHostedRevnetForStripeInvoice } from "./stripe-revnet-issuance";
import type {
  HostedWebhookDispatchEnqueueInput,
  HostedWebhookReceiptPersistenceClient,
  HostedWebhookReceiptHandlers,
  HostedWebhookSideEffect,
} from "./webhook-receipt-types";

export function createHostedWebhookReceiptHandlers(): HostedWebhookReceiptHandlers {
  return {
    afterSideEffectSent: async ({
      effect,
      prisma,
    }: {
      effect: HostedWebhookSideEffect;
      prisma: HostedWebhookReceiptPersistenceClient;
    }) => {
      if (effect.kind === "linq_message_send" && effect.payload.inviteId) {
        await markHostedInviteSentBestEffort(effect.payload.inviteId, prisma);
      }
    },
    enqueueDispatchEffect: enqueueHostedWebhookDispatchEffect,
    performSideEffect: performHostedWebhookSideEffect,
  };
}

async function enqueueHostedWebhookDispatchEffect(input: HostedWebhookDispatchEnqueueInput): Promise<void> {
  if (isPrismaClient(input.prismaOrTransaction)) {
    return input.prismaOrTransaction.$transaction((tx) =>
      enqueueHostedWebhookDispatchEffectWithTransaction(input, tx),
    );
  }

  return enqueueHostedWebhookDispatchEffectWithTransaction(input, input.prismaOrTransaction);
}

function isPrismaClient(
  client: HostedWebhookReceiptPersistenceClient,
): client is PrismaClient {
  return "$transaction" in client && typeof client.$transaction === "function";
}

async function enqueueHostedWebhookDispatchEffectWithTransaction(
  input: HostedWebhookDispatchEnqueueInput,
  transaction: Prisma.TransactionClient,
): Promise<void> {
  await enqueueHostedExecutionOutboxPayload({
    payload: input.payload,
    sourceId: `${input.source}:${input.eventId}`,
    sourceType: "hosted_webhook_receipt",
    tx: transaction,
  });
}

async function performHostedWebhookSideEffect(
  effect: HostedWebhookSideEffect,
  options: {
    prisma: HostedWebhookReceiptPersistenceClient;
    signal?: AbortSignal;
  },
): Promise<
  | { dispatched: true }
  | { chatId: string | null; messageId: string | null }
  | { handled: true }
> {
  switch (effect.kind) {
    case "hosted_execution_dispatch":
      throw new Error("Hosted execution dispatch effects must be queued through the execution outbox.");
    case "linq_message_send":
      return sendHostedLinqChatMessage({
        chatId: effect.payload.chatId,
        idempotencyKey: effect.effectId,
        message: await buildHostedLinqSideEffectMessage(effect, options.prisma),
        replyToMessageId: effect.payload.replyToMessageId,
        signal: options.signal,
      });
    case "revnet_invoice_issue": {
      const member = await readHostedMemberSnapshot({
        memberId: effect.payload.memberId,
        prisma: options.prisma,
      });

      if (!member) {
        return { handled: true };
      }

      await maybeIssueHostedRevnetForStripeInvoice({
        invoice: {
          amount_paid: effect.payload.amountPaid,
          charge: effect.payload.chargeId,
          currency: effect.payload.currency,
          id: effect.payload.invoiceId,
          payment_intent: effect.payload.paymentIntentId,
        } as never,
        member,
        prisma: options.prisma,
      });

      return { handled: true };
    }
    default:
      throw new Error(`Unsupported hosted webhook side effect kind: ${JSON.stringify(effect)}`);
  }
}

async function buildHostedLinqSideEffectMessage(
  effect: Extract<HostedWebhookSideEffect, { kind: "linq_message_send" }>,
  prisma: HostedWebhookReceiptPersistenceClient,
): Promise<string> {
  if (effect.payload.template === "daily_quota") {
    return buildHostedDailyQuotaReply();
  }

  if (effect.payload.template === "conversation_home_redirect") {
    if (!effect.payload.homeRecipientPhone) {
      throw hostedOnboardingError({
        code: "LINQ_HOME_PHONE_REQUIRED",
        message: `Hosted webhook side effect ${effect.effectId} requires a home recipient phone.`,
        httpStatus: 500,
        retryable: false,
      });
    }

    return buildHostedLinqConversationHomeRedirectReply({
      homeRecipientPhone: effect.payload.homeRecipientPhone,
    });
  }

  if (!effect.payload.inviteId) {
    throw hostedOnboardingError({
      code: "HOSTED_INVITE_REQUIRED",
      message: `Hosted webhook side effect ${effect.effectId} requires an invite id.`,
      httpStatus: 500,
      retryable: false,
    });
  }

  const inviteLookup =
    "findUnique" in prisma.hostedInvite && typeof prisma.hostedInvite.findUnique === "function"
      ? prisma.hostedInvite.findUnique({
          where: {
            id: effect.payload.inviteId,
          },
          select: {
            inviteCode: true,
          },
        })
      : prisma.hostedInvite.findFirst({
          where: {
            id: effect.payload.inviteId,
          },
          select: {
            inviteCode: true,
          },
        });
  const invite = await inviteLookup;

  if (!invite) {
    throw hostedOnboardingError({
      code: "HOSTED_INVITE_NOT_FOUND",
      message: `Hosted invite ${effect.payload.inviteId} was not found for webhook side effect ${effect.effectId}.`,
      httpStatus: 500,
      retryable: false,
    });
  }

  return buildHostedInviteReply({
    activeSubscription: effect.payload.template === "invite_signin",
    joinUrl: buildHostedInviteUrl(invite.inviteCode),
  });
}

async function markHostedInviteSentBestEffort(
  inviteId: string,
  prisma: HostedWebhookReceiptPersistenceClient,
): Promise<void> {
  try {
    await prisma.hostedInvite.update({
      where: {
        id: inviteId,
      },
      data: {
        sentAt: new Date(),
      },
    });
  } catch (error) {
    console.error(
      "Hosted invite sentAt update failed.",
      sanitizeHostedOnboardingLogString(
        error instanceof Error ? error.message : String(error),
      ) ?? "Unknown error.",
    );
  }
}
