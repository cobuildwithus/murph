import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";

import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  markHostedLinqDeliverySkippedTx,
} from "./linq-delivery-store";
import type {
  HostedLinqMessagePayload,
} from "./webhook-transport";
import {
  assertHostedThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import {
  hostedOnboardingError,
} from "./errors";

type HostedLinqEngagementClient = PrismaClient | Prisma.TransactionClient;

export const HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS = 28;
const HOSTED_LINQ_RECENT_INBOUND_WINDOW_MS =
  HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type HostedLinqRecentInboundDecision =
  | {
      allowed: true;
      lastInboundAt: Date;
    }
  | {
      allowed: false;
      lastInboundAt: Date | null;
      reason: "missing_recent_inbound";
    };

export function decideHostedLinqRecentInbound(input: {
  lastInboundAt: Date | null;
  now?: Date;
}): HostedLinqRecentInboundDecision {
  const now = input.now ?? new Date();
  const lastInboundAt = input.lastInboundAt;
  if (!lastInboundAt) {
    return {
      allowed: false,
      lastInboundAt: null,
      reason: "missing_recent_inbound",
    };
  }

  return lastInboundAt.getTime() >= now.getTime() - HOSTED_LINQ_RECENT_INBOUND_WINDOW_MS
    ? {
        allowed: true,
        lastInboundAt,
      }
    : {
        allowed: false,
        lastInboundAt,
        reason: "missing_recent_inbound",
      };
}

export async function recordHostedMemberLinqInboundEngagementTx(input: {
  chatId: string | null | undefined;
  memberId: string;
  occurredAt: Date | string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return;
  }
  const chatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  if (chatLookupKeys.length === 0) {
    return;
  }

  await input.prisma.hostedMemberRouting.updateMany({
    where: {
      linqChatLookupKey: { in: chatLookupKeys },
      memberId: input.memberId,
      OR: [
        { linqLastInboundAt: null },
        { linqLastInboundAt: { lt: occurredAt } },
      ],
    },
    data: {
      linqLastInboundAt: occurredAt,
    },
  });

  await input.prisma.hostedMemberRouting.updateMany({
    where: {
      memberId: input.memberId,
      pendingLinqChatLookupKey: { in: chatLookupKeys },
      OR: [
        { pendingLinqLastInboundAt: null },
        { pendingLinqLastInboundAt: { lt: occurredAt } },
      ],
    },
    data: {
      pendingLinqLastInboundAt: occurredAt,
    },
  });
}

export async function recordHostedThreadRouteLinqInboundEngagementTx(input: {
  chatId: string | null | undefined;
  occurredAt: Date | string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return;
  }
  const threadIdentityLookupKeys = createHostedExternalThreadIdentityLookupKeyReadCandidates({
    channel: "linq",
    threadId: input.chatId,
  });
  if (threadIdentityLookupKeys.length === 0) {
    return;
  }

  await input.prisma.hostedThreadRoute.updateMany({
    where: {
      channel: "linq",
      threadIdentityLookupKey: { in: threadIdentityLookupKeys },
      OR: [
        { lastInboundAt: null },
        { lastInboundAt: { lt: occurredAt } },
      ],
    },
    data: {
      lastInboundAt: occurredAt,
    },
  });
}

export async function readHostedLinqSideEffectRecentInboundDecision(input: {
  now?: Date;
  payload: HostedLinqMessagePayload;
  prisma: HostedLinqEngagementClient;
}): Promise<HostedLinqRecentInboundDecision> {
  const now = input.now ?? new Date();
  const routeAuthority = "routeAuthority" in input.payload
    ? input.payload.routeAuthority ?? null
    : null;
  if (routeAuthority) {
    const route = await assertHostedThreadRouteEgressAuthority({
      authority: routeAuthority,
      prisma: input.prisma,
    });
    return decideHostedLinqRecentInbound({
      lastInboundAt: route.lastInboundAt,
      now,
    });
  }

  const memberId = await resolveHostedLinqSideEffectMemberId(input);
  if (!memberId) {
    return decideHostedLinqRecentInbound({ lastInboundAt: null, now });
  }

  return decideHostedLinqRecentInbound({
    lastInboundAt: await readHostedMemberLinqRouteLastInboundAt({
      chatId: input.payload.chatId,
      memberId,
      prisma: input.prisma,
    }),
    now,
  });
}

export async function assertHostedLinqRecentInboundEngagementForRuntime(input: {
  directRecipientPhoneNumber?: string | null;
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  intentId?: string | null;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  routeAuthority?: HostedExecutionExternalThreadRouteAuthority | null;
  target: string | null;
  targetKind?: string | null;
}): Promise<void> {
  const now = input.now ?? new Date();
  if (input.routeAuthority && input.routeAuthority.containerMemberId !== input.memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_BOUND_USER_MISMATCH",
      httpStatus: 403,
      message: "Linq egress engagement authority does not match the runtime user.",
      retryable: false,
    });
  }

  const decision = input.routeAuthority
    ? decideHostedLinqRecentInbound({
        lastInboundAt: (await assertHostedThreadRouteEgressAuthority({
          authority: input.routeAuthority,
          prisma: input.prisma,
        })).lastInboundAt,
        now,
      })
    : decideHostedLinqRecentInbound({
        lastInboundAt: await readHostedMemberLinqRouteLastInboundAt({
          chatId: input.target,
          memberId: input.memberId,
          prisma: input.prisma,
          recipientPhone: input.directRecipientPhoneNumber,
        }),
        now,
      });

  if (decision.allowed) {
    return;
  }

  await markHostedLinqDeliverySkippedTx({
    idempotencyKey: input.idempotencyKey,
    linqChatId: input.targetKind === "participant" ? null : input.target,
    phoneNumber: input.fromPhoneNumber,
    prisma: input.prisma,
    reason: buildHostedLinqRecentInboundSkipReason(decision.lastInboundAt),
    skippedAt: now,
    source: "hosted_runtime_linq_egress_guard",
    sourceRef: input.intentId,
    targetKind: input.targetKind,
  });

  throw hostedOnboardingError({
    code: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
    details: {
      lastInboundAt: decision.lastInboundAt?.toISOString() ?? null,
      policyDays: HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS,
    },
    httpStatus: 403,
    message: `Linq/iMessage delivery requires a recipient reply within the last ${HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS} days.`,
    retryable: false,
  });
}

