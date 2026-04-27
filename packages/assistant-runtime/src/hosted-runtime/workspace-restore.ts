import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  resolveAssistantStatePaths,
  restoreHostedBundleRoots,
} from "@murphai/runtime-state/node";

import {
  createHostedArtifactResolver,
} from "./artifacts.ts";
import type {
  HostedRestoredExecutionContext,
} from "./models.ts";
import type {
  HostedRuntimePlatform,
} from "./platform.ts";

const HOSTED_OPERATOR_HOME_ROOT_KEY = "operator-home";

export type HostedWorkspaceRuntimeRestoreMode = "null-bootstrap" | "snapshot";

export interface HostedWorkspaceRuntimeRestoreResult
  extends HostedRestoredExecutionContext {
  mode: HostedWorkspaceRuntimeRestoreMode;
}

export class HostedWorkspaceRuntimeSnapshotRestoreError extends Error {
  readonly snapshotHash: string;

  constructor(snapshotHash: string) {
    super("Hosted workspace runtime job snapshot restore failed.");
    this.name = "HostedWorkspaceRuntimeSnapshotRestoreError";
    this.snapshotHash = snapshotHash;
  }
}

export async function restoreHostedWorkspaceRuntimeJobWorkspace(input: {
  platform: HostedRuntimePlatform;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedWorkspaceRuntimeRestoreResult> {
  const restored = await createHostedWorkspaceRuntimeLocalRoots(input.vaultRoot);
  const snapshotRef = input.workspace?.snapshotRef ?? null;

  if (!snapshotRef) {
    return {
      ...restored,
      mode: "null-bootstrap",
    };
  }

  const bundle = await input.platform.artifactStore.get(snapshotRef.hash);
  if (!bundle) {
    throw new HostedWorkspaceRuntimeSnapshotRestoreError(snapshotRef.hash);
  }

  await restoreHostedBundleRoots({
    artifactResolver: createHostedArtifactResolver({
      artifactStore: input.platform.artifactStore,
    }),
    bytes: bundle,
    expectedKind: "vault",
    roots: {
      [HOSTED_OPERATOR_HOME_ROOT_KEY]: restored.operatorHomeRoot,
      vault: restored.vaultRoot,
    },
    shouldRestoreArtifact: () => false,
  });

  return {
    ...restored,
    mode: "snapshot",
  };
}

async function createHostedWorkspaceRuntimeLocalRoots(
  vaultRoot: string,
): Promise<HostedRestoredExecutionContext> {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(resolvedVaultRoot).assistantStateRoot;
  const operatorHomeRoot = path.join(
    path.dirname(resolvedVaultRoot),
    `${path.basename(resolvedVaultRoot)}-operator-home`,
  );

  await Promise.all([
    createHostedWorkspaceRuntimePrivateDirectory(resolvedVaultRoot),
    createHostedWorkspaceRuntimePrivateDirectory(assistantStateRoot),
    createHostedWorkspaceRuntimePrivateDirectory(operatorHomeRoot),
  ]);

  return {
    assistantStateRoot,
    operatorHomeRoot,
    vaultRoot: resolvedVaultRoot,
  };
}

async function createHostedWorkspaceRuntimePrivateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(directoryPath, 0o700);
}
