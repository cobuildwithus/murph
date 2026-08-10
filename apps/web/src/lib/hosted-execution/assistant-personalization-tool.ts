import "server-only";

import { createHash } from "node:crypto";

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
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  assistantPersonalitySettingIds,
  resolveAssistantPersonaCombinationId,
  resolveAssistantPersonaParts,
  resolveAssistantEffectiveStyle,
  type AssistantBasePersonaId,
  type AssistantPersonaId,
  type AssistantPersonalityPreferences,
  type AssistantPreferenceFieldId,
} from "@murphai/contracts";

import { getPrisma } from "@/src/lib/prisma";
import {
  readHostedMemberAssistantModelPreference,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";
import {
  readHostedMemberAssistantPreferences,
  upsertHostedMemberAssistantPreferencesTx,
  type HostedMemberAssistantPersonalitySnapshot,
} from "@/src/lib/hosted-onboarding/member-preferences";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import {
  requireHostedRuntimeActiveAccess,
  requireHostedRuntimeActiveAccessForUpdateTx,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
  readHostedMailboxConversationWakeByAssistantInputId,
  type HostedMailboxStoreClient,
} from "@/src/lib/hosted-mailbox/store";
import { assertHostedLinqRouteEgressAuthority } from "@/src/lib/hosted-routing/thread-route-store";

type HostedRuntimeAssistantPersonalityUpdateResponse = Extract<
  HostedRuntimeAssistantPersonalizationToolResponse,
  { action: typeof HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION }
>;

interface HostedRuntimeAssistantPersonalityTransactionResult {
  dispatch: { mailboxItemId: string } | null;
  response: HostedRuntimeAssistantPersonalityUpdateResponse;
}

interface HostedRuntimeAssistantPreferenceWriteAuthority {
  occurredAt: string;
  preferenceCausalSeq?: string;
  updateId: string;
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
    await requireHostedRuntimeActiveAccess(input.memberId, {
      prisma: getPrisma(),
    });
    return {
      action: "read",
      result: await readHostedAssistantPersonalization(input.memberId),
    };
  }

  const request = input.request;
  const authority = input.authority;
  if (!authority) {
    throw new TypeError("Assistant personalization update requires action authority.");
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
    const personaRequested = request.mainPersona !== undefined
      || request.supportingPersona !== undefined;
    const requestedFields: AssistantPreferenceFieldId[] = [
      ...(personaRequested ? ["persona" as const] : []),
      ...(request.tone === undefined ? [] : ["tone" as const]),
      ...(request.voice === undefined ? [] : ["voice" as const]),
    ];
    const writeAuthority =
      await resolveHostedRuntimeAssistantPreferenceWriteAuthority({
        authority,
        memberId: input.memberId,
        operation: personaRequested ? "personalization" : "tone-voice",
        prisma: tx,
        requestedFields,
      });
    const currentPreferences = personaRequested
      ? await readHostedMemberAssistantPreferences({
          memberId: input.memberId,
          prisma: tx,
        })
      : null;
    const requestedPersona = currentPreferences
      ? resolveRequestedAssistantPersona({
          currentPersona: resolveHostedAssistantEffectiveStyle(currentPreferences).persona,
          mainPersona: request.mainPersona,
          supportingPersona: request.supportingPersona,
        })
      : null;
    const styleResult = await upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: input.memberId,
      occurredAt: writeAuthority.occurredAt,
      ...(writeAuthority.preferenceCausalSeq === undefined
        ? {}
        : { preferenceCausalSeq: writeAuthority.preferenceCausalSeq }),
      preferences: {
        ...(requestedPersona === null ? {} : { persona: requestedPersona }),
        ...(request.tone === undefined ? {} : { tone: request.tone }),
        ...(request.voice === undefined ? {} : { voice: request.voice }),
      },
      prisma: tx,
      updateId: writeAuthority.updateId,
    });
    const model = await readHostedMemberAssistantModelPreference({
      memberId: input.memberId,
      prisma: tx,
    });
    const preferences = {
      persona: styleResult.assistantPersona,
      personality: styleResult.assistantPersonality,
      tone: styleResult.assistantTone,
      voice: styleResult.assistantVoice,
    };
    const effectiveStyle = resolveHostedAssistantEffectiveStyle(preferences);
    const personaParts = resolveAssistantPersonaParts(effectiveStyle.persona);
    const effectiveTone = effectiveStyle.tone;
    const effectiveVoice = effectiveStyle.voice;
    const styleUpdated = styleResult.updated;

    return {
      dispatch: styleResult.dispatch,
      response: {
        action: "update" as const,
        result: {
          mainPersona: personaParts.mainId,
          model: model.model,
          modelChangeAppliesNextRun: false as const,
          modelUpdated: false as const,
          solAvailable: model.solAvailable,
          status: styleUpdated ? "saved" as const : "unchanged" as const,
          supportingPersona: personaParts.supportingId,
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
    const writeAuthority =
      await resolveHostedRuntimeAssistantPreferenceWriteAuthority({
        authority: input.authority,
        memberId: input.memberId,
        operation: "personality",
        prisma: tx,
        requestedFields: assistantPersonalitySettingIds.filter(
          (settingId) => input.personality[settingId] !== undefined,
        ),
      });
    const styleResult = await upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: input.memberId,
      occurredAt: writeAuthority.occurredAt,
      ...(writeAuthority.preferenceCausalSeq === undefined
        ? {}
        : { preferenceCausalSeq: writeAuthority.preferenceCausalSeq }),
      preferences: {
        personality: input.personality,
      },
      prisma: tx,
      updateId: writeAuthority.updateId,
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
          settings: buildHostedAssistantPersonalitySettings({
            persona: styleResult.assistantPersona,
            personality: styleResult.assistantPersonality,
          }),
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

function buildHostedAssistantPersonalitySettings(input: {
  persona: AssistantPersonaId | null;
  personality: HostedMemberAssistantPersonalitySnapshot;
}): HostedRuntimeAssistantPersonalitySettings {
  const effective = resolveHostedAssistantEffectiveStyle(input).personality;
  return {
    detail: buildHostedAssistantPersonalitySetting({
      defaultValue: effective.detail,
      value: input.personality.detail,
    }),
    humor: buildHostedAssistantPersonalitySetting({
      defaultValue: effective.humor,
      value: input.personality.humor,
    }),
    push: buildHostedAssistantPersonalitySetting({
      defaultValue: effective.push,
      value: input.personality.push,
    }),
    unhinged: buildHostedAssistantPersonalitySetting({
      defaultValue: effective.unhinged,
      value: input.personality.unhinged,
    }),
  };
}

function resolveHostedAssistantEffectiveStyle(input: {
  persona?: AssistantPersonaId | null;
  personality?: HostedMemberAssistantPersonalitySnapshot;
  tone?: string | null;
  voice?: string | null;
}) {
  const personality: AssistantPersonalityPreferences = {};
  for (const settingId of assistantPersonalitySettingIds) {
    const value = input.personality?.[settingId];
    if (value !== null && value !== undefined) personality[settingId] = value;
  }
  return resolveAssistantEffectiveStyle({
    ...(input.persona ? { persona: input.persona } : {}),
    ...(input.tone === "formal" || input.tone === "casual"
      ? { tone: input.tone }
      : {}),
    ...(input.voice ? { voice: input.voice } : {}),
    personality,
  });
}

function buildHostedAssistantPersonalitySetting(input: {
  defaultValue: number;
  value: number | null;
}): { source: "custom" | "default"; value: number } {
  return input.value === null
    ? { source: "default", value: input.defaultValue }
    : { source: "custom", value: input.value };
}

async function resolveHostedRuntimeAssistantPreferenceWriteAuthority(input: {
  authority: HostedRuntimeAssistantPersonalizationToolAuthority;
  memberId: string;
  operation: "personalization" | "personality" | "tone-voice";
  prisma: HostedMailboxStoreClient;
  requestedFields: readonly AssistantPreferenceFieldId[];
}): Promise<HostedRuntimeAssistantPreferenceWriteAuthority> {
  await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, {
    prisma: input.prisma,
  });
  if ("automationId" in input.authority) {
    return {
      occurredAt: input.authority.occurrenceAt,
      updateId: buildHostedAssistantPreferenceUpdateId({
        authority: input.authority,
        operation: input.operation,
        requestedFields: input.requestedFields,
      }),
    };
  }
  await requireHostedAssistantStyleInputAuthority({
    assistantInputId: input.authority.assistantInputId,
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const inputAuthority =
    await readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
      assistantInputId: input.authority.assistantInputId,
      memberId: input.memberId,
      prisma: input.prisma,
    });
  if (!inputAuthority) {
    throw new TypeError("Assistant personalization input authority is invalid.");
  }
  return {
    occurredAt: inputAuthority.occurredAt,
    preferenceCausalSeq: inputAuthority.causalSeq,
    updateId: buildHostedAssistantPreferenceUpdateId({
      authority: input.authority,
      operation: input.operation,
      requestedFields: input.requestedFields,
    }),
  };
}

function buildHostedAssistantPreferenceUpdateId(input: {
  authority: HostedRuntimeAssistantPersonalizationToolAuthority;
  operation: "personalization" | "personality" | "tone-voice";
  requestedFields: readonly AssistantPreferenceFieldId[];
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      origin: "automationId" in input.authority
        ? {
            automationId: input.authority.automationId,
            kind: "automation_occurrence",
            occurrenceAt: input.authority.occurrenceAt,
          }
        : {
            assistantInputId: input.authority.assistantInputId,
            kind: "accepted_input",
          },
      operation: input.operation,
      requestedFields: [...input.requestedFields].sort(),
      schema: "murph.assistant-preference-update.v2",
      toolCallId: input.authority.toolCallId ?? null,
    }))
    .digest("hex");
}

