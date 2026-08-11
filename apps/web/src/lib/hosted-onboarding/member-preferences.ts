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

import {
  appendHostedMailboxEnvelopeTx,
  findHostedMailboxItemByDedupeKeyTx,
  readHostedMailboxWakeByDedupeKey,
} from "../hosted-mailbox/store";
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
  assistantUnhinged: number | null;
};

export async function upsertHostedMemberAssistantPreferencesTx(input: {
  causalOrigin?: "event" | "turn";
  memberId: string;
  occurredAt: string;
  preferenceCausalSeq?: string;
  preferences: HostedMemberAssistantPreferencesUpdate;
  prisma: Prisma.TransactionClient;
  updateId?: string;
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
      assistantUnhinged: true,
      assistantUnhingedCausalSeq: true,
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

  if (!Number.isFinite(Date.parse(input.occurredAt))) {
    throw new TypeError("Assistant preference logical ordering time is invalid.");
  }
  const currentOccurredAt =
    await readHostedAssistantPreferenceOccurredAtByCausalSeq({
      currentCausalSeq: readHostedMemberAssistantPreferenceCausalSeq(member),
      memberId: input.memberId,
      prisma: input.prisma,
    });

  const currentCausalSeq = readHostedMemberAssistantPreferenceCausalSeq(member);
  const eventId = input.updateId === undefined
    ? null
    : buildHostedMemberPreferencesUpdatedEventId({
        memberId: input.memberId,
        updateId: input.updateId,
      });
  if (eventId) {
    const existing = await findHostedMailboxItemByDedupeKeyTx({
      dedupeKey: eventId,
      tx: input.prisma,
      userId: input.memberId,
    });
    if (existing) {
      const existingWake = await readHostedMailboxWakeByDedupeKey({
        dedupeKey: eventId,
        prisma: input.prisma,
        userId: input.memberId,
      });
      assertHostedMemberPreferenceWakeReplay({
        causalOrigin: input.causalOrigin,
        eventId,
        memberId: input.memberId,
        occurredAt: input.occurredAt,
        preferenceCausalSeq: input.preferenceCausalSeq,
        preferences: input.preferences,
        wake: existingWake,
      });
      return buildHostedMemberAssistantPreferencesUnchangedResult({
        dispatch: { mailboxItemId: existing.id },
        member,
      });
    }
  }

  const requestedCausalSeq = input.preferenceCausalSeq === undefined
    ? resolveHostedAssistantPreferenceNextCandidateCausalSeq(currentCausalSeq)
    : BigInt(input.preferenceCausalSeq);

  let applicablePreferences = resolveApplicableAssistantPreferences({
    preferences: input.preferences,
    causalSeq: requestedCausalSeq,
    currentCausalSeq,
    currentOccurredAt,
    occurredAt: input.occurredAt,
    sameSourceCommand: input.updateId !== undefined
      && input.preferenceCausalSeq !== undefined,
  });

  if (!applicablePreferences) {
    return buildHostedMemberAssistantPreferencesUnchangedResult({
      dispatch: null,
      member,
    });
  }

  const append = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionMemberPreferencesUpdatedWake({
      ...(input.causalOrigin ? { causalOrigin: input.causalOrigin } : {}),
      eventId: eventId ?? buildHostedMemberPreferencesUpdatedEventId({
        memberId: input.memberId,
        updateId: randomUUID(),
      }),
      memberId: input.memberId,
      occurredAt: input.occurredAt,
      ...(input.preferenceCausalSeq
        ? { preferenceCausalSeq: input.preferenceCausalSeq }
        : {}),
      preferences: applicablePreferences.preferences,
      requestedFields: resolveHostedAssistantPreferenceRequestedFields(
        input.preferences,
      ),
    }),
    tx: input.prisma,
  });
  assertHostedMemberPreferenceWakeAppend(append);
  if (append.duplicate) {
    return buildHostedMemberAssistantPreferencesUnchangedResult({
      dispatch: { mailboxItemId: append.item.id },
      member,
    });
  }

  const appendedCausalSeq = requireHostedMemberPreferenceWakeCausalSeq(append);
  if (input.preferenceCausalSeq === undefined) {
    const finalizedPreferences = resolveApplicableAssistantPreferences({
      preferences: input.preferences,
      causalSeq: appendedCausalSeq,
      currentCausalSeq,
      currentOccurredAt,
      occurredAt: input.occurredAt,
      sameSourceCommand: false,
    });
    if (
      !finalizedPreferences
      ||
      JSON.stringify(finalizedPreferences)
      !== JSON.stringify(applicablePreferences)
    ) {
      throw new Error(
        "Hosted mailbox causal allocation changed preference applicability.",
      );
    }
    applicablePreferences = finalizedPreferences;
  }
  const preferences = applicablePreferences.preferences;
  const effectiveCausalSeq = input.preferenceCausalSeq === undefined
    ? appendedCausalSeq
    : requestedCausalSeq;
  const projectedPersona = preferences.persona;
  const projectedTone = preferences.tone;
  const projectedVoice = preferences.voice;
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
      preferences.personality?.unhinged !== undefined
      && preferences.personality.unhinged !== member.assistantUnhinged
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
            assistantPersonaCausalSeq: effectiveCausalSeq,
          }),
      ...(projectedTone === undefined
        ? {}
        : {
            assistantTone: projectedTone,
            assistantToneCausalSeq: effectiveCausalSeq,
          }),
      ...(projectedVoice === undefined
        ? {}
        : {
            assistantVoice: projectedVoice,
            assistantVoiceCausalSeq: effectiveCausalSeq,
          }),
      ...(preferences.personality?.humor === undefined
        ? {}
        : {
            assistantHumor: preferences.personality.humor,
            assistantHumorCausalSeq: effectiveCausalSeq,
          }),
      ...(preferences.personality?.push === undefined
        ? {}
        : {
            assistantPush: preferences.personality.push,
            assistantPushCausalSeq: effectiveCausalSeq,
          }),
      ...(preferences.personality?.detail === undefined
        ? {}
        : {
            assistantDetail: preferences.personality.detail,
            assistantDetailCausalSeq: effectiveCausalSeq,
          }),
      ...(preferences.personality?.unhinged === undefined
        ? {}
        : {
            assistantUnhinged: preferences.personality.unhinged,
            assistantUnhingedCausalSeq: effectiveCausalSeq,
          }),
    },
    select: {
      assistantPersona: true,
      assistantDetail: true,
      assistantHumor: true,
      assistantPush: true,
      assistantUnhinged: true,
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

function assertHostedMemberPreferenceWakeAppend(
  append: Awaited<ReturnType<typeof appendHostedMailboxEnvelopeTx>>,
): void {
  if (!append.dedupeConflict) {
    return;
  }
  throwHostedMemberPreferenceWakeDedupeConflict();
}

function throwHostedMemberPreferenceWakeDedupeConflict(): never {
  throw hostedOnboardingError({
    code: "HOSTED_MEMBER_PREFERENCES_WAKE_DEDUPE_CONFLICT",
    httpStatus: 503,
    message: "Assistant preference update conflicted with an existing wake identity.",
    retryable: true,
  });
}

function resolveHostedAssistantPreferenceRequestedFields(
  preferences: HostedMemberAssistantPreferencesUpdate,
): Array<"persona" | "tone" | "voice"> {
  return [
    ...(preferences.persona === undefined ? [] : ["persona" as const]),
    ...(preferences.tone === undefined ? [] : ["tone" as const]),
    ...(preferences.voice === undefined ? [] : ["voice" as const]),
  ];
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
      assistantUnhinged: true,
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

type HostedMemberAssistantPreferenceCausalSeq = {
  persona: bigint | null;
  personality: Record<AssistantPersonalitySettingId, bigint | null>;
  tone: bigint | null;
  voice: bigint | null;
};

function readHostedMemberAssistantPreferenceCausalSeq(member: {
  assistantPersonaCausalSeq: bigint | null;
  assistantDetailCausalSeq: bigint | null;
  assistantHumorCausalSeq: bigint | null;
  assistantPushCausalSeq: bigint | null;
  assistantUnhingedCausalSeq: bigint | null;
  assistantToneCausalSeq: bigint | null;
  assistantVoiceCausalSeq: bigint | null;
}): HostedMemberAssistantPreferenceCausalSeq {
  return {
    persona: member.assistantPersonaCausalSeq,
    personality: {
      detail: member.assistantDetailCausalSeq,
      humor: member.assistantHumorCausalSeq,
      push: member.assistantPushCausalSeq,
      unhinged: member.assistantUnhingedCausalSeq,
    },
    tone: member.assistantToneCausalSeq,
    voice: member.assistantVoiceCausalSeq,
  };
}

function resolveHostedAssistantPreferenceNextCandidateCausalSeq(
  current: HostedMemberAssistantPreferenceCausalSeq,
): bigint {
  const currentValues = [
    current.persona,
    ...assistantPersonalitySettingIds.map(
      (settingId) => current.personality[settingId],
    ),
    current.tone,
    current.voice,
  ];
  let maximum = 0n;
  for (const value of currentValues) {
    if (value !== null && value > maximum) {
      maximum = value;
    }
  }
  return maximum + 1n;
}

function requireHostedMemberPreferenceWakeCausalSeq(
  append: Awaited<ReturnType<typeof appendHostedMailboxEnvelopeTx>>,
): bigint {
  const causalSeq = append.item.causalSeq;
  if (causalSeq === null || causalSeq === undefined) {
    throw new Error("Hosted preference wake requires a causal sequence.");
  }
  return BigInt(causalSeq);
}

function buildHostedMemberAssistantPreferencesUnchangedResult(input: {
  dispatch: HostedMailboxAppendDispatch | null;
  member: HostedMemberPersonalityColumns & {
    assistantPersona: string | null;
    assistantTone: string | null;
    assistantVoice: string | null;
  };
}): HostedMemberAssistantPreferencesResult {
  return {
    appliedFields: [],
    assistantPersona: normalizeStoredAssistantPersona(input.member.assistantPersona),
    assistantPersonality: normalizeStoredAssistantPersonality(input.member),
    assistantTone: normalizeStoredAssistantTone(input.member.assistantTone),
    assistantVoice: normalizeStoredAssistantVoice(input.member.assistantVoice),
    dispatch: input.dispatch,
    updated: false,
  };
}

function assertHostedMemberPreferenceWakeReplay(input: {
  causalOrigin?: "event" | "turn";
  eventId: string;
  memberId: string;
  occurredAt: string;
  preferenceCausalSeq?: string;
  preferences: HostedMemberAssistantPreferencesUpdate;
  wake: Awaited<ReturnType<typeof readHostedMailboxWakeByDedupeKey>>;
}): void {
  const wake = input.wake;
  if (
    !wake
    || wake.kind !== "member.preferences.updated"
    || wake.eventId !== input.eventId
    || wake.userId !== input.memberId
    || wake.occurredAt !== input.occurredAt
    || wake.causalOrigin !== input.causalOrigin
    || wake.preferenceCausalSeq !== input.preferenceCausalSeq
    || JSON.stringify(wake.requestedFields ?? [])
      !== JSON.stringify(
        resolveHostedAssistantPreferenceRequestedFields(input.preferences),
      )
    || JSON.stringify(wake.preferences)
      !== JSON.stringify(projectHostedPreferenceReplayValues({
        preferences: input.preferences,
        stored: wake.preferences,
      }))
  ) {
    throwHostedMemberPreferenceWakeDedupeConflict();
  }
}

function projectHostedPreferenceReplayValues(input: {
  preferences: HostedMemberAssistantPreferencesUpdate;
  stored: HostedExecutionMemberPreferences;
}): HostedExecutionMemberPreferences {
  const personality: HostedMemberAssistantPersonalityUpdate = {};
  for (const settingId of assistantPersonalitySettingIds) {
    if (input.stored.personality?.[settingId] === undefined) {
      continue;
    }
    const requested = input.preferences.personality?.[settingId];
    if (requested !== undefined) {
      personality[settingId] = requested;
    }
  }
  return {
    ...(input.stored.persona !== undefined
      && input.preferences.persona !== undefined
      ? { persona: input.preferences.persona }
      : {}),
    ...(Object.keys(personality).length > 0 ? { personality } : {}),
    ...(input.stored.tone !== undefined && input.preferences.tone !== undefined
      ? { tone: input.preferences.tone }
      : {}),
    ...(input.stored.voice !== undefined && input.preferences.voice !== undefined
      ? { voice: input.preferences.voice }
      : {}),
  };
}

function resolveApplicableAssistantPreferences(input: {
  causalSeq: bigint;
  currentCausalSeq?: {
    persona: bigint | null;
    personality: Record<AssistantPersonalitySettingId, bigint | null>;
    tone: bigint | null;
    voice: bigint | null;
  };
  currentOccurredAt: {
    persona: Date | null | undefined;
    personality: Record<AssistantPersonalitySettingId, Date | null | undefined>;
    tone: Date | null | undefined;
    voice: Date | null | undefined;
  };
  occurredAt: string;
  preferences: HostedMemberAssistantPreferencesUpdate;
  sameSourceCommand: boolean;
}): {
  appliedFields: AssistantPreferenceFieldId[];
  preferences: HostedExecutionMemberPreferences;
} | null {
  const personaApplicable = isAssistantPreferenceFieldApplicable({
    causalSeq: input.causalSeq,
    currentCausalSeq: input.currentCausalSeq?.persona,
    currentOccurredAt: input.currentOccurredAt?.persona,
    occurredAt: input.occurredAt,
    requestedValue: input.preferences.persona,
    sameSourceCommand: input.sameSourceCommand,
  });
  const toneApplicable = isAssistantPreferenceFieldApplicable({
    causalSeq: input.causalSeq,
    currentCausalSeq: input.currentCausalSeq?.tone,
    currentOccurredAt: input.currentOccurredAt?.tone,
    occurredAt: input.occurredAt,
    requestedValue: input.preferences.tone,
    sameSourceCommand: input.sameSourceCommand,
  });
  const voiceApplicable = isAssistantPreferenceFieldApplicable({
    causalSeq: input.causalSeq,
    currentCausalSeq: input.currentCausalSeq?.voice,
    currentOccurredAt: input.currentOccurredAt?.voice,
    occurredAt: input.occurredAt,
    requestedValue: input.preferences.voice,
    sameSourceCommand: input.sameSourceCommand,
  });
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
      currentOccurredAt: input.currentOccurredAt?.personality[settingId],
      occurredAt: input.occurredAt,
      requestedValue: requestedScore,
      sameSourceCommand: input.sameSourceCommand,
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

function isAssistantPreferenceFieldApplicable<T>(input: {
  causalSeq: bigint;
  currentCausalSeq: bigint | null | undefined;
  currentOccurredAt: Date | null | undefined;
  occurredAt: string;
  requestedValue: T | undefined;
  sameSourceCommand: boolean;
}): boolean {
  if (input.requestedValue === undefined) {
    return false;
  }
  if (input.currentCausalSeq == null) {
    return true;
  }
  if (!input.currentOccurredAt) {
    return input.causalSeq > input.currentCausalSeq;
  }
  const requestedAt = Date.parse(input.occurredAt);
  const currentAt = input.currentOccurredAt.getTime();
  if (requestedAt !== currentAt) {
    return requestedAt > currentAt;
  }
  return input.causalSeq > input.currentCausalSeq
    || (
      input.sameSourceCommand
      && input.causalSeq === input.currentCausalSeq
    );
}

async function readHostedAssistantPreferenceOccurredAtByCausalSeq(input: {
  currentCausalSeq: {
    persona: bigint | null;
    personality: Record<AssistantPersonalitySettingId, bigint | null>;
    tone: bigint | null;
    voice: bigint | null;
  };
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<{
  persona: Date | null | undefined;
  personality: Record<AssistantPersonalitySettingId, Date | null | undefined>;
  tone: Date | null | undefined;
  voice: Date | null | undefined;
}> {
  const causalSeqs = [
    input.currentCausalSeq.persona,
    ...assistantPersonalitySettingIds.map(
      (settingId) => input.currentCausalSeq.personality[settingId],
    ),
    input.currentCausalSeq.tone,
    input.currentCausalSeq.voice,
  ].filter((causalSeq): causalSeq is bigint => causalSeq !== null);
  const items = causalSeqs.length === 0
    ? []
    : await input.prisma.hostedMailboxItem.findMany({
        select: { causalSeq: true, occurredAt: true },
        where: {
          causalSeq: { in: [...new Set(causalSeqs)] },
          userId: input.memberId,
        },
      });
  const occurredAtByCausalSeq = new Map(
    items.flatMap((item) => item.causalSeq === null
      ? []
      : [[item.causalSeq, item.occurredAt] as const]),
  );
  const readOccurredAt = (causalSeq: bigint | null) => causalSeq === null
    ? null
    : occurredAtByCausalSeq.get(causalSeq);
  return {
    persona: readOccurredAt(input.currentCausalSeq.persona),
    personality: {
      detail: readOccurredAt(input.currentCausalSeq.personality.detail),
      humor: readOccurredAt(input.currentCausalSeq.personality.humor),
      push: readOccurredAt(input.currentCausalSeq.personality.push),
      unhinged: readOccurredAt(input.currentCausalSeq.personality.unhinged),
    },
    tone: readOccurredAt(input.currentCausalSeq.tone),
    voice: readOccurredAt(input.currentCausalSeq.voice),
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
    unhinged: normalizeStoredAssistantPersonalityScore(value?.assistantUnhinged),
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
