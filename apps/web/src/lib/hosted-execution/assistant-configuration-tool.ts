import "server-only";

import type {
  HostedRuntimeAssistantConfigurationSnapshot,
  HostedRuntimeAssistantConfigurationControlRequest,
  HostedRuntimeAssistantConfigurationToolResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedAssistantConfigurationApprovalRequest,
} from "@murphai/hosted-execution/assistant-configuration-approval";
import {
  serializeHostedActionApprovalRequest,
} from "@murphai/hosted-execution/action-approval";

import { consumeHostedActionApproval } from "../action-approvals";
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
  readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx,
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
  if ("approval" in updateRequest) {
    const expectedApprovalRequest = buildHostedAssistantConfigurationApprovalRequest({
      changes: updateRequest,
      returnContactKind: updateRequest.approval.request.returnContactKind,
      target: updateRequest.target,
    });
    if (
      serializeHostedActionApprovalRequest(expectedApprovalRequest) !==
        serializeHostedActionApprovalRequest(updateRequest.approval.request)
    ) {
      throw actionApprovalUnavailable();
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if ("assistantInputId" in updateRequest) {
        const causalSeq =
          await readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx({
            assistantInputId: updateRequest.assistantInputId,
            memberId: input.memberId,
            prisma: tx,
          });
        if (causalSeq === null) {
          throw hostedOnboardingError({
            code: "ASSISTANT_CONFIGURATION_INPUT_AUTHORITY_INVALID",
            httpStatus: 403,
            message: "Assistant configuration is unavailable for this turn.",
          });
        }
      } else {
        const approval = await consumeHostedActionApproval({
          memberId: input.memberId,
          prisma: tx,
          request: updateRequest.approval,
        });
        if (approval.status !== "approved") {
          throw actionApprovalUnavailable();
        }
      }
      const updatedConfiguration = await updateHostedMemberAssistantConfigurationTx({
        memberId: input.memberId,
        ...(updateRequest.model === undefined
          ? {}
          : { model: updateRequest.model }),
        prisma: tx,
        ...(updateRequest.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: updateRequest.reasoningEffort }),
      });
      if (
        "target" in updateRequest
        && (
          updatedConfiguration.model !== updateRequest.target.model
          || updatedConfiguration.reasoningEffort !==
            updateRequest.target.reasoningEffort
        )
      ) {
        throw actionApprovalUnavailable();
      }
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

function actionApprovalUnavailable() {
  return hostedOnboardingError({
    code: "ACTION_APPROVAL_UNAVAILABLE",
    httpStatus: 403,
    message: "Secure approval is unavailable for this change.",
  });
}

function projectHostedRuntimeAssistantConfigurationSnapshot(input: {
  availableModels: readonly HostedRuntimeAssistantConfigurationSnapshot["model"][];
  availableReasoningEfforts: readonly HostedRuntimeAssistantConfigurationSnapshot["reasoningEffort"][];
  configurationAvailable: boolean;
  dormantSolPreference: boolean;
  model: HostedRuntimeAssistantConfigurationSnapshot["model"];
  reasoningEffort: HostedRuntimeAssistantConfigurationSnapshot["reasoningEffort"];
  solAvailable: boolean;
}): HostedRuntimeAssistantConfigurationSnapshot {
  return {
    availableModels: [...input.availableModels],
    availableReasoningEfforts: [...input.availableReasoningEfforts],
    configurationAvailable: input.configurationAvailable,
    dormantSolPreference: input.dormantSolPreference,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    solAvailable: input.solAvailable,
  };
}
