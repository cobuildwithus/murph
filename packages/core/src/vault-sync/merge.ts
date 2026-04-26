import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  safeParseContract,
  type VaultFrontmatterFamilyDescriptor,
  type VaultJsonValidationFamilyDescriptor,
  type VaultJsonlValidationFamilyDescriptor,
  VAULT_FRONTMATTER_FAMILIES,
  VAULT_JSON_VALIDATION_FAMILIES,
  VAULT_JSONL_VALIDATION_FAMILIES,
} from "@murphai/contracts";

import { VAULT_LAYOUT } from "../constants.ts";
import { VaultError } from "../errors.ts";
import { parseFrontmatterDocument } from "../frontmatter.ts";
import {
  acquireCanonicalWriteLock,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  withCanonicalWriteLockScope,
} from "../operations/canonical-write-lock.ts";
import { normalizeOpaquePathSegment, normalizeRelativeVaultPath } from "../path-safety.ts";
import {
  applyCanonicalWriteBatch,
  type CanonicalJsonlAppendInput,
  type CanonicalRawContentInput,
  type CanonicalRawCopyInput,
  type CanonicalTextWriteInput,
} from "../public-mutations.ts";
import type { UnknownRecord } from "../types.ts";
import { assertValidVault, validateJsonlRecordAgainstVault } from "../vault.ts";
import {
  readVaultSyncImportManifest,
  readVerifiedImportFileBytes,
} from "./manifest.ts";
import {
  SYNC_IMPORT_ROOT,
  VAULT_SYNC_CONFLICT_MANIFEST_SCHEMA,
  type MergeVaultSyncImportConflict,
  type MergeVaultSyncImportInput,
  type MergeVaultSyncImportResult,
  type VaultSyncConflictManifest,
  type VaultSyncImportFileKind,
} from "./types.ts";

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

const MAX_IMPORT_JSONL_LINE_BYTES = 1024 * 1024;
const MAX_IMPORT_JSONL_RECORDS_PER_FILE = 100_000;

export interface MergePlan {
  conflicts: MergeVaultSyncImportConflict[];
  duplicates: number;
  jsonlAppends: CanonicalJsonlAppendInput<Record<string, unknown>>[];
  rawContents: CanonicalRawContentInput[];
  rawCopies: CanonicalRawCopyInput[];
  textWrites: CanonicalTextWriteInput[];
}

