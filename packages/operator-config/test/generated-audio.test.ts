import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'

import { assertGeneratedMp3Audio } from '../src/generated-audio.ts'
import { generateElevenLabsSpeech } from '../src/elevenlabs-runtime.ts'
import { sendLinqVoiceMemo, uploadLinqAttachment } from '../src/linq-runtime.ts'

afterEach(() => vi.restoreAllMocks())

test.each(['speech', 'music', 'stream'])('accepts the encoded %s fixture without changing its bytes', async (name) => {
  const bytes = new Uint8Array(readFileSync(new URL(`../../../fixtures/generated-audio/${name}.mp3`, import.meta.url)))
  const original = bytes.slice()
  await expect(assertGeneratedMp3Audio(bytes)).resolves.toBeUndefined()
  expect(bytes).toEqual(original)
})

test('validation yields to cancellation while processing larger audio', async () => {
  const frameStream = readFileSync(new URL('../../../fixtures/generated-audio/stream.mp3', import.meta.url)).subarray(45)
  const bytes = new Uint8Array(Buffer.concat(Array.from({ length: 40 }, () => frameStream)))
  const controller = new AbortController()
  const validation = assertGeneratedMp3Audio(bytes, controller.signal)
  setImmediate(() => controller.abort())
  await expect(validation).rejects.toMatchObject({ name: 'AbortError' })
  // A failed validation must not poison the next independent decoder.
  await expect(assertGeneratedMp3Audio(frameStream)).resolves.toBeUndefined()
})

test.each([0, 250, null, undefined, -1, '250'])(
  'retains safe Linq duration metadata (%s) without replaying an accepted send',
  async (duration) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let sends = 0
    const result = await sendLinqVoiceMemo({ attachmentId: 'synthetic-attachment', chatId: 'synthetic-chat' }, {
      env: { LINQ_API_TOKEN: 'synthetic-token' },
      fetchImplementation: async () => {
        sends += 1
        return Response.json({ voice_memo: {
          id: 'synthetic-message',
          voice_memo: { duration_ms: duration },
        } }, { status: 202 })
      },
    })
    expect(sends).toBe(1)
    expect(result.providerMessageId).toBe('synthetic-message')
    expect(result.voiceMemoDurationMs).toBe(typeof duration === 'number' && duration >= 0 ? duration : null)
    expect(warning).toHaveBeenCalledTimes(duration === 0 ? 1 : 0)
    if (duration === 0) {
      expect(warning).toHaveBeenCalledWith('Linq accepted a voice memo with zero duration.', {
        provider: 'linq', operation: 'send_voice_memo', durationMs: 0,
      })
    }
  },
)

test('invalid generated audio never reaches Linq attachment reservation or upload', async () => {
  const deliveryFetch = vi.fn()
  const generationFetch = vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x64])))
  const generateAndUpload = async () => {
    const audio = await generateElevenLabsSpeech({
      apiKey: 'synthetic-key', modelId: 'eleven_v3', text: 'Synthetic memo.', voiceId: 'synthetic-voice',
      fetchImplementation: generationFetch,
    })
    return uploadLinqAttachment({ bytes: audio.bytes, contentType: audio.contentType, filename: 'synthetic.mp3' }, {
      env: { LINQ_API_TOKEN: 'synthetic-key' }, fetchImplementation: deliveryFetch,
    })
  }
  await expect(generateAndUpload()).rejects.toMatchObject({ code: 'ELEVENLABS_INVALID_AUDIO' })
  expect(generationFetch).toHaveBeenCalledTimes(1)
  expect(deliveryFetch).not.toHaveBeenCalled()
})
