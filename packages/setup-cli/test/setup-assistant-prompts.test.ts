import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { afterEach, test, vi } from 'vitest'
import type { SetupCommandOptions } from '@murphai/operator-config/setup-cli-contracts'
import { createSetupAssistantResolver } from '../src/setup-assistant.ts'

const promptState = vi.hoisted(() => ({
  answers: [] as string[],
  prompts: [] as string[],
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

afterEach(() => {
  promptState.answers = []
  promptState.prompts = []
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

test('setup assistant prompt flow asks directly for the Codex model id', async () => {
  promptState.answers = ['gpt-5.5-medium']

  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      async resolve() {
        return null
      },
    },
    input: new PassThrough(),
    output: new PassThrough(),
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
      assistantModelProvider: 'vercel-ai-gateway',
    }),
    preset: 'codex',
  })

  assert.deepEqual(promptState.prompts, [
    'Model id to use with Codex [gpt-5.5]: ',
  ])
  assert.deepEqual(assistant, {
    preset: 'codex',
    enabled: true,
    provider: 'codex-cli',
    model: 'gpt-5.5-medium',
    modelProvider: 'vercel-ai-gateway',
    codexCommand: null,
    codexHome: null,
    profile: null,
    reasoningEffort: 'low',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    oss: false,
    account: null,
    detail:
      'Use Codex with gpt-5.5-medium. Use Codex model provider vercel-ai-gateway.',
  })
})

test('setup assistant prompt flow asks Venice for an explicit model without OpenAI default leakage', async () => {
  promptState.answers = [' venice-model-test ']
  let accountCalls = 0

  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      async resolve() {
        accountCalls += 1
        return null
      },
    },
    input: new PassThrough(),
    output: new PassThrough(),
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
      assistantModelProvider: 'venice',
    }),
    preset: 'codex',
  })

  assert.deepEqual(promptState.prompts, [
    'Venice model id to use with Codex: ',
  ])
  assert.equal(assistant.model, 'venice-model-test')
  assert.equal(assistant.modelProvider, 'venice')
  assert.equal(accountCalls, 0)
  assert.match(assistant.detail, /Use Codex model provider venice/u)
})

test('setup assistant rejects noninteractive Venice without a model before account probing', async () => {
  let accountCalls = 0
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      async resolve() {
        accountCalls += 1
        return null
      },
    },
    input: new PassThrough(),
    output: new PassThrough(),
    async resolveCodexHome() {
      return {
        codexHome: null,
        discoveredHomes: [],
      }
    },
  })

  await assert.rejects(
    resolver.resolve({
      allowPrompt: false,
      commandName: 'murph setup',
      options: createSetupOptions({
        assistantModelProvider: 'venice',
      }),
      preset: 'codex',
    }),
    /--assistant-model is required/u,
  )
  assert.equal(accountCalls, 0)
  assert.deepEqual(promptState.prompts, [])
})

test('setup assistant rejects model providers with local OSS setup', async () => {
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      async resolve() {
        return null
      },
    },
    input: new PassThrough(),
    output: new PassThrough(),
    async resolveCodexHome() {
      return {
        codexHome: null,
        discoveredHomes: [],
      }
    },
  })

  await assert.rejects(
    resolver.resolve({
      allowPrompt: false,
      commandName: 'murph setup',
      options: createSetupOptions({
        assistantModel: 'llama',
        assistantModelProvider: 'venice',
        assistantOss: true,
      }),
      preset: 'codex',
    }),
    /--assistant-model-provider cannot be used with --assistant-oss/u,
  )
})

test('setup assistant prompt flow defaults local OSS Codex models when blank', async () => {
  promptState.answers = ['']

  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      async resolve() {
        return null
      },
    },
    input: new PassThrough(),
    output: new PassThrough(),
    async resolveCodexHome() {
      return {
        codexHome: '/tmp/codex-home',
        discoveredHomes: [],
      }
    },
  })

  const assistant = await resolver.resolve({
    allowPrompt: true,
    commandName: 'murph setup',
    options: createSetupOptions({
      assistantOss: true,
    }),
    preset: 'codex',
  })

  assert.deepEqual(promptState.prompts, [
    'Local model id to use with Codex [gpt-oss:20b]: ',
  ])
  assert.equal(assistant.model, 'gpt-oss:20b')
  assert.equal(assistant.oss, true)
  assert.match(assistant.detail, /path redacted/u)
})
