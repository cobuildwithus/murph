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
  hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity,
  repairLegacyHostedWorkspaceSnapshotProviderContinuity,
  resolveAssistantStatePaths,
  restoreHostedBundleRoots,
} from "@murphai/runtime-state/node";
import {
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";

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
const HOSTED_ASSISTANT_RUNTIME_HOT_STATE_BUNDLE_KEY_PREFIX = "cloudflare-workspace-hot-state/";

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

  let baseProvidesCodexProviderContinuity = false;
  if (baseSnapshotRef) {
    const baseBundle = await readHostedWorkspaceRuntimeBundle({
      platform: input.platform,
      ref: baseSnapshotRef,
    });
    const baseRepair = await repairHostedWorkspaceRuntimeBundleProviderContinuity({
      bundle: baseBundle,
      platform: input.platform,
      snapshotLayer: "base",
    });
    await restoreHostedWorkspaceRuntimeBundle({
      bundle: baseRepair.bundle,
      platform: input.platform,
      ref: baseSnapshotRef,
      restored,
    });
    baseProvidesCodexProviderContinuity = hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity({
      bundle: baseRepair.bundle,
    });
  }

  if (hotSnapshotRef) {
    const hotBundle = await readHostedWorkspaceRuntimeBundle({
      platform: input.platform,
      ref: hotSnapshotRef,
    });
    const hotRepair = await repairHostedWorkspaceRuntimeBundleProviderContinuity({
      bundle: hotBundle,
      platform: input.platform,
      snapshotLayer: "hot",
      skipLegacyContinuityRepair: (
        baseProvidesCodexProviderContinuity
        && isHostedAssistantRuntimeHotStateBundleRef(hotSnapshotRef)
      ),
    });
    const hotBundleRepaired =
      hotRepair.removedMalformedSessionCount > 0 || hotRepair.scrubbedSessionCount > 0;
    await clearHostedAssistantRuntimeHotState({
      operatorHomeRoot: hotBundleRepaired || hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity({
        bundle: hotRepair.bundle,
      })
        ? restored.operatorHomeRoot
        : null,
      vaultRoot: restored.vaultRoot,
    });
    await restoreHostedWorkspaceRuntimeBundle({
      bundle: hotRepair.bundle,
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

async function repairHostedWorkspaceRuntimeBundleProviderContinuity(input: {
  bundle: Uint8Array | ArrayBuffer;
  platform: HostedRuntimePlatform;
  skipLegacyContinuityRepair?: boolean;
  snapshotLayer: "base" | "hot";
}): Promise<{
  bundle: Uint8Array | ArrayBuffer;
  removedMalformedSessionCount: number;
  scrubbedSessionCount: number;
}> {
  if (input.skipLegacyContinuityRepair === true) {
    return {
      bundle: input.bundle,
      removedMalformedSessionCount: 0,
      scrubbedSessionCount: 0,
    };
  }

  const repair = repairLegacyHostedWorkspaceSnapshotProviderContinuity({
    bundle: input.bundle,
  });
  if (repair.removedMalformedSessionCount === 0 && repair.scrubbedSessionCount === 0) {
    return repair;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "workspace",
      eventCode: "workspace.legacy_codex_resume_repaired",
      level: "warn",
      phase: "restore",
      redactedJson: {
        nativeResumeDisabled: true,
        removedMalformedSessionCount: repair.removedMalformedSessionCount,
        scrubbedSessionCount: repair.scrubbedSessionCount,
        snapshotLayer: input.snapshotLayer,
      },
    },
    platform: input.platform,
  });
  return repair;
}

function isHostedAssistantRuntimeHotStateBundleRef(ref: HostedExecutionBundleRef): boolean {
  return ref.key.startsWith(HOSTED_ASSISTANT_RUNTIME_HOT_STATE_BUNDLE_KEY_PREFIX);
}

async function restoreHostedWorkspaceRuntimeBundle(input: {
  bundle?: Uint8Array | ArrayBuffer | null;
  platform: HostedRuntimePlatform;
  ref: HostedExecutionBundleRef;
  restored: HostedRestoredExecutionContext;
}): Promise<void> {
  const bundle = input.bundle ?? await readHostedWorkspaceRuntimeBundle({
    platform: input.platform,
    ref: input.ref,
  });

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

async function readHostedWorkspaceRuntimeBundle(input: {
  platform: HostedRuntimePlatform;
  ref: HostedExecutionBundleRef;
}): Promise<Uint8Array | ArrayBuffer> {
  const bundle = await input.platform.artifactStore.get(input.ref.hash);
  if (!bundle) {
    throw new HostedWorkspaceRuntimeSnapshotRestoreError(input.ref.hash);
  }

  return bundle;
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
