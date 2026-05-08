import { createHash, createHmac, randomUUID } from "node:crypto";
import { constants as fsConstants, type Dirent } from "node:fs";
import {
  chmod,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ensureAssistantStateDirectory,
  resolveAssistantStateRestoreMode,
} from "./assistant-state-security.ts";
import {
  assertHostedBundleArtifactIntegrity,
  HOSTED_BUNDLE_SCHEMA,
  isHostedBundleArtifactEntry,
  normalizeBundlePath,
  parseHostedBundleArchive,
  resolveHostedBundleRestorePath,
  serializeHostedBundleArchive,
  toHostedBundleBytes,
  type HostedBundleArchiveFile,
  type HostedBundleArtifactLocation,
  type HostedBundleArtifactRef,
} from "./hosted-bundle.ts";
import type { HostedExecutionBundleKind } from "./hosted-bundle-ref.ts";

const HOSTED_OPERATOR_HOME_ROOT_KEY = "operator-home";
const HOSTED_CODEX_HOME_RELATIVE_PATH = ".codex-hosted";
const HOSTED_CODEX_HOME_DIRECTORY_MODE = 0o700;
const HOSTED_CODEX_HOME_FILE_MODE = 0o600;
const HOSTED_WORKSPACE_BUNDLE_METADATA_ROOT = "workspace-metadata";
const HOSTED_CHECKPOINT_DEBUG_PATHS_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS";
const HOSTED_CHECKPOINT_DEBUG_PATHS_FILE_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE";
const HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG";
const HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT";
const HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW_ENV = "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW";
const HOSTED_CHECKPOINT_DEBUG_TRACE_SCHEMA = "murph.hosted-checkpoint-debug-paths.v1";
const HOSTED_CHECKPOINT_DEBUG_LOG_ENTRY_CHUNK_SIZE = 250;
const HOSTED_CHECKPOINT_DEBUG_MAX_LOG_ENTRY_LIMIT = 20_000;
const HOSTED_CHECKPOINT_DEBUG_SUMMARY_LOG_EVENT = "murph.hosted-checkpoint-debug.summary";
const HOSTED_CHECKPOINT_DEBUG_ENTRIES_LOG_EVENT = "murph.hosted-checkpoint-debug.entries";
const HOSTED_CHECKPOINT_DEBUG_LOG_HASH_SECRET_ENV = "HOSTED_LOG_FINGERPRINT_SECRET";
const HOSTED_CHECKPOINT_DEBUG_OUTPUT_OPEN_FLAGS = fsConstants.O_WRONLY
  | fsConstants.O_CREAT
  | fsConstants.O_NONBLOCK
  | fsConstants.O_TRUNC
  | fsConstants.O_NOFOLLOW;
const HOSTED_CHECKPOINT_DEBUG_OUTPUT_NOT_REGULAR_ERROR = "Hosted checkpoint debug output path must be a regular file.";

export interface HostedBundleArtifactSnapshotInput {
  absolutePath: string;
  bytes: Uint8Array;
  path: string;
  root: string;
}

export interface HostedBundleArtifactRestoreInput extends HostedBundleArtifactLocation {}

export type HostedBundleArtifactRestoreFilter = (
  input: HostedBundleArtifactRestoreInput,
) => boolean | Promise<boolean>;

export interface HostedBundleInlineRestoreInput {
  path: string;
  root: string;
  sha256: string;
  size: number;
}

export type HostedBundleInlineRestoreFilter = (
  input: HostedBundleInlineRestoreInput,
) => boolean | Promise<boolean>;

export interface HostedBundleSnapshotRootInput {
  explicitFiles?: readonly string[];
  optional?: boolean;
  root: string;
  rootKey: string;
  shouldIncludeRelativePath?: (relativePath: string) => boolean;
}

export interface HostedBundleRestoreRootMap {
  [rootKey: string]: string;
}

export interface HostedBundleSnapshotRootsInput {
  assertSnapshotLive?: () => Promise<void> | void;
  externalizeFile?: (input: HostedBundleArtifactSnapshotInput) => Promise<HostedBundleArtifactRef | null>;
  kind: HostedExecutionBundleKind;
  materializedPreservedArtifactPaths?: ReadonlySet<string>;
  onBeforeSerialize?: () => Promise<void> | void;
  preservedArtifacts?: readonly HostedBundleArtifactLocation[];
  roots: readonly HostedBundleSnapshotRootInput[];
  shouldIncludePreservedArtifact?: (
    input: HostedBundleArtifactLocation,
  ) => boolean | Promise<boolean>;
}

type HostedCheckpointDebugEntrySource = "explicit" | "preserved" | "walk";
type HostedCheckpointDebugEntryType = "artifact" | "directory" | "file" | "other" | "symlink" | "unknown";
type HostedCheckpointDebugDecision = "descend" | "exclude" | "include";
type HostedCheckpointDebugReason =
  | "already_included"
  | "externalized"
  | "inline"
  | "not_live"
  | "not_regular_file"
  | "policy_excluded"
  | "policy_included"
  | "preserved_artifact"
  | "unsupported_type";
