import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs, type Stats } from "node:fs";

import { auditRecordSchema } from "@murphai/contracts";

import {
  copyFileAtomic,
  copyFileAtomicExclusive,
  writeBytesFileAtomicExclusive,
  writeTextFileAtomic,
} from "../atomic-write.ts";
import { VaultError } from "../errors.ts";
import { ensureDirectory, pathExists } from "../fs.ts";
import { VAULT_LAYOUT } from "../constants.ts";
import {
  isJsonlRelativePath,
  isRawRelativePath,
  isVaultFilesystemCaseInsensitive,
  normalizeRelativeVaultPath,
  normalizeRelativeVaultPathForComparison,
  normalizeVaultRoot,
  resolveVaultPath,
  resolveVaultPathOnDisk,
  type VaultPathComparisonOptions,
} from "../path-safety.ts";
import { toIsoTimestamp } from "../time.ts";
import { isErrnoException, isPlainRecord } from "../types.ts";
import {
  assertAuthorizedIntegrationIngestAppendPlan,
  appendArchivedIntegrationIngestShard,
  buildIntegrationIngestAppendPlan,
  createArchivedIntegrationIngestShardContentReceipt,
  inspectArchivedIntegrationIngestShardAppend,
  parseIntegrationIngestAppendPayload,
  prepareLiveIntegrationIngestAppendPayload,
  truncateArchivedIntegrationIngestShard,
  type IntegrationIngestAppendPlan,
} from "../integration-ingests.ts";
import {
  applyImmutableWriteTarget,
  applyJsonlAppendTarget,
  applyTextWriteTarget,
  assertJsonlAppendTargetCanAppend,
  isIntegrationIngestJsonlAppendTarget,
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
export const TERMINAL_WRITE_OPERATION_PRUNE_MIN_RETAINED_COUNT = 100;
export const TERMINAL_WRITE_OPERATION_PRUNE_RETENTION_MS = 24 * 60 * 60 * 1000;

type WriteOperationStatus = "staged" | "committing" | "committed" | "rolled_back" | "failed";
type WriteOperationActionState = "staged" | "applied" | "reused" | "rolled_back";
const PROTECTED_CANONICAL_ROOT_FILES = new Set<string>([VAULT_LAYOUT.metadata, VAULT_LAYOUT.coreDocument]);
const CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV = "MURPH_CANONICAL_WRITE_GUARD_RECEIPT_DIR";
export const HOSTED_CANONICAL_WRITE_RECEIPT_DIRECTORY_ENV = "MURPH_HOSTED_CANONICAL_WRITE_RECEIPT_DIR";
const WRITE_OPERATION_GUARD_RECEIPT_SCHEMA_VERSION = "murph.write-operation-guard-receipt.v1";
export const HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION = "murph.hosted-canonical-write-receipt.v1";
const HOSTED_CANONICAL_WRITE_PAYLOAD_DIRECTORY_NAME = "payloads";
const PRIVATE_RECEIPT_DIRECTORY_MODE = 0o700;
const PRIVATE_RECEIPT_FILE_MODE = 0o600;

export interface CommittedPayloadReceipt {
  sha256: string;
  byteLength: number;
}

export interface HostedCanonicalWriteReceiptContentRef {
  sha256: string;
  byteSize: number;
}

export interface HostedCanonicalWritePayload {
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
}

export type HostedCanonicalWriteReceiptAction =
  | {
      kind: "text_upsert";
      targetRelativePath: string;
      sha256: string;
      byteLength: number;
      effect: "create" | "update" | "reuse";
      allowRaw?: true;
      expectedSha256?: string;
      expectedByteLength?: number;
      contentRef?: HostedCanonicalWriteReceiptContentRef;
    }
  | {
      kind: "jsonl_append";
      targetRelativePath: string;
      appendSha256: string;
      appendByteLength: number;
      baseSha256: string;
      baseByteLength: number;
      originalSize: number | null;
      allowArchivedIntegrationIngestAmendment?: boolean;
      contentRef?: HostedCanonicalWriteReceiptContentRef;
    }
  | {
      kind: "raw_upsert";
      targetRelativePath: string;
      sha256: string;
      byteLength: number;
      mediaType: string;
      originalFileName: string;
      effect: "copy" | "reuse";
      contentRef: HostedCanonicalWriteReceiptContentRef;
    }
  | {
      kind: "delete";
      targetRelativePath: string;
      existedBefore: boolean;
      allowRaw?: true;
    }
  | {
      kind: "delete_if_match";
      targetRelativePath: string;
      existedBefore: boolean;
      expectedSha256: string;
      expectedByteLength: number;
      allowRaw?: true;
    };

export interface HostedCanonicalWriteReceipt {
  schema: typeof HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION;
  operationId: string;
  operationType: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  occurredAt: string;
  committedAt: string;
  actions: HostedCanonicalWriteReceiptAction[];
}

export interface HostedCanonicalWritePersistenceInput {
  payloads: HostedCanonicalWritePayload[];
  receipt: HostedCanonicalWriteReceipt;
}

export interface HostedCanonicalWritePort {
  persistCanonicalWrite(input: HostedCanonicalWritePersistenceInput): Promise<void>;
  persistRuntimeState?(): Promise<void>;
}

const hostedCanonicalWritePortStorage = new AsyncLocalStorage<HostedCanonicalWritePort | null>();

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
    };

interface CreateWriteBatchInput {
  vaultRoot: string;
  operationType: string;
  summary: string;
  occurredAt?: DateInput;
  hostedCanonicalWritePort?: HostedCanonicalWritePort | null;
  hostedCanonicalWriteReceiptDirectory?: string | null;
}

interface RunCanonicalWriteInput<TResult> extends CreateWriteBatchInput {
  assertCanContinue?: (() => void) | null;
  mutate: (context: { batch: WriteBatch; vaultRoot: string }) => Promise<TResult>;
}

interface CommitWriteBatchOptions {
  assertCanContinue?: (() => void) | null;
}

interface StageTextWriteOptions {
  allowRaw?: boolean;
  allowAppendOnlyJsonl?: boolean;
  overwrite?: boolean;
  allowExistingMatch?: boolean;
  expectedTargetReceipt?: CommittedPayloadReceipt;
}

