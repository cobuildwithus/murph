import "server-only";
import { HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX } from "@murphai/hosted-execution/runtime-control";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  getHostedLinqChatSummary,
  type HostedLinqChatRosterObservation,
  type HostedLinqChatHandleSummary,
} from "../hosted-onboarding/linq-client";
import { createHostedLinqParticipantContactLookupKey } from "../hosted-onboarding/linq-participant-contact";
import {
  deriveHostedOnboardingTimingErrorName,
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "../hosted-onboarding/logging";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { HOSTED_GROWTH_GROUP_PRIVATE_ATTRIBUTION_LOOKBACK_MS } from "./group-private-attribution-policy";
import { lookupHostedGroupParticipantMemberIdsByHandles } from "./participant-member";
import { lockHostedThreadContainerParticipantObservationTx } from "./thread-container-participant-access";

export const HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX =
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX;

export type HostedThreadContainerResolvedParticipant = {
  handle: string;
  participantMemberId: string;
};

export async function reconcileHostedThreadContainerParticipants(input: {
  chatId: string;
  containerMemberId: string;
  observation?: HostedLinqChatRosterObservation;
  prisma: PrismaClient;
  resolvedParticipants?: readonly HostedThreadContainerResolvedParticipant[];
}): Promise<void> {
  try {
    const observation = input.observation ?? await getHostedLinqChatSummary({ chatId: input.chatId });
    const { handles, observedAt } = observation;
    if (handles.length === 0) {
      logHostedThreadContainerParticipantReconcileSkipped({
        chatId: input.chatId,
        containerMemberId: input.containerMemberId,
        reason: "empty_roster",
      });
      return;
    }

    const hasCompleteRoster =
      observation.handlesComplete === true
      && observation.handleCount <= HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX;
    const participantHandles = selectHostedThreadContainerParticipantHandles({
      chatId: input.chatId,
      containerMemberId: input.containerMemberId,
      handles,
    });
    const boundedHandleValues = new Set(participantHandles.map((handle) => handle.handle));
    const resolvedParticipants = (input.resolvedParticipants
      ?? await resolveHostedThreadContainerParticipants({
        handles: participantHandles,
        prisma: input.prisma,
      })).filter((participant) => boundedHandleValues.has(participant.handle));
    const observationExpiresAt = new Date(
      observedAt.getTime() + HOSTED_GROWTH_GROUP_PRIVATE_ATTRIBUTION_LOOKBACK_MS,
    );
    const observationLookupKeys = [...new Set(participantHandles.flatMap((handle) => {
      const lookupKey = createHostedThreadContainerParticipantHandleLookupKey(
        handle.handle,
      );
      return lookupKey ? [lookupKey] : [];
    }))];
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
    const inputObservationRows = observationLookupKeys.length === 0
      ? Prisma.sql`
          SELECT NULL::text
          WHERE FALSE
        `
      : Prisma.sql`
          VALUES ${Prisma.join(observationLookupKeys.map((lookupKey) => Prisma.sql`
            (${lookupKey}::text)
          `))}
        `;
    const inputParticipantRows = seenParticipants.length === 0
      ? Prisma.sql`
          SELECT NULL::text, NULL::text
          WHERE FALSE
        `
      : Prisma.sql`
          VALUES ${Prisma.join(seenParticipants.map((participant) => Prisma.sql`
            (${participant.participantMemberId}::text, ${participant.handleLookupKey}::text)
          `))}
        `;

    await input.prisma.$transaction(async (tx) => {
      const acceptsPositive = await lockHostedThreadContainerParticipantObservationTx({
        containerMemberId: input.containerMemberId,
        observedAt,
        prisma: tx,
      });
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO hosted_group_participant_observation (
          contact_lookup_key, first_observed_at, expires_at
        )
        SELECT input_observation.contact_lookup_key, ${observedAt}, ${observationExpiresAt}
        FROM (${inputObservationRows}) AS input_observation(contact_lookup_key)
        ORDER BY input_observation.contact_lookup_key
        ON CONFLICT (contact_lookup_key)
        DO UPDATE SET
          first_observed_at = CASE
            WHEN hosted_group_participant_observation.expires_at <= EXCLUDED.first_observed_at
              THEN EXCLUDED.first_observed_at
            ELSE LEAST(
              hosted_group_participant_observation.first_observed_at,
              EXCLUDED.first_observed_at
            )
          END,
          expires_at = GREATEST(
            hosted_group_participant_observation.expires_at,
            EXCLUDED.expires_at
          )
      `);
      if (acceptsPositive) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO hosted_thread_container_participant (
            container_member_id, participant_member_id, handle_lookup_key,
            first_seen_at, last_seen_at, removed_at, created_at, updated_at
          )
          SELECT ${input.containerMemberId}, input_participant.participant_member_id,
            input_participant.handle_lookup_key, ${observedAt}, ${observedAt}, NULL,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM (${inputParticipantRows}) AS input_participant(participant_member_id, handle_lookup_key)
          ON CONFLICT (container_member_id, participant_member_id)
          DO UPDATE SET
            handle_lookup_key = EXCLUDED.handle_lookup_key,
            last_seen_at = EXCLUDED.last_seen_at,
            removed_at = NULL,
            updated_at = EXCLUDED.updated_at
          WHERE hosted_thread_container_participant.last_seen_at < EXCLUDED.last_seen_at
            AND (hosted_thread_container_participant.removed_at IS NULL
              OR hosted_thread_container_participant.removed_at < EXCLUDED.last_seen_at)
        `);
      }
      if (hasCompleteRoster) {
        await tx.hostedThreadContainerParticipant.updateMany({
          where: {
            containerMemberId: input.containerMemberId,
            removedAt: null,
            lastSeenAt: { lte: observedAt },
            participantMemberId: { notIn: seenParticipants.map(participant => participant.participantMemberId) },
          },
          data: { removedAt: observedAt },
        });
        if (acceptsPositive) {
          await tx.hostedThreadContainer.update({
            where: { memberId: input.containerMemberId },
            data: { completeRosterObservedAt: observedAt },
          });
        }
      }
    });

    if (!hasCompleteRoster) {
      logHostedThreadContainerParticipantReconcileSkipped({
        chatId: input.chatId,
        containerMemberId: input.containerMemberId,
        reason: observation.handleCount > HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX
          ? "roster_exceeds_cap" : "roster_incomplete",
      });
    }
  } catch (error) {
    logHostedThreadContainerParticipantReconcileSkipped({
      chatId: input.chatId,
      containerMemberId: input.containerMemberId,
      errorName: deriveHostedOnboardingTimingErrorName(error),
      reason: "reconcile_failed",
    });
  }
}

