import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'

import {
  generateOpenAiImage,
  OPENAI_IMAGE_GENERATION_MODEL,
  OPENAI_IMAGE_GENERATION_TIMEOUT_MS,
} from '../src/assistant-codex/openai-image-generation.js'

const RESPONSE_IMAGE_BYTES = new Uint8Array([0x01, 0x02, 0x03])

function openAiImageResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          b64_json: Buffer.from(RESPONSE_IMAGE_BYTES).toString('base64'),
        },
      ],
      usage: {
        input_tokens: 10,
        input_tokens_details: {
          image_tokens: 7,
          text_tokens: 3,
        },
        output_tokens: 5,
        total_tokens: 15,
      },
    }),
    {
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_image_123',
      },
      status: 200,
    },
  )
}

describe('generateOpenAiImage', () => {
  it('keeps the image request timeout above two minutes', () => {
    expect(OPENAI_IMAGE_GENERATION_TIMEOUT_MS).toBe(240_000)
  })

  it('uses the generations endpoint with JSON when no references are present', async () => {
    const beforeRequest = Date.now()
    let capturedUrl: string | null = null
    let capturedInit: RequestInit | undefined
    let requestCount = 0
    const fetchImpl: typeof fetch = async (url, init) => {
      requestCount += 1
      capturedUrl = String(url)
      capturedInit = init
      return openAiImageResponse()
    }

    const result = await generateOpenAiImage({
      apiKey: 'test-key',
      fetchImpl,
      outputCompression: 40,
      outputFormat: 'webp',
      prompt: 'Draw a clean icon.',
      quality: 'medium',
      size: '1024x1024',
    })
    const afterRequest = Date.now()

    expect(requestCount).toBe(1)
    expect(capturedUrl).toBe('https://api.openai.com/v1/images/generations')
    expect(capturedInit?.method).toBe('POST')
    const requestHeaders = new Headers(capturedInit?.headers)
    expect(requestHeaders.get('authorization')).toBe('Bearer test-key')
    expect(requestHeaders.get('content-type')).toBe('application/json')
    expect(requestHeaders.get('x-stainless-retry-count')).toBe('0')
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: OPENAI_IMAGE_GENERATION_MODEL,
      output_compression: 40,
      output_format: 'webp',
      prompt: 'Draw a clean icon.',
      quality: 'medium',
      size: '1024x1024',
    })
    expect(result.providerRequestId).toBe('req_image_123')
    expect(Date.parse(result.occurredAt)).toBeGreaterThanOrEqual(beforeRequest)
    expect(Date.parse(result.occurredAt)).toBeLessThanOrEqual(afterRequest)
    expect([...result.imageBytes]).toEqual([...RESPONSE_IMAGE_BYTES])
  })

  it('uses the edits endpoint with multipart references when references are present', async () => {
    let capturedUrl: string | null = null
    let capturedInit: RequestInit | undefined
    let requestCount = 0
    const fetchImpl: typeof fetch = async (url, init) => {
      requestCount += 1
      capturedUrl = String(url)
      capturedInit = init
      return openAiImageResponse()
    }

    await generateOpenAiImage({
      apiKey: 'test-key',
      fetchImpl,
      outputCompression: 55,
      outputFormat: 'jpeg',
      prompt: 'Use image 1 as the product reference.',
      quality: 'high',
      referenceImages: [
        {
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          filename: 'reference-image-1.png',
          mediaType: 'image/png',
        },
      ],
      size: '1024x1536',
    })

    expect(requestCount).toBe(1)
    expect(capturedUrl).toBe('https://api.openai.com/v1/images/edits')
    expect(capturedInit?.method).toBe('POST')
    const requestHeaders = new Headers(capturedInit?.headers)
    expect(requestHeaders.get('authorization')).toBe('Bearer test-key')
    expect(requestHeaders.get('content-type')).toBeNull()
    expect(requestHeaders.get('x-stainless-retry-count')).toBe('0')
    expect(capturedInit?.body).toBeInstanceOf(FormData)

    const form = capturedInit?.body as FormData
    expect(form.get('model')).toBe(OPENAI_IMAGE_GENERATION_MODEL)
    expect(form.get('prompt')).toBe('Use image 1 as the product reference.')
    expect(form.get('quality')).toBe('high')
    expect(form.get('size')).toBe('1024x1536')
    expect(form.get('output_format')).toBe('jpeg')
    expect(form.get('output_compression')).toBe('55')
    expect(form.getAll('image[]')).toHaveLength(1)
    expect((form.getAll('image[]')[0] as { name?: string }).name).toBe(
      'reference-image-1.png',
    )
  })

  it('does not retry provider rate limits and keeps bounded error metadata', async () => {
    let requestCount = 0
    const fetchImpl: typeof fetch = async () => {
      requestCount += 1
      return new Response(
        JSON.stringify({
          error: {
            code: 'rate_limit_exceeded',
            message: 'Rate limit reached for this request.',
            type: 'rate_limit_error',
          },
        }),
        {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req_image_rate_limit',
          },
          status: 429,
        },
      )
    }

    await expect(
      generateOpenAiImage({
        apiKey: 'test-key',
        fetchImpl,
        outputFormat: 'png',
        prompt: 'Draw a clean icon.',
        quality: 'medium',
        size: '1024x1024',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_IMAGE_GENERATION_FAILED',
      context: {
        failureStage: 'http',
        operation: 'generation',
        provider: 'openai-images',
        providerErrorCode: 'rate_limit_exceeded',
        providerErrorMessage: 'Rate limit reached for this request.',
        providerRequestId: 'req_image_rate_limit',
        retryable: true,
        status: 429,
      },
    })
    expect(requestCount).toBe(1)
  })

  it('times out a hung SDK image request after one attempt', async () => {
    vi.useFakeTimers()
    try {
      let requestCount = 0
      let markRequestStarted!: (signal: AbortSignal) => void
      const requestStarted = new Promise<AbortSignal>((resolve) => {
        markRequestStarted = resolve
      })
      const fetchImpl: typeof fetch = async (_url, init) => {
        requestCount += 1
        const requestSignal = init?.signal
        if (!requestSignal) {
          throw new Error('OpenAI SDK request signal is missing.')
        }
        markRequestStarted(requestSignal)
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal.addEventListener('abort', () => {
            reject(requestSignal.reason ?? new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        })
      }

      const generation = generateOpenAiImage({
        apiKey: 'test-key',
        fetchImpl,
        outputFormat: 'png',
        prompt: 'Draw a clean icon.',
        quality: 'medium',
        size: '1024x1024',
      })
      const requestSignal = await requestStarted
      const rejection = expect(generation).rejects.toMatchObject({
        code: 'ASSISTANT_IMAGE_GENERATION_FAILED',
        context: {
          failureStage: 'transport',
          operation: 'generation',
          provider: 'openai-images',
          retryable: true,
          timedOut: true,
          timeoutMs: OPENAI_IMAGE_GENERATION_TIMEOUT_MS,
          transportErrorName: 'TimeoutError',
        },
      })

      await vi.advanceTimersByTimeAsync(OPENAI_IMAGE_GENERATION_TIMEOUT_MS)
      await rejection
      expect(requestCount).toBe(1)
      expect(requestSignal.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the SDK image request from a real caller AbortController', async () => {
    const abortController = new AbortController()
    let requestCount = 0
    let markRequestStarted!: (signal: AbortSignal) => void
    const requestStarted = new Promise<AbortSignal>((resolve) => {
      markRequestStarted = resolve
    })
    const fetchImpl: typeof fetch = async (_url, init) => {
      requestCount += 1
      const requestSignal = init?.signal
      if (!requestSignal) {
        throw new Error('OpenAI SDK request signal is missing.')
      }
      markRequestStarted(requestSignal)
      return await new Promise<Response>((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => {
          reject(requestSignal.reason ?? new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    }

    const generation = generateOpenAiImage({
      abortSignal: abortController.signal,
      apiKey: 'test-key',
      fetchImpl,
      outputFormat: 'png',
      prompt: 'Draw a clean icon.',
      quality: 'medium',
      size: '1024x1024',
    })

    const requestSignal = await requestStarted
    abortController.abort()

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestCount).toBe(1)
    expect(requestSignal.aborted).toBe(true)
  })
})
