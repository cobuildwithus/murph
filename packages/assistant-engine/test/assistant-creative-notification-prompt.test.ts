import { describe, expect, it } from 'vitest'

import {
  buildAssistantCreativeNotificationPromptWithCacheMetadata,
} from '../src/assistant/system-prompt.js'

describe('assistant creative notification prompt', () => {
  it('keeps message and poem formats tool-free while bounding song generation', () => {
    const prompt = buildAssistantCreativeNotificationPromptWithCacheMetadata({
      channel: 'telegram',
    }).prompt

    expect(prompt).toContain(
      'validated creative format: message, poem, or song',
    )
    expect(prompt).toContain(
      'For message or poem, do not call tools.',
    )
    expect(prompt).toContain(
      'Song format only: Call `murph.generate_song` exactly once.',
    )
    expect(prompt).toContain('`durationSeconds` to exactly 15')
    expect(prompt).toContain('at most four short lyric lines')
    expect(prompt).toContain(
      'never substitute text when generation fails',
    )
  })

  it('translates named song references into broad traits instead of imitation', () => {
    const prompt = buildAssistantCreativeNotificationPromptWithCacheMetadata({
      channel: 'linq',
    }).prompt

    expect(prompt).toContain('mood, tempo, instrumentation, and structure')
    expect(prompt).toContain('recognizable melody')
    expect(prompt).toContain('signature arrangement')
    expect(prompt).toContain(
      'Never imitate or name a real artist, band, song, or lyrics.',
    )
    expect(prompt).not.toContain('unless it is independently')
    expect(prompt).toContain(
      'For message or poem, `text` is the complete creative response.',
    )
  })
})
