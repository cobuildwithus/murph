import {
  assistantPersonalityCausalWritesEnabled,
  isAssistantPersonaId,
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  type AssistantPersonaId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";

import { getPrisma } from "@/src/lib/prisma";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { upsertHostedMemberAssistantPreferencesTx } from "@/src/lib/hosted-onboarding/member-preferences";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

const ASSISTANT_PERSONA_REQUEST_BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  if (!assistantPersonalityCausalWritesEnabled(process.env)) {
    throw hostedOnboardingError({
      code: "ASSISTANT_PERSONA_ROLLOUT_PENDING",
      httpStatus: 503,
      message: "Murph personas are temporarily unavailable during rollout.",
      retryable: true,
    });
  }

  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: ASSISTANT_PERSONA_REQUEST_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "ASSISTANT_PERSONA_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Assistant persona request body is too large.",
  });
  const preferences = parseAssistantPersonaRequestBody(body);
  const prisma = getPrisma();
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => (
    upsertHostedMemberAssistantPreferencesTx({
      mailboxPayloadMode: "sparse_delta",
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
    assistantPersona: result.assistantPersona,
    assistantPersonality: result.assistantPersonality,
    assistantTone: result.assistantTone,
    assistantVoice: result.assistantVoice,
    ok: true,
    runTriggered: result.dispatch !== null,
    updated: result.updated,
  });
});

function parseAssistantPersonaRequestBody(
  body: Record<string, unknown>,
): {
  persona: AssistantPersonaId;
  tone: AssistantTonePreference;
  voice: AssistantVoiceOptionId;
} {
  for (const key of Object.keys(body)) {
    if (key !== "persona" && key !== "tone" && key !== "voice") {
      throw hostedOnboardingError({
        code: "ASSISTANT_PERSONA_INVALID_REQUEST",
        httpStatus: 400,
        message: "Choose a valid persona, writing style, and voice.",
      });
    }
  }
  if (!isAssistantPersonaId(body.persona)) {
    throw hostedOnboardingError({
      code: "ASSISTANT_PERSONA_INVALID_PERSONA",
      httpStatus: 400,
      message: "Choose a valid Murph persona.",
    });
  }
  if (!isAssistantTonePreference(body.tone)) {
    throw hostedOnboardingError({
      code: "ASSISTANT_PERSONA_INVALID_TONE",
      httpStatus: 400,
      message: "Choose a valid writing style.",
    });
  }
  if (!isAssistantVoiceOptionId(body.voice)) {
    throw hostedOnboardingError({
      code: "ASSISTANT_PERSONA_INVALID_VOICE",
      httpStatus: 400,
      message: "Choose a valid voice.",
    });
  }
  return {
    persona: body.persona,
    tone: body.tone,
    voice: body.voice,
  };
}

async function signalHostedMailboxAppendBestEffort(input: {
  expectedUserId: string;
  mailboxItemId: string;
}): Promise<void> {
  try {
    await signalHostedMailboxAppendRuntime(input);
  } catch {
    // The durable preference save succeeds even when the best-effort wake is unavailable.
  }
}
