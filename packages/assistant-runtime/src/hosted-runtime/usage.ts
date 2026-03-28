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

const HOSTED_MEMBER_AI_CREDENTIAL_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "TOGETHER_API_KEY",
  "XAI_API_KEY",
]);

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
        provider: record.provider,
        userEnv: input.userEnv,
      }),
    };

    try {
      const response = await recordHostedExecutionAiUsage({
        baseUrl: input.baseUrl,
        fetchImpl: input.fetchImpl,
        internalToken: input.internalToken,
        timeoutMs: input.timeoutMs,
        usage: [enrichedRecord as Record<string, unknown>],
      });

      if (response.recorded < 1 || !response.usageIds.includes(record.usageId)) {
        failed += 1;
        console.warn(
          `Hosted AI usage export did not acknowledge ${record.usageId}; leaving the pending record in place.`,
        );
        continue;
      }

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
  provider: string;
  userEnv: Readonly<Record<string, string>>;
}): AssistantUsageCredentialSource {
  if (!input.apiKeyEnv) {
    if (input.provider === "codex-cli" && hasHostedMemberAiCredential(input.userEnv)) {
      return "unknown";
    }

    return "platform";
  }

  return Object.prototype.hasOwnProperty.call(input.userEnv, input.apiKeyEnv)
    ? "member"
    : "platform";
}

function hasHostedMemberAiCredential(userEnv: Readonly<Record<string, string>>): boolean {
  return Object.keys(userEnv).some((key) => HOSTED_MEMBER_AI_CREDENTIAL_ENV_KEYS.has(key));
}
