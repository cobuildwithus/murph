import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfigLike,
} from '@murphai/operator-config/assistant/provider-config'

export function resolveAssistantModelSpecFromProviderConfig(
  input: AssistantProviderConfigLike | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): null {
  void env
  normalizeAssistantProviderConfig(input)
  return null
}
