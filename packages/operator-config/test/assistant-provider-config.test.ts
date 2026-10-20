import { describe, expect, it } from 'vitest'

import { assistantCodexModelTargetSchema } from '../src/assistant-cli-contracts.ts'

import {
  compactAssistantProviderConfigInput,
  mergeAssistantProviderConfigs,
  normalizeAssistantProviderConfig,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
  type AssistantProviderConfigInput,
} from '../src/assistant/provider-config.ts'
import {
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
  resolveAssistantCodexUsageProviderName,
  resolveAssistantCodexModelProviderConfig,
} from '../src/assistant/target-runtime.ts'

function continuityFingerprint(input: AssistantProviderConfigInput): string {
  return serializeAssistantProviderSessionOptions(input).continuityFingerprint
}

describe('assistant provider config', () => {
  it('keeps local transport identities out of OpenAI usage evidence', () => {
    expect(resolveAssistantCodexUsageProviderName(
      HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
    )).toBe(HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID)
    expect(resolveAssistantCodexUsageProviderName(null)).toBeNull()
  })

  it('keeps Codex continuity stable across ordinary model and reasoning changes', () => {
    const first = continuityFingerprint({
      approvalPolicy: 'never',
      model: 'gpt-6.1-sol',
      modelProvider: 'openai',
      provider: 'codex-cli',
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
    })
    const switched = continuityFingerprint({
      approvalPolicy: 'never',
      model: 'gpt-5.6-sol',
      modelProvider: 'openai',
      provider: 'codex-cli',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
    })
    const incompatible = continuityFingerprint({
      approvalPolicy: 'never',
      model: 'gpt-5.6-sol',
      modelProvider: 'hosted-openai',
      provider: 'codex-cli',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
    })

    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(switched).toBe(first)
    expect(incompatible).not.toBe(first)
  })

  it('normalizes OpenAI as Codex model-provider configuration', () => {
    const input = {
      provider: 'codex-cli',
      approvalPolicy: 'never',
      codexHome: ' /tmp/codex-home ',
      model: ' gpt-6.1-sol ',
      modelProvider: ' OpenAI ',
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
        model: 'gpt-6.1-sol',
        modelProvider: 'openai',
        oss: false,
        profile: 'hosted',
      },
    })

    expect(serializeAssistantProviderSessionOptions(input)).toMatchObject({
      approvalPolicy: 'never',
      executionDriver: 'codex-app-server',
      model: 'gpt-6.1-sol',
      modelProvider: 'openai',
      provider: 'codex-cli',
      reasoningEffort: 'medium',
      resumeKind: 'codex-thread',
      sandbox: 'danger-full-access',
    })
    expect(serializeAssistantProviderOperatorDefaults(input)).toMatchObject({
      model: 'gpt-6.1-sol',
      modelProvider: 'openai',
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

  it.each(['venice', 'hosted-custom-inference', 'venice-local-test', 'vercel-ai-gateway', 'ollama', 'lmstudio'])(
    'rejects removed model provider %s without falling back to OpenAI',
    (modelProvider) => {
      expect(resolveAssistantCodexModelProviderConfig(modelProvider)).toBeNull()
      expect(() => normalizeAssistantProviderConfig({ modelProvider })).toThrow(/Unknown Codex model provider/u)
      expect(() => serializeAssistantProviderSessionOptions({ modelProvider })).toThrow(/Unknown Codex model provider/u)
      expect(assistantCodexModelTargetSchema.safeParse({
        adapter: 'codex-cli',
        modelProvider,
      }).success).toBe(false)
    },
  )

  it('rejects local model execution', () => {
    expect(() => normalizeAssistantProviderConfig({ oss: true })).toThrow(/must use OpenAI/u)
    expect(assistantCodexModelTargetSchema.safeParse({
      adapter: 'codex-cli',
      oss: true,
    }).success).toBe(false)
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
