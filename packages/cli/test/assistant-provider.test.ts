import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { beforeEach, test, vi } from 'vitest'

const providerMocks = vi.hoisted(() => ({
  executeCodexPrompt: vi.fn(),
  generateText: vi.fn(),
  resolveAssistantLanguageModel: vi.fn(),
}))

vi.mock('ai', () => ({
  generateText: providerMocks.generateText,
}))

vi.mock('../src/assistant-codex.js', () => ({
  executeCodexPrompt: providerMocks.executeCodexPrompt,
}))

vi.mock('../src/model-harness.js', () => ({
  resolveAssistantLanguageModel: providerMocks.resolveAssistantLanguageModel,
}))

import {
  executeAssistantProviderTurn,
  resolveAssistantProviderCapabilities,
  resolveAssistantProviderOptions,
} from '../src/chat-provider.js'
import {
  defaultDiscoverOpenAICompatibleModels,
  resolveAssistantModelCatalog,
} from '../src/assistant/provider-catalog.js'
import { createSetupAssistantResolver } from '../src/setup-assistant.js'

beforeEach(() => {
  providerMocks.executeCodexPrompt.mockReset()
  providerMocks.generateText.mockReset()
  providerMocks.resolveAssistantLanguageModel.mockReset()
  vi.unstubAllGlobals()
})

test('resolveAssistantProviderOptions sanitizes settings for the selected provider', () => {
  assert.deepEqual(
    resolveAssistantProviderOptions({
      provider: 'openai-compatible',
      model: ' gpt-oss:20b ',
      sandbox: 'read-only',
      approvalPolicy: 'never',
      profile: ' primary ',
      baseUrl: ' http://127.0.0.1:11434/v1 ',
      apiKeyEnv: ' OLLAMA_API_KEY ',
      providerName: ' ollama ',
      headers: {
        'X-Foo ': ' bar ',
        ' X-Bar': 'baz',
      },
      oss: true,
    }),
    {
      model: 'gpt-oss:20b',
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: 'OLLAMA_API_KEY',
      providerName: 'ollama',
      headers: {
        'X-Bar': 'baz',
        'X-Foo': 'bar',
      },
    },
  )
})

test('resolveAssistantProviderCapabilities keeps prompt-only providers from claiming direct CLI execution', () => {
  assert.deepEqual(resolveAssistantProviderCapabilities('codex-cli'), {
    supportsDirectCliExecution: true,
    supportsModelDiscovery: false,
    supportsReasoningEffort: true,
  })
  assert.deepEqual(resolveAssistantProviderCapabilities('openai-compatible'), {
    supportsDirectCliExecution: false,
    supportsModelDiscovery: true,
    supportsReasoningEffort: false,
  })
})

test('resolveAssistantModelCatalog keeps custom Codex models first-class in the picker', () => {
  const catalog = resolveAssistantModelCatalog({
    provider: 'codex-cli',
    currentModel: 'gpt-oss:20b',
    currentReasoningEffort: 'high',
    oss: true,
  })

  assert.equal(catalog.modelOptions[0]?.value, 'gpt-oss:20b')
  assert.equal(
    catalog.modelOptions.some((option) => option.value === 'gpt-5.4'),
    true,
  )
  assert.equal(catalog.reasoningOptions.length, 4)
})

test('resolveAssistantModelCatalog uses discovered OpenAI-compatible models and hides reasoning options', () => {
  const catalog = resolveAssistantModelCatalog({
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    providerName: 'ollama',
    currentModel: 'gpt-oss:20b',
    currentReasoningEffort: 'high',
    discoveredModels: ['gpt-oss:20b', 'llama3.3:70b'],
  })

  assert.deepEqual(
    catalog.modelOptions.map((option) => option.value),
    ['gpt-oss:20b', 'llama3.3:70b'],
  )
  assert.equal(catalog.providerLabel, 'ollama')
  assert.deepEqual(catalog.reasoningOptions, [])
})