interface StageRawCopyOptions {
  allowExistingMatch?: boolean;
  expectedSourceReceipt?: CommittedPayloadReceipt;
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
      expectedSourceReceipt?: CommittedPayloadReceipt;
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
      expectedTargetReceipt?: CommittedPayloadReceipt;
      appliedAt?: string;
      rolledBackAt?: string;
    }
  | {
      kind: "jsonl_append";
      state: WriteOperationActionState;
      targetRelativePath: string;
      stageRelativePath: string;
      stagedPayloadReceipt?: CommittedPayloadReceipt;
      effect?: "append";
      existedBefore?: boolean;
      originalSize?: number;
      baseContentReceipt?: CommittedPayloadReceipt;
      committedPayloadReceipt?: CommittedPayloadReceipt;
      appliedAt?: string;
      rolledBackAt?: string;
      allowArchivedIntegrationIngestAmendment?: boolean;
    }
  | {
      kind: "delete";
      state: WriteOperationActionState;
      targetRelativePath: string;
      effect?: "delete";
      existedBefore?: boolean;
      backupRelativePath?: string;
      expectedTargetReceipt?: CommittedPayloadReceipt;
      // Opt-in for delete paths that are otherwise covered by the raw
      // immutability policy (e.g. raw/inbox/... privacy retention sweeps).
      // Persisted in the operation record so resume keeps the same allowance.
      allowRaw?: boolean;
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

export interface PruneTerminalWriteOperationRecordsInput {
  checkpointedAfter: DateInput | null | undefined;
  now?: DateInput;
  retainedOperationCount?: number;
  retentionMs?: number;
  signal?: AbortSignal | null;
  vaultRoot: string;
}

export interface PruneTerminalWriteOperationRecordsResult {
  invalidCount: number;
  prunedByteCount: number;
  prunedCount: number;
  prunedFileCount: number;
  prunedStageDirectoryCount: number;
  retainedErroredTerminalCount: number;
  retainedNewestTerminalCount: number;
  retainedProtectedCount: number;
  retainedRecentTerminalCount: number;
  retainedStageDirectoryCount: number;
  retainedUncheckpointedTerminalCount: number;
  scannedCount: number;
}

interface PrunableTerminalWriteOperationRecord {
  metadataRelativePath: string;
  operationId: string;
  stageRoot: string;
  updatedAtMs: number;
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

async function createFileContentReceipt(absolutePath: string): Promise<CommittedPayloadReceipt> {
  const hash = createHash("sha256");
  let byteLength = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += bytes.byteLength;
      hash.update(bytes);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return {
    sha256: hash.digest("hex"),
    byteLength,
  };
}

function receiptsMatch(left: CommittedPayloadReceipt, right: CommittedPayloadReceipt): boolean {
  return left.sha256 === right.sha256 && left.byteLength === right.byteLength;
}

function createHostedCanonicalWriteReceiptContentRef(
  receipt: CommittedPayloadReceipt,
): HostedCanonicalWriteReceiptContentRef {
  return {
    sha256: receipt.sha256,
    byteSize: receipt.byteLength,
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

function resolveHostedCanonicalWriteReceiptDirectoryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidate = typeof env[HOSTED_CANONICAL_WRITE_RECEIPT_DIRECTORY_ENV] === "string"
    ? env[HOSTED_CANONICAL_WRITE_RECEIPT_DIRECTORY_ENV]?.trim()
    : "";
  return candidate ? path.resolve(candidate) : null;
}

function resolveAmbientHostedCanonicalWritePort(): HostedCanonicalWritePort | null {
  return hostedCanonicalWritePortStorage.getStore() ?? null;
}

export function readHostedCanonicalWritePort(): HostedCanonicalWritePort | null {
  return resolveAmbientHostedCanonicalWritePort();
}

export async function persistHostedRuntimeStateAtCanonicalBoundary(): Promise<void> {
  const port = resolveAmbientHostedCanonicalWritePort();
  if (!port?.persistRuntimeState) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_BOUNDARY_REQUIRED",
      "Hosted runtime state persistence requires a canonical write boundary.",
    );
  }

  await port.persistRuntimeState();
}

export async function withHostedCanonicalWritePort<TResult>(
  port: HostedCanonicalWritePort | null,
  run: () => Promise<TResult>,
): Promise<TResult> {
  return await hostedCanonicalWritePortStorage.run(port, run);
}

export async function applyHostedCanonicalWriteReceipt(input: {
  readPayload(ref: HostedCanonicalWriteReceiptContentRef): Promise<Uint8Array | ArrayBuffer | null>;
  receipt: HostedCanonicalWriteReceipt;
  vaultRoot: string;
}): Promise<void> {
  if (input.receipt.schema !== HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_INVALID",
      "Hosted canonical write receipt schema is invalid.",
    );
  }

  const vaultRoot = normalizeVaultRoot(input.vaultRoot);
  for (const action of input.receipt.actions) {
    switch (action.kind) {
      case "text_upsert": {
        const bytes = await readHostedCanonicalWriteReceiptPayload({
          expectedByteLength: action.byteLength,
          expectedSha256: action.sha256,
          readPayload: input.readPayload,
          ref: action.contentRef,
        });
        await applyHostedCanonicalTextReceiptAction({
          allowRaw: action.allowRaw === true,
          bytes,
          expectedTargetReceipt:
            action.expectedSha256 && action.expectedByteLength !== undefined
              ? {
                  byteLength: action.expectedByteLength,
                  sha256: action.expectedSha256,
                }
              : undefined,
          targetRelativePath: action.targetRelativePath,
          vaultRoot,
        });
        break;
      }
      case "jsonl_append": {
        const bytes = await readHostedCanonicalWriteReceiptPayload({
          expectedByteLength: action.appendByteLength,
          expectedSha256: action.appendSha256,
          readPayload: input.readPayload,
          ref: action.contentRef,
        });
        await applyHostedCanonicalJsonlAppendReceiptAction({
          allowArchivedIntegrationIngestAmendment: action.allowArchivedIntegrationIngestAmendment === true,
          baseByteLength: action.baseByteLength,
          baseSha256: action.baseSha256,
          bytes,
          originalSize: action.originalSize,
          targetRelativePath: action.targetRelativePath,
          vaultRoot,
        });
        break;
      }
      case "raw_upsert": {
        const bytes = await readHostedCanonicalWriteReceiptPayload({
          expectedByteLength: action.byteLength,
          expectedSha256: action.sha256,
          readPayload: input.readPayload,
          ref: action.contentRef,
        });
        await applyHostedCanonicalRawReceiptAction({
          bytes,
          targetRelativePath: action.targetRelativePath,
          vaultRoot,
        });
        break;
      }
      case "delete":
        await applyHostedCanonicalDeleteReceiptAction({
          allowRaw: action.allowRaw === true,
          targetRelativePath: action.targetRelativePath,
          vaultRoot,
        });
        break;
      case "delete_if_match":
        await applyHostedCanonicalDeleteReceiptAction({
          allowRaw: action.allowRaw === true,
          expectedTargetReceipt: {
            byteLength: action.expectedByteLength,
            sha256: action.expectedSha256,
          },
          targetRelativePath: action.targetRelativePath,
          vaultRoot,
        });
        break;
    }
  }
}

async function readHostedCanonicalWriteReceiptPayload(input: {
  expectedByteLength: number;
  expectedSha256: string;
  readPayload(ref: HostedCanonicalWriteReceiptContentRef): Promise<Uint8Array | ArrayBuffer | null>;
  ref?: HostedCanonicalWriteReceiptContentRef;
}): Promise<Uint8Array> {
  if (!input.ref) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_PAYLOAD_MISSING",
      "Hosted canonical write receipt action is missing a payload ref.",
    );
  }
  if (input.ref.sha256 !== input.expectedSha256 || input.ref.byteSize !== input.expectedByteLength) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_PAYLOAD_REF_INVALID",
      "Hosted canonical write receipt payload ref does not match the action.",
    );
  }

  const payload = await input.readPayload(input.ref);
  if (!payload) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_PAYLOAD_UNAVAILABLE",
      "Hosted canonical write payload is unavailable.",
    );
  }
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const receipt = createCommittedPayloadReceipt(bytes);
  if (receipt.sha256 !== input.expectedSha256 || receipt.byteLength !== input.expectedByteLength) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_PAYLOAD_INTEGRITY",
      "Hosted canonical write payload failed integrity verification.",
    );
  }
  return bytes;
}

async function applyHostedCanonicalTextReceiptAction(input: {
  allowRaw: boolean;
  bytes: Uint8Array;
  expectedTargetReceipt?: CommittedPayloadReceipt;
  targetRelativePath: string;
  vaultRoot: string;
}): Promise<void> {
  const isRawTarget = isRawRelativePath(input.targetRelativePath, {
    caseInsensitive: await isVaultFilesystemCaseInsensitive(input.vaultRoot),
  });
  const target = await prepareVerifiedWriteTarget(input.vaultRoot, input.targetRelativePath, {
    kind: "text",
    // Legacy create receipts predate allowRaw. Preserve their create-only
    // replay while requiring explicit authority for guarded raw replacement.
    allowRaw: input.allowRaw || (isRawTarget && !input.expectedTargetReceipt),
  });
  if (await targetMatchesBytes(target.absolutePath, input.bytes)) {
    return;
  }
  if (input.expectedTargetReceipt) {
    let actualReceipt: CommittedPayloadReceipt;
    try {
      actualReceipt = await createFileContentReceipt(target.absolutePath);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        throw new VaultError(
          "HOSTED_CANONICAL_WRITE_TEXT_CONFLICT",
          "Hosted canonical guarded text replay found a missing preimage.",
          { relativePath: input.targetRelativePath },
        );
      }
      throw error;
    }
    if (!receiptsMatch(actualReceipt, input.expectedTargetReceipt)) {
      throw new VaultError(
        "HOSTED_CANONICAL_WRITE_TEXT_CONFLICT",
        "Hosted canonical guarded text replay found conflicting existing bytes.",
        { relativePath: input.targetRelativePath },
      );
    }
  } else if (isRawTarget && (await pathExists(target.absolutePath))) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_RAW_CONFLICT",
      "Hosted canonical raw replay found conflicting existing bytes.",
    );
  }
  await writeTextFileAtomic(target.absolutePath, Buffer.from(input.bytes).toString("utf8"));
}

async function applyHostedCanonicalJsonlAppendReceiptAction(input: {
  allowArchivedIntegrationIngestAmendment: boolean;
  baseByteLength: number;
  baseSha256: string;
  bytes: Uint8Array;
  originalSize: number | null;
  targetRelativePath: string;
  vaultRoot: string;
}): Promise<void> {
  const target = await prepareVerifiedWriteTarget(input.vaultRoot, input.targetRelativePath, {
    kind: "jsonl_append",
  });
  const comparisonOptions: VaultPathComparisonOptions = {
    caseInsensitive: await isVaultFilesystemCaseInsensitive(input.vaultRoot),
  };
  try {
    await assertJsonlAppendTargetCanAppend(target, comparisonOptions);
  } catch (error) {
    if (isArchivedIntegrationIngestAppendError(error, target, comparisonOptions)) {
      if (input.allowArchivedIntegrationIngestAmendment) {
        await appendArchivedIntegrationIngestShard({
          expectedBaseByteLength: input.baseByteLength,
          expectedBaseSha256: input.baseSha256,
          payload: Buffer.from(input.bytes).toString("utf8"),
          targetRelativePath: target.relativePath,
          vaultRoot: input.vaultRoot,
        });
        return;
      }
      await assertArchivedIntegrationIngestHostedAppendAlreadyApplied({
        bytes: input.bytes,
        targetRelativePath: target.relativePath,
        vaultRoot: input.vaultRoot,
      });
      return;
    }
    throw error;
  }
  const originalSize = input.originalSize ?? 0;
  if (input.baseByteLength !== originalSize) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_APPEND_BASE_MISMATCH",
      "Hosted canonical JSONL append base receipt does not match the recorded base size.",
    );
  }

  let existing = new Uint8Array();
  try {
    existing = await fs.readFile(target.absolutePath);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const baseSizeIsPresent = existing.byteLength >= originalSize;
  const baseReceipt = baseSizeIsPresent
    ? createCommittedPayloadReceipt(existing.subarray(0, input.baseByteLength))
    : null;
  const baseMatches = baseReceipt?.sha256 === input.baseSha256
    && baseReceipt.byteLength === input.baseByteLength;
  if (baseMatches) {
    const appendedEnd = originalSize + input.bytes.byteLength;
    if (
      existing.byteLength >= appendedEnd &&
      Buffer.from(existing.subarray(originalSize, appendedEnd)).equals(Buffer.from(input.bytes))
    ) {
      return;
    }
    if (existing.byteLength === originalSize) {
      await fs.appendFile(target.absolutePath, input.bytes);
      return;
    }
  }

  if (await tryReconcileHostedCanonicalAuditAppend({
    bytes: input.bytes,
    comparisonOptions,
    existing,
    target,
  })) {
    return;
  }
  throw new VaultError(
    "HOSTED_CANONICAL_WRITE_APPEND_BASE_MISMATCH",
    baseSizeIsPresent
      ? "Hosted canonical JSONL append base content does not match the receipt."
      : "Hosted canonical JSONL append base size is not present.",
  );
}

