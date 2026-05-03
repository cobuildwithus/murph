import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  resolveAssistantUsageCredentialSource,
  type AssistantProviderRequestOutcome,
  writePendingAssistantUsageRecord,
} from '@murphai/runtime-state/node'
import type {
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { CodexThreadIdentity } from './provider-route.js'
import type { AssistantProviderUsage } from './providers/types.js'
import type { AssistantUsageAttribution } from './usage-attribution.js'
import type { AssistantExecutionContext } from './execution-context.js'
import { normalizeNullableString } from './shared.js'

export interface AssistantUsageProviderResult {
  attemptCount: number
  provider: string
  providerOptions: AssistantProviderSessionOptions
  route: CodexThreadIdentity
  session: AssistantSession
  usage?: AssistantProviderUsage | null
  usageAttribution?: AssistantUsageAttribution | null
}

export async function persistPendingAssistantUsageEvent(input: {
  executionContext: AssistantExecutionContext
  providerRequestOutcome?: AssistantProviderRequestOutcome
  providerRequestOrdinal?: number
  providerResult: AssistantUsageProviderResult
  turnId: string
  vault: string
}): Promise<void> {
  const usage = input.providerResult.usage
  const hostedMemberId = normalizeNullableString(input.executionContext.hosted?.memberId)
  const apiKeyEnv = normalizeNullableString(usage?.apiKeyEnv)
  const usageAttribution = input.providerResult.usageAttribution ?? null

  if (!usage || !hostedMemberId) {
    return
  }

  await writePendingAssistantUsageRecord({
    vault: input.vault,
    record: {
      schema: ASSISTANT_USAGE_SCHEMA,
      usageId: createAssistantUsageId({
        attemptCount: input.providerResult.attemptCount,
        providerRequestOrdinal: input.providerRequestOrdinal ?? 0,
        turnId: input.turnId,
      }),
      memberId: hostedMemberId,
      sessionId: input.providerResult.session.sessionId,
      turnId: input.turnId,
      attemptCount: input.providerResult.attemptCount,
      providerRequestOrdinal: input.providerRequestOrdinal ?? 0,
      occurredAt: new Date().toISOString(),
      provider: input.providerResult.provider,
      routeId: input.providerResult.route.routeId,
      requestedModel: usage.requestedModel ?? input.providerResult.providerOptions.model,
      servedModel: usage.servedModel ?? null,
      providerName: normalizeNullableString(usage.providerName),
      providerRequestOutcome: input.providerRequestOutcome ?? 'succeeded',
      baseUrl: normalizeNullableString(usage.baseUrl),
      apiKeyEnv,
      credentialSource: usageAttribution?.credentialSource ?? resolveAssistantUsageCredentialSource({
        apiKeyEnv,
        headers: input.providerResult.providerOptions.headers ?? null,
        provider: input.providerResult.provider,
        userEnvKeys: [...(input.executionContext.hosted?.userEnvKeys ?? [])],
      }),
      featureKey: usageAttribution?.featureKey ?? null,
      gatewayTags: [...(usageAttribution?.gatewayTags ?? [])],
      reportingUserId: usageAttribution?.reportingUserId ?? null,
      surface: usageAttribution?.surface ?? null,
      stripeMeterSource: usageAttribution?.stripeMeterSource ?? 'murph',
      triggerKind: usageAttribution?.triggerKind ?? null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      providerRequestId: normalizeNullableString(usage.providerRequestId),
      rawUsageJson: normalizeAssistantProviderRawUsageRecord(usage.rawUsageJson),
      rawUsageJsonHash: normalizeNullableString(usage.rawUsageJsonHash),
      usageExtractionSourcePath: normalizeNullableString(usage.usageExtractionSourcePath),
      usageExtractionVersion: normalizeNullableString(usage.usageExtractionVersion) ?? 'unknown',
      totalTokens: usage.totalTokens,
    },
  })
}

function normalizeAssistantProviderRawUsageRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const serialized = JSON.stringify(value)

  if (serialized === undefined) {
    return null
  }

  const normalized: unknown = JSON.parse(serialized)

  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return null
  }

  return normalized as Record<string, unknown>
}
