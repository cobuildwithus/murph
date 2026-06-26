import type { Prisma, PrismaClient } from "@prisma/client";

import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedLinqChatLookupKey,
} from "./contact-privacy";
import {
  upsertHostedLinqLineForPhoneTx,
} from "./linq-line-store";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { normalizePhoneNumber } from "./phone";

type HostedLinqConversationClient = PrismaClient | Prisma.TransactionClient;

export const HOSTED_LINQ_TRUSTED_RECIPIENT_REPLY_COUNT = 3;

export const HOSTED_LINQ_CONVERSATION_HEALTH = {
  atRisk: "AT_RISK",
  critical: "CRITICAL",
  healthy: "HEALTHY",
  optedOut: "OPTED_OUT",
} as const;

export async function recordHostedLinqConversationInboundTx(input: {
  chatId: string | null | undefined;
  linqChatLookupKey?: string | null;
  linePhoneNumber?: string | null;
  linePhoneNumberLookupKey?: string | null;
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqConversationClient;
}): Promise<void> {
  const occurredAt = normalizeConversationDate(input.occurredAt);
  const linqChatLookupKey = normalizeConversationText(input.linqChatLookupKey)
    ?? createHostedLinqChatLookupKey(input.chatId);
  if (!occurredAt || !linqChatLookupKey) {
    return;
  }

  const linePhoneNumberLookupKey = await resolveConversationLineLookupKey({
    linePhoneNumber: input.linePhoneNumber,
    linePhoneNumberLookupKey: input.linePhoneNumberLookupKey,
    observedAt: occurredAt,
    prisma: input.prisma,
  });

  await input.prisma.hostedLinqConversationState.upsert({
    where: { linqChatLookupKey },
    create: {
      firstInboundAt: occurredAt,
      healthStatus: HOSTED_LINQ_CONVERSATION_HEALTH.atRisk,
      lastInboundAt: occurredAt,
      linePhoneNumberLookupKey,
      linqChatLookupKey,
      memberId: input.memberId,
      outboundSinceLastInboundCount: 0,
      recipientReplyCount: 1,
    },
    update: {
      ...(linePhoneNumberLookupKey ? { linePhoneNumberLookupKey } : {}),
      lastInboundAt: occurredAt,
      memberId: input.memberId,
      outboundSinceLastInboundCount: 0,
      recipientReplyCount: { increment: 1 },
    },
  });

  await input.prisma.hostedLinqConversationState.updateMany({
    where: { firstInboundAt: null, linqChatLookupKey },
    data: { firstInboundAt: occurredAt },
  });

  await input.prisma.hostedLinqConversationState.updateMany({
    where: {
      linqChatLookupKey,
      recipientReplyCount: { gte: HOSTED_LINQ_TRUSTED_RECIPIENT_REPLY_COUNT },
      trustedAt: null,
    },
    data: { trustedAt: occurredAt },
  });
}

export async function projectHostedLinqConversationForProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  lineLookupKey: string | null;
  prisma: HostedLinqConversationClient;
}): Promise<boolean> {
  const linqChatLookupKey = input.event.linqChatLookupKey;
  if (!linqChatLookupKey) {
    return false;
  }

  if (input.event.eventType === "message.received") {
    if (input.event.direction === "outbound") {
      const updated = await input.prisma.hostedLinqConversationState.updateMany({
        where: { linqChatLookupKey },
        data: {
          lastOutboundAt: input.event.providerCreatedAt,
          outboundSinceLastInboundCount: { increment: 1 },
          totalOutboundCount: { increment: 1 },
        },
      });
      return updated.count === 1;
    }

    const memberId = await resolveConversationMemberIdForProviderEventTx({
      event: input.event,
      prisma: input.prisma,
    });
    if (!memberId) {
      return false;
    }

    await recordHostedLinqConversationInboundTx({
      chatId: input.event.linqChatId,
      linqChatLookupKey,
      linePhoneNumberLookupKey: input.lineLookupKey,
      memberId,
      occurredAt: input.event.providerCreatedAt,
      prisma: input.prisma,
    });
    return true;
  }

  if (input.event.deliveryStatus) {
    return applyHostedLinqConversationDeliveryReceiptTx({
      event: input.event,
      prisma: input.prisma,
    });
  }

  return false;
}

