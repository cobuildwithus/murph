import { describe, expect, it } from 'vitest'

import {
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'

describe('murph.generate_image dynamic tool schema', () => {
  it('keeps the minimal legacy prompt-only call valid', () => {
    const request = readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          prompt: 'Draw a simple image.',
        },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })

    expect(request).toMatchObject({
      args: {
        alt: null,
        outputFormat: 'webp',
        prompt: 'Draw a simple image.',
        quality: 'medium',
        referenceImageRefs: [],
        size: '1024x1024',
      },
      kind: 'generate-image',
    })
  })

  it('accepts up to four ordered reference image refs', () => {
    const request = readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          prompt: 'Use image 1 as the subject and image 2 as the style.',
          referenceImageRefs: [
            'raw/inbox/subject.png',
            'raw/inbox/style.jpg',
          ],
        },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })

    expect(request).toMatchObject({
      args: {
        referenceImageRefs: [
          'raw/inbox/subject.png',
          'raw/inbox/style.jpg',
        ],
      },
      kind: 'generate-image',
    })
  })

  it('rejects more than sixteen reference image refs', () => {
    const request = readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          prompt: 'Too many refs.',
          referenceImageRefs: Array.from(
            { length: 17 },
            (_value, index) => `raw/inbox/${index + 1}.png`,
          ),
        },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })

    expect(request).toMatchObject({
      kind: 'invalid-generate-image-arguments',
    })
  })
})
