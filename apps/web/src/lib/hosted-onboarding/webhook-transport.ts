import { Prisma, type PrismaClient } from "@prisma/client";

import { enqueueHostedExecutionOutbox } from "../hosted-execution/outbox";
import { sendHostedLinqChatMessage } from "./linq";
import { maybeIssueHostedRevnetForStripeInvoice } from "./stripe-revnet-issuance";
import { buildHostedWebhookReceiptLeaseWriteData } from "./webhook-receipt-store";
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
      prisma: PrismaClient;
    }) => {
      if (effect.kind === "linq_message_send" && effect.payload.inviteId) {
        await markHostedInviteSentBestEffort(effect.payload.inviteId, prisma);
      }
    },
    enqueueDispatchEffect: enqueueHostedWebhookDispatchEffect,
    performSideEffect: performHostedWebhookSideEffect,
  };
}

async function enqueueHostedWebhookDispatchEffect(input: HostedWebhookDispatchEnqueueInput): Promise<number> {
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
): Promise<number> {
  await enqueueHostedExecutionOutbox({
    dispatch: input.dispatch,
    sourceId: `${input.source}:${input.eventId}`,
    sourceType: "hosted_webhook_receipt",
    tx: transaction,
  });
  const updatedReceipt = await transaction.hostedWebhookReceipt.updateMany({
    where: {
      source: input.source,
      eventId: input.eventId,
      payloadJson: {
        equals: input.previousClaim.payloadJson ?? Prisma.JsonNull,
      },
    },
    data: {
      ...buildHostedWebhookReceiptLeaseWriteData(input.nextStatus),
      payloadJson: input.nextPayloadJson,
    },
  });

  return updatedReceipt.count;
}

async function performHostedWebhookSideEffect(
  effect: HostedWebhookSideEffect,
  options: {
    prisma: PrismaClient;
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
        message: effect.payload.message,
        replyToMessageId: effect.payload.replyToMessageId,
        signal: options.signal,
      });
    case "revnet_invoice_issue": {
      const member = await options.prisma.hostedMember.findUnique({
        where: {
          id: effect.payload.memberId,
        },
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

async function markHostedInviteSentBestEffort(
  inviteId: string,
  prisma: PrismaClient,
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
      error instanceof Error ? error.message : String(error),
    );
  }
}
