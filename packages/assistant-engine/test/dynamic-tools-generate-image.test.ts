import { describe, expect, it } from 'vitest'

import {
  HOSTED_EXECUTION_ASSISTANT_IMAGE_PROMPT_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_IMAGE_QUALITIES,
  HOSTED_EXECUTION_ASSISTANT_IMAGE_REFERENCE_MAX_COUNT,
  HOSTED_EXECUTION_ASSISTANT_IMAGE_SIZES,
} from '@murphai/hosted-execution/contracts'

import {
  MURPH_GENERATE_IMAGE_TOOL,
  MURPH_GROUP_TOOL,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  MURPH_GENERATE_SONG_TOOL,
} from '../src/assistant-codex/dynamic-tools/generate-song.js'
import {
  MURPH_GENERATE_VOICE_MEMO_TOOL,
} from '../src/assistant-codex/dynamic-tools/generate-voice-memo.js'

describe('murph.generate_image dynamic tool schema', () => {
  it('requires a request, known preference, or owning flow for richer media', () => {
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'a known preference supports visual help',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'explicitly marks images welcome and privacy-safe',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'a known preference supports voice',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'explicitly asks for a voice memo and marks voice welcome and privacy-safe',
    )
    expect(MURPH_GENERATE_SONG_TOOL.description).toContain(
      'a known preference or the automation instructions mark music welcome and privacy-safe',
    )
  })

  it('routes only a trusted image-capacity denial to the existing funding skill', () => {
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'status="insufficient_image_capacity", reason="would_exhaust", and image_started=false',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'do not retry: read the hosted-low-usage skill',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'without claiming the whole plan is low or exhausted',
    )
    expect(MURPH_GROUP_TOOL.description).toContain(
      'when a trusted hosted murph.generate_image result has status="insufficient_image_capacity", reason="would_exhaust", and image_started=false',
    )
    expect(MURPH_GROUP_TOOL.description).toContain(
      'read usage even if the coarse result may be healthy',
    )
    expect(MURPH_GROUP_TOOL.description).toContain(
      'do not infer this exception from any other image result or error',
    )
  })

  it('describes hosted admission and completion without implying automatic work or delivery', () => {
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'status="admission_pending" means only that the request was registered',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'it is not queued, admitted, dispatched, or started',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'Do not claim the image is underway',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'do not call generate_image again for the same request in this turn',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'Nothing is attached or sent automatically',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'may attach the image with murph.attach_response_media, send any other reply, or finish without reply',
    )
  })

  it('uses the hosted image admission limits in its public schema', () => {
    expect(MURPH_GENERATE_IMAGE_TOOL.inputSchema.properties.prompt.maxLength).toBe(
      HOSTED_EXECUTION_ASSISTANT_IMAGE_PROMPT_MAX_CODE_POINTS,
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.inputSchema.properties.quality.enum).toEqual(
      [...HOSTED_EXECUTION_ASSISTANT_IMAGE_QUALITIES],
    )
    expect(
      MURPH_GENERATE_IMAGE_TOOL.inputSchema.properties.referenceImageRefs.maxItems,
    ).toBe(HOSTED_EXECUTION_ASSISTANT_IMAGE_REFERENCE_MAX_COUNT)
    expect(MURPH_GENERATE_IMAGE_TOOL.inputSchema.properties.size.enum).toEqual(
      [...HOSTED_EXECUTION_ASSISTANT_IMAGE_SIZES],
    )
    expect(MURPH_GROUP_TOOL.inputSchema.properties.prompt.maxLength).toBe(
      HOSTED_EXECUTION_ASSISTANT_IMAGE_PROMPT_MAX_CODE_POINTS,
    )
    expect(MURPH_GROUP_TOOL.inputSchema.properties.quality.enum).toEqual(
      [...HOSTED_EXECUTION_ASSISTANT_IMAGE_QUALITIES],
    )
    expect(MURPH_GROUP_TOOL.inputSchema.properties.referenceImageRefs.maxItems).toBe(
      HOSTED_EXECUTION_ASSISTANT_IMAGE_REFERENCE_MAX_COUNT,
    )
    expect(MURPH_GROUP_TOOL.inputSchema.properties.size.enum).toEqual(['1024x1024'])
  })

  it('enforces the image prompt limit by Unicode code points', () => {
    const atLimit = readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          prompt: '🟢'.repeat(
            HOSTED_EXECUTION_ASSISTANT_IMAGE_PROMPT_MAX_CODE_POINTS,
          ),
        },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })
    const overLimit = readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          prompt: '🟢'.repeat(
            HOSTED_EXECUTION_ASSISTANT_IMAGE_PROMPT_MAX_CODE_POINTS + 1,
          ),
        },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })

    expect(atLimit).toMatchObject({ kind: 'generate-image' })
    expect(overLimit).toMatchObject({
      kind: 'invalid-generate-image-arguments',
    })
  })

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
