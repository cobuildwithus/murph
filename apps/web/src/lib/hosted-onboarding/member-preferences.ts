import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  buildHostedExecutionMemberPreferencesUpdatedWake,
  type HostedExecutionMemberPreferences,
} from "@murphai/hosted-execution";
import {
  assistantPersonalitySettingIds,
  isAssistantPersonalityScore,
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  type AssistantPersonalitySettingId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { hostedOnboardingError } from "./errors";
import { lockHostedMemberRow } from "./shared";

export interface HostedMailboxAppendDispatch {
  mailboxItemId: string;
}

export type HostedMemberAssistantPersonalityUpdate = Partial<
  Record<AssistantPersonalitySettingId, number>
>;

export type HostedMemberAssistantPersonalitySnapshot = Record<
  AssistantPersonalitySettingId,
  number | null
>;

export interface HostedMemberAssistantPreferencesUpdate {
  personality?: HostedMemberAssistantPersonalityUpdate;
  tone?: AssistantTonePreference;
  voice?: AssistantVoiceOptionId;
}

export type HostedMemberAssistantPreferencesMailboxPayloadMode =
  | "legacy_snapshot"
  | "sparse_delta";

export interface HostedMemberAssistantPreferencesResult {
  assistantPersonality: HostedMemberAssistantPersonalitySnapshot;
  assistantTone: AssistantTonePreference | null;
  assistantVoice: AssistantVoiceOptionId | null;
  dispatch: HostedMailboxAppendDispatch | null;
  updated: boolean;
}

type HostedMemberPersonalityColumns = {
  assistantDetail: number | null;
  assistantHumor: number | null;
  assistantPush: number | null;
};

export async function upsertHostedMemberAssistantPreferencesTx(input: {
  mailboxPayloadMode: HostedMemberAssistantPreferencesMailboxPayloadMode;
  memberId: string;
  occurredAt: string;
  preferences: HostedMemberAssistantPreferencesUpdate;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberAssistantPreferencesResult> {
  await lockHostedMemberRow(input.prisma, input.memberId);

  const member = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      assistantDetail: true,
      assistantHumor: true,
      assistantPush: true,
      assistantTone: true,
      assistantVoice: true,
      id: true,
    },
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }

  const changedPreferences = resolveChangedAssistantPreferences({
    current: {
      personality: member,
      tone: member.assistantTone,
      voice: member.assistantVoice,
    },
    preferences: input.preferences,
  });

  if (!changedPreferences) {
    return {
      assistantPersonality: normalizeStoredAssistantPersonality(member),
      assistantTone: normalizeStoredAssistantTone(member.assistantTone),
      assistantVoice: normalizeStoredAssistantVoice(member.assistantVoice),
      dispatch: null,
      updated: false,
    };
  }

  if (
    input.mailboxPayloadMode === "legacy_snapshot"
    && changedPreferences.personality !== undefined
  ) {
    throw new TypeError(
      "Assistant personality updates require the sparse mailbox payload rollout.",
    );
  }

  const updatedMember = await input.prisma.hostedMember.update({
    where: {
      id: input.memberId,
    },
    data: {
      ...(changedPreferences.tone === undefined
        ? {}
        : { assistantTone: changedPreferences.tone }),
      ...(changedPreferences.voice === undefined
        ? {}
        : { assistantVoice: changedPreferences.voice }),
      ...(changedPreferences.personality?.humor === undefined
        ? {}
        : { assistantHumor: changedPreferences.personality.humor }),
      ...(changedPreferences.personality?.push === undefined
        ? {}
        : { assistantPush: changedPreferences.personality.push }),
      ...(changedPreferences.personality?.detail === undefined
        ? {}
        : { assistantDetail: changedPreferences.personality.detail }),
    },
    select: {
      assistantDetail: true,
      assistantHumor: true,
      assistantPush: true,
      assistantTone: true,
      assistantVoice: true,
    },
  });

  const wake = buildHostedExecutionMemberPreferencesUpdatedWake({
    eventId: buildHostedMemberPreferencesUpdatedEventId({
      memberId: input.memberId,
      updateId: randomUUID(),
    }),
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    preferences: input.mailboxPayloadMode === "sparse_delta"
      ? changedPreferences
      : buildHostedMemberAssistantPreferencesSnapshot({
          tone: updatedMember.assistantTone,
          voice: updatedMember.assistantVoice,
        }),
  });
  const append = await appendHostedMailboxEnvelopeTx({
    envelope: wake,
    tx: input.prisma,
  });
  if (append.dedupeConflict) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_PREFERENCES_WAKE_DEDUPE_CONFLICT",
      httpStatus: 503,
      message: "Assistant preference update conflicted with an existing wake identity.",
      retryable: true,
    });
  }

  return {
    assistantPersonality: normalizeStoredAssistantPersonality(updatedMember),
    assistantTone: normalizeStoredAssistantTone(updatedMember.assistantTone),
    assistantVoice: normalizeStoredAssistantVoice(updatedMember.assistantVoice),
    dispatch: {
      mailboxItemId: append.item.id,
    },
    updated: true,
  };
}

