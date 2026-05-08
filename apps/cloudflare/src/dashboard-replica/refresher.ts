import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createHostedBrowserVaultReplicaForSourceState,
  readHostedBrowserVaultWarmSourceStateHash,
  restoreHostedWorkspaceRuntimeJobWorkspace,
} from "@murphai/assistant-runtime";
import {
  readDashboardReplicaSourceStateHash,
} from "@murphai/hosted-execution/dashboard-replica";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";

import {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  measureHostedBrowserVaultReplicaBytes,
} from "../browser-vault-limits.ts";
import {
  resolveHostedRunnerWarmWorkspaceVaultRoot,
} from "../node-runner-isolated.ts";
import type {
  buildHostedExecutionRuntimePlatform,
} from "../runtime-platform.ts";

type HostedRuntimePlatform = ReturnType<typeof buildHostedExecutionRuntimePlatform>;

export type DashboardReplicaRefreshResult =
  | {
      byteLength: number;
      replicaRef: HostedBrowserVaultReplicaRef;
      status: "written";
    }
  | {
      byteLength: number;
      maxBytes: number;
      status: "refresh_failed_too_large";
    }
  | {
      status: "already_fresh" | "stale_source" | "workspace_missing";
    };

export async function refreshDashboardReplicaFromCommittedWorkspace(input: {
  platform: HostedRuntimePlatform;
  sourceStateHash: string;
  userId: string;
}): Promise<DashboardReplicaRefreshResult> {
  const workspacePort = input.platform.workspacePort;
  if (!workspacePort?.read) {
    throw new TypeError("Dashboard replica refresh requires a workspace read port.");
  }
  if (!input.platform.browserVaultReplicaPort?.write) {
    throw new TypeError("Dashboard replica refresh requires a browser-vault replica write port.");
  }

  const workspaceRead = await workspacePort.read();
  const workspace = workspaceRead.workspace;
  if (!workspace) {
    return {
      status: "workspace_missing",
    };
  }

  const currentSourceStateHash = readDashboardReplicaSourceStateHash(workspace.snapshotRef);
  if (currentSourceStateHash !== input.sourceStateHash) {
    return {
      status: "stale_source",
    };
  }

  if (workspace.browserVaultReplicaRef?.sourceBundleHash === input.sourceStateHash) {
    return {
      status: "already_fresh",
    };
  }

  const warmResult = await tryRefreshDashboardReplicaFromWarmRoot({
    platform: input.platform,
    sourceStateHash: input.sourceStateHash,
    userId: input.userId,
  });
  if (warmResult) {
    return warmResult;
  }

  const refreshRoot = await mkdtemp(path.join(os.tmpdir(), "murph-dashboard-replica-refresh-"));
  try {
    const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
      platform: input.platform,
      vaultRoot: refreshRoot,
      workspace,
    });
    return await createAndWriteDashboardReplica({
      platform: input.platform,
      sourceStateHash: input.sourceStateHash,
      userId: input.userId,
      vaultRoot: restored.vaultRoot,
    });
  } finally {
    await rm(refreshRoot, {
      force: true,
      recursive: true,
    });
  }
}

async function tryRefreshDashboardReplicaFromWarmRoot(input: {
  platform: HostedRuntimePlatform;
  sourceStateHash: string;
  userId: string;
}): Promise<DashboardReplicaRefreshResult | null> {
  const warmVaultRoot = resolveHostedRunnerWarmWorkspaceVaultRoot(input.userId);
  const warmSourceStateHash = await readHostedBrowserVaultWarmSourceStateHash({
    vaultRoot: warmVaultRoot,
  });
  if (warmSourceStateHash !== input.sourceStateHash) {
    return null;
  }

  try {
    return await createAndWriteDashboardReplica({
      platform: input.platform,
      sourceStateHash: input.sourceStateHash,
      userId: input.userId,
      vaultRoot: warmVaultRoot,
    });
  } catch {
    return null;
  }
}

async function createAndWriteDashboardReplica(input: {
  platform: HostedRuntimePlatform;
  sourceStateHash: string;
  userId: string;
  vaultRoot: string;
}): Promise<Extract<DashboardReplicaRefreshResult, { status: "written" | "refresh_failed_too_large" }>> {
  const replica = await createHostedBrowserVaultReplicaForSourceState({
    generatedAt: new Date().toISOString(),
    sourceStateHash: input.sourceStateHash,
    vaultRoot: input.vaultRoot,
  });
  const byteLength = measureHostedBrowserVaultReplicaBytes(replica);
  if (byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) {
    return {
      byteLength,
      maxBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
      status: "refresh_failed_too_large",
    };
  }

  const replicaRef = await input.platform.browserVaultReplicaPort!.write({ replica });
  return {
    byteLength: replicaRef.byteLength,
    replicaRef,
    status: "written",
  };
}
