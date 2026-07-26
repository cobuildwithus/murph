import type {
  AssistantProviderUsageDraft,
} from "@murphai/assistant-engine/assistant-ask";
import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  parseAssistantUsageRecord,
  type AssistantUsageCredentialSource,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";

export interface HostedStandaloneAssistantUsageAttribution {
  credentialSource: AssistantUsageCredentialSource;
  featureKey: string;
  surface: string;
  triggerKind: string;
}

export function buildHostedStandaloneAssistantUsageRecord(input: {
  attemptCount: number;
  attribution: HostedStandaloneAssistantUsageAttribution;
  memberId: string;
  occurredAt: string;
  providerUsage: AssistantProviderUsageDraft;
  sessionId: string;
  turnId: string;
}): AssistantUsageRecord {
  const usage = input.providerUsage.usage;
  return parseAssistantUsageRecord({
    apiKeyEnv: usage.apiKeyEnv,
    attemptCount: input.attemptCount,
    baseUrl: usage.baseUrl,
    cacheWriteTokens: usage.cacheWriteTokens,
    cachedInputTokens: usage.cachedInputTokens,
    credentialSource: input.attribution.credentialSource,
    featureKey: input.attribution.featureKey,
    gatewayTags: [],
    inputTokens: usage.inputTokens,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    outputTokens: usage.outputTokens,
    provider: input.providerUsage.provider,
    providerName: usage.providerName,
    providerRequestId: usage.providerRequestId,
    providerRequestOrdinal: input.providerUsage.providerRequestOrdinal,
    providerRequestOutcome:
      input.providerUsage.providerRequestOutcome ?? "succeeded",
    rawUsageJson: usage.rawUsageJson,
    rawUsageJsonHash: usage.rawUsageJsonHash,
    reasoningTokens: usage.reasoningTokens,
    reportingUserId: null,
    requestedModel: usage.requestedModel,
    routeId: null,
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: usage.servedModel,
    sessionId: input.sessionId,
    stripeMeterSource: "murph",
    surface: input.attribution.surface,
    tokenPricingBasis: usage.tokenPricingBasis,
    totalTokens: usage.totalTokens,
    triggerKind: input.attribution.triggerKind,
    turnId: input.turnId,
    turnProfileJson: usage.turnProfileJson,
    usageId: createAssistantUsageId({
      attemptCount: input.attemptCount,
      providerRequestOrdinal: input.providerUsage.providerRequestOrdinal,
      turnId: input.turnId,
    }),
    usageExtractionSourcePath: usage.usageExtractionSourcePath,
    usageExtractionVersion: usage.usageExtractionVersion,
  });
}
