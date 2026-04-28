import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
  type AssistantProviderConfig,
} from '../src/assistant/provider-config.ts'
import {
  VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
} from '../src/assistant/target-runtime.ts'

describe('assistant provider config normalization', () => {
  it('re-sanitizes normalized Codex targets and attaches known model provider config', () => {
    const staleNormalizedConfig: AssistantProviderConfig = {
      target: {
        kind: 'codex-cli',
        codexCommand: null,
        codexHome: null,
        model: ' gpt-5.5 ',
        modelProvider: ' VERCEL-AI-GATEWAY ',
        modelProviderConfig: null,
        oss: false,
        profile: null,
      },
      policy: {
        approvalPolicy: null,
        reasoningEffort: null,
        sandbox: null,
        webSearch: null,
        zeroDataRetention: null,
      },
    }

    const normalized = normalizeAssistantProviderConfig(staleNormalizedConfig)

    expect(normalized.target.kind).toBe('codex-cli')
    if (normalized.target.kind !== 'codex-cli') {
      throw new Error('expected a Codex target after normalization')
    }
    expect(normalized.target.model).toBe('gpt-5.5')
    expect(normalized.target.modelProvider).toBe('vercel-ai-gateway')
    expect(normalized.target.modelProviderConfig).toEqual(
      VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
    )
    expect(serializeAssistantProviderSessionOptions(normalized)).toMatchObject({
      executionDriver: 'codex-app-server',
      modelProvider: 'vercel-ai-gateway',
      modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
      provider: 'codex-cli',
      resumeKind: 'codex-thread',
    })
  })

  it('fails closed when a persisted normalized target is still OpenAI-compatible', () => {
    const legacyNormalizedConfig: AssistantProviderConfig = {
      target: {
        kind: 'openai-compatible',
        apiKeyEnv: 'VERCEL_AI_API_KEY',
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        gatewayOnlyProviders: null,
        headers: null,
        model: 'openai/gpt-5',
        presetId: 'vercel-ai-gateway',
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

    expect(() => normalizeAssistantProviderConfig(legacyNormalizedConfig)).toThrow(
      /OpenAI-compatible assistant runtimes are no longer supported/u,
    )
  })
})
