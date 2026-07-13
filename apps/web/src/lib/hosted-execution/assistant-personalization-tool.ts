import "server-only";

import type {
  HostedRuntimeAssistantPersonalizationSnapshot,
  HostedRuntimeAssistantPersonalizationToolRequest,
  HostedRuntimeAssistantPersonalizationToolResponse,
} from "@murphai/hosted-execution/assistant-personalization";
import {
  defaultAssistantTonePreference,
  defaultAssistantVoiceOptionId,
} from "@murphai/contracts";

import { getPrisma } from "@/src/lib/prisma";
import {
  assertHostedMemberAssistantPersonalizationEligible,
  readHostedMemberAssistantModelPreference,
  updateHostedMemberAssistantModelPreferenceTx,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedMemberAssistantPreferences,
  upsertHostedMemberAssistantPreferencesTx,
} from "@/src/lib/hosted-onboarding/member-preferences";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

type HostedRuntimeAssistantPersonalizationUpdateResponse = Extract<
  HostedRuntimeAssistantPersonalizationToolResponse,
  { action: "update" }
>;

interface HostedRuntimeAssistantPersonalizationTransactionResult {
  dispatch: { mailboxItemId: string } | null;
  response: HostedRuntimeAssistantPersonalizationUpdateResponse;
}

export async function handleHostedRuntimeAssistantPersonalizationTool(input: {
  memberId: string;
  request: HostedRuntimeAssistantPersonalizationToolRequest;
  scheduleMailboxWake?: (input: {
    expectedUserId: string;
    mailboxItemId: string;
  }) => void;
}): Promise<HostedRuntimeAssistantPersonalizationToolResponse> {
  if (input.request.action === "read") {
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
  const prisma = getPrisma();
  let transactionResult: HostedRuntimeAssistantPersonalizationTransactionResult;
  try {
    transactionResult = await prisma.$transaction(async (tx) => {
      await assertHostedMemberAssistantPersonalizationEligible({
        memberId: input.memberId,
        prisma: tx,
      });
      // Check and persist the billing-gated model choice before any style write.
      // An ineligible Sol request therefore cannot append a style mailbox event;
      // the transaction also rolls back the model if a later style write fails.
      const modelUpdateResult = request.model === undefined
        ? null
        : await updateHostedMemberAssistantModelPreferenceTx({
            memberId: input.memberId,
            model: request.model,
            prisma: tx,
          });
      const styleResult = request.tone !== undefined || request.voice !== undefined
        ? await upsertHostedMemberAssistantPreferencesTx({
            memberId: input.memberId,
            occurredAt: new Date().toISOString(),
            preferences: {
              ...(request.tone === undefined ? {} : { tone: request.tone }),
              ...(request.voice === undefined ? {} : { voice: request.voice }),
            },
            prisma: tx,
            sourceType: "assistant.personalization-tool",
          })
        : null;
      const model = modelUpdateResult
        ?? await readHostedMemberAssistantModelPreference({
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
      const modelPreferenceUpdated = modelUpdateResult?.updated ?? false;
      const modelUpdated = modelUpdateResult?.effectiveModelUpdated ?? false;
      const styleUpdated = styleResult?.updated ?? false;
      const updated = modelPreferenceUpdated || styleUpdated;

      return {
        dispatch: styleResult?.dispatch ?? null,
        response: {
          action: "update" as const,
          result: {
            model: model.model,
            modelChangeAppliesNextRun: modelUpdated,
            modelUpdated,
            rejectionReason: null,
            solAvailable: model.solAvailable,
            status: updated ? "saved" as const : "unchanged" as const,
            styleUpdated,
            tone: effectiveTone,
            updated,
            voice: effectiveVoice,
          },
        },
      };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "ASSISTANT_MODEL_SOL_REQUIRES_EDGE"
    ) {
      return {
        action: "update",
        result: {
          ...await readHostedAssistantPersonalization(input.memberId),
          modelChangeAppliesNextRun: false,
          modelUpdated: false,
          rejectionReason: "sol_requires_edge",
          status: "rejected",
          styleUpdated: false,
          updated: false,
        },
      };
    }
    throw error;
  }

  if (transactionResult.dispatch) {
    input.scheduleMailboxWake?.({
      expectedUserId: input.memberId,
      mailboxItemId: transactionResult.dispatch.mailboxItemId,
    });
  }

  return transactionResult.response;
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
