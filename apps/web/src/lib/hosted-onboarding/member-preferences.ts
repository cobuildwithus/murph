import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  buildHostedExecutionMemberPreferencesUpdatedWake,
  type HostedExecutionMemberPreferences,
} from "@murphai/hosted-execution";
import {
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { hostedOnboardingError } from "./errors";
import { lockHostedMemberRow } from "./shared";

export interface HostedMailboxAppendDispatch {
  mailboxItemId: string;
}

export interface HostedMemberAssistantPreferencesUpdate {
  tone?: AssistantTonePreference;
  voice?: AssistantVoiceOptionId;
}

export interface HostedMemberAssistantPreferencesResult {
  assistantTone: AssistantTonePreference | null;
  assistantVoice: AssistantVoiceOptionId | null;
  dispatch: HostedMailboxAppendDispatch | null;
  updated: boolean;
}

export async function upsertHostedMemberAssistantPreferencesTx(input: {
  memberId: string;
  occurredAt: string;
  preferences: HostedMemberAssistantPreferencesUpdate;
  prisma: Prisma.TransactionClient;
  sourceType: string;
}): Promise<HostedMemberAssistantPreferencesResult> {
  await lockHostedMemberRow(input.prisma, input.memberId);

  const member = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
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
      tone: member.assistantTone,
      voice: member.assistantVoice,
    },
    preferences: input.preferences,
  });

  if (!changedPreferences) {
    return {
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
    },
    select: {
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
  tone: AssistantTonePreference | null;
  voice: AssistantVoiceOptionId | null;
}> {
  const member = await input.prisma.hostedMember.findUnique({
    select: {
      assistantTone: true,
      assistantVoice: true,
    },
    where: {
      id: input.memberId,
    },
  });

  return {
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

  if (tone === undefined && voice === undefined) {
    return null;
  }

  return {
    ...(tone === undefined ? {} : { tone }),
    ...(voice === undefined ? {} : { voice }),
  };
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
