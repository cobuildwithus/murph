import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
} from "@murphai/hosted-execution/parsers";
import {
  clearHostedAssistantRuntimeHotState,
  clearHostedCodexContinuityRestoreRoot,
  createHostedPortableWorkspaceManifestFromBundle,
  hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity,
  repairLegacyHostedWorkspaceSnapshotProviderContinuity,
  readHostedPortableWorkspaceManifestFromBundle,
  restoredWorkspaceRequiresHostedCodexProviderContinuity,
  resolveAssistantStatePaths,
  restoreHostedBundleRoots,
  restoreHostedWorkspaceWorkingDelta,
  verifyRestoredHostedCodexContinuityManifest,
  readHostedWorkspaceSkippedInlineFiles,
  writeHostedWorkspaceSkippedInlineFiles,
  type HostedWorkspaceSkippedInlineFile,
} from "@murphai/runtime-state/node";
import {
  buildHostedRuntimeLogContextFields,
  type HostedRuntimeLogContext,
  writeHostedRuntimeLogBestEffort,
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
const HOSTED_WORKSPACE_BASE_RESTORE_CACHE_SCHEMA = "murph.hosted-workspace-base-restore-cache.v2";
const HOSTED_WORKSPACE_BASE_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-base-restore-cache.json";
const HOSTED_WORKSPACE_HOT_RESTORE_CACHE_SCHEMA = "murph.hosted-workspace-hot-restore-cache.v2";
const HOSTED_WORKSPACE_HOT_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-hot-restore-cache.json";
const HOSTED_WORKSPACE_WORKING_RESTORE_CACHE_SCHEMA = "murph.hosted-workspace-working-restore-cache.v1";
const HOSTED_WORKSPACE_WORKING_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-working-restore-cache.json";

export type HostedWorkspaceRuntimeRestoreMode = "null-bootstrap" | "snapshot";

export interface HostedWorkspaceRuntimeRestoreResult
  extends HostedRestoredExecutionContext {
  materializeWorkspaceArtifacts: HostedWorkspaceArtifactMaterializer;
  materializedArtifactPaths: ReadonlySet<string>;
  mode: HostedWorkspaceRuntimeRestoreMode;
  restoreWasCold: boolean;
}

export class HostedWorkspaceRuntimeSnapshotRestoreError extends Error {
  readonly snapshotHash: string;

  constructor(snapshotHash: string) {
    super("Hosted workspace runtime job snapshot restore failed.");
    this.name = "HostedWorkspaceRuntimeSnapshotRestoreError";
    this.snapshotHash = snapshotHash;
  }
}

interface HostedWorkspaceBaseRestoreCache {
  baseProvidesCodexProviderContinuity: boolean;
  baseSnapshotHash: string;
  baseSnapshotSize: number;
  schema: typeof HOSTED_WORKSPACE_BASE_RESTORE_CACHE_SCHEMA;
  vaultRootName: string;
}

interface HostedWorkspaceHotRestoreCache {
  baseSnapshotHash: string;
  baseSnapshotSize: number;
  hotSnapshotHash: string;
  hotSnapshotSize: number;
  schema: typeof HOSTED_WORKSPACE_HOT_RESTORE_CACHE_SCHEMA;
  vaultRootName: string;
}

interface HostedWorkspaceWorkingRestoreCache {
  baseSnapshotHash: string;
  baseSnapshotSize: number;
  deltaSnapshotHash: string;
  deltaSnapshotSize: number;
  schema: typeof HOSTED_WORKSPACE_WORKING_RESTORE_CACHE_SCHEMA;
  vaultRootName: string;
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
  const materializedArtifactPaths = await readHostedMaterializedArtifactPaths({
    vaultRoot: restored.vaultRoot,
  });
  const materializerBundles: Array<() => Promise<Uint8Array | ArrayBuffer | null>> = [];

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

  if (baseSnapshotRef && deltaSnapshotRef && !hotSnapshotRef) {
    const cachedWorkingRestore = await readHostedWorkspaceWorkingRestoreCache(restored.vaultRoot);
    if (
      cachedWorkingRestore
      && isHostedWorkspaceWorkingRestoreCacheHit({
        baseRef: baseSnapshotRef,
        cache: cachedWorkingRestore,
        deltaRef: deltaSnapshotRef,
        vaultRoot: restored.vaultRoot,
      })
    ) {
      try {
        await verifyRestoredHostedCodexContinuityManifest(restored.operatorHomeRoot, {
          assistantStateRoot: resolveAssistantStatePaths(restored.vaultRoot).assistantStateRoot,
        });
        materializerBundles.push(
          () => readHostedWorkspaceRuntimeBundle({
            platform: input.platform,
            ref: baseSnapshotRef,
          }),
          () => readHostedWorkspaceRuntimeBundle({
            platform: input.platform,
            ref: deltaSnapshotRef,
          }),
        );
        await applyHostedCanonicalWriteReceiptsFromWorkspaceState({
          platform: input.platform,
          status: input.workspace?.redactedStatus ?? null,
          vaultRoot: restored.vaultRoot,
        });
        return {
          ...restored,
          materializeWorkspaceArtifacts: createHostedWorkspaceRuntimeArtifactMaterializer({
            materializedArtifactPaths,
            platform: input.platform,
            restored,
            readBundles: materializerBundles,
          }),
          materializedArtifactPaths,
          mode: "snapshot",
          restoreWasCold: false,
        };
      } catch {
        await clearHostedWorkspaceWorkingRestoreCacheBestEffort(restored.vaultRoot);
      }
    }
  }

  let baseRestoreCacheHit = false;
  let restoreWasCold = false;
  if (baseSnapshotRef) {
    const cachedBaseRestore = await readHostedWorkspaceBaseRestoreCache(restored.vaultRoot);
    let useCachedBaseRestore = false;
    const canUseCachedBaseRestore = !deltaSnapshotRef;

    if (canUseCachedBaseRestore && cachedBaseRestore && isHostedWorkspaceBaseRestoreCacheHit({
      cache: cachedBaseRestore,
      ref: baseSnapshotRef,
      vaultRoot: restored.vaultRoot,
    })) {
      try {
        if (cachedBaseRestore.baseProvidesCodexProviderContinuity) {
          await verifyRestoredHostedCodexContinuityManifest(restored.operatorHomeRoot, {
            allowUnmanifestedCodexHomeFiles: true,
            assistantStateRoot: resolveAssistantStatePaths(restored.vaultRoot).assistantStateRoot,
            requireManifest: true,
          });
        }
        useCachedBaseRestore = true;
      } catch {
        await clearHostedWorkspaceBaseRestoreCacheBestEffort(restored.vaultRoot);
      }
    }

    if (useCachedBaseRestore) {
      baseRestoreCacheHit = true;
      materializerBundles.push(() => readHostedWorkspaceRuntimeBundle({
        platform: input.platform,
        ref: baseSnapshotRef,
      }));
    } else {
      restoreWasCold = true;
      const baseBundle = await readHostedWorkspaceRuntimeBundle({
        platform: input.platform,
        ref: baseSnapshotRef,
      });
      const baseRepair = await repairHostedWorkspaceRuntimeBundleProviderContinuity({
        bundle: baseBundle,
        logContext: input.logContext ?? null,
        platform: input.platform,
        snapshotLayer: "base",
      });
      materializerBundles.push(async () => baseRepair.bundle);
      if (deltaSnapshotRef) {
        await clearHostedWorkspaceRuntimeLocalRoots(restored);
      }
      await restoreHostedWorkspaceRuntimeBundle({
        bundle: baseRepair.bundle,
        platform: input.platform,
        ref: baseSnapshotRef,
        restored,
        trackSkippedInlineFiles: true,
      });
      const baseProvidesCodexProviderContinuity = hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity({
        bundle: baseRepair.bundle,
      });
      await writeHostedWorkspaceBaseRestoreCacheBestEffort({
        cache: {
          baseProvidesCodexProviderContinuity,
          baseSnapshotHash: baseSnapshotRef.hash,
          baseSnapshotSize: baseSnapshotRef.size,
          schema: HOSTED_WORKSPACE_BASE_RESTORE_CACHE_SCHEMA,
          vaultRootName: readHostedWorkspaceRestoreCacheVaultRootName(restored.vaultRoot),
        },
        vaultRoot: restored.vaultRoot,
      });
    }
  }

  if (hotSnapshotRef) {
    const cachedHotRestore = baseSnapshotRef && baseRestoreCacheHit
      ? await readHostedWorkspaceHotRestoreCache(restored.vaultRoot)
      : null;
    if (
      baseSnapshotRef
      && cachedHotRestore
      && isHostedWorkspaceHotRestoreCacheHit({
        baseRef: baseSnapshotRef,
        cache: cachedHotRestore,
        hotRef: hotSnapshotRef,
        vaultRoot: restored.vaultRoot,
      })
    ) {
      try {
        await verifyRestoredHostedCodexContinuityManifest(restored.operatorHomeRoot, {
          allowUnmanifestedCodexHomeFiles: true,
          assistantStateRoot: resolveAssistantStatePaths(restored.vaultRoot).assistantStateRoot,
          requireManifest: await restoredWorkspaceRequiresHostedCodexProviderContinuity({
            vaultRoot: restored.vaultRoot,
          }),
        });
        materializerBundles.push(() => readHostedWorkspaceRuntimeBundle({
          platform: input.platform,
          ref: hotSnapshotRef,
        }));
      } catch {
        await clearHostedWorkspaceHotRestoreCacheBestEffort(restored.vaultRoot);
        restoreWasCold = true;
        const restoredHotBundle = await restoreHostedWorkspaceRuntimeHotLayer({
          hotSnapshotRef,
          input,
          restored,
        });
        await writeHostedWorkspaceHotRestoreCacheForSnapshotRefBestEffort({
          snapshotRef: input.workspace?.snapshotRef ?? null,
          vaultRoot: restored.vaultRoot,
        });
        materializerBundles.push(async () => restoredHotBundle);
      }
    } else {
      await clearHostedWorkspaceHotRestoreCacheBestEffort(restored.vaultRoot);
      restoreWasCold = true;
      const restoredHotBundle = await restoreHostedWorkspaceRuntimeHotLayer({
        hotSnapshotRef,
        input,
        restored,
      });
      await writeHostedWorkspaceHotRestoreCacheForSnapshotRefBestEffort({
        snapshotRef: input.workspace?.snapshotRef ?? null,
        vaultRoot: restored.vaultRoot,
      });
      materializerBundles.push(async () => restoredHotBundle);
    }
  }

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
    if (!hotSnapshotRef) {
      await writeHostedWorkspaceWorkingRestoreCacheBestEffort({
        baseRef: baseSnapshotRef,
        deltaRef: deltaSnapshotRef,
        vaultRoot: restored.vaultRoot,
      });
    }
  }

  await applyHostedCanonicalWriteReceiptsFromWorkspaceState({
    platform: input.platform,
    status: input.workspace?.redactedStatus ?? null,
    vaultRoot: restored.vaultRoot,
  });

  return {
    ...restored,
    materializeWorkspaceArtifacts: createHostedWorkspaceRuntimeArtifactMaterializer({
      materializedArtifactPaths,
      platform: input.platform,
      restored,
      readBundles: materializerBundles,
    }),
    materializedArtifactPaths,
    mode: "snapshot",
    restoreWasCold,
  };
}

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
  const hotRepair = await repairHostedWorkspaceRuntimeBundleProviderContinuity({
    bundle: hotBundle,
    logContext: input.input.logContext ?? null,
    platform: input.input.platform,
    snapshotLayer: "hot",
  });
  const hotBundleRepaired =
    hotRepair.removedMalformedSessionCount > 0 || hotRepair.scrubbedSessionCount > 0;
  await clearHostedAssistantRuntimeHotState({
    operatorHomeRoot: hotBundleRepaired || hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity({
      bundle: hotRepair.bundle,
    })
      ? input.restored.operatorHomeRoot
      : null,
    vaultRoot: input.restored.vaultRoot,
  });
  await restoreHostedWorkspaceRuntimeBundle({
    bundle: hotRepair.bundle,
    platform: input.input.platform,
    ref: input.hotSnapshotRef,
    restored: input.restored,
    appendSkippedInlineFiles: true,
    trackSkippedInlineFiles: true,
  });
  return hotRepair.bundle;
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

