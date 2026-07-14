import type { Prisma } from "@prisma/client";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

import {
  decodeHostedMailboxStoredPayload,
  readHostedMailboxLiveItemById,
  readHostedMailboxPayload,
  readHostedMailboxRecentLiveConversationItemIds,
} from "../hosted-mailbox/store";
import {
  readHostedMemberRoutingState,
} from "./hosted-member-routing-store";
import { readActiveHostedMemberAccess } from "./member-access";

const RECENT_TELEGRAM_INBOUND_SCAN_LIMIT = 100;

export async function isHostedTelegramDeliveryTargetAuthorizedTx(input: {
  deliveryTarget: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
  replyToMessageId: string | null;
}): Promise<boolean> {
  const [access, routing] = await Promise.all([
    readActiveHostedMemberAccess({ memberId: input.memberId, prisma: input.prisma }),
    readHostedMemberRoutingState({ memberId: input.memberId, prisma: input.prisma }),
  ]);
  if (!access) {
    return false;
  }
  if (routing?.telegramThreadId === input.deliveryTarget) {
    return true;
  }
  if (!input.replyToMessageId) {
    return false;
  }

  const mailboxItemIds = await readHostedMailboxRecentLiveConversationItemIds({
    availableAt: new Date(),
    limit: RECENT_TELEGRAM_INBOUND_SCAN_LIMIT,
    prisma: input.prisma,
    userId: input.memberId,
  });
  for (const mailboxItemId of mailboxItemIds) {
    if (await matchesPersistedTelegramInbound({
      deliveryTarget: input.deliveryTarget,
      mailboxItemId,
      memberId: input.memberId,
      prisma: input.prisma,
      replyToMessageId: input.replyToMessageId,
    })) {
      return true;
    }
  }
  return false;
}

async function matchesPersistedTelegramInbound(input: {
  deliveryTarget: string;
  mailboxItemId: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
  replyToMessageId: string;
}): Promise<boolean> {
  const item = await readHostedMailboxLiveItemById({
    availableAt: new Date(),
    mailboxItemId: input.mailboxItemId,
    prisma: input.prisma,
  });
  if (
    !item
    || item.userId !== input.memberId
    || item.kind !== "conversation.message"
    || item.lane !== "conversation"
  ) {
    return false;
  }
  const payload = item.payloadRef
    ? await readHostedMailboxPayload({
        dedupeKey: item.dedupeKey,
        mailboxItemId: item.id,
        payloadRef: item.payloadRef,
        prisma: input.prisma,
        userId: item.userId,
      })
    : null;
  const decoded = await decodeHostedMailboxStoredPayload({
    dedupeKey: item.dedupeKey,
    kind: item.kind,
    lane: item.lane,
    laneSeq: item.laneSeq,
    mailboxItemId: item.id,
    occurredAt: item.occurredAt,
    payloadCiphertext: payload?.payloadCiphertext ?? null,
    payloadInlineCiphertext: item.payloadInlineCiphertext,
    payloadSchema: item.payloadSchema,
    prisma: input.prisma,
    userId: item.userId,
  });
  if (!decoded) {
    return false;
  }
  const wake = parseHostedExecutionWake(decoded);
  return wake.kind === "conversation.message"
    && wake.userId === input.memberId
    && wake.eventId === item.dedupeKey
    && wake.occurredAt === item.occurredAt
    && wake.message.channel === "telegram"
    && wake.message.telegramMessage.messageId === input.replyToMessageId
    && wake.message.telegramMessage.threadId === input.deliveryTarget;
}
