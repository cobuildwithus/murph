import type { Prisma, PrismaClient } from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "./contact-privacy";
import {
  upsertHostedLinqLineForPhoneTx,
} from "./linq-line-store";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { normalizePhoneNumber } from "./phone";

type HostedLinqConversationClient = PrismaClient | Prisma.TransactionClient;

export const HOSTED_LINQ_TRUSTED_RECIPIENT_REPLY_COUNT = 3;
export const HOSTED_LINQ_COLD_PROACTIVE_WINDOW_DAYS = 30;
const HOSTED_LINQ_COLD_PROACTIVE_WINDOW_MS =
  HOSTED_LINQ_COLD_PROACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const HOSTED_LINQ_CONVERSATION_HEALTH = {
  atRisk: "AT_RISK",
  critical: "CRITICAL",
  healthy: "HEALTHY",
  optedOut: "OPTED_OUT",
} as const;

export type HostedLinqConversationEgressKind =
  | "current_inbound_reply"
  | "proactive"
  | "reactive_notice"
  | "recovery";

export type HostedLinqConversationEgressBlockReason =
  | "conversation_critical"
  | "conversation_missing"
  | "conversation_opted_out"
  | "missing_recent_inbound"
  | "three_reply_danger_zone";

export type HostedLinqConversationEgressDecision =
  | {
      allowed: true;
      egressKind: HostedLinqConversationEgressKind;
      lastInboundAt: Date | null;
      recipientReplyCount: number;
    }
  | {
      allowed: false;
      egressKind: HostedLinqConversationEgressKind;
      lastInboundAt: Date | null;
      reason: HostedLinqConversationEgressBlockReason;
      recipientReplyCount: number;
    };

