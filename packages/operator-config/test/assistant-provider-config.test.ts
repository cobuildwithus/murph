import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantProviderConfig,
  resolveAssistantProviderRuntimeTarget,
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'

describe('assistant provider config runtime resolution', () => {
  it('drops unsupported zero-data-retention requests from non-gateway targets', () => {
    const normalized = normalizeAssistantProviderConfig({
      provider: 'openai-compatible',
      presetId: 'openai',
      model: 'gpt-5.1',
      zeroDataRetention: true,
    })

    expect(normalized.zeroDataRetention).toBeNull()

    const resolved = resolveAssistantProviderRuntimeTarget(normalized)
    expect(resolved.supportsZeroDataRetention).toBe(false)

    const sessionOptions = serializeAssistantProviderSessionOptions(normalized)
    expect(sessionOptions.zeroDataRetention).toBeUndefined()
  })

  it('preserves zero-data-retention for vercel ai gateway targets', () => {
    const normalized = normalizeAssistantProviderConfig({
      provider: 'openai-compatible',
      presetId: 'vercel-ai-gateway',
      model: 'openai/gpt-5.1',
      zeroDataRetention: true,
    })

    expect(normalized.zeroDataRetention).toBe(true)

    const resolved = resolveAssistantProviderRuntimeTarget(normalized)
    expect(resolved.executionDriver).toBe('gateway')
    expect(resolved.supportsZeroDataRetention).toBe(true)

    const sessionOptions = serializeAssistantProviderSessionOptions(normalized)
    expect(sessionOptions.zeroDataRetention).toBe(true)
  })

  it('resolves gateway openai models to the native-resume-capable runtime', () => {
    const resolved = resolveAssistantProviderRuntimeTarget({
      provider: 'openai-compatible',
      presetId: 'vercel-ai-gateway',
      model: 'openai/gpt-5.1',
    })

    expect(resolved.executionDriver).toBe('gateway')
    expect(resolved.resumeKind).toBe('openai-response-id')
    expect(resolved.supportsProviderWebSearch).toBe(true)
    expect(resolved.supportsGatewayWebSearch).toBe(true)
  })

  it('keeps unlabeled compatible endpoints conservative', () => {
    const normalized = normalizeAssistantProviderConfig({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.1',
      webSearch: 'provider',
      zeroDataRetention: true,
    })

    expect(normalized.presetId).toBeNull()
    expect(normalized.zeroDataRetention).toBeNull()

    const resolved = resolveAssistantProviderRuntimeTarget(normalized)
    expect(resolved.executionDriver).toBe('openai-compatible')
    expect(resolved.resumeKind).toBeNull()
    expect(resolved.supportsNativeResume).toBe(false)
    expect(resolved.supportsProviderWebSearch).toBe(false)
    expect(resolved.supportsGatewayWebSearch).toBe(false)
  })
})
