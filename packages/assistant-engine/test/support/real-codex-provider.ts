import { HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID, OPENAI_CODEX_MODEL_PROVIDER_CONFIG } from '@murphai/operator-config/assistant/target-runtime'

// Only fixture-owned provider metadata crosses config isolation. The credential
// value remains in the existing process environment, never in generated config.
export interface RealCodexProviderConfig {
  apiKeyEnv: string
  modelProvider: string
  productionTransport?: boolean
}

export function realCodexProviderTomlLines(input: RealCodexProviderConfig): string[] {
  const key = /^[A-Za-z0-9_-]+$/.test(input.modelProvider) ? input.modelProvider : JSON.stringify(input.modelProvider)
  return [
    `[model_providers.${key}]`,
    'name = "OpenAI"',
    `base_url = ${JSON.stringify(OPENAI_CODEX_MODEL_PROVIDER_CONFIG.baseUrl)}`,
    `env_key = ${JSON.stringify(input.apiKeyEnv)}`,
    'wire_api = "responses"',
    'request_max_retries = 4',
    'stream_max_retries = 5',
    `supports_websockets = ${input.productionTransport === true && input.modelProvider === HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID && OPENAI_CODEX_MODEL_PROVIDER_CONFIG.supportsWebSockets}`,
  ]
}
