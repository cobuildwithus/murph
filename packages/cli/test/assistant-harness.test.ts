import assert from 'node:assert/strict'
import { z } from 'zod'
import { afterEach, beforeEach, test, vi } from 'vitest'

const harnessMocks = vi.hoisted(() => {
  const gateway = vi.fn((model: string) => ({
    provider: 'gateway',
    model,
  }))
  const openAICompatibleProvider = vi.fn((model: string) => ({
    provider: 'openai-compatible',
    model,
  }))
  const createOpenAICompatible = vi.fn(() => openAICompatibleProvider)

  return {
    gateway,
    openAICompatibleProvider,
    createOpenAICompatible,
  }
})

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    gateway: harnessMocks.gateway,
  }
})

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: harnessMocks.createOpenAICompatible,
}))

import {
  createAssistantToolCatalog,
  resolveAssistantLanguageModel,
} from '../src/assistant-harness.js'

const TEST_API_KEY_ENV = 'HEALTHYBOB_ASSISTANT_TEST_KEY'

beforeEach(() => {
  harnessMocks.gateway.mockClear()
  harnessMocks.openAICompatibleProvider.mockClear()
  harnessMocks.createOpenAICompatible.mockClear()
  delete process.env[TEST_API_KEY_ENV]
})

afterEach(() => {
  delete process.env[TEST_API_KEY_ENV]
})

test('resolveAssistantLanguageModel uses gateway when no baseUrl is provided', () => {
  const model = resolveAssistantLanguageModel({
    model: 'anthropic/claude-sonnet-4-5',
  })

  assert.deepEqual(model, {
    provider: 'gateway',
    model: 'anthropic/claude-sonnet-4-5',
  })
  assert.deepEqual(harnessMocks.gateway.mock.calls, [['anthropic/claude-sonnet-4-5']])
  assert.equal(harnessMocks.createOpenAICompatible.mock.calls.length, 0)
})

test('resolveAssistantLanguageModel uses the openai-compatible provider with env key fallback', () => {
  process.env[TEST_API_KEY_ENV] = 'secret-key'

  const model = resolveAssistantLanguageModel({
    model: 'local-model',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: TEST_API_KEY_ENV,
    headers: {
      'x-test-header': 'bundle',
    },
  })

  assert.deepEqual(model, {
    provider: 'openai-compatible',
    model: 'local-model',
  })
  assert.deepEqual(harnessMocks.createOpenAICompatible.mock.calls, [
    [
      {
        name: 'healthybob-assistant',
        apiKey: 'secret-key',
        baseURL: 'http://127.0.0.1:11434/v1',
        headers: {
          'x-test-header': 'bundle',
        },
      },
    ],
  ])
  assert.deepEqual(harnessMocks.openAICompatibleProvider.mock.calls, [['local-model']])
})

test('createAssistantToolCatalog preview mode validates input but does not execute the tool', async () => {
  const execute = vi.fn(async ({ value }: { value: string }) => ({
    echoed: value,
  }))
  const catalog = createAssistantToolCatalog([
    {
      name: 'echo',
      description: 'Echo the supplied value.',
      inputSchema: z.object({
        value: z.string().min(1),
      }),
      inputExample: {
        value: 'hello',
      },
      execute,
    },
  ])

  const results = await catalog.executeCalls({
    calls: [
      {
        tool: 'echo',
        input: {
          value: 'preview',
        },
      },
    ],
    mode: 'preview',
  })

  assert.equal(results[0]?.status, 'previewed')
  assert.deepEqual(results[0]?.result, {
    preview: true,
    tool: 'echo',
    input: {
      value: 'preview',
    },
  })
  assert.equal(execute.mock.calls.length, 0)
})

test('createAssistantToolCatalog apply mode executes tools and reports unknown, invalid, and skipped calls', async () => {
  const execute = vi.fn(async ({ value }: { value: string }) => ({
    echoed: value,
  }))
  const catalog = createAssistantToolCatalog([
    {
      name: 'echo',
      description: 'Echo the supplied value.',
      inputSchema: z.object({
        value: z.string().min(1),
      }),
      execute,
    },
  ])

  const applied = await catalog.executeCalls({
    calls: [
      {
        tool: 'echo',
        input: {
          value: 'apply',
        },
      },
    ],
    mode: 'apply',
  })
  const invalid = await catalog.executeCalls({
    calls: [
      {
        tool: 'echo',
        input: {
          value: 123,
        },
      },
    ],
    mode: 'apply',
  })
  const unknown = await catalog.executeCalls({
    calls: [
      {
        tool: 'missing.tool',
        input: {},
      },
    ],
    mode: 'apply',
  })
  const skipped = await catalog.executeCalls({
    calls: [
      {
        tool: 'echo',
        input: {
          value: 'first',
        },
      },
      {
        tool: 'echo',
        input: {
          value: 'second',
        },
      },
    ],
    maxCalls: 1,
    mode: 'apply',
  })

  assert.equal(applied[0]?.status, 'succeeded')
  assert.deepEqual(applied[0]?.result, {
    echoed: 'apply',
  })
  assert.equal(execute.mock.calls.length, 2)
  assert.equal(invalid[0]?.status, 'failed')
  assert.equal(invalid[0]?.errorCode, 'ASSISTANT_TOOL_INPUT_INVALID')
  assert.equal(unknown[0]?.status, 'failed')
  assert.equal(unknown[0]?.errorCode, 'ASSISTANT_TOOL_UNKNOWN')
  assert.equal(skipped[1]?.status, 'skipped')
  assert.equal(skipped[1]?.errorMessage, 'Skipped because the plan exceeded the configured call limit.')
})
