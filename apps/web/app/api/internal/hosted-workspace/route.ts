import {
  buildHostedExecutionPrefixedSafeErrorDiagnostics,
} from "@murphai/hosted-execution";
import {
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import { HOSTED_ASSISTANT_ASTRA_MODEL } from "@murphai/hosted-execution/assistant-model";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { getPrisma } from "@/src/lib/prisma";
import {
  resolveHostedRuntimeAiUsageGate,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import {
  readHostedMemberAssistantModelPreference,
  type HostedMemberAssistantModelResolution,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";
import { runWithHostedWorkspaceReadTiming } from "@/src/lib/hosted-workspace/read-timing";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const HOSTED_WORKSPACE_READ_CALLBACK_BODY_LIMIT_BYTES = 0;

// Admission policy for workspace reads lives in the mode-aware runtime owner
// (`runtime-reconciliation-facts.ts` blocks inactive members from default
// processing and confines them to `inbox_media_retention` dispatch). Repeating
// the active-entitlement check here would block the retention run that the
// owner just authorized, leaving raw inbox media past the 14-day retention.
export const GET = withJsonError((request: Request) => runWithHostedWorkspaceReadTiming(request, async (timing) => {
  const userId = await timing.measure("authentication", () => requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_WORKSPACE_READ_CALLBACK_BODY_LIMIT_BYTES,
  }));
  timing.authenticated();
  const prisma = getPrisma();
  const [workspace, assistantConfiguration, usageGate] = await Promise.all([
    timing.measure("workspace", () => readHostedWorkspace({ userId })),
    timing.measure("configuration", () => readHostedAssistantConfiguration({
      memberId: userId,
      prisma,
    })),
    timing.measure("usage", () => resolveHostedRuntimeAiUsageGate({ mode: "read_only", prisma, userId })),
  ]);

  return timing.measure("response", () => jsonOk(parseHostedWorkspaceReadResponse({
    fetchedAt: new Date().toISOString(),
    ...projectHostedAssistantModelAuthority(assistantConfiguration),
    ...(assistantConfiguration?.hostedAssistantModelOverride
      ? { hostedAssistantModelOverride: assistantConfiguration.hostedAssistantModelOverride }
      : {}),
    ...(assistantConfiguration?.hostedAssistantReasoningEffortOverride
      ? { hostedAssistantReasoningEffortOverride: assistantConfiguration.hostedAssistantReasoningEffortOverride }
      : {}),
    platformAiUsageAllowed: usageGate.status === "allowed",
    workspace: workspace
      ? {
          browserVaultReplicaRef: workspace.browserVaultReplicaRef,
          checkpointedAt: workspace.checkpointedAt,
          createdAt: workspace.createdAt,
          inboxMediaRetentionWakeAt: workspace.inboxMediaRetentionWakeAt,
          nextDefaultProcessingWakeAt: workspace.nextDefaultProcessingWakeAt,
          nextDefaultProcessingWakeReason:
            workspace.nextDefaultProcessingWakeReason,
          nextWakeAt: workspace.nextWakeAt,
          nextWakeReason: workspace.nextWakeReason,
          redactedStatus: workspace.redactedStatusJson,
          snapshotRef: workspace.snapshotRef,
          systemMailboxProgressGeneration:
            workspace.systemMailboxProgressGeneration,
          updatedAt: workspace.updatedAt,
          userId: workspace.userId,
          version: workspace.version,
        }
      : null,
  })));
}));

function projectHostedAssistantModelAuthority(
  configuration: HostedMemberAssistantModelResolution | null,
) {
  return {
    ...(configuration?.hostedAssistantPriorityUntil
      ? { hostedAssistantPriorityUntil: configuration.hostedAssistantPriorityUntil }
      : {}),
    hostedAssistantAstraAllowed: configuration?.availableModels.includes(HOSTED_ASSISTANT_ASTRA_MODEL) === true,
    hostedAssistantSubagentModelOverridesAllowed: configuration?.solAvailable === true,
  };
}

async function readHostedAssistantConfiguration(
  input: {
    memberId: string;
    prisma: Parameters<typeof readHostedMemberAssistantModelPreference>[0]["prisma"];
  },
): Promise<HostedMemberAssistantModelResolution | null> {
  try {
    return await readHostedMemberAssistantModelPreference(input);
  } catch (error) {
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
