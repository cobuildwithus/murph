import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { MessageContent } from "@linqapp/sdk/resources";
import type { Message } from "@linqapp/sdk/resources/messages";

import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import { readHostedLinqFailedMessage, resendHostedLinqMessage } from "./linq-client";
import { recordHostedLinqTerminalRetryAcceptedTx } from "./linq-delivery-store";
import { evaluateHostedLinqEgressPolicy } from "./linq-egress-policy";
import { readHostedRuntimeAiAccessDecision } from "./member-access";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
import { sha256Hex } from "../primitives";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";

// Recovery cannot extend the provider's optional 24-hour content lifetime.
const RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
type RetryClient = PrismaClient | Prisma.TransactionClient;

export function isHostedLinqTerminalSendFailure(input: {
  failureCode: string | null;
  failureReason: string | null;
}): boolean {
  return input.failureCode === "4001"
    && input.failureReason === "Message send failed";
}

export async function retryHostedLinqTerminalSendForEvent(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
}): Promise<void> {
  if (input.event.eventType !== "message.failed" || !isHostedLinqTerminalSendFailure(input.event)) return;
  await retryHostedLinqTerminalSend({
    chatId: input.event.linqChatId,
    messageId: input.event.linqMessageId,
    prisma: input.prisma,
  });
}

/** Return no request when retrieval cannot preserve the original send semantics. */
export function buildHostedLinqTerminalRetryMessage(
  original: Message,
  idempotencyKey: string,
): MessageContent | null {
  if (!original.parts?.length || original.parts.length > 100) return null;
  const parts: NonNullable<MessageContent["parts"]> = [];
  for (const part of original.parts) {
    switch (part.type) {
      case "text":
        parts.push({
          type: "text",
          value: part.value,
          ...(part.text_decorations ? { text_decorations: part.text_decorations } : {}),
        });
        break;
      case "link":
        parts.push({ type: "link", value: part.value });
        break;
      case "media":
        // Retrieval does not distinguish voice memo bubbles from audio files.
        if (!part.id || !part.mime_type || part.mime_type.startsWith("audio/")) return null;
        parts.push({ type: "media", attachment_id: part.id });
        break;
      default:
        // App cards omit original interaction/experience semantics in retrieval.
        return null;
    }
  }
  return {
    idempotency_key: idempotencyKey,
    parts,
    preferred_service: original.preferred_service ?? "iMessage",
    ...(original.effect ? { effect: original.effect } : {}),
    ...(original.reply_to ? { reply_to: original.reply_to } : {}),
  };
}

async function readRetryCandidate(input: {
  chatKeys: string[];
  messageKeys: string[];
  now: Date;
  prisma: RetryClient;
}) {
  const delivery = await input.prisma.hostedLinqDelivery.findFirst({
    where: {
      source: "hosted_runtime_linq_delivery",
      status: "failed",
      linqChatLookupKey: { in: input.chatKeys },
      acceptedAt: { gte: new Date(input.now.getTime() - RETRY_MAX_AGE_MS) },
      OR: [
        { messageLookupKey: { in: input.messageKeys } },
        { messages: { some: { messageLookupKey: { in: input.messageKeys } } } },
      ],
    },
    select: {
      id: true,
      acceptedAt: true,
      messageLookupKey: true,
      messageIdSuffix: true,
      phoneNumberLookupKey: true,
      threadIsDirect: true,
      failedAt: true,
      failureCode: true,
      failureReason: true,
      lastReceiptAt: true,
      lastProviderEventId: true,
      service: true,
      status: true,
      messages: {
        select: {
          id: true,
          messageLookupKey: true,
          status: true,
          failureCode: true,
          failureReason: true,
          terminalRetryAttemptedAt: true,
        },
        take: 11,
      },
    },
  });
  if (
    !delivery?.phoneNumberLookupKey
    || !delivery.acceptedAt
    || delivery.threadIsDirect === null
    || delivery.messages.length > 10
  ) return null;
  const message = delivery.messages.find((item) =>
    input.messageKeys.includes(item.messageLookupKey));
  if (delivery.messages.length && !message) return null;
  const failed = message ?? delivery;
  if (
    failed.status !== "failed"
    || !isHostedLinqTerminalSendFailure(failed)
    || message?.terminalRetryAttemptedAt
  ) return null;
  return { delivery, message };
}

