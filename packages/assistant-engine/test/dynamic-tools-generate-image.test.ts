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
    expect(MURPH_GENERATE_IMAGE_TOOL.description).not.toContain(
      'attach the generated image to the final response',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'if generation and upload finish while the invocation remains live',
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
    const launchedOperations = new Set<string>()
    const scopeStatuses = new Map<string, 'pending' | 'queued'>()
    let releaseUsage = (): void => undefined
    const usageHeld = new Promise<void>((resolve) => {
      releaseUsage = resolve
    })
    const recordDetachedUsage = vi.fn(async () => {
      await usageHeld
    })
    const hostedToolContext = {
      computerToolsAvailable: false,
      currentAssistantInputId: () => 'input_image_origin',
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      currentUserActionScope: () => ({
        acceptedInputIds: ['input_image_origin'],
        conversationId: 'conversation_1',
        conversationScope: 'direct',
        inboundMailboxItemIds: ['mailbox_1'],
        originSessionId: 'session_1',
        recipientKey: 'recipient_1',
      }),
      imageGenerationLauncher: {
        launch(input) {
          if (launchedOperations.has(input.operationId)) {
            return 'already-started' as const
          }
          if (input.scopeId && scopeStatuses.has(input.scopeId)) {
            return 'already-pending' as const
          }
          launchedOperations.add(input.operationId)
          if (input.scopeId) {
            scopeStatuses.set(input.scopeId, 'pending')
          }
          generation = input.run(
            new AbortController().signal,
            async (write) => await write(),
          )
          return 'started' as const
        },
        readStatus(scopeId) {
          return scopeStatuses.get(scopeId) ?? null
        },
      },
      recordDetachedUsage,
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
        text: expect.stringContaining('tell the user it is still generating'),
      }],
    })
    expect(result.rpcResult).toMatchObject({
      contentItems: [{
        text: expect.stringContaining('if it succeeds'),
      }],
    })
    expect(result.rpcResult).toMatchObject({
      contentItems: [{
        text: expect.stringContaining(
          'later user questions steered into this live turn',
        ),
      }],
    })
    expect(result.rpcResult).not.toMatchObject({
      contentItems: [{
        text: expect.stringContaining('will appear'),
      }],
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(uploader.uploadGeneratedImage).not.toHaveBeenCalled()

    const duplicate = await executeMurphDynamicToolRequest({
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
    expect(duplicate.rpcResult).toMatchObject({
      success: true,
      contentItems: [{
        text: expect.stringContaining(
          'this exact image operation was already accepted',
        ),
      }],
    })
    expect(fetchImpl).toHaveBeenCalledOnce()

    const sameConversationFollowup = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: 'test-key' },
      fetchImpl,
      hostedGeneratedImageUploader: uploader,
      hostedToolContext,
      nextUsageOrdinal: () => 2,
      progressDelivery: null,
      request: {
        args: {
          alt: null,
          outputFormat: 'webp',
          prompt: 'Restart the same sunrise.',
          quality: 'medium',
          referenceImageRefs: [],
          size: '1024x1024',
        },
        kind: 'generate-image',
        toolCallId: 'followup-tool-call',
      },
      requireHostedGeneratedImageUploader: true,
    })
    expect(sameConversationFollowup.rpcResult).toMatchObject({
      success: true,
      contentItems: [{
        text: expect.stringContaining('new image request was not started'),
      }],
    })
    expect(sameConversationFollowup.rpcResult).toMatchObject({
      contentItems: [{
        text: expect.stringContaining('do not imply the new request was queued'),
      }],
    })
    expect(fetchImpl).toHaveBeenCalledOnce()

    scopeStatuses.set('session_1', 'queued')
    const queuedExactDuplicate = await executeMurphDynamicToolRequest({
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
    expect(queuedExactDuplicate.rpcResult).toMatchObject({
      success: true,
      contentItems: [{
        text: expect.stringContaining(
          'do not infer its current state from another pending or queued image',
        ),
      }],
    })
    expect(queuedExactDuplicate.rpcResult).not.toMatchObject({
      contentItems: [{
        text: expect.stringContaining(
          'this exact image operation finished processing',
        ),
      }],
    })

    const queuedConversationFollowup = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: 'test-key' },
      fetchImpl,
      hostedGeneratedImageUploader: uploader,
      hostedToolContext,
      nextUsageOrdinal: () => 3,
      progressDelivery: null,
      request: {
        args: {
          alt: null,
          outputFormat: 'webp',
          prompt: 'Try the sunrise again.',
          quality: 'medium',
          referenceImageRefs: [],
          size: '1024x1024',
        },
        kind: 'generate-image',
        toolCallId: 'queued-followup-tool-call',
      },
      requireHostedGeneratedImageUploader: true,
    })
    expect(queuedConversationFollowup.rpcResult).toMatchObject({
      success: true,
      contentItems: [{
        text: expect.stringContaining('finished processing'),
      }],
    })
    expect(queuedConversationFollowup.rpcResult).toMatchObject({
      contentItems: [{
        text: expect.stringContaining(
          'if trusted turn context includes `Trusted hosted image completion',
        ),
      }],
    })
    expect(queuedConversationFollowup.rpcResult).not.toMatchObject({
      contentItems: [{
        text: expect.stringContaining('still in progress'),
      }],
    })
    expect(fetchImpl).toHaveBeenCalledOnce()

    releaseProvider()
    await expect(generation).resolves.toMatchObject({
      media: {
        url: 'https://imagedelivery.net/account/generated/public',
      },
    })
    expect(recordDetachedUsage).toHaveBeenCalledOnce()
    expect(recordDetachedUsage).toHaveBeenCalledWith(expect.objectContaining({
      operationId: expect.stringContaining('murph.dynamic-tool.generate-image'),
      originAssistantInputId: 'input_image_origin',
      usageDraft: expect.objectContaining({
        provider: 'openai-images',
      }),
    }))
    releaseUsage()
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
