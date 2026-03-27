import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

import type { HostedExecutionBundleKind } from "./hosted-execution.ts";

export const HOSTED_BUNDLE_SCHEMA = "healthybob.hosted-bundle.v1";
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/;

interface HostedBundleArchiveFile {
  contentsBase64: string;
  path: string;
  root: string;
}

interface HostedBundleArchive {
  files: HostedBundleArchiveFile[];
  kind: HostedExecutionBundleKind;
  schema: typeof HOSTED_BUNDLE_SCHEMA;
}

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
  kind: HostedExecutionBundleKind;
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
        root: root.root,
        rootKey: root.rootKey,
        shouldIncludeRelativePath: root.shouldIncludeRelativePath ?? (() => true),
      })),
    );
  }

  if (includedRootCount === 0) {
    return null;
  }

  return serializeHostedBundleArchive({
    files,
    kind: input.kind,
    schema: HOSTED_BUNDLE_SCHEMA,
  });
}

export async function restoreHostedBundleRoots(input: {
  bytes: Uint8Array | ArrayBuffer;
  expectedKind: HostedExecutionBundleKind;
  ignoredRoots?: readonly string[];
  roots: HostedBundleRestoreRootMap;
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

    const absolutePath = resolveHostedBundleRestorePath(root, file.path);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(file.contentsBase64, "base64"));
  }
}

export function readHostedBundleTextFile(input: {
  bytes: Uint8Array | ArrayBuffer | null;
  expectedKind: HostedExecutionBundleKind;
  path: string;
  root: string;
}): string | null {
  if (!input.bytes) {
    return null;
  }

  const archive = parseHostedBundleArchive(input.bytes);

  if (archive.kind !== input.expectedKind) {
    throw new Error(
      `Hosted bundle kind mismatch: expected ${input.expectedKind}, got ${archive.kind}.`,
    );
  }

  const normalizedPath = normalizeBundlePath(input.path);
  const file = archive.files.find((entry) => (
    entry.root === input.root
    && entry.path === normalizedPath
  ));

  if (!file) {
    return null;
  }

  return Buffer.from(file.contentsBase64, "base64").toString("utf8");
}

export function writeHostedBundleTextFile(input: {
  bytes: Uint8Array | ArrayBuffer | null;
  kind: HostedExecutionBundleKind;
  path: string;
  root: string;
  text: string | null;
}): Uint8Array {
  const normalizedPath = normalizeBundlePath(input.path);
  const archive = input.bytes
    ? parseHostedBundleArchive(input.bytes)
    : {
        files: [],
        kind: input.kind,
        schema: HOSTED_BUNDLE_SCHEMA,
      } satisfies HostedBundleArchive;

  if (archive.kind !== input.kind) {
    throw new Error(`Hosted bundle kind mismatch: expected ${input.kind}, got ${archive.kind}.`);
  }

  const nextFiles = archive.files.filter((entry) => (
    entry.root !== input.root || entry.path !== normalizedPath
  ));

  if (input.text !== null) {
    nextFiles.push({
      contentsBase64: Buffer.from(input.text, "utf8").toString("base64"),
      path: normalizedPath,
      root: input.root,
    });
  }

  return serializeHostedBundleArchive({
    ...archive,
    files: sortHostedBundleFiles(nextFiles),
  });
}

export function encodeHostedBundleBase64(value: Uint8Array | ArrayBuffer | null): string | null {
  if (!value) {
    return null;
  }

  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString("base64");
}

export function decodeHostedBundleBase64(value: string | null): Uint8Array | null {
  return value ? Uint8Array.from(Buffer.from(value, "base64")) : null;
}

export function sha256HostedBundleHex(bytes: Uint8Array | ArrayBuffer): string {
  return createHash("sha256")
    .update(bytes instanceof ArrayBuffer ? Buffer.from(new Uint8Array(bytes)) : Buffer.from(bytes))
    .digest("hex");
}

function parseHostedBundleArchive(bytes: Uint8Array | ArrayBuffer): HostedBundleArchive {
  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  const parsed = JSON.parse(gunzipSync(buffer).toString("utf8")) as Partial<HostedBundleArchive>;

  if (parsed.schema !== HOSTED_BUNDLE_SCHEMA || !Array.isArray(parsed.files)) {
    throw new Error("Hosted bundle archive is invalid.");
  }

  if (parsed.kind !== "vault" && parsed.kind !== "agent-state") {
    throw new Error("Hosted bundle archive kind is invalid.");
  }

  return {
    files: sortHostedBundleFiles(parsed.files.map((file) => {
      if (
        !file
        || typeof file.path !== "string"
        || typeof file.root !== "string"
        || typeof file.contentsBase64 !== "string"
      ) {
        throw new Error("Hosted bundle archive contains an invalid file entry.");
      }

      return {
        contentsBase64: file.contentsBase64,
        path: normalizeBundlePath(file.path),
        root: file.root,
      };
    })),
    kind: parsed.kind,
    schema: HOSTED_BUNDLE_SCHEMA,
  };
}

function serializeHostedBundleArchive(archive: HostedBundleArchive): Uint8Array {
  return Uint8Array.from(
    gzipSync(
      Buffer.from(
        JSON.stringify({
          ...archive,
          files: sortHostedBundleFiles(archive.files),
        }),
        "utf8",
      ),
    ),
  );
}

async function collectBundleFiles(input: {
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

    files.push({
      contentsBase64: (await readFile(absolutePath)).toString("base64"),
      path: normalizeBundlePath(relativePath),
      root: input.rootKey,
    });
  }

  return files;
}

function normalizeBundlePath(value: string): string {
  const candidate = value.replace(/\\/g, "/");

  if (!candidate || candidate.includes("\u0000")) {
    throw new Error(`Hosted bundle path is invalid: ${value}`);
  }

  if (WINDOWS_DRIVE_PREFIX_PATTERN.test(candidate) || path.posix.isAbsolute(candidate)) {
    throw new Error(`Hosted bundle path is invalid: ${value}`);
  }

  const normalized = path.posix.normalize(candidate);

  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.includes("/../")
  ) {
    throw new Error(`Hosted bundle path is invalid: ${value}`);
  }

  return normalized;
}

function resolveHostedBundleRestorePath(root: string, relativePath: string): string {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, normalizeBundlePath(relativePath));
  assertPathWithinRoot(absoluteRoot, absolutePath, relativePath);
  return absolutePath;
}

function assertPathWithinRoot(root: string, absolutePath: string, originalPath: string): void {
  const relative = path.relative(root, absolutePath);

  if (
    relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || WINDOWS_DRIVE_PREFIX_PATTERN.test(relative)
  ) {
    throw new Error(`Hosted bundle path escapes restore root: ${originalPath}`);
  }
}

function sortHostedBundleFiles(files: readonly HostedBundleArchiveFile[]): HostedBundleArchiveFile[] {
  return [...files].sort((left, right) => {
    if (left.root !== right.root) {
      return left.root.localeCompare(right.root);
    }

    return left.path.localeCompare(right.path);
  });
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}
