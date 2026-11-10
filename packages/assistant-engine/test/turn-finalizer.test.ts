import { describe, expect, it } from 'vitest'

import {
  resolveAssistantProviderResumeStateAction,
  resolveAssistantResumeStateFromProviderTurn,
} from '../src/assistant/turn-finalizer.js'
import { advanceBookmarkOverOwnEntries, fingerprintTranscriptEntry, findEntriesAfterBookmark, readTranscriptBoundary } from '../src/assistant/transcript-bookmark.js'

describe('resolveAssistantProviderResumeStateAction', () => {
  it.each([
    {
      codexThreadId: 'accepted-session-thread',
      expected: 'persist-from-provider-turn',
      threadScope: 'session-thread',
    },
    {
      codexThreadId: null,
      expected: 'clear',
      threadScope: 'session-thread',
    },
    {
      codexThreadId: 'isolated-maintenance-thread',
      expected: 'preserve-existing',
      threadScope: 'isolated-thread',
    },
  ] as const)(
    'returns $expected for $threadScope with thread $codexThreadId',
    ({ codexThreadId, expected, threadScope }) => {
      expect(
        resolveAssistantProviderResumeStateAction({
          codexThreadId,
          threadScope,
        }),
      ).toBe(expected)
    },
  )
})

describe('resolveAssistantResumeStateFromProviderTurn', () => {
  it('records the route that produced the resumable provider session', () => {
    const codexThreadId = '00000000-0000-4000-8000-000000000123'
    const codexRolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${codexThreadId}.jsonl`
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        codexRolloutRelativePath,
        codexThreadId,
        routeFingerprint: 'route-new',
      }),
    ).toEqual({
      assistantContractFingerprint:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-new',
      threadId: codexThreadId,
    })
  })

  it('drops non-resumable turns instead of persisting route-only state', () => {
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        codexThreadId: null,
        routeFingerprint: 'route-new',
      }),
    ).toBeNull()
  })
})

describe('transcript bookmark', () => {
  const entry = (kind: 'user' | 'assistant' | 'status', text: string, createdAt = '2026-07-14T00:00:00.000Z') => ({
    schema: 'murph.assistant-transcript-entry.v1' as const,
    kind,
    text,
    createdAt,
  })

  it('finds a backdated import by file order and stops before foreign conversation entries', () => {
    const base = entry('user', 'Earlier message')
    const own = entry('assistant', 'My answer')
    const audit = entry('status', 'Tool audit')
    const foreign = entry('assistant', 'Imported reply', '2026-07-13T00:00:00.000Z')
    const laterOwn = entry('assistant', 'Later answer')
    const entries = [base, own, audit, foreign, laterOwn]
    const boundary = readTranscriptBoundary([base])
    expect(findEntriesAfterBookmark(entries, boundary)).toEqual([own, audit, foreign, laterOwn])
    expect(advanceBookmarkOverOwnEntries({ boundary, ownEntries: [own, laterOwn], entries }))
      .toEqual(fingerprintTranscriptEntry(audit))
    expect(findEntriesAfterBookmark(entries, fingerprintTranscriptEntry(entry('user', 'missing')))).toBeNull()
  })
})
