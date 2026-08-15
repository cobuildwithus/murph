import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  parseAssistantUsageRecord,
} from '@murphai/hosted-execution/assistant-usage'
import {
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'

import {
  type CodexSubagentTurnTokenUsageSample,
  extractCodexSubagentUsageDrafts,
  hashAssistantProviderStableJson,
} from '../src/assistant/providers/helpers.ts'

const SUBAGENT_PROVIDER_REQUEST_STARTED_AT = '2026-07-23T11:59:00.000Z'

function tokenUsageEvent(input: {
  threadId: string
  turnId: string
  total: Record<string, number>
  last: Record<string, number>
}): Record<string, unknown> {
  const completeBreakdown = (
    breakdown: Record<string, number>,
  ): Record<string, number> => ({
    cacheWriteInputTokens: 0,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
    ...breakdown,
  })
  return {
    method: 'thread/tokenUsage/updated',
    params: {
      threadId: input.threadId,
      turnId: input.turnId,
      tokenUsage: {
        last: completeBreakdown(input.last),
        modelContextWindow: null,
        total: completeBreakdown(input.total),
      },
    },
  }
}

function spawnEndEvent(input: {
  receiverThreadIds: readonly string[]
  model?: string
}): Record<string, unknown> {
  return {
    method: 'item/completed',
    params: {
      threadId: 'thread-parent',
      turnId: 'turn-parent',
      item: {
        id: 'collab-call-1',
        type: 'collabAgentToolCall',
        tool: 'spawnAgent',
        status: 'completed',
        senderThreadId: 'thread-parent',
        receiverThreadIds: [...input.receiverThreadIds],
        prompt: 'do the heavy part',
        ...(input.model !== undefined ? { model: input.model } : {}),
        reasoningEffort: 'low',
        agentsStates: {},
      },
    },
  }
}

function sampleFromEvents(
  events: readonly Record<string, unknown>[],
  occurredAt = SUBAGENT_PROVIDER_REQUEST_STARTED_AT,
): CodexSubagentTurnTokenUsageSample {
  const params = events[0]?.params
  if (!params || typeof params !== 'object') {
    throw new Error('Expected a token usage event with params.')
  }
  const threadId = Reflect.get(params, 'threadId')
  const turnId = Reflect.get(params, 'turnId')
  if (typeof threadId !== 'string' || typeof turnId !== 'string') {
    throw new Error('Expected a token usage event with thread and turn ids.')
  }
  return {
    firstEvent: events[0],
    lastEvent: events[events.length - 1],
    occurredAt,
    threadId,
    turnId,
  }
}

describe('extractCodexSubagentUsageDrafts', () => {
  it('returns no drafts without subagent samples', () => {
    expect(
      extractCodexSubagentUsageDrafts({
        modelProvider: 'openai',
        ordinalStart: 1,
        parentRawEvents: [],
        subagentTokenUsageByTurn: new Map(),
      }),
    ).toEqual([])
  })

  it('attributes local OpenAI subagent usage to the hosted OpenAI ledger identity', () => {
    const events = [
      tokenUsageEvent({
        threadId: 'thread-local-openai-child',
        turnId: 'turn-local-openai-child',
        total: {
          totalTokens: 100,
          inputTokens: 80,
          outputTokens: 20,
        },
        last: {
          totalTokens: 100,
          inputTokens: 80,
          outputTokens: 20,
        },
      }),
    ]
    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
      ordinalStart: 1,
      parentRawEvents: [spawnEndEvent({
        model: 'gpt-5.6-terra',
        receiverThreadIds: ['thread-local-openai-child'],
      })],
      serviceTier: 'flex',
      subagentTokenUsageByTurn: new Map([
        ['thread-local-openai-child', sampleFromEvents(events)],
      ]),
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.usage).toMatchObject({
      providerName: 'hosted-openai',
      tokenPricingBasis: 'openai-flex',
    })
  })

  it('builds per-turn total deltas with spawn-attributed models', () => {
    const childA = [
      tokenUsageEvent({
        threadId: 'thread-child-a',
        turnId: 'turn-child-a',
        total: {
          totalTokens: 1_000,
          inputTokens: 800,
          cachedInputTokens: 0,
          outputTokens: 200,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 1_000,
          inputTokens: 800,
          cachedInputTokens: 0,
          outputTokens: 200,
          reasoningOutputTokens: 0,
        },
      }),
      tokenUsageEvent({
        threadId: 'thread-child-a',
        turnId: 'turn-child-a',
        total: {
          totalTokens: 5_000,
          inputTokens: 4_000,
          cachedInputTokens: 2_000,
          outputTokens: 1_000,
          reasoningOutputTokens: 120,
        },
        last: {
          totalTokens: 4_000,
          inputTokens: 3_200,
          cachedInputTokens: 2_000,
          outputTokens: 800,
          reasoningOutputTokens: 120,
        },
      }),
    ]
    const childB = [
      tokenUsageEvent({
        threadId: 'thread-child-b',
        turnId: 'turn-child-b',
        total: {
          totalTokens: 700,
          inputTokens: 600,
          cachedInputTokens: 100,
          outputTokens: 100,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 700,
          inputTokens: 600,
          cachedInputTokens: 100,
          outputTokens: 100,
          reasoningOutputTokens: 0,
        },
      }),
    ]

    const ghostThread = [
      tokenUsageEvent({
        threadId: 'thread-child-ghost',
        turnId: 'turn-child-ghost',
        total: {
          totalTokens: 9_999,
          inputTokens: 9_000,
          cachedInputTokens: 0,
          outputTokens: 999,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 9_999,
          inputTokens: 9_000,
          cachedInputTokens: 0,
          outputTokens: 999,
          reasoningOutputTokens: 0,
        },
      }),
    ]

    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 3,
      parentRawEvents: [
        spawnEndEvent({
          receiverThreadIds: ['thread-child-a'],
          model: 'gpt-5.6-terra-mini',
        }),
        // Spawn evidence without a model: bills, stays unattributed.
        spawnEndEvent({
          receiverThreadIds: ['thread-child-b'],
        }),
      ],
      subagentTokenUsageByTurn: new Map([
        ['thread-child-a', sampleFromEvents(childA)],
        ['thread-child-b', sampleFromEvents(childB)],
        // No spawn item names this thread (e.g. a stale flush from a
        // previous thread on a reused warm process): never billed.
        ['thread-child-ghost', sampleFromEvents(ghostThread)],
      ]),
    })

    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({
      occurredAt: SUBAGENT_PROVIDER_REQUEST_STARTED_AT,
      provider: 'codex-cli',
      providerRequestOrdinal: 3,
      providerRequestOutcome: 'succeeded',
      usage: {
        // First event's total equals its last, so the prior-thread baseline
        // is zero and the delta is the final total.
        cachedInputTokens: 2_000,
        inputTokens: 4_000,
        outputTokens: 1_000,
        providerName: 'openai',
        reasoningTokens: 120,
        requestedModel: 'gpt-5.6-terra-mini',
        servedModel: 'gpt-5.6-terra-mini',
        totalTokens: 5_000,
        usageExtractionSourcePath: 'subagent.turn.tokenUsage.total.delta',
      },
    })
    expect(drafts[0]?.usage.rawUsageJson).toEqual({
      cacheWriteInputTokens: 0,
      cachedInputTokens: 2_000,
      inputTokens: 4_000,
      outputTokens: 1_000,
      reasoningOutputTokens: 120,
      totalTokens: 5_000,
    })
    expect(drafts[0]?.usage.rawUsageJsonHash).toBe(
      hashAssistantProviderStableJson(drafts[0]?.usage.rawUsageJson),
    )
    expect(drafts[1]).toMatchObject({
      providerRequestOrdinal: 4,
      usage: {
        inputTokens: 600,
        outputTokens: 100,
        // The spawn item carried no model, so the model stays unattributed
        // rather than inheriting the parent's.
        requestedModel: null,
        servedModel: null,
        totalTokens: 700,
      },
    })
    expect(drafts[1]?.usage.rawUsageJson).toEqual({
      cacheWriteInputTokens: 0,
      cachedInputTokens: 100,
      inputTokens: 600,
      outputTokens: 100,
      reasoningOutputTokens: 0,
      totalTokens: 700,
    })

    const draft = drafts[0]!
    const turnId = 'turn-subagent-usage'
    const usageId = createAssistantUsageId({
      attemptCount: 1,
      providerRequestOrdinal: draft.providerRequestOrdinal,
      turnId,
    })
    const parsed = parseAssistantUsageRecord({
      ...draft.usage,
      attemptCount: 1,
      credentialSource: 'platform',
      occurredAt: '2026-07-23T12:00:00.000Z',
      provider: draft.provider,
      providerRequestOrdinal: draft.providerRequestOrdinal,
      providerRequestOutcome: draft.providerRequestOutcome,
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: 'assistant-session-subagent-usage',
      turnId,
      usageId,
    })
    expect(parsed.providerRequestOrdinal).toBe(3)
    expect(parsed.usageId).toBe(
      'turn-subagent-usage.request-3.attempt-1',
    )
    expect(parsed.rawUsageJson).toEqual(draft.usage.rawUsageJson)
    expect(parsed.rawUsageJsonHash).toBe(draft.usage.rawUsageJsonHash)

    // The ghost thread never bills.
    expect(JSON.stringify(drafts)).not.toContain('thread-child-ghost')
  })

  it('keeps reused child turns as distinct provider operations', () => {
    const threadId = 'thread-reused-across-reset'
    const firstStartedAt = '2026-07-23T11:59:59.000Z'
    const secondStartedAt = '2026-07-23T12:00:01.000Z'
    const firstTurn = [
      tokenUsageEvent({
        threadId,
        turnId: 'turn-before-reset',
        total: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        last: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
      }),
    ]
    const secondTurn = [
      tokenUsageEvent({
        threadId,
        turnId: 'turn-after-reset',
        total: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        last: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
      }),
      tokenUsageEvent({
        threadId,
        turnId: 'turn-after-reset',
        total: { inputTokens: 200, outputTokens: 50, totalTokens: 250 },
        last: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
      }),
    ]

    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 4,
      parentRawEvents: [
        spawnEndEvent({ receiverThreadIds: [threadId] }),
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'collabAgentToolCall',
              tool: 'sendInput',
              receiverThreadIds: [threadId],
            },
          },
        },
      ],
      subagentTokenUsageByTurn: new Map([
        ['before', sampleFromEvents(firstTurn, firstStartedAt)],
        ['after', sampleFromEvents(secondTurn, secondStartedAt)],
      ]),
    })

    expect(drafts).toMatchObject([
      {
        occurredAt: firstStartedAt,
        providerRequestOrdinal: 4,
        usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
      },
      {
        occurredAt: secondStartedAt,
        providerRequestOrdinal: 5,
        usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      },
    ])
  })

  it('tracks Codex v2 app-server spawn items and token usage notifications', () => {
    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 2,
      parentRawEvents: [
        {
          method: 'item/completed',
          params: {
            threadId: 'thread-parent-v2',
            turnId: 'turn-parent-v2',
            item: {
              id: 'spawn-v2-1',
              type: 'collabAgentToolCall',
              tool: 'spawnAgent',
              status: 'completed',
              senderThreadId: 'thread-parent-v2',
              receiverThreadIds: ['thread-child-v2'],
              prompt: 'summarize private context',
              model: 'gpt-5.2',
              reasoningEffort: 'medium',
              agentsStates: {
                'thread-child-v2': 'completed',
              },
            },
          },
        },
      ],
      subagentTokenUsageByTurn: new Map([
        [
          'thread-child-v2',
          sampleFromEvents([
            tokenUsageEvent({
              threadId: 'thread-child-v2',
              turnId: 'turn-child-v2',
              total: {
                totalTokens: 1_200,
                inputTokens: 900,
                cachedInputTokens: 300,
                outputTokens: 300,
                reasoningOutputTokens: 40,
              },
              last: {
                totalTokens: 1_200,
                inputTokens: 900,
                cachedInputTokens: 300,
                outputTokens: 300,
                reasoningOutputTokens: 40,
              },
            }),
          ]),
        ],
      ]),
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      provider: 'codex-cli',
      providerRequestOrdinal: 2,
      providerRequestOutcome: 'succeeded',
      usage: {
        cachedInputTokens: 300,
        inputTokens: 900,
        outputTokens: 300,
        providerName: 'openai',
        reasoningTokens: 40,
        requestedModel: 'gpt-5.2',
        servedModel: 'gpt-5.2',
        totalTokens: 1_200,
        usageExtractionSourcePath: 'subagent.turn.tokenUsage.total.delta',
      },
    })
    expect(drafts[0]?.usage.rawUsageJson).toEqual({
      cacheWriteInputTokens: 0,
      cachedInputTokens: 300,
      inputTokens: 900,
      outputTokens: 300,
      reasoningOutputTokens: 40,
      totalTokens: 1_200,
    })
    expect(JSON.stringify(drafts)).not.toContain('summarize private context')
  })

  it('authorizes billing via non-spawn collab items and keeps spawn-attributed models', () => {
    const usageFor = (threadId: string) =>
      sampleFromEvents([
        tokenUsageEvent({
          threadId,
          turnId: `turn-${threadId}`,
          total: {
            totalTokens: 100,
            inputTokens: 80,
            cachedInputTokens: 0,
            outputTokens: 20,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 100,
            inputTokens: 80,
            cachedInputTokens: 0,
            outputTokens: 20,
            reasoningOutputTokens: 0,
          },
        }),
      ])

    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 1,
      parentRawEvents: [
        // A reused child only appears via sendInput: billable, model unknown.
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'collabAgentToolCall',
              tool: 'sendInput',
              receiverThreadIds: ['thread-reused-child'],
            },
          },
        },
        // A spawned child later also receives sendInput: the spawn model wins.
        spawnEndEvent({
          receiverThreadIds: ['thread-spawned-child'],
          model: 'gpt-5.6-terra-mini',
        }),
        {
          method: 'item/completed',
          params: {
            item: {
              type: 'collabAgentToolCall',
              tool: 'sendInput',
              receiverThreadIds: ['thread-spawned-child'],
            },
          },
        },
      ],
      subagentTokenUsageByTurn: new Map([
        ['thread-reused-child', usageFor('thread-reused-child')],
        ['thread-spawned-child', usageFor('thread-spawned-child')],
      ]),
    })

    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({
      usage: {
        requestedModel: null,
        servedModel: null,
        totalTokens: 100,
      },
    })
    expect(drafts[0]?.usage.rawUsageJson).toEqual({
      cacheWriteInputTokens: 0,
      cachedInputTokens: 0,
      inputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      totalTokens: 100,
    })
    expect(drafts[1]).toMatchObject({
      usage: {
        requestedModel: 'gpt-5.6-terra-mini',
        servedModel: 'gpt-5.6-terra-mini',
      },
    })
  })

  it('never bills foreign-thread usage without spawn evidence', () => {
    // Warm processes are reused across threads; a stale tokenUsage flush from
    // a previous thread carries a foreign thread id but is not a subagent.
    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 1,
      parentRawEvents: [],
      subagentTokenUsageByTurn: new Map([
        [
          'thread-previous-warm',
          sampleFromEvents([
            tokenUsageEvent({
              threadId: 'thread-previous-warm',
              turnId: 'turn-previous-warm',
              total: {
                totalTokens: 1_234,
                inputTokens: 1_000,
                cachedInputTokens: 0,
                outputTokens: 234,
                reasoningOutputTokens: 0,
              },
              last: {
                totalTokens: 1_234,
                inputTokens: 1_000,
                cachedInputTokens: 0,
                outputTokens: 234,
                reasoningOutputTokens: 0,
              },
            }),
          ]),
        ],
      ]),
    })

    expect(drafts).toEqual([])
  })

  it('rejects snake-case subagent aliases at the pinned protocol boundary', () => {
    const snakeCaseEvent = {
      method: 'thread/token_usage/updated',
      params: {
        threadId: 'thread-child-snake',
        turnId: 'turn-child-snake',
        token_usage: {
          last: {
            total_tokens: 50,
            input_tokens: 40,
            cached_input_tokens: 0,
            output_tokens: 10,
          },
          total: {
            total_tokens: 50,
            input_tokens: 40,
            cached_input_tokens: 0,
            output_tokens: 10,
          },
        },
      },
    }
    const sample = sampleFromEvents([snakeCaseEvent])

    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: null,
      ordinalStart: 1,
      parentRawEvents: [
        {
          method: 'item.completed',
          params: {
            item: {
              type: 'collabAgentToolCall',
              tool: 'spawn_agent',
              receiver_thread_ids: ['thread-child-snake', 'thread-other'],
              model: 'gpt-5.6-terra',
            },
          },
        },
      ],
      subagentTokenUsageByTurn: new Map([
        ['thread-child-snake', sample],
      ]),
    })

    expect(drafts).toEqual([])
  })

  it('persists only the flat token delta and never leaks spawn prompt content', () => {
    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 1,
      parentRawEvents: [
        spawnEndEvent({
          receiverThreadIds: ['thread-child-a'],
          model: 'gpt-5.6-terra-mini',
        }),
      ],
      subagentTokenUsageByTurn: new Map([
        [
          'thread-child-a',
          sampleFromEvents([
            tokenUsageEvent({
              threadId: 'thread-child-a',
              turnId: 'turn-child-a',
              total: {
                totalTokens: 300,
                inputTokens: 250,
                cachedInputTokens: 0,
                outputTokens: 50,
                reasoningOutputTokens: 0,
              },
              last: {
                totalTokens: 300,
                inputTokens: 250,
                cachedInputTokens: 0,
                outputTokens: 50,
                reasoningOutputTokens: 0,
              },
            }),
          ]),
        ],
      ]),
    })

    expect(drafts).toHaveLength(1)
    // The spawn item carries member content ('prompt'); drafts must stay
    // token-only so hosted_ai_usage never persists raw member content.
    expect(JSON.stringify(drafts)).not.toContain('do the heavy part')
    expect(JSON.stringify(drafts)).not.toContain('prompt')
    expect(JSON.stringify(drafts)).not.toContain('thread-child-a')
    expect(drafts[0]?.usage.rawUsageJson).toEqual({
      cacheWriteInputTokens: 0,
      cachedInputTokens: 0,
      inputTokens: 250,
      outputTokens: 50,
      reasoningOutputTokens: 0,
      totalTokens: 300,
    })
  })

  it('skips spawned threads whose buffered events carry no usable token usage', () => {
    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 1,
      parentRawEvents: [
        spawnEndEvent({
          receiverThreadIds: ['thread-child-empty'],
          model: 'gpt-5.6-terra-mini',
        }),
      ],
      subagentTokenUsageByTurn: new Map([
        [
          'thread-child-empty',
          {
            firstEvent: { method: 'thread/tokenUsage/updated', params: {} },
            lastEvent: { method: 'thread/tokenUsage/updated', params: {} },
            occurredAt: SUBAGENT_PROVIDER_REQUEST_STARTED_AT,
            threadId: 'thread-child-empty',
            turnId: 'turn-child-empty',
          },
        ],
      ]),
    })

    expect(drafts).toEqual([])
  })

  // Multi-agent V2 emits subAgentActivity items instead of collab tool calls.
  // The canonical item carries no model, so the child inherits the parent
  // model by default; alternate item aliases must not authorize billing.
  it('authorizes exact V2 subAgentActivity items and rejects alternate aliases', () => {
    const childEvents = [
      tokenUsageEvent({
        threadId: 'thread-child-v2',
        turnId: 'turn-child-v2',
        total: {
          totalTokens: 900,
          inputTokens: 700,
          cachedInputTokens: 300,
          outputTokens: 200,
          reasoningOutputTokens: 40,
        },
        last: {
          totalTokens: 900,
          inputTokens: 700,
          cachedInputTokens: 300,
          outputTokens: 200,
          reasoningOutputTokens: 40,
        },
      }),
    ]
    const snakeCaseChildEvents = [
      tokenUsageEvent({
        threadId: 'thread-child-v2-snake',
        turnId: 'turn-child-v2-snake',
        total: {
          totalTokens: 300,
          inputTokens: 250,
          cachedInputTokens: 0,
          outputTokens: 50,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 300,
          inputTokens: 250,
          cachedInputTokens: 0,
          outputTokens: 50,
          reasoningOutputTokens: 0,
        },
      }),
    ]
    const ghostEvents = [
      tokenUsageEvent({
        threadId: 'thread-child-ghost',
        turnId: 'turn-child-ghost',
        total: {
          totalTokens: 400,
          inputTokens: 300,
          cachedInputTokens: 0,
          outputTokens: 100,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 400,
          inputTokens: 300,
          cachedInputTokens: 0,
          outputTokens: 100,
          reasoningOutputTokens: 0,
        },
      }),
    ]

    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 3,
      parentModel: 'gpt-5.6-terra',
      parentRawEvents: [
        {
          method: 'item/completed',
          params: {
            threadId: 'thread-parent',
            turnId: 'turn-parent',
            item: {
              id: 'activity-1',
              type: 'subAgentActivity',
              kind: 'started',
              agentThreadId: 'thread-child-v2',
              agentPath: 'root/child-1',
            },
          },
        },
        {
          method: 'item/completed',
          params: {
            threadId: 'thread-parent',
            turnId: 'turn-parent',
            item: {
              id: 'activity-2',
              type: 'sub_agent_activity',
              kind: 'interacted',
              agent_thread_id: 'thread-child-v2-snake',
              agent_path: 'root/child-2',
            },
          },
        },
      ],
      subagentTokenUsageByTurn: new Map([
        ['thread-child-v2', sampleFromEvents(childEvents)],
        ['thread-child-v2-snake', sampleFromEvents(snakeCaseChildEvents)],
        ['thread-child-ghost', sampleFromEvents(ghostEvents)],
      ]),
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.usage.servedModel).toBe('gpt-5.6-terra')
    expect(drafts[0]?.usage.requestedModel).toBe('gpt-5.6-terra')
    expect(drafts[0]?.providerRequestOrdinal).toBe(3)
    expect(drafts[0]?.usage.inputTokens).toBe(700)
    expect(drafts[0]?.usage.outputTokens).toBe(200)
    expect(drafts[0]?.usage.rawUsageJson).toEqual({
      cacheWriteInputTokens: 0,
      cachedInputTokens: 300,
      inputTokens: 700,
      outputTokens: 200,
      reasoningOutputTokens: 40,
      totalTokens: 900,
    })
    expect(
      drafts.reduce(
        (total, draft) => total + (draft.usage.totalTokens ?? 0),
        0,
      ),
    ).toBe(900)
  })

  it('ignores unsupported V2 activity model metadata and inherits the parent model', () => {
    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 2,
      parentModel: 'gpt-5.6-sol',
      parentRawEvents: [
        {
          method: 'item/completed',
          params: {
            threadId: 'thread-parent-v2-override',
            turnId: 'turn-parent-v2-override',
            item: {
              id: 'spawn-v2-terra',
              type: 'subAgentActivity',
              kind: 'started',
              agentThreadId: 'thread-child-v2-terra',
              agentPath: 'root/terra_check',
              model: 'gpt-5.6-terra',
            },
          },
        },
      ],
      subagentTokenUsageByTurn: new Map([
        [
          'thread-child-v2-terra',
          sampleFromEvents([
            tokenUsageEvent({
              threadId: 'thread-child-v2-terra',
              turnId: 'turn-child-v2-terra',
              total: {
                totalTokens: 300,
                inputTokens: 250,
                cachedInputTokens: 0,
                outputTokens: 50,
                reasoningOutputTokens: 0,
              },
              last: {
                totalTokens: 300,
                inputTokens: 250,
                cachedInputTokens: 0,
                outputTokens: 50,
                reasoningOutputTokens: 0,
              },
            }),
          ]),
        ],
      ]),
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      providerRequestOrdinal: 2,
      usage: {
        inputTokens: 250,
        outputTokens: 50,
        requestedModel: 'gpt-5.6-sol',
        servedModel: 'gpt-5.6-sol',
        totalTokens: 300,
      },
    })
    expect(JSON.stringify(drafts)).not.toContain('thread-child-v2-terra')
  })
})
