import {
  assistantWebPersonalityPreferencesSchema,
  assistantWebPersonalitySettingIds,
  isAssistantPersonaId,
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  type AssistantPersonaId,
  type AssistantPersonalityPreferences,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
  type AssistantWebPersonalitySettingId,
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
  "personality",
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
    // Project to the web-visible dials so the conversational-only Unhinged score
    // never crosses the server boundary into browser network or client state,
    // even when the saved personality includes it. The client filters again as
    // defense in depth.
    assistantPersonality: projectWebVisiblePersonality(result.assistantPersonality),
    assistantTone: result.assistantTone,
    assistantVoice: result.assistantVoice,
    ok: true,
    runTriggered: result.dispatch !== null,
    updated: result.updated,
  });
});

function projectWebVisiblePersonality(
  personality: Record<string, number | null>,
): Record<AssistantWebPersonalitySettingId, number | null> {
  const projected = {} as Record<AssistantWebPersonalitySettingId, number | null>;
  for (const id of assistantWebPersonalitySettingIds) {
    projected[id] = personality[id] ?? null;
  }
  return projected;
}
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
  const personality = body.personality === undefined
    ? undefined
    : parseAssistantPersonality(body.personality);
  const tone = body.tone === undefined
    ? undefined
    : parseAssistantTone(body.tone);
  const voice = body.voice === undefined
    ? undefined
    : parseAssistantVoice(body.voice);

  if (
    personality !== undefined
    && (persona !== undefined || tone !== undefined || voice !== undefined)
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_STYLE_MIXED_UPDATE",
      httpStatus: 400,
      message: "Update personality separately from persona, tone, and voice.",
    });
  }

  if (
    persona === undefined
    && personality === undefined
    && tone === undefined
    && voice === undefined
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_STYLE_EMPTY_UPDATE",
      httpStatus: 400,
      message: "Choose a persona, tone, voice, or personality setting before continuing.",
    });
  }

  return {
    ...(persona === undefined ? {} : { persona }),
    ...(personality === undefined ? {} : { personality }),
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

function parseAssistantPersonality(value: unknown): AssistantPersonalityPreferences {
  // The browser Settings surface only exposes the web-visible dials. The
  // conversational-only `unhinged` dial is rejected as an unknown key here and
  // can be changed only through Murph in conversation.
  const result = assistantWebPersonalityPreferencesSchema.safeParse(value);
  if (result.success && Object.keys(result.data).length > 0) return result.data;
  throw hostedOnboardingError({
    code: "ASSISTANT_STYLE_INVALID_PERSONALITY",
    httpStatus: 400,
    message: "Choose a valid personality setting.",
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
