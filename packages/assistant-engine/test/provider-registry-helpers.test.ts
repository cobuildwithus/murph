import { afterEach, describe, expect, it, vi } from 'vitest'

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'

import { createAssistantBinding } from '../src/assistant/bindings.ts'
import { codexCliProviderDefinition } from '../src/assistant/providers/codex-cli.ts'
import {
  DEFAULT_CODEX_MODEL_CAPABILITIES,
  DEFAULT_CODEX_MODELS,
  createCatalogModel,
  normalizeDiscoveredModelIds,
} from '../src/assistant/providers/catalog.ts'
import {
  buildAssistantProviderLabel,
  buildAssistantProviderMessages,
  buildOpenAICompatibleDiscoveryHeaders,
  ensureTrailingSlash,
  extractCodexAssistantProviderUsage,
  extractOpenAICompatibleProviderSessionId,
  resolveAssistantProviderPrompt,
} from '../src/assistant/providers/helpers.ts'
import {
  discoverAssistantProviderModels,
  executeAssistantProviderTurnAttemptWithDefinition,
  listAssistantProviderDefinitions,
  listAssistantProviders,
  resolveAssistantProviderCapabilities,
  resolveAssistantProviderExecutionCapabilities,
  resolveAssistantProviderStaticModels,
  resolveAssistantProviderTargetCapabilities,
  resolveAssistantProviderTargetExecutionCapabilities,
} from '../src/assistant/providers/registry.ts'
import type {
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
} from '../src/assistant/providers/types.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('assistant provider registry helpers', () => {
  it('builds discovery headers from normalized config and injects auth only when missing', () => {
    const injected = buildOpenAICompatibleDiscoveryHeaders({
      config: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'TEST_PROVIDER_API_KEY',
        headers: {
          ' x-trace ': '  trace-id  ',
        },
      }),
      env: {
        TEST_PROVIDER_API_KEY: 'secret-token',
      },
    })

    expect(injected).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer secret-token',
      'X-Trace': 'trace-id',
    })

    const explicitAuthorization = buildOpenAICompatibleDiscoveryHeaders({
      config: normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'TEST_PROVIDER_API_KEY',
        headers: {
          authorization: 'Bearer preconfigured',
        },
      }),
      env: {
        TEST_PROVIDER_API_KEY: 'secret-token',
      },
    })

    expect(explicitAuthorization).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer preconfigured',
    })
  })

  it('resolves provider labels for presets, codex variants, unknown hosts, and generic endpoints', () => {
    expect(
      buildAssistantProviderLabel(
        normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
          providerName: 'openrouter',
        }),
      ),
    ).toBe('OpenRouter')

    expect(
      buildAssistantProviderLabel(
        normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          oss: false,
        }),
      ),
    ).toBe('Codex CLI')

    expect(
      buildAssistantProviderLabel(
        normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          oss: true,
        }),
      ),
    ).toBe('Codex OSS')

    expect(
      buildAssistantProviderLabel(
        normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
          baseUrl: 'https://models.example.com/v1',
        }),
      ),
    ).toBe('OpenAI-compatible endpoint at models.example.com')

    expect(
      buildAssistantProviderLabel(
        normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
        }),
      ),
    ).toBe('OpenAI-compatible endpoint')
  })

  it('ensures trailing slashes before appending discovery paths', () => {
    expect(ensureTrailingSlash('https://example.com/v1')).toBe(
      'https://example.com/v1/',
    )
    expect(ensureTrailingSlash('https://example.com/v1/')).toBe(
      'https://example.com/v1/',
    )
  })

  it('extracts provider session ids and codex usage from sparse provider metadata', () => {
    expect(
      extractOpenAICompatibleProviderSessionId({
        providerMetadata: {
          openai: {
            responseId: 'resp-openai-1',
          },
        },
      }),
    ).toBe('resp-openai-1')
    expect(
      extractOpenAICompatibleProviderSessionId({
        response: {
          id: 'resp-fallback-2',
        },
      }),
    ).toBe('resp-fallback-2')

    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          oss: false,
        }),
        rawEvents: [
          {
            event: 'progress',
          },
        ],
      }),
    ).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      providerMetadataJson: null,
      providerRequestId: null,
      rawUsageJson: null,
      servedModel: 'codex-mini',
      totalTokens: null,
    })
  })

  it('composes flat prompts from system instructions, binding context, continuity, and the user prompt', () => {
    const binding = createAssistantBinding({
      actorId: 'actor-1',
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: true,
    })

    expect(
      resolveAssistantProviderPrompt({
        prompt: '  explicit prompt  ',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toBe('explicit prompt')

    expect(
      resolveAssistantProviderPrompt({
        continuityContext: 'Stay grounded in the saved thread context.',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        sessionContext: {
          binding,
        },
        systemPrompt: 'You are Murph.',
        userPrompt: '  What changed today?  ',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toBe(
      [
        'You are Murph.',
        '',
        'Conversation context:',
        'channel: telegram',
        'identity: identity-1',
        'actor: actor-1',
        'thread: thread-1',
        'thread is direct: true',
        'delivery: thread -> thread-1',
        '',
        'Stay grounded in the saved thread context.',
        '',
        'User message:',
        'What changed today?',
      ].join('\n'),
    )

    expect(() =>
      resolveAssistantProviderPrompt({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toThrow('Assistant provider turns require either prompt or userPrompt.')
  })

  it('sanitizes conversation history and preserves structured user content with context', () => {
    const binding = createAssistantBinding({
      actorId: 'actor-9',
      channel: 'linq',
      identityId: 'identity-9',
      threadId: 'chat-9',
      threadIsDirect: false,
    })

    expect(
      buildAssistantProviderMessages({
        continuityContext: 'Prefer the latest delivery target.',
        conversationMessages: [
          {
            role: 'assistant',
            content: '   ',
          },
          {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '  Earlier assistant answer  ',
              },
              {
                type: 'file',
                data: 'file-blob',
                filename: 'notes.pdf',
                mediaType: 'application/pdf',
              },
              {
                type: 'image',
                image: 'image-blob',
                mediaType: 'image/png',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '   ',
              },
              {
                type: 'text',
                text: '  Earlier user reply  ',
              },
            ],
          },
        ],
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
        }),
        sessionContext: {
          binding,
        },
        userMessageContent: [
          {
            type: 'text',
            text: '   ',
          },
          {
            type: 'text',
            text: '  Latest structured question  ',
          },
          {
            type: 'file',
            data: 'note-blob',
            filename: 'summary.txt',
            mediaType: 'text/plain',
          },
        ],
        userPrompt: 'ignored when structured content is present',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toEqual([
      {
        role: 'assistant',
        content: [
          'Earlier assistant answer',
          'Assistant shared file (notes.pdf).',
          'Assistant shared image (image/png).',
        ].join('\n\n'),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Earlier user reply',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              'Conversation context:',
              'channel: linq',
              'identity: identity-9',
              'actor: actor-9',
              'thread: chat-9',
              'thread is direct: false',
              'delivery: thread -> chat-9',
              '',
              'Prefer the latest delivery target.',
            ].join('\n'),
          },
          {
            type: 'text',
            text: 'Latest structured question',
          },
          {
            type: 'file',
            data: 'note-blob',
            filename: 'summary.txt',
            mediaType: 'text/plain',
          },
        ],
      },
    ])
  })

  it('falls back to prompt or composed plain user content when no structured content exists', () => {
    expect(
      buildAssistantProviderMessages({
        prompt: '  use the explicit prompt  ',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
        }),
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toEqual([
      {
        role: 'user',
        content: 'use the explicit prompt',
      },
    ])

    const binding = createAssistantBinding({
      actorId: 'actor-2',
      channel: 'telegram',
      threadId: 'thread-2',
      threadIsDirect: true,
    })

    expect(
      buildAssistantProviderMessages({
        continuityContext: 'Use the thread binding.',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'openai-compatible',
        }),
        sessionContext: {
          binding,
        },
        userPrompt: '  send the reply now  ',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toEqual([
      {
        role: 'user',
        content: [
          'Conversation context:',
          'channel: telegram',
          'actor: actor-2',
          'thread: thread-2',
          'thread is direct: true',
          'delivery: thread -> thread-2',
          '',
          'Use the thread binding.',
          '',
          'send the reply now',
        ].join('\n'),
      },
    ])
  })

  it('normalizes discovered model ids and clones catalog capabilities', () => {
    expect(
      normalizeDiscoveredModelIds([
        '  alpha  ',
        'beta',
        'alpha',
        '',
        null,
        undefined,
        'model-1',
        'model-2',
        'model-3',
        'model-4',
        'model-5',
        'model-6',
        'model-7',
        'model-8',
        'model-9',
        'model-10',
        'model-11',
        'model-12',
      ]),
    ).toEqual([
      'alpha',
      'beta',
      'model-1',
      'model-2',
      'model-3',
      'model-4',
      'model-5',
      'model-6',
      'model-7',
      'model-8',
      'model-9',
      'model-10',
    ])

    const capabilities = {
      ...DEFAULT_CODEX_MODEL_CAPABILITIES,
    }
    const model = createCatalogModel({
      capabilities,
      description: 'Test model',
      id: 'test-model',
      source: 'manual',
    })

    capabilities.tools = false

    expect(model).toEqual({
      capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
      description: 'Test model',
      id: 'test-model',
      label: 'test-model',
      source: 'manual',
    })
  })

  it('exposes registry capabilities and static model lists for both providers', () => {
    expect(listAssistantProviders()).toEqual([
      'codex-cli',
      'openai-compatible',
    ])
    expect(listAssistantProviderDefinitions()).toHaveLength(2)

    expect(resolveAssistantProviderCapabilities('codex-cli')).toEqual({
      supportsModelDiscovery: false,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: false,
      supportsZeroDataRetention: false,
    })

    expect(
      resolveAssistantProviderExecutionCapabilities('openai-compatible'),
    ).toEqual({
      murphCommandSurface: 'bound-tools',
      requestFormat: 'messages',
      supportsModelDiscovery: true,
      supportsNativeResume: true,
      supportsReasoningEffort: false,
      supportsRichUserMessageContent: true,
      supportsZeroDataRetention: false,
      supportsToolRuntime: true,
    })

    expect(
      resolveAssistantProviderTargetCapabilities({
        baseUrl: 'https://api.openai.com/v1',
      }),
    ).toEqual({
      supportsModelDiscovery: true,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: true,
      supportsZeroDataRetention: false,
    })

    expect(
      resolveAssistantProviderTargetExecutionCapabilities({
        baseUrl: 'https://api.openai.com/v1',
      }),
    ).toEqual({
      murphCommandSurface: 'bound-tools',
      requestFormat: 'messages',
      supportsModelDiscovery: true,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: true,
      supportsZeroDataRetention: false,
      supportsToolRuntime: true,
    })

    expect(resolveAssistantProviderStaticModels({ provider: 'codex-cli' })).toEqual(
      DEFAULT_CODEX_MODELS,
    )
    expect(
      resolveAssistantProviderStaticModels({
        provider: 'openai-compatible',
      }),
    ).toEqual([])
  })

  it('delegates model discovery through the registry with normalized headers and model ids', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: '  model-a  ' },
              { id: 'model-a' },
              { id: 'model-b' },
              { id: null },
            ],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      )

    const result = await discoverAssistantProviderModels({
      apiKeyEnv: 'DISCOVERY_KEY',
      baseUrl: 'https://models.example.com/v1',
      env: {
        DISCOVERY_KEY: 'secret-key',
      },
      headers: {
        ' x-request-id ': '  req-123  ',
      },
      provider: 'openai-compatible',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://models.example.com/v1/models',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer secret-key',
        'X-Request-Id': 'req-123',
      },
    })
    expect(result).toEqual({
      message: null,
      models: [
        {
          capabilities: {
            images: false,
            pdf: false,
            reasoning: false,
            streaming: true,
            tools: true,
          },
          description: 'Discovered from OpenAI-compatible endpoint at models.example.com.',
          id: 'model-a',
          label: 'model-a',
          source: 'discovered',
        },
        {
          capabilities: {
            images: false,
            pdf: false,
            reasoning: false,
            streaming: true,
            tools: true,
          },
          description: 'Discovered from OpenAI-compatible endpoint at models.example.com.',
          id: 'model-b',
          label: 'model-b',
          source: 'discovered',
        },
      ],
      status: 'ok',
    })
  })

  it('merges progress activity labels into successful delegated execution attempts', async () => {
    const executionResult: AssistantProviderTurnExecutionResult = {
      provider: 'codex-cli',
      providerSessionId: 'provider-session-1',
      rawEvents: [],
      response: 'Completed.',
      stderr: '',
      stdout: '',
      usage: null,
    }
    const bubbledEvents: unknown[] = []

    vi.spyOn(codexCliProviderDefinition, 'executeTurn').mockImplementation(
      async (input: AssistantProviderTurnExecutionInput) => {
        input.onEvent?.({
          id: 'event-1',
          kind: 'tool',
          label: '  Search   Web  ',
          rawEvent: {
            type: 'tool',
          },
          state: 'running',
          text: 'using Search Web',
        })

        return {
          metadata: {
            activityLabels: ['  Existing Label  '],
            executedToolCount: 1,
            rawToolEvents: [{ type: 'raw-tool-event' }],
          },
          ok: true,
          result: executionResult,
        }
      },
    )

    const attempt = await executeAssistantProviderTurnAttemptWithDefinition({
      onEvent: (event) => {
        bubbledEvents.push(event)
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    if (!attempt.ok) {
      throw new Error('expected successful provider attempt')
    }

    expect(bubbledEvents).toHaveLength(1)
    expect(attempt.metadata).toEqual({
      activityLabels: ['Existing Label', 'Search Web'],
      executedToolCount: 1,
      rawToolEvents: [{ type: 'raw-tool-event' }],
    })
    expect(attempt.result).toEqual(executionResult)
  })

  it('returns failed delegated execution attempts with merged labels from emitted progress', async () => {
    const expectedError = new Error('provider crashed')

    vi.spyOn(codexCliProviderDefinition, 'executeTurn').mockImplementation(
      async (input: AssistantProviderTurnExecutionInput) => {
        input.onEvent?.({
          id: 'event-2',
          kind: 'command',
          label: '  Refresh Session  ',
          rawEvent: {
            type: 'command',
          },
          state: 'running',
          text: 'refreshing session',
        })

        throw expectedError
      },
    )

    const attempt = await executeAssistantProviderTurnAttemptWithDefinition({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt).toEqual({
      error: expectedError,
      metadata: {
        activityLabels: ['Refresh Session'],
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: false,
    })
  })
})
