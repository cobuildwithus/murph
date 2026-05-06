import { describe, expect, it } from 'vitest'

import {
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
  VENICE_CODEX_MODEL_PROVIDER_CONFIG,
} from '@murphai/operator-config/assistant/target-runtime'
import {
  mergeCodexConfigOverrides,
} from '../src/assistant/providers/helpers.ts'

describe('Codex provider config overrides', () => {
  it('emits Venice provider table overrides without raw credential values', () => {
    const overrides = mergeCodexConfigOverrides({
      modelProvider: 'venice',
      modelProviderConfig: VENICE_CODEX_MODEL_PROVIDER_CONFIG,
      showThinkingTraces: false,
    })

    expect(overrides).toEqual([
      'model_providers."venice".name="Venice.ai"',
      'model_providers."venice".base_url="https://api.venice.ai/api/v1"',
      'model_providers."venice".env_key="VENICE_API_KEY"',
      'model_providers."venice".wire_api="responses"',
    ])
    expect(JSON.stringify(overrides)).not.toContain('sk-venice-secret-test')
  })

  it('keeps reserved OpenAI provider ids on built-in Codex config', () => {
    const overrides = mergeCodexConfigOverrides({
      modelProvider: 'openai',
      modelProviderConfig: OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
      showThinkingTraces: true,
    })

    expect(overrides).toEqual([
      'model_reasoning_summary="auto"',
      'hide_agent_reasoning=false',
    ])
  })

  it('fails closed when a provider id has no known provider config', () => {
    expect(() =>
      mergeCodexConfigOverrides({
        modelProvider: 'unknown-provider',
        modelProviderConfig: null,
        showThinkingTraces: false,
      }),
    ).toThrow(/Unknown Codex model provider: unknown-provider/u)
  })

  it('fails closed when provider id and provider config do not match', () => {
    expect(() =>
      mergeCodexConfigOverrides({
        modelProvider: 'venice',
        modelProviderConfig: OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
        showThinkingTraces: false,
      }),
    ).toThrow(/Codex model provider config mismatch: venice/u)
  })
})
