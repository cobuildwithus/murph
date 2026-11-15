import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'

import { assertGeneratedMp3Audio, inspectGeneratedMp3Audio, inspectMp3Frames } from '../src/generated-audio.ts'
import { generateElevenLabsSpeech } from '../src/elevenlabs-runtime.ts'
import { sendLinqVoiceMemo, uploadLinqAttachment } from '../src/linq-runtime.ts'

afterEach(() => vi.restoreAllMocks())

test('walks real-shaped headers, ID3 and variable padding without assuming 576-byte frames', () => {
  const frame = (padding: number) => { const b = Buffer.alloc(417 + padding); b.set([0xff, 0xfb, 0x90 | padding << 1, 0]); return b }
  const id3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0, 0])
  const tag = Buffer.alloc(128); tag.write('TAG')
  const bytes = Buffer.concat([id3, frame(0), frame(1), frame(0), tag])
  const stream = inspectMp3Frames(bytes)
  expect(stream.frames.map(f => f.byteOffset)).toEqual([12, 429, 847])
  expect(stream.frames[2]!.timeMs).toBeCloseTo(1152 * 2000 / 44100)
  expect(stream.endOffset).toBe(1264)
  const real = inspectMp3Frames(readFileSync(new URL('../../../fixtures/generated-audio/recap-synthetic-20s.mp3', import.meta.url)))
  expect(real.durationMs).toBeGreaterThan(20_000)
  expect(real.durationMs).toBeLessThan(20_500)
})

test('rejects malformed frames, truncated tags, mixed sample rates, layers and bitrate, and unknown trailing bytes', () => {
  const frame = Buffer.alloc(576); frame.set([0xff, 0xfb, 0xb4, 0])
  const mutate = (index: number, value: number) => { const b = Buffer.from(frame); b[index] = value; return Buffer.concat([frame, b]) }
  for (const bytes of [Buffer.alloc(0), frame.subarray(0, 575), Buffer.concat([frame, Buffer.from([0])]),
    mutate(1, 0xfd), mutate(2, 0xb0), mutate(2, 0xa4), mutate(2, 0xf4), mutate(0, 0),
    Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0x80, 0, 0, 0]), Buffer.from([0x49, 0x44, 0x33]),
    Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 127])]) expect(() => inspectMp3Frames(bytes)).toThrow()
})

test('derives bounded duration from playable samples and rejects a forged MP3 header', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../../../fixtures/generated-audio/music.mp3', import.meta.url)))
  const result = await inspectGeneratedMp3Audio(bytes)
  expect(result.durationMs).toBeGreaterThan(0)
  expect(result.durationMs).toBeLessThan(300_000)
  await expect(inspectGeneratedMp3Audio(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).rejects.toMatchObject({ code: 'ELEVENLABS_INVALID_AUDIO' })
})

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
