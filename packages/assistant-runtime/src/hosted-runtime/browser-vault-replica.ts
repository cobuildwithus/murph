import {
  createHash,
} from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  experimentFrontmatterSchema,
  experimentOutcomeSchema,
  VAULT_LAYOUT,
  type ExperimentOutcome,
  type ExperimentFrontmatter,
} from "@murphai/contracts";

import type {
  CanonicalQuerySourceHash,
  VaultReadModel,
} from "@murphai/query";
import type { BrowserVaultReplica } from "@murphai/query/browser";
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
  labResultRows: number;
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

export type HostedBrowserVaultReplicaRefreshStage =
  | "initial_source_hash"
  | "replica_construction"
  | "replica_serialization"
  | "second_source_hash"
  | "replica_write"
  | "ref_publication";

export type HostedBrowserVaultReplicaRefreshAttempt = "initial" | "retry";

export type HostedBrowserVaultReplicaRefreshStep =
  | "initial_source_hash"
  | "replica_construction_initialization"
  | "replica_construction_source_read"
  | "replica_construction_experiment_outcome_read"
  | "replica_construction_projection"
  | "replica_serialization"
  | "second_source_hash"
  | "replica_write"
  | "ref_publication";

type HostedBrowserVaultReplicaConstructionStep = Extract<
  HostedBrowserVaultReplicaRefreshStep,
  | "replica_construction_source_read"
  | "replica_construction_experiment_outcome_read"
  | "replica_construction_projection"
>;

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
      attempt: HostedBrowserVaultReplicaRefreshAttempt;
      configuredTimeoutMs: number;
      currentStepElapsedMs: number;
      refreshElapsedMs: number;
      refreshStage: HostedBrowserVaultReplicaRefreshStage;
      refreshStep: HostedBrowserVaultReplicaRefreshStep;
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "deferred_timeout";
    }
  | {
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "deferred_runtime_wake" | "deferred_aborted";
    }
  | {
      source: HostedBrowserVaultReplicaSourceSummary;
      status: "deferred_source_changed";
    }
  | {
      status: "publish_conflict" | "skipped_no_port" | "workspace_missing" | "refresh_failed";
    };

const DEFAULT_HOSTED_BROWSER_VAULT_REFRESH_TIMEOUT_MS = 30_000;
const utf8Encoder = new TextEncoder();

