import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantProviderConfig,
  resolveAssistantProviderRuntimeTarget,
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'

describe('assistant provider config runtime resolution', () => {
  it('drops unsupported zero-data-retention requests from non-gateway targets', () => {
    const input = {
      provider: 'openai-compatible',
      presetId: 'openai',
      model: 'gpt-5.1',
      zeroDataRetention: true,
    } as const
    const normalized = normalizeAssistantProviderConfig(input)

    expect(normalized.policy.zeroDataRetention).toBeNull()
    expect(normalized.target.kind).toBe('responses')

    const resolved = resolveAssistantProviderRuntimeTarget(normalized)
    expect(resolved.supportsZeroDataRetention).toBe(false)

    const sessionOptions = serializeAssistantProviderSessionOptions(input)
    expect(sessionOptions.zeroDataRetention).toBeUndefined()
  })

  it('preserves zero-data-retention for vercel ai gateway targets', () => {
    const input = {
      provider: 'openai-compatible',
      presetId: 'vercel-ai-gateway',
      model: 'openai/gpt-5.1',
      zeroDataRetention: true,
    } as const
    const normalized = normalizeAssistantProviderConfig(input)

    expect(normalized.policy.zeroDataRetention).toBe(true)
    expect(normalized.target).toEqual({
      kind: 'responses',
      via: 'vercel-ai-gateway',
      apiKeyEnv: null,
      baseUrl: null,
      gatewayOnlyProviders: null,
      headers: null,
      model: 'openai/gpt-5.1',
      presetId: 'vercel-ai-gateway',
      providerName: null,
    })

    const resolved = resolveAssistantProviderRuntimeTarget(normalized)
    expect(resolved.executionDriver).toBe('responses')
    expect(resolved.supportsZeroDataRetention).toBe(true)

    const sessionOptions = serializeAssistantProviderSessionOptions(input)
    expect(sessionOptions.zeroDataRetention).toBe(true)
  })

  it('preserves Vercel AI Gateway provider-only routing filters', () => {
    const input = {
      provider: 'openai-compatible',
      presetId: 'vercel-ai-gateway',
      model: 'openai/gpt-5.4',
      gatewayOnlyProviders: [' OpenAI ', 'azure', 'openai'],
    } as const
    const normalized = normalizeAssistantProviderConfig(input)

    expect(
      normalized.target.kind === 'responses'
        ? normalized.target.gatewayOnlyProviders
        : null,
    ).toEqual(['openai', 'azure'])
    expect(serializeAssistantProviderSessionOptions(input).gatewayOnlyProviders).toEqual([
      'openai',
      'azure',
    ])

    const nonGateway = normalizeAssistantProviderConfig({
      ...input,
      presetId: 'openai',
      model: 'gpt-5.4',
    })
    expect(
      nonGateway.target.kind === 'responses'
        ? nonGateway.target.gatewayOnlyProviders
        : null,
    ).toBeNull()
  })

  it('resolves gateway openai models to the native-resume-capable runtime', () => {
    const resolved = resolveAssistantProviderRuntimeTarget({
      provider: 'openai-compatible',
      presetId: 'vercel-ai-gateway',
      model: 'openai/gpt-5.1',
    })

    expect(resolved.executionDriver).toBe('responses')
    expect(resolved.resumeKind).toBe('openai-response-id')
    expect(resolved.supportsProviderWebSearch).toBe(true)
    expect(resolved.supportsGatewayWebSearch).toBe(true)
  })

  it('keeps custom compatible endpoints conservative', () => {
    const normalized = normalizeAssistantProviderConfig({
      provider: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5.1',
      webSearch: 'provider',
      zeroDataRetention: true,
    })

    expect(normalized.target.kind).toBe('openai-compatible')
    expect(
      normalized.target.kind === 'openai-compatible'
        ? normalized.target.presetId
        : undefined,
    ).toBeNull()
    expect(normalized.policy.zeroDataRetention).toBeNull()

    const resolved = resolveAssistantProviderRuntimeTarget(normalized)
    expect(resolved.executionDriver).toBe('openai-compatible')
    expect(resolved.resumeKind).toBeNull()
    expect(resolved.supportsNativeResume).toBe(false)
    expect(resolved.supportsProviderWebSearch).toBe(false)
    expect(resolved.supportsGatewayWebSearch).toBe(false)
  })
})