type HostedCheckpointDebugStatus = "completed" | "empty" | "failed";

interface HostedCheckpointDebugEntry {
  bytes?: number;
  decision: HostedCheckpointDebugDecision;
  depth: number;
  path: string;
  reason: HostedCheckpointDebugReason;
  root: string;
  source: HostedCheckpointDebugEntrySource;
  type: HostedCheckpointDebugEntryType;
}

interface HostedCheckpointDebugTrace {
  record: (entry: HostedCheckpointDebugEntry) => void;
  setArchiveFileCount: (count: number) => void;
  write: (status: HostedCheckpointDebugStatus) => Promise<void>;
}

interface HostedCheckpointDebugSummary {
  archiveFileCount: number | null;
  artifactCount: number;
  descendedDirectoryCount: number;
  directoryCount: number;
  entryCount: number;
  excludedDecisionCount: number;
  fileCount: number;
  includedDecisionCount: number;
  otherCount: number;
  symlinkCount: number;
  unknownCount: number;
}

interface HostedCheckpointDebugArtifact {
  createdAt: string;
  entries: HostedCheckpointDebugEntry[];
  kind: HostedExecutionBundleKind;
  schema: typeof HOSTED_CHECKPOINT_DEBUG_TRACE_SCHEMA;
  status: HostedCheckpointDebugStatus;
  summary: HostedCheckpointDebugSummary;
}

interface HostedCheckpointDebugLogConfig {
  enabled: boolean;
  entryLimit: number | null;
  entryLimitError: string | null;
  rawPaths: boolean;
}

type HostedCheckpointDebugLogEntry = Omit<HostedCheckpointDebugEntry, "path"> & {
  pathHash: string;
  path?: string;
};

interface HostedCheckpointDebugLogLimitResult {
  entryLimit: number | null;
  error: string | null;
}

export async function snapshotHostedBundleRoots(input: HostedBundleSnapshotRootsInput): Promise<Uint8Array | null> {
  const debugTrace = createHostedCheckpointDebugTrace(input.kind);

  try {
    const bundle = await snapshotHostedBundleRootsWithDebugTrace(input, debugTrace);
    await debugTrace?.write(bundle ? "completed" : "empty");
    return bundle;
  } catch (error) {
    await tryWriteHostedCheckpointDebugTrace(debugTrace, "failed");
    throw error;
  }
}

async function snapshotHostedBundleRootsWithDebugTrace(
  input: HostedBundleSnapshotRootsInput,
  debugTrace: HostedCheckpointDebugTrace | null,
): Promise<Uint8Array | null> {
  const files: HostedBundleArchiveFile[] = [];
  const includedPaths = new Set<string>();
  let includedRootCount = 0;
  const configuredRootsByKey = new Map<string, HostedBundleSnapshotRootInput[]>();
  const includedRootsByKey = new Map<string, HostedBundleSnapshotRootInput[]>();

  for (const root of input.roots) {
    const configuredRoots = configuredRootsByKey.get(root.rootKey);
    if (configuredRoots) {
      configuredRoots.push(root);
    } else {
      configuredRootsByKey.set(root.rootKey, [root]);
    }
  }

  for (const root of input.roots) {
    await input.assertSnapshotLive?.();
    if (!(await directoryExists(root.root))) {
      if (root.optional) {
        continue;
      }

      throw new Error(`Hosted bundle root "${root.rootKey}" does not exist.`);
    }

    includedRootCount += 1;
    const includedRoots = includedRootsByKey.get(root.rootKey);
    if (includedRoots) {
      includedRoots.push(root);
    } else {
      includedRootsByKey.set(root.rootKey, [root]);
    }
    appendHostedBundleFiles(
      files,
      includedPaths,
      await collectBundleFiles({
        assertSnapshotLive: input.assertSnapshotLive,
        debugTrace,
        externalizeFile: input.externalizeFile,
        root: root.root,
        rootKey: root.rootKey,
        shouldIncludeRelativePath: root.shouldIncludeRelativePath ?? (() => true),
      }),
      "walk",
      debugTrace,
    );
    appendHostedBundleFiles(
      files,
      includedPaths,
      await collectExplicitBundleFiles({
        assertSnapshotLive: input.assertSnapshotLive,
        debugTrace,
        explicitFiles: root.explicitFiles ?? [],
        includedPaths,
        externalizeFile: input.externalizeFile,
        root: root.root,
        rootKey: root.rootKey,
      }),
      "explicit",
      debugTrace,
    );
  }

  if (includedRootCount === 0) {
    debugTrace?.setArchiveFileCount(0);
    return null;
  }

  const materializedPreservedArtifactPaths = input.materializedPreservedArtifactPaths ?? new Set<string>();
  for (const artifact of input.preservedArtifacts ?? []) {
    await input.assertSnapshotLive?.();
    if (!configuredRootsByKey.has(artifact.root)) {
      throw new Error(`Hosted bundle preserved artifact root "${artifact.root}" is not configured for snapshot.`);
    }

    const normalizedPath = normalizeBundlePath(artifact.path);
    const preservedPathKey = `${artifact.root}:${normalizedPath}`;
    if (includedPaths.has(preservedPathKey)) {
      recordHostedCheckpointDebugEntry(debugTrace, {
        decision: "exclude",
        path: normalizedPath,
        reason: "already_included",
        root: artifact.root,
        source: "preserved",
        type: "artifact",
      });
      continue;
    }

    if (input.shouldIncludePreservedArtifact) {
      const shouldIncludePreservedArtifact = await input.shouldIncludePreservedArtifact({
        ...artifact,
        path: normalizedPath,
      });
      if (!shouldIncludePreservedArtifact) {
        recordHostedCheckpointDebugEntry(debugTrace, {
          decision: "exclude",
          path: normalizedPath,
          reason: "policy_excluded",
          root: artifact.root,
          source: "preserved",
          type: "artifact",
        });
        continue;
      }
    }

    if (
      materializedPreservedArtifactPaths.has(preservedPathKey)
      && !(await hasLiveBundledFilePath({
        relativePath: normalizedPath,
        roots: includedRootsByKey.get(artifact.root) ?? [],
      }))
    ) {
      recordHostedCheckpointDebugEntry(debugTrace, {
        decision: "exclude",
        path: normalizedPath,
        reason: "not_live",
        root: artifact.root,
        source: "preserved",
        type: "artifact",
      });
      continue;
    }

    recordHostedCheckpointDebugEntry(debugTrace, {
      bytes: artifact.ref.byteSize,
      decision: "include",
      path: normalizedPath,
      reason: "preserved_artifact",
      root: artifact.root,
      source: "preserved",
      type: "artifact",
    });
    files.push({
      artifact: artifact.ref,
      path: normalizedPath,
      root: artifact.root,
    });
    includedPaths.add(preservedPathKey);
  }

  await input.assertSnapshotLive?.();
  await input.onBeforeSerialize?.();
  debugTrace?.setArchiveFileCount(files.length);

  return serializeHostedBundleArchive({
    files,
    kind: input.kind,
    schema: HOSTED_BUNDLE_SCHEMA,
  });
}

