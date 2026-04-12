import type { AssistantModelSpec } from '../model-harness.js'
import { readAssistantEnvString } from '@murphai/operator-config/assistant/shared'
import {
  normalizeAssistantProviderConfig,
  resolveAssistantProviderRuntimeTarget,
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

export function resolveAssistantModelSpecFromProviderConfig(
  input: AssistantProviderConfigInput | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AssistantModelSpec | null {
  const normalized = normalizeAssistantProviderConfig(input)
  if (normalized.provider !== 'openai-compatible') {
    return null
  }

  const resolvedRuntimeTarget = resolveAssistantProviderRuntimeTarget(normalized)
  const model = normalizeNullableString(normalized.model)
  if (!model) {
    return null
  }

  const baseUrl = normalizeNullableString(normalized.baseUrl)
  if (
    !baseUrl &&
    resolvedRuntimeTarget.executionDriver !== 'gateway' &&
    resolvedRuntimeTarget.executionDriver !== 'openai-responses'
  ) {
    return null
  }

  const apiKeyEnv = normalizeNullableString(normalized.apiKeyEnv)
  const apiKeyValue = readAssistantEnvString(env, apiKeyEnv) ?? undefined

  return {
    ...(baseUrl ? { baseUrl } : {}),
    executionDriver: resolvedRuntimeTarget.executionDriver,
    model,
    ...(apiKeyValue ? { apiKey: apiKeyValue } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(normalized.headers ? { headers: normalized.headers } : {}),
    ...(normalized.providerName ? { providerName: normalized.providerName } : {}),
  }
}
