import {
  deletePendingAssistantUsageRecord,
  listPendingAssistantUsageRecords,
  type AssistantUsageCredentialSource,
} from "@murph/runtime-state";
import { recordHostedExecutionAiUsage } from "@murph/hosted-execution";

export interface HostedPendingAssistantUsageExportResult {
  exported: number;
  failed: number;
  pending: number;
}

export async function exportHostedPendingAssistantUsage(input: {
  baseUrl: string | null;
  fetchImpl?: typeof fetch;
  internalToken: string | null;
  timeoutMs: number | null;
  userEnv: Readonly<Record<string, string>>;
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

  for (const record of pendingRecords) {
    const enrichedRecord = {
      ...record,
      credentialSource: resolveHostedAssistantUsageCredentialSource({
        apiKeyEnv: record.apiKeyEnv,
        userEnv: input.userEnv,
      }),
    };

    try {
      await recordHostedExecutionAiUsage({
        baseUrl: input.baseUrl,
        fetchImpl: input.fetchImpl,
        internalToken: input.internalToken,
        timeoutMs: input.timeoutMs,
        usage: [enrichedRecord as Record<string, unknown>],
      });
      await deletePendingAssistantUsageRecord({
        usageId: record.usageId,
        vault: input.vaultRoot,
      });
      exported += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        `Failed to export hosted AI usage ${record.usageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    exported,
    failed,
    pending: pendingRecords.length - exported,
  };
}

function resolveHostedAssistantUsageCredentialSource(input: {
  apiKeyEnv: string | null;
  userEnv: Readonly<Record<string, string>>;
}): AssistantUsageCredentialSource {
  if (!input.apiKeyEnv) {
    return "platform";
  }

  return Object.prototype.hasOwnProperty.call(input.userEnv, input.apiKeyEnv)
    ? "member"
    : "platform";
}
