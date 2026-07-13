import {
  assistantPersonalityCausalWritesEnabled,
  assistantPersonalityPreferencesSchema,
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  type AssistantPersonalityPreferences,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";

import { getPrisma } from "@/src/lib/prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  upsertHostedMemberAssistantPreferencesTx,
  type HostedMemberAssistantPreferencesUpdate,
} from "@/src/lib/hosted-onboarding/member-preferences";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

const ASSISTANT_STYLE_REQUEST_BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: ASSISTANT_STYLE_REQUEST_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "ASSISTANT_STYLE_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Assistant style request body is too large.",
  });
  const preferences = parseAssistantStyleRequestBody(body);
  if (
    preferences.personality !== undefined
    && !assistantPersonalityCausalWritesEnabled(process.env)
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_PERSONALITY_ROLLOUT_PENDING",
      httpStatus: 503,
      message: "Personality settings are temporarily unavailable during rollout.",
      retryable: true,
    });
  }
  const prisma = getPrisma();
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => (
    upsertHostedMemberAssistantPreferencesTx({
      memberId: auth.member.id,
      occurredAt: now.toISOString(),
      preferences,
      prisma: tx,
    })
  ), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (result.dispatch) {
    await signalHostedMailboxAppendBestEffort({
      expectedUserId: auth.member.id,
      mailboxItemId: result.dispatch.mailboxItemId,
    });
  }

  return jsonOk({
    assistantPersonality: result.assistantPersonality,
    assistantTone: result.assistantTone,
    assistantVoice: result.assistantVoice,
    ok: true,
    runTriggered: result.dispatch !== null,
    updated: result.updated,
  });
});

function parseAssistantStyleRequestBody(
  body: Record<string, unknown>,
): HostedMemberAssistantPreferencesUpdate {
  const personality = body.personality === undefined
    ? undefined
    : parseAssistantPersonality(body.personality);
  const tone = body.tone === undefined
    ? undefined
    : parseAssistantTone(body.tone);
  const voice = body.voice === undefined
    ? undefined
    : parseAssistantVoice(body.voice);

  if (personality !== undefined && (tone !== undefined || voice !== undefined)) {
    throw hostedOnboardingError({
      code: "ASSISTANT_STYLE_MIXED_UPDATE",
      httpStatus: 400,
      message: "Update personality separately from tone and voice.",
    });
  }

  if (personality === undefined && tone === undefined && voice === undefined) {
    throw hostedOnboardingError({
      code: "ASSISTANT_STYLE_EMPTY_UPDATE",
      httpStatus: 400,
      message: "Choose a tone, voice, or personality setting before continuing.",
    });
  }

  return {
    ...(personality === undefined ? {} : { personality }),
    ...(tone === undefined ? {} : { tone }),
    ...(voice === undefined ? {} : { voice }),
  };
}

function parseAssistantPersonality(value: unknown): AssistantPersonalityPreferences {
  const result = assistantPersonalityPreferencesSchema.safeParse(value);
  if (result.success && Object.keys(result.data).length > 0) {
    return result.data;
  }

  throw hostedOnboardingError({
    code: "ASSISTANT_STYLE_INVALID_PERSONALITY",
    httpStatus: 400,
    message: "Choose a valid personality setting.",
  });
}

function parseAssistantTone(value: unknown): AssistantTonePreference {
  if (isAssistantTonePreference(value)) {
    return value;
  }

  throw hostedOnboardingError({
    code: "ASSISTANT_STYLE_INVALID_TONE",
    httpStatus: 400,
    message: "Choose a valid tone.",
  });
}

function parseAssistantVoice(value: unknown): AssistantVoiceOptionId {
  if (isAssistantVoiceOptionId(value)) {
    return value;
  }

  throw hostedOnboardingError({
    code: "ASSISTANT_STYLE_INVALID_VOICE",
    httpStatus: 400,
    message: "Choose a valid voice.",
  });
}

async function signalHostedMailboxAppendBestEffort(input: {
  expectedUserId: string;
  mailboxItemId: string;
}): Promise<void> {
  try {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: input.expectedUserId,
      mailboxItemId: input.mailboxItemId,
    });
  } catch {
    // Assistant style saves should not fail if the best-effort runtime wake is unavailable.
  }
}
