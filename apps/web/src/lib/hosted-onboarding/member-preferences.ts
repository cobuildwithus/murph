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
  normalizeStoredAssistantPersonaId,
  type AssistantPersonaId,
  type AssistantPreferenceFieldId,
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
  Record<AssistantPersonalitySettingId, number | null>
>;

export type HostedMemberAssistantPersonalitySnapshot = Record<
  AssistantPersonalitySettingId,
  number | null
>;

export interface HostedMemberAssistantPreferencesUpdate {
  persona?: AssistantPersonaId;
  personality?: HostedMemberAssistantPersonalityUpdate;
  tone?: AssistantTonePreference;
  voice?: AssistantVoiceOptionId;
}

export type HostedMemberAssistantPreferencesMailboxPayloadMode =
  | "legacy_snapshot"
  | "sparse_delta";

export interface HostedMemberAssistantPreferencesResult {
  appliedFields: AssistantPreferenceFieldId[];
  assistantPersona: AssistantPersonaId | null;
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
      assistantPersona: true,
      assistantPersonaCausalSeq: true,
      assistantDetail: true,
      assistantDetailCausalSeq: true,
      assistantHumor: true,
      assistantHumorCausalSeq: true,
      assistantPush: true,
      assistantPushCausalSeq: true,
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
      persona: member.assistantPersona,
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
            persona: member.assistantPersonaCausalSeq,
            personality: {
              detail: member.assistantDetailCausalSeq,
              humor: member.assistantHumorCausalSeq,
              push: member.assistantPushCausalSeq,
            },
            tone: member.assistantToneCausalSeq,
            voice: member.assistantVoiceCausalSeq,
          },
        }),
  });

  if (!applicablePreferences) {
    return {
      appliedFields: [],
      assistantPersona: normalizeStoredAssistantPersona(member.assistantPersona),
      assistantPersonality: normalizeStoredAssistantPersonality(member),
      assistantTone: normalizeStoredAssistantTone(member.assistantTone),
      assistantVoice: normalizeStoredAssistantVoice(member.assistantVoice),
      dispatch: null,
      updated: false,
    };
  }

  const preferences = applicablePreferences.preferences;

  if (
    input.mailboxPayloadMode === "legacy_snapshot"
    && (preferences.persona !== undefined || preferences.personality !== undefined)
  ) {
    throw new TypeError(
      "Assistant persona and personality updates require the sparse mailbox payload rollout.",
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
      ? preferences
      : buildHostedMemberAssistantPreferencesSnapshot({
          tone: preferences.tone ?? member.assistantTone,
          voice: preferences.voice ?? member.assistantVoice,
        }),
    requestedFields: [
      ...(preferences.persona === undefined ? [] : ["persona" as const]),
      ...(preferences.tone === undefined ? [] : ["tone" as const]),
      ...(preferences.voice === undefined ? [] : ["voice" as const]),
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
  const projectedPersona = wake.preferences.persona;
  const projectedTone = wake.preferences.tone;
  const projectedVoice = wake.preferences.voice;
  const visibleValueChanged = (
    preferences.persona !== undefined
    && preferences.persona !== member.assistantPersona
  )
    || (
    preferences.personality?.humor !== undefined
    && preferences.personality.humor !== member.assistantHumor
  )
    || (
      preferences.personality?.push !== undefined
      && preferences.personality.push !== member.assistantPush
    )
    || (
      preferences.personality?.detail !== undefined
      && preferences.personality.detail !== member.assistantDetail
    )
    || (
      preferences.tone !== undefined
      && preferences.tone !== member.assistantTone
    )
    || (
      preferences.voice !== undefined
      && preferences.voice !== member.assistantVoice
    );
  const updatedMember = await input.prisma.hostedMember.update({
    where: {
      id: input.memberId,
    },
    data: {
      ...(projectedPersona === undefined
        ? {}
        : {
            assistantPersona: projectedPersona,
            assistantPersonaCausalSeq: maxCausalSeq(
              member.assistantPersonaCausalSeq,
              effectiveCausalSeq,
            ),
          }),
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
      ...(preferences.personality?.humor === undefined
        ? {}
        : {
            assistantHumor: preferences.personality.humor,
            assistantHumorCausalSeq: maxCausalSeq(
              member.assistantHumorCausalSeq,
              effectiveCausalSeq,
            ),
          }),
      ...(preferences.personality?.push === undefined
        ? {}
        : {
            assistantPush: preferences.personality.push,
            assistantPushCausalSeq: maxCausalSeq(
              member.assistantPushCausalSeq,
              effectiveCausalSeq,
            ),
          }),
      ...(preferences.personality?.detail === undefined
        ? {}
        : {
            assistantDetail: preferences.personality.detail,
            assistantDetailCausalSeq: maxCausalSeq(
              member.assistantDetailCausalSeq,
              effectiveCausalSeq,
            ),
          }),
    },
    select: {
      assistantPersona: true,
      assistantDetail: true,
      assistantHumor: true,
      assistantPush: true,
      assistantTone: true,
      assistantVoice: true,
    },
  });

  return {
    appliedFields: applicablePreferences.appliedFields,
    assistantPersona: normalizeStoredAssistantPersona(updatedMember.assistantPersona),
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
  persona: AssistantPersonaId | null;
  personality: HostedMemberAssistantPersonalitySnapshot;
  tone: AssistantTonePreference | null;
  voice: AssistantVoiceOptionId | null;
}> {
  const member = await input.prisma.hostedMember.findUnique({
    select: {
      assistantPersona: true,
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

  return projectHostedMemberAssistantPreferences(member);
}

export function projectHostedMemberAssistantPreferences(
  member: (HostedMemberPersonalityColumns & {
    assistantPersona?: string | null;
    assistantTone: string | null;
    assistantVoice: string | null;
  }) | null,
): {
  persona: AssistantPersonaId | null;
  personality: HostedMemberAssistantPersonalitySnapshot;
  tone: AssistantTonePreference | null;
  voice: AssistantVoiceOptionId | null;
} {
  return {
    persona: normalizeStoredAssistantPersona(member?.assistantPersona ?? null),
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
    persona: string | null;
    personality: HostedMemberPersonalityColumns;
    tone: string | null;
    voice: string | null;
  };
  currentCausalSeq?: {
    persona: bigint | null;
    personality: Record<AssistantPersonalitySettingId, bigint | null>;
    tone: bigint | null;
    voice: bigint | null;
  };
  preferences: HostedMemberAssistantPreferencesUpdate;
}): {
  appliedFields: AssistantPreferenceFieldId[];
  preferences: HostedExecutionMemberPreferences;
} | null {
  const personaApplicable = input.causalSeq === undefined
    || input.currentCausalSeq?.persona === null
    || input.currentCausalSeq?.persona === undefined
    || input.causalSeq >= input.currentCausalSeq.persona;
  const toneApplicable = input.causalSeq === undefined
    || input.currentCausalSeq?.tone === null
    || input.currentCausalSeq?.tone === undefined
    || input.causalSeq >= input.currentCausalSeq.tone;
  const voiceApplicable = input.causalSeq === undefined
    || input.currentCausalSeq?.voice === null
    || input.currentCausalSeq?.voice === undefined
    || input.causalSeq >= input.currentCausalSeq.voice;
  const persona = personaApplicable && input.preferences.persona !== undefined
    ? input.preferences.persona
    : undefined;
  const tone = toneApplicable && input.preferences.tone !== undefined
    ? input.preferences.tone
    : undefined;
  const voice = voiceApplicable && input.preferences.voice !== undefined
    ? input.preferences.voice
    : undefined;
  const personality: HostedMemberAssistantPersonalityUpdate = {};
  const appliedFields: AssistantPreferenceFieldId[] = [
    ...(persona === undefined ? [] : ["persona" as const]),
    ...(tone === undefined ? [] : ["tone" as const]),
    ...(voice === undefined ? [] : ["voice" as const]),
  ];
  for (const settingId of assistantPersonalitySettingIds) {
    const requestedScore = input.preferences.personality?.[settingId];
    if (requestedScore === undefined) {
      continue;
    }

    if (!isAssistantPreferenceFieldApplicable({
      causalSeq: input.causalSeq,
      currentCausalSeq: input.currentCausalSeq?.personality[settingId],
      currentValue: readStoredAssistantPersonalityScore(
        input.current.personality,
        settingId,
      ),
      requestedValue: requestedScore,
    })) {
      continue;
    }

    personality[settingId] = requestedScore;
    appliedFields.push(settingId);
  }
  const personalityChanged = Object.keys(personality).length > 0;

  if (
    persona === undefined
    && tone === undefined
    && voice === undefined
    && !personalityChanged
  ) {
    return null;
  }

  return {
    appliedFields,
    preferences: {
      ...(persona === undefined ? {} : { persona }),
      ...(personalityChanged ? { personality } : {}),
      ...(tone === undefined ? {} : { tone }),
      ...(voice === undefined ? {} : { voice }),
    },
  };
}

function isAssistantPreferenceFieldApplicable(input: {
  causalSeq: bigint | undefined;
  currentCausalSeq: bigint | null | undefined;
  currentValue: number | null;
  requestedValue: number | null;
}): boolean {
  if (input.causalSeq === undefined || input.currentCausalSeq == null) {
    return true;
  }
  if (input.causalSeq > input.currentCausalSeq) {
    return true;
  }
  if (input.causalSeq < input.currentCausalSeq) {
    return false;
  }
  return input.requestedValue !== input.currentValue;
}

function readStoredAssistantPersonalityScore(
  value: HostedMemberPersonalityColumns,
  settingId: AssistantPersonalitySettingId,
): number | null {
  switch (settingId) {
    case "detail":
      return value.assistantDetail;
    case "humor":
      return value.assistantHumor;
    case "push":
      return value.assistantPush;
  }
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

function normalizeStoredAssistantPersona(
  value: string | null | undefined,
): AssistantPersonaId | null {
  return normalizeStoredAssistantPersonaId(value);
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
