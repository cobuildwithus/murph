import type { AssistantModelSpec } from '../model-harness.js'
import {
  isAssistantLocalDevelopmentBaseUrl,
  isAssistantVercelAIGatewayBaseUrl,
  readAssistantEnvString,
} from '@murphai/operator-config/assistant/shared'
import {
  normalizeAssistantProviderConfig,
  normalizeAssistantGatewayOnlyProviders,
  resolveAssistantProviderRuntimeTarget,
  type AssistantProviderConfigLike,
} from '@murphai/operator-config/assistant/provider-config'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

export function resolveAssistantModelSpecFromProviderConfig(
  input: AssistantProviderConfigLike | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AssistantModelSpec | null {
  const normalized = normalizeAssistantProviderConfig(input)
  if (normalized.target.kind === 'codex-cli') {
    return null
  }

  const resolvedRuntimeTarget = resolveAssistantProviderRuntimeTarget(normalized)
  const model = normalizeNullableString(normalized.target.model)
  if (!model) {
    return null
  }

  const baseUrl = normalizeNullableString(normalized.target.baseUrl)
  if (!baseUrl && resolvedRuntimeTarget.executionDriver !== 'responses') {
    return null
  }

  const apiKeyEnv = normalizeNullableString(normalized.target.apiKeyEnv)
  const apiKeyValue = readAssistantEnvString(env, apiKeyEnv) ?? undefined
  const explicitEnvSnapshot =
    env !== process.env && typeof apiKeyEnv === 'string' && apiKeyEnv.length > 0
  const responsesRequestPolicy = resolveAssistantResponsesRequestPolicy(normalized)

  return {
    ...(baseUrl ? { baseUrl } : {}),
    executionDriver: resolvedRuntimeTarget.executionDriver,
    model,
    ...(apiKeyValue ? { apiKey: apiKeyValue } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(explicitEnvSnapshot ? { apiKeyEnvValue: apiKeyValue ?? null } : {}),
    ...(normalized.target.headers ? { headers: normalized.target.headers } : {}),
    ...(normalized.target.providerName
      ? { providerName: normalized.target.providerName }
      : {}),
    ...(responsesRequestPolicy ? { responsesRequestPolicy } : {}),
  }
}

function resolveAssistantResponsesRequestPolicy(
  input: ReturnType<typeof normalizeAssistantProviderConfig>,
): AssistantModelSpec['responsesRequestPolicy'] {
  if (
    input.target.kind !== 'responses' ||
    input.target.via !== 'vercel-ai-gateway' ||
    (
      !isAssistantVercelAIGatewayBaseUrl(input.target.baseUrl) &&
      !isAssistantLocalDevelopmentBaseUrl(input.target.baseUrl)
    )
  ) {
    return undefined
  }

  const gatewayOnlyProviders = normalizeAssistantGatewayOnlyProviders(
    input.target.gatewayOnlyProviders,
  )
  const policy: NonNullable<AssistantModelSpec['responsesRequestPolicy']> = {
    ...(gatewayOnlyProviders ? { gatewayOnlyProviders } : {}),
    ...(input.policy.zeroDataRetention === true
      ? { gatewayZeroDataRetention: true }
      : {}),
  }

  return Object.keys(policy).length > 0 ? policy : undefined
}