test('resolveAssistantModelCatalog keeps undiscovered OpenAI-compatible endpoints empty until the operator chooses a model', () => {
  const catalog = resolveAssistantModelCatalog({
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
  })

  assert.deepEqual(
    catalog.modelOptions.map((option) => option.value),
    [],
  )
  assert.deepEqual(catalog.reasoningOptions, [])
})

test('resolveAssistantModelCatalog keeps the current OpenAI-compatible model selectable even when discovery is empty', () => {
  const catalog = resolveAssistantModelCatalog({
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    currentModel: 'llama3.3:70b',
  })

  assert.equal(catalog.modelOptions[0]?.value, 'llama3.3:70b')
  assert.deepEqual(catalog.reasoningOptions, [])
})

test('defaultDiscoverOpenAICompatibleModels normalizes and dedupes model ids from the models endpoint', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { id: ' gpt-oss:20b ' },
        { id: 'llama3.3:70b' },
        { id: 'gpt-oss:20b' },
        { id: null },
      ],
    }),
  } as Response)
  vi.stubGlobal('fetch', fetchMock)

  const models = await defaultDiscoverOpenAICompatibleModels(
    ' http://127.0.0.1:11434/v1 ',
    {
      apiKeyEnv: 'OLLAMA_API_KEY',
      env: {
        OLLAMA_API_KEY: 'secret-token',
      },
    },
  )

  assert.deepEqual(models, ['gpt-oss:20b', 'llama3.3:70b'])
  assert.equal(
    String(fetchMock.mock.calls[0]?.[0]),
    'http://127.0.0.1:11434/v1/models',
  )
  assert.equal(
    (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined)
      ?.headers?.Authorization,
    'Bearer secret-token',
  )
})

test('defaultDiscoverOpenAICompatibleModels respects explicit Authorization headers over apiKeyEnv injection', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [],
    }),
  } as Response)
  vi.stubGlobal('fetch', fetchMock)

  await defaultDiscoverOpenAICompatibleModels('http://127.0.0.1:11434/v1', {
    apiKeyEnv: 'OLLAMA_API_KEY',
    env: {
      OLLAMA_API_KEY: 'secret-token',
    },
    headers: {
      authorization: 'Bearer override-token',
    },
  })

  const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined)
    ?.headers
  assert.equal(headers?.authorization, 'Bearer override-token')
  assert.equal('Authorization' in (headers ?? {}), false)
})

test('executeAssistantProviderTurn keeps absent Codex runtime overrides undefined', async () => {
  providerMocks.executeCodexPrompt.mockResolvedValue({
    finalMessage: 'assistant reply',
    jsonEvents: [],
    sessionId: 'thread-123',
    stderr: '',
    stdout: '',
  })

  await executeAssistantProviderTurn({
    provider: 'codex-cli',
    workingDirectory: '/tmp/vault',
    userPrompt: 'hello',
  })

  const call = providerMocks.executeCodexPrompt.mock.calls[0]?.[0]
  assert.equal(call?.codexCommand, undefined)
  assert.equal(call?.model, undefined)
  assert.equal(call?.reasoningEffort, undefined)
  assert.equal(call?.sandbox, undefined)
  assert.equal(call?.approvalPolicy, undefined)
  assert.equal(call?.profile, undefined)
  assert.equal(call?.oss, false)
})

