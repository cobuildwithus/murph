import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { beforeEach, test as baseTest, vi } from 'vitest'

const test = baseTest.sequential

const providerMocks = vi.hoisted(() => ({
  executeCodexPrompt: vi.fn(),
  generateText: vi.fn(),
  resolveAssistantLanguageModel: vi.fn(),
  stepCountIs: vi.fn((count: number) => ({
    count,
    kind: 'stepCountIs',
  })),
}))

const toolMocks = vi.hoisted(() => ({
  createDefaultAssistantToolCatalog: vi.fn(),
}))

const promptMocks = vi.hoisted(() => ({
  answers: [] as string[],
  prompts: [] as string[],
}))

vi.mock('ai', () => ({
  generateText: providerMocks.generateText,
  stepCountIs: providerMocks.stepCountIs,
}))

vi.mock('@murphai/assistant-engine/assistant-codex', () => ({
  executeCodexPrompt: providerMocks.executeCodexPrompt,
}))

vi.mock('@murphai/assistant-engine/model-harness', () => ({
  resolveAssistantLanguageModel: providerMocks.resolveAssistantLanguageModel,
}))

vi.mock('@murphai/assistant-engine/assistant-cli-tools', () => ({
  createDefaultAssistantToolCatalog: toolMocks.createDefaultAssistantToolCatalog,
}))

vi.mock('node:readline/promises', () => ({
  default: {
    createInterface: () => ({
      close() {},
      question: async (prompt: string) => {
        promptMocks.prompts.push(prompt)
        return promptMocks.answers.shift() ?? ''
      },
    }),
  },
}))

