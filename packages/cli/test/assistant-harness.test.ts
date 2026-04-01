import assert from 'node:assert/strict'
import { z } from 'zod'
import { afterEach, beforeEach, expectTypeOf, test as baseTest, vi } from 'vitest'

const test = baseTest.sequential

const harnessMocks = vi.hoisted(() => {
  const gateway = vi.fn((model: string) => ({
    provider: 'gateway',
    model,
  }))
  const openAICompatibleProvider = vi.fn((model: string) => ({
    provider: 'openai-compatible',
    model,
  }))
  const openAIResponsesProvider = vi.fn((model: string) => ({
    provider: 'openai-responses',
    model,
  }))
  const openAIProvider = Object.assign(
    vi.fn((model: string) => ({
      provider: 'openai',
      model,
    })),
    {
      responses: openAIResponsesProvider,
    },
  )
  const createOpenAI = vi.fn(() => openAIProvider)
  const createOpenAICompatible = vi.fn(() => openAICompatibleProvider)

  return {
    gateway,
    openAICompatibleProvider,
    openAIProvider,
    openAIResponsesProvider,
    createOpenAI,
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

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: harnessMocks.createOpenAI,
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: harnessMocks.createOpenAICompatible,
}))

import {
  createAssistantToolCatalog,
  defineAssistantTool,
  resolveAssistantLanguageModel,
} from '@murphai/assistant-core/model-harness'

const TEST_API_KEY_ENV = 'ASSISTANT_TEST_KEY'

beforeEach(() => {
  harnessMocks.gateway.mockClear()
  harnessMocks.openAICompatibleProvider.mockClear()
  harnessMocks.openAIProvider.mockClear()
  harnessMocks.openAIResponsesProvider.mockClear()
  harnessMocks.createOpenAI.mockClear()
  harnessMocks.createOpenAICompatible.mockClear()
  delete process.env[TEST_API_KEY_ENV]
})

afterEach(() => {
  delete process.env[TEST_API_KEY_ENV]
})

test('defineAssistantTool infers execute input from the tool schema', () => {
  const definition = defineAssistantTool({
    name: 'typed.echo',
    description: 'Compile-time typed echo tool.',
    inputSchema: z.object({
      value: z.string().min(1),
      count: z.number().int().positive().optional(),
    }),
    execute: async ({ value, count }) => ({
      echoed: value,
      count,
    }),
  })

  expectTypeOf<Parameters<typeof definition.execute>[0]>().toEqualTypeOf<{
    value: string
    count?: number | undefined
  }>()
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

test('resolveAssistantLanguageModel uses the OpenAI responses provider for the official OpenAI endpoint', () => {
  process.env[TEST_API_KEY_ENV] = 'secret-key'

  const model = resolveAssistantLanguageModel({
    model: 'gpt-5',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: TEST_API_KEY_ENV,
    providerName: 'openai',
    headers: {
      'x-test-header': 'bundle',
    },
  })
  const openAiResponsesModel = model as {
    constructor?: {
      name?: string
    }
    modelId?: string
    specificationVersion?: string
    config?: {
      fetch?: typeof fetch
      headers?: () => Record<string, string>
      provider?: string
    }
  }
  const headers = openAiResponsesModel.config?.headers?.()

  assert.equal(openAiResponsesModel.constructor?.name, 'OpenAIResponsesLanguageModel')
  assert.equal(openAiResponsesModel.modelId, 'gpt-5')
  assert.equal(openAiResponsesModel.specificationVersion, 'v2')
  assert.equal(openAiResponsesModel.config?.provider, 'openai.responses')
  assert.equal(typeof openAiResponsesModel.config?.fetch, 'function')
  assert.equal(headers?.authorization, 'Bearer secret-key')
  assert.equal(headers?.['x-test-header'], 'bundle')
  assert.match(String(headers?.['user-agent']), /^ai-sdk\/openai\//u)
})


test('resolveAssistantLanguageModel injects automatic OpenAI response compaction', async () => {
  process.env[TEST_API_KEY_ENV] = 'secret-key'

  const originalFetch = globalThis.fetch
  const fetchSpy = vi.fn(async (
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    return new Response(init?.body ?? '', {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  })

  globalThis.fetch = fetchSpy as typeof globalThis.fetch

  try {
    const model = resolveAssistantLanguageModel({
      model: 'gpt-5',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: TEST_API_KEY_ENV,
      providerName: 'openai',
    })
    const openAiResponsesModel = model as {
      config?: {
        fetch?: typeof fetch
      }
    }

    assert.equal(typeof openAiResponsesModel.config?.fetch, 'function')
    const wrappedFetch = openAiResponsesModel.config?.fetch as typeof fetch
    await wrappedFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-5',
      }),
    })

    const forwardedInit = fetchSpy.mock.calls[0]?.[1] as Parameters<typeof fetch>[1] | undefined
    assert.equal(typeof forwardedInit?.body, 'string')
    assert.deepEqual(JSON.parse(forwardedInit?.body as string), {
      model: 'gpt-5',
      context_management: [
        {
          type: 'compaction',
          compact_threshold: 200000,
        },
      ],
    })
  } finally {
    globalThis.fetch = originalFetch
  }
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
  const openAiCompatibleModel = model as {
    constructor?: {
      name?: string
    }
    modelId?: string
    specificationVersion?: string
    supportsStructuredOutputs?: boolean
    config?: {
      fetch?: typeof fetch
      headers?: () => Record<string, string>
      provider?: string
    }
  }
  const headers = openAiCompatibleModel.config?.headers?.()

  assert.equal(
    openAiCompatibleModel.constructor?.name,
    'OpenAICompatibleChatLanguageModel',
  )
  assert.equal(openAiCompatibleModel.modelId, 'local-model')
  assert.equal(openAiCompatibleModel.specificationVersion, 'v3')
  assert.equal(openAiCompatibleModel.config?.provider, 'murph-assistant.chat')
  assert.equal(openAiCompatibleModel.supportsStructuredOutputs, false)
  assert.equal(typeof openAiCompatibleModel.config?.fetch, 'undefined')
  assert.equal(headers?.authorization, 'Bearer secret-key')
  assert.equal(headers?.['x-test-header'], 'bundle')
  assert.match(String(headers?.['user-agent']), /^ai-sdk\/openai-compatible\//u)
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
