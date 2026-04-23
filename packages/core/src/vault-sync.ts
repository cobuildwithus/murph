import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  restoreHostedBundleRoots,
  snapshotHostedBundleRoots,
  type HostedBundleArtifactRef,
  type HostedBundleArtifactRestoreInput,
  type HostedBundleArtifactSnapshotInput,
} from "@murphai/runtime-state/node";

import { VAULT_LAYOUT, VAULT_SCHEMA_VERSION } from "./constants.ts";
import { VaultError } from "./errors.ts";
import {
  acquireCanonicalWriteLock,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  withCanonicalWriteLockScope,
} from "./operations/canonical-write-lock.ts";
import { normalizeOpaquePathSegment, normalizeRelativeVaultPath, resolveVaultPath } from "./path-safety.ts";
import {
  applyCanonicalWriteBatch,
  type CanonicalJsonlAppendInput,
  type CanonicalRawContentInput,
  type CanonicalRawCopyInput,
  type CanonicalTextWriteInput,
} from "./public-mutations.ts";
import { assertValidVault } from "./vault.ts";

export const VAULT_SYNC_IMPORT_MANIFEST_SCHEMA = "murph.vaultSync.importManifest.v1";
export const VAULT_SYNC_CONFLICT_MANIFEST_SCHEMA = "murph.vaultSync.conflictManifest.v1";
export const VAULT_SYNC_IMPORT_BUNDLE_KIND = "vault-sync-import" as const;

const SYNC_IMPORT_ROOT = "raw/sync-imports";
const IMPORT_PACK_VAULT_ROOT_KEY = "vault";
const IMPORT_PACK_META_ROOT_KEY = "meta";
const IMPORT_PACK_MANIFEST_PATH = "manifest.json";
const JSONL_EXTENSION = ".jsonl";

export type VaultSyncImportFileKind = "jsonl_ledger" | "raw" | "text" | "metadata";

export interface VaultSyncSourceVaultMetadata {
  schemaVersion: string | null;
  title: string | null;
  vaultId: string | null;
}

export interface VaultSyncImportManifestFile {
  bytes: number;
  kind: VaultSyncImportFileKind;
  path: string;
  sha256: string;
}

export interface VaultSyncImportManifestExcludedFile {
  path: string;
  reason: string;
}

export interface VaultSyncImportManifest {
  createdAt: string;
  excluded: VaultSyncImportManifestExcludedFile[];
  files: VaultSyncImportManifestFile[];
  manifestHash: string;
  schema: typeof VAULT_SYNC_IMPORT_MANIFEST_SCHEMA;
  sourceVault: VaultSyncSourceVaultMetadata;
}

export interface VaultSyncImportArtifactSnapshotInput extends HostedBundleArtifactSnapshotInput {
  ref: HostedBundleArtifactRef;
}

export interface BuildVaultSyncImportPackInput {
  artifactSink?: (input: VaultSyncImportArtifactSnapshotInput) => Promise<void>;
  now?: Date;
  vaultRoot: string;
}

export interface BuildVaultSyncImportPackResult {
  bundle: Uint8Array;
  manifest: VaultSyncImportManifest;
  manifestHash: string;
  sourceSchemaVersion: string | null;
  sourceVaultId: string | null;
  sourceVaultTitle: string | null;
}

export interface RestoreVaultSyncImportPackInput {
  artifactResolver?: (input: HostedBundleArtifactRestoreInput) => Promise<Uint8Array | ArrayBuffer>;
  bundle: Uint8Array | ArrayBuffer;
  workspaceRoot?: string;
}

export interface RestoreVaultSyncImportPackResult {
  cleanup: () => Promise<void>;
  metaRoot: string;
  vaultRoot: string;
  workspaceRoot: string;
}

export interface MergeVaultSyncImportConflict {
  kind: "jsonl" | "raw" | "text" | "metadata";
  localSha256: string;
  path: string;
  preservedLocalPath?: string | null;
  reason: string;
  remoteSha256?: string | null;
}

