import { createHash, createHmac } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import path from "node:path";
import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";

import { ensureAssistantStateDirectory } from "./assistant-state-security.ts";
import { resolveAssistantStatePaths } from "./assistant-state.ts";
import {
  ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH,
  describeVaultLocalStateRelativePath,
  isPortableVaultOperationalContainerRelativePath,
  RUNTIME_CACHE_ROOT_RELATIVE_PATH,
  RUNTIME_PROJECTION_ROOT_RELATIVE_PATH,
  RUNTIME_ROOT_RELATIVE_PATH,
  RUNTIME_TEMP_ROOT_RELATIVE_PATH,
} from "./local-state-taxonomy.ts";
import {
  HOSTED_BUNDLE_SCHEMA,
  isHostedBundleArtifactEntry,
  parseHostedBundleArchive,
  readHostedBundleTextFile,
  resolveHostedBundleRestorePath,
  serializeHostedBundleArchive,
  type HostedBundleArchiveFile,
  type HostedBundleArtifactRef,
  writeHostedBundleTextFile,
} from "./hosted-bundle.ts";
import {
  materializeHostedBundleArtifacts,
  restoreHostedBundleRoots,
  snapshotHostedBundleRoots,
  type HostedBundleArtifactRestoreFilter,
  type HostedBundleArtifactRestoreInput,
  type HostedBundleArtifactSnapshotInput,
} from "./hosted-bundle-node.ts";

const WORKSPACE_OPERATOR_HOME_ROOT = "operator-home";
const HOSTED_CODEX_HOME_RELATIVE_PATH = ".codex-hosted";
const HOSTED_CODEX_CONTINUITY_MANIFEST_RELATIVE_PATH =
  ".murph/hosted-codex-continuity.json";
const HOSTED_CODEX_CONTINUITY_MANIFEST_SCHEMA =
  "murph.hosted-codex-continuity.v1";
const HOSTED_WORKSPACE_BUNDLE_METADATA_ROOT = "workspace-metadata";
export const HOSTED_PORTABLE_WORKSPACE_MANIFEST_RELATIVE_PATH =
  "hosted-portable-workspace-manifest.json";
export const HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA =
  "murph.hosted-portable-workspace-manifest.v1";
export const HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION =
  "hosted-workspace-snapshot-policy.2026-05-07";
export const HOSTED_PORTABLE_WORKSPACE_DELTA_MANIFEST_RELATIVE_PATH =
  "hosted-portable-workspace-delta.json";
export const HOSTED_PORTABLE_WORKSPACE_DELTA_MANIFEST_SCHEMA =
  "murph.portable-workspace-delta.v1";
const HOSTED_CODEX_ROLLOUT_RELATIVE_PATH_PATTERN =
  /^sessions\/(\d{4})\/(\d{2})\/(\d{2})\/rollout-(\d{4})-(\d{2})-(\d{2})T[^/]+-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/u;
const WORKSPACE_SNAPSHOT_ROOT_KEYS = new Set<string>([
  WORKSPACE_OPERATOR_HOME_ROOT,
  "vault",
]);
const RAW_ARTIFACT_EXTERNALIZE_THRESHOLD_BYTES = 256 * 1024;
const HOSTED_WORKSPACE_SNAPSHOT_DIAGNOSTIC_LIST_LIMIT = 16;
const HOSTED_HOT_STATE_MAX_FILES = 5_000;
const HOSTED_HOT_STATE_MAX_INLINE_BYTES = 16 * 1024 * 1024;
const HOSTED_HOT_STATE_MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const HOSTED_CODEX_CONTINUITY_SNAPSHOT_MAX_ATTEMPTS = 2;