export async function restoreHostedBundleRoots(input: {
  artifactResolver?: (input: HostedBundleArtifactRestoreInput) => Promise<Uint8Array | ArrayBuffer>;
  bytes: Uint8Array | ArrayBuffer;
  expectedKind: HostedExecutionBundleKind;
  ignoredRoots?: readonly string[];
  onSkippedInlineFile?: (input: HostedBundleInlineRestoreInput) => Promise<void> | void;
  roots: HostedBundleRestoreRootMap;
  shouldRestoreArtifact?: HostedBundleArtifactRestoreFilter;
  shouldRestoreInlineFile?: HostedBundleInlineRestoreFilter;
}): Promise<void> {
  await restoreHostedBundleArchiveFiles({
    ...input,
    includeInlineFiles: true,
  });
}

export async function materializeHostedBundleArtifacts(input: {
  artifactResolver: (input: HostedBundleArtifactRestoreInput) => Promise<Uint8Array | ArrayBuffer>;
  bytes: Uint8Array | ArrayBuffer;
  expectedKind: HostedExecutionBundleKind;
  ignoredRoots?: readonly string[];
  roots: HostedBundleRestoreRootMap;
  shouldRestoreArtifact?: HostedBundleArtifactRestoreFilter;
}): Promise<void> {
  await restoreHostedBundleArchiveFiles({
    ...input,
    includeInlineFiles: false,
  });
}