test('executeAssistantProviderTurn dispatches to the Codex adapter and preserves the provider session id', async () => {
  const onEvent = vi.fn()
  const abortController = new AbortController()
  providerMocks.executeCodexPrompt.mockResolvedValue({
    finalMessage: 'assistant reply',
    jsonEvents: [{ type: 'thread.started', thread_id: 'thread-123' }],
    sessionId: 'thread-123',
    stderr: 'stderr output',
    stdout: 'stdout output',
  })

  const result = await executeAssistantProviderTurn({
    abortSignal: abortController.signal,
    provider: 'codex-cli',
    configOverrides: ['mcp_servers.healthybob_memory.command="node"'],
    continuityContext: 'Recent local conversation transcript:\nUser: prior question',
    env: {
      PATH: '/tmp/healthybob-bin',
    },
    workingDirectory: '/tmp/vault',
    systemPrompt: 'system prompt',
    userPrompt: 'hello',
    sessionContext: {
      binding: {
        conversationKey: 'channel:imessage|thread:chat-123',
        channel: 'imessage',
        identityId: null,
        actorId: 'contact:bob',
        threadId: 'chat-123',
        threadIsDirect: false,
        delivery: {
          kind: 'thread',
          target: 'chat-123',
        },
      },
    },
    resumeProviderSessionId: 'thread-existing',
    codexCommand: '/opt/homebrew/bin/codex',
    model: 'gpt-oss:20b',
    onEvent,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    profile: 'primary',
    oss: true,
  })

  const call = providerMocks.executeCodexPrompt.mock.calls[0]?.[0]
  assert.equal(call?.abortSignal, abortController.signal)
  assert.equal(call?.codexCommand, '/opt/homebrew/bin/codex')
  assert.deepEqual(call?.configOverrides, ['mcp_servers.healthybob_memory.command="node"'])
  assert.deepEqual(call?.env, {
    PATH: '/tmp/healthybob-bin',
  })
  assert.equal(call?.workingDirectory, '/tmp/vault')
  assert.equal(call?.resumeSessionId, 'thread-existing')
  assert.equal(call?.model, 'gpt-oss:20b')
  assert.equal(call?.sandbox, 'read-only')
  assert.equal(call?.approvalPolicy, 'never')
  assert.equal(call?.onProgress, onEvent)
  assert.equal(call?.profile, 'primary')
  assert.equal(call?.oss, true)
  assert.match(call?.prompt ?? '', /system prompt/u)
  assert.match(call?.prompt ?? '', /channel: imessage/u)
  assert.match(call?.prompt ?? '', /thread: chat-123/u)
  assert.match(call?.prompt ?? '', /Recent local conversation transcript/u)
  assert.match(call?.prompt ?? '', /User message:\nhello/u)
  assert.deepEqual(result, {
    provider: 'codex-cli',
    providerSessionId: 'thread-123',
    response: 'assistant reply',
    stderr: 'stderr output',
    stdout: 'stdout output',
    rawEvents: [{ type: 'thread.started', thread_id: 'thread-123' }],
  })
})

test('executeAssistantProviderTurn dispatches to the OpenAI-compatible adapter with transcript context', async () => {
  const languageModel = { provider: 'mock-model' }
  const abortController = new AbortController()
  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
  })

  const result = await executeAssistantProviderTurn({
    abortSignal: abortController.signal,
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    env: {
      OLLAMA_API_KEY: 'secret-token',
    },
    systemPrompt: 'system prompt',
    baseUrl: ' http://127.0.0.1:11434/v1 ',
    apiKeyEnv: ' OLLAMA_API_KEY ',
    providerName: ' ollama ',
    headers: {
      'X-Foo': 'bar',
    },
    model: ' gpt-oss:20b ',
    conversationMessages: [
      {
        role: 'user',
        content: 'older question',
      },
      {
        role: 'assistant',
        content: 'older answer',
      },
    ],
    sessionContext: {
      binding: {
        conversationKey: 'channel:telegram|thread:chat-55',
        channel: 'telegram',
        identityId: null,
        actorId: 'contact:alice',
        threadId: 'chat-55',
        threadIsDirect: true,
        delivery: {
          kind: 'thread',
          target: 'chat-55',
        },
      },
    },
    userPrompt: 'hello',
  })

  assert.deepEqual(
    providerMocks.resolveAssistantLanguageModel.mock.calls[0]?.[0],
    {
      apiKey: 'secret-token',
      apiKeyEnv: 'OLLAMA_API_KEY',
      baseUrl: 'http://127.0.0.1:11434/v1',
      headers: {
        'X-Foo': 'bar',
      },
      model: 'gpt-oss:20b',
      providerName: 'ollama',
    },
  )

  const generateCall = providerMocks.generateText.mock.calls[0]?.[0]
  assert.equal(generateCall?.model, languageModel)
  assert.equal(generateCall?.system, 'system prompt')
  assert.equal(generateCall?.abortSignal, abortController.signal)
  assert.equal(generateCall?.timeout, 10 * 60 * 1000)
  assert.equal(generateCall?.maxRetries, 2)
  assert.deepEqual(generateCall?.messages?.slice(0, 2), [
    {
      role: 'user',
      content: 'older question',
    },
    {
      role: 'assistant',
      content: 'older answer',
    },
  ])
  assert.match(generateCall?.messages?.[2]?.content ?? '', /Conversation context:/u)
  assert.match(generateCall?.messages?.[2]?.content ?? '', /channel: telegram/u)
  assert.match(generateCall?.messages?.[2]?.content ?? '', /thread: chat-55/u)
  assert.match(generateCall?.messages?.[2]?.content ?? '', /hello/u)
  assert.deepEqual(result, {
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
})