async function repairHostedWorkspaceRuntimeBundleProviderContinuity(input: {
  bundle: Uint8Array | ArrayBuffer;
  logContext?: HostedRuntimeLogContext | null;
  platform: HostedRuntimePlatform;
  snapshotLayer: "base" | "hot";
}): Promise<{
  bundle: Uint8Array | ArrayBuffer;
  removedMalformedSessionCount: number;
  scrubbedSessionCount: number;
}> {
  const repair = repairLegacyHostedWorkspaceSnapshotProviderContinuity({
    bundle: input.bundle,
  });
  if (repair.removedMalformedSessionCount === 0 && repair.scrubbedSessionCount === 0) {
    return repair;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.logContext),
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

async function readHostedWorkspaceBaseRestoreCache(
  vaultRoot: string,
): Promise<HostedWorkspaceBaseRestoreCache | null> {
  try {
    const contents = await readFile(resolveHostedWorkspaceBaseRestoreCachePath(vaultRoot), "utf8");
    const parsed: unknown = JSON.parse(contents);
    return parseHostedWorkspaceBaseRestoreCache(parsed);
  } catch {
    return null;
  }
}

async function writeHostedWorkspaceBaseRestoreCacheBestEffort(input: {
  cache: HostedWorkspaceBaseRestoreCache;
  vaultRoot: string;
}): Promise<void> {
  try {
    await writeFile(
      resolveHostedWorkspaceBaseRestoreCachePath(input.vaultRoot),
      JSON.stringify(input.cache) + "\n",
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  } catch {
    // Restore remains correct without the local cache marker; the next run will cold-restore base.
  }
}

async function clearHostedWorkspaceBaseRestoreCacheBestEffort(vaultRoot: string): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceBaseRestoreCachePath(vaultRoot), { force: true });
  } catch {
    // A stale base cache marker should not block cold restore from the source bundle.
  }
}

