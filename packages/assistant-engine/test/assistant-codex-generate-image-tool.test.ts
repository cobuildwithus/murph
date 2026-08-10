import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeVault } from '@murphai/core'

import {
  executeGenerateImageTool,
} from '../src/assistant-codex/generate-image-tool.ts'
import {
  executeMurphDynamicToolRequest,
  listMurphDynamicToolNames,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.ts'
import type {
  AssistantGeneratedImageCapturePersistence,
} from '../src/assistant/execution-context.ts'

const tempRoots: string[] = []
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
])
const persistGeneratedImageCapture: AssistantGeneratedImageCapturePersistence =
  async (write) => await write()
const generatedImageHostedToolContext = {
  persistGeneratedImageCapture,
} as AssistantHostedToolContext

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('executeGenerateImageTool', () => {
  it('generates an image locally without returning an absolute path', async () => {
    const codexHome = await createTempDir('assistant-image-tool-home-')
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe('https://api.openai.com/v1/images/generations')
      expect(init?.method).toBe('POST')
      expect(readHeader(init?.headers, 'authorization')).toBe('Bearer openai-test-key')
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'gpt-image-2',
        output_format: 'png',
        prompt: 'Make a clean product image.',
        quality: 'medium',
        size: '1024x1024',
      })

      return jsonResponse({
        data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }],
        usage: {
          input_tokens: 7,
          input_tokens_details: {
            cached_tokens: 2,
            image_tokens: 0,
            text_tokens: 7,
          },
          output_tokens: 11,
          output_tokens_details: {
            image_tokens: 11,
            reasoning_tokens: 0,
            text_tokens: 0,
          },
          total_tokens: 18,
        },
      }, {
        headers: {
          'x-request-id': 'req_image_local',
        },
      })
    })

    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Make a clean product image.',
        quality: 'medium',
        size: '1024x1024',
      },
      codexHome,
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 2,
    })

    expect(result.rpcSuccess).toBe(true)
    expect(result.rpcText).toMatch(
      /^generated image saved at CODEX_HOME\/generated_images\/generated-[^.]+\.png$/u,
    )
    expect(result.rpcText).not.toContain(codexHome)
    const files = await readdir(path.join(codexHome, 'generated_images'))
    expect(files).toHaveLength(1)
    await expect(readFile(path.join(codexHome, 'generated_images', files[0]!)))
      .resolves.toEqual(Buffer.from(pngBytes))
    expect(result.usageDraft).toMatchObject({
      provider: 'openai-images',
      providerRequestOrdinal: 2,
      providerRequestOutcome: 'succeeded',
      usage: {
        apiKeyEnv: 'OPENAI_API_KEY',
        cachedInputTokens: 2,
        inputTokens: 7,
        outputTokens: 11,
        providerName: 'OpenAI Images',
        providerRequestId: 'req_image_local',
        reasoningTokens: 0,
        requestedModel: 'gpt-image-2',
        totalTokens: 18,
      },
    })
  })

  it('emits hash-bound private vault media for hosted image delivery', async () => {
    const vaultRoot = await createTempDir('assistant-image-tool-vault-')
    await initializeVault({ vaultRoot })
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
        usage: {
          input_tokens: 3,
          output_tokens: 5,
          total_tokens: 8,
        },
      }))
    let retentionWakeAt: string | null = null
    const startedAt = Date.now()

    const result = await executeGenerateImageTool({
      args: {
        alt: 'A product photo',
        outputFormat: 'webp',
        prompt: 'Render the object.',
        quality: 'high',
        size: '1536x1024',
      },
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      persistGeneratedImageCapture: async (write, metadata) => {
        retentionWakeAt = metadata.retentionWakeAt
        return await write()
      },
      providerRequestOrdinal: 4,
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result.rpcSuccess).toBe(true)
    expect(result.rpcText).toMatch(
      /^generated image attached privately and saved to the vault as raw\/captures\/.+\.webp$/u,
    )
    expect(result.savedCaptureId).toMatch(/^evt_[A-Za-z0-9_-]+$/u)
    expect(result.savedImageRef).toMatch(/^raw\/captures\/.+\.webp$/u)
    expect(result.responseMedia).toEqual([
      {
        alt: 'A product photo',
        contentType: 'image/webp',
        filename: path.posix.basename(result.savedImageRef!),
        kind: 'vault_image',
        ref: result.savedImageRef,
        sha256: createHash('sha256').update(webpBytes).digest('hex'),
        sizeBytes: webpBytes.byteLength,
        source: 'gpt-image-2',
      },
    ])
    await expect(readFile(path.join(vaultRoot, result.savedImageRef!)))
      .resolves.toEqual(Buffer.from(webpBytes))
    const retentionWakeMs = Date.parse(retentionWakeAt ?? '')
    const retentionWindowMs = 14 * 24 * 60 * 60 * 1000
    expect(retentionWakeMs).toBeGreaterThanOrEqual(startedAt + retentionWindowMs)
    expect(retentionWakeMs).toBeLessThanOrEqual(Date.now() + retentionWindowMs)
    expect(result.usageDraft?.providerRequestOrdinal).toBe(4)
    expect(result.usageDraft?.providerRequestOutcome).toBe('succeeded')
    expect(result.usageDraft?.usage).toMatchObject({
      inputTokens: 3,
      outputTokens: 5,
      rawUsageJson: {
        input_tokens: 3,
        output_tokens: 5,
        total_tokens: 8,
      },
      totalTokens: 8,
    })
  })

  it('reuses the saved capture and private descriptor for the same operation key', async () => {
    const vaultRoot = await createTempDir('assistant-image-tool-retry-vault-')
    await initializeVault({ vaultRoot })
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
        usage: {
          input_tokens: 3,
          output_tokens: 5,
          total_tokens: 8,
        },
      }))

    const args = {
      alt: 'A retryable product photo',
      outputFormat: 'webp' as const,
      prompt: 'Render the retryable object.',
      quality: 'high' as const,
      size: '1536x1024' as const,
    }
    const first = await executeGenerateImageTool({
      args,
      captureIdempotencyKey: 'turn-1:tool-2',
      env: { OPENAI_API_KEY: 'openai-test-key' },
      fetchImpl,
      persistGeneratedImageCapture,
      providerRequestOrdinal: 4,
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })
    const second = await executeGenerateImageTool({
      args,
      captureIdempotencyKey: 'turn-1:tool-2',
      env: { OPENAI_API_KEY: 'openai-test-key' },
      fetchImpl,
      persistGeneratedImageCapture,
      providerRequestOrdinal: 5,
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(first.rpcSuccess).toBe(true)
    expect(second.rpcSuccess).toBe(true)
    expect(second.savedImageRef).toBe(first.savedImageRef)
    expect(second.responseMedia).toEqual(first.responseMedia)
    expect(second.usageDraft).toBeNull()
    await expect(readFile(path.join(vaultRoot, second.savedImageRef!)))
      .resolves.toEqual(Buffer.from(webpBytes))
  })

  it('keys dynamic generated-image retries by stable tool call id, not RPC request id', async () => {
    const vaultRoot = await createTempDir('assistant-image-tool-call-id-vault-')
    await initializeVault({ vaultRoot })

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
        usage: {
          input_tokens: 3,
          output_tokens: 5,
          total_tokens: 8,
        },
      }))
    const toolParams = {
      callId: 'call_stable_generated_image',
      namespace: 'murph',
      tool: 'generate_image',
      arguments: {
        alt: 'A retryable dynamic product photo',
        outputFormat: 'webp',
        prompt: 'Render the retryable dynamic object.',
        quality: 'high',
        size: '1536x1024',
      },
    }
    const firstRequest = readTestMurphDynamicToolRequest({
      id: 100,
      method: 'item/tool/call',
      params: toolParams,
    })
    const secondRequest = readTestMurphDynamicToolRequest({
      id: 101,
      method: 'item/tool/call',
      params: toolParams,
    })

    expect(firstRequest).toMatchObject({
      kind: 'generate-image',
      toolCallId: 'call_stable_generated_image',
    })
    if (
      !firstRequest ||
      !secondRequest ||
      firstRequest.kind !== 'generate-image' ||
      secondRequest.kind !== 'generate-image'
    ) {
      throw new Error('expected generate-image requests')
    }

    let usageOrdinal = 4
    const first = await executeMurphDynamicToolRequest({
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      hostedToolContext: generatedImageHostedToolContext,
      nextUsageOrdinal: () => usageOrdinal++,
      progressDelivery: null,
      request: firstRequest,
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })
    expect(first.rpcResult).toMatchObject({
      success: true,
      contentItems: [
        {
          type: 'inputText',
          text: expect.stringMatching(/^generated image attached privately/u),
        },
      ],
    })
    expect(fetchImpl).toHaveBeenCalledOnce()

    const second = await executeMurphDynamicToolRequest({
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      hostedToolContext: generatedImageHostedToolContext,
      nextUsageOrdinal: () => usageOrdinal++,
      progressDelivery: null,
      request: secondRequest,
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(second.rpcResult.success).toBe(true)
    expect(second.responseMediaPatch?.media).toEqual(first.responseMediaPatch?.media)
    expect(second.responseMediaPatch?.media).toEqual([
      expect.objectContaining({
        alt: 'A retryable dynamic product photo',
        contentType: 'image/webp',
        kind: 'vault_image',
        source: 'gpt-image-2',
      }),
    ])
    expect(second.usageDraft).toBeNull()
  })

  it('emits a succeeded usage draft when a successful image response omits usage', async () => {
    const codexHome = await createTempDir('assistant-image-tool-no-usage-')
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
      }, {
        headers: {
          'x-request-id': 'req_image_no_usage',
        },
      }))

    const result = await executeGenerateImageTool({
      args: {
        alt: 'A product photo',
        outputFormat: 'webp',
        prompt: 'Render the object.',
        quality: 'high',
        size: '1536x1024',
      },
      codexHome,
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 5,
    })

    expect(result.rpcSuccess).toBe(true)
    expect(result.usageDraft).toMatchObject({
      provider: 'openai-images',
      providerRequestOrdinal: 5,
      providerRequestOutcome: 'succeeded',
      usage: {
        inputTokens: null,
        outputTokens: null,
        providerName: 'OpenAI Images',
        providerRequestId: 'req_image_no_usage',
        rawUsageJson: null,
        rawUsageJsonHash: null,
        requestedModel: 'gpt-image-2',
        totalTokens: null,
      },
    })
  })

  it('returns a structured failure when the provider fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })

    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Render the object.',
        quality: 'medium',
        size: '1024x1024',
      },
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 1,
    })

    expect(result).toMatchObject({
      rpcSuccess: false,
      rpcText: expect.stringMatching(
        /^image generation failed: ASSISTANT_IMAGE_GENERATION_FAILED \(stage=transport, TypeError, \d+ms\)$/u,
      ),
    })
  })

  it('bounds and sanitizes the structured OpenAI error message', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        error: {
          code: 'invalid_prompt',
          internal_debug: 'private-body-field-must-not-appear',
          message: `  Actual\u0000 OpenAI detail ${'x'.repeat(400)}  `,
        },
      }, {
        headers: {
          'x-request-id': 'req_image_bounded',
        },
        status: 400,
      }))

    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Render the object.',
        quality: 'medium',
        size: '1024x1024',
      },
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 1,
    })

    expect(result.rpcSuccess).toBe(false)
    expect(result.rpcText).not.toContain('\u0000')
    expect(result.rpcText).not.toContain('private-body-field-must-not-appear')
    const providerMessage = result.rpcText?.split('): ')[1]
    expect(providerMessage).toMatch(/^Actual OpenAI detail x+…$/u)
    expect(Array.from(providerMessage ?? '')).toHaveLength(300)
  })

  it('does not expose an unstructured OpenAI error body', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('upstream body must-not-appear', {
        headers: {
          'openai-request-id': 'req_image_unstructured',
        },
        status: 502,
      }))

    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Render the object.',
        quality: 'medium',
        size: '1024x1024',
      },
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 1,
    })

    expect(result).toEqual({
      rpcSuccess: false,
      rpcText:
        'image generation failed: ASSISTANT_IMAGE_GENERATION_FAILED (http 502, request req_image_unstructured)',
    })
  })

  it('reports a deadline timeout as a tool failure instead of a turn abort', async () => {
    // AbortSignal.timeout rejects with a TimeoutError, which must stay
    // distinct from caller AbortError so a hung OpenAI request becomes a
    // recoverable tool failure rather than aborting the whole turn.
    const timeoutError = new Error('request timed out')
    timeoutError.name = 'TimeoutError'
    const fetchImpl = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal | null }) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      throw timeoutError
    })

    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Render the object.',
        quality: 'medium',
        size: '1024x1024',
      },
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 1,
    })

    expect(result).toMatchObject({
      rpcSuccess: false,
      rpcText: expect.stringMatching(
        /^image generation failed: ASSISTANT_IMAGE_GENERATION_FAILED \(stage=transport, timed out, TimeoutError, \d+ms\)$/u,
      ),
    })
  })

  it('rethrows provider aborts instead of reporting a tool failure', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const fetchImpl = vi.fn(async () => {
      throw abortError
    })

    await expect(executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Render the object.',
        quality: 'medium',
        size: '1024x1024',
      },
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 1,
    })).rejects.toBe(abortError)
  })

  it('reports invalid image bytes with usage instead of an upload failure', async () => {
    const vaultRoot = await createTempDir('assistant-image-tool-invalid-vault-')
    await initializeVault({ vaultRoot })
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: Buffer.from([0x00, 0x01, 0x02]).toString('base64') }],
        usage: {
          input_tokens: 3,
          output_tokens: 5,
          total_tokens: 8,
        },
      }))

    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Render the object.',
        quality: 'medium',
        size: '1024x1024',
      },
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      persistGeneratedImageCapture,
      providerRequestOrdinal: 6,
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })

    expect(result.rpcSuccess).toBe(false)
    expect(result.rpcText).toBe('image generation returned invalid image data')
    expect(result.usageDraft?.providerRequestOrdinal).toBe(6)
    expect(result.usageDraft?.providerRequestOutcome).toBe('partial')
  })

  it('hashes raw usage JSON on generated image usage drafts', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }],
        usage: {
          input_tokens: 3,
          output_tokens: 5,
          total_tokens: 8,
        },
      }))
    const codexHome = await createTempDir('assistant-image-tool-hash-')

    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Render the object.',
        quality: 'medium',
        size: '1024x1024',
      },
      codexHome,
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 1,
    })

    expect(result.usageDraft?.usage.rawUsageJson).toEqual({
      input_tokens: 3,
      output_tokens: 5,
      total_tokens: 8,
    })
    expect(result.usageDraft?.usage.rawUsageJsonHash).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(result.usageDraft?.providerRequestOutcome).toBe('succeeded')
    expect(result.usageDraft?.usage).toMatchObject({
      inputTokens: 3,
      outputTokens: 5,
      totalTokens: 8,
    })
  })

  it('fails before OpenAI when private hosted delivery has no owning vault', async () => {
    const fetchImpl = vi.fn()

    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'webp',
        prompt: 'Render the object.',
        quality: 'medium',
        size: '1024x1024',
      },
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 1,
      requireHostedPrivateImageDelivery: true,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toEqual({
      rpcSuccess: false,
      rpcText: 'hosted private image delivery requires the owning vault',
    })
  })

  it('fails before OpenAI when hosted capture persistence is unavailable', async () => {
    const fetchImpl = vi.fn()
    const vaultRoot = await createTempDir('assistant-image-tool-hosted-boundary-')
    await initializeVault({ vaultRoot })

    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'webp',
        prompt: 'Render the object.',
        quality: 'medium',
        size: '1024x1024',
      },
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      providerRequestOrdinal: 1,
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toEqual({
      rpcSuccess: false,
      rpcText:
        'hosted private image delivery requires generated capture persistence',
    })
  })
})

