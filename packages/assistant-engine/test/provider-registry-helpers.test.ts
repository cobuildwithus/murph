import { afterEach, describe, expect, it, vi } from 'vitest'

const codexAppServerMocks = vi.hoisted(() => ({
  executeCodexAppServerTurn: vi.fn(),
}))

vi.mock('../src/assistant-codex.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/assistant-codex.ts')>()),
  executeCodexAppServerTurn: codexAppServerMocks.executeCodexAppServerTurn,
}))

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

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

  it.each([
    {
      expected: {
        cachedInputTokens: null,
        inputTokens: 17,
        outputTokens: 9,
        reasoningTokens: null,
        totalTokens: 26,
      },
      expectedRawUsageJson: {
        completion_tokens: 9,
        prompt_tokens: 17,
        total_tokens: 26,
      },
      expectedSourcePath: 'params.usage',
      name: 'OpenAI chat-completions usage aliases',
      rawEvents: [
        {
          event: 'progress',
        },
        {
          params: {
            turn: {
              id: 'turn-chat-completions-usage',
              model: 'gpt-5.4',
            },
            usage: {
              completion_tokens: 9,
              headers: {
                authorization: 'redacted-test-header',
              },
              prompt: 'redacted test prompt',
              prompt_tokens: 17,
              total_tokens: 26,
            },
          },
          type: 'turn.completed',
        },
      ],
    },
    {
      expected: {
        cachedInputTokens: 5,
        inputTokens: 30,
        outputTokens: 11,
        reasoningTokens: 7,
        totalTokens: 41,
      },
      expectedRawUsageJson: {
        input_tokens: 30,
        input_tokens_details: {
          cached_tokens: 5,
        },
        output_tokens: 11,
        output_tokens_details: {
          reasoning_tokens: 7,
        },
        total_tokens: 41,
      },
      expectedSourcePath: 'params.usage',
      name: 'OpenAI responses usage detail aliases',
      rawEvents: [
        {
          params: {
            turn: {
              id: 'turn-responses-usage',
              model: 'gpt-5.4',
            },
            usage: {
              input_tokens: 30,
              input_tokens_details: {
                cached_tokens: 5,
              },
              output_tokens: 11,
              output_tokens_details: {
                reasoning_tokens: 7,
              },
              total_tokens: 41,
            },
          },
          type: 'turn.completed',
        },
      ],
    },
    {
      expected: {
        cacheWriteTokens: 2,
        cachedInputTokens: 4,
        inputTokens: 21,
        outputTokens: 13,
        reasoningTokens: 8,
        totalTokens: 34,
      },
      expectedRawUsageJson: {
        cacheWriteTokens: 2,
        cachedInputTokens: 4,
        completionTokens: 13,
        promptTokens: 21,
        reasoningTokens: 8,
        totalTokens: 34,
      },
      expectedSourcePath: 'params.turn.usage',
      name: 'camel-case prompt and completion aliases',
      rawEvents: [
        {
          params: {
            turn: {
              id: 'turn-camel-usage',
              model: 'gpt-5.4',
              usage: {
                cacheWriteTokens: 2,
                cachedInputTokens: 4,
                completionTokens: 13,
                promptTokens: 21,
                reasoningTokens: 8,
                totalTokens: 34,
              },
            },
          },
          type: 'turn.completed',
        },
      ],
    },
    {
      expected: {
        cacheWriteTokens: 3,
        cachedInputTokens: 6,
        inputTokens: 22,
        outputTokens: 10,
        reasoningTokens: 2,
        totalTokens: 32,
      },
      expectedRawUsageJson: {
        cache_write_tokens: 3,
        cached_input_tokens: 6,
        input_tokens: 22,
        output_tokens: 10,
        reasoning_tokens: 2,
        total_tokens: 32,
      },
      expectedSourcePath: 'params.metrics.usage',
      name: 'snake-case Murph usage aliases',
      rawEvents: [
        {
          params: {
            metrics: {
              usage: {
                cache_write_tokens: 3,
                cached_input_tokens: 6,
                input_tokens: 22,
                output_tokens: 10,
                reasoning_tokens: 2,
                total_tokens: 32,
              },
            },
            turn: {
              id: 'turn-snake-usage',
              model: 'gpt-5.4',
            },
          },
          type: 'turn.completed',
        },
      ],
    },
    {
      expected: {
        cachedInputTokens: 77,
        inputTokens: 101,
        outputTokens: 13,
        reasoningTokens: 5,
        totalTokens: 119,
      },
      expectedRawUsageJson: {
        cachedInputTokens: 77,
        inputTokens: 101,
        outputTokens: 13,
        reasoningOutputTokens: 5,
        totalTokens: 119,
      },
      expectedSourcePath: 'thread.tokenUsage.last',
      name: 'Codex thread token usage notification',
      rawEvents: [
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 77,
                inputTokens: 101,
                outputTokens: 13,
                reasoningOutputTokens: 5,
                totalTokens: 119,
              },
              total: {
                cachedInputTokens: 100,
                inputTokens: 200,
                outputTokens: 30,
                reasoningOutputTokens: 7,
                totalTokens: 237,
              },
            },
            turnId: 'turn-token-usage',
          },
        },
        {
          params: {
            turn: {
              id: 'turn-token-usage',
              model: 'gpt-5.4',
            },
          },
          type: 'turn.completed',
        },
      ],
    },
  ])('extracts Codex usage from $name', ({
    expected,
    expectedRawUsageJson,
    expectedSourcePath,
    rawEvents,
  }) => {
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'gpt-5.4',
          modelProvider: 'openai',
          oss: false,
        }),
        rawEvents,
      }),
    ).toMatchObject({
      cacheWriteTokens: null,
      providerName: 'openai',
      providerRequestId: expect.stringMatching(/^turn-/u),
      rawUsageJson: expectedRawUsageJson,
      rawUsageJsonHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      servedModel: 'gpt-5.4',
      usageExtractionSourcePath: expectedSourcePath,
      usageExtractionVersion: 'codex-usage-v1',
      ...expected,
    })
  })

  it('composes turn prompts from binding context, continuity, and the user prompt', () => {
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
        'delivery: thread route available',
        'iMessage route note: this is not a confirmed direct iMessage thread, so do not use it as a personal reminder route unless the user explicitly asks to send in this thread; use internal channel "linq" only for route fields.',
        '',
        'Prefer the latest delivery target.',
        '',
        'User message:',
        'Latest question.',
      ].join('\n'),
    )
  })

  it('keeps raw Linq delivery targets out of Codex prompt context', () => {
    const prompt = resolveAssistantProviderPrompt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      sessionContext: {
        binding: createAssistantBinding({
          actorId: 'hid_linq_actor',
          channel: 'linq',
          deliveryKind: 'participant',
          deliveryTarget: '+15550100001',
          identityId: 'hid_linq_identity',
          threadIsDirect: true,
        }),
      },
      systemPrompt: 'You are Murph.',
      userPrompt: 'Say hi.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(prompt).toContain('actor: hid_linq_actor')
    expect(prompt).toContain('delivery: participant route available')
    expect(prompt).not.toContain('+15550100001')
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
        rawUsageJsonHash: null,
        reasoningTokens: null,
        requestedModel: null,
        servedModel: null,
        totalTokens: null,
        usageExtractionSourcePath: null,
        usageExtractionVersion: 'codex-usage-v1',
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

  it('replays active-turn history only on stale native-resume fallback', async () => {
    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(
        new VaultCliError(
          'ASSISTANT_CODEX_RESUME_STALE',
          'thread/resume failed: no rollout found for thread id stale-thread',
        ),
      )
      .mockResolvedValueOnce({
        finalMessage: 'final after fallback',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: 'fresh-thread',
        stderr: '',
        stdout: '',
        threadId: 'fresh-thread',
        turnId: 'turn-fallback',
      })

    const attempt = await executeCodexAssistantTurnAttempt({
      activeTurnMessages: [
        {
          content: 'initial prompt',
          role: 'user',
        },
        {
          content: 'draft before interruption',
          role: 'assistant',
        },
      ],
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      resumeProviderSessionId: 'stale-thread',
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(2)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0],
    ).toMatchObject({
      prompt: expect.not.stringContaining('Active turn so far:'),
      resumeSessionId: 'stale-thread',
    })
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0],
    ).toMatchObject({
      prompt: expect.stringContaining('Active turn so far:'),
      resumeSessionId: undefined,
    })
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0]?.prompt,
    ).toContain('draft before interruption')
    if (!attempt.ok) {
      throw new Error('expected successful provider attempt')
    }
    expect(attempt.result.providerContinuation).toEqual({
      kind: 'thread-start',
    })
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