const HOSTED_ASSISTANT_RUNTIME_HOT_STATE_INCLUDE_PATHS = [
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/accepted-turn-inputs`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/auto-reply`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/automation-state.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/cron/automation-runtime.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/cron/jobs.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/hosted-mailbox.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/hosted-provider-cleanup.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/hosted-system-mailbox.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/indexes.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/input-events`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/issues/pending`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/outbox`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/receipts`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/sessions`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/state`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/transcripts`,
] as const;

const HOSTED_ASSISTANT_RUNTIME_HOT_STATE_EXCLUDED_PATHS = [
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/cron/runs`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/diagnostics`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/journals`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/runtime-budgets.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/status.json`,
] as const;

export interface HostedCodexHomeSnapshotDiagnostics {
  codexResumeArchivedUnsupportedCount: number;
  codexResumeFlushFailed: boolean;
  codexResumeInvalidPathCount: number;
  codexResumeMissingRolloutCount: number;
  codexResumeRolloutBytes: number;
  codexResumeRolloutFileBytes: number[];
  codexResumeRolloutRelHashes: string[];
  codexResumeThreadCount: number;
}

export interface HostedWorkspaceSnapshotSizeDiagnostics {
  workspaceSnapshotClassSummary: string[];
  workspaceSnapshotExternalArtifactBytes: number;
  workspaceSnapshotExternalArtifactCount: number;
  workspaceSnapshotFingerprintStatus: "disabled" | "enabled";
  workspaceSnapshotIncludedFileCount: number;
  workspaceSnapshotInlineBytes: number;
  workspaceSnapshotLargestFiles: string[];
  workspaceSnapshotMaxFileBytes: number;
  workspaceSnapshotMaxFileClass: string | null;
}

export interface HostedWorkspaceArtifactPersistInput extends HostedBundleArtifactSnapshotInput {
  ref: HostedBundleArtifactRef;
}

export interface HostedAssistantRuntimeHotStateSnapshot {
  bundle: Uint8Array;
  bundleBytes: number;
  codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;
  fileCount: number;
  inlineBytes: number;
}

export interface HostedWorkspaceSnapshotProviderContinuityAnalysis {
  hasCodexProviderContinuity: boolean;
  hasProviderResumeState: boolean;
}

interface HostedAssistantRuntimeHotStateBudgetMetrics {
  fileCount: number;
  inlineBytes: number;
  minimumBundleBytes: number;
}

interface HostedCodexContinuityEntry {
  absolutePath: string;
  byteSize: number;
  codexRolloutRelativePath: string;
  providerSessionId: string;
  sha256: string;
}

interface HostedCodexContinuityCollection {
  archivedUnsupportedCount: number;
  entries: HostedCodexContinuityEntry[];
  flushFailed: boolean;
  invalidPathCount: number;
  missingRolloutCount: number;
  requestedThreadCount: number;
}

export class HostedAssistantRuntimeHotStateBudgetExceededError extends Error {
  constructor(
    readonly budget: "files" | "inline_bytes" | "bundle_bytes",
    readonly limit: number,
    readonly actual: number,
  ) {
    super("Hosted assistant runtime hot-state snapshot exceeded its budget.");
    this.name = "HostedAssistantRuntimeHotStateBudgetExceededError";
  }
}

export class HostedWorkspaceSnapshotContinuityIncompleteError extends Error {
  readonly codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;

  constructor(
    readonly reason: "codex_flush_failed" | "codex_home_missing",
    options?: {
      codexHomeSnapshotDiagnostics?: HostedCodexHomeSnapshotDiagnostics | null;
      message?: string;
    },
  ) {
    super(options?.message ?? "Hosted workspace snapshot is missing required provider continuity state.");
    this.name = "HostedWorkspaceSnapshotContinuityIncompleteError";
    this.codexHomeSnapshotDiagnostics = options?.codexHomeSnapshotDiagnostics ?? null;
  }
}

class HostedCodexContinuitySnapshotDriftError extends HostedWorkspaceSnapshotContinuityIncompleteError {
  constructor(codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null) {
    super("codex_home_missing", {
      codexHomeSnapshotDiagnostics,
      message: "Hosted Codex continuity changed while snapshotting.",
    });
    this.name = "HostedCodexContinuitySnapshotDriftError";
  }
}

export type HostedWorkspaceArtifactResolver = (
  input: HostedBundleArtifactRestoreInput,
) => Promise<Uint8Array | ArrayBuffer>;

interface HostedExecutionContextSnapshotInput {
  assertSnapshotLive?: () => Promise<void> | void;
  artifactSink?: (input: HostedWorkspaceArtifactPersistInput) => Promise<void>;
  artifactRefProvider?: (
    input: HostedBundleArtifactSnapshotInput,
  ) => HostedBundleArtifactRef | null | Promise<HostedBundleArtifactRef | null>;
  codexHomeSnapshotHashSecret?: string | null;
  materializedArtifactPaths?: ReadonlySet<string>;
  operatorHomeRoot?: string | null;
  prepareCodexContinuitySnapshot?: HostedCodexContinuitySnapshotPreparer | null;
  preservedArtifacts?: readonly HostedBundleArtifactRestoreInput[];
  vaultRoot: string;
  workspaceSnapshotSizeDiagnosticsSink?: (
    diagnostics: HostedWorkspaceSnapshotSizeDiagnostics,
  ) => Promise<void> | void;
}

export type HostedCodexContinuitySnapshotPreparer = () =>
  | Promise<readonly HostedCodexContinuitySnapshotPreparedThread[]>
  | readonly HostedCodexContinuitySnapshotPreparedThread[];

export interface HostedCodexContinuitySnapshotPreparedThread {
  codexRolloutRelativePath: string;
  providerSessionId: string;
}

export async function snapshotHostedExecutionContext(
  input: HostedExecutionContextSnapshotInput,
): Promise<{
  bundle: Uint8Array;
  codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;
  workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics;
}> {
  return await snapshotHostedPortableWorkspaceBundleWithProviderContinuityPolicy({
    ...input,
    enforceProviderContinuity: true,
  });
}

export async function snapshotHostedExecutionContextUnsafeForFixture(
  input: HostedExecutionContextSnapshotInput,
): Promise<{
  bundle: Uint8Array;
  codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;
  workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics;
}> {
  return await snapshotHostedPortableWorkspaceBundleWithProviderContinuityPolicy({
    ...input,
    enforceProviderContinuity: false,
  });
}

export interface HostedPortableWorkspaceManifestFile {
  artifact?: HostedBundleArtifactRef;
  path: string;
  root: string;
  sha256: string;
  size: number;
}

export interface HostedPortableWorkspaceManifest {
  files: HostedPortableWorkspaceManifestFile[];
  manifestHash: string;
  policyVersion: typeof HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION;
  schema: typeof HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA;
}

export interface HostedPortableWorkspaceDeltaTombstone {
  path: string;
  root: string;
}

export interface HostedPortableWorkspaceDeltaManifest {
  baseManifestHash: string;
  baseSnapshotHash: string;
  effectiveManifestHash: string;
  manifestHash: string;
  policyVersion: typeof HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION;
  schema: typeof HOSTED_PORTABLE_WORKSPACE_DELTA_MANIFEST_SCHEMA;
  tombstones: HostedPortableWorkspaceDeltaTombstone[];
  upserts: HostedPortableWorkspaceManifestFile[];
}

export type HostedPortableWorkspaceDeltaSnapshot =
  | {
      bundle: Uint8Array;
      codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;
      kind: "changed";
      manifest: HostedPortableWorkspaceDeltaManifest;
      workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics;
    }
  | {
      codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;
      currentManifest: HostedPortableWorkspaceManifest;
      kind: "unchanged";
      workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics;
    };

export async function snapshotHostedPortableWorkspaceDelta(input: Omit<
  HostedExecutionContextSnapshotInput,
  "assertSnapshotLive"
> & {
  baseManifest: HostedPortableWorkspaceManifest;
  baseSnapshotHash: string;
}): Promise<HostedPortableWorkspaceDeltaSnapshot> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const operatorHomeRoot = input.operatorHomeRoot ? path.resolve(input.operatorHomeRoot) : null;
  const workspaceSnapshotHashSecret =
    normalizeHostedCodexHomeSnapshotHashSecret(input.codexHomeSnapshotHashSecret);
  const workspaceSnapshotSizeDiagnostics =
    createHostedWorkspaceSnapshotSizeDiagnosticsCollector({
      hashSecret: workspaceSnapshotHashSecret,
    });
  const preparedCodexContinuity = await prepareHostedCodexContinuitySnapshot({
    assistantStateRoot,
    prepareCodexContinuitySnapshot: input.prepareCodexContinuitySnapshot,
  });
  const hostedCodexContinuity = operatorHomeRoot
    ? await collectHostedCodexContinuity({
        assistantStateRoot,
        hashSecret: workspaceSnapshotHashSecret,
        operatorHomeRoot,
        preparedThreads: preparedCodexContinuity.preparedThreads,
      })
    : await collectMissingHostedCodexContinuity(assistantStateRoot);
  hostedCodexContinuity.flushFailed ||= preparedCodexContinuity.flushFailed;
  const codexHomeSnapshotDiagnostics = createHostedCodexContinuityDiagnostics({
    collection: hostedCodexContinuity,
    hashSecret: workspaceSnapshotHashSecret,
  });
  assertHostedCodexContinuityComplete(
    hostedCodexContinuity,
    codexHomeSnapshotDiagnostics,
  );

  const scan = await collectHostedPortableWorkspaceDeltaFiles({
    artifactRefProvider: input.artifactRefProvider,
    artifactSink: input.artifactSink,
    baseManifest: input.baseManifest,
    baseSnapshotHash: input.baseSnapshotHash,
    codexHomeSnapshotDiagnostics,
    codexContinuity: hostedCodexContinuity,
    materializedArtifactPaths: input.materializedArtifactPaths,
    operatorHomeRoot,
    preservedArtifacts: input.preservedArtifacts,
    vaultRoot,
    workspaceSnapshotSizeDiagnostics,
  });
  await input.workspaceSnapshotSizeDiagnosticsSink?.(
    workspaceSnapshotSizeDiagnostics.finish(),
  );

  if (scan.delta === null) {
    return {
      codexHomeSnapshotDiagnostics,
      currentManifest: scan.currentManifest,
      kind: "unchanged",
      workspaceSnapshotSizeDiagnostics: workspaceSnapshotSizeDiagnostics.finish(),
    };
  }

  return {
    bundle: scan.delta.bundle,
    codexHomeSnapshotDiagnostics,
    kind: "changed",
    manifest: scan.delta.manifest,
    workspaceSnapshotSizeDiagnostics: workspaceSnapshotSizeDiagnostics.finish(),
  };
}

async function snapshotHostedPortableWorkspaceBundleWithProviderContinuityPolicy(
  input: HostedExecutionContextSnapshotInput & {
    enforceProviderContinuity: boolean;
  },
): Promise<{
  bundle: Uint8Array;
  codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;
  workspaceSnapshotSizeDiagnostics: HostedWorkspaceSnapshotSizeDiagnostics;
}> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const artifactSink = input.artifactSink;
  const operatorHomeRoot = input.operatorHomeRoot ? path.resolve(input.operatorHomeRoot) : null;
  const workspaceSnapshotHashSecret =
    normalizeHostedCodexHomeSnapshotHashSecret(input.codexHomeSnapshotHashSecret);
  const workspaceSnapshotSizeDiagnostics =
    createHostedWorkspaceSnapshotSizeDiagnosticsCollector({
      hashSecret: workspaceSnapshotHashSecret,
    });
  const preparedCodexContinuity = await prepareHostedCodexContinuitySnapshot({
    assistantStateRoot,
    prepareCodexContinuitySnapshot: input.prepareCodexContinuitySnapshot,
  });
  const hostedCodexContinuity = operatorHomeRoot
    ? await collectHostedCodexContinuity({
        assistantStateRoot,
        hashSecret: workspaceSnapshotHashSecret,
        operatorHomeRoot,
        preparedThreads: preparedCodexContinuity.preparedThreads,
      })
    : await collectMissingHostedCodexContinuity(assistantStateRoot);
  hostedCodexContinuity.flushFailed ||= preparedCodexContinuity.flushFailed;
  const codexHomeSnapshotDiagnostics = createHostedCodexContinuityDiagnostics({
    collection: hostedCodexContinuity,
    hashSecret: workspaceSnapshotHashSecret,
  });
  if (input.enforceProviderContinuity) {
    assertHostedCodexContinuityComplete(
      hostedCodexContinuity,
      codexHomeSnapshotDiagnostics,
    );
  }
  const codexContinuityArtifactPaths = createHostedCodexContinuitySnapshotArtifactPathSet(
    hostedCodexContinuity,
  );
  const vaultBundle = await snapshotHostedBundleRoots({
    assertSnapshotLive: input.assertSnapshotLive,
    externalizeFile: async (artifact) => {
      const shouldExternalize =
        shouldExternalizeWorkspaceArtifact(artifact)
        || codexContinuityArtifactPaths.has(`${artifact.root}:${artifact.path}`);
      const existingRef = shouldExternalize
        ? await input.artifactRefProvider?.(artifact) ?? null
        : null;
      const willExternalize = shouldExternalize && (existingRef !== null || Boolean(artifactSink));
      workspaceSnapshotSizeDiagnostics.record({
        artifact,
        externalized: willExternalize,
      });
      if (!willExternalize) {
        return null;
      }
      if (existingRef) {
        return existingRef;
      }
      if (!artifactSink) {
        return null;
      }

      await input.assertSnapshotLive?.();
      const ref = createHostedWorkspaceArtifactRef(artifact.bytes);
      await input.assertSnapshotLive?.();
      await artifactSink({
        ...artifact,
        ref,
      });
      return ref;
    },
    kind: "vault",
    materializedPreservedArtifactPaths: new Set(
      [...(input.materializedArtifactPaths ?? [])]
        .map((relativePath) => normalizeWorkspaceSnapshotArtifactPathKey(relativePath))
        .filter((artifactPathKey): artifactPathKey is string => artifactPathKey !== null),
    ),
    onBeforeSerialize: async () => {
      await input.workspaceSnapshotSizeDiagnosticsSink?.(
        workspaceSnapshotSizeDiagnostics.finish(),
      );
    },
    preservedArtifacts: input.preservedArtifacts,
    roots: [
      {
        root: vaultRoot,
        rootKey: "vault",
        shouldIncludeRelativePath(relativePath) {
          return shouldIncludeWorkspaceSnapshotVaultRelativePath(relativePath);
        },
      },
      ...(input.operatorHomeRoot
        ? [
            {
              explicitFiles: createHostedCodexContinuitySnapshotExplicitFiles(
                hostedCodexContinuity,
              ),
              optional: true,
              root: operatorHomeRoot!,
              rootKey: WORKSPACE_OPERATOR_HOME_ROOT,
              shouldIncludeRelativePath(relativePath: string) {
                return shouldIncludeHostedOperatorHomeRelativePath(relativePath);
              },
            },
          ]
        : []),
    ],
    shouldIncludePreservedArtifact(artifact) {
      return shouldPreserveWorkspaceSnapshotArtifact(artifact);
    },
  });

  if (vaultBundle === null) {
    throw new Error("Hosted vault bundle could not be created.");
  }
  const bundleWithCodexContinuityManifest =
    hostedCodexContinuity.entries.length > 0
      ? writeHostedBundleTextFile({
          bytes: vaultBundle,
          kind: "vault",
          path: HOSTED_CODEX_CONTINUITY_MANIFEST_RELATIVE_PATH,
          root: WORKSPACE_OPERATOR_HOME_ROOT,
          text: JSON.stringify(createHostedCodexContinuityManifestFromBundle({
            bytes: vaultBundle,
            entries: hostedCodexContinuity.entries,
          })) + "\n",
        })
      : vaultBundle;
  const bundleWithPortableManifest =
    writeHostedPortableWorkspaceManifestToBundle(bundleWithCodexContinuityManifest);
  return {
    bundle: bundleWithPortableManifest,
    codexHomeSnapshotDiagnostics,
    workspaceSnapshotSizeDiagnostics: workspaceSnapshotSizeDiagnostics.finish(),
  };
}

export function readHostedPortableWorkspaceManifestFromBundle(
  bytes: Uint8Array | ArrayBuffer | null,
): HostedPortableWorkspaceManifest | null {
  const manifestText = readHostedBundleTextFile({
    bytes,
    expectedKind: "vault",
    path: HOSTED_PORTABLE_WORKSPACE_MANIFEST_RELATIVE_PATH,
    root: HOSTED_WORKSPACE_BUNDLE_METADATA_ROOT,
  });
  if (!manifestText) {
    return null;
  }
  return parseHostedPortableWorkspaceManifestJson(manifestText);
}

export function createHostedPortableWorkspaceManifestFromBundle(
  bytes: Uint8Array | ArrayBuffer,
): HostedPortableWorkspaceManifest {
  const archive = parseHostedBundleArchive(bytes);
  if (archive.kind !== "vault") {
    throw new Error(`Hosted portable workspace manifest requires a vault bundle, got ${archive.kind}.`);
  }

  const files = archive.files
    .filter((file) => file.root !== HOSTED_WORKSPACE_BUNDLE_METADATA_ROOT)
    .map((file): HostedPortableWorkspaceManifestFile => {
      if (isHostedBundleArtifactEntry(file)) {
        return {
          artifact: file.artifact,
          path: file.path,
          root: file.root,
          sha256: file.artifact.sha256,
          size: file.artifact.byteSize,
        };
      }

      const contents = Buffer.from(file.contentsBase64, "base64");
      return {
        path: file.path,
        root: file.root,
        sha256: createHash("sha256").update(contents).digest("hex"),
        size: contents.byteLength,
      };
    })
    .sort(compareHostedPortableWorkspaceManifestFiles);

  return finalizeHostedPortableWorkspaceManifest(files);
}

function writeHostedPortableWorkspaceManifestToBundle(
  bytes: Uint8Array | ArrayBuffer,
): Uint8Array {
  const manifest = createHostedPortableWorkspaceManifestFromBundle(bytes);
  return writeHostedBundleTextFile({
    bytes,
    kind: "vault",
    path: HOSTED_PORTABLE_WORKSPACE_MANIFEST_RELATIVE_PATH,
    root: HOSTED_WORKSPACE_BUNDLE_METADATA_ROOT,
    text: JSON.stringify(manifest) + "\n",
  });
}

export function createHostedWorkspaceWorkingDeltaBundle(input: {
  baseManifest: HostedPortableWorkspaceManifest;
  baseSnapshotHash: string;
  currentBundle: Uint8Array | ArrayBuffer;
  preservedArtifacts?: readonly HostedBundleArtifactRestoreInput[];
}): {
  bundle: Uint8Array;
  manifest: HostedPortableWorkspaceDeltaManifest;
} {
  const currentManifest =
    readHostedPortableWorkspaceManifestFromBundle(input.currentBundle)
      ?? createHostedPortableWorkspaceManifestFromBundle(input.currentBundle);
  if (
    input.baseManifest.policyVersion !== HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION
    || currentManifest.policyVersion !== HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION
  ) {
    throw new Error("Hosted workspace working delta requires matching portable manifest policy versions.");
  }

  const archive = parseHostedBundleArchive(input.currentBundle);
  if (archive.kind !== "vault") {
    throw new Error(`Hosted workspace working delta requires a vault bundle, got ${archive.kind}.`);
  }

  const baseFiles = new Map(input.baseManifest.files.map((file) => [
    hostedPortableWorkspaceManifestFileKey(file),
    file,
  ]));
  const currentFiles = new Map(currentManifest.files.map((file) => [
    hostedPortableWorkspaceManifestFileKey(file),
    file,
  ]));
  for (const artifact of input.preservedArtifacts ?? []) {
    const key = `${artifact.root}:${normalizeWorkspaceSnapshotRelativePath(artifact.path)}`;
    if (currentFiles.has(key)) {
      continue;
    }
    currentFiles.set(key, {
      artifact: artifact.ref,
      path: normalizeWorkspaceSnapshotRelativePath(artifact.path),
      root: artifact.root,
      sha256: artifact.ref.sha256,
      size: artifact.ref.byteSize,
    });
  }
  const effectiveCurrentFiles = [...currentFiles.values()]
    .sort(compareHostedPortableWorkspaceManifestFiles);
  const effectiveCurrentManifest = finalizeHostedPortableWorkspaceManifest(effectiveCurrentFiles);
  const upserts = effectiveCurrentManifest.files.filter((file) => {
    const baseFile = baseFiles.get(hostedPortableWorkspaceManifestFileKey(file));
    return !baseFile || !hostedPortableWorkspaceManifestFilesEqual(baseFile, file);
  });
  const tombstones = input.baseManifest.files
    .filter((file) => !currentFiles.has(hostedPortableWorkspaceManifestFileKey(file)))
    .map((file): HostedPortableWorkspaceDeltaTombstone => ({
      path: file.path,
      root: file.root,
    }))
    .sort(compareHostedPortableWorkspaceDeltaTombstones);
  const archiveFiles = new Map(archive.files.map((file) => [
    hostedPortableWorkspaceArchiveFileKey(file),
    file,
  ]));
  const deltaFiles: HostedBundleArchiveFile[] = upserts.map((upsert) => {
    const key = hostedPortableWorkspaceManifestFileKey(upsert);
    const archiveFile = archiveFiles.get(key);
    if (archiveFile) {
      return archiveFile;
    }
    if (upsert.artifact) {
      return {
        artifact: upsert.artifact,
        path: upsert.path,
        root: upsert.root,
      };
    }
    throw new Error(`Hosted workspace working delta upsert "${key}" is missing from the current bundle.`);
  });
  const manifest = finalizeHostedPortableWorkspaceDeltaManifest({
    baseManifestHash: input.baseManifest.manifestHash,
    baseSnapshotHash: input.baseSnapshotHash,
    effectiveManifestHash: effectiveCurrentManifest.manifestHash,
    tombstones,
    upserts,
  });

  const deltaBundle = serializeHostedBundleArchive({
    files: deltaFiles,
    kind: "vault",
    schema: archive.schema,
  });

  return {
    bundle: writeHostedBundleTextFile({
      bytes: deltaBundle,
      kind: "vault",
      path: HOSTED_PORTABLE_WORKSPACE_DELTA_MANIFEST_RELATIVE_PATH,
      root: HOSTED_WORKSPACE_BUNDLE_METADATA_ROOT,
      text: JSON.stringify(manifest) + "\n",
    }),
    manifest,
  };
}

async function collectHostedPortableWorkspaceDeltaFiles(input: {
  artifactRefProvider?: (
    input: HostedBundleArtifactSnapshotInput,
  ) => HostedBundleArtifactRef | null | Promise<HostedBundleArtifactRef | null>;
  artifactSink?: (input: HostedWorkspaceArtifactPersistInput) => Promise<void>;
  baseManifest: HostedPortableWorkspaceManifest;
  baseSnapshotHash: string;
  codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;
  codexContinuity: HostedCodexContinuityCollection;
  materializedArtifactPaths?: ReadonlySet<string>;
  operatorHomeRoot: string | null;
  preservedArtifacts?: readonly HostedBundleArtifactRestoreInput[];
  vaultRoot: string;
  workspaceSnapshotSizeDiagnostics: ReturnType<typeof createHostedWorkspaceSnapshotSizeDiagnosticsCollector>;
}): Promise<{
  currentManifest: HostedPortableWorkspaceManifest;
  delta: {
    bundle: Uint8Array;
    manifest: HostedPortableWorkspaceDeltaManifest;
  } | null;
}> {
  const files = new Map<string, HostedPortableWorkspaceManifestFile>();
  const archiveFiles = new Map<string, HostedBundleArchiveFile>();
  const includedPaths = new Set<string>();
  const codexContinuityArtifactPaths = createHostedCodexContinuitySnapshotArtifactPathSet(
    input.codexContinuity,
  );

  await collectHostedPortableWorkspaceDeltaRoot({
    artifactRefProvider: input.artifactRefProvider,
    artifactSink: input.artifactSink,
    archiveFiles,
    codexContinuityArtifactPaths,
    files,
    includedPaths,
    root: input.vaultRoot,
    rootKey: "vault",
    shouldIncludeRelativePath(relativePath) {
      return shouldIncludeWorkspaceSnapshotVaultRelativePath(relativePath);
    },
    workspaceSnapshotSizeDiagnostics: input.workspaceSnapshotSizeDiagnostics,
  });

  if (input.operatorHomeRoot) {
    await collectHostedPortableWorkspaceDeltaRoot({
      artifactRefProvider: input.artifactRefProvider,
      artifactSink: input.artifactSink,
      archiveFiles,
      codexContinuityArtifactPaths,
      explicitFiles: createHostedCodexContinuitySnapshotExplicitFiles(input.codexContinuity),
      files,
      includedPaths,
      optional: true,
      root: input.operatorHomeRoot,
      rootKey: WORKSPACE_OPERATOR_HOME_ROOT,
      shouldIncludeRelativePath(relativePath) {
        return shouldIncludeHostedOperatorHomeRelativePath(relativePath);
      },
      workspaceSnapshotSizeDiagnostics: input.workspaceSnapshotSizeDiagnostics,
    });
  }

  if (input.codexContinuity.entries.length > 0) {
    await addHostedPortableWorkspaceDeltaInlineFile({
      archiveFiles,
      bytes: Buffer.from(
        JSON.stringify(createHostedCodexContinuityManifestFromArchiveFiles({
          codexHomeSnapshotDiagnostics: input.codexHomeSnapshotDiagnostics,
          entries: input.codexContinuity.entries,
          files: [...archiveFiles.values()],
        })) + "\n",
        "utf8",
      ),
      files,
      path: HOSTED_CODEX_CONTINUITY_MANIFEST_RELATIVE_PATH,
      root: WORKSPACE_OPERATOR_HOME_ROOT,
    });
  }

  carryForwardUnmaterializedHostedWorkspaceArtifacts({
    archiveFiles,
    files,
    materializedArtifactPaths: input.materializedArtifactPaths,
    preservedArtifacts: input.preservedArtifacts,
  });

  const currentManifest = finalizeHostedPortableWorkspaceManifest(
    [...files.values()].sort(compareHostedPortableWorkspaceManifestFiles),
  );
  const delta = createHostedWorkspaceWorkingDeltaBundleFromManifestFiles({
    archiveFiles,
    baseManifest: input.baseManifest,
    baseSnapshotHash: input.baseSnapshotHash,
    currentManifest,
  });

  return {
    currentManifest,
    delta,
  };
}

async function collectHostedPortableWorkspaceDeltaRoot(input: {
  artifactRefProvider?: (
    input: HostedBundleArtifactSnapshotInput,
  ) => HostedBundleArtifactRef | null | Promise<HostedBundleArtifactRef | null>;
  artifactSink?: (input: HostedWorkspaceArtifactPersistInput) => Promise<void>;
  archiveFiles: Map<string, HostedBundleArchiveFile>;
  codexContinuityArtifactPaths: ReadonlySet<string>;
  explicitFiles?: readonly string[];
  files: Map<string, HostedPortableWorkspaceManifestFile>;
  includedPaths: Set<string>;
  optional?: boolean;
  relativeDirectory?: string;
  root: string;
  rootKey: string;
  shouldIncludeRelativePath: (relativePath: string) => boolean;
  workspaceSnapshotSizeDiagnostics: ReturnType<typeof createHostedWorkspaceSnapshotSizeDiagnosticsCollector>;
}): Promise<void> {
  const relativeDirectory = input.relativeDirectory ?? "";
  const directoryPath = relativeDirectory ? path.join(input.root, relativeDirectory) : input.root;
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (input.optional && isMissingPathError(error)) {
      return;
    }
    throw error;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name)
      : entry.name;

    if (!input.shouldIncludeRelativePath(relativePath)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await collectHostedPortableWorkspaceDeltaRoot({
        ...input,
        optional: false,
        relativeDirectory: path.join(relativeDirectory, entry.name),
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await addHostedPortableWorkspaceDeltaFile({
      absolutePath,
      artifactRefProvider: input.artifactRefProvider,
      artifactSink: input.artifactSink,
      archiveFiles: input.archiveFiles,
      codexContinuityArtifactPaths: input.codexContinuityArtifactPaths,
      files: input.files,
      includedPaths: input.includedPaths,
      path: normalizeWorkspaceSnapshotRelativePath(relativePath),
      root: input.rootKey,
      workspaceSnapshotSizeDiagnostics: input.workspaceSnapshotSizeDiagnostics,
    });
  }

  if (relativeDirectory !== "") {
    return;
  }

  for (const explicitFile of input.explicitFiles ?? []) {
    const normalizedPath = normalizeWorkspaceSnapshotRelativePath(explicitFile);
    if (input.includedPaths.has(`${input.rootKey}:${normalizedPath}`)) {
      continue;
    }
    if (!(await isHostedPortableWorkspaceDeltaRegularFile(input.root, normalizedPath))) {
      throw new Error(`Hosted portable workspace delta explicit file is not a regular file for root "${input.rootKey}".`);
    }
    await addHostedPortableWorkspaceDeltaFile({
      absolutePath: path.join(input.root, ...normalizedPath.split(path.posix.sep)),
      artifactRefProvider: input.artifactRefProvider,
      artifactSink: input.artifactSink,
      archiveFiles: input.archiveFiles,
      codexContinuityArtifactPaths: input.codexContinuityArtifactPaths,
      files: input.files,
      includedPaths: input.includedPaths,
      path: normalizedPath,
      root: input.rootKey,
      workspaceSnapshotSizeDiagnostics: input.workspaceSnapshotSizeDiagnostics,
    });
  }
}

async function addHostedPortableWorkspaceDeltaFile(input: {
  absolutePath: string;
  artifactRefProvider?: (
    input: HostedBundleArtifactSnapshotInput,
  ) => HostedBundleArtifactRef | null | Promise<HostedBundleArtifactRef | null>;
  artifactSink?: (input: HostedWorkspaceArtifactPersistInput) => Promise<void>;
  archiveFiles: Map<string, HostedBundleArchiveFile>;
  codexContinuityArtifactPaths: ReadonlySet<string>;
  files: Map<string, HostedPortableWorkspaceManifestFile>;
  includedPaths: Set<string>;
  path: string;
  root: string;
  workspaceSnapshotSizeDiagnostics: ReturnType<typeof createHostedWorkspaceSnapshotSizeDiagnosticsCollector>;
}): Promise<void> {
  const key = `${input.root}:${input.path}`;
  if (input.includedPaths.has(key)) {
    return;
  }

  const bytes = new Uint8Array(await readFile(input.absolutePath));
  const artifactInput = {
    absolutePath: input.absolutePath,
    bytes,
    path: input.path,
    root: input.root,
  };
  const shouldExternalize =
    shouldExternalizeWorkspaceArtifact(artifactInput)
    || input.codexContinuityArtifactPaths.has(key);
  const existingRef = shouldExternalize
    ? await input.artifactRefProvider?.(artifactInput) ?? null
    : null;
  const willExternalize = shouldExternalize && (existingRef !== null || Boolean(input.artifactSink));
  input.workspaceSnapshotSizeDiagnostics.record({
    artifact: artifactInput,
    externalized: willExternalize,
  });

  if (willExternalize) {
    const ref = existingRef ?? createHostedWorkspaceArtifactRef(bytes);
    if (!existingRef) {
      await input.artifactSink?.({
        ...artifactInput,
        ref,
      });
    }
    input.files.set(key, {
      artifact: ref,
      path: input.path,
      root: input.root,
      sha256: ref.sha256,
      size: ref.byteSize,
    });
    input.archiveFiles.set(key, {
      artifact: ref,
      path: input.path,
      root: input.root,
    });
    input.includedPaths.add(key);
    return;
  }

  addHostedPortableWorkspaceDeltaInlineFile({
    archiveFiles: input.archiveFiles,
    bytes,
    files: input.files,
    path: input.path,
    root: input.root,
  });
  input.includedPaths.add(key);
}

async function isHostedPortableWorkspaceDeltaRegularFile(
  root: string,
  relativePath: string,
): Promise<boolean> {
  const absolutePath = path.join(
    root,
    ...normalizeWorkspaceSnapshotRelativePath(relativePath).split(path.posix.sep),
  );
  try {
    const stats = await lstat(absolutePath);
    return stats.isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

function addHostedPortableWorkspaceDeltaInlineFile(input: {
  archiveFiles: Map<string, HostedBundleArchiveFile>;
  bytes: Uint8Array;
  files: Map<string, HostedPortableWorkspaceManifestFile>;
  path: string;
  root: string;
}): void {
  const key = `${input.root}:${input.path}`;
  input.files.set(key, {
    path: input.path,
    root: input.root,
    sha256: sha256BytesHex(input.bytes),
    size: input.bytes.byteLength,
  });
  input.archiveFiles.set(key, {
    contentsBase64: Buffer.from(input.bytes).toString("base64"),
    path: input.path,
    root: input.root,
  });
}

function carryForwardUnmaterializedHostedWorkspaceArtifacts(input: {
  archiveFiles: Map<string, HostedBundleArchiveFile>;
  files: Map<string, HostedPortableWorkspaceManifestFile>;
  materializedArtifactPaths?: ReadonlySet<string>;
  preservedArtifacts?: readonly HostedBundleArtifactRestoreInput[];
}): void {
  const materializedArtifactPathKeys = new Set(
    [...(input.materializedArtifactPaths ?? [])]
      .map((relativePath) => normalizeWorkspaceSnapshotArtifactPathKey(relativePath))
      .filter((artifactPathKey): artifactPathKey is string => artifactPathKey !== null),
  );

  for (const artifact of input.preservedArtifacts ?? []) {
    const normalizedPath = normalizeWorkspaceSnapshotRelativePath(artifact.path);
    const key = `${artifact.root}:${normalizedPath}`;
    if (input.files.has(key) || materializedArtifactPathKeys.has(key)) {
      continue;
    }
    const file = {
      artifact: artifact.ref,
      path: normalizedPath,
      root: artifact.root,
      sha256: artifact.ref.sha256,
      size: artifact.ref.byteSize,
    };
    input.files.set(key, file);
    input.archiveFiles.set(key, {
      artifact: artifact.ref,
      path: normalizedPath,
      root: artifact.root,
    });
  }
}

function createHostedWorkspaceWorkingDeltaBundleFromManifestFiles(input: {
  archiveFiles: ReadonlyMap<string, HostedBundleArchiveFile>;
  baseManifest: HostedPortableWorkspaceManifest;
  baseSnapshotHash: string;
  currentManifest: HostedPortableWorkspaceManifest;
}): {
  bundle: Uint8Array;
  manifest: HostedPortableWorkspaceDeltaManifest;
} | null {
  const baseFiles = new Map(input.baseManifest.files.map((file) => [
    hostedPortableWorkspaceManifestFileKey(file),
    file,
  ]));
  const currentFiles = new Map(input.currentManifest.files.map((file) => [
    hostedPortableWorkspaceManifestFileKey(file),
    file,
  ]));
  const upserts = input.currentManifest.files.filter((file) => {
    const baseFile = baseFiles.get(hostedPortableWorkspaceManifestFileKey(file));
    return !baseFile || !hostedPortableWorkspaceManifestFilesEqual(baseFile, file);
  });
  const tombstones = input.baseManifest.files
    .filter((file) => !currentFiles.has(hostedPortableWorkspaceManifestFileKey(file)))
    .map((file): HostedPortableWorkspaceDeltaTombstone => ({
      path: file.path,
      root: file.root,
    }))
    .sort(compareHostedPortableWorkspaceDeltaTombstones);

  if (upserts.length === 0 && tombstones.length === 0) {
    return null;
  }

  const deltaFiles: HostedBundleArchiveFile[] = upserts.map((upsert) => {
    const key = hostedPortableWorkspaceManifestFileKey(upsert);
    const archiveFile = input.archiveFiles.get(key);
    if (archiveFile) {
      return archiveFile;
    }
    if (upsert.artifact) {
      return {
        artifact: upsert.artifact,
        path: upsert.path,
        root: upsert.root,
      };
    }
    throw new Error(`Hosted workspace working delta upsert "${key}" is missing from the current scan.`);
  });
  const manifest = finalizeHostedPortableWorkspaceDeltaManifest({
    baseManifestHash: input.baseManifest.manifestHash,
    baseSnapshotHash: input.baseSnapshotHash,
    effectiveManifestHash: input.currentManifest.manifestHash,
    tombstones,
    upserts,
  });
  const deltaBundle = serializeHostedBundleArchive({
    files: deltaFiles,
    kind: "vault",
    schema: HOSTED_BUNDLE_SCHEMA,
  });

  return {
    bundle: writeHostedBundleTextFile({
      bytes: deltaBundle,
      kind: "vault",
      path: HOSTED_PORTABLE_WORKSPACE_DELTA_MANIFEST_RELATIVE_PATH,
      root: HOSTED_WORKSPACE_BUNDLE_METADATA_ROOT,
      text: JSON.stringify(manifest) + "\n",
    }),
    manifest,
  };
}

export function readHostedPortableWorkspaceDeltaManifestFromBundle(
  bytes: Uint8Array | ArrayBuffer | null,
): HostedPortableWorkspaceDeltaManifest | null {
  const manifestText = readHostedBundleTextFile({
    bytes,
    expectedKind: "vault",
    path: HOSTED_PORTABLE_WORKSPACE_DELTA_MANIFEST_RELATIVE_PATH,
    root: HOSTED_WORKSPACE_BUNDLE_METADATA_ROOT,
  });
  if (!manifestText) {
    return null;
  }
  return parseHostedPortableWorkspaceDeltaManifestJson(manifestText);
}

function parseHostedPortableWorkspaceManifestJson(
  text: string,
): HostedPortableWorkspaceManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Hosted portable workspace manifest is invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Hosted portable workspace manifest must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA) {
    throw new Error("Hosted portable workspace manifest schema is invalid.");
  }
  if (record.policyVersion !== HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION) {
    throw new Error("Hosted portable workspace manifest policyVersion is invalid.");
  }
  if (!Array.isArray(record.files)) {
    throw new Error("Hosted portable workspace manifest files must be an array.");
  }
  const files = record.files.map(parseHostedPortableWorkspaceManifestFile)
    .sort(compareHostedPortableWorkspaceManifestFiles);
  const manifest = finalizeHostedPortableWorkspaceManifest(files);
  if (record.manifestHash !== manifest.manifestHash) {
    throw new Error("Hosted portable workspace manifest hash mismatch.");
  }
  return manifest;
}

function parseHostedPortableWorkspaceManifestFile(
  value: unknown,
): HostedPortableWorkspaceManifestFile {
  if (!value || typeof value !== "object") {
    throw new Error("Hosted portable workspace manifest file must be an object.");
  }
  const record = value as Record<string, unknown>;
  const root = requireManifestString(record.root, "root");
  const file: HostedPortableWorkspaceManifestFile = {
    path: requireManifestString(record.path, "path"),
    root,
    sha256: requireManifestString(record.sha256, "sha256"),
    size: requireManifestNumber(record.size, "size"),
  };
  if (record.artifact !== undefined) {
    const artifact = record.artifact;
    if (!artifact || typeof artifact !== "object") {
      throw new Error("Hosted portable workspace manifest artifact must be an object.");
    }
    const artifactRecord = artifact as Record<string, unknown>;
    file.artifact = {
      byteSize: requireManifestNumber(artifactRecord.byteSize, "artifact.byteSize"),
      sha256: requireManifestString(artifactRecord.sha256, "artifact.sha256"),
    };
  }
  return file;
}

function parseHostedPortableWorkspaceDeltaManifestJson(
  text: string,
): HostedPortableWorkspaceDeltaManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Hosted portable workspace delta manifest is invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Hosted portable workspace delta manifest must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== HOSTED_PORTABLE_WORKSPACE_DELTA_MANIFEST_SCHEMA) {
    throw new Error("Hosted portable workspace delta manifest schema is invalid.");
  }
  if (record.policyVersion !== HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION) {
    throw new Error("Hosted portable workspace delta manifest policyVersion is invalid.");
  }
  if (!Array.isArray(record.upserts)) {
    throw new Error("Hosted portable workspace delta manifest upserts must be an array.");
  }
  if (!Array.isArray(record.tombstones)) {
    throw new Error("Hosted portable workspace delta manifest tombstones must be an array.");
  }
  const body = {
    baseManifestHash: requireManifestString(record.baseManifestHash, "baseManifestHash"),
    baseSnapshotHash: requireManifestString(record.baseSnapshotHash, "baseSnapshotHash"),
    effectiveManifestHash: requireManifestString(record.effectiveManifestHash, "effectiveManifestHash"),
    tombstones: record.tombstones.map(parseHostedPortableWorkspaceDeltaTombstone)
      .sort(compareHostedPortableWorkspaceDeltaTombstones),
    upserts: record.upserts.map(parseHostedPortableWorkspaceManifestFile)
      .sort(compareHostedPortableWorkspaceManifestFiles),
  };
  const manifest = finalizeHostedPortableWorkspaceDeltaManifest(body);
  if (record.manifestHash !== manifest.manifestHash) {
    throw new Error("Hosted portable workspace delta manifest hash mismatch.");
  }
  return manifest;
}

function parseHostedPortableWorkspaceDeltaTombstone(
  value: unknown,
): HostedPortableWorkspaceDeltaTombstone {
  if (!value || typeof value !== "object") {
    throw new Error("Hosted portable workspace delta manifest tombstone must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    path: requireManifestString(record.path, "tombstone.path"),
    root: requireManifestString(record.root, "tombstone.root"),
  };
}

function finalizeHostedPortableWorkspaceManifest(
  files: HostedPortableWorkspaceManifestFile[],
): HostedPortableWorkspaceManifest {
  const manifestBody: Omit<HostedPortableWorkspaceManifest, "manifestHash"> = {
    files: files.map(canonicalizeHostedPortableWorkspaceManifestFile)
      .sort(compareHostedPortableWorkspaceManifestFiles),
    policyVersion: HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION,
    schema: HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA,
  };
  const manifestHash = createHash("sha256")
    .update(JSON.stringify(manifestBody))
    .digest("hex");
  return {
    ...manifestBody,
    manifestHash,
  };
}

function finalizeHostedPortableWorkspaceDeltaManifest(input: {
  baseManifestHash: string;
  baseSnapshotHash: string;
  effectiveManifestHash: string;
  tombstones: HostedPortableWorkspaceDeltaTombstone[];
  upserts: HostedPortableWorkspaceManifestFile[];
}): HostedPortableWorkspaceDeltaManifest {
  const manifestBody: Omit<HostedPortableWorkspaceDeltaManifest, "manifestHash"> = {
    baseManifestHash: input.baseManifestHash,
    baseSnapshotHash: input.baseSnapshotHash,
    effectiveManifestHash: input.effectiveManifestHash,
    policyVersion: HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION,
    schema: HOSTED_PORTABLE_WORKSPACE_DELTA_MANIFEST_SCHEMA,
    tombstones: [...input.tombstones].sort(compareHostedPortableWorkspaceDeltaTombstones),
    upserts: input.upserts.map(canonicalizeHostedPortableWorkspaceManifestFile)
      .sort(compareHostedPortableWorkspaceManifestFiles),
  };
  const manifestHash = createHash("sha256")
    .update(JSON.stringify(manifestBody))
    .digest("hex");
  return {
    ...manifestBody,
    manifestHash,
  };
}

function canonicalizeHostedPortableWorkspaceManifestFile(
  file: HostedPortableWorkspaceManifestFile,
): HostedPortableWorkspaceManifestFile {
  return {
    ...(file.artifact
      ? {
          artifact: {
            byteSize: file.artifact.byteSize,
            sha256: file.artifact.sha256,
          },
        }
      : {}),
    path: file.path,
    root: file.root,
    sha256: file.sha256,
    size: file.size,
  };
}

function compareHostedPortableWorkspaceManifestFiles(
  left: HostedPortableWorkspaceManifestFile,
  right: HostedPortableWorkspaceManifestFile,
): number {
  return `${left.root}:${left.path}`.localeCompare(`${right.root}:${right.path}`);
}

function compareHostedPortableWorkspaceDeltaTombstones(
  left: HostedPortableWorkspaceDeltaTombstone,
  right: HostedPortableWorkspaceDeltaTombstone,
): number {
  return `${left.root}:${left.path}`.localeCompare(`${right.root}:${right.path}`);
}

function hostedPortableWorkspaceManifestFileKey(
  file: Pick<HostedPortableWorkspaceManifestFile, "path" | "root">,
): string {
  return `${file.root}:${file.path}`;
}

function hostedPortableWorkspaceArchiveFileKey(
  file: Pick<HostedBundleArchiveFile, "path" | "root">,
): string {
  return `${file.root}:${file.path}`;
}

function hostedPortableWorkspaceManifestFilesEqual(
  left: HostedPortableWorkspaceManifestFile,
  right: HostedPortableWorkspaceManifestFile,
): boolean {
  return left.root === right.root
    && left.path === right.path
    && left.sha256 === right.sha256
    && left.size === right.size
    && hostedPortableWorkspaceArtifactRefsEqual(left.artifact ?? null, right.artifact ?? null);
}

function hostedPortableWorkspaceArtifactRefsEqual(
  left: HostedBundleArtifactRef | null,
  right: HostedBundleArtifactRef | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.sha256 === right.sha256 && left.byteSize === right.byteSize;
}

function requireManifestString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Hosted portable workspace manifest ${label} must be a non-empty string.`);
  }
  return value;
}

function requireManifestNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Hosted portable workspace manifest ${label} must be a non-negative integer.`);
  }
  return value;
}

export async function snapshotHostedAssistantRuntimeHotState(input: {
  assertSnapshotLive?: () => Promise<void> | void;
  codexHomeSnapshotHashSecret?: string | null;
  codexContinuityArtifactRefProvider?: (
    input: HostedBundleArtifactSnapshotInput,
  ) => HostedBundleArtifactRef | null | Promise<HostedBundleArtifactRef | null>;
  codexContinuityArtifactSink?: (
    input: HostedWorkspaceArtifactPersistInput,
  ) => Promise<void> | void;
  operatorHomeRoot?: string | null;
  prepareCodexContinuitySnapshot?: HostedCodexContinuitySnapshotPreparer | null;
  vaultRoot: string;
}): Promise<HostedAssistantRuntimeHotStateSnapshot> {
  for (let attempt = 1; attempt <= HOSTED_CODEX_CONTINUITY_SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await snapshotHostedAssistantRuntimeHotStateOnce(input);
    } catch (error) {
      if (
        attempt < HOSTED_CODEX_CONTINUITY_SNAPSHOT_MAX_ATTEMPTS
        && error instanceof HostedCodexContinuitySnapshotDriftError
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Hosted assistant runtime hot-state snapshot retry loop did not return.");
}

async function snapshotHostedAssistantRuntimeHotStateOnce(input: {
  assertSnapshotLive?: () => Promise<void> | void;
  codexHomeSnapshotHashSecret?: string | null;
  codexContinuityArtifactRefProvider?: (
    input: HostedBundleArtifactSnapshotInput,
  ) => HostedBundleArtifactRef | null | Promise<HostedBundleArtifactRef | null>;
  codexContinuityArtifactSink?: (
    input: HostedWorkspaceArtifactPersistInput,
  ) => Promise<void> | void;
  operatorHomeRoot?: string | null;
  prepareCodexContinuitySnapshot?: HostedCodexContinuitySnapshotPreparer | null;
  vaultRoot: string;
}): Promise<HostedAssistantRuntimeHotStateSnapshot> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const operatorHomeRoot = input.operatorHomeRoot ? path.resolve(input.operatorHomeRoot) : null;
  await ensureAssistantStateDirectory(assistantStateRoot);
  await assertHostedAssistantRuntimeHotStatePreBundleBudget({
    vaultRoot,
  });
  const workspaceSnapshotHashSecret =
    normalizeHostedCodexHomeSnapshotHashSecret(input.codexHomeSnapshotHashSecret);
  const preparedCodexContinuity = await prepareHostedCodexContinuitySnapshot({
    assistantStateRoot,
    prepareCodexContinuitySnapshot: input.prepareCodexContinuitySnapshot,
  });
  const hostedCodexContinuity = operatorHomeRoot
    ? await collectHostedCodexContinuity({
        assistantStateRoot,
        hashSecret: workspaceSnapshotHashSecret,
        operatorHomeRoot,
        preparedThreads: preparedCodexContinuity.preparedThreads,
      })
    : await collectMissingHostedCodexContinuity(assistantStateRoot);
  hostedCodexContinuity.flushFailed ||= preparedCodexContinuity.flushFailed;
  const codexHomeSnapshotDiagnostics = createHostedCodexContinuityDiagnostics({
    collection: hostedCodexContinuity,
    hashSecret: workspaceSnapshotHashSecret,
  });
  assertHostedCodexContinuityComplete(
    hostedCodexContinuity,
    codexHomeSnapshotDiagnostics,
  );
  const codexContinuityArtifactPaths = createHostedCodexContinuitySnapshotArtifactPathSet(
    hostedCodexContinuity,
  );

  await input.assertSnapshotLive?.();
  const bundle = await snapshotHostedBundleRoots({
    // Hot checkpoints are already bounded and the Cloudflare bridge checks the
    // active lease before snapshot and before publish. Keep live hot snapshots
    // from turning many tiny hot-state files into many runner lease RPCs.
    externalizeFile: async (artifact) => {
      if (!codexContinuityArtifactPaths.has(`${artifact.root}:${artifact.path}`)) {
        return null;
      }

      const existingRef = await input.codexContinuityArtifactRefProvider?.(artifact) ?? null;
      if (existingRef) {
        return existingRef;
      }

      if (!input.codexContinuityArtifactSink) {
        return null;
      }

      const ref = createHostedWorkspaceArtifactRef(artifact.bytes);
      await input.codexContinuityArtifactSink({
        ...artifact,
        ref,
      });
      return ref;
    },
    kind: "vault",
    roots: [
      {
        root: vaultRoot,
        rootKey: "vault",
        shouldIncludeRelativePath(relativePath) {
          return shouldIncludeHostedAssistantRuntimeHotStateRelativePath(relativePath);
        },
      },
      ...(operatorHomeRoot
        ? [
            {
              explicitFiles: createHostedCodexContinuitySnapshotExplicitFiles(
                hostedCodexContinuity,
              ),
              optional: true,
              root: operatorHomeRoot,
              rootKey: WORKSPACE_OPERATOR_HOME_ROOT,
              shouldIncludeRelativePath(relativePath: string) {
                return shouldIncludeHostedOperatorHomeRelativePath(relativePath);
              },
            },
          ]
        : []),
    ],
  });

  if (bundle === null) {
    throw new Error("Hosted assistant runtime hot-state bundle could not be created.");
  }
  const bundleWithCodexContinuityManifest =
    hostedCodexContinuity.entries.length > 0
      ? writeHostedBundleTextFile({
          bytes: bundle,
          kind: "vault",
          path: HOSTED_CODEX_CONTINUITY_MANIFEST_RELATIVE_PATH,
          root: WORKSPACE_OPERATOR_HOME_ROOT,
          text: JSON.stringify(
            createHostedCodexContinuityManifestFromBundle({
              bytes: bundle,
              codexHomeSnapshotDiagnostics,
              entries: hostedCodexContinuity.entries,
            }),
          ) + "\n",
        })
      : bundle;

  const metrics = measureHostedAssistantRuntimeHotStateBundle(bundleWithCodexContinuityManifest);
  assertHostedAssistantRuntimeHotStateBudget({
    ...metrics,
    bundleBytes: bundleWithCodexContinuityManifest.byteLength,
  });
  return {
    bundle: bundleWithCodexContinuityManifest,
    bundleBytes: bundleWithCodexContinuityManifest.byteLength,
    codexHomeSnapshotDiagnostics,
    fileCount: metrics.fileCount,
    inlineBytes: metrics.inlineBytes,
  };
}

export async function clearHostedAssistantRuntimeHotState(input: {
  operatorHomeRoot?: string | null;
  vaultRoot: string;
}): Promise<void> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const operatorHomeRoot = input.operatorHomeRoot ? path.resolve(input.operatorHomeRoot) : null;
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;

  await Promise.all([
    ...HOSTED_ASSISTANT_RUNTIME_HOT_STATE_INCLUDE_PATHS.map((relativePath) =>
      rm(path.join(vaultRoot, relativePath), {
        force: true,
        recursive: true,
      })
    ),
    ...(operatorHomeRoot
      ? [
          rm(path.join(operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH), {
            force: true,
            recursive: true,
          }),
        ]
      : []),
  ]);
  await ensureAssistantStateDirectory(assistantStateRoot);
}

export function hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity(input: {
  bundle?: Uint8Array | ArrayBuffer | null;
}): boolean {
  if (!input.bundle) {
    return false;
  }

  return analyzeHostedWorkspaceSnapshotProviderContinuity({
    bundle: input.bundle,
  }).hasCodexProviderContinuity;
}

export async function restoredWorkspaceRequiresHostedCodexProviderContinuity(input: {
  vaultRoot: string;
}): Promise<boolean> {
  const assistantStateRoot = resolveAssistantStatePaths(path.resolve(input.vaultRoot))
    .assistantStateRoot;
  const requirements = await readAssistantSessionProviderResumeRequirements(
    assistantStateRoot,
  );
  return requirements.length > 0;
}

export function assertHostedWorkspaceSnapshotProviderContinuityComplete(input: {
  bundle: Uint8Array | ArrayBuffer;
  createError?: (reason: "codex_home_missing") => Error;
}): void {
  const analysis = analyzeHostedWorkspaceSnapshotProviderContinuity(input);
  if (analysis.hasProviderResumeState && !analysis.hasCodexProviderContinuity) {
    throw input.createError?.("codex_home_missing")
      ?? new HostedWorkspaceSnapshotContinuityIncompleteError("codex_home_missing");
  }
}

export function analyzeHostedWorkspaceSnapshotProviderContinuity(input: {
  bundle: Uint8Array | ArrayBuffer;
}): HostedWorkspaceSnapshotProviderContinuityAnalysis {
  const archive = parseHostedBundleArchive(input.bundle);
  if (archive.kind !== "vault") {
    throw new Error(
      `Hosted bundle kind mismatch: expected vault, got ${archive.kind}.`,
    );
  }

  let hasProviderResumeState = false;
  let hasCodexProviderContinuity = false;
  let hasCodexContinuityManifest = false;
  const requiredCodexContinuityPaths = new Set<string>();
  const bundledCodexContinuityPaths = new Set<string>();
  for (const file of archive.files) {
    const normalizedPath = normalizeWorkspaceSnapshotRelativePath(file.path);
    if (
      file.root === WORKSPACE_OPERATOR_HOME_ROOT
      && isHostedCodexResumeContinuitySnapshotRelativePath(normalizedPath)
    ) {
      if (normalizedPath === HOSTED_CODEX_CONTINUITY_MANIFEST_RELATIVE_PATH) {
        hasCodexContinuityManifest = true;
      }
      if (hasWorkspaceSnapshotPathPrefix(normalizedPath, HOSTED_CODEX_HOME_RELATIVE_PATH)) {
        bundledCodexContinuityPaths.add(normalizedPath);
      }
    }

    if (
      file.root === "vault"
      && !isHostedBundleArtifactEntry(file)
      && hasWorkspaceSnapshotPathPrefix(
        normalizedPath,
        `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/sessions`,
      )
    ) {
      const text = Buffer.from(file.contentsBase64, "base64").toString("utf8");
      for (const requirement of readAssistantSessionProviderResumeRequirementsFromText(text)) {
        hasProviderResumeState = true;
        if (requirement.codexRolloutRelativePath) {
          requiredCodexContinuityPaths.add(
            `${HOSTED_CODEX_HOME_RELATIVE_PATH}/${normalizeWorkspaceSnapshotRelativePath(
              requirement.codexRolloutRelativePath,
            )}`,
          );
        }
      }
    }
  }
  hasCodexProviderContinuity =
    hasCodexContinuityManifest
    && requiredCodexContinuityPaths.size > 0
    && [...requiredCodexContinuityPaths].every((requiredPath) =>
      bundledCodexContinuityPaths.has(requiredPath),
    );

  return {
    hasCodexProviderContinuity,
    hasProviderResumeState,
  };
}

export async function restoreHostedExecutionContext(input: {
  artifactResolver?: HostedWorkspaceArtifactResolver;
  bundle?: Uint8Array | ArrayBuffer | null;
  shouldRestoreArtifact?: HostedBundleArtifactRestoreFilter;
  workspaceRoot: string;
}): Promise<{
  assistantStateRoot: string;
  operatorHomeRoot: string;
  vaultRoot: string;
}> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const vaultRoot = path.join(workspaceRoot, "vault");
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const operatorHomeRoot = path.join(workspaceRoot, "home");

  await mkdir(vaultRoot, { recursive: true });
  await ensureAssistantStateDirectory(assistantStateRoot);
  await mkdir(operatorHomeRoot, { recursive: true });

  if (input.bundle) {
    await clearHostedCodexContinuityRestoreRoot(operatorHomeRoot);
    try {
      await restoreHostedBundleRoots({
        artifactResolver: input.artifactResolver,
        bytes: input.bundle,
        expectedKind: "vault",
        roots: {
          [WORKSPACE_OPERATOR_HOME_ROOT]: operatorHomeRoot,
          vault: vaultRoot,
        },
        shouldRestoreArtifact: input.shouldRestoreArtifact,
      });
      await verifyRestoredHostedCodexContinuityManifest(operatorHomeRoot, {
        assistantStateRoot,
      });
    } catch (error) {
      await clearHostedCodexContinuityRestoreRoot(operatorHomeRoot);
      throw error;
    }
  }

  return {
    assistantStateRoot,
    operatorHomeRoot,
    vaultRoot,
  };
}

export async function restoreHostedWorkspaceWorkingDelta(input: {
  artifactResolver?: HostedWorkspaceArtifactResolver;
  baseManifest: HostedPortableWorkspaceManifest;
  baseSnapshotHash: string;
  bundle: Uint8Array | ArrayBuffer;
  roots: {
    [WORKSPACE_OPERATOR_HOME_ROOT]?: string;
    vault: string;
  };
  shouldRestoreArtifact?: HostedBundleArtifactRestoreFilter;
}): Promise<HostedPortableWorkspaceDeltaManifest> {
  const manifest = readHostedPortableWorkspaceDeltaManifestFromBundle(input.bundle);
  if (!manifest) {
    throw new Error("Hosted workspace working delta manifest is missing.");
  }
  if (manifest.baseSnapshotHash !== input.baseSnapshotHash) {
    throw new Error("Hosted workspace working delta base snapshot hash mismatch.");
  }
  if (manifest.baseManifestHash !== input.baseManifest.manifestHash) {
    throw new Error("Hosted workspace working delta base manifest hash mismatch.");
  }
  verifyHostedWorkspaceWorkingDeltaEffectiveManifest({
    baseManifest: input.baseManifest,
    manifest,
  });

  for (const tombstone of manifest.tombstones) {
    const root = input.roots[tombstone.root as keyof typeof input.roots];
    if (!root) {
      throw new Error(`Hosted workspace working delta tombstone root "${tombstone.root}" is not mapped.`);
    }
    const absolutePath = resolveHostedBundleRestorePath(root, tombstone.path);
    await assertHostedWorkspaceWorkingDeltaTombstonePathHasNoSymlinks({
      absolutePath,
      path: tombstone.path,
      root,
    });
    await rm(absolutePath, {
      force: true,
      recursive: true,
    });
  }

  const restoreRoots: Record<string, string> = {
    vault: input.roots.vault,
  };
  if (input.roots[WORKSPACE_OPERATOR_HOME_ROOT]) {
    restoreRoots[WORKSPACE_OPERATOR_HOME_ROOT] = input.roots[WORKSPACE_OPERATOR_HOME_ROOT];
  }

  await restoreHostedBundleRoots({
    artifactResolver: input.artifactResolver,
    bytes: input.bundle,
    expectedKind: "vault",
    roots: restoreRoots,
    shouldRestoreArtifact: input.shouldRestoreArtifact,
  });
  await verifyHostedWorkspaceWorkingDeltaUpserts({
    manifest,
    roots: input.roots,
  });
  return manifest;
}

export async function verifyRestoredHostedCodexContinuityManifest(
  operatorHomeRoot: string,
  options?: {
    allowUnmanifestedCodexHomeFiles?: boolean;
    assistantStateRoot?: string;
    requireManifest?: boolean;
  },
): Promise<void> {
  const requiredContinuity = options?.assistantStateRoot
    ? await readAssistantSessionProviderResumeRequirements(options.assistantStateRoot)
    : [];
  const requireManifest =
    options?.requireManifest === true || requiredContinuity.length > 0;

  let rawManifest: string;
  try {
    rawManifest = await readFile(
      path.join(operatorHomeRoot, HOSTED_CODEX_CONTINUITY_MANIFEST_RELATIVE_PATH),
      "utf8",
    );
  } catch (error) {
    if (isMissingPathError(error)) {
      if (requireManifest) {
        throw new Error("Hosted Codex continuity manifest is missing after restore.");
      }
      await removeHostedCodexHomeFiles(operatorHomeRoot);
      return;
    }
    throw error;
  }

  const manifest = parseHostedCodexContinuityManifest(rawManifest);
  const allowedRolloutRelativePaths = new Set<string>();
  const manifestThreadKeys = new Set<string>();
  const codexHomeRoot = path.join(operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH);
  for (const thread of manifest.threads) {
    const normalizedPath = normalizeHostedCodexRolloutRelativePathForProvider({
      providerSessionId: thread.providerSessionId,
      value: thread.codexRolloutRelativePath,
    });
    if (normalizedPath.reason !== null) {
      throw new Error("Hosted Codex continuity manifest contains an invalid rollout path.");
    }
    allowedRolloutRelativePaths.add(normalizedPath.relativePath);
    manifestThreadKeys.add(createHostedCodexContinuityThreadKey({
      providerSessionId: thread.providerSessionId,
      rolloutRelativePath: normalizedPath.relativePath,
    }));

    const rolloutFile = await inspectHostedCodexRolloutFile({
      codexHomeRoot,
      relativePath: normalizedPath.relativePath,
    });
    if (!rolloutFile) {
      throw new Error("Hosted Codex continuity rollout was not restored as a regular file.");
    }
    if (rolloutFile.stats.size !== thread.rolloutBlob.byteSize) {
      throw new Error("Hosted Codex continuity rollout byte size mismatch after restore.");
    }
    const sha256 = await sha256FileHex(rolloutFile.absolutePath);
    if (sha256 !== thread.rolloutBlob.sha256) {
      throw new Error("Hosted Codex continuity rollout SHA-256 mismatch after restore.");
    }
  }
  assertHostedCodexContinuityManifestCoversAssistantSessions({
    manifestThreadKeys,
    requirements: requiredContinuity,
  });
  if (options?.allowUnmanifestedCodexHomeFiles !== true) {
    await assertNoUnmanifestedHostedCodexHomeFiles({
      allowedRolloutRelativePaths,
      operatorHomeRoot,
    });
  }
}

async function verifyHostedWorkspaceWorkingDeltaUpserts(input: {
  manifest: HostedPortableWorkspaceDeltaManifest;
  roots: {
    [WORKSPACE_OPERATOR_HOME_ROOT]?: string;
    vault: string;
  };
}): Promise<void> {
  for (const upsert of input.manifest.upserts) {
    if (upsert.artifact) {
      continue;
    }
    const root = input.roots[upsert.root as keyof typeof input.roots];
    if (!root) {
      throw new Error(`Hosted workspace working delta upsert root "${upsert.root}" is not mapped.`);
    }
    const bytes = await readFile(resolveHostedBundleRestorePath(root, upsert.path));
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== upsert.sha256 || bytes.byteLength !== upsert.size) {
      throw new Error("Hosted workspace working delta upsert verification failed.");
    }
  }
}

function verifyHostedWorkspaceWorkingDeltaEffectiveManifest(input: {
  baseManifest: HostedPortableWorkspaceManifest;
  manifest: HostedPortableWorkspaceDeltaManifest;
}): void {
  const effectiveFiles = new Map(input.baseManifest.files.map((file) => [
    hostedPortableWorkspaceManifestFileKey(file),
    file,
  ]));
  for (const tombstone of input.manifest.tombstones) {
    effectiveFiles.delete(hostedPortableWorkspaceManifestFileKey(tombstone));
  }
  for (const upsert of input.manifest.upserts) {
    effectiveFiles.set(hostedPortableWorkspaceManifestFileKey(upsert), upsert);
  }

  const effectiveManifest = finalizeHostedPortableWorkspaceManifest([...effectiveFiles.values()]);
  if (effectiveManifest.manifestHash !== input.manifest.effectiveManifestHash) {
    throw new Error("Hosted workspace working delta effective manifest hash mismatch.");
  }
}

async function assertHostedWorkspaceWorkingDeltaTombstonePathHasNoSymlinks(input: {
  absolutePath: string;
  path: string;
  root: string;
}): Promise<void> {
  const root = path.resolve(input.root);
  let currentPath = root;
  const segments = normalizeWorkspaceSnapshotRelativePath(input.path)
    .split(path.posix.sep)
    .filter(Boolean);

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    let entry;
    try {
      entry = await lstat(currentPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Hosted workspace working delta tombstone path must not contain symlinks: ${input.path}`);
    }
    if (currentPath === input.absolutePath) {
      return;
    }
  }
}