async function restoreHostedBundleArchiveFiles(input: {
  artifactResolver?: (input: HostedBundleArtifactRestoreInput) => Promise<Uint8Array | ArrayBuffer>;
  bytes: Uint8Array | ArrayBuffer;
  expectedKind: HostedExecutionBundleKind;
  ignoredRoots?: readonly string[];
  onSkippedInlineFile?: (input: HostedBundleInlineRestoreInput) => Promise<void> | void;
  roots: HostedBundleRestoreRootMap;
  shouldRestoreArtifact?: HostedBundleArtifactRestoreFilter;
  shouldRestoreInlineFile?: HostedBundleInlineRestoreFilter;
  includeInlineFiles: boolean;
}): Promise<void> {
  const archive = parseHostedBundleArchive(input.bytes);
  const ignoredRoots = new Set([
    HOSTED_WORKSPACE_BUNDLE_METADATA_ROOT,
    ...(input.ignoredRoots ?? []),
  ]);

  if (archive.kind !== input.expectedKind) {
    throw new Error(
      `Hosted bundle kind mismatch: expected ${input.expectedKind}, got ${archive.kind}.`,
    );
  }

  for (const file of archive.files) {
    const isArtifact = isHostedBundleArtifactEntry(file);
    if (!isArtifact && !input.includeInlineFiles) {
      continue;
    }

    const root = input.roots[file.root];

    if (!root) {
      if (ignoredRoots.has(file.root)) {
        continue;
      }

      throw new Error(`Hosted bundle root "${file.root}" is not mapped for restore.`);
    }

    const absolutePath = resolveHostedBundleRestorePath(root, file.path);
    await assertHostedBundleRestorePathHasNoSymlinks(root, absolutePath, file.path);

    if (isArtifact) {
      const shouldRestore = input.shouldRestoreArtifact
        ? await input.shouldRestoreArtifact({
            path: file.path,
            ref: file.artifact,
            root: file.root,
          })
        : true;
      if (!shouldRestore) {
        continue;
      }

      if (!input.artifactResolver) {
        throw new Error(
          `Hosted bundle artifact ${file.root}:${file.path} requires an artifact resolver.`,
        );
      }

      const resolved = await input.artifactResolver({
        path: file.path,
        ref: file.artifact,
        root: file.root,
      });
      const resolvedBytes = toHostedBundleBytes(resolved);
      assertHostedBundleArtifactIntegrity({
        bytes: resolvedBytes,
        path: file.path,
        ref: file.artifact,
        root: file.root,
      });
      await writeHostedBundleRestoredFile({
        absolutePath,
        bytes: Buffer.from(resolvedBytes),
        mappedRoot: root,
        path: file.path,
        root: file.root,
      });
      continue;
    }

    if (!input.includeInlineFiles) {
      continue;
    }

    const inlineBytes = Buffer.from(file.contentsBase64, "base64");
    const inlineFile = {
      path: file.path,
      root: file.root,
      sha256: createHash("sha256").update(inlineBytes).digest("hex"),
      size: inlineBytes.byteLength,
    };
    const shouldRestoreInline = input.shouldRestoreInlineFile
      ? await input.shouldRestoreInlineFile(inlineFile)
      : true;
    if (!shouldRestoreInline) {
      await input.onSkippedInlineFile?.(inlineFile);
      continue;
    }

    await writeHostedBundleRestoredFile({
      absolutePath,
      bytes: inlineBytes,
      mappedRoot: root,
      path: file.path,
      root: file.root,
    });
  }
}

async function writeHostedBundleRestoredFile(input: {
  absolutePath: string;
  bytes: Buffer;
  mappedRoot: string;
  path: string;
  root: string;
}): Promise<void> {
  await ensureHostedBundleRestoreParentDirectory(input);
  await assertHostedBundleRestorePathHasNoSymlinks(input.mappedRoot, input.absolutePath, input.path);
  await writeFile(input.absolutePath, input.bytes, {
    mode: resolveHostedBundleRestoreMode({
      kind: "file",
      path: input.path,
      root: input.root,
    }),
  });
  await chmodHostedBundleRestoredFile(input);
}

async function ensureHostedBundleRestoreParentDirectory(input: {
  absolutePath: string;
  mappedRoot: string;
  path: string;
  root: string;
}): Promise<void> {
  const directoryPath = path.dirname(input.absolutePath);
  const mode = resolveHostedBundleRestoreMode({
    kind: "directory",
    path: path.posix.dirname(input.path),
    root: input.root,
  });

  if (typeof mode === "number") {
    if (isHostedCodexHomeRestorePath({
      path: path.posix.dirname(input.path),
      root: input.root,
    })) {
      await ensureHostedCodexHomeRestoreDirectory({
        mappedRoot: input.mappedRoot,
        relativeDirectory: path.posix.dirname(input.path),
      });
      return;
    }

    await ensureAssistantStateDirectory(directoryPath);
    await chmod(directoryPath, mode);
    return;
  }

  await mkdir(directoryPath, { recursive: true });
}