export async function writeHostedWorkspaceHotRestoreCacheForSnapshotRefBestEffort(input: {
  snapshotRef: HostedWorkspaceState["snapshotRef"];
  vaultRoot: string;
}): Promise<void> {
  const baseSnapshotRef = readHostedExecutionSnapshotBaseRef(input.snapshotRef ?? null);
  const hotSnapshotRef = readHostedExecutionSnapshotHotRef(input.snapshotRef ?? null);
  if (!baseSnapshotRef || !hotSnapshotRef) {
    await clearHostedWorkspaceHotRestoreCacheBestEffort(input.vaultRoot);
    return;
  }

  try {
    await writeFile(
      resolveHostedWorkspaceHotRestoreCachePath(input.vaultRoot),
      JSON.stringify({
        baseSnapshotHash: baseSnapshotRef.hash,
        baseSnapshotSize: baseSnapshotRef.size,
        hotSnapshotHash: hotSnapshotRef.hash,
        hotSnapshotSize: hotSnapshotRef.size,
        schema: HOSTED_WORKSPACE_HOT_RESTORE_CACHE_SCHEMA,
        vaultRootName: readHostedWorkspaceRestoreCacheVaultRootName(input.vaultRoot),
      } satisfies HostedWorkspaceHotRestoreCache) + "\n",
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  } catch {
    // Restore remains correct without the hot marker; the next run will rematerialize hot state.
  }
}

async function readHostedWorkspaceHotRestoreCache(
  vaultRoot: string,
): Promise<HostedWorkspaceHotRestoreCache | null> {
  try {
    const contents = await readFile(resolveHostedWorkspaceHotRestoreCachePath(vaultRoot), "utf8");
    const parsed: unknown = JSON.parse(contents);
    return parseHostedWorkspaceHotRestoreCache(parsed);
  } catch {
    return null;
  }
}

async function clearHostedWorkspaceHotRestoreCacheBestEffort(vaultRoot: string): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceHotRestoreCachePath(vaultRoot), { force: true });
  } catch {
    // A stale or missing cache marker only affects performance, not correctness.
  }
}

