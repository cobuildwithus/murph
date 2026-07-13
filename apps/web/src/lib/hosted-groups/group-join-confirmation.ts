import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  type HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { hasActiveHostedCryptoDomainRootsForUserTx } from "../hosted-crypto/domain-root-store";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { readHostedMemberRoutingState } from "../hosted-onboarding/hosted-member-routing-store";
import { readHostedLinqHomeLineAuthority } from "../hosted-onboarding/linq-home-routing";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "../hosted-onboarding/messaging-state";
import { buildHostedGroupJoinUrl } from "./group-links";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { getPrisma } from "../prisma";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";

export interface HostedGroupJoinConfirmationSignal {
  mailboxItemId: string;
  memberId: string;
}

export const HOSTED_GROUP_JOIN_CONFIRMATION_PRODUCER_ENABLED_ENV =
  "HOSTED_GROUP_JOIN_CONFIRMATION_PRODUCER_ENABLED";

export type HostedGroupJoinConfirmationAppendResult =
  | {
      kind: "appended";
      signal: HostedGroupJoinConfirmationSignal;
    }
  | {
      kind: "deferred";
      reason: "crypto-roots" | "private-route";
    }
  | {
      kind: "terminal-skip";
    };

export type HostedGroupJoinConfirmationMaterializationResult =
  | { kind: "disabled" | "empty" }
  | { kind: "deferred" }
  | { kind: "terminal-skip" }
  | {
      kind: "appended";
      signal: HostedGroupJoinConfirmationSignal;
    };

export interface HostedGroupJoinConfirmationDrainResult {
  appended: number;
  deferred: number;
  nextCursor: string | null;
  scanned: number;
  terminalSkipped: number;
}

export const HOSTED_GROUP_JOIN_CONFIRMATION_DRAIN_DEFAULT_LIMIT = 10;
export const HOSTED_GROUP_JOIN_CONFIRMATION_DRAIN_MAX_LIMIT = 25;

export function isHostedGroupJoinConfirmationProducerEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return source[HOSTED_GROUP_JOIN_CONFIRMATION_PRODUCER_ENABLED_ENV] === "1";
}

export async function appendHostedGroupJoinConfirmationTx(input: {
  joinCode: string;
  memberId: string;
  membershipId: string;
  occurredAt: Date;
  publicBaseUrl: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinConfirmationAppendResult> {
  const joinUrl = buildHostedGroupJoinUrl({
    joinCode: input.joinCode,
    publicBaseUrl: input.publicBaseUrl,
  });
  if (!joinUrl) {
    return { kind: "terminal-skip" };
  }
  if (!(await hasActiveHostedCryptoDomainRootsForUserTx({
    tx: input.tx,
    userId: input.memberId,
  }))) {
    return { kind: "deferred", reason: "crypto-roots" };
  }

  const route = await resolveHostedGroupJoinConfirmationRouteTx({
    memberId: input.memberId,
    tx: input.tx,
  });
  if (!route) {
    return { kind: "deferred", reason: "private-route" };
  }

  const notificationKey = `group-join:${input.membershipId}`;
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: `assistant.notification.requested:${notificationKey}`,
      memberId: input.memberId,
      notification: {
        deliveryDedupeToken: notificationKey,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: notificationKey,
        instructions: "Private group-join check-in; exact user-facing text is in responsePolicy.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: buildHostedGroupJoinConfirmationText(joinUrl),
        },
        route,
      },
      occurredAt: input.occurredAt.toISOString(),
    }),
    tx: input.tx,
  });

  return {
    kind: "appended",
    signal: {
      mailboxItemId: appended.item.id,
      memberId: appended.item.userId,
    },
  };
}

