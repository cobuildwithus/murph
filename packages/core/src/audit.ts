import type {
  AuditAction,
  AuditActor,
  AuditRecord,
  AuditStatus,
  ErrorCodeValue,
  FileChangeOperation,
} from "@healthybob/contracts";

import {
  AUDIT_ACTORS,
  AUDIT_SCHEMA_VERSION,
  AUDIT_STATUSES,
  FILE_CHANGE_OPERATIONS,
  ID_PREFIXES,
  VAULT_LAYOUT,
} from "./constants.js";
import { generateRecordId } from "./ids.js";
import { appendJsonlRecord, toMonthlyShardRelativePath } from "./jsonl.js";
import { normalizeRelativeVaultPath } from "./path-safety.js";
import { toIsoTimestamp } from "./time.js";

import type { DateInput, FileChange } from "./types.js";

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
}

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
}: EmitAuditRecordInput): Promise<{ relativePath: string; record: AuditRecord }> {
  const occurredTimestamp = toIsoTimestamp(occurredAt, "occurredAt");
  const normalizedChanges = normalizeChanges(changes, files);

  const record: AuditRecord = {
    schemaVersion: "hb.audit.v1",
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

  const relativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.auditDirectory,
    occurredTimestamp,
    "occurredAt",
  );

  await appendJsonlRecord({
    vaultRoot,
    relativePath,
    record,
  });

  return {
    relativePath,
    record,
  };
}