async function assertRetryRouteAndPolicy(input: {
  chatId: string;
  chatKeys: string[];
  lineKey: string;
  threadIsDirect: boolean;
  prisma: RetryClient;
}): Promise<boolean> {
  const group = await readHostedThreadRouteByThreadIdentity({
    channel: "linq", threadId: input.chatId, prisma: input.prisma,
  });
  const direct = group ? null : await input.prisma.hostedMemberRouting.findFirst({
    where: { linqChatLookupKey: { in: input.chatKeys } },
    select: { memberId: true, linqRecipientPhoneLookupKey: true },
  });
  const memberId = group?.containerMemberId ?? direct?.memberId;
  const lineKey = group?.accountLookupKey ?? direct?.linqRecipientPhoneLookupKey;
  if (!memberId || lineKey !== input.lineKey || Boolean(direct) !== input.threadIsDirect) {
    return false;
  }
  const access = await readHostedRuntimeAiAccessDecision({
    memberId, prisma: input.prisma,
  });
  if (!access.allowed) return false;
  const line = await input.prisma.hostedLinqLine.findUnique({
    where: { phoneNumberLookupKey: input.lineKey },
    select: {
      configuredAt: true, egressPolicy: true, healthStatus: true,
      providerReputationStatus: true, providerServiceStatus: true,
    },
  });
  if (!line?.configuredAt) return false;
  const chat = await input.prisma.hostedLinqChatHealth.findFirst({
    where: { linqChatLookupKey: { in: input.chatKeys } },
    select: { providerStatus: true, phoneNumberLookupKey: true },
  });
  if (chat?.phoneNumberLookupKey && chat.phoneNumberLookupKey !== input.lineKey) return false;
  return evaluateHostedLinqEgressPolicy({
    chatHealthStatus: chat?.providerStatus,
    lineDeliveryHealthStatus: line.healthStatus,
    lineEgressPolicy: line.egressPolicy,
    lineReputationStatus: line.providerReputationStatus,
    lineServiceStatus: line.providerServiceStatus,
    newConversation: false,
  }).kind === "allow";
}

function isMatchingFailedOutbound(
  original: Message,
  input: { messageId: string; chatId: string; lineKey: string },
): boolean {
  return original.id === input.messageId
    && original.chat_id === input.chatId
    && original.is_from_me === true
    && original.delivery_status === "failed"
    && original.service === "iMessage"
    && createHostedPhoneLookupKeyReadCandidates(
      original.from_handle?.handle ?? original.from,
    ).includes(input.lineKey);
}

/**
 * Called both after receipt ingestion and after runtime acceptance so neither
 * arrival order can strand a known terminal failure. The existing message row
 * owns the one-attempt fence, including duplicate/concurrent webhook delivery.
 */
export async function retryHostedLinqTerminalSend(input: {
  chatId: string | null;
  messageId: string | null;
  prisma: PrismaClient;
}): Promise<void> {
  if (!input.chatId || !input.messageId) return;
  const { chatId, messageId, prisma } = input;
  const keys = {
    chatKeys: createHostedLinqChatLookupKeyReadCandidates(chatId),
    messageKeys: createHostedLinqMessageLookupKeyReadCandidates(messageId),
    now: new Date(),
  };
  const candidate = await readRetryCandidate({ ...keys, prisma });
  if (!candidate) return;
  const { delivery } = candidate;
  const lineKey = delivery.phoneNumberLookupKey;
  const threadIsDirect = delivery.threadIsDirect;
  if (!lineKey || threadIsDirect === null) return;
  const policyInput = { chatId, chatKeys: keys.chatKeys, lineKey, threadIsDirect };
  if (!await assertRetryRouteAndPolicy({ ...policyInput, prisma })) return;

  const original = await readHostedLinqFailedMessage(messageId);
  if (!isMatchingFailedOutbound(original, { messageId, chatId, lineKey })) return;
  const messageRowId = candidate.message?.id
    ?? `hlm_terminal_${sha256Hex(delivery.id)}`;
  const body = buildHostedLinqTerminalRetryMessage(
    original, `terminal-retry:${messageRowId}`,
  );
  if (!body) return;

  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM hosted_linq_delivery WHERE id = ${delivery.id} FOR UPDATE
    `);
    const current = await readRetryCandidate({ ...keys, now: new Date(), prisma: tx });
    if (!current || current.delivery.id !== delivery.id) return false;
    if (!await assertRetryRouteAndPolicy({ ...policyInput, prisma: tx })) return false;
    if (!current.message) {
      await tx.hostedLinqDeliveryMessage.create({
        data: {
          id: messageRowId, deliveryId: delivery.id, ordinal: 0,
          messageLookupKey: current.delivery.messageLookupKey!,
          messageIdSuffix: current.delivery.messageIdSuffix,
          acceptedAt: current.delivery.acceptedAt!,
          failedAt: current.delivery.failedAt,
          failureCode: current.delivery.failureCode,
          failureReason: current.delivery.failureReason,
          lastReceiptAt: current.delivery.lastReceiptAt,
          lastProviderEventId: current.delivery.lastProviderEventId,
          service: current.delivery.service,
          status: "failed",
        },
      });
    }
    const claim = await tx.hostedLinqDeliveryMessage.updateMany({
      where: { id: messageRowId, terminalRetryAttemptedAt: null },
      data: { terminalRetryAttemptedAt: new Date() },
    });
    return claim.count === 1;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (!claimed) return;

  // A transport-ambiguous response consumes this attempt too. Never open a
  // second retry or release the fence after dispatch may have reached Linq.
  const accepted = await resendHostedLinqMessage({ chatId, message: body });
  if (accepted.chatId !== chatId || !accepted.messageId || accepted.messageId === messageId) {
    throw new Error("Linq terminal retry response omitted the expected identity.");
  }
  await prisma.$transaction((tx) => recordHostedLinqTerminalRetryAcceptedTx({
    acceptedAt: new Date(),
    deliveryId: delivery.id,
    messageRowId,
    messageId: accepted.messageId!,
    phoneNumberLookupKey: lineKey,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}
