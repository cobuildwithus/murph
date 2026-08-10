import {
  isAssistantPersonaId,
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  type AssistantPersonaId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";

import { getPrisma } from "@/src/lib/prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";
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
const ASSISTANT_STYLE_REQUEST_FIELDS = new Set([
  "persona",
  "tone",
  "voice",
]);

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
    assistantPersona: result.assistantPersona,
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
  for (const key of Object.keys(body)) {
    if (!ASSISTANT_STYLE_REQUEST_FIELDS.has(key)) {
      throw hostedOnboardingError({
        code: "ASSISTANT_STYLE_UNKNOWN_FIELD",
        httpStatus: 400,
        message: "Assistant style request contains an unknown field.",
      });
    }
  }

  const persona = body.persona === undefined
    ? undefined
    : parseAssistantPersona(body.persona);
  const tone = body.tone === undefined
    ? undefined
    : parseAssistantTone(body.tone);
  const voice = body.voice === undefined
    ? undefined
    : parseAssistantVoice(body.voice);

  if (
    persona === undefined
    && tone === undefined
    && voice === undefined
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_STYLE_EMPTY_UPDATE",
      httpStatus: 400,
      message: "Choose a persona, tone, or voice before continuing.",
    });
  }

  return {
    ...(persona === undefined ? {} : { persona }),
    ...(tone === undefined ? {} : { tone }),
    ...(voice === undefined ? {} : { voice }),
  };
}

function parseAssistantPersona(value: unknown): AssistantPersonaId {
  if (isAssistantPersonaId(value)) return value;
  throw hostedOnboardingError({
    code: "ASSISTANT_STYLE_INVALID_PERSONA",
    httpStatus: 400,
    message: "Choose a valid Murph persona.",
  });
}

function parseAssistantTone(value: unknown): AssistantTonePreference {
  if (isAssistantTonePreference(value)) return value;
  throw hostedOnboardingError({
    code: "ASSISTANT_STYLE_INVALID_TONE",
    httpStatus: 400,
    message: "Choose a valid tone.",
  });
}

function parseAssistantVoice(value: unknown): AssistantVoiceOptionId {
  if (isAssistantVoiceOptionId(value)) return value;
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
  const deadlineMs = createHostedPostCommitDeadline(undefined);
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs,
      operation: (abortSignal) => signalHostedMailboxAppendRuntime({
        ...input,
        abortSignal,
      }),
    });
  } catch {
    // The durable save succeeds even when the best-effort runtime wake is unavailable.
  }
}
