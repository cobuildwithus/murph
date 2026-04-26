import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { VaultError } from "../errors.ts";
import { normalizeRelativeVaultPath } from "../path-safety.ts";
import {
  buildManifestHashInput,
  classifyImportFile,
} from "./import-pack.ts";
import {
  IMPORT_PACK_MANIFEST_PATH,
  VAULT_SYNC_IMPORT_MANIFEST_SCHEMA,
  type VaultSyncImportFileKind,
  type VaultSyncImportManifest,
  type VaultSyncImportManifestExcludedFile,
  type VaultSyncImportManifestFile,
} from "./types.ts";

const MAX_IMPORT_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_MANIFEST_FILES = 10_000;
const MAX_IMPORT_MANIFEST_EXCLUDED_SUMMARIES = 20;
const MAX_IMPORT_MANIFEST_EXCLUDED_FILES = 20_000;
const MAX_IMPORT_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_IMPORT_TEXT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_IMPORT_RAW_FILE_BYTES = 256 * 1024 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Prefixed(bytes: Uint8Array | string): string {
  return `sha256:${sha256Hex(bytes)}`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readJsonObjectIfExists(
  absolutePath: string,
  options: {
    maxBytes?: number;
  } = {},
): Promise<Record<string, unknown> | null> {
  if (options.maxBytes !== undefined) {
    let fileSize: number;
    try {
      const fileStats = await stat(absolutePath);
      fileSize = fileStats.size;
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    if (fileSize > options.maxBytes) {
      throw new VaultError(
        "VAULT_SYNC_IMPORT_MANIFEST_TOO_LARGE",
        "Vault sync import manifest is too large.",
        {
          maxBytes: options.maxBytes,
          actualBytes: fileSize,
        },
      );
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  return isPlainObject(parsed) ? parsed : null;
}

function stringField(value: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const entry = value[key];
    if (typeof entry === "string" && entry.trim().length > 0) {
      return entry;
    }
  }

  return null;
}

export function isVaultSyncImportFileKind(value: string): value is VaultSyncImportFileKind {
  return value === "jsonl_ledger" || value === "raw" || value === "text" || value === "metadata";
}

export function invalidImportManifest(message: string): never {
  throw new VaultError("VAULT_SYNC_IMPORT_MANIFEST_INVALID", message);
}

function isSha256Prefixed(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function maxImportFileBytesForKind(kind: VaultSyncImportFileKind): number {
  return kind === "raw" ? MAX_IMPORT_RAW_FILE_BYTES : MAX_IMPORT_TEXT_FILE_BYTES;
}

export function parseManifestFileEntry(entry: unknown): VaultSyncImportManifestFile {
  if (!isPlainObject(entry)) {
    invalidImportManifest("Vault sync import manifest contains an invalid file entry.");
  }

  if (
    typeof entry.path !== "string"
    || typeof entry.kind !== "string"
    || !isVaultSyncImportFileKind(entry.kind)
    || typeof entry.sha256 !== "string"
    || typeof entry.bytes !== "number"
    || !Number.isSafeInteger(entry.bytes)
    || entry.bytes < 0
  ) {
    invalidImportManifest("Vault sync import manifest contains a malformed file entry.");
  }

  const relativePath = normalizeRelativeVaultPath(entry.path);
  const expectedKind = classifyImportFile(relativePath);
  if (!expectedKind || expectedKind !== entry.kind) {
    invalidImportManifest("Vault sync import manifest contains a non-canonical or mismatched file entry.");
  }

  if (!isSha256Prefixed(entry.sha256)) {
    invalidImportManifest("Vault sync import manifest contains a malformed file hash.");
  }

  if (entry.bytes > maxImportFileBytesForKind(entry.kind)) {
    invalidImportManifest("Vault sync import manifest contains a file that exceeds the import size limit.");
  }

  return {
    bytes: entry.bytes,
    kind: entry.kind,
    path: relativePath,
    sha256: entry.sha256,
  };
}

export function parseManifestExcludedEntry(entry: unknown): VaultSyncImportManifestExcludedFile {
  if (!isPlainObject(entry)) {
    invalidImportManifest("Vault sync import manifest contains an invalid excluded entry.");
  }

  if (
    typeof entry.count !== "number"
    || !Number.isSafeInteger(entry.count)
    || entry.count < 0
    || typeof entry.reason !== "string"
    || entry.reason.trim().length === 0
  ) {
    invalidImportManifest("Vault sync import manifest contains a malformed excluded entry.");
  }

  return {
    count: entry.count,
    reason: entry.reason,
  };
}

export async function readVaultSyncImportManifest(importMetaRoot: string): Promise<VaultSyncImportManifest> {
  const parsed = await readJsonObjectIfExists(path.join(importMetaRoot, IMPORT_PACK_MANIFEST_PATH), {
    maxBytes: MAX_IMPORT_MANIFEST_BYTES,
  });
  if (!parsed || parsed.schema !== VAULT_SYNC_IMPORT_MANIFEST_SCHEMA) {
    throw new VaultError("VAULT_SYNC_IMPORT_MANIFEST_INVALID", "Vault sync import pack is missing a valid manifest.");
  }

  const filesValue = parsed.files;
  const excludedValue = parsed.excluded;
  const sourceVaultValue = parsed.sourceVault;

  if (!Array.isArray(filesValue) || !Array.isArray(excludedValue) || !isPlainObject(sourceVaultValue)) {
    throw new VaultError("VAULT_SYNC_IMPORT_MANIFEST_INVALID", "Vault sync import manifest has an invalid shape.");
  }

  if (filesValue.length > MAX_IMPORT_MANIFEST_FILES) {
    invalidImportManifest("Vault sync import manifest contains too many files.");
  }

  if (excludedValue.length > MAX_IMPORT_MANIFEST_EXCLUDED_SUMMARIES) {
    invalidImportManifest("Vault sync import manifest contains too many excluded files.");
  }

  const files: VaultSyncImportManifestFile[] = [];
  const filePaths = new Set<string>();
  let totalBytes = 0;
  for (const file of filesValue) {
    const parsedFile = parseManifestFileEntry(file);
    if (filePaths.has(parsedFile.path)) {
      invalidImportManifest("Vault sync import manifest contains duplicate file paths.");
    }
    totalBytes += parsedFile.bytes;
    if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
      invalidImportManifest("Vault sync import manifest exceeds the total import size limit.");
    }
    filePaths.add(parsedFile.path);
    files.push(parsedFile);
  }

  const excluded: VaultSyncImportManifestExcludedFile[] = [];
  let excludedFileCount = 0;
  for (const entry of excludedValue) {
    const parsedExcluded = parseManifestExcludedEntry(entry);
    excludedFileCount += parsedExcluded.count;
    if (excludedFileCount > MAX_IMPORT_MANIFEST_EXCLUDED_FILES) {
      invalidImportManifest("Vault sync import manifest contains too many excluded files.");
    }
    excluded.push(parsedExcluded);
  }

  const manifest: VaultSyncImportManifest = {
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
    excluded,
    files,
    manifestHash: typeof parsed.manifestHash === "string" ? parsed.manifestHash : "",
    schema: VAULT_SYNC_IMPORT_MANIFEST_SCHEMA,
    sourceVault: {
      schemaVersion: stringField(sourceVaultValue, ["schemaVersion"]),
      title: stringField(sourceVaultValue, ["title"]),
      vaultId: stringField(sourceVaultValue, ["vaultId"]),
    },
  };

  const { manifestHash, ...manifestBase } = manifest;
  const expectedHash = sha256Prefixed(buildManifestHashInput(manifestBase));
  if (manifestHash !== expectedHash) {
    throw new VaultError("VAULT_SYNC_IMPORT_MANIFEST_HASH_MISMATCH", "Vault sync import manifest hash does not match its contents.");
  }

  return manifest;
}

export async function readVerifiedImportFileBytes(input: {
  expectedBytes: number;
  expectedSha256: string;
  importVaultRoot: string;
  relativePath: string;
}): Promise<Uint8Array> {
  const absolutePath = path.join(input.importVaultRoot, input.relativePath);
  let actualBytes: number;
  try {
    const fileStats = await stat(absolutePath);
    if (!fileStats.isFile()) {
      throw new VaultError(
        "VAULT_SYNC_IMPORT_FILE_INVALID",
        "Vault sync import pack contains a non-file entry for a manifest-listed file.",
        {
          relativePath: input.relativePath,
        },
      );
    }
    actualBytes = fileStats.size;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new VaultError(
        "VAULT_SYNC_IMPORT_FILE_MISSING",
        "Vault sync import pack is missing a manifest-listed file.",
        {
          expectedSha256: input.expectedSha256,
          relativePath: input.relativePath,
        },
      );
    }
    throw error;
  }

  if (actualBytes !== input.expectedBytes) {
    throw new VaultError(
      "VAULT_SYNC_IMPORT_FILE_SIZE_MISMATCH",
      "Vault sync import pack file size does not match the manifest.",
      {
        actualBytes,
        expectedBytes: input.expectedBytes,
        relativePath: input.relativePath,
      },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new VaultError(
        "VAULT_SYNC_IMPORT_FILE_MISSING",
        "Vault sync import pack is missing a manifest-listed file.",
        {
          expectedSha256: input.expectedSha256,
          relativePath: input.relativePath,
        },
      );
    }
    throw error;
  }

  const actualSha256 = sha256Prefixed(bytes);
  if (actualSha256 !== input.expectedSha256) {
    throw new VaultError(
      "VAULT_SYNC_IMPORT_FILE_HASH_MISMATCH",
      "Vault sync import pack file hash does not match the manifest.",
      {
        actualSha256,
        expectedSha256: input.expectedSha256,
        relativePath: input.relativePath,
      },
    );
  }

  return bytes;
}