function assertHostedCodexContinuityManifestCoversAssistantSessions(input: {
  manifestThreadKeys: ReadonlySet<string>;
  requirements: ReadonlyArray<{
    codexRolloutRelativePath: string | null;
    providerSessionId: string;
  }>;
}): void {
  for (const requirement of input.requirements) {
    const normalizedPath = normalizeHostedCodexRolloutRelativePathForProvider({
      providerSessionId: requirement.providerSessionId,
      value: requirement.codexRolloutRelativePath,
    });
    if (normalizedPath.reason !== null) {
      throw new Error(
        "Hosted Codex continuity manifest is missing restored session rollout state.",
      );
    }

    if (!input.manifestThreadKeys.has(createHostedCodexContinuityThreadKey({
      providerSessionId: requirement.providerSessionId,
      rolloutRelativePath: normalizedPath.relativePath,
    }))) {
      throw new Error(
        "Hosted Codex continuity manifest is missing a restored session rollout.",
      );
    }
  }
}

function createHostedCodexContinuityThreadKey(input: {
  providerSessionId: string;
  rolloutRelativePath: string;
}): string {
  return `${input.providerSessionId}:${input.rolloutRelativePath}`;
}

export async function clearHostedCodexContinuityRestoreRoot(
  operatorHomeRoot: string,
): Promise<void> {
  await removeHostedCodexHomeFiles(operatorHomeRoot);
}

