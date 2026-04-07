import type { AssistantModelSpec } from '../model-harness.js'
import {
  readAssistantEnvString,
} from '@murphai/operator-config/assistant/shared'
import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

export * from '@murphai/operator-config/assistant/provider-config'

export function resolveAssistantModelSpecFromProviderConfig(
  input: AssistantProviderConfigInput | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AssistantModelSpec | null {
  const normalized = normalizeAssistantProviderConfig(input)
  if (normalized.provider !== 'openai-compatible') {
    return null
  }

  const model = normalizeNullableString(normalized.model)
  const baseUrl = normalizeNullableString(normalized.baseUrl)
  if (!model || !baseUrl) {
    return null
  }

  const apiKeyEnv = normalizeNullableString(normalized.apiKeyEnv)
  const apiKeyValue = readAssistantEnvString(env, apiKeyEnv) ?? undefined

  return {
    baseUrl,
    model,
    ...(apiKeyValue ? { apiKey: apiKeyValue } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(normalized.headers ? { headers: normalized.headers } : {}),
    ...(normalized.providerName ? { providerName: normalized.providerName } : {}),
  }
}