import {
  executeAssistantProviderTurnAttempt,
  executeAssistantProviderTurn,
  resolveAssistantProviderCapabilities,
} from '@murphai/assistant-engine/assistant/provider-registry'
import {
  defaultDiscoverOpenAICompatibleModels,
  type AssistantModelDiscoveryResult,
  resolveAssistantModelCatalog,
  resolveAssistantTargetCapabilities,
} from '@murphai/assistant-engine/assistant-provider-catalog'
import {
  buildAssistantProviderDefaultsPatch,
  resolveAssistantProviderDefaults,
} from '@murphai/operator-config/operator-config'
import { prepareAssistantDirectCliEnv } from '@murphai/assistant-engine/assistant-cli-access'
import {
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import {
  createSetupAssistantResolver,
  DEFAULT_SETUP_CODEX_REASONING_EFFORT,
} from '@murphai/setup-cli/setup-assistant'

beforeEach(() => {
  providerMocks.executeCodexPrompt.mockReset()
  providerMocks.generateText.mockReset()
  providerMocks.resolveAssistantLanguageModel.mockReset()
  providerMocks.stepCountIs.mockReset()
  providerMocks.stepCountIs.mockImplementation((count: number) => ({
    count,
    kind: 'stepCountIs',
  }))
  toolMocks.createDefaultAssistantToolCatalog.mockReset()
  promptMocks.answers.length = 0
  promptMocks.prompts.length = 0
  vi.unstubAllGlobals()
})

test('serializeAssistantProviderSessionOptions sanitizes settings for the selected provider', () => {
  assert.deepEqual(
    serializeAssistantProviderSessionOptions({
      provider: 'openai-compatible',
      model: ' gpt-oss:20b ',
      codexHome: ' /tmp/codex-1 ',
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

test('serializeAssistantProviderSessionOptions preserves an explicit Codex home for Codex targets', () => {
  assert.deepEqual(
    serializeAssistantProviderSessionOptions({
      provider: 'codex-cli',
      model: ' gpt-5.4 ',
      codexCommand: ' codex ',
      codexHome: ' /tmp/codex-1 ',
      profile: ' primary ',
      reasoningEffort: ' high ',
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      oss: false,
    }),
    {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      profile: 'primary',
      oss: false,
      codexHome: '/tmp/codex-1',
    },
  )
})

test('buildAssistantProviderDefaultsPatch keeps OpenAI-compatible public headers when only the model changes', () => {
  assert.deepEqual(
    buildAssistantProviderDefaultsPatch({
      defaults: {
        backend: {
          adapter: 'openai-compatible',
          model: 'llama3.2:latest',
          endpoint: 'http://127.0.0.1:11434/v1',
          apiKeyEnv: 'OLLAMA_API_KEY',
          providerName: 'ollama',
          headers: {
            Authorization: 'Bearer override-token',
            'X-Foo': 'bar',
          },
          reasoningEffort: null,
        },
        identityId: null,
        failoverRoutes: null,
        account: null,
        selfDeliveryTargets: null,
      },
      provider: 'openai-compatible',
      providerConfig: {
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
          Authorization: 'Bearer override-token',
          'X-Foo': 'bar',
        },
      },
    }),
    {
      backend: {
        adapter: 'openai-compatible',
        model: 'gpt-oss:20b',
        endpoint: 'http://127.0.0.1:11434/v1',
        apiKeyEnv: 'OLLAMA_API_KEY',
        providerName: 'ollama',
        headers: {
          'X-Foo': 'bar',
        },
        reasoningEffort: null,
      },
    },
  )
})

test('resolveAssistantProviderDefaults only returns the active saved backend target', () => {
  const openAiDefaults = resolveAssistantProviderDefaults(
    {
      backend: {
        adapter: 'codex-cli',
        model: 'gpt-5.4',
        approvalPolicy: 'on-request',
        codexCommand: '/opt/bin/codex',
        oss: true,
        profile: 'ops',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
      },
      identityId: null,
      failoverRoutes: null,
      account: null,
      selfDeliveryTargets: null,
    },
    'openai-compatible',
  )

  assert.equal(openAiDefaults, null)
})

test('resolveAssistantProviderCapabilities reports shared backend-facing capabilities', () => {
  assert.deepEqual(resolveAssistantProviderCapabilities('codex-cli'), {
    supportsModelDiscovery: false,
    supportsNativeResume: true,
    supportsReasoningEffort: true,
    supportsRichUserMessageContent: false,
  })
  assert.deepEqual(resolveAssistantProviderCapabilities('openai-compatible'), {
    supportsModelDiscovery: true,
    supportsNativeResume: true,
    supportsReasoningEffort: false,
    supportsRichUserMessageContent: true,
  })
})

test('resolveAssistantTargetCapabilities enables reasoning effort for OpenAI-compatible targets', () => {
  assert.deepEqual(
    resolveAssistantTargetCapabilities({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      providerName: 'openai',
    }),
    {
      supportsModelDiscovery: true,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: true,
    },
  )
  assert.deepEqual(
    resolveAssistantTargetCapabilities({
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'gpt-oss:20b',
      providerName: 'ollama',
    }),
    {
      supportsModelDiscovery: true,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: true,
    },
  )
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

test('resolveAssistantModelCatalog uses discovered OpenAI-compatible models and exposes reasoning options', () => {
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
  assert.equal(catalog.providerLabel, 'Ollama')
  assert.equal(catalog.reasoningOptions.length, 4)
})

test('resolveAssistantModelCatalog exposes reasoning options for official OpenAI-compatible targets', () => {
  const catalog = resolveAssistantModelCatalog({
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    providerName: 'openai',
    currentModel: 'gpt-5.4',
    currentReasoningEffort: 'medium',
    discoveredModels: ['gpt-5.4', 'gpt-4.1-mini'],
  })

  assert.equal(catalog.providerLabel, 'OpenAI')
  assert.equal(catalog.capabilities.supportsReasoningEffort, true)
  assert.equal(catalog.selectedModel?.id, 'gpt-5.4')
  assert.equal(catalog.selectedModel?.capabilities.reasoning, true)
  assert.equal(catalog.reasoningOptions.length, 4)
})

test('resolveAssistantModelCatalog normalizes discovery objects for official OpenAI-compatible targets', () => {
  const catalog = resolveAssistantModelCatalog({
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    providerName: 'openai',
    currentModel: 'gpt-5.4',
    discovery: {
      status: 'ok',
      message: null,
      models: [
        {
          id: 'gpt-5.4',
          label: 'gpt-5.4',
          description: 'Discovered from OpenAI.',
          source: 'discovered',
          capabilities: {
            images: false,
            pdf: false,
            reasoning: false,
            streaming: true,
            tools: true,
          },
        },
      ],
    },
  })

  assert.equal(catalog.selectedModel?.id, 'gpt-5.4')
  assert.equal(catalog.selectedModel?.capabilities.reasoning, true)
  assert.equal(catalog.reasoningOptions.length, 4)
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
  assert.equal(catalog.reasoningOptions.length, 4)
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
  assert.equal(headers?.Authorization, 'Bearer override-token')
  assert.equal('authorization' in (headers ?? {}), false)
})

test('defaultDiscoverOpenAICompatibleModels merges process env lookup with normalized header dedupe', async () => {
  const originalApiKey = process.env.MERGED_OLLAMA_API_KEY
  process.env.MERGED_OLLAMA_API_KEY = 'process-token'
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [],
    }),
  } as Response)
  vi.stubGlobal('fetch', fetchMock)

  try {
    await defaultDiscoverOpenAICompatibleModels('http://127.0.0.1:11434/v1', {
      apiKeyEnv: 'MERGED_OLLAMA_API_KEY',
      env: {
        LOCAL_ONLY: '1',
      },
      headers: {
        ' x-foo ': 'one',
        'X-Foo': 'two',
      },
    })
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.MERGED_OLLAMA_API_KEY
    } else {
      process.env.MERGED_OLLAMA_API_KEY = originalApiKey
    }
  }

  assert.deepEqual(
    (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined)
      ?.headers,
    {
      Accept: 'application/json',
      Authorization: 'Bearer process-token',
      'X-Foo': 'two',
    },
  )
})

test('executeAssistantProviderTurn defaults absent Codex reasoning to the Murph-owned default', async () => {
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
  assert.equal(call?.reasoningEffort, DEFAULT_SETUP_CODEX_REASONING_EFFORT)
  assert.equal(call?.sandbox, undefined)
  assert.equal(call?.approvalPolicy, undefined)
  assert.equal(call?.profile, undefined)
  assert.equal(call?.oss, false)
})

test('executeAssistantProviderTurn keeps explicit Codex prompts untouched', async () => {
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
    prompt: '  raw prompt  ',
    systemPrompt: 'system prompt',
    userPrompt: 'ignored user prompt',
  })

  const call = providerMocks.executeCodexPrompt.mock.calls[0]?.[0]
  assert.equal(call?.prompt, 'raw prompt')
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
    continuityContext: 'Recent local conversation transcript:\nUser: prior question',
    env: {
      PATH: '/tmp/murph-bin',
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
  assert.equal(call?.configOverrides, undefined)
  assert.deepEqual(
    call?.env,
    prepareAssistantDirectCliEnv({
      PATH: '/tmp/murph-bin',
    }),
  )
  assert.equal(call?.workingDirectory, '/tmp/vault')
  assert.equal(call?.resumeSessionId, 'thread-existing')
  assert.equal(call?.model, 'gpt-oss:20b')
  assert.equal(call?.sandbox, 'read-only')
  assert.equal(call?.approvalPolicy, 'never')
  assert.equal(typeof call?.onProgress, 'function')
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
    usage: {
      apiKeyEnv: null,
      baseUrl: null,
      cacheWriteTokens: null,
      cachedInputTokens: null,
      inputTokens: null,
      outputTokens: null,
      providerMetadataJson: null,
      providerName: null,
      providerRequestId: null,
      rawUsageJson: null,
      reasoningTokens: null,
      requestedModel: 'gpt-oss:20b',
      servedModel: 'gpt-oss:20b',
      totalTokens: null,
    },
  })
})

