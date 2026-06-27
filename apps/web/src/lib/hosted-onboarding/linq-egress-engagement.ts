import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";

import {
  createHostedExternalThreadLookupKeyReadCandidates,
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
const HOSTED_LINQ_FUTURE_INBOUND_SKEW_MS = 5 * 60 * 1000;

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
  if (lastInboundAt.getTime() > now.getTime() + HOSTED_LINQ_FUTURE_INBOUND_SKEW_MS) {
    return {
      allowed: false,
      lastInboundAt,
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
  linePhoneNumber?: string | null;
  now?: Date;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const occurredAt = normalizeHostedLinqInboundEngagementAt({
    now: input.now,
    occurredAt: input.occurredAt,
  });
  if (!occurredAt) {
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
  linePhoneNumberLookupKey: string | null;
  memberId: string;
  now?: Date;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const occurredAt = normalizeHostedLinqInboundEngagementAt({
    now: input.now,
    occurredAt: input.occurredAt,
  });
  if (!occurredAt) {
    return;
  }
  const threadLookupKeys = createHostedExternalThreadLookupKeyReadCandidates({
    accountLookupKey: input.linePhoneNumberLookupKey,
    channel: "linq",
    threadId: input.chatId,
  });
  if (threadLookupKeys.length === 0) {
    return;
  }

  await input.prisma.hostedThreadRoute.updateMany({
    where: {
      channel: "linq",
      containerMemberId: input.memberId,
      threadLookupKey: { in: threadLookupKeys },
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
  route?: { lastInboundAt: Date | null } | null;
}): Promise<HostedLinqRecentInboundDecision> {
  const now = input.now ?? new Date();
  const memberId = await resolveHostedLinqSideEffectMemberId(input);
  const routeAuthority = "routeAuthority" in input.payload
    ? input.payload.routeAuthority ?? null
    : null;
  if (routeAuthority) {
    const validatedRouteAuthority = assertHostedLinqRouteAuthorityMatchesTarget({
      chatId: input.payload.chatId,
      memberId,
      routeAuthority,
    });
    const route = input.route ?? await assertHostedThreadRouteEgressAuthority({
      authority: validatedRouteAuthority,
      prisma: input.prisma,
    });
    return decideHostedLinqRecentInbound({
      lastInboundAt: route.lastInboundAt,
      now,
    });
  }

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

export function assertHostedLinqRouteAuthorityMatchesTarget(input: {
  chatId: string | null | undefined;
  memberId?: string | null;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
}): HostedExecutionLinqExternalThreadRouteAuthority {
  const authority = input.routeAuthority;
  const chatId = normalizeNullable(input.chatId);
  const memberId = normalizeNullable(input.memberId);

  if (
    authority.channel !== "linq"
    || !chatId
    || authority.threadId !== chatId
    || (memberId !== null && authority.containerMemberId !== memberId)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority does not match the requested thread.",
      retryable: false,
    });
  }

  return {
    ...authority,
    channel: "linq",
  };
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
  const routeAuthority = normalizeHostedLinqRouteAuthorityForEgress({
    memberId: input.memberId,
    routeAuthority: input.routeAuthority ?? null,
    target: input.target,
    targetKind: input.targetKind,
  });
  if (routeAuthority && routeAuthority.containerMemberId !== input.memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_BOUND_USER_MISMATCH",
      httpStatus: 403,
      message: "Linq egress engagement authority does not match the runtime user.",
      retryable: false,
    });
  }

  const route = routeAuthority
    ? await assertHostedThreadRouteEgressAuthority({
        authority: routeAuthority,
        prisma: input.prisma,
      })
    : null;
  const fallbackChatId = input.targetKind === "participant" ? null : input.target;
  const fallbackRecipientPhone = input.targetKind === "participant"
    ? input.directRecipientPhoneNumber ?? input.target
    : null;
  const decision = route
    ? decideHostedLinqRecentInbound({
      lastInboundAt: route.lastInboundAt,
      now,
    })
    : decideHostedLinqRecentInbound({
      lastInboundAt: await readHostedMemberLinqRouteLastInboundAt({
        chatId: fallbackChatId,
        memberId: input.memberId,
        prisma: input.prisma,
        recipientPhone: fallbackRecipientPhone,
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
      reason: decision.reason,
    },
    httpStatus: 403,
    message: `Linq/iMessage delivery requires a recipient reply within the last ${HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS} days.`,
    retryable: false,
  });
}

function normalizeHostedLinqRouteAuthorityForEgress(input: {
  memberId: string;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority | null;
  target: string | null;
  targetKind?: string | null;
}): HostedExecutionLinqExternalThreadRouteAuthority | null {
  const authority = input.routeAuthority;
  if (!authority) {
    return null;
  }
  const targetKind = normalizeNullable(input.targetKind);
  const target = normalizeNullable(input.target);
  if (authority.channel !== "linq") {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority must be for a Linq thread.",
      retryable: false,
    });
  }
  const linqAuthority: HostedExecutionLinqExternalThreadRouteAuthority = {
    ...authority,
    channel: "linq",
  };
  if (linqAuthority.containerMemberId !== input.memberId) {
    return linqAuthority;
  }
  if (targetKind !== "thread" && targetKind !== "explicit") {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority can only authorize thread delivery.",
      retryable: false,
    });
  }
  if (!target || target !== linqAuthority.threadId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority does not match the requested thread.",
      retryable: false,
    });
  }

  return linqAuthority;
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function buildHostedLinqRecentInboundSkipReason(lastInboundAt: Date | null): string {
  return lastInboundAt
    ? `last_inbound_at=${lastInboundAt.toISOString()}; window_days=${HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS}`
    : `last_inbound_at=null; window_days=${HOSTED_LINQ_RECENT_INBOUND_WINDOW_DAYS}`;
}

function normalizeHostedLinqInboundEngagementAt(input: {
  now?: Date;
  occurredAt: Date | string;
}): Date | null {
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return null;
  }
  const now = input.now ?? new Date();
  return occurredAt.getTime() > now.getTime() + HOSTED_LINQ_FUTURE_INBOUND_SKEW_MS
    ? now
    : occurredAt;
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
