import {
  parseHostedBrowserVaultReplicaPublishRequest,
  parseHostedBrowserVaultReplicaPublishResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { publishHostedBrowserVaultReplicaRef } from "@/src/lib/hosted-workspace/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedBrowserVaultReplicaPublishRequest(
    await readOptionalJsonObject(request),
  );
  const result = await publishHostedBrowserVaultReplicaRef({
    ...(body.expectedSourceStateHash === undefined
      ? {}
      : { expectedSourceStateHash: body.expectedSourceStateHash }),
    replicaRef: body.replicaRef,
    userId,
  });

  if (!result.workspace) {
    return jsonOk(parseHostedBrowserVaultReplicaPublishResponse({
      published: false,
      workspace: null,
    }), 404);
  }

  return jsonOk(parseHostedBrowserVaultReplicaPublishResponse({
    published: result.status === "published",
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
