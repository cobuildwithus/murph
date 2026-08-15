import assert from 'node:assert/strict'

import { afterEach, expect, test, vi } from 'vitest'

import {
  ELEVENLABS_AUDIO_MAX_BYTES,
  ELEVENLABS_MUSIC_MODEL_ID,
  ELEVENLABS_MUSIC_OUTPUT_FORMAT,
  ELEVENLABS_TTS_MAX_TEXT_LENGTH,
  ELEVENLABS_TTS_TIMEOUT_MS,
  generateElevenLabsMusic,
  generateElevenLabsSpeech,
  resolveElevenLabsApiKey,
  resolveElevenLabsModelId,
  resolveElevenLabsVoiceId,
} from '../src/elevenlabs-runtime.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test('elevenlabs runtime posts text-to-speech requests and returns MP3 bytes', async () => {
  const audioBytes = new Uint8Array([1, 2, 3])
  const fetchImplementation = vi.fn(async (url: string, init) => {
    assert.equal(
      url,
      'https://api.elevenlabs.io/v1/text-to-speech/voice_123?output_format=mp3_44100_128',
    )
    assert.equal(init.method, 'POST')
    assert.equal(init.redirect, 'error')
    const headers = new Headers(init.headers)
    assert.equal(headers.get('accept'), 'audio/mpeg')
    assert.equal(headers.get('content-type'), 'application/json')
    assert.equal(headers.get('xi-api-key'), 'elevenlabs-key')
    assert.deepEqual(JSON.parse(String(init.body)), {
      model_id: 'eleven_multilingual_v2',
      text: 'Short memo.',
    })
    return new Response(audioBytes, {
      headers: {
        'content-type': 'audio/mpeg',
      },
      status: 200,
    })
  })

  await expect(
    generateElevenLabsSpeech({
      apiKey: ' elevenlabs-key ',
      fetchImplementation,
      modelId: ' eleven_multilingual_v2 ',
      text: ' Short memo. ',
      voiceId: ' voice_123 ',
    }),
  ).resolves.toEqual({
    bytes: audioBytes,
    contentType: 'audio/mpeg',
    filenameExtension: 'mp3',
  })
  expect(fetchImplementation).toHaveBeenCalledOnce()
})

test('elevenlabs runtime uses the SDK music operation with the exact request shape', async () => {
  const audioBytes = new Uint8Array([9, 8, 7])
  const fetchImplementation = vi.fn(async (url: string, init) => {
    assert.equal(
      url,
      'https://api.elevenlabs.io/v1/music?output_format=mp3_48000_192',
    )
    assert.equal(init.method, 'POST')
    const headers = new Headers(init.headers)
    assert.equal(headers.get('accept'), 'audio/mpeg')
    assert.equal(headers.get('content-type'), 'application/json')
    assert.equal(headers.get('xi-api-key'), 'elevenlabs-key')
    assert.deepEqual(JSON.parse(String(init.body)), {
      force_instrumental: true,
      model_id: 'music_v2',
      music_length_ms: 12_000,
      prompt: 'Warm instrumental transition.',
    })
    return new Response(audioBytes, { status: 200 })
  })

  await expect(
    generateElevenLabsMusic({
      apiKey: 'elevenlabs-key',
      durationMs: 12_000,
      fetchImplementation,
      forceInstrumental: true,
      modelId: ELEVENLABS_MUSIC_MODEL_ID,
      outputFormat: ELEVENLABS_MUSIC_OUTPUT_FORMAT,
      prompt: 'Warm instrumental transition.',
    }),
  ).resolves.toEqual({
    bytes: audioBytes,
    contentType: 'audio/mpeg',
    filenameExtension: 'mp3',
  })
  expect(fetchImplementation).toHaveBeenCalledOnce()
})

test('elevenlabs runtime leaves audio byte validation to callers', async () => {
  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation: async () =>
        new Response(new Uint8Array(), {
          headers: {
            'content-type': 'audio/mpeg',
          },
          status: 200,
        }),
      modelId: 'eleven_multilingual_v2',
      text: 'Short memo.',
      voiceId: 'voice_123',
    }),
  ).resolves.toEqual({
    bytes: new Uint8Array(),
    contentType: 'audio/mpeg',
    filenameExtension: 'mp3',
  })
})