test('executeAssistantProviderTurn throws a base-url error before attempting OpenAI-compatible execution', async () => {
  providerMocks.resolveAssistantLanguageModel.mockImplementation(() => {
    throw new Error('resolveAssistantLanguageModel should not be called')
  })

  await assert.rejects(
    () =>
      executeAssistantProviderTurn({
        provider: 'openai-compatible',
        workingDirectory: '/tmp/vault',
        model: 'gpt-oss:20b',
        userPrompt: 'hello',
      }),
    (error: unknown) => {
      assert.equal((error as { code?: unknown } | null)?.code, 'ASSISTANT_BASE_URL_REQUIRED')
      return true
    },
  )
})

test('createSetupAssistantResolver refuses to pick a fake OpenAI-compatible model in non-interactive mode when discovery is empty', async () => {
  const discoverModels = vi.fn().mockResolvedValue([])
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      resolve: async () => null,
    },
    discoverModels,
    input: new PassThrough(),
    output: new PassThrough(),
  })

  await assert.rejects(
    () =>
      resolver.resolve({
        allowPrompt: false,
        commandName: 'setup',
        preset: 'openai-compatible',
        options: {} as any,
      }),
    /OpenAI-compatible setup requires an explicit model/u,
  )
  assert.equal(discoverModels.mock.calls.length, 1)
})

test('createSetupAssistantResolver chooses the first discovered OpenAI-compatible model in non-interactive mode', async () => {
  const discoverModels = vi.fn().mockResolvedValue(['llama3.3:70b', 'gpt-oss:20b'])
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      resolve: async () => null,
    },
    discoverModels,
    input: new PassThrough(),
    output: new PassThrough(),
  })

  const resolved = await resolver.resolve({
    allowPrompt: false,
    commandName: 'setup',
    preset: 'openai-compatible',
    options: {} as any,
  })

  assert.equal(resolved.provider, 'openai-compatible')
  assert.equal(resolved.model, 'llama3.3:70b')
})

test('executeAssistantProviderTurn enables reasoning summary traces when requested', async () => {
  const onTraceEvent = vi.fn()
  providerMocks.executeCodexPrompt.mockResolvedValue({
    finalMessage: 'assistant reply',
    jsonEvents: [],
    sessionId: 'thread-thinking',
    stderr: '',
    stdout: '',
  })

  await executeAssistantProviderTurn({
    provider: 'codex-cli',
    configOverrides: ['mcp_servers.healthybob_memory.command="node"'],
    workingDirectory: '/tmp/vault',
    userPrompt: 'hello',
    showThinkingTraces: true,
    onTraceEvent,
  })

  const call = providerMocks.executeCodexPrompt.mock.calls[0]?.[0]
  assert.deepEqual(call?.configOverrides, [
    'mcp_servers.healthybob_memory.command="node"',
    'model_reasoning_summary="auto"',
    'hide_agent_reasoning=false',
  ])
  assert.equal(call?.onTraceEvent, onTraceEvent)
})
