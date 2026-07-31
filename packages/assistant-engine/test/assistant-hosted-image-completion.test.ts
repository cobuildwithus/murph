import { describe, expect, it } from 'vitest'

import {
  parseAssistantHostedImageCompletionText,
  renderAssistantHostedImageCompletionSystemText,
} from '../src/assistant/hosted-image-completion.js'

describe('hosted image completion', () => {
  it('binds the saved image to its originating accepted input', () => {
    const text = renderAssistantHostedImageCompletionSystemText({
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      result: {
        media: {
          alt: null,
          contentType: 'image/jpeg',
          filename: 'generated.jpeg',
          kind: 'vault_image',
          ref: 'raw/captures/generated.jpeg',
          sha256: 'b'.repeat(64),
          sizeBytes: 123,
          source: 'gpt-image-2',
        },
        runtimeIssue: null,
        savedImageRef: 'raw/captures/generated.jpeg',
      },
    })

    expect(parseAssistantHostedImageCompletionText(text)).toEqual({
      contentType: 'image/jpeg',
      imageRef: 'raw/captures/generated.jpeg',
      imageSha256: 'b'.repeat(64),
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      sizeBytes: 123,
    })
  })

  it('rejects a mismatched saved ref', () => {
    const text = [
      '<hosted_image_result>',
      JSON.stringify({
        media: [{
          contentType: 'image/jpeg',
          filename: 'generated.jpeg',
          kind: 'vault_image',
          ref: 'raw/captures/generated.jpeg',
          sha256: 'b'.repeat(64),
          sizeBytes: 123,
        }],
        originAssistantInputId: `ain_${'a'.repeat(32)}`,
        savedImageRef: 'raw/captures/other.jpeg',
        status: 'ready',
      }),
      '</hosted_image_result>',
    ].join('')

    expect(parseAssistantHostedImageCompletionText(text)).toBeNull()
  })
})
