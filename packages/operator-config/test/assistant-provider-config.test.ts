import { describe, expect, it } from 'vitest'

import {
  compactAssistantProviderConfigInput,
  mergeAssistantProviderConfigs,
  normalizeAssistantProviderConfig,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
  type AssistantProviderConfigInput,
} from '../src/assistant/provider-config.ts'
import {
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_CONFIG,
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
  VENICE_CODEX_MODEL_PROVIDER_CONFIG,
  resolveAssistantCodexLocalOnboardingProviderConfig,
  resolveAssistantCodexModelProviderConfig,
} from '../src/assistant/target-runtime.ts'

function continuityFingerprint(input: AssistantProviderConfigInput): string {
  return serializeAssistantProviderSessionOptions(input).continuityFingerprint
}

describe('assistant provider config', () => {
  it('keeps Codex continuity stable across ordinary model and reasoning changes', () => {
    const first = continuityFingerprint({
      approvalPolicy: 'never',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
    })
    const switched = continuityFingerprint({
      approvalPolicy: 'never',
      model: 'gpt-5.6-sol',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
    })
    const incompatible = continuityFingerprint({
      approvalPolicy: 'never',
      model: 'gpt-5.6-sol',
      modelProvider: 'openai',
      provider: 'codex-cli',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
    })

    expect(first).toBe(
      'sha256:9c5e29337e7b8d33232ad969c74c9271f0e0ee53769838a4197dd516f6ee8367',
    )
    expect(switched).toBe(first)
    expect(incompatible).not.toBe(first)
  })

  it('makes hosted custom inference continuity revision-sensitive through its model alias', () => {
    const revisionSeven = continuityFingerprint({
      model: 'murph-custom-r7',
      modelProvider: 'hosted-custom-inference',
      provider: 'codex-cli',
    })
    const sameRevision = continuityFingerprint({
      model: 'murph-custom-r7',
      modelProvider: 'hosted-custom-inference',
      provider: 'codex-cli',
      reasoningEffort: 'high',
    })
    const revisionEight = continuityFingerprint({
      model: 'murph-custom-r8',
      modelProvider: 'hosted-custom-inference',
      provider: 'codex-cli',
    })

    expect(sameRevision).toBe(revisionSeven)
    expect(revisionEight).not.toBe(revisionSeven)
  })

  it('normalizes Vercel AI Gateway as Codex model-provider configuration', () => {
    const input = {
      provider: 'codex-cli',
      approvalPolicy: 'never',
      codexHome: ' /tmp/codex-home ',
      model: ' gpt-5.6-terra ',
      modelProvider: ' Vercel-AI-Gateway ',
      oss: false,
      profile: ' hosted ',
      reasoningEffort: ' medium ',
      sandbox: 'danger-full-access',
    } as const

    expect(normalizeAssistantProviderConfig(input)).toEqual({
      policy: {
        approvalPolicy: 'never',
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
      },
      target: {
        codexCommand: null,
        codexHome: '/tmp/codex-home',
        model: 'gpt-5.6-terra',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: 'hosted',
      },
    })

    expect(serializeAssistantProviderSessionOptions(input)).toMatchObject({
      approvalPolicy: 'never',
      executionDriver: 'codex-app-server',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      reasoningEffort: 'medium',
      resumeKind: 'codex-thread',
      sandbox: 'danger-full-access',
    })
    expect(serializeAssistantProviderOperatorDefaults(input)).toMatchObject({
      model: 'gpt-5.6-terra',
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

  it('registers one internal Responses provider for hosted custom inference', () => {
    expect(resolveAssistantCodexModelProviderConfig('hosted-custom-inference'))
      .toEqual(HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_CONFIG)
    expect(HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_CONFIG).toEqual({
      id: 'hosted-custom-inference',
      name: 'Murph Custom Inference',
      baseUrl: 'http://murph-custom-inference.worker/v1',
      envKey: 'MURPH_CUSTOM_INFERENCE_API_KEY',
      failureHint:
        'The selected custom inference endpoint is unavailable or incompatible. Murph did not fall back to managed inference.',
      wireApi: 'responses',
    })
    expect(resolveAssistantCodexLocalOnboardingProviderConfig(
      'hosted-custom-inference',
    )).toBeNull()
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

  it('fails closed for unsupported assistant-runtime identifiers at raw config boundaries', () => {
    const legacyInput = {
      provider: 'unsupported-provider',
      model: 'gpt-5.1',
    } as const
    const message = /Assistant runtime targets must use Codex App Server/u

    expect(() => normalizeAssistantProviderConfig(legacyInput)).toThrow(message)
    expect(() => compactAssistantProviderConfigInput(legacyInput)).toThrow(message)
    expect(() => mergeAssistantProviderConfigs(legacyInput)).toThrow(message)
    expect(() => serializeAssistantProviderSessionOptions(legacyInput)).toThrow(
      message,
    )
  })
})
