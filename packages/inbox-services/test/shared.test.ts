import { describe, expect, it } from 'vitest'

import { isParseableAttachment } from '../src/inbox-services/shared.ts'

describe('isParseableAttachment', () => {
  it('treats only audio and video attachments as parseable', () => {
    expect(
      isParseableAttachment({
        attachmentId: 'attachment-audio',
        ordinal: 1,
        kind: 'audio',
        parseState: null,
      } as never),
    ).toBe(true)
    expect(
      isParseableAttachment({
        attachmentId: 'attachment-video',
        ordinal: 2,
        kind: 'video',
        parseState: null,
      } as never),
    ).toBe(true)
    expect(
      isParseableAttachment({
        attachmentId: 'attachment-image',
        ordinal: 3,
        kind: 'image',
        parseState: null,
      } as never),
    ).toBe(false)
    expect(
      isParseableAttachment({
        attachmentId: 'attachment-document',
        ordinal: 4,
        kind: 'document',
        parseState: null,
      } as never),
    ).toBe(false)
  })
})
