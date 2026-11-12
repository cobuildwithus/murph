import { createHash, createHmac } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import path from "node:path";
import { lstat, readFile, readdir, rm } from "node:fs/promises";

import { readHostedColdIngestReferences, HostedColdHistoryUnavailableError } from "./hosted-media-references.ts";

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

import { QUERY_PROJECTION_SECTION_RELATIVE_PATHS } from "./runtime-paths.ts";

const WORKSPACE_OPERATOR_HOME_ROOT = "operator-home";
const HOSTED_CODEX_HOME_RELATIVE_PATH = ".codex-hosted";

const HOSTED_QUERY_PROJECTION_SNAPSHOT_RELATIVE_PATHS: readonly string[] =
  Object.values(QUERY_PROJECTION_SECTION_RELATIVE_PATHS);
const HOSTED_CODEX_ROLLOUT_RELATIVE_PATH_PATTERN =
  /^sessions\/(\d{4})\/(\d{2})\/(\d{2})\/rollout-(\d{4})-(\d{2})-(\d{2})T[^/]+-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/u;
const HOSTED_CODEX_DURABLE_MEMORY_READ_ARTIFACT_RELATIVE_PATHS = new Set([
  "memories/MEMORY.md",
  "memories/memory_summary.md",
  "memories/raw_memories.md",
]);

const HOSTED_WORKSPACE_SNAPSHOT_DIAGNOSTIC_LIST_LIMIT = 16;
const HOSTED_CODEX_ROLLOUT_SCAN_MAX_FILES = 5_000;

export interface HostedCodexHomeSnapshotDiagnostics {
  codexResumeArchivedUnsupportedCount: number;
  codexResumeInvalidPathCount: number;
  codexResumeMissingRolloutCount: number;
  codexResumeRolloutBytes: number;
  codexResumeRolloutFileBytes: number[];
  codexResumeRolloutRelHashes: string[];
  codexResumeThreadCount: number;
}