test('executeAssistantProviderTurnAttempt collects provider-agnostic activity labels from Codex progress events', async () => {
  const onEvent = vi.fn()
  providerMocks.executeCodexPrompt.mockImplementation(async (input: { onProgress?: Function }) => {
    input.onProgress?.({
      id: 'cmd-1',
      kind: 'command',
      label: '$ node /tmp/bin.js memory show --vault /tmp/vault',
      rawEvent: { type: 'item.started' },
      safeLabel: 'memory show',
      safeText: 'running memory show',
      state: 'running',
      text: '$ node /tmp/bin.js memory show --vault /tmp/vault',
    })
    input.onProgress?.({
      id: 'tool-1',
      kind: 'tool',
      label: 'murph.cli.run',
      rawEvent: { type: 'tool.call' },
      safeLabel: 'murph.cli.run',
      safeText: 'finished murph.cli.run',
      state: 'completed',
      text: 'Tool murph.cli.run',
    })
    input.onProgress?.({
      id: 'tool-2',
      kind: 'tool',
      label: 'murph.cli.run',
      rawEvent: { type: 'tool.call' },
      safeLabel: 'murph.cli.run',
      safeText: 'using murph.cli.run',
      state: 'running',
      text: 'Tool murph.cli.run',
    })

    return {
      finalMessage: 'assistant reply',
      jsonEvents: [],
      sessionId: 'thread-123',
      stderr: '',
      stdout: '',
    }
  })

  const result = await executeAssistantProviderTurnAttempt({
    provider: 'codex-cli',
    workingDirectory: '/tmp/vault',
    userPrompt: 'hello',
    onEvent,
  })

  assert.equal(result.ok, true)
  if (!result.ok) {
    assert.fail('expected the provider attempt to succeed')
  }
  assert.deepEqual(result.metadata.activityLabels, [
    'memory show',
    'murph.cli.run',
  ])
  assert.equal(onEvent.mock.calls.length, 3)
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
    usage: {
      apiKeyEnv: 'OLLAMA_API_KEY',
      baseUrl: 'http://127.0.0.1:11434/v1',
      cacheWriteTokens: null,
      cachedInputTokens: null,
      inputTokens: null,
      outputTokens: null,
      providerMetadataJson: null,
      providerName: 'ollama',
      providerRequestId: null,
      rawUsageJson: null,
      reasoningTokens: null,
      requestedModel: 'gpt-oss:20b',
      servedModel: 'gpt-oss:20b',
      totalTokens: null,
    },
  })
})

