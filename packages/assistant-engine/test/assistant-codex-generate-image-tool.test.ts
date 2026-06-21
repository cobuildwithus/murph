import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeGenerateImageTool,
} from '../src/assistant-codex/generate-image-tool.ts'
import {
  executeMurphDynamicToolRequest,
  listMurphDynamicToolNames,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'

const tempRoots: string[] = []
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
])

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

  it('uploads hosted images and returns normalized response media', async () => {
    const uploader = {
      uploadGeneratedImage: vi.fn(async (input) => {
        expect(input.alt).toBe('A product photo')
        expect(input.bytes).toEqual(webpBytes)
        expect(input.contentType).toBe('image/webp')
        expect(input.filename).toMatch(/^generated-[^.]+\.webp$/u)
        expect(input.metadata).toMatchObject({
          model: 'gpt-image-2',
          schema: 'murph.generated-image.v1',
        })
        expect(input.metadata.promptHash).toMatch(/^[A-Za-z0-9_-]{32}$/u)
        return {
          alt: input.alt,
          kind: 'image' as const,
          source: input.source,
          url: 'https://imagedelivery.net/account/image/public',
        }
      }),
    }
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
        usage: {
          input_tokens: 3,
          output_tokens: 5,
          total_tokens: 8,
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
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      hostedGeneratedImageUploader: uploader,
      providerRequestOrdinal: 4,
      requireHostedGeneratedImageUploader: true,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(uploader.uploadGeneratedImage).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      responseMedia: [
        {
          alt: 'A product photo',
          kind: 'image',
          source: 'gpt-image-2',
          url: 'https://imagedelivery.net/account/image/public',
        },
      ],
      rpcSuccess: true,
      rpcText: 'generated image attached to the final response',
    })
    expect(result.usageDraft?.providerRequestOrdinal).toBe(4)
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

    expect(result).toEqual({
      rpcSuccess: false,
      rpcText: 'image generation failed',
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

    expect(result).toEqual({
      rpcSuccess: false,
      rpcText: 'image generation failed',
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
    const uploader = {
      uploadGeneratedImage: vi.fn(),
    }
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
      hostedGeneratedImageUploader: uploader,
      providerRequestOrdinal: 6,
      requireHostedGeneratedImageUploader: true,
    })

    expect(uploader.uploadGeneratedImage).not.toHaveBeenCalled()
    expect(result.rpcSuccess).toBe(false)
    expect(result.rpcText).toBe('image generation returned invalid image data')
    expect(result.usageDraft?.providerRequestOrdinal).toBe(6)
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
  })

  it('fails before OpenAI when hosted upload is required but unavailable', async () => {
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
      requireHostedGeneratedImageUploader: true,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toEqual({
      rpcSuccess: false,
      rpcText: 'hosted image upload is not available for this turn',
    })
  })
})

describe('murph.generate_image dynamic tool execution', () => {
  it('advertises finish_without_reply', () => {
    expect(listMurphDynamicToolNames()).toContain('murph.finish_without_reply')
  })

  it('advertises and executes react_to_message as a reaction patch', async () => {
    expect(listMurphDynamicToolNames()).toContain('murph.react_to_message')
    expect(resolveMurphDynamicTools({
    }).map((tool) => `${tool.namespace}.${tool.name}`))
      .not.toContain('murph.react_to_message')
    expect(resolveMurphDynamicTools({
      allowMessageReactions: true,
    }).map((tool) => `${tool.namespace}.${tool.name}`))
      .toContain('murph.react_to_message')

    const request = readMurphDynamicToolRequest({
      id: 23,
      method: 'item/tool/call',
      params: {
        arguments: {
          reaction: 'thumbs_up',
        },
        namespace: 'murph',
        tool: 'react_to_message',
      },
    })

    expect(request).toEqual({
      kind: 'react-to-message',
      reaction: 'thumbs_up',
    })

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: vi.fn<typeof fetch>(),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: request!,
    })

    expect(result).toEqual({
      reactionPatch: {
        reaction: 'thumbs_up',
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
  })

  it('returns a value-free validation digest for invalid reaction arguments', () => {
    const request = readMurphDynamicToolRequest({
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
    const request = readMurphDynamicToolRequest({
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
    const request = readMurphDynamicToolRequest({
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
    const request = readMurphDynamicToolRequest({
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
    const uploader = {
      uploadGeneratedImage: vi.fn(async (input) => ({
        alt: input.alt,
        kind: 'image' as const,
        source: input.source,
        url: 'https://imagedelivery.net/account/image/public',
      })),
    }
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

    const request = readMurphDynamicToolRequest({
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
      hostedGeneratedImageUploader: uploader,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
      requireHostedGeneratedImageUploader: true,
    })

    expect(nextUsageOrdinal).toHaveBeenCalledOnce()
    expect(result.rpcResult).toEqual({
      success: true,
      contentItems: [
        {
          type: 'inputText',
          text: 'generated image attached to the final response',
        },
      ],
    })
    expect(result.responseMediaPatch).toEqual({
      media: [
        {
          alt: 'Generated bottle image',
          kind: 'image',
          source: 'gpt-image-2',
          url: 'https://imagedelivery.net/account/image/public',
        },
      ],
      op: 'append',
    })
    expect(result.usageDraft).toMatchObject({
      provider: 'openai-images',
      providerRequestOrdinal: 3,
      providerRequestOutcome: 'succeeded',
      usage: {
        providerName: 'OpenAI Images',
        providerRequestId: 'req_dynamic_image',
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