async function removeHostedCodexHomeFiles(operatorHomeRoot: string): Promise<void> {
  await Promise.all([
    rm(path.join(operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH), {
      force: true,
      recursive: true,
    }),
    rm(path.join(operatorHomeRoot, HOSTED_CODEX_CONTINUITY_MANIFEST_RELATIVE_PATH), {
      force: true,
    }),
  ]);
}

async function assertNoUnmanifestedHostedCodexHomeFiles(input: {
  allowedRolloutRelativePaths: ReadonlySet<string>;
  operatorHomeRoot: string;
}): Promise<void> {
  const codexHomeRoot = path.join(input.operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH);

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

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      const relativePath = normalizeWorkspaceSnapshotRelativePath(
        path.relative(codexHomeRoot, absolutePath).split(path.sep).join("/"),
      );
      if (!input.allowedRolloutRelativePaths.has(relativePath)) {
        throw new Error(
          "Hosted Codex continuity restore included an unmanifested Codex home file.",
        );
      }
    }
  }

  await visit(codexHomeRoot);
}

export async function materializeHostedExecutionArtifacts(input: {
  artifactResolver: HostedWorkspaceArtifactResolver;
  bundle?: Uint8Array | ArrayBuffer | null;
  shouldRestoreArtifact?: HostedBundleArtifactRestoreFilter;
  workspaceRoot: string;
}): Promise<void> {
  if (!input.bundle) {
    return;
  }

  const workspaceRoot = path.resolve(input.workspaceRoot);
  const vaultRoot = path.join(workspaceRoot, "vault");
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const operatorHomeRoot = path.join(workspaceRoot, "home");

  await mkdir(vaultRoot, { recursive: true });
  await ensureAssistantStateDirectory(assistantStateRoot);
  await mkdir(operatorHomeRoot, { recursive: true });

  await materializeHostedBundleArtifacts({
    artifactResolver: input.artifactResolver,
    bytes: input.bundle,
    expectedKind: "vault",
    roots: {
      [WORKSPACE_OPERATOR_HOME_ROOT]: operatorHomeRoot,
      vault: vaultRoot,
    },
    shouldRestoreArtifact: input.shouldRestoreArtifact,
  });
}

async function assertHostedAssistantRuntimeHotStatePreBundleBudget(input: {
  vaultRoot: string;
}): Promise<void> {
  const metrics = await collectHostedAssistantRuntimeHotStateBudgetMetrics({
    shouldIncludeRelativePath: shouldIncludeHostedAssistantRuntimeHotStateRelativePath,
    root: input.vaultRoot,
  });
  assertHostedAssistantRuntimeHotStateBudget({
    bundleBytes: metrics.minimumBundleBytes,
    fileCount: metrics.fileCount,
    inlineBytes: metrics.inlineBytes,
  });
}

