import { describe, expect, it } from 'vitest'

import {
  mergeCodexConfigOverrides,
} from '../src/assistant/providers/helpers.ts'

describe('Codex provider config overrides', () => {
  it('emits Venice provider table overrides without raw credential values', () => {
    const overrides = mergeCodexConfigOverrides({
      modelProvider: 'venice',
      showThinkingTraces: false,
    })

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
    const overrides = mergeCodexConfigOverrides({
      modelProvider: 'openai',
      showThinkingTraces: true,
    })

    expect(overrides).toEqual([
      'model_reasoning_summary="auto"',
      'hide_agent_reasoning=false',
    ])
  })

  it('never emits a multi_agent_v2 CLI override that would shadow the hosted config table', () => {
    // A CLI `--config features.multi_agent_v2=true` override takes precedence
    // over hosted config.toml and could shadow hosted defaults or future table
    // fields.
    const overrides = mergeCodexConfigOverrides({
      modelProvider: 'openai-local-test',
      showThinkingTraces: true,
    })

    expect(
      overrides?.some((override) => override.includes('multi_agent')),
    ).toBe(false)
  })

  it('fails closed when a provider id has no known provider config', () => {
    expect(() =>
      mergeCodexConfigOverrides({
        modelProvider: 'unknown-provider',
        showThinkingTraces: false,
      }),
    ).toThrow(/Unknown Codex model provider: unknown-provider/u)
  })

  it('does not emit custom tables for reserved built-in provider ids without registry configs', () => {
    const overrides = mergeCodexConfigOverrides({
      modelProvider: 'ollama',
      showThinkingTraces: false,
    })

    expect(overrides).toBeUndefined()
  })

  it('allows hosted-local test provider ids to use the prewritten Codex config', () => {
    const overrides = mergeCodexConfigOverrides({
      modelProvider: 'openai-local-test',
      showThinkingTraces: false,
    })

    expect(overrides).toBeUndefined()
  })
})
