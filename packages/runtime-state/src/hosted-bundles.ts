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
  isHostedBundleArtifactEntry,
  parseHostedBundleArchive,
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

export type HostedWorkspaceArtifactResolver = (
  input: HostedBundleArtifactRestoreInput,
) => Promise<Uint8Array | ArrayBuffer>;

interface HostedExecutionContextSnapshotInput {
  artifactSink?: (input: HostedWorkspaceArtifactPersistInput) => Promise<void>;
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
  return await snapshotHostedExecutionContextWithProviderContinuityPolicy({
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
  return await snapshotHostedExecutionContextWithProviderContinuityPolicy({
    ...input,
    enforceProviderContinuity: false,
  });
}

async function snapshotHostedExecutionContextWithProviderContinuityPolicy(
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
  const vaultBundle = await snapshotHostedBundleRoots({
    externalizeFile: async (artifact) => {
      const shouldExternalize = Boolean(artifactSink)
        && shouldExternalizeWorkspaceArtifact(artifact);
      workspaceSnapshotSizeDiagnostics.record({
        artifact,
        externalized: shouldExternalize,
      });
      if (!artifactSink || !shouldExternalize) {
        return null;
      }

      const ref = createHostedWorkspaceArtifactRef(artifact.bytes);
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
  return {
    bundle: bundleWithCodexContinuityManifest,
    codexHomeSnapshotDiagnostics,
    workspaceSnapshotSizeDiagnostics: workspaceSnapshotSizeDiagnostics.finish(),
  };
}

export async function snapshotHostedAssistantRuntimeHotState(input: {
  codexHomeSnapshotHashSecret?: string | null;
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

  const bundle = await snapshotHostedBundleRoots({
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
          text: JSON.stringify(createHostedCodexContinuityManifestFromBundle({
            bytes: bundle,
            entries: hostedCodexContinuity.entries,
          })) + "\n",
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
    if (isHostedBundleArtifactEntry(file)) {
      throw new Error("Hosted assistant runtime hot-state snapshots must not externalize artifacts.");
    }
    inlineBytes += Buffer.from(file.contentsBase64, "base64").byteLength;
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

function createHostedCodexContinuityManifestFromBundle(input: {
  bytes: Uint8Array | ArrayBuffer;
  entries: HostedCodexContinuityEntry[];
}): ReturnType<typeof createHostedCodexContinuityManifest> {
  const archive = parseHostedBundleArchive(input.bytes);
  if (archive.kind !== "vault") {
    throw new Error(
      `Hosted bundle kind mismatch: expected vault, got ${archive.kind}.`,
    );
  }

  return createHostedCodexContinuityManifest(input.entries.map((entry) => {
    const snapshotPath = `${HOSTED_CODEX_HOME_RELATIVE_PATH}/${entry.codexRolloutRelativePath}`;
    const rolloutFile = archive.files.find((file) =>
      file.root === WORKSPACE_OPERATOR_HOME_ROOT && file.path === snapshotPath
    );
    if (!rolloutFile) {
      throw new Error("Hosted Codex continuity rollout was not included in the snapshot bundle.");
    }

    if (isHostedBundleArtifactEntry(rolloutFile)) {
      return {
        ...entry,
        byteSize: rolloutFile.artifact.byteSize,
        sha256: rolloutFile.artifact.sha256,
      };
    }

    const bytes = Buffer.from(rolloutFile.contentsBase64, "base64");
    return {
      ...entry,
      byteSize: bytes.byteLength,
      sha256: sha256BytesHex(bytes),
    };
  }));
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
