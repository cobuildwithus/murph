import { createHash } from "node:crypto";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import type { HostedExecutionBundleKind } from "./hosted-bundle-ref.ts";

export const HOSTED_BUNDLE_SCHEMA = "murph.hosted-bundle.v1";
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/;
const MAX_HOSTED_BUNDLE_ARCHIVE_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_HOSTED_BUNDLE_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_HOSTED_BUNDLE_ARCHIVE_FILE_COUNT = 50_000;
const MAX_HOSTED_BUNDLE_PATH_LENGTH = 4_096;
const MAX_HOSTED_BUNDLE_ROOT_LENGTH = 256;
const BASE64_CANONICAL_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export interface HostedBundleArtifactRef {
  byteSize: number;
  sha256: string;
}

export interface HostedBundleArtifactLocation {
  path: string;
  ref: HostedBundleArtifactRef;
  root: string;
}

export interface HostedBundleArchiveInlineFile {
  contentsBase64: string;
  path: string;
  root: string;
}

export interface HostedBundleArchiveExternalFile {
  artifact: HostedBundleArtifactRef;
  path: string;
  root: string;
}

export type HostedBundleArchiveFile =
  | HostedBundleArchiveInlineFile
  | HostedBundleArchiveExternalFile;

export interface HostedBundleArchive {
  files: HostedBundleArchiveFile[];
  kind: HostedExecutionBundleKind;
  schema: typeof HOSTED_BUNDLE_SCHEMA;
}

export function hasHostedBundleArtifactPath(input: {
  bytes: Uint8Array | ArrayBuffer | null;
  expectedKind: HostedExecutionBundleKind;
  path: string;
  root: string;
}): boolean {
  if (!input.bytes) {
    return false;
  }

  const archive = parseHostedBundleArchive(input.bytes);

  if (archive.kind !== input.expectedKind) {
    throw new Error(
      `Hosted bundle kind mismatch: expected ${input.expectedKind}, got ${archive.kind}.`,
    );
  }

  const normalizedPath = normalizeBundlePath(input.path);
  return archive.files.some((entry) => (
    isHostedBundleArtifactEntry(entry)
    && entry.root === input.root
    && entry.path === normalizedPath
  ));
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

  if (!file || isHostedBundleArtifactEntry(file)) {
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

export function listHostedBundleArtifacts(input: {
  bytes: Uint8Array | ArrayBuffer | null;
  expectedKind: HostedExecutionBundleKind;
}): HostedBundleArtifactLocation[] {
  if (!input.bytes) {
    return [];
  }

  const archive = parseHostedBundleArchive(input.bytes);

  if (archive.kind !== input.expectedKind) {
    throw new Error(
      `Hosted bundle kind mismatch: expected ${input.expectedKind}, got ${archive.kind}.`,
    );
  }

  return archive.files
    .filter(isHostedBundleArtifactEntry)
    .map((entry) => ({
      path: entry.path,
      ref: entry.artifact,
      root: entry.root,
    }));
}

export function encodeHostedBundleBase64(value: Uint8Array | ArrayBuffer | null): string | null {
  if (!value) {
    return null;
  }

  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString("base64");
}

export function decodeHostedBundleBase64(value: string | null): Uint8Array | null {
  return value === null ? null : decodeStrictBase64(value, "Hosted bundle payload must be valid base64.");
}

export function sha256HostedBundleHex(bytes: Uint8Array | ArrayBuffer): string {
  return createHash("sha256")
    .update(bytes instanceof ArrayBuffer ? Buffer.from(new Uint8Array(bytes)) : Buffer.from(bytes))
    .digest("hex");
}

export function parseHostedBundleArchive(bytes: Uint8Array | ArrayBuffer): HostedBundleArchive {
  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);

  if (buffer.byteLength > MAX_HOSTED_BUNDLE_ARCHIVE_COMPRESSED_BYTES) {
    throw new Error(
      `Hosted bundle archive exceeds the ${MAX_HOSTED_BUNDLE_ARCHIVE_COMPRESSED_BYTES} byte compressed size limit.`,
    );
  }

  let parsed: Partial<HostedBundleArchive> & {
    schema?: string;
  };

  try {
    parsed = JSON.parse(
      gunzipSync(buffer, { maxOutputLength: MAX_HOSTED_BUNDLE_ARCHIVE_UNCOMPRESSED_BYTES }).toString("utf8"),
    ) as Partial<HostedBundleArchive> & { schema?: string };
  } catch {
    throw new Error("Hosted bundle archive is invalid.");
  }

  if (
    parsed.schema !== HOSTED_BUNDLE_SCHEMA
    || !Array.isArray(parsed.files)
  ) {
    throw new Error("Hosted bundle archive is invalid.");
  }

  if (parsed.kind !== "vault") {
    throw new Error("Hosted bundle archive kind is invalid.");
  }

  if (parsed.files.length > MAX_HOSTED_BUNDLE_ARCHIVE_FILE_COUNT) {
    throw new Error(
      `Hosted bundle archive exceeds the ${MAX_HOSTED_BUNDLE_ARCHIVE_FILE_COUNT} file entry limit.`,
    );
  }

  const files = parsed.files.map((file) => parseHostedBundleArchiveFile(file));
  assertUniqueHostedBundleArchiveEntries(files);

  return {
    files: sortHostedBundleFiles(files),
    kind: parsed.kind,
    schema: HOSTED_BUNDLE_SCHEMA,
  };
}

export function serializeHostedBundleArchive(archive: HostedBundleArchive): Uint8Array {
  const files = archive.files.map((file) => parseHostedBundleArchiveFile(file));

  if (files.length > MAX_HOSTED_BUNDLE_ARCHIVE_FILE_COUNT) {
    throw new Error(
      `Hosted bundle archive exceeds the ${MAX_HOSTED_BUNDLE_ARCHIVE_FILE_COUNT} file entry limit.`,
    );
  }

  assertUniqueHostedBundleArchiveEntries(files);

  return Uint8Array.from(
    gzipSync(
      Buffer.from(
        JSON.stringify({
          ...archive,
          files: sortHostedBundleFiles(files),
        }),
        "utf8",
      ),
    ),
  );
}

function decodeStrictBase64(value: string, errorMessage: string): Uint8Array {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return new Uint8Array();
  }

  if (
    normalized.length % 4 !== 0
    || !BASE64_CANONICAL_PATTERN.test(normalized)
  ) {
    throw new TypeError(errorMessage);
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.toString("base64") !== normalized) {
    throw new TypeError(errorMessage);
  }

  return Uint8Array.from(decoded);
}

