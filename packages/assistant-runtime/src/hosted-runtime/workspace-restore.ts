import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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
  buildHostedRuntimeLogContextFields,
  type HostedRuntimeLogContext,
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
const HOSTED_WORKSPACE_BASE_RESTORE_CACHE_SCHEMA = "murph.hosted-workspace-base-restore-cache.v1";
const HOSTED_WORKSPACE_BASE_RESTORE_CACHE_FILE_NAME = ".hosted-workspace-base-restore-cache.json";

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

interface HostedWorkspaceBaseRestoreCache {
  baseProvidesCodexProviderContinuity: boolean;
  baseSnapshotHash: string;
  baseSnapshotSize: number;
  schema: typeof HOSTED_WORKSPACE_BASE_RESTORE_CACHE_SCHEMA;
}

export async function restoreHostedWorkspaceRuntimeJobWorkspace(input: {
  logContext?: HostedRuntimeLogContext | null;
  platform: HostedRuntimePlatform;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedWorkspaceRuntimeRestoreResult> {
  const restoreStartedAt = Date.now();
  const localRootsStartedAt = Date.now();
  const restored = await createHostedWorkspaceRuntimeLocalRoots(input.vaultRoot);
  const localRootsElapsedMs = Date.now() - localRootsStartedAt;
  const snapshotRef = input.workspace?.snapshotRef ?? null;
  const baseSnapshotRef = readHostedExecutionSnapshotBaseRef(snapshotRef);
  const hotSnapshotRef = readHostedExecutionSnapshotHotRef(snapshotRef);

  if (!baseSnapshotRef && !hotSnapshotRef) {
    await writeHostedWorkspaceRestoreStartedLog({
      baseSnapshotRef: null,
      hotSnapshotRef: null,
      localRootsElapsedMs,
      logContext: input.logContext ?? null,
      mode: "null-bootstrap",
      platform: input.platform,
    });
    await writeHostedWorkspaceRestoreFinishedLog({
      baseSnapshotRef: null,
      hotSnapshotRef: null,
      logContext: input.logContext ?? null,
      mode: "null-bootstrap",
      platform: input.platform,
      totalElapsedMs: Date.now() - restoreStartedAt,
    });
    return {
      ...restored,
      mode: "null-bootstrap",
    };
  }

  await writeHostedWorkspaceRestoreStartedLog({
    baseSnapshotRef,
    hotSnapshotRef,
    localRootsElapsedMs,
    logContext: input.logContext ?? null,
    mode: "snapshot",
    platform: input.platform,
  });

  let baseProvidesCodexProviderContinuity = false;
  if (baseSnapshotRef) {
    const cachedBaseRestore = await readHostedWorkspaceBaseRestoreCache(restored.vaultRoot);

    if (cachedBaseRestore && isHostedWorkspaceBaseRestoreCacheHit({
      cache: cachedBaseRestore,
      ref: baseSnapshotRef,
    })) {
      baseProvidesCodexProviderContinuity = cachedBaseRestore.baseProvidesCodexProviderContinuity;
      await writeHostedWorkspaceRestoreLayerFinishedLog({
        bundleBytes: baseSnapshotRef.size,
        cacheHit: true,
        fetchElapsedMs: 0,
        logContext: input.logContext ?? null,
        materializeElapsedMs: 0,
        platform: input.platform,
        ref: baseSnapshotRef,
        repairElapsedMs: 0,
        repairRemovedMalformedSessionCount: 0,
        repairScrubbedSessionCount: 0,
        snapshotLayer: "base",
        totalElapsedMs: 0,
      });
    } else {
      const layerStartedAt = Date.now();
      const fetchStartedAt = Date.now();
      const baseBundle = await readHostedWorkspaceRuntimeBundle({
        platform: input.platform,
        ref: baseSnapshotRef,
      });
      const fetchElapsedMs = Date.now() - fetchStartedAt;
      const repairStartedAt = Date.now();
      const baseRepair = await repairHostedWorkspaceRuntimeBundleProviderContinuity({
        bundle: baseBundle,
        logContext: input.logContext ?? null,
        platform: input.platform,
        snapshotLayer: "base",
      });
      const repairElapsedMs = Date.now() - repairStartedAt;
      const materializeStartedAt = Date.now();
      await restoreHostedWorkspaceRuntimeBundle({
        bundle: baseRepair.bundle,
        platform: input.platform,
        ref: baseSnapshotRef,
        restored,
      });
      const materializeElapsedMs = Date.now() - materializeStartedAt;
      baseProvidesCodexProviderContinuity = hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity({
        bundle: baseRepair.bundle,
      });
      await writeHostedWorkspaceBaseRestoreCacheBestEffort({
        cache: {
          baseProvidesCodexProviderContinuity,
          baseSnapshotHash: baseSnapshotRef.hash,
          baseSnapshotSize: baseSnapshotRef.size,
          schema: HOSTED_WORKSPACE_BASE_RESTORE_CACHE_SCHEMA,
        },
        vaultRoot: restored.vaultRoot,
      });
      await writeHostedWorkspaceRestoreLayerFinishedLog({
        bundleBytes: readBundleByteLength(baseRepair.bundle),
        fetchElapsedMs,
        logContext: input.logContext ?? null,
        materializeElapsedMs,
        platform: input.platform,
        ref: baseSnapshotRef,
        repairElapsedMs,
        repairRemovedMalformedSessionCount: baseRepair.removedMalformedSessionCount,
        repairScrubbedSessionCount: baseRepair.scrubbedSessionCount,
        snapshotLayer: "base",
        totalElapsedMs: Date.now() - layerStartedAt,
      });
    }
  }

  if (hotSnapshotRef) {
    const layerStartedAt = Date.now();
    const fetchStartedAt = Date.now();
    const hotBundle = await readHostedWorkspaceRuntimeBundle({
      platform: input.platform,
      ref: hotSnapshotRef,
    });
    const fetchElapsedMs = Date.now() - fetchStartedAt;
    const repairStartedAt = Date.now();
    const hotRepair = await repairHostedWorkspaceRuntimeBundleProviderContinuity({
      bundle: hotBundle,
      logContext: input.logContext ?? null,
      platform: input.platform,
      snapshotLayer: "hot",
      skipLegacyContinuityRepair: (
        baseProvidesCodexProviderContinuity
        && isHostedAssistantRuntimeHotStateBundleRef(hotSnapshotRef)
      ),
    });
    const repairElapsedMs = Date.now() - repairStartedAt;
    const hotBundleRepaired =
      hotRepair.removedMalformedSessionCount > 0 || hotRepair.scrubbedSessionCount > 0;
    const clearStartedAt = Date.now();
    await clearHostedAssistantRuntimeHotState({
      operatorHomeRoot: hotBundleRepaired || hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity({
        bundle: hotRepair.bundle,
      })
        ? restored.operatorHomeRoot
        : null,
      vaultRoot: restored.vaultRoot,
    });
    const clearElapsedMs = Date.now() - clearStartedAt;
    const materializeStartedAt = Date.now();
    await restoreHostedWorkspaceRuntimeBundle({
      bundle: hotRepair.bundle,
      platform: input.platform,
      ref: hotSnapshotRef,
      restored,
    });
    const materializeElapsedMs = Date.now() - materializeStartedAt;
    await writeHostedWorkspaceRestoreLayerFinishedLog({
      bundleBytes: readBundleByteLength(hotRepair.bundle),
      clearElapsedMs,
      fetchElapsedMs,
      logContext: input.logContext ?? null,
      materializeElapsedMs,
      platform: input.platform,
      ref: hotSnapshotRef,
      repairElapsedMs,
      repairRemovedMalformedSessionCount: hotRepair.removedMalformedSessionCount,
      repairScrubbedSessionCount: hotRepair.scrubbedSessionCount,
      snapshotLayer: "hot",
      totalElapsedMs: Date.now() - layerStartedAt,
    });
  }

  await writeHostedWorkspaceRestoreFinishedLog({
    baseSnapshotRef,
    hotSnapshotRef,
    logContext: input.logContext ?? null,
    mode: "snapshot",
    platform: input.platform,
    totalElapsedMs: Date.now() - restoreStartedAt,
  });

  return {
    ...restored,
    mode: "snapshot",
  };
}

async function repairHostedWorkspaceRuntimeBundleProviderContinuity(input: {
  bundle: Uint8Array | ArrayBuffer;
  logContext?: HostedRuntimeLogContext | null;
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

async function writeHostedWorkspaceRestoreStartedLog(input: {
  baseSnapshotRef: HostedExecutionBundleRef | null;
  hotSnapshotRef: HostedExecutionBundleRef | null;
  localRootsElapsedMs: number;
  logContext: HostedRuntimeLogContext | null;
  mode: HostedWorkspaceRuntimeRestoreMode;
  platform: HostedRuntimePlatform;
}): Promise<void> {
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.logContext),
      component: "workspace",
      eventCode: "workspace.restore_started",
      level: "info",
      phase: "restore",
      redactedJson: {
        baseBundleRefSize: input.baseSnapshotRef?.size ?? null,
        baseSnapshotPresent: input.baseSnapshotRef !== null,
        hotBundleRefSize: input.hotSnapshotRef?.size ?? null,
        hotSnapshotPresent: input.hotSnapshotRef !== null,
        localRootsElapsedMs: input.localRootsElapsedMs,
        restoreMode: input.mode,
      },
    },
    platform: input.platform,
  });
}

