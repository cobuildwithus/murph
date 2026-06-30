import { describe, expect, it } from 'vitest'

import {
  type CodexSubagentTokenUsageSample,
  extractCodexSubagentUsageDrafts,
} from '../src/assistant/providers/helpers.ts'

function tokenUsageEvent(input: {
  method?: string
  threadId: string
  turnId: string
  total: Record<string, number>
  last: Record<string, number>
  tokenUsageKey?: 'tokenUsage' | 'token_usage'
}): Record<string, unknown> {
  return {
    method: input.method ?? 'thread/tokenUsage/updated',
    params: {
      threadId: input.threadId,
      turnId: input.turnId,
      [input.tokenUsageKey ?? 'tokenUsage']: {
        total: input.total,
        last: input.last,
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
): CodexSubagentTokenUsageSample {
  return {
    eventCount: events.length,
    firstEvent: events[0],
    lastEvent: events[events.length - 1],
  }
}

describe('extractCodexSubagentUsageDrafts', () => {
  it('returns no drafts without subagent samples', () => {
    expect(
      extractCodexSubagentUsageDrafts({
        droppedThreadCount: 0,
        modelProvider: 'openai',
        ordinalStart: 1,
        parentRawEvents: [],
        subagentTokenUsageByThread: new Map(),
      }),
    ).toEqual([])
  })

  it('builds per-thread total deltas with spawn-attributed models', () => {
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
      droppedThreadCount: 0,
      modelProvider: 'openai',
      ordinalStart: 3,
      parentRawEvents: [
        spawnEndEvent({
          receiverThreadIds: ['thread-child-a'],
          model: 'gpt-5.5-mini',
        }),
        // Spawn evidence without a model: bills, stays unattributed.
        spawnEndEvent({
          receiverThreadIds: ['thread-child-b'],
        }),
      ],
      subagentTokenUsageByThread: new Map([
        ['thread-child-a', sampleFromEvents(childA)],
        ['thread-child-b', sampleFromEvents(childB)],
        // No spawn item names this thread (e.g. a stale flush from a
        // previous thread on a reused warm process): never billed.
        ['thread-child-ghost', sampleFromEvents(ghostThread)],
      ]),
    })

    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({
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
        requestedModel: 'gpt-5.5-mini',
        servedModel: 'gpt-5.5-mini',
        totalTokens: 5_000,
        usageExtractionSourcePath: 'subagent.thread.tokenUsage.total.delta',
      },
    })
    expect(drafts[0]?.usage.rawUsageJson).toMatchObject({
      codexSubagentThreadId: 'thread-child-a',
      tokenUsageEventCount: 2,
      unattributedSubagentUsageThreadCount: 1,
    })
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
    expect(drafts[1]?.usage.rawUsageJson).toMatchObject({
      codexSubagentThreadId: 'thread-child-b',
    })
    // The ghost thread never bills.
    expect(JSON.stringify(drafts)).not.toContain('thread-child-ghost')
  })

  it('tracks Codex v2 app-server spawn items and token usage notifications', () => {
    const drafts = extractCodexSubagentUsageDrafts({
      droppedThreadCount: 0,
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
      subagentTokenUsageByThread: new Map([
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
        usageExtractionSourcePath: 'subagent.thread.tokenUsage.total.delta',
      },
    })
    expect(drafts[0]?.usage.rawUsageJson).toMatchObject({
      codexSubagentThreadId: 'thread-child-v2',
      tokenUsageEventCount: 1,
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
      droppedThreadCount: 0,
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
          model: 'gpt-5.5-mini',
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
      subagentTokenUsageByThread: new Map([
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
    expect(drafts[0]?.usage.rawUsageJson).toMatchObject({
      codexSubagentThreadId: 'thread-reused-child',
    })
    expect(drafts[1]).toMatchObject({
      usage: {
        requestedModel: 'gpt-5.5-mini',
        servedModel: 'gpt-5.5-mini',
      },
    })
  })

  it('never bills foreign-thread usage without spawn evidence', () => {
    // Warm processes are reused across threads; a stale tokenUsage flush from
    // a previous thread carries a foreign thread id but is not a subagent.
    const drafts = extractCodexSubagentUsageDrafts({
      droppedThreadCount: 0,
      modelProvider: 'openai',
      ordinalStart: 1,
      parentRawEvents: [],
      subagentTokenUsageByThread: new Map([
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

  it('attributes one spawn model to every receiver thread and tolerates snake_case items', () => {
    const sample = sampleFromEvents([
      tokenUsageEvent({
        method: 'thread/token_usage/updated',
        threadId: 'thread-child-snake',
        turnId: 'turn-child-snake',
        tokenUsageKey: 'token_usage',
        total: {
          total_tokens: 50,
          input_tokens: 40,
          cached_input_tokens: 0,
          output_tokens: 10,
        },
        last: {
          total_tokens: 50,
          input_tokens: 40,
          cached_input_tokens: 0,
          output_tokens: 10,
        },
      }),
    ])

    const drafts = extractCodexSubagentUsageDrafts({
      droppedThreadCount: 2,
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
              model: 'gpt-5.5',
            },
          },
        },
      ],
      subagentTokenUsageByThread: new Map([
        ['thread-child-snake', sample],
      ]),
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      usage: {
        inputTokens: 40,
        outputTokens: 10,
        requestedModel: 'gpt-5.5',
        servedModel: 'gpt-5.5',
        totalTokens: 50,
      },
    })
    expect(drafts[0]?.usage.rawUsageJson).toMatchObject({
      droppedSubagentUsageThreadCount: 2,
    })
  })

  it('never leaks spawn prompt content into drafts and keeps rawUsageJson metadata-only', () => {
    const drafts = extractCodexSubagentUsageDrafts({
      droppedThreadCount: 0,
      modelProvider: 'openai',
      ordinalStart: 1,
      parentRawEvents: [
        spawnEndEvent({
          receiverThreadIds: ['thread-child-a'],
          model: 'gpt-5.5-mini',
        }),
      ],
      subagentTokenUsageByThread: new Map([
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
    // metadata-only so hosted_ai_usage never persists raw member content.
    expect(JSON.stringify(drafts)).not.toContain('do the heavy part')
    expect(JSON.stringify(drafts)).not.toContain('prompt')
    expect(
      Object.keys(drafts[0]?.usage.rawUsageJson as Record<string, unknown>).sort(),
    ).toEqual([
      'codexSubagentThreadId',
      'tokenUsage',
      'tokenUsageEventCount',
    ])
  })

  it('skips spawned threads whose buffered events carry no usable token usage', () => {
    const drafts = extractCodexSubagentUsageDrafts({
      droppedThreadCount: 0,
      modelProvider: 'openai',
      ordinalStart: 1,
      parentRawEvents: [
        spawnEndEvent({
          receiverThreadIds: ['thread-child-empty'],
          model: 'gpt-5.5-mini',
        }),
      ],
      subagentTokenUsageByThread: new Map([
        [
          'thread-child-empty',
          {
            eventCount: 1,
            firstEvent: { method: 'thread/tokenUsage/updated', params: {} },
            lastEvent: { method: 'thread/tokenUsage/updated', params: {} },
          },
        ],
      ]),
    })

    expect(drafts).toEqual([])
  })
})
