import "server-only";

import type { PrismaClient } from "@prisma/client";
import { HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX } from "@murphai/hosted-execution/runtime-control";

import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import {
  lookupHostedMemberIdentityByPhoneNumber,
} from "../hosted-onboarding/hosted-member-identity-store";
import {
  lookupHostedMemberByVerifiedEmailAddress,
} from "../hosted-onboarding/hosted-member-store";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import {
  getHostedLinqChatHandles,
  type HostedLinqChatHandleSummary,
} from "../hosted-onboarding/linq-client";
import {
  createHostedLinqParticipantContactLookupKey,
} from "../hosted-onboarding/linq-participant-contact";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  type HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";

type HostedLinqThreadRosterResolvedParticipant = {
  handle: string;
  participantMemberId: string;
};

export type HostedLinqThreadRosterSnapshot = {
  handles: readonly HostedLinqChatHandleSummary[];
  observationOrdinal: bigint;
  observedAt: Date;
};

type HostedLinqThreadRosterUnavailableReason =
  | "empty_roster"
  | "roster_exceeds_cap"
  | "route_mismatch";

export function selectHostedLinqThreadRosterHandles(
  handles: readonly HostedLinqChatHandleSummary[],
): {
  handles: HostedLinqChatHandleSummary[];
  reason: HostedLinqThreadRosterUnavailableReason | null;
} {
  if (handles.length === 0) {
    return { handles: [], reason: "empty_roster" };
  }

  const currentHandles = handles.filter(isCurrentHostedLinqParticipantHandle);
  return {
    handles: currentHandles.slice(0, HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX),
    reason: currentHandles.length > HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX
      ? "roster_exceeds_cap"
      : null,
  };
}

export async function resolveHostedLinqThreadRosterParticipants(input: {
  handles: readonly HostedLinqChatHandleSummary[];
  prisma: HostedOnboardingReadClient;
}): Promise<HostedLinqThreadRosterResolvedParticipant[]> {
  const resolvedParticipants: HostedLinqThreadRosterResolvedParticipant[] = [];
  for (const handle of input.handles) {
    const lookup = await lookupHostedLinqThreadRosterParticipant({
      handle: handle.handle,
      prisma: input.prisma,
    });
    if (lookup?.core.id) {
      resolvedParticipants.push({
        handle: handle.handle,
        participantMemberId: lookup.core.id,
      });
    }
  }
  return resolvedParticipants;
}

/**
 * Applies a complete provider snapshot to the cache-only participant
 * projection. The database-owned ordinal serializes overlapping snapshots
 * before any projection writes. Only the winning snapshot may decide access;
 * a superseded observation fails retryably so its caller can read again.
 */
export async function applyHostedLinqThreadRosterSnapshotStrict(input: {
  chatId: string;
  containerMemberId: string;
  handles: readonly HostedLinqChatHandleSummary[];
  observationOrdinal: bigint;
  observedAt: Date;
  prisma: HostedOnboardingReadClient;
}): Promise<{ hasActiveParticipantAccess: boolean }> {
  try {
    const selection = selectHostedLinqThreadRosterHandles(input.handles);
    if (selection.reason) {
      throw buildHostedLinqThreadRosterUnavailableError(undefined, selection.reason);
    }

    const applySnapshot = (prisma: HostedOnboardingReadClient) =>
      applyHostedLinqThreadRosterSnapshotTx({
        chatId: input.chatId,
        containerMemberId: input.containerMemberId,
        handles: selection.handles,
        observationOrdinal: input.observationOrdinal,
        observedAt: input.observedAt,
        prisma,
      });
    if (
      "$transaction" in input.prisma
      && typeof input.prisma.$transaction === "function"
    ) {
      return await input.prisma.$transaction(
        (transaction) => applySnapshot(transaction),
        HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
      );
    }
    return await applySnapshot(input.prisma);
  } catch (cause) {
    if (
      isHostedOnboardingError(cause)
      && cause.code === "LINQ_GROUP_ROSTER_UNAVAILABLE"
    ) {
      throw cause;
    }
    throw buildHostedLinqThreadRosterUnavailableError(cause);
  }
}