async function ensureHostedCodexHomeRestoreDirectory(input: {
  mappedRoot: string;
  relativeDirectory: string;
}): Promise<void> {
  const normalizedRelativeDirectory = normalizeBundlePath(input.relativeDirectory);
  if (
    normalizedRelativeDirectory !== HOSTED_CODEX_HOME_RELATIVE_PATH
    && !normalizedRelativeDirectory.startsWith(`${HOSTED_CODEX_HOME_RELATIVE_PATH}/`)
  ) {
    throw new Error(`Hosted Codex restore path is outside ${HOSTED_CODEX_HOME_RELATIVE_PATH}.`);
  }

  await mkdir(input.mappedRoot, { recursive: true });

  let currentPath = input.mappedRoot;
  for (const segment of normalizedRelativeDirectory.split("/").filter(Boolean)) {
    currentPath = path.join(currentPath, segment);
    try {
      const entry = await lstat(currentPath);
      if (entry.isSymbolicLink()) {
        throw new Error(`Hosted Codex restore directory must not contain symlinks: ${input.relativeDirectory}`);
      }
      if (!entry.isDirectory()) {
        throw new Error(`Hosted Codex restore path is not a directory: ${currentPath}`);
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      await mkdir(currentPath, {
        mode: HOSTED_CODEX_HOME_DIRECTORY_MODE,
      });
    }

    await chmod(currentPath, HOSTED_CODEX_HOME_DIRECTORY_MODE);
  }
}

async function chmodHostedBundleRestoredFile(input: {
  absolutePath: string;
  path: string;
  root: string;
}): Promise<void> {
  const mode = resolveHostedBundleRestoreMode({
    kind: "file",
    path: input.path,
    root: input.root,
  });

  if (typeof mode === "number") {
    await chmod(input.absolutePath, mode);
  }
}

function resolveHostedBundleRestoreMode(input: {
  kind: "directory" | "file";
  path: string;
  root: string;
}): number | undefined {
  const assistantStateMode = resolveAssistantStateRestoreMode({
    kind: input.kind,
    relativePath: input.path,
    root: input.root,
  });
  if (assistantStateMode !== undefined) {
    return assistantStateMode;
  }

  if (isHostedCodexHomeRestorePath(input)) {
    return input.kind === "directory"
      ? HOSTED_CODEX_HOME_DIRECTORY_MODE
      : HOSTED_CODEX_HOME_FILE_MODE;
  }

  return undefined;
}

function isHostedCodexHomeRestorePath(input: {
  path: string;
  root: string;
}): boolean {
  if (input.root !== HOSTED_OPERATOR_HOME_ROOT_KEY) {
    return false;
  }

  const normalizedRelativePath = normalizeBundlePath(input.path);
  return normalizedRelativePath === HOSTED_CODEX_HOME_RELATIVE_PATH
    || normalizedRelativePath.startsWith(`${HOSTED_CODEX_HOME_RELATIVE_PATH}/`);
}

function createHostedCheckpointDebugTrace(kind: HostedExecutionBundleKind): HostedCheckpointDebugTrace | null {
  if (!isHostedCheckpointDebugPathsEnabled(process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_ENV])) {
    return null;
  }

  const outputPath = resolveHostedCheckpointDebugOutputPath();
  const logConfig = resolveHostedCheckpointDebugLogConfig();
  const createdAt = new Date().toISOString();
  const entries: HostedCheckpointDebugEntry[] = [];
  let archiveFileCount: number | null = null;

  return {
    record(entry) {
      entries.push(entry);
    },
    setArchiveFileCount(count) {
      archiveFileCount = count;
    },
    async write(status) {
      const artifact: HostedCheckpointDebugArtifact = {
        schema: HOSTED_CHECKPOINT_DEBUG_TRACE_SCHEMA,
        createdAt,
        kind,
        status,
        summary: summarizeHostedCheckpointDebugEntries(entries, archiveFileCount),
        entries,
      };

      await writeHostedCheckpointDebugTraceFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
      writeHostedCheckpointDebugLog(artifact, logConfig);
    },
  };
}

function isHostedCheckpointDebugPathsEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

function resolveHostedCheckpointDebugOutputPath(): string {
  const configuredPath = process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_FILE_ENV]?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  return path.join(
    tmpdir(),
    `murph-hosted-checkpoint-debug-${process.pid}-${Date.now()}-${randomUUID()}.json`,
  );
}

function resolveHostedCheckpointDebugLogConfig(): HostedCheckpointDebugLogConfig {
  const limit = readHostedCheckpointDebugLogEntryLimit(
    process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT_ENV],
  );

  return {
    enabled: isHostedCheckpointDebugPathsEnabled(
      process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_ENV],
    ),
    entryLimit: limit.entryLimit,
    entryLimitError: limit.error,
    rawPaths: isHostedCheckpointDebugPathsEnabled(
      process.env[HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW_ENV],
    ),
  };
}

function readHostedCheckpointDebugLogEntryLimit(value: string | undefined): HostedCheckpointDebugLogLimitResult {
  const normalized = value?.trim();
  if (!normalized) {
    return {
      entryLimit: null,
      error: "missing_log_limit",
    };
  }

  if (!/^[0-9]+$/u.test(normalized)) {
    return {
      entryLimit: null,
      error: "invalid_log_limit",
    };
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed > HOSTED_CHECKPOINT_DEBUG_MAX_LOG_ENTRY_LIMIT) {
    return {
      entryLimit: null,
      error: "invalid_log_limit",
    };
  }

  return {
    entryLimit: parsed,
    error: null,
  };
}