async function tryReconcileHostedCanonicalAuditAppend(input: {
  bytes: Uint8Array;
  comparisonOptions: VaultPathComparisonOptions;
  existing: Uint8Array;
  target: ResolvedVaultPath;
}): Promise<boolean> {
  const comparisonRelativePath = normalizeRelativeVaultPathForComparison(
    input.target.relativePath,
    input.comparisonOptions,
  );
  const auditDirectory = normalizeRelativeVaultPathForComparison(
    VAULT_LAYOUT.auditDirectory,
    input.comparisonOptions,
  );
  if (
    !comparisonRelativePath.startsWith(`${auditDirectory}/`) ||
    !isJsonlRelativePath(input.target.relativePath, input.comparisonOptions)
  ) {
    return false;
  }

  const payload = Buffer.from(input.bytes).toString("utf8");
  if (!payload.endsWith("\n")) {
    return false;
  }
  const payloadLines = payload.slice(0, -1).split("\n");
  if (payloadLines.length !== 1 || payloadLines[0]?.length === 0) {
    return false;
  }
  const incomingRecord = parseHostedAuditRecordLine(payloadLines[0]);
  if (!incomingRecord) {
    return false;
  }

  const existingText = Buffer.from(input.existing).toString("utf8");
  if (existingText.length > 0 && !existingText.endsWith("\n")) {
    return false;
  }
  const existingLines = existingText.length === 0 ? [] : existingText.slice(0, -1).split("\n");
  const existingRecordIds = new Set<string>();
  let matchingRecord: typeof incomingRecord | null = null;
  for (const line of existingLines) {
    if (line.length === 0) {
      return false;
    }
    const record = parseHostedAuditRecordLine(line);
    if (!record) {
      return false;
    }
    if (existingRecordIds.has(record.id)) {
      throw new VaultError(
        "HOSTED_CANONICAL_WRITE_APPEND_BASE_MISMATCH",
        "Hosted canonical audit replay found a duplicate existing audit record ID.",
      );
    }
    existingRecordIds.add(record.id);
    if (record.id === incomingRecord.id) {
      matchingRecord = record;
    }
  }

  if (matchingRecord) {
    if (JSON.stringify(matchingRecord) !== JSON.stringify(incomingRecord)) {
      throw new VaultError(
        "HOSTED_CANONICAL_WRITE_APPEND_BASE_MISMATCH",
        "Hosted canonical audit replay found conflicting content for an existing audit record ID.",
      );
    }
    return true;
  }

  await fs.appendFile(input.target.absolutePath, input.bytes);
  return true;
}

function parseHostedAuditRecordLine(line: string) {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const result = auditRecordSchema.safeParse(value);
  return result.success ? result.data : null;
}

function isArchivedIntegrationIngestAppendError(
  error: unknown,
  target: ResolvedVaultPath,
  options: VaultPathComparisonOptions = {},
): boolean {
  return error instanceof VaultError
    && error.code === "INTEGRATION_INGEST_SHARD_ARCHIVED"
    && isIntegrationIngestJsonlAppendTarget(target.relativePath, options);
}

async function assertArchivedIntegrationIngestHostedAppendAlreadyApplied(input: {
  bytes: Uint8Array;
  targetRelativePath: string;
  vaultRoot: string;
}): Promise<void> {
  const payload = Buffer.from(input.bytes).toString("utf8");
  const records = await parseIntegrationIngestAppendPayload(payload, input.targetRelativePath);
  const plan = await buildIntegrationIngestAppendPlan(input.vaultRoot, records);
  if (plan.payloads.size === 0) {
    return;
  }
  throw new VaultError(
    "INTEGRATION_INGEST_SHARD_ARCHIVED",
    `Integration ingest shard "${input.targetRelativePath}" is archived and cannot be appended.`,
    { relativePath: input.targetRelativePath },
  );
}

async function applyHostedCanonicalRawReceiptAction(input: {
  bytes: Uint8Array;
  targetRelativePath: string;
  vaultRoot: string;
}): Promise<void> {
  const target = await prepareVerifiedWriteTarget(input.vaultRoot, input.targetRelativePath, {
    kind: "raw",
  });
  if (await targetMatchesBytes(target.absolutePath, input.bytes)) {
    return;
  }
  if (await pathExists(target.absolutePath)) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_RAW_CONFLICT",
      "Hosted canonical raw replay found conflicting existing bytes.",
    );
  }
  await fs.writeFile(target.absolutePath, input.bytes);
}