export async function readHostedMemberAssistantPreferences(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<{
  personality: HostedMemberAssistantPersonalitySnapshot;
  tone: AssistantTonePreference | null;
  voice: AssistantVoiceOptionId | null;
}> {
  const member = await input.prisma.hostedMember.findUnique({
    select: {
      assistantDetail: true,
      assistantHumor: true,
      assistantPush: true,
      assistantTone: true,
      assistantVoice: true,
    },
    where: {
      id: input.memberId,
    },
  });

  return {
    personality: normalizeStoredAssistantPersonality(member),
    tone: normalizeStoredAssistantTone(member?.assistantTone ?? null),
    voice: normalizeStoredAssistantVoice(member?.assistantVoice ?? null),
  };
}

export function buildHostedMemberPreferencesUpdatedEventId(input: {
  memberId: string;
  updateId: string;
}): string {
  return [
    "member.preferences.updated",
    input.memberId,
    input.updateId,
  ].join(":");
}

function resolveChangedAssistantPreferences(input: {
  current: {
    personality: HostedMemberPersonalityColumns;
    tone: string | null;
    voice: string | null;
  };
  preferences: HostedMemberAssistantPreferencesUpdate;
}): HostedExecutionMemberPreferences | null {
  const tone = input.preferences.tone !== undefined
    && input.preferences.tone !== input.current.tone
    ? input.preferences.tone
    : undefined;
  const voice = input.preferences.voice !== undefined
    && input.preferences.voice !== input.current.voice
    ? input.preferences.voice
    : undefined;
  const personality: HostedMemberAssistantPersonalityUpdate = {};
  for (const settingId of assistantPersonalitySettingIds) {
    const requestedScore = input.preferences.personality?.[settingId];
    if (requestedScore === undefined) {
      continue;
    }

    // Postgres is only a display/write projection. An explicit sparse
    // personality request must reach the canonical owner even when its value
    // equals the potentially stale projection column.
    personality[settingId] = requestedScore;
  }
  const personalityChanged = Object.keys(personality).length > 0;

  if (tone === undefined && voice === undefined && !personalityChanged) {
    return null;
  }

  return {
    ...(personalityChanged ? { personality } : {}),
    ...(tone === undefined ? {} : { tone }),
    ...(voice === undefined ? {} : { voice }),
  };
}

function buildHostedMemberAssistantPreferencesSnapshot(input: {
  tone: string | null;
  voice: string | null;
}): HostedExecutionMemberPreferences {
  const tone = normalizeStoredAssistantTone(input.tone);
  const voice = normalizeStoredAssistantVoice(input.voice);
  return {
    ...(tone === null ? {} : { tone }),
    ...(voice === null ? {} : { voice }),
  };
}

function normalizeStoredAssistantPersonality(
  value: HostedMemberPersonalityColumns | null | undefined,
): HostedMemberAssistantPersonalitySnapshot {
  return {
    detail: normalizeStoredAssistantPersonalityScore(value?.assistantDetail),
    humor: normalizeStoredAssistantPersonalityScore(value?.assistantHumor),
    push: normalizeStoredAssistantPersonalityScore(value?.assistantPush),
  };
}

function normalizeStoredAssistantPersonalityScore(
  value: number | null | undefined,
): number | null {
  return isAssistantPersonalityScore(value) ? value : null;
}

function normalizeStoredAssistantTone(
  value: string | null,
): AssistantTonePreference | null {
  return isAssistantTonePreference(value) ? value : null;
}

function normalizeStoredAssistantVoice(
  value: string | null,
): AssistantVoiceOptionId | null {
  return isAssistantVoiceOptionId(value) ? value : null;
}