function writeHostedCheckpointDebugLog(
  artifact: HostedCheckpointDebugArtifact,
  config: HostedCheckpointDebugLogConfig,
): void {
  if (!config.enabled) {
    return;
  }

  const entriesToLog = config.entryLimit === null
    ? []
    : artifact.entries.slice(0, config.entryLimit);
  const omittedEntryCount = Math.max(0, artifact.entries.length - entriesToLog.length);

  console.error(
    HOSTED_CHECKPOINT_DEBUG_SUMMARY_LOG_EVENT,
    JSON.stringify({
      schema: artifact.schema,
      createdAt: artifact.createdAt,
      kind: artifact.kind,
      status: artifact.status,
      summary: artifact.summary,
      logEntryLimit: config.entryLimit,
      loggedEntryCount: entriesToLog.length,
      omittedEntryCount,
      entryLogMode: config.entryLimit === null
        ? "disabled"
        : config.rawPaths ? "raw" : "hashed",
      entryLoggingDisabledReason: config.entryLimitError,
    }),
  );

  if (config.entryLimit === null) {
    return;
  }

  const logEntries = entriesToLog.map((entry) =>
    toHostedCheckpointDebugLogEntry(entry, config)
  );

  if (entriesToLog.length === 0) {
    console.error(
      HOSTED_CHECKPOINT_DEBUG_ENTRIES_LOG_EVENT,
      JSON.stringify({
        schema: artifact.schema,
        kind: artifact.kind,
        status: artifact.status,
        chunkIndex: 0,
        chunkCount: 0,
        startIndex: 0,
        entryCount: 0,
        omittedEntryCount,
        entries: [],
      }),
    );
    return;
  }

  const chunkCount = Math.ceil(entriesToLog.length / HOSTED_CHECKPOINT_DEBUG_LOG_ENTRY_CHUNK_SIZE);
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const startIndex = chunkIndex * HOSTED_CHECKPOINT_DEBUG_LOG_ENTRY_CHUNK_SIZE;
    const entries = logEntries.slice(
      startIndex,
      startIndex + HOSTED_CHECKPOINT_DEBUG_LOG_ENTRY_CHUNK_SIZE,
    );
    console.error(
      HOSTED_CHECKPOINT_DEBUG_ENTRIES_LOG_EVENT,
      JSON.stringify({
        schema: artifact.schema,
        kind: artifact.kind,
        status: artifact.status,
        chunkIndex,
        chunkCount,
        startIndex,
        entryCount: entries.length,
        omittedEntryCount,
        entries,
      }),
    );
  }
}

function toHostedCheckpointDebugLogEntry(
  entry: HostedCheckpointDebugEntry,
  config: HostedCheckpointDebugLogConfig,
): HostedCheckpointDebugLogEntry {
  const { path: relativePath, ...rest } = entry;
  return {
    ...rest,
    pathHash: hashHostedCheckpointDebugPath(entry),
    ...(config.rawPaths ? { path: relativePath } : {}),
  };
}

function hashHostedCheckpointDebugPath(entry: HostedCheckpointDebugEntry): string {
  const secret = process.env[HOSTED_CHECKPOINT_DEBUG_LOG_HASH_SECRET_ENV]?.trim();
  const input = `${entry.root}\0${entry.path}`;

  if (secret) {
    return createHmac("sha256", secret).update(input).digest("hex");
  }

  return createHash("sha256").update(input).digest("hex");
}

async function writeHostedCheckpointDebugTraceFile(
  outputPath: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  let handle: FileHandle;
  try {
    handle = await open(
      outputPath,
      HOSTED_CHECKPOINT_DEBUG_OUTPUT_OPEN_FLAGS,
      HOSTED_CODEX_HOME_FILE_MODE,
    );
  } catch (error) {
    if (getNodeErrorCode(error) === "ELOOP") {
      throw new Error("Hosted checkpoint debug output path must not be a symbolic link.");
    }
    if (isHostedCheckpointDebugOutputNotRegularError(error)) {
      throw new Error(HOSTED_CHECKPOINT_DEBUG_OUTPUT_NOT_REGULAR_ERROR);
    }

    throw error;
  }

  try {
    const outputStat = await handle.stat();
    if (!outputStat.isFile()) {
      throw new Error(HOSTED_CHECKPOINT_DEBUG_OUTPUT_NOT_REGULAR_ERROR);
    }

    await handle.chmod(HOSTED_CODEX_HOME_FILE_MODE);
    await handle.writeFile(contents, "utf8");
  } finally {
    await handle.close();
  }
}

function isHostedCheckpointDebugOutputNotRegularError(error: unknown): boolean {
  const code = getNodeErrorCode(error);
  return code === "EISDIR" || code === "ENOTDIR" || code === "ENXIO";
}

async function tryWriteHostedCheckpointDebugTrace(
  trace: HostedCheckpointDebugTrace | null,
  status: HostedCheckpointDebugStatus,
): Promise<void> {
  try {
    await trace?.write(status);
  } catch {
    return;
  }
}

function recordHostedCheckpointDebugEntry(
  trace: HostedCheckpointDebugTrace | null,
  entry: Omit<HostedCheckpointDebugEntry, "depth">,
): void {
  if (!trace) {
    return;
  }

  const normalizedPath = normalizeBundlePath(entry.path);
  trace.record({
    ...entry,
    path: normalizedPath,
    depth: getHostedCheckpointDebugPathDepth(normalizedPath),
  });
}

function getHostedCheckpointDebugPathDepth(relativePath: string): number {
  return relativePath.split(path.posix.sep).filter(Boolean).length;
}

function getHostedCheckpointDebugEntryType(entry: Dirent): HostedCheckpointDebugEntryType {
  if (entry.isDirectory()) {
    return "directory";
  }

  if (entry.isFile()) {
    return "file";
  }

  if (entry.isSymbolicLink()) {
    return "symlink";
  }

  return "other";
}

function getHostedBundleArchiveFileByteSize(file: HostedBundleArchiveFile): number {
  if (isHostedBundleArtifactEntry(file)) {
    return file.artifact.byteSize;
  }

  return Buffer.byteLength(file.contentsBase64, "base64");
}

