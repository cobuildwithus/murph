import { afterEach, describe, expect, it, vi } from 'vitest'

const codexAppServerMocks = vi.hoisted(() => ({
  executeCodexAppServerTurn: vi.fn(),
  readCodexAppServerTurnFailureContext: vi.fn(),
}))
const diagnosticsMocks = vi.hoisted(() => ({
  recordAssistantDiagnosticEvent: vi.fn(),
}))
const turnsMocks = vi.hoisted(() => ({
  appendAssistantTurnReceiptEvent: vi.fn(),
}))

vi.mock('../src/assistant-codex.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/assistant-codex.ts')>()),
  executeCodexAppServerTurn: codexAppServerMocks.executeCodexAppServerTurn,
  readCodexAppServerTurnFailureContext:
    codexAppServerMocks.readCodexAppServerTurnFailureContext,
}))
vi.mock('../src/assistant/diagnostics.ts', () => ({
  recordAssistantDiagnosticEvent:
    diagnosticsMocks.recordAssistantDiagnosticEvent,
}))
vi.mock('../src/assistant/turns.ts', () => ({
  appendAssistantTurnReceiptEvent: turnsMocks.appendAssistantTurnReceiptEvent,
}))

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  createAssistantBinding,
  getAssistantBindingContextLines,
} from '../src/assistant/bindings.ts'
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
  recordCodexAttemptStarted,
  recordCodexPlan,
} from '../src/assistant/codex-turn/attempt-observability.ts'
import {
  executeCodexAssistantTurnAttempt,
  resolveCodexAssistantCapabilities,
  resolveCodexAssistantLabel,
  resolveCodexStaticModels,
  resolveCodexAssistantTargetCapabilities,
} from '../src/assistant/codex-runtime.ts'
import type { CodexThreadIdentity } from '../src/assistant/codex-thread-route.ts'
import type {
  AssistantProviderTurnExecutionResult,
} from '../src/assistant/providers/types.ts'
import type { AssistantProviderTraceEvent } from '../src/assistant/provider-traces.ts'

const TEST_FRESH_THREAD_FALLBACK = {
  turnContextPrompt: 'Fresh thread runtime context.',
} as const

