import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyHostedCanonicalWriteReceipt,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  type HostedCanonicalWriteReceiptAction,
  type HostedCanonicalWriteReceiptContentRef,
  type HostedCanonicalWriteReceipt,
} from "@murphai/core";
import {
  VAULT_LAYOUT,
} from "@murphai/contracts";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
  isHostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  clearHostedAssistantRuntimeHotState,
  clearHostedCodexHomeRestoreRoot,
  createHostedPortableWorkspaceManifestFromBundle,
  readHostedPortableWorkspaceManifestFromBundle,
  resolveAssistantStatePaths,
  restoreHostedBundleRoots,
  restoreHostedWorkspaceWorkingDelta,
  readHostedWorkspaceSkippedInlineFiles,
  pruneHostedCodexHomeToSessionReferencedRollouts,
  writeHostedWorkspaceSkippedInlineFiles,
  type HostedWorkspaceSkippedInlineFile,
} from "@murphai/runtime-state/node";
import {
  normalizeCodexResumeState,
  normalizeCodexRolloutRelativePath,
} from "@murphai/operator-config/assistant/codex-resume-state";
import type {
  HostedRuntimeLogContext,
} from "./runtime-logs.ts";
import {
  readHostedCanonicalWriteReceiptLogEntries,
  readHostedCanonicalWriteReceiptLogStatusFingerprint,
  type HostedCanonicalWriteReceiptLogStatusFingerprint,
} from "./canonical-write-receipt-log.ts";

import {
  createHostedArtifactMaterializer,
  createHostedArtifactResolver,
} from "./artifacts.ts";
import type {
  HostedWorkspaceArtifactMaterializer,
  HostedRestoredExecutionContext,
} from "./models.ts";
import {
  readHostedMaterializedArtifactPaths,
} from "./materialized-artifact-state.ts";
import type {
  HostedRuntimePlatform,
} from "./platform.ts";

const HOSTED_OPERATOR_HOME_ROOT_KEY = "operator-home";
const HOSTED_CODEX_HOME_RELATIVE_PATH = ".codex-hosted";
const HOSTED_CODEX_THREAD_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

// Legacy restore-only compatibility for pre-v2 workspace refs. Production v2
// checkpoints no longer create base, hot, working, bundle, or delta refs; these
// caches and paths are deletable after the v2 migration window.
const HOSTED_WORKSPACE_BASE_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-base-restore-cache.json";
const HOSTED_WORKSPACE_HOT_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-hot-restore-cache.json";
const HOSTED_WORKSPACE_WORKING_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-working-restore-cache.json";
const HOSTED_WORKSPACE_LIVE_RUNTIME_STATE_FILE_NAME = ".hosted-workspace-live-runtime-state.json";
const HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_FILE_NAME = ".hosted-workspace-clean-checkpoint.json";
const HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_SCHEMA =
  "murph.hosted-workspace-clean-checkpoint.v1";

export type HostedWorkspaceRuntimeRestoreMode = "null-bootstrap" | "snapshot";

export interface HostedWorkspaceRuntimeRestoreResult
  extends HostedRestoredExecutionContext {
  materializeWorkspaceArtifacts: HostedWorkspaceArtifactMaterializer;
  materializedArtifactPaths: ReadonlySet<string>;
  mode: HostedWorkspaceRuntimeRestoreMode;
  inboxSidecarNeedsRebuild: boolean;
  restoreWasCold: boolean;
}

export type HostedWorkspaceWarmIdleCheckpointOpenResult =
  | {
      ok: true;
      restored: HostedRestoredExecutionContext;
    }
  | {
      ok: false;
      reason: "warm_workspace_missing" | "workspace_version_mismatch";
    };

export class HostedWorkspaceRuntimeSnapshotRestoreError extends Error {
  readonly snapshotHash: string;

  constructor(snapshotHash: string) {
    super("Hosted workspace runtime job snapshot restore failed.");
    this.name = "HostedWorkspaceRuntimeSnapshotRestoreError";
    this.snapshotHash = snapshotHash;
  }
}

