import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  hashCanonicalQuerySources,
  listMetricPoints,
  readVault,
} from "@murphai/query";
import type {
  CanonicalQuerySourceHash,
} from "@murphai/query";
import {
  createBrowserVaultReplica,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import {
  assessBrowserVaultReplicaFreshness,
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  type BrowserVaultReplicaFreshnessAssessment,
} from "@murphai/hosted-execution";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimePlatform,
} from "./platform.ts";
import type {
  RuntimeWakeSignal,
} from "./runtime-wake.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
  type HostedWorkspaceRuntimeRestoreMode,
} from "./workspace-restore.ts";

const HOSTED_BROWSER_VAULT_WARM_SOURCE_STATE_SCHEMA =
  "murph.hosted-browser-vault-warm-source-state.v1";
const HOSTED_BROWSER_VAULT_WARM_SOURCE_STATE_PATH = path.join(
  ".runtime",
  "cache",
  "hosted-browser-vault-source-state.json",
);

interface HostedBrowserVaultWarmSourceState {
  schema: typeof HOSTED_BROWSER_VAULT_WARM_SOURCE_STATE_SCHEMA;
  sourceStateHash: string;
}

export interface HostedBrowserVaultReplicaContentSummary {
  entities: number;
  hasPrivateContent: boolean;
  metricGoalProgressRows: number;
  metricRows: number;
  metricSelectionRows: number;
  searchRows: number;
  sourceHealthRows: number;
  timelineRows: number;
  weeklySampleSummaries: number;
}

export interface HostedBrowserVaultReplicaSourceSummary {
  fileCount: number;
  totalBytes: number;
}

export interface HostedBrowserVaultReplicaRestoreSummary {
  mode: HostedWorkspaceRuntimeRestoreMode;
  restoreWasCold: boolean;
}

export interface HostedBrowserVaultReplicaRefreshPreparation {
  content: HostedBrowserVaultReplicaContentSummary;
  replica: BrowserVaultReplica;
  restore: HostedBrowserVaultReplicaRestoreSummary;
  source: HostedBrowserVaultReplicaSourceSummary;
}

export type HostedBrowserVaultReplicaRefreshResult =
  | {
      byteLength: number;
      content: HostedBrowserVaultReplicaContentSummary;
      freshness: BrowserVaultReplicaFreshnessAssessment;
      replicaRef: HostedBrowserVaultReplicaRef;
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "published";
    }
  | {
      freshness: BrowserVaultReplicaFreshnessAssessment;
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "skipped_current";
    }
  | {
      byteLength: number;
      content: HostedBrowserVaultReplicaContentSummary;
      maxBytes: number;
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "refresh_failed_too_large";
    }
  | {
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "deferred_runtime_wake" | "deferred_timeout" | "deferred_aborted";
    }
  | {
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "deferred_source_changed";
    }
  | {
      status: "publish_conflict" | "skipped_no_port" | "workspace_missing" | "refresh_failed";
    };

const DEFAULT_HOSTED_BROWSER_VAULT_REFRESH_TIMEOUT_MS = 10_000;
const utf8Encoder = new TextEncoder();

export async function createHostedBrowserVaultReplicaForSourceState(input: {
  generatedAt?: string;
  sourceStateHash: string;
  vaultRoot: string;
}): Promise<BrowserVaultReplica> {
  const vault = await readVault(input.vaultRoot);
  const metricPoints = await listMetricPoints(input.vaultRoot, { limit: null });

  return await createBrowserVaultReplica({
    generatedAt: input.generatedAt,
    metricPoints,
    sourceBundleHash: input.sourceStateHash,
    vault,
  });
}

export async function createHostedBrowserVaultReplicaRefreshFromWorkspace(input: {
  generatedAt: string;
  platform: HostedRuntimePlatform;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedBrowserVaultReplicaRefreshPreparation> {
  const restored = input.workspace
    ? await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: input.platform,
        vaultRoot: input.vaultRoot,
        workspace: input.workspace,
      })
    : {
        mode: "null-bootstrap" as const,
        restoreWasCold: false,
        vaultRoot: path.resolve(input.vaultRoot),
      };
  const sourceHash = await hashCanonicalQuerySources(restored.vaultRoot);
  const replica = await createHostedBrowserVaultReplicaForSourceState({
    generatedAt: input.generatedAt,
    sourceStateHash: sourceHash.hash,
    vaultRoot: restored.vaultRoot,
  });

  return {
    content: summarizeHostedBrowserVaultReplicaContent(replica),
    replica,
    restore: {
      mode: restored.mode,
      restoreWasCold: restored.restoreWasCold,
    },
    source: summarizeHostedBrowserVaultReplicaSource(sourceHash),
  };
}