afterEach(() => {
  codexAppServerMocks.executeCodexAppServerTurn.mockReset()
  codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReset()
  diagnosticsMocks.recordAssistantDiagnosticEvent.mockReset()
  turnsMocks.appendAssistantTurnReceiptEvent.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function readProviderTraceRawEvent(
  event: AssistantProviderTraceEvent | undefined,
): Record<string, unknown> {
  if (!event?.rawEvent || typeof event.rawEvent !== 'object' || Array.isArray(event.rawEvent)) {
    throw new Error('expected provider trace raw event record')
  }

  return event.rawEvent as Record<string, unknown>
}

function findProviderTraceRawEvent(
  events: readonly AssistantProviderTraceEvent[],
  providerTraceKind: string,
): Record<string, unknown> {
  const rawEvents = events
    .map((event) => readProviderTraceRawEvent(event))
    .filter((event) => event.providerTraceKind === providerTraceKind)
  if (rawEvents.length !== 1) {
    throw new Error(
      `expected exactly one provider trace kind ${providerTraceKind}, got ${rawEvents.length}`,
    )
  }

  return rawEvents[0]!
}

function findProviderPromptSizeTraceRawEvent(
  events: readonly AssistantProviderTraceEvent[],
  providerPromptDiagnosticKind: string,
): Record<string, unknown> {
  const rawEvents = events
    .map((event) => readProviderTraceRawEvent(event))
    .filter(
      (event) =>
        event.providerTraceKind === 'provider.prompt_size' &&
        event.providerPromptDiagnosticKind === providerPromptDiagnosticKind,
    )
  if (rawEvents.length !== 1) {
    throw new Error(
      `expected exactly one provider prompt-size trace kind ${providerPromptDiagnosticKind}, got ${rawEvents.length}`,
    )
  }

  return rawEvents[0]!
}

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

  it('records privacy-safe provider-attempt-started diagnostics', async () => {
    const providerConfig = normalizeAssistantProviderConfig({
      provider: 'codex-cli',
      model: 'gpt-5.4',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: 'prod',
      reasoningEffort: 'high',
    })
    const route: CodexThreadIdentity = {
      codexCommand: '/opt/murph/bin/codex',
      label: 'primary:Codex app-server:gpt-5.4:prod',
      provider: 'codex-cli',
      providerOptions: serializeAssistantProviderSessionOptions(providerConfig),
      routeId: 'route-1',
    }

    await recordCodexAttemptStarted({
      activeTurnMessagesPresent: true,
      attemptCount: 2,
      at: '2026-05-04T00:00:00.000Z',
      hasResumeCodexThreadId: true,
      codexContinuationKind: 'provider-state-optimization',
      refreshThreadInstructions: false,
      route,
      sessionId: 'session-1',
      turnId: 'turn-1',
      vault: '/vaults/test',
    })

    expect(turnsMocks.appendAssistantTurnReceiptEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'provider.attempt.started',
        metadata: {
          attempt: '2',
          model: 'gpt-5.4',
          provider: 'codex-cli',
          routeFingerprint: 'route-1',
        },
      }),
    )
    expect(diagnosticsMocks.recordAssistantDiagnosticEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'provider',
        kind: 'provider.attempt.started',
        sessionId: 'session-1',
        turnId: 'turn-1',
        data: {
          activeTurnMessagesPresent: true,
          attempt: 2,
          hasResumeCodexThreadId: true,
          model: 'gpt-5.4',
          modelProvider: 'vercel-ai-gateway',
          provider: 'codex-cli',
          codexContinuationKind: 'provider-state-optimization',
          reasoningEffort: 'high',
          refreshThreadInstructions: false,
          routeFingerprint: 'route-1',
        },
      }),
    )
    expect(
      diagnosticsMocks.recordAssistantDiagnosticEvent.mock.calls[0]?.[0]?.data,
    ).toEqual({
      activeTurnMessagesPresent: true,
      attempt: 2,
      hasResumeCodexThreadId: true,
      model: 'gpt-5.4',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      codexContinuationKind: 'provider-state-optimization',
      reasoningEffort: 'high',
      refreshThreadInstructions: false,
      routeFingerprint: 'route-1',
    })
  })

  it('records provider-plan diagnostics for production resume verification', async () => {
    vi.stubEnv('HOSTED_LOG_FINGERPRINT_SECRET', 'diagnostic-secret')
    const providerConfig = normalizeAssistantProviderConfig({
      provider: 'codex-cli',
      codexHome: '/operator-home/.codex-hosted',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      reasoningEffort: 'low',
    })
    const route: CodexThreadIdentity = {
      codexCommand: null,
      label: 'primary:Codex app-server:gpt-5.5',
      provider: 'codex-cli',
      providerOptions: serializeAssistantProviderSessionOptions(providerConfig),
      routeId: 'route-plan',
    }

    await recordCodexPlan({
      activeTurnHistoryMessageCount: 3,
      activeTurnHistoryPresent: true,
      at: '2026-05-04T00:10:24.000Z',
      codexContinuation: 'provider-state-optimization',
      providerRequestOrdinal: 1,
      refreshThreadInstructions: false,
      resumeCodexThreadIdPresent: true,
      route,
      sessionId: 'session-plan',
      turnId: 'turn-plan',
      vault: '/vaults/test',
      vaultRoot: '/vaults/test',
      workingDirectory: '/proc/self/cwd',
    })

    expect(diagnosticsMocks.recordAssistantDiagnosticEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'provider',
        kind: 'provider.plan',
        message: 'Assistant provider plan resolved.',
        sessionId: 'session-plan',
        turnId: 'turn-plan',
        data: {
          activeTurnHistoryPresent: true,
          activeTurnHistoryMessageCount: 3,
          codexHomeHash: expect.stringMatching(/^h1_[a-f0-9]{24}$/u),
          codexContinuation: 'provider-state-optimization',
          providerRequestOrdinal: 1,
          refreshThreadInstructions: false,
          resumeCodexThreadIdPresent: true,
          routeFingerprint: 'route-plan',
          sessionId: 'session-plan',
          vaultRootHash: expect.stringMatching(/^h1_[a-f0-9]{24}$/u),
          workingDirectoryHash: expect.stringMatching(/^h1_[a-f0-9]{24}$/u),
          workingDirectoryKind: 'hosted-stable-proc-cwd',
        },
      }),
    )
    const dataJson = JSON.stringify(
      diagnosticsMocks.recordAssistantDiagnosticEvent.mock.calls[0]?.[0]?.data,
    )
    expect(dataJson).not.toContain('/vaults/test')
    expect(dataJson).not.toContain('/operator-home')
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
        cachedInputTokens: 8,
        inputTokens: 44,
        outputTokens: 9,
        totalTokens: 53,
      },
      expectedRawUsageJson: {
        completion_tokens: 9,
        prompt_tokens: 44,
        prompt_tokens_details: {
          cached_tokens: 8,
        },
        total_tokens: 53,
      },
      expectedSourcePath: 'params.usage',
      name: 'OpenAI chat usage prompt token detail aliases',
      rawEvents: [
        {
          params: {
            turn: {
              id: 'turn-chat-usage',
              model: 'gpt-5.4',
            },
            usage: {
              completion_tokens: 9,
              prompt_tokens: 44,
              prompt_tokens_details: {
                cached_tokens: 8,
              },
              total_tokens: 53,
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
      expectedSourcePath: 'thread.tokenUsage.total.delta',
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
    {
      expected: {
        cachedInputTokens: 41216,
        inputTokens: 67969,
        outputTokens: 185,
        reasoningTokens: 0,
        totalTokens: 68154,
      },
      expectedRawUsageJson: {
        cachedInputTokens: 41216,
        inputTokens: 67969,
        outputTokens: 185,
        reasoningOutputTokens: 0,
        totalTokens: 68154,
      },
      expectedSourcePath: 'thread.tokenUsage.total.delta',
      name: 'multiple Codex token usage notifications use current-turn total delta accounting',
      rawEvents: [
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-multi-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 7552,
                inputTokens: 33848,
                outputTokens: 172,
                reasoningOutputTokens: 0,
                totalTokens: 34020,
              },
              total: {
                cachedInputTokens: 7552,
                inputTokens: 33848,
                outputTokens: 172,
                reasoningOutputTokens: 0,
                totalTokens: 34020,
              },
            },
            turnId: 'turn-multi-token-usage',
          },
        },
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-multi-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 33664,
                inputTokens: 34121,
                outputTokens: 13,
                reasoningOutputTokens: 0,
                totalTokens: 34134,
              },
              total: {
                cachedInputTokens: 41216,
                inputTokens: 67969,
                outputTokens: 185,
                reasoningOutputTokens: 0,
                totalTokens: 68154,
              },
            },
            turnId: 'turn-multi-token-usage',
          },
        },
        {
          params: {
            turn: {
              id: 'turn-multi-token-usage',
              model: 'gpt-5.4',
            },
          },
          type: 'turn.completed',
        },
      ],
    },
    {
      expected: {
        cachedInputTokens: 11136,
        inputTokens: 11532,
        outputTokens: 16,
        reasoningTokens: 0,
        totalTokens: 11548,
      },
      expectedRawUsageJson: {
        cachedInputTokens: 11136,
        inputTokens: 11532,
        outputTokens: 16,
        reasoningOutputTokens: 0,
        totalTokens: 11548,
      },
      expectedSourcePath: 'thread.tokenUsage.total.delta',
      name: 'resumed Codex token usage ignores thread-cumulative total',
      rawEvents: [
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-resumed-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 11136,
                inputTokens: 11532,
                outputTokens: 16,
                reasoningOutputTokens: 0,
                totalTokens: 11548,
              },
              total: {
                cachedInputTokens: 11136,
                inputTokens: 23037,
                outputTokens: 42,
                reasoningOutputTokens: 0,
                totalTokens: 23079,
              },
            },
            turnId: 'turn-resumed-token-usage',
          },
        },
        {
          params: {
            turn: {
              id: 'turn-resumed-token-usage',
              model: 'gpt-5.4',
            },
          },
          type: 'turn.completed',
        },
      ],
    },
    {
      expected: {
        cachedInputTokens: 33664,
        inputTokens: 34121,
        outputTokens: 13,
        reasoningTokens: 0,
        totalTokens: 34134,
      },
      expectedRawUsageJson: {
        cachedInputTokens: 33664,
        inputTokens: 34121,
        outputTokens: 13,
        reasoningOutputTokens: 0,
        totalTokens: 34134,
      },
      expectedSourcePath: 'thread.tokenUsage.total.delta',
      name: 'resumed Codex token usage ignores restored previous-turn notification',
      rawEvents: [
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-resume-replay-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 7552,
                inputTokens: 33848,
                outputTokens: 172,
                reasoningOutputTokens: 0,
                totalTokens: 34020,
              },
              total: {
                cachedInputTokens: 7552,
                inputTokens: 33848,
                outputTokens: 172,
                reasoningOutputTokens: 0,
                totalTokens: 34020,
              },
            },
            turnId: 'turn-previous-token-usage',
          },
        },
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-resume-replay-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 33664,
                inputTokens: 34121,
                outputTokens: 13,
                reasoningOutputTokens: 0,
                totalTokens: 34134,
              },
              total: {
                cachedInputTokens: 41216,
                inputTokens: 67969,
                outputTokens: 185,
                reasoningOutputTokens: 0,
                totalTokens: 68154,
              },
            },
            turnId: 'turn-current-token-usage',
          },
        },
        {
          params: {
            turn: {
              id: 'turn-current-token-usage',
              model: 'gpt-5.4',
            },
          },
          type: 'turn.completed',
        },
      ],
    },
    {
      expected: {
        cachedInputTokens: 0,
        inputTokens: 38474,
        outputTokens: 27,
        reasoningTokens: 0,
        totalTokens: 38501,
      },
      expectedRawUsageJson: {
        cachedInputTokens: 0,
        inputTokens: 38474,
        outputTokens: 27,
        reasoningOutputTokens: 0,
        totalTokens: 38501,
      },
      expectedSourcePath: 'thread.tokenUsage.total.delta',
      name: 'resumed Codex token usage ignores replayed pre-output cumulative notification',
      rawEvents: [
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-resume-prestart-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 0,
                inputTokens: 37815,
                outputTokens: 202,
                reasoningOutputTokens: 46,
                totalTokens: 38017,
              },
              total: {
                cachedInputTokens: 0,
                inputTokens: 37815,
                outputTokens: 202,
                reasoningOutputTokens: 46,
                totalTokens: 38017,
              },
            },
            turnId: 'turn-resume-prestart-token-usage',
          },
        },
        {
          method: 'turn/started',
          params: {
            turn: {
              id: 'turn-resume-prestart-token-usage',
            },
          },
        },
        {
          method: 'item/started',
          params: {
            item: {
              content: [
                {
                  text: 'Reply briefly.',
                  type: 'text',
                },
              ],
              id: 'item-resume-prestart-user',
              type: 'userMessage',
            },
            threadId: 'thread-resume-prestart-token-usage',
            turnId: 'turn-resume-prestart-token-usage',
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              content: [
                {
                  text: 'Reply briefly.',
                  type: 'text',
                },
              ],
              id: 'item-resume-prestart-user',
              type: 'userMessage',
            },
            threadId: 'thread-resume-prestart-token-usage',
            turnId: 'turn-resume-prestart-token-usage',
          },
        },
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-resume-prestart-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 0,
                inputTokens: 37815,
                outputTokens: 202,
                reasoningOutputTokens: 46,
                totalTokens: 38017,
              },
              total: {
                cachedInputTokens: 0,
                inputTokens: 37815,
                outputTokens: 202,
                reasoningOutputTokens: 46,
                totalTokens: 38017,
              },
            },
            turnId: 'turn-resume-prestart-token-usage',
          },
        },
        {
          method: 'item/agentMessage/delta',
          params: {
            delta: 'OK',
            itemId: 'item-resume-prestart-agent',
            threadId: 'thread-resume-prestart-token-usage',
            turnId: 'turn-resume-prestart-token-usage',
          },
        },
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-resume-prestart-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 0,
                inputTokens: 38474,
                outputTokens: 27,
                reasoningOutputTokens: 0,
                totalTokens: 38501,
              },
              total: {
                cachedInputTokens: 0,
                inputTokens: 76289,
                outputTokens: 229,
                reasoningOutputTokens: 46,
                totalTokens: 76518,
              },
            },
            turnId: 'turn-resume-prestart-token-usage',
          },
        },
        {
          params: {
            turn: {
              id: 'turn-resume-prestart-token-usage',
              model: 'gpt-5.4',
            },
          },
          type: 'turn.completed',
        },
      ],
    },
    {
      expected: {
        cachedInputTokens: 55,
        inputTokens: 89,
        outputTokens: 21,
        reasoningTokens: 8,
        totalTokens: 118,
      },
      expectedRawUsageJson: {
        cachedInputTokens: 55,
        inputTokens: 89,
        outputTokens: 21,
        reasoningOutputTokens: 8,
        totalTokens: 118,
      },
      expectedSourcePath: 'thread.tokenUsage.last',
      name: 'Codex token usage notification with empty completion usage',
      rawEvents: [
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-empty-completion-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 55,
                inputTokens: 89,
                outputTokens: 21,
                reasoningOutputTokens: 8,
                totalTokens: 118,
              },
            },
            turnId: 'turn-empty-completion-usage',
          },
        },
        {
          params: {
            turn: {
              id: 'turn-empty-completion-usage',
              model: 'gpt-5.4',
              usage: {},
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

  it('composes turn prompts from binding context and the user prompt', () => {
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
        'User message:',
        'What changed today?',
      ].join('\n'),
    )

    expect(
      resolveAssistantProviderPrompt({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        resumeCodexThreadId: 'codex-session-1',
        systemPrompt: 'You are Murph.',
        userPrompt: '  What changed today?  ',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toBe('User message:\nWhat changed today?')

    expect(
      resolveAssistantProviderPrompt({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        resumeCodexThreadId: 'codex-session-1',
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

  it('serializes active turn content into a Codex flat prompt', () => {
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

  it('emits metadata-only provider prompt-size diagnostics', async () => {
    const traceEvents: AssistantProviderTraceEvent[] = []
    const activeTurnHistoryPrompt =
      'Active turn so far:\nAssistant:\nprivate draft should not be logged'
    const sessionBinding = createAssistantBinding({
      actorId: 'actor-private',
      channel: 'telegram',
      identityId: 'identity-private',
      threadId: 'thread-private',
      threadIsDirect: true,
    })
    const conversationContextPrompt =
      `Conversation context:\n${getAssistantBindingContextLines(sessionBinding).join('\n')}`
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'ok',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-thread-prompt-size',
      stderr: '',
      stdout: '',
      threadId: 'codex-thread-prompt-size',
      turnId: 'turn-prompt-size',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      activeTurnMessages: [
        {
          content: 'private draft should not be logged',
          role: 'assistant',
        },
      ],
      developerInstructions: 'Private developer instructions.',
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      refreshThreadInstructions: true,
      sessionContext: {
        binding: sessionBinding,
      },
      systemPrompt: 'Private system prompt 💚.',
      turnContextPrompt: 'Private runtime context.',
      userPrompt: 'hello',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    const prompt =
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]?.prompt
    if (typeof prompt !== 'string') {
      throw new Error('expected Codex prompt')
    }
    const diagnostic = findProviderPromptSizeTraceRawEvent(
      traceEvents,
      'primary',
    )
    expect(diagnostic).toMatchObject({
      activeTurnHistoryCount: 1,
      activeTurnHistoryBytes: Buffer.byteLength(activeTurnHistoryPrompt, 'utf8'),
      activeTurnHistoryPresent: true,
      conversationContextBytes: Buffer.byteLength(conversationContextPrompt, 'utf8'),
      conversationContextPresent: true,
      developerInstructionsBytes: Buffer.byteLength(
        'Private developer instructions.',
        'utf8',
      ),
      developerInstructionsPresent: true,
      providerPromptBytes: Buffer.byteLength(prompt, 'utf8'),
      providerPromptDiagnosticKind: 'primary',
      providerTraceKind: 'provider.prompt_size',
      refreshThreadInstructions: true,
      resumeCodexThreadIdPresent: false,
      schema: 'murph.assistant-provider-prompt-size-diagnostics.v1',
      systemPromptBytes: Buffer.byteLength('Private system prompt 💚.', 'utf8'),
      turnContextPromptBytes: Buffer.byteLength(
        'Private runtime context.',
        'utf8',
      ),
      type: 'assistant.provider.prompt_size',
      userPromptBytes: Buffer.byteLength('hello', 'utf8'),
    })
    const serializedDiagnostic = JSON.stringify(diagnostic)
    expect(serializedDiagnostic).not.toContain('hello')
    expect(serializedDiagnostic).not.toContain('private draft')
    expect(serializedDiagnostic).not.toContain('Private developer')
    expect(serializedDiagnostic).not.toContain('Private system')
    expect(serializedDiagnostic).not.toContain('Private runtime')
    expect(serializedDiagnostic).not.toContain('actor-private')
    expect(serializedDiagnostic).not.toContain('identity-private')
    expect(serializedDiagnostic).not.toContain('thread-private')
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
      codexThreadId: 'provider-session-1',
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
          sessionId: executionResult.codexThreadId,
          stderr: executionResult.stderr,
          stdout: executionResult.stdout,
          threadId: executionResult.codexThreadId,
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

  it('passes Venice provider id and config overrides through the Codex app-server seam', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Completed with Venice.',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'venice-thread',
      stderr: '',
      stdout: '',
      threadId: 'venice-thread',
      turnId: 'turn-venice',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'venice-model',
        modelProvider: 'venice',
      }),
      userPrompt: 'Run Venice.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    const appServerInput = codexAppServerMocks.executeCodexAppServerTurn.mock
      .calls[0]?.[0]
    expect(appServerInput).toMatchObject({
      model: 'venice-model',
      modelProvider: 'venice',
    })
    expect(appServerInput?.configOverrides).toEqual(
      expect.arrayContaining([
        'model_providers.venice.name="Venice.ai"',
        'model_providers.venice.base_url="https://api.venice.ai/api/v1"',
        'model_providers.venice.env_key="VENICE_API_KEY"',
        'model_providers.venice.wire_api="responses"',
        'model_providers.venice.requires_openai_auth=false',
        'shell_environment_policy.ignore_default_excludes=false',
      ]),
    )
  })

  it('replays active-turn history only on stale native-resume fallback', async () => {
    const traceEvents: AssistantProviderTraceEvent[] = []

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
      freshThreadFallback: TEST_FRESH_THREAD_FALLBACK,
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      resumeCodexThreadId: 'stale-thread',
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
    expect(attempt.result.codexContinuation).toEqual({
      kind: 'thread-start',
    })
    expect(findProviderPromptSizeTraceRawEvent(
      traceEvents,
      'primary',
    )).toMatchObject({
      activeTurnHistoryCount: 0,
      activeTurnHistoryPresent: false,
      providerPromptDiagnosticKind: 'primary',
      refreshThreadInstructions: false,
      resumeCodexThreadIdPresent: true,
    })
    expect(findProviderPromptSizeTraceRawEvent(
      traceEvents,
      'fresh-thread-fallback',
    )).toMatchObject({
      activeTurnHistoryCount: 2,
      activeTurnHistoryPresent: true,
      providerPromptDiagnosticKind: 'fresh-thread-fallback',
      refreshThreadInstructions: true,
      resumeCodexThreadIdPresent: false,
    })
    expect(findProviderTraceRawEvent(
      traceEvents,
      'codex.resume_failure',
    )).toMatchObject({
      codexResumeFailureErrorCode: 'ASSISTANT_CODEX_RESUME_STALE',
      codexResumeFailureErrorKind: 'resume-stale',
      codexResumeFailureEventCount: null,
      codexResumeFailurePhase: 'resume-failed',
      codexResumeFailureProviderActionCount: null,
      codexResumeFailureResumeMatchesFailureSession: null,
      codexResumeFailureResumeSessionPresent: true,
      codexResumeFailureSessionPresent: false,
      codexResumeFailureTraceType: 'failure',
      codexResumeFailureTurnPresent: false,
      providerTraceKind: 'codex.resume_failure',
    })
  })

  it('starts a fresh thread when resumed Codex history has invalid tool output', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server turn failed. status failed. {"error":{"type":"invalid_request_error","message":"input.193.output: Invalid input"}}',
    )
    const traceEvents: AssistantProviderTraceEvent[] = []

    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(expectedError)
      .mockResolvedValueOnce({
        finalMessage: 'final after invalid resume fallback',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: 'fresh-thread-after-invalid-output',
        stderr: '',
        stdout: '',
        threadId: 'fresh-thread-after-invalid-output',
        turnId: 'turn-fallback-invalid-output',
      })
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValueOnce({
      jsonEvents: [
        {
          method: 'turn/started',
          params: {
            turn: {
              status: 'in_progress',
            },
          },
        },
        {
          method: 'turn/completed',
          params: {
            output: [
              {
                text: 'private tool text should not be logged',
                type: 'input_text',
              },
              {
                image_url: 'https://example.invalid/private.png',
                type: 'input_image',
              },
              {
                type: 'https://example.invalid/raw-part-type',
              },
            ],
            turn: {
              error: {
                type: 'invalid_request_error',
              },
              status: 'failed',
            },
          },
        },
        {
          method: 'turn/completed',
          params: {
            output: {
              HbA1c: '9.1',
              text: 'private health text should not be logged',
              type: 'result',
            },
          },
        },
      ],
      providerActionCount: 0,
      codexThreadId: 'corrupt-thread',
      providerTurnId: 'turn-invalid-output',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      activeTurnMessages: [
        {
          content: 'initial prompt',
          role: 'user',
        },
        {
          content: 'draft before invalid resume',
          role: 'assistant',
        },
      ],
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      freshThreadFallback: TEST_FRESH_THREAD_FALLBACK,
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      resumeCodexThreadId: 'corrupt-thread',
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(2)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0],
    ).toMatchObject({
      prompt: expect.not.stringContaining('Active turn so far:'),
      resumeSessionId: 'corrupt-thread',
    })
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0],
    ).toMatchObject({
      prompt: expect.stringContaining('Active turn so far:'),
      resumeSessionId: undefined,
    })
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0]?.prompt,
    ).toContain('draft before invalid resume')
    if (!attempt.ok) {
      throw new Error('expected successful provider attempt')
    }
    expect(attempt.result.codexContinuation).toEqual({
      kind: 'thread-start',
    })
    expect(attempt.result.codexThreadId).toBe('fresh-thread-after-invalid-output')
    expect(findProviderTraceRawEvent(
      traceEvents,
      'codex.invalid_output_resume_failure',
    )).toMatchObject({
      codexInvalidOutputErrorCode: 'ASSISTANT_CODEX_FAILED',
      codexInvalidOutputErrorField: 'input.193.output',
      codexInvalidOutputErrorKind: 'invalid-input-output',
      codexInvalidOutputErrorMessageLength: expectedError.message.length,
      codexInvalidOutputFallbackAttempted: true,
      codexInvalidOutputFailureEventCount: 3,
      codexInvalidOutputFailureEventMethods: ['turn/started', 'turn/completed'],
      codexInvalidOutputFailureOutputArrayLengths: [3],
      codexInvalidOutputFailureOutputKinds: ['array', 'object'],
      codexInvalidOutputFailureOutputObjectKeys: ['[key],text,type'],
      codexInvalidOutputFailureOutputPartTypes: ['input_text', 'input_image', 'object'],
      codexInvalidOutputFailureProviderActionCount: 0,
      codexInvalidOutputFailureSessionPresent: true,
      codexInvalidOutputFailureTurnPresent: true,
      codexInvalidOutputInputIndex: 193,
      codexInvalidOutputPhase: 'resume-failed',
      codexInvalidOutputResumeMatchesFailureSession: true,
      codexInvalidOutputResumeSessionPresent: true,
      codexInvalidOutputTraceType: 'failure',
      providerTraceKind: 'codex.invalid_output_resume_failure',
      schema: 'murph.assistant-codex-invalid-output-diagnostics.v1',
      type: 'assistant.codex.invalid_output_resume_failure',
    })
    expect(findProviderTraceRawEvent(
      traceEvents,
      'codex.invalid_output_resume_fallback',
    )).toMatchObject({
      codexInvalidOutputFallbackEventCount: 0,
      codexInvalidOutputFallbackProviderActionCount: 0,
      codexInvalidOutputFallbackResult: 'succeeded',
      codexInvalidOutputFallbackSessionChanged: true,
      codexInvalidOutputFallbackSessionPresent: true,
      codexInvalidOutputFallbackTurnPresent: true,
      codexInvalidOutputPhase: 'fallback-succeeded',
      codexInvalidOutputTraceType: 'fallback',
      providerTraceKind: 'codex.invalid_output_resume_fallback',
      type: 'assistant.codex.invalid_output_resume_fallback',
    })
    expect(JSON.stringify(traceEvents)).not.toContain('private tool text')
    expect(JSON.stringify(traceEvents)).not.toContain('private health text')
    expect(JSON.stringify(traceEvents)).not.toContain('HbA1c')
    expect(JSON.stringify(traceEvents)).not.toContain('example.invalid')
  })

  it('fresh-thread retries invalid resumed output after provider actions', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server turn failed. status failed. {"error":{"type":"invalid_request_error","message":"input.193.output: Invalid input"}}',
    )
    const rawEvents = [{ method: 'turn/completed' }]

    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(expectedError)
      .mockResolvedValueOnce({
        finalMessage: 'final after provider-action invalid resume fallback',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: 'fresh-thread-after-provider-action-invalid-output',
        stderr: '',
        stdout: '',
        threadId: 'fresh-thread-after-provider-action-invalid-output',
        turnId: 'turn-fallback-provider-action-invalid-output',
      })
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValueOnce({
      jsonEvents: rawEvents,
      providerActionCount: 1,
      codexThreadId: 'corrupt-thread',
      providerTurnId: 'turn-invalid-output',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      freshThreadFallback: TEST_FRESH_THREAD_FALLBACK,
      resumeCodexThreadId: 'corrupt-thread',
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(2)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0],
    ).toMatchObject({
      resumeSessionId: 'corrupt-thread',
    })
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0],
    ).toMatchObject({
      resumeSessionId: undefined,
    })
    if (!attempt.ok) {
      throw new Error('expected successful provider attempt')
    }
    expect(attempt.result.codexContinuation).toEqual({
      kind: 'thread-start',
    })
    expect(attempt.result.codexThreadId).toBe(
      'fresh-thread-after-provider-action-invalid-output',
    )
  })

  it('records resumed Codex turn failure diagnostics without raw strings', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server turn failed. status failed. retry limit reached after resumed turn',
      {
        codexAbortRequested: false,
        codexExitSignal: 'SIGKILL',
        codexFailureStage: 'turn_failed',
        codexJsonEventCount: 3,
        codexLifecycleStage: 'turn_running',
        codexLiveTurnOpen: true,
        codexPendingRpcCount: 1,
        codexPendingRpcMethod: 'turn/start',
        codexProcessGroupPresent: true,
        codexProcessLifetimeMs: 2041,
        codexProviderRequestStarted: true,
        codexShutdownRequested: false,
        codexStderrBytes: 128,
        codexTerminationSignalSent: 'SIGTERM',
        codexTurnStatus: 'failed',
        retryable: false,
      },
    )
    const traceEvents: AssistantProviderTraceEvent[] = []

    codexAppServerMocks.executeCodexAppServerTurn.mockRejectedValueOnce(expectedError)
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValueOnce({
      jsonEvents: [
        {
          method: 'turn/started',
          params: {
            turn: {
              status: 'in_progress',
            },
          },
        },
        {
          method: 'turn/completed',
          params: {
            output: [
              {
                text: 'private tool text should not be logged',
                type: 'input_text',
              },
              {
                image_url: 'https://example.invalid/private.png',
                type: 'input_image',
              },
              {
                type: 'process_exit',
              },
            ],
            turn: {
              status: 'failed',
            },
          },
        },
        {
          method: 'turn/completed',
          params: {
            output: {
              privateField: 'private value',
              text: 'private output text should not be logged',
              type: 'result',
            },
          },
        },
      ],
      providerActionCount: 0,
      codexThreadId: 'resume-thread',
      providerTurnId: 'turn-failed',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      freshThreadFallback: TEST_FRESH_THREAD_FALLBACK,
      resumeCodexThreadId: 'resume-thread',
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    if (attempt.ok) {
      throw new Error('expected failed provider attempt')
    }
    expect(attempt.error).toBe(expectedError)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(findProviderTraceRawEvent(
      traceEvents,
      'codex.resume_failure',
    )).toMatchObject({
      codexResumeFailureCodexAbortRequested: false,
      codexResumeFailureCodexExitSignal: 'SIGKILL',
      codexResumeFailureCodexFailureStage: 'turn_failed',
      codexResumeFailureCodexTurnStatus: 'failed',
      codexResumeFailureCodexJsonEventCount: 3,
      codexResumeFailureCodexLifecycleStage: 'turn_running',
      codexResumeFailureCodexLiveTurnOpen: true,
      codexResumeFailureCodexPendingRpcCount: 1,
      codexResumeFailureCodexPendingRpcMethod: 'turn/start',
      codexResumeFailureCodexProcessGroupPresent: true,
      codexResumeFailureCodexProcessLifetimeMs: 2041,
      codexResumeFailureCodexProviderRequestStarted: true,
      codexResumeFailureCodexShutdownRequested: false,
      codexResumeFailureCodexStderrBytes: 128,
      codexResumeFailureCodexTerminationSignalSent: 'SIGTERM',
      codexResumeFailureErrorCode: 'ASSISTANT_CODEX_FAILED',
      codexResumeFailureErrorKind: 'turn-failed',
      codexResumeFailureErrorMessage: expectedError.message,
      codexResumeFailureErrorMessageLength: expectedError.message.length,
      codexResumeFailureErrorMessagePresent: true,
      codexResumeFailureErrorPhrases: ['codex-turn-failed', 'status-failed'],
      codexResumeFailureEventCount: 3,
      codexResumeFailureEventMethods: ['turn/started', 'turn/completed'],
      codexResumeFailureEventStatuses: ['in_progress', 'failed'],
      codexResumeFailureOutputArrayLengths: [3],
      codexResumeFailureOutputKinds: ['array', 'object'],
      codexResumeFailureOutputObjectKeys: ['[key],text,type'],
      codexResumeFailureOutputPartTypes: ['input_text', 'input_image', 'process_exit'],
      codexResumeFailureParamKeys: ['[key]', 'output,[key]', 'output'],
      codexResumeFailurePhase: 'resume-failed',
      codexResumeFailureProviderActionCount: 0,
      codexResumeFailureResumeMatchesFailureSession: true,
      codexResumeFailureResumeSessionPresent: true,
      codexResumeFailureRetryable: false,
      codexResumeFailureSessionPresent: true,
      codexResumeFailureTraceType: 'failure',
      codexResumeFailureTurnPresent: true,
      providerTraceKind: 'codex.resume_failure',
      schema: 'murph.assistant-codex-resume-failure-diagnostics.v1',
      type: 'assistant.codex.resume_failure',
    })
    expect(JSON.stringify(traceEvents)).not.toContain('private tool text')
    expect(JSON.stringify(traceEvents)).not.toContain('private output text')
    expect(JSON.stringify(traceEvents)).not.toContain('privateField')
    expect(JSON.stringify(traceEvents)).not.toContain('example.invalid')
  })

  it('records resumed Codex diagnostics for structural error objects', async () => {
    const expectedError = {
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexFailureStage: 'turn_failed',
        codexTurnStatus: 'failed',
        retryable: false,
      },
      message:
        'Codex app-server turn failed. status failed. Authorization: Bearer raw-token-value at /tmp/provider-tests',
    }
    const traceEvents: AssistantProviderTraceEvent[] = []

    codexAppServerMocks.executeCodexAppServerTurn.mockRejectedValueOnce(
      expectedError,
    )
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValueOnce({
      jsonEvents: [
        {
          method: 'turn/completed',
          params: {
            turn: {
              status: 'failed',
            },
          },
        },
      ],
      providerActionCount: 0,
      codexThreadId: 'resume-thread',
      providerTurnId: 'turn-failed',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      freshThreadFallback: TEST_FRESH_THREAD_FALLBACK,
      resumeCodexThreadId: 'resume-thread',
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    if (attempt.ok) {
      throw new Error('expected failed provider attempt')
    }
    expect(attempt.error).toBe(expectedError)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(findProviderTraceRawEvent(
      traceEvents,
      'codex.resume_failure',
    )).toMatchObject({
      codexResumeFailureCodexFailureStage: 'turn_failed',
      codexResumeFailureCodexTurnStatus: 'failed',
      codexResumeFailureErrorCode: 'ASSISTANT_CODEX_FAILED',
      codexResumeFailureErrorKind: 'turn-failed',
      codexResumeFailureErrorMessage:
        'Codex app-server turn failed. status failed. Authorization: [REDACTED] at [path]',
      codexResumeFailureErrorMessageLength: expectedError.message.length,
      codexResumeFailureErrorMessagePresent: true,
      codexResumeFailureErrorPhrases: ['codex-turn-failed', 'status-failed'],
      codexResumeFailureEventCount: 1,
      codexResumeFailureEventMethods: ['turn/completed'],
      codexResumeFailureEventStatuses: ['failed'],
      codexResumeFailurePhase: 'resume-failed',
      codexResumeFailureProviderActionCount: 0,
      codexResumeFailureResumeMatchesFailureSession: true,
      codexResumeFailureResumeSessionPresent: true,
      codexResumeFailureRetryable: false,
      codexResumeFailureSessionPresent: true,
      codexResumeFailureTraceType: 'failure',
      codexResumeFailureTurnPresent: true,
      providerTraceKind: 'codex.resume_failure',
      schema: 'murph.assistant-codex-resume-failure-diagnostics.v1',
      type: 'assistant.codex.resume_failure',
    })
    expect(JSON.stringify(traceEvents)).not.toContain('raw-token-value')
    expect(JSON.stringify(traceEvents)).not.toContain('/tmp/provider-tests')
  })

  it('records invalid resumed output diagnostics when fresh-thread fallback fails', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server turn failed. status failed. {"error":{"type":"invalid_request_error","message":"input.7.output: Invalid input"}}',
    )
    const fallbackError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'fallback failed after echoing HbA1c 9.1 and https://example.invalid/private',
    )
    const traceEvents: AssistantProviderTraceEvent[] = []

    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(expectedError)
      .mockRejectedValueOnce(fallbackError)
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValueOnce({
      jsonEvents: [{ method: 'turn/completed' }],
      providerActionCount: 2,
      codexThreadId: 'corrupt-thread',
      providerTurnId: 'turn-invalid-output',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      freshThreadFallback: TEST_FRESH_THREAD_FALLBACK,
      resumeCodexThreadId: 'corrupt-thread',
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    if (attempt.ok) {
      throw new Error('expected failed provider attempt')
    }
    expect(attempt.error).toBe(fallbackError)
    expect(findProviderTraceRawEvent(
      traceEvents,
      'codex.invalid_output_resume_failure',
    )).toMatchObject({
      codexInvalidOutputFailureProviderActionCount: 2,
      codexInvalidOutputInputIndex: 7,
      codexInvalidOutputPhase: 'resume-failed',
      providerTraceKind: 'codex.invalid_output_resume_failure',
    })
    expect(findProviderTraceRawEvent(
      traceEvents,
      'codex.invalid_output_resume_fallback',
    )).toMatchObject({
      codexInvalidOutputFallbackErrorCode: 'ASSISTANT_CODEX_FAILED',
      codexInvalidOutputFallbackErrorMessageLength: fallbackError.message.length,
      codexInvalidOutputFallbackErrorMessagePresent: true,
      codexInvalidOutputFallbackResult: 'failed',
      codexInvalidOutputPhase: 'fallback-failed',
      providerTraceKind: 'codex.invalid_output_resume_fallback',
    })
    expect(JSON.stringify(traceEvents)).not.toContain('HbA1c')
    expect(JSON.stringify(traceEvents)).not.toContain('example.invalid')
  })

  it('adds the Venice runtime hint when invalid-output fallback fails', async () => {
    const authHeaderPrefix = ['Authorization:', 'Bearer'].join(' ')
    const sentinel = 'venice_secret_SENTINEL'
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server turn failed. status failed. {"error":{"type":"invalid_request_error","message":"input.7.output: Invalid input"}}',
    )
    const fallbackError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      `fallback failed: ${authHeaderPrefix} ${sentinel}; VENICE_API_KEY=${sentinel}; raw ${sentinel}`,
    )

    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(expectedError)
      .mockRejectedValueOnce(fallbackError)
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValueOnce({
      jsonEvents: [{ method: 'turn/completed' }],
      providerActionCount: 0,
      codexThreadId: 'corrupt-venice-thread',
      providerTurnId: 'turn-invalid-output',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        modelProvider: 'venice',
      }),
      env: {
        VENICE_API_KEY: sentinel,
      },
      freshThreadFallback: TEST_FRESH_THREAD_FALLBACK,
      resumeCodexThreadId: 'corrupt-venice-thread',
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    if (attempt.ok) {
      throw new Error('expected failed provider attempt')
    }
    expect(attempt.error).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      message: expect.stringContaining('Venice via Codex Responses failed.'),
    })
    const error = attempt.error as Error
    expect(error.message).not.toContain(sentinel)
    expect(error.message).toContain('[REDACTED]')
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
