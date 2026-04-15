import { describe, expect, it } from 'vitest'

import { isParseableAttachment } from '../src/inbox-services/shared.ts'

describe('isParseableAttachment', () => {
  it('treats image attachments as parseable', () => {
    expect(
      isParseableAttachment({
        attachmentId: 'attachment-image',
        ordinal: 1,
        kind: 'image',
        parseState: null,
      } as never),
    ).toBe(true)
  })
})