export async function applyHostedLinqConversationDeliveryReceiptTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqConversationClient;
}): Promise<boolean> {
  const linqChatLookupKey = input.event.linqChatLookupKey;
  if (!linqChatLookupKey || !input.event.deliveryStatus) {
    return false;
  }

  if (input.event.deliveryStatus === "delivered") {
    const updated = await input.prisma.hostedLinqConversationState.updateMany({
      where: {
        linqChatLookupKey,
        OR: buildConversationReceiptOrderingWhere(input.event),
      },
      data: {
        consecutiveFailures: 0,
        lastDeliveredAt: input.event.providerCreatedAt,
        lastReceiptAt: input.event.providerCreatedAt,
        lastReceiptEventId: input.event.eventId,
      },
    });
    return updated.count === 1;
  }

  const advanced = await input.prisma.hostedLinqConversationState.updateMany({
    where: {
      healthStatus: { not: HOSTED_LINQ_CONVERSATION_HEALTH.optedOut },
      linqChatLookupKey,
      OR: buildConversationReceiptOrderingWhere(input.event),
    },
    data: {
      consecutiveFailures: { increment: 1 },
      lastFailedAt: input.event.providerCreatedAt,
      lastReceiptAt: input.event.providerCreatedAt,
      lastReceiptEventId: input.event.eventId,
    },
  });
  if (advanced.count !== 1) {
    return false;
  }

  await input.prisma.hostedLinqConversationState.updateMany({
    where: {
      healthStatus: {
        notIn: [
          HOSTED_LINQ_CONVERSATION_HEALTH.critical,
          HOSTED_LINQ_CONVERSATION_HEALTH.optedOut,
        ],
      },
      linqChatLookupKey,
    },
    data: {
      healthReason: "delivery_failed",
      healthStatus: HOSTED_LINQ_CONVERSATION_HEALTH.atRisk,
    },
  });
  return true;
}

async function resolveConversationMemberIdForProviderEventTx(input: {
  event: Pick<ParsedHostedLinqProviderEvent, "linqChatId" | "linqChatLookupKey">;
  prisma: HostedLinqConversationClient;
}): Promise<string | null> {
  if (!input.event.linqChatLookupKey) {
    return null;
  }

  const routing = await input.prisma.hostedMemberRouting.findFirst({
    where: {
      OR: [
        { linqChatLookupKey: input.event.linqChatLookupKey },
        { pendingLinqChatLookupKey: input.event.linqChatLookupKey },
      ],
    },
    select: {
      memberId: true,
    },
  });
  if (routing) {
    return routing.memberId;
  }

  const threadIdentityLookupKeys = createHostedExternalThreadIdentityLookupKeyReadCandidates({
    channel: "linq",
    threadId: input.event.linqChatId,
  });
  if (threadIdentityLookupKeys.length === 0) {
    return null;
  }

  const route = await input.prisma.hostedThreadRoute.findFirst({
    where: {
      channel: "linq",
      threadIdentityLookupKey: {
        in: threadIdentityLookupKeys,
      },
    },
    select: {
      containerMemberId: true,
    },
  });
  return route?.containerMemberId ?? null;
}

function buildConversationReceiptOrderingWhere(
  event: Pick<ParsedHostedLinqProviderEvent, "eventId" | "providerCreatedAt">,
): Prisma.HostedLinqConversationStateWhereInput[] {
  return [
    { lastReceiptAt: null },
    { lastReceiptAt: { lt: event.providerCreatedAt } },
    {
      lastReceiptAt: event.providerCreatedAt,
      lastReceiptEventId: null,
    },
    {
      lastReceiptAt: event.providerCreatedAt,
      lastReceiptEventId: { lt: event.eventId },
    },
  ];
}

async function resolveConversationLineLookupKey(input: {
  linePhoneNumber?: string | null;
  linePhoneNumberLookupKey?: string | null;
  observedAt: Date;
  prisma: HostedLinqConversationClient;
}): Promise<string | null> {
  const providedLookupKey = normalizeConversationText(input.linePhoneNumberLookupKey);
  if (providedLookupKey) {
    return providedLookupKey;
  }
  const linePhoneNumber = normalizePhoneNumber(input.linePhoneNumber);
  if (!linePhoneNumber) {
    return null;
  }
  const line = await upsertHostedLinqLineForPhoneTx({
    observedAt: input.observedAt,
    phoneNumber: linePhoneNumber,
    prisma: input.prisma,
    source: "webhook",
  });
  return line.phoneNumberLookupKey;
}

function normalizeConversationDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeConversationText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
