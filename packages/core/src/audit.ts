import type {
  AuditAction,
  AuditActor,
  AuditRecord,
  AuditStatus,
  ErrorCodeValue,
  FileChangeOperation,
} from "@murphai/contracts";

import {
  AUDIT_ACTORS,
  AUDIT_SCHEMA_VERSION,
  AUDIT_STATUSES,
  FILE_CHANGE_OPERATIONS,
  ID_PREFIXES,
  VAULT_LAYOUT,
} from "./constants.ts";
import { generateRecordId } from "./ids.ts";
import { appendJsonlRecord, toMonthlyShardRelativePath } from "./jsonl.ts";
import type { WriteBatch } from "./operations/write-batch.ts";
import { normalizeRelativeVaultPath } from "./path-safety.ts";
import { toIsoTimestamp } from "./time.ts";

import type { DateInput, FileChange } from "./types.ts";

type AuditChange = AuditRecord["changes"][number];

interface EmitAuditRecordInput {
  vaultRoot: string;
  action: AuditAction;
  actor?: AuditActor;
  status?: AuditStatus;
  occurredAt?: DateInput;
  commandName?: string;
  summary?: string;
  files?: string[];
  targetIds?: string[];
  errorCode?: ErrorCodeValue;
  changes?: Array<FileChange | null | undefined>;
  batch?: WriteBatch;
}

interface BuildAuditRecordInput extends Omit<EmitAuditRecordInput, "vaultRoot"> {}

const AUDIT_ACTOR_SET = new Set<AuditActor>(AUDIT_ACTORS as readonly AuditActor[]);
const AUDIT_STATUS_SET = new Set<AuditStatus>(AUDIT_STATUSES as readonly AuditStatus[]);
const FILE_CHANGE_OPERATION_SET = new Set<FileChangeOperation>(
  FILE_CHANGE_OPERATIONS as readonly FileChangeOperation[],
);

function normalizeActor(actor: AuditActor | undefined): AuditActor {
  return actor && AUDIT_ACTOR_SET.has(actor) ? actor : "core";
}

function normalizeStatus(status: AuditStatus | undefined): AuditStatus {
  return status && AUDIT_STATUS_SET.has(status) ? status : "success";
}

function normalizeOperation(op: string | undefined): FileChangeOperation {
  return op && FILE_CHANGE_OPERATION_SET.has(op as FileChangeOperation)
    ? (op as FileChangeOperation)
    : "update";
}

function normalizeChanges(
  changes: Array<FileChange | null | undefined> | undefined,
  files: string[],
): AuditChange[] {
  if (Array.isArray(changes)) {
    return changes
      .map((change) => {
        if (!change || typeof change !== "object") {
          return null;
        }

        if (typeof change.path !== "string" || !change.path.trim()) {
          return null;
        }

        return {
          path: normalizeRelativeVaultPath(change.path),
          op: normalizeOperation(change.op),
        } satisfies AuditChange;
      })
      .filter((change): change is AuditChange => change !== null);
  }

  return [...new Set(files.map((file) => normalizeRelativeVaultPath(file)))]
    .sort()
    .map((path) => ({
      path,
      op: "update",
    }));
}

export async function emitAuditRecord({
  vaultRoot,
  action,
  actor = "core",
  status = "success",
  occurredAt = new Date(),
  commandName,
  summary,
  files = [],
  targetIds = [],
  errorCode,
  changes,
  batch,
}: EmitAuditRecordInput): Promise<{ relativePath: string; record: AuditRecord }> {
  const record = buildAuditRecord({
    action,
    actor,
    status,
    occurredAt,
    commandName,
    summary,
    files,
    targetIds,
    errorCode,
    changes,
  });
  const relativePath = resolveAuditShardPath(record.occurredAt);

  const payload = `${JSON.stringify(record)}\n`;

  if (batch) {
    await batch.stageJsonlAppend(relativePath, payload);
  } else {
    await appendJsonlRecord({
      vaultRoot,
      relativePath,
      record,
    });
  }

  return {
    relativePath,
    record,
  };
}

export function resolveAuditShardPath(occurredAt: DateInput | string): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.auditDirectory,
    occurredAt,
    "occurredAt",
  );
}

export function buildAuditRecord({
  action,
  actor = "core",
  status = "success",
  occurredAt = new Date(),
  commandName,
  summary,
  files = [],
  targetIds = [],
  errorCode,
  changes,
}: BuildAuditRecordInput): AuditRecord {
  const occurredTimestamp = toIsoTimestamp(occurredAt, "occurredAt");
  const normalizedChanges = normalizeChanges(changes, files);

  return {
    schemaVersion: "murph.audit.v1",
    id: generateRecordId(ID_PREFIXES.audit),
    action,
    status: normalizeStatus(status),
    occurredAt: occurredTimestamp,
    actor: normalizeActor(actor),
    commandName: String(commandName ?? action),
    summary: String(summary ?? action),
    targetIds: targetIds.length > 0 ? [...targetIds] : undefined,
    errorCode,
    changes: normalizedChanges,
  };
}
