import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  hashCanonicalQuerySources,
  isCanonicalQuerySourcePath,
  listCanonicalSourceManifest,
  readVault,
} from "@murphai/query";
import type {
  CanonicalQuerySourceHash,
  QuerySourceManifestEntry,
} from "@murphai/query";
import type {
  HostedCanonicalWriteReceipt,
  HostedCanonicalWriteReceiptAction,
} from "@murphai/core";
import {
  createBrowserVaultReplica,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimePlatform,
} from "./platform.ts";
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
const HOSTED_BROWSER_VAULT_REFRESH_STATE_SCHEMA =
  "murph.hosted-browser-vault-refresh-state.v1";
const HOSTED_BROWSER_VAULT_REFRESH_STATE_PATH = path.join(
  ".runtime",
  "operations",
  "browser-vault",
  "refresh-state.json",
);

export type HostedBrowserVaultRefreshDirtyReason =
  | "query_source_changed"
  | "query_source_deleted";

interface HostedBrowserVaultWarmSourceState {
  schema: typeof HOSTED_BROWSER_VAULT_WARM_SOURCE_STATE_SCHEMA;
  sourceStateHash: string;
}

export interface HostedBrowserVaultRefreshState {
  dirty: boolean;
  dirtyReason: HostedBrowserVaultRefreshDirtyReason | null;
  dirtySince: string | null;
  failureCount: number;
  lastPublishedSourceHash: string | null;
  nextAttemptAt: string | null;
  schema: typeof HOSTED_BROWSER_VAULT_REFRESH_STATE_SCHEMA;
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

export async function createHostedBrowserVaultReplicaForSourceState(input: {
  generatedAt?: string;
  sourceStateHash: string;
  vaultRoot: string;
}): Promise<BrowserVaultReplica> {
  return await createBrowserVaultReplica({
    generatedAt: input.generatedAt,
    sourceBundleHash: input.sourceStateHash,
    vault: await readVault(input.vaultRoot),
  });
}

export async function hashHostedBrowserVaultQuerySources(input: {
  vaultRoot: string;
}): Promise<CanonicalQuerySourceHash> {
  return await hashCanonicalQuerySources(input.vaultRoot);
}

export async function createHostedBrowserVaultReplicaRefreshFromWorkspace(input: {
  generatedAt: string;
  platform: HostedRuntimePlatform;
  sourceStateHash: string;
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
  const sourceManifest = await listCanonicalSourceManifest(restored.vaultRoot);
  const replica = await createHostedBrowserVaultReplicaForSourceState({
    generatedAt: input.generatedAt,
    sourceStateHash: input.sourceStateHash,
    vaultRoot: restored.vaultRoot,
  });

  return {
    content: summarizeHostedBrowserVaultReplicaContent(replica),
    replica,
    restore: {
      mode: restored.mode,
      restoreWasCold: restored.restoreWasCold,
    },
    source: summarizeHostedBrowserVaultReplicaSource(sourceManifest),
  };
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

export async function readHostedBrowserVaultRefreshState(input: {
  vaultRoot: string;
}): Promise<HostedBrowserVaultRefreshState> {
  try {
    const contents = await readFile(resolveHostedBrowserVaultRefreshStatePath(input.vaultRoot), "utf8");
    return parseHostedBrowserVaultRefreshState(JSON.parse(contents));
  } catch {
    return createCleanHostedBrowserVaultRefreshState();
  }
}

export async function writeHostedBrowserVaultRefreshState(input: {
  state: HostedBrowserVaultRefreshState;
  vaultRoot: string;
}): Promise<void> {
  const statePath = resolveHostedBrowserVaultRefreshStatePath(input.vaultRoot);
  await mkdir(path.dirname(statePath), {
    mode: 0o700,
    recursive: true,
  });
  await writeFile(
    statePath,
    `${JSON.stringify(parseHostedBrowserVaultRefreshState(input.state), null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

export async function markHostedBrowserVaultRefreshDirtyForReceiptBestEffort(input: {
  now?: () => string;
  receipt: HostedCanonicalWriteReceipt;
  vaultRoot: string;
}): Promise<void> {
  const dirtyReason = readBrowserVaultDirtyReasonFromReceipt(input.receipt);
  if (!dirtyReason) {
    return;
  }

  try {
    await markHostedBrowserVaultRefreshDirty({
      dirtyReason,
      now: input.now,
      vaultRoot: input.vaultRoot,
    });
  } catch {
    // This marker only schedules a background browser-vault refresh. Canonical
    // writes must not fail because the local runtime marker was unavailable.
  }
}

export async function markHostedBrowserVaultRefreshDirty(input: {
  dirtyReason: HostedBrowserVaultRefreshDirtyReason;
  now?: () => string;
  vaultRoot: string;
}): Promise<HostedBrowserVaultRefreshState> {
  const current = await readHostedBrowserVaultRefreshState(input);
  const now = input.now?.() ?? new Date().toISOString();
  const next: HostedBrowserVaultRefreshState = {
    ...current,
    dirty: true,
    dirtyReason: current.dirtyReason === "query_source_deleted"
      ? "query_source_deleted"
      : input.dirtyReason,
    dirtySince: current.dirtySince ?? now,
    nextAttemptAt: null,
  };
  await writeHostedBrowserVaultRefreshState({
    state: next,
    vaultRoot: input.vaultRoot,
  });
  return next;
}

export async function markHostedBrowserVaultRefreshClean(input: {
  lastPublishedSourceHash: string;
  vaultRoot: string;
}): Promise<HostedBrowserVaultRefreshState> {
  const current = await readHostedBrowserVaultRefreshState(input);
  const next: HostedBrowserVaultRefreshState = {
    ...current,
    dirty: false,
    dirtyReason: null,
    dirtySince: null,
    failureCount: 0,
    lastPublishedSourceHash: input.lastPublishedSourceHash,
    nextAttemptAt: null,
  };
  await writeHostedBrowserVaultRefreshState({
    state: next,
    vaultRoot: input.vaultRoot,
  });
  return next;
}

export async function markHostedBrowserVaultRefreshFailed(input: {
  now?: () => string;
  vaultRoot: string;
}): Promise<HostedBrowserVaultRefreshState> {
  const current = await readHostedBrowserVaultRefreshState(input);
  const failureCount = current.failureCount + 1;
  const nowMs = Date.parse(input.now?.() ?? new Date().toISOString());
  const backoffMs = Math.min(15 * 60_000, 2 ** Math.min(failureCount - 1, 6) * 1_000);
  const next: HostedBrowserVaultRefreshState = {
    ...current,
    dirty: true,
    failureCount,
    nextAttemptAt: new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + backoffMs).toISOString(),
  };
  await writeHostedBrowserVaultRefreshState({
    state: next,
    vaultRoot: input.vaultRoot,
  });
  return next;
}

function resolveHostedBrowserVaultWarmSourceStatePath(vaultRoot: string): string {
  return path.join(path.resolve(vaultRoot), HOSTED_BROWSER_VAULT_WARM_SOURCE_STATE_PATH);
}

function resolveHostedBrowserVaultRefreshStatePath(vaultRoot: string): string {
  return path.join(path.resolve(vaultRoot), HOSTED_BROWSER_VAULT_REFRESH_STATE_PATH);
}

function createCleanHostedBrowserVaultRefreshState(): HostedBrowserVaultRefreshState {
  return {
    schema: HOSTED_BROWSER_VAULT_REFRESH_STATE_SCHEMA,
    dirty: false,
    dirtySince: null,
    dirtyReason: null,
    lastPublishedSourceHash: null,
    failureCount: 0,
    nextAttemptAt: null,
  };
}

function parseHostedBrowserVaultRefreshState(value: unknown): HostedBrowserVaultRefreshState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createCleanHostedBrowserVaultRefreshState();
  }

  const record = value as Partial<HostedBrowserVaultRefreshState>;
  if (record.schema !== HOSTED_BROWSER_VAULT_REFRESH_STATE_SCHEMA) {
    return createCleanHostedBrowserVaultRefreshState();
  }

  const failureCount = typeof record.failureCount === "number" && Number.isSafeInteger(record.failureCount)
    && record.failureCount >= 0
    ? record.failureCount
    : 0;
  return {
    schema: HOSTED_BROWSER_VAULT_REFRESH_STATE_SCHEMA,
    dirty: record.dirty === true,
    dirtySince: readNullableString(record.dirtySince),
    dirtyReason: record.dirtyReason === "query_source_deleted"
      ? "query_source_deleted"
      : record.dirtyReason === "query_source_changed"
      ? "query_source_changed"
      : null,
    lastPublishedSourceHash: readNullableString(record.lastPublishedSourceHash),
    failureCount,
    nextAttemptAt: readNullableString(record.nextAttemptAt),
  };
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readBrowserVaultDirtyReasonFromReceipt(
  receipt: HostedCanonicalWriteReceipt,
): HostedBrowserVaultRefreshDirtyReason | null {
  let changed = false;
  for (const action of receipt.actions) {
    const actionReason = readBrowserVaultDirtyReasonFromReceiptAction(action);
    if (actionReason === "query_source_deleted") {
      return "query_source_deleted";
    }
    if (actionReason === "query_source_changed") {
      changed = true;
    }
  }
  return changed ? "query_source_changed" : null;
}

function readBrowserVaultDirtyReasonFromReceiptAction(
  action: HostedCanonicalWriteReceiptAction,
): HostedBrowserVaultRefreshDirtyReason | null {
  switch (action.kind) {
    case "text_upsert":
      return action.effect !== "reuse" && isCanonicalQuerySourcePath(action.targetRelativePath)
        ? "query_source_changed"
        : null;
    case "jsonl_append":
      return isCanonicalQuerySourcePath(action.targetRelativePath)
        ? "query_source_changed"
        : null;
    case "delete":
      return action.existedBefore === true && isCanonicalQuerySourcePath(action.targetRelativePath)
        ? "query_source_deleted"
        : null;
    case "raw_upsert":
      return null;
  }
}

function summarizeHostedBrowserVaultReplicaSource(
  manifest: readonly QuerySourceManifestEntry[],
): HostedBrowserVaultReplicaSourceSummary {
  return {
    fileCount: manifest.length,
    totalBytes: manifest.reduce((total, entry) => total + entry.sizeBytes, 0),
  };
}