export type VaultSyncImportConflict = MergeVaultSyncImportConflict;

export interface VaultSyncConflictManifest {
  conflicts: MergeVaultSyncImportConflict[];
  createdAt: string;
  schema: typeof VAULT_SYNC_CONFLICT_MANIFEST_SCHEMA;
  sessionId: string;
  sourceVaultId: string | null;
  summary: {
    conflictCount: number;
    importedJsonlRecords: number;
    importedRawFiles: number;
    importedTextFiles: number;
  };
}

export interface MergeVaultSyncImportInput {
  importedAt?: Date;
  importMetaRoot: string;
  importVaultRoot: string;
  sessionId: string;
  targetVaultRoot: string;
}

export interface MergeVaultSyncImportResult {
  conflictManifestPath: string | null;
  conflicts: MergeVaultSyncImportConflict[];
  imported: {
    jsonlRecords: number;
    rawFiles: number;
    textFiles: number;
  };
  sessionId: string;
  skipped: {
    duplicates: number;
    excludedFiles: number;
  };
}

export type VaultSyncImportMergeResult = MergeVaultSyncImportResult;

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

interface MergePlan {
  conflicts: MergeVaultSyncImportConflict[];
  duplicates: number;
  jsonlAppends: CanonicalJsonlAppendInput<Record<string, unknown>>[];
  rawContents: CanonicalRawContentInput[];
  rawCopies: CanonicalRawCopyInput[];
  textWrites: CanonicalTextWriteInput[];
}

interface ExistingRecordIndexEntry {
  hash: string;
  key: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  const output: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (typeof entry === "undefined" || typeof entry === "function" || typeof entry === "symbol") {
      continue;
    }
    output[key] = toJsonValue(entry);
  }
  return output;
}

