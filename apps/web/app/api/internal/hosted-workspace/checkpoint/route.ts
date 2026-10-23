import {
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { checkpointHostedRuntimeWorkspace } from "@/src/lib/hosted-workspace/runtime-publication";
import { readHostedRuntimeCallbackAuthority } from "@/src/lib/hosted-execution/runtime-write-fence";
import { createHostedRuntimeCallbackTiming } from "@/src/lib/hosted-execution/runtime-callback-timing";

const HOSTED_WORKSPACE_CHECKPOINT_CALLBACK_BODY_LIMIT_BYTES = 256 * 1024;
const runWithTiming = createHostedRuntimeCallbackTiming("checkpoint");

type CheckpointFailureStage =
  | "request_body"
  | "request_schema"
  | "runtime_authority"
  | "publication"
  | "response";

export const POST = withJsonError((request: Request) => runWithTiming(request, async (timing) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    runtimeAuthority: "caller_transaction",
    maxBodyBytes: HOSTED_WORKSPACE_CHECKPOINT_CALLBACK_BODY_LIMIT_BYTES,
  });
  timing.authenticated();
  let failureStage: CheckpointFailureStage = "request_body";
  try {
    const requestBody = await readOptionalJsonObject(request);
    failureStage = "request_schema";
    const body = parseHostedWorkspaceCheckpointRequest(requestBody);
    failureStage = "runtime_authority";
    const runtimeAuthority = readHostedRuntimeCallbackAuthority(request, {
      attemptId: body.attemptId,
      leaseGeneration: body.leaseGeneration,
      workspaceVersion: body.expectedWorkspaceVersion,
    });
    failureStage = "publication";
    const result = await checkpointHostedRuntimeWorkspace({
      runtimeAuthority,
      expectedVersion: body.expectedWorkspaceVersion,
      ...(body.handledConversationMailboxItemIds === undefined
        ? {}
        : {
            handledConversationMailboxItemIds:
              body.handledConversationMailboxItemIds,
          }),
      ...("inboxMediaRetentionWakeAt" in body
        ? { inboxMediaRetentionWakeAt: body.inboxMediaRetentionWakeAt }
        : {}),
      // Legacy runtimes omit the capability group. Persist that as an explicit
      // all-null epoch so a rollback fails open instead of retaining stale gates.
      nextDefaultProcessingWakeAt:
        body.nextDefaultProcessingWakeAt ?? null,
      nextDefaultProcessingWakeReason:
        body.nextDefaultProcessingWakeReason ?? null,
      reason: body.reason,
      snapshotRef: body.snapshotRef,
      systemMailboxProgressGeneration:
        body.systemMailboxProgressGeneration ?? null,
      userId,
      ...("nextWakeAt" in body ? { nextWakeAt: body.nextWakeAt } : {}),
      ...("nextWakeReason" in body ? { nextWakeReason: body.nextWakeReason } : {}),
      ...("redactedStatus" in body ? { redactedStatusJson: body.redactedStatus } : {}),
    });

    if (!result.workspace) {
      throw new TypeError("Hosted workspace checkpoint requires an existing workspace row.");
    }

    failureStage = "response";
    return jsonOk(parseHostedWorkspaceCheckpointResponse({
      checkpointed: result.status === "updated",
      ...(result.status === "conflict"
        ? { checkpointConflictReason: "workspace_version" }
        : {}),
      ...(result.conversationInputAhead === undefined
        ? {}
        : { conversationInputAhead: result.conversationInputAhead }),
      ...(result.status === "updated"
        ? { replacedSnapshotRef: result.replacedSnapshotRef }
        : {}),
      workspace: {
        browserVaultReplicaRef: result.workspace.browserVaultReplicaRef,
        checkpointedAt: result.workspace.checkpointedAt,
        createdAt: result.workspace.createdAt,
        inboxMediaRetentionWakeAt: result.workspace.inboxMediaRetentionWakeAt,
        nextDefaultProcessingWakeAt:
          result.workspace.nextDefaultProcessingWakeAt,
        nextDefaultProcessingWakeReason:
          result.workspace.nextDefaultProcessingWakeReason,
        nextWakeAt: result.workspace.nextWakeAt,
        nextWakeReason: result.workspace.nextWakeReason,
        redactedStatus: result.workspace.redactedStatusJson,
        snapshotRef: result.workspace.snapshotRef,
        systemMailboxProgressGeneration:
          result.workspace.systemMailboxProgressGeneration,
        updatedAt: result.workspace.updatedAt,
        userId: result.workspace.userId,
        version: result.workspace.version,
      },
    }));
  } catch (error) {
    reportCheckpointFailure(failureStage, error);
    throw error;
  }
}));

function reportCheckpointFailure(stage: CheckpointFailureStage, error: unknown): void {
  try {
    const code = stage === "publication" && error instanceof TypeError && "code" in error
      ? error.code : undefined;
    console.warn("Hosted workspace checkpoint failed.", {
      errorClass: error instanceof TypeError ? "type_error"
        : error instanceof RangeError ? "range_error"
        : error instanceof Error ? "error" : "non_error",
      ...(code === "HOSTED_WORKSPACE_PROGRESS_REGRESSED"
        || code === "HOSTED_WORKSPACE_PROGRESS_SKIPPED_INCREMENT"
        || code === "HOSTED_WORKSPACE_PROGRESS_INVALID_INITIAL"
        ? { errorCode: code } : {}),
      schema: "murph.hosted-workspace.checkpoint.failure.v1",
      stage,
    });
  } catch {
    // Failure telemetry must never replace the original checkpoint failure.
  }
}