function parseHostedBundleArchiveFile(file: unknown): HostedBundleArchiveFile {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new Error("Hosted bundle archive contains an invalid file entry.");
  }

  const record = file as Record<string, unknown>;
  if (typeof record.path !== "string" || typeof record.root !== "string") {
    throw new Error("Hosted bundle archive contains an invalid file entry.");
  }

  const normalized = {
    path: normalizeBundlePath(record.path),
    root: normalizeHostedBundleRoot(record.root),
  };

  if (typeof record.contentsBase64 === "string") {
    return {
      contentsBase64: record.contentsBase64,
      ...normalized,
    };
  }

  const artifactRecord = record.artifact;
  if (
    artifactRecord
    && typeof artifactRecord === "object"
    && !Array.isArray(artifactRecord)
    && typeof (artifactRecord as Record<string, unknown>).sha256 === "string"
    && typeof (artifactRecord as Record<string, unknown>).byteSize === "number"
  ) {
    return {
      artifact: {
        byteSize: (artifactRecord as Record<string, unknown>).byteSize as number,
        sha256: (artifactRecord as Record<string, unknown>).sha256 as string,
      },
      ...normalized,
    };
  }

  throw new Error("Hosted bundle archive contains an invalid file entry.");
}

export function normalizeBundlePath(value: string): string {
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
    || normalized.length > MAX_HOSTED_BUNDLE_PATH_LENGTH
  ) {
    throw new Error(`Hosted bundle path is invalid: ${value}`);
  }

  return normalized;
}

export function resolveHostedBundleRestorePath(root: string, relativePath: string): string {
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

export function sortHostedBundleFiles(files: readonly HostedBundleArchiveFile[]): HostedBundleArchiveFile[] {
  return [...files].sort((left, right) => {
    if (left.root !== right.root) {
      return left.root.localeCompare(right.root);
    }

    return left.path.localeCompare(right.path);
  });
}

export function isHostedBundleArtifactEntry(
  value: HostedBundleArchiveFile,
): value is HostedBundleArchiveExternalFile {
  return "artifact" in value;
}

export function assertHostedBundleArtifactIntegrity(input: {
  bytes: Uint8Array;
  path: string;
  ref: HostedBundleArtifactRef;
  root: string;
}): void {
  if (input.bytes.byteLength !== input.ref.byteSize) {
    throw new Error(
      `Hosted bundle artifact ${input.root}:${input.path} size mismatch: expected ${input.ref.byteSize}, got ${input.bytes.byteLength}.`,
    );
  }

  const actualSha256 = sha256HostedBundleHex(input.bytes);
  if (actualSha256 !== input.ref.sha256) {
    throw new Error(
      `Hosted bundle artifact ${input.root}:${input.path} hash mismatch: expected ${input.ref.sha256}, got ${actualSha256}.`,
    );
  }
}

export function toHostedBundleBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function normalizeHostedBundleRoot(value: string): string {
  const normalized = value.trim();

  if (
    normalized.length === 0
    || normalized.length > MAX_HOSTED_BUNDLE_ROOT_LENGTH
    || normalized.includes("\u0000")
  ) {
    throw new Error(`Hosted bundle root is invalid: ${value}`);
  }

  return normalized;
}

function assertUniqueHostedBundleArchiveEntries(files: readonly HostedBundleArchiveFile[]): void {
  const seen = new Set<string>();

  for (const file of files) {
    const key = `${file.root}:${file.path}`;

    if (seen.has(key)) {
      throw new Error(`Hosted bundle archive contains duplicate file entry: ${key}.`);
    }

    seen.add(key);
  }
}