export async function materializePendingHostedGroupJoinConfirmations(input: {
  memberId: string;
  membershipId?: string;
  prisma?: PrismaClient;
}): Promise<HostedGroupJoinConfirmationMaterializationResult> {
  if (!isHostedGroupJoinConfirmationProducerEnabled()) {
    return { kind: "disabled" };
  }

  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.$transaction((tx) =>
    materializePendingHostedGroupJoinConfirmationsTx({
      memberId: input.memberId,
      ...(input.membershipId ? { membershipId: input.membershipId } : {}),
      tx,
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (result.kind === "appended") {
    try {
      await signalHostedMailboxAppendRuntime({
        expectedUserId: result.signal.memberId,
        mailboxItemId: result.signal.mailboxItemId,
        prisma,
      });
    } catch {
      // The encrypted mailbox item is durable; a later runtime wake imports it.
    }
  }

  return result;
}

export async function materializePendingHostedGroupJoinConfirmationsBestEffort(input: {
  memberId: string;
  membershipId?: string;
  prisma?: PrismaClient;
}): Promise<void> {
  try {
    await materializePendingHostedGroupJoinConfirmations({
      memberId: input.memberId,
      ...(input.membershipId ? { membershipId: input.membershipId } : {}),
      ...(input.prisma ? { prisma: input.prisma } : {}),
    });
  } catch (error) {
    console.warn("Hosted group join confirmation reconciliation failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

export async function drainPendingHostedGroupJoinConfirmations(input: {
  cursor?: string | null;
  limit?: number;
  prisma?: PrismaClient;
} = {}): Promise<HostedGroupJoinConfirmationDrainResult> {
  if (!isHostedGroupJoinConfirmationProducerEnabled()) {
    return {
      appended: 0,
      deferred: 0,
      nextCursor: null,
      scanned: 0,
      terminalSkipped: 0,
    };
  }

  const prisma = input.prisma ?? getPrisma();
  const limit = normalizeDrainLimit(input.limit);
  const cursor = input.cursor?.trim() || null;
  const candidates = await prisma.hostedGroupMember.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      memberId: true,
    },
    take: limit + 1,
    where: {
      joinConfirmationEligibleAt: { not: null },
      role: "member",
    },
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
  });
  const page = candidates.slice(0, limit);
  let appended = 0;
  let deferred = 0;
  let terminalSkipped = 0;

  for (const candidate of page) {
    const result = await materializePendingHostedGroupJoinConfirmations({
      memberId: candidate.memberId,
      membershipId: candidate.id,
      prisma,
    });
    if (result.kind === "appended") {
      appended += 1;
    } else if (result.kind === "deferred") {
      deferred += 1;
    } else if (result.kind === "terminal-skip") {
      terminalSkipped += 1;
    }
  }

  return {
    appended,
    deferred,
    nextCursor: candidates.length > limit ? page.at(-1)?.id ?? null : null,
    scanned: page.length,
    terminalSkipped,
  };
}

export async function materializePendingHostedGroupJoinConfirmationsTx(input: {
  memberId: string;
  membershipId?: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinConfirmationMaterializationResult> {
  const publicBaseUrl = resolveHostedPublicBaseUrl();

  const membership = await input.tx.hostedGroupMember.findFirst({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      createdAt: true,
      id: true,
      joinedAt: true,
      group: {
        select: { joinCode: true },
      },
    },
    where: {
      joinConfirmationEligibleAt: { not: null },
      memberId: input.memberId,
      role: "member",
      ...(input.membershipId ? { id: input.membershipId } : {}),
    },
  });

  if (!membership) {
    return { kind: "empty" };
  }

  const result = membership.group.joinCode
    ? await appendHostedGroupJoinConfirmationTx({
        joinCode: membership.group.joinCode,
        memberId: input.memberId,
        membershipId: membership.id,
        occurredAt: membership.joinedAt ?? membership.createdAt,
        publicBaseUrl,
        tx: input.tx,
      })
    : { kind: "terminal-skip" as const };
  if (result.kind === "deferred") {
    return { kind: "deferred" };
  }

  await input.tx.hostedGroupMember.update({
    data: { joinConfirmationEligibleAt: null },
    where: { id: membership.id },
  });

  return result;
}

async function resolveHostedGroupJoinConfirmationRouteTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedExecutionAssistantNotificationRoute | null> {
  const [identity, routing] = await Promise.all([
    readHostedMemberIdentity({
      memberId: input.memberId,
      prisma: input.tx,
    }),
    readHostedMemberRoutingState({
      memberId: input.memberId,
      prisma: input.tx,
    }),
  ]);
  const linqAuthority = readHostedLinqHomeLineAuthority(routing);
  const linqContactLookupKey = (
    linqAuthority.kind === "home" || linqAuthority.kind === "pending"
  )
    ? linqAuthority.participantContact?.lookupKey ?? null
    : null;
  const linqRoute = (
    linqAuthority.kind === "home" || linqAuthority.kind === "pending"
  ) && linqContactLookupKey
    ? {
        chatId: linqAuthority.chatId,
        contactLookupKey: linqContactLookupKey,
      }
    : null;

  return resolveHostedMemberAssistantNotificationRoute({
    linqChatId: linqRoute?.chatId ?? null,
    linqContactLookupKey: linqRoute?.contactLookupKey ?? null,
    // Group-join confirmations may continue an existing private thread, but
    // must never use the participant-target first-contact delivery path.
    linqRecipientPhone: null,
    memberId: input.memberId,
    memberPhoneNumber: identity?.phoneNumber ?? null,
    messaging: resolveHostedMemberMessagingState({
      identity: {
        phoneLookupKey: identity?.phoneLookupKey ?? null,
      },
      routing: {
        linqChatId: routing?.linqChatId ?? null,
        pendingLinqChatId: routing?.pendingLinqChatId ?? null,
        pendingLinqParticipantContact: routing?.pendingLinqParticipantContact ?? null,
        telegramThreadId: routing?.telegramThreadId ?? null,
        telegramUserId: routing?.telegramUserId ?? null,
      },
    }),
  });
}

function buildHostedGroupJoinConfirmationText(joinUrl: string): string {
  return [
    "Hey — you just joined a Murph group. Did you mean to? Reply yes or no.",
    `You can review or change what you share here: ${joinUrl}`,
  ].join("\n\n");
}

function normalizeDrainLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return HOSTED_GROUP_JOIN_CONFIRMATION_DRAIN_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(HOSTED_GROUP_JOIN_CONFIRMATION_DRAIN_MAX_LIMIT, Math.floor(value)));
}
