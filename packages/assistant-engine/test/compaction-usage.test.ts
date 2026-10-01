import { describe, expect, it } from 'vitest'
import { readCodexCompactionResponseUsage } from '../src/assistant-codex/compaction-usage.ts'

const usage = { inputTokens: 100, cachedInputTokens: 60, cacheWriteInputTokens: 20,
  outputTokens: 30, reasoningOutputTokens: 5, totalTokens: 130 }
const params = { threadId: 'thread_fixture', turnId: 'turn_compact', responseId: 'response_fixture', usage }
const identity = { threadId: params.threadId, turnId: params.turnId }
const read = (value: unknown) => readCodexCompactionResponseUsage(value, identity)

describe('compaction usage evidence', () => {
  it('preserves exact buckets and excludes provider content', () => {
    expect(read({ method: 'rawResponse/completed', params: { ...params, content: 'synthetic-private-content' } }))
      .toEqual({ ...usage, responseId: params.responseId })
  })
  it.each([
    { ...params, threadId: 'child_fixture' }, { ...params, turnId: 'old_turn' },
    { ...params, responseId: '' }, { ...params, responseId: 'x'.repeat(513) },
    { ...params, usage: { ...usage, totalTokens: 131 } },
    { ...params, usage: { ...usage, cachedInputTokens: 81 } },
    { ...params, usage: { ...usage, reasoningOutputTokens: 31 } },
    { ...params, usage: { ...usage, inputTokens: 100.5 } },
    { ...params, usage: null },
  ])('rejects stale, foreign, or malformed evidence %#', (invalid) => {
    expect(read({ method: 'rawResponse/completed', params: invalid })).toBeNull()
  })
  it('requires active compaction turn and exact event method', () => {
    expect(read({ method: 'rawResponseItem/completed', params })).toBeNull()
    expect(readCodexCompactionResponseUsage({ method: 'rawResponse/completed', params }, { ...identity, turnId: null })).toBeNull()
  })
})
