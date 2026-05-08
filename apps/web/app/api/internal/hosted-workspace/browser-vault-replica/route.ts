import {
  parseHostedBrowserVaultReplicaPublishRequest,
  parseHostedBrowserVaultReplicaPublishResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  publishLegacySourceHashBrowserVaultReplicaRef,
  publishLatestBrowserVaultReplicaRef,
} from "@/src/lib/hosted-workspace/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const rawBody = await readOptionalJsonObject(request);
  const body = parseHostedBrowserVaultReplicaPublishRequest(rawBody);
  const legacyExpectedSourceStateHash =
    readLegacyExpectedSourceStateHash(rawBody);
  const result = legacyExpectedSourceStateHash === null
    ? await publishLatestBrowserVaultReplicaRef({
        replicaRef: body.replicaRef,
        userId,
      })
    : await publishLegacySourceHashBrowserVaultReplicaRef({
        expectedSourceStateHash: legacyExpectedSourceStateHash,
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

function readLegacyExpectedSourceStateHash(
  body: Record<string, unknown>,
): string | null {
  if (!Object.hasOwn(body, "expectedSourceStateHash")) {
    return null;
  }
  if (typeof body.expectedSourceStateHash !== "string" || !body.expectedSourceStateHash.trim()) {
    throw new TypeError(
      "Legacy hosted browser-vault replica publish expectedSourceStateHash must be a non-empty string.",
    );
  }
  return body.expectedSourceStateHash;
}
