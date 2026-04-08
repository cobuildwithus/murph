import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { afterEach, test, vi } from 'vitest'
import type { SetupCommandOptions } from '@murphai/operator-config/setup-cli-contracts'
import { createSetupAssistantResolver } from '../src/setup-assistant.ts'
import { createCapturedOutputStream } from './helpers.ts'

const promptState = vi.hoisted(() => ({
  answers: [] as string[],
  prompts: [] as string[],
  discoveredCalls: [] as Array<{
    apiKeyEnv?: string | null
    baseUrl: string
    providerName?: string | null
  }>,
  supportsReasoningEffort: true,
}))

vi.mock('node:readline/promises', () => ({
  default: {
    createInterface: () => ({
      async question(prompt: string) {
        promptState.prompts.push(prompt)
        return promptState.answers.shift() ?? ''
      },
      close() {},
    }),
  },
}))

vi.mock('@murphai/assistant-engine/assistant-provider-catalog', () => ({
  discoverAssistantProviderModels: vi.fn(async (input: {
    apiKeyEnv?: string | null
    baseUrl: string
    providerName?: string | null
  }) => {
    promptState.discoveredCalls.push(input)
    return {
      message: 'Discovered models',
      models: [{ id: 'model-alpha' }, { id: 'model-beta' }],
    }
  }),
  resolveAssistantTargetCapabilities: vi.fn(() => ({
    supportsReasoningEffort: promptState.supportsReasoningEffort,
  })),
}))

afterEach(() => {
  promptState.answers = []
  promptState.prompts = []
  promptState.discoveredCalls = []
  promptState.supportsReasoningEffort = true
})

function createSetupOptions(
  overrides: Partial<SetupCommandOptions> = {},
): SetupCommandOptions {
  return {
    vault: '/tmp/test-vault',
    strict: false,
    whisperModel: 'base.en',
    ...overrides,
  }
}

test('setup assistant prompt flow uses discovered models and numeric model selection', async () => {
  promptState.answers = ['', '', '2']
  const { output, readOutput } = createCapturedOutputStream()

  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      async resolve() {
        return null
      },
    },
    input: new PassThrough(),
    output,
    async resolveCodexHome() {
      return {
        codexHome: null,
        discoveredHomes: [],
      }
    },
  })

  const assistant = await resolver.resolve({
    allowPrompt: true,
    commandName: 'murph setup',
    options: createSetupOptions({
      assistantProviderPreset: 'openrouter',
    }),
    preset: 'openai-compatible',
  })

  assert.deepEqual(assistant, {
    preset: 'openai-compatible',
    enabled: true,
    provider: 'openai-compatible',
    model: 'model-beta',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    providerName: 'openrouter',
    codexCommand: null,
    profile: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    oss: false,
    account: null,
    detail: 'Use model-beta from OpenRouter. Murph will read the key from OPENROUTER_API_KEY.',
  })
  assert.deepEqual(promptState.discoveredCalls, [
    {
      apiKeyEnv: 'OPENROUTER_API_KEY',
      baseUrl: 'https://openrouter.ai/api/v1',
      provider: 'openai-compatible',
      providerName: 'openrouter',
    },
  ])
  assert.match(readOutput(), /Discovered models/u)
  assert.match(readOutput(), /Available models:/u)
})

test('setup assistant prompt flow retries required model entry and rejects unsupported reasoning effort', async () => {
  promptState.answers = ['https://example.test/v1', '', '', 'custom-model']
  promptState.supportsReasoningEffort = false
  const { output, readOutput } = createCapturedOutputStream()

  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      async resolve() {
        return null
      },
    },
    discoverModels: async () => ({
      message: 'No models available',
      models: [],
      status: 'ok',
    }),
    input: new PassThrough(),
    output,
    async resolveCodexHome() {
      return {
        codexHome: null,
        discoveredHomes: [],
      }
    },
  })

  await assert.rejects(
    resolver.resolve({
      allowPrompt: true,
      commandName: 'murph setup',
      options: createSetupOptions({
        assistantProviderPreset: 'custom',
        assistantReasoningEffort: 'high',
      }),
      preset: 'openai-compatible',
    }),
    /does not support assistantReasoningEffort/u,
  )
  assert.match(readOutput(), /A model id is required\./u)
})
