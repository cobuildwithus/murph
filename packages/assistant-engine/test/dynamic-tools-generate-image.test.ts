import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
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
  readMurphDynamicToolRequest as readExactMurphDynamicToolRequest,
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
      'Hosted accepted-message turns start generation in the background',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'Exact scheduled automation occurrences remain synchronous and attach private media to the same final response',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'that image consumes one of the same 8 final-response media slots, so leave a slot before calling',
    )
    expect(MURPH_GENERATE_IMAGE_TOOL.description).toContain(
      'Local runs stay synchronous with the same slot rule',
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
        text: expect.stringContaining(
          'should come back here in a separate message when it is ready',
        ),
      }],
    })
    expect(result.rpcResult).toMatchObject({
      contentItems: [{
        text: expect.stringContaining('usually takes about a minute'),
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
        text: expect.stringContaining('if it succeeds'),
      }],
    })
    expect(result.rpcResult).not.toMatchObject({
      contentItems: [{
        text: expect.stringContaining('do not guarantee success'),
      }],
    })
    expect(result.rpcResult).not.toMatchObject({
      contentItems: [{
        text: expect.stringContaining('will send it here'),
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
        text: expect.stringContaining(
          'this exact image operation was already accepted',
        ),
      }],
    })
    expect(fetchImpl).toHaveBeenCalledOnce()

    const sameConversationFollowup = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: 'test-key' },
      fetchImpl,
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
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
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
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
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
      failureDiagnostic: null,
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
        occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
        provider: 'openai-images',
      }),
    }))
    releaseUsage()
  })

  it('binds an irreversible continuation to its exact accepted group input', async () => {
    const exactInputId = `ain_${'a'.repeat(32)}`
    const batchTailInputId = `ain_${'b'.repeat(32)}`
    const launch = vi.fn<
      NonNullable<AssistantHostedToolContext['imageGenerationLauncher']>['launch']
    >(() => 'started')
    const hostedToolContext = {
      computerToolsAvailable: false,
      currentAssistantInputId: () => batchTailInputId,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      currentUserActionScope: () => ({
        acceptedInputIds: [exactInputId, batchTailInputId],
        conversationId: 'conversation_1',
        conversationScope: 'group' as const,
        inboundMailboxItemIds: ['mailbox_1', 'mailbox_2'],
        originSessionId: 'session_1',
        recipientKey: 'recipient_1',
      }),
      imageGenerationLauncher: { launch },
      sendVaultFile: async () => ({
        filename: 'unused',
        status: 'denied' as const,
      }),
      vaultFileSendAvailable: false,
    } satisfies AssistantHostedToolContext
    const authorizeAcceptedMessageTarget = vi.fn(async () => ({
      participant: {
        assistantInputId: exactInputId,
        senderHandle: 'participant_1',
        source: 'linq' as const,
      },
      targetInputId: exactInputId,
    }))
    const request = {
      args: {
        alt: null,
        outputFormat: 'jpeg' as const,
        prompt: 'Create a physical note page.',
        quality: 'high' as const,
        referenceImageRefs: [],
        size: '1024x1536' as const,
      },
      kind: 'generate-image' as const,
      messageRef: exactInputId,
    }

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
    })

    expect(result.rpcResult).toMatchObject({ success: true })
    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledWith({
      action: 'participant-effect',
      deliveryContextOrdinal: 0,
      messageRef: exactInputId,
    })
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      originAssistantInputId: exactInputId,
      originAssistantInputIdExact: true,
    }))

    const denied = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget: async () => null,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 2,
      progressDelivery: null,
      request,
    })
    expect(denied.rpcResult).toMatchObject({ success: false })
    expect(launch).toHaveBeenCalledOnce()
  })

  it('keeps provider diagnostics in the hosted image result', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-image-failure-'))
    tempRoots.push(vaultRoot)
    await initializeVault({ vaultRoot })
    let generation: Promise<unknown> | null = null
    const hostedToolContext = {
      computerToolsAvailable: false,
      currentAssistantInputId: () => 'input_image_failure_origin',
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      currentUserActionScope: () => ({
        acceptedInputIds: ['input_image_failure_origin'],
        conversationId: 'conversation_failure',
        conversationScope: 'direct',
        inboundMailboxItemIds: ['mailbox_failure'],
        originSessionId: 'session_failure',
        recipientKey: 'recipient_failure',
      }),
      imageGenerationLauncher: {
        launch(input) {
          generation = input.run(
            new AbortController().signal,
            async (write) => await write(),
          )
          return 'started' as const
        },
      },
      recordDetachedUsage: vi.fn(),
      sendVaultFile: async () => ({
        filename: 'unused',
        status: 'denied' as const,
      }),
      vaultFileSendAvailable: false,
    } satisfies AssistantHostedToolContext

    const result = await executeMurphDynamicToolRequest({
      env: { OPENAI_API_KEY: 'test-key' },
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: 'invalid_prompt',
          message: 'The image prompt was rejected.',
          type: 'invalid_request_error',
        },
      }), {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_image_failed',
        },
        status: 400,
      }),
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        args: {
          alt: null,
          outputFormat: 'webp',
          prompt: 'Draw an invalid image.',
          quality: 'medium',
          referenceImageRefs: [],
          size: '1024x1024',
        },
        kind: 'generate-image',
      },
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })

    expect(result.rpcResult.success).toBe(true)
    await expect(generation).resolves.toEqual({
      failureDiagnostic:
        'image generation failed: ASSISTANT_IMAGE_GENERATION_FAILED (http 400, invalid_prompt, request req_image_failed): The image prompt was rejected.',
      media: null,
      runtimeIssue: null,
      savedImageRef: null,
    })
  })

  it('keeps the minimal canonical prompt-only arguments valid', () => {
    const request = readTestMurphDynamicToolRequest({
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

  it('rejects a tool request without the pinned protocol identity fields', () => {
    expect(readExactMurphDynamicToolRequest({
      id: 'request-missing-identity',
      method: 'item/tool/call',
      params: {
        arguments: { prompt: 'Draw a simple image.' },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })).toBeNull()
  })

  it('parses an exact effect-authorizing message outside provider arguments', () => {
    const messageRef = `ain_${'c'.repeat(32)}`
    expect(readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          message_ref: messageRef,
          prompt: 'Create a note page.',
        },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })).toMatchObject({
      args: {
        prompt: 'Create a note page.',
      },
      kind: 'generate-image',
      messageRef,
    })
  })

  it('accepts up to sixteen ordered reference image refs', () => {
    const request = readTestMurphDynamicToolRequest({
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
    const request = readTestMurphDynamicToolRequest({
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
    const request = readTestMurphDynamicToolRequest({
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
    expect(MURPH_GROUP_TOOL.inputSchema.allOf[0].properties.referenceImageRefs.description)
      .toContain('skill-assets/murph-character-sheet-v1.png')
    expect(MURPH_GROUP_TOOL.inputSchema.allOf[0].properties.action.enum).toContain(
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
    expect(readTestMurphDynamicToolRequest({
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

  it('publishes and enforces the eight-image authored response limit', () => {
    expect(MURPH_ATTACH_RESPONSE_MEDIA_TOOL.inputSchema.properties.media.maxItems).toBe(8)
    const media = Array.from({ length: 9 }, (_, index) => ({
      alt: `Frame ${index + 1}`,
      kind: 'image',
      source: `exercise_catalog:movement:${index + 1}`,
      url: `https://cdn.example.test/exercises/frame-${index + 1}.png`,
    }))

    expect(readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: { media },
        namespace: 'murph',
        tool: MURPH_ATTACH_RESPONSE_MEDIA_TOOL.name,
      },
    })).toMatchObject({
      kind: 'invalid-response-media-arguments',
    })
  })
})
