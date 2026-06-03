import {
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { checkpointHostedWorkspace } from "@/src/lib/hosted-workspace/store";

const HOSTED_WORKSPACE_CHECKPOINT_CALLBACK_BODY_LIMIT_BYTES = 256 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_WORKSPACE_CHECKPOINT_CALLBACK_BODY_LIMIT_BYTES,
  });
  const body = parseHostedWorkspaceCheckpointRequest(await readOptionalJsonObject(request));
  const result = await checkpointHostedWorkspace({
    expectedVersion: body.expectedWorkspaceVersion,
    reason: body.reason,
    snapshotRef: body.snapshotRef,
    userId,
    ...("nextWakeAt" in body ? { nextWakeAt: body.nextWakeAt } : {}),
    ...("nextWakeReason" in body ? { nextWakeReason: body.nextWakeReason } : {}),
    ...("redactedStatus" in body ? { redactedStatusJson: body.redactedStatus } : {}),
  });

  if (!result.workspace) {
    throw new TypeError("Hosted workspace checkpoint requires an existing workspace row.");
  }

  return jsonOk(parseHostedWorkspaceCheckpointResponse({
    checkpointed: result.status === "updated",
    workspace: {
      browserVaultReplicaRef: result.workspace.browserVaultReplicaRef,
      checkpointedAt: result.workspace.checkpointedAt,
      createdAt: result.workspace.createdAt,
      nextWakeAt: result.workspace.nextWakeAt,
      nextWakeReason: result.workspace.nextWakeReason,
      redactedStatus: result.workspace.redactedStatusJson,
      snapshotRef: result.workspace.snapshotRef,
      updatedAt: result.workspace.updatedAt,
      userId: result.workspace.userId,
      version: result.workspace.version,
    },
  }));
});