test('executeAssistantProviderTurn forwards rich user message content to the OpenAI-compatible adapter', async () => {
  const languageModel = { provider: 'mock-model' }
  const imageBytes = Buffer.from([0xff, 0xd8, 0xff])
  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
  })

  await executeAssistantProviderTurn({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'gpt-oss:20b',
    userPrompt: 'fallback text prompt',
    userMessageContent: [
      {
        type: 'text',
        text: 'Photo-only capture from Telegram.',
      },
      {
        type: 'image',
        image: imageBytes,
        mediaType: 'image/jpeg',
        mimeType: 'image/jpeg',
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
  })

  const generateCall = providerMocks.generateText.mock.calls[0]?.[0]
  const messageContent = generateCall?.messages?.[0]?.content
  assert.equal(Array.isArray(messageContent), true)
  assert.match(messageContent?.[0]?.text ?? '', /Conversation context:/u)
  assert.deepEqual(messageContent?.[1], {
    type: 'text',
    text: 'Photo-only capture from Telegram.',
  })
  assert.deepEqual(messageContent?.[2], {
    type: 'image',
    image: imageBytes,
    mediaType: 'image/jpeg',
    mimeType: 'image/jpeg',
  })
  assert.doesNotMatch(messageContent?.[0]?.text ?? '', /fallback text prompt/u)
})

test('executeAssistantProviderTurn chains official OpenAI responses and stores the response id', async () => {
  const languageModel = { provider: 'mock-model' }
  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
    providerMetadata: {
      openai: {
        responseId: 'resp_123',
      },
    },
  })

  const result = await executeAssistantProviderTurn({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'openai',
    model: 'gpt-5',
    systemPrompt: 'system prompt',
    userPrompt: 'hello',
    resumeProviderSessionId: 'resp_prev',
  })

  const generateCall = providerMocks.generateText.mock.calls[0]?.[0]
  assert.deepEqual(generateCall?.providerOptions, {
    openai: {
      store: false,
      previousResponseId: 'resp_prev',
    },
  })
  assert.equal(result.providerSessionId, 'resp_123')
  assert.ok(result.usage)
  assert.equal(result.usage.providerRequestId, 'resp_123')
})

test('executeAssistantProviderTurn forwards reasoning effort to official OpenAI responses', async () => {
  const languageModel = { provider: 'mock-model' }
  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
  })

  await executeAssistantProviderTurn({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'openai',
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    userPrompt: 'hello',
  })

  const generateCall = providerMocks.generateText.mock.calls[0]?.[0]
  assert.deepEqual(generateCall?.providerOptions, {
    openai: {
      reasoningEffort: 'medium',
      store: false,
    },
  })
})

test('executeAssistantProviderTurn forwards reasoning effort to Venice chat completions', async () => {
  const languageModel = { provider: 'mock-model' }
  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
  })

  await executeAssistantProviderTurn({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'https://api.venice.ai/api/v1',
    apiKeyEnv: 'VENICE_API_KEY',
    providerName: 'venice',
    model: 'openai-gpt-54',
    reasoningEffort: 'medium',
    userPrompt: 'hello',
  })

  const generateCall = providerMocks.generateText.mock.calls[0]?.[0]
  assert.deepEqual(generateCall?.providerOptions, {
    venice: {
      reasoningEffort: 'medium',
    },
  })
})

test('executeAssistantProviderTurn uses the prebuilt canonical assistant tool catalog for OpenAI-compatible tool-runtime turns', async () => {
  const languageModel = { provider: 'mock-model' }
  const aiSdkTools = {
    'assistant.knowledge.list': { description: 'knowledge-list' },
    'assistant.knowledge.search': { description: 'knowledge' },
    'assistant.selfTarget.list': { description: 'self-target' },
    'assistant.knowledge.upsert': { description: 'knowledge-upsert' },
    'vault.fs.readText': { description: 'read-text' },
    'vault.show': { description: 'show' },
  } as any
  const createAiSdkTools = vi.fn((mode?: string, options?: { onToolEvent?: Function }) => {
    assert.equal(mode, 'apply')
    assert.equal(typeof options?.onToolEvent, 'function')
    return aiSdkTools
  })

  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
  })

  await executeAssistantProviderTurn({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'gpt-oss:20b',
    systemPrompt: 'system prompt',
    userPrompt: 'hello',
    toolRuntime: {
      requestId: 'turn_123',
      vault: '/tmp/vault',
      toolCatalog: {
        createAiSdkTools,
        executeCalls: vi.fn(),
        hasTool: vi.fn(() => true),
        listTools: vi.fn(() => []),
      } as any,
    },
  })

  assert.equal(toolMocks.createDefaultAssistantToolCatalog.mock.calls.length, 0)
  assert.equal(createAiSdkTools.mock.calls.length, 1)
  assert.deepEqual(providerMocks.stepCountIs.mock.calls[0], [8])

  const generateCall = providerMocks.generateText.mock.calls[0]?.[0]
  assert.equal(generateCall?.maxRetries, 0)
  assert.deepEqual(generateCall?.stopWhen, {
    count: 8,
    kind: 'stepCountIs',
  })
  assert.deepEqual(generateCall?.tools, aiSdkTools)
})

