import { Prisma, type PrismaClient } from "@prisma/client";

import { enqueueHostedExecutionOutbox } from "../hosted-execution/outbox";
import { sendHostedLinqChatMessage } from "./linq";
import type {
  HostedWebhookDispatchEnqueueInput,
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
  const transaction = input.prisma.$transaction;

  if (typeof transaction === "function") {
    return transaction.call(input.prisma, async (tx) => {
      await enqueueHostedExecutionOutbox({
        dispatch: input.dispatch,
        sourceId: `${input.source}:${input.eventId}`,
        sourceType: "hosted_webhook_receipt",
        tx,
      });
      const updatedReceipt = await tx.hostedWebhookReceipt.updateMany({
        where: {
          source: input.source,
          eventId: input.eventId,
          payloadJson: {
            equals: input.previousClaim.payloadJson ?? Prisma.JsonNull,
          },
        },
        data: {
          payloadJson: input.nextPayloadJson,
        },
      });

      return updatedReceipt.count;
    }) as Promise<number>;
  }

  await enqueueHostedExecutionOutbox({
    dispatch: input.dispatch,
    sourceId: `${input.source}:${input.eventId}`,
    sourceType: "hosted_webhook_receipt",
    tx: input.prisma as unknown as Prisma.TransactionClient,
  });
  const updatedReceipt = await input.prisma.hostedWebhookReceipt.updateMany({
    where: {
      source: input.source,
      eventId: input.eventId,
      payloadJson: {
        equals: input.previousClaim.payloadJson ?? Prisma.JsonNull,
      },
    },
    data: {
      payloadJson: input.nextPayloadJson,
    },
  });

  return updatedReceipt.count;
}

async function performHostedWebhookSideEffect(
  effect: HostedWebhookSideEffect,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<{ dispatched: true } | { chatId: string | null; messageId: string | null }> {
  switch (effect.kind) {
    case "hosted_execution_dispatch":
      throw new Error("Hosted execution dispatch effects must be queued through the execution outbox.");
    case "linq_message_send":
      return sendHostedLinqChatMessage({
        chatId: effect.payload.chatId,
        message: effect.payload.message,
        signal: options.signal,
      });
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