async function writeHostedWorkspaceRestoreLayerFinishedLog(input: {
  bundleBytes: number;
  cacheHit?: boolean;
  clearElapsedMs?: number;
  fetchElapsedMs: number;
  logContext: HostedRuntimeLogContext | null;
  materializeElapsedMs: number;
  platform: HostedRuntimePlatform;
  ref: HostedExecutionBundleRef;
  repairElapsedMs: number;
  repairRemovedMalformedSessionCount: number;
  repairScrubbedSessionCount: number;
  snapshotLayer: "base" | "hot";
  totalElapsedMs: number;
}): Promise<void> {
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.logContext),
      component: "workspace",
      eventCode: "workspace.restore_layer_finished",
      level: "info",
      phase: "restore",
      redactedJson: {
        bundleBytes: input.bundleBytes,
        bundleRefSize: input.ref.size,
        cacheHit: input.cacheHit === true,
        clearElapsedMs: input.clearElapsedMs ?? null,
        fetchElapsedMs: input.fetchElapsedMs,
        materializeElapsedMs: input.materializeElapsedMs,
        repairElapsedMs: input.repairElapsedMs,
        repairRemovedMalformedSessionCount: input.repairRemovedMalformedSessionCount,
        repairScrubbedSessionCount: input.repairScrubbedSessionCount,
        snapshotLayer: input.snapshotLayer,
        totalElapsedMs: input.totalElapsedMs,
      },
    },
    platform: input.platform,
  });
}