export async function restoreHostedWorkspaceRuntimeJobWorkspace(input: {
  logContext?: HostedRuntimeLogContext | null;
  platform: HostedRuntimePlatform;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedWorkspaceRuntimeRestoreResult> {
  const restored = readHostedWorkspaceRuntimeLocalRoots(input.vaultRoot);
  const snapshotRef = input.workspace?.snapshotRef ?? null;
  const baseSnapshotRef = readHostedExecutionSnapshotBaseRef(snapshotRef);
  const deltaSnapshotRef = readHostedExecutionSnapshotDeltaRef(snapshotRef);
  const hotSnapshotRef = readHostedExecutionSnapshotHotRef(snapshotRef);
  const materializerBundles: Array<() => Promise<Uint8Array | ArrayBuffer | null>> = [];

  await clearHostedWorkspaceLiveRuntimeStateBestEffort(restored.vaultRoot);

  // Current v2 restore path: restore the single direct-R2 encrypted snapshot
  // without legacy bundle, hot-layer, delta, or sidecar artifact handling.
  if (isHostedWorkspaceSnapshotV2Ref(snapshotRef)) {
    if (!input.platform.workspaceSnapshotPort) {
      throw new Error("Hosted workspace snapshot v2 restore requires a workspace snapshot port.");
    }
    const warmRestored = await tryRestoreHostedWorkspaceFromCleanCheckpointMarker({
      logContext: input.logContext ?? null,
      platform: input.platform,
      restored,
      snapshotRef,
      workspace: input.workspace ?? null,
    });
    if (warmRestored) {
      return {
        ...warmRestored,
        mode: "snapshot",
        restoreWasCold: false,
        inboxSidecarNeedsRebuild: true,
      };
    }
    await clearHostedWorkspaceRuntimeLocalRoots(restored);
    await clearHostedWorkspaceRestoreCachesBestEffort(restored.vaultRoot);
    await input.platform.workspaceSnapshotPort.restoreWorkspaceSnapshot({
      durableRoot: resolveHostedWorkspaceDurableRoot(restored.vaultRoot),
      ref: snapshotRef,
      scratchRoot: resolveHostedWorkspaceScratchRoot(restored.vaultRoot),
    });
    await Promise.all([
      createHostedWorkspaceRuntimePrivateDirectory(restored.vaultRoot),
      createHostedWorkspaceRuntimePrivateDirectory(restored.assistantStateRoot),
      createHostedWorkspaceRuntimePrivateDirectory(restored.operatorHomeRoot),
    ]);
    await sanitizeRestoredHostedCodexResumeState({
      assistantStateRoot: restored.assistantStateRoot,
      operatorHomeRoot: restored.operatorHomeRoot,
    });
    const restoredMaterializedArtifactPaths = await readHostedMaterializedArtifactPaths({
      vaultRoot: restored.vaultRoot,
    });
    await applyHostedCanonicalWriteReceiptsFromWorkspaceState({
      platform: input.platform,
      status: input.workspace?.redactedStatus ?? null,
      vaultRoot: restored.vaultRoot,
    });

    return {
      ...restored,
      materializeWorkspaceArtifacts: createHostedWorkspaceRuntimeArtifactMaterializer({
        materializedArtifactPaths: restoredMaterializedArtifactPaths,
        platform: input.platform,
        restored,
        readBundles: materializerBundles,
      }),
      materializedArtifactPaths: restoredMaterializedArtifactPaths,
      mode: "snapshot",
      inboxSidecarNeedsRebuild: true,
      restoreWasCold: true,
    };
  }

  if (!baseSnapshotRef && !hotSnapshotRef && !deltaSnapshotRef) {
    await clearHostedWorkspaceRuntimeLocalRoots(restored);
    await clearHostedWorkspaceRestoreCachesBestEffort(restored.vaultRoot);
    const restoredMaterializedArtifactPaths = await readHostedMaterializedArtifactPaths({
      vaultRoot: restored.vaultRoot,
    });

    return {
      ...restored,
      materializeWorkspaceArtifacts: createHostedWorkspaceRuntimeArtifactMaterializer({
        materializedArtifactPaths: restoredMaterializedArtifactPaths,
        platform: input.platform,
        restored,
        readBundles: materializerBundles,
      }),
      materializedArtifactPaths: restoredMaterializedArtifactPaths,
      mode: "null-bootstrap",
      inboxSidecarNeedsRebuild: true,
      restoreWasCold: true,
    };
  }

  // Legacy refs still restore from durable truth. Reusing local bundle restore
  // caches would preserve cross-lease dirty state, so every pre-v2 restore starts
  // from clean roots just like the v2 snapshot path.
  await clearHostedWorkspaceRuntimeLocalRoots(restored);
  await clearHostedWorkspaceRestoreCachesBestEffort(restored.vaultRoot);

  let restoreWasCold = false;
  // Legacy restore-only compatibility for old base bundle refs. This branch is
  // not on the v2 production checkpoint path and can be removed after migration.
  if (baseSnapshotRef) {
    restoreWasCold = true;
    const baseBundle = await readHostedWorkspaceRuntimeBundle({
      platform: input.platform,
      ref: baseSnapshotRef,
    });
    materializerBundles.push(async () => baseBundle);
    await restoreHostedWorkspaceRuntimeBundle({
      bundle: baseBundle,
      platform: input.platform,
      ref: baseSnapshotRef,
      restored,
      trackSkippedInlineFiles: true,
    });
  }

  // Legacy restore-only compatibility for old hot-layer bundle refs. This
  // restores the authoritative hot state only for pre-v2 snapshots.
  if (hotSnapshotRef) {
    restoreWasCold = true;
    const restoredHotBundle = await restoreHostedWorkspaceRuntimeHotLayer({
      hotSnapshotRef,
      input,
      restored,
    });
    materializerBundles.push(async () => restoredHotBundle);
  }

  // Legacy restore-only compatibility for old working deltas. New v2 snapshots
  // restore above and should never reach this path.
  if (deltaSnapshotRef) {
    restoreWasCold = true;
    if (!baseSnapshotRef) {
      throw new HostedWorkspaceRuntimeSnapshotRestoreError(deltaSnapshotRef.hash);
    }
    const baseBundle = await readHostedWorkspaceRuntimeBundle({
      platform: input.platform,
      ref: baseSnapshotRef,
    });
    const baseManifest =
      readHostedPortableWorkspaceManifestFromBundle(baseBundle)
        ?? createHostedPortableWorkspaceManifestFromBundle(baseBundle);
    const deltaBundle = await readHostedWorkspaceRuntimeBundle({
      platform: input.platform,
      ref: deltaSnapshotRef,
    });
    materializerBundles.push(async () => deltaBundle);
    const skippedInlineFiles: HostedWorkspaceSkippedInlineFile[] = [];
    await restoreHostedWorkspaceWorkingDelta({
      artifactResolver: createHostedArtifactResolver({
        artifactStore: input.platform.artifactStore,
      }),
      baseManifest,
      baseSnapshotHash: baseSnapshotRef.hash,
      bundle: deltaBundle,
      onSkippedInlineFile: (file) => {
        skippedInlineFiles.push(file);
      },
      roots: {
        [HOSTED_OPERATOR_HOME_ROOT_KEY]: restored.operatorHomeRoot,
        vault: restored.vaultRoot,
      },
      shouldRestoreArtifact: shouldRestoreHostedRuntimeEagerArtifact,
      shouldRestoreInlineFile: shouldRestoreHostedRuntimeInlineFile,
    });
    if (skippedInlineFiles.length > 0) {
      await appendHostedWorkspaceSkippedInlineFiles({
        files: skippedInlineFiles,
        vaultRoot: restored.vaultRoot,
      });
    }
    await sanitizeRestoredHostedCodexResumeState({
      assistantStateRoot: restored.assistantStateRoot,
      operatorHomeRoot: restored.operatorHomeRoot,
    });
  }

  await applyHostedCanonicalWriteReceiptsFromWorkspaceState({
    platform: input.platform,
    status: input.workspace?.redactedStatus ?? null,
    vaultRoot: restored.vaultRoot,
  });
  const restoredMaterializedArtifactPaths = await readHostedMaterializedArtifactPaths({
    vaultRoot: restored.vaultRoot,
  });

  return {
    ...restored,
    materializeWorkspaceArtifacts: createHostedWorkspaceRuntimeArtifactMaterializer({
      materializedArtifactPaths: restoredMaterializedArtifactPaths,
      platform: input.platform,
      restored,
      readBundles: materializerBundles,
    }),
    materializedArtifactPaths: restoredMaterializedArtifactPaths,
    mode: "snapshot",
    inboxSidecarNeedsRebuild: restoreWasCold,
    restoreWasCold,
  };
}

interface HostedWorkspaceCleanCheckpointMarker {
  receiptLogByteSize: number | null;
  receiptLogEntryCount: number;
  receiptLogSha256: string | null;
  schema: typeof HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_SCHEMA;
  snapshotFingerprintSha256: string;
  workspaceVersion: string;
  writtenAt: string;
}

interface HostedWorkspaceCleanCheckpointReceiptMarkerFields {
  receiptLogByteSize: number | null;
  receiptLogEntryCount: number;
  receiptLogSha256: string | null;
}

async function tryRestoreHostedWorkspaceFromCleanCheckpointMarker(input: {
  logContext: HostedRuntimeLogContext | null;
  platform: HostedRuntimePlatform;
  restored: HostedRestoredExecutionContext;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
  workspace: HostedWorkspaceState | null;
}): Promise<
  | (HostedRestoredExecutionContext & {
      materializeWorkspaceArtifacts: HostedWorkspaceArtifactMaterializer;
      materializedArtifactPaths: ReadonlySet<string>;
    })
  | null
> {
  const expected = tryBuildHostedWorkspaceCleanCheckpointMarker({
    snapshotRef: input.snapshotRef,
    workspace: input.workspace,
  });
  if (!expected) {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }

  let marker: HostedWorkspaceCleanCheckpointMarker | null = null;
  try {
    marker = await readHostedWorkspaceCleanCheckpointMarker(input.restored.vaultRoot);
  } catch {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }
  if (!marker) {
    return null;
  }
  if (!sameHostedWorkspaceCleanCheckpointMarker(marker, expected)) {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }

  try {
    await consumeHostedWorkspaceCleanCheckpointMarker(input.restored.vaultRoot);
  } catch {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }

  try {
    await assertHostedWorkspaceWarmCleanRoots(input.restored);
    await sanitizeRestoredHostedCodexResumeState({
      assistantStateRoot: input.restored.assistantStateRoot,
      operatorHomeRoot: input.restored.operatorHomeRoot,
    });
    const restoredMaterializedArtifactPaths = await readHostedMaterializedArtifactPaths({
      vaultRoot: input.restored.vaultRoot,
    });
    await applyHostedCanonicalWriteReceiptsFromWorkspaceState({
      platform: input.platform,
      status: input.workspace?.redactedStatus ?? null,
      vaultRoot: input.restored.vaultRoot,
    });
    return {
      ...input.restored,
      materializeWorkspaceArtifacts: createHostedWorkspaceRuntimeArtifactMaterializer({
        materializedArtifactPaths: restoredMaterializedArtifactPaths,
        platform: input.platform,
        restored: input.restored,
        readBundles: [],
      }),
      materializedArtifactPaths: restoredMaterializedArtifactPaths,
    };
  } catch {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }
}

export async function writeHostedWorkspaceCleanCheckpointMarkerBestEffort(input: {
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<boolean> {
  const snapshotRef = input.workspace?.snapshotRef ?? null;
  if (!isHostedWorkspaceSnapshotV2Ref(snapshotRef)) {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.vaultRoot);
    return false;
  }
  const marker = tryBuildHostedWorkspaceCleanCheckpointMarker({
    snapshotRef,
    workspace: input.workspace,
  });
  if (!marker) {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.vaultRoot);
    return false;
  }
  try {
    await writeHostedWorkspaceCleanCheckpointMarker(input.vaultRoot, marker);
    return true;
  } catch {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.vaultRoot);
    return false;
  }
}

function tryBuildHostedWorkspaceCleanCheckpointMarker(input: {
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
  workspace: HostedWorkspaceState | null;
}): HostedWorkspaceCleanCheckpointMarker | null {
  if (!input.workspace || input.workspace.version.trim().length === 0) {
    return null;
  }
  let receiptFields: HostedWorkspaceCleanCheckpointReceiptMarkerFields;
  try {
    receiptFields = createHostedWorkspaceCleanCheckpointReceiptMarkerFields(
      readHostedCanonicalWriteReceiptLogStatusFingerprint(input.workspace.redactedStatus ?? null),
    );
  } catch {
    return null;
  }
  return {
    ...receiptFields,
    schema: HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_SCHEMA,
    snapshotFingerprintSha256: buildHostedWorkspaceSnapshotV2FingerprintSha256(input.snapshotRef),
    workspaceVersion: input.workspace.version,
    writtenAt: new Date().toISOString(),
  };
}

function createHostedWorkspaceCleanCheckpointReceiptMarkerFields(
  fingerprint: HostedCanonicalWriteReceiptLogStatusFingerprint | null,
): HostedWorkspaceCleanCheckpointReceiptMarkerFields {
  return fingerprint
    ? {
        receiptLogByteSize: fingerprint.byteSize,
        receiptLogEntryCount: fingerprint.entryCount,
        receiptLogSha256: fingerprint.sha256,
      }
    : {
        receiptLogByteSize: null,
        receiptLogEntryCount: 0,
        receiptLogSha256: null,
      };
}

function buildHostedWorkspaceSnapshotV2FingerprintSha256(
  ref: HostedWorkspaceSnapshotV2Ref,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      archive: {
        compression: ref.archive.compression,
        encryptedByteSize: ref.archive.encryptedByteSize,
        encryptedObjectSha256: ref.archive.encryptedObjectSha256,
        fileCount: ref.archive.fileCount,
        format: ref.archive.format,
        plaintextArchiveSha256: ref.archive.plaintextArchiveSha256,
        totalPlainBytes: ref.archive.totalPlainBytes,
      },
      createdAt: ref.createdAt,
      encryption: {
        aad: ref.encryption.aad,
        ivBase64: ref.encryption.ivBase64,
        rootKeyId: ref.encryption.rootKeyId,
        scheme: ref.encryption.scheme,
        wrappedDataKey: ref.encryption.wrappedDataKey,
      },
      objectKey: ref.objectKey,
      schema: ref.schema,
      snapshotId: ref.snapshotId,
      upload: ref.upload,
      userId: ref.userId,
    }))
    .digest("hex");
}

