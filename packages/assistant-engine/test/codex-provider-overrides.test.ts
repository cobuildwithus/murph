import { describe, expect, it } from 'vitest'

import {
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'

import {
  resolveCodexModelProviderConfigOverrides,
} from '../src/assistant/providers/helpers.ts'

describe('Codex provider config overrides', () => {
  it('emits Venice provider table overrides without raw credential values', () => {
    const overrides = resolveCodexModelProviderConfigOverrides('venice')

    expect(overrides).toEqual([
      'model_providers.venice.name="Venice.ai"',
      'model_providers.venice.base_url="https://api.venice.ai/api/v1"',
      'model_providers.venice.env_key="VENICE_API_KEY"',
      'model_providers.venice.wire_api="responses"',
      'model_providers.venice.requires_openai_auth=false',
    ])
    expect(JSON.stringify(overrides)).not.toContain('sk-venice-secret-test')
    expect(overrides?.some((override) => override.startsWith('model_provider='))).toBe(false)
  })

  it('keeps reserved OpenAI provider ids on built-in Codex config', () => {
    expect(resolveCodexModelProviderConfigOverrides('openai')).toBeUndefined()
  })

  it('fails closed when a provider id has no known provider config', () => {
    expect(() =>
      resolveCodexModelProviderConfigOverrides('unknown-provider'),
    ).toThrow(/Unknown Codex model provider: unknown-provider/u)
  })

  it('does not emit custom tables for reserved built-in provider ids without registry configs', () => {
    const overrides = resolveCodexModelProviderConfigOverrides('ollama')

    expect(overrides).toBeUndefined()
  })

  it('allows hosted-local test provider ids to use the prewritten Codex config', () => {
    const overrides =
      resolveCodexModelProviderConfigOverrides('openai-local-test')

    expect(overrides).toBeUndefined()
  })

  it('allows hosted ChatGPT auth to use the prewritten Codex config', () => {
    const overrides = resolveCodexModelProviderConfigOverrides(
      HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
    )

    expect(overrides).toBeUndefined()
  })
})
