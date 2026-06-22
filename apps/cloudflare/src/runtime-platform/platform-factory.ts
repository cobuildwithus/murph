import {
  readHostedRunnerCommitTimeoutMs,
  type HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import type { HostedWebCallbackSigningEnvironment } from "../web-callback-auth.ts";
import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import { createCloudflareArtifactStore } from "./artifact-store.ts";
import { createCloudflareBrowserVaultReplicaPort } from "./browser-vault-replica-port.ts";
import { createHostedWebDeviceSyncPort } from "./device-sync-port.ts";
import { createCloudflareEffectsPort } from "./effects-port.ts";
import { createCloudflareGeneratedImageUploader } from "./generated-image-uploader.ts";
import { createHostedRuntimeIssueExportPort } from "./issue-export-port.ts";
import { createHostedWebRuntimeLatencyTracePort } from "./latency-trace-port.ts";
import { createHostedWebRuntimeLogPort } from "./log-port.ts";
import { createHostedWebVaultSharePort } from "./vault-share-port.ts";
import { createHostedWebMailboxPort } from "./mailbox-port.ts";
import {
  createCloudflareHostedInternalFetch,
  createCloudflareHostedProviderFetch,
  createCloudflareHostedTrustedInternalFetch,
} from "./provider-fetch.ts";
import { createCloudflareHostedPublicInternetFetch } from "./public-internet-fetch.ts";
import { createHostedRuntimeUsageRecordPort } from "./usage-record-port.ts";
import { resolveHostedWebControlTransport } from "./web-control-transport.ts";
import { createHostedWebWorkspacePort } from "./workspace-port.ts";
import { createCloudflareWorkspaceSnapshotPort } from "./workspace-snapshot-port.ts";

export function buildHostedExecutionRuntimePlatform(input: {
  boundUserId: string;
  commitTimeoutMs?: number | null;
  fetchImpl?: typeof fetch;
  providerFetchBaseUrlSource?: Readonly<Record<string, unknown>> | null;
  providerFetchBaseUrls?: readonly string[] | null;
  proxyBoundUserIdHeader?: boolean | null;
  webCallbackSigning?: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl?: string | null;
  workspaceCheckpointBridge?: HostedWorkspaceCheckpointBridgeAuthority | null;
}): HostedRuntimePlatform {
  const baseFetchImpl = input.fetchImpl ?? fetch;
  const fetchImpl = createCloudflareHostedInternalFetch(
    input.boundUserId,
    baseFetchImpl,
    {
      injectBoundUserIdHeader: input.proxyBoundUserIdHeader ?? false,
      readCurrentLease: input.workspaceCheckpointBridge?.readCurrentLease,
    },
  );
  const trustedInternalFetchImpl = createCloudflareHostedTrustedInternalFetch(
    input.boundUserId,
    baseFetchImpl,
    {
      injectBoundUserIdHeader: input.proxyBoundUserIdHeader ?? false,
    },
  );
  const timeoutMs = readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs ?? null);
  const transport = resolveHostedWebControlTransport({
    webCallbackSigning: input.webCallbackSigning ?? null,
    webControlBaseUrl: input.webControlBaseUrl ?? null,
    workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
  });
  const deviceSyncPort = transport
    ? createHostedWebDeviceSyncPort({
        boundUserId: input.boundUserId,
        fetchImpl,
        timeoutMs,
        transport,
      })
    : null;

  return {
    artifactStore: createCloudflareArtifactStore({
      fetchImpl: trustedInternalFetchImpl,
      timeoutMs,
      workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
    }),
    ...(input.workspaceCheckpointBridge
      ? {
          workspaceSnapshotPort: createCloudflareWorkspaceSnapshotPort({
            boundUserId: input.boundUserId,
            fetchImpl: trustedInternalFetchImpl,
            timeoutMs,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge,
          }),
        }
      : {}),
    ...(input.workspaceCheckpointBridge
      ? {
          generatedImageUploader: createCloudflareGeneratedImageUploader({
            fetchImpl: trustedInternalFetchImpl,
            timeoutMs,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge,
          }),
          providerFetch: createCloudflareHostedProviderFetch(
            input.boundUserId,
            baseFetchImpl,
            {
              injectBoundUserIdHeader: true,
              providerFetchBaseUrlSource:
                input.providerFetchBaseUrlSource ?? undefined,
              providerFetchBaseUrls: input.providerFetchBaseUrls ?? undefined,
              readCurrentLease: input.workspaceCheckpointBridge.readCurrentLease,
            },
          ),
        }
      : {}),
    connectedAppsAvailable: transport !== null,
    publicInternetFetch: createCloudflareHostedPublicInternetFetch(baseFetchImpl),
    ...(transport
      ? {
          logPort: createHostedWebRuntimeLogPort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport,
          }),
          latencyTracePort: createHostedWebRuntimeLatencyTracePort({
            boundUserId: input.boundUserId,
            fetchImpl: trustedInternalFetchImpl,
            timeoutMs,
            transport,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
          }),
          mailboxPort: createHostedWebMailboxPort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport,
          }),
          vaultSharePort: createHostedWebVaultSharePort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport,
          }),
          workspacePort: createHostedWebWorkspacePort({
            boundUserId: input.boundUserId,
            fetchImpl: trustedInternalFetchImpl,
            timeoutMs,
            transport,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
          }),
        }
      : {}),
    ...(deviceSyncPort ? { deviceSyncPort } : {}),
    ...(input.workspaceCheckpointBridge
      ? {
          browserVaultReplicaPort: createCloudflareBrowserVaultReplicaPort({
            boundUserId: input.boundUserId,
            fetchImpl: trustedInternalFetchImpl,
            timeoutMs,
            transport,
            workspaceCheckpointBridge: input.workspaceCheckpointBridge,
          }),
        }
      : {}),
    effectsPort: createCloudflareEffectsPort({
      fetchImpl: trustedInternalFetchImpl,
      timeoutMs,
      workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
    }),
    ...(transport
      ? {
          issueExportPort: createHostedRuntimeIssueExportPort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport,
          }),
          usageRecordPort: createHostedRuntimeUsageRecordPort({
            boundUserId: input.boundUserId,
            fetchImpl,
            timeoutMs,
            transport,
          }),
        }
      : {}),
  };
}
