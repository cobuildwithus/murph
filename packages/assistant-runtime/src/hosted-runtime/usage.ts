import {
  deletePendingAssistantUsageRecord,
  listPendingAssistantUsageRecords,
  resolveAssistantUsageCredentialSource,
} from "@murph/runtime-state";
import { resolveHostedExecutionAiUsageClient } from "@murph/hosted-execution";

export interface HostedPendingAssistantUsageExportResult {
  exported: number;
  failed: number;
  pending: number;
}

const HOSTED_USAGE_EXPORT_BATCH_LIMIT = 50;

export async function exportHostedPendingAssistantUsage(input: {
  baseUrl: string | null;
  fetchImpl?: typeof fetch;
  internalToken: string | null;
  timeoutMs: number | null;
  userId: string;
  userEnvKeys?: readonly string[];
  vaultRoot: string;
}): Promise<HostedPendingAssistantUsageExportResult> {
  const pendingRecords = await listPendingAssistantUsageRecords({
    vault: input.vaultRoot,
  });

  if (!input.baseUrl || pendingRecords.length === 0) {
    return {
      exported: 0,
      failed: 0,
      pending: pendingRecords.length,
    };
  }

  let exported = 0;
  let failed = 0;
  const client = resolveHostedExecutionAiUsageClient({
    baseUrl: input.baseUrl,
    boundUserId: input.userId,
    fetchImpl: input.fetchImpl,
    internalToken: input.internalToken,
    timeoutMs: input.timeoutMs,
  });

  if (!client) {
    console.warn(
      `Hosted AI usage export is not configured for the current bound user; leaving ${pendingRecords.length} records pending.`,
    );

    return {
      exported: 0,
      failed: pendingRecords.length,
      pending: pendingRecords.length,
    };
  }

  for (const batch of chunkPendingUsageRecords(pendingRecords, HOSTED_USAGE_EXPORT_BATCH_LIMIT)) {
    try {
      const response = await client.recordUsage(
        batch.map((record): Record<string, unknown> =>
          record.credentialSource === null
            ? {
                ...record,
                credentialSource: resolveAssistantUsageCredentialSource({
                  apiKeyEnv: record.apiKeyEnv,
                  provider: record.provider,
                  userEnvKeys: input.userEnvKeys ?? [],
                }),
              }
            : {
                ...record,
              }
        ),
      );

      const batchUsageIds = new Set(batch.map((record) => record.usageId));
      const acknowledgedUsageIds = response.usageIds.filter((usageId) => batchUsageIds.has(usageId));

      if (acknowledgedUsageIds.length !== batch.length) {
        failed += batch.length - acknowledgedUsageIds.length;
        console.warn(
          `Hosted AI usage export acknowledged ${acknowledgedUsageIds.length} of ${batch.length} records; leaving the remainder pending.`,
        );
      }

      for (const usageId of acknowledgedUsageIds) {
        await deletePendingAssistantUsageRecord({
          usageId,
          vault: input.vaultRoot,
        });
      }
      exported += acknowledgedUsageIds.length;
    } catch (error) {
      failed += batch.length;
      console.warn(
        `Failed to export hosted AI usage batch of ${batch.length} records: ${error instanceof Error ? error.message : String(error)}`,
      );
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
