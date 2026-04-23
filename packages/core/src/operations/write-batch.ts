import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

import {
  copyFileAtomic,
  copyFileAtomicExclusive,
  writeTextFileAtomic,
} from "../atomic-write.ts";
import { VaultError } from "../errors.ts";
import { ensureDirectory, pathExists, walkVaultFiles } from "../fs.ts";
import { VAULT_LAYOUT } from "../constants.ts";
import {
  isJsonlRelativePath,
  isVaultFilesystemCaseInsensitive,
  normalizeRelativeVaultPath,
  normalizeRelativeVaultPathForComparison,
  normalizeVaultRoot,
  resolveVaultPath,
  type VaultPathComparisonOptions,
} from "../path-safety.ts";
import { toIsoTimestamp } from "../time.ts";
import { isErrnoException, isPlainRecord } from "../types.ts";
import {
  applyImmutableWriteTarget,
  applyJsonlAppendTarget,
  applyTextWriteTarget,
  assertWriteTargetPolicy,
  assertWriteTargetPolicyForVault,
  prepareVerifiedDeleteTarget,
  prepareVerifiedWriteTarget,
  type ResolvedVaultPath,
} from "../write-policy.ts";
import { acquireCanonicalWriteLock } from "./canonical-write-lock.ts";

import type { DateInput } from "../types.ts";

export const WRITE_OPERATION_SCHEMA_VERSION = "murph.write-operation.v1";
export const WRITE_OPERATION_DIRECTORY = ".runtime/operations";

type WriteOperationStatus = "staged" | "committing" | "committed" | "rolled_back" | "failed";
type WriteOperationActionState = "staged" | "applied" | "reused" | "rolled_back";
const PROTECTED_CANONICAL_ROOT_FILES = new Set<string>([VAULT_LAYOUT.metadata, VAULT_LAYOUT.coreDocument]);
const CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV = "MURPH_CANONICAL_WRITE_GUARD_RECEIPT_DIR";
const WRITE_OPERATION_GUARD_RECEIPT_SCHEMA_VERSION = "murph.write-operation-guard-receipt.v1";

export interface CommittedPayloadReceipt {
  sha256: string;
  byteLength: number;
}

interface WriteOperationGuardReceipt {
  schemaVersion: typeof WRITE_OPERATION_GUARD_RECEIPT_SCHEMA_VERSION;
  operationId: string;
  createdAt: string;
  updatedAt: string;
  actions: WriteOperationGuardReceiptAction[];
}

type WriteOperationGuardReceiptAction =
  | {
      kind: "delete";
      targetRelativePath: string;
    }
  | {
      kind: "jsonl_append" | "text_write";
      targetRelativePath: string;
      committedPayloadReceipt: CommittedPayloadReceipt;
      payloadRelativePath: string;
    };

interface CreateWriteBatchInput {
  vaultRoot: string;
  operationType: string;
  summary: string;
  occurredAt?: DateInput;
}

interface RunCanonicalWriteInput<TResult> extends CreateWriteBatchInput {
  mutate: (context: { batch: WriteBatch; vaultRoot: string }) => Promise<TResult>;
}

interface StageTextWriteOptions {
  allowRaw?: boolean;
  allowAppendOnlyJsonl?: boolean;
  overwrite?: boolean;
  allowExistingMatch?: boolean;
}

interface StageRawCopyOptions {
  allowExistingMatch?: boolean;
}

interface StageRawCopyInput extends StageRawCopyOptions {
  sourcePath: string;
  targetRelativePath: string;
  originalFileName: string;
  mediaType: string;
}

interface StageRawTextInput extends StageRawCopyOptions {
  targetRelativePath: string;
  originalFileName: string;
  mediaType: string;
  content: string;
}

interface StageRawBytesInput extends StageRawCopyOptions {
  targetRelativePath: string;
  originalFileName: string;
  mediaType: string;
  content: Uint8Array;
}

interface StageRawContentInput extends StageRawCopyOptions {
  targetRelativePath: string;
  originalFileName: string;
  mediaType: string;
  content: string | Uint8Array;
}

interface StagedRawCopy {
  relativePath: string;
  originalFileName: string;
  mediaType: string;
  stagedAbsolutePath: string;
}

type StoredWriteAction =
  | {
      kind: "raw_copy";
      state: WriteOperationActionState;
      targetRelativePath: string;
      stageRelativePath: string;
      allowExistingMatch: boolean;
      originalFileName: string;
      mediaType: string;
      effect?: "copy" | "reuse";
      existedBefore?: boolean;
      appliedAt?: string;
      rolledBackAt?: string;
    }
  | {
      kind: "text_write";
      state: WriteOperationActionState;
      targetRelativePath: string;
      stageRelativePath: string;
      overwrite: boolean;
      allowExistingMatch: boolean;
      allowRaw: boolean;
      effect?: "create" | "update" | "reuse";
      existedBefore?: boolean;
      backupRelativePath?: string;
      committedPayloadReceipt?: CommittedPayloadReceipt;
      appliedAt?: string;
      rolledBackAt?: string;
    }
  | {
      kind: "jsonl_append";
      state: WriteOperationActionState;
      targetRelativePath: string;
      stageRelativePath: string;
      effect?: "append";
      existedBefore?: boolean;
      originalSize?: number;
      committedPayloadReceipt?: CommittedPayloadReceipt;
      appliedAt?: string;
      rolledBackAt?: string;
    }
  | {
      kind: "delete";
      state: WriteOperationActionState;
      targetRelativePath: string;
      effect?: "delete";
      existedBefore?: boolean;
      backupRelativePath?: string;
      appliedAt?: string;
      rolledBackAt?: string;
    };

type BackupCapableStoredWriteAction = Extract<StoredWriteAction, { kind: "text_write" | "delete" }>;
type DeleteActionMutationResult =
  | {
      existedBefore: false;
      state: "reused";
    }
  | {
      backupRelativePath: string;
      existedBefore: true;
      state: "applied";
    };

interface StoredWriteOperationError {
  code?: string;
  message: string;
}

export interface StoredWriteOperation {
  schemaVersion: typeof WRITE_OPERATION_SCHEMA_VERSION;
  operationId: string;
  operationType: string;
  summary: string;
  status: WriteOperationStatus;
  createdAt: string;
  updatedAt: string;
  occurredAt: string;
  actions: StoredWriteAction[];
  error?: StoredWriteOperationError;
}