test('elevenlabs runtime rejects and cancels audio with an oversized declared length', async () => {
  let canceled = false
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true
    },
  })

  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation: async () =>
        new Response(body, {
          headers: {
            'content-length': String(ELEVENLABS_AUDIO_MAX_BYTES + 1),
            'content-type': 'audio/mpeg',
          },
          status: 200,
        }),
      modelId: 'eleven_multilingual_v2',
      text: 'Short memo.',
      voiceId: 'voice_123',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.context?.failureStage === 'response_body' &&
    error.context?.maxResponseBytes === ELEVENLABS_AUDIO_MAX_BYTES &&
    error.context?.retryable === false
  )
  assert.equal(canceled, true)
})

test('elevenlabs runtime caps and cancels streamed audio without a declared length', async () => {
  let canceled = false
  let emittedFirstChunk = false
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true
    },
    pull(controller) {
      if (!emittedFirstChunk) {
        emittedFirstChunk = true
        controller.enqueue(new Uint8Array(ELEVENLABS_AUDIO_MAX_BYTES))
        return
      }
      controller.enqueue(new Uint8Array([1]))
    },
  })

  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation: async () =>
        new Response(body, {
          headers: { 'content-type': 'audio/mpeg' },
          status: 200,
        }),
      modelId: 'eleven_multilingual_v2',
      text: 'Short memo.',
      voiceId: 'voice_123',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.context?.failureStage === 'response_body'
  )
  assert.equal(canceled, true)
})

test('elevenlabs runtime resolves env defaults and keeps HTTP failures secret-safe', async () => {
  expect(resolveElevenLabsApiKey({
    ELEVENLABS_API_KEY: ' key ',
  })).toBe('key')
  expect(resolveElevenLabsVoiceId({
    MURPH_ELEVENLABS_VOICE_ID: ' voice ',
  })).toBe('voice')
  expect(resolveElevenLabsModelId({})).toBe('eleven_multilingual_v2')

  const fetchImplementation = vi.fn(async () =>
    new Response('provider said private text failed', { status: 429 }))

  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation,
      modelId: 'eleven_multilingual_v2',
      text: 'Private memo text.',
      voiceId: 'voice_123',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.code === 'ELEVENLABS_API_REQUEST_FAILED' &&
    error.context?.failureStage === 'http' &&
    error.context?.provider === 'elevenlabs' &&
    error.context?.responseBodyTextLength === 'provider said private text failed'.length &&
    error.context?.retryable === true &&
    !JSON.stringify(error.context).includes('Private memo text') &&
    !JSON.stringify(error.context).includes('elevenlabs-key')
  )
  expect(fetchImplementation).toHaveBeenCalledOnce()
})

test('elevenlabs runtime forwards echoed provider text but never the credential', async () => {
  // Deliberate narrowing of the secret-safe rule above: the provider's own
  // message is forwarded so the assistant can debug a rejection, which means
  // text the provider echoes back from the request can reach the error context
  // and the runtime log. The credential must still never appear, and the
  // forwarded message stays length-capped.
  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation: async () =>
        new Response(
          JSON.stringify({
            detail: {
              code: 'invalid_content',
              message: 'Text rejected: Private memo text.',
            },
          }),
          { status: 400 },
        ),
      modelId: 'eleven_v3',
      text: 'Private memo text.',
      voiceId: 'voice_123',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.context?.providerErrorCode === 'invalid_content' &&
    error.context?.providerErrorMessage ===
      'Text rejected: Private memo text.' &&
    !JSON.stringify(error.context).includes('elevenlabs-key')
  )
})

test('elevenlabs runtime does not wrap a caller abort', async () => {
  const controller = new AbortController()
  const fetchImplementation = vi.fn(async (_url: string, init) => {
    if (init.signal?.aborted) {
      throw init.signal.reason
    }
    return await new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason)
      }, { once: true })
    })
  })

  const generation = generateElevenLabsSpeech({
    apiKey: 'elevenlabs-key',
    fetchImplementation,
    modelId: 'eleven_multilingual_v2',
    signal: controller.signal,
    text: 'Short memo.',
    voiceId: 'voice_123',
  })
  controller.abort()

  await expect(generation).rejects.toSatisfy((error: unknown) =>
    error instanceof Error &&
    error.name === 'AbortError' &&
    !(error instanceof VaultCliError)
  )
  expect(fetchImplementation).toHaveBeenCalledOnce()
})

test('elevenlabs runtime keeps timeout active while consuming the response body', async () => {
  vi.useFakeTimers()
  const fetchImplementation = vi.fn(async (_url: string, init) => ({
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('body read aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }),
    ok: true,
    status: 200,
    text: async () => '',
  }))

  const result = expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation,
      modelId: 'eleven_multilingual_v2',
      text: 'Short memo.',
      voiceId: 'voice_123',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.code === 'ELEVENLABS_API_REQUEST_FAILED' &&
    error.context?.failureStage === 'transport' &&
    error.context?.timedOut === true
  )

  await vi.advanceTimersByTimeAsync(ELEVENLABS_TTS_TIMEOUT_MS)
  await result
})

