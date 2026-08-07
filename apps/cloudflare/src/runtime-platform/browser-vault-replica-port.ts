import {
  parseHostedBrowserVaultReplicaPublishResponse,
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH } from "@murphai/hosted-execution/routes";

import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../internal-hosts.ts";
import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import { requireHostedRuntimeWriteFenceHeaders } from "./authority-headers.ts";
import { fetchHostedJson, readRequiredField } from "./hosted-http.ts";
import { fetchHostedWebControlPlaneJson, type HostedWebControlTransport } from "./web-control-transport.ts";

export function createCloudflareBrowserVaultReplicaPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport | null;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}) {
  return {
    ...(input.transport
      ? {
          async publishRef(publishInput: {
            replicaRef: NonNullable<ReturnType<typeof parseHostedBrowserVaultReplicaRef>>;
            signal?: AbortSignal | null;
          }) {
            const payload = await fetchHostedWebControlPlaneJson({
              body: {
                replicaRef: publishInput.replicaRef,
              },
              boundUserId: input.boundUserId,
              description: "Hosted browser-vault replica publish",
              fetchImpl: input.fetchImpl,
              headers: await createHostedBrowserVaultReplicaPublishHeaders({
                workspaceCheckpointBridge: input.workspaceCheckpointBridge,
              }),
              path: HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
              signal: publishInput.signal ?? null,
              timeoutMs: input.timeoutMs,
              transport: input.transport!,
              acceptedStatuses: [404, 409],
            });

            return parseHostedBrowserVaultReplicaPublishResponse(payload);
          },
        }
      : {}),
    async write(writeInput: {
      replica: unknown;
      replacedReplicaRef?: NonNullable<ReturnType<typeof parseHostedBrowserVaultReplicaRef>> | null;
      signal?: AbortSignal | null;
    }) {
      const payload = await fetchHostedJson({
        body: {
          replica: writeInput.replica,
          replacedReplicaRef: writeInput.replacedReplicaRef ?? null,
        },
        description: "Hosted browser-vault replica write",
        fetchImpl: input.fetchImpl,
        headers: await createHostedBrowserVaultReplicaWriteHeaders({
          workspaceCheckpointBridge: input.workspaceCheckpointBridge,
        }),
        method: "POST",
        signal: writeInput.signal ?? null,
        timeoutMs: input.timeoutMs,
        url: new URL(
          "/replicas",
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.browserVaultReplicaStore}/`,
        ),
      });
      const replicaRef = parseHostedBrowserVaultReplicaRef(
        readRequiredField(payload, "replicaRef"),
        "Hosted browser-vault replica write response.replicaRef",
      );

      if (!replicaRef) {
        throw new TypeError(
          "Hosted browser-vault replica write response.replicaRef must not be null.",
        );
      }

      return replicaRef;
    },
  };
}

export async function createHostedBrowserVaultReplicaWriteHeaders(input: {
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}): Promise<Headers> {
  if (!input.workspaceCheckpointBridge) {
    throw new Error("Hosted browser-vault replica write requires a runtime write fence.");
  }
  return await requireHostedRuntimeWriteFenceHeaders(
    input.workspaceCheckpointBridge,
    "Browser-vault replica write",
  );
}

async function createHostedBrowserVaultReplicaPublishHeaders(input: {
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}): Promise<Headers> {
  if (!input.workspaceCheckpointBridge) {
    throw new Error("Hosted browser-vault replica publish requires a runtime write fence.");
  }
  return await requireHostedRuntimeWriteFenceHeaders(
    input.workspaceCheckpointBridge,
    "Browser-vault replica publish",
  );
}
