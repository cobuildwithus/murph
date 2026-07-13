import {
  buildHostedExecutionPrefixedSafeErrorDiagnostics,
} from "@murphai/hosted-execution";
import {
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { getPrisma } from "@/src/lib/prisma";
import {
  readHostedMemberAssistantModelPreference,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";
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
  const [workspace, assistantConfiguration] = await Promise.all([
    readHostedWorkspace({ userId }),
    readHostedMemberAssistantModelPreference({
      memberId: userId,
      prisma: getPrisma(),
    }).catch((error: unknown) => {
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
    }),
  ]);

  return jsonOk(parseHostedWorkspaceReadResponse({
    fetchedAt: new Date().toISOString(),
    ...(assistantConfiguration?.hostedAssistantModelOverride
      ? {
          hostedAssistantModelOverride:
            assistantConfiguration.hostedAssistantModelOverride,
        }
      : {}),
    ...(assistantConfiguration?.hostedAssistantReasoningEffortOverride
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
