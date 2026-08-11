import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
  type AssistantProviderConfig,
} from '../src/assistant/provider-config.ts'
import {
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
} from '../src/assistant/target-runtime.ts'

describe('assistant provider config normalization', () => {
  it('re-sanitizes normalized Codex targets without carrying registry metadata', () => {
    const staleNormalizedConfig: AssistantProviderConfig = {
      target: {
        codexCommand: null,
        codexHome: null,
        model: ' gpt-5.6-terra ',
        modelProvider: ' VERCEL-AI-GATEWAY ',
        oss: false,
        profile: null,
      },
      policy: {
        approvalPolicy: null,
        reasoningEffort: null,
        sandbox: null,
      },
    }

    const normalized = normalizeAssistantProviderConfig(staleNormalizedConfig)

    expect(normalized.target.model).toBe('gpt-5.6-terra')
    expect(normalized.target.modelProvider).toBe('vercel-ai-gateway')
    expect(serializeAssistantProviderSessionOptions(normalized)).toMatchObject({
      executionDriver: 'codex-app-server',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      resumeKind: 'codex-thread',
    })
  })

  it('fails closed when a caller explicitly selects an unsupported provider', () => {
    expect(() =>
      normalizeAssistantProviderConfig({
        provider: 'unsupported-provider',
      }),
    ).toThrow(/Assistant runtime targets must use Codex App Server/u)
  })

  it('fails closed when session options are serialized with invalid or unknown model providers', () => {
    expect(() =>
      serializeAssistantProviderSessionOptions({
        provider: 'codex-cli',
        modelProvider: 'not a provider',
      }),
    ).toThrow(/Unknown Codex model provider: not a provider/u)
    expect(() =>
      serializeAssistantProviderSessionOptions({
        provider: 'codex-cli',
        modelProvider: 'custom-provider',
      }),
    ).toThrow(/Unknown Codex model provider: custom-provider/u)
  })

  it('serializes the internal hosted ChatGPT provider', () => {
    expect(
      serializeAssistantProviderSessionOptions({
        provider: 'codex-cli',
        modelProvider: HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
      }),
    ).toMatchObject({
      modelProvider: HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
      provider: 'codex-cli',
    })
  })
})
