import "server-only";

import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
  type HostedRuntimeAssistantPersonalitySettings,
  type HostedRuntimeAssistantPersonalityUpdate,
  type HostedRuntimeAssistantPersonalityUpdateOutcomes,
  type HostedRuntimeAssistantPersonalizationToolAuthority,
  type HostedRuntimeAssistantPersonalizationSnapshot,
  type HostedRuntimeAssistantPersonalizationToolRequest,
  type HostedRuntimeAssistantPersonalizationToolResponse,
} from "@murphai/hosted-execution/assistant-personalization";
import {
  assistantPersonalitySettingIds,
  assistantPersonalityCausalWritesEnabled,
  defaultAssistantPersonalityScores,
  defaultAssistantTonePreference,
  defaultAssistantVoiceOptionId,
  type AssistantPreferenceFieldId,
} from "@murphai/contracts";

import { getPrisma } from "@/src/lib/prisma";
import {
  assertHostedMemberAssistantPersonalizationEligible,
  readHostedMemberAssistantModelPreference,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";
import { assertActiveHostedMemberAccessAllowed } from "@/src/lib/hosted-onboarding/member-access";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedMemberAssistantPreferences,
  upsertHostedMemberAssistantPreferencesTx,
  type HostedMemberAssistantPersonalitySnapshot,
} from "@/src/lib/hosted-onboarding/member-preferences";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "@/src/lib/hosted-onboarding/shared";
import {
  readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx,
  type HostedMailboxStoreClient,
} from "@/src/lib/hosted-mailbox/store";

type HostedRuntimeAssistantPersonalityUpdateResponse = Extract<
  HostedRuntimeAssistantPersonalizationToolResponse,
  { action: typeof HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION }
>;

interface HostedRuntimeAssistantPersonalityTransactionResult {
  dispatch: { mailboxItemId: string } | null;
  response: HostedRuntimeAssistantPersonalityUpdateResponse;
}

