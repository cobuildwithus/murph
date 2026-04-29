import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantProviderConfig,
  resolveAssistantProviderRuntimeTarget,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
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
      resumeKind: 'codex-thread',
      supportsNativeResume: true,
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
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
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
