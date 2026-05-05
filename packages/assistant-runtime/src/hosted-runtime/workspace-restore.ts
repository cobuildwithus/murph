import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import {
  clearHostedAssistantRuntimeHotState,
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
  const baseSnapshotRef = readHostedExecutionSnapshotBaseRef(snapshotRef);
  const hotSnapshotRef = readHostedExecutionSnapshotHotRef(snapshotRef);

  if (!baseSnapshotRef && !hotSnapshotRef) {
    return {
      ...restored,
      mode: "null-bootstrap",
    };
  }

  if (baseSnapshotRef) {
    await restoreHostedWorkspaceRuntimeBundle({
      platform: input.platform,
      ref: baseSnapshotRef,
      restored,
    });
  }

  if (hotSnapshotRef) {
    await clearHostedAssistantRuntimeHotState({
      vaultRoot: restored.vaultRoot,
    });
    await restoreHostedWorkspaceRuntimeBundle({
      platform: input.platform,
      ref: hotSnapshotRef,
      restored,
    });
  }

  return {
    ...restored,
    mode: "snapshot",
  };
}

async function restoreHostedWorkspaceRuntimeBundle(input: {
  platform: HostedRuntimePlatform;
  ref: HostedExecutionBundleRef;
  restored: HostedRestoredExecutionContext;
}): Promise<void> {
  const bundle = await input.platform.artifactStore.get(input.ref.hash);
  if (!bundle) {
    throw new HostedWorkspaceRuntimeSnapshotRestoreError(input.ref.hash);
  }

  await restoreHostedBundleRoots({
    artifactResolver: createHostedArtifactResolver({
      artifactStore: input.platform.artifactStore,
    }),
    bytes: bundle,
    expectedKind: "vault",
    roots: {
      [HOSTED_OPERATOR_HOME_ROOT_KEY]: input.restored.operatorHomeRoot,
      vault: input.restored.vaultRoot,
    },
    shouldRestoreArtifact: shouldRestoreHostedAssistantInputEvidenceArtifact,
  });
}

function shouldRestoreHostedAssistantInputEvidenceArtifact(input: {
  path: string;
  root: string;
}): boolean {
  if (input.root !== "vault") {
    return false;
  }

  return (
    hasHostedAssistantInputEvidenceArtifactPrefix(input.path, "raw/inbox")
    || hasHostedAssistantInputEvidenceArtifactPrefix(input.path, "raw/assistant-input")
    || hasHostedAssistantInputEvidenceArtifactPrefix(input.path, "derived/inbox")
    || hasHostedAssistantInputEvidenceArtifactPrefix(input.path, "derived/assistant-input")
  );
}

function hasHostedAssistantInputEvidenceArtifactPrefix(
  relativePath: string,
  prefix: string,
): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
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