async function applyHostedLinqThreadRosterSnapshotTx(input: {
  chatId: string;
  containerMemberId: string;
  handles: readonly HostedLinqChatHandleSummary[];
  observationOrdinal: bigint;
  observedAt: Date;
  prisma: HostedOnboardingReadClient;
}): Promise<{ hasActiveParticipantAccess: boolean }> {
  const resolvedParticipants = await resolveHostedLinqThreadRosterParticipants({
    handles: input.handles,
    prisma: input.prisma,
  });
  const seenByMemberId = new Map<string, {
    handleLookupKey: string;
    participantMemberId: string;
  }>();

  for (const participant of resolvedParticipants) {
    const handleLookupKey = createHostedThreadContainerParticipantHandleLookupKey(
      participant.handle,
    );
    if (!handleLookupKey || seenByMemberId.has(participant.participantMemberId)) {
      continue;
    }
    seenByMemberId.set(participant.participantMemberId, {
      handleLookupKey,
      participantMemberId: participant.participantMemberId,
    });
  }

  const seenParticipants = [...seenByMemberId.values()];
  let hasActiveParticipantAccess = false;
  for (const participant of seenParticipants) {
    if (await readActiveHostedMemberAccess({
      memberId: participant.participantMemberId,
      prisma: input.prisma,
    })) {
      hasActiveParticipantAccess = true;
      break;
    }
  }

  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: "linq",
      threadId: input.chatId,
    });
  if (threadIdentityLookupKeys.length === 0) {
    throw buildHostedLinqThreadRosterUnavailableError(undefined, "route_mismatch");
  }

  const matchingRoutes = await input.prisma.hostedThreadRoute.findMany({
    select: {
      containerMemberId: true,
      threadIdentityLookupKey: true,
    },
    where: {
      channel: "linq",
      threadIdentityLookupKey: { in: threadIdentityLookupKeys },
    },
  });
  const matchingRoute = matchingRoutes.length === 1 ? matchingRoutes[0] : null;
  if (!matchingRoute || matchingRoute.containerMemberId !== input.containerMemberId) {
    throw buildHostedLinqThreadRosterUnavailableError(undefined, "route_mismatch");
  }

  const claimedRoute = await input.prisma.hostedThreadRoute.updateMany({
    data: { participantRosterAppliedOrdinal: input.observationOrdinal },
    where: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      OR: [
        { participantRosterAppliedOrdinal: null },
        { participantRosterAppliedOrdinal: { lt: input.observationOrdinal } },
      ],
      threadIdentityLookupKey: matchingRoute.threadIdentityLookupKey,
    },
  });
  if (claimedRoute.count !== 1) {
    throw buildHostedLinqThreadRosterUnavailableError();
  }
  await writeHostedLinqThreadRosterProjection({
    containerMemberId: input.containerMemberId,
    observedAt: input.observedAt,
    prisma: input.prisma,
    seenParticipants,
  });

  return { hasActiveParticipantAccess };
}