async function requireHostedAssistantStyleInputAuthority(input: {
  assistantInputId: string;
  memberId: string;
  prisma: HostedMailboxStoreClient;
}): Promise<void> {
  const container = await input.prisma.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: input.memberId },
  });
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.assistantInputId,
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (!wake) {
    throw new TypeError("Assistant personalization input authority is invalid.");
  }

  if (!container) {
    if (!isHostedDirectAssistantStyleWake(wake)) {
      throw new TypeError("Assistant personalization input authority is invalid.");
    }
    return;
  }

  const authority = isHostedLinqConversationMessageWake(wake)
    ? wake.message.routeAuthority
    : null;
  if (
    !isHostedLinqConversationMessageWake(wake)
    || wake.message.linqMessage.threadIsDirect !== false
    || !authority
    || authority.containerMemberId !== input.memberId
    || authority.threadId !== wake.message.linqMessage.chatId
  ) {
    throw new TypeError("Assistant personalization input authority is invalid.");
  }

  const route = await assertHostedLinqRouteEgressAuthority({
    authority,
    prisma: input.prisma,
  });
  if (route.containerMemberId !== input.memberId) {
    throw new TypeError("Assistant personalization input authority is invalid.");
  }
}

function isHostedDirectAssistantStyleWake(
  wake: HostedExecutionConversationMessageWake,
): boolean {
  if (isHostedLinqConversationMessageWake(wake)) {
    return wake.message.linqMessage.threadIsDirect === true;
  }
  if (isHostedEmailConversationMessageWake(wake)) {
    return wake.message.threadIsDirect === true
      && wake.message.assistantStyleSettingsAuthorized === true;
  }
  return isHostedTelegramConversationMessageWake(wake);
}

