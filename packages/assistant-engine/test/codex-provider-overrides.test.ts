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
      'shell_environment_policy.ignore_default_excludes=false',
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
      'shell_environment_policy.ignore_default_excludes=false',
      'model_reasoning_summary="auto"',
      'hide_agent_reasoning=false',
    ])
  })

  it('can enable hosted MultiAgent V2 as a process-launch override', () => {
    const overrides = mergeCodexConfigOverrides({
      enableMultiAgentV2: true,
      modelProvider: 'openai-local-test',
      showThinkingTraces: false,
    })

    expect(overrides).toEqual([
      'features.multi_agent_v2=true',
    ])
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
