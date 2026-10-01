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
  buildCodexSubagentUsageDraft,
  type CodexSubagentTurnTokenUsageSample,
  extractCodexSubagentUsageDrafts,
  hashAssistantProviderStableJson,
} from '../src/assistant/providers/helpers.ts'

const SUBAGENT_TURN_STARTED_AT = '2026-07-23T11:59:00.000Z'

function tokenUsageEvent(input: {
  last: Record<string, number>
  threadId: string
  total: Record<string, number>
  turnId: string
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
      tokenUsage: {
        last: completeBreakdown(input.last),
        modelContextWindow: null,
        total: completeBreakdown(input.total),
      },
      turnId: input.turnId,
    },
  }
}

function sampleFromEvents(
  events: readonly Record<string, unknown>[],
  occurredAt = SUBAGENT_TURN_STARTED_AT,
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
    lastEvent: events.at(-1),
    occurredAt,
    providerRequestOutcome: 'succeeded',
    threadId,
    turnId,
  }
}

describe('Codex subagent usage drafts', () => {
  it('returns no drafts without child token samples', () => {
    expect(
      extractCodexSubagentUsageDrafts({
        modelProvider: 'openai',
        ordinalStart: 1,
        subagentTokenUsageByTurn: new Map(),
      }),
    ).toEqual([])
  })

  it('builds one content-free cumulative draft from strict child metadata', () => {
    const sample = sampleFromEvents([
      tokenUsageEvent({
        last: {
          cachedInputTokens: 10,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        threadId: 'thread-child',
        total: {
          cachedInputTokens: 10,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        turnId: 'turn-child',
      }),
      tokenUsageEvent({
        last: {
          cacheWriteInputTokens: 9,
          cachedInputTokens: 30,
          inputTokens: 80,
          outputTokens: 30,
          reasoningOutputTokens: 7,
          totalTokens: 110,
        },
        threadId: 'thread-child',
        total: {
          cacheWriteInputTokens: 9,
          cachedInputTokens: 40,
          inputTokens: 180,
          outputTokens: 50,
          reasoningOutputTokens: 7,
          totalTokens: 230,
        },
        turnId: 'turn-child',
      }),
    ])
    const draft = buildCodexSubagentUsageDraft({
      metadata: {
        model: 'gpt-5.6-sol',
        modelProvider: HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
        serviceTier: 'flex',
      },
      ordinal: 2,
      sample,
    })

    expect(draft).toMatchObject({
      occurredAt: SUBAGENT_TURN_STARTED_AT,
      provider: 'codex-cli',
      providerRequestOrdinal: 2,
      providerRequestOutcome: 'succeeded',
      usage: {
        cacheWriteTokens: 9,
        cachedInputTokens: 40,
        inputTokens: 180,
        outputTokens: 50,
        providerName: 'hosted-openai',
        providerRequestId: null,
        reasoningTokens: 7,
        requestedModel: 'gpt-5.6-sol',
        servedModel: 'gpt-5.6-sol',
        tokenPricingBasis: 'openai-flex',
        totalTokens: 230,
        usageExtractionSourcePath: 'subagent.turn.tokenUsage.total.delta',
      },
    })
    expect(draft?.usage.rawUsageJson).toEqual({
      cacheWriteInputTokens: 9,
      cachedInputTokens: 40,
      inputTokens: 180,
      outputTokens: 50,
      reasoningOutputTokens: 7,
      totalTokens: 230,
    })
    expect(draft?.usage.rawUsageJsonHash).toBe(
      hashAssistantProviderStableJson(draft?.usage.rawUsageJson),
    )
    expect(JSON.stringify(draft)).not.toContain('thread-child')

    if (!draft) {
      throw new Error('Expected a child usage draft.')
    }
    const turnId = 'turn-parent'
    const parsed = parseAssistantUsageRecord({
      ...draft.usage,
      attemptCount: 1,
      credentialSource: 'platform',
      occurredAt: draft.occurredAt,
      provider: draft.provider,
      providerRequestOrdinal: draft.providerRequestOrdinal,
      providerRequestOutcome: draft.providerRequestOutcome,
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: 'session-parent',
      turnId,
      usageId: createAssistantUsageId({
        attemptCount: 1,
        providerRequestOrdinal: draft.providerRequestOrdinal,
        turnId,
      }),
    })
    expect(parsed.providerRequestOrdinal).toBe(2)
    expect(parsed.rawUsageJson).toEqual(draft.usage.rawUsageJson)
  })

  it('uses the parent model only for non-hosted result aggregation', () => {
    const drafts = extractCodexSubagentUsageDrafts({
      modelProvider: 'openai',
      ordinalStart: 3,
      parentModel: 'gpt-5.6-terra',
      subagentTokenUsageByTurn: new Map([
        [
          'first',
          sampleFromEvents([
            tokenUsageEvent({
              last: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
              threadId: 'thread-first',
              total: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
              turnId: 'turn-first',
            }),
          ]),
        ],
        [
          'second',
          sampleFromEvents([
            tokenUsageEvent({
              last: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
              threadId: 'thread-second',
              total: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
              turnId: 'turn-second',
            }),
            tokenUsageEvent({
              last: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
              threadId: 'thread-second',
              total: { inputTokens: 200, outputTokens: 50, totalTokens: 250 },
              turnId: 'turn-second',
            }),
          ], '2026-07-23T12:00:00.000Z'),
        ],
      ]),
    })

    expect(drafts).toMatchObject([
      {
        providerRequestOrdinal: 3,
        usage: {
          inputTokens: 80,
          outputTokens: 20,
          requestedModel: 'gpt-5.6-terra',
          servedModel: 'gpt-5.6-terra',
          totalTokens: 100,
        },
      },
      {
        occurredAt: '2026-07-23T12:00:00.000Z',
        providerRequestOrdinal: 4,
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          requestedModel: 'gpt-5.6-terra',
          servedModel: 'gpt-5.6-terra',
          totalTokens: 150,
        },
      },
    ])
  })

  it('rejects malformed or mismatched cumulative notifications', () => {
    const malformed = sampleFromEvents([{
      method: 'thread/token_usage/updated',
      params: {
        threadId: 'thread-child',
        turnId: 'turn-child',
      },
    }])
    expect(buildCodexSubagentUsageDraft({
      metadata: {
        model: 'gpt-5.6-sol',
        modelProvider: 'openai',
        serviceTier: null,
      },
      ordinal: 1,
      sample: malformed,
    })).toBeNull()
  })
})