async function applyHostedCanonicalDeleteReceiptAction(input: {
  allowRaw: boolean;
  expectedTargetReceipt?: CommittedPayloadReceipt;
  targetRelativePath: string;
  vaultRoot: string;
}): Promise<void> {
  const target = await prepareVerifiedDeleteTarget(input.vaultRoot, input.targetRelativePath, {
    allowAppendOnlyJsonl: true,
    allowRaw: input.allowRaw,
    kind: "delete",
  });
  if (input.expectedTargetReceipt) {
    let actualReceipt: CommittedPayloadReceipt;
    try {
      actualReceipt = await createFileContentReceipt(target.absolutePath);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (!receiptsMatch(actualReceipt, input.expectedTargetReceipt)) {
      throw new VaultError(
        "HOSTED_CANONICAL_WRITE_DELETE_CONFLICT",
        "Hosted canonical guarded delete found conflicting existing bytes.",
        { relativePath: input.targetRelativePath },
      );
    }
  }
  await fs.rm(target.absolutePath, { force: true });
}

async function targetMatchesBytes(absolutePath: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const existing = await fs.readFile(absolutePath);
    return Buffer.from(existing).equals(Buffer.from(bytes));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensurePrivateReceiptDirectory(receiptRoot: string): Promise<void> {
  await fs.mkdir(receiptRoot, { recursive: true, mode: PRIVATE_RECEIPT_DIRECTORY_MODE });
  await fs.chmod(receiptRoot, PRIVATE_RECEIPT_DIRECTORY_MODE);
}

async function writePrivateReceiptFile(absolutePath: string, content: string): Promise<void> {
  await fs.writeFile(absolutePath, content, {
    encoding: "utf8",
    mode: PRIVATE_RECEIPT_FILE_MODE,
  });
  await fs.chmod(absolutePath, PRIVATE_RECEIPT_FILE_MODE);
}

async function writePrivateReceiptPayloadFile(absolutePath: string, content: Uint8Array): Promise<void> {
  await fs.writeFile(absolutePath, content, {
    mode: PRIVATE_RECEIPT_FILE_MODE,
  });
  await fs.chmod(absolutePath, PRIVATE_RECEIPT_FILE_MODE);
}

function resolveHostedCanonicalWritePayloadDirectory(receiptRoot: string): string {
  return path.join(receiptRoot, HOSTED_CANONICAL_WRITE_PAYLOAD_DIRECTORY_NAME);
}

export function resolveHostedCanonicalWritePayloadFilePath(input: {
  receiptRoot: string;
  sha256: string;
}): string {
  if (!/^[a-f0-9]{64}$/u.test(input.sha256)) {
    throw new VaultError(
      "HOSTED_CANONICAL_WRITE_PAYLOAD_REF_INVALID",
      "Hosted canonical write receipt payload ref is invalid.",
    );
  }
  return path.join(resolveHostedCanonicalWritePayloadDirectory(input.receiptRoot), `${input.sha256}.bin`);
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

function getActionStageRelativePath(action: StoredWriteAction): string | null {
  return action.kind === "raw_copy" || action.kind === "text_write" || action.kind === "jsonl_append"
    ? action.stageRelativePath
    : null;
}

function assertUniqueStageRelativePaths(actions: readonly StoredWriteAction[]): void {
  const seen = new Set<string>();
  for (const action of actions) {
    const stageRelativePath = getActionStageRelativePath(action);
    if (!stageRelativePath) {
      continue;
    }
    if (seen.has(stageRelativePath)) {
      throw new VaultError(
        "OPERATION_STAGE_ARTIFACT_CONFLICT",
        "Write batch staged two payloads to the same artifact path.",
      );
    }
    seen.add(stageRelativePath);
  }
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

async function removeTreeInterruptibly(
  absolutePath: string,
  signal: AbortSignal | null | undefined,
): Promise<void> {
  signal?.throwIfAborted();

  let stats: Stats;
  try {
    stats = await fs.lstat(absolutePath);
  } catch (error) {
    signal?.throwIfAborted();
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  signal?.throwIfAborted();

  if (!stats.isDirectory()) {
    await safeUnlink(absolutePath);
    signal?.throwIfAborted();
    return;
  }

  let childNames: string[];
  try {
    childNames = await fs.readdir(absolutePath);
  } catch (error) {
    signal?.throwIfAborted();
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  signal?.throwIfAborted();

  childNames.sort((left, right) => left.localeCompare(right));
  for (const childName of childNames) {
    signal?.throwIfAborted();
    await removeTreeInterruptibly(path.join(absolutePath, childName), signal);
  }

  try {
    await fs.rmdir(absolutePath);
  } catch (error) {
    signal?.throwIfAborted();
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  signal?.throwIfAborted();
}

export function isTerminalWriteOperationStatus(status: string): boolean {
  return status === "committed" || status === "rolled_back";
}

async function readWriteOperationDirectoryEntries(vaultRoot: string) {
  const operationDirectory = await resolveVaultPathOnDisk(vaultRoot, WRITE_OPERATION_DIRECTORY);
  if (!(await pathExists(operationDirectory.absolutePath))) {
    return [];
  }

  const stats = await fs.lstat(operationDirectory.absolutePath);
  if (!stats.isDirectory()) {
    return [];
  }

  return await fs.readdir(operationDirectory.absolutePath, { withFileTypes: true });
}

export async function listWriteOperationMetadataPaths(vaultRoot: string): Promise<string[]> {
  return (await readWriteOperationDirectoryEntries(vaultRoot))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.posix.join(WRITE_OPERATION_DIRECTORY, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export async function listWriteOperationMetadataPathsWithStageDirectories(
  vaultRoot: string,
): Promise<string[]> {
  const entries = await readWriteOperationDirectoryEntries(vaultRoot);
  const stageDirectoryNames = new Set(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        stageDirectoryNames.has(entry.name.slice(0, -".json".length)),
    )
    .map((entry) => path.posix.join(WRITE_OPERATION_DIRECTORY, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export async function pruneTerminalWriteOperationRecords(
  input: PruneTerminalWriteOperationRecordsInput,
): Promise<PruneTerminalWriteOperationRecordsResult> {
  input.signal?.throwIfAborted();
  const checkpointedAfterMs = parsePruneBoundaryMs(input.checkpointedAfter);
  const nowMs = parsePruneBoundaryMs(input.now ?? new Date());
  const retainedOperationCount = normalizeTerminalWriteOperationRetainedCount(
    input.retainedOperationCount,
  );
  const retentionMs = normalizeTerminalWriteOperationRetentionMs(input.retentionMs);
  const result: PruneTerminalWriteOperationRecordsResult = {
    invalidCount: 0,
    prunedByteCount: 0,
    prunedCount: 0,
    prunedFileCount: 0,
    prunedStageDirectoryCount: 0,
    retainedErroredTerminalCount: 0,
    retainedNewestTerminalCount: 0,
    retainedProtectedCount: 0,
    retainedRecentTerminalCount: 0,
    retainedStageDirectoryCount: 0,
    retainedUncheckpointedTerminalCount: 0,
    scannedCount: 0,
  };

  if (checkpointedAfterMs === null || nowMs === null) {
    return result;
  }

  const candidates: PrunableTerminalWriteOperationRecord[] = [];
  const cutoffMs = nowMs - retentionMs;
  const metadataPaths = await listWriteOperationMetadataPaths(input.vaultRoot);
  input.signal?.throwIfAborted();
  for (const relativePath of metadataPaths) {
    input.signal?.throwIfAborted();
    result.scannedCount += 1;
    const operationId = operationIdFromMetadataPath(relativePath);
    if (!operationId) {
      result.invalidCount += 1;
      continue;
    }

    const operation = await readStrictPrunableWriteOperation(input.vaultRoot, relativePath);
    input.signal?.throwIfAborted();
    if (!operation || operation.operationId !== operationId) {
      result.invalidCount += 1;
      continue;
    }

    if (operation.status !== "committed") {
      result.retainedProtectedCount += 1;
      continue;
    }

    if (operation.error) {
      result.retainedErroredTerminalCount += 1;
      continue;
    }

    const updatedAtMs = parsePruneBoundaryMs(operation.updatedAt);
    if (updatedAtMs === null) {
      result.invalidCount += 1;
      continue;
    }

    const stageRoot = (await resolveVaultPathOnDisk(
      input.vaultRoot,
      path.posix.join(WRITE_OPERATION_DIRECTORY, operationId),
    )).absolutePath;
    input.signal?.throwIfAborted();
    if (updatedAtMs >= checkpointedAfterMs) {
      const stageRootExists = await pathExists(stageRoot);
      input.signal?.throwIfAborted();
      if (stageRootExists) {
        result.retainedStageDirectoryCount += 1;
      }
      result.retainedUncheckpointedTerminalCount += 1;
      continue;
    }

    const stageRootExists = await pathExists(stageRoot);
    input.signal?.throwIfAborted();
    if (stageRootExists) {
      await removeTreeInterruptibly(stageRoot, input.signal);
      result.prunedStageDirectoryCount += 1;
    }

    await resolveVaultPathOnDisk(input.vaultRoot, relativePath);
    input.signal?.throwIfAborted();

    candidates.push({
      metadataRelativePath: relativePath,
      operationId,
      stageRoot,
      updatedAtMs,
    });
  }

  candidates.sort((left, right) =>
    right.updatedAtMs - left.updatedAtMs ||
    left.operationId.localeCompare(right.operationId),
  );

  for (const [index, candidate] of candidates.entries()) {
    input.signal?.throwIfAborted();
    if (index < retainedOperationCount) {
      result.retainedNewestTerminalCount += 1;
      continue;
    }

    if (candidate.updatedAtMs > cutoffMs) {
      result.retainedRecentTerminalCount += 1;
      continue;
    }

    const stageRootExists = await pathExists(candidate.stageRoot);
    input.signal?.throwIfAborted();
    if (stageRootExists) {
      await removeTreeInterruptibly(candidate.stageRoot, input.signal);
      result.prunedStageDirectoryCount += 1;
    }

    const metadataPath = (await resolveVaultPathOnDisk(
      input.vaultRoot,
      candidate.metadataRelativePath,
    )).absolutePath;
    input.signal?.throwIfAborted();
    const measured = await measureExistingFile(metadataPath);
    input.signal?.throwIfAborted();
    await safeUnlink(metadataPath);
    input.signal?.throwIfAborted();
    result.prunedCount += 1;
    result.prunedFileCount += measured.fileCount;
    result.prunedByteCount += measured.byteCount;
  }

  return result;
}

async function readStrictPrunableWriteOperation(
  vaultRoot: string,
  relativePath: string,
): Promise<StoredWriteOperation | null> {
  try {
    return await readStoredWriteOperation(vaultRoot, relativePath);
  } catch (error) {
    if (
      (error instanceof VaultError && error.code === "OPERATION_INVALID") ||
      error instanceof SyntaxError ||
      (isErrnoException(error) && error.code === "ENOENT")
    ) {
      return null;
    }
    throw error;
  }
}

function normalizeTerminalWriteOperationRetainedCount(value: number | undefined): number {
  if (typeof value !== "number") {
    return TERMINAL_WRITE_OPERATION_PRUNE_MIN_RETAINED_COUNT;
  }
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : TERMINAL_WRITE_OPERATION_PRUNE_MIN_RETAINED_COUNT;
}

function normalizeTerminalWriteOperationRetentionMs(value: number | undefined): number {
  if (typeof value !== "number") {
    return TERMINAL_WRITE_OPERATION_PRUNE_RETENTION_MS;
  }
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : TERMINAL_WRITE_OPERATION_PRUNE_RETENTION_MS;
}

function parsePruneBoundaryMs(value: DateInput | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function operationIdFromMetadataPath(relativePath: string): string | null {
  const basename = path.posix.basename(relativePath);
  if (!basename.endsWith(".json")) {
    return null;
  }
  const operationId = basename.slice(0, -".json".length);
  return /^op_[A-Za-z0-9_-]+$/u.test(operationId) ? operationId : null;
}

async function measureExistingFile(
  absolutePath: string,
): Promise<{ byteCount: number; fileCount: number }> {
  try {
    const stats = await fs.lstat(absolutePath);
    return stats.isFile()
      ? { byteCount: stats.size, fileCount: 1 }
      : { byteCount: 0, fileCount: 0 };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { byteCount: 0, fileCount: 0 };
    }
    throw error;
  }
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
      const expectedTargetReceipt = parseCommittedPayloadReceipt(record.expectedTargetReceipt);
      if (expectedTargetReceipt === null) {
        return null;
      }

      return {
        kind: "delete",
        ...base,
        allowRaw: record.allowRaw === true,
        backupRelativePath,
        effect: record.effect === "delete" ? record.effect : undefined,
        ...(expectedTargetReceipt ? { expectedTargetReceipt } : {}),
      };
    }
    case "raw_copy": {
      const stageRelativePath = parseStoredRequiredStageRelativePath(record);
      if (!stageRelativePath) {
        return null;
      }
      const expectedSourceReceipt = parseCommittedPayloadReceipt(record.expectedSourceReceipt);
      if (expectedSourceReceipt === null) {
        return null;
      }

      return {
        kind: "raw_copy",
        ...base,
        allowExistingMatch: record.allowExistingMatch === true,
        effect: record.effect === "copy" || record.effect === "reuse" ? record.effect : undefined,
        ...(expectedSourceReceipt ? { expectedSourceReceipt } : {}),
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
      const expectedTargetReceipt = parseCommittedPayloadReceipt(record.expectedTargetReceipt);
      if (expectedTargetReceipt === null) {
        return null;
      }

      return {
        kind: "text_write",
        ...base,
        allowExistingMatch: record.allowExistingMatch === true,
        allowRaw: record.allowRaw === true,
        backupRelativePath,
        committedPayloadReceipt,
        ...(expectedTargetReceipt ? { expectedTargetReceipt } : {}),
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

      const stagedPayloadReceipt = parseCommittedPayloadReceipt(record.stagedPayloadReceipt);
      if (stagedPayloadReceipt === null) {
        return null;
      }

      const baseContentReceipt = parseCommittedPayloadReceipt(record.baseContentReceipt);
      if (baseContentReceipt === null) {
        return null;
      }

      return {
        kind: "jsonl_append",
        ...base,
        allowArchivedIntegrationIngestAmendment: record.allowArchivedIntegrationIngestAmendment === true,
        baseContentReceipt,
        committedPayloadReceipt,
        stagedPayloadReceipt,
        effect: record.effect === "append" ? record.effect : undefined,
        originalSize:
          typeof record.originalSize === "number" &&
            Number.isInteger(record.originalSize) &&
            record.originalSize >= 0
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

export async function readStoredWriteOperationJsonlAppendPayload(input: {
  operation: StoredWriteOperation;
  targetRelativePath: string;
  vaultRoot: string;
}): Promise<string | null> {
  const targetRelativePath = normalizeRelativeVaultPath(input.targetRelativePath);
  const actions = input.operation.actions.filter(
    (action): action is Extract<StoredWriteAction, { kind: "jsonl_append" }> =>
      action.kind === "jsonl_append" && action.targetRelativePath === targetRelativePath,
  );
  if (actions.length !== 1) {
    return null;
  }

  const action = actions[0];
  if (action.state !== "staged" || !action.stagedPayloadReceipt) {
    return null;
  }

  const expectedStagePrefix = `${stageRootRelativePath(input.operation.operationId)}/payloads/`;
  if (!action.stageRelativePath.startsWith(expectedStagePrefix)) {
    return null;
  }

  let content: string;
  try {
    const stagePath = await resolveVaultPathOnDisk(input.vaultRoot, action.stageRelativePath);
    content = await fs.readFile(stagePath.absolutePath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!receiptsMatch(createCommittedPayloadReceipt(content), action.stagedPayloadReceipt)) {
    return null;
  }
  return content;
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
  hostedCanonicalWritePort,
  hostedCanonicalWriteReceiptDirectory,
  assertCanContinue,
  mutate,
}: RunCanonicalWriteInput<TResult>): Promise<TResult> {
  assertCanContinue?.();
  const batch = await WriteBatch.create({
    vaultRoot,
    operationType,
    summary,
    occurredAt,
    hostedCanonicalWritePort,
    hostedCanonicalWriteReceiptDirectory,
  });

  let result: TResult;

  try {
    assertCanContinue?.();
    result = await mutate({
      batch,
      vaultRoot: batch.vaultRoot,
    });
    assertCanContinue?.();
  } catch (error) {
    await batch.rollback();
    throw error;
  }

  await batch.commit({ assertCanContinue });
  return result;
}

export class WriteBatch {
  readonly vaultRoot: string;
  readonly operationId: string;
  readonly metadataRelativePath: string;
  readonly stageRootRelativePath: string;

  private readonly metadataAbsolutePath: string;
  private readonly stageRootAbsolutePath: string;
  private readonly hostedCanonicalWritePort: HostedCanonicalWritePort | null;
  private readonly hostedCanonicalWriteReceiptDirectory: string | null;
  private readonly record: StoredWriteOperation;
  private persistTail: Promise<void> = Promise.resolve();
  private nextStageArtifactOrdinal: number;

  private constructor(input: {
    hostedCanonicalWritePort?: HostedCanonicalWritePort | null;
    hostedCanonicalWriteReceiptDirectory?: string | null;
    record: StoredWriteOperation;
    vaultRoot: string;
  }) {
    const { record, vaultRoot } = input;
    this.vaultRoot = vaultRoot;
    this.operationId = record.operationId;
    this.metadataRelativePath = metadataRelativePath(record.operationId);
    this.stageRootRelativePath = stageRootRelativePath(record.operationId);
    this.metadataAbsolutePath = resolveVaultPath(vaultRoot, this.metadataRelativePath).absolutePath;
    this.stageRootAbsolutePath = resolveVaultPath(vaultRoot, this.stageRootRelativePath).absolutePath;
    this.hostedCanonicalWritePort = input.hostedCanonicalWritePort === undefined
      ? resolveAmbientHostedCanonicalWritePort()
      : input.hostedCanonicalWritePort ?? null;
    this.hostedCanonicalWriteReceiptDirectory =
      input.hostedCanonicalWriteReceiptDirectory === undefined
        ? resolveHostedCanonicalWriteReceiptDirectoryFromEnv()
        : input.hostedCanonicalWriteReceiptDirectory
          ? path.resolve(input.hostedCanonicalWriteReceiptDirectory)
          : null;
    this.record = record;
    this.nextStageArtifactOrdinal = record.actions.filter((action) => getActionStageRelativePath(action)).length;
  }

  static async create({
    vaultRoot,
    operationType,
    summary,
    occurredAt = new Date(),
    hostedCanonicalWritePort,
    hostedCanonicalWriteReceiptDirectory,
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
    const batch = new WriteBatch({
      hostedCanonicalWritePort,
      hostedCanonicalWriteReceiptDirectory,
      record,
      vaultRoot: absoluteRoot,
    });
    await ensureDirectory(path.dirname(batch.metadataAbsolutePath));
    await ensureDirectory(batch.stageRootAbsolutePath);
    await batch.persist();
    return batch;
  }

  async stageRawCopy({
    sourcePath,
    targetRelativePath,
    allowExistingMatch = false,
    expectedSourceReceipt,
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

    const stageRelativePath = this.reserveStageArtifactRelativePath("raw");
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, stageRelativePath).absolutePath;
    await ensureDirectory(path.dirname(stageAbsolutePath));
    await fs.copyFile(sourceAbsolutePath, stageAbsolutePath);
    if (expectedSourceReceipt) {
      const stagedReceipt = await createFileContentReceipt(stageAbsolutePath);
      if (!receiptsMatch(stagedReceipt, expectedSourceReceipt)) {
        await safeUnlink(stageAbsolutePath);
        throw new VaultError(
          "OPERATION_PRECONDITION_FAILED",
          `Raw source for "${normalizedTarget}" changed after it was inspected.`,
          { relativePath: normalizedTarget },
        );
      }
    }

    this.record.actions.push({
      kind: "raw_copy",
      state: "staged",
      targetRelativePath: normalizedTarget,
      stageRelativePath,
      allowExistingMatch,
      originalFileName,
      mediaType,
      expectedSourceReceipt: expectedSourceReceipt
        ? { ...expectedSourceReceipt }
        : undefined,
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

    const stageRelativePath = this.reserveStageArtifactRelativePath("raw");
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
    if (options.expectedTargetReceipt && options.overwrite === false) {
      throw new VaultError(
        "OPERATION_PRECONDITION_INVALID",
        "Receipt-guarded text writes must replace the inspected target.",
        { relativePath: targetRelativePath },
      );
    }
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

    const stageRelativePath = this.reserveStageArtifactRelativePath("txt");
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
      expectedTargetReceipt: options.expectedTargetReceipt
        ? { ...options.expectedTargetReceipt }
        : undefined,
    });
    await this.persist();
    return normalizedTarget;
  }

  async stageJsonlAppend(
    targetRelativePath: string,
    content: string,
  ): Promise<string> {
    return await this.stageJsonlAppendAction(targetRelativePath, content, false);
  }

  async stageIntegrationIngestAppendPlan(
    plan: IntegrationIngestAppendPlan,
  ): Promise<void> {
    this.assertMutable();
    assertAuthorizedIntegrationIngestAppendPlan(plan);
    const archivedAmendmentShardPaths = new Set(plan.archivedAmendmentShardPaths);
    for (const relativePath of [...plan.payloads.keys()].sort()) {
      const payload = plan.payloads.get(relativePath);
      if (payload) {
        const archivedAmendment = archivedAmendmentShardPaths.has(relativePath);
        await this.stageJsonlAppendAction(
          relativePath,
          archivedAmendment
            ? payload
            : await prepareLiveIntegrationIngestAppendPayload(this.vaultRoot, relativePath, payload),
          archivedAmendment,
        );
      }
    }
  }

  private async stageJsonlAppendAction(
    targetRelativePath: string,
    content: string,
    allowArchivedIntegrationIngestAmendment: boolean,
  ): Promise<string> {
    this.assertMutable();
    const normalizedTarget = normalizeRelativeVaultPath(targetRelativePath);
    await assertWriteTargetPolicyForVault(this.vaultRoot, normalizedTarget, {
      kind: "jsonl_append",
      messages: {
        appendOnlyDisallowed: "Append-only writes are restricted to JSONL ledger and audit shards.",
        rawDisallowed: "Raw files are immutable once written.",
      },
    });

    const stageRelativePath = this.reserveStageArtifactRelativePath("jsonl");
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, stageRelativePath).absolutePath;
    await ensureDirectory(path.dirname(stageAbsolutePath));
    await fs.writeFile(stageAbsolutePath, content, "utf8");
    const stagedPayloadReceipt = createCommittedPayloadReceipt(content);

    this.record.actions.push({
      kind: "jsonl_append",
      state: "staged",
      targetRelativePath: normalizedTarget,
      stageRelativePath,
      stagedPayloadReceipt,
      allowArchivedIntegrationIngestAmendment,
    });
    await this.persist();
    return normalizedTarget;
  }

  async stageDelete(
    targetRelativePath: string,
    options: {
      allowAppendOnlyJsonl?: boolean;
      allowRaw?: boolean;
      expectedTargetReceipt?: CommittedPayloadReceipt;
    } = {},
  ): Promise<string> {
    this.assertMutable();
    const normalizedTarget = normalizeRelativeVaultPath(targetRelativePath);
    await assertWriteTargetPolicyForVault(this.vaultRoot, normalizedTarget, {
      kind: "delete",
      allowAppendOnlyJsonl: options.allowAppendOnlyJsonl,
      allowRaw: options.allowRaw,
      messages: {
        appendOnlyDisallowed: "Use stageJsonlAppend for ledger and audit shards.",
        rawDisallowed:
          "Raw files are immutable; opt in with allowRaw for retention/privacy deletes.",
      },
    });
    this.record.actions.push({
      kind: "delete",
      state: "staged",
      targetRelativePath: normalizedTarget,
      allowRaw: options.allowRaw ?? false,
      expectedTargetReceipt: options.expectedTargetReceipt
        ? { ...options.expectedTargetReceipt }
        : undefined,
    });
    await this.persist();
    return normalizedTarget;
  }

  async commit(
    options: CommitWriteBatchOptions = {},
  ): Promise<HostedCanonicalWriteReceipt | null> {
    this.assertMutable();
    options.assertCanContinue?.();
    assertUniqueStageRelativePaths(this.record.actions);
    const lock = await acquireCanonicalWriteLock(this.vaultRoot);
    let hostedCanonicalWriteReceipt: HostedCanonicalWriteReceipt | null = null;

    try {
      try {
        this.record.status = "committing";
        this.record.updatedAt = nowIso();
        this.record.error = undefined;
        await this.persist();

        for (const [index, action] of this.record.actions.entries()) {
          options.assertCanContinue?.();
          if (action.state === "applied" || action.state === "reused") {
            continue;
          }

          await this.applyAction(index, action);
          options.assertCanContinue?.();
        }

        options.assertCanContinue?.();
        await this.persistGuardReceiptIfConfigured();
        options.assertCanContinue?.();
        const hostedCanonicalWritePersistenceInput =
          await this.persistHostedCanonicalWriteReceiptIfConfigured();
        hostedCanonicalWriteReceipt = hostedCanonicalWritePersistenceInput?.receipt ?? null;
        this.record.status = "committed";
        this.record.updatedAt = nowIso();
        this.record.error = undefined;
        await this.persist();
        if (hostedCanonicalWritePersistenceInput) {
          await this.persistHostedCanonicalWriteIfConfigured(hostedCanonicalWritePersistenceInput);
        }
      } catch (error) {
        this.record.error = toStoredOperationError(error);
        this.record.updatedAt = nowIso();
        await this.persistBestEffort();

        let rollbackFailed = false;
        try {
          await this.rollbackAppliedActions();
          await this.cleanupGuardReceiptIfConfigured();
          await this.cleanupHostedCanonicalWriteReceiptIfConfigured();
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

    return hostedCanonicalWriteReceipt;
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

  private reserveStageArtifactRelativePath(extension: "jsonl" | "raw" | "txt"): string {
    const ordinal = this.nextStageArtifactOrdinal;
    this.nextStageArtifactOrdinal += 1;
    return stageArtifactRelativePath(
      this.operationId,
      `${String(ordinal).padStart(4, "0")}.${extension}`,
    );
  }

  private async persist(): Promise<void> {
    const snapshot = `${JSON.stringify(this.record, null, 2)}\n`;
    const write = this.persistTail.then(async () => {
      await writeTextFileAtomic(this.metadataAbsolutePath, snapshot);
    });
    this.persistTail = write.catch(() => undefined);
    await write;
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

  private async cleanupHostedCanonicalWriteReceiptIfConfigured(): Promise<void> {
    const receiptRoot = this.hostedCanonicalWriteReceiptDirectory;
    if (!receiptRoot) {
      return;
    }

    await fs.rm(path.join(receiptRoot, `${this.operationId}.json`), { force: true });
  }

  private async persistGuardReceiptIfConfigured(): Promise<void> {
    const receiptRoot = resolveGuardReceiptDirectoryFromEnv();
    if (!receiptRoot) {
      return;
    }

    const actions: WriteOperationGuardReceiptAction[] = [];
    await ensurePrivateReceiptDirectory(receiptRoot);

    for (const action of this.record.actions) {
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

      actions.push({
        kind: action.kind,
        targetRelativePath: action.targetRelativePath,
        committedPayloadReceipt: payloadReceipt,
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
    await writePrivateReceiptFile(
      path.join(receiptRoot, `${this.operationId}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
  }

  private async persistHostedCanonicalWriteReceiptIfConfigured(): Promise<HostedCanonicalWritePersistenceInput | null> {
    if (!this.hostedCanonicalWritePort && !this.hostedCanonicalWriteReceiptDirectory) {
      return null;
    }

    const receipt = await this.createHostedCanonicalWriteReceipt();
    const payloads = (this.hostedCanonicalWritePort || this.hostedCanonicalWriteReceiptDirectory)
      ? await this.createHostedCanonicalWritePayloads()
      : [];
    if (this.hostedCanonicalWriteReceiptDirectory) {
      await ensurePrivateReceiptDirectory(this.hostedCanonicalWriteReceiptDirectory);
      await this.persistHostedCanonicalWritePayloads(this.hostedCanonicalWriteReceiptDirectory, payloads);
      await writePrivateReceiptFile(
        path.join(this.hostedCanonicalWriteReceiptDirectory, `${this.operationId}.json`),
        `${JSON.stringify(receipt, null, 2)}\n`,
      );
    }
    return {
      payloads,
      receipt,
    };
  }

  private async persistHostedCanonicalWritePayloads(
    receiptRoot: string,
    payloads: readonly HostedCanonicalWritePayload[],
  ): Promise<void> {
    if (payloads.length === 0) {
      return;
    }

    const payloadRoot = resolveHostedCanonicalWritePayloadDirectory(receiptRoot);
    await ensurePrivateReceiptDirectory(payloadRoot);
    await Promise.all(payloads.map(async (payload) => {
      await writePrivateReceiptPayloadFile(
        resolveHostedCanonicalWritePayloadFilePath({
          receiptRoot,
          sha256: payload.sha256,
        }),
        payload.bytes,
      );
    }));
  }

  private async persistHostedCanonicalWriteIfConfigured(
    input: HostedCanonicalWritePersistenceInput,
  ): Promise<void> {
    if (!this.hostedCanonicalWritePort) {
      return;
    }
    await this.hostedCanonicalWritePort.persistCanonicalWrite(input);
  }

  private async createHostedCanonicalWriteReceipt(): Promise<HostedCanonicalWriteReceipt> {
    const committedAt = nowIso();
    const actions: HostedCanonicalWriteReceiptAction[] = [];
    for (const action of this.record.actions) {
      actions.push(await this.createHostedCanonicalWriteReceiptAction(action));
    }

    return {
      schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
      operationId: this.operationId,
      operationType: this.record.operationType,
      summary: this.record.summary,
      createdAt: this.record.createdAt,
      updatedAt: this.record.updatedAt,
      occurredAt: this.record.occurredAt,
      committedAt,
      actions,
    };
  }

  private async createHostedCanonicalWritePayloads(): Promise<HostedCanonicalWritePayload[]> {
    assertUniqueStageRelativePaths(this.record.actions);
    const payloadsBySha = new Map<string, HostedCanonicalWritePayload>();
    for (const action of this.record.actions) {
      if (
        action.kind !== "text_write" &&
        action.kind !== "jsonl_append" &&
        action.kind !== "raw_copy"
      ) {
        continue;
      }
      const bytes = await fs.readFile(resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath);
      const receipt = createCommittedPayloadReceipt(bytes);
      if (action.kind === "raw_copy") {
        this.assertExpectedSourceReceipt(action, receipt);
      }
      const existing = payloadsBySha.get(receipt.sha256);
      if (existing) {
        if (existing.byteLength !== receipt.byteLength) {
          throw new VaultError(
            "CANONICAL_WRITE_PAYLOAD_CONFLICT",
            "Hosted canonical write payload hash collision detected.",
          );
        }
        continue;
      }
      payloadsBySha.set(receipt.sha256, {
        bytes,
        byteLength: receipt.byteLength,
        sha256: receipt.sha256,
      });
    }
    return [...payloadsBySha.values()];
  }

  private async createHostedCanonicalWriteReceiptAction(
    action: StoredWriteAction,
  ): Promise<HostedCanonicalWriteReceiptAction> {
    switch (action.kind) {
      case "text_write": {
        const payloadReceipt = await this.requireActionPayloadReceipt(action);
        return {
          kind: "text_upsert",
          targetRelativePath: action.targetRelativePath,
          sha256: payloadReceipt.sha256,
          byteLength: payloadReceipt.byteLength,
          effect: action.effect ?? "update",
          ...(action.allowRaw ? { allowRaw: true as const } : {}),
          ...(action.expectedTargetReceipt
            ? {
                expectedSha256: action.expectedTargetReceipt.sha256,
                expectedByteLength: action.expectedTargetReceipt.byteLength,
              }
            : {}),
          contentRef: createHostedCanonicalWriteReceiptContentRef(payloadReceipt),
        };
      }
      case "jsonl_append": {
        const payloadReceipt = await this.requireActionPayloadReceipt(action);
        const baseContentReceipt = action.baseContentReceipt ??
          (action.originalSize === 0 ? createCommittedPayloadReceipt(new Uint8Array()) : null);
        if (!baseContentReceipt) {
          throw new VaultError(
            "CANONICAL_WRITE_RECEIPT_INCOMPLETE",
            "JSONL append receipt is missing the base content receipt.",
          );
        }
        return {
          kind: "jsonl_append",
          targetRelativePath: action.targetRelativePath,
          appendSha256: payloadReceipt.sha256,
          appendByteLength: payloadReceipt.byteLength,
          baseSha256: baseContentReceipt.sha256,
          baseByteLength: baseContentReceipt.byteLength,
          originalSize: action.originalSize ?? null,
          ...(action.allowArchivedIntegrationIngestAmendment
            ? { allowArchivedIntegrationIngestAmendment: true as const }
            : {}),
          contentRef: createHostedCanonicalWriteReceiptContentRef(payloadReceipt),
        };
      }
      case "raw_copy": {
        const payloadReceipt = await this.createActionPayloadReceiptFromStage(action);
        return {
          kind: "raw_upsert",
          targetRelativePath: action.targetRelativePath,
          sha256: payloadReceipt.sha256,
          byteLength: payloadReceipt.byteLength,
          mediaType: action.mediaType,
          originalFileName: action.originalFileName,
          effect: action.effect ?? "copy",
          contentRef: createHostedCanonicalWriteReceiptContentRef(payloadReceipt),
        };
      }
      case "delete":
        if (action.expectedTargetReceipt) {
          return {
            kind: "delete_if_match",
            targetRelativePath: action.targetRelativePath,
            existedBefore: action.existedBefore ?? false,
            expectedSha256: action.expectedTargetReceipt.sha256,
            expectedByteLength: action.expectedTargetReceipt.byteLength,
            ...(action.allowRaw ? { allowRaw: true as const } : {}),
          };
        }
        return {
          kind: "delete",
          targetRelativePath: action.targetRelativePath,
          existedBefore: action.existedBefore ?? false,
          ...(action.allowRaw ? { allowRaw: true as const } : {}),
        };
    }
  }

  private async requireActionPayloadReceipt(
    action: Extract<StoredWriteAction, { kind: "jsonl_append" | "text_write" }>,
  ): Promise<CommittedPayloadReceipt> {
    return action.committedPayloadReceipt ?? await this.createActionPayloadReceiptFromStage(action);
  }

  private async createActionPayloadReceiptFromStage(
    action: Extract<StoredWriteAction, { kind: "jsonl_append" | "raw_copy" | "text_write" }>,
  ): Promise<CommittedPayloadReceipt> {
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath;
    const receipt = createCommittedPayloadReceipt(await fs.readFile(stageAbsolutePath));
    if (action.kind === "raw_copy") {
      this.assertExpectedSourceReceipt(action, receipt);
    }
    return receipt;
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

  private assertExpectedSourceReceipt(
    action: Extract<StoredWriteAction, { kind: "raw_copy" }>,
    actualReceipt: CommittedPayloadReceipt,
  ): void {
    if (
      action.expectedSourceReceipt
      && !receiptsMatch(actualReceipt, action.expectedSourceReceipt)
    ) {
      throw new VaultError(
        "OPERATION_PRECONDITION_FAILED",
        `Raw source for "${action.targetRelativePath}" changed after it was inspected.`,
        {
          operationId: this.operationId,
          relativePath: action.targetRelativePath,
        },
      );
    }
  }

  private async assertExpectedTargetReceipt(
    action: Extract<StoredWriteAction, { kind: "delete" | "text_write" }>,
    absolutePath: string,
  ): Promise<void> {
    if (!action.expectedTargetReceipt) {
      return;
    }

    let actualReceipt: CommittedPayloadReceipt;
    try {
      actualReceipt = await createFileContentReceipt(absolutePath);
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "ENOENT") {
        throw error;
      }
      throw new VaultError(
        "OPERATION_PRECONDITION_FAILED",
        `Write target "${action.targetRelativePath}" disappeared after it was inspected.`,
        {
          operationId: this.operationId,
          relativePath: action.targetRelativePath,
        },
      );
    }

    if (!receiptsMatch(actualReceipt, action.expectedTargetReceipt)) {
      throw new VaultError(
        "OPERATION_PRECONDITION_FAILED",
        `Write target "${action.targetRelativePath}" changed after it was inspected.`,
        {
          operationId: this.operationId,
          relativePath: action.targetRelativePath,
        },
      );
    }
  }

  private async moveExpectedTargetToBackup(
    action: BackupCapableStoredWriteAction,
    targetAbsolutePath: string,
  ): Promise<string> {
    if (!action.expectedTargetReceipt || !action.backupRelativePath) {
      throw new VaultError(
        "OPERATION_PRECONDITION_INVALID",
        `Write target "${action.targetRelativePath}" has incomplete precondition metadata.`,
        {
          operationId: this.operationId,
          relativePath: action.targetRelativePath,
        },
      );
    }

    const backupAbsolutePath = resolveVaultPath(
      this.vaultRoot,
      action.backupRelativePath,
    ).absolutePath;
    const backupExists = await pathExists(backupAbsolutePath);
    if (backupExists) {
      if (await pathExists(targetAbsolutePath)) {
        throw new VaultError(
          "OPERATION_PRECONDITION_FAILED",
          `Write target "${action.targetRelativePath}" was recreated while its inspected bytes were quarantined.`,
          {
            operationId: this.operationId,
            relativePath: action.targetRelativePath,
          },
        );
      }
    } else {
      await ensureDirectory(path.dirname(backupAbsolutePath));
      try {
        await fs.rename(targetAbsolutePath, backupAbsolutePath);
      } catch (error) {
        if (!isErrnoException(error) || error.code !== "ENOENT") {
          throw error;
        }
        throw new VaultError(
          "OPERATION_PRECONDITION_FAILED",
          `Write target "${action.targetRelativePath}" disappeared after it was inspected.`,
          {
            operationId: this.operationId,
            relativePath: action.targetRelativePath,
          },
        );
      }
    }

    await this.assertExpectedTargetReceipt(action, backupAbsolutePath);
    return backupAbsolutePath;
  }

  private async restoreExpectedTargetFromBackup(
    action: BackupCapableStoredWriteAction,
  ): Promise<boolean> {
    if (!action.expectedTargetReceipt || !action.backupRelativePath) {
      return false;
    }

    const backupAbsolutePath = resolveVaultPath(
      this.vaultRoot,
      action.backupRelativePath,
    ).absolutePath;
    if (!(await pathExists(backupAbsolutePath))) {
      return false;
    }

    const targetAbsolutePath = resolveVaultPath(
      this.vaultRoot,
      action.targetRelativePath,
    ).absolutePath;
    const backupReceipt = await createFileContentReceipt(backupAbsolutePath);
    if (action.kind === "delete") {
      if (await pathExists(targetAbsolutePath)) {
        const targetReceipt = await createFileContentReceipt(targetAbsolutePath);
        if (receiptsMatch(backupReceipt, targetReceipt)) {
          return true;
        }

        throw new VaultError(
          "OPERATION_ROLLBACK_CONFLICT",
          `Write target "${action.targetRelativePath}" was recreated before rollback; its quarantined bytes were retained.`,
          {
            operationId: this.operationId,
            relativePath: action.targetRelativePath,
          },
        );
      }
    } else {
      const replacementRelativePath = `${action.backupRelativePath}.replacement`;
      const replacementAbsolutePath = resolveVaultPath(
        this.vaultRoot,
        replacementRelativePath,
      ).absolutePath;

      if (await pathExists(targetAbsolutePath)) {
        const targetReceipt = await createFileContentReceipt(targetAbsolutePath);
        if (receiptsMatch(backupReceipt, targetReceipt)) {
          return true;
        }
        if (await pathExists(replacementAbsolutePath)) {
          throw new VaultError(
            "OPERATION_ROLLBACK_CONFLICT",
            `Text target "${action.targetRelativePath}" and its replacement quarantine both exist; all bytes were retained.`,
            {
              operationId: this.operationId,
              relativePath: action.targetRelativePath,
            },
          );
        }
        await ensureDirectory(path.dirname(replacementAbsolutePath));
        await fs.rename(targetAbsolutePath, replacementAbsolutePath);
      }

      if (await pathExists(replacementAbsolutePath)) {
        const replacementReceipt = await createFileContentReceipt(
          replacementAbsolutePath,
        );
        if (
          !action.committedPayloadReceipt
          || !receiptsMatch(replacementReceipt, action.committedPayloadReceipt)
        ) {
          try {
            await copyFileAtomicExclusive(
              replacementAbsolutePath,
              targetAbsolutePath,
            );
          } catch (error) {
            throw new VaultError(
              "OPERATION_ROLLBACK_CONFLICT",
              `Text target "${action.targetRelativePath}" changed during rollback; the changed bytes and original backup were retained.`,
              {
                cause: error instanceof Error ? error.message : String(error),
                operationId: this.operationId,
                relativePath: action.targetRelativePath,
              },
            );
          }
          throw new VaultError(
            "OPERATION_ROLLBACK_CONFLICT",
            `Text target "${action.targetRelativePath}" changed before rollback; the changed bytes and original backup were retained.`,
            {
              operationId: this.operationId,
              relativePath: action.targetRelativePath,
            },
          );
        }
      }
    }

    try {
      await copyFileAtomicExclusive(backupAbsolutePath, targetAbsolutePath);
    } catch (error) {
      throw new VaultError(
        "OPERATION_ROLLBACK_CONFLICT",
        `Write target "${action.targetRelativePath}" was recreated during rollback; its quarantined bytes were retained.`,
        {
          cause: error instanceof Error ? error.message : String(error),
          operationId: this.operationId,
          relativePath: action.targetRelativePath,
        },
      );
    }
    return true;
  }

  private getPreparedJsonlBaseReceipt(
    action: Extract<StoredWriteAction, { kind: "jsonl_append" }>,
  ): CommittedPayloadReceipt {
    if (action.baseContentReceipt) {
      return action.baseContentReceipt;
    }
    if (action.originalSize === 0) {
      return createCommittedPayloadReceipt(new Uint8Array());
    }
    throw this.buildResumeConflictError(
      action,
      `Append target "${action.targetRelativePath}" cannot be resumed without a base content receipt.`,
    );
  }

  private async applyRawCopy(action: Extract<StoredWriteAction, { kind: "raw_copy" }>): Promise<void> {
    const stageAbsolutePath = resolveVaultPath(this.vaultRoot, action.stageRelativePath).absolutePath;
    const [stagedContent, stagedStats] = await Promise.all([
      fs.readFile(stageAbsolutePath),
      fs.stat(stageAbsolutePath),
    ]);
    this.assertExpectedSourceReceipt(action, createCommittedPayloadReceipt(stagedContent));
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
          createTarget: () =>
            writeBytesFileAtomicExclusive(target.absolutePath, stagedContent, {
              mode: stagedStats.mode & 0o7777,
            }),
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
        if (
          !action.expectedTargetReceipt
          &&
          action.existedBefore === true
          && action.overwrite
          && !(await pathExists(target.absolutePath))
        ) {
          throw this.buildResumeConflictError(
            action,
            `Text target "${action.targetRelativePath}" disappeared while resuming the write batch.`,
          );
        }

        if (action.expectedTargetReceipt) {
          if (!action.overwrite || !action.backupRelativePath) {
            throw new VaultError(
              "OPERATION_PRECONDITION_INVALID",
              `Receipt-guarded text target "${action.targetRelativePath}" has incomplete replacement metadata.`,
              {
                operationId: this.operationId,
                relativePath: action.targetRelativePath,
              },
            );
          }

          const backupAbsolutePath = await this.moveExpectedTargetToBackup(
            action,
            target.absolutePath,
          );
          const replacementMode = (await fs.stat(backupAbsolutePath)).mode & 0o7777;
          try {
            await writeBytesFileAtomicExclusive(
              target.absolutePath,
              Buffer.from(stagedContent, "utf8"),
              { mode: replacementMode },
            );
          } catch (error) {
            if (!isErrnoException(error) || error.code !== "EEXIST") {
              throw error;
            }
            throw new VaultError(
              "OPERATION_PRECONDITION_FAILED",
              `Text target "${action.targetRelativePath}" was recreated while its inspected bytes were quarantined.`,
              {
                operationId: this.operationId,
                relativePath: action.targetRelativePath,
              },
            );
          }
          return {
            effect: "update",
            existedBefore: true,
          } as const;
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

        if (
          action.overwrite
          && existedBefore
          && backupRelativePath
          && !action.expectedTargetReceipt
        ) {
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
    const payloadBytes = Buffer.from(payload, "utf8");
    const payloadReceipt = action.committedPayloadReceipt ?? createCommittedPayloadReceipt(payloadBytes);
    const comparisonOptions: VaultPathComparisonOptions = {
      caseInsensitive: await isVaultFilesystemCaseInsensitive(this.vaultRoot),
    };
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

        const baseContentReceipt = this.getPreparedJsonlBaseReceipt(action);
        if (action.allowArchivedIntegrationIngestAmendment) {
          const archivedState = await inspectArchivedIntegrationIngestShardAppend({
            expectedBaseByteLength: action.originalSize,
            expectedBaseSha256: baseContentReceipt.sha256,
            payload: payloadBytes,
            targetRelativePath: action.targetRelativePath,
            vaultRoot: this.vaultRoot,
          });
          if (archivedState === "base") {
            return undefined;
          }
          if (archivedState === "applied") {
            return {
              effect: "append",
              existedBefore: true,
              originalSize: action.originalSize,
            } as const;
          }
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
        if (targetSize < action.originalSize) {
          throw this.buildResumeConflictError(
            action,
            `Append target "${action.targetRelativePath}" changed unexpectedly while resuming the write batch.`,
          );
        }

        const targetContent = await fs.readFile(target.absolutePath);
        const actualBaseReceipt = createCommittedPayloadReceipt(targetContent.subarray(0, action.originalSize));
        if (!receiptsMatch(actualBaseReceipt, baseContentReceipt)) {
          throw this.buildResumeConflictError(
            action,
            `Append target "${action.targetRelativePath}" base content changed while resuming the write batch.`,
          );
        }

        if (targetSize === action.originalSize) {
          return undefined;
        }

        const expectedSize = action.originalSize + payloadBytes.byteLength;
        if (targetSize !== expectedSize) {
          throw this.buildResumeConflictError(
            action,
            `Append target "${action.targetRelativePath}" changed unexpectedly while resuming the write batch.`,
          );
        }

        if (!Buffer.from(targetContent.subarray(action.originalSize)).equals(payloadBytes)) {
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
      mutateTarget: async (target) => {
        try {
          return await applyJsonlAppendTarget({
            appendPayload: (payloadChunk) => fs.appendFile(target.absolutePath, payloadChunk, "utf8"),
            readPayload: async () => payload,
            target,
          });
        } catch (error) {
          if (
            action.allowArchivedIntegrationIngestAmendment &&
            isArchivedIntegrationIngestAppendError(error, target, comparisonOptions)
          ) {
            const baseContentReceipt = action.baseContentReceipt;
            if (!baseContentReceipt) {
              throw this.buildResumeConflictError(
                action,
                `Archived append target "${action.targetRelativePath}" is missing its prepared base receipt.`,
              );
            }
            const result = await appendArchivedIntegrationIngestShard({
              expectedBaseByteLength: baseContentReceipt.byteLength,
              expectedBaseSha256: baseContentReceipt.sha256,
              payload,
              targetRelativePath: action.targetRelativePath,
              vaultRoot: this.vaultRoot,
            });
            return {
              effect: "append",
              existedBefore: true,
              originalSize: result.originalSize,
            } as const;
          }
          throw error;
        }
      },
      prepareMutation: async (target) => {
        if (action.allowArchivedIntegrationIngestAmendment) {
          const archivedReceipt = await createArchivedIntegrationIngestShardContentReceipt(
            this.vaultRoot,
            action.targetRelativePath,
          );
          if (archivedReceipt) {
            const originalSize = action.originalSize ?? archivedReceipt.byteLength;
            const baseContentReceipt = action.baseContentReceipt ??
              archivedReceipt;
            if (baseContentReceipt.byteLength !== originalSize) {
              throw this.buildResumeConflictError(
                action,
                `Archived append target "${action.targetRelativePath}" base size changed while preparing the write batch.`,
              );
            }
            await this.persistPreparedAction(() => {
              let changed = false;
              if (action.baseContentReceipt === undefined) {
                action.baseContentReceipt = baseContentReceipt;
                changed = true;
              }
              if (action.committedPayloadReceipt === undefined) {
                action.committedPayloadReceipt = payloadReceipt;
                changed = true;
              }
              if (action.existedBefore === undefined) {
                action.existedBefore = true;
                changed = true;
              }
              if (action.originalSize === undefined) {
                action.originalSize = originalSize;
                changed = true;
              }
              return changed;
            });
            return;
          }
        }

        const existedBefore = action.existedBefore ?? (await pathExists(target.absolutePath));
        const originalSize = action.originalSize ?? (existedBefore ? (await fs.stat(target.absolutePath)).size : 0);
        const baseContentReceipt = action.baseContentReceipt ??
          (existedBefore ? await createFileContentReceipt(target.absolutePath) : createCommittedPayloadReceipt(new Uint8Array()));
        if (baseContentReceipt.byteLength !== originalSize) {
          throw this.buildResumeConflictError(
            action,
            `Append target "${action.targetRelativePath}" base size changed while preparing the write batch.`,
          );
        }
        await this.persistPreparedAction(() => {
          let changed = false;
          if (action.baseContentReceipt === undefined) {
            action.baseContentReceipt = baseContentReceipt;
            changed = true;
          }
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
        if (action.expectedTargetReceipt) {
          await this.assertExpectedTargetReceipt(action, backupAbsolutePath);
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
          if (action.expectedTargetReceipt) {
            await this.assertExpectedTargetReceipt(action, target.absolutePath);
          }
          return {
            existedBefore: false,
            state: "reused",
          };
        }

        const backupRelativePath = this.resolveActionBackupRelativePath(index, action);
        if (action.expectedTargetReceipt) {
          await this.moveExpectedTargetToBackup(action, target.absolutePath);
          return {
            backupRelativePath,
            existedBefore: true,
            state: "applied",
          };
        }

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

        if (!action.expectedTargetReceipt) {
          await this.ensureBackupArtifactExists(target.absolutePath, backupRelativePath);
        }
      },
      prepareTarget: async () =>
        await prepareVerifiedDeleteTarget(this.vaultRoot, action.targetRelativePath, {
          kind: "delete",
          allowRaw: action.allowRaw,
        }),
    });
  }

  private async rollbackAppliedActions(): Promise<void> {
    for (const action of [...this.record.actions].reverse()) {
      if (
        (action.kind === "delete" || action.kind === "text_write")
        && action.expectedTargetReceipt
        && await this.restoreExpectedTargetFromBackup(action)
      ) {
        action.state = "rolled_back";
        action.rolledBackAt = nowIso();
        continue;
      }

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
        if (
          action.allowArchivedIntegrationIngestAmendment &&
          action.baseContentReceipt &&
          action.originalSize !== undefined &&
          await createArchivedIntegrationIngestShardContentReceipt(
            this.vaultRoot,
            action.targetRelativePath,
          )
        ) {
          await truncateArchivedIntegrationIngestShard({
            expectedBaseByteLength: action.originalSize,
            expectedBaseSha256: action.baseContentReceipt.sha256,
            targetRelativePath: action.targetRelativePath,
            vaultRoot: this.vaultRoot,
          });
        } else if (!action.existedBefore) {
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