async function readHostedWorkspaceWorkingRestoreCache(
  vaultRoot: string,
): Promise<HostedWorkspaceWorkingRestoreCache | null> {
  try {
    const contents = await readFile(resolveHostedWorkspaceWorkingRestoreCachePath(vaultRoot), "utf8");
    const parsed: unknown = JSON.parse(contents);
    return parseHostedWorkspaceWorkingRestoreCache(parsed);
  } catch {
    return null;
  }
}

async function writeHostedWorkspaceWorkingRestoreCacheBestEffort(input: {
  baseRef: HostedExecutionBundleRef;
  deltaRef: HostedExecutionBundleRef;
  vaultRoot: string;
}): Promise<void> {
  try {
    await writeFile(
      resolveHostedWorkspaceWorkingRestoreCachePath(input.vaultRoot),
      JSON.stringify({
        baseSnapshotHash: input.baseRef.hash,
        baseSnapshotSize: input.baseRef.size,
        deltaSnapshotHash: input.deltaRef.hash,
        deltaSnapshotSize: input.deltaRef.size,
        schema: HOSTED_WORKSPACE_WORKING_RESTORE_CACHE_SCHEMA,
        vaultRootName: readHostedWorkspaceRestoreCacheVaultRootName(input.vaultRoot),
      } satisfies HostedWorkspaceWorkingRestoreCache) + "\n",
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  } catch {
    // Restore remains correct without the local working marker; the next run will cold-restore the delta.
  }
}

async function clearHostedWorkspaceWorkingRestoreCacheBestEffort(vaultRoot: string): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceWorkingRestoreCachePath(vaultRoot), { force: true });
  } catch {
    // A stale or missing cache marker only affects performance, not correctness.
  }
}

