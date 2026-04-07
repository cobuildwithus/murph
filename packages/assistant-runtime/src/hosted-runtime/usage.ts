import {
  deletePendingAssistantUsageRecord,
  listPendingAssistantUsageRecords,
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
  pending: number;
}

const HOSTED_USAGE_EXPORT_BATCH_LIMIT = 50;

export async function exportHostedPendingAssistantUsage(input: {
  usageExportPort?: HostedRuntimeUsageExportPort | null;
  vaultRoot: string;
}): Promise<HostedPendingAssistantUsageExportResult> {
  const pendingRecords = await listPendingAssistantUsageRecords({
    vault: input.vaultRoot,
  });

  if (!input.usageExportPort || pendingRecords.length === 0) {
    return {
      exported: 0,
      failed: 0,
      pending: pendingRecords.length,
    };
  }

  let exported = 0;
  let failed = 0;

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
    pending: pendingRecords.length - exported,
  };
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

  const batchUsageIds = new Set(input.batch.map((record) => record.usageId));
  const acknowledgedUsageIds = response.usageIds.filter((usageId) => batchUsageIds.has(usageId));
  const failed = input.batch.length - acknowledgedUsageIds.length;

  if (failed > 0) {
    console.warn(
      `Hosted AI usage export acknowledged ${acknowledgedUsageIds.length} of ${input.batch.length} records; leaving the remainder pending.`,
    );
  }

  for (const usageId of acknowledgedUsageIds) {
    await deletePendingAssistantUsageRecord({
      usageId,
      vault: input.vaultRoot,
    });
  }

  return {
    exported: acknowledgedUsageIds.length,
    failed,
  };
}
