import { createHash, createHmac } from "node:crypto";
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
const WORKSPACE_SNAPSHOT_ROOT_KEYS = new Set<string>([
  WORKSPACE_OPERATOR_HOME_ROOT,
  "vault",
]);
const RAW_ARTIFACT_EXTERNALIZE_THRESHOLD_BYTES = 256 * 1024;
const HOSTED_CODEX_HOME_INCLUDED_HASH_LIMIT = 16;
const HOSTED_CODEX_HOME_EXCLUDED_SUMMARY_LIMIT = 16;
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
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/usage/pending`,
] as const;

const HOSTED_ASSISTANT_RUNTIME_HOT_STATE_EXCLUDED_PATHS = [
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/cron/runs`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/diagnostics`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/journals`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/runtime-budgets.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/status.json`,
] as const;

export interface HostedCodexHomeSnapshotDiagnostics {
  codexHomeIncludedRelHashes: string[];
  codexHomeSnapshotCandidateCount: number;
  codexHomeSnapshotExcludedClassSummary: string[];
  codexHomeSnapshotIncludedCount: number;
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

interface HostedAssistantRuntimeHotStateBudgetMetrics {
  fileCount: number;
  inlineBytes: number;
  minimumBundleBytes: number;
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
  constructor(readonly reason: "codex_home_missing") {
    super("Hosted workspace snapshot is missing required provider continuity state.");
    this.name = "HostedWorkspaceSnapshotContinuityIncompleteError";
  }
}

export class HostedAssistantRuntimeHotStateIncompleteError
  extends HostedWorkspaceSnapshotContinuityIncompleteError {
  constructor(reason: "codex_home_missing") {
    super(reason);
    this.name = "HostedAssistantRuntimeHotStateIncompleteError";
  }
}

export type HostedWorkspaceArtifactResolver = (
  input: HostedBundleArtifactRestoreInput,
) => Promise<Uint8Array | ArrayBuffer>;

export async function snapshotHostedExecutionContext(input: {
  artifactSink?: (input: HostedWorkspaceArtifactPersistInput) => Promise<void>;
  codexHomeSnapshotHashSecret?: string | null;
  materializedArtifactPaths?: ReadonlySet<string>;
  operatorHomeRoot?: string | null;
  preservedArtifacts?: readonly HostedBundleArtifactRestoreInput[];
  vaultRoot: string;
}): Promise<{
  bundle: Uint8Array;
  codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;
}> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const artifactSink = input.artifactSink;
  const operatorHomeRoot = input.operatorHomeRoot ? path.resolve(input.operatorHomeRoot) : null;
  const codexHomeSnapshotDiagnostics = operatorHomeRoot
    ? await collectHostedCodexHomeSnapshotDiagnostics({
        hashSecret: input.codexHomeSnapshotHashSecret ?? null,
        operatorHomeRoot,
      })
    : null;
  const vaultBundle = await snapshotHostedBundleRoots({
    externalizeFile: artifactSink
      ? (() => {
          const persistArtifact = artifactSink;
          return async (artifact) => {
            if (!shouldExternalizeWorkspaceArtifact(artifact)) {
              return null;
            }

            const ref = createHostedWorkspaceArtifactRef(artifact.bytes);
            await persistArtifact({
              ...artifact,
              ref,
            });
            return ref;
          };
        })()
      : undefined,
    kind: "vault",
    materializedPreservedArtifactPaths: new Set(
      [...(input.materializedArtifactPaths ?? [])]
        .map((relativePath) => normalizeWorkspaceSnapshotArtifactPathKey(relativePath))
        .filter((artifactPathKey): artifactPathKey is string => artifactPathKey !== null),
    ),
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
    throw new Error(`Hosted vault bundle could not be created for ${vaultRoot}.`);
  }
  assertHostedWorkspaceSnapshotProviderContinuityComplete({
    bundle: vaultBundle,
  });

  return {
    bundle: vaultBundle,
    codexHomeSnapshotDiagnostics,
  };
}

export async function snapshotHostedAssistantRuntimeHotState(input: {
  codexHomeSnapshotHashSecret?: string | null;
  operatorHomeRoot?: string | null;
  vaultRoot: string;
}): Promise<HostedAssistantRuntimeHotStateSnapshot> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const operatorHomeRoot = input.operatorHomeRoot ? path.resolve(input.operatorHomeRoot) : null;
  const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
  const includeCodexProviderContinuity = await hostedAssistantRuntimeHotStateHasProviderResumeState({
    vaultRoot,
  });
  const codexHomeSnapshotRoot = includeCodexProviderContinuity ? operatorHomeRoot : null;
  const codexHomeSnapshotDiagnostics = codexHomeSnapshotRoot
    ? await collectHostedCodexHomeSnapshotDiagnostics({
        hashSecret: input.codexHomeSnapshotHashSecret ?? null,
        operatorHomeRoot: codexHomeSnapshotRoot,
      })
    : null;
  await ensureAssistantStateDirectory(assistantStateRoot);
  await assertHostedAssistantRuntimeHotStatePreBundleBudget({ vaultRoot });

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
      ...(codexHomeSnapshotRoot
        ? [
            {
              optional: true,
              root: codexHomeSnapshotRoot,
              rootKey: WORKSPACE_OPERATOR_HOME_ROOT,
              shouldIncludeRelativePath(relativePath: string) {
                return shouldIncludeHostedAssistantRuntimeHotStateOperatorHomeRelativePath(relativePath);
              },
            },
          ]
        : []),
    ],
  });

  if (bundle === null) {
    throw new Error(`Hosted assistant runtime hot-state bundle could not be created for ${vaultRoot}.`);
  }

  const metrics = measureHostedAssistantRuntimeHotStateBundle(bundle);
  assertHostedAssistantRuntimeHotStateBudget({
    ...metrics,
    bundleBytes: bundle.byteLength,
  });
  assertHostedWorkspaceSnapshotProviderContinuityComplete({
    bundle,
    createError: (reason) => new HostedAssistantRuntimeHotStateIncompleteError(reason),
  });
  return {
    bundle,
    bundleBytes: bundle.byteLength,
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

  const archive = parseHostedBundleArchive(input.bundle);
  if (archive.kind !== "vault") {
    throw new Error(
      `Hosted bundle kind mismatch: expected vault, got ${archive.kind}.`,
    );
  }

  return hostedWorkspaceSnapshotIncludesCodexSessionState({
    bundle: input.bundle,
  });
}

export function hostedAssistantRuntimeHotStateIncludesCodexHome(input: {
  bundle?: Uint8Array | ArrayBuffer | null;
}): boolean {
  return hostedAssistantRuntimeHotStateIncludesCodexProviderContinuity(input);
}

export function assertHostedWorkspaceSnapshotProviderContinuityComplete(input: {
  bundle: Uint8Array | ArrayBuffer;
  createError?: (reason: "codex_home_missing") => Error;
}): void {
  if (
    hostedWorkspaceSnapshotContainsProviderResumeState(input)
    && !hostedWorkspaceSnapshotIncludesCodexSessionState(input)
  ) {
    throw input.createError?.("codex_home_missing")
      ?? new HostedWorkspaceSnapshotContinuityIncompleteError("codex_home_missing");
  }
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
  }

  return {
    assistantStateRoot,
    operatorHomeRoot,
    vaultRoot,
  };
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
    root: input.vaultRoot,
  });
  assertHostedAssistantRuntimeHotStateBudget({
    bundleBytes: metrics.minimumBundleBytes,
    fileCount: metrics.fileCount,
    inlineBytes: metrics.inlineBytes,
  });
}

async function hostedAssistantRuntimeHotStateHasProviderResumeState(input: {
  vaultRoot: string;
}): Promise<boolean> {
  const sessionsRoot = path.join(
    input.vaultRoot,
    ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH,
    "sessions",
  );

  async function visit(directoryPath: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (await visit(absolutePath)) {
          return true;
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let text;
      try {
        text = await readFile(absolutePath, "utf8");
      } catch {
        return true;
      }

      if (assistantSessionTextContainsProviderResumeState(text)) {
        return true;
      }
    }

    return false;
  }

  return await visit(sessionsRoot);
}

async function collectHostedAssistantRuntimeHotStateBudgetMetrics(input: {
  relativeDirectory?: string;
  root: string;
}): Promise<HostedAssistantRuntimeHotStateBudgetMetrics> {
  const relativeDirectory = input.relativeDirectory ?? "";
  const directoryPath = relativeDirectory ? path.join(input.root, relativeDirectory) : input.root;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const metrics: HostedAssistantRuntimeHotStateBudgetMetrics = {
    fileCount: 0,
    inlineBytes: 0,
    minimumBundleBytes: 0,
  };

  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name)
      : entry.name;

    if (!shouldIncludeHostedAssistantRuntimeHotStateRelativePath(relativePath)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const childMetrics = await collectHostedAssistantRuntimeHotStateBudgetMetrics({
        relativeDirectory: path.join(relativeDirectory, entry.name),
        root: input.root,
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

function shouldIncludeHostedAssistantRuntimeHotStateOperatorHomeRelativePath(relativePath: string): boolean {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);
  if (!hasWorkspaceSnapshotPathPrefix(normalizedRelativePath, HOSTED_CODEX_HOME_RELATIVE_PATH)) {
    return false;
  }

  return shouldIncludeHostedCodexHomeRelativePath(
    normalizedRelativePath === HOSTED_CODEX_HOME_RELATIVE_PATH
      ? ""
      : normalizedRelativePath.slice(`${HOSTED_CODEX_HOME_RELATIVE_PATH}${path.posix.sep}`.length),
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

function hostedWorkspaceSnapshotContainsProviderResumeState(input: {
  bundle: Uint8Array | ArrayBuffer;
}): boolean {
  const archive = parseHostedBundleArchive(input.bundle);
  if (archive.kind !== "vault") {
    throw new Error(
      `Hosted bundle kind mismatch: expected vault, got ${archive.kind}.`,
    );
  }

  return archive.files.some((file) => {
    if (
      file.root !== "vault"
      || isHostedBundleArtifactEntry(file)
      || !hasWorkspaceSnapshotPathPrefix(
        normalizeWorkspaceSnapshotRelativePath(file.path),
        `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/sessions`,
      )
    ) {
      return false;
    }

    const text = Buffer.from(file.contentsBase64, "base64").toString("utf8");
    return assistantSessionTextContainsProviderResumeState(text);
  });
}

function assistantSessionTextContainsProviderResumeState(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return true;
  }

  return (
    recordStringProperty(parsed, "providerSessionId") !== null
    || recordStringProperty(recordProperty(parsed, "resumeState"), "providerSessionId") !== null
  );
}

function hostedWorkspaceSnapshotIncludesCodexSessionState(input: {
  bundle: Uint8Array | ArrayBuffer;
}): boolean {
  const archive = parseHostedBundleArchive(input.bundle);
  if (archive.kind !== "vault") {
    throw new Error(
      `Hosted bundle kind mismatch: expected vault, got ${archive.kind}.`,
    );
  }

  return archive.files.some((file) =>
    file.root === WORKSPACE_OPERATOR_HOME_ROOT
    && hasWorkspaceSnapshotPathPrefix(
      normalizeWorkspaceSnapshotRelativePath(file.path),
      `${HOSTED_CODEX_HOME_RELATIVE_PATH}/sessions`,
    )
  );
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

  if (
    normalizedRelativePath === ".murph"
    || normalizedRelativePath === ".murph/config.json"
  ) {
    return true;
  }

  if (hasWorkspaceSnapshotPathPrefix(normalizedRelativePath, HOSTED_CODEX_HOME_RELATIVE_PATH)) {
    return shouldIncludeHostedCodexHomeRelativePath(
      normalizedRelativePath === HOSTED_CODEX_HOME_RELATIVE_PATH
        ? ""
        : normalizedRelativePath.slice(`${HOSTED_CODEX_HOME_RELATIVE_PATH}${path.posix.sep}`.length),
    );
  }

  return false;
}

function shouldIncludeHostedCodexHomeRelativePath(relativePath: string): boolean {
  return classifyHostedCodexHomeRelativePath(relativePath).include;
}

type HostedCodexHomeSnapshotExclusionClass =
  | "environment"
  | "root-history"
  | "sensitive-basename"
  | "unsafe-container";

type HostedCodexHomeSnapshotDecision =
  | {
      include: true;
    }
  | {
      exclusionClass: HostedCodexHomeSnapshotExclusionClass;
      include: false;
    };

function classifyHostedCodexHomeRelativePath(relativePath: string): HostedCodexHomeSnapshotDecision {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);
  if (normalizedRelativePath.length === 0) {
    return {
      include: true,
    };
  }

  if (isEnvironmentRelativePath(normalizedRelativePath)) {
    return {
      exclusionClass: "environment",
      include: false,
    };
  }

  const segments = normalizedRelativePath
    .split(path.posix.sep)
    .map((segment) => segment.toLowerCase());
  if (
    segments.some((segment) =>
      segment === "tmp"
      || segment === ".tmp"
      || segment === "auth"
      || segment === ".auth"
      || segment === "cache"
      || segment === ".cache"
      || segment === "cert"
      || segment === ".cert"
      || segment === "certs"
      || segment === ".certs"
      || segment === "certificate"
      || segment === ".certificate"
      || segment === "certificates"
      || segment === ".certificates"
      || segment === "cookie"
      || segment === ".cookie"
      || segment === "cookies"
      || segment === ".cookies"
      || segment === "credential"
      || segment === ".credential"
      || segment === "credentials"
      || segment === ".credentials"
      || segment === "key"
      || segment === ".key"
      || segment === "keys"
      || segment === ".keys"
      || segment === "log"
      || segment === ".log"
      || segment === "logs"
      || segment === ".logs"
      || segment === "oauth"
      || segment === ".oauth"
      || segment === "password"
      || segment === ".password"
      || segment === "passwords"
      || segment === ".passwords"
      || segment === "secrets"
      || segment === ".secrets"
      || segment === "token"
      || segment === ".token"
      || segment === "tokens"
      || segment === ".tokens"
    )
  ) {
    return {
      exclusionClass: "unsafe-container",
      include: false,
    };
  }

  if (isHostedCodexHomeRootHistoryPath(normalizedRelativePath)) {
    return {
      exclusionClass: "root-history",
      include: false,
    };
  }

  const basename = path.posix.basename(normalizedRelativePath).toLowerCase();
  if (isHostedCodexHomeSensitiveBasename(basename)) {
    return {
      exclusionClass: "sensitive-basename",
      include: false,
    };
  }

  return {
    include: true,
  };
}

async function collectHostedCodexHomeSnapshotDiagnostics(input: {
  hashSecret?: string | null;
  operatorHomeRoot: string;
}): Promise<HostedCodexHomeSnapshotDiagnostics | null> {
  const codexHomeRoot = path.join(input.operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH);
  try {
    const entry = await lstat(codexHomeRoot);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      return null;
    }
  } catch {
    return null;
  }

  const includedRelHashes: string[] = [];
  const excludedClassCounts = new Map<HostedCodexHomeSnapshotExclusionClass, number>();
  const hashSecret = normalizeHostedCodexHomeSnapshotHashSecret(input.hashSecret);
  let candidateCount = 0;
  let includedCount = 0;

  async function visit(relativeDirectory: string): Promise<void> {
    const absoluteDirectory = relativeDirectory
      ? path.join(codexHomeRoot, relativeDirectory)
      : codexHomeRoot;
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name)
        : entry.name;
      const decision = classifyHostedCodexHomeRelativePath(relativePath);

      if (!decision.include) {
        candidateCount += 1;
        excludedClassCounts.set(
          decision.exclusionClass,
          (excludedClassCounts.get(decision.exclusionClass) ?? 0) + 1,
        );
        continue;
      }

      if (entry.isDirectory()) {
        await visit(path.join(relativeDirectory, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      candidateCount += 1;
      includedCount += 1;
      if (hashSecret && includedRelHashes.length < HOSTED_CODEX_HOME_INCLUDED_HASH_LIMIT) {
        includedRelHashes.push(fingerprintHostedCodexHomeRelativePath({
          hashSecret,
          relativePath,
        }));
      }
    }
  }

  await visit("");

  return {
    codexHomeIncludedRelHashes: includedRelHashes,
    codexHomeSnapshotCandidateCount: candidateCount,
    codexHomeSnapshotExcludedClassSummary:
      summarizeHostedCodexHomeSnapshotExclusionClasses(excludedClassCounts),
    codexHomeSnapshotIncludedCount: includedCount,
  };
}

function summarizeHostedCodexHomeSnapshotExclusionClasses(
  counts: ReadonlyMap<HostedCodexHomeSnapshotExclusionClass, number>,
): string[] {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, HOSTED_CODEX_HOME_EXCLUDED_SUMMARY_LIMIT)
    .map(([exclusionClass, count]) => `${exclusionClass}:${count}`);
}

function fingerprintHostedCodexHomeRelativePath(input: {
  hashSecret: string;
  relativePath: string;
}): string {
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(input.relativePath);
  const hash = createHmac("sha256", input.hashSecret)
    .update(`codex_home_rel:${normalizedRelativePath}`, "utf8")
    .digest("hex");
  return `h1_${hash.slice(0, 24)}`;
}

function normalizeHostedCodexHomeSnapshotHashSecret(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function isHostedCodexHomeRootHistoryPath(relativePath: string): boolean {
  return relativePath === "history.json"
    || relativePath === "history.jsonl"
    || relativePath === "history.jsonl.db";
}

function isHostedCodexHomeSensitiveBasename(basename: string): boolean {
  if (
    basename === ".netrc"
    || basename === "auth.json"
    || basename === "credentials.json"
    || basename === "oauth.json"
    || basename === "token.json"
    || basename === "tokens.json"
  ) {
    return true;
  }

  if (
    hasHostedCodexHomeSensitiveBasenameToken(basename)
    || basename.includes("access-token")
    || basename.includes("api-key")
    || basename.includes("apikey")
    || basename.includes("credential")
    || basename.includes("cookie")
    || basename.includes("oauth")
    || basename.includes("password")
    || basename.includes("refresh-token")
    || basename.includes("secret")
    || basename.includes("token")
  ) {
    return true;
  }

  return hasHostedCodexHomeSensitiveExtension(basename);
}

function hasHostedCodexHomeSensitiveBasenameToken(basename: string): boolean {
  const tokens = basename.split(/[^a-z0-9]+/u);
  return tokens.some((token) =>
    token === "auth"
    || token === "apikey"
    || token === "cert"
    || token === "certificate"
    || token === "credential"
    || token === "credentials"
    || token === "cookie"
    || token === "key"
    || token === "keys"
    || token === "oauth"
    || token === "password"
    || token === "secret"
    || token === "token"
  );
}

function hasHostedCodexHomeSensitiveExtension(basename: string): boolean {
  return (
    basename.endsWith(".cer")
    || basename.endsWith(".crt")
    || basename.endsWith(".der")
    || basename.endsWith(".key")
    || basename.endsWith(".keystore")
    || basename.endsWith(".lock")
    || basename.endsWith(".log")
    || basename.endsWith(".p12")
    || basename.endsWith(".pem")
    || basename.endsWith(".pfx")
    || basename.endsWith(".pid")
    || basename.endsWith(".sock")
    || basename.endsWith(".socket")
    || basename.endsWith(".tmp")
    || basename.startsWith(".tmp-")
  );
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
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/.locks`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/.runtime-write.lock`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/.automation-run.lock`,
] as const;
