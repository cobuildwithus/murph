import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  readHostedMaterializedArtifactPaths,
} from "./materialized-artifact-state.ts";
import type {
  HostedRuntimeArtifactReader,
} from "./platform.ts";
import type {
  HostedWorkspaceRuntimeJobOptions,
} from "../hosted-runtime.ts";
import {
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import {
  createHostedPortableWorkspaceManifestFromBundle,
  listHostedBundleInlineFiles,
  readHostedPortableWorkspaceDeltaManifestFromBundle,
  readHostedPortableWorkspaceManifestFromBundle,
  readHostedWorkspaceSkippedInlineFiles,
  writeHostedWorkspaceSkippedInlineFiles,
  sha256HostedBundleHex,
  type HostedBundleInlineLocation,
  type HostedPortableWorkspaceDeltaManifest,
  type HostedWorkspaceSkippedInlineFile,
} from "@murphai/runtime-state/node";

export interface LegacyWorkspaceRefsForV2SnapshotMaterializationPlan {
  currentSnapshotRefPresent: boolean;
  legacyBundleRefPresent: boolean;
  preservedInlineFileCount: number;
  preservedState: HostedWorkspaceEffectivePreservedState | null;
  skippedInlineFiles: readonly HostedWorkspaceSkippedInlineFile[];
  skippedInlineFileCount: number;
}

export async function prepareLegacyWorkspaceRefsForV2SnapshotMaterialization(input: {
  artifactStore: HostedRuntimeArtifactReader;
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<LegacyWorkspaceRefsForV2SnapshotMaterializationPlan> {
  assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
  try {
    const currentSnapshotRef = await readHostedWorkspaceCurrentSnapshotRef({
      platform: input.platform,
      signal: input.signal,
    });
    assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
    const legacyBundleRef = readHostedExecutionSnapshotBaseRef(currentSnapshotRef);
    const preservedState = legacyBundleRef
      ? await readHostedWorkspaceEffectivePreservedState({
          artifactStore: input.artifactStore,
          signal: input.signal,
          snapshotRef: currentSnapshotRef,
        })
      : null;
    assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
    const skippedInlineFiles = legacyBundleRef
      ? await readHostedWorkspaceSkippedInlineFiles({
          vaultRoot: input.vaultRoot,
        })
      : [];
    assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);

    return {
      currentSnapshotRefPresent: currentSnapshotRef !== null,
      legacyBundleRefPresent: legacyBundleRef !== null,
      preservedInlineFileCount: preservedState?.inlineFiles.length ?? 0,
      preservedState,
      skippedInlineFiles,
      skippedInlineFileCount: skippedInlineFiles.length,
    };
  } catch (error) {
    assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
    throw error;
  }
}

export async function clearLegacyWorkspaceRefsForV2SnapshotMaterialization(input: {
  plan: LegacyWorkspaceRefsForV2SnapshotMaterializationPlan;
  vaultRoot: string;
}): Promise<void> {
  if (input.plan.skippedInlineFiles.length === 0) {
    return;
  }
  await writeHostedWorkspaceSkippedInlineFiles({
    files: [],
    vaultRoot: input.vaultRoot,
  });
}

class HostedWorkspaceCommittedStateUnavailableError extends Error {
  constructor() {
    super("Hosted workspace committed snapshot state is missing.");
    this.name = "HostedWorkspaceCommittedStateUnavailableError";
  }
}

export interface HostedWorkspaceEffectivePreservedState {
  inlineFiles: HostedBundleInlineLocation[];
}

export async function materializeLegacyWorkspaceRefsForV2Snapshot(input: {
  artifactStore: HostedRuntimeArtifactReader;
  operatorHomeRoot: string;
  plan: LegacyWorkspaceRefsForV2SnapshotMaterializationPlan;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<void> {
  await materializeHostedWorkspaceSkippedInlineFilesForV2Snapshot({
    artifactStore: input.artifactStore,
    files: input.plan.skippedInlineFiles,
    operatorHomeRoot: input.operatorHomeRoot,
    preservedState: input.plan.preservedState,
    signal: input.signal,
    vaultRoot: input.vaultRoot,
  });
}

async function readHostedWorkspaceCurrentSnapshotRef(input: {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  signal?: AbortSignal | null;
}): Promise<HostedExecutionSnapshotRef | null> {
  if (!input.platform.workspacePort?.read) {
    return null;
  }

  const currentWorkspace = await input.platform.workspacePort.read({
    signal: input.signal,
  });
  return currentWorkspace.workspace?.snapshotRef ?? null;
}

function assertHostedWorkspaceLegacySnapshotPreparationLive(
  signal: AbortSignal | null | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted workspace legacy snapshot preparation was interrupted.");
}

async function materializeHostedWorkspaceSkippedInlineFilesForV2Snapshot(input: {
  artifactStore: HostedRuntimeArtifactReader;
  files: readonly HostedWorkspaceSkippedInlineFile[];
  operatorHomeRoot: string;
  preservedState: HostedWorkspaceEffectivePreservedState | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<void> {
  assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
  const preservedInlineFiles = new Map(
    (input.preservedState?.inlineFiles ?? []).map((file) => [`${file.root}:${file.path}`, file]),
  );
  const materializedArtifactPaths = await readHostedMaterializedArtifactPaths({
    vaultRoot: input.vaultRoot,
  });
  for (const file of input.files) {
    assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
    const root = resolveHostedWorkspaceSkippedInlineFileRoot({
      operatorHomeRoot: input.operatorHomeRoot,
      root: file.root,
      vaultRoot: input.vaultRoot,
    });
    const targetPath = resolveSafeHostedWorkspaceSnapshotPath(root, file.path);
    if (
      materializedArtifactPaths.has(`${file.root}:${file.path}`)
      || await hostedWorkspaceSnapshotPathExists(targetPath)
    ) {
      continue;
    }
    const inlineFile = preservedInlineFiles.get(`${file.root}:${file.path}`);
    const bytes = inlineFile?.sha256 === file.sha256 && inlineFile.size === file.size
      ? inlineFile.bytes
      : await input.artifactStore.get(file.sha256, { signal: input.signal });
    assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
    if (bytes === null) {
      throw new Error("Hosted workspace skipped-inline artifact is unavailable.");
    }
    if (bytes.byteLength !== file.size || sha256HostedBundleHex(bytes) !== file.sha256) {
      throw new Error("Hosted workspace skipped-inline artifact digest does not match its manifest.");
    }
    await mkdir(path.dirname(targetPath), { mode: 0o700, recursive: true });
    await writeFile(targetPath, bytes, { mode: 0o600 });
  }
}

async function hostedWorkspaceSnapshotPathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveHostedWorkspaceSkippedInlineFileRoot(input: {
  operatorHomeRoot: string;
  root: string;
  vaultRoot: string;
}): string {
  if (input.root === "vault") {
    return input.vaultRoot;
  }
  if (input.root === "operator-home") {
    return input.operatorHomeRoot;
  }
  throw new Error("Hosted workspace skipped-inline file root is unsupported.");
}

function resolveSafeHostedWorkspaceSnapshotPath(root: string, relativePath: string): string {
  const normalizedRoot = path.resolve(root);
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Hosted workspace skipped-inline file path is invalid.");
  }
  const targetPath = path.resolve(
    normalizedRoot,
    ...relativePath.split(path.posix.sep),
  );
  const relativeToRoot = path.relative(normalizedRoot, targetPath);
  if (
    relativeToRoot === ""
    || relativeToRoot.startsWith("..")
    || path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("Hosted workspace skipped-inline file path escapes its root.");
  }
  return targetPath;
}

async function readHostedWorkspaceEffectivePreservedState(input: {
  artifactStore: HostedRuntimeArtifactReader;
  signal?: AbortSignal | null;
  snapshotRef: HostedExecutionSnapshotRef | null;
}): Promise<HostedWorkspaceEffectivePreservedState> {
  const baseSnapshotRef = readHostedExecutionSnapshotBaseRef(input.snapshotRef);
  if (!baseSnapshotRef) {
    return createHostedWorkspaceEffectivePreservedState();
  }

  const baseBundle = await input.artifactStore.get(baseSnapshotRef.hash, {
    signal: input.signal,
  });
  assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
  if (!baseBundle) {
    throw new HostedWorkspaceCommittedStateUnavailableError();
  }
  const baseManifest =
    readHostedPortableWorkspaceManifestFromBundle(baseBundle)
      ?? createHostedPortableWorkspaceManifestFromBundle(baseBundle);
  const baseInlineFiles = listHostedBundleInlineFiles({
    bytes: baseBundle,
    expectedKind: "vault",
  });
  const deltaSnapshotRef = readHostedExecutionSnapshotDeltaRef(input.snapshotRef);
  if (!deltaSnapshotRef) {
    const hotSnapshotRef = readHostedExecutionSnapshotHotRef(input.snapshotRef);
    if (hotSnapshotRef) {
      const hotBundle = await input.artifactStore.get(hotSnapshotRef.hash, {
        signal: input.signal,
      });
      assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
      if (!hotBundle) {
        throw new HostedWorkspaceCommittedStateUnavailableError();
      }
      const hotInlineFiles = listHostedBundleInlineFiles({
        bytes: hotBundle,
        expectedKind: "vault",
      });
      return createHostedWorkspaceEffectivePreservedState(
        createHostedWorkspaceBridgeOverlayInlineFiles({
          baseInlineFiles,
          overlayInlineFiles: hotInlineFiles,
        }),
      );
    }
    return createHostedWorkspaceEffectivePreservedState(baseInlineFiles);
  }

  const deltaBundle = await input.artifactStore.get(deltaSnapshotRef.hash, {
    signal: input.signal,
  });
  assertHostedWorkspaceLegacySnapshotPreparationLive(input.signal);
  if (!deltaBundle) {
    throw new HostedWorkspaceCommittedStateUnavailableError();
  }
  const deltaManifest = readHostedPortableWorkspaceDeltaManifestFromBundle(deltaBundle);
  if (!deltaManifest) {
    throw new HostedWorkspaceCommittedStateUnavailableError();
  }

  if (deltaManifest.baseManifestHash !== baseManifest.manifestHash) {
    throw new HostedWorkspaceCommittedStateUnavailableError();
  }

  return createHostedWorkspaceEffectivePreservedState(
    createHostedWorkspaceBridgeWorkingInlineFiles({
      baseInlineFiles,
      deltaBundle,
      deltaManifest,
    }),
  );
}

function createHostedWorkspaceEffectivePreservedState(
  inlineFiles: HostedBundleInlineLocation[] = [],
): HostedWorkspaceEffectivePreservedState {
  return {
    inlineFiles,
  };
}

function createHostedWorkspaceBridgeOverlayInlineFiles(input: {
  baseInlineFiles: readonly HostedBundleInlineLocation[];
  overlayInlineFiles: readonly HostedBundleInlineLocation[];
}): HostedBundleInlineLocation[] {
  const files = new Map(input.baseInlineFiles.map((file) => [
    `${file.root}:${file.path}`,
    file,
  ]));
  for (const file of input.overlayInlineFiles) {
    files.set(`${file.root}:${file.path}`, file);
  }
  return [...files.values()];
}

function createHostedWorkspaceBridgeWorkingInlineFiles(input: {
  baseInlineFiles: readonly HostedBundleInlineLocation[];
  deltaBundle: Uint8Array | ArrayBuffer;
  deltaManifest: HostedPortableWorkspaceDeltaManifest;
}): HostedBundleInlineLocation[] {
  const files = new Map(input.baseInlineFiles.map((file) => [
    `${file.root}:${file.path}`,
    file,
  ]));
  for (const tombstone of input.deltaManifest.tombstones) {
    files.delete(`${tombstone.root}:${tombstone.path}`);
  }
  for (const file of listHostedBundleInlineFiles({
    bytes: input.deltaBundle,
    expectedKind: "vault",
  })) {
    files.set(`${file.root}:${file.path}`, file);
  }
  return [...files.values()];
}
