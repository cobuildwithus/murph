import "server-only";

import type { Prisma } from "@prisma/client";
import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";

import {
  appendHostedMailboxEnvelopeTx,
} from "../hosted-mailbox/store";

/**
 * A group reaction uses the ordinary conversation mailbox and AssistantInputEvent
 * spine, but is consumed at ingress so it can never become a reply candidate.
 * The exact row remains importable as durable context and follows the same
 * checkpoint, retention, and idempotency rules as every other message.
 */
export async function appendConsumedHostedGroupReactionMailboxEnvelopeTx(input: {
  envelope: HostedExecutionConversationMessageWake;
  tx: Prisma.TransactionClient;
}): Promise<Awaited<ReturnType<typeof appendHostedMailboxEnvelopeTx>>> {
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: input.envelope,
    tx: input.tx,
  });
  if (appended.dedupeConflict) {
    throw new Error("Hosted group reaction mailbox dedupe conflict.");
  }

  const consumed = await input.tx.hostedMailboxItem.updateMany({
    data: {
      consumedAt: new Date(input.envelope.occurredAt),
    },
    where: {
      consumedAt: null,
      id: appended.item.id,
      userId: input.envelope.userId,
    },
  });
  if (appended.inserted && consumed.count !== 1) {
    throw new Error("A new hosted group reaction mailbox row was not consumed.");
  }

  return appended;
}