export async function recordHostedLinqConversationInboundTx(input: {
  chatId: string | null | undefined;
  linePhoneNumber?: string | null;
  linePhoneNumberLookupKey?: string | null;
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqConversationClient;
}): Promise<void> {
  const occurredAt = normalizeConversationDate(input.occurredAt);
  const linqChatLookupKey = createHostedLinqChatLookupKey(input.chatId);
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

export async function claimHostedLinqConversationEgressTx(input: {
  chatId: string | null | undefined;
  egressKind?: HostedLinqConversationEgressKind | string | null;
  linePhoneNumber?: string | null;
  linePhoneNumberLookupKey?: string | null;
  memberId: string;
  now?: Date;
  prisma: HostedLinqConversationClient;
}): Promise<HostedLinqConversationEgressDecision> {
  const now = input.now ?? new Date();
  const egressKind = normalizeConversationEgressKind(input.egressKind);
  const linqChatLookupKey = createHostedLinqChatLookupKey(input.chatId);
  if (!linqChatLookupKey) {
    return {
      allowed: false,
      egressKind,
      lastInboundAt: null,
      reason: "conversation_missing",
      recipientReplyCount: 0,
    };
  }

  const linePhoneNumberLookupKey = await resolveConversationLineLookupKey({
    linePhoneNumber: input.linePhoneNumber,
    linePhoneNumberLookupKey: input.linePhoneNumberLookupKey,
    observedAt: now,
    prisma: input.prisma,
  });

  await input.prisma.hostedLinqConversationState.upsert({
    where: { linqChatLookupKey },
    create: {
      healthStatus: HOSTED_LINQ_CONVERSATION_HEALTH.atRisk,
      linePhoneNumberLookupKey,
      linqChatLookupKey,
      memberId: input.memberId,
    },
    update: {
      ...(linePhoneNumberLookupKey ? { linePhoneNumberLookupKey } : {}),
    },
  });

  const claim = await input.prisma.hostedLinqConversationState.updateMany({
    where: buildConversationEgressClaimWhere({ egressKind, linqChatLookupKey, memberId: input.memberId, now }),
    data: {
      lastOutboundAt: now,
      outboundSinceLastInboundCount: { increment: 1 },
      totalOutboundCount: { increment: 1 },
    },
  });

  const current = await input.prisma.hostedLinqConversationState.findUnique({
    where: { linqChatLookupKey },
    select: {
      healthStatus: true,
      lastInboundAt: true,
      memberId: true,
      outboundSinceLastInboundCount: true,
      recipientReplyCount: true,
    },
  });

  if (claim.count === 1) {
    return {
      allowed: true,
      egressKind,
      lastInboundAt: current?.lastInboundAt ?? null,
      recipientReplyCount: current?.recipientReplyCount ?? 0,
    };
  }

  return buildConversationBlockedDecision({ current, egressKind, memberId: input.memberId, now });
}

export async function applyHostedLinqConversationDeliveryReceiptTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqConversationClient;
}): Promise<void> {
  const linqChatLookupKey = input.event.linqChatLookupKey;
  if (!linqChatLookupKey || !input.event.deliveryStatus) {
    return;
  }

  if (input.event.deliveryStatus === "delivered") {
    await input.prisma.hostedLinqConversationState.updateMany({
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
    return;
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
    return;
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

export function buildHostedLinqConversationEgressSkipReason(
  decision: Extract<HostedLinqConversationEgressDecision, { allowed: false }>,
): string {
  return [
    `reason=${decision.reason}`,
    `egress_kind=${decision.egressKind}`,
    `recipient_replies=${decision.recipientReplyCount}`,
    `last_inbound_at=${decision.lastInboundAt?.toISOString() ?? "null"}`,
  ].join("; ");
}

function buildConversationEgressClaimWhere(input: {
  egressKind: HostedLinqConversationEgressKind;
  linqChatLookupKey: string;
  memberId: string;
  now: Date;
}): Prisma.HostedLinqConversationStateWhereInput {
  const base: Prisma.HostedLinqConversationStateWhereInput = {
    healthStatus: {
      notIn: [
        HOSTED_LINQ_CONVERSATION_HEALTH.critical,
        HOSTED_LINQ_CONVERSATION_HEALTH.optedOut,
      ],
    },
    linqChatLookupKey: input.linqChatLookupKey,
    memberId: input.memberId,
  };

  if (input.egressKind !== "proactive") {
    return base;
  }

  return {
    ...base,
    lastInboundAt: { gte: new Date(input.now.getTime() - HOSTED_LINQ_COLD_PROACTIVE_WINDOW_MS) },
    OR: [
      { recipientReplyCount: { gte: HOSTED_LINQ_TRUSTED_RECIPIENT_REPLY_COUNT } },
      { outboundSinceLastInboundCount: { lt: 1 } },
    ],
  };
}

function buildConversationBlockedDecision(input: {
  current: {
    healthStatus: string;
    lastInboundAt: Date | null;
    memberId: string;
    outboundSinceLastInboundCount: number;
    recipientReplyCount: number;
  } | null;
  egressKind: HostedLinqConversationEgressKind;
  memberId: string;
  now: Date;
}): Extract<HostedLinqConversationEgressDecision, { allowed: false }> {
  const current = input.current;
  if (!current || current.memberId !== input.memberId) {
    return {
      allowed: false,
      egressKind: input.egressKind,
      lastInboundAt: current?.lastInboundAt ?? null,
      reason: "conversation_missing",
      recipientReplyCount: current?.recipientReplyCount ?? 0,
    };
  }
  if (current.healthStatus === HOSTED_LINQ_CONVERSATION_HEALTH.optedOut) {
    return {
      allowed: false,
      egressKind: input.egressKind,
      lastInboundAt: current.lastInboundAt,
      reason: "conversation_opted_out",
      recipientReplyCount: current.recipientReplyCount,
    };
  }
  if (current.healthStatus === HOSTED_LINQ_CONVERSATION_HEALTH.critical) {
    return {
      allowed: false,
      egressKind: input.egressKind,
      lastInboundAt: current.lastInboundAt,
      reason: "conversation_critical",
      recipientReplyCount: current.recipientReplyCount,
    };
  }

  const coldCutoffMs = input.now.getTime() - HOSTED_LINQ_COLD_PROACTIVE_WINDOW_MS;
  if (input.egressKind === "proactive" && (!current.lastInboundAt || current.lastInboundAt.getTime() < coldCutoffMs)) {
    return {
      allowed: false,
      egressKind: input.egressKind,
      lastInboundAt: current.lastInboundAt,
      reason: "missing_recent_inbound",
      recipientReplyCount: current.recipientReplyCount,
    };
  }

  return {
    allowed: false,
    egressKind: input.egressKind,
    lastInboundAt: current.lastInboundAt,
    reason: "three_reply_danger_zone",
    recipientReplyCount: current.recipientReplyCount,
  };
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
  const lookupKey = createHostedPhoneLookupKey(linePhoneNumber);
  if (!linePhoneNumber || !lookupKey) {
    return null;
  }
  await upsertHostedLinqLineForPhoneTx({
    observedAt: input.observedAt,
    phoneNumber: linePhoneNumber,
    prisma: input.prisma,
    source: "webhook",
  });
  return lookupKey;
}

function normalizeConversationDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeConversationEgressKind(value: HostedLinqConversationEgressKind | string | null | undefined): HostedLinqConversationEgressKind {
  switch (value) {
    case "current_inbound_reply":
    case "reactive_notice":
    case "recovery":
      return value;
    default:
      return "proactive";
  }
}

function normalizeConversationText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
