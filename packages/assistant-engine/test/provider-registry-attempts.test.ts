import { afterEach, describe, expect, it, vi } from 'vitest'

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'

import { DEFAULT_CODEX_MODELS } from '../src/assistant/providers/catalog.ts'
import { codexCliProviderDefinition } from '../src/assistant/providers/codex-cli.ts'
import { openAiCompatibleProviderDefinition } from '../src/assistant/providers/openai-compatible.ts'
import {
  executeAssistantProviderTurn,
  executeAssistantProviderTurnAttempt,
  executeAssistantProviderTurnAttemptWithDefinition,
  executeAssistantProviderTurnWithDefinition,
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
})

describe('assistant provider registry attempts', () => {
  it('resolves target labels, capabilities, and static models from inferred configs', () => {
    expect(resolveAssistantProviderLabel({ oss: true, profile: 'daily' })).toBe(
      'Codex OSS',
    )
    expect(resolveAssistantProviderTargetCapabilities({ oss: true })).toEqual({
      supportsModelDiscovery: false,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: false,
      supportsZeroDataRetention: false,
    })
    expect(resolveAssistantProviderTargetExecutionCapabilities({ oss: true })).toEqual({
      murphCommandSurface: 'direct-cli',
      requestFormat: 'flat-prompt',
      supportsModelDiscovery: false,
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      supportsRichUserMessageContent: false,
      supportsZeroDataRetention: false,
      supportsToolRuntime: false,
    })
    expect(resolveAssistantProviderStaticModels({ oss: true })).toEqual(
      DEFAULT_CODEX_MODELS,
    )

    const inferredOpenAiTarget = {
      apiKeyEnv: 'OPENROUTER_API_KEY',
      providerName: ' openrouter ',
    }

    expect(resolveAssistantProviderLabel(inferredOpenAiTarget)).toBe('OpenRouter')
    expect(
      resolveAssistantProviderTargetCapabilities(inferredOpenAiTarget),
    ).toEqual({
      supportsModelDiscovery: true,
      supportsNativeResume: false,
      supportsReasoningEffort: false,
      supportsRichUserMessageContent: true,
      supportsZeroDataRetention: false,
    })
    expect(
      resolveAssistantProviderTargetExecutionCapabilities(inferredOpenAiTarget),
    ).toEqual({
      murphCommandSurface: 'bound-tools',
      requestFormat: 'messages',
      supportsModelDiscovery: true,
      supportsNativeResume: false,
      supportsReasoningEffort: false,
      supportsRichUserMessageContent: true,
      supportsZeroDataRetention: false,
      supportsToolRuntime: true,
    })
    expect(resolveAssistantProviderStaticModels(inferredOpenAiTarget)).toEqual([])
  })

  it('merges failed attempt metadata with emitted command and tool labels only', async () => {
    const bubbledEvents: unknown[] = []
    const expectedError = new Error('provider returned a failed attempt')

    vi.spyOn(codexCliProviderDefinition, 'executeTurn').mockImplementation(
      async (input: AssistantProviderTurnExecutionInput) => {
        input.onEvent?.({
          id: 'event-search',
          kind: 'search',
          label: 'Search Web',
          rawEvent: { type: 'search' },
          state: 'running',
          text: 'searching',
        })
        input.onEvent?.({
          id: 'event-command',
          kind: 'command',
          label: '  Refresh Session  ',
          rawEvent: { type: 'command' },
          state: 'running',
          text: 'refreshing',
        })
        input.onEvent?.({
          id: 'event-tool',
          kind: 'tool',
          label: 'ignored raw label',
          rawEvent: { type: 'tool' },
          safeLabel: '  Use Calendar  ',
          state: 'completed',
          text: 'done',
        })

        return {
          error: expectedError,
          metadata: {
            activityLabels: ['  Existing Label  ', 'Refresh Session'],
            executedToolCount: 2,
            rawToolEvents: [{ type: 'raw-tool-event' }],
          },
          ok: false,
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

    expect(bubbledEvents).toHaveLength(3)
    expect(attempt).toEqual({
      error: expectedError,
      metadata: {
        activityLabels: ['Existing Label', 'Refresh Session', 'Use Calendar'],
        executedToolCount: 2,
        rawToolEvents: [{ type: 'raw-tool-event' }],
      },
      ok: false,
    })
  })

  it('seeds empty attempt metadata when a provider result omits metadata entirely', async () => {
    vi.spyOn(codexCliProviderDefinition, 'executeTurn').mockImplementation(
      async (input: AssistantProviderTurnExecutionInput) => {
        input.onEvent?.({
          id: 'event-tool',
          kind: 'tool',
          label: '  Search Web  ',
          rawEvent: { type: 'tool' },
          state: 'running',
          text: 'searching',
        })

        const attempt = {
          metadata: createAttemptMetadata(),
          ok: true as const,
          result: {
            provider: 'codex-cli' as const,
            providerSessionId: null,
            rawEvents: [],
            response: 'ok',
            stderr: '',
            stdout: '',
            usage: null,
          },
        }

        Reflect.deleteProperty(attempt, 'metadata')
        return attempt
      },
    )

    await expect(
      executeAssistantProviderTurnAttemptWithDefinition({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        workingDirectory: '/tmp/provider-tests',
      }),
    ).resolves.toEqual({
      metadata: {
        activityLabels: ['Search Web'],
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: true,
      result: {
        provider: 'codex-cli',
        providerSessionId: null,
        rawEvents: [],
        response: 'ok',
        stderr: '',
        stdout: '',
        usage: null,
      },
    })
  })

  it('fills empty attempt metadata when provider definitions omit it', async () => {
    vi.spyOn(codexCliProviderDefinition, 'executeTurn').mockImplementation(
      async () => {
        const attempt = {
          error: new Error('missing metadata'),
          metadata: createAttemptMetadata(),
          ok: false as const,
        }

        Reflect.set(attempt, 'metadata', null)
        return attempt
      },
    )

    const attempt = await executeAssistantProviderTurnAttemptWithDefinition({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt).toMatchObject({
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: false,
    })
  })

  it('throws the failed attempt error from executeAssistantProviderTurnWithDefinition', async () => {
    const expectedError = new Error('execution failed')

    vi.spyOn(openAiCompatibleProviderDefinition, 'executeTurn').mockResolvedValue({
      error: expectedError,
      metadata: {
        activityLabels: ['Attempted OpenAI-compatible call'],
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: false,
    })

    await expect(
      executeAssistantProviderTurnWithDefinition({
        prompt: 'test prompt',
        providerConfig: normalizeAssistantProviderConfig({
          apiKeyEnv: 'OPENAI_API_KEY',
          baseUrl: 'https://api.example.com/v1',
          provider: 'openai-compatible',
        }),
        workingDirectory: '/tmp/provider-tests',
      }),
    ).rejects.toBe(expectedError)
  })

  it('fills default attempt metadata when a provider returns none', async () => {
    vi.spyOn(openAiCompatibleProviderDefinition, 'executeTurn').mockImplementation(
      async () => {
        const attempt = {
          error: new Error('missing metadata'),
          metadata: createAttemptMetadata(),
          ok: false as const,
        }

        Reflect.deleteProperty(attempt, 'metadata')
        return attempt
      },
    )

    const attempt = await executeAssistantProviderTurnAttemptWithDefinition({
      providerConfig: normalizeAssistantProviderConfig({
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://api.example.com/v1',
        provider: 'openai-compatible',
      }),
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt).toMatchObject({
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: false,
    })
  })

  it('normalizes target config inputs before delegated attempt execution', async () => {
    let capturedInput: AssistantProviderTurnExecutionInput | null = null
    const executionResult: AssistantProviderTurnExecutionResult = {
      provider: 'openai-compatible',
      providerSessionId: 'provider-session-1',
      rawEvents: [],
      response: 'Attempt completed.',
      stderr: '',
      stdout: '',
      usage: null,
    }

    vi.spyOn(openAiCompatibleProviderDefinition, 'executeTurn').mockImplementation(
      async (input: AssistantProviderTurnExecutionInput) => {
        capturedInput = input
        return {
          metadata: {
            activityLabels: [],
            executedToolCount: 0,
            rawToolEvents: [],
          },
          ok: true,
          result: executionResult,
        }
      },
    )

    const attempt = await executeAssistantProviderTurnAttempt({
      apiKeyEnv: 'OPENROUTER_API_KEY',
      baseUrl: 'https://openrouter.ai/api/v1',
      prompt: 'summarize the latest changes',
      providerName: 'openrouter',
      resumeProviderSessionId: 'resume-1',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt).toEqual({
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: true,
      result: executionResult,
    })
    const executionInput = requireCapturedInput(capturedInput)
    expect(executionInput.providerConfig).toEqual(
      normalizeAssistantProviderConfig({
        apiKeyEnv: 'OPENROUTER_API_KEY',
        baseUrl: 'https://openrouter.ai/api/v1',
        providerName: 'openrouter',
      }),
    )
    expect(executionInput.prompt).toBe('summarize the latest changes')
    expect(executionInput.resumeProviderSessionId).toBe('resume-1')
  })

  it('returns successful execution results through executeAssistantProviderTurn', async () => {
    let capturedInput: AssistantProviderTurnExecutionInput | null = null
    const executionResult: AssistantProviderTurnExecutionResult = {
      provider: 'codex-cli',
      providerSessionId: 'provider-session-2',
      rawEvents: [],
      response: 'Turn completed.',
      stderr: '',
      stdout: '',
      usage: null,
    }

    vi.spyOn(codexCliProviderDefinition, 'executeTurn').mockImplementation(
      async (input: AssistantProviderTurnExecutionInput) => {
        capturedInput = input
        return {
          metadata: {
            activityLabels: [],
            executedToolCount: 0,
            rawToolEvents: [],
          },
          ok: true,
          result: executionResult,
        }
      },
    )

    const result = await executeAssistantProviderTurn({
      oss: true,
      prompt: 'reply with the latest status',
      resumeProviderSessionId: 'resume-2',
      showThinkingTraces: true,
      workingDirectory: '/tmp/provider-tests',
    })

    expect(result).toEqual(executionResult)
    const executionInput = requireCapturedInput(capturedInput)
    expect(executionInput.providerConfig).toEqual(
      normalizeAssistantProviderConfig({
        oss: true,
      }),
    )
    expect(executionInput.prompt).toBe('reply with the latest status')
    expect(executionInput.resumeProviderSessionId).toBe('resume-2')
    expect(executionInput.showThinkingTraces).toBe(true)
  })

  it('fills default attempt metadata when a provider definition omits it', async () => {
    vi.spyOn(codexCliProviderDefinition, 'executeTurn').mockImplementation(
      async () => {
        const attempt = {
          metadata: createAttemptMetadata(),
          ok: true as const,
          result: {
            provider: 'codex-cli' as const,
            providerSessionId: 'provider-session-minimal',
            rawEvents: [],
            response: 'done',
            stderr: '',
            stdout: '',
            usage: null,
          },
        }

        Reflect.deleteProperty(attempt, 'metadata')
        return attempt
      },
    )

    await expect(
      executeAssistantProviderTurnAttemptWithDefinition({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          oss: false,
        }),
        workingDirectory: '/tmp/provider-tests',
      }),
    ).resolves.toEqual({
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: true,
      result: {
        provider: 'codex-cli',
        providerSessionId: 'provider-session-minimal',
        rawEvents: [],
        response: 'done',
        stderr: '',
        stdout: '',
        usage: null,
      },
    })
  })
})

function requireCapturedInput(
  input: AssistantProviderTurnExecutionInput | null,
): AssistantProviderTurnExecutionInput {
  if (!input) {
    throw new Error('Expected provider execution input to be captured.')
  }

  return input
}

function createAttemptMetadata() {
  return {
    activityLabels: [],
    executedToolCount: 0,
    rawToolEvents: [],
  }
}