function isHostedWorkspaceBaseRestoreCacheHit(input: {
  cache: HostedWorkspaceBaseRestoreCache;
  ref: HostedExecutionBundleRef;
  vaultRoot: string;
}): boolean {
  return (
    input.cache.baseSnapshotHash === input.ref.hash
    && input.cache.baseSnapshotSize === input.ref.size
    && input.cache.vaultRootName === readHostedWorkspaceRestoreCacheVaultRootName(input.vaultRoot)
  );
}

function isHostedWorkspaceHotRestoreCacheHit(input: {
  baseRef: HostedExecutionBundleRef;
  cache: HostedWorkspaceHotRestoreCache;
  hotRef: HostedExecutionBundleRef;
  vaultRoot: string;
}): boolean {
  return (
    input.cache.baseSnapshotHash === input.baseRef.hash
    && input.cache.baseSnapshotSize === input.baseRef.size
    && input.cache.hotSnapshotHash === input.hotRef.hash
    && input.cache.hotSnapshotSize === input.hotRef.size
    && input.cache.vaultRootName === readHostedWorkspaceRestoreCacheVaultRootName(input.vaultRoot)
  );
}

function isHostedWorkspaceWorkingRestoreCacheHit(input: {
  baseRef: HostedExecutionBundleRef;
  cache: HostedWorkspaceWorkingRestoreCache;
  deltaRef: HostedExecutionBundleRef;
  vaultRoot: string;
}): boolean {
  return (
    input.cache.baseSnapshotHash === input.baseRef.hash
    && input.cache.baseSnapshotSize === input.baseRef.size
    && input.cache.deltaSnapshotHash === input.deltaRef.hash
    && input.cache.deltaSnapshotSize === input.deltaRef.size
    && input.cache.vaultRootName === readHostedWorkspaceRestoreCacheVaultRootName(input.vaultRoot)
  );
}