test('elevenlabs speech timeout leaves headroom over the longest accepted memo', () => {
  // eleven_v3 synthesizes at roughly 25ms per character (measured 2026-07-25).
  // The pairing these constants replaced accepted 4000 characters against a 30s
  // timeout, so long memos could not physically succeed. Keep the timeout at no
  // less than double the longest accepted memo's expected synthesis time.
  const expectedSynthesisMs = ELEVENLABS_TTS_MAX_TEXT_LENGTH * 25
  assert.ok(
    ELEVENLABS_TTS_TIMEOUT_MS >= expectedSynthesisMs * 2,
    `timeout ${ELEVENLABS_TTS_TIMEOUT_MS}ms must cover ${expectedSynthesisMs}ms of synthesis with headroom`,
  )
})

test('elevenlabs runtime rejects speech text it cannot synthesize before the timeout', async () => {
  const fetchImplementation = vi.fn()

  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation,
      modelId: 'eleven_v3',
      text: 'a'.repeat(ELEVENLABS_TTS_MAX_TEXT_LENGTH + 1),
      voiceId: 'voice_123',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.code === 'ELEVENLABS_INVALID_INPUT'
  )
  assert.equal(fetchImplementation.mock.calls.length, 0)
})

test('elevenlabs runtime keeps the provider error code, request id, and message', async () => {
  const fetchImplementation = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(0),
    ok: false,
    status: 404,
    text: async () =>
      JSON.stringify({
        detail: {
          code: 'voice_not_found',
          message: "A voice with voice_id 'voice_probe' was not found.",
          request_id: 'c080176137ecfe',
          status: 'voice_not_found',
          type: 'not_found',
        },
      }),
  }))

  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation,
      modelId: 'eleven_v3',
      text: 'Short memo.',
      voiceId: 'voice_probe',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.context?.providerErrorCode === 'voice_not_found' &&
    error.context?.providerRequestId === 'c080176137ecfe' &&
    error.context?.providerErrorMessage ===
      "A voice with voice_id 'voice_probe' was not found."
  )
})

test('elevenlabs runtime caps an oversized provider error message', async () => {
  const fetchImplementation = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(0),
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({ detail: { message: 'x'.repeat(5_000) } }),
  }))

  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation,
      modelId: 'eleven_v3',
      text: 'Short memo.',
      voiceId: 'voice_probe',
    }),
  ).rejects.toSatisfy((error: unknown) => {
    if (!(error instanceof VaultCliError)) {
      return false
    }
    const message = error.context?.providerErrorMessage
    // Echoed provider text must never reach an assistant context unbounded.
    return typeof message === 'string' && message.length === 301 &&
      message.endsWith('…')
  })
})

test('elevenlabs runtime keeps HTTP classification when the error body cannot be read', async () => {
  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation: async () => ({
        arrayBuffer: async () => new ArrayBuffer(0),
        ok: false,
        status: 503,
        text: async () => {
          throw new Error('body unavailable')
        },
      }),
      modelId: 'eleven_v3',
      text: 'Short memo.',
      voiceId: 'voice_probe',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.context?.failureStage === 'http' &&
    error.context?.responseBodyTextLength === null &&
    error.context?.status === 503
  )
})

test('elevenlabs runtime cancels oversized error bodies and keeps HTTP classification', async () => {
  let canceled = false
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true
    },
  })

  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation: async () =>
        new Response(body, {
          headers: { 'content-length': '999999' },
          status: 413,
        }),
      modelId: 'eleven_v3',
      text: 'Short memo.',
      voiceId: 'voice_probe',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.context?.failureStage === 'http' &&
    error.context?.responseBodyTextLength === null &&
    error.context?.status === 413
  )
  assert.equal(canceled, true)
})

test('elevenlabs runtime tolerates a non-JSON error body', async () => {
  const fetchImplementation = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(0),
    ok: false,
    status: 502,
    text: async () => '<html>bad gateway</html>',
  }))

  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation,
      modelId: 'eleven_v3',
      text: 'Short memo.',
      voiceId: 'voice_probe',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof VaultCliError &&
    error.context?.providerErrorCode === null &&
    error.context?.providerErrorMessage === null &&
    error.context?.responseBodyTextLength === 24
  )
})
