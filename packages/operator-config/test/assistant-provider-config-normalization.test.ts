import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
  type AssistantProviderConfig,
} from '../src/assistant/provider-config.ts'

describe('assistant provider config normalization', () => {
  it('re-sanitizes normalized OpenAI-compatible targets so inferred presets override stale preset ids', () => {
    const staleNormalizedConfig: AssistantProviderConfig = {
      target: {
        kind: 'openai-compatible',
        apiKeyEnv: 'VERCEL_AI_API_KEY',
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        gatewayOnlyProviders: null,
        headers: null,
        model: 'openai/gpt-5',
        presetId: 'openrouter',
        providerName: null,
      },
      policy: {
        approvalPolicy: null,
        reasoningEffort: null,
        sandbox: null,
        webSearch: null,
        zeroDataRetention: true,
      },
    }

    const normalized = normalizeAssistantProviderConfig(staleNormalizedConfig)

    expect(normalized.target.kind).toBe('responses')
    if (normalized.target.kind !== 'responses') {
      throw new Error('expected a responses target after normalization')
    }
    expect(normalized.target.presetId).toBe('vercel-ai-gateway')
    expect(normalized.policy.zeroDataRetention).toBe(true)
    expect(serializeAssistantProviderSessionOptions(normalized)).toMatchObject({
      executionDriver: 'responses',
      presetId: 'vercel-ai-gateway',
      zeroDataRetention: true,
    })
  })
})
