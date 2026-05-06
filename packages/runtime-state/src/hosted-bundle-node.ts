import path from "node:path";
import { chmod, lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";

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

export async function snapshotHostedBundleRoots(input: {
  externalizeFile?: (input: HostedBundleArtifactSnapshotInput) => Promise<HostedBundleArtifactRef | null>;
  kind: HostedExecutionBundleKind;
  materializedPreservedArtifactPaths?: ReadonlySet<string>;
  onBeforeSerialize?: () => Promise<void> | void;
  preservedArtifacts?: readonly HostedBundleArtifactLocation[];
  roots: readonly HostedBundleSnapshotRootInput[];
  shouldIncludePreservedArtifact?: (
    input: HostedBundleArtifactLocation,
  ) => boolean | Promise<boolean>;
}): Promise<Uint8Array | null> {
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
        externalizeFile: input.externalizeFile,
        root: root.root,
        rootKey: root.rootKey,
        shouldIncludeRelativePath: root.shouldIncludeRelativePath ?? (() => true),
      }),
    );
    appendHostedBundleFiles(
      files,
      includedPaths,
      await collectExplicitBundleFiles({
        explicitFiles: root.explicitFiles ?? [],
        includedPaths,
        externalizeFile: input.externalizeFile,
        root: root.root,
        rootKey: root.rootKey,
      }),
    );
  }

  if (includedRootCount === 0) {
    return null;
  }

  const materializedPreservedArtifactPaths = input.materializedPreservedArtifactPaths ?? new Set<string>();
  for (const artifact of input.preservedArtifacts ?? []) {
    if (!configuredRootsByKey.has(artifact.root)) {
      throw new Error(`Hosted bundle preserved artifact root "${artifact.root}" is not configured for snapshot.`);
    }

    const normalizedPath = normalizeBundlePath(artifact.path);
    const preservedPathKey = `${artifact.root}:${normalizedPath}`;
    if (includedPaths.has(preservedPathKey)) {
      continue;
    }

    if (input.shouldIncludePreservedArtifact) {
      const shouldIncludePreservedArtifact = await input.shouldIncludePreservedArtifact({
        ...artifact,
        path: normalizedPath,
      });
      if (!shouldIncludePreservedArtifact) {
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
      continue;
    }

    files.push({
      artifact: artifact.ref,
      path: normalizedPath,
      root: artifact.root,
    });
    includedPaths.add(preservedPathKey);
  }

  await input.onBeforeSerialize?.();

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
  roots: HostedBundleRestoreRootMap;
  shouldRestoreArtifact?: HostedBundleArtifactRestoreFilter;
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
  roots: HostedBundleRestoreRootMap;
  shouldRestoreArtifact?: HostedBundleArtifactRestoreFilter;
  includeInlineFiles: boolean;
}): Promise<void> {
  const archive = parseHostedBundleArchive(input.bytes);
  const ignoredRoots = new Set(input.ignoredRoots ?? []);

  if (archive.kind !== input.expectedKind) {
    throw new Error(
      `Hosted bundle kind mismatch: expected ${input.expectedKind}, got ${archive.kind}.`,
    );
  }

  for (const file of archive.files) {
    const root = input.roots[file.root];

    if (!root) {
      if (ignoredRoots.has(file.root)) {
        continue;
      }

      throw new Error(`Hosted bundle root "${file.root}" is not mapped for restore.`);
    }

    if (!isHostedBundleArtifactEntry(file) && !input.includeInlineFiles) {
      continue;
    }

    const absolutePath = resolveHostedBundleRestorePath(root, file.path);
    await assertHostedBundleRestorePathHasNoSymlinks(root, absolutePath, file.path);

    if (isHostedBundleArtifactEntry(file)) {
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

    await writeHostedBundleRestoredFile({
      absolutePath,
      bytes: Buffer.from(file.contentsBase64, "base64"),
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

async function collectBundleFiles(input: {
  externalizeFile?: (input: HostedBundleArtifactSnapshotInput) => Promise<HostedBundleArtifactRef | null>;
  root: string;
  rootKey: string;
  shouldIncludeRelativePath: (relativePath: string) => boolean;
  relativeDirectory?: string;
}): Promise<HostedBundleArchiveFile[]> {
  const relativeDirectory = input.relativeDirectory ?? "";
  const directoryPath = relativeDirectory ? path.join(input.root, relativeDirectory) : input.root;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: HostedBundleArchiveFile[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name)
      : entry.name;

    if (!input.shouldIncludeRelativePath(relativePath)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(
        ...(await collectBundleFiles({
          ...input,
          relativeDirectory: path.join(relativeDirectory, entry.name),
        })),
      );
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const bytes = new Uint8Array(await readFile(absolutePath));
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
      files.push({
        artifact,
        path: normalizedPath,
        root: input.rootKey,
      });
      continue;
    }

    files.push({
      contentsBase64: Buffer.from(bytes).toString("base64"),
      path: normalizedPath,
      root: input.rootKey,
    });
  }

  return files;
}

async function collectExplicitBundleFiles(input: {
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
    if (input.includedPaths.has(`${input.rootKey}:${normalizedPath}`)) {
      continue;
    }

    if (!(await isBundledRegularFilePath(input.root, normalizedPath))) {
      throw new Error(`Hosted bundle explicit file is not a regular file for root "${input.rootKey}".`);
    }

    const absolutePath = path.join(
      input.root,
      ...normalizedPath.split(path.posix.sep),
    );
    const bytes = new Uint8Array(await readFile(absolutePath));
    const artifact = input.externalizeFile
      ? await input.externalizeFile({
          absolutePath,
          bytes,
          path: normalizedPath,
          root: input.rootKey,
        })
      : null;

    if (artifact) {
      files.push({
        artifact,
        path: normalizedPath,
        root: input.rootKey,
      });
      continue;
    }

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
): void {
  for (const candidate of candidates) {
    const normalizedPath = normalizeBundlePath(candidate.path);
    const pathKey = `${candidate.root}:${normalizedPath}`;
    if (includedPaths.has(pathKey)) {
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
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}
