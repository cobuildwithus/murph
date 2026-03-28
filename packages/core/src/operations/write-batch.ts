import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";

import { VaultError } from "../errors.ts";
import { ensureDirectory, pathExists, walkVaultFiles } from "../fs.ts";
import { VAULT_LAYOUT } from "../constants.ts";
import {
  normalizeRelativeVaultPath,
  normalizeVaultRoot,
  resolveVaultPath,
} from "../path-safety.ts";
import { toIsoTimestamp } from "../time.ts";
import { isErrnoException, isPlainRecord } from "../types.ts";
import {
  applyImmutableWriteTarget,
  applyJsonlAppendTarget,
  applyTextWriteTarget,
  assertWriteTargetPolicy,
  prepareVerifiedWriteTarget,
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

function parseCommittedPayloadReceipt(value: unknown): CommittedPayloadReceipt | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (
    !isPlainRecord(value) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    typeof value.byteLength !== "number" ||
    !Number.isInteger(value.byteLength) ||
    value.byteLength < 0
  ) {
    return null;
  }

  return {
    sha256: value.sha256,
    byteLength: value.byteLength,
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
  if (!isPlainRecord(value) || typeof value.kind !== "string" || typeof value.state !== "string") {
    return null;
  }

  const targetRelativePath = normalizeStoredRelativePath(value.targetRelativePath);
  if (!targetRelativePath) {
    return null;
  }

  if (
    value.kind !== "raw_copy" &&
    value.kind !== "text_write" &&
    value.kind !== "jsonl_append" &&
    value.kind !== "delete"
  ) {
    return null;
  }

  if (value.kind === "delete") {
    const backupRelativePath =
      "backupRelativePath" in value && value.backupRelativePath !== undefined
        ? (normalizeStoredRelativePath(value.backupRelativePath) ?? undefined)
        : undefined;
    if ("backupRelativePath" in value && value.backupRelativePath !== undefined && !backupRelativePath) {
      return null;
    }

    return {
      kind: "delete",
      state: value.state as WriteOperationActionState,
      targetRelativePath,
      effect: value.effect === "delete" ? value.effect : undefined,
      existedBefore: typeof value.existedBefore === "boolean" ? value.existedBefore : undefined,
      backupRelativePath,
      appliedAt: typeof value.appliedAt === "string" ? value.appliedAt : undefined,
      rolledBackAt: typeof value.rolledBackAt === "string" ? value.rolledBackAt : undefined,
    };
  }

  const stageRelativePath = normalizeStoredRelativePath(value.stageRelativePath);
  if (!stageRelativePath) {
    return null;
  }

  if (value.kind === "raw_copy") {
    return {
      kind: "raw_copy",
      state: value.state as WriteOperationActionState,
      targetRelativePath,
      stageRelativePath,
      allowExistingMatch: value.allowExistingMatch === true,
      originalFileName: typeof value.originalFileName === "string" ? value.originalFileName : "",
      mediaType: typeof value.mediaType === "string" ? value.mediaType : "",
      effect: value.effect === "copy" || value.effect === "reuse" ? value.effect : undefined,
      existedBefore: typeof value.existedBefore === "boolean" ? value.existedBefore : undefined,
      appliedAt: typeof value.appliedAt === "string" ? value.appliedAt : undefined,
      rolledBackAt: typeof value.rolledBackAt === "string" ? value.rolledBackAt : undefined,
    };
  }

  const backupRelativePath =
    "backupRelativePath" in value && value.backupRelativePath !== undefined
      ? (normalizeStoredRelativePath(value.backupRelativePath) ?? undefined)
      : undefined;
  if ("backupRelativePath" in value && value.backupRelativePath !== undefined && !backupRelativePath) {
    return null;
  }
  const committedPayloadReceipt = parseCommittedPayloadReceipt(value.committedPayloadReceipt);
  if (committedPayloadReceipt === null) {
    return null;
  }

  if (value.kind === "text_write") {
    return {
      kind: "text_write",
      state: value.state as WriteOperationActionState,
      targetRelativePath,
      stageRelativePath,
      overwrite: value.overwrite !== false,
      allowExistingMatch: value.allowExistingMatch === true,
      allowRaw: value.allowRaw === true,
      effect:
        value.effect === "create" || value.effect === "update" || value.effect === "reuse"
          ? value.effect
          : undefined,
      existedBefore: typeof value.existedBefore === "boolean" ? value.existedBefore : undefined,
      backupRelativePath,
      committedPayloadReceipt,
      appliedAt: typeof value.appliedAt === "string" ? value.appliedAt : undefined,
      rolledBackAt: typeof value.rolledBackAt === "string" ? value.rolledBackAt : undefined,
    };
  }

  return {
    kind: "jsonl_append",
    state: value.state as WriteOperationActionState,
    targetRelativePath,
    stageRelativePath,
    effect: value.effect === "append" ? value.effect : undefined,
    existedBefore: typeof value.existedBefore === "boolean" ? value.existedBefore : undefined,
    originalSize:
      typeof value.originalSize === "number" && Number.isFinite(value.originalSize)
        ? value.originalSize
        : undefined,
    committedPayloadReceipt,
    appliedAt: typeof value.appliedAt === "string" ? value.appliedAt : undefined,
    rolledBackAt: typeof value.rolledBackAt === "string" ? value.rolledBackAt : undefined,
  };
}

function parseRecoverableStoredAction(value: unknown): StoredWriteAction | null {
  const action = parseStoredAction(value);
  if (!action) {
    return null;
  }

  if (
    (action.kind === "raw_copy" || action.kind === "text_write" || action.kind === "jsonl_append") &&
    typeof action.stageRelativePath !== "string"
  ) {
    return null;
  }

  return action;
}

export function isProtectedCanonicalPath(relativePath: string): boolean {
  let normalizedRelativePath: string;
  try {
    normalizedRelativePath = normalizeRelativeVaultPath(relativePath);
  } catch {
    return false;
  }

  // Raw artifacts remain enforced by the isolated provider workspace +
  // sandbox boundary rather than full snapshot/replay in the assistant guard.
  return (
    PROTECTED_CANONICAL_ROOT_FILES.has(normalizedRelativePath) ||
    normalizedRelativePath.startsWith(`${VAULT_LAYOUT.journalDirectory}/`) ||
    normalizedRelativePath.startsWith("bank/") ||
    (normalizedRelativePath.startsWith("ledger/") && normalizedRelativePath.endsWith(".jsonl")) ||
    (normalizedRelativePath.startsWith(`${VAULT_LAYOUT.auditDirectory}/`) &&
      normalizedRelativePath.endsWith(".jsonl"))
  );
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

  for (const relativeDirectory of [VAULT_LAYOUT.journalDirectory, "bank", "ledger", VAULT_LAYOUT.auditDirectory]) {
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

    if (entry.isFile() && isProtectedCanonicalPath(childRelativePath)) {
      matches.add(childRelativePath);
    }
  }
}

export async function readStoredWriteOperation(
  vaultRoot: string,
  relativePath: string,
): Promise<StoredWriteOperation> {
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  const raw = JSON.parse(await readText(resolved.absolutePath)) as unknown;

  if (!isPlainRecord(raw)) {
    throw new VaultError("OPERATION_INVALID", "Write operation metadata must be a JSON object.", {
      relativePath,
    });
  }

  const actions = Array.isArray(raw.actions) ? raw.actions.map(parseStoredAction) : null;

  if (
    raw.schemaVersion !== WRITE_OPERATION_SCHEMA_VERSION ||
    typeof raw.operationId !== "string" ||
    typeof raw.operationType !== "string" ||
    typeof raw.summary !== "string" ||
    !isStoredWriteOperationStatus(raw.status) ||
    typeof raw.createdAt !== "string" ||
    typeof raw.updatedAt !== "string" ||
    typeof raw.occurredAt !== "string" ||
    !actions ||
    actions.some((action) => action === null)
  ) {
    throw new VaultError("OPERATION_INVALID", "Write operation metadata has an unexpected shape.", {
      relativePath,
    });
  }

  if (
    raw.status === "committed" &&
    (actions as StoredWriteAction[]).some(
      (action) =>
        (action.kind === "text_write" || action.kind === "jsonl_append") &&
        action.committedPayloadReceipt === undefined,
    )
  ) {
    throw new VaultError(
      "OPERATION_INVALID",
      "Committed write operation metadata is missing committed payload receipts.",
      {
        relativePath,
      },
    );
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
    actions: actions as StoredWriteAction[],
    error:
      isPlainRecord(raw.error) && typeof raw.error.message === "string"
        ? {
            message: raw.error.message,
            code: typeof raw.error.code === "string" ? raw.error.code : undefined,
          }
        : undefined,
  };
}

export async function readRecoverableStoredWriteOperation(
  vaultRoot: string,
  relativePath: string,
): Promise<RecoverableStoredWriteOperation | null> {
  try {
    const resolved = resolveVaultPath(vaultRoot, relativePath);
    const raw = JSON.parse(await readText(resolved.absolutePath)) as unknown;

    if (!isPlainRecord(raw)) {
      return null;
    }

    const actions = Array.isArray(raw.actions) ? raw.actions.map(parseRecoverableStoredAction) : null;
    if (
      typeof raw.operationId !== "string" ||
      typeof raw.createdAt !== "string" ||
      typeof raw.updatedAt !== "string" ||
      typeof raw.status !== "string" ||
      !actions ||
      actions.some((action) => action === null)
    ) {
      return null;
    }

    if (
      raw.status === "committed" &&
      (actions as StoredWriteAction[]).some(
        (action) =>
          (action.kind === "text_write" || action.kind === "jsonl_append") &&
          action.committedPayloadReceipt === undefined,
      )
    ) {
      return null;
    }

    return {
      operationId: raw.operationId,
      status: raw.status,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      actions: actions as StoredWriteAction[],
    };
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
    assertWriteTargetPolicy(normalizedTarget, {
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
    assertWriteTargetPolicy(normalizedTarget, {
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
    assertWriteTargetPolicy(normalizedTarget, {
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
    assertWriteTargetPolicy(normalizedTarget, {
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
    assertWriteTargetPolicy(normalizedTarget, {
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

      this.record.status = "committed";
      this.record.updatedAt = nowIso();
      await this.persist();
      await this.persistGuardReceiptIfConfigured();
      await this.cleanupStageArtifacts();
    } catch (error) {
      this.record.error = toStoredOperationError(error);
      this.record.updatedAt = nowIso();
      await this.persist();

      try {
        await this.rollbackAppliedActions();
        this.record.status = "rolled_back";
        this.record.updatedAt = nowIso();
        await this.persist();
        await this.cleanupStageArtifacts();
      } catch (rollbackError) {
        this.record.status = "failed";
        this.record.error = toStoredOperationError(rollbackError);
        this.record.updatedAt = nowIso();
        await this.persist();
      }

      throw error;
    } finally {
      await lock.release();
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
      await lock.release();
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
    await fs.writeFile(this.metadataAbsolutePath, `${JSON.stringify(this.record, null, 2)}\n`, "utf8");
  }

  private async cleanupStageArtifacts(): Promise<void> {
    await fs.rm(this.stageRootAbsolutePath, { recursive: true, force: true });
  }

  private async persistGuardReceiptIfConfigured(): Promise<void> {
    const receiptRoot = resolveGuardReceiptDirectoryFromEnv();
    if (!receiptRoot) {
      return;
    }

    const actions: WriteOperationGuardReceiptAction[] = [];
    await ensureDirectory(receiptRoot);

    for (const [index, action] of this.record.actions.entries()) {
      if (!isProtectedCanonicalPath(action.targetRelativePath)) {
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
      await this.applyRawCopy(index, action);
      return;
    }

    if (action.kind === "text_write") {
      await this.applyTextWrite(index, action);
      return;
    }

    if (action.kind === "jsonl_append") {
      await this.applyJsonlAppend(index, action);
      return;
    }

    await this.applyDelete(index, action);
  }

  private async applyRawCopy(index: number, action: Extract<StoredWriteAction, { kind: "raw_copy" }>): Promise<void> {
    const target = await prepareVerifiedWriteTarget(this.vaultRoot, action.targetRelativePath);
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath;
    const stagedContent = await fs.readFile(stageAbsolutePath);
    const result = await applyImmutableWriteTarget({
      allowExistingMatch: action.allowExistingMatch,
      createEffect: "copy",
      createTarget: () => fs.copyFile(stageAbsolutePath, target.absolutePath, fsConstants.COPYFILE_EXCL),
      existsErrorMessage: "Raw target already exists and may not be overwritten.",
      matchesExistingContent: async () => {
        const existingContent = await fs.readFile(target.absolutePath);
        return existingContent.equals(stagedContent);
      },
      target,
    });
    action.state = result.effect === "reuse" ? "reused" : "applied";
    action.effect = result.effect === "reuse" ? "reuse" : "copy";
    action.existedBefore = result.existedBefore;
    action.appliedAt = nowIso();
    this.record.updatedAt = action.appliedAt;
    await this.persist();
  }

  private async applyTextWrite(
    index: number,
    action: Extract<StoredWriteAction, { kind: "text_write" }>,
  ): Promise<void> {
    const target = await prepareVerifiedWriteTarget(this.vaultRoot, action.targetRelativePath);
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath;
    const stagedContent = await readText(stageAbsolutePath);
    const result = await applyTextWriteTarget({
      allowExistingMatch: action.allowExistingMatch,
      backupExisting: action.overwrite
        ? async () => {
            const backupRelativePath =
              action.backupRelativePath ??
              backupArtifactRelativePath(this.operationId, `${String(index).padStart(4, "0")}.bak`);
            const backupAbsolutePath = resolveVaultPath(this.vaultRoot, backupRelativePath).absolutePath;
            await ensureDirectory(path.dirname(backupAbsolutePath));
            await fs.copyFile(target.absolutePath, backupAbsolutePath);
            action.backupRelativePath = backupRelativePath;
          }
        : undefined,
      createTarget: () => fs.copyFile(stageAbsolutePath, target.absolutePath, fsConstants.COPYFILE_EXCL),
      matchesExistingContent: async () => {
        const existingContent = await readText(target.absolutePath);
        return existingContent === stagedContent;
      },
      overwrite: action.overwrite,
      replaceTarget: () => fs.copyFile(stageAbsolutePath, target.absolutePath),
      target,
    });
    action.state = result.effect === "reuse" ? "reused" : "applied";
    action.effect = result.effect;
    action.existedBefore = result.existedBefore;
    action.committedPayloadReceipt = createCommittedPayloadReceipt(stagedContent);
    action.appliedAt = nowIso();
    this.record.updatedAt = action.appliedAt;
    await this.persist();
  }

  private async applyJsonlAppend(
    index: number,
    action: Extract<StoredWriteAction, { kind: "jsonl_append" }>,
  ): Promise<void> {
    const target = await prepareVerifiedWriteTarget(this.vaultRoot, action.targetRelativePath);
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath;
    const payload = await readText(stageAbsolutePath);
    const result = await applyJsonlAppendTarget({
      appendPayload: (payload) => fs.appendFile(target.absolutePath, payload, "utf8"),
      readPayload: async () => payload,
      target,
    });
    action.state = "applied";
    action.effect = result.effect;
    action.existedBefore = result.existedBefore;
    action.originalSize = result.originalSize;
    action.committedPayloadReceipt = createCommittedPayloadReceipt(payload);
    action.appliedAt = nowIso();
    this.record.updatedAt = action.appliedAt;
    await this.persist();
  }

  private async applyDelete(index: number, action: Extract<StoredWriteAction, { kind: "delete" }>): Promise<void> {
    const target = await prepareVerifiedWriteTarget(this.vaultRoot, action.targetRelativePath);
    const existedBefore = await pathExists(target.absolutePath);

    if (!existedBefore) {
      action.state = "reused";
      action.effect = "delete";
      action.existedBefore = false;
      action.appliedAt = nowIso();
      this.record.updatedAt = action.appliedAt;
      await this.persist();
      return;
    }

    const backupRelativePath = backupArtifactRelativePath(
      this.operationId,
      `${String(index).padStart(4, "0")}.bak`,
    );
    const backupAbsolutePath = resolveVaultPath(this.vaultRoot, backupRelativePath).absolutePath;
    await ensureDirectory(path.dirname(backupAbsolutePath));
    await fs.copyFile(target.absolutePath, backupAbsolutePath);
    await fs.unlink(target.absolutePath);

    action.state = "applied";
    action.effect = "delete";
    action.existedBefore = true;
    action.backupRelativePath = backupRelativePath;
    action.appliedAt = nowIso();
    this.record.updatedAt = action.appliedAt;
    await this.persist();
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
          await fs.copyFile(backupAbsolutePath, targetAbsolutePath);
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
        await ensureDirectory(path.dirname(targetAbsolutePath));
        await fs.copyFile(backupAbsolutePath, targetAbsolutePath);
      }

      action.state = "rolled_back";
      action.rolledBackAt = nowIso();
    }
  }
}
