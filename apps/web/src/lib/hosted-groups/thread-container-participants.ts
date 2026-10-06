import "server-only";
import { HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX } from "@murphai/hosted-execution/runtime-control";
import { Prisma } from "@prisma/client";

import {
  getHostedLinqChatHandles,
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

export const HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX =
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX;

export type HostedThreadContainerResolvedParticipant = {
  handle: string;
  participantMemberId: string;
};

export async function reconcileHostedThreadContainerParticipants(input: {
  chatId: string;
  containerMemberId: string;
  handles?: readonly HostedLinqChatHandleSummary[];
  prisma: HostedOnboardingReadClient;
  resolvedParticipants?: readonly HostedThreadContainerResolvedParticipant[];
}): Promise<void> {
  try {
    const handles = input.handles ?? await getHostedLinqChatHandles({ chatId: input.chatId });
    if (handles.length === 0) {
      logHostedThreadContainerParticipantReconcileSkipped({
        chatId: input.chatId,
        containerMemberId: input.containerMemberId,
        reason: "empty_roster",
      });
      return;
    }

    const hasCompleteRoster =
      handles.length <= HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX;
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
    const now = new Date();
    const observationExpiresAt = new Date(
      now.getTime() + HOSTED_GROWTH_GROUP_PRIVATE_ATTRIBUTION_LOOKBACK_MS,
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

    await input.prisma.$executeRaw(Prisma.sql`
      WITH input_observation(contact_lookup_key) AS (
        ${inputObservationRows}
      ),
      upserted_observation AS (
        INSERT INTO hosted_group_participant_observation (
          contact_lookup_key,
          first_observed_at,
          expires_at
        )
        SELECT
          input_observation.contact_lookup_key,
          ${now},
          ${observationExpiresAt}
        FROM input_observation
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
        RETURNING contact_lookup_key
      ),
      input_participant(participant_member_id, handle_lookup_key) AS (
        ${inputParticipantRows}
      ),
      upserted AS (
        INSERT INTO hosted_thread_container_participant (
          container_member_id,
          participant_member_id,
          handle_lookup_key,
          first_seen_at,
          last_seen_at,
          removed_at,
          created_at,
          updated_at
        )
        SELECT
          ${input.containerMemberId},
          input_participant.participant_member_id,
          input_participant.handle_lookup_key,
          ${now},
          ${now},
          NULL,
          ${now},
          ${now}
        FROM input_participant
        CROSS JOIN (SELECT COUNT(*) FROM upserted_observation) AS observation_barrier
        ON CONFLICT (container_member_id, participant_member_id)
        DO UPDATE SET
          handle_lookup_key = EXCLUDED.handle_lookup_key,
          last_seen_at = EXCLUDED.last_seen_at,
          removed_at = NULL,
          updated_at = EXCLUDED.updated_at
        RETURNING participant_member_id
      )
      UPDATE hosted_thread_container_participant AS participant
      SET
        removed_at = ${now},
        updated_at = ${now}
      FROM (SELECT COUNT(*) FROM upserted) AS upsert_barrier
      WHERE ${hasCompleteRoster}
        AND participant.container_member_id = ${input.containerMemberId}
        AND participant.removed_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM input_participant
          WHERE input_participant.participant_member_id = participant.participant_member_id
        )
    `);

    if (!hasCompleteRoster) {
      logHostedThreadContainerParticipantReconcileSkipped({
        chatId: input.chatId,
        containerMemberId: input.containerMemberId,
        reason: "roster_exceeds_cap",
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