export interface HostedWorkspaceSnapshotSizeDiagnostics {
  workspaceSnapshotArchiveArtifactCount: number | null;
  workspaceSnapshotArchiveFileCount: number | null;
  workspaceSnapshotArchiveInlineFileCount: number | null;
  workspaceSnapshotArchivePreservedArtifactCandidateCount: number | null;
  workspaceSnapshotArchivePreservedArtifactIncludedCount: number | null;
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

export interface HostedWorkspaceSnapshotArchiveEntry {
  absolutePath: string;
  archivePath: string;
  kind: "directory" | "file";
  relativePath: string;
  root: "operator-home" | "vault";
  size: number | null;
}

export interface HostedWorkspaceSnapshotArchivePlan {
  codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null;
  directoryCount: number;
  entries: HostedWorkspaceSnapshotArchiveEntry[];
  fileCount: number;
  totalPlainBytes: number;
}

export interface HostedWorkspaceSnapshotArchiveExtraPath {
  path: string;
  root: "operator-home" | "vault";
}

export function createHostedWorkspaceSnapshotArchivePlanSizeDiagnostics(input: {
  archivePlan: HostedWorkspaceSnapshotArchivePlan;
  hashSecret?: string | null;
}): HostedWorkspaceSnapshotSizeDiagnostics {
  const hashSecret = normalizeHostedCodexHomeSnapshotHashSecret(input.hashSecret);
  const classMetrics = new Map<string, HostedWorkspaceSnapshotClassMetrics>();
  const largestFiles: HostedWorkspaceSnapshotLargestFileMetric[] = [];
  let fileCount = 0;
  let inlineBytes = 0;
  let maxFileBytes = 0;
  let maxFileClass: string | null = null;

  for (const entry of input.archivePlan.entries) {
    if (entry.kind !== "file") continue;
    const bytes = entry.size ?? 0;
    const className = classifyHostedWorkspaceSnapshotArtifact({
      path: entry.relativePath,
      root: entry.root,
    });
    const metrics = classMetrics.get(className) ?? { fileCount: 0, inlineBytes: 0 };
    metrics.fileCount += 1;
    metrics.inlineBytes += bytes;
    classMetrics.set(className, metrics);
    fileCount += 1;
    inlineBytes += bytes;
    if (bytes > maxFileBytes) {
      maxFileBytes = bytes;
      maxFileClass = className;
    }
    largestFiles.push({
      bytes,
      className,
      depth: hostedWorkspaceSnapshotPathDepth(entry.relativePath),
      extension: hostedWorkspaceSnapshotSafeExtension(entry.relativePath),
      relHash: hashSecret
        ? fingerprintHostedWorkspaceSnapshotRelativePath({
            hashSecret,
            relativePath: entry.relativePath,
            root: entry.root,
          })
        : null,
      root: entry.root,
    });
    largestFiles.sort((left, right) => right.bytes - left.bytes);
    largestFiles.splice(HOSTED_WORKSPACE_SNAPSHOT_DIAGNOSTIC_LIST_LIMIT);
  }

  return {
    workspaceSnapshotArchiveArtifactCount: null,
    workspaceSnapshotArchiveFileCount: null,
    workspaceSnapshotArchiveInlineFileCount: null,
    workspaceSnapshotArchivePreservedArtifactCandidateCount: null,
    workspaceSnapshotArchivePreservedArtifactIncludedCount: null,
    workspaceSnapshotClassSummary: summarizeHostedWorkspaceSnapshotClasses(classMetrics),
    workspaceSnapshotExternalArtifactBytes: 0,
    workspaceSnapshotExternalArtifactCount: 0,
    workspaceSnapshotFingerprintStatus: hashSecret ? "enabled" : "disabled",
    workspaceSnapshotIncludedFileCount: fileCount,
    workspaceSnapshotInlineBytes: inlineBytes,
    workspaceSnapshotLargestFiles: summarizeHostedWorkspaceSnapshotLargestFiles(largestFiles),
    workspaceSnapshotMaxFileBytes: maxFileBytes,
    workspaceSnapshotMaxFileClass: maxFileClass,
  };
}

interface HostedCodexContinuityEntry {
  byteSize: number;
  codexRolloutRelativePath: string;
}

interface HostedCodexContinuityCollection {
  archivedUnsupportedCount: number;
  entries: HostedCodexContinuityEntry[];
  invalidPathCount: number;
  missingRolloutCount: number;
  requestedThreadCount: number;
}

export async function pruneHostedCodexHomeToSessionReferencedRollouts(input: {
  assistantStateRoot: string;
  nativeMemoryRetention?: "none" | "read-artifacts";
  operatorHomeRoot: string;
}): Promise<void> {
  const requirements = await readAssistantSessionProviderResumeRequirements(input.assistantStateRoot);
  const retainedRelativePaths = new Set<string>(
    input.nativeMemoryRetention === "read-artifacts"
      ? HOSTED_CODEX_DURABLE_MEMORY_READ_ARTIFACT_RELATIVE_PATHS
      : [],
  );
  for (const requirement of requirements) {
    const normalized = normalizeHostedCodexRolloutRelativePathForProvider({
      providerSessionId: requirement.providerSessionId,
      value: requirement.codexRolloutRelativePath,
    });
    if (normalized.reason === null) {
      retainedRelativePaths.add(normalized.relativePath);
    }
  }
  // The pruning walk validates the root, ancestors, and retained regular files.
  // Snapshot collection also inspects each rollout's ancestors and byte size;
  // doing that here would repeat the same filesystem work without using its sizes.
  await pruneHostedCodexHomeRoot({
    operatorHomeRoot: input.operatorHomeRoot,
    retainedRelativePaths,
  });
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

export async function collectHostedWorkspaceSnapshotArchivePlan(input: {
  codexHomeSnapshotHashSecret?: string | null;
  durableRoot: string;
  excludedVaultPaths?: readonly string[];
  extraFiles?: readonly HostedWorkspaceSnapshotArchiveExtraPath[];
  operatorHomeRoot?: string | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedWorkspaceSnapshotArchivePlan> {
  assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
  const durableRoot = path.resolve(input.durableRoot);
  const vaultRoot = path.resolve(input.vaultRoot);
  if (!isSameOrDescendantWorkspaceSnapshotPath(vaultRoot, durableRoot)) {
    throw new Error("Hosted workspace snapshot vault root must be inside durableRoot.");
  }

  const entries: HostedWorkspaceSnapshotArchiveEntry[] = [];
  let codexHomeSnapshotDiagnostics: HostedCodexHomeSnapshotDiagnostics | null = null;
  const excludedVaultPaths = createHostedWorkspaceSnapshotExcludedPathSet(
    input.excludedVaultPaths ?? [],
  );
  const explicitVaultFiles = createHostedWorkspaceSnapshotExtraFileSet({
    entries: input.extraFiles ?? [],
    root: "vault",
  });
  const explicitOperatorHomeFiles = createHostedWorkspaceSnapshotExtraFileSet({
    entries: input.extraFiles ?? [],
    root: "operator-home",
  });

  await collectHostedWorkspaceRootArchiveEntries({
    durableRoot,
    entries,
    excludedRelativePaths: excludedVaultPaths,
    explicitRelativePaths: explicitVaultFiles,
    includeRelativePath: (relativePath) =>
      shouldIncludeWorkspaceSnapshotVaultRelativePath(relativePath),
    root: "vault",
    rootPath: vaultRoot,
    signal: input.signal,
  });
  // A full archive/export must contain verified history. Only the checkpoint
  // publisher may explicitly exclude objects already represented by its catalogue.
  for (const reference of await readHostedColdIngestReferences(vaultRoot)) {
    if (excludedVaultPaths.has(reference.relativePath)) continue;
    const entry = entries.find((entry) => entry.root === "vault" && entry.relativePath === reference.relativePath);
    if (!entry || entry.kind !== "file" || entry.size !== reference.byteSize) throw new HostedColdHistoryUnavailableError();
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(entry.absolutePath)) {
      assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
      hash.update(chunk);
    }
    if (hash.digest("hex") !== reference.sha256) throw new HostedColdHistoryUnavailableError();
  }
  assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);

  const operatorHomeRoot = input.operatorHomeRoot ? path.resolve(input.operatorHomeRoot) : null;
  const portableOperatorHomeRoot =
    operatorHomeRoot && isSameOrDescendantWorkspaceSnapshotPath(operatorHomeRoot, durableRoot)
      ? operatorHomeRoot
      : null;
  if (portableOperatorHomeRoot) {
    const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const codexContinuityCollection = await collectHostedCodexContinuity({
      assistantStateRoot,
      operatorHomeRoot: portableOperatorHomeRoot,
      signal: input.signal,
    });
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    codexHomeSnapshotDiagnostics = createHostedCodexContinuityDiagnostics({
      collection: codexContinuityCollection,
      hashSecret: input.codexHomeSnapshotHashSecret,
    });

    for (const relativePath of createHostedCodexContinuitySnapshotExplicitFiles(
      codexContinuityCollection,
    )) {
      explicitOperatorHomeFiles.add(relativePath);
    }
    for (const relativePath of HOSTED_CODEX_DURABLE_MEMORY_READ_ARTIFACT_RELATIVE_PATHS) {
      explicitOperatorHomeFiles.add(
        `${HOSTED_CODEX_HOME_RELATIVE_PATH}${path.posix.sep}${relativePath}`,
      );
    }
  } else {
    const missingCodexContinuity = await collectMissingHostedCodexContinuity(
      resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
      input.signal,
    );
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    codexHomeSnapshotDiagnostics = createHostedCodexContinuityDiagnostics({
      collection: missingCodexContinuity,
      hashSecret: input.codexHomeSnapshotHashSecret,
    });
  }

  if (portableOperatorHomeRoot) {
    await collectHostedWorkspaceRootArchiveEntries({
      durableRoot,
      entries,
      explicitRelativePaths: explicitOperatorHomeFiles,
      includeRelativePath: () => false,
      root: "operator-home",
      rootPath: portableOperatorHomeRoot,
      signal: input.signal,
    });
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
  } else if (explicitOperatorHomeFiles.size > 0) {
    throw new Error("Hosted workspace snapshot operator home root must be inside durableRoot.");
  }

  assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
  entries.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
  assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
  return {
    codexHomeSnapshotDiagnostics,
    directoryCount: entries.filter((entry) => entry.kind === "directory").length,
    entries,
    fileCount: entries.filter((entry) => entry.kind === "file").length,
    totalPlainBytes: entries.reduce(
      (total, entry) => total + (entry.kind === "file" ? entry.size ?? 0 : 0),
      0,
    ),
  };
}

function createHostedWorkspaceSnapshotExcludedPathSet(
  paths: readonly string[],
): Set<string> {
  const excluded = new Set<string>();
  for (const candidate of paths) {
    const relativePath = normalizeWorkspaceSnapshotRelativePath(candidate);
    assertHostedWorkspaceSnapshotRelativePathSafe(relativePath);
    if (relativePath.length > 0) {
      excluded.add(relativePath);
    }
  }
  return excluded;
}

function createHostedWorkspaceSnapshotExtraFileSet(input: {
  entries: readonly HostedWorkspaceSnapshotArchiveExtraPath[];
  root: "operator-home" | "vault";
}): Set<string> {
  const included = new Set<string>();
  for (const entry of input.entries) {
    if (entry.root !== input.root) {
      continue;
    }
    const relativePath = normalizeWorkspaceSnapshotRelativePath(entry.path);
    if (input.root === "vault") {
      if (shouldIncludeWorkspaceSnapshotVaultRelativePath(relativePath)) {
        included.add(relativePath);
      }
    }
  }
  return included;
}

async function collectHostedWorkspaceRootArchiveEntries(input: {
  durableRoot: string;
  entries: HostedWorkspaceSnapshotArchiveEntry[];
  excludedRelativePaths?: ReadonlySet<string>;
  explicitRelativePaths?: ReadonlySet<string>;
  includeRelativePath(relativePath: string): boolean;
  root: "operator-home" | "vault";
  rootPath: string;
  signal?: AbortSignal | null;
}): Promise<void> {
  assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
  const rootPath = path.resolve(input.rootPath);
  const rootArchivePrefix = normalizeWorkspaceSnapshotRelativePath(
    path.relative(input.durableRoot, rootPath).split(path.sep).join(path.posix.sep),
  );
  if (
    rootArchivePrefix === ".."
    || rootArchivePrefix.startsWith(`..${path.posix.sep}`)
    || path.posix.isAbsolute(rootArchivePrefix)
  ) {
    throw new Error("Hosted workspace snapshot root escaped durableRoot.");
  }

  const explicitRelativePaths = input.explicitRelativePaths ?? new Set<string>();
  const excludedRelativePaths = input.excludedRelativePaths ?? new Set<string>();

  function hasExplicitDescendant(relativePath: string): boolean {
    return [...explicitRelativePaths].some((explicitPath) =>
      relativePath.length === 0
      || explicitPath === relativePath
      || explicitPath.startsWith(`${relativePath}${path.posix.sep}`)
    );
  }

  async function visit(currentPath: string): Promise<void> {
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    const filesystemRelativePath = path.relative(rootPath, currentPath);
    const relativePath = normalizeWorkspaceSnapshotRelativePath(
      filesystemRelativePath.split(path.sep).join(path.posix.sep),
    );
    assertHostedWorkspaceSnapshotRelativePathSafe(relativePath);
    if (hasHostedWorkspaceSnapshotExcludedPath(relativePath, excludedRelativePaths)) {
      return;
    }
    const policyIncluded = relativePath.length > 0 && input.includeRelativePath(relativePath);
    const explicitIncluded = explicitRelativePaths.has(relativePath);
    const explicitDescendant = hasExplicitDescendant(relativePath);
    const archivePath = joinHostedWorkspaceArchivePath(rootArchivePrefix, relativePath);
    if (relativePath.length > 0 && !policyIncluded && !explicitDescendant) {
      return;
    }
    let stats;
    try {
      stats = await lstat(currentPath);
    } catch (error) {
      assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
      // An uninitialized root is optional; a vanished descendant invalidates
      // the inventory and must never publish a partial replacement snapshot.
      if (currentPath === rootPath && isMissingPathError(error)) {
        return;
      }
      throw error;
    }
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    if (stats.isSymbolicLink()) {
      throw new Error("Hosted workspace snapshot durable root contains symlinks.");
    }
    if (stats.isSocket() || stats.isFIFO() || stats.isBlockDevice() || stats.isCharacterDevice()) {
      throw new Error("Hosted workspace snapshot durable root contains unsupported special files.");
    }

    if (stats.isFile()) {
      if (!policyIncluded && !explicitIncluded) {
        return;
      }
      if (stats.nlink > 1) {
        throw new Error("Hosted workspace snapshot durable root contains hardlinks.");
      }
      input.entries.push({
        absolutePath: currentPath,
        archivePath,
        kind: "file",
        relativePath,
        root: input.root,
        size: stats.size,
      });
      return;
    }

    if (!stats.isDirectory()) {
      throw new Error("Hosted workspace snapshot durable root contains unsupported entries.");
    }

    const descendantStart = input.entries.length;
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    const children = await readdir(currentPath);
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    for (const child of children.sort((left, right) => left.localeCompare(right))) {
      assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
      await visit(path.join(currentPath, child));
      assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    }

    // Every retained descendant below these roots leads to an included file.
    // Keep the roots and all other directory entries, which carry restore modes.
    if (isEmptyHostedWorkspaceInboxDirectory(input.root, filesystemRelativePath, input.entries.length - descendantStart)) {
      return;
    }

    if (archivePath.length > 0 && (policyIncluded || explicitDescendant || relativePath.length === 0)) {
      input.entries.push({
        absolutePath: currentPath,
        archivePath,
        kind: "directory",
        relativePath,
        root: input.root,
        size: null,
      });
    }
  }

  try {
    await visit(rootPath);
  } finally {
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
  }
}

function isEmptyHostedWorkspaceInboxDirectory(
  root: "operator-home" | "vault",
  filesystemRelativePath: string,
  includedDescendantCount: number,
): boolean {
  return root === "vault"
    && includedDescendantCount === 0
    && (filesystemRelativePath.startsWith(`raw${path.sep}inbox${path.sep}`)
      || filesystemRelativePath.startsWith(`derived${path.sep}inbox${path.sep}`));
}

function hasHostedWorkspaceSnapshotExcludedPath(
  relativePath: string,
  excludedRelativePaths: ReadonlySet<string>,
): boolean {
  let candidate = relativePath;
  while (candidate.length > 0 && candidate !== ".") {
    if (excludedRelativePaths.has(candidate)) {
      return true;
    }
    const parent = path.posix.dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }
  return false;
}

function assertHostedWorkspaceSnapshotArchivePlanLive(
  signal: AbortSignal | null | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted workspace snapshot archive planning was interrupted.");
}

function joinHostedWorkspaceArchivePath(prefix: string, relativePath: string): string {
  const normalizedPrefix = normalizeWorkspaceSnapshotRelativePath(prefix);
  const normalizedRelativePath = normalizeWorkspaceSnapshotRelativePath(relativePath);
  if (normalizedPrefix.length === 0) {
    return normalizedRelativePath;
  }
  if (normalizedRelativePath.length === 0) {
    return normalizedPrefix;
  }
  return `${normalizedPrefix}/${normalizedRelativePath}`;
}

function isSameOrDescendantWorkspaceSnapshotPath(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertHostedWorkspaceSnapshotRelativePathSafe(relativePath: string): void {
  if (
    relativePath.includes("\u0000")
    || /[\u0001-\u001f\u007f]/u.test(relativePath)
    || path.posix.isAbsolute(relativePath)
    || relativePath === ".."
    || relativePath.startsWith("../")
    || relativePath.includes("/../")
    || relativePath.endsWith("/..")
  ) {
    throw new Error("Hosted workspace snapshot path is unsafe.");
  }
}

interface HostedWorkspaceSnapshotClassMetrics {
  fileCount: number;
  inlineBytes: number;
}

interface HostedWorkspaceSnapshotLargestFileMetric {
  bytes: number;
  className: string;
  depth: number;
  extension: string;
  relHash: string | null;
  root: string;
}

function summarizeHostedWorkspaceSnapshotClasses(
  metrics: ReadonlyMap<string, HostedWorkspaceSnapshotClassMetrics>,
): string[] {
  return [...metrics.entries()]
    .sort(([leftClass, left], [rightClass, right]) => {
      const leftBytes = left.inlineBytes;
      const rightBytes = right.inlineBytes;
      return rightBytes - leftBytes || leftClass.localeCompare(rightClass);
    })
    .slice(0, HOSTED_WORKSPACE_SNAPSHOT_DIAGNOSTIC_LIST_LIMIT)
    .map(([className, entry]) =>
      [
        `class=${className}`,
        `files=${entry.fileCount}`,
        `inlineBytes=${entry.inlineBytes}`,
        "externalBytes=0",
        "externalCount=0",
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
        "external=0",
        `ext=${entry.extension}`,
        `depth=${entry.depth}`,
        `relHash=${entry.relHash ?? "disabled"}`,
      ].join(","));
}

function classifyHostedWorkspaceSnapshotArtifact(artifact: {
  path: string;
  root: string;
}): string {
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

  const resumeState =
    recordProperty(parsed, "codexResume") ?? recordProperty(parsed, "resumeState");
  const providerSessionId =
    recordStringProperty(resumeState, "threadId")
    ?? recordStringProperty(resumeState, "providerSessionId")
    ?? recordStringProperty(parsed, "codexThreadId")
    ?? recordStringProperty(parsed, "providerSessionId");
  if (!providerSessionId) {
    return [];
  }
  const routeFingerprint =
    recordStringProperty(resumeState, "routeFingerprint")
    ?? recordStringProperty(resumeState, "resumeRouteId")
    ?? recordStringProperty(parsed, "routeFingerprint")
    ?? recordStringProperty(parsed, "resumeRouteId");
  if (!routeFingerprint) {
    return [];
  }
  const target =
    recordProperty(parsed, "codexTarget") ?? recordProperty(parsed, "target");
  const targetAdapter = recordStringProperty(target, "adapter");
  if (targetAdapter && targetAdapter !== "codex-cli") {
    return [];
  }

  return [{
    codexRolloutRelativePath:
      recordStringProperty(resumeState, "rolloutRelativePath")
      ?? recordStringProperty(resumeState, "codexRolloutRelativePath"),
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

function shouldIncludeWorkspaceSnapshotRuntimeRelativePath(relativePath: string): boolean {
  if (isHostedQueryProjectionSnapshotRelativePath(relativePath)) {
    return true;
  }
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

function isHostedQueryProjectionSnapshotRelativePath(relativePath: string): boolean {
  return HOSTED_QUERY_PROJECTION_SNAPSHOT_RELATIVE_PATHS.some(
    (queryProjectionPath) =>
      relativePath === queryProjectionPath
      || isStrictAncestorPath(relativePath, queryProjectionPath),
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
    || isAssistantRuntimeEventLogRelativePath(relativePath)
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

function isAssistantRuntimeEventLogRelativePath(relativePath: string): boolean {
  return ASSISTANT_RUNTIME_EVENT_LOG_PATHS.some((eventLogPath) =>
    relativePath === eventLogPath || relativePath.startsWith(`${eventLogPath}.`),
  );
}

function isDotGitRelativePath(relativePath: string): boolean {
  return relativePath === ".git" || relativePath.startsWith(`.git${path.posix.sep}`);
}

function isEnvironmentRelativePath(relativePath: string): boolean {
  return path.posix.basename(relativePath).startsWith(".env");
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
    invalidPathCount: 0,
    missingRolloutCount: 0,
    requestedThreadCount: 0,
  };
}

async function collectMissingHostedCodexContinuity(
  assistantStateRoot: string,
  signal?: AbortSignal | null,
): Promise<HostedCodexContinuityCollection> {
  assertHostedWorkspaceSnapshotArchivePlanLive(signal);
  const requirements = await readAssistantSessionProviderResumeRequirements(
    assistantStateRoot,
    signal,
  );
  assertHostedWorkspaceSnapshotArchivePlanLive(signal);
  if (requirements.length === 0) {
    return createEmptyHostedCodexContinuityCollection();
  }

  return {
    archivedUnsupportedCount: 0,
    entries: [],
    invalidPathCount: 0,
    missingRolloutCount: requirements.length,
    requestedThreadCount: requirements.length,
  };
}

async function collectHostedCodexContinuity(input: {
  assistantStateRoot: string;
  operatorHomeRoot: string;
  signal?: AbortSignal | null;
}): Promise<HostedCodexContinuityCollection> {
  assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
  const requirements = await readAssistantSessionProviderResumeRequirements(
    input.assistantStateRoot,
    input.signal,
  );
  assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
  const codexHomeRoot = path.join(input.operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH);
  const entries: HostedCodexContinuityEntry[] = [];
  let archivedUnsupportedCount = 0;
  let invalidPathCount = 0;
  let missingRolloutCount = 0;

  for (const requirement of requirements) {
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    const normalizedPath = normalizeHostedCodexRolloutRelativePathForProvider({
      providerSessionId: requirement.providerSessionId,
      value: requirement.codexRolloutRelativePath,
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
      signal: input.signal,
    });
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    if (!rolloutFile) {
      missingRolloutCount += 1;
      continue;
    }

    entries.push({
      byteSize: rolloutFile.stats.size,
      codexRolloutRelativePath: normalizedPath.relativePath,
    });
  }

  return {
    archivedUnsupportedCount,
    entries,
    invalidPathCount,
    missingRolloutCount,
    requestedThreadCount: requirements.length,
  };
}

async function inspectHostedCodexRolloutFile(input: {
  codexHomeRoot: string;
  relativePath: string;
  signal?: AbortSignal | null;
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
    assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    const nextPath = path.join(currentPath, segment);
    let entry: Stats;
    try {
      entry = await lstat(nextPath);
      assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
    } catch {
      assertHostedWorkspaceSnapshotArchivePlanLive(input.signal);
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

async function pruneHostedCodexHomeRoot(input: {
  operatorHomeRoot: string;
  retainedRelativePaths: ReadonlySet<string>;
}): Promise<void> {
  const codexHomeRoot = path.join(input.operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH);
  let codexHomeStats: Stats;
  try {
    codexHomeStats = await lstat(codexHomeRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }
    throw error;
  }

  if (
    codexHomeStats.isSymbolicLink()
    || !codexHomeStats.isDirectory()
  ) {
    await rm(codexHomeRoot, { force: true, recursive: true });
    return;
  }

  const keptAny = await pruneHostedCodexHomeDirectory({
    directoryPath: codexHomeRoot,
    relativePath: "",
    retainedRelativePaths: input.retainedRelativePaths,
  });
  if (!keptAny) {
    await rm(codexHomeRoot, { force: true, recursive: true });
  }
}

async function pruneHostedCodexHomeDirectory(input: {
  directoryPath: string;
  relativePath: string;
  retainedRelativePaths: ReadonlySet<string>;
}): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(input.directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }

  let keptAny = false;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(input.directoryPath, entry.name);
    const entryRelativePath = input.relativePath
      ? `${input.relativePath}${path.posix.sep}${entry.name}`
      : entry.name;
    if (
      entry.isDirectory()
      && [...input.retainedRelativePaths].some((retainedPath) =>
        isStrictAncestorPath(entryRelativePath, retainedPath)
      )
    ) {
      if (await pruneHostedCodexHomeDirectory({
        directoryPath: entryPath,
        relativePath: entryRelativePath,
        retainedRelativePaths: input.retainedRelativePaths,
      })) {
        keptAny = true;
        continue;
      }
    } else if (entry.isFile() && input.retainedRelativePaths.has(entryRelativePath)) {
      try {
        const fileStats = await lstat(entryPath);
        if (fileStats.isFile() && fileStats.nlink === 1) {
          keptAny = true;
          continue;
        }
      } catch (error) {
        if (isMissingPathError(error)) {
          continue;
        }
        throw error;
      }
    }
    // No retained descendant needs this subtree. Delete it directly rather than
    // listing every private cache file first. rm does not follow symbolic links.
    await rm(entryPath, { force: true, recursive: true });
  }

  // Restore owns a quiescent Codex home, so the completed walk is the result;
  // a second directory listing would only rediscover the files we just kept.
  return keptAny;
}

function createHostedCodexContinuityDiagnostics(input: {
  collection: HostedCodexContinuityCollection;
  hashSecret?: string | null;
}): HostedCodexHomeSnapshotDiagnostics | null {
  if (
    input.collection.requestedThreadCount === 0
    && input.collection.entries.length === 0
    && input.collection.missingRolloutCount === 0
    && input.collection.invalidPathCount === 0
    && input.collection.archivedUnsupportedCount === 0
  ) {
    return null;
  }

  const hashSecret = normalizeHostedCodexHomeSnapshotHashSecret(input.hashSecret);
  return {
    codexResumeArchivedUnsupportedCount: input.collection.archivedUnsupportedCount,
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

async function readAssistantSessionProviderResumeRequirements(
  assistantStateRoot: string,
  signal?: AbortSignal | null,
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
    assertHostedWorkspaceSnapshotArchivePlanLive(signal);
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
      assertHostedWorkspaceSnapshotArchivePlanLive(signal);
    } catch {
      assertHostedWorkspaceSnapshotArchivePlanLive(signal);
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      assertHostedWorkspaceSnapshotArchivePlanLive(signal);
      if (visitedFiles > HOSTED_CODEX_ROLLOUT_SCAN_MAX_FILES) {
        return;
      }

      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        assertHostedWorkspaceSnapshotArchivePlanLive(signal);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      visitedFiles += 1;
      let text: string;
      try {
        text = await readFile(absolutePath, "utf8");
      } catch (error) {
        assertHostedWorkspaceSnapshotArchivePlanLive(signal);
        throw error;
      }
      assertHostedWorkspaceSnapshotArchivePlanLive(signal);
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

  assertHostedWorkspaceSnapshotArchivePlanLive(signal);
  await visit(sessionsRoot);
  assertHostedWorkspaceSnapshotArchivePlanLive(signal);
  return dedupeAssistantSessionProviderResumeRequirements(requirements);
}

function dedupeAssistantSessionProviderResumeRequirements(
  requirements: Array<{
    codexRolloutRelativePath: string | null;
    providerSessionId: string;
  }>,
): Array<{
  codexRolloutRelativePath: string | null;
  providerSessionId: string;
}> {
  const seen = new Set<string>();
  const uniqueRequirements: Array<{
    codexRolloutRelativePath: string | null;
    providerSessionId: string;
  }> = [];

  for (const requirement of requirements) {
    const key = `${requirement.providerSessionId}\0${requirement.codexRolloutRelativePath ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueRequirements.push(requirement);
  }

  return uniqueRequirements;
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

const ASSISTANT_RUNTIME_EXCLUDED_PATH_PREFIXES = [
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/status.json`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/secrets`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/quarantine`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/outbox/.quarantine`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/usage`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/.locks`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/.runtime-write.lock`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/.automation-run.lock`,
] as const;
const ASSISTANT_RUNTIME_EVENT_LOG_PATHS = [
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/diagnostics/events.jsonl`,
  `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/journals/runtime-events.jsonl`,
] as const;
