import { describe, expect, it } from 'vitest'

import {
  MURPH_GENERATE_IMAGE_TOOL,
  MURPH_GROUP_TOOL,
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

  it('accepts up to sixteen ordered reference image refs', () => {
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

  it('accepts the canonical Murph character sheet skill asset ref', () => {
    const request = readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          prompt: 'Draw Murph using image 1 as the character sheet.',
          referenceImageRefs: ['skill-assets/murph-character-sheet-v1.png'],
        },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })

    expect(request).toMatchObject({
      args: {
        referenceImageRefs: ['skill-assets/murph-character-sheet-v1.png'],
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

  it('describes the canonical Murph character sheet skill asset reference', () => {
    const generateImageReferenceDescription =
      MURPH_GENERATE_IMAGE_TOOL.inputSchema.properties.referenceImageRefs.description
    const groupReferenceDescription =
      MURPH_GROUP_TOOL.inputSchema.properties.referenceImageRefs.description

    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'skill-assets/murph-character-sheet-v1.png',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      "Murph's canonical character sheet",
    )
    expect(generateImageReferenceDescription).toContain(
      'skill-assets/murph-character-sheet-v1.png',
    )
    expect(generateImageReferenceDescription).toContain(
      'whenever Murph itself appears',
    )
    expect(groupReferenceDescription).toContain(
      'skill-assets/murph-character-sheet-v1.png',
    )
    expect(groupReferenceDescription).toContain(
      'generated avatar',
    )
  })
})
