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
  extractCodexAssistantProviderUsage,
  resolveAssistantProviderPrompt,
} from '../src/assistant/providers/helpers.ts'
import {
  executeAssistantProviderTurnAttemptWithDefinition,
  listAssistantProviderDefinitions,
  listAssistantProviders,
  resolveAssistantProviderCapabilities,
  resolveAssistantProviderExecutionCapabilities,
  resolveAssistantProviderLabel,
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
  it('resolves provider labels for Codex app-server variants', () => {
    expect(
      resolveAssistantProviderLabel(
        normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          oss: false,
        }),
      ),
    ).toBe('Codex app-server')

    expect(
      resolveAssistantProviderLabel(
        normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          oss: true,
        }),
      ),
    ).toBe('Codex OSS app-server')
  })

  it('extracts Codex usage from sparse provider metadata', () => {
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          modelProvider: 'vercel-ai-gateway',
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
      providerName: 'vercel-ai-gateway',
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

    expect(
      resolveAssistantProviderPrompt({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        resumeProviderSessionId: 'codex-session-1',
        systemPrompt: 'You are Murph.',
        userPrompt: '  What changed today?  ',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toBe('User message:\nWhat changed today?')

    expect(
      resolveAssistantProviderPrompt({
        continuityContext: 'Do not resend this on native resume.',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        resumeProviderSessionId: 'codex-session-1',
        sessionContext: {
          binding,
        },
        systemPrompt: 'You are Murph.',
        userPrompt: '  What changed today?  ',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toBe(
      [
        'Conversation context:',
        'channel: telegram',
        'identity: identity-1',
        'actor: actor-1',
        'thread: thread-1',
        'thread is direct: true',
        'delivery: thread -> thread-1',
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

  it('serializes conversation history and active turn content into a Codex flat prompt', () => {
    const binding = createAssistantBinding({
      actorId: 'actor-9',
      channel: 'linq',
      identityId: 'identity-9',
      threadId: 'chat-9',
      threadIsDirect: false,
    })

    expect(
      resolveAssistantProviderPrompt({
        activeTurnMessages: [
          {
            role: 'assistant',
            content: '  Draft answer  ',
          },
        ],
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
          provider: 'codex-cli',
        }),
        sessionContext: {
          binding,
        },
        systemPrompt: 'You are Murph.',
        userPrompt: 'Latest question.',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toBe(
      [
        'You are Murph.',
        '',
        'Conversation so far:',
        'Assistant:',
        [
          'Earlier assistant answer',
          'Assistant shared file (notes.pdf).',
          'Assistant shared image (image/png).',
        ].join('\n\n'),
        '',
        'User:',
        'Earlier user reply',
        '',
        'Active turn so far:',
        'Assistant:',
        'Draft answer',
        '',
        'Conversation context:',
        'channel: linq (user-facing: iMessage)',
        'identity: identity-9',
        'actor: actor-9',
        'thread: chat-9',
        'thread is direct: false',
        'delivery: thread -> chat-9',
        'iMessage route note: this is not a confirmed direct iMessage thread, so do not use it as a personal reminder route unless the user explicitly asks to send in this thread; use internal channel "linq" only for route fields.',
        '',
        'Prefer the latest delivery target.',
        '',
        'User message:',
        'Latest question.',
      ].join('\n'),
    )
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

  it('exposes Codex-only registry capabilities and static model lists', () => {
    expect(listAssistantProviders()).toEqual(['codex-cli'])
    expect(listAssistantProviderDefinitions()).toHaveLength(1)

    expect(resolveAssistantProviderCapabilities('codex-cli')).toEqual({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsModelDiscovery: false,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: true,
      supportsZeroDataRetention: false,
    })

    expect(
      resolveAssistantProviderTargetCapabilities({
        provider: 'codex-cli',
      }),
    ).toEqual({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsModelDiscovery: false,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: true,
      supportsZeroDataRetention: false,
    })

    expect(
      resolveAssistantProviderTargetExecutionCapabilities({
        provider: 'codex-cli',
      }),
    ).toEqual({
      murphCommandSurface: 'direct-cli',
      requestFormat: 'flat-prompt',
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsModelDiscovery: false,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: true,
      supportsZeroDataRetention: false,
    })

    expect(resolveAssistantProviderStaticModels({ provider: 'codex-cli' })).toEqual(
      DEFAULT_CODEX_MODELS,
    )
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
            providerActionCount: 0,
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
      providerActionCount: 0,
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
        providerActionCount: 0,
      },
      ok: false,
    })
  })
})
