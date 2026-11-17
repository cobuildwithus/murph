import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../prisma";
import { isHostedLinqSenderBlocked } from "../hosted-routing/linq-handle-block";
import { createHostedLinqParticipantContact } from "./linq-participant-contact";
import { parseHostedLinqProviderEvent } from "./linq-provider-events";
import { requireHostedLinqMessageEditedEvent, requireHostedLinqMessageReceivedEvent, resolveHostedLinqParticipantContact, type HostedLinqWebhookEvent } from "./linq-webhook";

/** Resolve the actor before speculative generation, edits, or reaction work. */
export async function isHostedLinqWebhookSenderBlocked(event: HostedLinqWebhookEvent, prisma?: PrismaClient): Promise<boolean> {
  let value: string | null = null;
  if (event.event_type === "message.received") {
    const message = requireHostedLinqMessageReceivedEvent(event);
    if (message.data.is_from_me) return false;
    return isHostedLinqSenderBlocked(resolveHostedLinqParticipantContact(message), prisma ?? getPrisma());
  }
  if (event.event_type === "message.edited") {
    const message = requireHostedLinqMessageEditedEvent(event);
    if (message.data.direction === "outbound" || message.data.sender_handle.is_me) return false;
    value = message.data.sender_handle.handle;
  } else if (event.event_type === "reaction.added" || event.event_type === "reaction.removed") {
    const reaction = parseHostedLinqProviderEvent({ event });
    if (reaction?.reactionIsFromMe) return false;
    value = reaction?.reactionFromHandle ?? null;
  }
  if (!value) return false;
  return isHostedLinqSenderBlocked(createHostedLinqParticipantContact({ kind: value.includes("@") ? "email" : "phone", value }), prisma ?? getPrisma());
}

export async function readHostedLinqSenderBlockWebhookResponse(event: HostedLinqWebhookEvent, prisma?: PrismaClient) {
  return await isHostedLinqWebhookSenderBlocked(event, prisma) ? { ok: true as const, ignored: true, reason: "sender-blocked" } : null;
}