export function buildHostedLinqRecentInboundSkipReason(lastInboundAt: Date | null): string {
  return lastInboundAt
    ? `last_inbound_at=${lastInboundAt.toISOString()}; window_days=${HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS}`
    : `last_inbound_at=null; window_days=${HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS}`;
}

async function resolveHostedLinqSideEffectMemberId(input: {
  payload: HostedLinqMessagePayload;
  prisma: HostedLinqEngagementClient;
}): Promise<string | null> {
  if ("memberId" in input.payload && input.payload.memberId) {
    return input.payload.memberId;
  }
  if (!("inviteId" in input.payload) || !input.payload.inviteId) {
    return null;
  }
  const invite = await input.prisma.hostedInvite.findUnique({
    where: { id: input.payload.inviteId },
    select: { memberId: true },
  });
  return invite?.memberId ?? null;
}

async function readHostedMemberLinqRouteLastInboundAt(input: {
  chatId: string | null | undefined;
  memberId: string;
  prisma: HostedLinqEngagementClient;
  recipientPhone?: string | null;
}): Promise<Date | null> {
  const chatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  const recipientPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(input.recipientPhone);
  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      linqChatLookupKey: true,
      linqLastInboundAt: true,
      linqRecipientPhoneLookupKey: true,
      pendingLinqChatLookupKey: true,
      pendingLinqLastInboundAt: true,
      pendingLinqRecipientPhoneLookupKey: true,
    },
  });

  if (!routing) {
    return null;
  }

  if (
    routing.linqChatLookupKey
    && chatLookupKeys.includes(routing.linqChatLookupKey)
  ) {
    return routing.linqLastInboundAt;
  }
  if (
    routing.pendingLinqChatLookupKey
    && chatLookupKeys.includes(routing.pendingLinqChatLookupKey)
  ) {
    return routing.pendingLinqLastInboundAt;
  }
  if (
    routing.linqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.linqRecipientPhoneLookupKey)
  ) {
    return routing.linqLastInboundAt;
  }
  if (
    routing.pendingLinqRecipientPhoneLookupKey
    && recipientPhoneLookupKeys.includes(routing.pendingLinqRecipientPhoneLookupKey)
  ) {
    return routing.pendingLinqLastInboundAt;
  }

  return null;
}
