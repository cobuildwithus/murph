import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantProviderConfig,
  resolveAssistantProviderRuntimeTarget,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'
import {
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
  VENICE_CODEX_MODEL_PROVIDER_CONFIG,
  resolveAssistantCodexLocalOnboardingProviderConfig,
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
      },
      target: {
        kind: 'codex-cli',
        codexCommand: null,
        codexHome: '/tmp/codex-home',
        model: 'gpt-5.5',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: 'hosted',
      },
    })

    const resolved = resolveAssistantProviderRuntimeTarget(normalized)
    expect(resolved).toMatchObject({
      executionDriver: 'codex-app-server',
      modelProvider: 'vercel-ai-gateway',
      resumeKind: 'codex-thread',
      supportsNativeResume: true,
      target: { kind: 'codex-cli' },
    })

    expect(serializeAssistantProviderSessionOptions(input)).toMatchObject({
      approvalPolicy: 'never',
      executionDriver: 'codex-app-server',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      reasoningEffort: 'medium',
      resumeKind: 'codex-thread',
      sandbox: 'danger-full-access',
    })
    expect(serializeAssistantProviderOperatorDefaults(input)).toMatchObject({
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
    })
  })

  it('records OpenAI Codex provider WebSocket support explicitly', () => {
    expect(OPENAI_CODEX_MODEL_PROVIDER_CONFIG).toEqual({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      envKey: 'OPENAI_API_KEY',
      supportsWebSockets: true,
      wireApi: 'responses',
    })
  })

  it('normalizes Venice as a Codex Responses model provider with local onboarding metadata', () => {
    const normalized = normalizeAssistantProviderConfig({
      provider: 'codex-cli',
      model: ' venice-model ',
      modelProvider: ' Venice ',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
    })

    expect(normalized).toMatchObject({
      target: {
        kind: 'codex-cli',
        model: 'venice-model',
        modelProvider: 'venice',
      },
    })
    expect(VENICE_CODEX_MODEL_PROVIDER_CONFIG).toEqual({
      id: 'venice',
      name: 'Venice.ai',
      baseUrl: 'https://api.venice.ai/api/v1',
      envKey: 'VENICE_API_KEY',
      failureHint:
        'Venice via Codex Responses failed. Check VENICE_API_KEY, the Venice model id, account balance/rate limits, and whether this key/model has Venice Responses API Alpha access.',
      wireApi: 'responses',
    })
    expect(resolveAssistantCodexLocalOnboardingProviderConfig('venice')).toEqual({
      defaultModel: null,
      description: 'Use Codex with a Venice API key.',
      label: 'Venice.ai',
      modelPrompt: 'Venice model id to use with Codex',
      providerId: 'venice',
      selectableInLocalOnboarding: true,
    })
  })

  it('fails closed for unsupported provider config inputs', () => {
    const legacyInput = {
      provider: 'unsupported-provider',
      model: 'gpt-5.1',
    } as const

    expect(() => normalizeAssistantProviderConfig(legacyInput)).toThrow(
      /Assistant runtime targets must use Codex App Server/u,
    )
    expect(() => resolveAssistantProviderRuntimeTarget(legacyInput)).toThrow(
      /Assistant runtime targets must use Codex App Server/u,
    )
    expect(() => serializeAssistantProviderSessionOptions(legacyInput)).toThrow(
      /Assistant runtime targets must use Codex App Server/u,
    )
  })
})
