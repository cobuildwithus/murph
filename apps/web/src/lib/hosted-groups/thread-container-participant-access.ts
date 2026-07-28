import type { Prisma } from "@prisma/client";

const DAY_MS = 86_400_000;

/**
 * Participant-derived runtime authority is a bounded lease over observed
 * provider membership. Owner-derived authority remains independent.
 */
export const HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS = 7 * DAY_MS;

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

export function hostedThreadContainerParticipantAccessCutoff(now: Date): Date {
  assertValidDate(now);
  return new Date(now.getTime() - HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS);
}

/**
 * A provider timestamp may prove a past observation, but may not mint future
 * authority. Delayed events also cannot move the observation backwards.
 */
export async function renewHostedThreadContainerParticipantAccessTx(input: {
  containerMemberId: string;
  now: Date;
  observedAt: Date;
  participantMemberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  assertValidDate(input.now);
  assertValidDate(input.observedAt);
  const lastSeenAt = clampHostedThreadContainerParticipantObservation(input);
  const updated = await input.prisma.hostedThreadContainerParticipant.updateMany({
    data: { lastSeenAt },
    where: {
      containerMemberId: input.containerMemberId,
      lastSeenAt: { lt: lastSeenAt },
      participantMemberId: input.participantMemberId,
      removedAt: null,
    },
  });

  return updated.count > 0;
}

/**
 * Records an authenticated provider observation without transferring container
 * ownership. The participant identity is part of the compound key, so one
 * sender can only create or renew their own lease.
 */
export async function observeHostedThreadContainerParticipantAccessTx(input: {
  containerMemberId: string;
  handleLookupKey: string;
  now: Date;
  observedAt: Date;
  participantMemberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  assertValidDate(input.now);
  assertValidDate(input.observedAt);
  const lastSeenAt = clampHostedThreadContainerParticipantObservation({
    now: input.now,
    observedAt: input.observedAt,
  });
  await input.prisma.hostedThreadContainerParticipant.upsert({
    create: {
      containerMemberId: input.containerMemberId,
      firstSeenAt: lastSeenAt,
      handleLookupKey: input.handleLookupKey,
      lastSeenAt,
      participantMemberId: input.participantMemberId,
      removedAt: null,
    },
    update: {
      handleLookupKey: input.handleLookupKey,
    },
    where: {
      containerMemberId_participantMemberId: {
        containerMemberId: input.containerMemberId,
        participantMemberId: input.participantMemberId,
      },
    },
  });
  await input.prisma.hostedThreadContainerParticipant.updateMany({
    data: {
      lastSeenAt,
      removedAt: null,
    },
    where: {
      containerMemberId: input.containerMemberId,
      participantMemberId: input.participantMemberId,
      removedAt: { lt: lastSeenAt },
    },
  });
  await renewHostedThreadContainerParticipantAccessTx(input);
}

function clampHostedThreadContainerParticipantObservation(input: {
  now: Date;
  observedAt: Date;
}): Date {
  return input.observedAt.getTime() > input.now.getTime()
    ? input.now
    : input.observedAt;
}

function assertValidDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError("Hosted thread-container participant observation time must be valid.");
  }
}