export async function refreshHostedBrowserVaultReplicaFromRuntime(input: {
  generatedAt?: string | null;
  force?: boolean | null;
  maxAgeMs?: number | null;
  platform: HostedRuntimePlatform;
  runtimeWakeSignal?: RuntimeWakeSignal | null;
  signal?: AbortSignal | null;
  timeoutMs?: number | null;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedBrowserVaultReplicaRefreshResult> {
  const port = input.platform.browserVaultReplicaPort ?? null;
  if (!port?.write || !port.publishRef) {
    return { status: "skipped_no_port" };
  }
  if (!input.workspace) {
    return { status: "workspace_missing" };
  }

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const cancellation = createBrowserVaultRefreshCancellation({
    runtimeWakeSignal: input.runtimeWakeSignal ?? null,
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs ?? DEFAULT_HOSTED_BROWSER_VAULT_REFRESH_TIMEOUT_MS,
  });

  try {
    const sourceBefore = await cancellation.race(
      hashCanonicalQuerySources(input.vaultRoot),
    );
    const source = summarizeHostedBrowserVaultReplicaSource(sourceBefore);
    const freshness = assessBrowserVaultReplicaFreshness({
      currentSourceHash: sourceBefore.hash,
      maxAgeMs: input.maxAgeMs,
      now: generatedAt,
      replicaRef: input.workspace.browserVaultReplicaRef ?? null,
    });

    if (!freshness.shouldRefresh && input.force !== true) {
      return {
        freshness,
        source,
        status: "skipped_current",
      };
    }

    const replica = await cancellation.race(
      createHostedBrowserVaultReplicaForSourceState({
        generatedAt,
        sourceStateHash: sourceBefore.hash,
        vaultRoot: input.vaultRoot,
      }),
    );
    const content = summarizeHostedBrowserVaultReplicaContent(replica);
    const byteLength = measureHostedBrowserVaultReplicaBytes(replica);
    if (byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) {
      return {
        byteLength,
        content,
        maxBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
        source,
        status: "refresh_failed_too_large",
      };
    }

    const sourceAfter = await cancellation.race(
      hashCanonicalQuerySources(input.vaultRoot),
    );
    if (sourceAfter.hash !== sourceBefore.hash) {
      return {
        source,
        status: "deferred_source_changed",
      };
    }

    cancellation.throwIfCancelled();
    const replicaRef = await cancellation.race(
      port.write({
        replica,
        signal: cancellation.signal,
      }),
    );
    assertHostedBrowserVaultReplicaWriteMatchesRefresh({
      byteLength,
      replicaRef,
      sourceHash: sourceBefore.hash,
    });

    cancellation.throwIfCancelled();
    const publish = await cancellation.race(
      port.publishRef({
        replicaRef,
        signal: cancellation.signal,
      }),
    );
    if (!publish.published) {
      return {
        status: "publish_conflict",
      };
    }

    return {
      byteLength: replicaRef.byteLength,
      content,
      freshness,
      replicaRef,
      source,
      status: "published",
    };
  } catch (error) {
    if (error instanceof HostedBrowserVaultRefreshDeferredError) {
      return {
        source: error.source ?? {
          fileCount: 0,
          totalBytes: 0,
        },
        status: error.status,
      };
    }

    return {
      status: "refresh_failed",
    };
  } finally {
    cancellation.cleanup();
  }
}

export function summarizeHostedBrowserVaultReplicaContent(
  replica: BrowserVaultReplica,
): HostedBrowserVaultReplicaContentSummary {
  const contentCounts = {
    entities: replica.entities.length,
    metricGoalProgressRows: replica.metricGoalProgressRows.length,
    metricRows: replica.metricRows.length,
    searchRows: replica.searchRows.length,
    sourceHealthRows: replica.sourceHealthRows.length,
    timelineRows: replica.timelineRows.length,
    weeklySampleSummaries: replica.weeklySampleSummaries.length,
  };

  return {
    ...contentCounts,
    hasPrivateContent: Object.values(contentCounts).some((count) => count > 0),
    metricSelectionRows: replica.metricSelectionRows.length,
  };
}

export async function readHostedBrowserVaultWarmSourceStateHash(input: {
  vaultRoot: string;
}): Promise<string | null> {
  try {
    const contents = await readFile(
      resolveHostedBrowserVaultWarmSourceStatePath(input.vaultRoot),
      "utf8",
    );
    const parsed: unknown = JSON.parse(contents);
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || (parsed as Partial<HostedBrowserVaultWarmSourceState>).schema
        !== HOSTED_BROWSER_VAULT_WARM_SOURCE_STATE_SCHEMA
    ) {
      return null;
    }
    const sourceStateHash =
      (parsed as Partial<HostedBrowserVaultWarmSourceState>).sourceStateHash;
    return typeof sourceStateHash === "string" && sourceStateHash.length > 0
      ? sourceStateHash
      : null;
  } catch {
    return null;
  }
}

export async function writeHostedBrowserVaultWarmSourceStateHashBestEffort(input: {
  sourceStateHash: string | null;
  vaultRoot: string;
}): Promise<void> {
  try {
    if (!input.sourceStateHash) {
      await clearHostedBrowserVaultWarmSourceStateHash(input);
      return;
    }

    const markerPath = resolveHostedBrowserVaultWarmSourceStatePath(input.vaultRoot);
    await mkdir(path.dirname(markerPath), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(
      markerPath,
      JSON.stringify({
        schema: HOSTED_BROWSER_VAULT_WARM_SOURCE_STATE_SCHEMA,
        sourceStateHash: input.sourceStateHash,
      } satisfies HostedBrowserVaultWarmSourceState) + "\n",
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  } catch {
    // The marker only helps the detached live refresh name the current source.
    // Failing to write it should not block workspace progress.
  }
}

export async function clearHostedBrowserVaultWarmSourceStateHash(input: {
  vaultRoot: string;
}): Promise<void> {
  await rm(resolveHostedBrowserVaultWarmSourceStatePath(input.vaultRoot), { force: true });
}

function resolveHostedBrowserVaultWarmSourceStatePath(vaultRoot: string): string {
  return path.join(path.resolve(vaultRoot), HOSTED_BROWSER_VAULT_WARM_SOURCE_STATE_PATH);
}

function summarizeHostedBrowserVaultReplicaSource(
  source: CanonicalQuerySourceHash,
): HostedBrowserVaultReplicaSourceSummary {
  return {
    fileCount: source.fileCount,
    totalBytes: source.totalBytes,
  };
}

function measureHostedBrowserVaultReplicaBytes(replica: unknown): number {
  return utf8Encoder.encode(JSON.stringify(replica)).byteLength;
}

function assertHostedBrowserVaultReplicaWriteMatchesRefresh(input: {
  byteLength: number;
  replicaRef: HostedBrowserVaultReplicaRef;
  sourceHash: string;
}): void {
  if (input.replicaRef.sourceBundleHash !== input.sourceHash) {
    throw new Error("Hosted browser-vault refresh wrote a mismatched source hash.");
  }
  if (
    input.replicaRef.byteLength !== input.byteLength
    || input.replicaRef.byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES
  ) {
    throw new Error("Hosted browser-vault refresh wrote invalid byte metadata.");
  }
}

class HostedBrowserVaultRefreshDeferredError extends Error {
  readonly source: HostedBrowserVaultReplicaSourceSummary | null;
  readonly status: Extract<
    HostedBrowserVaultReplicaRefreshResult["status"],
    "deferred_aborted" | "deferred_runtime_wake" | "deferred_timeout"
  >;

  constructor(input: {
    source?: HostedBrowserVaultReplicaSourceSummary | null;
    status: HostedBrowserVaultRefreshDeferredError["status"];
  }) {
    super(`Hosted browser-vault refresh ${input.status}.`);
    this.name = "HostedBrowserVaultRefreshDeferredError";
    this.source = input.source ?? null;
    this.status = input.status;
  }
}

function createBrowserVaultRefreshCancellation(input: {
  runtimeWakeSignal: RuntimeWakeSignal | null;
  signal: AbortSignal | null;
  timeoutMs: number;
}): {
  cleanup(): void;
  race<T>(promise: Promise<T>): Promise<T>;
  signal: AbortSignal;
  throwIfCancelled(): void;
} {
  let deferred: HostedBrowserVaultRefreshDeferredError | null = null;
  let rejectDeferred: (error: HostedBrowserVaultRefreshDeferredError) => void = () => {};
  const waiterAbortController = new AbortController();
  const deferredPromise = new Promise<never>((_resolve, reject) => {
    rejectDeferred = reject;
  });
  void deferredPromise.catch(() => undefined);
  const defer = (status: HostedBrowserVaultRefreshDeferredError["status"]) => {
    if (deferred) {
      return;
    }
    deferred = new HostedBrowserVaultRefreshDeferredError({ status });
    if (!waiterAbortController.signal.aborted) {
      waiterAbortController.abort(deferred);
    }
    rejectDeferred(deferred);
  };
  const externalAbort = () => defer("deferred_aborted");
  const timeout = setTimeout(() => defer("deferred_timeout"), Math.max(0, input.timeoutMs));

  input.signal?.addEventListener("abort", externalAbort, { once: true });
  if (input.signal?.aborted) {
    externalAbort();
  }
  input.runtimeWakeSignal?.wait(waiterAbortController.signal).then(
    () => defer("deferred_runtime_wake"),
    () => undefined,
  );

  return {
    cleanup() {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", externalAbort);
      if (!waiterAbortController.signal.aborted) {
        waiterAbortController.abort(
          new DOMException("Hosted browser-vault refresh finished.", "AbortError"),
        );
      }
    },
    async race<T>(promise: Promise<T>): Promise<T> {
      if (deferred) {
        throw deferred;
      }
      return await Promise.race([promise, deferredPromise]);
    },
    signal: waiterAbortController.signal,
    throwIfCancelled() {
      if (deferred) {
        throw deferred;
      }
    },
  };
}
