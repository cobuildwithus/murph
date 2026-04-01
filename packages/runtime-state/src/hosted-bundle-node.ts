import path from "node:path";
import { lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";

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
  preservedArtifacts?: readonly HostedBundleArtifactLocation[];
  roots: readonly HostedBundleSnapshotRootInput[];
}): Promise<Uint8Array | null> {
  const files: HostedBundleArchiveFile[] = [];
  let includedRootCount = 0;

  for (const root of input.roots) {
    if (!(await directoryExists(root.root))) {
      if (root.optional) {
        continue;
      }

      throw new Error(`Hosted bundle root does not exist: ${root.root}`);
    }

    includedRootCount += 1;
    files.push(
      ...(await collectBundleFiles({
        externalizeFile: input.externalizeFile,
        root: root.root,
        rootKey: root.rootKey,
        shouldIncludeRelativePath: root.shouldIncludeRelativePath ?? (() => true),
      })),
    );
  }

  if (includedRootCount === 0) {
    return null;
  }

  const includedPaths = new Set(files.map((file) => `${file.root}:${file.path}`));
  for (const artifact of input.preservedArtifacts ?? []) {
    const preservedPathKey = `${artifact.root}:${normalizeBundlePath(artifact.path)}`;
    if (includedPaths.has(preservedPathKey)) {
      continue;
    }

    files.push({
      artifact: artifact.ref,
      path: normalizeBundlePath(artifact.path),
      root: artifact.root,
    });
    includedPaths.add(preservedPathKey);
  }

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

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await assertHostedBundleRestorePathHasNoSymlinks(root, absolutePath, file.path);
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
      await writeFile(
        absolutePath,
        Buffer.from(resolvedBytes),
      );
      continue;
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await assertHostedBundleRestorePathHasNoSymlinks(root, absolutePath, file.path);
    await writeFile(absolutePath, Buffer.from(file.contentsBase64, "base64"));
  }
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

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
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
