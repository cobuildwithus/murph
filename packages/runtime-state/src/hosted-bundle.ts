import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

import type { HostedExecutionBundleKind } from "./hosted-execution.js";

export const HOSTED_BUNDLE_SCHEMA = "healthybob.hosted-bundle.v1";

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

  return Uint8Array.from(
    gzipSync(
      Buffer.from(
        JSON.stringify({
          files,
          kind: input.kind,
          schema: HOSTED_BUNDLE_SCHEMA,
        } satisfies HostedBundleArchive),
        "utf8",
      ),
    ),
  );
}

export async function restoreHostedBundleRoots(input: {
  bytes: Uint8Array | ArrayBuffer;
  expectedKind: HostedExecutionBundleKind;
  roots: HostedBundleRestoreRootMap;
}): Promise<void> {
  const archive = parseHostedBundleArchive(input.bytes);

  if (archive.kind !== input.expectedKind) {
    throw new Error(
      `Hosted bundle kind mismatch: expected ${input.expectedKind}, got ${archive.kind}.`,
    );
  }

  for (const file of archive.files) {
    const root = input.roots[file.root];

    if (!root) {
      throw new Error(`Hosted bundle root "${file.root}" is not mapped for restore.`);
    }

    const absolutePath = path.join(root, normalizeBundlePath(file.path));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(file.contentsBase64, "base64"));
  }
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
    files: parsed.files.map((file) => {
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
    }),
    kind: parsed.kind,
    schema: HOSTED_BUNDLE_SCHEMA,
  };
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
  const normalized = path.posix.normalize(value);

  if (
    normalized === "."
    || normalized.startsWith("../")
    || normalized.includes("/../")
    || path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Hosted bundle path is invalid: ${value}`);
  }

  return normalized;
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}