function stableJson(value: unknown): string {
  return JSON.stringify(toJsonValue(value));
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

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    const stats = await stat(absolutePath);
    return stats.isFile();
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readFileIfExists(absolutePath: string): Promise<Uint8Array | null> {
  try {
    return await readFile(absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonObjectIfExists(absolutePath: string): Promise<Record<string, unknown> | null> {
  const bytes = await readFileIfExists(absolutePath);
  if (!bytes) {
    return null;
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

async function readSourceVaultMetadata(vaultRoot: string): Promise<VaultSyncSourceVaultMetadata> {
  const metadata = await readJsonObjectIfExists(path.join(vaultRoot, VAULT_LAYOUT.metadata));
  const formatVersion = metadata?.formatVersion;
  return {
    schemaVersion: stringField(metadata, ["schemaVersion", "vaultSchemaVersion"])
      ?? (typeof formatVersion === "number" ? String(formatVersion) : VAULT_SCHEMA_VERSION),
    title: stringField(metadata, ["title", "name"]),
    vaultId: stringField(metadata, ["vaultId", "id"]),
  };
}

function startsWithPath(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}

function isExcludedLocalPath(relativePath: string): string | null {
  if (startsWithPath(relativePath, SYNC_IMPORT_ROOT)) {
    return "previous_sync_import";
  }

  if (startsWithPath(relativePath, VAULT_LAYOUT.auditDirectory)) {
    return "local_audit_history";
  }

  if (
    relativePath.split("/").some((segment) => segment === ".env" || segment.startsWith(".env."))
    || relativePath === ".git"
    || startsWithPath(relativePath, ".git")
    || relativePath === "node_modules"
    || startsWithPath(relativePath, "node_modules")
    || relativePath === ".runtime"
    || startsWithPath(relativePath, ".runtime")
    || relativePath === "derived"
    || startsWithPath(relativePath, "derived")
    || startsWithPath(relativePath, VAULT_LAYOUT.exportPacksDirectory)
    || startsWithPath(relativePath, "dist")
    || startsWithPath(relativePath, "build")
    || startsWithPath(relativePath, "coverage")
  ) {
    return "local_or_rebuildable_state";
  }

  return null;
}

function isImportableJsonlLedgerPath(relativePath: string): boolean {
  return relativePath.endsWith(JSONL_EXTENSION) && (
    startsWithPath(relativePath, VAULT_LAYOUT.assessmentLedgerDirectory)
    || startsWithPath(relativePath, VAULT_LAYOUT.eventLedgerDirectory)
    || startsWithPath(relativePath, VAULT_LAYOUT.sampleLedgerDirectory)
    || startsWithPath(relativePath, VAULT_LAYOUT.inboxCaptureLedgerDirectory)
  );
}

function classifyImportFile(relativePath: string): VaultSyncImportFileKind | null {
  if (isExcludedLocalPath(relativePath)) {
    return null;
  }

  if (relativePath === VAULT_LAYOUT.metadata) {
    return "metadata";
  }

  if (startsWithPath(relativePath, VAULT_LAYOUT.rawDirectory)) {
    return "raw";
  }

  if (isImportableJsonlLedgerPath(relativePath)) {
    return "jsonl_ledger";
  }

  if (
    relativePath === VAULT_LAYOUT.coreDocument
    || relativePath === VAULT_LAYOUT.memoryDocument
    || relativePath === VAULT_LAYOUT.preferencesDocument
    || startsWithPath(relativePath, VAULT_LAYOUT.bankDirectory)
    || startsWithPath(relativePath, VAULT_LAYOUT.journalDirectory)
    || startsWithPath(relativePath, VAULT_LAYOUT.automationsDirectory)
  ) {
    if (relativePath.endsWith(".md") || relativePath.endsWith(".json") || relativePath.endsWith(".txt")) {
      return "text";
    }
  }

  return null;
}

async function listVaultFiles(vaultRoot: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string, baseRelativePath: string): Promise<void> {
    let entries: Array<{
      isDirectory(): boolean;
      isFile(): boolean;
      isSymbolicLink(): boolean;
      name: string | Buffer;
    }>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryName = String(entry.name);
      const relativePath = baseRelativePath ? `${baseRelativePath}/${entryName}` : entryName;
      const normalized = normalizeRelativeVaultPath(relativePath);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(path.join(directory, entryName), normalized);
        continue;
      }
      if (entry.isFile()) {
        files.push(normalized);
      }
    }
  }

  await walk(vaultRoot, "");
  return files.sort();
}

function buildManifestHashInput(input: Omit<VaultSyncImportManifest, "manifestHash">): string {
  return stableJson(input);
}

function artifactRefForBytes(bytes: Uint8Array): HostedBundleArtifactRef {
  return {
    byteSize: bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
}

function buildIncludedPathPrefixSet(paths: Iterable<string>): Set<string> {
  const prefixes = new Set<string>();
  for (const includedPath of paths) {
    const parts = includedPath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      prefixes.add(parts.slice(0, index).join("/"));
    }
  }
  return prefixes;
}

function shouldExternalizeImportPackFile(input: HostedBundleArtifactSnapshotInput): boolean {
  return input.root === IMPORT_PACK_VAULT_ROOT_KEY
    && startsWithPath(input.path, VAULT_LAYOUT.rawDirectory)
    && input.bytes.byteLength >= 256 * 1024;
}

export async function buildVaultSyncImportPack(
  input: BuildVaultSyncImportPackInput,
): Promise<BuildVaultSyncImportPackResult> {
  const { vaultRoot } = resolveVaultPath(input.vaultRoot, VAULT_LAYOUT.metadata);
  const createdAt = (input.now ?? new Date()).toISOString();
  const sourceVault = await readSourceVaultMetadata(vaultRoot);
  const files = await listVaultFiles(vaultRoot);
  const included = new Map<string, VaultSyncImportFileKind>();
  const manifestFiles: VaultSyncImportManifestFile[] = [];
  const excluded: VaultSyncImportManifestExcludedFile[] = [];

  for (const relativePath of files) {
    const explicitExclusion = isExcludedLocalPath(relativePath);
    const kind = classifyImportFile(relativePath);
    if (!kind || explicitExclusion) {
      excluded.push({
        path: relativePath,
        reason: explicitExclusion ?? "not_canonical_sync_input",
      });
      continue;
    }

    const absolutePath = path.join(vaultRoot, relativePath);
    const bytes = await readFile(absolutePath);
    included.set(relativePath, kind);
    manifestFiles.push({
      bytes: bytes.byteLength,
      kind,
      path: relativePath,
      sha256: sha256Prefixed(bytes),
    });
  }

  const manifestBase = {
    createdAt,
    excluded,
    files: manifestFiles,
    schema: VAULT_SYNC_IMPORT_MANIFEST_SCHEMA,
    sourceVault,
  } satisfies Omit<VaultSyncImportManifest, "manifestHash">;
  const manifestHash = sha256Prefixed(buildManifestHashInput(manifestBase));
  const manifest: VaultSyncImportManifest = {
    ...manifestBase,
    manifestHash,
  };

  const includedPrefixes = buildIncludedPathPrefixSet(included.keys());
  const metaRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-sync-meta-"));
  try {
    await writeFile(path.join(metaRoot, IMPORT_PACK_MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const bundle = await snapshotHostedBundleRoots({
      externalizeFile: input.artifactSink
        ? async (artifactInput) => {
            if (!shouldExternalizeImportPackFile(artifactInput)) {
              return null;
            }
            const ref = artifactRefForBytes(artifactInput.bytes);
            await input.artifactSink?.({
              ...artifactInput,
              ref,
            });
            return ref;
          }
        : undefined,
      kind: VAULT_SYNC_IMPORT_BUNDLE_KIND,
      roots: [
        {
          root: vaultRoot,
          rootKey: IMPORT_PACK_VAULT_ROOT_KEY,
          shouldIncludeRelativePath: (relativePath) => {
            const normalized = normalizeRelativeVaultPath(relativePath);
            return included.has(normalized) || includedPrefixes.has(normalized);
          },
        },
        {
          root: metaRoot,
          rootKey: IMPORT_PACK_META_ROOT_KEY,
        },
      ],
    });

    if (!bundle) {
      throw new VaultError("VAULT_SYNC_IMPORT_EMPTY", "Vault sync import pack did not include any roots.");
    }

    return {
      bundle,
      manifest,
      manifestHash,
      sourceSchemaVersion: sourceVault.schemaVersion,
      sourceVaultId: sourceVault.vaultId,
      sourceVaultTitle: sourceVault.title,
    };
  } finally {
    await rm(metaRoot, { force: true, recursive: true });
  }
}

export async function restoreVaultSyncImportPack(
  input: RestoreVaultSyncImportPackInput,
): Promise<RestoreVaultSyncImportPackResult> {
  const workspaceRoot = input.workspaceRoot ?? await mkdtemp(path.join(tmpdir(), "murph-vault-sync-import-"));
  const vaultRoot = path.join(workspaceRoot, "vault");
  const metaRoot = path.join(workspaceRoot, "meta");
  await mkdir(vaultRoot, { recursive: true });
  await mkdir(metaRoot, { recursive: true });

  await restoreHostedBundleRoots({
    artifactResolver: input.artifactResolver,
    bytes: input.bundle,
    expectedKind: VAULT_SYNC_IMPORT_BUNDLE_KIND,
    roots: {
      [IMPORT_PACK_META_ROOT_KEY]: metaRoot,
      [IMPORT_PACK_VAULT_ROOT_KEY]: vaultRoot,
    },
  });

  return {
    cleanup: async () => {
      if (!input.workspaceRoot) {
        await rm(workspaceRoot, { force: true, recursive: true });
      }
    },
    metaRoot,
    vaultRoot,
    workspaceRoot,
  };
}

function isVaultSyncImportFileKind(value: string): value is VaultSyncImportFileKind {
  return value === "jsonl_ledger" || value === "raw" || value === "text" || value === "metadata";
}

export async function readVaultSyncImportManifest(importMetaRoot: string): Promise<VaultSyncImportManifest> {
  const parsed = await readJsonObjectIfExists(path.join(importMetaRoot, IMPORT_PACK_MANIFEST_PATH));
  if (!parsed || parsed.schema !== VAULT_SYNC_IMPORT_MANIFEST_SCHEMA) {
    throw new VaultError("VAULT_SYNC_IMPORT_MANIFEST_INVALID", "Vault sync import pack is missing a valid manifest.");
  }

  const filesValue = parsed.files;
  const excludedValue = parsed.excluded;
  const sourceVaultValue = parsed.sourceVault;

  if (!Array.isArray(filesValue) || !Array.isArray(excludedValue) || !isPlainObject(sourceVaultValue)) {
    throw new VaultError("VAULT_SYNC_IMPORT_MANIFEST_INVALID", "Vault sync import manifest has an invalid shape.");
  }

  const files: VaultSyncImportManifestFile[] = [];
  for (const file of filesValue) {
    if (!isPlainObject(file)) {
      continue;
    }
    if (
      typeof file.path === "string"
      && typeof file.kind === "string"
      && isVaultSyncImportFileKind(file.kind)
      && typeof file.sha256 === "string"
      && typeof file.bytes === "number"
    ) {
      files.push({
        bytes: file.bytes,
        kind: file.kind,
        path: normalizeRelativeVaultPath(file.path),
        sha256: file.sha256,
      });
    }
  }

  const excluded: VaultSyncImportManifestExcludedFile[] = [];
  for (const entry of excludedValue) {
    if (!isPlainObject(entry)) {
      continue;
    }
    if (typeof entry.path === "string" && typeof entry.reason === "string") {
      excluded.push({
        path: normalizeRelativeVaultPath(entry.path),
        reason: entry.reason,
      });
    }
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

function recordIdValue(record: Record<string, unknown>): string | null {
  for (const key of ["id", "captureId", "eventId", "sampleId", "assessmentId"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function eventRevisionValue(record: Record<string, unknown>): string | null {
  const lifecycle = record.lifecycle;
  if (isPlainObject(lifecycle)) {
    const revision = lifecycle.revision;
    if (typeof revision === "string" || typeof revision === "number") {
      return String(revision);
    }
  }

  const revision = record.revision;
  if (typeof revision === "string" || typeof revision === "number") {
    return String(revision);
  }

  return null;
}

function stableRecordKey(record: Record<string, unknown>, relativePath: string): string {
  const stableId = recordIdValue(record);
  if (stableId) {
    const revision = startsWithPath(relativePath, VAULT_LAYOUT.eventLedgerDirectory)
      ? eventRevisionValue(record)
      : null;
    return revision ? `${stableId}@${revision}` : stableId;
  }

  return sha256Prefixed(stableJson(record));
}

function readJsonlRecordObjects(content: string, relativePath: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }

    const parsed = JSON.parse(line);
    if (!isPlainObject(parsed)) {
      throw new VaultError("VAULT_SYNC_INVALID_JSONL", "JSONL import records must be objects.", {
        line: index + 1,
        relativePath,
      });
    }
    records.push(parsed);
  }
  return records;
}

async function buildExistingRecordIndex(
  targetVaultRoot: string,
  relativePath: string,
): Promise<Map<string, ExistingRecordIndexEntry>> {
  const bytes = await readFileIfExists(path.join(targetVaultRoot, relativePath));
  const index = new Map<string, ExistingRecordIndexEntry>();
  if (!bytes) {
    return index;
  }

  for (const record of readJsonlRecordObjects(Buffer.from(bytes).toString("utf8"), relativePath)) {
    const hash = sha256Prefixed(stableJson(record));
    index.set(stableRecordKey(record, relativePath), {
      hash,
      key: stableRecordKey(record, relativePath),
    });
  }

  return index;
}

function conflictPreservationPath(sessionId: string, localSha256: string, originalPath: string): string {
  const digest = localSha256.replace(/^sha256:/u, "");
  const basename = path.posix.basename(originalPath).replace(/[^A-Za-z0-9._-]/gu, "_") || "conflict";
  return `${SYNC_IMPORT_ROOT}/${sessionId}/conflicts/${digest}/${basename}`;
}

function manifestPreservationPath(sessionId: string): string {
  return `${SYNC_IMPORT_ROOT}/${sessionId}/manifest.json`;
}

async function planJsonlMerge(input: {
  importVaultRoot: string;
  plan: MergePlan;
  relativePath: string;
  sessionId: string;
  targetVaultRoot: string;
}): Promise<void> {
  const localPath = path.join(input.importVaultRoot, input.relativePath);
  const localContent = Buffer.from(await readFile(localPath)).toString("utf8");
  const remoteRecords = await buildExistingRecordIndex(input.targetVaultRoot, input.relativePath);

  for (const record of readJsonlRecordObjects(localContent, input.relativePath)) {
    const key = stableRecordKey(record, input.relativePath);
    const localHash = sha256Prefixed(stableJson(record));
    const existing = remoteRecords.get(key);

    if (!existing) {
      input.plan.jsonlAppends.push({
        record,
        relativePath: input.relativePath,
      });
      remoteRecords.set(key, {
        hash: localHash,
        key,
      });
      continue;
    }

    if (existing.hash === localHash) {
      input.plan.duplicates += 1;
      continue;
    }

    const preservedLocalPath = conflictPreservationPath(input.sessionId, localHash, `${input.relativePath}.json`);
    const conflict: MergeVaultSyncImportConflict = {
      kind: "jsonl",
      localSha256: localHash,
      path: input.relativePath,
      preservedLocalPath,
      reason: "same_record_key_different_payload",
      remoteSha256: existing.hash,
    };
    input.plan.conflicts.push(conflict);
    input.plan.rawContents.push({
      allowExistingMatch: true,
      content: `${JSON.stringify(record, null, 2)}\n`,
      mediaType: "application/json",
      originalFileName: `${path.posix.basename(input.relativePath)}.json`,
      targetRelativePath: preservedLocalPath,
    });
  }
}

async function planRawMerge(input: {
  importVaultRoot: string;
  plan: MergePlan;
  relativePath: string;
  sessionId: string;
  targetVaultRoot: string;
}): Promise<void> {
  const localPath = path.join(input.importVaultRoot, input.relativePath);
  const localBytes = await readFile(localPath);
  const localSha256 = sha256Prefixed(localBytes);
  const remoteBytes = await readFileIfExists(path.join(input.targetVaultRoot, input.relativePath));

  if (!remoteBytes) {
    input.plan.rawCopies.push({
      allowExistingMatch: true,
      mediaType: "application/octet-stream",
      originalFileName: path.posix.basename(input.relativePath),
      sourcePath: localPath,
      targetRelativePath: input.relativePath,
    });
    return;
  }

  const remoteSha256 = sha256Prefixed(remoteBytes);
  if (remoteSha256 === localSha256) {
    input.plan.duplicates += 1;
    return;
  }

  const preservedLocalPath = conflictPreservationPath(input.sessionId, localSha256, input.relativePath);
  input.plan.conflicts.push({
    kind: "raw",
    localSha256,
    path: input.relativePath,
    preservedLocalPath,
    reason: "remote_and_local_differ",
    remoteSha256,
  });
  input.plan.rawCopies.push({
    allowExistingMatch: true,
    mediaType: "application/octet-stream",
    originalFileName: path.posix.basename(input.relativePath),
    sourcePath: localPath,
    targetRelativePath: preservedLocalPath,
  });
}

async function planTextMerge(input: {
  importVaultRoot: string;
  kind: VaultSyncImportFileKind;
  plan: MergePlan;
  relativePath: string;
  sessionId: string;
  targetVaultRoot: string;
}): Promise<void> {
  const localPath = path.join(input.importVaultRoot, input.relativePath);
  const localBytes = await readFile(localPath);
  const localSha256 = sha256Prefixed(localBytes);
  const remoteBytes = await readFileIfExists(path.join(input.targetVaultRoot, input.relativePath));

  if (!remoteBytes) {
    input.plan.textWrites.push({
      allowExistingMatch: true,
      content: Buffer.from(localBytes).toString("utf8"),
      overwrite: false,
      relativePath: input.relativePath,
    });
    return;
  }

  const remoteSha256 = sha256Prefixed(remoteBytes);
  if (remoteSha256 === localSha256) {
    input.plan.duplicates += 1;
    return;
  }

  const preservedLocalPath = conflictPreservationPath(input.sessionId, localSha256, input.relativePath);
  input.plan.conflicts.push({
    kind: input.kind === "metadata" ? "metadata" : "text",
    localSha256,
    path: input.relativePath,
    preservedLocalPath,
    reason: "remote_and_local_differ",
    remoteSha256,
  });
  input.plan.rawCopies.push({
    allowExistingMatch: true,
    mediaType: input.relativePath.endsWith(".json") ? "application/json" : "text/plain",
    originalFileName: path.posix.basename(input.relativePath),
    sourcePath: localPath,
    targetRelativePath: preservedLocalPath,
  });
}

function hasPendingWrites(plan: MergePlan): boolean {
  return plan.rawCopies.length > 0
    || plan.rawContents.length > 0
    || plan.textWrites.length > 0
    || plan.jsonlAppends.length > 0;
}

function buildMergeCanonicalWriteBatchInput(input: {
  importedAt: Date;
  plan: MergePlan;
  sessionId: string;
  vaultRoot: string;
}) {
  return {
    audit: {
      action: "document_import" as const,
      commandName: "core.mergeVaultSyncImportIntoVault",
      summary: `Merged local vault sync import ${input.sessionId}.`,
    },
    jsonlAppends: input.plan.jsonlAppends,
    occurredAt: input.importedAt,
    operationType: "vault_sync_import",
    rawContents: input.plan.rawContents,
    rawCopies: input.plan.rawCopies,
    summary: `Merge local vault sync import ${input.sessionId}`,
    textWrites: input.plan.textWrites,
    vaultRoot: input.vaultRoot,
  };
}

async function validateMergePlanAgainstCurrentVaultContracts(input: {
  importedAt: Date;
  plan: MergePlan;
  sessionId: string;
  targetVaultRoot: string;
}): Promise<void> {
  if (!hasPendingWrites(input.plan)) {
    return;
  }

  const previewVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-sync-merge-preview-"));

  try {
    await cp(input.targetVaultRoot, previewVaultRoot, { recursive: true });
    await rm(path.join(previewVaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY), {
      force: true,
      recursive: true,
    });
    await applyCanonicalWriteBatch(
      buildMergeCanonicalWriteBatchInput({
        importedAt: input.importedAt,
        plan: input.plan,
        sessionId: input.sessionId,
        vaultRoot: previewVaultRoot,
      }),
    );
    await assertValidVault({
      vaultRoot: previewVaultRoot,
      errorCode: "VAULT_SYNC_IMPORT_VALIDATION_FAILED",
      message: "Vault sync import payload failed canonical validation before commit.",
    });
  } finally {
    await rm(previewVaultRoot, { force: true, recursive: true });
  }
}

export async function mergeVaultSyncImportIntoVault(
  input: MergeVaultSyncImportInput,
): Promise<MergeVaultSyncImportResult> {
  const sessionId = normalizeOpaquePathSegment(input.sessionId, "Vault sync session id");
  const importedAt = input.importedAt ?? new Date();
  const manifest = await readVaultSyncImportManifest(input.importMetaRoot);
  const excludedFiles = manifest.excluded.length;
  return await withCanonicalWriteLockScope(input.targetVaultRoot, async () => {
    const lock = await acquireCanonicalWriteLock(input.targetVaultRoot);

    try {
      const plan: MergePlan = {
        conflicts: [],
        duplicates: 0,
        jsonlAppends: [],
        rawContents: [],
        rawCopies: [],
        textWrites: [],
      };

      for (const file of manifest.files) {
        const relativePath = normalizeRelativeVaultPath(file.path);
        if (!(await fileExists(path.join(input.importVaultRoot, relativePath)))) {
          continue;
        }

        if (file.kind === "jsonl_ledger") {
          await planJsonlMerge({
            importVaultRoot: input.importVaultRoot,
            plan,
            relativePath,
            sessionId,
            targetVaultRoot: input.targetVaultRoot,
          });
          continue;
        }

        if (file.kind === "raw") {
          await planRawMerge({
            importVaultRoot: input.importVaultRoot,
            plan,
            relativePath,
            sessionId,
            targetVaultRoot: input.targetVaultRoot,
          });
          continue;
        }

        await planTextMerge({
          importVaultRoot: input.importVaultRoot,
          kind: file.kind,
          plan,
          relativePath,
          sessionId,
          targetVaultRoot: input.targetVaultRoot,
        });
      }

      let conflictManifestPath: string | null = null;
      if (plan.conflicts.length > 0) {
        conflictManifestPath = manifestPreservationPath(sessionId);
        const conflictManifest: VaultSyncConflictManifest = {
          conflicts: plan.conflicts,
          createdAt: importedAt.toISOString(),
          schema: VAULT_SYNC_CONFLICT_MANIFEST_SCHEMA,
          sessionId,
          sourceVaultId: manifest.sourceVault.vaultId ?? null,
          summary: {
            conflictCount: plan.conflicts.length,
            importedJsonlRecords: plan.jsonlAppends.length,
            importedRawFiles: plan.rawCopies.filter((entry) => entry.targetRelativePath.startsWith(`${VAULT_LAYOUT.rawDirectory}/`) && !entry.targetRelativePath.startsWith(`${SYNC_IMPORT_ROOT}/${sessionId}/`)).length,
            importedTextFiles: plan.textWrites.length,
          },
        };
        plan.rawContents.push({
          allowExistingMatch: true,
          content: `${JSON.stringify(conflictManifest, null, 2)}\n`,
          mediaType: "application/json",
          originalFileName: "manifest.json",
          targetRelativePath: conflictManifestPath,
        });
      }

      await validateMergePlanAgainstCurrentVaultContracts({
        importedAt,
        plan,
        sessionId,
        targetVaultRoot: input.targetVaultRoot,
      });

      if (hasPendingWrites(plan)) {
        await applyCanonicalWriteBatch(
          buildMergeCanonicalWriteBatchInput({
            importedAt,
            plan,
            sessionId,
            vaultRoot: input.targetVaultRoot,
          }),
        );
      }

      return {
        conflictManifestPath,
        conflicts: plan.conflicts,
        imported: {
          jsonlRecords: plan.jsonlAppends.length,
          rawFiles: plan.rawCopies.filter((entry) => entry.targetRelativePath.startsWith(`${VAULT_LAYOUT.rawDirectory}/`) && !entry.targetRelativePath.startsWith(`${SYNC_IMPORT_ROOT}/${sessionId}/`)).length,
          textFiles: plan.textWrites.length,
        },
        sessionId,
        skipped: {
          duplicates: plan.duplicates,
          excludedFiles,
        },
      };
    } finally {
      await lock.release();
    }
  });
}
