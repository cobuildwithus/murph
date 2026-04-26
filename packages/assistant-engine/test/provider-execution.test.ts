import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tool } from 'ai'
import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { z } from 'zod'
import type {
  AssistantCreateAiSdkToolsOptions,
  AssistantToolCatalog,
  AssistantToolExecutionMode,
} from '../src/model-harness.ts'
import { createAssistantUsageAttribution } from '../src/assistant/usage-attribution.ts'

const providerMocks = vi.hoisted(() => ({
  executeCodexAppServerTurn: vi.fn(),
  generateText: vi.fn(),
  prepareAssistantDirectCliEnv: vi.fn(),
  resolveAssistantLanguageModel: vi.fn(),
  stepCountIs: vi.fn(),
  tool: vi.fn((definition) => definition),
}))

vi.mock('ai', () => ({
  generateText: providerMocks.generateText,
  stepCountIs: providerMocks.stepCountIs,
  tool: providerMocks.tool,
}))

vi.mock('../src/model-harness.ts', () => ({
  resolveAssistantLanguageModel: providerMocks.resolveAssistantLanguageModel,
}))

vi.mock('../src/assistant-cli-access.ts', () => ({
  prepareAssistantDirectCliEnv: providerMocks.prepareAssistantDirectCliEnv,
}))

vi.mock('../src/assistant-codex.ts', () => ({
  executeCodexAppServerTurn: providerMocks.executeCodexAppServerTurn,
}))

import { codexCliProviderDefinition } from '../src/assistant/providers/codex-cli.ts'
import {
  openAiCompatibleProviderDefinition,
  resolveOpenAiCompatibleProviderVisibleToolAliases,
} from '../src/assistant/providers/openai-compatible.ts'

const WORKING_DIRECTORY = '/tmp/assistant-engine-provider-tests'

