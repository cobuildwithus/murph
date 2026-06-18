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
        url: null,
        mimeType: 'audio/mpeg',
        filename: 'memo-1.mp3',
        sizeBytes: 128,
        transcript: 'First memo',
        source: 'elevenlabs',
        voiceId: 'voice_1',
        modelId: 'eleven_multilingual_v2',
        transportRefs: {
          linq: {
            attachmentId: 'attachment_1',
          },
        },
      },
      {
        kind: 'voice_memo',
        url: null,
        mimeType: 'audio/mpeg',
        filename: 'memo-duplicate.mp3',
        sizeBytes: 128,
        transcript: 'Duplicate memo',
        source: 'elevenlabs',
        voiceId: 'voice_1',
        modelId: 'eleven_multilingual_v2',
        transportRefs: {
          linq: {
            attachmentId: 'attachment_1',
          },
        },
      },
      {
        kind: 'voice_memo',
        url: null,
        mimeType: 'audio/mpeg',
        filename: 'memo-2.mp3',
        sizeBytes: 256,
        transcript: 'Second memo',
        source: 'elevenlabs',
        voiceId: 'voice_1',
        modelId: 'eleven_multilingual_v2',
        transportRefs: {
          linq: {
            attachmentId: 'attachment_2',
          },
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
        url: null,
        mimeType: 'audio/mpeg',
        filename: 'memo-1.mp3',
        sizeBytes: 128,
        transcript: 'First memo',
        source: 'elevenlabs',
        voiceId: 'voice_1',
        modelId: 'eleven_multilingual_v2',
        transportRefs: {
          linq: {
            attachmentId: 'attachment_1',
          },
        },
      },
      {
        kind: 'voice_memo',
        url: null,
        mimeType: 'audio/mpeg',
        filename: 'memo-2.mp3',
        sizeBytes: 256,
        transcript: 'Second memo',
        source: 'elevenlabs',
        voiceId: 'voice_1',
        modelId: 'eleven_multilingual_v2',
        transportRefs: {
          linq: {
            attachmentId: 'attachment_2',
          },
        },
      },
    ])
  })
})
