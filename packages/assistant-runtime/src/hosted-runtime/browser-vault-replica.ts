import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  listCanonicalSourceManifest,
  readVault,
} from "@murphai/query";
import type {
  QuerySourceManifestEntry,
} from "@murphai/query";
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

export async function createHostedBrowserVaultReplicaRefreshFromWorkspace(input: {
  generatedAt: string;
  platform: HostedRuntimePlatform;
  sourceStateHash: string;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedBrowserVaultReplicaRefreshPreparation> {
  const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
    platform: input.platform,
    vaultRoot: input.vaultRoot,
    workspace: input.workspace,
  });
  const [sourceManifest, replica] = await Promise.all([
    listCanonicalSourceManifest(restored.vaultRoot),
    createHostedBrowserVaultReplicaForSourceState({
      generatedAt: input.generatedAt,
      sourceStateHash: input.sourceStateHash,
      vaultRoot: restored.vaultRoot,
    }),
  ]);

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

function resolveHostedBrowserVaultWarmSourceStatePath(vaultRoot: string): string {
  return path.join(path.resolve(vaultRoot), HOSTED_BROWSER_VAULT_WARM_SOURCE_STATE_PATH);
}

function summarizeHostedBrowserVaultReplicaSource(
  manifest: readonly QuerySourceManifestEntry[],
): HostedBrowserVaultReplicaSourceSummary {
  return {
    fileCount: manifest.length,
    totalBytes: manifest.reduce((total, entry) => total + entry.sizeBytes, 0),
  };
}
