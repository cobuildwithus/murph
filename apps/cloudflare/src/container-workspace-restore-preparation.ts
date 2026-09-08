import {
  startHostedWorkspaceRestorePreparation,
  type HostedWorkspaceRestorePreparation,
  type HostedWorkspaceRestorePreparationPlatform,
} from "@murphai/assistant-runtime/hosted-workspace-restore-preparation";
import type {
  HostedRuntimeBridgeCheckpointLease,
} from "@murphai/assistant-runtime/hosted-checkpoint-bridge";
import {
  readHostedRunnerCommitTimeoutMs,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";

import {
  prepareHostedRunnerWarmWorkspaceVaultRoot,
} from "./hosted-runner-warm-workspace.ts";
import type {
  HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";
import type {
  HostedWorkspaceCheckpointBridgeAuthority,
} from "./runtime-platform/authority-headers.ts";
import {
  createCloudflareArtifactStore,
} from "./runtime-platform/artifact-store.ts";
import {
  createCloudflareMediaStore,
} from "./runtime-platform/media-store.ts";
import {
  createHostedWebRuntimeLogPort,
} from "./runtime-platform/log-port.ts";
import {
  createCloudflareHostedInternalFetch,
  createCloudflareHostedTrustedInternalFetch,
} from "./runtime-platform/provider-fetch.ts";
import {
  resolveHostedWebControlTransport,
} from "./runtime-platform/web-control-transport.ts";
import {
  createHostedWebWorkspacePort,
} from "./runtime-platform/workspace-port.ts";
import {
  createCloudflareWorkspaceSnapshotPort,
} from "./runtime-platform/workspace-snapshot-port.ts";

export async function prepareHostedContainerWorkspaceRestore(input: {
  job: HostedExecutionWorkspaceInvocationJobInput;
  signal: AbortSignal;
}): Promise<HostedWorkspaceRestorePreparation> {
  const vaultRoot = await prepareHostedRunnerWarmWorkspaceVaultRoot(
    input.job.request.userId,
  );
  let currentLease: HostedRuntimeBridgeCheckpointLease = {
    attemptId: input.job.request.attemptId,
    leaseGeneration: input.job.request.leaseGeneration,
    providerEgressToken: input.job.request.providerEgressToken ?? null,
    userId: input.job.request.userId,
    workspaceVersion: input.job.request.workspaceVersion,
  };
  const workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority = {
    readCurrentLease: () => currentLease,
    recordCheckpoint: ({ workspaceVersion }) => {
      currentLease = {
        ...currentLease,
        workspaceVersion,
      };
    },
  };
  const internalFetch = createCloudflareHostedInternalFetch(
    input.job.request.userId,
    fetch,
    {
      injectBoundUserIdHeader: true,
      readCurrentLease: workspaceCheckpointBridge.readCurrentLease,
    },
  );
  const trustedInternalFetch = createCloudflareHostedTrustedInternalFetch(
    input.job.request.userId,
    fetch,
    {
      injectBoundUserIdHeader: true,
    },
  );
  const transport = resolveHostedWebControlTransport({
    webCallbackSigning: null,
    webControlBaseUrl: null,
    workspaceCheckpointBridge,
  });
  if (!transport) {
    throw new Error("Hosted workspace restore preparation requires Web control transport.");
  }
  const timeoutMs = readHostedRunnerCommitTimeoutMs(
    input.job.runtime?.commitTimeoutMs ?? null,
  );
  const platform: HostedWorkspaceRestorePreparationPlatform = {
    artifactStore: createCloudflareArtifactStore({
      fetchImpl: trustedInternalFetch,
      timeoutMs,
      workspaceCheckpointBridge,
    }),
    mediaStore: createCloudflareMediaStore({
      fetchImpl: trustedInternalFetch,
      timeoutMs,
      workspaceCheckpointBridge,
    }),
    logPort: createHostedWebRuntimeLogPort({
      boundUserId: input.job.request.userId,
      fetchImpl: internalFetch,
      timeoutMs,
      transport,
    }),
    workspacePort: createHostedWebWorkspacePort({
      boundUserId: input.job.request.userId,
      fetchImpl: trustedInternalFetch,
      timeoutMs,
      transport,
      workspaceCheckpointBridge,
    }),
    workspaceSnapshotPort: createCloudflareWorkspaceSnapshotPort({
      boundUserId: input.job.request.userId,
      fetchImpl: trustedInternalFetch,
      preparedSnapshotRestore: input.job.preparedSnapshotRestore ?? null,
      timeoutMs,
      workspaceCheckpointBridge,
    }),
  };

  return startHostedWorkspaceRestorePreparation({
    job: input.job,
    platform,
    signal: input.signal,
    vaultRoot,
  });
}
