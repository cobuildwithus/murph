import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  resolveAssistantUsageCredentialSource,
  writePendingAssistantUsageRecord,
} from '@murph/runtime-state/node'
import type { ExecutedAssistantProviderTurnResult } from './service-contracts.js'
import { normalizeNullableString } from './shared.js'

export async function persistPendingAssistantUsageEvent(input: {
  providerResult: ExecutedAssistantProviderTurnResult
  turnId: string
  vault: string
}): Promise<void> {
  const usage = input.providerResult.usage
  const hostedMemberId = normalizeNullableString(process.env.HOSTED_MEMBER_ID)
  const apiKeyEnv = normalizeNullableString(
    usage?.apiKeyEnv ?? input.providerResult.providerOptions.apiKeyEnv,
  )

  if (!usage || !hostedMemberId) {
    return
  }

  await writePendingAssistantUsageRecord({
    vault: input.vault,
    record: {
      schema: ASSISTANT_USAGE_SCHEMA,
      usageId: createAssistantUsageId({
        attemptCount: input.providerResult.attemptCount,
        turnId: input.turnId,
      }),
      memberId: hostedMemberId,
      sessionId: input.providerResult.session.sessionId,
      turnId: input.turnId,
      attemptCount: input.providerResult.attemptCount,
      occurredAt: new Date().toISOString(),
      provider: input.providerResult.provider,
      routeId: input.providerResult.route.routeId,
      requestedModel: usage.requestedModel ?? input.providerResult.providerOptions.model,
      servedModel: usage.servedModel ?? null,
      providerName: normalizeNullableString(
        usage.providerName ?? input.providerResult.providerOptions.providerName,
      ),
      baseUrl: normalizeNullableString(
        usage.baseUrl ?? input.providerResult.providerOptions.baseUrl,
      ),
      apiKeyEnv,
      credentialSource: resolveAssistantUsageCredentialSource({
        apiKeyEnv,
        provider: input.providerResult.provider,
        userEnvKeys: readHostedUserEnvKeysFromProcessEnv(process.env),
      }),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      totalTokens: usage.totalTokens,
      providerSessionId: input.providerResult.providerSessionId,
      providerRequestId: usage.providerRequestId,
      providerMetadataJson: usage.providerMetadataJson,
      rawUsageJson: usage.rawUsageJson,
    },
  })
}

function readHostedUserEnvKeysFromProcessEnv(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const raw = normalizeNullableString(env.HOSTED_EXECUTION_USER_ENV_KEYS)

  if (!raw) {
    return []
  }

  return raw
    .split(',')
    .map((key) => normalizeNullableString(key))
    .filter((key): key is string => key !== null)
}
