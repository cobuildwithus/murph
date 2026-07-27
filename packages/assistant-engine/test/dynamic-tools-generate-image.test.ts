import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import {
  MURPH_GENERATE_IMAGE_TOOL,
  MURPH_GROUP_TOOL,
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.js'
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

  it('returns immediately when the hosted runtime launches image generation', async () => {
    let releaseProvider = (): void => undefined
    const providerHeld = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    const fetchImpl = vi.fn(async () => {
      await providerHeld
      return new Response(JSON.stringify({
        data: [{
          b64_json: Buffer.from([
            0x52, 0x49, 0x46, 0x46,
            0x00, 0x00, 0x00, 0x00,
            0x57, 0x45, 0x42, 0x50,
          ]).toString('base64'),
        }],
      }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    })
    let generation: Promise<unknown> | null = null
    const hostedToolContext = {
      computerToolsAvailable: false,
      currentAssistantInputId: () => 'input_image_origin',
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      imageGenerationLauncher: {
        launch(input) {
          generation = input.run(new AbortController().signal)
          return 'started' as const
        },
      },
      sendVaultFile: async () => ({
        filename: 'unused',
        status: 'denied' as const,
      }),
      vaultFileSendAvailable: false,
    } satisfies AssistantHostedToolContext
    const uploader = {
      uploadGeneratedImage: vi.fn(async () => ({
        alt: 'Generated image',
        kind: 'image' as const,
        source: 'gpt-image-1',
        url: 'https://imagedelivery.net/account/generated/public',
      })),
    }

    const result = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: 'test-key' },
      fetchImpl,
      hostedGeneratedImageUploader: uploader,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        args: {
          alt: null,
          outputFormat: 'webp',
          prompt: 'Draw a calm sunrise.',
          quality: 'medium',
          referenceImageRefs: [],
          size: '1024x1024',
        },
        kind: 'generate-image',
      },
      requireHostedGeneratedImageUploader: true,
    })

    expect(result.rpcResult).toMatchObject({
      success: true,
      contentItems: [{
        text: expect.stringContaining('continue without waiting'),
      }],
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(uploader.uploadGeneratedImage).not.toHaveBeenCalled()

    releaseProvider()
    await expect(generation).resolves.toMatchObject({
      media: [{
        url: 'https://imagedelivery.net/account/generated/public',
      }],
      success: true,
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