function summarizeHostedCheckpointDebugEntries(
  entries: readonly HostedCheckpointDebugEntry[],
  archiveFileCount: number | null,
): HostedCheckpointDebugSummary {
  const summary = {
    archiveFileCount,
    artifactCount: 0,
    descendedDirectoryCount: 0,
    directoryCount: 0,
    entryCount: entries.length,
    excludedDecisionCount: 0,
    fileCount: 0,
    includedDecisionCount: 0,
    otherCount: 0,
    symlinkCount: 0,
    unknownCount: 0,
  };

  for (const entry of entries) {
    if (entry.decision === "descend") {
      summary.descendedDirectoryCount += 1;
    } else if (entry.decision === "include") {
      summary.includedDecisionCount += 1;
    } else if (entry.decision === "exclude") {
      summary.excludedDecisionCount += 1;
    }

    if (entry.type === "artifact") {
      summary.artifactCount += 1;
    } else if (entry.type === "directory") {
      summary.directoryCount += 1;
    } else if (entry.type === "file") {
      summary.fileCount += 1;
    } else if (entry.type === "symlink") {
      summary.symlinkCount += 1;
    } else if (entry.type === "unknown") {
      summary.unknownCount += 1;
    } else {
      summary.otherCount += 1;
    }
  }

  return summary;
}

async function collectBundleFiles(input: {
  assertSnapshotLive?: () => Promise<void> | void;
  debugTrace: HostedCheckpointDebugTrace | null;
  externalizeFile?: (input: HostedBundleArtifactSnapshotInput) => Promise<HostedBundleArtifactRef | null>;
  root: string;
  rootKey: string;
  shouldIncludeRelativePath: (relativePath: string) => boolean;
  relativeDirectory?: string;
}): Promise<HostedBundleArchiveFile[]> {
  const relativeDirectory = input.relativeDirectory ?? "";
  const directoryPath = relativeDirectory ? path.join(input.root, relativeDirectory) : input.root;
  await input.assertSnapshotLive?.();
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: HostedBundleArchiveFile[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    await input.assertSnapshotLive?.();
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name)
      : entry.name;
    const entryType = getHostedCheckpointDebugEntryType(entry);

    if (!input.shouldIncludeRelativePath(relativePath)) {
      recordHostedCheckpointDebugEntry(input.debugTrace, {
        decision: "exclude",
        path: relativePath,
        reason: "policy_excluded",
        root: input.rootKey,
        source: "walk",
        type: entryType,
      });
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      recordHostedCheckpointDebugEntry(input.debugTrace, {
        decision: "descend",
        path: relativePath,
        reason: "policy_included",
        root: input.rootKey,
        source: "walk",
        type: "directory",
      });
      files.push(
        ...(await collectBundleFiles({
          ...input,
          relativeDirectory: path.join(relativeDirectory, entry.name),
        })),
      );
      continue;
    }

    if (!entry.isFile()) {
      recordHostedCheckpointDebugEntry(input.debugTrace, {
        decision: "exclude",
        path: relativePath,
        reason: "unsupported_type",
        root: input.rootKey,
        source: "walk",
        type: entryType,
      });
      continue;
    }

    const bytes = new Uint8Array(await readFile(absolutePath));
    await input.assertSnapshotLive?.();
    const normalizedPath = normalizeBundlePath(relativePath);
    const artifact = input.externalizeFile
      ? await input.externalizeFile({
          absolutePath,
          bytes,
          path: normalizedPath,
          root: input.rootKey,
        })
      : null;

    if (artifact) {
      await input.assertSnapshotLive?.();
      recordHostedCheckpointDebugEntry(input.debugTrace, {
        bytes: artifact.byteSize,
        decision: "include",
        path: normalizedPath,
        reason: "externalized",
        root: input.rootKey,
        source: "walk",
        type: "file",
      });
      files.push({
        artifact,
        path: normalizedPath,
        root: input.rootKey,
      });
      continue;
    }

    recordHostedCheckpointDebugEntry(input.debugTrace, {
      bytes: bytes.byteLength,
      decision: "include",
      path: normalizedPath,
      reason: "inline",
      root: input.rootKey,
      source: "walk",
      type: "file",
    });
    files.push({
      contentsBase64: Buffer.from(bytes).toString("base64"),
      path: normalizedPath,
      root: input.rootKey,
    });
  }

  return files;
}