beforeEach(() => {
  providerMocks.stepCountIs.mockImplementation((count: number) => ({
    kind: 'step-count',
    count,
  }))
  providerMocks.resolveAssistantLanguageModel.mockImplementation(() => ({
    provider: 'mock-language-model',
  }))
  providerMocks.prepareAssistantDirectCliEnv.mockImplementation((env) => ({
    ...(env ?? {}),
    PATH: '/prepared/bin',
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('openAiCompatibleProviderDefinition.discoverModels', () => {
  it('reports unsupported configs before making a network request', async () => {
    await expect(
      openAiCompatibleProviderDefinition.discoverModels({
        config: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
      }),
    ).resolves.toEqual({
      message:
        'OpenAI-compatible model discovery requires an OpenAI-compatible provider config.',
      models: [],
      status: 'unsupported',
    })

    await expect(
      openAiCompatibleProviderDefinition.discoverModels({
        config: normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
        }),
      }),
    ).resolves.toEqual({
      message: 'OpenAI-compatible model discovery requires a base URL.',
      models: [],
      status: 'unsupported',
    })
  })

  it('maps endpoint failures to unauthorized and unreachable discovery states', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('denied', {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(
        new Response('bad gateway', {
          status: 502,
        }),
      )
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const config = normalizeAssistantProviderConfig({
      provider: 'openai-compatible',
      baseUrl: 'https://models.example.com/v1',
      apiKeyEnv: 'DISCOVERY_KEY',
    })

    await expect(
      openAiCompatibleProviderDefinition.discoverModels({
        config,
        env: {
          DISCOVERY_KEY: 'secret-key',
        },
      }),
    ).resolves.toEqual({
      message:
        'The endpoint rejected the configured credentials while discovering models.',
      models: [],
      status: 'unauthorized',
    })

    await expect(
      openAiCompatibleProviderDefinition.discoverModels({
        config,
        env: {
          DISCOVERY_KEY: 'secret-key',
        },
      }),
    ).resolves.toEqual({
      message: 'The endpoint returned 502 while discovering models.',
      models: [],
      status: 'unreachable',
    })

    await expect(
      openAiCompatibleProviderDefinition.discoverModels({
        config,
        env: {
          DISCOVERY_KEY: 'secret-key',
        },
      }),
    ).resolves.toEqual({
      message: 'connect ECONNREFUSED',
      models: [],
      status: 'unreachable',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL('models', 'https://models.example.com/v1/'),
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer secret-key',
        },
        signal: expect.any(AbortSignal),
      }),
    )
  })
})

describe('openAiCompatibleProviderDefinition.executeTurn', () => {
  it('rejects unsupported configs and missing model resolution inputs', async () => {
    await expect(
      openAiCompatibleProviderDefinition.executeTurn({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_PROVIDER_UNSUPPORTED',
      message:
        'OpenAI-compatible execution requires an OpenAI-compatible provider config.',
    })

    await expect(
      openAiCompatibleProviderDefinition.executeTurn({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
          model: 'gpt-4.1-mini',
        }),
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_BASE_URL_REQUIRED',
      message: 'The openai-compatible assistant provider requires a base URL.',
    })

    await expect(
      openAiCompatibleProviderDefinition.executeTurn({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
        }),
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_MODEL_REQUIRED',
      message: 'The openai-compatible assistant provider requires a model id.',
    })
  })

  it('shapes OpenAI Responses requests, tracks tool events, and falls back to the resumed session id', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Resolved answer',
      totalUsage: {
        cache_write_tokens: 1,
        cached_input_tokens: 2,
        input_tokens: 11,
        output_tokens: 7,
        reasoning_tokens: 3,
        total_tokens: 18,
      },
      providerMetadata: {
        openai: {},
      },
      raw: {
        model: 'gpt-4.1-mini-2026-04-01',
      },
      response: {
        model: 'gpt-4.1-mini-2026-04-01',
        requestId: 'req-openai-1',
      },
    })

    const onEvent = vi.fn()
    const onTraceEvent = vi.fn()
    const createAiSdkTools: AssistantToolCatalog['createAiSdkTools'] = (
      _mode: AssistantToolExecutionMode = 'preview',
      callbacks: AssistantCreateAiSdkToolsOptions = {},
    ) => {
      callbacks.onToolEvent?.({
        input: {},
        kind: 'previewed',
        mode: 'apply',
        tool: 'web.search',
      })
      callbacks.onToolEvent?.({
        input: {
          query: 'murph',
        },
        kind: 'started',
        mode: 'apply',
        tool: 'web.search',
      })
      callbacks.onToolEvent?.({
        errorCode: 'DENIED',
        errorMessage: 'Refused',
        input: {
          path: 'journal/today.md',
        },
        kind: 'failed',
        mode: 'apply',
        tool: 'vault.write',
      })

      return {
        'web.search': tool({
          description: 'Mock web search tool',
          execute: async () => ({}),
          inputSchema: z.object({
            query: z.string().optional(),
          }),
        }),
      }
    }

    const toolCatalog: AssistantToolCatalog = {
      createAiSdkTools: vi.fn(createAiSdkTools),
      executeCalls: vi.fn(),
      hasTool: vi.fn(),
      listTools: vi.fn(),
    }

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      conversationMessages: [
        {
          content: 'Earlier answer',
          role: 'assistant',
        },
      ],
      env: {
        OPENAI_API_KEY: 'test-openai-key',
      },
      onEvent,
      onTraceEvent,
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        presetId: 'openai',
        providerName: 'OpenAI',
        reasoningEffort: 'medium',
        webSearch: 'murph',
      }),
      resumeProviderSessionId: 'resp_resume_session_123',
      systemPrompt: 'You are concise.',
      toolRuntime: {
        toolCatalog,
        vault: '/tmp/test-vault',
      },
      userPrompt: 'What changed today?',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toEqual({
      metadata: {
        activityLabels: [],
        executedToolCount: 1,
        providerActionCount: 0,
        rawToolEvents: [
          {
            mode: 'apply',
            sequence: 1,
            tool: 'web.search',
            type: 'assistant.tool.previewed',
          },
          {
            input: {
              query: 'murph',
            },
            mode: 'apply',
            sequence: 2,
            tool: 'web.search',
            type: 'assistant.tool.started',
          },
          {
            errorCode: 'DENIED',
            errorMessage: 'Refused',
            input: {
              path: 'journal/today.md',
            },
            mode: 'apply',
            sequence: 3,
            tool: 'vault.write',
            type: 'assistant.tool.failed',
          },
        ],
      },
      ok: true,
      result: {
        provider: 'openai-compatible',
        providerSessionId: 'resp_resume_session_123',
        rawEvents: [
          {
            mode: 'apply',
            sequence: 1,
            tool: 'web.search',
            type: 'assistant.tool.previewed',
          },
          {
            input: {
              query: 'murph',
            },
            mode: 'apply',
            sequence: 2,
            tool: 'web.search',
            type: 'assistant.tool.started',
          },
          {
            errorCode: 'DENIED',
            errorMessage: 'Refused',
            input: {
              path: 'journal/today.md',
            },
            mode: 'apply',
            sequence: 3,
            tool: 'vault.write',
            type: 'assistant.tool.failed',
          },
        ],
        response: 'Resolved answer',
        stderr: '',
        stdout: '',
        usage: {
          apiKeyEnv: 'OPENAI_API_KEY',
          baseUrl: 'https://api.openai.com/v1',
          cacheWriteTokens: 1,
          cachedInputTokens: 2,
          inputTokens: 11,
          outputTokens: 7,
          providerMetadataJson: {
            openai: {},
          },
          providerName: 'OpenAI',
          providerRequestId: 'req-openai-1',
          rawUsageJson: {
            cache_write_tokens: 1,
            cached_input_tokens: 2,
            input_tokens: 11,
            output_tokens: 7,
            reasoning_tokens: 3,
            total_tokens: 18,
          },
          reasoningTokens: 3,
          requestedModel: 'gpt-4.1-mini',
          servedModel: 'gpt-4.1-mini-2026-04-01',
          totalTokens: 18,
        },
      },
    })

    expect(providerMocks.stepCountIs).toHaveBeenCalledWith(8)
    expect(toolCatalog.createAiSdkTools).toHaveBeenCalledWith(
      'apply',
      expect.objectContaining({
        onToolEvent: expect.any(Function),
      }),
    )
    expect(providerMocks.resolveAssistantLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-openai-key',
        apiKeyEnv: 'OPENAI_API_KEY',
        apiKeyEnvValue: 'test-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        executionDriver: 'responses',
        model: 'gpt-4.1-mini',
        providerName: 'OpenAI',
      }),
    )
    expect(providerMocks.generateText.mock.calls[0]?.[0]).toMatchObject({
      abortSignal: undefined,
      maxRetries: 0,
      messages: [
        {
          content: 'What changed today?',
          role: 'user',
        },
      ],
      model: {
        provider: 'mock-language-model',
      },
      providerOptions: {
        openai: {
          previousResponseId: 'resp_resume_session_123',
          reasoningEffort: 'medium',
          store: true,
        },
      },
      stopWhen: {
        count: 8,
        kind: 'step-count',
      },
      system: 'You are concise.',
      timeout: 600000,
      tools: expect.objectContaining({
        web_search: expect.objectContaining({
          description: 'Mock web search tool',
        }),
      }),
    })
    expect(providerMocks.generateText.mock.calls[0]?.[0]?.tools).not.toHaveProperty('web.search')
    expect(providerMocks.generateText.mock.calls[0]?.[0]?.tools).not.toHaveProperty('perplexity_search')
    expect(onEvent).toHaveBeenCalledTimes(3)
    expect(onEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'tool-1',
        kind: 'tool',
        safeLabel: 'web.search',
        safeText: 'planned web.search',
        state: 'completed',
        text: 'Planned web.search.',
      }),
    )
    expect(onTraceEvent).toHaveBeenNthCalledWith(
      1,
      {
        providerSessionId: null,
        rawEvent: {
          mode: 'apply',
          sequence: 1,
          tool: 'web.search',
          type: 'assistant.tool.previewed',
        },
        updates: [
          {
            kind: 'status',
            text: 'Planned web.search.',
          },
        ],
      },
    )
    expect(onTraceEvent).toHaveBeenNthCalledWith(
      3,
      {
        providerSessionId: null,
        rawEvent: {
          errorCode: 'DENIED',
          errorMessage: 'Refused',
          input: {
            path: 'journal/today.md',
          },
          mode: 'apply',
          sequence: 3,
          tool: 'vault.write',
          type: 'assistant.tool.failed',
        },
        updates: [
          {
            kind: 'error',
            text: 'vault.write failed: Refused',
          },
        ],
      },
    )
  })

  it('extracts cached input tokens from nested OpenAI Responses usage details', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Nested usage answer',
      response: {
        id: 'response-openai-nested-input-details',
        model: 'gpt-5.4',
      },
      usage: {
        input_tokens: 25,
        input_tokens_details: {
          cached_tokens: 9,
        },
        output_tokens: 5,
        total_tokens: 30,
      },
    })

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      env: {
        OPENAI_API_KEY: 'test-openai-key',
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4',
        providerName: 'OpenAI',
      }),
      userPrompt: 'What changed today?',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        usage: {
          cachedInputTokens: 9,
          inputTokens: 25,
        },
      },
    })
  })

  it('extracts cached input tokens from nested Chat Completions prompt details', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Nested chat usage answer',
      response: {
        id: 'response-openai-nested-prompt-details',
        model: 'gpt-5.4',
      },
      usage: {
        completion_tokens: 6,
        prompt_tokens: 41,
        prompt_tokens_details: {
          cached_tokens: 17,
        },
        total_tokens: 47,
      },
    })

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      env: {
        OPENAI_API_KEY: 'test-openai-key',
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4',
        providerName: 'OpenAI',
      }),
      userPrompt: 'What changed today?',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        usage: {
          cachedInputTokens: 17,
          inputTokens: 41,
        },
      },
    })
  })

  it('falls back fresh when an OpenAI Responses resume id is not a response id', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Fresh answer',
      response: {
        id: 'gen_gateway_1',
        model: 'gpt-4.1-mini-2026-04-01',
      },
      usage: {
        input_tokens: 4,
        output_tokens: 6,
        total_tokens: 10,
      },
    })

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      continuityContext: 'Recovered bootstrap context.',
      conversationMessages: [
        {
          content: 'Earlier question',
          role: 'user',
        },
        {
          content: 'Earlier answer',
          role: 'assistant',
        },
      ],
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        presetId: 'openai',
        providerName: 'OpenAI',
      }),
      resumeProviderSessionId: 'gen_gateway_123',
      userPrompt: 'Please reply now.',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        providerSessionId: null,
        response: 'Fresh answer',
      },
    })
    expect(providerMocks.generateText.mock.calls[0]?.[0]).toMatchObject({
      messages: [
        {
          content:
            'Conversation so far:\nUser:\nEarlier question\n\nAssistant:\nEarlier answer',
          role: 'user',
        },
        {
          content: 'Recovered bootstrap context.\n\nPlease reply now.',
          role: 'user',
        },
      ],
      providerOptions: {
        openai: {
          store: true,
        },
      },
    })
    expect(
      providerMocks.generateText.mock.calls[0]?.[0]?.providerOptions?.openai,
    ).not.toHaveProperty('previousResponseId')
  })

  it('uses normalized provider option keys outside the OpenAI Responses API and leaves provider sessions unset', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Proxy answer',
      response: {
        id: 'response-proxy-1',
        modelId: 'proxy-model-2',
      },
      usage: {
        completion_tokens: 8,
        prompt_tokens: 5,
      },
    })

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://proxy.example.com/v1',
        model: 'proxy-model-1',
        providerName: 'Acme Provider',
        reasoningEffort: 'low',
      }),
      prompt: '  Use the proxy endpoint  ',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toEqual({
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        providerActionCount: 0,
        rawToolEvents: [],
      },
      ok: true,
      result: {
        provider: 'openai-compatible',
        providerSessionId: null,
        rawEvents: [],
        response: 'Proxy answer',
        stderr: '',
        stdout: '',
        usage: {
          apiKeyEnv: null,
          baseUrl: 'https://proxy.example.com/v1',
          cacheWriteTokens: null,
          cachedInputTokens: null,
          inputTokens: 5,
          outputTokens: 8,
          providerMetadataJson: null,
          providerName: 'Acme Provider',
          providerRequestId: 'response-proxy-1',
          rawUsageJson: {
            completion_tokens: 8,
            prompt_tokens: 5,
          },
          reasoningTokens: null,
          requestedModel: 'proxy-model-1',
          servedModel: 'proxy-model-2',
          totalTokens: 13,
        },
      },
    })

    expect(providerMocks.generateText).toHaveBeenCalledWith({
      abortSignal: undefined,
      maxRetries: 2,
      messages: [
        {
          content: 'Use the proxy endpoint',
          role: 'user',
        },
      ],
      model: {
        provider: 'mock-language-model',
      },
      onStepFinish: expect.any(Function),
      system: undefined,
      timeout: 600000,
    })
  })

  it('emits succeeded tool progress and drops non-Responses ids when no resumed session is available', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Finished tool work',
      totalUsage: {
        input_tokens: 4,
        output_tokens: 6,
        total_tokens: 10,
      },
      response: {
        id: 'response-openai-2',
        model: 'gpt-4.1-mini-2026-04-01',
      },
    })

    const onEvent = vi.fn()
    const onTraceEvent = vi.fn()
    const toolCatalog: AssistantToolCatalog = {
      createAiSdkTools: vi.fn(
        (_mode: AssistantToolExecutionMode = 'preview', _callbacks: AssistantCreateAiSdkToolsOptions = {}) => ({
          webSearch: tool({
            description: 'Mock web search tool',
            execute: async () => ({}),
            inputSchema: z.object({
              query: z.string().optional(),
            }),
          }),
        }),
      ),
      executeCalls: vi.fn(),
      hasTool: vi.fn(),
      listTools: vi.fn(),
    }

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      onEvent,
      onTraceEvent,
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        presetId: 'openai',
        providerName: 'OpenAI',
        reasoningEffort: 'medium',
      }),
      resumeProviderSessionId: '   ',
      toolRuntime: {
        toolCatalog,
        vault: '/tmp/test-vault',
      },
      userPrompt: 'Run the tool and summarize the result.',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toEqual({
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        providerActionCount: 0,
        rawToolEvents: [],
      },
      ok: true,
      result: {
        provider: 'openai-compatible',
        providerSessionId: null,
        rawEvents: [],
        response: 'Finished tool work',
        stderr: '',
        stdout: '',
        usage: {
          apiKeyEnv: null,
          baseUrl: 'https://api.openai.com/v1',
          cacheWriteTokens: null,
          cachedInputTokens: null,
          inputTokens: 4,
          outputTokens: 6,
          providerMetadataJson: null,
          providerName: 'OpenAI',
          providerRequestId: 'response-openai-2',
          rawUsageJson: {
            input_tokens: 4,
            output_tokens: 6,
            total_tokens: 10,
          },
          reasoningTokens: null,
          requestedModel: 'gpt-4.1-mini',
          servedModel: 'gpt-4.1-mini-2026-04-01',
          totalTokens: 10,
        },
      },
    })

    expect(providerMocks.generateText.mock.calls[0]?.[0]).toMatchObject({
      abortSignal: undefined,
      maxRetries: 0,
      messages: [
        {
          content: 'Run the tool and summarize the result.',
          role: 'user',
        },
      ],
      model: {
        provider: 'mock-language-model',
      },
      providerOptions: {
        openai: {
          reasoningEffort: 'medium',
          store: true,
        },
      },
      stopWhen: {
        count: 8,
        kind: 'step-count',
      },
      system: undefined,
      timeout: 600000,
      tools: expect.objectContaining({
        web_search: expect.objectContaining({
          description: 'Native OpenAI web search tool',
        }),
      }),
    })
    expect(onEvent).not.toHaveBeenCalled()
    expect(onTraceEvent).not.toHaveBeenCalled()
  })

  it('counts deduped provider-executed native web search actions in success metadata', async () => {
    providerMocks.generateText.mockImplementationOnce(async (options) => {
      options.onStepFinish?.({
        toolCalls: [
          {
            providerExecuted: true,
            toolCallId: 'provider-web-search-1',
          },
        ],
        toolResults: [
          {
            providerExecuted: true,
            toolCallId: 'provider-web-search-1',
          },
        ],
      })

      return {
        response: {
          id: 'response-openai-provider-web-search',
          model: 'gpt-4.1-mini-2026-04-01',
        },
        text: 'Provider-native web search answer',
        toolCalls: [
          {
            providerExecuted: true,
            toolCallId: 'provider-web-search-1',
          },
        ],
        toolResults: [
          {
            providerExecuted: true,
            toolCallId: 'provider-web-search-1',
          },
        ],
        totalUsage: {
          input_tokens: 5,
          output_tokens: 8,
          total_tokens: 13,
        },
      }
    })

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        presetId: 'openai',
        providerName: 'OpenAI',
        webSearch: 'provider',
      }),
      prompt: 'Search the web natively and answer.',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toMatchObject({
      metadata: {
        executedToolCount: 0,
        providerActionCount: 1,
      },
      ok: true,
    })
    expect(providerMocks.generateText.mock.calls[0]?.[0]).toMatchObject({
      onStepFinish: expect.any(Function),
      tools: {
        web_search: expect.objectContaining({
          description: 'Native OpenAI web search tool',
        }),
      },
    })
  })

  it('filters Murph web-read helpers when provider-native web search is selected', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Native search answer',
      response: {
        id: 'response-openai-web-native',
        model: 'gpt-4.1-mini',
      },
    })

    const toolCatalog: AssistantToolCatalog = {
      createAiSdkTools: vi.fn(() => ({
        'web.fetch': tool({
          description: 'Mock web fetch tool',
          execute: async () => ({}),
          inputSchema: z.object({ url: z.string() }),
        }),
        'web.pdf.read': tool({
          description: 'Mock web PDF tool',
          execute: async () => ({}),
          inputSchema: z.object({ url: z.string() }),
        }),
        'web.search': tool({
          description: 'Mock Murph web search tool',
          execute: async () => ({}),
          inputSchema: z.object({ query: z.string() }),
        }),
      })),
      executeCalls: vi.fn(),
      hasTool: vi.fn(),
      listTools: vi.fn(),
    }

    await openAiCompatibleProviderDefinition.executeTurn({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        presetId: 'openai',
        providerName: 'OpenAI',
        webSearch: 'provider',
      }),
      prompt: 'Search natively.',
      toolRuntime: {
        toolCatalog,
        vault: '/tmp/test-vault',
      },
      workingDirectory: WORKING_DIRECTORY,
    })

    const tools = providerMocks.generateText.mock.calls[0]?.[0]?.tools
    expect(tools).toMatchObject({
      web_search: expect.objectContaining({
        description: 'Native OpenAI web search tool',
      }),
    })
    expect(tools).not.toHaveProperty('web_fetch')
    expect(tools).not.toHaveProperty('web_pdf_read')
  })

  it('centralizes OpenAI-compatible provider-visible tool aliases', () => {
    expect(
      resolveOpenAiCompatibleProviderVisibleToolAliases([
        'vault.cli.run',
        'vault_cli_run',
        'web.pdf.read',
      ]),
    ).toEqual({
      'vault.cli.run': 'vault_cli_run',
      vault_cli_run: 'vault_cli_run_2',
      'web.pdf.read': 'web_pdf_read',
    })
  })

  it('returns a failed provider result when generateText throws', async () => {
    const providerError = Object.assign(new Error('gateway timeout'), {
      responseBody: JSON.stringify({
        error: {
          code: 'rate_limit_exceeded',
          message: 'Azure provider was rate limited.',
          type: 'rate_limit_error',
        },
      }),
      statusCode: 429,
    })
    providerMocks.generateText.mockRejectedValueOnce(providerError)

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        gatewayOnlyProviders: ['openai'],
        model: 'openai/gpt-5.4',
        presetId: 'vercel-ai-gateway',
        providerName: 'vercel-ai-gateway',
      }),
      prompt: 'Retry this request',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toMatchObject({
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        providerActionCount: 0,
        rawToolEvents: [],
      },
      ok: false,
    })
    if (result.ok) {
      throw new Error('Expected the provider execution to fail.')
    }
    expect(result.error).toBe(providerError)
    expect((result.error as Error & { details?: Record<string, unknown> }).details).toMatchObject({
      assistantProviderAdapter: 'openai-compatible',
      assistantProviderBaseUrlConfigured: true,
      assistantProviderBaseUrlOrigin: 'https://ai-gateway.vercel.sh',
      assistantProviderBaseUrlPath: '/v1',
      assistantProviderErrorBodyCode: 'rate_limit_exceeded',
      assistantProviderErrorBodyMessage: 'Azure provider was rate limited.',
      assistantProviderErrorBodyPresent: true,
      assistantProviderErrorBodyType: 'rate_limit_error',
      assistantProviderErrorMessage: 'gateway timeout',
      assistantProviderErrorStatus: 429,
      assistantProviderGatewayOnlyProviderCount: 1,
      assistantProviderGatewayOnlyProviders: 'openai',
      assistantProviderGatewayTarget: true,
      assistantProviderModel: 'openai/gpt-5.4',
      assistantProviderName: 'vercel-ai-gateway',
      assistantProviderPresetId: 'vercel-ai-gateway',
    })
  })

  it('preserves provider-native action counts when generateText fails after provider work', async () => {
    const providerFailure = new Error('gateway timeout after provider-native search')
    providerMocks.generateText.mockImplementationOnce(async (options) => {
      options.onStepFinish?.({
        toolCalls: [
          {
            providerExecuted: true,
            toolCallId: 'provider-web-search-1',
          },
        ],
        toolResults: [
          {
            providerExecuted: true,
            toolCallId: 'provider-web-search-1',
          },
        ],
      })

      throw providerFailure
    })

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        presetId: 'openai',
        providerName: 'OpenAI',
        webSearch: 'provider',
      }),
      prompt: 'Retry this request after native search.',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toMatchObject({
      metadata: {
        executedToolCount: 0,
        providerActionCount: 1,
        rawToolEvents: [],
      },
      ok: false,
    })
    if (result.ok) {
      throw new Error('Expected the provider execution to fail.')
    }
    expect(result.error).toBe(providerFailure)
  })

  it('routes Vercel AI Gateway zero-data-retention through the responses request policy', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Gateway answer',
      response: {
        id: 'gateway-resp-1',
        modelId: 'openai/gpt-5.4',
      },
      usage: {
        completion_tokens: 4,
        prompt_tokens: 6,
      },
    })

    await openAiCompatibleProviderDefinition.executeTurn({
      env: {
        HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: 'rk_test_123',
        HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: '1',
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'VERCEL_AI_API_KEY',
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        gatewayOnlyProviders: ['openai'],
        model: 'openai/gpt-5.4',
        presetId: 'vercel-ai-gateway',
        providerName: 'vercel-ai-gateway',
        reasoningEffort: 'low',
        zeroDataRetention: true,
      }),
      usageAttribution: createAssistantUsageAttribution({
        credentialSource: 'platform',
        environment: 'production',
        featureKey: 'assistant_reply',
        memberId: 'member_123',
        reportingSecret: 'reporting-secret',
        surface: 'hosted_web',
        stripeCustomerId: 'cus_123',
        stripeMeterSource: 'vercel-ai-gateway',
        triggerKind: 'manual_ask',
        zeroDataRetention: true,
      }),
      prompt: 'Use the gateway',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.resolveAssistantLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyEnv: 'VERCEL_AI_API_KEY',
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        executionDriver: 'responses',
        headers: {
          'stripe-customer-id': 'cus_123',
          'stripe-restricted-access-key': 'rk_test_123',
        },
        model: 'openai/gpt-5.4',
        providerName: 'vercel-ai-gateway',
        responsesRequestPolicy: expect.objectContaining({
          gatewayOnlyProviders: ['openai'],
          gatewayZeroDataRetention: true,
        }),
      }),
    )

    expect(providerMocks.generateText.mock.calls[0]?.[0]).toMatchObject({
      abortSignal: undefined,
      maxRetries: 0,
      messages: [
        {
          content: 'Use the gateway',
          role: 'user',
        },
      ],
      model: {
        provider: 'mock-language-model',
      },
      providerOptions: {
        gateway: expect.objectContaining({
          only: ['openai'],
          zeroDataRetention: true,
        }),
        openai: {
          reasoningEffort: 'low',
          store: false,
        },
      },
      stopWhen: {
        count: 8,
        kind: 'step-count',
      },
      system: undefined,
      timeout: 600000,
      tools: {
        web_search: expect.objectContaining({
          description: 'Native OpenAI web search tool',
        }),
      },
    })
  })

  it('strips inherited Stripe delegation headers when the current turn is not eligible for delegated billing', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Gateway answer',
      response: {
        id: 'gateway-resp-2',
        modelId: 'openai/gpt-5.4',
      },
      usage: {
        completion_tokens: 3,
        prompt_tokens: 5,
      },
    })

    await openAiCompatibleProviderDefinition.executeTurn({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'VERCEL_AI_API_KEY',
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        headers: {
          'stripe-customer-id': 'cus_prefilled',
          'stripe-restricted-access-key': 'rk_prefilled',
          'x-extra-header': 'keep-me',
        },
        model: 'openai/gpt-5.4',
        presetId: 'vercel-ai-gateway',
        providerName: 'vercel-ai-gateway',
      }),
      usageAttribution: createAssistantUsageAttribution({
        credentialSource: 'member',
        environment: 'production',
        featureKey: 'assistant_reply',
        memberId: 'member_123',
        reportingSecret: 'reporting-secret',
        surface: 'hosted_web',
        stripeCustomerId: 'cus_123',
        stripeMeterSource: 'murph',
        triggerKind: 'manual_ask',
      }),
      prompt: 'Use the gateway without delegated billing',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.resolveAssistantLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'X-Extra-Header': 'keep-me',
        },
      }),
    )
  })

  it('keeps custom endpoints off gateway provider options and delegated billing even with stale gateway metadata', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Proxy answer',
      response: {
        id: 'gateway-proxy-1',
        modelId: 'openai/gpt-5.4',
      },
      usage: {
        completion_tokens: 2,
        prompt_tokens: 4,
      },
    })

    await openAiCompatibleProviderDefinition.executeTurn({
      env: {
        HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: 'rk_test_123',
        HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: '1',
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'VERCEL_AI_API_KEY',
        baseUrl: 'https://proxy.example.com/v1',
        gatewayOnlyProviders: ['openai'],
        headers: {
          'x-extra-header': 'keep-me',
        },
        model: 'openai/gpt-5.4',
        presetId: 'vercel-ai-gateway',
        providerName: 'vercel-ai-gateway',
        zeroDataRetention: true,
      }),
      usageAttribution: createAssistantUsageAttribution({
        credentialSource: 'platform',
        environment: 'production',
        featureKey: 'assistant_reply',
        memberId: 'member_123',
        reportingSecret: 'reporting-secret',
        surface: 'hosted_web',
        stripeCustomerId: 'cus_123',
        stripeMeterSource: 'vercel-ai-gateway',
        triggerKind: 'manual_ask',
        zeroDataRetention: true,
      }),
      prompt: 'Use the custom proxy',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.resolveAssistantLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyEnv: 'VERCEL_AI_API_KEY',
        baseUrl: 'https://proxy.example.com/v1',
        apiKeyEnvValue: null,
        executionDriver: 'openai-compatible',
        headers: {
          'X-Extra-Header': 'keep-me',
        },
      }),
    )
    expect(
      providerMocks.resolveAssistantLanguageModel.mock.calls[0]?.[0],
    ).not.toHaveProperty('responsesRequestPolicy')
    expect(providerMocks.generateText.mock.calls[0]?.[0]).not.toHaveProperty(
      'providerOptions.gateway',
    )
  })

  it('keeps Murph web.search on custom endpoints even when stale OpenAI metadata would otherwise enable native search', async () => {
    providerMocks.generateText.mockResolvedValue({
      text: 'Proxy answer',
      response: {
        id: 'proxy-openai-1',
        modelId: 'gpt-4.1-mini',
      },
      usage: {
        completion_tokens: 5,
        prompt_tokens: 6,
      },
    })

    const toolCatalog: AssistantToolCatalog = {
      createAiSdkTools: vi.fn(
        (_mode: AssistantToolExecutionMode = 'preview', _callbacks: AssistantCreateAiSdkToolsOptions = {}) => ({
          'web.search': tool({
            description: 'Mock web search tool',
            execute: async () => ({}),
            inputSchema: z.object({
              query: z.string().optional(),
            }),
          }),
        }),
      ),
      executeCalls: vi.fn(),
      hasTool: vi.fn(),
      listTools: vi.fn(),
    }

    await openAiCompatibleProviderDefinition.executeTurn({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://proxy.example.com/v1',
        model: 'gpt-4.1-mini',
        presetId: 'openai',
        providerName: 'OpenAI',
      }),
      toolRuntime: {
        toolCatalog,
        vault: '/tmp/test-vault',
      },
      userPrompt: 'Search for the latest note.',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.generateText.mock.calls[0]?.[0]?.tools).toMatchObject({
      web_search: expect.objectContaining({
        description: 'Mock web search tool',
      }),
    })
  })
})

