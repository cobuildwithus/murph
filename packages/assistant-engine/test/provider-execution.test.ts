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

const providerMocks = vi.hoisted(() => ({
  executeCodexPrompt: vi.fn(),
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
  executeCodexPrompt: providerMocks.executeCodexPrompt,
}))

import { codexCliProviderDefinition } from '../src/assistant/providers/codex-cli.ts'
import { openAiCompatibleProviderDefinition } from '../src/assistant/providers/openai-compatible.ts'

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
        webSearch: tool({
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
      }),
      resumeProviderSessionId: 'resume-session-123',
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
        providerSessionId: 'resume-session-123',
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
    expect(providerMocks.resolveAssistantLanguageModel).toHaveBeenCalledWith({
      apiKey: 'test-openai-key',
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://api.openai.com/v1',
      executionDriver: 'openai-responses',
      model: 'gpt-4.1-mini',
      providerName: 'OpenAI',
    })
    expect(providerMocks.generateText.mock.calls[0]?.[0]).toMatchObject({
      abortSignal: undefined,
      maxRetries: 0,
      messages: [
        {
          content: 'Earlier answer',
          role: 'assistant',
        },
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
          previousResponseId: 'resume-session-123',
          reasoningEffort: 'medium',
          store: false,
        },
      },
      stopWhen: {
        count: 8,
        kind: 'step-count',
      },
      system: 'You are concise.',
      timeout: 600000,
      tools: expect.objectContaining({
        webSearch: expect.objectContaining({
          description: 'Mock web search tool',
        }),
      }),
    })
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
      system: undefined,
      timeout: 600000,
    })
  })

  it('emits succeeded tool progress and omits previousResponseId when no resumed session is available', async () => {
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
        (
          _mode: AssistantToolExecutionMode = 'preview',
          callbacks: AssistantCreateAiSdkToolsOptions = {},
        ) => {
          callbacks.onToolEvent?.({
            input: {},
            kind: 'succeeded',
            mode: 'apply',
            tool: 'web.search',
          })

          return {
            webSearch: tool({
              description: 'Mock web search tool',
              execute: async () => ({}),
              inputSchema: z.object({
                query: z.string().optional(),
              }),
            }),
          }
        },
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
        rawToolEvents: [
          {
            mode: 'apply',
            sequence: 1,
            tool: 'web.search',
            type: 'assistant.tool.succeeded',
          },
        ],
      },
      ok: true,
      result: {
        provider: 'openai-compatible',
        providerSessionId: 'response-openai-2',
        rawEvents: [
          {
            mode: 'apply',
            sequence: 1,
            tool: 'web.search',
            type: 'assistant.tool.succeeded',
          },
        ],
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
          store: false,
        },
      },
      stopWhen: {
        count: 8,
        kind: 'step-count',
      },
      system: undefined,
      timeout: 600000,
      tools: expect.objectContaining({
        webSearch: expect.objectContaining({
          description: 'Mock web search tool',
        }),
      }),
    })
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tool-1',
        kind: 'tool',
        safeLabel: 'web.search',
        state: 'completed',
        text: 'Finished web.search.',
      }),
    )
    expect(onTraceEvent).toHaveBeenCalledWith({
      providerSessionId: null,
      rawEvent: {
        mode: 'apply',
        sequence: 1,
        tool: 'web.search',
        type: 'assistant.tool.succeeded',
      },
      updates: [
        {
          kind: 'status',
          text: 'Finished web.search.',
        },
      ],
    })
  })

  it('returns a failed provider result when generateText throws', async () => {
    providerMocks.generateText.mockRejectedValueOnce(new Error('gateway timeout'))

    const result = await openAiCompatibleProviderDefinition.executeTurn({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
      }),
      prompt: 'Retry this request',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(result).toMatchObject({
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: false,
    })
    if (result.ok) {
      throw new Error('Expected the provider execution to fail.')
    }
    expect(result.error).toEqual(new Error('gateway timeout'))
  })

  it('routes Vercel AI Gateway zero-data-retention through gateway provider options', async () => {
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
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'VERCEL_AI_API_KEY',
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        model: 'openai/gpt-5.4',
        presetId: 'vercel-ai-gateway',
        providerName: 'vercel-ai-gateway',
        reasoningEffort: 'low',
        zeroDataRetention: true,
      }),
      prompt: 'Use the gateway',
      workingDirectory: WORKING_DIRECTORY,
    })

    expect(providerMocks.generateText).toHaveBeenCalledWith({
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
        gateway: {
          zeroDataRetention: true,
        },
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
      tools: expect.objectContaining({
        web_search: expect.any(Object),
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
      message: 'Codex model discovery is not available from the local CLI adapter.',
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
      message: 'Codex CLI execution requires a Codex provider config.',
    })
  })

  it('prepares CLI execution inputs and extracts usage from the completion event tail', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      CODEX_ENV: 'prepared',
      PATH: '/prepared/bin',
    })
    providerMocks.executeCodexPrompt.mockResolvedValue({
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
    expect(providerMocks.executeCodexPrompt).toHaveBeenCalledWith({
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

  it('omits undefined optional codex fields when the provider config is sparse', async () => {
    providerMocks.prepareAssistantDirectCliEnv.mockReturnValue({
      PATH: '/prepared/bin',
    })
    providerMocks.executeCodexPrompt.mockResolvedValue({
      finalMessage: 'Minimal codex answer',
      jsonEvents: [],
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

    expect(providerMocks.executeCodexPrompt).toHaveBeenCalledWith({
      abortSignal: undefined,
      approvalPolicy: undefined,
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
    providerMocks.executeCodexPrompt
      .mockRejectedValueOnce(
        new VaultCliError(
          'ASSISTANT_CODEX_RESUME_STALE',
          'Codex CLI could not resume the saved provider session.',
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
        sessionId: 'codex-session-fresh',
        stderr: '',
        stdout: '',
      })

    await expect(
      codexCliProviderDefinition.executeTurn({
        env: {},
        prompt: '  retry stale resume  ',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          oss: false,
        }),
        resumeProviderSessionId: 'stale-session',
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        providerSessionId: 'codex-session-fresh',
        response: 'Recovered with fresh session',
      },
    })

    expect(providerMocks.executeCodexPrompt).toHaveBeenCalledTimes(2)
    expect(providerMocks.executeCodexPrompt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        resumeSessionId: 'stale-session',
      }),
    )
    expect(providerMocks.executeCodexPrompt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resumeSessionId: undefined,
      }),
    )
  })
})