async function collectExplicitBundleFiles(input: {
  assertSnapshotLive?: () => Promise<void> | void;
  debugTrace: HostedCheckpointDebugTrace | null;
  explicitFiles: readonly string[];
  includedPaths: ReadonlySet<string>;
  externalizeFile?: (input: HostedBundleArtifactSnapshotInput) => Promise<HostedBundleArtifactRef | null>;
  root: string;
  rootKey: string;
}): Promise<HostedBundleArchiveFile[]> {
  const normalizedPaths = [...new Set(input.explicitFiles.map((explicitFile) =>
    normalizeBundlePath(explicitFile)
  ))].sort((left, right) => left.localeCompare(right));
  const files: HostedBundleArchiveFile[] = [];

  for (const normalizedPath of normalizedPaths) {
    await input.assertSnapshotLive?.();
    if (input.includedPaths.has(`${input.rootKey}:${normalizedPath}`)) {
      recordHostedCheckpointDebugEntry(input.debugTrace, {
        decision: "exclude",
        path: normalizedPath,
        reason: "already_included",
        root: input.rootKey,
        source: "explicit",
        type: "file",
      });
      continue;
    }

    if (!(await isBundledRegularFilePath(input.root, normalizedPath))) {
      recordHostedCheckpointDebugEntry(input.debugTrace, {
        decision: "exclude",
        path: normalizedPath,
        reason: "not_regular_file",
        root: input.rootKey,
        source: "explicit",
        type: "unknown",
      });
      throw new Error(`Hosted bundle explicit file is not a regular file for root "${input.rootKey}".`);
    }

    const absolutePath = path.join(
      input.root,
      ...normalizedPath.split(path.posix.sep),
    );
    const bytes = new Uint8Array(await readFile(absolutePath));
    await input.assertSnapshotLive?.();
    const artifact = input.externalizeFile
      ? await input.externalizeFile({
          absolutePath,
          bytes,
          path: normalizedPath,
          root: input.rootKey,
        })
      : null;

    if (artifact) {
      await input.assertSnapshotLive?.();
      recordHostedCheckpointDebugEntry(input.debugTrace, {
        bytes: artifact.byteSize,
        decision: "include",
        path: normalizedPath,
        reason: "externalized",
        root: input.rootKey,
        source: "explicit",
        type: "file",
      });
      files.push({
        artifact,
        path: normalizedPath,
        root: input.rootKey,
      });
      continue;
    }

    recordHostedCheckpointDebugEntry(input.debugTrace, {
      bytes: bytes.byteLength,
      decision: "include",
      path: normalizedPath,
      reason: "inline",
      root: input.rootKey,
      source: "explicit",
      type: "file",
    });
    files.push({
      contentsBase64: Buffer.from(bytes).toString("base64"),
      path: normalizedPath,
      root: input.rootKey,
    });
  }

  return files;
}

function appendHostedBundleFiles(
  files: HostedBundleArchiveFile[],
  includedPaths: Set<string>,
  candidates: readonly HostedBundleArchiveFile[],
  source: HostedCheckpointDebugEntrySource,
  debugTrace: HostedCheckpointDebugTrace | null,
): void {
  for (const candidate of candidates) {
    const normalizedPath = normalizeBundlePath(candidate.path);
    const pathKey = `${candidate.root}:${normalizedPath}`;
    if (includedPaths.has(pathKey)) {
      recordHostedCheckpointDebugEntry(debugTrace, {
        bytes: getHostedBundleArchiveFileByteSize(candidate),
        decision: "exclude",
        path: normalizedPath,
        reason: "already_included",
        root: candidate.root,
        source,
        type: isHostedBundleArtifactEntry(candidate) ? "artifact" : "file",
      });
      continue;
    }

    files.push({
      ...candidate,
      path: normalizedPath,
    });
    includedPaths.add(pathKey);
  }
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

async function hasLiveBundledFilePath(input: {
  relativePath: string;
  roots: readonly HostedBundleSnapshotRootInput[];
}): Promise<boolean> {
  for (const root of input.roots) {
    const shouldIncludeRelativePath = root.shouldIncludeRelativePath ?? (() => true);
    if (!shouldIncludeRelativePath(input.relativePath)) {
      continue;
    }

    if (await isBundledRegularFilePath(root.root, input.relativePath)) {
      return true;
    }
  }

  return false;
}

async function isBundledRegularFilePath(root: string, relativePath: string): Promise<boolean> {
  const segments = normalizeBundlePath(relativePath).split(path.posix.sep).filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  let currentPath = root;

  for (const [index, segment] of segments.entries()) {
    const nextPath = path.join(currentPath, segment);

    try {
      const entry = await lstat(nextPath);

      if (entry.isSymbolicLink()) {
        return false;
      }

      if (index === segments.length - 1) {
        return entry.isFile();
      }

      if (!entry.isDirectory()) {
        return false;
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return false;
      }

      throw error;
    }

    currentPath = nextPath;
  }

  return false;
}

async function assertHostedBundleRestorePathHasNoSymlinks(
  root: string,
  absolutePath: string,
  relativePath: string,
): Promise<void> {
  const absoluteRoot = path.resolve(root);
  const relative = path.relative(absoluteRoot, absolutePath);

  if (!relative || relative === ".") {
    return;
  }

  const segments = relative.split(path.sep).filter(Boolean);
  let currentPath = absoluteRoot;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const nextPath = path.join(currentPath, segment);

    try {
      const entry = await lstat(nextPath);

      if (entry.isSymbolicLink()) {
        throw new Error(`Hosted bundle restore path may not traverse symbolic links: ${relativePath}`);
      }

      if (index < segments.length - 1 && !entry.isDirectory()) {
        throw new Error(`Hosted bundle restore parent is not a directory: ${relativePath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }

    currentPath = nextPath;
  }
}

function isMissingPathError(error: unknown): boolean {
  return getNodeErrorCode(error) === "ENOENT";
}

function getNodeErrorCode(error: unknown): string | null {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;
}