describe('codexCliProviderDefinition', () => {
  it('reports model discovery as unsupported from the CLI adapter', async () => {
    await expect(
      codexCliProviderDefinition.discoverModels({
        config: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
      }),
    ).resolves.toEqual({
      message: 'Codex app-server model discovery is not wired into Murph yet.',
      models: [],
      status: 'unsupported',
    })
  })

  it('rejects non-codex provider configs during execution', async () => {
    await expect(
      codexCliProviderDefinition.executeTurn({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
        }),
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_PROVIDER_UNSUPPORTED',
      message: 'Codex app-server execution requires a Codex provider config.',
    })
  })

  it.each([
    'on-request',
    'untrusted',
  ] as const)(
    'fails closed before launching Codex app-server turns for approvalPolicy=%s',
    async (approvalPolicy) => {
      await expect(
        codexCliProviderDefinition.executeTurn({
          env: {
            PATH: '/usr/bin:/bin',
          },
          prompt: 'Unsupported approval policy',
          providerConfig: normalizeAssistantProviderConfig({
            provider: 'codex-cli',
            approvalPolicy,
            model: 'codex-mini',
            oss: false,
          }),
          workingDirectory: WORKING_DIRECTORY,
        }),
      ).rejects.toMatchObject({
        code: 'ASSISTANT_CODEX_APPROVAL_POLICY_UNSUPPORTED',
        message:
          `Codex app-server approval policy "${approvalPolicy}" is not supported in noninteractive assistant turns. Use approvalPolicy=never.`,
      })

      expect(providerMocks.prepareAssistantDirectCliEnv).not.toHaveBeenCalled()
      expect(providerMocks.executeCodexAppServerTurn).not.toHaveBeenCalled()
    },
  )

  it('prepares app-server execution inputs and extracts usage from the completion event tail', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      CODEX_ENV: 'prepared',
      PATH: '/prepared/bin',
    })
    providerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'Codex final answer',
      jsonEvents: [
        {
          type: 'status',
          value: 'starting',
        },
        {
          metrics: {
            usage: {
              cache_write_tokens: 2,
              cached_input_tokens: 3,
              input_tokens: 13,
              output_tokens: 21,
              reasoning_tokens: 5,
            },
          },
          model_id: 'codex-pro-served',
          request_id: 'req-codex-7',
          type: 'turn/completed',
        },
      ],
      providerActionCount: 0,
      sessionId: 'codex-session-7',
      stderr: 'codex stderr',
      stdout: 'codex stdout',
    })

    const onEvent = vi.fn()
    const onTraceEvent = vi.fn()

    const result = await codexCliProviderDefinition.executeTurn({
      env: {
        PATH: '/usr/bin:/bin',
      },
      onEvent,
      onTraceEvent,
      prompt: '  explicit codex prompt  ',
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: 'codex-dev',
        codexHome: '/tmp/codex-home',
        model: 'codex-pro',
        oss: true,
        profile: 'research',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
      }),
      resumeProviderSessionId: 'resume-codex-1',
      showThinkingTraces: true,
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.prepareAssistantDirectCliEnv).toHaveBeenCalledWith({
      PATH: '/usr/bin:/bin',
    })
    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenCalledWith({
      abortSignal: undefined,
      approvalPolicy: 'never',
      codexCommand: 'codex-dev',
      codexHome: '/tmp/codex-home',
      configOverrides: [
        'model_reasoning_summary="auto"',
        'hide_agent_reasoning=false',
      ],
      env: {
        CODEX_ENV: 'prepared',
        PATH: '/prepared/bin',
      },
      model: 'codex-pro',
      onProgress: onEvent,
      onTraceEvent,
      oss: true,
      profile: 'research',
      prompt: 'explicit codex prompt',
      reasoningEffort: 'high',
      resumeSessionId: 'resume-codex-1',
      sandbox: 'workspace-write',
      workingDirectory: WORKING_DIRECTORY,
    })
    expect(result).toEqual({
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        providerActionCount: 0,
        rawToolEvents: [],
      },
      ok: true,
      result: {
        provider: 'codex-cli',
        providerSessionId: 'codex-session-7',
        rawEvents: [
          {
            type: 'status',
            value: 'starting',
          },
          {
            metrics: {
              usage: {
                cache_write_tokens: 2,
                cached_input_tokens: 3,
                input_tokens: 13,
                output_tokens: 21,
                reasoning_tokens: 5,
              },
            },
            model_id: 'codex-pro-served',
            request_id: 'req-codex-7',
            type: 'turn/completed',
          },
        ],
        response: 'Codex final answer',
        stderr: 'codex stderr',
        stdout: 'codex stdout',
        usage: {
          apiKeyEnv: null,
          baseUrl: null,
          cacheWriteTokens: 2,
          cachedInputTokens: 3,
          inputTokens: 13,
          outputTokens: 21,
          providerMetadataJson: {
            metrics: {
              usage: {
                cache_write_tokens: 2,
                cached_input_tokens: 3,
                input_tokens: 13,
                output_tokens: 21,
                reasoning_tokens: 5,
              },
            },
            model_id: 'codex-pro-served',
            request_id: 'req-codex-7',
            type: 'turn/completed',
          },
          providerName: null,
          providerRequestId: 'req-codex-7',
          rawUsageJson: {
            cache_write_tokens: 2,
            cached_input_tokens: 3,
            input_tokens: 13,
            output_tokens: 21,
            reasoning_tokens: 5,
          },
          reasoningTokens: 5,
          requestedModel: 'codex-pro',
          servedModel: 'codex-pro-served',
          totalTokens: 34,
        },
      },
    })
  })

  it('defaults sparse codex provider configs to approvalPolicy=never before launch', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      PATH: '/prepared/bin',
    })
    providerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'Minimal codex answer',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-session-minimal',
      stderr: '',
      stdout: '',
    })

    await codexCliProviderDefinition.executeTurn({
      env: {},
      prompt: '  minimal prompt  ',
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'codex-mini',
        oss: false,
      }),
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenCalledWith({
      abortSignal: undefined,
      approvalPolicy: 'never',
      codexCommand: undefined,
      codexHome: undefined,
      configOverrides: undefined,
      env: {
        PATH: '/prepared/bin',
      },
      model: 'codex-mini',
      onProgress: undefined,
      onTraceEvent: undefined,
      oss: false,
      profile: undefined,
      prompt: 'minimal prompt',
      reasoningEffort: 'medium',
      resumeSessionId: undefined,
      sandbox: undefined,
      workingDirectory: WORKING_DIRECTORY,
    })
  })

  it('retries once without resume when Codex reports a stale provider session', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      PATH: '/prepared/bin',
    })
    providerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(
        new VaultCliError(
          'ASSISTANT_CODEX_RESUME_STALE',
          'Codex app-server could not resume the saved provider session.',
          {
            providerSessionId: 'stale-session',
            retryable: true,
            staleResume: true,
          },
        ),
      )
      .mockResolvedValueOnce({
        finalMessage: 'Recovered with fresh session',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: 'codex-session-fresh',
        stderr: '',
        stdout: '',
      })

    await expect(
      codexCliProviderDefinition.executeTurn({
        continuityContext: 'Fresh bootstrap context.',
        conversationMessages: [
          {
            content: 'Earlier user turn',
            role: 'user',
          },
          {
            content: 'Earlier assistant turn',
            role: 'assistant',
          },
        ],
        env: {},
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          oss: false,
        }),
        resumeProviderSessionId: 'stale-session',
        sessionContext: {
          binding: {
            actorId: 'contact:alice',
            channel: 'telegram',
            conversationKey: 'channel:telegram|thread:chat-55',
            delivery: {
              kind: 'thread',
              target: 'chat-55',
            },
            identityId: null,
            threadId: 'chat-55',
            threadIsDirect: true,
          },
        },
        systemPrompt: 'System/bootstrap instructions.',
        userPrompt: 'Current user turn',
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        providerSessionId: 'codex-session-fresh',
        response: 'Recovered with fresh session',
      },
    })

    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(2)
    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        prompt: expect.stringContaining('User message:\nCurrent user turn'),
        resumeSessionId: 'stale-session',
      }),
    )
    expect(
      providerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]?.prompt,
    ).toContain('Conversation context:')
    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.stringContaining('System/bootstrap instructions.'),
        resumeSessionId: undefined,
      }),
    )
    expect(
      providerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0]?.prompt,
    ).toContain(
      'Conversation so far:\nUser:\nEarlier user turn\n\nAssistant:\nEarlier assistant turn',
    )
    expect(
      providerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0]?.prompt,
    ).toContain(
      'Fresh bootstrap context.',
    )
    expect(
      providerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0]?.prompt,
    ).toContain(
      'User message:\nCurrent user turn',
    )
  })

  it('rethrows non-stale Codex execution failures without retrying', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      PATH: '/prepared/bin',
    })
    providerMocks.executeCodexAppServerTurn.mockRejectedValue(
      new VaultCliError(
        'ASSISTANT_CODEX_FAILED',
        'Codex app-server failed to execute the turn.',
      ),
    )

    await expect(
      codexCliProviderDefinition.executeTurn({
        env: {},
        prompt: '  fail without retry  ',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          oss: false,
        }),
        resumeProviderSessionId: 'resume-session',
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      message: 'Codex app-server failed to execute the turn.',
    })

    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSessionId: 'resume-session',
      }),
    )
  })

  it('passes only image user message parts through to the Codex app-server adapter', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      PATH: '/prepared/bin',
    })
    providerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'Image-aware answer',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-session-images',
      stderr: '',
      stdout: '',
    })

    await codexCliProviderDefinition.executeTurn({
      env: {},
      prompt: '  inspect image evidence  ',
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'codex-mini',
        oss: false,
      }),
      userMessageContent: [
        {
          type: 'text',
          text: 'What is shown here?',
        },
        {
          type: 'image',
          image: new Uint8Array([1, 2, 3]),
          mediaType: 'image/png',
          mimeType: 'image/png',
        },
        {
          type: 'file',
          data: new Uint8Array([9, 8, 7]),
          filename: 'report.pdf',
          mediaType: 'application/pdf',
        },
      ],
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
          },
        ],
      }),
    )
  })

  it('passes filesystem-backed image references through to the Codex app-server adapter', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      PATH: '/prepared/bin',
    })
    providerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'Image-aware answer',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-session-paths',
      stderr: '',
      stdout: '',
    })

    await codexCliProviderDefinition.executeTurn({
      env: {},
      prompt: '  inspect image evidence  ',
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'codex-mini',
        oss: false,
      }),
      userMessageContent: [
        {
          type: 'image',
          image: '/tmp/evidence.jpg',
          mediaType: 'image/jpeg',
          mimeType: 'image/jpeg',
        },
        {
          type: 'image',
          image: new URL('file:///tmp/evidence-2.png'),
          mediaType: 'image/png',
          mimeType: 'image/png',
        },
      ],
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          {
            path: '/tmp/evidence.jpg',
            mimeType: 'image/jpeg',
          },
          {
            path: '/tmp/evidence-2.png',
            mimeType: 'image/png',
          },
        ],
      }),
    )
  })

  it('decodes inline data URLs and ArrayBuffers for the Codex app-server adapter', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      PATH: '/prepared/bin',
    })
    providerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'Image-aware answer',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-session-inline-images',
      stderr: '',
      stdout: '',
    })

    await codexCliProviderDefinition.executeTurn({
      env: {},
      prompt: '  inspect image evidence  ',
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'codex-mini',
        oss: false,
      }),
      userMessageContent: [
        {
          type: 'image',
          image: 'data:image/png;base64,AQID',
          mediaType: 'image/png',
          mimeType: 'image/png',
        },
        {
          type: 'image',
          image: new URL('data:image/jpeg;base64,BAUG'),
          mediaType: 'image/jpeg',
          mimeType: 'image/jpeg',
        },
        {
          type: 'image',
          image: Uint8Array.from([7, 8, 9]).buffer,
          mediaType: 'image/webp',
          mimeType: 'image/webp',
        },
      ],
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.executeCodexAppServerTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          {
            bytes: Uint8Array.from([1, 2, 3]),
            mimeType: 'image/png',
          },
          {
            bytes: Uint8Array.from([4, 5, 6]),
            mimeType: 'image/jpeg',
          },
          {
            bytes: Uint8Array.from([7, 8, 9]),
            mimeType: 'image/webp',
          },
        ],
      }),
    )
  })

  it('rejects unsupported remote image URLs for the Codex app-server adapter', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      PATH: '/prepared/bin',
    })

    await expect(
      codexCliProviderDefinition.executeTurn({
        env: {},
        prompt: '  inspect image evidence  ',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          oss: false,
        }),
        userMessageContent: [
          {
            type: 'image',
            image: new URL('https://example.com/evidence.png'),
            mediaType: 'image/png',
            mimeType: 'image/png',
          },
        ],
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_IMAGE_INVALID',
      message: 'Codex app-server image input does not support URL scheme "https:".',
    })

    expect(providerMocks.executeCodexAppServerTurn).not.toHaveBeenCalled()
  })

  it('rejects malformed or non-base64 inline image data for the Codex app-server adapter', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      PATH: '/prepared/bin',
    })

    await expect(
      codexCliProviderDefinition.executeTurn({
        env: {},
        prompt: '  inspect image evidence  ',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          oss: false,
        }),
        userMessageContent: [
          {
            type: 'image',
            image: 'data:image/png,not-base64',
            mediaType: 'image/png',
            mimeType: 'image/png',
          },
        ],
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_IMAGE_INVALID',
      message: 'Codex app-server image input data URLs must use base64 encoding.',
    })

    await expect(
      codexCliProviderDefinition.executeTurn({
        env: {},
        prompt: '  inspect image evidence  ',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          oss: false,
        }),
        userMessageContent: [
          {
            type: 'image',
            image: 'data:image/png;base64',
            mediaType: 'image/png',
            mimeType: 'image/png',
          },
        ],
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_IMAGE_INVALID',
      message: 'Codex app-server image input data URL is malformed.',
    })

    expect(providerMocks.executeCodexAppServerTurn).not.toHaveBeenCalled()
  })
})
