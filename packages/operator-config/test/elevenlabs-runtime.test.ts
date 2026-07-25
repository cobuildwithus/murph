import assert from 'node:assert/strict'

import { afterEach, expect, test, vi } from 'vitest'

import {
  ELEVENLABS_TTS_MAX_TEXT_LENGTH,
  ELEVENLABS_TTS_TIMEOUT_MS,
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
    assert.deepEqual(init.headers, {
      accept: 'audio/mpeg',
      'content-type': 'application/json',
      'xi-api-key': 'elevenlabs-key',
    })
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

test('elevenlabs runtime resolves env defaults and keeps HTTP failures secret-safe', async () => {
  expect(resolveElevenLabsApiKey({
    ELEVENLABS_API_KEY: ' key ',
  })).toBe('key')
  expect(resolveElevenLabsVoiceId({
    MURPH_ELEVENLABS_VOICE_ID: ' voice ',
  })).toBe('voice')
  expect(resolveElevenLabsModelId({})).toBe('eleven_multilingual_v2')

  await expect(
    generateElevenLabsSpeech({
      apiKey: 'elevenlabs-key',
      fetchImplementation: async () =>
        new Response('provider said private text failed', { status: 429 }),
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
