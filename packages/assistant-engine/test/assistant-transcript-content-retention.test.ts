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
  return {
    schema: 'murph.assistant-transcript-entry.v1',
    text: 'some message text',
    ...overrides,
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

  it('treats the window boundary as not yet expired', () => {
    const boundary = new Date(
      NOW.getTime() - ASSISTANT_TRANSCRIPT_CONTENT_RETENTION_MS,
    ).toISOString()
    const result = redactExpiredAssistantTranscriptEntries(
      [entry({ kind: 'user', createdAt: boundary, text: 'exactly at the window' })],
      NOW,
    )

    expect(result.redactedCount).toBe(0)
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