export interface RecoverableStoredWriteOperation {
  operationId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  actions: StoredWriteAction[];
}

function isStoredWriteOperationStatus(value: unknown): value is WriteOperationStatus {
  return (
    value === "staged" ||
    value === "committing" ||
    value === "committed" ||
    value === "rolled_back" ||
    value === "failed"
  );
}

function parseWriteOperationActionState(value: unknown): WriteOperationActionState | null {
  return value === "staged" || value === "applied" || value === "reused" || value === "rolled_back"
    ? value
    : null;
}

function nowIso(): string {
  return toIsoTimestamp(new Date(), "updatedAt");
}

function generateOperationId(): string {
  return `op_${randomUUID().replace(/-/g, "")}`;
}

function createCommittedPayloadReceipt(content: string | Uint8Array): CommittedPayloadReceipt {
  const buffer = Buffer.from(content);
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    byteLength: buffer.byteLength,
  };
}

function normalizeStoredRelativePath(candidate: unknown): string | null {
  if (typeof candidate !== "string") {
    return null;
  }

  try {
    const normalized = normalizeRelativeVaultPath(candidate);
    return normalized === candidate ? normalized : null;
  } catch {
    return null;
  }
}

function parseStoredOptionalBackupRelativePath(
  record: Record<string, unknown>,
): string | undefined | null {
  if (!("backupRelativePath" in record) || record.backupRelativePath === undefined) {
    return undefined;
  }

  return normalizeStoredRelativePath(record.backupRelativePath);
}

function parseStoredRequiredStageRelativePath(record: Record<string, unknown>): string | null {
  return normalizeStoredRelativePath(record.stageRelativePath);
}

interface ParsedStoredActionBase {
  appliedAt?: string;
  existedBefore?: boolean;
  rolledBackAt?: string;
  state: WriteOperationActionState;
  targetRelativePath: string;
}

function parseStoredActionBase(record: Record<string, unknown>): ParsedStoredActionBase | null {
  const state = parseWriteOperationActionState(record.state);
  const targetRelativePath = normalizeStoredRelativePath(record.targetRelativePath);
  if (!state || !targetRelativePath) {
    return null;
  }

  return {
    appliedAt: typeof record.appliedAt === "string" ? record.appliedAt : undefined,
    existedBefore: typeof record.existedBefore === "boolean" ? record.existedBefore : undefined,
    rolledBackAt: typeof record.rolledBackAt === "string" ? record.rolledBackAt : undefined,
    state,
    targetRelativePath,
  };
}

function parseCommittedPayloadReceipt(value: unknown): CommittedPayloadReceipt | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainRecord(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.sha256) ||
    typeof record.byteLength !== "number" ||
    !Number.isInteger(record.byteLength) ||
    record.byteLength < 0
  ) {
    return null;
  }

  return {
    sha256: record.sha256,
    byteLength: record.byteLength,
  };
}

function resolveGuardReceiptDirectoryFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidate = typeof env[CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV] === "string"
    ? env[CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV]?.trim()
    : "";
  return candidate ? path.resolve(candidate) : null;
}

function metadataRelativePath(operationId: string): string {
  return `${WRITE_OPERATION_DIRECTORY}/${operationId}.json`;
}

function stageRootRelativePath(operationId: string): string {
  return `${WRITE_OPERATION_DIRECTORY}/${operationId}`;
}

function stageArtifactRelativePath(operationId: string, fileName: string): string {
  return `${stageRootRelativePath(operationId)}/payloads/${fileName}`;
}

function backupArtifactRelativePath(operationId: string, fileName: string): string {
  return `${stageRootRelativePath(operationId)}/backups/${fileName}`;
}

