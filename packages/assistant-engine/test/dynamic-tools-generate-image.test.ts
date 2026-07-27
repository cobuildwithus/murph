import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MURPH_ATTACH_RESPONSE_MEDIA_TOOL,
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

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ))
})

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
      'private media is provided in a later trusted system input',
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
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-private-image-launch-'))
    tempRoots.push(vaultRoot)
    await initializeVault({
      createdAt: '2026-07-27T12:00:00.000Z',
      vaultRoot,
    })
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
    const recordDetachedUsage = vi.fn()
    const hostedToolContext = {
      computerToolsAvailable: false,
      currentAssistantInputId: () => 'input_image_origin',
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      imageGenerationLauncher: {
        launch(input) {
          if (launchedOperations.has(input.operationId)) {
            return 'already-started' as const
          }
          launchedOperations.add(input.operationId)
          generation = input.run(
            new AbortController().signal,
            async (write) => await write(),
          )
          return 'started' as const
        },
      },
      recordDetachedUsage,
      sendVaultFile: async () => ({
        filename: 'unused',
        status: 'denied' as const,
      }),
      vaultFileSendAvailable: false,
    } satisfies AssistantHostedToolContext

    const result = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: 'test-key' },
      fetchImpl,
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
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })

    expect(result.rpcResult).toMatchObject({
      success: true,
      contentItems: [{
        text: expect.stringContaining('continue without waiting'),
      }],
    })
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledOnce()
    })

    const duplicate = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: 'test-key' },
      fetchImpl,
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
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })
    expect(duplicate.rpcResult).toMatchObject({
      success: true,
      contentItems: [{
        text: 'image generation was already started for this operation',
      }],
    })
    expect(fetchImpl).toHaveBeenCalledOnce()

    releaseProvider()
    await expect(generation).resolves.toMatchObject({
      media: {
        contentType: 'image/webp',
        kind: 'vault_image',
        ref: expect.stringMatching(/^raw\/captures\/.+\.webp$/u),
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

  it('describes the canonical Murph character sheet for generated messages and avatars', () => {
    const generateImageReferenceDescription =
      MURPH_GENERATE_IMAGE_TOOL.inputSchema.properties.referenceImageRefs.description

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
    expect(MURPH_GROUP_TOOL.inputSchema.properties.referenceImageRefs.description)
      .toContain('skill-assets/murph-character-sheet-v1.png')
    expect(MURPH_GROUP_TOOL.inputSchema.properties.action.enum).toContain(
      'set_chat_avatar',
    )
  })

  it('accepts an exact private vault image descriptor from a trusted command', () => {
    const media = {
      alt: 'Private progress',
      contentType: 'image/png',
      filename: 'progress.png',
      kind: 'vault_image',
      ref: 'raw/captures/progress.png',
      sha256: 'a'.repeat(64),
      sizeBytes: 1234,
      source: 'murph.experiment-progress-card',
    }
    expect(readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: { media: [media] },
        namespace: 'murph',
        tool: MURPH_ATTACH_RESPONSE_MEDIA_TOOL.name,
      },
    })).toEqual({
      kind: 'attach-response-media',
      media: [media],
    })
  })
})
