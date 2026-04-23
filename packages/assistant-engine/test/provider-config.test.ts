import { describe, expect, it } from 'vitest'

import { resolveAssistantModelSpecFromProviderConfig } from '../src/assistant/provider-config.ts'

describe('assistant provider config model spec', () => {
  it('derives a responses request policy only for vercel ai gateway zero-data-retention targets', () => {
    const gatewaySpec = resolveAssistantModelSpecFromProviderConfig({
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      model: 'openai/gpt-5.4',
      presetId: 'vercel-ai-gateway',
      provider: 'openai-compatible',
      gatewayOnlyProviders: ['openai'],
      zeroDataRetention: true,
    })

    expect(gatewaySpec).toMatchObject({
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      executionDriver: 'responses',
      model: 'openai/gpt-5.4',
      responsesRequestPolicy: {
        gatewayOnlyProviders: ['openai'],
        gatewayZeroDataRetention: true,
      },
    })

    const openAiSpec = resolveAssistantModelSpecFromProviderConfig({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      presetId: 'openai',
      provider: 'openai-compatible',
      zeroDataRetention: true,
    })

    expect(openAiSpec).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      executionDriver: 'responses',
      model: 'gpt-4.1-mini',
    })
    expect(openAiSpec).not.toHaveProperty('responsesRequestPolicy')
  })

  it('refuses gateway responses request policy for custom endpoints with stale gateway metadata', () => {
    const customSpec = resolveAssistantModelSpecFromProviderConfig({
      baseUrl: 'https://proxy.example.com/v1',
      gatewayOnlyProviders: ['openai'],
      model: 'openai/gpt-5.4',
      presetId: 'vercel-ai-gateway',
      provider: 'openai-compatible',
      providerName: 'vercel-ai-gateway',
      zeroDataRetention: true,
    })

    expect(customSpec).toMatchObject({
      baseUrl: 'https://proxy.example.com/v1',
      executionDriver: 'openai-compatible',
      model: 'openai/gpt-5.4',
    })
    expect(customSpec).not.toHaveProperty('responsesRequestPolicy')
  })
})