async function collectHostedAssistantRuntimeHotStateBudgetMetrics(input: {
  optional?: boolean;
  relativeDirectory?: string;
  root: string;
  shouldIncludeRelativePath: (relativePath: string) => boolean;
}): Promise<HostedAssistantRuntimeHotStateBudgetMetrics> {
  const relativeDirectory = input.relativeDirectory ?? "";
  const directoryPath = relativeDirectory ? path.join(input.root, relativeDirectory) : input.root;
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (input.optional) {
      return {
        fileCount: 0,
        inlineBytes: 0,
        minimumBundleBytes: 0,
      };
    }
    throw error;
  }
  const metrics: HostedAssistantRuntimeHotStateBudgetMetrics = {
    fileCount: 0,
    inlineBytes: 0,
    minimumBundleBytes: 0,
  };

  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name)
      : entry.name;

    if (!input.shouldIncludeRelativePath(relativePath)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const childMetrics = await collectHostedAssistantRuntimeHotStateBudgetMetrics({
        optional: input.optional,
        relativeDirectory: path.join(relativeDirectory, entry.name),
        root: input.root,
        shouldIncludeRelativePath: input.shouldIncludeRelativePath,
      });
      metrics.fileCount += childMetrics.fileCount;
      metrics.inlineBytes += childMetrics.inlineBytes;
      metrics.minimumBundleBytes += childMetrics.minimumBundleBytes;
      assertHostedAssistantRuntimeHotStateBudget({
        bundleBytes: metrics.minimumBundleBytes,
        fileCount: metrics.fileCount,
        inlineBytes: metrics.inlineBytes,
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stat = await lstat(absolutePath);
    metrics.fileCount += 1;
    metrics.inlineBytes += stat.size;
    metrics.minimumBundleBytes += Math.ceil(stat.size / 3) * 4;
    assertHostedAssistantRuntimeHotStateBudget({
      bundleBytes: metrics.minimumBundleBytes,
      fileCount: metrics.fileCount,
      inlineBytes: metrics.inlineBytes,
    });
  }

  return metrics;
}

function shouldIncludeWorkspaceSnapshotVaultRelativePath(relativePath: string): boolean {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);

  if (isVaultRuntimeRelativePath(normalizedRelativePath)) {
    return shouldIncludeWorkspaceSnapshotRuntimeRelativePath(normalizedRelativePath);
  }

  const localStateDescriptor = describeVaultLocalStateRelativePath(normalizedRelativePath);
  return (
    !isDotGitRelativePath(normalizedRelativePath)
    && !isEnvironmentRelativePath(normalizedRelativePath)
    && !isExportPackRelativePath(normalizedRelativePath)
    && (
      localStateDescriptor === null
      || localStateDescriptor.portability === "portable"
    )
  );
}

function shouldIncludeHostedAssistantRuntimeHotStateRelativePath(relativePath: string): boolean {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);

  if (
    HOSTED_ASSISTANT_RUNTIME_HOT_STATE_EXCLUDED_PATHS.some((excludedPath) =>
      hasWorkspaceSnapshotPathPrefix(normalizedRelativePath, excludedPath),
    )
  ) {
    return false;
  }

  if (
    isAssistantRuntimeRelativePath(normalizedRelativePath)
    && isHostedAssistantRuntimeSnapshotExcludedRelativePath(normalizedRelativePath)
  ) {
    return false;
  }

  return HOSTED_ASSISTANT_RUNTIME_HOT_STATE_INCLUDE_PATHS.some((includedPath) =>
    normalizedRelativePath === includedPath
    || normalizedRelativePath.startsWith(`${includedPath}${path.posix.sep}`)
    || includedPath.startsWith(`${normalizedRelativePath}${path.posix.sep}`)
  );
}

function measureHostedAssistantRuntimeHotStateBundle(bundle: Uint8Array): {
  fileCount: number;
  inlineBytes: number;
} {
  const archive = parseHostedBundleArchive(bundle);
  let inlineBytes = 0;

  for (const file of archive.files) {
    if (!isHostedBundleArtifactEntry(file)) {
      inlineBytes += Buffer.from(file.contentsBase64, "base64").byteLength;
    }
  }

  return {
    fileCount: archive.files.length,
    inlineBytes,
  };
}

interface HostedWorkspaceSnapshotClassMetrics {
  externalBytes: number;
  externalCount: number;
  fileCount: number;
  inlineBytes: number;
}

interface HostedWorkspaceSnapshotLargestFileMetric {
  bytes: number;
  className: string;
  depth: number;
  externalized: boolean;
  extension: string;
  relHash: string | null;
  root: string;
}

function createHostedWorkspaceSnapshotSizeDiagnosticsCollector(input: {
  hashSecret: string | null;
}): {
  finish(): HostedWorkspaceSnapshotSizeDiagnostics;
  record(input: {
    artifact: HostedBundleArtifactSnapshotInput;
    externalized: boolean;
  }): void;
} {
  const classMetrics = new Map<string, HostedWorkspaceSnapshotClassMetrics>();
  const largestFiles: HostedWorkspaceSnapshotLargestFileMetric[] = [];
  let externalArtifactBytes = 0;
  let externalArtifactCount = 0;
  let fileCount = 0;
  let inlineBytes = 0;
  let maxFileBytes = 0;
  let maxFileClass: string | null = null;

  return {
    finish() {
      return {
        workspaceSnapshotClassSummary:
          summarizeHostedWorkspaceSnapshotClasses(classMetrics),
        workspaceSnapshotExternalArtifactBytes: externalArtifactBytes,
        workspaceSnapshotExternalArtifactCount: externalArtifactCount,
        workspaceSnapshotFingerprintStatus: input.hashSecret ? "enabled" : "disabled",
        workspaceSnapshotIncludedFileCount: fileCount,
        workspaceSnapshotInlineBytes: inlineBytes,
        workspaceSnapshotLargestFiles:
          summarizeHostedWorkspaceSnapshotLargestFiles(largestFiles),
        workspaceSnapshotMaxFileBytes: maxFileBytes,
        workspaceSnapshotMaxFileClass: maxFileClass,
      };
    },
    record({ artifact, externalized }) {
      const bytes = artifact.bytes.byteLength;
      const className = classifyHostedWorkspaceSnapshotArtifact(artifact);
      const metrics = classMetrics.get(className) ?? {
        externalBytes: 0,
        externalCount: 0,
        fileCount: 0,
        inlineBytes: 0,
      };
      metrics.fileCount += 1;
      if (externalized) {
        metrics.externalBytes += bytes;
        metrics.externalCount += 1;
        externalArtifactBytes += bytes;
        externalArtifactCount += 1;
      } else {
        metrics.inlineBytes += bytes;
        inlineBytes += bytes;
      }
      classMetrics.set(className, metrics);

      fileCount += 1;
      if (bytes > maxFileBytes) {
        maxFileBytes = bytes;
        maxFileClass = className;
      }

      largestFiles.push({
        bytes,
        className,
        depth: hostedWorkspaceSnapshotPathDepth(artifact.path),
        externalized,
        extension: hostedWorkspaceSnapshotSafeExtension(artifact.path),
        relHash: input.hashSecret
          ? fingerprintHostedWorkspaceSnapshotRelativePath({
              hashSecret: input.hashSecret,
              relativePath: artifact.path,
              root: artifact.root,
            })
          : null,
        root: artifact.root,
      });
      largestFiles.sort((left, right) => right.bytes - left.bytes);
      largestFiles.splice(HOSTED_WORKSPACE_SNAPSHOT_DIAGNOSTIC_LIST_LIMIT);
    },
  };
}

function summarizeHostedWorkspaceSnapshotClasses(
  metrics: ReadonlyMap<string, HostedWorkspaceSnapshotClassMetrics>,
): string[] {
  return [...metrics.entries()]
    .sort(([leftClass, left], [rightClass, right]) => {
      const leftBytes = left.inlineBytes + left.externalBytes;
      const rightBytes = right.inlineBytes + right.externalBytes;
      return rightBytes - leftBytes || leftClass.localeCompare(rightClass);
    })
    .slice(0, HOSTED_WORKSPACE_SNAPSHOT_DIAGNOSTIC_LIST_LIMIT)
    .map(([className, entry]) =>
      [
        `class=${className}`,
        `files=${entry.fileCount}`,
        `inlineBytes=${entry.inlineBytes}`,
        `externalBytes=${entry.externalBytes}`,
        `externalCount=${entry.externalCount}`,
      ].join(","));
}

function summarizeHostedWorkspaceSnapshotLargestFiles(
  files: readonly HostedWorkspaceSnapshotLargestFileMetric[],
): string[] {
  return files
    .slice(0, HOSTED_WORKSPACE_SNAPSHOT_DIAGNOSTIC_LIST_LIMIT)
    .map((entry) =>
      [
        `class=${entry.className}`,
        `root=${entry.root}`,
        `bytes=${entry.bytes}`,
        `external=${entry.externalized ? 1 : 0}`,
        `ext=${entry.extension}`,
        `depth=${entry.depth}`,
        `relHash=${entry.relHash ?? "disabled"}`,
      ].join(","));
}

function classifyHostedWorkspaceSnapshotArtifact(
  artifact: HostedBundleArtifactSnapshotInput,
): string {
  const relativePath = normalizeWorkspaceSnapshotRelativePath(artifact.path);

  if (artifact.root === WORKSPACE_OPERATOR_HOME_ROOT) {
    if (hasWorkspaceSnapshotPathPrefix(relativePath, HOSTED_CODEX_HOME_RELATIVE_PATH)) {
      return "operator-codex-home";
    }

    return "operator-home-other";
  }

  if (artifact.root !== "vault") {
    return "unknown-root";
  }

  if (hasWorkspaceSnapshotPathPrefix(relativePath, ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH)) {
    return "runtime-assistant";
  }

  if (hasWorkspaceSnapshotPathPrefix(relativePath, RUNTIME_ROOT_RELATIVE_PATH)) {
    return "runtime-other";
  }

  const firstSegment = relativePath.split(path.posix.sep).filter(Boolean)[0] ?? "root";
  switch (firstSegment) {
    case "bank":
    case "derived":
    case "journal":
    case "ledger":
    case "raw":
      return firstSegment;
    default:
      return "vault-canonical";
  }
}

function hostedWorkspaceSnapshotPathDepth(relativePath: string): number {
  return normalizeWorkspaceSnapshotRelativePath(relativePath)
    .split(path.posix.sep)
    .filter(Boolean)
    .length;
}

function hostedWorkspaceSnapshotSafeExtension(relativePath: string): string {
  const extension = path.posix.extname(normalizeWorkspaceSnapshotRelativePath(relativePath))
    .toLowerCase();
  return extension && /^[.][a-z0-9]{1,12}$/u.test(extension) ? extension : "none";
}

function fingerprintHostedWorkspaceSnapshotRelativePath(input: {
  hashSecret: string;
  relativePath: string;
  root: string;
}): string {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(input.relativePath);
  const hash = createHmac("sha256", input.hashSecret)
    .update(`workspace_snapshot_rel:${input.root}:${normalizedRelativePath}`, "utf8")
    .digest("hex");
  return `h1_${hash.slice(0, 24)}`;
}

function assertHostedAssistantRuntimeHotStateBudget(input: {
  bundleBytes: number;
  fileCount: number;
  inlineBytes: number;
}): void {
  if (input.fileCount > HOSTED_HOT_STATE_MAX_FILES) {
    throw new HostedAssistantRuntimeHotStateBudgetExceededError(
      "files",
      HOSTED_HOT_STATE_MAX_FILES,
      input.fileCount,
    );
  }

  if (input.inlineBytes > HOSTED_HOT_STATE_MAX_INLINE_BYTES) {
    throw new HostedAssistantRuntimeHotStateBudgetExceededError(
      "inline_bytes",
      HOSTED_HOT_STATE_MAX_INLINE_BYTES,
      input.inlineBytes,
    );
  }

  if (input.bundleBytes > HOSTED_HOT_STATE_MAX_BUNDLE_BYTES) {
    throw new HostedAssistantRuntimeHotStateBudgetExceededError(
      "bundle_bytes",
      HOSTED_HOT_STATE_MAX_BUNDLE_BYTES,
      input.bundleBytes,
    );
  }
}

function isHostedCodexResumeContinuitySnapshotRelativePath(relativePath: string): boolean {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);
  return normalizedRelativePath === HOSTED_CODEX_CONTINUITY_MANIFEST_RELATIVE_PATH
    || (
      hasWorkspaceSnapshotPathPrefix(normalizedRelativePath, HOSTED_CODEX_HOME_RELATIVE_PATH)
      && isHostedCodexActiveRolloutSnapshotRelativePath(
        normalizedRelativePath === HOSTED_CODEX_HOME_RELATIVE_PATH
          ? ""
          : normalizedRelativePath.slice(`${HOSTED_CODEX_HOME_RELATIVE_PATH}${path.posix.sep}`.length),
      )
    );
}

function readAssistantSessionProviderResumeRequirementsFromText(text: string): Array<{
  codexRolloutRelativePath: string | null;
  providerSessionId: string | null;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [{
      codexRolloutRelativePath: null,
      providerSessionId: null,
    }];
  }

  const resumeState = recordProperty(parsed, "resumeState");
  const providerSessionId =
    recordStringProperty(resumeState, "providerSessionId")
    ?? recordStringProperty(parsed, "providerSessionId");
  if (!providerSessionId) {
    return [];
  }
  const targetAdapter = recordStringProperty(recordProperty(parsed, "target"), "adapter");
  if (targetAdapter && targetAdapter !== "codex-cli") {
    return [];
  }

  return [{
    codexRolloutRelativePath:
      recordStringProperty(resumeState, "codexRolloutRelativePath"),
    providerSessionId,
  }];
}

function recordProperty(value: unknown, propertyName: string): unknown {
  if (!isRecord(value)) {
    return null;
  }

  return value[propertyName];
}

function recordStringProperty(value: unknown, propertyName: string): string | null {
  const propertyValue = recordProperty(value, propertyName);
  return typeof propertyValue === "string" && propertyValue.trim().length > 0
    ? propertyValue
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT"
  );
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function readRedactedErrorMessage(error: unknown): string {
  return redactHostedDiagnosticMessage(readErrorMessage(error));
}