function parseHostedWorkspaceBaseRestoreCache(
  value: unknown,
): HostedWorkspaceBaseRestoreCache | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.schema !== HOSTED_WORKSPACE_BASE_RESTORE_CACHE_SCHEMA) {
    return null;
  }
  if (typeof value.baseSnapshotHash !== "string") {
    return null;
  }
  if (typeof value.baseSnapshotSize !== "number") {
    return null;
  }
  if (typeof value.baseProvidesCodexProviderContinuity !== "boolean") {
    return null;
  }
  if (typeof value.vaultRootName !== "string") {
    return null;
  }

  return {
    baseProvidesCodexProviderContinuity: value.baseProvidesCodexProviderContinuity,
    baseSnapshotHash: value.baseSnapshotHash,
    baseSnapshotSize: value.baseSnapshotSize,
    schema: HOSTED_WORKSPACE_BASE_RESTORE_CACHE_SCHEMA,
    vaultRootName: value.vaultRootName,
  };
}

function parseHostedWorkspaceHotRestoreCache(
  value: unknown,
): HostedWorkspaceHotRestoreCache | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.schema !== HOSTED_WORKSPACE_HOT_RESTORE_CACHE_SCHEMA) {
    return null;
  }
  if (typeof value.baseSnapshotHash !== "string") {
    return null;
  }
  if (typeof value.baseSnapshotSize !== "number") {
    return null;
  }
  if (typeof value.hotSnapshotHash !== "string") {
    return null;
  }
  if (typeof value.hotSnapshotSize !== "number") {
    return null;
  }
  if (typeof value.vaultRootName !== "string") {
    return null;
  }

  return {
    baseSnapshotHash: value.baseSnapshotHash,
    baseSnapshotSize: value.baseSnapshotSize,
    hotSnapshotHash: value.hotSnapshotHash,
    hotSnapshotSize: value.hotSnapshotSize,
    schema: HOSTED_WORKSPACE_HOT_RESTORE_CACHE_SCHEMA,
    vaultRootName: value.vaultRootName,
  };
}

function parseHostedWorkspaceWorkingRestoreCache(
  value: unknown,
): HostedWorkspaceWorkingRestoreCache | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.schema !== HOSTED_WORKSPACE_WORKING_RESTORE_CACHE_SCHEMA) {
    return null;
  }
  if (typeof value.baseSnapshotHash !== "string") {
    return null;
  }
  if (typeof value.baseSnapshotSize !== "number") {
    return null;
  }
  if (typeof value.deltaSnapshotHash !== "string") {
    return null;
  }
  if (typeof value.deltaSnapshotSize !== "number") {
    return null;
  }
  if (typeof value.vaultRootName !== "string") {
    return null;
  }

  return {
    baseSnapshotHash: value.baseSnapshotHash,
    baseSnapshotSize: value.baseSnapshotSize,
    deltaSnapshotHash: value.deltaSnapshotHash,
    deltaSnapshotSize: value.deltaSnapshotSize,
    schema: HOSTED_WORKSPACE_WORKING_RESTORE_CACHE_SCHEMA,
    vaultRootName: value.vaultRootName,
  };
}

function readHostedWorkspaceRestoreCacheVaultRootName(vaultRoot: string): string {
  return path.basename(path.resolve(vaultRoot));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

  return !isHostedRuntimeLazyContentPath(input.path);
}

function shouldRestoreHostedRuntimeInlineFile(input: {
  path: string;
  root: string;
}): boolean {
  if (input.root !== "vault") {
    return true;
  }

  return !isHostedRuntimeLazyContentPath(input.path);
}

function isHostedRuntimeLazyContentPath(relativePath: string): boolean {
  return (
    hasHostedRuntimeEagerArtifactPrefix(relativePath, "raw/inbox")
    || hasHostedRuntimeEagerArtifactPrefix(relativePath, "raw/assistant-input")
    || hasHostedRuntimeEagerArtifactPrefix(relativePath, "derived/inbox")
    || hasHostedRuntimeEagerArtifactPrefix(relativePath, "derived/assistant-input")
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

async function clearHostedWorkspaceRuntimeLocalRoots(
  restored: HostedRestoredExecutionContext,
): Promise<void> {
  await Promise.all([
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