test('executeAssistantProviderTurn records tool raw-events and trace updates for OpenAI-compatible tool turns', async () => {
  const languageModel = { provider: 'mock-model' }
  const onTraceEvent = vi.fn()
  const createAiSdkTools = vi.fn((mode?: string, options?: { onToolEvent?: Function }) => {
    assert.equal(mode, 'apply')
    options?.onToolEvent?.({
      kind: 'started',
      mode: 'apply',
      tool: 'assistant.knowledge.search',
      input: { text: 'lipids' },
    })
    options?.onToolEvent?.({
      kind: 'succeeded',
      mode: 'apply',
      tool: 'assistant.knowledge.search',
      input: { text: 'lipids' },
      result: { results: [] },
    })

    return {
      'assistant.knowledge.search': { description: 'knowledge' },
    } as any
  })

  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
  })

  const result = await executeAssistantProviderTurn({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'gpt-oss:20b',
    userPrompt: 'hello',
    onTraceEvent,
    toolRuntime: {
      requestId: 'turn_456',
      vault: '/tmp/vault',
      toolCatalog: {
        createAiSdkTools,
        executeCalls: vi.fn(),
        hasTool: vi.fn(() => true),
        listTools: vi.fn(() => []),
      } as any,
    },
  })

  assert.deepEqual(result.rawEvents, [
    {
      type: 'assistant.tool.started',
      sequence: 1,
      mode: 'apply',
      tool: 'assistant.knowledge.search',
      input: { text: 'lipids' },
    },
    {
      type: 'assistant.tool.succeeded',
      sequence: 2,
      mode: 'apply',
      tool: 'assistant.knowledge.search',
    },
  ])
  assert.equal(onTraceEvent.mock.calls.length, 2)
  assert.equal(onTraceEvent.mock.calls[0]?.[0]?.updates[0]?.text, 'Running assistant.knowledge.search…')
  assert.equal(onTraceEvent.mock.calls[1]?.[0]?.updates[0]?.text, 'Finished assistant.knowledge.search.')
})

test('executeAssistantProviderTurnAttempt reports provider-agnostic tool execution metadata on OpenAI-compatible failures', async () => {
  const languageModel = { provider: 'mock-model' }
  const onEvent = vi.fn()
  const createAiSdkTools = vi.fn((mode?: string, options?: { onToolEvent?: Function }) => {
    assert.equal(mode, 'apply')
    options?.onToolEvent?.({
      kind: 'started',
      mode: 'apply',
      tool: 'assistant.knowledge.search',
      input: { text: 'lipids' },
    })

    return {
      'assistant.knowledge.search': { description: 'knowledge' },
    } as any
  })

  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockRejectedValue(
    new Error('provider timed out after tool execution'),
  )

  const result = await executeAssistantProviderTurnAttempt({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'gpt-oss:20b',
    userPrompt: 'hello',
    onEvent,
    toolRuntime: {
      requestId: 'turn_789',
      vault: '/tmp/vault',
      toolCatalog: {
        createAiSdkTools,
        executeCalls: vi.fn(),
        hasTool: vi.fn(() => true),
        listTools: vi.fn(() => []),
      } as any,
    },
  })

  assert.equal(result.ok, false)
  if (result.ok) {
    assert.fail('expected the provider attempt to fail')
  }
  assert.equal(result.metadata.executedToolCount, 1)
  assert.deepEqual(result.metadata.activityLabels, ['assistant.knowledge.search'])
  assert.deepEqual(result.metadata.rawToolEvents, [
    {
      type: 'assistant.tool.started',
      sequence: 1,
      mode: 'apply',
      tool: 'assistant.knowledge.search',
      input: { text: 'lipids' },
    },
  ])
  assert.deepEqual(onEvent.mock.calls.map((call) => call[0]), [
    {
      id: 'tool-1',
      kind: 'tool',
      label: 'assistant.knowledge.search',
      rawEvent: {
        type: 'assistant.tool.started',
        sequence: 1,
        mode: 'apply',
        tool: 'assistant.knowledge.search',
        input: { text: 'lipids' },
      },
      safeLabel: 'assistant.knowledge.search',
      safeText: 'using assistant.knowledge.search',
      state: 'running',
      text: 'Running assistant.knowledge.search.',
    },
  ])
})

