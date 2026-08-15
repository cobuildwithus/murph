import assert from 'node:assert/strict'

import { expect, test, vi } from 'vitest'

import {
  ELEVENLABS_SCRIPT_TTS_MAX_TEXT_LENGTH,
  ELEVENLABS_SCRIPT_TTS_TIMEOUT_MS,
  ElevenLabsGenerationError,
  generateElevenLabsSpeechMp3,
} from './elevenlabs-speech-generation.mjs'

test('shared ElevenLabs helper uses the SDK request shape and returns MP3 bytes', async () => {
  const audioBytes = new Uint8Array([4, 5, 6])
  const fetchImplementation = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(
      url,
      'https://api.elevenlabs.io/v1/text-to-speech/voice_123?output_format=mp3_44100_64',
    )
    assert.equal(init?.method, 'POST')
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('accept'), 'audio/mpeg')
    assert.equal(headers.get('content-type'), 'application/json')
    assert.equal(headers.get('xi-api-key'), 'elevenlabs-key')
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model_id: 'eleven_v3',
      text: 'Preview text.',
    })
    return new Response(audioBytes, { status: 200 })
  })

  await expect(
    generateElevenLabsSpeechMp3({
      apiKey: 'elevenlabs-key',
      fetchImplementation,
      modelId: 'eleven_v3',
      text: 'Preview text.',
      voiceId: 'voice_123',
    }),
  ).resolves.toEqual(audioBytes)
  expect(fetchImplementation).toHaveBeenCalledOnce()
  expect(ELEVENLABS_SCRIPT_TTS_TIMEOUT_MS).toBe(90_000)
})

test('shared ElevenLabs helper disables SDK retries and bounds diagnostics', async () => {
  const fetchImplementation = vi.fn(async () =>
    new Response(
      JSON.stringify({
        detail: {
          code: 'generation_failed',
          message: 'x'.repeat(5_000),
          request_id: 'request_123',
        },
      }),
      { status: 503 },
    ))

  await expect(
    generateElevenLabsSpeechMp3({
      apiKey: 'elevenlabs-key',
      fetchImplementation,
      modelId: 'eleven_v3',
      text: 'Private preview text.',
      voiceId: 'voice_123',
    }),
  ).rejects.toSatisfy((error: unknown) => {
    if (!(error instanceof ElevenLabsGenerationError)) return false
    const diagnostics = error.diagnostics
    const serialized = JSON.stringify(diagnostics)
    return diagnostics.failureStage === 'http'
      && diagnostics.providerErrorCode === 'generation_failed'
      && diagnostics.providerErrorMessage?.length === 301
      && diagnostics.providerErrorMessage.endsWith('…')
      && diagnostics.providerRequestId === 'request_123'
      && diagnostics.retryable === true
      && !serialized.includes('elevenlabs-key')
      && !serialized.includes('Private preview text.')
  })
  expect(fetchImplementation).toHaveBeenCalledOnce()
})

test('shared ElevenLabs helper preserves the caller abort reason', async () => {
  const controller = new AbortController()
  const callerReason = new Error('generation cancelled')
  const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      throw init.signal.reason
    }
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason)
      }, { once: true })
    })
  })

  const generation = generateElevenLabsSpeechMp3({
    apiKey: 'elevenlabs-key',
    fetchImplementation,
    modelId: 'eleven_v3',
    signal: controller.signal,
    text: 'Preview text.',
    voiceId: 'voice_123',
  })
  controller.abort(callerReason)

  await expect(generation).rejects.toBe(callerReason)
  expect(fetchImplementation).toHaveBeenCalledOnce()
})

test('shared ElevenLabs helper rejects overlong text before provider I/O', async () => {
  const fetchImplementation = vi.fn()

  await expect(
    generateElevenLabsSpeechMp3({
      apiKey: 'elevenlabs-key',
      fetchImplementation,
      modelId: 'eleven_v3',
      text: 'a'.repeat(ELEVENLABS_SCRIPT_TTS_MAX_TEXT_LENGTH + 1),
      voiceId: 'voice_123',
    }),
  ).rejects.toSatisfy((error: unknown) =>
    error instanceof ElevenLabsGenerationError
    && error.diagnostics.failureStage === 'configuration'
  )
  expect(fetchImplementation).not.toHaveBeenCalled()
})
