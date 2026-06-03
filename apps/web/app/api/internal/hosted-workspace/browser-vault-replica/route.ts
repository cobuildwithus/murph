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
  readLegacyExpectedSourceStateHash,
} from "@/src/lib/hosted-workspace/legacy-source-hash-browser-vault";
import {
  publishLatestBrowserVaultReplicaRef,
} from "@/src/lib/hosted-workspace/store";

const HOSTED_RUNTIME_ATTEMPT_ID_HEADER = "x-hosted-runtime-attempt-id";
const HOSTED_RUNTIME_LEASE_GENERATION_HEADER = "x-hosted-runtime-lease-generation";
const HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER = "x-hosted-runtime-workspace-version";
const HOSTED_BROWSER_VAULT_REPLICA_CALLBACK_BODY_LIMIT_BYTES = 256 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_BROWSER_VAULT_REPLICA_CALLBACK_BODY_LIMIT_BYTES,
  });
  const writeFence = readHostedRuntimeWriteFenceHeaders(request);
  const rawBody = await readOptionalJsonObject(request);
  const body = parseHostedBrowserVaultReplicaPublishRequest(rawBody);
  const legacyExpectedSourceStateHash =
    readLegacyExpectedSourceStateHash(rawBody);
  const result = legacyExpectedSourceStateHash === null
    ? await publishLatestBrowserVaultReplicaRef({
        expectedWorkspaceVersion: writeFence.workspaceVersion,
        replicaRef: body.replicaRef,
        userId,
      })
    : await publishLegacySourceHashBrowserVaultReplicaRef({
        expectedSourceStateHash: legacyExpectedSourceStateHash,
        expectedWorkspaceVersion: writeFence.workspaceVersion,
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

function readHostedRuntimeWriteFenceHeaders(request: Request): {
  attemptId: string;
  leaseGeneration: string;
  workspaceVersion: string;
} {
  const attemptId = request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER);
  const leaseGeneration = request.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER);
  const workspaceVersion = request.headers.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);

  if (!attemptId || !leaseGeneration || !workspaceVersion) {
    throw new TypeError("Hosted browser-vault replica publish requires runtime write-fence headers.");
  }

  return {
    attemptId,
    leaseGeneration,
    workspaceVersion,
  };
}
