import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  resolveAssistantUsageCredentialSource,
  type AssistantProviderRequestOutcome,
  type AssistantUsageRecord,
} from '@murphai/hosted-execution/assistant-usage'
import type {
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from './codex-thread-route.js'
import type {
  AssistantProviderUsage,
  AssistantProviderUsageDraft,
} from './providers/types.js'
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

export async function recordAssistantUsageEvent(input: {
  executionContext: AssistantExecutionContext
  providerRequestOutcome?: AssistantProviderRequestOutcome
  providerRequestOrdinal?: number
  providerResult: AssistantUsageProviderResult
  turnId: string
}): Promise<void> {
  const usage = input.providerResult.usage
  const hostedMemberId = normalizeNullableString(input.executionContext.hosted?.memberId)
  const usageRecorder = input.executionContext.hosted?.usageRecorder ?? null
  const apiKeyEnv = normalizeNullableString(usage?.apiKeyEnv)
  const usageAttribution = input.providerResult.usageAttribution ?? null

  if (!usage || !hostedMemberId || !usageRecorder) {
    return
  }

  try {
    const record: AssistantUsageRecord = {
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
      routeId: readCodexThreadRouteFingerprint(input.providerResult.route),
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
      turnProfileJson: usage.turnProfileJson ?? null,
    }

    void usageRecorder.recordUsage(record).catch((error: unknown) => {
      warnAssistantUsageRecordingFailure(error)
    })
  } catch (error) {
    warnAssistantUsageRecordingFailure(error)
  }
}

export async function recordAdditionalAssistantUsageEvents(input: {
  additionalUsages: readonly AssistantProviderUsageDraft[] | null | undefined
  effectiveEnv: Readonly<Record<string, string | undefined>>
  executionContext: AssistantExecutionContext
  providerResult: AssistantUsageProviderResult
  turnId: string
}): Promise<void> {
  const baseAttribution = input.providerResult.usageAttribution ?? null
  for (const usageDraft of input.additionalUsages ?? []) {
    // Additional usages can run on a different credential than the primary
    // provider turn (for example platform-owned OpenAI Images on a
    // member-credential Codex turn), so resolve credential source per draft
    // with the same effective-env rule the primary attribution uses: a key
    // env that is listed but unset/empty attributes as platform, not member.
    const usageAttribution = baseAttribution
      ? {
          ...baseAttribution,
          credentialSource: resolveAssistantUsageCredentialSource({
            apiKeyEnv: normalizeNullableString(usageDraft.usage.apiKeyEnv),
            effectiveEnv: input.effectiveEnv,
            headers: input.providerResult.providerOptions.headers ?? null,
            provider: usageDraft.provider,
            userEnvKeys: [...(input.executionContext.hosted?.userEnvKeys ?? [])],
          }),
        }
      : null
    await recordAssistantUsageEvent({
      executionContext: input.executionContext,
      providerRequestOrdinal: usageDraft.providerRequestOrdinal,
      providerRequestOutcome: usageDraft.providerRequestOutcome,
      providerResult: {
        ...input.providerResult,
        provider: usageDraft.provider,
        usage: usageDraft.usage,
        usageAttribution,
      },
      turnId: input.turnId,
    })
  }
}

function warnAssistantUsageRecordingFailure(error: unknown): void {
  console.warn('Assistant usage recording failed; continuing without retry.', {
    errorName: error instanceof Error ? error.name : typeof error,
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