async function writeHostedWorkspaceRestoreFinishedLog(input: {
  baseSnapshotRef: HostedExecutionBundleRef | null;
  hotSnapshotRef: HostedExecutionBundleRef | null;
  logContext: HostedRuntimeLogContext | null;
  mode: HostedWorkspaceRuntimeRestoreMode;
  platform: HostedRuntimePlatform;
  totalElapsedMs: number;
}): Promise<void> {
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.logContext),
      component: "workspace",
      eventCode: "workspace.restore_finished",
      level: "info",
      phase: "restore",
      redactedJson: {
        baseBundleRefSize: input.baseSnapshotRef?.size ?? null,
        baseSnapshotPresent: input.baseSnapshotRef !== null,
        hotBundleRefSize: input.hotSnapshotRef?.size ?? null,
        hotSnapshotPresent: input.hotSnapshotRef !== null,
        restoreMode: input.mode,
        totalElapsedMs: input.totalElapsedMs,
      },
    },
    platform: input.platform,
  });
}

function readBundleByteLength(bundle: Uint8Array | ArrayBuffer): number {
  return bundle.byteLength;
}

function isHostedAssistantRuntimeHotStateBundleRef(ref: HostedExecutionBundleRef): boolean {
  return ref.key.startsWith(HOSTED_ASSISTANT_RUNTIME_HOT_STATE_BUNDLE_KEY_PREFIX);
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

function isHostedWorkspaceBaseRestoreCacheHit(input: {
  cache: HostedWorkspaceBaseRestoreCache;
  ref: HostedExecutionBundleRef;
}): boolean {
  return (
    input.cache.baseSnapshotHash === input.ref.hash
    && input.cache.baseSnapshotSize === input.ref.size
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

  return {
    baseProvidesCodexProviderContinuity: value.baseProvidesCodexProviderContinuity,
    baseSnapshotHash: value.baseSnapshotHash,
    baseSnapshotSize: value.baseSnapshotSize,
    schema: HOSTED_WORKSPACE_BASE_RESTORE_CACHE_SCHEMA,
  };
}

function resolveHostedWorkspaceBaseRestoreCachePath(vaultRoot: string): string {
  return path.join(
    path.dirname(path.resolve(vaultRoot)),
    HOSTED_WORKSPACE_BASE_RESTORE_CACHE_FILE_NAME,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
