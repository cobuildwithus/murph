import type { Prisma, PrismaClient } from "@prisma/client";
import {
  isAssistantPersonaId,
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  type AssistantPersonaId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";

import { hostedOnboardingError } from "./errors";
import {
  projectHostedMemberAssistantPreferences,
  upsertHostedMemberAssistantPreferencesTx,
  type HostedMailboxAppendDispatch,
} from "./member-preferences";
import { lockHostedMemberRow } from "./shared";

export const COMPANION_INITIAL_ONBOARDING_SCHEMA =
  "murph.companion.initial-onboarding.v1";

const COMPLETION_ACTIONS = new Set(["save", "skip"]);
const COMPLETION_REQUEST_FIELDS = new Set(["action", "preferences"]);
const COMPLETION_PREFERENCE_FIELDS = new Set(["persona", "tone", "voice"]);

export interface HostedInitialOnboardingPreferences {
  persona: AssistantPersonaId | null;
  tone: AssistantTonePreference | null;
  voice: AssistantVoiceOptionId | null;
}

export interface HostedInitialOnboardingState {
  preferences: HostedInitialOnboardingPreferences;
  status: "completed" | "pending";
}

export type HostedInitialOnboardingCompletionRequest =
  | { action: "skip" }
  | {
      action: "save";
      preferences: {
        persona: AssistantPersonaId;
        tone: AssistantTonePreference;
        voice: AssistantVoiceOptionId;
      };
    };

export interface HostedInitialOnboardingCompletionResult
  extends HostedInitialOnboardingState {
  completedNow: boolean;
  dispatch: HostedMailboxAppendDispatch | null;
}

type HostedInitialOnboardingReadClient = Pick<PrismaClient, "hostedMember">;

const hostedInitialOnboardingMemberSelect = {
  assistantDetail: true,
  assistantHumor: true,
  assistantPersona: true,
  assistantPush: true,
  assistantTone: true,
  assistantUnhinged: true,
  assistantVoice: true,
  initialOnboardingCompletedAt: true,
} as const;

export async function readHostedInitialOnboardingState(input: {
  memberId: string;
  prisma: HostedInitialOnboardingReadClient;
}): Promise<HostedInitialOnboardingState> {
  const member = await input.prisma.hostedMember.findUnique({
    select: hostedInitialOnboardingMemberSelect,
    where: { id: input.memberId },
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }

  return projectHostedInitialOnboardingState(member);
}

export async function completeHostedInitialOnboardingTx(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
  request: HostedInitialOnboardingCompletionRequest;
}): Promise<HostedInitialOnboardingCompletionResult> {
  await lockHostedMemberRow(input.prisma, input.memberId);
  const member = await input.prisma.hostedMember.findUnique({
    select: hostedInitialOnboardingMemberSelect,
    where: { id: input.memberId },
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }

  if (member.initialOnboardingCompletedAt) {
    return {
      ...projectHostedInitialOnboardingState(member),
      completedNow: false,
      dispatch: null,
    };
  }

  const preferenceResult = input.request.action === "save"
    ? await upsertHostedMemberAssistantPreferencesTx({
        memberId: input.memberId,
        occurredAt: input.now.toISOString(),
        preferences: input.request.preferences,
        prisma: input.prisma,
      })
    : null;

  await input.prisma.hostedMember.update({
    data: { initialOnboardingCompletedAt: input.now },
    where: { id: input.memberId },
  });

  return {
    completedNow: true,
    dispatch: preferenceResult?.dispatch ?? null,
    preferences: preferenceResult
      ? {
          persona: preferenceResult.assistantPersona,
          tone: preferenceResult.assistantTone,
          voice: preferenceResult.assistantVoice,
        }
      : projectHostedInitialOnboardingState(member).preferences,
    status: "completed",
  };
}

export function parseHostedInitialOnboardingCompletionRequest(
  body: Record<string, unknown>,
): HostedInitialOnboardingCompletionRequest {
  rejectUnknownFields(body, COMPLETION_REQUEST_FIELDS);
  if (typeof body.action !== "string" || !COMPLETION_ACTIONS.has(body.action)) {
    throw invalidCompletionRequest("Choose whether to save or skip onboarding.");
  }

  if (body.action === "skip") {
    if (body.preferences !== undefined) {
      throw invalidCompletionRequest("Skipped onboarding cannot include preferences.");
    }
    return { action: "skip" };
  }

  if (!isRecord(body.preferences)) {
    throw invalidCompletionRequest("Choose a valid Murph persona, tone, and voice.");
  }
  rejectUnknownFields(body.preferences, COMPLETION_PREFERENCE_FIELDS);
  if (
    !isAssistantPersonaId(body.preferences.persona)
    || !isAssistantTonePreference(body.preferences.tone)
    || !isAssistantVoiceOptionId(body.preferences.voice)
  ) {
    throw invalidCompletionRequest("Choose a valid Murph persona, tone, and voice.");
  }

  return {
    action: "save",
    preferences: {
      persona: body.preferences.persona,
      tone: body.preferences.tone,
      voice: body.preferences.voice,
    },
  };
}

function projectHostedInitialOnboardingState(
  member: {
    assistantDetail: number | null;
    assistantHumor: number | null;
    assistantPersona: string | null;
    assistantPush: number | null;
    assistantTone: string | null;
    assistantUnhinged: number | null;
    assistantVoice: string | null;
    initialOnboardingCompletedAt: Date | null;
  },
): HostedInitialOnboardingState {
  const preferences = projectHostedMemberAssistantPreferences(member);
  return {
    preferences: {
      persona: preferences.persona,
      tone: preferences.tone,
      voice: preferences.voice,
    },
    status: member.initialOnboardingCompletedAt ? "completed" : "pending",
  };
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidCompletionRequest("Onboarding request contains an unknown field.");
  }
}

function invalidCompletionRequest(message: string): Error {
  return hostedOnboardingError({
    code: "INITIAL_ONBOARDING_REQUEST_INVALID",
    httpStatus: 400,
    message,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