function redactHostedDiagnosticMessage(message: string): string {
  return message
    .replace(/\.codex-hosted(?:\/[^\s:'"]+)+/gu, ".codex-hosted/<REDACTED_PATH>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer <REDACTED>")
    .replace(/("(?:api[_-]?key|token|secret|password)"\s*:\s*")[^"]+(")/giu, "$1<REDACTED>$2")
    .replace(/(authorization\s*[:=]\s*)[^\s,'"{}]+/giu, "$1<REDACTED>")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,'"{}]+/giu, "$1<REDACTED>")
    .replace(/\/Users\/[^/\s:'"]+/gu, "<HOME_DIR>")
    .replace(/\/home\/[^/\s:'"]+/gu, "<HOME_DIR>")
    .replace(/[A-Za-z]:\\Users\\[^\\\s:'"]+/gu, "<HOME_DIR>")
    .slice(0, 1000);
}

function shouldIncludeWorkspaceSnapshotRuntimeRelativePath(relativePath: string): boolean {
  if (isHostedRuntimeSnapshotExcludedRelativePath(relativePath)) {
    return false;
  }

  if (isAssistantRuntimeRelativePath(relativePath)) {
    return !isHostedAssistantRuntimeSnapshotExcludedRelativePath(relativePath);
  }

  const localStateDescriptor = describeVaultLocalStateRelativePath(relativePath);
  return (
    isStrictAncestorPath(relativePath, ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH)
    || localStateDescriptor?.portability === "portable"
    || isPortableVaultOperationalContainerRelativePath(relativePath)
  );
}

function shouldPreserveWorkspaceSnapshotArtifact(input: {
  path: string;
  root: string;
}): boolean {
  if (input.root !== "vault") {
    return false;
  }

  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(input.path);
  return (
    shouldIncludeWorkspaceSnapshotVaultRelativePath(normalizedRelativePath)
    && normalizedRelativePath.startsWith(`raw${path.posix.sep}`)
  );
}

function isVaultRuntimeRelativePath(relativePath: string): boolean {
  return relativePath === RUNTIME_ROOT_RELATIVE_PATH
    || relativePath.startsWith(`${RUNTIME_ROOT_RELATIVE_PATH}${path.posix.sep}`);
}

function isAssistantRuntimeRelativePath(relativePath: string): boolean {
  return hasWorkspaceSnapshotPathPrefix(relativePath, ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH);
}

function isHostedRuntimeSnapshotExcludedRelativePath(relativePath: string): boolean {
  return (
    isEnvironmentRelativePath(relativePath)
    || hasWorkspaceSnapshotPathPrefix(relativePath, RUNTIME_CACHE_ROOT_RELATIVE_PATH)
    || hasWorkspaceSnapshotPathPrefix(relativePath, RUNTIME_TEMP_ROOT_RELATIVE_PATH)
    || hasWorkspaceSnapshotPathPrefix(relativePath, RUNTIME_PROJECTION_ROOT_RELATIVE_PATH)
  );
}

function isHostedAssistantRuntimeSnapshotExcludedRelativePath(relativePath: string): boolean {
  if (
    ASSISTANT_RUNTIME_EXCLUDED_PATH_PREFIXES.some((prefix) =>
      hasWorkspaceSnapshotPathPrefix(relativePath, prefix),
    )
  ) {
    return true;
  }

  const pathSegments = relativePath.split(path.posix.sep);
  if (
    pathSegments.some((segment) =>
      segment === "secrets"
      || segment === ".secrets"
      || segment === "quarantine"
      || segment === ".quarantine"
      || segment === ".locks"
    )
  ) {
    return true;
  }

  const basename = path.posix.basename(relativePath);
  return (
    basename === "tmp"
    || basename === ".tmp"
    || isHostedAssistantRuntimeLockTempBasename(basename)
    || basename.endsWith(".lock")
    || basename.endsWith(".pid")
    || basename.endsWith(".sock")
    || basename.endsWith(".socket")
    || basename.endsWith(".tmp")
    || basename.startsWith(".tmp-")
  );
}

function isHostedAssistantRuntimeLockTempBasename(basename: string): boolean {
  return /^\.(?:automation-run|runtime-write)\.lock\.(?:cleanup|pending|stale)\./u.test(basename);
}

function isDotGitRelativePath(relativePath: string): boolean {
  return relativePath === ".git" || relativePath.startsWith(`.git${path.posix.sep}`);
}

function isEnvironmentRelativePath(relativePath: string): boolean {
  return (
    path.posix.basename(relativePath) === ".env"
    || path.posix.basename(relativePath).startsWith(".env.")
  );
}

function isExportPackRelativePath(relativePath: string): boolean {
  return (
    relativePath === "exports/packs"
    || relativePath.startsWith(`exports/packs${path.posix.sep}`)
  );
}

function hasWorkspaceSnapshotPathPrefix(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}${path.posix.sep}`);
}

function isStrictAncestorPath(ancestorPath: string, targetPath: string): boolean {
  return ancestorPath !== targetPath && targetPath.startsWith(`${ancestorPath}${path.posix.sep}`);
}

function normalizeWorkspaceSnapshotRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+|\/+$/gu, "");
}

function normalizeWorkspaceSnapshotArtifactPathKey(relativePath: string): string | null {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);
  if (normalizedRelativePath.length === 0) {
    return null;
  }

  const delimitedPath = parseWorkspaceSnapshotArtifactPath(normalizedRelativePath);
  if (delimitedPath) {
    return `${delimitedPath.root}:${normalizeWorkspaceSnapshotRelativePath(delimitedPath.path)}`;
  }

  if (normalizedRelativePath.startsWith(`vault${path.posix.sep}`)) {
    return `vault:${normalizeWorkspaceSnapshotRelativePath(
      normalizedRelativePath.slice(`vault${path.posix.sep}`.length),
    )}`;
  }

  if (normalizedRelativePath.startsWith(`${WORKSPACE_OPERATOR_HOME_ROOT}${path.posix.sep}`)) {
    return `${WORKSPACE_OPERATOR_HOME_ROOT}:${normalizeWorkspaceSnapshotRelativePath(
      normalizedRelativePath.slice(`${WORKSPACE_OPERATOR_HOME_ROOT}${path.posix.sep}`.length),
    )}`;
  }

  return `vault:${normalizedRelativePath}`;
}

function parseWorkspaceSnapshotArtifactPath(relativePath: string): {
  path: string;
  root: string;
} | null {
  const delimiterIndex = relativePath.indexOf(":");
  if (delimiterIndex <= 0 || delimiterIndex >= relativePath.length - 1) {
    return null;
  }

  const root = relativePath.slice(0, delimiterIndex);
  if (!WORKSPACE_SNAPSHOT_ROOT_KEYS.has(root)) {
    return null;
  }

  return {
    path: relativePath.slice(delimiterIndex + 1),
    root,
  };
}

function shouldIncludeHostedOperatorHomeRelativePath(relativePath: string): boolean {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);

  return (
    normalizedRelativePath === ".murph"
    || normalizedRelativePath === ".murph/config.json"
  );
}

function createHostedCodexContinuitySnapshotExplicitFiles(
  collection: HostedCodexContinuityCollection,
): string[] {
  return [...new Set(collection.entries.map((entry) =>
    `${HOSTED_CODEX_HOME_RELATIVE_PATH}/${entry.codexRolloutRelativePath}`
  ))].sort((left, right) => left.localeCompare(right));
}

function createHostedCodexContinuitySnapshotArtifactPathSet(
  collection: HostedCodexContinuityCollection,
): Set<string> {
  return new Set(createHostedCodexContinuitySnapshotExplicitFiles(collection).map((relativePath) =>
    `${WORKSPACE_OPERATOR_HOME_ROOT}:${relativePath}`
  ));
}

function isHostedCodexActiveRolloutSnapshotRelativePath(relativePath: string): boolean {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);
  const match = HOSTED_CODEX_ROLLOUT_RELATIVE_PATH_PATTERN.exec(normalizedRelativePath);
  return Boolean(
    match
    && match[1] === match[4]
    && match[2] === match[5]
    && match[3] === match[6],
  );
}

function createEmptyHostedCodexContinuityCollection(): HostedCodexContinuityCollection {
  return {
    archivedUnsupportedCount: 0,
    entries: [],
    flushFailed: false,
    invalidPathCount: 0,
    missingRolloutCount: 0,
    requestedThreadCount: 0,
  };
}

async function collectMissingHostedCodexContinuity(
  assistantStateRoot: string,
): Promise<HostedCodexContinuityCollection> {
  const requirements = await readAssistantSessionProviderResumeRequirements(
    assistantStateRoot,
  );
  if (requirements.length === 0) {
    return createEmptyHostedCodexContinuityCollection();
  }

  return {
    archivedUnsupportedCount: 0,
    entries: [],
    flushFailed: false,
    invalidPathCount: 0,
    missingRolloutCount: requirements.length,
    requestedThreadCount: requirements.length,
  };
}

async function prepareHostedCodexContinuitySnapshot(input: {
  assistantStateRoot: string;
  prepareCodexContinuitySnapshot?: HostedCodexContinuitySnapshotPreparer | null;
}): Promise<{
  flushFailed: boolean;
  preparedThreads: ReadonlyMap<string, string>;
}> {
  if (!input.prepareCodexContinuitySnapshot) {
    return {
      flushFailed: false,
      preparedThreads: new Map(),
    };
  }

  const requirements = await readAssistantSessionProviderResumeRequirements(
    input.assistantStateRoot,
  );
  if (requirements.length === 0) {
    return {
      flushFailed: false,
      preparedThreads: new Map(),
    };
  }

  let preparedThreads: readonly HostedCodexContinuitySnapshotPreparedThread[];
  try {
    preparedThreads = await input.prepareCodexContinuitySnapshot();
  } catch (error) {
    throw new HostedWorkspaceSnapshotContinuityIncompleteError("codex_flush_failed", {
      codexHomeSnapshotDiagnostics: {
        codexResumeArchivedUnsupportedCount: 0,
        codexResumeFlushFailed: true,
        codexResumeInvalidPathCount: 0,
        codexResumeMissingRolloutCount: 0,
        codexResumeRolloutBytes: 0,
        codexResumeRolloutFileBytes: [],
        codexResumeRolloutRelHashes: [],
        codexResumeThreadCount: requirements.length,
      },
      message: `Hosted Codex continuity snapshot preparation failed: ${readRedactedErrorMessage(error)}`,
    });
  }

  return {
    flushFailed: false,
    preparedThreads: new Map(
      preparedThreads
        .map((thread) => [
          thread.providerSessionId,
          thread.codexRolloutRelativePath,
        ] as const),
    ),
  };
}

async function collectHostedCodexContinuity(input: {
  assistantStateRoot: string;
  hashSecret?: string | null;
  operatorHomeRoot: string;
  preparedThreads: ReadonlyMap<string, string>;
}): Promise<HostedCodexContinuityCollection> {
  const requirements = await readAssistantSessionProviderResumeRequirements(
    input.assistantStateRoot,
  );
  const codexHomeRoot = path.join(input.operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH);
  const entries: HostedCodexContinuityEntry[] = [];
  let archivedUnsupportedCount = 0;
  let invalidPathCount = 0;
  let missingRolloutCount = 0;

  for (const requirement of requirements) {
    const preparedRolloutRelativePath = input.preparedThreads.get(
      requirement.providerSessionId,
    ) ?? null;
    const normalizedPath = resolveHostedCodexContinuityRequirementPath({
      providerSessionId: requirement.providerSessionId,
      preparedRolloutRelativePath,
      sessionRolloutRelativePath: requirement.codexRolloutRelativePath,
    });
    if (normalizedPath.reason === "archived") {
      archivedUnsupportedCount += 1;
      continue;
    }
    if (normalizedPath.reason !== null) {
      invalidPathCount += 1;
      continue;
    }

    const rolloutFile = await inspectHostedCodexRolloutFile({
      codexHomeRoot,
      relativePath: normalizedPath.relativePath,
    });
    if (!rolloutFile) {
      missingRolloutCount += 1;
      continue;
    }

    entries.push({
      absolutePath: rolloutFile.absolutePath,
      byteSize: rolloutFile.stats.size,
      codexRolloutRelativePath: normalizedPath.relativePath,
      providerSessionId: requirement.providerSessionId,
      sha256: await sha256FileHex(rolloutFile.absolutePath),
    });
  }

  return {
    archivedUnsupportedCount,
    entries,
    flushFailed: false,
    invalidPathCount,
    missingRolloutCount,
    requestedThreadCount: requirements.length,
  };
}

function resolveHostedCodexContinuityRequirementPath(input: {
  providerSessionId: string;
  preparedRolloutRelativePath: string | null;
  sessionRolloutRelativePath: string | null;
}):
  | {
      reason: null;
      relativePath: string;
    }
  | {
      reason: "archived" | "invalid";
      relativePath?: never;
    } {
  const sessionPath = normalizeHostedCodexRolloutRelativePathForProvider({
    providerSessionId: input.providerSessionId,
    value: input.sessionRolloutRelativePath,
  });
  const preparedPath = normalizeHostedCodexRolloutRelativePathForProvider({
    providerSessionId: input.providerSessionId,
    value: input.preparedRolloutRelativePath,
  });

  if (input.sessionRolloutRelativePath && input.preparedRolloutRelativePath) {
    if (sessionPath.reason === "archived" || preparedPath.reason === "archived") {
      return { reason: "archived" };
    }
    if (
      sessionPath.reason !== null
      || preparedPath.reason !== null
      || sessionPath.relativePath !== preparedPath.relativePath
    ) {
      return { reason: "invalid" };
    }
    return sessionPath;
  }

  return input.sessionRolloutRelativePath ? sessionPath : preparedPath;
}

async function inspectHostedCodexRolloutFile(input: {
  codexHomeRoot: string;
  relativePath: string;
}): Promise<{
  absolutePath: string;
  stats: Stats;
} | null> {
  const segments = normalizeWorkspaceSnapshotRelativePath(input.relativePath)
    .split(path.posix.sep)
    .filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  let currentPath = input.codexHomeRoot;
  for (const [index, segment] of segments.entries()) {
    const nextPath = path.join(currentPath, segment);
    let entry: Stats;
    try {
      entry = await lstat(nextPath);
    } catch {
      return null;
    }

    if (entry.isSymbolicLink()) {
      return null;
    }
    if (index === segments.length - 1) {
      return entry.isFile()
        ? {
            absolutePath: nextPath,
            stats: entry,
          }
        : null;
    }
    if (!entry.isDirectory()) {
      return null;
    }

    currentPath = nextPath;
  }

  return null;
}

function createHostedCodexContinuityDiagnostics(input: {
  collection: HostedCodexContinuityCollection;
  hashSecret?: string | null;
}): HostedCodexHomeSnapshotDiagnostics | null {
  if (
    input.collection.requestedThreadCount === 0
    && input.collection.entries.length === 0
    && !input.collection.flushFailed
    && input.collection.missingRolloutCount === 0
    && input.collection.invalidPathCount === 0
    && input.collection.archivedUnsupportedCount === 0
  ) {
    return null;
  }

  const hashSecret = normalizeHostedCodexHomeSnapshotHashSecret(input.hashSecret);
  return {
    codexResumeArchivedUnsupportedCount: input.collection.archivedUnsupportedCount,
    codexResumeFlushFailed: input.collection.flushFailed,
    codexResumeInvalidPathCount: input.collection.invalidPathCount,
    codexResumeMissingRolloutCount: input.collection.missingRolloutCount,
    codexResumeRolloutBytes: input.collection.entries.reduce(
      (total, entry) => total + entry.byteSize,
      0,
    ),
    codexResumeRolloutFileBytes: input.collection.entries
      .slice(0, HOSTED_WORKSPACE_SNAPSHOT_DIAGNOSTIC_LIST_LIMIT)
      .map((entry) => entry.byteSize),
    codexResumeRolloutRelHashes: hashSecret
      ? input.collection.entries
          .slice(0, HOSTED_WORKSPACE_SNAPSHOT_DIAGNOSTIC_LIST_LIMIT)
          .map((entry) => fingerprintHostedCodexContinuityRelativePath({
            hashSecret,
            relativePath: entry.codexRolloutRelativePath,
          }))
      : [],
    codexResumeThreadCount: input.collection.requestedThreadCount,
  };
}

function assertHostedCodexContinuityComplete(
  collection: HostedCodexContinuityCollection,
  diagnostics: HostedCodexHomeSnapshotDiagnostics | null,
): void {
  if (
    collection.flushFailed
    || collection.archivedUnsupportedCount > 0
    || collection.invalidPathCount > 0
    || collection.missingRolloutCount > 0
    || collection.entries.length !== collection.requestedThreadCount
  ) {
    throw new HostedWorkspaceSnapshotContinuityIncompleteError(
      collection.flushFailed ? "codex_flush_failed" : "codex_home_missing",
      {
        codexHomeSnapshotDiagnostics: diagnostics,
        message: collection.flushFailed
          ? "Hosted Codex continuity snapshot preparation failed."
          : "Hosted Codex continuity snapshot is missing required rollout state.",
      },
    );
  }
}

function createHostedCodexContinuityManifest(entries: HostedCodexContinuityEntry[]): {
  schema: typeof HOSTED_CODEX_CONTINUITY_MANIFEST_SCHEMA;
  threads: Array<{
    codexRolloutRelativePath: string;
    providerSessionId: string;
    rolloutBlob: {
      byteSize: number;
      sha256: string;
      storage: "hosted-bundle.v1";
    };
  }>;
} {
  return {
    schema: HOSTED_CODEX_CONTINUITY_MANIFEST_SCHEMA,
    threads: entries
      .map((entry) => ({
        codexRolloutRelativePath: entry.codexRolloutRelativePath,
        providerSessionId: entry.providerSessionId,
        rolloutBlob: {
          byteSize: entry.byteSize,
          sha256: entry.sha256,
          storage: "hosted-bundle.v1" as const,
        },
      }))
      .sort((left, right) =>
        left.providerSessionId.localeCompare(right.providerSessionId)
        || left.codexRolloutRelativePath.localeCompare(right.codexRolloutRelativePath),
      ),
  };
}

function createHostedCodexContinuityManifestFromArchiveFiles(input: {
  codexHomeSnapshotDiagnostics?: HostedCodexHomeSnapshotDiagnostics | null;
  entries: HostedCodexContinuityEntry[];
  files: readonly HostedBundleArchiveFile[];
}): ReturnType<typeof createHostedCodexContinuityManifest> {
  const expectedThreadKeys = new Set(
    input.entries.map((entry) =>
      createHostedCodexContinuityThreadKey({
        providerSessionId: entry.providerSessionId,
        rolloutRelativePath: entry.codexRolloutRelativePath,
      })
    ),
  );
  const expectedEntriesByProviderSessionId = new Map<string, HostedCodexContinuityEntry>();
  for (const entry of input.entries) {
    const existing = expectedEntriesByProviderSessionId.get(entry.providerSessionId);
    if (!existing || existing.codexRolloutRelativePath === entry.codexRolloutRelativePath) {
      expectedEntriesByProviderSessionId.set(entry.providerSessionId, entry);
    }
  }
  const finalRequirements = readHostedCodexContinuityRequirementsFromBundleArchive({
    files: input.files,
  });
  const finalThreadKeys = new Set<string>();
  const finalEntries: HostedCodexContinuityEntry[] = [];

  for (const requirement of finalRequirements) {
    const expectedEntry = expectedEntriesByProviderSessionId.get(requirement.providerSessionId) ?? null;
    const normalizedPath = resolveHostedCodexContinuityRequirementPath({
      preparedRolloutRelativePath: expectedEntry?.codexRolloutRelativePath ?? null,
      providerSessionId: requirement.providerSessionId,
      sessionRolloutRelativePath: requirement.codexRolloutRelativePath,
    });
    if (normalizedPath.reason !== null) {
      throw new HostedCodexContinuitySnapshotDriftError(
        input.codexHomeSnapshotDiagnostics ?? null,
      );
    }
    const threadKey = createHostedCodexContinuityThreadKey({
      providerSessionId: requirement.providerSessionId,
      rolloutRelativePath: normalizedPath.relativePath,
    });
    finalThreadKeys.add(threadKey);
    if (!expectedThreadKeys.has(threadKey)) {
      throw new HostedCodexContinuitySnapshotDriftError(
        input.codexHomeSnapshotDiagnostics ?? null,
      );
    }

    const snapshotPath = `${HOSTED_CODEX_HOME_RELATIVE_PATH}/${normalizedPath.relativePath}`;
    const rolloutFile = input.files.find((file) =>
      file.root === WORKSPACE_OPERATOR_HOME_ROOT && file.path === snapshotPath
    );
    if (!rolloutFile) {
      throw new HostedCodexContinuitySnapshotDriftError(
        input.codexHomeSnapshotDiagnostics ?? null,
      );
    }

    if (isHostedBundleArtifactEntry(rolloutFile)) {
      finalEntries.push({
        absolutePath: snapshotPath,
        byteSize: rolloutFile.artifact.byteSize,
        codexRolloutRelativePath: normalizedPath.relativePath,
        providerSessionId: requirement.providerSessionId,
        sha256: rolloutFile.artifact.sha256,
      });
      continue;
    }

    const bytes = Buffer.from(rolloutFile.contentsBase64, "base64");
    finalEntries.push({
      absolutePath: snapshotPath,
      byteSize: bytes.byteLength,
      codexRolloutRelativePath: normalizedPath.relativePath,
      providerSessionId: requirement.providerSessionId,
      sha256: sha256BytesHex(bytes),
    });
  }

  if (
    finalThreadKeys.size !== expectedThreadKeys.size
    || [...expectedThreadKeys].some((threadKey) => !finalThreadKeys.has(threadKey))
  ) {
    throw new HostedCodexContinuitySnapshotDriftError(
      input.codexHomeSnapshotDiagnostics ?? null,
    );
  }

  return createHostedCodexContinuityManifest(finalEntries);
}

function createHostedCodexContinuityManifestFromBundle(input: {
  bytes: Uint8Array | ArrayBuffer;
  codexHomeSnapshotDiagnostics?: HostedCodexHomeSnapshotDiagnostics | null;
  entries: HostedCodexContinuityEntry[];
}): ReturnType<typeof createHostedCodexContinuityManifest> {
  const archive = parseHostedBundleArchive(input.bytes);
  if (archive.kind !== "vault") {
    throw new Error(
      `Hosted bundle kind mismatch: expected vault, got ${archive.kind}.`,
    );
  }

  return createHostedCodexContinuityManifestFromArchiveFiles({
    codexHomeSnapshotDiagnostics: input.codexHomeSnapshotDiagnostics,
    entries: input.entries,
    files: archive.files,
  });
}

function readHostedCodexContinuityRequirementsFromBundleArchive(input: {
  files: readonly HostedBundleArchiveFile[];
}): Array<{
  codexRolloutRelativePath: string | null;
  providerSessionId: string;
}> {
  const requirements: Array<{
    codexRolloutRelativePath: string | null;
    providerSessionId: string;
  }> = [];

  for (const file of input.files) {
    if (
      file.root !== "vault" ||
      isHostedBundleArtifactEntry(file) ||
      !hasWorkspaceSnapshotPathPrefix(
        normalizeWorkspaceSnapshotRelativePath(file.path),
        `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/sessions`,
      )
    ) {
      continue;
    }

    const text = Buffer.from(file.contentsBase64, "base64").toString("utf8");
    for (const requirement of readAssistantSessionProviderResumeRequirementsFromText(text)) {
      if (requirement.providerSessionId) {
        requirements.push({
          codexRolloutRelativePath: requirement.codexRolloutRelativePath,
          providerSessionId: requirement.providerSessionId,
        });
      }
    }
  }

  return requirements.sort((left, right) =>
    left.providerSessionId.localeCompare(right.providerSessionId)
    || (left.codexRolloutRelativePath ?? "").localeCompare(right.codexRolloutRelativePath ?? "")
  );
}

function parseHostedCodexContinuityManifest(rawManifest: string): {
  threads: Array<{
    codexRolloutRelativePath: string;
    providerSessionId: string;
    rolloutBlob: {
      byteSize: number;
      sha256: string;
      storage: "hosted-bundle.v1";
    };
  }>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    throw new Error("Hosted Codex continuity manifest is not valid JSON.");
  }

  if (
    !isRecord(parsed)
    || parsed.schema !== HOSTED_CODEX_CONTINUITY_MANIFEST_SCHEMA
    || !Array.isArray(parsed.threads)
  ) {
    throw new Error("Hosted Codex continuity manifest schema mismatch.");
  }

  return {
    threads: parsed.threads.map((thread) => {
      if (!isRecord(thread) || !isRecord(thread.rolloutBlob)) {
        throw new Error("Hosted Codex continuity manifest thread entry is invalid.");
      }
      const providerSessionId = recordStringProperty(thread, "providerSessionId");
      const codexRolloutRelativePath = recordStringProperty(
        thread,
        "codexRolloutRelativePath",
      );
      const byteSize = thread.rolloutBlob.byteSize;
      const sha256 = recordStringProperty(thread.rolloutBlob, "sha256");
      const storage = recordStringProperty(thread.rolloutBlob, "storage");
      if (
        !providerSessionId
        || !codexRolloutRelativePath
        || typeof byteSize !== "number"
        || !Number.isSafeInteger(byteSize)
        || byteSize < 0
        || !sha256
        || storage !== "hosted-bundle.v1"
      ) {
        throw new Error("Hosted Codex continuity manifest thread entry is invalid.");
      }
      return {
        codexRolloutRelativePath,
        providerSessionId,
        rolloutBlob: {
          byteSize,
          sha256,
          storage,
        },
      };
    }),
  };
}

async function readAssistantSessionProviderResumeRequirements(
  assistantStateRoot: string,
): Promise<Array<{
  codexRolloutRelativePath: string | null;
  providerSessionId: string;
}>> {
  const sessionsRoot = path.join(assistantStateRoot, "sessions");
  const requirements: Array<{
    codexRolloutRelativePath: string | null;
    providerSessionId: string;
  }> = [];
  let visitedFiles = 0;

  async function visit(directoryPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (visitedFiles > HOSTED_HOT_STATE_MAX_FILES) {
        return;
      }

      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      visitedFiles += 1;
      const text = await readFile(absolutePath, "utf8");
      for (const requirement of readAssistantSessionProviderResumeRequirementsFromText(text)) {
        if (requirement.providerSessionId) {
          requirements.push({
            codexRolloutRelativePath: requirement.codexRolloutRelativePath,
            providerSessionId: requirement.providerSessionId,
          });
        }
      }
    }
  }

  await visit(sessionsRoot);
  return requirements;
}

function normalizeHostedCodexRolloutRelativePathForProvider(input: {
  providerSessionId: string;
  value: string | null;
}):
  | {
      reason: null;
      relativePath: string;
    }
  | {
      reason: "archived" | "invalid";
      relativePath?: never;
} {
  const rawValue = input.value?.trim() ?? "";
  if (rawValue.length === 0 || rawValue.startsWith("/") || rawValue.includes("\\")) {
    return { reason: "invalid" };
  }
  const normalized = normalizeWorkspaceSnapshotRelativePath(rawValue);
  if (
    normalized === "archived_sessions"
    || normalized.startsWith(`archived_sessions${path.posix.sep}`)
  ) {
    return { reason: "archived" };
  }
  if (!isHostedCodexActiveRolloutSnapshotRelativePath(normalized)) {
    return { reason: "invalid" };
  }

  const segments = normalized.split(path.posix.sep);
  if (segments.some((segment) =>
    segment.length === 0 || segment === "." || segment === "..",
  )) {
    return { reason: "invalid" };
  }

  const match = HOSTED_CODEX_ROLLOUT_RELATIVE_PATH_PATTERN.exec(normalized);
  if (
    !match ||
    match[1] !== match[4] ||
    match[2] !== match[5] ||
    match[3] !== match[6] ||
    match[7] !== input.providerSessionId
  ) {
    return { reason: "invalid" };
  }

  return {
    reason: null,
    relativePath: normalized,
  };
}

async function sha256FileHex(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function sha256BytesHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fingerprintHostedCodexContinuityRelativePath(input: {
  hashSecret: string;
  relativePath: string;
}): string {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(input.relativePath);
  const hash = createHmac("sha256", input.hashSecret)
    .update(`codex_continuity_rel:${normalizedRelativePath}`, "utf8")
    .digest("hex");
  return `h1_${hash.slice(0, 24)}`;
}

function normalizeHostedCodexHomeSnapshotHashSecret(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function shouldExternalizeWorkspaceArtifact(input: HostedBundleArtifactSnapshotInput): boolean {
  if (input.root !== "vault" || !input.path.startsWith(`raw${path.posix.sep}`)) {
    return false;
  }

  if (isDefinitelyBinaryRawArtifact(input.path)) {
    return true;
  }

  if (input.bytes.byteLength < RAW_ARTIFACT_EXTERNALIZE_THRESHOLD_BYTES) {
    return false;
  }

  return !isLikelyTextBytes(input.bytes);
}

function isDefinitelyBinaryRawArtifact(relativePath: string): boolean {
  const extension = path.posix.extname(relativePath).toLowerCase();
  return BINARY_RAW_ARTIFACT_EXTENSIONS.has(extension);
}

function isLikelyTextBytes(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8 * 1024));

  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function createHostedWorkspaceArtifactRef(bytes: Uint8Array): HostedBundleArtifactRef {
  return {
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const BINARY_RAW_ARTIFACT_EXTENSIONS = new Set([
  ".aac",
  ".avi",
  ".bmp",
  ".doc",
  ".docx",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".opus",
  ".pdf",
  ".png",
  ".tif",
  ".tiff",
  ".wav",
  ".webm",
  ".webp",
]);

const ASSISTANT_RUNTIME_EXCLUDED_PATH_PREFIXES = [
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/secrets`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/quarantine`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/outbox/.quarantine`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/usage`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/.locks`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/.runtime-write.lock`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/.automation-run.lock`,
] as const;
