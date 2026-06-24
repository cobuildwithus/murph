import {
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  signalHostedRuntimeRecheckRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
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
    ...("inboxMediaRetentionWakeAt" in body
      ? { inboxMediaRetentionWakeAt: body.inboxMediaRetentionWakeAt }
      : {}),
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

  await signalFutureWorkspaceWakeBestEffort({
    checkpointed: result.status === "updated",
    inboxMediaRetentionWakeAt: result.workspace.inboxMediaRetentionWakeAt,
    nextWakeAt: result.workspace.nextWakeAt,
    userId,
  });

  return jsonOk(parseHostedWorkspaceCheckpointResponse({
    checkpointed: result.status === "updated",
    ...(result.status === "conflict"
      ? { checkpointConflictReason: "workspace_version" }
      : result.status === "foreground_pending"
        ? { checkpointConflictReason: "foreground_pending" }
        : {}),
    ...(result.status === "updated"
      ? { replacedSnapshotRef: result.replacedSnapshotRef }
      : {}),
    workspace: {
      browserVaultReplicaRef: result.workspace.browserVaultReplicaRef,
      checkpointedAt: result.workspace.checkpointedAt,
      createdAt: result.workspace.createdAt,
      inboxMediaRetentionWakeAt: result.workspace.inboxMediaRetentionWakeAt,
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

async function signalFutureWorkspaceWakeBestEffort(input: {
  checkpointed: boolean;
  inboxMediaRetentionWakeAt: string | null;
  nextWakeAt: string | null;
  userId: string;
}): Promise<void> {
  if (
    !input.checkpointed
    || (
      !isFutureIsoTimestamp(input.nextWakeAt)
      && !isFutureIsoTimestamp(input.inboxMediaRetentionWakeAt)
    )
  ) {
    return;
  }

  try {
    await signalHostedRuntimeRecheckRuntime({
      userId: input.userId,
    });
  } catch (error) {
    console.warn("Hosted workspace wake recheck signal failed after checkpoint.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

function isFutureIsoTimestamp(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) && parsedMs > Date.now();
}
