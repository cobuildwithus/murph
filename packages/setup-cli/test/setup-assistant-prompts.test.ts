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
  promptState.answers = ['gpt-5.6-terra-medium']

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
    }),
    preset: 'codex',
  })

  assert.deepEqual(promptState.prompts, [
    'OpenAI model id to use with Codex [gpt-6.1-sol]: ',
  ])
  assert.deepEqual(assistant, {
    preset: 'codex',
    enabled: true,
    provider: 'codex-cli',
    model: 'gpt-5.6-terra-medium',
    modelProvider: null,
    codexCommand: null,
    codexHome: null,
    profile: null,
    reasoningEffort: 'low',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    oss: false,
    account: null,
    detail:
      'Use Codex with gpt-5.6-terra-medium.',
  })
})

test('setup assistant prompt flow defaults OpenAI models when blank', async () => {
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
    }),
    preset: 'codex',
  })

  assert.deepEqual(promptState.prompts, [
    'OpenAI model id to use with Codex [gpt-6.1-sol]: ',
  ])
  assert.equal(assistant.model, 'gpt-6.1-sol')
  assert.equal(assistant.oss, false)
  assert.match(assistant.detail, /path redacted/u)
})
