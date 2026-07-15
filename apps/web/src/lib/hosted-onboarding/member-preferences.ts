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

function maxCausalSeq(current: bigint | null, next: bigint): bigint {
  return current !== null && current > next ? current : next;
}

export async function upsertHostedMemberAssistantPreferencesTx(input: {
  causalOrigin?: "event" | "turn";
  mailboxPayloadMode: HostedMemberAssistantPreferencesMailboxPayloadMode;
  memberId: string;
  occurredAt: string;
  preferenceCausalSeq?: string;
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
      assistantToneCausalSeq: true,
      assistantVoice: true,
      assistantVoiceCausalSeq: true,
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

  const requestedCausalSeq = input.preferenceCausalSeq === undefined
    ? null
    : BigInt(input.preferenceCausalSeq);
  const applicablePreferences = resolveApplicableAssistantPreferences({
    current: {
      personality: member,
      tone: member.assistantTone,
      voice: member.assistantVoice,
    },
    preferences: input.preferences,
    ...(requestedCausalSeq === null
      ? {}
      : {
          causalSeq: requestedCausalSeq,
          currentCausalSeq: {
            tone: member.assistantToneCausalSeq,
            voice: member.assistantVoiceCausalSeq,
          },
        }),
  });

  if (!applicablePreferences) {
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
    && applicablePreferences.personality !== undefined
  ) {
    throw new TypeError(
      "Assistant personality updates require the sparse mailbox payload rollout.",
    );
  }

  const wake = buildHostedExecutionMemberPreferencesUpdatedWake({
    ...(input.causalOrigin ? { causalOrigin: input.causalOrigin } : {}),
    eventId: buildHostedMemberPreferencesUpdatedEventId({
      memberId: input.memberId,
      updateId: randomUUID(),
    }),
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    ...(input.preferenceCausalSeq
      ? { preferenceCausalSeq: input.preferenceCausalSeq }
      : {}),
    preferences: input.mailboxPayloadMode === "sparse_delta"
      ? applicablePreferences
      : buildHostedMemberAssistantPreferencesSnapshot({
          tone: applicablePreferences.tone ?? member.assistantTone,
          voice: applicablePreferences.voice ?? member.assistantVoice,
        }),
    requestedFields: [
      ...(applicablePreferences.tone === undefined ? [] : ["tone" as const]),
      ...(applicablePreferences.voice === undefined ? [] : ["voice" as const]),
    ],
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
  const effectiveCausalSeq = requestedCausalSeq ?? BigInt(append.item.causalSeq!);
  const projectedTone = wake.preferences.tone;
  const projectedVoice = wake.preferences.voice;
  const visibleValueChanged = applicablePreferences.personality !== undefined
    || (
      applicablePreferences.tone !== undefined
      && applicablePreferences.tone !== member.assistantTone
    )
    || (
      applicablePreferences.voice !== undefined
      && applicablePreferences.voice !== member.assistantVoice
    );
  const updatedMember = await input.prisma.hostedMember.update({
    where: {
      id: input.memberId,
    },
    data: {
      ...(projectedTone === undefined
        ? {}
        : {
            assistantTone: projectedTone,
            assistantToneCausalSeq: maxCausalSeq(
              member.assistantToneCausalSeq,
              effectiveCausalSeq,
            ),
          }),
      ...(projectedVoice === undefined
        ? {}
        : {
            assistantVoice: projectedVoice,
            assistantVoiceCausalSeq: maxCausalSeq(
              member.assistantVoiceCausalSeq,
              effectiveCausalSeq,
            ),
          }),
      ...(applicablePreferences.personality?.humor === undefined
        ? {}
        : { assistantHumor: applicablePreferences.personality.humor }),
      ...(applicablePreferences.personality?.push === undefined
        ? {}
        : { assistantPush: applicablePreferences.personality.push }),
      ...(applicablePreferences.personality?.detail === undefined
        ? {}
        : { assistantDetail: applicablePreferences.personality.detail }),
    },
    select: {
      assistantDetail: true,
      assistantHumor: true,
      assistantPush: true,
      assistantTone: true,
      assistantVoice: true,
    },
  });

  return {
    assistantPersonality: normalizeStoredAssistantPersonality(updatedMember),
    assistantTone: normalizeStoredAssistantTone(updatedMember.assistantTone),
    assistantVoice: normalizeStoredAssistantVoice(updatedMember.assistantVoice),
    dispatch: {
      mailboxItemId: append.item.id,
    },
    updated: visibleValueChanged,
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

function resolveApplicableAssistantPreferences(input: {
  causalSeq?: bigint;
  current: {
    personality: HostedMemberPersonalityColumns;
    tone: string | null;
    voice: string | null;
  };
  currentCausalSeq?: {
    tone: bigint | null;
    voice: bigint | null;
  };
  preferences: HostedMemberAssistantPreferencesUpdate;
}): HostedExecutionMemberPreferences | null {
  const toneApplicable = input.causalSeq === undefined
    || input.currentCausalSeq?.tone === null
    || input.currentCausalSeq?.tone === undefined
    || input.causalSeq >= input.currentCausalSeq.tone;
  const voiceApplicable = input.causalSeq === undefined
    || input.currentCausalSeq?.voice === null
    || input.currentCausalSeq?.voice === undefined
    || input.causalSeq >= input.currentCausalSeq.voice;
  const tone = toneApplicable && input.preferences.tone !== undefined
    ? input.preferences.tone
    : undefined;
  const voice = voiceApplicable && input.preferences.voice !== undefined
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