function toStoredOperationError(error: unknown): StoredWriteOperationError {
  if (error instanceof VaultError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

async function readText(absolutePath: string): Promise<string> {
  return fs.readFile(absolutePath, "utf8");
}

async function safeUnlink(absolutePath: string): Promise<void> {
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

export function isTerminalWriteOperationStatus(status: string): boolean {
  return status === "committed" || status === "rolled_back";
}

export async function listWriteOperationMetadataPaths(vaultRoot: string): Promise<string[]> {
  const operationFiles = await walkVaultFiles(vaultRoot, WRITE_OPERATION_DIRECTORY, {
    extension: ".json",
  });

  return operationFiles.filter((relativePath) => path.posix.dirname(relativePath) === WRITE_OPERATION_DIRECTORY);
}

function parseStoredAction(value: unknown): StoredWriteAction | null {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const base = parseStoredActionBase(record);
  if (!base) {
    return null;
  }

  switch (record.kind) {
    case "delete": {
      const backupRelativePath = parseStoredOptionalBackupRelativePath(record);
      if (backupRelativePath === null) {
        return null;
      }

      return {
        kind: "delete",
        ...base,
        backupRelativePath,
        effect: record.effect === "delete" ? record.effect : undefined,
      };
    }
    case "raw_copy": {
      const stageRelativePath = parseStoredRequiredStageRelativePath(record);
      if (!stageRelativePath) {
        return null;
      }

      return {
        kind: "raw_copy",
        ...base,
        allowExistingMatch: record.allowExistingMatch === true,
        effect: record.effect === "copy" || record.effect === "reuse" ? record.effect : undefined,
        mediaType: typeof record.mediaType === "string" ? record.mediaType : "",
        originalFileName: typeof record.originalFileName === "string" ? record.originalFileName : "",
        stageRelativePath,
      };
    }
    case "text_write": {
      const stageRelativePath = parseStoredRequiredStageRelativePath(record);
      if (!stageRelativePath) {
        return null;
      }

      const backupRelativePath = parseStoredOptionalBackupRelativePath(record);
      if (backupRelativePath === null) {
        return null;
      }

      const committedPayloadReceipt = parseCommittedPayloadReceipt(record.committedPayloadReceipt);
      if (committedPayloadReceipt === null) {
        return null;
      }

      return {
        kind: "text_write",
        ...base,
        allowExistingMatch: record.allowExistingMatch === true,
        allowRaw: record.allowRaw === true,
        backupRelativePath,
        committedPayloadReceipt,
        effect:
          record.effect === "create" || record.effect === "update" || record.effect === "reuse"
            ? record.effect
            : undefined,
        overwrite: record.overwrite !== false,
        stageRelativePath,
      };
    }
    case "jsonl_append": {
      const stageRelativePath = parseStoredRequiredStageRelativePath(record);
      if (!stageRelativePath) {
        return null;
      }

      const committedPayloadReceipt = parseCommittedPayloadReceipt(record.committedPayloadReceipt);
      if (committedPayloadReceipt === null) {
        return null;
      }

      return {
        kind: "jsonl_append",
        ...base,
        committedPayloadReceipt,
        effect: record.effect === "append" ? record.effect : undefined,
        originalSize:
          typeof record.originalSize === "number" && Number.isFinite(record.originalSize)
            ? record.originalSize
            : undefined,
        stageRelativePath,
      };
    }
    default:
      return null;
  }
}

export function isProtectedCanonicalPath(
  relativePath: string,
  options: VaultPathComparisonOptions = {},
): boolean {
  let normalizedRelativePath: string;
  try {
    normalizedRelativePath = normalizeRelativeVaultPath(relativePath);
  } catch {
    return false;
  }

  const comparisonRelativePath = normalizeRelativeVaultPathForComparison(normalizedRelativePath, options);
  const bankDirectory = normalizeRelativeVaultPathForComparison(VAULT_LAYOUT.bankDirectory, options);
  const journalDirectory = normalizeRelativeVaultPathForComparison(VAULT_LAYOUT.journalDirectory, options);
  const ledgerDirectory = normalizeRelativeVaultPathForComparison(VAULT_LAYOUT.ledgerDirectory, options);
  const auditDirectory = normalizeRelativeVaultPathForComparison(VAULT_LAYOUT.auditDirectory, options);

  // Raw artifacts stay outside the protected canonical-write set; assistant turns
  // rely on the shared Murph runtime/tool boundary rather than a second workspace guard.
  return (
    [...PROTECTED_CANONICAL_ROOT_FILES].some(
      (protectedRelativePath) =>
        normalizeRelativeVaultPathForComparison(protectedRelativePath, options) === comparisonRelativePath,
    ) ||
    comparisonRelativePath.startsWith(`${journalDirectory}/`) ||
    comparisonRelativePath.startsWith(`${bankDirectory}/`) ||
    (comparisonRelativePath.startsWith(`${ledgerDirectory}/`) &&
      isJsonlRelativePath(normalizedRelativePath, options)) ||
    (comparisonRelativePath.startsWith(`${auditDirectory}/`) &&
      isJsonlRelativePath(normalizedRelativePath, options))
  );
}

export async function isProtectedCanonicalPathForVault(
  vaultRoot: string,
  relativePath: string,
): Promise<boolean> {
  return isProtectedCanonicalPath(relativePath, {
    caseInsensitive: await isVaultFilesystemCaseInsensitive(vaultRoot),
  });
}

export async function listProtectedCanonicalPaths(vaultRoot: string): Promise<string[]> {
  const matches = new Set<string>();

  await Promise.all(
    [...PROTECTED_CANONICAL_ROOT_FILES].map(async (relativePath) => {
      if (await pathExists(resolveVaultPath(vaultRoot, relativePath).absolutePath)) {
        matches.add(relativePath);
      }
    }),
  );

  for (const relativeDirectory of [
    VAULT_LAYOUT.journalDirectory,
    VAULT_LAYOUT.bankDirectory,
    VAULT_LAYOUT.ledgerDirectory,
    VAULT_LAYOUT.auditDirectory,
  ]) {
    await walkProtectedCanonicalFiles(vaultRoot, relativeDirectory, matches);
  }

  return [...matches].sort();
}

async function walkProtectedCanonicalFiles(
  vaultRoot: string,
  relativeDirectory: string,
  matches: Set<string>,
): Promise<void> {
  const absoluteDirectory = resolveVaultPath(vaultRoot, relativeDirectory).absolutePath;
  if (!(await pathExists(absoluteDirectory))) {
    return;
  }

  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const childRelativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      await walkProtectedCanonicalFiles(vaultRoot, childRelativePath, matches);
      continue;
    }

    if (entry.isFile() && (await isProtectedCanonicalPathForVault(vaultRoot, childRelativePath))) {
      matches.add(childRelativePath);
    }
  }
}

function parseStoredActions(value: unknown): StoredWriteAction[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const actions: StoredWriteAction[] = [];
  for (const candidate of value) {
    const action = parseStoredAction(candidate);
    if (!action) {
      return null;
    }
    actions.push(action);
  }
  return actions;
}

function hasMissingCommittedPayloadReceipts(status: string, actions: StoredWriteAction[]): boolean {
  return (
    status === "committed" &&
    actions.some(
      (action) =>
        (action.kind === "text_write" || action.kind === "jsonl_append") &&
        action.committedPayloadReceipt === undefined,
    )
  );
}

function parseStoredOperationError(value: unknown): StoredWriteOperationError | undefined {
  return isPlainRecord(value) && typeof value.message === "string"
    ? {
        message: value.message,
        code: typeof value.code === "string" ? value.code : undefined,
      }
    : undefined;
}

function parseStrictStoredWriteOperation(raw: Record<string, unknown>): StoredWriteOperation | null {
  const actions = parseStoredActions(raw.actions);
  if (
    raw.schemaVersion !== WRITE_OPERATION_SCHEMA_VERSION ||
    typeof raw.operationId !== "string" ||
    typeof raw.operationType !== "string" ||
    typeof raw.summary !== "string" ||
    !isStoredWriteOperationStatus(raw.status) ||
    typeof raw.createdAt !== "string" ||
    typeof raw.updatedAt !== "string" ||
    typeof raw.occurredAt !== "string" ||
    !actions
  ) {
    return null;
  }

  return {
    schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
    operationId: raw.operationId,
    operationType: raw.operationType,
    summary: raw.summary,
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    occurredAt: raw.occurredAt,
    actions,
    error: parseStoredOperationError(raw.error),
  };
}

function parseRecoverableStoredWriteOperationRecord(
  raw: Record<string, unknown>,
): RecoverableStoredWriteOperation | null {
  const actions = parseStoredActions(raw.actions);
  if (
    typeof raw.operationId !== "string" ||
    typeof raw.createdAt !== "string" ||
    typeof raw.updatedAt !== "string" ||
    typeof raw.status !== "string" ||
    !actions
  ) {
    return null;
  }

  if (hasMissingCommittedPayloadReceipts(raw.status, actions)) {
    return null;
  }

  return {
    operationId: raw.operationId,
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    actions,
  };
}

export async function readStoredWriteOperation(
  vaultRoot: string,
  relativePath: string,
): Promise<StoredWriteOperation> {
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  const raw = JSON.parse(await readText(resolved.absolutePath));

  if (!isPlainRecord(raw)) {
    throw new VaultError("OPERATION_INVALID", "Write operation metadata must be a JSON object.", {
      relativePath,
    });
  }

  const operation = parseStrictStoredWriteOperation(raw);
  if (!operation) {
    throw new VaultError("OPERATION_INVALID", "Write operation metadata has an unexpected shape.", {
      relativePath,
    });
  }

  if (hasMissingCommittedPayloadReceipts(operation.status, operation.actions)) {
    throw new VaultError(
      "OPERATION_INVALID",
      "Committed write operation metadata is missing committed payload receipts.",
      {
        relativePath,
      },
    );
  }

  return operation;
}

export async function readRecoverableStoredWriteOperation(
  vaultRoot: string,
  relativePath: string,
): Promise<RecoverableStoredWriteOperation | null> {
  try {
    const resolved = resolveVaultPath(vaultRoot, relativePath);
    const raw = JSON.parse(await readText(resolved.absolutePath));
    return isPlainRecord(raw) ? parseRecoverableStoredWriteOperationRecord(raw) : null;
  } catch {
    return null;
  }
}

export async function runCanonicalWrite<TResult>({
  vaultRoot,
  operationType,
  summary,
  occurredAt = new Date(),
  mutate,
}: RunCanonicalWriteInput<TResult>): Promise<TResult> {
  const batch = await WriteBatch.create({
    vaultRoot,
    operationType,
    summary,
    occurredAt,
  });

  let result: TResult;

  try {
    result = await mutate({
      batch,
      vaultRoot: batch.vaultRoot,
    });
  } catch (error) {
    await batch.rollback();
    throw error;
  }

  await batch.commit();
  return result;
}

export class WriteBatch {
  readonly vaultRoot: string;
  readonly operationId: string;
  readonly metadataRelativePath: string;
  readonly stageRootRelativePath: string;

  private readonly metadataAbsolutePath: string;
  private readonly stageRootAbsolutePath: string;
  private readonly record: StoredWriteOperation;

  private constructor(vaultRoot: string, record: StoredWriteOperation) {
    this.vaultRoot = vaultRoot;
    this.operationId = record.operationId;
    this.metadataRelativePath = metadataRelativePath(record.operationId);
    this.stageRootRelativePath = stageRootRelativePath(record.operationId);
    this.metadataAbsolutePath = resolveVaultPath(vaultRoot, this.metadataRelativePath).absolutePath;
    this.stageRootAbsolutePath = resolveVaultPath(vaultRoot, this.stageRootRelativePath).absolutePath;
    this.record = record;
  }

  static async create({
    vaultRoot,
    operationType,
    summary,
    occurredAt = new Date(),
  }: CreateWriteBatchInput): Promise<WriteBatch> {
    const absoluteRoot = normalizeVaultRoot(vaultRoot);
    const operationId = generateOperationId();
    const createdAt = nowIso();
    const record: StoredWriteOperation = {
      schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
      operationId,
      operationType: String(operationType).trim() || "write_batch",
      summary: String(summary).trim() || "write_batch",
      status: "staged",
      createdAt,
      updatedAt: createdAt,
      occurredAt: toIsoTimestamp(occurredAt, "occurredAt"),
      actions: [],
    };
    const batch = new WriteBatch(absoluteRoot, record);
    await ensureDirectory(path.dirname(batch.metadataAbsolutePath));
    await ensureDirectory(batch.stageRootAbsolutePath);
    await batch.persist();
    return batch;
  }

  async stageRawCopy({
    sourcePath,
    targetRelativePath,
    allowExistingMatch = false,
    originalFileName,
    mediaType,
  }: StageRawCopyInput): Promise<StagedRawCopy> {
    this.assertMutable();
    const normalizedTarget = normalizeRelativeVaultPath(targetRelativePath);
    await assertWriteTargetPolicyForVault(this.vaultRoot, normalizedTarget, {
      kind: "raw",
      messages: {
        rawRequired: "Raw copies must target the raw/ tree.",
      },
    });

    const sourceAbsolutePath = path.resolve(String(sourcePath ?? "").trim());
    if (!(await pathExists(sourceAbsolutePath))) {
      throw new VaultError("VAULT_SOURCE_MISSING", "Raw source file does not exist.");
    }

    const sourceStats = await fs.stat(sourceAbsolutePath);
    if (!sourceStats.isFile()) {
      throw new VaultError("VAULT_SOURCE_INVALID", "Raw source path must point to a file.");
    }

    const stageRelativePath = stageArtifactRelativePath(
      this.operationId,
      `${String(this.record.actions.length).padStart(4, "0")}.raw`,
    );
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, stageRelativePath).absolutePath;
    await ensureDirectory(path.dirname(stageAbsolutePath));
    await fs.copyFile(sourceAbsolutePath, stageAbsolutePath);

    this.record.actions.push({
      kind: "raw_copy",
      state: "staged",
      targetRelativePath: normalizedTarget,
      stageRelativePath,
      allowExistingMatch,
      originalFileName,
      mediaType,
    });
    await this.persist();

    return {
      relativePath: normalizedTarget,
      originalFileName,
      mediaType,
      stagedAbsolutePath: stageAbsolutePath,
    };
  }

  async stageRawText({
    targetRelativePath,
    originalFileName,
    mediaType,
    content,
    allowExistingMatch = false,
  }: StageRawTextInput): Promise<StagedRawCopy> {
    return this.stageRawContent({
      targetRelativePath,
      originalFileName,
      mediaType,
      content,
      allowExistingMatch,
    });
  }

  async stageRawBytes({
    targetRelativePath,
    originalFileName,
    mediaType,
    content,
    allowExistingMatch = false,
  }: StageRawBytesInput): Promise<StagedRawCopy> {
    return this.stageRawContent({
      targetRelativePath,
      originalFileName,
      mediaType,
      content,
      allowExistingMatch,
    });
  }

  private async stageRawContent({
    targetRelativePath,
    originalFileName,
    mediaType,
    content,
    allowExistingMatch = false,
  }: StageRawContentInput): Promise<StagedRawCopy> {
    this.assertMutable();
    const normalizedTarget = normalizeRelativeVaultPath(targetRelativePath);
    await assertWriteTargetPolicyForVault(this.vaultRoot, normalizedTarget, {
      kind: "raw",
      messages: {
        rawRequired: "Raw copies must target the raw/ tree.",
      },
    });

    const stageRelativePath = stageArtifactRelativePath(
      this.operationId,
      `${String(this.record.actions.length).padStart(4, "0")}.raw`,
    );
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, stageRelativePath).absolutePath;
    await ensureDirectory(path.dirname(stageAbsolutePath));
    if (typeof content === "string") {
      await fs.writeFile(stageAbsolutePath, content, "utf8");
    } else {
      await fs.writeFile(stageAbsolutePath, content);
    }

    this.record.actions.push({
      kind: "raw_copy",
      state: "staged",
      targetRelativePath: normalizedTarget,
      stageRelativePath,
      allowExistingMatch,
      originalFileName,
      mediaType,
    });
    await this.persist();

    return {
      relativePath: normalizedTarget,
      originalFileName,
      mediaType,
      stagedAbsolutePath: stageAbsolutePath,
    };
  }

  async stageTextWrite(
    targetRelativePath: string,
    content: string,
    options: StageTextWriteOptions = {},
  ): Promise<string> {
    this.assertMutable();
    const normalizedTarget = normalizeRelativeVaultPath(targetRelativePath);
    await assertWriteTargetPolicyForVault(this.vaultRoot, normalizedTarget, {
      kind: "text",
      allowAppendOnlyJsonl: options.allowAppendOnlyJsonl,
      allowRaw: options.allowRaw,
      messages: {
        appendOnlyDisallowed: "Use stageJsonlAppend for ledger and audit shards.",
        rawDisallowed: "Use stageRawCopy for raw artifacts.",
      },
    });

    const stageRelativePath = stageArtifactRelativePath(
      this.operationId,
      `${String(this.record.actions.length).padStart(4, "0")}.txt`,
    );
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, stageRelativePath).absolutePath;
    await ensureDirectory(path.dirname(stageAbsolutePath));
    await fs.writeFile(stageAbsolutePath, content, "utf8");

    this.record.actions.push({
      kind: "text_write",
      state: "staged",
      targetRelativePath: normalizedTarget,
      stageRelativePath,
      overwrite: options.overwrite ?? true,
      allowExistingMatch: options.allowExistingMatch ?? false,
      allowRaw: options.allowRaw ?? false,
    });
    await this.persist();
    return normalizedTarget;
  }

  async stageJsonlAppend(targetRelativePath: string, content: string): Promise<string> {
    this.assertMutable();
    const normalizedTarget = normalizeRelativeVaultPath(targetRelativePath);
    await assertWriteTargetPolicyForVault(this.vaultRoot, normalizedTarget, {
      kind: "jsonl_append",
      messages: {
        appendOnlyDisallowed: "Append-only writes are restricted to JSONL ledger and audit shards.",
        rawDisallowed: "Raw files are immutable once written.",
      },
    });

    const stageRelativePath = stageArtifactRelativePath(
      this.operationId,
      `${String(this.record.actions.length).padStart(4, "0")}.jsonl`,
    );
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, stageRelativePath).absolutePath;
    await ensureDirectory(path.dirname(stageAbsolutePath));
    await fs.writeFile(stageAbsolutePath, content, "utf8");

    this.record.actions.push({
      kind: "jsonl_append",
      state: "staged",
      targetRelativePath: normalizedTarget,
      stageRelativePath,
    });
    await this.persist();
    return normalizedTarget;
  }

  async stageDelete(
    targetRelativePath: string,
    options: {
      allowAppendOnlyJsonl?: boolean;
    } = {},
  ): Promise<string> {
    this.assertMutable();
    const normalizedTarget = normalizeRelativeVaultPath(targetRelativePath);
    await assertWriteTargetPolicyForVault(this.vaultRoot, normalizedTarget, {
      kind: "delete",
      allowAppendOnlyJsonl: options.allowAppendOnlyJsonl,
      messages: {
        appendOnlyDisallowed: "Use stageJsonlAppend for ledger and audit shards.",
        rawDisallowed: "Use stageRawCopy for raw artifacts.",
      },
    });
    this.record.actions.push({
      kind: "delete",
      state: "staged",
      targetRelativePath: normalizedTarget,
    });
    await this.persist();
    return normalizedTarget;
  }

  async commit(): Promise<void> {
    this.assertMutable();
    const lock = await acquireCanonicalWriteLock(this.vaultRoot);

    try {
      try {
        this.record.status = "committing";
        this.record.updatedAt = nowIso();
        this.record.error = undefined;
        await this.persist();

        for (const [index, action] of this.record.actions.entries()) {
          if (action.state === "applied" || action.state === "reused") {
            continue;
          }

          await this.applyAction(index, action);
        }

        await this.persistGuardReceiptIfConfigured();
        this.record.status = "committed";
        this.record.updatedAt = nowIso();
        this.record.error = undefined;
        await this.persist();
      } catch (error) {
        this.record.error = toStoredOperationError(error);
        this.record.updatedAt = nowIso();
        await this.persistBestEffort();

        let rollbackFailed = false;
        try {
          await this.rollbackAppliedActions();
          await this.cleanupGuardReceiptIfConfigured();
        } catch (rollbackError) {
          rollbackFailed = true;
          this.record.status = "failed";
          this.record.error = toStoredOperationError(rollbackError);
          this.record.updatedAt = nowIso();
          await this.persistBestEffort();
        }

        if (!rollbackFailed) {
          const rollbackTriggerError = this.record.error;
          this.record.status = "rolled_back";
          this.record.updatedAt = nowIso();
          await this.persistBestEffort();

          try {
            await this.cleanupStageArtifacts();
          } catch {
            this.record.error = rollbackTriggerError;
            this.record.updatedAt = nowIso();
            await this.persistBestEffort();
          }
        }

        throw error;
      }

      try {
        await this.cleanupStageArtifacts();
      } catch (error) {
        this.record.error = toStoredOperationError(error);
        this.record.updatedAt = nowIso();

        try {
          await this.persist();
        } catch {
          // Leaving the stage artifacts in place is the primary diagnostic fallback.
        }
      }
    } finally {
      await lock?.release();
    }
  }

  async rollback(): Promise<void> {
    this.assertMutable();
    const lock = await acquireCanonicalWriteLock(this.vaultRoot);

    try {
      await this.rollbackAppliedActions();
      this.record.status = "rolled_back";
      this.record.updatedAt = nowIso();
      this.record.error = undefined;
      await this.persist();
      await this.cleanupStageArtifacts();
    } finally {
      await lock?.release();
    }
  }

  private assertMutable(): void {
    if (isTerminalWriteOperationStatus(this.record.status) || this.record.status === "failed") {
      throw new VaultError(
        "OPERATION_STATE_INVALID",
        `Write batch "${this.operationId}" can no longer be modified after status "${this.record.status}".`,
      );
    }
  }

  private async persist(): Promise<void> {
    await writeTextFileAtomic(this.metadataAbsolutePath, `${JSON.stringify(this.record, null, 2)}\n`);
  }

  private async persistBestEffort(): Promise<void> {
    try {
      await this.persist();
    } catch {
      // Rollback and cleanup should not depend on metadata persistence succeeding.
    }
  }

  private async cleanupStageArtifacts(): Promise<void> {
    await fs.rm(this.stageRootAbsolutePath, { recursive: true, force: true });
  }

  private async cleanupGuardReceiptIfConfigured(): Promise<void> {
    const receiptRoot = resolveGuardReceiptDirectoryFromEnv();
    if (!receiptRoot) {
      return;
    }

    await fs.rm(path.join(receiptRoot, `${this.operationId}.json`), { force: true });
    await fs.rm(path.join(receiptRoot, this.operationId), { recursive: true, force: true });
  }

  private async persistGuardReceiptIfConfigured(): Promise<void> {
    const receiptRoot = resolveGuardReceiptDirectoryFromEnv();
    if (!receiptRoot) {
      return;
    }

    const actions: WriteOperationGuardReceiptAction[] = [];
    await ensureDirectory(receiptRoot);

    for (const [index, action] of this.record.actions.entries()) {
      if (!(await isProtectedCanonicalPathForVault(this.vaultRoot, action.targetRelativePath))) {
        continue;
      }

      if (action.kind === "delete") {
        actions.push({
          kind: "delete",
          targetRelativePath: action.targetRelativePath,
        });
        continue;
      }

      if (action.kind !== "text_write" && action.kind !== "jsonl_append") {
        continue;
      }

      const payloadReceipt = action.committedPayloadReceipt;
      if (!payloadReceipt) {
        continue;
      }

      const payloadDirectory = path.join(receiptRoot, this.operationId);
      const payloadFileName = `${String(index).padStart(4, "0")}.${action.kind === "text_write" ? "txt" : "jsonl"}`;
      const payloadAbsolutePath = path.join(payloadDirectory, payloadFileName);
      const payloadRelativePath = path.posix.join(this.operationId, payloadFileName);
      const stageAbsolutePath = resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath;
      await ensureDirectory(payloadDirectory);
      await fs.copyFile(stageAbsolutePath, payloadAbsolutePath);

      actions.push({
        kind: action.kind,
        targetRelativePath: action.targetRelativePath,
        committedPayloadReceipt: payloadReceipt,
        payloadRelativePath,
      });
    }

    if (actions.length === 0) {
      return;
    }

    const receipt: WriteOperationGuardReceipt = {
      schemaVersion: WRITE_OPERATION_GUARD_RECEIPT_SCHEMA_VERSION,
      operationId: this.operationId,
      createdAt: this.record.createdAt,
      updatedAt: this.record.updatedAt,
      actions,
    };
    await fs.writeFile(
      path.join(receiptRoot, `${this.operationId}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
  }

  private async applyAction(index: number, action: StoredWriteAction): Promise<void> {
    if (action.kind === "raw_copy") {
      await this.applyRawCopy(action);
      return;
    }

    if (action.kind === "text_write") {
      await this.applyTextWrite(index, action);
      return;
    }

    if (action.kind === "jsonl_append") {
      await this.applyJsonlAppend(action);
      return;
    }

    await this.applyDelete(index, action);
  }

  private async applyPreparedAction<TAction extends StoredWriteAction, TResult>(input: {
    action: TAction;
    finalize: (result: TResult) => void;
    maybeAlreadyApplied?: (target: ResolvedVaultPath) => Promise<TResult | undefined>;
    mutateTarget: (target: ResolvedVaultPath) => Promise<TResult>;
    prepareMutation?: (target: ResolvedVaultPath) => Promise<void>;
    prepareTarget: () => Promise<ResolvedVaultPath>;
  }): Promise<void> {
    const target = await input.prepareTarget();
    const resumeResult = await input.maybeAlreadyApplied?.(target);
    if (resumeResult !== undefined) {
      await this.finalizeActionApplication(input.action, () => input.finalize(resumeResult));
      return;
    }

    await input.prepareMutation?.(target);
    const result = await input.mutateTarget(target);
    await this.finalizeActionApplication(input.action, () => input.finalize(result));
  }

  private async finalizeActionApplication(
    action: StoredWriteAction,
    updateAction: () => void,
  ): Promise<void> {
    updateAction();
    const appliedAt = nowIso();
    action.appliedAt = appliedAt;
    this.record.updatedAt = appliedAt;
    await this.persist();
  }

  private async persistPreparedAction(updateAction: () => boolean): Promise<void> {
    if (!updateAction()) {
      return;
    }

    this.record.updatedAt = nowIso();
    await this.persist();
  }

  private resolveActionBackupRelativePath(
    index: number,
    action: BackupCapableStoredWriteAction,
  ): string {
    return action.backupRelativePath ??
      backupArtifactRelativePath(this.operationId, `${String(index).padStart(4, "0")}.bak`);
  }

  private buildResumeConflictError(action: StoredWriteAction, reason: string): VaultError {
    return new VaultError("OPERATION_RESUME_CONFLICT", reason, {
      operationId: this.operationId,
      relativePath: action.targetRelativePath,
    });
  }

  private async applyRawCopy(action: Extract<StoredWriteAction, { kind: "raw_copy" }>): Promise<void> {
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath;
    const stagedContent = await fs.readFile(stageAbsolutePath);
    await this.applyPreparedAction({
      action,
      finalize: (result: Awaited<ReturnType<typeof applyImmutableWriteTarget>>) => {
        action.state = result.effect === "reuse" ? "reused" : "applied";
        action.effect = result.effect === "reuse" ? "reuse" : "copy";
        action.existedBefore = result.existedBefore;
      },
      maybeAlreadyApplied: async (target) => {
        if (action.existedBefore !== false || !(await pathExists(target.absolutePath))) {
          return undefined;
        }

        const existingContent = await fs.readFile(target.absolutePath);
        if (!existingContent.equals(stagedContent)) {
          throw this.buildResumeConflictError(
            action,
            `Raw target "${action.targetRelativePath}" changed unexpectedly while resuming the write batch.`,
          );
        }

        return {
          effect: "copy",
          existedBefore: false,
        } as const;
      },
      mutateTarget: async (target) =>
        await applyImmutableWriteTarget({
          allowExistingMatch: action.allowExistingMatch,
          createEffect: "copy",
          createTarget: () => copyFileAtomicExclusive(stageAbsolutePath, target.absolutePath),
          existsErrorMessage: "Raw target already exists and may not be overwritten.",
          matchesExistingContent: async () => {
            const existingContent = await fs.readFile(target.absolutePath);
            return existingContent.equals(stagedContent);
          },
          target,
        }),
      prepareMutation: async (target) => {
        if (action.existedBefore !== undefined || (await pathExists(target.absolutePath))) {
          return;
        }

        await this.persistPreparedAction(() => {
          action.existedBefore = false;
          return true;
        });
      },
      prepareTarget: async () =>
        await prepareVerifiedWriteTarget(this.vaultRoot, action.targetRelativePath),
    });
  }

  private async applyTextWrite(
    index: number,
    action: Extract<StoredWriteAction, { kind: "text_write" }>,
  ): Promise<void> {
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath;
    const stagedContent = await readText(stageAbsolutePath);
    const payloadReceipt = action.committedPayloadReceipt ?? createCommittedPayloadReceipt(stagedContent);
    await this.applyPreparedAction({
      action,
      finalize: (result: Awaited<ReturnType<typeof applyTextWriteTarget>>) => {
        action.state = result.effect === "reuse" ? "reused" : "applied";
        action.effect = result.effect;
        action.existedBefore = result.existedBefore;
        action.committedPayloadReceipt = payloadReceipt;
      },
      maybeAlreadyApplied: async (target) => {
        if (action.existedBefore === undefined || !(await pathExists(target.absolutePath))) {
          return undefined;
        }

        const existingContent = await readText(target.absolutePath);
        if (existingContent === stagedContent) {
          if (action.overwrite && action.existedBefore && !action.backupRelativePath) {
            throw this.buildResumeConflictError(
              action,
              `Text backup metadata for "${action.targetRelativePath}" is missing while resuming the write batch.`,
            );
          }

          return {
            effect: action.existedBefore ? (action.overwrite ? "update" : "reuse") : "create",
            existedBefore: action.existedBefore,
          } as const;
        }

        if (!action.existedBefore) {
          throw this.buildResumeConflictError(
            action,
            `Text target "${action.targetRelativePath}" changed unexpectedly while resuming the write batch.`,
          );
        }

        return undefined;
      },
      mutateTarget: async (target) => {
        if (action.existedBefore === true && action.overwrite && !(await pathExists(target.absolutePath))) {
          throw this.buildResumeConflictError(
            action,
            `Text target "${action.targetRelativePath}" disappeared while resuming the write batch.`,
          );
        }

        return await applyTextWriteTarget({
          allowExistingMatch: action.allowExistingMatch,
          backupExisting: action.overwrite
            ? async () => {
                if (!action.backupRelativePath) {
                  return;
                }

                await this.ensureBackupArtifactExists(target.absolutePath, action.backupRelativePath);
              }
            : undefined,
          createTarget: () => copyFileAtomicExclusive(stageAbsolutePath, target.absolutePath),
          matchesExistingContent: async () => {
            const existingContent = await readText(target.absolutePath);
            return existingContent === stagedContent;
          },
          overwrite: action.overwrite,
          replaceTarget: () => copyFileAtomic(stageAbsolutePath, target.absolutePath),
          target,
        });
      },
      prepareMutation: async (target) => {
        const existedBefore = action.existedBefore ?? (await pathExists(target.absolutePath));
        const requiresPreparedMutation = action.overwrite || !existedBefore;
        if (!requiresPreparedMutation) {
          return;
        }

        let backupRelativePath = action.backupRelativePath;
        if (action.overwrite && existedBefore && !backupRelativePath) {
          backupRelativePath = this.resolveActionBackupRelativePath(index, action);
        }

        await this.persistPreparedAction(() => {
          let changed = false;
          if (action.committedPayloadReceipt === undefined) {
            action.committedPayloadReceipt = payloadReceipt;
            changed = true;
          }
          if (action.existedBefore === undefined) {
            action.existedBefore = existedBefore;
            changed = true;
          }
          if (backupRelativePath && action.backupRelativePath !== backupRelativePath) {
            action.backupRelativePath = backupRelativePath;
            changed = true;
          }
          return changed;
        });

        if (action.overwrite && existedBefore && backupRelativePath) {
          await this.ensureBackupArtifactExists(target.absolutePath, backupRelativePath);
        }
      },
      prepareTarget: async () =>
        await prepareVerifiedWriteTarget(this.vaultRoot, action.targetRelativePath),
    });
  }

  private async applyJsonlAppend(action: Extract<StoredWriteAction, { kind: "jsonl_append" }>): Promise<void> {
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath;
    const payload = await readText(stageAbsolutePath);
    const payloadReceipt = action.committedPayloadReceipt ?? createCommittedPayloadReceipt(payload);
    await this.applyPreparedAction({
      action,
      finalize: (result: Awaited<ReturnType<typeof applyJsonlAppendTarget>>) => {
        action.state = "applied";
        action.effect = result.effect;
        action.existedBefore = result.existedBefore;
        action.originalSize = result.originalSize;
        action.committedPayloadReceipt = payloadReceipt;
      },
      maybeAlreadyApplied: async (target) => {
        if (action.existedBefore === undefined || action.originalSize === undefined) {
          return undefined;
        }

        if (!(await pathExists(target.absolutePath))) {
          if (action.existedBefore) {
            throw this.buildResumeConflictError(
              action,
              `Append target "${action.targetRelativePath}" disappeared while resuming the write batch.`,
            );
          }

          return undefined;
        }

        const targetSize = (await fs.stat(target.absolutePath)).size;
        if (targetSize === action.originalSize) {
          return undefined;
        }

        const expectedSize = action.originalSize + Buffer.byteLength(payload);
        if (targetSize !== expectedSize) {
          throw this.buildResumeConflictError(
            action,
            `Append target "${action.targetRelativePath}" changed unexpectedly while resuming the write batch.`,
          );
        }

        const targetContent = await readText(target.absolutePath);
        if (targetContent.slice(action.originalSize) !== payload) {
          throw this.buildResumeConflictError(
            action,
            `Append target "${action.targetRelativePath}" changed unexpectedly while resuming the write batch.`,
          );
        }

        return {
          effect: "append",
          existedBefore: action.existedBefore,
          originalSize: action.originalSize,
        } as const;
      },
      mutateTarget: async (target) =>
        await applyJsonlAppendTarget({
          appendPayload: (payloadChunk) => fs.appendFile(target.absolutePath, payloadChunk, "utf8"),
          readPayload: async () => payload,
          target,
        }),
      prepareMutation: async (target) => {
        const existedBefore = action.existedBefore ?? (await pathExists(target.absolutePath));
        const originalSize = action.originalSize ?? (existedBefore ? (await fs.stat(target.absolutePath)).size : 0);
        await this.persistPreparedAction(() => {
          let changed = false;
          if (action.committedPayloadReceipt === undefined) {
            action.committedPayloadReceipt = payloadReceipt;
            changed = true;
          }
          if (action.existedBefore === undefined) {
            action.existedBefore = existedBefore;
            changed = true;
          }
          if (action.originalSize === undefined) {
            action.originalSize = originalSize;
            changed = true;
          }
          return changed;
        });
      },
      prepareTarget: async () =>
        await prepareVerifiedWriteTarget(this.vaultRoot, action.targetRelativePath),
    });
  }

  private async applyDelete(index: number, action: Extract<StoredWriteAction, { kind: "delete" }>): Promise<void> {
    await this.applyPreparedAction({
      action,
      finalize: (result: DeleteActionMutationResult) => {
        action.state = result.state;
        action.effect = "delete";
        action.existedBefore = result.existedBefore;
        if (result.state === "applied") {
          action.backupRelativePath = result.backupRelativePath;
        }
      },
      maybeAlreadyApplied: async (target) => {
        if (action.existedBefore === undefined) {
          return undefined;
        }

        const targetExists = await pathExists(target.absolutePath);
        if (!action.existedBefore) {
          if (targetExists) {
            throw this.buildResumeConflictError(
              action,
              `Delete target "${action.targetRelativePath}" changed unexpectedly while resuming the write batch.`,
            );
          }

          return {
            existedBefore: false,
            state: "reused",
          } as const;
        }

        if (targetExists) {
          return undefined;
        }

        if (!action.backupRelativePath) {
          throw this.buildResumeConflictError(
            action,
            `Delete backup metadata for "${action.targetRelativePath}" is missing while resuming the write batch.`,
          );
        }

        const backupAbsolutePath = resolveVaultPath(this.vaultRoot, action.backupRelativePath).absolutePath;
        if (!(await pathExists(backupAbsolutePath))) {
          throw this.buildResumeConflictError(
            action,
            `Delete backup "${action.backupRelativePath}" is missing while resuming the write batch.`,
          );
        }

        return {
          backupRelativePath: action.backupRelativePath,
          existedBefore: true,
          state: "applied",
        } as const;
      },
      mutateTarget: async (target): Promise<DeleteActionMutationResult> => {
        const existedBefore = await pathExists(target.absolutePath);
        if (!existedBefore) {
          return {
            existedBefore: false,
            state: "reused",
          };
        }

        const backupRelativePath = this.resolveActionBackupRelativePath(index, action);
        await this.ensureBackupArtifactExists(target.absolutePath, backupRelativePath);
        await fs.unlink(target.absolutePath);
        return {
          backupRelativePath,
          existedBefore: true,
          state: "applied",
        };
      },
      prepareMutation: async (target) => {
        if (!(await pathExists(target.absolutePath))) {
          return;
        }

        const backupRelativePath = this.resolveActionBackupRelativePath(index, action);
        await this.persistPreparedAction(() => {
          let changed = false;
          if (action.existedBefore === undefined) {
            action.existedBefore = true;
            changed = true;
          }
          if (action.backupRelativePath !== backupRelativePath) {
            action.backupRelativePath = backupRelativePath;
            changed = true;
          }
          return changed;
        });

        await this.ensureBackupArtifactExists(target.absolutePath, backupRelativePath);
      },
      prepareTarget: async () =>
        await prepareVerifiedDeleteTarget(this.vaultRoot, action.targetRelativePath),
    });
  }

  private async rollbackAppliedActions(): Promise<void> {
    for (const action of [...this.record.actions].reverse()) {
      if (action.state !== "applied") {
        continue;
      }

      if (action.kind === "raw_copy") {
        await safeUnlink(resolveVaultPath(this.vaultRoot, action.targetRelativePath).absolutePath);
      } else if (action.kind === "text_write") {
        if (action.effect === "create") {
          await safeUnlink(resolveVaultPath(this.vaultRoot, action.targetRelativePath).absolutePath);
        } else if (action.backupRelativePath) {
          const targetAbsolutePath = resolveVaultPath(this.vaultRoot, action.targetRelativePath).absolutePath;
          const backupAbsolutePath = resolveVaultPath(this.vaultRoot, action.backupRelativePath).absolutePath;
          await copyFileAtomic(backupAbsolutePath, targetAbsolutePath);
        }
      } else if (action.kind === "jsonl_append") {
        const targetAbsolutePath = resolveVaultPath(this.vaultRoot, action.targetRelativePath).absolutePath;
        if (!action.existedBefore) {
          await safeUnlink(targetAbsolutePath);
        } else {
          await fs.truncate(targetAbsolutePath, action.originalSize ?? 0);
        }
      } else if (action.kind === "delete" && action.backupRelativePath) {
        const targetAbsolutePath = resolveVaultPath(this.vaultRoot, action.targetRelativePath).absolutePath;
        const backupAbsolutePath = resolveVaultPath(this.vaultRoot, action.backupRelativePath).absolutePath;
        await copyFileAtomic(backupAbsolutePath, targetAbsolutePath);
      }

      action.state = "rolled_back";
      action.rolledBackAt = nowIso();
    }
  }

  private async ensureBackupArtifactExists(
    sourceAbsolutePath: string,
    backupRelativePath: string,
  ): Promise<void> {
    const backupAbsolutePath = resolveVaultPath(this.vaultRoot, backupRelativePath).absolutePath;

    if (!(await pathExists(backupAbsolutePath))) {
      await copyFileAtomicExclusive(sourceAbsolutePath, backupAbsolutePath);
    }
  }
}