test('executeAssistantProviderTurn keeps explicit OpenAI-compatible prompts as the final user message', async () => {
  const languageModel = { provider: 'mock-model' }
  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
  })

  await executeAssistantProviderTurn({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'gpt-oss:20b',
    systemPrompt: 'system prompt',
    prompt: '  raw prompt  ',
    userPrompt: 'ignored user prompt',
    conversationMessages: [
      {
        role: 'assistant',
        content: 'older answer',
      },
    ],
  })

  const generateCall = providerMocks.generateText.mock.calls[0]?.[0]
  assert.equal(generateCall?.system, 'system prompt')
  assert.deepEqual(generateCall?.messages, [
    {
      role: 'assistant',
      content: 'older answer',
    },
    {
      role: 'user',
      content: 'raw prompt',
    },
  ])
})

test('executeAssistantProviderTurn surfaces AI SDK usage for OpenAI-compatible providers', async () => {
  const languageModel = { provider: 'mock-model' }
  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
    totalUsage: {
      inputTokens: 120,
      outputTokens: 45,
      reasoningTokens: 8,
      cachedInputTokens: 12,
      cacheWriteTokens: 3,
      totalTokens: 165,
    },
    providerMetadata: {
      provider: 'venice',
    },
    response: {
      requestId: 'req_123',
      model: 'venice/deepseek-r1-671b',
    },
  })

  const result = await executeAssistantProviderTurn({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'https://api.venice.ai/api/v1',
    apiKeyEnv: 'VENICE_API_KEY',
    providerName: 'venice',
    model: 'deepseek-r1-671b',
    userPrompt: 'hello',
  })

  assert.deepEqual(result.usage, {
    apiKeyEnv: 'VENICE_API_KEY',
    baseUrl: 'https://api.venice.ai/api/v1',
    cacheWriteTokens: 3,
    cachedInputTokens: 12,
    inputTokens: 120,
    outputTokens: 45,
    providerMetadataJson: {
      provider: 'venice',
    },
    providerName: 'venice',
    providerRequestId: 'req_123',
    rawUsageJson: {
      inputTokens: 120,
      outputTokens: 45,
      reasoningTokens: 8,
      cachedInputTokens: 12,
      cacheWriteTokens: 3,
      totalTokens: 165,
    },
    reasoningTokens: 8,
    requestedModel: 'deepseek-r1-671b',
    servedModel: 'venice/deepseek-r1-671b',
    totalTokens: 165,
  })
})

test('executeAssistantProviderTurn keeps totalTokens null when an OpenAI-compatible provider omits an explicit total', async () => {
  const languageModel = { provider: 'mock-model' }
  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
    totalUsage: {
      inputTokens: 120,
      outputTokens: 45,
      reasoningTokens: 8,
      cachedInputTokens: 12,
      cacheWriteTokens: 3,
    },
    providerMetadata: {
      provider: 'venice',
    },
    response: {
      requestId: 'req_124',
      model: 'venice/deepseek-r1-671b',
    },
  })

  const result = await executeAssistantProviderTurn({
    provider: 'openai-compatible',
    workingDirectory: '/tmp/vault',
    baseUrl: 'https://api.venice.ai/api/v1',
    apiKeyEnv: 'VENICE_API_KEY',
    providerName: 'venice',
    model: 'deepseek-r1-671b',
    userPrompt: 'hello',
  })

  assert.equal(result.usage?.inputTokens, 120)
  assert.equal(result.usage?.outputTokens, 45)
  assert.equal(result.usage?.totalTokens, 165)
})

