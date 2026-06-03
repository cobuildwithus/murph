import {
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const HOSTED_WORKSPACE_READ_CALLBACK_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_WORKSPACE_READ_CALLBACK_BODY_LIMIT_BYTES,
  });
  const workspace = await readHostedWorkspace({ userId });

  return jsonOk(parseHostedWorkspaceReadResponse({
    fetchedAt: new Date().toISOString(),
    workspace: workspace
      ? {
          browserVaultReplicaRef: workspace.browserVaultReplicaRef,
          checkpointedAt: workspace.checkpointedAt,
          createdAt: workspace.createdAt,
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