async function resolveHostedThreadContainerParticipants(input: {
  handles: readonly HostedLinqChatHandleSummary[];
  prisma: HostedOnboardingReadClient;
}): Promise<HostedThreadContainerResolvedParticipant[]> {
  const currentHandles = input.handles.filter(isCurrentHostedLinqParticipantHandle);
  const memberIdsByHandle = await lookupHostedGroupParticipantMemberIdsByHandles({
    handles: currentHandles.map((handle) => handle.handle),
    prisma: input.prisma,
  });

  return currentHandles.flatMap((handle) => {
    const participantMemberId = memberIdsByHandle.get(handle.handle) ?? null;
    return participantMemberId
      ? [{ handle: handle.handle, participantMemberId }]
      : [];
  });
}

function isActiveHostedLinqChatHandle(handle: HostedLinqChatHandleSummary): boolean {
  return !handle.status || handle.status.trim().toLowerCase() === "active";
}

function isCurrentHostedLinqParticipantHandle(handle: HostedLinqChatHandleSummary): boolean {
  return !handle.isMe && isActiveHostedLinqChatHandle(handle);
}

export function selectHostedThreadContainerParticipantHandles(input: {
  chatId: string;
  containerMemberId: string;
  handles: readonly HostedLinqChatHandleSummary[];
}): HostedLinqChatHandleSummary[] {
  const currentHandles = input.handles.filter(isCurrentHostedLinqParticipantHandle);
  if (currentHandles.length > HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX) {
    logHostedThreadContainerParticipantReconcileCapped({
      cap: HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
      chatId: input.chatId,
      containerMemberId: input.containerMemberId,
      rosterSize: currentHandles.length,
    });
  }

  return currentHandles.slice(0, HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX);
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

function logHostedThreadContainerParticipantReconcileSkipped(input: {
  chatId: string;
  containerMemberId: string;
  errorName?: string;
  reason: string;
}): void {
  console.warn("Hosted thread-container participant reconcile skipped.", {
    ...sanitizeHostedOnboardingStructuredLogDetails({
      chatIdSuffix: toHostedOnboardingLogIdSuffix(input.chatId),
      containerMemberIdSuffix: toHostedOnboardingLogIdSuffix(input.containerMemberId),
      errorName: input.errorName,
      reason: input.reason,
    }),
  });
}

function logHostedThreadContainerParticipantReconcileCapped(input: {
  cap: number;
  chatId: string;
  containerMemberId: string;
  rosterSize: number;
}): void {
  console.warn("Hosted thread-container participant reconcile capped.", {
    ...sanitizeHostedOnboardingStructuredLogDetails({
      cap: input.cap,
      chatIdSuffix: toHostedOnboardingLogIdSuffix(input.chatId),
      containerMemberIdSuffix: toHostedOnboardingLogIdSuffix(input.containerMemberId),
      reason: "roster_exceeds_cap",
      rosterSize: input.rosterSize,
    }),
  });
}