describe('murph.generate_image dynamic tool execution', () => {
  it('advertises finish_without_reply', () => {
    expect(listMurphDynamicToolNames()).toContain('murph.finish_without_reply')
  })

  it('can disable image generation for a delivery route without changing the default', () => {
    expect(resolveMurphDynamicTools({}).map((tool) => tool.name)).toContain(
      'generate_image',
    )
    expect(resolveMurphDynamicTools({
      imageGenerationAvailable: false,
    }).map((tool) => tool.name)).not.toContain('generate_image')
  })

  it('co-gates message-target tools and executes reactions through the authorizer', async () => {
    const messageRef = `ain_${'a'.repeat(32)}`
    expect(listMurphDynamicToolNames()).toContain('murph.react_to_message')
    expect(listMurphDynamicToolNames()).toContain('murph.select_reply_target')
    expect(resolveMurphDynamicTools({
    }).map((tool) => `${tool.namespace}.${tool.name}`))
      .not.toContain('murph.react_to_message')
    expect(resolveMurphDynamicTools({
      messageTargetingAvailable: true,
    }).map((tool) => `${tool.namespace}.${tool.name}`))
      .toEqual(expect.arrayContaining([
        'murph.react_to_message',
        'murph.select_reply_target',
      ]))

    const request = readTestMurphDynamicToolRequest({
      id: 23,
      method: 'item/tool/call',
      params: {
        arguments: {
          message_ref: messageRef,
          reaction: 'thumbs_up',
        },
        namespace: 'murph',
        tool: 'react_to_message',
      },
    })

    expect(request).toEqual({
      kind: 'react-to-message',
      messageRef,
      reaction: 'thumbs_up',
    })

    const authorizeAcceptedMessageTarget = vi.fn(async () => ({
      targetInputId: messageRef,
    }))
    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 2,
      env: {},
      fetchImpl: vi.fn<typeof fetch>(),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: request!,
    })

    expect(result).toEqual({
      reactionPatch: {
        reaction: 'thumbs_up',
        targetInputId: messageRef,
      },
      rpcResult: {
        success: true,
        contentItems: [
          {
            type: 'inputText',
            text: 'reaction queued',
          },
        ],
      },
    })
    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledWith({
      action: 'reaction',
      deliveryContextOrdinal: 2,
      messageRef,
    })
  })

  it('selects a reply target through the same authorizer', async () => {
    const messageRef = `ain_${'b'.repeat(32)}`
    const request = readTestMurphDynamicToolRequest({
      id: 25,
      method: 'item/tool/call',
      params: {
        arguments: {
          message_ref: messageRef,
        },
        namespace: 'murph',
        tool: 'select_reply_target',
      },
    })

    expect(request).toEqual({
      kind: 'select-reply-target',
      messageRef,
    })

    const authorizeAcceptedMessageTarget = vi.fn(async () => ({
      targetInputId: messageRef,
    }))
    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget,
      deliveryContextOrdinal: 3,
      env: {},
      fetchImpl: vi.fn<typeof fetch>(),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: request!,
    })

    expect(result).toEqual({
      replyTargetPatch: {
        targetInputId: messageRef,
      },
      rpcResult: {
        success: true,
        contentItems: [
          {
            type: 'inputText',
            text: 'selection recorded',
          },
        ],
      },
    })
    expect(authorizeAcceptedMessageTarget).toHaveBeenCalledWith({
      action: 'native-reply',
      deliveryContextOrdinal: 3,
      messageRef,
    })
  })

  it('does not disguise an unexpected target-authority failure as an unavailable ref', async () => {
    const messageRef = `ain_${'c'.repeat(32)}`
    const request = readTestMurphDynamicToolRequest({
      id: 26,
      method: 'item/tool/call',
      params: {
        arguments: { message_ref: messageRef },
        namespace: 'murph',
        tool: 'select_reply_target',
      },
    })
    const authorityFailure = new Error('target authority storage failed')

    await expect(executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget: async () => {
        throw authorityFailure
      },
      deliveryContextOrdinal: 3,
      env: {},
      fetchImpl: vi.fn<typeof fetch>(),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: request!,
    })).rejects.toBe(authorityFailure)
  })

  it('returns a value-free validation digest for invalid reaction arguments', () => {
    const request = readTestMurphDynamicToolRequest({
      id: 24,
      method: 'item/tool/call',
      params: {
        arguments: {
          reaction: 'private reaction value',
          note: 'private reaction note',
        },
        namespace: 'murph',
        tool: 'react_to_message',
      },
    })

    expect(request).toMatchObject({
      kind: 'invalid-reaction-arguments',
      validationDigest: {
        detailsSchema: 'murph.tool-call-validation-digest.v1',
        toolName: 'murph.react_to_message',
        schemaName: 'murph.react_to_message.input',
        rootType: 'object',
        rootKeysPresent: ['reaction'],
        rootKeyCount: 2,
        unsafeRootKeyCount: 1,
        invalidPaths: ['reaction'],
        unknownKeyCount: 1,
      },
    })
    if (!request || request.kind !== 'invalid-reaction-arguments') {
      throw new Error('expected invalid reaction arguments')
    }

    expect(request.validationDigest.validationFingerprint)
      .toMatch(/^tvd_[a-f0-9]{12}$/)
    const serialized = JSON.stringify(request.validationDigest)
    expect(serialized).not.toContain('private reaction value')
    expect(serialized).not.toContain('private reaction note')
  })

  it('executes finish_without_reply as a terminal no-op final action', async () => {
    const request = readTestMurphDynamicToolRequest({
      id: 21,
      method: 'item/tool/call',
      params: {
        arguments: {},
        namespace: 'murph',
        tool: 'finish_without_reply',
      },
    })

    expect(request).toEqual({
      kind: 'finish-without-reply',
    })

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: vi.fn<typeof fetch>(),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: request!,
    })

    expect(result).toEqual({
      finalActionPatch: {
        kind: 'none',
      },
      rpcResult: {
        success: true,
        contentItems: [
          {
            type: 'inputText',
            text: 'finished without reply',
          },
        ],
      },
    })
  })

  it('returns a value-free validation digest for invalid no-reply arguments', () => {
    const request = readTestMurphDynamicToolRequest({
      id: 22,
      method: 'item/tool/call',
      params: {
        arguments: {
          reason: 'private no-reply reason',
          note: 'private message content',
        },
        namespace: 'murph',
        tool: 'finish_without_reply',
      },
    })

    expect(request).toMatchObject({
      kind: 'invalid-finish-without-reply-arguments',
      validationDigest: {
        detailsSchema: 'murph.tool-call-validation-digest.v1',
        toolName: 'murph.finish_without_reply',
        schemaName: 'murph.finish_without_reply.input',
        rootType: 'object',
        rootKeyCount: 2,
        unknownKeyCount: 2,
      },
    })
    if (!request || request.kind !== 'invalid-finish-without-reply-arguments') {
      throw new Error('expected invalid no-reply arguments')
    }

    expect(request.validationDigest.validationFingerprint)
      .toMatch(/^tvd_[a-f0-9]{12}$/)
    const serialized = JSON.stringify(request.validationDigest)
    expect(serialized).not.toContain('private no-reply reason')
    expect(serialized).not.toContain('private message content')
  })

  it('returns a value-free validation digest for invalid image arguments', () => {
    const request = readTestMurphDynamicToolRequest({
      id: 10,
      method: 'item/tool/call',
      params: {
        arguments: {
          prompt: 12,
          promptText: 'Render a private product label.',
          imageUrl: 'https://private.example.test/image.png',
          AG1: 'unsafe key value',
        },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })

    expect(request).toMatchObject({
      kind: 'invalid-generate-image-arguments',
      validationDigest: {
        detailsSchema: 'murph.tool-call-validation-digest.v1',
        toolName: 'murph.generate_image',
        schemaName: 'murph.generate_image.input',
        rootType: 'object',
        rootKeysPresent: ['prompt'],
        rootKeyCount: 4,
        unsafeRootKeyCount: 3,
        invalidPaths: ['prompt'],
        unknownKeyCount: 3,
      },
    })
    if (!request || request.kind !== 'invalid-generate-image-arguments') {
      throw new Error('expected invalid generate image arguments')
    }

    expect(request.validationDigest.validationFingerprint).toMatch(/^tvd_[a-f0-9]{12}$/)
    expect(request.validationDigest.pathIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'prompt',
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
      }),
      expect.objectContaining({
        path: 'root',
        code: 'unrecognized_key',
        received: 'keys.count_1_10',
      }),
    ]))
    const serialized = JSON.stringify(request.validationDigest)
    expect(serialized).not.toContain('promptText')
    expect(serialized).not.toContain('imageUrl')
    expect(serialized).not.toContain('Render a private product label.')
    expect(serialized).not.toContain('https://private.example.test/image.png')
    expect(serialized).not.toContain('AG1')
    expect(serialized).not.toContain('unsafe key value')
  })

  it('parses a Codex dynamic tool call and appends hosted media with image usage', async () => {
    const vaultRoot = await createTempDir('assistant-image-tool-dynamic-vault-')
    await initializeVault({ vaultRoot })
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
        usage: {
          input_tokens: 12,
          output_tokens: 34,
          total_tokens: 46,
        },
      }, {
        headers: {
          'x-request-id': 'req_dynamic_image',
        },
      }))

    const request = readTestMurphDynamicToolRequest({
      id: 10,
      method: 'item/tool/call',
      params: {
        arguments: {
          alt: 'Generated bottle image',
          prompt: 'Render a clean supplement bottle.',
        },
        namespace: 'murph',
        tool: 'generate_image',
      },
    })

    expect(request).toMatchObject({
      args: {
        alt: 'Generated bottle image',
        outputFormat: 'webp',
        prompt: 'Render a clean supplement bottle.',
        quality: 'medium',
        size: '1024x1024',
      },
      kind: 'generate-image',
    })

    const nextUsageOrdinal = vi.fn(() => 3)
    const result = await executeMurphDynamicToolRequest({
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      hostedToolContext: generatedImageHostedToolContext,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
      requireHostedPrivateImageDelivery: true,
      vaultRoot,
    })

    expect(nextUsageOrdinal).toHaveBeenCalledOnce()
    expect(result.rpcResult).toEqual({
      success: true,
      contentItems: [
        {
          type: 'inputText',
          text: expect.stringMatching(
            /^generated image attached privately and saved to the vault as raw\/captures\/.+\.webp$/u,
          ),
        },
      ],
    })
    const savedImageRef = result.rpcResult.contentItems[0]?.type === 'inputText'
      ? result.rpcResult.contentItems[0].text.match(/raw\/captures\/.+\.webp/u)?.[0]
      : null
    expect(savedImageRef).toBeTruthy()
    await expect(readFile(path.join(vaultRoot, savedImageRef!)))
      .resolves.toEqual(Buffer.from(webpBytes))
    expect(result.responseMediaPatch).toEqual({
      media: [
        {
          alt: 'Generated bottle image',
          contentType: 'image/webp',
          filename: path.posix.basename(savedImageRef!),
          kind: 'vault_image',
          ref: savedImageRef,
          sha256: createHash('sha256').update(webpBytes).digest('hex'),
          sizeBytes: webpBytes.byteLength,
          source: 'gpt-image-2',
        },
      ],
      op: 'append',
    })
    expect(result.usageDraft).toMatchObject({
      provider: 'openai-images',
      providerRequestOrdinal: 3,
      providerRequestOutcome: 'succeeded',
      usage: {
        inputTokens: 12,
        outputTokens: 34,
        providerName: 'OpenAI Images',
        providerRequestId: 'req_dynamic_image',
        rawUsageJson: {
          input_tokens: 12,
          output_tokens: 34,
          total_tokens: 46,
        },
        requestedModel: 'gpt-image-2',
        totalTokens: 46,
      },
    })
  })

})

async function createTempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    status: init.status ?? 200,
  })
}

function readHeader(
  headers: RequestInit['headers'],
  key: string,
): string | null {
  return new Headers(headers).get(key)
}
