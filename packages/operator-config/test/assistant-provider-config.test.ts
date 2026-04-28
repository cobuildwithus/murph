import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantProviderConfig,
  resolveAssistantProviderRuntimeTarget,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
  shouldUseAssistantOpenAIResponsesApi,
  supportsAssistantZeroDataRetention,
} from '../src/assistant/provider-config.ts'
import {
  VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
} from '../src/assistant/target-runtime.ts'

describe('assistant provider config runtime resolution', () => {
  it('normalizes Vercel AI Gateway as a Codex model provider', () => {
    const input = {
      provider: 'codex-cli',
      approvalPolicy: 'never',
      codexHome: ' /tmp/codex-home ',
      model: ' gpt-5.5 ',
      modelProvider: ' Vercel-AI-Gateway ',
      oss: false,
      profile: ' hosted ',
      reasoningEffort: ' medium ',
      sandbox: 'danger-full-access',
    } as const

    const normalized = normalizeAssistantProviderConfig(input)

    expect(normalized).toEqual({
      policy: {
        approvalPolicy: 'never',
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
        webSearch: null,
        zeroDataRetention: null,
      },
      target: {
        kind: 'codex-cli',
        codexCommand: null,
        codexHome: '/tmp/codex-home',
        model: 'gpt-5.5',
        modelProvider: 'vercel-ai-gateway',
        modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
        oss: false,
        profile: 'hosted',
      },
    })

    const resolved = resolveAssistantProviderRuntimeTarget(normalized)
    expect(resolved).toMatchObject({
      executionDriver: 'codex-app-server',
      modelProvider: 'vercel-ai-gateway',
      modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
      presetId: null,
      resumeKind: 'codex-thread',
      supportsNativeResume: true,
      supportsZeroDataRetention: false,
      target: { kind: 'codex-cli' },
    })

    expect(serializeAssistantProviderSessionOptions(input)).toMatchObject({
      approvalPolicy: 'never',
      executionDriver: 'codex-app-server',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
      provider: 'codex-cli',
      reasoningEffort: 'medium',
      resumeKind: 'codex-thread',
      sandbox: 'danger-full-access',
    })
    expect(serializeAssistantProviderOperatorDefaults(input)).toMatchObject({
      apiKeyEnv: null,
      baseUrl: null,
      headers: null,
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
      presetId: null,
      providerName: null,
      zeroDataRetention: null,
    })
  })

  it('fails closed for removed OpenAI-compatible provider config inputs', () => {
    const legacyInput = {
      provider: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://api.example.test/v1',
      model: 'gpt-5.1',
      presetId: 'openai',
      zeroDataRetention: true,
    } as const

    expect(() => normalizeAssistantProviderConfig(legacyInput)).toThrow(
      /OpenAI-compatible assistant runtimes are no longer supported/u,
    )
    expect(() => resolveAssistantProviderRuntimeTarget(legacyInput)).toThrow(
      /Reconfigure the assistant for Codex App Server/u,
    )
    expect(() => serializeAssistantProviderSessionOptions(legacyInput)).toThrow(
      /Reconfigure the assistant for Codex App Server/u,
    )
    expect(shouldUseAssistantOpenAIResponsesApi(legacyInput)).toBe(false)
    expect(supportsAssistantZeroDataRetention({ provider: 'codex-cli' })).toBe(false)
  })
})