test('executeAssistantProviderTurn extracts best-effort Codex usage from the final completion event', async () => {
  providerMocks.executeCodexPrompt.mockResolvedValue({
    finalMessage: 'assistant reply',
    jsonEvents: [
      { type: 'thread.started', thread_id: 'thread-123' },
      {
        type: 'turn.completed',
        model: 'gpt-5.4',
        usage: {
          input_tokens: 210,
          cached_input_tokens: 64,
          output_tokens: 98,
          total_tokens: 308,
        },
      },
    ],
    sessionId: 'thread-123',
    stderr: '',
    stdout: '',
  })

  const result = await executeAssistantProviderTurn({
    provider: 'codex-cli',
    workingDirectory: '/tmp/vault',
    model: 'gpt-5.4',
    userPrompt: 'hello',
  })

  assert.deepEqual(result.usage, {
    apiKeyEnv: null,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: 64,
    inputTokens: 210,
    outputTokens: 98,
    providerMetadataJson: {
      type: 'turn.completed',
      model: 'gpt-5.4',
      usage: {
        input_tokens: 210,
        cached_input_tokens: 64,
        output_tokens: 98,
        total_tokens: 308,
      },
    },
    providerName: null,
    providerRequestId: null,
    rawUsageJson: {
      input_tokens: 210,
      cached_input_tokens: 64,
      output_tokens: 98,
      total_tokens: 308,
    },
    reasoningTokens: null,
    requestedModel: 'gpt-5.4',
    servedModel: 'gpt-5.4',
    totalTokens: 308,
  })
})

test('executeAssistantProviderTurn keeps totalTokens null when Codex omits an explicit total', async () => {
  providerMocks.executeCodexPrompt.mockResolvedValue({
    finalMessage: 'assistant reply',
    jsonEvents: [
      { type: 'thread.started', thread_id: 'thread-123' },
      {
        type: 'turn.completed',
        model: 'gpt-5.4',
        usage: {
          input_tokens: 210,
          cached_input_tokens: 64,
          output_tokens: 98,
        },
      },
    ],
    sessionId: 'thread-123',
    stderr: '',
    stdout: '',
  })

  const result = await executeAssistantProviderTurn({
    provider: 'codex-cli',
    workingDirectory: '/tmp/vault',
    model: 'gpt-5.4',
    userPrompt: 'hello',
  })

  assert.equal(result.usage?.inputTokens, 210)
  assert.equal(result.usage?.outputTokens, 98)
  assert.equal(result.usage?.totalTokens, 308)
})

test('executeAssistantProviderTurn infers the OpenAI-compatible provider when endpoint config is supplied without an explicit provider', async () => {
  const languageModel = { provider: 'mock-model' }
  providerMocks.resolveAssistantLanguageModel.mockReturnValue(languageModel)
  providerMocks.generateText.mockResolvedValue({
    text: 'assistant reply',
  })

  const result = await executeAssistantProviderTurn({
    workingDirectory: '/tmp/vault',
    baseUrl: ' http://127.0.0.1:11434/v1 ',
    apiKeyEnv: ' OLLAMA_API_KEY ',
    providerName: ' ollama ',
    headers: {
      'X-Foo': 'bar',
    },
    model: ' gpt-oss:20b ',
    userPrompt: 'hello',
  })

  assert.deepEqual(
    providerMocks.resolveAssistantLanguageModel.mock.calls[0]?.[0],
    {
      apiKeyEnv: 'OLLAMA_API_KEY',
      baseUrl: 'http://127.0.0.1:11434/v1',
      headers: {
        'X-Foo': 'bar',
      },
      model: 'gpt-oss:20b',
      providerName: 'ollama',
    },
  )
  assert.equal(providerMocks.executeCodexPrompt.mock.calls.length, 0)
  assert.equal(result.provider, 'openai-compatible')
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
  const discoverModels = vi.fn().mockResolvedValue(createDiscoveryResult([]))
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
  const discoverModels = vi
    .fn()
    .mockResolvedValue(createDiscoveryResult(['llama3.3:70b', 'gpt-oss:20b']))
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

test('createSetupAssistantResolver requires a non-empty OpenAI-compatible model when discovery is empty', async () => {
  const discoverModels = vi.fn().mockResolvedValue(createDiscoveryResult([]))
  promptMocks.answers.push('', '', '', 'custom-model')
  const input = new PassThrough()
  const output = new PassThrough()
  const outputChunks: string[] = []
  output.on('data', (chunk: Buffer | string) => {
    outputChunks.push(chunk.toString())
  })
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      resolve: async () => null,
    },
    discoverModels,
    input,
    output,
  })

  const resolved = await resolver.resolve({
    allowPrompt: true,
    commandName: 'setup',
    preset: 'openai-compatible',
    options: {} as any,
  })

  assert.equal(resolved.provider, 'openai-compatible')
  assert.equal(resolved.model, 'custom-model')
  assert.match(outputChunks.join(''), /A model id is required\./u)
  assert.deepEqual(promptMocks.prompts, [
    'Ollama endpoint URL [http://127.0.0.1:11434/v1]: ',
    'API key env var name (leave blank if this local endpoint does not need one): ',
    'Default model to use: ',
    'Default model to use: ',
  ])
})

