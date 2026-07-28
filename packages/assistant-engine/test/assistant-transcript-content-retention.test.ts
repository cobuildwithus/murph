import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_TRANSCRIPT_CONTENT_RETENTION_MS,
  redactExpiredAssistantTranscriptEntries,
} from '../src/assistant/store/persistence.js'
import type { AssistantTranscriptEntry } from '@murphai/operator-config/assistant-cli-contracts'

const NOW = new Date('2026-07-25T00:00:00.000Z')

function entry(
  overrides: Partial<AssistantTranscriptEntry> & Pick<AssistantTranscriptEntry, 'kind' | 'createdAt'>,
): AssistantTranscriptEntry {
  const contentReceivedAt =
    overrides.contentReceivedAt
    ?? (overrides.kind === 'user' ? overrides.createdAt : undefined)
  return {
    schema: 'murph.assistant-transcript-entry.v1',
    text: 'some message text',
    ...overrides,
    ...(contentReceivedAt ? { contentReceivedAt } : {}),
  } as AssistantTranscriptEntry
}

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('assistant transcript content retention', () => {
  it('clears inbound text past the window and leaves recent text alone', () => {
    const result = redactExpiredAssistantTranscriptEntries(
      [
        entry({ kind: 'user', createdAt: isoDaysAgo(20), text: 'an old message body' }),
        entry({ kind: 'user', createdAt: isoDaysAgo(3), text: 'a recent message body' }),
      ],
      NOW,
    )

    expect(result.redactedCount).toBe(1)
    // The entry survives so the transcript still shows a message happened here.
    expect(result.entries[0]).toMatchObject({
      kind: 'user',
      text: '',
      textRetiredAt: NOW.toISOString(),
    })
    expect(result.entries[1]?.text).toBe('a recent message body')
    expect(result.entries[1]?.textRetiredAt).toBeUndefined()
  })

  it('leaves assistant output alone', () => {
    // The policy covers the member's inbound messages, not Murph's replies.
    const result = redactExpiredAssistantTranscriptEntries(
      [entry({ kind: 'assistant', createdAt: isoDaysAgo(90), text: 'an old reply' })],
      NOW,
    )

    expect(result.redactedCount).toBe(0)
    expect(result.entries[0]?.text).toBe('an old reply')
  })

  it('is idempotent so a transcript is not rewritten every checkpoint', () => {
    const first = redactExpiredAssistantTranscriptEntries(
      [entry({ kind: 'user', createdAt: isoDaysAgo(30), text: 'an old message body' })],
      NOW,
    )
    const second = redactExpiredAssistantTranscriptEntries(first.entries, NOW)

    expect(first.redactedCount).toBe(1)
    expect(second.redactedCount).toBe(0)
  })

  it('expires at the exact window boundary', () => {
    const boundary = new Date(
      NOW.getTime() - ASSISTANT_TRANSCRIPT_CONTENT_RETENTION_MS,
    ).toISOString()
    const result = redactExpiredAssistantTranscriptEntries(
      [entry({ kind: 'user', createdAt: boundary, text: 'exactly at the window' })],
      NOW,
    )

    expect(result.redactedCount).toBe(1)
    expect(result.entries[0]?.text).toBe('')
  })

  it('uses the original receipt when a message enters the transcript later', () => {
    const result = redactExpiredAssistantTranscriptEntries(
      [
        entry({
          kind: 'user',
          contentReceivedAt: isoDaysAgo(14),
          createdAt: isoDaysAgo(1),
          text: 'a delayed accepted message',
        }),
      ],
      NOW,
    )

    expect(result.redactedCount).toBe(1)
    expect(result.entries[0]?.text).toBe('')
  })

  it('preserves unstamped legacy text until the phase-two cutover', () => {
    const legacyEntry = {
      createdAt: isoDaysAgo(30),
      kind: 'user',
      schema: 'murph.assistant-transcript-entry.v1',
      text: 'legacy text without a retained receipt',
    } satisfies AssistantTranscriptEntry
    const result = redactExpiredAssistantTranscriptEntries(
      [legacyEntry],
      NOW,
    )

    expect(result).toEqual({
      entries: [legacyEntry],
      nextEligibleAt: null,
      redactedCount: 0,
    })
  })

  it('reports the earliest future content deadline', () => {
    const oldest = isoDaysAgo(13)
    const result = redactExpiredAssistantTranscriptEntries(
      [
        entry({ kind: 'user', createdAt: isoDaysAgo(3), text: 'newer' }),
        entry({ kind: 'user', createdAt: oldest, text: 'older' }),
      ],
      NOW,
    )

    expect(result.nextEligibleAt).toBe(
      new Date(
        Date.parse(oldest) + ASSISTANT_TRANSCRIPT_CONTENT_RETENTION_MS,
      ).toISOString(),
    )
  })

  it('ignores entries with unparseable timestamps rather than guessing', () => {
    const result = redactExpiredAssistantTranscriptEntries(
      [entry({ kind: 'user', createdAt: 'not-a-date', text: 'unknown age' })],
      NOW,
    )

    expect(result.redactedCount).toBe(0)
    expect(result.entries[0]?.text).toBe('unknown age')
  })
})
