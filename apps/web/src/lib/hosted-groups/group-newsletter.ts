import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionGroupNewsletterEmailNeededWake,
} from "@murphai/hosted-execution";
import { normalizeHostedEmailAddress } from "@murphai/runtime-state";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import {
  readHostedMemberEmailAuthorization,
} from "../hosted-onboarding/hosted-member-store";
import {
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
} from "../hosted-onboarding/hosted-member-routing-store";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";

export interface HostedGroupNewsletterParticipant {
  displayName: string | null;
  hasEmail: boolean;
  memberId: string;
}

export interface HostedGroupNewsletterEmailRecipient {
  address: string;
  memberId: string;
}

export type HostedGroupNewsletterParticipantsResult =
  | {
      groupId: string;
      missingEmailParticipants: HostedGroupNewsletterParticipant[];
      participants: HostedGroupNewsletterParticipant[];
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    };

type ReadClient = PrismaClient;

export async function readHostedGroupNewsletterParticipants(input: {
  groupId: string;
  prisma?: ReadClient;
  runtimeMemberId: string;
}): Promise<HostedGroupNewsletterParticipantsResult> {
  const resolved = await readHostedGroupNewsletterParticipantEmailFacts(input);
  if (resolved.status !== "ok") {
    return resolved;
  }

  const participants = resolved.participants.map((participant) => ({
    displayName: null,
    hasEmail: participant.address !== null,
    memberId: participant.memberId,
  }));
  await enqueueMissingNewsletterEmailWakesBestEffort({
    groupDisplayName: resolved.groupDisplayName,
    groupId: resolved.groupId,
    missingMemberIds: participants
      .filter((participant) => !participant.hasEmail)
      .map((participant) => participant.memberId),
    prisma: input.prisma ?? getPrisma(),
  });

  return {
    groupId: resolved.groupId,
    missingEmailParticipants: participants.filter((participant) => !participant.hasEmail),
    participants,
    status: "ok",
  };
}

export async function readHostedGroupNewsletterEmailRecipients(input: {
  groupId: string;
  prisma?: ReadClient;
  runtimeMemberId: string;
}): Promise<
  | {
      recipients: HostedGroupNewsletterEmailRecipient[];
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    }
> {
  const resolved = await readHostedGroupNewsletterParticipantEmailFacts(input);
  if (resolved.status !== "ok") {
    return resolved;
  }

  const recipients: HostedGroupNewsletterEmailRecipient[] = [];
  const seenAddresses = new Set<string>();
  for (const participant of resolved.participants) {
    if (!participant.address || seenAddresses.has(participant.address)) {
      continue;
    }
    seenAddresses.add(participant.address);
    recipients.push({
      address: participant.address,
      memberId: participant.memberId,
    });
  }

  return { recipients, status: "ok" };
}

async function readHostedGroupNewsletterParticipantEmailFacts(input: {
  groupId: string;
  prisma?: ReadClient;
  runtimeMemberId: string;
}): Promise<
  | {
      groupDisplayName: string | null;
      groupId: string;
      participants: Array<{
        address: string | null;
        memberId: string;
      }>;
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    }
> {
  const prisma = input.prisma ?? getPrisma();
  if (!await hasHostedRuntimeActiveAccess(input.runtimeMemberId, { prisma })) {
    return { status: "unavailable", unavailableReason: "runtime_inactive" };
  }

  const group = await prisma.hostedGroup.findFirst({
    where: {
      id: input.groupId,
      runtimeMemberId: input.runtimeMemberId,
    },
    select: {
      id: true,
      displayName: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: { memberId: true },
      },
    },
  });
  if (!group) {
    return { status: "unavailable", unavailableReason: "group_not_found" };
  }

  const memberIds = group.members.map((member) => member.memberId);
  if (memberIds.length === 0) {
    return {
      groupDisplayName: group.displayName ?? null,
      groupId: group.id,
      participants: [],
      status: "ok",
    };
  }

  const grants = await prisma.hostedVaultShare.findMany({
    where: {
      destinationMemberId: input.runtimeMemberId,
      grantorMemberId: { in: memberIds },
      projectionKind: "group-email.v0",
      status: "granted",
    },
    select: { grantorMemberId: true },
  });
  const grantedMemberIds = new Set(grants.map((grant) => grant.grantorMemberId));
  const participants: Array<{
    address: string | null;
    memberId: string;
  }> = [];
  for (const memberId of memberIds) {
    if (!grantedMemberIds.has(memberId)) {
      continue;
    }
    if (!await readActiveHostedMemberAccess({ memberId, prisma })) {
      continue;
    }

    const authorization = await readHostedMemberEmailAuthorization({
      memberId,
      prisma,
    });
    const address = normalizeHostedEmailAddress(
      authorization?.verifiedEmail?.address ?? null,
    );
    participants.push({ address, memberId });
  }

  return {
    groupDisplayName: group.displayName ?? null,
    groupId: group.id,
    participants,
    status: "ok",
  };
}

async function enqueueMissingNewsletterEmailWakesBestEffort(input: {
  groupDisplayName: string | null;
  groupId: string;
  missingMemberIds: readonly string[];
  prisma: ReadClient;
}): Promise<void> {
  for (const memberId of input.missingMemberIds) {
    const eventId = buildGroupNewsletterEmailNeededEventId({
      groupId: input.groupId,
      memberId,
    });
    try {
      if (!await hasHostedMemberDirectNewsletterNudgeRoute({
        memberId,
        prisma: input.prisma,
      })) {
        continue;
      }

      const appended = await input.prisma.$transaction(async (tx) =>
        appendHostedMailboxEnvelopeTx({
          envelope: buildHostedExecutionGroupNewsletterEmailNeededWake({
            eventId,
            groupDisplayName: input.groupDisplayName,
            groupId: input.groupId,
            memberId,
            occurredAt: new Date().toISOString(),
          }),
          tx,
        })
      );
      if (!appended.inserted) {
        continue;
      }
      try {
        await signalHostedMailboxAppendRuntime({
          expectedUserId: memberId,
          mailboxItemId: appended.item.id,
        });
      } catch {
        // The mailbox item is durable; the destination runtime will observe it later.
      }
    } catch {
      // Missing-email private nudges are best-effort and must not fail read_stats.
    }
  }
}

async function hasHostedMemberDirectNewsletterNudgeRoute(input: {
  memberId: string;
  prisma: ReadClient;
}): Promise<boolean> {
  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  return hasEstablishedDirectNewsletterNudgeRoute(routing);
}

function hasEstablishedDirectNewsletterNudgeRoute(
  routing: HostedMemberRoutingStateSnapshot | null,
): boolean {
  return (
    hasNonEmptyHostedRouteId(routing?.linqChatId)
    || hasNonEmptyHostedRouteId(routing?.telegramThreadId)
  );
}

function hasNonEmptyHostedRouteId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function buildGroupNewsletterEmailNeededEventId(input: {
  groupId: string;
  memberId: string;
}): string {
  return `group-newsletter.email-needed:${input.memberId}:${input.groupId}`;
}
