import {
  deletePendingAssistantUsageRecord,
  ASSISTANT_RUNTIME_ISSUE_SCHEMA,
  createAssistantRuntimeIssueFingerprint,
  listPendingAssistantRuntimeIssueRecords,
  listPendingAssistantUsageRecords,
  writePendingAssistantRuntimeIssueRecord,
} from "@murphai/runtime-state/node";
import {
  summarizeHostedExecutionError,
} from "@murphai/hosted-execution";

import type {
  HostedRuntimeUsageExportPort,
} from "./platform.ts";

export interface HostedPendingAssistantUsageExportResult {
  exported: number;
  failed: number;
  invalid: number;
  invalidIssueRecorded: boolean;
  pending: number;
}

const HOSTED_USAGE_EXPORT_BATCH_LIMIT = 50;

export async function exportHostedPendingAssistantUsage(input: {
  now?: () => string;
  usageExportPort?: HostedRuntimeUsageExportPort | null;
  vaultRoot: string;
}): Promise<HostedPendingAssistantUsageExportResult> {
  let invalidPendingRecordCount = 0;
  const pendingRecords = await listPendingAssistantUsageRecords({
    onInvalidRecord: ({ error }) => {
      invalidPendingRecordCount += 1;
      console.warn(
        "Skipping malformed pending assistant usage file; leaving it pending.",
        {
          errorName: error instanceof Error ? error.name : typeof error,
        },
      );
    },
    skipInvalidRecords: true,
    vault: input.vaultRoot,
  });
  const totalPendingRecords = pendingRecords.length + invalidPendingRecordCount;
  const invalidIssueRecorded = await writeHostedMalformedUsageRuntimeIssueBestEffort({
    invalidPendingRecordCount,
    now: input.now,
    vaultRoot: input.vaultRoot,
  });

  if (!input.usageExportPort || pendingRecords.length === 0) {
    return {
      exported: 0,
      failed: input.usageExportPort ? invalidPendingRecordCount : 0,
      invalid: invalidPendingRecordCount,
      invalidIssueRecorded,
      pending: totalPendingRecords,
    };
  }

  let exported = 0;
  let failed = invalidPendingRecordCount;

  for (const batch of chunkPendingUsageRecords(pendingRecords, HOSTED_USAGE_EXPORT_BATCH_LIMIT)) {
    try {
      const result = await exportHostedUsageBatch({
        batch,
        usageExportPort: input.usageExportPort,
        vaultRoot: input.vaultRoot,
      });
      exported += result.exported;
      failed += result.failed;
    } catch (error) {
      const message = summarizeHostedExecutionError(error);

      if (batch.length === 1) {
        failed += 1;
        console.warn(`Failed to export hosted AI usage batch of 1 record: ${message}`);
        continue;
      }

      console.warn(
        `Failed to export hosted AI usage batch of ${batch.length} records; retrying each record individually: ${message}`,
      );

      for (const record of batch) {
        try {
          const result = await exportHostedUsageBatch({
            batch: [record],
            usageExportPort: input.usageExportPort,
            vaultRoot: input.vaultRoot,
          });
          exported += result.exported;
          failed += result.failed;
        } catch (singleError) {
          failed += 1;
          console.warn(
            `Failed to export hosted AI usage retry for 1 record: ${summarizeHostedExecutionError(singleError)}`,
          );
        }
      }
    }
  }

  return {
    exported,
    failed,
    invalid: invalidPendingRecordCount,
    invalidIssueRecorded,
    pending: totalPendingRecords - exported,
  };
}

async function writeHostedMalformedUsageRuntimeIssueBestEffort(input: {
  invalidPendingRecordCount: number;
  now?: () => string;
  vaultRoot: string;
}): Promise<boolean> {
  if (input.invalidPendingRecordCount === 0) {
    return false;
  }

  try {
    const fingerprint = createAssistantRuntimeIssueFingerprint({
      component: "hosted.usage_export",
      errorCode: "pending_usage_invalid",
      issueKind: "schema_rejection",
      operation: "pending_usage_export",
      phase: "hosted_commit",
      summary: "Assistant runtime issue: schema rejection during hosted_commit (pending_usage_export).",
    });
    const issueId = `ari_${fingerprint.slice(0, 16)}_${fingerprint}`;
    const existingIssues = await listPendingAssistantRuntimeIssueRecords({
      skipInvalidRecords: true,
      vault: input.vaultRoot,
    });
    if (existingIssues.some((issue) => issue.issueId === issueId)) {
      return false;
    }

    await writePendingAssistantRuntimeIssueRecord({
      record: {
        component: "hosted.usage_export",
        details: {
          invalidPendingRecordCount: input.invalidPendingRecordCount,
        },
        environment: "hosted",
        errorCode: "pending_usage_invalid",
        fingerprint,
        issueId,
        issueKind: "schema_rejection",
        occurredAt: input.now?.() ?? new Date().toISOString(),
        operation: "pending_usage_export",
        phase: "hosted_commit",
        schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
        severity: "warning",
        summary: "Assistant runtime issue: schema rejection during hosted_commit (pending_usage_export).",
        surface: null,
      },
      vault: input.vaultRoot,
    });

    return true;
  } catch (error) {
    console.warn("Failed to record malformed hosted AI usage runtime issue.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

function chunkPendingUsageRecords<T>(records: readonly T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < records.length; index += size) {
    batches.push(records.slice(index, index + size));
  }

  return batches;
}

async function exportHostedUsageBatch(input: {
  batch: readonly Awaited<ReturnType<typeof listPendingAssistantUsageRecords>>[number][];
  usageExportPort: HostedRuntimeUsageExportPort;
  vaultRoot: string;
}): Promise<{ exported: number; failed: number }> {
  const response = await input.usageExportPort.recordUsage(input.batch);
  if (response.recorded !== response.usageIds.length) {
    throw new TypeError("Hosted AI usage export response recorded count does not match usageIds.");
  }

  const batchUsageIds = new Set(input.batch.map((record) => record.usageId));
  const acknowledgedUsageIds = new Set(
    response.usageIds.filter((usageId) => batchUsageIds.has(usageId)),
  );
  let failed = input.batch.length - acknowledgedUsageIds.size;
  let exported = 0;

  if (failed > 0) {
    console.warn(
      `Hosted AI usage export acknowledged ${acknowledgedUsageIds.size} of ${input.batch.length} records; leaving the remainder pending.`,
    );
  }

  for (const usageId of acknowledgedUsageIds) {
    try {
      await deletePendingAssistantUsageRecord({
        usageId,
        vault: input.vaultRoot,
      });
      exported += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        "Failed to delete acknowledged hosted AI usage record; leaving it pending.",
        {
          errorName: error instanceof Error ? error.name : typeof error,
        },
      );
    }
  }

  return {
    exported,
    failed,
  };
}