export interface ExistingRecordIndexEntry {
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

function startsWithPath(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
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

function findJsonlValidationFamily(relativePath: string): VaultJsonlValidationFamilyDescriptor | null {
  return VAULT_JSONL_VALIDATION_FAMILIES.find((family) =>
    relativePath.endsWith(family.fileExtension) && startsWithPath(relativePath, family.directory)
  ) ?? null;
}

function findFrontmatterValidationFamily(relativePath: string): VaultFrontmatterFamilyDescriptor | null {
  for (const family of VAULT_FRONTMATTER_FAMILIES) {
    if (
      family.storageKind === "singleton-file"
        ? family.relativePath === relativePath
        : relativePath.endsWith(family.fileExtension) && startsWithPath(relativePath, family.directory)
    ) {
      return family;
    }
  }

  return null;
}

function findJsonValidationFamily(relativePath: string): VaultJsonValidationFamilyDescriptor | null {
  return VAULT_JSON_VALIDATION_FAMILIES.find((family) => family.relativePath === relativePath) ?? null;
}

function throwImportValidationFailed(input: {
  code: string;
  details?: { errors: string[] };
  message: string;
  relativePath: string;
}): never {
  throw new VaultError(
    "VAULT_SYNC_IMPORT_VALIDATION_FAILED",
    "Vault sync import payload failed canonical validation before commit.",
    {
      issues: [
        {
          code: input.code,
          ...(input.details ? { details: input.details } : {}),
          message: input.message,
          path: input.relativePath,
          severity: "error",
        },
      ],
    },
  );
}

function throwImportValidationIssues(issues: Array<{
  code: string;
  message: string;
  path?: string;
  severity: string;
}>): never {
  throw new VaultError(
    "VAULT_SYNC_IMPORT_VALIDATION_FAILED",
    "Vault sync import payload failed canonical validation before commit.",
    {
      issues,
    },
  );
}

export async function assertImportedJsonlRecordValid(input: {
  importVaultRoot: string;
  index: number;
  record: Record<string, unknown>;
  relativePath: string;
}): Promise<void> {
  const { importVaultRoot, index, record, relativePath } = input;
  const family = findJsonlValidationFamily(relativePath);
  if (!family) {
    return;
  }

  const result = safeParseContract(family.validation.schema, record);
  if (!result.success) {
    throwImportValidationFailed({
      code: family.validation.issueCode,
      details: {
        errors: result.errors,
      },
      message: `record ${index + 1}: ${result.errors.join("; ")}`,
      relativePath,
    });
  }

  const issues = await validateJsonlRecordAgainstVault({
    familyId: family.id,
    index,
    record: result.data as UnknownRecord,
    relativePath,
    vaultRoot: importVaultRoot,
  });
  if (issues.length > 0) {
    throwImportValidationIssues(issues);
  }
}

export function assertImportedTextFileValid(content: string, relativePath: string): void {
  const frontmatterFamily = findFrontmatterValidationFamily(relativePath);
  if (frontmatterFamily) {
    let parsed: ReturnType<typeof parseFrontmatterDocument>;
    try {
      parsed = parseFrontmatterDocument(content);
    } catch (error) {
      throwImportValidationFailed({
        code: frontmatterFamily.validation.issueCode,
        message: error instanceof Error ? error.message : String(error),
        relativePath,
      });
    }

    const result = safeParseContract(frontmatterFamily.validation.schema, parsed.attributes);
    if (!result.success) {
      throwImportValidationFailed({
        code: frontmatterFamily.validation.issueCode,
        details: {
          errors: result.errors,
        },
        message: result.errors.join("; "),
        relativePath,
      });
    }
    return;
  }

  const jsonFamily = findJsonValidationFamily(relativePath);
  if (!jsonFamily) {
    throwImportValidationFailed({
      code: "VAULT_SYNC_IMPORT_UNSUPPORTED_TEXT_PATH",
      message: "Vault sync import text path is not a supported canonical contract path.",
      relativePath,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throwImportValidationFailed({
      code: jsonFamily.validation.issueCode,
      message: error instanceof Error ? error.message : String(error),
      relativePath,
    });
  }

  const result = safeParseContract(jsonFamily.validation.schema, parsed);
  if (!result.success) {
    throwImportValidationFailed({
      code: jsonFamily.validation.issueCode,
      details: {
        errors: result.errors,
      },
      message: result.errors.join("; "),
      relativePath,
    });
  }
}

function* readJsonlRecordObjects(content: string, relativePath: string): Generator<Record<string, unknown>> {
  let lineStart = 0;
  let lineNumber = 1;
  let recordCount = 0;

  for (let index = 0; index <= content.length; index += 1) {
    if (index < content.length && content[index] !== "\n") {
      continue;
    }

    const rawLine = content.slice(lineStart, index).replace(/\r$/u, "");
    if (Buffer.byteLength(rawLine, "utf8") > MAX_IMPORT_JSONL_LINE_BYTES) {
      throw new VaultError("VAULT_SYNC_INVALID_JSONL", "JSONL import line exceeds the size limit.", {
        line: lineNumber,
        maxBytes: MAX_IMPORT_JSONL_LINE_BYTES,
        relativePath,
      });
    }

    const line = rawLine.trim();
    if (!line) {
      lineStart = index + 1;
      lineNumber += 1;
      continue;
    }

    recordCount += 1;
    if (recordCount > MAX_IMPORT_JSONL_RECORDS_PER_FILE) {
      throw new VaultError("VAULT_SYNC_INVALID_JSONL", "JSONL import file contains too many records.", {
        maxRecords: MAX_IMPORT_JSONL_RECORDS_PER_FILE,
        relativePath,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new VaultError("VAULT_SYNC_INVALID_JSONL", "JSONL import line must be valid JSON.", {
        line: lineNumber,
        message: error instanceof Error ? error.message : String(error),
        relativePath,
      });
    }
    if (!isPlainObject(parsed)) {
      throw new VaultError("VAULT_SYNC_INVALID_JSONL", "JSONL import records must be objects.", {
        line: lineNumber,
        relativePath,
      });
    }
    yield parsed;
    lineStart = index + 1;
    lineNumber += 1;
  }
}

export async function buildExistingRecordIndex(
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

function manifestPreservationPath(sessionId: string): string {
  return `${SYNC_IMPORT_ROOT}/${sessionId}/manifest.json`;
}

export async function planJsonlMerge(input: {
  importVaultRoot: string;
  localContent: string;
  plan: MergePlan;
  relativePath: string;
  sessionId: string;
  targetVaultRoot: string;
}): Promise<void> {
  const remoteRecords = await buildExistingRecordIndex(input.targetVaultRoot, input.relativePath);

  let index = 0;
  for (const record of readJsonlRecordObjects(input.localContent, input.relativePath)) {
    const recordIndex = index;
    index += 1;
    await assertImportedJsonlRecordValid({
      importVaultRoot: input.importVaultRoot,
      index: recordIndex,
      record,
      relativePath: input.relativePath,
    });
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

    const conflict: MergeVaultSyncImportConflict = {
      kind: "jsonl",
      localSha256: localHash,
      path: input.relativePath,
      preservedLocalPath: null,
      reason: "same_record_key_different_payload",
      remoteSha256: existing.hash,
    };
    input.plan.conflicts.push(conflict);
  }
}

export async function planRawMerge(input: {
  localBytes: Uint8Array;
  plan: MergePlan;
  relativePath: string;
  sessionId: string;
  targetVaultRoot: string;
}): Promise<void> {
  const localSha256 = sha256Prefixed(input.localBytes);
  const remoteBytes = await readFileIfExists(path.join(input.targetVaultRoot, input.relativePath));

  if (!remoteBytes) {
    input.plan.rawContents.push({
      allowExistingMatch: true,
      content: input.localBytes,
      mediaType: "application/octet-stream",
      originalFileName: path.posix.basename(input.relativePath),
      targetRelativePath: input.relativePath,
    });
    return;
  }

  const remoteSha256 = sha256Prefixed(remoteBytes);
  if (remoteSha256 === localSha256) {
    input.plan.duplicates += 1;
    return;
  }

  input.plan.conflicts.push({
    kind: "raw",
    localSha256,
    path: input.relativePath,
    preservedLocalPath: null,
    reason: "remote_and_local_differ",
    remoteSha256,
  });
}

export async function planTextMerge(input: {
  kind: VaultSyncImportFileKind;
  localBytes: Uint8Array;
  plan: MergePlan;
  relativePath: string;
  sessionId: string;
  targetVaultRoot: string;
}): Promise<void> {
  const content = Buffer.from(input.localBytes).toString("utf8");
  assertImportedTextFileValid(content, input.relativePath);
  const localSha256 = sha256Prefixed(input.localBytes);
  const remoteBytes = await readFileIfExists(path.join(input.targetVaultRoot, input.relativePath));

  if (!remoteBytes) {
    input.plan.textWrites.push({
      allowExistingMatch: true,
      content,
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

  input.plan.conflicts.push({
    kind: input.kind === "metadata" ? "metadata" : "text",
    localSha256,
    path: input.relativePath,
    preservedLocalPath: null,
    reason: "remote_and_local_differ",
    remoteSha256,
  });
}

function hasPendingWrites(plan: MergePlan): boolean {
  return plan.rawCopies.length > 0
    || plan.rawContents.length > 0
    || plan.textWrites.length > 0
    || plan.jsonlAppends.length > 0;
}

function countImportedRawFiles(plan: MergePlan, sessionId: string): number {
  const isImportedRawPath = (relativePath: string): boolean =>
    relativePath.startsWith(`${VAULT_LAYOUT.rawDirectory}/`) && !relativePath.startsWith(`${SYNC_IMPORT_ROOT}/${sessionId}/`);

  return plan.rawCopies.filter((entry) => isImportedRawPath(entry.targetRelativePath)).length
    + plan.rawContents.filter((entry) => isImportedRawPath(entry.targetRelativePath)).length;
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

export async function validateMergePlanAgainstCurrentVaultContracts(input: {
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
  const excludedFiles = manifest.excluded.reduce((total, entry) => total + entry.count, 0);
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
        const localBytes = await readVerifiedImportFileBytes({
          expectedBytes: file.bytes,
          expectedSha256: file.sha256,
          importVaultRoot: input.importVaultRoot,
          relativePath,
        });

        if (file.kind === "jsonl_ledger") {
          await planJsonlMerge({
            importVaultRoot: input.importVaultRoot,
            localContent: Buffer.from(localBytes).toString("utf8"),
            plan,
            relativePath,
            sessionId,
            targetVaultRoot: input.targetVaultRoot,
          });
          continue;
        }

        if (file.kind === "raw") {
          await planRawMerge({
            localBytes,
            plan,
            relativePath,
            sessionId,
            targetVaultRoot: input.targetVaultRoot,
          });
          continue;
        }

        await planTextMerge({
          kind: file.kind,
          localBytes,
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
            importedRawFiles: countImportedRawFiles(plan, sessionId),
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
          rawFiles: countImportedRawFiles(plan, sessionId),
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
