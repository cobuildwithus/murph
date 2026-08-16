import { afterEach, describe, expect, it, vi } from 'vitest'

const codexAppServerMocks = vi.hoisted(() => ({
  executeCodexAppServerTurn: vi.fn(),
  preinitializeCodexAppServer: vi.fn(),
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
  preinitializeCodexAppServer:
    codexAppServerMocks.preinitializeCodexAppServer,
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

import {
  ASSISTANT_USAGE_SCHEMA,
  parseAssistantUsageRecord,
} from '@murphai/hosted-execution/assistant-usage'
import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import {
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  VAULT_CLI_BATCH_RESULT_SCHEMA,
} from '@murphai/operator-config/vault-cli-contracts'

import {
  assistantModelTargetToProviderConfigInput,
} from '@murphai/operator-config/assistant-backend'
import {
  createAssistantBinding,
  getAssistantBindingContextLines,
} from '../src/assistant/bindings.ts'
import {
  MURPH_CODEX_BASE_INSTRUCTIONS,
} from '../src/assistant/codex-base-instructions.ts'
import {
  DEFAULT_CODEX_MODEL_CAPABILITIES,
  DEFAULT_CODEX_MODELS,
  createCatalogModel,
} from '../src/assistant/providers/catalog.ts'
import {
  buildAssistantCodexTurnProfileJson as buildExactAssistantCodexTurnProfileJson,
  extractCodexAssistantProviderUsage as extractExactCodexAssistantProviderUsage,
  resolveCodexAssistantProviderTokenPricingBasis,
  resolveAssistantProviderPrompt as resolveAssistantProviderPromptUnchecked,
} from '../src/assistant/providers/helpers.ts'
import {
  recordCodexAttemptFailed,
} from '../src/assistant/codex-turn/attempt-observability.ts'
import {
  executeCodexAssistantTurnFromInput,
  executeCodexAssistantTurnAttempt as executeCodexAssistantTurnAttemptUnchecked,
  executeCodexAssistantTurnAttemptFromInput,
  prepareHostedCodexAssistantProcess,
  resolveCodexAssistantCapabilities,
  resolveCodexAssistantLabel,
  resolveCodexStaticModels,
  resolveCodexAssistantTargetCapabilities,
} from '../src/assistant/codex-runtime.ts'
import {
  MURPH_DYNAMIC_TOOLS,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import type { CodexThreadIdentity } from '../src/assistant/codex-thread-route.ts'
import type {
  AssistantProviderTurnExecutionInput,
  AssistantProviderTurnExecutionResult,
} from '../src/assistant/providers/types.ts'
import type { AssistantProviderTraceEvent } from '../src/assistant/provider-traces.ts'
import {
  HOSTED_RUNTIME_PROCESS_ENV_MARKER,
} from '../src/assistant-cli-access.ts'

function testCodexResume(codexThreadId: string) {
  return {
    codexThreadId,
  }
}

function extractCodexAssistantProviderUsage(
  input: Parameters<typeof extractExactCodexAssistantProviderUsage>[0],
) {
  return extractExactCodexAssistantProviderUsage({
    ...input,
    rawEvents: completeTestCodexProtocolEvents(
      input.rawEvents,
      resolveTestTurnId(input.rawEvents),
    ),
  })
}

function buildAssistantCodexTurnProfileJson(
  input: Parameters<typeof buildExactAssistantCodexTurnProfileJson>[0],
) {
  return buildExactAssistantCodexTurnProfileJson({
    ...input,
    rawEvents: completeTestCodexProtocolEvents(input.rawEvents, input.turnId),
  })
}

function completeTestCodexProtocolEvents(
  events: readonly unknown[],
  turnId: string | null,
): unknown[] {
  return events.map((event) => {
    const record = readTestRecord(event)
    const params = readTestRecord(record?.params)
    if (!record || !params || typeof record.method !== 'string') {
      return event
    }

    const completedParams = {
      threadId: 'thread-test',
      ...(turnId ? { turnId } : {}),
      ...params,
    }
    const tokenUsage = readTestRecord(params?.tokenUsage)
    if (record.method !== 'thread/tokenUsage/updated' || !tokenUsage) {
      return {
        ...record,
        params: completedParams,
      }
    }

    const last = completeTestTokenUsageBreakdown(tokenUsage.last)
    const total = completeTestTokenUsageBreakdown(
      tokenUsage.total ?? tokenUsage.last,
    )
    if (!last || !total) {
      return event
    }

    return {
      ...record,
      params: {
        ...completedParams,
        tokenUsage: {
          modelContextWindow: null,
          ...tokenUsage,
          last,
          total,
        },
      },
    }
  })
}

function resolveTestTurnId(events: readonly unknown[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const params = readTestRecord(readTestRecord(events[index])?.params)
    const turnId = typeof params?.turnId === 'string'
      ? params.turnId
      : readTestRecord(params?.turn)?.id
    if (typeof turnId === 'string' && turnId.length > 0) {
      return turnId
    }
  }
  return null
}

function completeTestTokenUsageBreakdown(
  value: unknown,
): Record<string, unknown> | null {
  const breakdown = readTestRecord(value)
  const inputTokens = typeof breakdown?.inputTokens === 'number'
    ? breakdown.inputTokens
    : 0
  const outputTokens = typeof breakdown?.outputTokens === 'number'
    ? breakdown.outputTokens
    : 0
  return breakdown
    ? {
        cacheWriteInputTokens: 0,
        cachedInputTokens: 0,
        inputTokens,
        outputTokens,
        reasoningOutputTokens: 0,
        totalTokens: inputTokens + outputTokens,
        ...breakdown,
      }
    : null
}

function readTestRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function resolveAssistantProviderPrompt(
  input: Omit<AssistantProviderTurnExecutionInput, 'dynamicTools'> & {
    dynamicTools?: AssistantProviderTurnExecutionInput['dynamicTools']
  },
) {
  return resolveAssistantProviderPromptUnchecked({
    ...input,
    dynamicTools: input.dynamicTools ?? resolveMurphDynamicTools({
      progressUpdatesAvailable: false,
    }),
  })
}

function executeCodexAssistantTurnAttempt(
  input: Omit<AssistantProviderTurnExecutionInput, 'dynamicTools'> & {
    dynamicTools?: AssistantProviderTurnExecutionInput['dynamicTools']
  },
) {
  return executeCodexAssistantTurnAttemptUnchecked({
    ...input,
    dynamicTools: input.dynamicTools ?? resolveMurphDynamicTools({
      allowFinishWithoutReply: input.allowFinishWithoutReply,
      messageTargetingAvailable:
        input.authorizeAcceptedMessageTarget != null,
      computerToolsAvailable:
        input.hostedToolContext?.computerToolsAvailable === true,
      connectedAppsAvailable: input.hostedToolContext?.connectedApps != null,
      productFeedbackAvailable:
        typeof input.productFeedbackRecorder?.recordProductFeedback === 'function',
      progressUpdatesAvailable: input.progressDelivery != null,
    }),
  })
}

afterEach(() => {
  codexAppServerMocks.executeCodexAppServerTurn.mockReset()
  codexAppServerMocks.preinitializeCodexAppServer.mockReset()
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

function findProviderTraceRawEvents(
  events: readonly AssistantProviderTraceEvent[],
  providerTraceKind: string,
): Record<string, unknown>[] {
  return events
    .map((event) => readProviderTraceRawEvent(event))
    .filter((event) => event.providerTraceKind === providerTraceKind)
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
  it('derives hosted process preparation from the same launch input as a real turn', async () => {
    const target = {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: '/runtime/bin/codex',
      codexHome: '/runtime/codex-home',
      model: 'gpt-5.6-terra',
      modelProvider: 'hosted-openai',
      oss: false,
      profile: 'hosted',
      reasoningEffort: 'low',
      sandbox: 'danger-full-access',
    } as const
    const env = {
      [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: '1',
      CODEX_HOME: '/runtime/codex-home',
      HOME: '/runtime/home',
      PATH: '/usr/bin',
    }
    const signal = new AbortController().signal
    codexAppServerMocks.preinitializeCodexAppServer.mockResolvedValue(null)
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'ok',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'ok',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-thread-preinitialized',
      stderr: '',
      stdout: '',
      threadId: 'codex-thread-preinitialized',
      turnId: 'turn-preinitialized',
    })

    await prepareHostedCodexAssistantProcess({
      env,
      signal,
      target,
      workingDirectory: '/runtime/vault',
    })
    await executeCodexAssistantTurnAttemptFromInput({
      providerConfig: assistantModelTargetToProviderConfigInput(target),
      turn: {
        dynamicTools: [],
        env,
        prompt: 'Answer the current message.',
        workingDirectory: '/runtime/vault',
      },
    })

    const preparationInput =
      codexAppServerMocks.preinitializeCodexAppServer.mock.calls[0]?.[0]
    const turnInput =
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]
    for (const key of [
      'codexCommand',
      'codexHome',
      'configOverrides',
      'env',
      'oss',
      'profile',
      'workingDirectory',
    ] as const) {
      expect(preparationInput?.[key]).toEqual(turnInput?.[key])
    }
    expect(preparationInput?.signal).toBe(signal)
    expect(preparationInput).not.toHaveProperty('prompt')
    expect(preparationInput).not.toHaveProperty('resumeSessionId')
    expect(preparationInput).not.toHaveProperty('dynamicTools')
  })

  it('finish_without_reply description does not claim to withdraw completed replies', () => {
    const finishWithoutReply = MURPH_DYNAMIC_TOOLS.find(
      (tool) => tool.name === 'finish_without_reply',
    )
    expect(finishWithoutReply?.description).toBe(
      'Finish the current response without adding a new text reply. This does not withdraw a reply you already completed earlier in the turn.',
    )
  })

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
      tokenPricingBasis: 'standard',
      totalTokens: null,
    })
  })

  it.each([
    {
      requestedModel: 'gpt-5.6-luna',
      servedModel: 'gpt-5.6-sol',
    },
    {
      requestedModel: 'gpt-5.6-sol',
      servedModel: 'gpt-5.6-luna',
    },
  ])(
    'attributes canonical $requestedModel reroutes to served $servedModel',
    ({ requestedModel, servedModel }) => {
      const usage = extractExactCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: requestedModel,
          modelProvider: 'openai',
          oss: false,
        }),
        rawEvents: [
          {
            method: 'turn/started',
            params: {
              threadId: 'thread-rerouted-usage',
              turn: { id: 'turn-rerouted-usage' },
            },
          },
          {
            method: 'model/rerouted',
            params: { toModel: servedModel },
          },
          {
            method: 'thread/tokenUsage/updated',
            params: {
              threadId: 'thread-rerouted-usage',
              tokenUsage: {
                last: {
                  cacheWriteInputTokens: 0,
                  cachedInputTokens: 12,
                  inputTokens: 120,
                  outputTokens: 45,
                  reasoningOutputTokens: 8,
                  totalTokens: 165,
                },
                modelContextWindow: 258_400,
                total: {
                  cacheWriteInputTokens: 0,
                  cachedInputTokens: 12,
                  inputTokens: 120,
                  outputTokens: 45,
                  reasoningOutputTokens: 8,
                  totalTokens: 165,
                },
              },
              turnId: 'turn-rerouted-usage',
            },
          },
          {
            method: 'turn/completed',
            params: {
              threadId: 'thread-rerouted-usage',
              turn: {
                id: 'turn-rerouted-usage',
                status: 'completed',
              },
            },
          },
        ],
      })

      expect(usage).toMatchObject({
        inputTokens: 120,
        outputTokens: 45,
        requestedModel,
        servedModel,
      })
    },
  )

  it('ignores a canonical reroute that precedes the current turn boundary', () => {
    const usage = extractExactCodexAssistantProviderUsage({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'gpt-5.6-luna',
        modelProvider: 'openai',
        oss: false,
      }),
      rawEvents: [
        {
          method: 'model/rerouted',
          params: { toModel: 'gpt-5.6-sol' },
        },
        {
          method: 'turn/started',
          params: {
            threadId: 'thread-current-usage',
            turn: { id: 'turn-current-usage' },
          },
        },
        {
          method: 'turn/completed',
          params: {
            threadId: 'thread-current-usage',
            turn: {
              id: 'turn-current-usage',
              status: 'completed',
            },
          },
        },
      ],
    })

    expect(usage).toMatchObject({
      requestedModel: 'gpt-5.6-luna',
      servedModel: 'gpt-5.6-luna',
    })
  })

  it.each([
    {
      expectedPricingBasis: 'openai-flex' as const,
      requestedModel: 'gpt-5.4-mini',
      servedModel: 'gpt-5.6-sol',
    },
    {
      expectedPricingBasis: 'standard' as const,
      requestedModel: 'gpt-5.6-sol',
      servedModel: 'gpt-5.4-mini',
    },
  ])(
    'derives $expectedPricingBasis pricing from rerouted $servedModel',
    ({ expectedPricingBasis, requestedModel, servedModel }) => {
      const usage = extractExactCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: requestedModel,
          modelProvider: 'openai',
          oss: false,
        }),
        rawEvents: [
          {
            method: 'turn/started',
            params: { turn: { id: 'turn-rerouted-pricing' } },
          },
          {
            method: 'model/rerouted',
            params: { toModel: servedModel },
          },
          {
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-rerouted-pricing',
                status: 'completed',
              },
            },
          },
        ],
        serviceTier: 'flex',
      })

      expect(usage).toMatchObject({
        requestedModel,
        servedModel,
        tokenPricingBasis: expectedPricingBasis,
      })
    },
  )

  it('uses OpenAI flex token pricing only for requested flex on supported OpenAI models', () => {
    const codexSettingsFlexEvent = {
      method: 'thread/settings/updated',
      params: {
        threadSettings: {
          model: 'gpt-5.6-terra',
          modelProvider: 'openai',
          serviceTier: 'flex',
        },
      },
    }
    const codexSnakeCaseSettingsFlexEvent = {
      method: 'thread.settings.updated',
      params: {
        thread_settings: {
          model: 'gpt-5.6-terra',
          model_provider: 'hosted-openai',
          service_tier: 'flex',
        },
      },
    }

    expect(resolveCodexAssistantProviderTokenPricingBasis({
      model: 'gpt-5.6-terra',
      modelProvider: 'openai',
      serviceTier: 'flex',
    })).toBe('openai-flex')
    expect(resolveCodexAssistantProviderTokenPricingBasis({
      model: 'gpt-5.6-terra',
      modelProvider: 'hosted-openai',
      serviceTier: 'flex',
    })).toBe('openai-flex')
    expect(resolveCodexAssistantProviderTokenPricingBasis({
      model: 'gpt-5.6-terra',
      modelProvider: HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
      serviceTier: 'flex',
    })).toBe('openai-flex')
    expect(resolveCodexAssistantProviderTokenPricingBasis({
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      serviceTier: 'flex',
    })).toBe('standard')
    expect(resolveCodexAssistantProviderTokenPricingBasis({
      model: 'gpt-5.6-terra',
      modelProvider: 'openai',
      serviceTier: null,
    })).toBe('standard')
    expect(resolveCodexAssistantProviderTokenPricingBasis({
      model: 'gpt-5.4-mini',
      modelProvider: 'openai',
      serviceTier: 'flex',
    })).toBe('standard')

    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'gpt-5.6-terra',
          modelProvider: HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
          oss: false,
        }),
        rawEvents: [codexSettingsFlexEvent],
        serviceTier: 'flex',
      }),
    ).toMatchObject({
      providerName: 'hosted-openai',
      tokenPricingBasis: 'openai-flex',
    })
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'gpt-5.6-terra',
          modelProvider: 'openai',
          oss: false,
        }),
        rawEvents: [],
        serviceTier: 'flex',
      }),
    ).toMatchObject({
      providerName: 'openai',
      tokenPricingBasis: 'openai-flex',
    })
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'gpt-5.6-terra',
          modelProvider: 'openai',
          oss: false,
        }),
        rawEvents: [codexSettingsFlexEvent],
        serviceTier: 'flex',
      }),
    ).toMatchObject({
      providerName: 'openai',
      tokenPricingBasis: 'openai-flex',
    })
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'gpt-5.6-terra',
          modelProvider: 'openai',
          oss: false,
        }),
        rawEvents: [codexSettingsFlexEvent],
        serviceTier: null,
      }),
    ).toMatchObject({
      providerName: 'openai',
      tokenPricingBasis: 'standard',
    })
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'gpt-5.6-terra',
          modelProvider: 'openai',
          oss: false,
        }),
        rawEvents: [
          codexSettingsFlexEvent,
          {
            params: {
              turn: {
                id: 'turn-provider-served-alias',
                model: 'openai-production-alias',
                usage: {},
              },
            },
            method: 'turn/completed',
          },
        ],
        serviceTier: 'flex',
      }),
    ).toMatchObject({
      providerName: 'openai',
      requestedModel: 'gpt-5.6-terra',
      servedModel: 'gpt-5.6-terra',
      tokenPricingBasis: 'openai-flex',
    })
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'gpt-5.6-terra',
          modelProvider: 'hosted-openai',
          oss: false,
        }),
        rawEvents: [codexSnakeCaseSettingsFlexEvent],
        serviceTier: 'flex',
      }),
    ).toMatchObject({
      providerName: 'hosted-openai',
      tokenPricingBasis: 'openai-flex',
    })
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'codex-mini',
          modelProvider: 'vercel-ai-gateway',
          oss: false,
        }),
        rawEvents: [codexSettingsFlexEvent],
        serviceTier: 'flex',
      }),
    ).toMatchObject({
      providerName: 'vercel-ai-gateway',
      tokenPricingBasis: 'standard',
    })
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'gpt-5.4-mini',
          modelProvider: 'hosted-openai',
          oss: false,
        }),
        rawEvents: [codexSettingsFlexEvent],
        serviceTier: 'flex',
      }),
    ).toMatchObject({
      providerName: 'hosted-openai',
      tokenPricingBasis: 'standard',
    })
    expect(
      extractCodexAssistantProviderUsage({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
          model: 'gpt-5.6-terra',
          modelProvider: 'openai',
          oss: false,
        }),
        rawEvents: [
          {
            method: 'thread/settings/updated',
            params: {
              threadSettings: {
                model: 'gpt-5.6-terra',
                modelProvider: 'openai',
                serviceTier: null,
              },
            },
          },
        ],
        serviceTier: null,
      }),
    ).toMatchObject({
      providerName: 'openai',
      tokenPricingBasis: 'standard',
    })
  })

  it('builds a per-turn profile from token usage and tool item events', () => {
    const usage = extractCodexAssistantProviderUsage({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'gpt-5.6-terra',
        oss: false,
      }),
      rawEvents: [
        {
          method: 'turn/started',
          params: { turn: { id: 'turn_profile' } },
        },
        {
          method: 'item/started',
          params: {
            item: {
              id: 'item_1',
              type: 'commandExecution',
            },
          },
        },
        {
          method: 'thread/tokenUsage/updated',
          params: {
            turnId: 'turn_profile',
            tokenUsage: {
              last: { inputTokens: 32000, cachedInputTokens: 0, outputTokens: 50 },
              total: { inputTokens: 32000, cachedInputTokens: 0, outputTokens: 50 },
              modelContextWindow: 258400,
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              id: 'item_1',
              // Codex shlex-joins the argv, so multi-word scripts arrive as a
              // quoted `bash -lc "..."` wrapper around the real command.
              command: 'bash -lc "vault-cli samples query --metric \'sleep score\'"',
              aggregatedOutput: 'x'.repeat(2048),
              durationMs: 420,
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'mcpToolCall',
              id: 'item_2',
              server: 'images',
              tool: 'generate',
              result: { url: 'https://example.test/generated' },
              durationMs: 900,
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              id: 'item_3',
              // Positional arguments can be member health content; only the
              // binary name may reach the persisted label.
              command: 'grep glucose journal.md',
              aggregatedOutput: 'x'.repeat(512),
              durationMs: 35,
            },
          },
        },
        {
          method: 'thread/tokenUsage/updated',
          params: {
            turnId: 'turn_profile',
            tokenUsage: {
              last: { inputTokens: 34100, cachedInputTokens: 33920, outputTokens: 80 },
              total: { inputTokens: 66100, cachedInputTokens: 33920, outputTokens: 130 },
              modelContextWindow: 258400,
            },
          },
        },
        {
          method: 'turn/completed',
          params: { turn: { id: 'turn_profile' } },
        },
      ],
    })

    expect(usage.turnProfileJson).toEqual({
      modelContextWindow: 258400,
      requestCount: 2,
      requests: [
        { cachedInput: 0, input: 32000, output: 50 },
        { cachedInput: 33920, input: 34100, output: 80 },
      ],
      requestsTruncated: false,
      schema: 'murph.assistant-turn-profile.v2',
      tools: [
        {
          calls: 1,
          durationKnownCalls: 1,
          durationMs: 900,
          failedCalls: 0,
          kind: 'mcp_tool',
          label: 's6_imagest8_generate',
          outputBytesMax: 40,
          outputBytesTotal: 40,
        },
        {
          calls: 1,
          durationKnownCalls: 1,
          durationMs: 420,
          failedCalls: 0,
          kind: 'command',
          label: 'command',
          outputBytesMax: 2048,
          outputBytesTotal: 2048,
        },
        {
          calls: 1,
          durationKnownCalls: 1,
          durationMs: 35,
          failedCalls: 0,
          kind: 'command',
          label: 'search',
          outputBytesMax: 512,
          outputBytesTotal: 512,
        },
      ],
      toolsTruncated: false,
    })

    // Producer→contract round-trip: label-charset drift between this builder
    // and the hosted-execution allowlist would silently null every profile in
    // prod (the parser drops invalid profiles by design), so pin it here.
    const parsed = parseAssistantUsageRecord({
      attemptCount: 1,
      credentialSource: 'platform',
      inputTokens: 66100,
      occurredAt: '2026-06-10T12:00:00.000Z',
      outputTokens: 130,
      provider: 'codex-cli',
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: 'asst_profile',
      turnId: 'turn_profile',
      turnProfileJson: usage.turnProfileJson,
      usageId: 'turn_profile.attempt-1',
    })
    expect(parsed.turnProfileJson).toEqual(usage.turnProfileJson)
  })

  it('separates tool kinds and distinguishes unknown duration from measured zero', () => {
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_exact_metrics' } } },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              command: 'grep private-query',
              aggregatedOutput: 'é',
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              command: 'rg private-query',
              aggregatedOutput: '🙂',
              durationMs: 0,
              exitCode: 1,
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              command: 'grep private-query',
              aggregatedOutput: '',
              durationMs: Number.MAX_SAFE_INTEGER + 1,
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'dynamicToolCall',
              tool: 'search',
              contentItems: 'é',
              durationMs: 0,
            },
          },
        },
      ],
      turnId: 'turn_exact_metrics',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 3,
        durationKnownCalls: 1,
        durationMs: 0,
        failedCalls: 1,
        kind: 'command',
        label: 'search',
        outputBytesMax: 4,
        outputBytesTotal: 6,
      },
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 0,
        failedCalls: 0,
        kind: 'dynamic_tool',
        label: 'n0_t6_search',
        outputBytesMax: 2,
        outputBytesTotal: 2,
      },
    ])
    expect(JSON.stringify(profile)).not.toContain('private-query')
  })

  it('uses canonical collision-free tool identities and fails closed on unsafe components', () => {
    const toolEvent = (
      id: string,
      namespace: string,
      tool: string,
    ) => ({
      method: 'item/completed',
      params: {
        item: {
          contentItems: '',
          id,
          namespace,
          tool,
          type: 'dynamicToolCall',
        },
      },
    })
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_tool_identity' } } },
        toolEvent('item_1', 'a.b', 'c'),
        toolEvent('item_2', 'a', 'b.c'),
        toolEvent('item_3', 'ab', 'c'),
        toolEvent('item_4', 'a', 'bc'),
        toolEvent('item_5', 'private/path', 'c'),
        toolEvent('item_6', 'private-prefix-that-is-deliberately-longer-than-forty-eight-characters', 'c'),
      ],
      turnId: 'turn_tool_identity',
    })

    expect(profile?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        calls: 4,
        kind: 'dynamic_tool',
        label: 'dynamic_tool',
      }),
      expect.objectContaining({
        calls: 1,
        kind: 'dynamic_tool',
        label: 'n1_at2_bc',
      }),
      expect.objectContaining({
        calls: 1,
        kind: 'dynamic_tool',
        label: 'n2_abt1_c',
      }),
    ]))
    const serialized = JSON.stringify(profile)
    expect(serialized).not.toContain('a.b')
    expect(serialized).not.toContain('b.c')
    expect(serialized).not.toContain('private/path')
    expect(serialized).not.toContain('private-prefix')
  })

  it('counts every canonical structural failure signal without reading error text', () => {
    const commandEvent = (
      id: string,
      outcome: Record<string, unknown>,
    ) => ({
      method: 'item/completed',
      params: {
        item: {
          aggregatedOutput: '',
          command: 'curl https://private.example',
          id,
          type: 'commandExecution',
          ...outcome,
        },
      },
    })
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_failures' } } },
        commandEvent('item_1', { exitCode: 2 }),
        commandEvent('item_2', { exit_code: '3' }),
        commandEvent('item_3', { success: false }),
        commandEvent('item_4', { status: 'error' }),
        commandEvent('item_5', { status: 'errored' }),
        commandEvent('item_6', { status: 'failed' }),
        commandEvent('item_7', {
          error: { message: 'private error text is not a structural signal' },
          status: 'completed',
          success: true,
        }),
      ],
      turnId: 'turn_failures',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 7,
        durationKnownCalls: 0,
        durationMs: 0,
        failedCalls: 6,
        kind: 'command',
        label: 'curl',
        outputBytesMax: 0,
        outputBytesTotal: 0,
      },
    ])
    expect(JSON.stringify(profile)).not.toContain('private error text')
  })

  it('drops the profile when a grouped aggregate would overflow a safe integer', () => {
    const dynamicEvent = (id: string, durationMs: number) => ({
      method: 'item/completed',
      params: {
        item: {
          contentItems: '',
          durationMs,
          id,
          tool: 'lookup',
          type: 'dynamicToolCall',
        },
      },
    })
    expect(buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_overflow' } } },
        dynamicEvent('item_1', Number.MAX_SAFE_INTEGER),
        dynamicEvent('item_2', 1),
      ],
      turnId: 'turn_overflow',
    })).toBeNull()
  })

  it('attributes reviewed display families without persisting arguments or output', () => {
    const privateOutput = 'private-output🙂'
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_safe_families' } } },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              command: 'bash -lc "vault-cli memory show private-record"',
              aggregatedOutput: privateOutput,
              durationMs: 120,
              exitCode: 1,
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              command: 'cat private-path',
              aggregatedOutput: 'é',
              durationMs: 20,
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              command: 'curl https://private.example/path?query=private',
              aggregatedOutput: '',
              durationMs: 19,
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              command: 'private-head safe-looking-subcommand private-query',
              aggregatedOutput: '',
              durationMs: 9,
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              command: 'vault-cli memory private-subcommand private-query',
              aggregatedOutput: '',
              durationMs: 8,
            },
          },
        },
      ],
      turnId: 'turn_safe_families',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 120,
        failedCalls: 1,
        kind: 'command',
        label: 'vault-cli memory show',
        outputBytesMax: Buffer.byteLength(privateOutput, 'utf8'),
        outputBytesTotal: Buffer.byteLength(privateOutput, 'utf8'),
      },
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 20,
        failedCalls: 0,
        kind: 'command',
        label: 'cat',
        outputBytesMax: 2,
        outputBytesTotal: 2,
      },
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 19,
        failedCalls: 0,
        kind: 'command',
        label: 'curl',
        outputBytesMax: 0,
        outputBytesTotal: 0,
      },
      {
        calls: 2,
        durationKnownCalls: 2,
        durationMs: 17,
        failedCalls: 0,
        kind: 'command',
        label: 'command',
        outputBytesMax: 0,
        outputBytesTotal: 0,
      },
    ])
    const serialized = JSON.stringify(profile)
    for (const privateValue of [
      'private-record',
      'private-path',
      'https://private.example/path?query=private',
      'private-head',
      'safe-looking-subcommand',
      'private-subcommand',
      'private-query',
      privateOutput,
    ]) {
      expect(serialized).not.toContain(privateValue)
    }
  })

  it('collapses compound command text to the finite command family', () => {
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_compound_command' } } },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              id: 'item_compound',
              command: 'bash -lc "cat private-record && node private-script.js"',
              commandActions: [
                {
                  type: 'read',
                  command: 'cat private-record',
                  path: 'private-record',
                },
                {
                  type: 'unknown',
                  command: 'node private-script.js',
                },
              ],
              aggregatedOutput: 'private output',
              durationMs: 19_194,
            },
          },
        },
      ],
      turnId: 'turn_compound_command',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 19_194,
        failedCalls: 0,
        kind: 'command',
        label: 'command',
        outputBytesMax: 14,
        outputBytesTotal: 14,
      },
    ])
    expect(JSON.stringify(profile)).not.toContain('private-record')
    expect(JSON.stringify(profile)).not.toContain('private-script')
    expect(JSON.stringify(profile)).not.toContain('private output')
  })

  it.each([
    {
      command: 'bash -lc "vault-cli batch --compact --format json --command \'[\\\"food\\\",\\\"search-labels-batch\\\",\\\"--query\\\",\\\"private-query-a\\\"]\'"',
      wrapper: 'double-quoted',
    },
    {
      command: "bash -lc 'vault-cli batch --compact --format json --command '\\''[\"food\",\"search-labels-batch\",\"--query\",\"private-query-a\"]'\\'''",
      wrapper: 'POSIX-spliced',
    },
  ])('attributes structured batch children through the $wrapper shell wrapper', ({
    command,
  }) => {
    const aggregatedOutput = JSON.stringify({
      schema: VAULT_CLI_BATCH_RESULT_SCHEMA,
      count: 4,
      failed: 2,
      commands: [
        {
          argv: ['food', 'search-labels-batch', '--query', 'private-query-a'],
          data: { privateResult: 'private-output-a-é' },
          durationMs: 12_000,
          index: 0,
          ok: true,
          outputBytes: 39,
          outputChars: 300_000,
          stdout: '',
        },
        {
          argv: ['food', 'search-labels-batch', '--query', 'private-query-b'],
          durationMs: 7_000,
          error: { message: 'private-failure-a' },
          index: 1,
          ok: false,
          outputBytes: 20,
          outputChars: 200_000,
          stdout: 'private-output-b🙂',
        },
        {
          argv: ['meal', 'totals', '--from', '2026-01-01'],
          data: { privateResult: 'private-output-c' },
          durationMs: 1_000,
          index: 2,
          ok: true,
          outputBytes: 36,
          outputChars: 900,
          stdout: '',
        },
        {
          argv: ['memory', 'private-health-command'],
          durationMs: 400,
          error: { message: 'private-failure-b' },
          index: 3,
          ok: false,
          outputBytes: 16,
          outputChars: 50,
          stdout: 'private-output-d',
        },
      ],
      vault: '/private/member/vault',
    })
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_batch_commands' } } },
        {
          method: 'item/completed',
          params: {
            item: {
              aggregatedOutput,
              command,
              durationMs: 22_060,
              exitCode: 0,
              id: 'item_batch_commands',
              type: 'commandExecution',
            },
          },
        },
      ],
      turnId: 'turn_batch_commands',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 2,
        durationKnownCalls: 2,
        durationMs: 19_000,
        failedCalls: 1,
        kind: 'command',
        label: 'food.search-labels-batch',
        outputBytesMax: 39,
        outputBytesTotal: 59,
      },
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 1_000,
        failedCalls: 0,
        kind: 'command',
        label: 'meal.totals',
        outputBytesMax: 36,
        outputBytesTotal: 36,
      },
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 400,
        failedCalls: 1,
        kind: 'command',
        label: 'other',
        outputBytesMax: 16,
        outputBytesTotal: 16,
      },
    ])
    const persisted = parseAssistantUsageRecord({
      attemptCount: 1,
      credentialSource: 'platform',
      inputTokens: 1,
      occurredAt: '2026-06-10T12:00:00.000Z',
      outputTokens: 1,
      provider: 'codex-cli',
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: 'session_batch_profile',
      turnId: 'turn_batch_commands',
      turnProfileJson: profile,
      usageId: 'turn_batch_commands.attempt-1',
    })
    expect(persisted.turnProfileJson).toEqual(profile)
    const serialized = JSON.stringify(profile)
    for (const privateValue of [
      'private-query-a',
      'private-query-b',
      'private-health-command',
      'private-output-a',
      'private-output-b',
      'private-output-c',
      'private-output-d',
      'private-failure-a',
      'private-failure-b',
      '/private/member/vault',
    ]) {
      expect(serialized).not.toContain(privateValue)
    }
  })

  it('attributes every structured batch child before the profile family cap', () => {
    const commands = Array.from({ length: 10 }, (_, index) => ({
      argv: index < 8
        ? ['goal', 'list', '--private-filter', `private-${index}`]
        : index === 8
          ? ['food', 'search-labels-batch', '--query', `private-${index}`]
          : ['meal', 'add', '--note', `private-${index}`],
      data: { privateResult: `private-output-${index}` },
      durationMs: index === 8 ? 12_000 : index === 9 ? 100 : index + 1,
      error: index === 8 ? { message: 'private-failure' } : undefined,
      index,
      ok: index !== 8,
      outputBytes: index === 8 ? 20 : 36,
      outputChars: index === 8 ? 500_000 : index === 9 ? 200 : 10,
      stdout: index === 8 ? 'private-large-output' : '',
    }))
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_batch_cap' } } },
        {
          method: 'item/completed',
          params: {
            item: {
              aggregatedOutput: JSON.stringify({
                schema: VAULT_CLI_BATCH_RESULT_SCHEMA,
                commands,
                count: commands.length,
                failed: 1,
                vault: '/private/member/vault',
              }),
              command: 'vault-cli batch --compact --format json',
              durationMs: 100,
              id: 'item_batch_cap',
              type: 'commandExecution',
            },
          },
        },
      ],
      turnId: 'turn_batch_cap',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 12_000,
        failedCalls: 1,
        kind: 'command',
        label: 'food.search-labels-batch',
        outputBytesMax: 20,
        outputBytesTotal: 20,
      },
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 100,
        failedCalls: 0,
        kind: 'command',
        label: 'meal.add',
        outputBytesMax: 36,
        outputBytesTotal: 36,
      },
      {
        calls: 8,
        durationKnownCalls: 8,
        durationMs: 36,
        failedCalls: 0,
        kind: 'command',
        label: 'goal.list',
        outputBytesMax: 36,
        outputBytesTotal: 288,
      },
    ])
    expect(profile?.toolsTruncated).toBe(false)
    expect(JSON.stringify(profile)).not.toContain('private-')
    expect(JSON.stringify(profile)).not.toContain('/private/member/vault')
  })

  it('falls back to the outer batch label when structured output is unavailable', () => {
    const aggregatedOutput = JSON.stringify({
      schema: VAULT_CLI_BATCH_RESULT_SCHEMA,
      commands: [{
        argv: ['memory', 'private-health-term'],
        durationMs: 9,
        ok: true,
        outputChars: 20,
        // An incomplete old producer did not carry an exact representation.
        data: { privateResult: 'private-output' },
      }],
      count: 1,
      failed: 0,
    })
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_batch_fallback' } } },
        {
          method: 'item/completed',
          params: {
            item: {
              aggregatedOutput,
              command: `vault-cli batch --command '["memory","private-health-term"]'`,
              durationMs: 10,
              id: 'item_batch_fallback',
              type: 'commandExecution',
            },
          },
        },
      ],
      turnId: 'turn_batch_fallback',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 10,
        failedCalls: 0,
        kind: 'command',
        label: 'vault-cli batch',
        outputBytesMax: Buffer.byteLength(aggregatedOutput, 'utf8'),
        outputBytesTotal: Buffer.byteLength(aggregatedOutput, 'utf8'),
      },
    ])
    expect(profile?.toolsTruncated).toBe(true)
    expect(JSON.stringify(profile)).not.toContain('private-health-term')
    expect(JSON.stringify(profile)).not.toContain('private-output')
  })

  it('never decomposes a batch-shaped payload from a non-batch command', () => {
    const aggregatedOutput = JSON.stringify({
      schema: VAULT_CLI_BATCH_RESULT_SCHEMA,
      commands: [{
        argv: ['memory', 'show'],
        durationMs: 9,
        ok: false,
        outputBytes: 0,
        outputChars: 0,
        stdout: '',
      }],
      count: 1,
      failed: 1,
    })
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_batch_spoof' } } },
        {
          method: 'item/completed',
          params: {
            item: {
              aggregatedOutput,
              command: 'printf private-batch-payload',
              durationMs: 10,
              id: 'item_batch_spoof',
              type: 'commandExecution',
            },
          },
        },
      ],
      turnId: 'turn_batch_spoof',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 10,
        failedCalls: 0,
        kind: 'command',
        label: 'printf',
        outputBytesMax: Buffer.byteLength(aggregatedOutput, 'utf8'),
        outputBytesTotal: Buffer.byteLength(aggregatedOutput, 'utf8'),
      },
    ])
    expect(profile?.toolsTruncated).toBe(false)
    expect(JSON.stringify(profile)).not.toContain('private-batch-payload')
  })

  it('uses the full safe structured chain when raw shell quoting fails closed', () => {
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_compound_fallback' } } },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              id: 'item_compound_fallback',
              command: "bash -lc 'cat '\\''private-record'\\'' && node private-script.js'",
              commandActions: [
                {
                  type: 'read',
                  command: "cat 'private-record'",
                  path: 'private-record',
                },
                {
                  type: 'unknown',
                  command: 'node private-script.js',
                },
              ],
              aggregatedOutput: '',
              durationMs: 19_194,
            },
          },
        },
      ],
      turnId: 'turn_compound_fallback',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 19_194,
        failedCalls: 0,
        kind: 'command',
        label: 'command',
        outputBytesMax: 0,
        outputBytesTotal: 0,
      },
    ])
    expect(JSON.stringify(profile)).not.toContain('private-record')
    expect(JSON.stringify(profile)).not.toContain('private-script')
  })

  it('does not build a partial structured chain across a later unsafe action', () => {
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_compound_unsafe' } } },
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'commandExecution',
              id: 'item_compound_unsafe',
              command:
                'bash -lc "cat private-record && /tmp/private-tool && node private-script.js"',
              commandActions: [
                {
                  type: 'read',
                  command: 'cat private-record',
                  path: 'private-record',
                },
                {
                  type: 'unknown',
                  command: '/tmp/private-tool',
                },
                {
                  type: 'unknown',
                  command: 'node private-script.js',
                },
              ],
              aggregatedOutput: '',
              durationMs: 19_194,
            },
          },
        },
      ],
      turnId: 'turn_compound_unsafe',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 19_194,
        failedCalls: 0,
        kind: 'command',
        label: 'command',
        outputBytesMax: 0,
        outputBytesTotal: 0,
      },
    ])
    expect(JSON.stringify(profile)).not.toContain('private-tool')
    expect(JSON.stringify(profile)).not.toContain('private-script')
  })

  it('caps the per-turn profile request series and tool list under the callback payload limit', () => {
    const rawEvents: unknown[] = [
      // Replayed pre-turn tool output must never count toward this turn even
      // when it would otherwise dominate the top-by-outputBytesTotal ranking.
      {
        method: 'item/completed',
        params: {
          item: {
            type: 'commandExecution',
            id: 'item_replay',
            command: 'replayed-binary',
            aggregatedOutput: 'x'.repeat(100000),
            durationMs: 1,
          },
        },
      },
      { method: 'turn/started', params: { turn: { id: 'turn_caps' } } },
    ]
    for (let request = 1; request <= 34; request += 1) {
      rawEvents.push({
        method: 'thread/tokenUsage/updated',
        params: {
          turnId: 'turn_caps',
          tokenUsage: {
            last: { inputTokens: request, cachedInputTokens: 0, outputTokens: 1 },
            total: { inputTokens: request, cachedInputTokens: 0, outputTokens: request },
          },
        },
      })
    }
    for (let tool = 1; tool <= 18; tool += 1) {
      rawEvents.push({
        method: 'item/completed',
        params: {
          item: {
            type: 'dynamicToolCall',
            id: `item_${tool}`,
            tool: `tool-${tool}`,
            contentItems: 'x'.repeat(tool),
            durationMs: tool,
          },
        },
      })
    }

    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents,
      turnId: 'turn_caps',
    })

    expect(profile).toMatchObject({
      // No event carried a context window: stays null instead of 0/undefined.
      modelContextWindow: null,
      requestCount: 34,
      requestsTruncated: true,
      toolsTruncated: true,
    })
    const requests = profile?.requests as Array<Record<string, number>>
    expect(requests).toHaveLength(32)
    // The last 32 requests are kept so the expensive tail of a long turn
    // stays visible after truncation.
    expect(requests[0]).toEqual({ cachedInput: 0, input: 3, output: 1 })
    expect(requests[31]).toEqual({ cachedInput: 0, input: 34, output: 1 })
    const tools = profile?.tools as Array<{ label: string }>
    expect(tools).toHaveLength(16)
    expect(tools[0]).toMatchObject({ label: 'n0_t7_tool-18', outputBytesTotal: 18 })
    expect(tools[15]).toMatchObject({ label: 'n0_t6_tool-3', outputBytesTotal: 3 })
    const labels = tools.map((tool) => tool.label)
    expect(labels).not.toContain('replayed-binary')
    expect(labels).not.toContain('tool-1')
    expect(labels).not.toContain('tool-2')

    const persisted = parseAssistantUsageRecord({
      attemptCount: 1,
      credentialSource: 'platform',
      inputTokens: 34,
      occurredAt: '2026-06-10T12:00:00.000Z',
      outputTokens: 34,
      provider: 'codex-cli',
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: 'asst_caps',
      turnId: 'turn_caps',
      turnProfileJson: profile,
      usageId: 'turn_caps.attempt-1',
    })
    expect(persisted.turnProfileJson).toEqual(profile)
  })

  it('keeps per-turn profile command labels member-content safe at the edges', () => {
    const commandEvent = (
      id: string,
      command: string,
      outputChars: number,
      commandActions?: unknown,
    ) => ({
      method: 'item/completed',
      params: {
        item: {
          type: 'commandExecution',
          id,
          command,
          ...(commandActions === undefined ? {} : { commandActions }),
          aggregatedOutput: 'x'.repeat(outputChars),
          durationMs: 10,
        },
      },
    })
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_labels' } } },
        // Uppercase positional token fails the subcommand shape even after an
        // allowlisted head binary: 'Samples' could be a member-named vault dir.
        // The safe raw-command label stays authoritative over a conflicting
        // structured fallback and its private-looking query.
        commandEvent(
          'item_1',
          'vault-cli Samples',
          40,
          [{ type: 'search', command: 'rg private-query', query: 'private-query' }],
        ),
        // 'murph' is the second allowlisted head binary; labels stop at three
        // tokens so trailing args never persist.
        commandEvent('item_2', 'murph reminders list --all glucose', 30),
        // Quoted shell wrapping (Codex shlex-joins multi-word scripts into
        // `bash -lc "..."`) unwraps one layer, then the same token rules apply.
        commandEvent('item_3', 'bash -lc "vault-cli samples query"', 20),
        // Repeated labels aggregate into one entry instead of multiplying.
        commandEvent('item_4', 'murph reminders list', 25),
        // Overlong safe binary names truncate to the persisted label cap.
        commandEvent('item_5', 'a'.repeat(70), 10),
        // After unwrapping, escaped quoted member content still stops at the
        // non-allowlisted binary name.
        commandEvent('item_6', 'bash -lc "grep \\"glucose level\\" journal.md"', 15),
        // Quoted path-invoked scripts still fail closed after unwrapping.
        commandEvent('item_7', 'bash -lc "scripts/check-member.sh"', 5),
        // A shell head inside the script would put the (possibly member-named)
        // script filename in the head slot: fail closed, never skip into it.
        commandEvent('item_8', 'bash -lc "bash my-glucose-analysis.sh"', 4),
        // Multiple quoted regions are not a single wrapped script; the greedy
        // splice must not surface inner words as a head binary.
        commandEvent('item_9', 'bash -lc "hypertension log" > "out"', 3),
        // Canonical POSIX quote splicing decodes only the outer shell's one
        // script argv, then the same finite-family resolver inspects it.
        commandEvent(
          'item_10',
          "bash -lc 'rg -n '\\''sleep score'\\'' records'",
          8,
          [{ type: 'search', command: 'rg -n \'sleep score\' records', query: 'sleep score' }],
        ),
        commandEvent(
          'item_11',
          "bash -lc 'sed -n '\\''1,80p'\\'' journal.md'",
          7,
          [{ type: 'read', command: "sed -n '1,80p' journal.md", path: 'journal.md' }],
        ),
        // The fixed memory-show family persists without its record argument.
        commandEvent(
          'item_12',
          "bash -lc 'vault-cli memory show '\\''private-memory'\\'''",
          6,
          [{ type: 'unknown', command: "vault-cli memory show 'private-memory'" }],
        ),
        // Arbitrary names and path-invoked binaries stay collapsed even when
        // supplied as structured actions.
        commandEvent(
          'item_13',
          "bash -lc 'hypertension '\\''private'\\'''",
          2,
          [{ type: 'unknown', command: 'hypertension log' }],
        ),
        commandEvent(
          'item_14',
          'bash -lc "/tmp/rg secret"',
          1,
          [{ type: 'search', command: '/tmp/rg secret' }],
        ),
        // Never skip an untrusted first action to label a later pipeline stage.
        commandEvent(
          'item_15',
          "bash -lc 'hypertension '\\''private'\\'' | rg secret'",
          1,
          [
            { type: 'unknown', command: 'hypertension' },
            { type: 'search', command: 'rg secret' },
          ],
        ),
        // Only a direct reviewed search invocation leaves the coarse command
        // family. Its query is inspected transiently and never persisted.
        commandEvent('item_16', 'rg private-query records', 11),
      ],
      turnId: 'turn_labels',
    })

    expect(profile).toMatchObject({
      modelContextWindow: null,
      requestCount: 0,
      requests: [],
      requestsTruncated: false,
      toolsTruncated: false,
    })
    expect(profile?.tools).toEqual([
      {
        calls: 11,
        durationKnownCalls: 11,
        durationMs: 110,
        failedCalls: 0,
        kind: 'command',
        label: 'command',
        outputBytesMax: 40,
        outputBytesTotal: 141,
      },
      {
        calls: 3,
        durationKnownCalls: 3,
        durationMs: 30,
        failedCalls: 0,
        kind: 'command',
        label: 'search',
        outputBytesMax: 15,
        outputBytesTotal: 34,
      },
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 10,
        failedCalls: 0,
        kind: 'command',
        label: 'sed',
        outputBytesMax: 7,
        outputBytesTotal: 7,
      },
      {
        calls: 1,
        durationKnownCalls: 1,
        durationMs: 10,
        failedCalls: 0,
        kind: 'command',
        label: 'vault-cli memory show',
        outputBytesMax: 6,
        outputBytesTotal: 6,
      },
    ])
    expect(JSON.stringify(profile)).not.toContain('sleep score')
    expect(JSON.stringify(profile)).not.toContain('private-memory')
    expect(JSON.stringify(profile)).not.toContain('private-query')
    expect(JSON.stringify(profile)).not.toContain('journal.md')
  })

  it('fails closed on adversarial shell-wrapper quoting shapes', () => {
    const commandEvent = (id: string, command: string, outputChars: number) => ({
      method: 'item/completed',
      params: {
        item: {
          type: 'commandExecution',
          id,
          command,
          aggregatedOutput: 'x'.repeat(outputChars),
          durationMs: 10,
        },
      },
    })
    const profile = buildAssistantCodexTurnProfileJson({
      rawEvents: [
        { method: 'turn/started', params: { turn: { id: 'turn_quoting' } } },
        // Single-quoted wrappers (Python shlex.join quotes with ') unwrap the
        // same way as double-quoted ones.
        commandEvent('item_1', "bash -lc 'vault-cli samples query'", 30),
        // Single-word scripts arrive unquoted; they pass through after the
        // wrapper strip instead of failing closed.
        commandEvent('item_2', 'bash -lc ls', 9),
        // POSIX '\'' splice inside a single-quoted wrapper is two quoted
        // regions, not one script: keep the original so the bash head fails
        // closed instead of splicing member content into the label.
        commandEvent('item_3', "bash -lc 'vault-cli '\\''member name'\\''", 6),
        // `\\"` is an escaped backslash followed by a REAL closing quote
        // (even backslash parity): a last-char-only escape check would
        // wrongly unwrap and label 'grep'.
        commandEvent('item_4', 'bash -lc "grep \\\\" glucose-note"', 5),
        // Unclosed quote is not a complete quoted region: fail closed rather
        // than stripping the lone leading quote.
        commandEvent('item_5', 'bash -lc "grep glucose-log', 4),
        // A lone quote both starts and ends with the quote char; the length
        // guard must still fail it closed.
        commandEvent('item_6', 'bash -lc "', 3),
        // Flag clusters without 'c' are not command wrappers; the quoted
        // remainder must not unwrap into a labelable head.
        commandEvent('item_7', 'bash -x "vault-cli samples"', 2),
        // A bare flag head without any wrapper fails closed instead of
        // skipping forward into positional (possibly member) content.
        commandEvent('item_8', '-x glucose-export', 1),
      ],
      turnId: 'turn_quoting',
    })

    expect(profile?.tools).toEqual([
      {
        calls: 8,
        durationKnownCalls: 8,
        durationMs: 80,
        failedCalls: 0,
        kind: 'command',
        label: 'command',
        outputBytesMax: 30,
        outputBytesTotal: 60,
      },
    ])
  })

  it('counts a failed provider attempt in its terminal diagnostic', async () => {
    const route: CodexThreadIdentity = {
      codexCommand: null,
      label: 'primary:Codex app-server:gpt-5.4',
      provider: 'codex-cli',
      providerOptions: serializeAssistantProviderSessionOptions(
        normalizeAssistantProviderConfig({
          model: 'gpt-5.4',
          provider: 'codex-cli',
        }),
      ),
      routeId: 'route-failed',
    }

    await recordCodexAttemptFailed({
      attemptCount: 1,
      detail: 'Provider attempt failed.',
      errorCode: 'PROVIDER_FAILED',
      route,
      sessionId: 'session-failed',
      turnId: 'turn-failed',
      vault: '/vaults/test',
    })

    expect(diagnosticsMocks.recordAssistantDiagnosticEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        counterDeltas: {
          providerFailures: 1,
        },
        kind: 'provider.attempt.failed',
      }),
    )
  })

  it('keeps failed-attempt recording best-effort when observability writes reject', async () => {
    const route: CodexThreadIdentity = {
      codexCommand: null,
      label: 'primary:Codex app-server:gpt-5.4',
      provider: 'codex-cli',
      providerOptions: serializeAssistantProviderSessionOptions(
        normalizeAssistantProviderConfig({
          model: 'gpt-5.4',
          provider: 'codex-cli',
        }),
      ),
      routeId: 'route-failed',
    }
    turnsMocks.appendAssistantTurnReceiptEvent.mockRejectedValueOnce(
      new Error('receipt store unavailable'),
    )
    diagnosticsMocks.recordAssistantDiagnosticEvent.mockRejectedValueOnce(
      new Error('diagnostic sink unavailable'),
    )

    // A thrown observability write here would replace the structured
    // failed-attempt outcome in the provider catch with an unclassified error.
    await expect(
      recordCodexAttemptFailed({
        attemptCount: 1,
        detail: 'Provider attempt failed.',
        errorCode: 'PROVIDER_FAILED',
        route,
        sessionId: 'session-failed',
        turnId: 'turn-failed',
        vault: '/vaults/test',
      }),
    ).resolves.toBeUndefined()
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
      legacy: true,
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
          method: 'turn/completed',
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
      legacy: true,
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
          method: 'turn/completed',
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
      legacy: true,
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
          method: 'turn/completed',
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
      legacy: true,
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
          method: 'turn/completed',
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
      legacy: true,
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
          method: 'turn/completed',
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
          method: 'turn/completed',
        },
      ],
    },
    {
      expected: {
        cachedInputTokens: 3,
        inputTokens: 21,
        outputTokens: 8,
        reasoningTokens: 2,
        totalTokens: 31,
      },
      expectedRawUsageJson: {
        cachedInputTokens: 3,
        inputTokens: 21,
        outputTokens: 8,
        reasoningOutputTokens: 2,
        totalTokens: 31,
      },
      expectedSourcePath: 'thread.tokenUsage.total.delta',
      legacy: true,
      name: 'Codex normalized dotted thread token usage notification',
      rawEvents: [
        {
          params: {
            threadId: 'thread-normalized-dotted-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 3,
                inputTokens: 21,
                outputTokens: 8,
                reasoningOutputTokens: 2,
                totalTokens: 31,
              },
              total: {
                cachedInputTokens: 3,
                inputTokens: 21,
                outputTokens: 8,
                reasoningOutputTokens: 2,
                totalTokens: 31,
              },
            },
            turnId: 'turn-normalized-dotted-token-usage',
          },
          type: 'thread.token.usage.updated',
        },
        {
          params: {
            turn: {
              id: 'turn-normalized-dotted-token-usage',
              model: 'gpt-5.4',
            },
          },
          method: 'turn/completed',
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
          method: 'turn/completed',
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
          method: 'turn/completed',
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
          method: 'turn/completed',
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
          method: 'turn/completed',
        },
      ],
    },
    {
      expected: {
        cachedInputTokens: 0,
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 0,
        totalTokens: 15,
      },
      expectedRawUsageJson: {
        cachedInputTokens: 0,
        inputTokens: 10,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 15,
      },
      expectedSourcePath: 'thread.tokenUsage.total.delta',
      name: 'resumed Codex token usage treats assistant message delta as current output',
      rawEvents: [
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-resume-assistant-delta-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 0,
                inputTokens: 100,
                outputTokens: 50,
                reasoningOutputTokens: 0,
                totalTokens: 150,
              },
              total: {
                cachedInputTokens: 0,
                inputTokens: 100,
                outputTokens: 50,
                reasoningOutputTokens: 0,
                totalTokens: 150,
              },
            },
            turnId: 'turn-resume-assistant-delta-token-usage',
          },
        },
        {
          method: 'turn/started',
          params: {
            turn: {
              id: 'turn-resume-assistant-delta-token-usage',
            },
          },
        },
        {
          method: 'item/agentMessage/delta',
          params: {
            delta: 'OK',
            itemId: 'assistant-resume-delta',
            threadId: 'thread-resume-assistant-delta-token-usage',
            turnId: 'turn-resume-assistant-delta-token-usage',
          },
        },
        {
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: 'thread-resume-assistant-delta-token-usage',
            tokenUsage: {
              last: {
                cachedInputTokens: 0,
                inputTokens: 10,
                outputTokens: 5,
                reasoningOutputTokens: 0,
                totalTokens: 15,
              },
              total: {
                cachedInputTokens: 0,
                inputTokens: 110,
                outputTokens: 55,
                reasoningOutputTokens: 0,
                totalTokens: 165,
              },
            },
            turnId: 'turn-resume-assistant-delta-token-usage',
          },
        },
        {
          params: {
            turn: {
              id: 'turn-resume-assistant-delta-token-usage',
              model: 'gpt-5.4',
            },
          },
          method: 'turn/completed',
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
      expectedSourcePath: 'thread.tokenUsage.total.delta',
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
          method: 'turn/completed',
        },
      ],
    },
  ])('extracts Codex usage from $name', ({
    expected,
    expectedRawUsageJson,
    expectedSourcePath,
    legacy = false,
    rawEvents,
  }) => {
    const usage = extractCodexAssistantProviderUsage({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'gpt-5.4',
        modelProvider: 'openai',
        oss: false,
      }),
      rawEvents,
    })
    if (legacy) {
      expect(usage).toMatchObject({
        inputTokens: null,
        outputTokens: null,
        rawUsageJson: null,
        usageExtractionSourcePath: null,
      })
      return
    }

    expect(usage).toMatchObject({
      cacheWriteTokens: 0,
      providerName: 'openai',
      providerRequestId: expect.stringMatching(/^turn-/u),
      rawUsageJson: {
        cacheWriteInputTokens: 0,
        ...expectedRawUsageJson,
      },
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
        prompt: '  explicit prompt  ',
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        turnContextPrompt: 'Current runtime context.',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toBe('Current runtime context.\n\nexplicit prompt')

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
        resume: testCodexResume('codex-session-1'),
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
        resume: testCodexResume('codex-session-1'),
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

  it('serializes committed conversation history before the current user message', () => {
    expect(
      resolveAssistantProviderPrompt({
        conversationHistoryMessages: [
          {
            role: 'user',
            content: 'Earlier question',
          },
          {
            role: 'assistant',
            content: 'Earlier answer',
          },
        ],
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        userPrompt: 'Latest question.',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).toBe(
      [
        'Recent conversation history for context only; do not answer these prior messages:',
        'User:',
        'Earlier question',
        '',
        'Assistant:',
        'Earlier answer',
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

  it('keeps raw email reply targets out of Codex prompt context', () => {
    const deliveryTarget = 'hostedmail:opaque-envelope-with-private-routing-state'
    const prompt = resolveAssistantProviderPrompt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      sessionContext: {
        binding: createAssistantBinding({
          channel: 'email',
          deliveryKind: 'thread',
          deliveryTarget,
          identityId: 'hid_email_identity',
          threadId: 'hid_email_thread',
          threadIsDirect: false,
        }),
      },
      systemPrompt: 'You are Murph.',
      userPrompt: 'Say hi.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(prompt).toContain('delivery: thread route available')
    expect(prompt).not.toContain(deliveryTarget)
  })

  it('prepends turn context to explicit prompts before Codex execution', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'ok',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'ok',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-thread-turn-context',
      stderr: '',
      stdout: '',
      threadId: 'codex-thread-turn-context',
      turnId: 'turn-context',
    })

    const attempt = await executeCodexAssistantTurnAttemptFromInput({
      providerConfig: { provider: 'codex-cli' },
      turn: {
        dynamicTools: resolveMurphDynamicTools({
          progressUpdatesAvailable: false,
        }),
        prompt: 'Answer the current message.',
        turnContextPrompt: 'Conversation context:\nEarlier assistant reminder.',
        workingDirectory: '/tmp/provider-tests',
      },
    })

    expect(attempt.ok).toBe(true)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]?.prompt,
    ).toBe(
      'Conversation context:\nEarlier assistant reminder.\n\nAnswer the current message.',
    )
  })

  it('keeps local Telegram runtime while public Linq wrappers fail closed', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'ok',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'ok',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-thread-voice-memo',
      stderr: '',
      stdout: '',
      threadId: 'codex-thread-voice-memo',
      turnId: 'turn-voice-memo',
    })

    await expect(
      executeCodexAssistantTurnFromInput({
        providerConfig: { provider: 'codex-cli' },
        turn: {
          dynamicTools: resolveMurphDynamicTools({
            progressUpdatesAvailable: false,
          }),
          env: {
            ELEVENLABS_API_KEY: 'local-elevenlabs-key',
            MURPH_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
            MURPH_ELEVENLABS_VOICE_ID: 'voice_default',
          },
          prompt: 'send a voice memo',
          voiceMemoDeliveryChannel: 'telegram',
          workingDirectory: '/tmp/provider-tests',
        },
      }),
    ).resolves.toMatchObject({
      response: 'ok',
    })
    const telegramTurnInput =
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]
    expect(telegramTurnInput?.voiceMemoRuntime).toEqual({
      elevenLabs: {
        apiKeyAvailable: true,
        defaultVoiceId: 'voice_default',
        modelId: 'eleven_multilingual_v2',
        voiceId: 'voice_default',
      },
      kind: 'telegram',
    })
    expect(telegramTurnInput).not.toHaveProperty('voiceMemoDeliveryChannel')

    const attempt = await executeCodexAssistantTurnAttemptFromInput({
      providerConfig: { provider: 'codex-cli' },
      turn: {
        dynamicTools: resolveMurphDynamicTools({
          progressUpdatesAvailable: false,
        }),
        prompt: 'send a voice memo',
        voiceMemoDeliveryChannel: 'linq',
        workingDirectory: '/tmp/provider-tests',
      },
    })

    expect(attempt.ok).toBe(true)
    const linqTurnInput =
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0]
    expect(linqTurnInput?.voiceMemoRuntime).toBeNull()
    expect(linqTurnInput).not.toHaveProperty('voiceMemoDeliveryChannel')
  })

  it('forwards message-target tools and their authorizer to Codex execution', async () => {
    const traceEvents: AssistantProviderTraceEvent[] = []
    const authorizeAcceptedMessageTarget = vi.fn(async () => null)
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'ok',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'ok',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-thread-reactions',
      stderr: '',
      stdout: '',
      threadId: 'codex-thread-reactions',
      turnId: 'turn-reactions',
    })

    await expect(
      executeCodexAssistantTurnFromInput({
        providerConfig: { provider: 'codex-cli' },
        turn: {
          authorizeAcceptedMessageTarget,
          dynamicTools: resolveMurphDynamicTools({
            messageTargetingAvailable: true,
            progressUpdatesAvailable: false,
          }),
          prompt: 'react to this',
          workingDirectory: '/tmp/provider-tests',
        },
      }),
    ).resolves.toMatchObject({
      response: 'ok',
    })
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0],
    ).toMatchObject({
      authorizeAcceptedMessageTarget,
      dynamicTools: expect.arrayContaining([
        expect.objectContaining({ name: 'react_to_message' }),
        expect.objectContaining({ name: 'select_reply_target' }),
      ]),
    })

    const attempt = await executeCodexAssistantTurnAttemptFromInput({
      providerConfig: { provider: 'codex-cli' },
      turn: {
        authorizeAcceptedMessageTarget,
        dynamicTools: resolveMurphDynamicTools({
          messageTargetingAvailable: true,
          progressUpdatesAvailable: false,
        }),
        onTraceEvent: (event) => {
          traceEvents.push(event)
        },
        prompt: 'react to this',
        workingDirectory: '/tmp/provider-tests',
      },
    })

    expect(attempt.ok).toBe(true)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[1]?.[0],
    ).toMatchObject({
      authorizeAcceptedMessageTarget,
    })
    expect(
      findProviderPromptSizeTraceRawEvent(traceEvents, 'primary'),
    ).toMatchObject({
      dynamicToolCount: resolveMurphDynamicTools({
        messageTargetingAvailable: true,
        progressUpdatesAvailable: false,
      }).length,
      messageTargetDynamicToolsAvailable: true,
    })
  })

  it('emits metadata-only provider prompt-size diagnostics', async () => {
    const traceEvents: AssistantProviderTraceEvent[] = []
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
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'ok',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'codex-thread-prompt-size',
      stderr: '',
      stdout: '',
      threadId: 'codex-thread-prompt-size',
      turnId: 'turn-prompt-size',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      developerInstructions: 'Private developer instructions.',
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
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
      baseInstructionsBytes: Buffer.byteLength(
        MURPH_CODEX_BASE_INSTRUCTIONS,
        'utf8',
      ),
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
    expect(
      resolveCodexAssistantTargetCapabilities({
        modelProvider: 'hosted-custom-inference',
        provider: 'codex-cli',
      }),
    ).toEqual({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsNativeResume: true,
      supportsReasoningEffort: false,
      supportsRichUserMessageContent: true,
    })

    expect(resolveCodexStaticModels({ provider: 'codex-cli' })).toEqual(
      DEFAULT_CODEX_MODELS,
    )
  })

  it('merges progress activity labels into successful delegated execution attempts', async () => {
    const executionResult: AssistantProviderTurnExecutionResult = {
      provider: 'codex-cli',
      additionalUsages: undefined,
      codexRolloutRelativePath: undefined,
      codexThreadId: 'provider-session-1',
      precedingResponseSegments: [],
      rawEvents: [],
      response: 'Completed.',
      responseDeliveryContextOrdinal: 0,
      responseMedia: undefined,
      stderr: '',
      stdout: '',
      transcriptResponse: 'Completed.',
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
        tokenPricingBasis: 'standard',
        totalTokens: null,
        turnProfileJson: null,
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
          precedingAgentMessageSegments: [],
          responseDeliveryContextOrdinal:
            executionResult.responseDeliveryContextOrdinal,
          transcriptMessage: executionResult.transcriptResponse,
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
      runtimeIssueInputs: [],
    })
    expect(attempt.result).toEqual(executionResult)
  })

  it('propagates app-server runtime issue inputs through provider metadata', async () => {
    const runtimeIssueInput = {
      component: 'assistant.codex-action',
      details: {
        actionKind: 'command.execution',
        durationMsBucket: 'lt_1s',
        exitCode: 1,
        outputBytesBucket: '0',
      },
      errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
      issueKind: 'tool_error' as const,
      operation: 'command.execution',
      phase: 'provider_turn' as const,
      severity: 'warning' as const,
      summary: 'Codex command execution failed during provider turn.',
    }

    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Final answer.',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'Final answer.',
      jsonEvents: [],
      providerActionCount: 1,
      responseMedia: [],
      runtimeIssueInputs: [runtimeIssueInput],
      sessionId: 'provider-session-issues',
      stderr: '',
      stdout: '',
      threadId: 'provider-session-issues',
      turnId: 'turn-issues',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
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

    expect(attempt.metadata).toMatchObject({
      providerActionCount: 1,
      rawToolEvents: [],
      runtimeIssueInputs: [runtimeIssueInput],
    })
  })

  it('keeps runtime-owned delivery capabilities out of the provider transcript response', async () => {
    const approvalUrl =
      `https://www.withmurph.ai/approve/haa_${'a'.repeat(32)}`
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: `Approval is required.\n\n${approvalUrl}`,
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      jsonEvents: [],
      providerActionCount: 1,
      responseMedia: [],
      runtimeIssueInputs: [],
      sessionId: 'provider-session-capability-split',
      stderr: '',
      stdout: '',
      threadId: 'provider-session-capability-split',
      transcriptMessage: 'Approval is required.',
      turnId: 'turn-capability-split',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      userPrompt: 'Send the report.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    if (!attempt.ok) {
      throw new Error('expected successful provider attempt')
    }
    expect(attempt.result.response).toContain(approvalUrl)
    expect(attempt.result.transcriptResponse).toBe('Approval is required.')
  })

  it('propagates failure-context runtime issue inputs through failed provider metadata', async () => {
    const runtimeIssueInput = {
      component: 'assistant.codex-action',
      details: {
        actionKind: 'mcp.tool.call',
        durationMsBucket: 'unknown',
        outputBytesBucket: 'lt_1kb',
      },
      errorCode: 'CODEX_TOOL_CALL_FAILED',
      issueKind: 'tool_error' as const,
      operation: 'mcp.tool.call',
      phase: 'tool_call' as const,
      severity: 'warning' as const,
      summary: 'Codex tool call failed during provider turn.',
    }
    const error = new VaultCliError('ASSISTANT_CODEX_FAILED', 'Codex failed.')

    codexAppServerMocks.executeCodexAppServerTurn.mockRejectedValueOnce(error)
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValueOnce({
      acceptedNoReplyDeliveryContextOrdinals: [0],
      additionalUsages: [],
      codexThreadId: 'thread-failed-issues',
      jsonEvents: [],
      providerActionCount: 1,
      providerTurnId: 'turn-failed-issues',
      reactions: [],
      rolloutRelativePath: 'sessions/2026/07/14/rollout-thread-failed-issues.jsonl',
      runtimeIssueInputs: [runtimeIssueInput],
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      userPrompt: 'Run the turn.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    if (attempt.ok) {
      throw new Error('expected failed provider attempt')
    }

    expect(attempt.metadata).toMatchObject({
      providerActionCount: 1,
      rawToolEvents: [],
      runtimeIssueInputs: [runtimeIssueInput],
    })
    expect(attempt.rawEvents).toEqual([])
    expect(attempt.acceptedNoReplyDeliveryContextOrdinals).toEqual([0])
    expect(attempt.codexRolloutRelativePath).toBe(
      'sessions/2026/07/14/rollout-thread-failed-issues.jsonl',
    )
    expect(attempt.codexThreadId).toBe('thread-failed-issues')
    expect(attempt.providerTurnId).toBe('turn-failed-issues')
  })

  it('closes active input admission through the production provider adapter', async () => {
    const closeInputAdmission = vi.fn()
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Final answer.',
      transcriptMessage: 'Final answer.',
      jsonEvents: [],
      precedingAgentMessageSegments: [],
      providerActionCount: 0,
      responseDeliveryContextOrdinal: 0,
      responseMedia: [],
      sessionId: 'provider-session-admission',
      stderr: '',
      stdout: '',
      threadId: 'provider-session-admission',
      turnId: 'turn-admission',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      activeTurnSteering: {
        closeInputAdmission,
        registerLiveProviderTurn: vi.fn(() => () => {}),
      },
      automationRelativeDateReferenceWindow: {
        earliestAt: '2031-02-15T09:59:59.900Z',
        latestAt: '2031-02-15T09:59:59.900Z',
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      userPrompt: 'Run the turn.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    const appServerInput =
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]
    expect(appServerInput?.onFirstAssistantResponseCompleted).toEqual(
      expect.any(Function),
    )
    expect(appServerInput?.automationRelativeDateReferenceWindow).toEqual({
      earliestAt: '2031-02-15T09:59:59.900Z',
      latestAt: '2031-02-15T09:59:59.900Z',
    })
    appServerInput?.onFirstAssistantResponseCompleted?.()
    expect(closeInputAdmission).toHaveBeenCalledTimes(1)
  })

  it('preserves response delivery ordinals across the provider adapter', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Final answer.',
      transcriptMessage: 'Final answer.',
      jsonEvents: [],
      precedingAgentMessageSegments: [
        {
          deliveryContextOrdinal: 1,
          response: 'Earlier answer.',
          media: [
            {
              kind: 'image',
              url: 'https://cdn.example.test/assistant/earlier.png',
              alt: 'Earlier answer image',
              source: null,
            },
          ],
        },
      ],
      providerActionCount: 0,
      responseDeliveryContextOrdinal: 0,
      responseMedia: [],
      sessionId: 'provider-session-segments',
      stderr: '',
      stdout: '',
      threadId: 'provider-session-segments',
      turnId: 'turn-segments',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
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

    expect(attempt.result.precedingResponseSegments).toEqual([
      {
        deliveryContextOrdinal: 1,
        response: 'Earlier answer.',
        media: [
          {
            kind: 'image',
            url: 'https://cdn.example.test/assistant/earlier.png',
            alt: 'Earlier answer image',
            source: null,
          },
        ],
      },
    ])
    expect(attempt.result.responseDeliveryContextOrdinal).toBe(0)
  })

  it('passes Venice provider id and config overrides through the Codex app-server seam', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Completed with Venice.',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'Completed with Venice.',
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
      ]),
    )
  })

  it('never passes a multi_agent_v2 CLI override on hosted turns', async () => {
    // Hosted config.toml owns [features.multi_agent_v2] (including
    // Murph's tool and mode hints); a CLI boolean override would take
    // precedence and silently reset that table to feature defaults.
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Completed hosted turn.',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'Completed hosted turn.',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'hosted-thread',
      stderr: '',
      stdout: '',
      threadId: 'hosted-thread',
      turnId: 'turn-hosted',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      env: {
        [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: '1',
        OPENAI_API_KEY: 'test-key',
        PATH: '/usr/bin',
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'hosted-model',
        modelProvider: 'openai',
      }),
      userPrompt: 'Run hosted turn.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    const appServerInput = codexAppServerMocks.executeCodexAppServerTurn.mock
      .calls[0]?.[0]
    expect(
      appServerInput?.configOverrides?.some(
        (override: string) => override.includes('multi_agent'),
      ) ?? false,
    ).toBe(false)
  })

  it('forwards the selected hosted provider credential to the Codex process', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Completed hosted Venice turn.',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'Completed hosted Venice turn.',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'hosted-venice-thread',
      stderr: '',
      stdout: '',
      threadId: 'hosted-venice-thread',
      turnId: 'turn-hosted-venice',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      env: {
        [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: '1',
        HOSTED_ASSISTANT_PROVIDER: 'venice',
        PATH: '/usr/bin',
        VENICE_API_KEY: 'signed-venice-egress-credential',
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
        model: 'venice-model',
        modelProvider: 'venice',
      }),
      userPrompt: 'Run hosted Venice turn.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]?.env,
    ).toMatchObject({
      HOSTED_ASSISTANT_PROVIDER: 'venice',
      VENICE_API_KEY: 'signed-venice-egress-credential',
    })
  })

  it('appends turn-local memory isolation after provider overrides', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Completed turn-local override.',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'Completed turn-local override.',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'turn-local-override-thread',
      stderr: '',
      stdout: '',
      threadId: 'turn-local-override-thread',
      turnId: 'turn-local-override',
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      codexConfigOverrides: [
        'memories.use_memories=false',
        'memories.generate_memories=false',
        'features.shell_tool=false',
      ],
      providerConfig: normalizeAssistantProviderConfig({
        codexHome: '/tmp/provider-tests/shared-codex-home',
        provider: 'codex-cli',
        model: 'hosted-model',
        modelProvider: 'venice',
      }),
      userPrompt: 'Run with turn-local overrides.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(true)
    const appServerInput = codexAppServerMocks.executeCodexAppServerTurn.mock
      .calls[0]?.[0]
    expect(appServerInput?.configOverrides).toEqual([
      'model_providers.venice.name="Venice.ai"',
      'model_providers.venice.base_url="https://api.venice.ai/api/v1"',
      'model_providers.venice.env_key="VENICE_API_KEY"',
      'model_providers.venice.wire_api="responses"',
      'model_providers.venice.requires_openai_auth=false',
      'memories.use_memories=false',
      'memories.generate_memories=false',
      'features.shell_tool=false',
    ])
    expect(appServerInput?.codexHome).toBe('/tmp/provider-tests/shared-codex-home')
  })

  it('forwards ephemeral read-only turns while preserving dynamic tools', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Completed isolated reviewed turn.',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'Completed isolated reviewed turn.',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'ephemeral-reviewed-thread',
      stderr: '',
      stdout: '',
      threadId: 'ephemeral-reviewed-thread',
      turnId: 'turn-ephemeral-reviewed',
    })
    const dynamicTools = resolveMurphDynamicTools({
      groupAvailable: true,
      progressUpdatesAvailable: false,
    })
    const codexConfigOverrides = [
      'memories.use_memories=false',
      'memories.generate_memories=false',
      'features.shell_tool=false',
      'web_search="disabled"',
      'features.web_search_request=false',
      'features.standalone_web_search=false',
      'features.apps=false',
      'features.enable_mcp_apps=false',
      'features.browser_use=false',
      'features.plugins=false',
      'features.multi_agent=false',
      'features.multi_agent_v2=false',
      'features.tool_suggest=false',
    ]

    const attempt = await executeCodexAssistantTurnAttemptFromInput({
      providerConfig: {
        provider: 'codex-cli',
        sandbox: 'read-only',
      },
      turn: {
        codexConfigOverrides,
        dynamicTools,
        prompt: 'Reason once over the reviewed group answer.',
        providerThreadEphemeral: true,
        workingDirectory: '/tmp/provider-tests',
      },
    })

    expect(attempt.ok).toBe(true)
    const appServerInput =
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]
    expect(appServerInput?.configOverrides).toEqual(codexConfigOverrides)
    expect(appServerInput?.dynamicTools).toEqual(dynamicTools)
    expect(appServerInput?.ephemeral).toBe(true)
    expect(appServerInput?.sandbox).toBe('read-only')
  })

  it('forwards named maintenance permissions without a legacy sandbox', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Completed room-model maintenance.',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'Completed room-model maintenance.',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'room-model-maintenance-thread',
      stderr: '',
      stdout: '',
      threadId: 'room-model-maintenance-thread',
      turnId: 'turn-room-model-maintenance',
    })

    const attempt = await executeCodexAssistantTurnAttemptFromInput({
      providerConfig: {
        provider: 'codex-cli',
        sandbox: 'danger-full-access',
      },
      turn: {
        dynamicTools: [],
        groupRoomModelMaintenanceAuthorized: true,
        permissions: 'murph-group-room-model-maintenance',
        processLifetime: 'one-shot',
        prompt: 'Refresh the room model.',
        providerThreadEphemeral: true,
        runtimeWorkspaceRoots: ['/tmp/provider-tests'],
        workingDirectory: '/tmp/provider-tests',
      },
    })

    expect(attempt.ok).toBe(true)
    const appServerInput =
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]
    expect(appServerInput).toMatchObject({
      ephemeral: true,
      groupRoomModelMaintenanceAuthorized: true,
      permissions: 'murph-group-room-model-maintenance',
      processLifetime: 'one-shot',
      runtimeWorkspaceRoots: ['/tmp/provider-tests'],
    })
    expect(appServerInput?.sandbox).toBeUndefined()
  })

  it('forwards resident member-workspace permissions through start and resume inputs', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'Completed ordinary hosted work.',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'Completed ordinary hosted work.',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'member-workspace-thread',
      stderr: '',
      stdout: '',
      threadId: 'member-workspace-thread',
      turnId: 'turn-member-workspace',
    })

    const attempt = await executeCodexAssistantTurnAttemptFromInput({
      providerConfig: {
        provider: 'codex-cli',
        sandbox: 'danger-full-access',
      },
      turn: {
        dynamicTools: [],
        permissions: 'murph-member-workspace',
        prompt: 'Update the ordinary member vault.',
        resume: {
          codexThreadId: 'member-workspace-thread',
        },
        runtimeWorkspaceRoots: ['/tmp/provider-tests'],
        workingDirectory: '/tmp/provider-tests',
      },
    })

    expect(attempt.ok).toBe(true)
    const appServerInput =
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]
    expect(appServerInput).toMatchObject({
      permissions: 'murph-member-workspace',
      resumeSessionId: 'member-workspace-thread',
      runtimeWorkspaceRoots: ['/tmp/provider-tests'],
    })
    expect(appServerInput?.sandbox).toBeUndefined()
    expect(appServerInput?.processLifetime).toBeUndefined()
    expect(appServerInput?.ephemeral).toBeUndefined()
  })

  it('does not replay committed history after stale native resume fails', async () => {
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
        precedingAgentMessageSegments: [],
        responseDeliveryContextOrdinal: 0,
        transcriptMessage: 'final after fallback',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: 'fresh-thread',
        stderr: '',
        stdout: '',
        threadId: 'fresh-thread',
        turnId: 'turn-fallback',
      })

    const attempt = await executeCodexAssistantTurnAttempt({
      conversationHistoryMessages: [
        {
          content: 'earlier committed user context',
          role: 'user',
        },
        {
          content: 'earlier committed assistant context',
          role: 'assistant',
        },
      ],
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      resume: testCodexResume('stale-thread'),
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    const primaryAppServerInput =
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0]
    expect(primaryAppServerInput).toMatchObject({
      resumeSessionId: 'stale-thread',
    })
    expect(primaryAppServerInput?.prompt).not.toContain('Active turn so far:')
    expect(primaryAppServerInput?.prompt).not.toContain(
      'Recent conversation history for context only; do not answer these prior messages:',
    )
    expect(findProviderPromptSizeTraceRawEvent(
      traceEvents,
      'primary',
    )).toMatchObject({
      conversationHistoryCount: 0,
      conversationHistoryPresent: false,
      providerPromptDiagnosticKind: 'primary',
      resumeCodexThreadIdPresent: true,
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

  it('preserves the original stale-resume failure', async () => {
    const staleError = new VaultCliError(
      'ASSISTANT_CODEX_RESUME_STALE',
      'thread/resume failed: no rollout found for thread id stale-thread',
    )
    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(staleError)
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValue(null)

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      resume: testCodexResume('stale-thread'),
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt).toMatchObject({
      error: staleError,
      ok: false,
    })
    expect(attempt).not.toHaveProperty('codexContinuation')
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
  })

  it('does not start a fresh thread when resumed Codex transport fails', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server turn failed. status failed. stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)',
      {
        codexFailureStage: 'turn_failed',
        codexTurnStatus: 'failed',
      },
    )
    const traceEvents: AssistantProviderTraceEvent[] = []

    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(expectedError)
      .mockResolvedValueOnce({
        finalMessage: 'final after transport fallback',
        precedingAgentMessageSegments: [],
        responseDeliveryContextOrdinal: 0,
        transcriptMessage: 'final after transport fallback',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: 'fresh-thread-after-transport-failure',
        stderr: '',
        stdout: '',
        threadId: 'fresh-thread-after-transport-failure',
        turnId: 'turn-fallback-transport',
      })
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
      conversationHistoryMessages: [
        {
          content: 'committed user context',
          role: 'user',
        },
      ],
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      resume: testCodexResume('resume-thread'),
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0],
    ).toMatchObject({
      resumeSessionId: 'resume-thread',
    })
    const resumeFailureTrace = findProviderTraceRawEvent(
      traceEvents,
      'codex.resume_failure',
    )
    expect(resumeFailureTrace).toMatchObject({
      codexResumeFailureErrorCode: 'ASSISTANT_CODEX_FAILED',
      codexResumeFailureErrorKind: 'turn-failed',
      codexResumeFailureProviderActionCount: 0,
      codexResumeFailureTraceType: 'failure',
      providerTraceKind: 'codex.resume_failure',
    })
    expect(String(resumeFailureTrace.codexResumeFailureErrorMessage)).toContain(
      'stream disconnected before completion',
    )
    expect(attempt).not.toHaveProperty('codexContinuation')
    expect(JSON.stringify(traceEvents)).not.toContain('api.openai.com')
  })

  it('does not start a fresh thread when resumed Codex RPC fails', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_RPC_FAILED',
      'thread/resume failed before provider actions',
      {
        method: 'thread/resume',
        retryable: false,
      },
    )

    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(expectedError)
      .mockResolvedValueOnce({
        finalMessage: 'final after rpc fallback',
        precedingAgentMessageSegments: [],
        responseDeliveryContextOrdinal: 0,
        transcriptMessage: 'final after rpc fallback',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: 'fresh-thread-after-rpc-failure',
        stderr: '',
        stdout: '',
        threadId: 'fresh-thread-after-rpc-failure',
        turnId: 'turn-fallback-rpc',
      })
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValueOnce({
      jsonEvents: [],
      providerActionCount: 0,
      codexThreadId: 'resume-thread',
      providerTurnId: null,
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      resume: testCodexResume('resume-thread'),
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0],
    ).toMatchObject({
      resumeSessionId: 'resume-thread',
    })
    expect(attempt).toMatchObject({ error: expectedError })
    expect(attempt).not.toHaveProperty('codexContinuation')
  })

  it('does not replay resumed Codex transport failures after provider actions', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server turn failed. status failed. stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)',
      {
        codexFailureStage: 'turn_failed',
        codexTurnStatus: 'failed',
      },
    )
    const traceEvents: AssistantProviderTraceEvent[] = []

    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(expectedError)
      .mockResolvedValueOnce({
        finalMessage: 'final after transport fallback despite provider action',
        precedingAgentMessageSegments: [],
        responseDeliveryContextOrdinal: 0,
        transcriptMessage: 'final after transport fallback despite provider action',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: 'fresh-thread-after-provider-action-transport-failure',
        stderr: '',
        stdout: '',
        threadId: 'fresh-thread-after-provider-action-transport-failure',
        turnId: 'turn-fallback-provider-action-transport',
      })
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
      providerActionCount: 1,
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
      resume: testCodexResume('resume-thread'),
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0],
    ).toMatchObject({
      resumeSessionId: 'resume-thread',
    })
    expect(attempt).toMatchObject({
      codexThreadId: 'resume-thread',
      metadata: {
        providerActionCount: 1,
      },
      providerTurnId: 'turn-failed',
    })
    expect(attempt).not.toHaveProperty('codexContinuation')
    expect(JSON.stringify(traceEvents)).not.toContain('api.openai.com')
  })

  it('does not replay a resumed turn after finish_without_reply was accepted', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server stream disconnected before completion',
      {
        codexFailureStage: 'turn_failed',
        codexTurnStatus: 'failed',
      },
    )
    const rolloutRelativePath =
      'sessions/2026/07/14/rollout-resume-thread.jsonl'

    codexAppServerMocks.executeCodexAppServerTurn.mockRejectedValueOnce(expectedError)
    codexAppServerMocks.readCodexAppServerTurnFailureContext.mockReturnValueOnce({
      acceptedNoReplyDeliveryContextOrdinals: [0],
      additionalUsages: [],
      codexThreadId: 'resume-thread',
      jsonEvents: [],
      providerActionCount: 1,
      providerTurnId: 'turn-failed-after-no-reply',
      reactions: [],
      rolloutRelativePath,
      runtimeIssueInputs: [],
    })

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      resume: testCodexResume('resume-thread'),
      userPrompt: 'no reply needed',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(attempt).toMatchObject({
      acceptedNoReplyDeliveryContextOrdinals: [0],
      codexRolloutRelativePath: rolloutRelativePath,
      codexThreadId: 'resume-thread',
      providerTurnId: 'turn-failed-after-no-reply',
    })
  })

  it('returns the original resume failure without running fallback recording', async () => {
    const resumeError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server stream disconnected before completion',
      {
        codexFailureStage: 'turn_failed',
        codexTurnStatus: 'failed',
      },
    )
    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(resumeError)
    codexAppServerMocks.readCodexAppServerTurnFailureContext
      .mockReturnValueOnce({
        acceptedNoReplyDeliveryContextOrdinals: [],
        additionalUsages: [],
        codexThreadId: 'resume-thread',
        jsonEvents: [],
        providerActionCount: 0,
        providerTurnId: 'turn-resume-failed',
        reactions: [],
        rolloutRelativePath: null,
        runtimeIssueInputs: [],
      })

    const attempt = await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      resume: testCodexResume('resume-thread'),
      userPrompt: 'no reply needed',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(attempt).toMatchObject({
      acceptedNoReplyDeliveryContextOrdinals: [],
      codexThreadId: 'resume-thread',
      error: resumeError,
      providerTurnId: 'turn-resume-failed',
    })
    expect(attempt).not.toHaveProperty('codexContinuation')
  })

  it('does not start a fresh thread when resumed Codex history has invalid tool output', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server turn failed. status failed. {"error":{"type":"invalid_request_error","message":"input.193.output: Invalid input"}}',
    )
    const traceEvents: AssistantProviderTraceEvent[] = []

    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(expectedError)
      .mockResolvedValueOnce({
        finalMessage: 'final after invalid resume fallback',
        precedingAgentMessageSegments: [],
        responseDeliveryContextOrdinal: 0,
        transcriptMessage: 'final after invalid resume fallback',
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
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      resume: testCodexResume('corrupt-thread'),
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0],
    ).toMatchObject({
      prompt: expect.not.stringContaining('Active turn so far:'),
      resumeSessionId: 'corrupt-thread',
    })
    expect(attempt).toMatchObject({ error: expectedError })
    expect(attempt).not.toHaveProperty('codexContinuation')
    expect(findProviderTraceRawEvent(
      traceEvents,
      'codex.invalid_output_resume_failure',
    )).toMatchObject({
      codexInvalidOutputErrorCode: 'ASSISTANT_CODEX_FAILED',
      codexInvalidOutputErrorField: 'input.193.output',
      codexInvalidOutputErrorKind: 'invalid-input-output',
      codexInvalidOutputErrorMessageLength: expectedError.message.length,
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
    expect(JSON.stringify(traceEvents)).not.toContain('private tool text')
    expect(JSON.stringify(traceEvents)).not.toContain('private health text')
    expect(JSON.stringify(traceEvents)).not.toContain('HbA1c')
    expect(JSON.stringify(traceEvents)).not.toContain('example.invalid')
  })

  it('does not replay invalid resumed output after provider actions', async () => {
    const expectedError = new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex app-server turn failed. status failed. {"error":{"type":"invalid_request_error","message":"input.193.output: Invalid input"}}',
    )
    const rawEvents = [{ method: 'turn/completed' }]

    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(expectedError)
      .mockResolvedValueOnce({
        finalMessage: 'final after provider-action invalid resume fallback',
        precedingAgentMessageSegments: [],
        responseDeliveryContextOrdinal: 0,
        transcriptMessage: 'final after provider-action invalid resume fallback',
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
      resume: testCodexResume('corrupt-thread'),
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(
      codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0],
    ).toMatchObject({
      resumeSessionId: 'corrupt-thread',
    })
    expect(attempt).toMatchObject({
      codexThreadId: 'corrupt-thread',
      metadata: {
        providerActionCount: 1,
      },
      providerTurnId: 'turn-invalid-output',
    })
    expect(attempt).not.toHaveProperty('codexContinuation')
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
      resume: testCodexResume('resume-thread'),
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
      resume: testCodexResume('resume-thread'),
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

  it('does not surface an unused invalid-output fallback failure', async () => {
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
      providerActionCount: 0,
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
      resume: testCodexResume('corrupt-thread'),
      userPrompt: 'late follow up',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(attempt.ok).toBe(false)
    if (attempt.ok) {
      throw new Error('expected failed provider attempt')
    }
    expect(attempt.error).toBe(expectedError)
    expect(attempt).not.toHaveProperty('codexContinuation')
    expect(findProviderTraceRawEvent(
      traceEvents,
      'codex.invalid_output_resume_failure',
    )).toMatchObject({
      codexInvalidOutputFailureProviderActionCount: 0,
      codexInvalidOutputInputIndex: 7,
      codexInvalidOutputPhase: 'resume-failed',
      providerTraceKind: 'codex.invalid_output_resume_failure',
    })
    expect(JSON.stringify(traceEvents)).not.toContain('HbA1c')
    expect(JSON.stringify(traceEvents)).not.toContain('example.invalid')
  })

  it('adds the Venice runtime hint when native resume has invalid output', async () => {
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
      resume: testCodexResume('corrupt-venice-thread'),
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
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
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
      additionalUsages: [],
      error: expectedError,
      metadata: {
        activityLabels: ['Refresh Session'],
        executedToolCount: 0,
        rawToolEvents: [],
        providerActionCount: 0,
        runtimeIssueInputs: [],
      },
      ok: false,
    })
  })
})