async function readHostedWorkspaceCleanCheckpointMarker(
  vaultRoot: string,
): Promise<HostedWorkspaceCleanCheckpointMarker | null> {
  const markerPath = resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot);
  let markerStat;
  try {
    markerStat = await lstat(markerPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
  if (!markerStat.isFile()) {
    throw new Error("Hosted workspace clean checkpoint marker must be a regular file.");
  }
  return parseHostedWorkspaceCleanCheckpointMarker(await readFile(markerPath, "utf8"));
}

function parseHostedWorkspaceCleanCheckpointMarker(
  raw: string,
): HostedWorkspaceCleanCheckpointMarker {
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error("Hosted workspace clean checkpoint marker must be an object.");
  }
  const schema = parsed.schema;
  const workspaceVersion = parsed.workspaceVersion;
  const snapshotFingerprintSha256 = parsed.snapshotFingerprintSha256;
  const receiptLogSha256 = parsed.receiptLogSha256;
  const receiptLogByteSize = parsed.receiptLogByteSize;
  const receiptLogEntryCount = parsed.receiptLogEntryCount;
  const writtenAt = parsed.writtenAt;
  if (schema !== HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_SCHEMA) {
    throw new Error("Hosted workspace clean checkpoint marker schema is invalid.");
  }
  if (typeof workspaceVersion !== "string" || workspaceVersion.trim().length === 0) {
    throw new Error("Hosted workspace clean checkpoint marker workspace version is invalid.");
  }
  if (!isSha256(snapshotFingerprintSha256)) {
    throw new Error("Hosted workspace clean checkpoint marker snapshot fingerprint is invalid.");
  }
  if (
    receiptLogSha256 !== null
    && !isSha256(receiptLogSha256)
  ) {
    throw new Error("Hosted workspace clean checkpoint marker receipt hash is invalid.");
  }
  if (
    receiptLogByteSize !== null
    && !isNonNegativeInteger(receiptLogByteSize)
  ) {
    throw new Error("Hosted workspace clean checkpoint marker receipt size is invalid.");
  }
  if (!isNonNegativeInteger(receiptLogEntryCount)) {
    throw new Error("Hosted workspace clean checkpoint marker receipt count is invalid.");
  }
  if (
    (receiptLogSha256 === null || receiptLogByteSize === null)
    && (receiptLogSha256 !== null || receiptLogByteSize !== null || receiptLogEntryCount !== 0)
  ) {
    throw new Error("Hosted workspace clean checkpoint marker receipt fields are inconsistent.");
  }
  if (
    typeof writtenAt !== "string"
    || !Number.isFinite(Date.parse(writtenAt))
    || new Date(writtenAt).toISOString() !== writtenAt
  ) {
    throw new Error("Hosted workspace clean checkpoint marker timestamp is invalid.");
  }
  return {
    receiptLogByteSize,
    receiptLogEntryCount,
    receiptLogSha256,
    schema,
    snapshotFingerprintSha256,
    workspaceVersion,
    writtenAt,
  };
}

