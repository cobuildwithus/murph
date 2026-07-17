import type { AuditAction } from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { runCanonicalWrite, type WriteBatch } from "./operations/write-batch.ts";

import type { DateInput, FileChange } from "./types.ts";

export interface CanonicalMutationAuditInput {
  action: AuditAction;
  commandName: string;
  summary: string;
  occurredAt?: DateInput;
  targetIds?: string[];
}

export interface AuditedCanonicalMutationResult<TResult> {
  result: TResult;
  files?: string[];
  changes?: Array<FileChange | null | undefined>;
  targetIds?: string[];
}

interface CommitAuditedCanonicalWriteInput<TResult> {
  vaultRoot: string;
  operationType: string;
  summary: string;
  occurredAt?: DateInput;
  assertCanContinue?: (() => void) | null;
  audit: CanonicalMutationAuditInput;
  mutate: (input: {
    batch: WriteBatch;
    vaultRoot: string;
  }) => Promise<AuditedCanonicalMutationResult<TResult>>;
}

export async function commitAuditedCanonicalWrite<TResult>({
  vaultRoot,
  operationType,
  summary,
  occurredAt,
  assertCanContinue,
  audit,
  mutate,
}: CommitAuditedCanonicalWriteInput<TResult>): Promise<{
  result: TResult;
  auditPath: string;
}> {
  const operationOccurredAt = occurredAt ?? audit.occurredAt;

  return runCanonicalWrite({
    vaultRoot,
    operationType,
    summary,
    occurredAt: operationOccurredAt,
    ...(assertCanContinue === undefined
      ? {}
      : { assertCanContinue }),
    mutate: async ({ batch, vaultRoot: lockedVaultRoot }) => {
      assertCanContinue?.();
      const outcome = await mutate({
        batch,
        vaultRoot: lockedVaultRoot,
      });
      assertCanContinue?.();
      const emittedAudit = await emitAuditRecord({
        vaultRoot: lockedVaultRoot,
        batch,
        action: audit.action,
        commandName: audit.commandName,
        summary: audit.summary,
        occurredAt: audit.occurredAt ?? operationOccurredAt,
        files: outcome.files,
        changes: outcome.changes,
        targetIds: outcome.targetIds ?? audit.targetIds ?? [],
      });
      assertCanContinue?.();

      return {
        result: outcome.result,
        auditPath: emittedAudit.relativePath,
      };
    },
  });
}
