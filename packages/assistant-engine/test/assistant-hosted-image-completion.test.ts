import { describe, expect, it } from 'vitest'

import {
  parseAssistantHostedImageCompletionOriginText,
  parseAssistantHostedImageCompletionText,
  renderAssistantHostedImageCompletionSystemText,
} from '../src/assistant/hosted-image-completion.js'

describe('hosted image completion', () => {
  it('binds the saved image to its originating accepted input', () => {
    const text = renderAssistantHostedImageCompletionSystemText({
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      originAssistantInputIdExact: true,
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
      originAssistantInputIdExact: true,
      sizeBytes: 123,
    })
    expect(parseAssistantHostedImageCompletionOriginText(text)).toEqual({
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      originAssistantInputIdExact: true,
      status: 'ready',
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

  it('treats legacy completions without exact authority as non-exact', () => {
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
        savedImageRef: 'raw/captures/generated.jpeg',
        status: 'ready',
      }),
      '</hosted_image_result>',
    ].join('')

    expect(parseAssistantHostedImageCompletionText(text)).toMatchObject({
      originAssistantInputIdExact: false,
    })
  })

  it('does not instruct downstream image actions after generation fails', () => {
    const text = renderAssistantHostedImageCompletionSystemText({
      originAssistantInputId: `ain_${'c'.repeat(32)}`,
      originAssistantInputIdExact: false,
      result: {
        media: null,
        runtimeIssue: {
          component: 'image-generation',
          issueKind: 'tool_error',
          phase: 'provider_turn',
          severity: 'error',
          summary: 'Provider request failed.',
        },
        savedImageRef: null,
      },
    })

    expect(text).toContain('Image generation failed and no saved image exists.')
    expect(text).toContain(
      'Do not call image-dependent downstream tools for this completion.',
    )
    expect(text).not.toContain('Continue the pending task with the exact saved image.')
    expect(parseAssistantHostedImageCompletionText(text)).toBeNull()
    expect(parseAssistantHostedImageCompletionOriginText(text)).toEqual({
      originAssistantInputId: `ain_${'c'.repeat(32)}`,
      originAssistantInputIdExact: false,
      status: 'failed',
    })
  })
})
