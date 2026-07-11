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

export interface HostedMemberAssistantPreferencesResult {
  assistantPersonality: HostedMemberAssistantPersonalitySnapshot;
  assistantTone: AssistantTonePreference | null;
  assistantVoice: AssistantVoiceOptionId | null;
  dispatch: HostedMailboxAppendDispatch | null;
  updated: boolean;
}

const PERSONALITY_MEMBER_COLUMNS = {
  detail: "assistantDetail",
  humor: "assistantHumor",
  push: "assistantPush",
} as const satisfies Record<
  AssistantPersonalitySettingId,
  "assistantDetail" | "assistantHumor" | "assistantPush"
>;

type HostedMemberPersonalityColumns = {
  assistantDetail: number | null;
  assistantHumor: number | null;
  assistantPush: number | null;
};

export async function upsertHostedMemberAssistantPreferencesTx(input: {
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
    // The canonical vault is also written conversationally, so the wake must
    // contain only this request's delta. A web-column snapshot could clobber
    // a newer preference the member set through chat.
    preferences: changedPreferences,
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

    const column = PERSONALITY_MEMBER_COLUMNS[settingId];
    if (requestedScore !== input.current.personality[column]) {
      personality[settingId] = requestedScore;
    }
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