export async function handleHostedRuntimeAssistantPersonalizationTool(input: {
  authority?: HostedRuntimeAssistantPersonalizationToolAuthority;
  memberId: string;
  request: HostedRuntimeAssistantPersonalizationToolRequest;
  scheduleMailboxWake?: (input: {
    expectedUserId: string;
    mailboxItemId: string;
  }) => void;
}): Promise<HostedRuntimeAssistantPersonalizationToolResponse> {
  if (input.request.action === "read") {
    await assertActiveHostedMemberAccessAllowed({
      memberId: input.memberId,
      prisma: getPrisma(),
    });
    await assertHostedMemberAssistantPersonalizationEligible({
      memberId: input.memberId,
      prisma: getPrisma(),
    });
    return {
      action: "read",
      result: await readHostedAssistantPersonalization(input.memberId),
    };
  }

  const request = input.request;
  if (
    request.action === HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION
    && !assistantPersonalityCausalWritesEnabled(process.env)
  ) {
    throw hostedOnboardingError({
      code: "ASSISTANT_PERSONALITY_ROLLOUT_PENDING",
      httpStatus: 503,
      message: "Personality settings are temporarily unavailable during rollout.",
      retryable: true,
    });
  }
  const authority = input.authority;
  if (!authority) {
    throw new TypeError("Assistant personalization update requires assistant input authority.");
  }
  if (request.action === HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION) {
    return handleHostedRuntimeAssistantPersonalityUpdate({
      authority,
      memberId: input.memberId,
      personality: request.personality,
      ...(input.scheduleMailboxWake
        ? { scheduleMailboxWake: input.scheduleMailboxWake }
        : {}),
    });
  }
  const prisma = getPrisma();
  const transactionResult = await prisma.$transaction(async (tx) => {
    const preferenceCausalSeq =
      await requireHostedRuntimeAssistantPreferenceCausalSeq({
        assistantInputId: authority.assistantInputId,
        memberId: input.memberId,
        prisma: tx,
      });
    const styleResult = request.tone !== undefined || request.voice !== undefined
      ? await upsertHostedMemberAssistantPreferencesTx({
          causalOrigin: "turn",
          mailboxPayloadMode: assistantPersonalityCausalWritesEnabled(process.env)
            ? "sparse_delta"
            : "legacy_snapshot",
          memberId: input.memberId,
          occurredAt: new Date().toISOString(),
          preferenceCausalSeq,
          preferences: {
            ...(request.tone === undefined ? {} : { tone: request.tone }),
            ...(request.voice === undefined ? {} : { voice: request.voice }),
          },
          prisma: tx,
        })
      : null;
    const model = await readHostedMemberAssistantModelPreference({
        memberId: input.memberId,
        prisma: tx,
      });
    const preferences = styleResult
      ? {
          tone: styleResult.assistantTone,
          voice: styleResult.assistantVoice,
        }
      : await readHostedMemberAssistantPreferences({
          memberId: input.memberId,
          prisma: tx,
        });
    const effectiveTone = preferences.tone ?? defaultAssistantTonePreference;
    const effectiveVoice = preferences.voice ?? defaultAssistantVoiceOptionId;
    const styleUpdated = styleResult?.updated ?? false;

    return {
      dispatch: styleResult?.dispatch ?? null,
      response: {
        action: "update" as const,
        result: {
          model: model.model,
          modelChangeAppliesNextRun: false as const,
          modelUpdated: false as const,
          solAvailable: model.solAvailable,
          status: styleUpdated ? "saved" as const : "unchanged" as const,
          tone: effectiveTone,
          voice: effectiveVoice,
        },
      },
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (transactionResult.dispatch) {
    input.scheduleMailboxWake?.({
      expectedUserId: input.memberId,
      mailboxItemId: transactionResult.dispatch.mailboxItemId,
    });
  }

  return transactionResult.response;
}

async function handleHostedRuntimeAssistantPersonalityUpdate(input: {
  authority: HostedRuntimeAssistantPersonalizationToolAuthority;
  memberId: string;
  personality: HostedRuntimeAssistantPersonalityUpdate;
  scheduleMailboxWake?: (input: {
    expectedUserId: string;
    mailboxItemId: string;
  }) => void;
}): Promise<HostedRuntimeAssistantPersonalityUpdateResponse> {
  const prisma = getPrisma();
  const transactionResult = await prisma.$transaction(async (tx) => {
    const preferenceCausalSeq =
      await requireHostedRuntimeAssistantPreferenceCausalSeq({
        assistantInputId: input.authority.assistantInputId,
        memberId: input.memberId,
        prisma: tx,
      });
    const styleResult = await upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      mailboxPayloadMode: "sparse_delta",
      memberId: input.memberId,
      occurredAt: new Date().toISOString(),
      preferenceCausalSeq,
      preferences: {
        personality: input.personality,
      },
      prisma: tx,
    });
    const outcomes = buildHostedAssistantPersonalityUpdateOutcomes({
      appliedFields: styleResult.appliedFields,
      personality: styleResult.assistantPersonality,
      requested: input.personality,
    });

    return {
      dispatch: styleResult.dispatch,
      response: {
        action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
        result: {
          outcomes,
          settings: buildHostedAssistantPersonalitySettings(
            styleResult.assistantPersonality,
          ),
        },
      },
    } satisfies HostedRuntimeAssistantPersonalityTransactionResult;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (transactionResult.dispatch) {
    input.scheduleMailboxWake?.({
      expectedUserId: input.memberId,
      mailboxItemId: transactionResult.dispatch.mailboxItemId,
    });
  }

  return transactionResult.response;
}

function buildHostedAssistantPersonalityUpdateOutcomes(input: {
  appliedFields: ReadonlyArray<AssistantPreferenceFieldId>;
  personality: HostedMemberAssistantPersonalitySnapshot;
  requested: HostedRuntimeAssistantPersonalityUpdate;
}): HostedRuntimeAssistantPersonalityUpdateOutcomes {
  const outcomes: HostedRuntimeAssistantPersonalityUpdateOutcomes = {};
  for (const settingId of assistantPersonalitySettingIds) {
    const requestedValue = input.requested[settingId];
    if (requestedValue === undefined) {
      continue;
    }
    outcomes[settingId] = input.appliedFields.includes(settingId)
      ? "saved"
      : input.personality[settingId] === requestedValue
        ? "unchanged"
        : "superseded";
  }
  return outcomes;
}

function buildHostedAssistantPersonalitySettings(
  personality: HostedMemberAssistantPersonalitySnapshot,
): HostedRuntimeAssistantPersonalitySettings {
  return {
    detail: buildHostedAssistantPersonalitySetting({
      defaultValue: defaultAssistantPersonalityScores.detail,
      value: personality.detail,
    }),
    humor: buildHostedAssistantPersonalitySetting({
      defaultValue: defaultAssistantPersonalityScores.humor,
      value: personality.humor,
    }),
    push: buildHostedAssistantPersonalitySetting({
      defaultValue: defaultAssistantPersonalityScores.push,
      value: personality.push,
    }),
  };
}

function buildHostedAssistantPersonalitySetting(input: {
  defaultValue: number;
  value: number | null;
}): { source: "custom" | "default"; value: number } {
  return input.value === null
    ? { source: "default", value: input.defaultValue }
    : { source: "custom", value: input.value };
}

async function requireHostedRuntimeAssistantPreferenceCausalSeq(input: {
  assistantInputId: string;
  memberId: string;
  prisma: HostedMailboxStoreClient;
}): Promise<string> {
  await lockHostedMemberRow(input.prisma, input.memberId);
  await lockHostedMemberSponsoredAccessRows(input.prisma, input.memberId);
  await assertActiveHostedMemberAccessAllowed({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  await assertHostedMemberAssistantPersonalizationEligible({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const causalSeq = await readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx({
    assistantInputId: input.assistantInputId,
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (causalSeq === null) {
    throw new TypeError("Assistant personalization input authority is invalid.");
  }
  return causalSeq;
}

async function readHostedAssistantPersonalization(
  memberId: string,
): Promise<HostedRuntimeAssistantPersonalizationSnapshot> {
  const prisma = getPrisma();
  const [preferences, model] = await Promise.all([
    readHostedMemberAssistantPreferences({ memberId, prisma }),
    readHostedMemberAssistantModelPreference({ memberId, prisma }),
  ]);

  return {
    model: model.model,
    solAvailable: model.solAvailable,
    tone: preferences.tone ?? defaultAssistantTonePreference,
    voice: preferences.voice ?? defaultAssistantVoiceOptionId,
  };
}
