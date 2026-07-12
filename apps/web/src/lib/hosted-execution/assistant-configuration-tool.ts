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
  const expectedApprovalRequest = buildHostedAssistantConfigurationApprovalRequest({
    changes: updateRequest,
    returnContactKind: updateRequest.approval.request.returnContactKind,
    target: updateRequest.target,
  });
  if (
    serializeHostedActionApprovalRequest(expectedApprovalRequest) !==
    serializeHostedActionApprovalRequest(updateRequest.approval.request)
  ) {
    throw hostedOnboardingError({
      code: "ACTION_APPROVAL_UNAVAILABLE",
      httpStatus: 403,
      message: "Secure approval is unavailable for this change.",
    });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const approval = await consumeHostedActionApproval({
        memberId: input.memberId,
        prisma: tx,
        request: updateRequest.approval,
      });
      if (approval.status !== "approved") {
        throw hostedOnboardingError({
          code: "ACTION_APPROVAL_UNAVAILABLE",
          httpStatus: 403,
          message: "Secure approval is unavailable for this change.",
        });
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
        updatedConfiguration.model !== updateRequest.target.model ||
        updatedConfiguration.reasoningEffort !==
          updateRequest.target.reasoningEffort
      ) {
        throw hostedOnboardingError({
          code: "ACTION_APPROVAL_UNAVAILABLE",
          httpStatus: 403,
          message: "Secure approval is unavailable for this change.",
        });
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
