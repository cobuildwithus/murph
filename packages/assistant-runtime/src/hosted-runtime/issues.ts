import {
  deletePendingAssistantRuntimeIssueRecord,
  listPendingAssistantRuntimeIssueRecords,
} from "@murphai/runtime-state/node";
import {
  summarizeHostedExecutionError,
} from "@murphai/hosted-execution";

import type {
  HostedRuntimeIssueExportPort,
} from "./platform.ts";

export interface HostedPendingAssistantIssueExportResult {
  exported: number;
  failed: number;
  pending: number;
}

const HOSTED_ISSUE_EXPORT_BATCH_LIMIT = 50;

export async function exportHostedPendingAssistantRuntimeIssues(input: {
  issueExportPort?: HostedRuntimeIssueExportPort | null;
  vaultRoot: string;
}): Promise<HostedPendingAssistantIssueExportResult> {
  let invalidPendingRecordCount = 0;
  const pendingRecords = await listPendingAssistantRuntimeIssueRecords({
    onInvalidRecord: ({ error, fileName }) => {
      invalidPendingRecordCount += 1;
      console.warn(
        `Skipping malformed pending assistant runtime issue file ${fileName}; leaving it pending: ${summarizeHostedExecutionError(error)}`,
      );
    },
    skipInvalidRecords: true,
    vault: input.vaultRoot,
  });
  const totalPendingRecords = pendingRecords.length + invalidPendingRecordCount;

  if (!input.issueExportPort || pendingRecords.length === 0) {
    return {
      exported: 0,
      failed: input.issueExportPort ? invalidPendingRecordCount : 0,
      pending: totalPendingRecords,
    };
  }

  let exported = 0;
  let failed = invalidPendingRecordCount;

  for (const batch of chunkPendingIssueRecords(pendingRecords, HOSTED_ISSUE_EXPORT_BATCH_LIMIT)) {
    try {
      const result = await exportHostedIssueBatch({
        batch,
        issueExportPort: input.issueExportPort,
        vaultRoot: input.vaultRoot,
      });
      exported += result.exported;
      failed += result.failed;
    } catch (error) {
      const message = summarizeHostedExecutionError(error);

      if (batch.length === 1) {
        failed += 1;
        console.warn(`Failed to export hosted assistant runtime issue batch of 1 record: ${message}`);
        continue;
      }

      console.warn(
        `Failed to export hosted assistant runtime issue batch of ${batch.length} records; retrying each record individually: ${message}`,
      );

      for (const record of batch) {
        try {
          const result = await exportHostedIssueBatch({
            batch: [record],
            issueExportPort: input.issueExportPort,
            vaultRoot: input.vaultRoot,
          });
          exported += result.exported;
          failed += result.failed;
        } catch (singleError) {
          failed += 1;
          console.warn(
            `Failed to export hosted assistant runtime issue retry for 1 record: ${summarizeHostedExecutionError(singleError)}`,
          );
        }
      }
    }
  }

  return {
    exported,
    failed,
    pending: totalPendingRecords - exported,
  };
}

function chunkPendingIssueRecords<T>(records: readonly T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < records.length; index += size) {
    batches.push(records.slice(index, index + size));
  }

  return batches;
}

async function exportHostedIssueBatch(input: {
  batch: readonly Awaited<ReturnType<typeof listPendingAssistantRuntimeIssueRecords>>[number][];
  issueExportPort: HostedRuntimeIssueExportPort;
  vaultRoot: string;
}): Promise<{ exported: number; failed: number }> {
  const response = await input.issueExportPort.recordIssues(input.batch);

  const batchIssueIds = new Set(input.batch.map((record) => record.issueId));
  const acknowledgedIssueIds = response.issueIds.filter((issueId) => batchIssueIds.has(issueId));
  const failed = input.batch.length - acknowledgedIssueIds.length;

  if (failed > 0) {
    console.warn(
      `Hosted assistant runtime issue export acknowledged ${acknowledgedIssueIds.length} of ${input.batch.length} records; leaving the remainder pending.`,
    );
  }

  for (const issueId of acknowledgedIssueIds) {
    await deletePendingAssistantRuntimeIssueRecord({
      issueId,
      vault: input.vaultRoot,
    });
  }

  return {
    exported: acknowledgedIssueIds.length,
    failed,
  };
}
