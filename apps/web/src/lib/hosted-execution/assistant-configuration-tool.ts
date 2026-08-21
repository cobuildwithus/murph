import "server-only";

import type {
  HostedRuntimeAssistantConfigurationSnapshot,
  HostedRuntimeAssistantConfigurationControlRequest,
  HostedRuntimeAssistantConfigurationToolResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  readHostedMemberAssistantModelPreference,
  updateHostedMemberAssistantConfigurationTx,
} from "../hosted-onboarding/assistant-model-preference";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import {
  readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
} from "../hosted-mailbox/store";
import { getPrisma } from "../prisma";

export async function handleHostedRuntimeAssistantConfigurationTool(input: {
  memberId: string;
  request: HostedRuntimeAssistantConfigurationControlRequest;
}): Promise<HostedRuntimeAssistantConfigurationToolResponse> {
  const prisma = getPrisma();
  if (input.request.action === "read") {
    return {
      action: "read",
      result: projectHostedRuntimeAssistantConfigurationSnapshot(
        await readHostedMemberAssistantModelPreference({
          memberId: input.memberId,
          prisma,
        }),
      ),
    };
  }
  const updateRequest = input.request;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const inputAuthority =
        await readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
          assistantInputId: updateRequest.assistantInputId,
          memberId: input.memberId,
          prisma: tx,
        });
      if (inputAuthority === null) {
        throw hostedOnboardingError({
          code: "ASSISTANT_CONFIGURATION_INPUT_AUTHORITY_INVALID",
          httpStatus: 403,
          message: "Assistant configuration is unavailable for this turn.",
        });
      }
      const updatedConfiguration = await updateHostedMemberAssistantConfigurationTx({
        memberId: input.memberId,
        ...(updateRequest.model === undefined
          ? {}
          : { model: updateRequest.model }),
        prisma: tx,
        ...(updateRequest.provider === undefined
          ? {}
          : { provider: updateRequest.provider }),
        ...(updateRequest.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: updateRequest.reasoningEffort }),
      });
      return updatedConfiguration;
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

    return {
      action: "update",
      result: {
        ...projectHostedRuntimeAssistantConfigurationSnapshot(updated),
        appliesAt: "next_turn",
        requiredPlan: null,
        status: updated.updated ? "updated" : "unchanged",
      },
    };
  } catch (error) {
    if (
      !isHostedOnboardingError(error) ||
      (
        error.code !== "ASSISTANT_MODEL_SOL_REQUIRES_EDGE" &&
        error.code !== "ASSISTANT_PROVIDER_VENICE_UNAVAILABLE" &&
        error.code !== "ASSISTANT_CONFIGURATION_PERSONAL_CHAT_REQUIRED" &&
        error.code !== "HOSTED_ACCESS_REQUIRED"
      )
    ) {
      throw error;
    }

    const current = projectHostedRuntimeAssistantConfigurationSnapshot(
      await readHostedMemberAssistantModelPreference({
        memberId: input.memberId,
        prisma,
      }),
    );
    const upgradeRequired = error.code === "ASSISTANT_MODEL_SOL_REQUIRES_EDGE";
    return {
      action: "update",
      result: {
        ...current,
        appliesAt: "next_turn",
        requiredPlan: upgradeRequired ? "edge" : null,
        status: upgradeRequired ? "upgrade_required" : "unavailable",
      },
    };
  }
}

function projectHostedRuntimeAssistantConfigurationSnapshot(input: {
  availableModels: readonly HostedRuntimeAssistantConfigurationSnapshot["model"][];
  availableProviders: readonly HostedRuntimeAssistantConfigurationSnapshot["provider"][];
  availableReasoningEfforts: readonly HostedRuntimeAssistantConfigurationSnapshot["reasoningEffort"][];
  configurationAvailable: boolean;
  dormantSolPreference: boolean;
  model: HostedRuntimeAssistantConfigurationSnapshot["model"];
  provider: HostedRuntimeAssistantConfigurationSnapshot["provider"];
  reasoningEffort: HostedRuntimeAssistantConfigurationSnapshot["reasoningEffort"];
  solAvailable: boolean;
}): HostedRuntimeAssistantConfigurationSnapshot {
  return {
    availableModels: [...input.availableModels],
    availableProviders: [...input.availableProviders],
    availableReasoningEfforts: [...input.availableReasoningEfforts],
    configurationAvailable: input.configurationAvailable,
    dormantSolPreference: input.dormantSolPreference,
    model: input.model,
    provider: input.provider,
    reasoningEffort: input.reasoningEffort,
    solAvailable: input.solAvailable,
  };
}