function sameHostedWorkspaceCleanCheckpointMarker(
  actual: HostedWorkspaceCleanCheckpointMarker,
  expected: HostedWorkspaceCleanCheckpointMarker,
): boolean {
  return actual.schema === expected.schema
    && actual.workspaceVersion === expected.workspaceVersion
    && actual.snapshotFingerprintSha256 === expected.snapshotFingerprintSha256
    && actual.receiptLogSha256 === expected.receiptLogSha256
    && actual.receiptLogByteSize === expected.receiptLogByteSize
    && actual.receiptLogEntryCount === expected.receiptLogEntryCount;
}

async function writeHostedWorkspaceCleanCheckpointMarker(
  vaultRoot: string,
  marker: HostedWorkspaceCleanCheckpointMarker,
): Promise<void> {
  const markerPath = resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot);
  const tempPath = `${markerPath}.${randomUUID().replace(/-/g, "")}.tmp`;
  await mkdir(path.dirname(markerPath), { mode: 0o700, recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(marker, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(tempPath, 0o600);
    await rename(tempPath, markerPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function consumeHostedWorkspaceCleanCheckpointMarker(vaultRoot: string): Promise<void> {
  await rm(resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot));
}

async function assertHostedWorkspaceWarmCleanRoots(
  restored: HostedRestoredExecutionContext,
): Promise<void> {
  await Promise.all([
    assertHostedWorkspaceWarmCleanDirectory(resolveHostedWorkspaceDurableRoot(restored.vaultRoot)),
    assertHostedWorkspaceWarmCleanDirectory(restored.vaultRoot),
    assertHostedWorkspaceWarmCleanDirectory(restored.assistantStateRoot),
    assertHostedWorkspaceWarmCleanDirectory(restored.operatorHomeRoot),
  ]);
  await assertHostedWorkspaceWarmCleanFile(path.join(restored.vaultRoot, VAULT_LAYOUT.metadata));
  await Promise.all([
    createHostedWorkspaceRuntimePrivateDirectory(restored.vaultRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.assistantStateRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.operatorHomeRoot),
  ]);
}

async function assertHostedWorkspaceWarmCleanDirectory(directoryPath: string): Promise<void> {
  const directoryStat = await lstat(directoryPath);
  if (!directoryStat.isDirectory()) {
    throw new Error("Hosted warm workspace root is not a directory.");
  }
}

async function assertHostedWorkspaceWarmCleanFile(filePath: string): Promise<void> {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile()) {
    throw new Error("Hosted warm workspace metadata is not a regular file.");
  }
}

async function sanitizeRestoredHostedCodexResumeState(input: {
  assistantStateRoot: string;
  operatorHomeRoot: string;
}): Promise<void> {
  const sessionsRoot = path.join(input.assistantStateRoot, "sessions");

  async function visit(directoryPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      await sanitizeHostedAssistantSessionCodexResumeFile({
        filePath: absolutePath,
        operatorHomeRoot: input.operatorHomeRoot,
      });
    }
  }

  await visit(sessionsRoot);
  await pruneHostedCodexHomeToSessionReferencedRollouts({
    assistantStateRoot: input.assistantStateRoot,
    operatorHomeRoot: input.operatorHomeRoot,
  });
}

async function sanitizeHostedAssistantSessionCodexResumeFile(input: {
  filePath: string;
  operatorHomeRoot: string;
}): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(input.filePath, "utf8"));
  } catch {
    return;
  }
  if (!await shouldClearHostedAssistantSessionCodexResumeRecord({
    operatorHomeRoot: input.operatorHomeRoot,
    value: parsed,
  })) {
    return;
  }
  const cleared = clearHostedAssistantSessionCodexResumeRecord(parsed);
  if (!cleared.changed) {
    return;
  }
  await writeFile(input.filePath, `${JSON.stringify(cleared.value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(input.filePath, 0o600);
}

async function shouldClearHostedAssistantSessionCodexResumeRecord(input: {
  operatorHomeRoot: string;
  value: unknown;
}): Promise<boolean> {
  if (!isPlainObject(input.value) || !isHostedAssistantSessionCodexTarget(input.value)) {
    return false;
  }
  if (!hasRawHostedAssistantSessionCodexResumeCandidate(input.value)) {
    return false;
  }

  const resumeSource =
    readRecordProperty(input.value, "codexResume")
    ?? readRecordProperty(input.value, "resumeState");
  const resumeState =
    normalizeCodexResumeState(resumeSource)
    ?? normalizeCodexResumeState(input.value);
  const rolloutRelativePath = normalizeCodexRolloutRelativePath(
    resumeState?.rolloutRelativePath,
  );
  if (!resumeState || !rolloutRelativePath) {
    return true;
  }
  if (!hostedCodexRolloutPathMatchesThreadId({
    rolloutRelativePath,
    threadId: resumeState.threadId,
  })) {
    return true;
  }

  return !await isRestoredHostedCodexRolloutRegularFile({
    operatorHomeRoot: input.operatorHomeRoot,
    rolloutRelativePath,
  });
}

function hostedCodexRolloutPathMatchesThreadId(input: {
  rolloutRelativePath: string;
  threadId: string;
}): boolean {
  const rolloutThreadId = readHostedCodexRolloutThreadId(input.rolloutRelativePath);
  return rolloutThreadId !== null && rolloutThreadId === input.threadId.toLowerCase();
}

function readHostedCodexRolloutThreadId(rolloutRelativePath: string): string | null {
  const suffix = ".jsonl";
  if (!rolloutRelativePath.endsWith(suffix)) {
    return null;
  }

  const pathWithoutSuffix = rolloutRelativePath.slice(0, -suffix.length);
  const threadIdStart = pathWithoutSuffix.length - 36;
  if (threadIdStart <= 0 || pathWithoutSuffix[threadIdStart - 1] !== "-") {
    return null;
  }

  const threadId = pathWithoutSuffix.slice(threadIdStart);
  return HOSTED_CODEX_THREAD_ID_PATTERN.test(threadId)
    ? threadId.toLowerCase()
    : null;
}

function clearHostedAssistantSessionCodexResumeRecord(value: unknown): {
  changed: boolean;
  value: unknown;
} {
  if (!isPlainObject(value)) {
    return {
      changed: false,
      value,
    };
  }

  const next: Record<string, unknown> = { ...value };
  let changed = false;
  for (const key of ["codexResume", "resumeState"] as const) {
    if (Object.hasOwn(next, key) && next[key] !== null) {
      next[key] = null;
      changed = true;
    }
  }
  for (const key of ["codexThreadId", "providerSessionId", "resumeRouteId", "routeFingerprint"] as const) {
    if (Object.hasOwn(next, key)) {
      delete next[key];
      changed = true;
    }
  }

  return {
    changed,
    value: changed ? next : value,
  };
}

function isHostedAssistantSessionCodexTarget(record: Record<string, unknown>): boolean {
  const target =
    readRecordProperty(record, "codexTarget") ?? readRecordProperty(record, "target");
  const targetAdapter = readRecordStringProperty(target, "adapter");
  return !targetAdapter || targetAdapter === "codex-cli";
}

function hasRawHostedAssistantSessionCodexResumeCandidate(
  record: Record<string, unknown>,
): boolean {
  return hasNonNullRecordProperty(record, "codexResume")
    || hasNonNullRecordProperty(record, "resumeState")
    || readRecordStringProperty(record, "codexThreadId") !== null
    || readRecordStringProperty(record, "providerSessionId") !== null;
}

function hasNonNullRecordProperty(
  record: Record<string, unknown>,
  propertyName: string,
): boolean {
  return Object.hasOwn(record, propertyName) && record[propertyName] != null;
}

async function isRestoredHostedCodexRolloutRegularFile(input: {
  operatorHomeRoot: string;
  rolloutRelativePath: string;
}): Promise<boolean> {
  const rolloutRelativePath = normalizeCodexRolloutRelativePath(input.rolloutRelativePath);
  if (!rolloutRelativePath) {
    return false;
  }

  const codexHomeRoot = path.resolve(input.operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH);
  const rolloutPath = path.resolve(codexHomeRoot, rolloutRelativePath);
  const relativeToCodexHome = path.relative(codexHomeRoot, rolloutPath);
  if (
    relativeToCodexHome.length === 0
    || relativeToCodexHome.startsWith("..")
    || path.isAbsolute(relativeToCodexHome)
  ) {
    return false;
  }

  let codexHomeStat;
  try {
    codexHomeStat = await lstat(codexHomeRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
  if (codexHomeStat.isSymbolicLink() || !codexHomeStat.isDirectory()) {
    return false;
  }

  let currentPath = codexHomeRoot;
  for (const segment of rolloutRelativePath.split("/")) {
    currentPath = path.join(currentPath, segment);
    let stat;
    try {
      stat = await lstat(currentPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return false;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      return false;
    }
    const isLeaf = currentPath === rolloutPath;
    if (isLeaf ? !stat.isFile() : !stat.isDirectory()) {
      return false;
    }
  }

  return true;
}

function readRecordProperty(
  value: unknown,
  propertyName: string,
): unknown {
  return isPlainObject(value) ? value[propertyName] : null;
}

function readRecordStringProperty(
  value: unknown,
  propertyName: string,
): string | null {
  const propertyValue = readRecordProperty(value, propertyName);
  return typeof propertyValue === "string" && propertyValue.trim().length > 0
    ? propertyValue
    : null;
}

export async function tryOpenExistingWarmWorkspaceForIdleCheckpoint(input: {
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedWorkspaceWarmIdleCheckpointOpenResult> {
  void input.workspace;
  await clearHostedWorkspaceLiveRuntimeStateBestEffort(
    readHostedWorkspaceRuntimeLocalRoots(input.vaultRoot).vaultRoot,
  );
  return {
    ok: false,
    reason: "warm_workspace_missing",
  };
}

// Legacy hot-layer bundle restore helper. Restore-only compatibility for
// pre-v2 `{base, hot}` snapshots; remove with the legacy snapshot readers.
async function restoreHostedWorkspaceRuntimeHotLayer(input: {
  hotSnapshotRef: HostedExecutionBundleRef;
  input: {
    logContext?: HostedRuntimeLogContext | null;
    platform: HostedRuntimePlatform;
  };
  restored: HostedRestoredExecutionContext;
}): Promise<Uint8Array | ArrayBuffer> {
  const hotBundle = await readHostedWorkspaceRuntimeBundle({
    platform: input.input.platform,
    ref: input.hotSnapshotRef,
  });
  await clearHostedAssistantRuntimeHotState({
    operatorHomeRoot: input.restored.operatorHomeRoot,
    vaultRoot: input.restored.vaultRoot,
  });
  await restoreHostedWorkspaceRuntimeBundle({
    bundle: hotBundle,
    platform: input.input.platform,
    ref: input.hotSnapshotRef,
    restored: input.restored,
    appendSkippedInlineFiles: true,
    trackSkippedInlineFiles: true,
  });
  return hotBundle;
}

function createHostedWorkspaceRuntimeArtifactMaterializer(input: {
  materializedArtifactPaths: Set<string>;
  platform: HostedRuntimePlatform;
  readBundles: readonly (() => Promise<Uint8Array | ArrayBuffer | null>)[];
  restored: HostedRestoredExecutionContext;
}): HostedWorkspaceArtifactMaterializer {
  return createHostedArtifactMaterializer({
    artifactResolver: createHostedArtifactResolver({
      artifactStore: input.platform.artifactStore,
    }),
    bundles: input.readBundles,
    materializedArtifactPaths: input.materializedArtifactPaths,
    operatorHomeRoot: input.restored.operatorHomeRoot,
    vaultRoot: input.restored.vaultRoot,
  });
}

async function applyHostedCanonicalWriteReceiptsFromWorkspaceState(input: {
  platform: HostedRuntimePlatform;
  status: HostedWorkspaceState["redactedStatus"] | null | undefined;
  vaultRoot: string;
}): Promise<void> {
  const entries = await readHostedCanonicalWriteReceiptLogEntries({
    artifactStore: input.platform.artifactStore,
    status: input.status,
  });
  const receipts: HostedCanonicalWriteReceipt[] = [];
  for (const entry of entries) {
    const bytes = await input.platform.artifactStore.get(entry.sha256);
    if (!bytes) {
      throw new Error("Hosted canonical write receipt artifact is unavailable.");
    }
    if (bytes.byteLength !== entry.byteSize) {
      throw new Error("Hosted canonical write receipt artifact size does not match its log ref.");
    }
    const parsed = parseHostedCanonicalWriteReceiptForRestore(
      Buffer.from(bytes).toString("utf8"),
    );
    if (parsed) {
      receipts.push(parsed);
    }
  }

  receipts.sort((left, right) =>
    left.committedAt.localeCompare(right.committedAt)
    || left.operationId.localeCompare(right.operationId)
  );

  for (const receipt of receipts) {
    await applyHostedCanonicalWriteReceipt({
      readPayload: async (ref) =>
        await readHostedCanonicalWritePayloadForRestore({
          platform: input.platform,
          ref,
        }),
      receipt,
      vaultRoot: input.vaultRoot,
    });
  }
}

async function readHostedCanonicalWritePayloadForRestore(input: {
  platform: HostedRuntimePlatform;
  ref: HostedCanonicalWriteReceiptContentRef;
}): Promise<Uint8Array | ArrayBuffer | null> {
  return await input.platform.artifactStore.get(input.ref.sha256);
}

function parseHostedCanonicalWriteReceiptForRestore(
  raw: string,
): HostedCanonicalWriteReceipt | null {
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error("Hosted canonical write receipt must be an object.");
  }
  if (
    parsed.schema !== HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION &&
    parsed.schemaVersion === HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION
  ) {
    return null;
  }
  if (parsed.schema !== HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION) {
    throw new Error("Hosted canonical write receipt schema is invalid.");
  }
  if (
    typeof parsed.operationId !== "string" ||
    typeof parsed.operationType !== "string" ||
    typeof parsed.summary !== "string" ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    typeof parsed.occurredAt !== "string" ||
    typeof parsed.committedAt !== "string" ||
    !Array.isArray(parsed.actions)
  ) {
    throw new Error("Hosted canonical write receipt fields are invalid.");
  }

  const actions = parsed.actions.map(parseHostedCanonicalWriteReceiptActionForRestore);
  return {
    schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
    operationId: parsed.operationId,
    operationType: parsed.operationType,
    summary: parsed.summary,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    occurredAt: parsed.occurredAt,
    committedAt: parsed.committedAt,
    actions,
  };
}

function parseHostedCanonicalWriteReceiptActionForRestore(
  raw: unknown,
): HostedCanonicalWriteReceiptAction {
  if (!isPlainObject(raw) || typeof raw.kind !== "string") {
    throw new Error("Hosted canonical write receipt action is invalid.");
  }
  if (typeof raw.targetRelativePath !== "string") {
    throw new Error("Hosted canonical write receipt action target is invalid.");
  }

  switch (raw.kind) {
    case "text_upsert": {
      if (
        !isSha256(raw.sha256) ||
        !isNonNegativeInteger(raw.byteLength) ||
        !isTextUpsertEffect(raw.effect)
      ) {
        throw new Error("Hosted canonical text write receipt action is invalid.");
      }
      const contentRef = parseHostedCanonicalWriteReceiptContentRef(raw.contentRef);
      return {
        kind: "text_upsert",
        targetRelativePath: raw.targetRelativePath,
        sha256: raw.sha256,
        byteLength: raw.byteLength,
        effect: raw.effect,
        ...(contentRef ? { contentRef } : {}),
      };
    }
    case "jsonl_append": {
      if (
        !isSha256(raw.appendSha256) ||
        !isNonNegativeInteger(raw.appendByteLength) ||
        !isSha256(raw.baseSha256) ||
        !isNonNegativeInteger(raw.baseByteLength) ||
        (raw.originalSize !== null && !isNonNegativeInteger(raw.originalSize))
      ) {
        throw new Error("Hosted canonical JSONL append receipt action is invalid.");
      }
      const contentRef = parseHostedCanonicalWriteReceiptContentRef(raw.contentRef);
      return {
        kind: "jsonl_append",
        targetRelativePath: raw.targetRelativePath,
        appendSha256: raw.appendSha256,
        appendByteLength: raw.appendByteLength,
        baseSha256: raw.baseSha256,
        baseByteLength: raw.baseByteLength,
        originalSize: raw.originalSize,
        ...(contentRef ? { contentRef } : {}),
      };
    }
    case "raw_upsert": {
      if (
        !isSha256(raw.sha256) ||
        !isNonNegativeInteger(raw.byteLength) ||
        typeof raw.mediaType !== "string" ||
        typeof raw.originalFileName !== "string" ||
        !isRawUpsertEffect(raw.effect)
      ) {
        throw new Error("Hosted canonical raw write receipt action is invalid.");
      }
      const contentRef = parseHostedCanonicalWriteReceiptContentRef(raw.contentRef);
      if (!contentRef) {
        throw new Error("Hosted canonical raw write receipt action is missing content.");
      }
      return {
        kind: "raw_upsert",
        targetRelativePath: raw.targetRelativePath,
        sha256: raw.sha256,
        byteLength: raw.byteLength,
        mediaType: raw.mediaType,
        originalFileName: raw.originalFileName,
        effect: raw.effect,
        contentRef,
      };
    }
    case "delete": {
      if (typeof raw.existedBefore !== "boolean") {
        throw new Error("Hosted canonical delete receipt action is invalid.");
      }
      return {
        kind: "delete",
        targetRelativePath: raw.targetRelativePath,
        existedBefore: raw.existedBefore,
      };
    }
    default:
      throw new Error("Hosted canonical write receipt action kind is invalid.");
  }
}

function parseHostedCanonicalWriteReceiptContentRef(
  raw: unknown,
): HostedCanonicalWriteReceiptContentRef | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isPlainObject(raw) || !isSha256(raw.sha256) || !isNonNegativeInteger(raw.byteSize)) {
    throw new Error("Hosted canonical write receipt content ref is invalid.");
  }
  return {
    sha256: raw.sha256,
    byteSize: raw.byteSize,
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isTextUpsertEffect(value: unknown): value is "create" | "update" | "reuse" {
  return value === "create" || value === "update" || value === "reuse";
}

function isRawUpsertEffect(value: unknown): value is "copy" | "reuse" {
  return value === "copy" || value === "reuse";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return isPlainObject(error) && error.code === "ENOENT";
}

// Legacy restore cache cleanup helpers. The cache-hit restore paths are disabled
// so pre-v2 refs cannot reuse cross-lease dirty local state.
async function clearHostedWorkspaceBaseRestoreCacheBestEffort(vaultRoot: string): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceBaseRestoreCachePath(vaultRoot), { force: true });
  } catch {
    // A stale base cache marker should not block cold restore from the source bundle.
  }
}

export async function markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort(input: {
  snapshotRef: HostedWorkspaceState["snapshotRef"];
  vaultRoot: string;
}): Promise<void> {
  void input.snapshotRef;
  // Dirty local runtime state is valid only inside the currently owned child.
  // A later lease may reuse only an explicitly clean checkpoint marker.
  await Promise.all([
    clearHostedWorkspaceLiveRuntimeStateBestEffort(input.vaultRoot),
    clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.vaultRoot),
  ]);
}

async function clearHostedWorkspaceLiveRuntimeStateBestEffort(vaultRoot: string): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceLiveRuntimeStatePath(vaultRoot), { force: true });
  } catch {
    // The legacy marker is best-effort cleanup only.
  }
}

export async function clearHostedWorkspaceCleanCheckpointMarkerBestEffort(
  vaultRoot: string,
): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot), { force: true });
  } catch {
    // A stale marker can only affect performance; warm restore consumes it fail-closed.
  }
}

async function clearHostedWorkspaceHotRestoreCacheBestEffort(vaultRoot: string): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceHotRestoreCachePath(vaultRoot), { force: true });
  } catch {
    // A stale or missing cache marker only affects performance, not correctness.
  }
}

async function clearHostedWorkspaceWorkingRestoreCacheBestEffort(vaultRoot: string): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceWorkingRestoreCachePath(vaultRoot), { force: true });
  } catch {
    // A stale or missing cache marker only affects performance, not correctness.
  }
}

function resolveHostedWorkspaceBaseRestoreCachePath(vaultRoot: string): string {
  return path.join(
    path.dirname(path.resolve(vaultRoot)),
    HOSTED_WORKSPACE_BASE_RESTORE_CACHE_FILE_NAME,
  );
}

function resolveHostedWorkspaceHotRestoreCachePath(vaultRoot: string): string {
  return path.join(
    path.dirname(path.resolve(vaultRoot)),
    HOSTED_WORKSPACE_HOT_RESTORE_CACHE_FILE_NAME,
  );
}

function resolveHostedWorkspaceWorkingRestoreCachePath(vaultRoot: string): string {
  return path.join(
    path.dirname(path.resolve(vaultRoot)),
    HOSTED_WORKSPACE_WORKING_RESTORE_CACHE_FILE_NAME,
  );
}

function resolveHostedWorkspaceLiveRuntimeStatePath(vaultRoot: string): string {
  return path.join(
    path.dirname(path.resolve(vaultRoot)),
    HOSTED_WORKSPACE_LIVE_RUNTIME_STATE_FILE_NAME,
  );
}

function resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot: string): string {
  return path.join(
    path.dirname(path.resolve(vaultRoot)),
    HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_FILE_NAME,
  );
}

// Legacy bundle restore helper for pre-v2 snapshot refs. The current v2 path
// uses workspaceSnapshotPort.restoreWorkspaceSnapshot instead.
async function restoreHostedWorkspaceRuntimeBundle(input: {
  appendSkippedInlineFiles?: boolean;
  bundle?: Uint8Array | ArrayBuffer | null;
  platform: HostedRuntimePlatform;
  ref: HostedExecutionBundleRef;
  restored: HostedRestoredExecutionContext;
  trackSkippedInlineFiles: boolean;
}): Promise<void> {
  const bundle = input.bundle ?? await readHostedWorkspaceRuntimeBundle({
    platform: input.platform,
    ref: input.ref,
  });
  const skippedInlineFiles: HostedWorkspaceSkippedInlineFile[] = [];

  await clearHostedCodexHomeRestoreRoot(input.restored.operatorHomeRoot);
  try {
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
      onSkippedInlineFile: input.trackSkippedInlineFiles
        ? (file) => {
            skippedInlineFiles.push(file);
          }
        : undefined,
      shouldRestoreArtifact: shouldRestoreHostedRuntimeEagerArtifact,
      shouldRestoreInlineFile: shouldRestoreHostedRuntimeInlineFile,
    });
    if (input.trackSkippedInlineFiles) {
      if (input.appendSkippedInlineFiles) {
        await appendHostedWorkspaceSkippedInlineFiles({
          files: skippedInlineFiles,
          vaultRoot: input.restored.vaultRoot,
        });
      } else {
        await writeHostedWorkspaceSkippedInlineFiles({
          files: skippedInlineFiles,
          vaultRoot: input.restored.vaultRoot,
        });
      }
    }
    await sanitizeRestoredHostedCodexResumeState({
      assistantStateRoot: input.restored.assistantStateRoot,
      operatorHomeRoot: input.restored.operatorHomeRoot,
    });
  } catch (error) {
    await clearHostedCodexHomeRestoreRoot(input.restored.operatorHomeRoot);
    throw error;
  }
}

async function appendHostedWorkspaceSkippedInlineFiles(input: {
  files: readonly HostedWorkspaceSkippedInlineFile[];
  vaultRoot: string;
}): Promise<void> {
  if (input.files.length === 0) {
    return;
  }

  let existing: HostedWorkspaceSkippedInlineFile[] = [];
  try {
    existing = await readHostedWorkspaceSkippedInlineFiles({
      vaultRoot: input.vaultRoot,
    });
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  const files = new Map<string, HostedWorkspaceSkippedInlineFile>();
  for (const file of existing) {
    files.set(`${file.root}:${file.path}`, file);
  }
  for (const file of input.files) {
    files.set(`${file.root}:${file.path}`, file);
  }

  await writeHostedWorkspaceSkippedInlineFiles({
    files: [...files.values()],
    vaultRoot: input.vaultRoot,
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

function shouldRestoreHostedRuntimeEagerArtifact(input: {
  path: string;
  root: string;
}): boolean {
  if (input.root === HOSTED_OPERATOR_HOME_ROOT_KEY) {
    return hasHostedRuntimeEagerArtifactPrefix(
      input.path,
      HOSTED_CODEX_HOME_RELATIVE_PATH,
    );
  }

  if (input.root !== "vault") {
    return false;
  }

  return !isHostedRuntimeLazyVaultContentPath(input.path);
}

function shouldRestoreHostedRuntimeInlineFile(input: {
  path: string;
  root: string;
}): boolean {
  if (input.root !== "vault") {
    return true;
  }

  return !isHostedRuntimeLazyVaultContentPath(input.path);
}

function isHostedRuntimeLazyVaultContentPath(relativePath: string): boolean {
  return (
    hasHostedRuntimeEagerArtifactPrefix(relativePath, "raw")
    || hasHostedRuntimeEagerArtifactPrefix(relativePath, "derived")
  );
}

function hasHostedRuntimeEagerArtifactPrefix(
  relativePath: string,
  prefix: string,
): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}

function readHostedWorkspaceRuntimeLocalRoots(
  vaultRoot: string,
): HostedRestoredExecutionContext {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(resolvedVaultRoot).assistantStateRoot;
  const operatorHomeRoot = resolveHostedWorkspaceOperatorHomeRoot(resolvedVaultRoot);

  return {
    assistantStateRoot,
    operatorHomeRoot,
    vaultRoot: resolvedVaultRoot,
  };
}

function resolveHostedWorkspaceDurableRoot(vaultRoot: string): string {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  if (path.basename(resolvedVaultRoot) === "vault") {
    return path.dirname(resolvedVaultRoot);
  }
  return resolvedVaultRoot;
}

function resolveHostedWorkspaceScratchRoot(vaultRoot: string): string {
  const durableRoot = resolveHostedWorkspaceDurableRoot(vaultRoot);
  if (path.basename(durableRoot) === "durable") {
    return path.join(path.dirname(durableRoot), "scratch");
  }
  return path.join(path.dirname(durableRoot), `${path.basename(durableRoot)}-scratch`);
}

function resolveHostedWorkspaceOperatorHomeRoot(vaultRoot: string): string {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const parent = path.dirname(resolvedVaultRoot);
  if (path.basename(resolvedVaultRoot) === "vault" && path.basename(parent) === "durable") {
    return path.join(parent, "home");
  }
  return path.join(parent, `${path.basename(resolvedVaultRoot)}-operator-home`);
}

async function createHostedWorkspaceRuntimePrivateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(directoryPath, 0o700);
}

async function clearHostedWorkspaceRuntimeLocalRoots(
  restored: HostedRestoredExecutionContext,
): Promise<void> {
  await Promise.all([
    clearHostedWorkspaceLiveRuntimeStateBestEffort(restored.vaultRoot),
    rm(restored.operatorHomeRoot, {
      force: true,
      recursive: true,
    }),
    rm(restored.vaultRoot, {
      force: true,
      recursive: true,
    }),
  ]);
  await Promise.all([
    createHostedWorkspaceRuntimePrivateDirectory(restored.operatorHomeRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.vaultRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.assistantStateRoot),
  ]);
}

async function clearHostedWorkspaceRestoreCachesBestEffort(vaultRoot: string): Promise<void> {
  await Promise.all([
    clearHostedWorkspaceBaseRestoreCacheBestEffort(vaultRoot),
    clearHostedWorkspaceCleanCheckpointMarkerBestEffort(vaultRoot),
    clearHostedWorkspaceHotRestoreCacheBestEffort(vaultRoot),
    clearHostedWorkspaceWorkingRestoreCacheBestEffort(vaultRoot),
    clearHostedWorkspaceLiveRuntimeStateBestEffort(vaultRoot),
  ]);
}
