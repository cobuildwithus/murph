import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantResponseMediaList,
} from '../src/assistant/response-media.ts'

describe('assistant response media', () => {
  it('normalizes, dedupes, and preserves response media order without runtime state', () => {
    expect(normalizeAssistantResponseMediaList([
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/setup.png',
        alt: 'Dead bug setup',
        source: 'dead-bug-setup',
      },
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/setup.png',
        alt: 'Duplicate should collapse by URL',
        source: 'duplicate',
      },
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/finish.png',
        alt: null,
        source: null,
      },
      {
        kind: 'voice_memo',
        filename: 'memo-1.mp3',
        transport: {
          attachmentId: 'attachment_1',
          kind: 'linq_attachment',
        },
      },
      {
        kind: 'voice_memo',
        filename: 'memo-duplicate.mp3',
        transport: {
          attachmentId: 'attachment_1',
          kind: 'linq_attachment',
        },
      },
      {
        kind: 'voice_memo',
        filename: 'memo-2.mp3',
        transport: {
          attachmentId: 'attachment_2',
          kind: 'linq_attachment',
        },
      },
    ])).toEqual([
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/setup.png',
        alt: 'Dead bug setup',
        source: 'dead-bug-setup',
      },
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/finish.png',
        alt: null,
        source: null,
      },
      {
        kind: 'voice_memo',
        filename: 'memo-1.mp3',
        transcript: null,
        transport: {
          attachmentId: 'attachment_1',
          kind: 'linq_attachment',
        },
      },
      {
        kind: 'voice_memo',
        filename: 'memo-2.mp3',
        transcript: null,
        transport: {
          attachmentId: 'attachment_2',
          kind: 'linq_attachment',
        },
      },
    ])
  })
})
