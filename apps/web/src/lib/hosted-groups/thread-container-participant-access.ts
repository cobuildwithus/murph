import type { Prisma } from "@prisma/client";

const DAY_MS = 86_400_000;

/**
 * Participant-derived access is a bounded lease over the provider roster
 * projection. Owner-derived access remains independent of this lease.
 */
export const HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS = 7 * DAY_MS;

export function hostedThreadContainerParticipantAccessCutoff(now: Date): Date {
  if (Number.isNaN(now.getTime())) {
    throw new TypeError("Hosted thread-container participant access time must be valid.");
  }

  return new Date(now.getTime() - HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS);
}

export function activeHostedThreadContainerParticipantWhere(input: {
  now: Date;
}): Prisma.HostedThreadContainerParticipantWhereInput {
  return {
    lastSeenAt: {
      gte: hostedThreadContainerParticipantAccessCutoff(input.now),
    },
    removedAt: null,
  };
}

/**
 * Provider timestamps are untrusted input. They may prove an observation in
 * the past, but must never mint access into the future.
 */
export function clampHostedThreadContainerParticipantObservedAt(input: {
  now: Date;
  observedAt: Date;
}): Date {
  if (Number.isNaN(input.now.getTime()) || Number.isNaN(input.observedAt.getTime())) {
    throw new TypeError("Hosted thread-container participant observation time must be valid.");
  }

  return input.observedAt.getTime() > input.now.getTime()
    ? input.now
    : input.observedAt;
}

export async function renewHostedThreadContainerParticipantLeaseTx(input: {
  containerMemberId: string;
  now: Date;
  observedAt: Date;
  participantMemberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  const lastSeenAt = clampHostedThreadContainerParticipantObservedAt({
    now: input.now,
    observedAt: input.observedAt,
  });
  const updated = await input.prisma.hostedThreadContainerParticipant.updateMany({
    data: { lastSeenAt },
    where: {
      containerMemberId: input.containerMemberId,
      lastSeenAt: { lt: lastSeenAt },
      participantMemberId: input.participantMemberId,
      // Inbound evidence may renew a roster relationship, never create one or
      // reverse a newer authoritative removal.
      removedAt: null,
    },
  });

  return updated.count > 0;
}