async function writeHostedLinqThreadRosterProjection(input: {
  containerMemberId: string;
  observedAt: Date;
  prisma: HostedOnboardingReadClient;
  seenParticipants: readonly {
    handleLookupKey: string;
    participantMemberId: string;
  }[];
}): Promise<void> {
  if (input.seenParticipants.length > 0) {
    await input.prisma.hostedThreadContainerParticipant.createMany({
      data: input.seenParticipants.map((participant) => ({
        containerMemberId: input.containerMemberId,
        firstSeenAt: input.observedAt,
        handleLookupKey: participant.handleLookupKey,
        lastSeenAt: input.observedAt,
        participantMemberId: participant.participantMemberId,
        removedAt: null,
      })),
      skipDuplicates: true,
    });
  }

  for (const participant of input.seenParticipants) {
    await input.prisma.hostedThreadContainerParticipant.updateMany({
      data: {
        handleLookupKey: participant.handleLookupKey,
        lastSeenAt: input.observedAt,
        removedAt: null,
      },
      where: {
        containerMemberId: input.containerMemberId,
        participantMemberId: participant.participantMemberId,
      },
    });
  }

  const seenParticipantMemberIds = input.seenParticipants.map(
    (participant) => participant.participantMemberId,
  );
  await input.prisma.hostedThreadContainerParticipant.updateMany({
    data: { removedAt: input.observedAt },
    where: {
      containerMemberId: input.containerMemberId,
      removedAt: null,
      ...(seenParticipantMemberIds.length > 0
        ? { participantMemberId: { notIn: seenParticipantMemberIds } }
        : {}),
    },
  });
}

export async function readHostedLinqThreadRosterStrict(input: {
  chatId: string;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedLinqThreadRosterSnapshot> {
  let observationOrdinal: bigint;
  let observedAt: Date;
  let handles: Awaited<ReturnType<typeof getHostedLinqChatHandles>>;
  try {
    observationOrdinal = await allocateHostedLinqThreadRosterObservationOrdinal({
      prisma: input.prisma,
    });
    observedAt = new Date();
    handles = await getHostedLinqChatHandles({
      chatId: input.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (cause) {
    throw buildHostedLinqThreadRosterUnavailableError(cause);
  }

  return { handles, observationOrdinal, observedAt };
}

async function allocateHostedLinqThreadRosterObservationOrdinal(input: {
  prisma: PrismaClient;
}): Promise<bigint> {
  // The route column's autoincrement default lets `prisma db push` own this
  // sequence too. Route creation consumes a lower value, but only a later
  // nextval result can reach this allocator and claim that route.
  const rows = await input.prisma.$queryRaw<Array<{ ordinal: bigint }>>`
    SELECT nextval('hosted_thread_route_participant_roster_applied_ordinal_seq') AS ordinal
  `;
  if (rows.length !== 1 || typeof rows[0]?.ordinal !== "bigint") {
    throw new Error("Hosted Linq roster observation ordinal allocation failed.");
  }
  return rows[0].ordinal;
}

function isCurrentHostedLinqParticipantHandle(handle: HostedLinqChatHandleSummary): boolean {
  return !handle.isMe
    && (!handle.status || handle.status.trim().toLowerCase() === "active");
}

async function lookupHostedLinqThreadRosterParticipant(input: {
  handle: string;
  prisma: HostedOnboardingReadClient;
}) {
  if (input.handle.includes("@")) {
    return await lookupHostedMemberByVerifiedEmailAddress({
      address: input.handle,
      prisma: input.prisma,
    });
  }
  const phoneNumber = normalizePhoneNumber(input.handle);
  if (!phoneNumber) {
    return null;
  }
  return await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber,
    prisma: input.prisma,
  });
}

function createHostedThreadContainerParticipantHandleLookupKey(handle: string): string | null {
  if (handle.includes("@")) {
    return createHostedLinqParticipantContactLookupKey({
      kind: "email",
      value: handle,
    });
  }

  const phoneNumber = normalizePhoneNumber(handle);
  return phoneNumber
    ? createHostedLinqParticipantContactLookupKey({
        kind: "phone",
        value: phoneNumber,
      })
    : null;
}

function buildHostedLinqThreadRosterUnavailableError(
  cause?: unknown,
  reason?: HostedLinqThreadRosterUnavailableReason,
) {
  return hostedOnboardingError({
    code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
    httpStatus: 503,
    message: "Hosted Linq group roster is unavailable. Retry later.",
    cause,
    details: reason ? { reason } : undefined,
    retryable: true,
  });
}
