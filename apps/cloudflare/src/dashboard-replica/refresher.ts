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
import type {
  HostedBrowserVaultReplicaPublishResponse,
} from "@murphai/hosted-execution/runtime-control";

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
      status: "published";
    }
  | {
      byteLength: number;
      maxBytes: number;
      status: "refresh_failed_too_large";
    }
  | {
      status: "already_fresh" | "publish_conflict" | "stale_source" | "workspace_missing";
    };

export async function refreshDashboardReplicaFromCommittedWorkspace(input: {
  platform: HostedRuntimePlatform;
  signal?: AbortSignal;
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
  if (!input.platform.browserVaultReplicaPort.publishRef) {
    throw new TypeError("Dashboard replica refresh requires a browser-vault replica publish port.");
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
    signal: input.signal,
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
    return await createWriteAndPublishDashboardReplica({
      platform: input.platform,
      signal: input.signal,
      sourceStateHash: input.sourceStateHash,
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
  signal?: AbortSignal;
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
    return await createWriteAndPublishDashboardReplica({
      platform: input.platform,
      signal: input.signal,
      sourceStateHash: input.sourceStateHash,
      vaultRoot: warmVaultRoot,
    });
  } catch {
    return null;
  }
}

async function createWriteAndPublishDashboardReplica(input: {
  platform: HostedRuntimePlatform;
  signal?: AbortSignal;
  sourceStateHash: string;
  vaultRoot: string;
}): Promise<DashboardReplicaRefreshResult> {
  throwIfDashboardReplicaRefreshAborted(input.signal);
  const replica = await createHostedBrowserVaultReplicaForSourceState({
    generatedAt: new Date().toISOString(),
    sourceStateHash: input.sourceStateHash,
    vaultRoot: input.vaultRoot,
  });
  throwIfDashboardReplicaRefreshAborted(input.signal);
  const byteLength = measureHostedBrowserVaultReplicaBytes(replica);
  if (byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) {
    return {
      byteLength,
      maxBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
      status: "refresh_failed_too_large",
    };
  }

  const replicaRef = await input.platform.browserVaultReplicaPort!.write({ replica });
  assertDashboardReplicaWriteResult({
    byteLength,
    expectedSourceStateHash: input.sourceStateHash,
    replicaRef,
  });
  throwIfDashboardReplicaRefreshAborted(input.signal);

  const publish = await input.platform.browserVaultReplicaPort!.publishRef!({
    expectedSourceStateHash: input.sourceStateHash,
    replicaRef,
  });
  if (!publish.published) {
    return classifyDashboardReplicaPublishMiss({
      sourceStateHash: input.sourceStateHash,
      workspace: publish.workspace,
    });
  }

  return {
    byteLength: replicaRef.byteLength,
    replicaRef,
    status: "published",
  };
}

function classifyDashboardReplicaPublishMiss(input: {
  sourceStateHash: string;
  workspace: HostedBrowserVaultReplicaPublishResponse["workspace"];
}): Extract<
  DashboardReplicaRefreshResult,
  { status: "already_fresh" | "publish_conflict" | "stale_source" | "workspace_missing" }
> {
  if (!input.workspace) {
    return {
      status: "workspace_missing",
    };
  }

  if (readDashboardReplicaSourceStateHash(input.workspace.snapshotRef) !== input.sourceStateHash) {
    return {
      status: "stale_source",
    };
  }

  if (input.workspace.browserVaultReplicaRef?.sourceBundleHash === input.sourceStateHash) {
    return {
      status: "already_fresh",
    };
  }

  return {
    status: "publish_conflict",
  };
}

function assertDashboardReplicaWriteResult(input: {
  byteLength: number;
  expectedSourceStateHash: string;
  replicaRef: HostedBrowserVaultReplicaRef;
}): void {
  if (input.replicaRef.sourceBundleHash !== input.expectedSourceStateHash) {
    throw new Error("Dashboard replica refresh wrote a stale replica ref.");
  }

  if (
    input.byteLength !== input.replicaRef.byteLength
    || input.byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
  ) {
    throw new Error("Dashboard replica refresh wrote invalid replica size metadata.");
  }
}

function throwIfDashboardReplicaRefreshAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Dashboard replica refresh aborted before publish.");
}
