import assert from 'node:assert/strict'

import { afterEach, expect, test, vi } from 'vitest'

import {
  generateElevenLabsSpeech,
  resolveElevenLabsApiKey,
  resolveElevenLabsModelId,
  resolveElevenLabsVoiceId,
} from '../src/elevenlabs-runtime.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

afterEach(() => {
  vi.restoreAllMocks()
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
