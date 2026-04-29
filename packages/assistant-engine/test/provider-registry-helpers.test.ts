import { afterEach, describe, expect, it, vi } from 'vitest'

const codexAppServerMocks = vi.hoisted(() => ({
  executeCodexAppServerTurn: vi.fn(),
}))

vi.mock('../src/assistant-codex.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/assistant-codex.ts')>()),
  executeCodexAppServerTurn: codexAppServerMocks.executeCodexAppServerTurn,
}))

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'

import { createAssistantBinding } from '../src/assistant/bindings.ts'
import {
  DEFAULT_CODEX_MODEL_CAPABILITIES,
  DEFAULT_CODEX_MODELS,
  createCatalogModel,
} from '../src/assistant/providers/catalog.ts'
import {
  extractCodexAssistantProviderUsage,
  resolveAssistantProviderPrompt,
} from '../src/assistant/providers/helpers.ts'
import {
  executeCodexAssistantTurnAttempt,
  resolveCodexAssistantCapabilities,
  resolveCodexAssistantLabel,
  resolveCodexStaticModels,
  resolveCodexAssistantTargetCapabilities,
} from '../src/assistant/providers/registry.ts'
import type {
  AssistantProviderTurnExecutionResult,
} from '../src/assistant/providers/types.ts'

afterEach(() => {
  codexAppServerMocks.executeCodexAppServerTurn.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Codex assistant registry helpers', () => {
  it('resolves provider labels for Codex app-server variants', () => {
    expect(
      resolveCodexAssistantLabel(
        normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          oss: false,
        }),
      ),
    ).toBe('Codex app-server')

    expect(
      resolveCodexAssistantLabel(
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

  it('clones catalog capabilities', () => {
    const capabilities = {
      ...DEFAULT_CODEX_MODEL_CAPABILITIES,
    }
    const model = createCatalogModel({
      capabilities,
      description: 'Test model',
      id: 'test-model',
      source: 'current',
    })

    capabilities.tools = false

    expect(model).toEqual({
      capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
      description: 'Test model',
      id: 'test-model',
      label: 'test-model',
      source: 'current',
    })
  })

  it('exposes Codex-only registry capabilities and static model lists', () => {
    expect(resolveCodexAssistantCapabilities()).toEqual({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: true,
    })

    expect(
      resolveCodexAssistantTargetCapabilities({
        provider: 'codex-cli',
      }),
    ).toEqual({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: true,
    })

    expect(resolveCodexStaticModels({ provider: 'codex-cli' })).toEqual(
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
        requestedModel: null,
        servedModel: null,
        totalTokens: null,
      },
    }
    const bubbledEvents: unknown[] = []

    codexAppServerMocks.executeCodexAppServerTurn.mockImplementation(
      async (input: { onProgress?: (event: unknown) => void }) => {
        input.onProgress?.({
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
          finalMessage: executionResult.response,
          jsonEvents: executionResult.rawEvents,
          providerActionCount: 1,
          sessionId: executionResult.providerSessionId,
          stderr: executionResult.stderr,
          stdout: executionResult.stdout,
          threadId: executionResult.providerSessionId,
          turnId: 'turn-1',
        }
      },
    )

    const attempt = await executeCodexAssistantTurnAttempt({
      onEvent: (event) => {
        bubbledEvents.push(event)
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      userPrompt: 'Run the turn.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    if (!attempt.ok) {
      throw new Error('expected successful provider attempt')
    }

    expect(bubbledEvents).toHaveLength(1)
    expect(attempt.metadata).toEqual({
      activityLabels: ['Search Web'],
      executedToolCount: 0,
      rawToolEvents: [],
      providerActionCount: 1,
    })
    expect(attempt.result).toEqual(executionResult)
  })

  it('returns failed delegated execution attempts with merged labels from emitted progress', async () => {
    const expectedError = new Error('provider crashed')

    codexAppServerMocks.executeCodexAppServerTurn.mockImplementation(
      async (input: { onProgress?: (event: unknown) => void }) => {
        input.onProgress?.({
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

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      userPrompt: 'Run the turn.',
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
