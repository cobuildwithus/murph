import { describe, expect, it } from 'vitest'

import {
  resolveAssistantProviderDefaults,
  type AssistantOperatorDefaults,
} from '@murphai/operator-config/operator-config'
import type { SetupConfiguredAssistant } from '@murphai/operator-config/setup-cli-contracts'
import {
  createSetupAssistantResolver,
  hasExplicitSetupAssistantOptions,
  inferSetupAssistantPresetFromOptions,
} from '../src/setup-assistant.ts'
import { assistantSelectionToOperatorDefaults } from '../src/setup-assistant-defaults.ts'

const existingGatewayDefaults: AssistantOperatorDefaults = {
  backend: {
    adapter: 'openai-compatible',
    apiKeyEnv: 'VERCEL_AI_API_KEY',
    endpoint: 'https://ai-gateway.vercel.sh/v1',
    headers: null,
    model: 'openai/gpt-5',
    presetId: 'vercel-ai-gateway',
    providerName: 'vercel-ai-gateway',
    reasoningEffort: null,
    webSearch: null,
    zeroDataRetention: true,
  },
  identityId: null,
  failoverRoutes: null,
  account: null,
  selfDeliveryTargets: null,
}

describe('setup assistant zero-data-retention handling', () => {
  it('treats an explicit false zero-data-retention option as an OpenAI-compatible setup edit', () => {
    expect(
      hasExplicitSetupAssistantOptions({
        assistantZeroDataRetention: false,
      }),
    ).toBe(true)
    expect(
      inferSetupAssistantPresetFromOptions({
        assistantZeroDataRetention: false,
      }),
    ).toBe('openai-compatible')
  })

  it('preserves explicit false zero-data-retention selections from the resolver', async () => {
    const resolver = createSetupAssistantResolver({
      assistantAccount: {
        resolve: async () => null,
      },
    })

    const resolved = await resolver.resolve({
      allowPrompt: false,
      commandName: 'test',
      preset: 'openai-compatible',
      options: {
        vault: '/tmp/test-vault',
        strict: false,
        whisperModel: 'base.en',
        assistantProviderPreset: 'vercel-ai-gateway',
        assistantModel: 'openai/gpt-5',
        assistantZeroDataRetention: false,
      },
    })

    expect(resolved.zeroDataRetention).toBe(false)
  })

  it('clears a previously saved gateway zero-data-retention setting when the next selection explicitly disables it', () => {
    const disabledSelection: SetupConfiguredAssistant = {
      preset: 'openai-compatible',
      enabled: true,
      provider: 'openai-compatible',
      model: 'openai/gpt-5',
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      apiKeyEnv: 'VERCEL_AI_API_KEY',
      presetId: 'vercel-ai-gateway',
      providerName: 'vercel-ai-gateway',
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      oss: false,
      zeroDataRetention: false,
      account: null,
      detail: 'Use openai/gpt-5 from Vercel AI Gateway.',
    }

    const nextDefaultsPatch = assistantSelectionToOperatorDefaults(
      disabledSelection,
      existingGatewayDefaults,
    )
    const nextDefaults: AssistantOperatorDefaults = {
      ...existingGatewayDefaults,
      ...nextDefaultsPatch,
      backend: nextDefaultsPatch.backend ?? null,
      account: nextDefaultsPatch.account ?? existingGatewayDefaults.account,
    }

    expect(resolveAssistantProviderDefaults(nextDefaults, 'openai-compatible'))
      .toMatchObject({
        zeroDataRetention: null,
      })
  })
})