async function readHostedAssistantPersonalization(
  memberId: string,
): Promise<HostedRuntimeAssistantPersonalizationSnapshot> {
  const prisma = getPrisma();
  const [preferences, model] = await Promise.all([
    readHostedMemberAssistantPreferences({ memberId, prisma }),
    readHostedMemberAssistantModelPreference({ memberId, prisma }),
  ]);

  const effective = resolveHostedAssistantEffectiveStyle(preferences);
  const personaParts = resolveAssistantPersonaParts(effective.persona);
  return {
    mainPersona: personaParts.mainId,
    model: model.model,
    solAvailable: model.solAvailable,
    supportingPersona: personaParts.supportingId,
    tone: effective.tone,
    voice: effective.voice,
  };
}

function resolveRequestedAssistantPersona(input: {
  currentPersona: AssistantPersonaId;
  mainPersona?: AssistantBasePersonaId;
  supportingPersona?: AssistantBasePersonaId | null;
}): AssistantPersonaId {
  const current = resolveAssistantPersonaParts(input.currentPersona);
  const main = input.mainPersona ?? current.mainId;
  let supporting = input.supportingPersona === undefined
    ? current.supportingId
    : input.supportingPersona;
  if (
    input.mainPersona !== undefined
    && input.supportingPersona === undefined
    && supporting === main
  ) {
    supporting = null;
  }
  if (supporting === main) {
    throw new TypeError("Supporting persona must differ from the main persona.");
  }
  return resolveAssistantPersonaCombinationId(main, supporting);
}
