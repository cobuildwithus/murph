import { chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  applyHostedCanonicalWriteReceipt,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  type HostedCanonicalWriteReceiptAction,
  type HostedCanonicalWriteReceiptContentRef,
  type HostedCanonicalWriteReceipt,
} from "@murphai/core";
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
import {
  clearHostedAssistantRuntimeHotState,
  clearHostedCodexContinuityRestoreRoot,
  createHostedPortableWorkspaceManifestFromBundle,
  hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity,
  readHostedPortableWorkspaceManifestFromBundle,
  resolveAssistantStatePaths,
  restoreHostedBundleRoots,
  restoreHostedWorkspaceWorkingDelta,
  verifyRestoredHostedCodexContinuityManifest,
  readHostedWorkspaceSkippedInlineFiles,
  writeHostedWorkspaceSkippedInlineFiles,
  type HostedWorkspaceSkippedInlineFile,
} from "@murphai/runtime-state/node";
import type {
  HostedRuntimeLogContext,
} from "./runtime-logs.ts";
import {
  readHostedCanonicalWriteReceiptLogEntries,
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

// Legacy restore-only compatibility for pre-v2 workspace refs. Production v2
// checkpoints no longer create base, hot, working, bundle, or delta refs; these
// caches and paths are deletable after the v2 migration window.
const HOSTED_WORKSPACE_BASE_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-base-restore-cache.json";
const HOSTED_WORKSPACE_HOT_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-hot-restore-cache.json";
const HOSTED_WORKSPACE_WORKING_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-working-restore-cache.json";
const HOSTED_WORKSPACE_LIVE_RUNTIME_STATE_FILE_NAME = ".hosted-workspace-live-runtime-state.json";

export type HostedWorkspaceRuntimeRestoreMode = "null-bootstrap" | "snapshot";

export interface HostedWorkspaceRuntimeRestoreResult
  extends HostedRestoredExecutionContext {
  materializeWorkspaceArtifacts: HostedWorkspaceArtifactMaterializer;
  materializedArtifactPaths: ReadonlySet<string>;
  mode: HostedWorkspaceRuntimeRestoreMode;
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
  const restored = await createHostedWorkspaceRuntimeLocalRoots(input.vaultRoot);
  const snapshotRef = input.workspace?.snapshotRef ?? null;
  const baseSnapshotRef = readHostedExecutionSnapshotBaseRef(snapshotRef);
  const deltaSnapshotRef = readHostedExecutionSnapshotDeltaRef(snapshotRef);
  const hotSnapshotRef = readHostedExecutionSnapshotHotRef(snapshotRef);
  const materializerBundles: Array<() => Promise<Uint8Array | ArrayBuffer | null>> = [];

  await clearHostedWorkspaceLiveRuntimeStateBestEffort(restored.vaultRoot);

  const materializedArtifactPaths = await readHostedMaterializedArtifactPaths({
    vaultRoot: restored.vaultRoot,
  });

  // Current v2 restore path: restore the single direct-R2 encrypted snapshot
  // without legacy bundle, hot-layer, delta, or sidecar artifact handling.
  if (isHostedWorkspaceSnapshotV2Ref(snapshotRef)) {
    if (!input.platform.workspaceSnapshotPort) {
      throw new Error("Hosted workspace snapshot v2 restore requires a workspace snapshot port.");
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
    await verifyRestoredHostedCodexContinuityManifest(restored.operatorHomeRoot, {
      assistantStateRoot: restored.assistantStateRoot,
      missingManifest: "preserve",
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
      restoreWasCold: true,
    };
  }

  if (!baseSnapshotRef && !hotSnapshotRef && !deltaSnapshotRef) {
    return {
      ...restored,
      materializeWorkspaceArtifacts: createHostedWorkspaceRuntimeArtifactMaterializer({
        materializedArtifactPaths,
        platform: input.platform,
        restored,
        readBundles: materializerBundles,
      }),
      materializedArtifactPaths,
      mode: "null-bootstrap",
      restoreWasCold: false,
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
    await verifyRestoredHostedCodexContinuityManifest(restored.operatorHomeRoot, {
      assistantStateRoot: resolveAssistantStatePaths(restored.vaultRoot).assistantStateRoot,
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
    restoreWasCold,
  };
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
    operatorHomeRoot: hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity({
      bundle: hotBundle,
    })
      ? input.restored.operatorHomeRoot
      : null,
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
  // Dirty local runtime state is valid only inside the currently owned child
  // process. A later lease must restore from durable workspace truth.
  await clearHostedWorkspaceLiveRuntimeStateBestEffort(input.vaultRoot);
}

async function clearHostedWorkspaceLiveRuntimeStateBestEffort(vaultRoot: string): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceLiveRuntimeStatePath(vaultRoot), { force: true });
  } catch {
    // The legacy marker is best-effort cleanup only.
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

  await clearHostedCodexContinuityRestoreRoot(input.restored.operatorHomeRoot);
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
    await verifyRestoredHostedCodexContinuityManifest(input.restored.operatorHomeRoot, {
      assistantStateRoot: resolveAssistantStatePaths(input.restored.vaultRoot).assistantStateRoot,
    });
  } catch (error) {
    await clearHostedCodexContinuityRestoreRoot(input.restored.operatorHomeRoot);
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

async function createHostedWorkspaceRuntimeLocalRoots(
  vaultRoot: string,
): Promise<HostedRestoredExecutionContext> {
  const restored = readHostedWorkspaceRuntimeLocalRoots(vaultRoot);

  await Promise.all([
    createHostedWorkspaceRuntimePrivateDirectory(restored.vaultRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.assistantStateRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.operatorHomeRoot),
  ]);

  return restored;
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
    clearHostedWorkspaceHotRestoreCacheBestEffort(vaultRoot),
    clearHostedWorkspaceWorkingRestoreCacheBestEffort(vaultRoot),
    clearHostedWorkspaceLiveRuntimeStateBestEffort(vaultRoot),
  ]);
}