export async function createHostedBrowserVaultReplicaForSourceState(input: {
  generatedAt?: string;
  onRefreshStep?: (step: HostedBrowserVaultReplicaConstructionStep) => void;
  signal?: AbortSignal;
  sourceStateHash: string;
  vaultRoot: string;
}): Promise<BrowserVaultReplica> {
  const {
    createBrowserVaultReplica,
    readBrowserVaultReplicaSource,
  } = await import("@murphai/query/browser-replica-server");
  input.onRefreshStep?.("replica_construction_source_read");
  input.signal?.throwIfAborted();
  const { metricPoints, vault } = await readBrowserVaultReplicaSource(
    input.vaultRoot,
    { signal: input.signal },
  );
  input.onRefreshStep?.("replica_construction_experiment_outcome_read");
  input.signal?.throwIfAborted();
  const outcomeProjection = await readHostedBrowserVaultExperimentOutcomes(
    input.vaultRoot,
    vault,
    input.signal,
  );
  input.signal?.throwIfAborted();

  input.onRefreshStep?.("replica_construction_projection");
  return await createBrowserVaultReplica({
    experimentOutcomes: outcomeProjection.outcomes,
    generatedAt: input.generatedAt,
    metricPoints,
    signal: input.signal,
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
  const sourceHash = await hashHostedBrowserVaultReplicaSources(restored.vaultRoot);
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
  attempt?: HostedBrowserVaultReplicaRefreshAttempt;
  deadlineMs?: number | null;
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
  const publishRef = port.publishRef;
  if (!input.workspace) {
    return { status: "workspace_missing" };
  }

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const attempt = input.attempt ?? "initial";
  const configuredTimeoutMs =
    input.timeoutMs ?? DEFAULT_HOSTED_BROWSER_VAULT_REFRESH_TIMEOUT_MS;
  const timeoutMs = input.deadlineMs === null || input.deadlineMs === undefined
    ? configuredTimeoutMs
    : Math.min(
        configuredTimeoutMs,
        Math.max(0, input.deadlineMs - Date.now()),
      );
  const cancellation = createBrowserVaultRefreshCancellation({
    attempt,
    configuredTimeoutMs,
    runtimeWakeSignal: input.runtimeWakeSignal ?? null,
    signal: input.signal ?? null,
    timeoutMs,
  });

  try {
    const sourceBefore = await cancellation.runOwned(
      "initial_source_hash",
      (signal) => hashHostedBrowserVaultReplicaSources(input.vaultRoot, signal),
    );
    const source = summarizeHostedBrowserVaultReplicaSource(sourceBefore);
    cancellation.recordSource(source);
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

    const replica = await cancellation.runOwned(
      "replica_construction",
      (signal) => createHostedBrowserVaultReplicaForSourceState({
        generatedAt,
        onRefreshStep: cancellation.recordConstructionStep,
        signal,
        sourceStateHash: sourceBefore.hash,
        vaultRoot: input.vaultRoot,
      }),
    );
    cancellation.throwIfCancelled();
    const content = summarizeHostedBrowserVaultReplicaContent(replica);
    const byteLength = await cancellation.runOwned(
      "replica_serialization",
      (signal) => measureHostedBrowserVaultReplicaBytes(replica, signal),
    );
    cancellation.throwIfCancelled();
    if (byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) {
      return {
        byteLength,
        content,
        maxBytes: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
        source,
        status: "refresh_failed_too_large",
      };
    }

    const sourceAfter = await cancellation.runOwned(
      "second_source_hash",
      (signal) => hashHostedBrowserVaultReplicaSources(input.vaultRoot, signal),
    );
    if (sourceAfter.hash !== sourceBefore.hash) {
      return {
        source,
        status: "deferred_source_changed",
      };
    }

    cancellation.throwIfCancelled();
    const replacedReplicaRef = input.workspace.browserVaultReplicaRef ?? null;
    const replicaRef = await cancellation.race(
      "replica_write",
      () => port.write({
        replica,
        replacedReplicaRef,
        signal: cancellation.signal,
      }),
    );
    assertHostedBrowserVaultReplicaWriteMatchesRefresh({
      byteLength,
      replicaRef,
      sourceHash: sourceBefore.hash,
    });

    const sourceBeforePublish = await cancellation.runOwned(
      "second_source_hash",
      (signal) => hashHostedBrowserVaultReplicaSources(input.vaultRoot, signal),
    );
    if (sourceBeforePublish.hash !== sourceBefore.hash) {
      return {
        source,
        status: "deferred_source_changed",
      };
    }

    cancellation.throwIfCancelled();
    const publish = await cancellation.race(
      "ref_publication",
      () => publishRef.call(port, {
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
      if (error.status === "deferred_timeout") {
        const source = error.source ?? {
          fileCount: 0,
          totalBytes: 0,
        };
        return {
          attempt: error.attempt,
          configuredTimeoutMs: error.configuredTimeoutMs,
          currentStepElapsedMs: error.currentStepElapsedMs,
          refreshElapsedMs: error.refreshElapsedMs,
          refreshStage: error.refreshStage,
          refreshStep: error.refreshStep,
          source,
          status: error.status,
        };
      }
      return {
        source: {
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
    labResultRows: replica.labResultRows.length,
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

interface HostedBrowserVaultOutcomeSource {
  byteLength: number;
  hash: string;
  relativePath: string;
}

interface HostedBrowserVaultOutcomeProjection {
  outcomes: ExperimentOutcome[];
  sources: HostedBrowserVaultOutcomeSource[];
}

export async function hashHostedBrowserVaultReplicaSources(
  vaultRoot: string,
  signal?: AbortSignal,
): Promise<CanonicalQuerySourceHash> {
  const {
    hashCanonicalQuerySources,
    readBrowserVaultReplicaVault,
  } = await import("@murphai/query/browser-replica-server");
  signal?.throwIfAborted();
  const [canonicalSourceResult, vaultResult] = await Promise.allSettled([
    hashCanonicalQuerySources(vaultRoot, { signal }),
    readBrowserVaultReplicaVault(vaultRoot, { signal }),
  ]);
  if (canonicalSourceResult.status === "rejected") {
    throw canonicalSourceResult.reason;
  }
  if (vaultResult.status === "rejected") {
    throw vaultResult.reason;
  }
  signal?.throwIfAborted();
  const outcomeProjection = await readHostedBrowserVaultExperimentOutcomes(
    vaultRoot,
    vaultResult.value,
    signal,
  );
  signal?.throwIfAborted();
  const digest = createHash("sha256");
  digest.update("murph.hosted-browser-vault-source.v1\0");
  digest.update(canonicalSourceResult.value.hash);
  digest.update("\0");

  for (const source of outcomeProjection.sources) {
    digest.update(source.relativePath);
    digest.update("\0");
    digest.update(String(source.byteLength));
    digest.update("\0");
    digest.update(source.hash);
    digest.update("\0");
  }

  return {
    fileCount:
      canonicalSourceResult.value.fileCount + outcomeProjection.sources.length,
    hash: digest.digest("hex"),
    totalBytes:
      canonicalSourceResult.value.totalBytes +
      outcomeProjection.sources.reduce((total, source) => total + source.byteLength, 0),
  };
}

async function readHostedBrowserVaultExperimentOutcomes(
  vaultRoot: string,
  vault: VaultReadModel,
  signal?: AbortSignal,
): Promise<HostedBrowserVaultOutcomeProjection> {
  const outcomes: ExperimentOutcome[] = [];
  const sources: HostedBrowserVaultOutcomeSource[] = [];

  for (const entity of vault.entities) {
    signal?.throwIfAborted();
    if (entity.family !== "experiment") {
      continue;
    }

    const parsedFrontmatter = experimentFrontmatterSchema.safeParse(
      entity.frontmatter ?? entity.attributes,
    );
    if (!parsedFrontmatter.success || !parsedFrontmatter.data.outcomeRef) {
      continue;
    }

    const relativePath = resolveBrowserVaultOutcomeRelativePath(
      parsedFrontmatter.data.outcomeRef.relativePath,
    );
    if (!relativePath) {
      continue;
    }

    const contents = await readOptionalBrowserVaultOutcomeFile(
      path.join(vaultRoot, relativePath),
      signal,
    );
    if (contents === null) {
      continue;
    }

    sources.push({
      byteLength: Buffer.byteLength(contents, "utf8"),
      hash: createHash("sha256").update(contents).digest("hex"),
      relativePath,
    });

    const outcome = parseBrowserVaultOutcome(contents);
    if (
      outcome &&
      browserVaultOutcomeMatchesExperiment(
        outcome,
        parsedFrontmatter.data,
      )
    ) {
      outcomes.push(outcome);
    }
  }

  return {
    outcomes,
    sources: sources.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    ),
  };
}

function resolveBrowserVaultOutcomeRelativePath(
  value: string | undefined,
): string | null {
  if (!value || value.includes("\\") || path.posix.isAbsolute(value)) {
    return null;
  }

  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    path.posix.dirname(normalized) !== VAULT_LAYOUT.experimentOutcomesDirectory ||
    path.posix.extname(normalized) !== ".json"
  ) {
    return null;
  }

  return normalized;
}

async function readOptionalBrowserVaultOutcomeFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    return await readFile(filePath, { encoding: "utf8", signal });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function parseBrowserVaultOutcome(contents: string): ExperimentOutcome | null {
  try {
    return experimentOutcomeSchema.parse(JSON.parse(contents));
  } catch {
    return null;
  }
}

function browserVaultOutcomeMatchesExperiment(
  outcome: ExperimentOutcome,
  frontmatter: ExperimentFrontmatter,
): boolean {
  const outcomeRef = frontmatter.outcomeRef;
  if (!outcomeRef) {
    return false;
  }

  return outcome.outcomeId === outcomeRef.outcomeId &&
    (outcomeRef.generatedAt === undefined ||
      outcome.generatedAt === outcomeRef.generatedAt) &&
    outcome.experiment.id === frontmatter.experimentId &&
    outcome.experiment.slug === frontmatter.slug;
}

async function measureHostedBrowserVaultReplicaBytes(
  replica: unknown,
  signal?: AbortSignal,
): Promise<number> {
  const { stringifyJsonCooperatively } = await import(
    "@murphai/query/browser-replica-server"
  );
  signal?.throwIfAborted();
  const serialized = await stringifyJsonCooperatively(replica, { signal });
  signal?.throwIfAborted();
  return utf8Encoder.encode(serialized).byteLength;
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
  readonly attempt: HostedBrowserVaultReplicaRefreshAttempt;
  readonly configuredTimeoutMs: number;
  readonly currentStepElapsedMs: number;
  readonly refreshElapsedMs: number;
  readonly refreshStage: HostedBrowserVaultReplicaRefreshStage;
  readonly refreshStep: HostedBrowserVaultReplicaRefreshStep;
  readonly source: HostedBrowserVaultReplicaSourceSummary | null;
  readonly status: Extract<
    HostedBrowserVaultReplicaRefreshResult["status"],
    "deferred_aborted" | "deferred_runtime_wake" | "deferred_timeout"
  >;

  constructor(input: {
    attempt: HostedBrowserVaultReplicaRefreshAttempt;
    configuredTimeoutMs: number;
    currentStepElapsedMs: number;
    refreshElapsedMs: number;
    refreshStage: HostedBrowserVaultReplicaRefreshStage;
    refreshStep: HostedBrowserVaultReplicaRefreshStep;
    source?: HostedBrowserVaultReplicaSourceSummary | null;
    status: HostedBrowserVaultRefreshDeferredError["status"];
  }) {
    super(`Hosted browser-vault refresh ${input.status}.`);
    this.name = "HostedBrowserVaultRefreshDeferredError";
    this.attempt = input.attempt;
    this.configuredTimeoutMs = input.configuredTimeoutMs;
    this.currentStepElapsedMs = input.currentStepElapsedMs;
    this.refreshElapsedMs = input.refreshElapsedMs;
    this.refreshStage = input.refreshStage;
    this.refreshStep = input.refreshStep;
    this.source = input.source ?? null;
    this.status = input.status;
  }
}

function createBrowserVaultRefreshCancellation(input: {
  attempt: HostedBrowserVaultReplicaRefreshAttempt;
  configuredTimeoutMs: number;
  runtimeWakeSignal: RuntimeWakeSignal | null;
  signal: AbortSignal | null;
  timeoutMs: number;
}): {
  cleanup(): void;
  race<T>(
    refreshStage: HostedBrowserVaultReplicaRefreshStage,
    operation: () => Promise<T>,
  ): Promise<T>;
  recordConstructionStep(
    refreshStep: HostedBrowserVaultReplicaConstructionStep,
  ): void;
  recordSource(source: HostedBrowserVaultReplicaSourceSummary): void;
  runOwned<T>(
    refreshStage: HostedBrowserVaultReplicaRefreshStage,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
  signal: AbortSignal;
  throwIfCancelled(): void;
} {
  let deferred: HostedBrowserVaultRefreshDeferredError | null = null;
  let refreshStage: HostedBrowserVaultReplicaRefreshStage = "initial_source_hash";
  let refreshStep: HostedBrowserVaultReplicaRefreshStep = "initial_source_hash";
  let source: HostedBrowserVaultReplicaSourceSummary | null = null;
  let rejectDeferred: (error: HostedBrowserVaultRefreshDeferredError) => void = () => {};
  const refreshStartedAtMs = Date.now();
  let currentStepStartedAtMs = refreshStartedAtMs;
  const waiterAbortController = new AbortController();
  const deferredPromise = new Promise<never>((_resolve, reject) => {
    rejectDeferred = reject;
  });
  void deferredPromise.catch(() => undefined);
  const defer = (status: HostedBrowserVaultRefreshDeferredError["status"]) => {
    if (deferred) {
      return;
    }
    const deferredAtMs = Date.now();
    const refreshElapsedMs = toBoundedHostedBrowserVaultTimingMs(
      deferredAtMs - refreshStartedAtMs,
    );
    deferred = new HostedBrowserVaultRefreshDeferredError({
      attempt: input.attempt,
      configuredTimeoutMs: toBoundedHostedBrowserVaultTimingMs(
        input.configuredTimeoutMs,
      ),
      currentStepElapsedMs: Math.min(
        refreshElapsedMs,
        toBoundedHostedBrowserVaultTimingMs(
          deferredAtMs - currentStepStartedAtMs,
        ),
      ),
      refreshElapsedMs,
      refreshStage,
      refreshStep,
      source,
      status,
    });
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
    async race<T>(
      nextRefreshStage: HostedBrowserVaultReplicaRefreshStage,
      operation: () => Promise<T>,
    ): Promise<T> {
      refreshStage = nextRefreshStage;
      refreshStep = resolveHostedBrowserVaultRefreshStep(nextRefreshStage);
      currentStepStartedAtMs = Date.now();
      const promise = operation();
      if (deferred) {
        throw deferred;
      }
      return await Promise.race([promise, deferredPromise]);
    },
    recordConstructionStep(nextRefreshStep) {
      refreshStep = nextRefreshStep;
      currentStepStartedAtMs = Date.now();
    },
    recordSource(nextSource: HostedBrowserVaultReplicaSourceSummary) {
      source = nextSource;
    },
    async runOwned<T>(
      nextRefreshStage: HostedBrowserVaultReplicaRefreshStage,
      operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      refreshStage = nextRefreshStage;
      refreshStep = resolveHostedBrowserVaultRefreshStep(nextRefreshStage);
      currentStepStartedAtMs = Date.now();
      if (deferred) {
        throw deferred;
      }
      try {
        const result = await operation(waiterAbortController.signal);
        if (deferred) {
          throw deferred;
        }
        return result;
      } catch (error) {
        if (deferred) {
          throw deferred;
        }
        throw error;
      }
    },
    signal: waiterAbortController.signal,
    throwIfCancelled() {
      if (deferred) {
        throw deferred;
      }
    },
  };
}

function resolveHostedBrowserVaultRefreshStep(
  refreshStage: HostedBrowserVaultReplicaRefreshStage,
): HostedBrowserVaultReplicaRefreshStep {
  return refreshStage === "replica_construction"
    ? "replica_construction_initialization"
    : refreshStage;
}

function toBoundedHostedBrowserVaultTimingMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}