test('createSetupAssistantResolver applies named provider preset defaults before discovery', async () => {
  const discoverModels = vi
    .fn()
    .mockResolvedValue(createDiscoveryResult(['openai/gpt-4.1-mini']))
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
    options: {
      assistantProviderPreset: 'openrouter',
    } as any,
  })

  assert.equal(discoverModels.mock.calls.length, 1)
  assert.deepEqual(discoverModels.mock.calls[0]?.[0], {
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    providerName: 'openrouter',
  })
  assert.equal(resolved.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(resolved.apiKeyEnv, 'OPENROUTER_API_KEY')
  assert.equal(resolved.providerName, 'openrouter')
  assert.equal(resolved.model, 'openai/gpt-4.1-mini')
  assert.match(resolved.detail, /OpenRouter/u)
})

test('createSetupAssistantResolver defaults Codex reasoning effort when it is not specified', async () => {
  let resolveCodexHomeInput: Record<string, unknown> | null = null
  const resolveCodexHome = vi.fn(async (input: {
    allowPrompt: boolean
    currentCodexHome?: string | null
    explicitCodexHome?: string | null
    input: NodeJS.ReadableStream
    output: NodeJS.WritableStream
  }) => {
    resolveCodexHomeInput = input
    return {
      codexHome: '/tmp/codex-1',
      discoveredHomes: ['/tmp/codex-1'],
    }
  })
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      resolve: async () => null,
    },
    input: new PassThrough(),
    output: new PassThrough(),
    resolveCodexHome,
  })

  const resolved = await resolver.resolve({
    allowPrompt: false,
    commandName: 'setup',
    preset: 'codex',
    options: {
      assistantModel: 'gpt-5.4',
    } as any,
  })

  assert.equal(resolved.provider, 'codex-cli')
  assert.equal(resolved.codexHome, '/tmp/codex-1')
  assert.equal(
    resolved.reasoningEffort,
    DEFAULT_SETUP_CODEX_REASONING_EFFORT,
  )
  const capturedCodexHomeInput = resolveCodexHomeInput
  assert.notEqual(capturedCodexHomeInput, null)
  if (capturedCodexHomeInput === null) {
    throw new Error('Expected Codex-home resolver input to be captured.')
  }
  assert.equal(capturedCodexHomeInput['allowPrompt'], false)
  assert.equal(capturedCodexHomeInput['currentCodexHome'], null)
  assert.equal(capturedCodexHomeInput['explicitCodexHome'], null)
})

test('createSetupAssistantResolver accepts reasoning effort for OpenAI-compatible targets', async () => {
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      resolve: async () => null,
    },
    input: new PassThrough(),
    output: new PassThrough(),
  })

  const resolved = await resolver.resolve({
    allowPrompt: false,
    commandName: 'setup',
    preset: 'openai-compatible',
    options: {
      assistantModel: 'gpt-5.4',
      assistantProviderPreset: 'openai',
      assistantReasoningEffort: 'medium',
    } as any,
  })

  assert.equal(resolved.baseUrl, 'https://api.openai.com/v1')
  assert.equal(resolved.providerName, 'openai')
  assert.equal(resolved.reasoningEffort, 'medium')
})

test('createSetupAssistantResolver accepts reasoning effort for Venice', async () => {
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      resolve: async () => null,
    },
    input: new PassThrough(),
    output: new PassThrough(),
  })

  const resolved = await resolver.resolve({
    allowPrompt: false,
    commandName: 'setup',
    preset: 'openai-compatible',
    options: {
      assistantProviderPreset: 'venice',
      assistantModel: 'openai-gpt-54',
      assistantReasoningEffort: 'medium',
    } as any,
  })

  assert.equal(resolved.baseUrl, 'https://api.venice.ai/api/v1')
  assert.equal(resolved.providerName, 'venice')
  assert.equal(resolved.reasoningEffort, 'medium')
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
    workingDirectory: '/tmp/vault',
    userPrompt: 'hello',
    showThinkingTraces: true,
    onTraceEvent,
  })

  const call = providerMocks.executeCodexPrompt.mock.calls[0]?.[0]
  assert.deepEqual(call?.configOverrides, [
    'model_reasoning_summary="auto"',
    'hide_agent_reasoning=false',
  ])
  assert.equal(call?.onTraceEvent, onTraceEvent)
})

function createDiscoveryResult(
  models: readonly string[],
  input?: Partial<AssistantModelDiscoveryResult>,
): AssistantModelDiscoveryResult {
  return {
    status: input?.status ?? 'ok',
    message: input?.message ?? null,
    models: models.map((id) => ({
      id,
      label: id,
      description: `Discovered ${id}.`,
      source: 'discovered',
      capabilities: {
        images: false,
        pdf: false,
        reasoning: false,
        streaming: true,
        tools: true,
      },
    })),
  }
}
