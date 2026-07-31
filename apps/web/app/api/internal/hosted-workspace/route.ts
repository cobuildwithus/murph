import {
  buildHostedExecutionPrefixedSafeErrorDiagnostics,
} from "@murphai/hosted-execution";
import {
  HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION_QUERY,
  isHostedCustomInferenceConsumerVersion,
} from "@murphai/hosted-execution/assistant-inference";
import {
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readSelectedHostedInferenceConnectionOverride,
} from "@/src/lib/hosted-inference/connection-store";
import { getPrisma } from "@/src/lib/prisma";
import {
  isHostedVeniceAssistantEnabled,
  readHostedMemberAssistantModelPreference,
  type HostedMemberAssistantModelResolution,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const HOSTED_WORKSPACE_READ_CALLBACK_BODY_LIMIT_BYTES = 0;

// Admission policy for workspace reads lives in the mode-aware runtime owner
// (`runtime-reconciliation-facts.ts` blocks inactive members from default
// processing and confines them to `inbox_media_retention` dispatch). Repeating
// the active-entitlement check here would block the retention run that the
// owner just authorized, leaving raw inbox media past the 14-day retention.
export const GET = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_WORKSPACE_READ_CALLBACK_BODY_LIMIT_BYTES,
  });
  const customInferenceConsumerSupported =
    isHostedCustomInferenceConsumerVersion(
      new URL(request.url).searchParams.get(
        HOSTED_CUSTOM_INFERENCE_CONSUMER_VERSION_QUERY,
      ),
    );
  const prisma = getPrisma();
  const [workspace, assistantConfiguration] = await Promise.all([
    readHostedWorkspace({ userId }),
    readHostedAssistantConfigurationFailingClosedForCustomInference({
      memberId: userId,
      prisma,
    }),
  ]);

  if (assistantConfiguration?.customInferenceReverificationRequired) {
    throw hostedOnboardingError({
      code: "HOSTED_INFERENCE_CONNECTION_REVERIFICATION_REQUIRED",
      httpStatus: 409,
      message:
        "Reverify the selected custom inference connection before using this Murph runtime.",
    });
  }
  if (
    assistantConfiguration?.customInferenceSelected
    && !customInferenceConsumerSupported
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_CUSTOM_INFERENCE_CONSUMER_UNSUPPORTED",
      httpStatus: 409,
      message:
        "This hosted runtime does not support the selected custom inference connection.",
    });
  }
  const customInferenceOverride =
    assistantConfiguration?.hostedAssistantCustomInferenceOverride ?? null;
  if (
    assistantConfiguration?.customInferenceSelected
    && !customInferenceOverride
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_INFERENCE_CONNECTION_INVALID",
      httpStatus: 409,
      message: "The selected custom inference connection is invalid.",
    });
  }

  return jsonOk(parseHostedWorkspaceReadResponse({
    fetchedAt: new Date().toISOString(),
    ...(customInferenceOverride
      ? { hostedAssistantCustomInferenceOverride: customInferenceOverride }
      : assistantConfiguration?.hostedAssistantModelOverride
        ? {
            hostedAssistantModelOverride:
              assistantConfiguration.hostedAssistantModelOverride,
          }
        : {}),
    ...(!customInferenceOverride
        && assistantConfiguration?.hostedAssistantProviderOverride
        && isHostedVeniceAssistantEnabled()
      ? {
          hostedAssistantProviderOverride:
            assistantConfiguration.hostedAssistantProviderOverride,
        }
      : {}),
    ...(!customInferenceOverride
        && assistantConfiguration?.hostedAssistantReasoningEffortOverride
      ? {
          hostedAssistantReasoningEffortOverride:
            assistantConfiguration.hostedAssistantReasoningEffortOverride,
        }
      : {}),
    workspace: workspace
      ? {
          browserVaultReplicaRef: workspace.browserVaultReplicaRef,
          checkpointedAt: workspace.checkpointedAt,
          createdAt: workspace.createdAt,
          inboxMediaRetentionWakeAt: workspace.inboxMediaRetentionWakeAt,
          nextWakeAt: workspace.nextWakeAt,
          nextWakeReason: workspace.nextWakeReason,
          redactedStatus: workspace.redactedStatusJson,
          snapshotRef: workspace.snapshotRef,
          updatedAt: workspace.updatedAt,
          userId: workspace.userId,
          version: workspace.version,
        }
      : null,
  }));
});

async function readHostedAssistantConfigurationFailingClosedForCustomInference(
  input: {
    memberId: string;
    prisma: Parameters<typeof readHostedMemberAssistantModelPreference>[0]["prisma"];
  },
): Promise<HostedMemberAssistantModelResolution | null> {
  try {
    return await readHostedMemberAssistantModelPreference(input);
  } catch (error) {
    // Managed inference historically tolerates a transient preference read
    // failure by using fleet defaults. That fallback is unsafe when a member
    // selected custom inference, so confirm the singular custom selection
    // before preserving the managed-only behavior.
    const selectedCustomInference =
      await readSelectedHostedInferenceConnectionOverride(input);
    if (selectedCustomInference) {
      throw error;
    }
    console.warn(
      "Hosted workspace assistant configuration read failed; using fleet defaults.",
      {
        ...buildHostedExecutionPrefixedSafeErrorDiagnostics({
          error,
          prefix: "preferenceRead",
        }),
        errorCode: "HOSTED_WORKSPACE_ASSISTANT_CONFIGURATION_READ_FAILED",
        fallback: "fleet_default",
        operation: "read_hosted_member_assistant_configuration",
      },
    );
    return null;
  }
}
