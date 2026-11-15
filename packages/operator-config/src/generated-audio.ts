import { setImmediate } from 'node:timers/promises'

import { VaultCliError } from './vault-cli-errors.ts'

export type Mp3FrameBoundary = { timeMs: number; byteOffset: number }

/** Walk every header of a constant-bitrate Layer III stream. Padding may vary.
 * Times come from sample counts; no decode, re-encode or guessed frame size. */
export function inspectMp3Frames(bytes: Uint8Array): { frames: Mp3FrameBoundary[]; durationMs: number; endOffset: number } {
  let offset = id3v2End(bytes)
  while (offset + 4 <= bytes.length && !(bytes[offset] === 0xff && (bytes[offset + 1]! & 0xe0) === 0xe0)) offset++
  const first = mp3Header(bytes, offset)
  const frames: Mp3FrameBoundary[] = []
  while (offset < bytes.length) {
    if (bytes.length - offset === 128 && tagAt(bytes, offset, 'TAG')) break
    const header = mp3Header(bytes, offset)
    if (header.sampleRate !== first.sampleRate || header.version !== first.version || header.bitrate !== first.bitrate) throw invalidAudio()
    frames.push({ timeMs: frames.length * first.samples * 1000 / first.sampleRate, byteOffset: offset })
    offset += header.length
  }
  if (!frames.length) throw invalidAudio()
  return { frames, durationMs: frames.length * first.samples * 1000 / first.sampleRate, endOffset: offset }
}

function tagAt(bytes: Uint8Array, offset: number, tag: string): boolean {
  return [...tag].every((char, i) => bytes[offset + i] === char.charCodeAt(0))
}

function id3v2End(bytes: Uint8Array): number {
  if (!tagAt(bytes, 0, 'ID3')) return 0
  if (bytes.length < 10 || ![2, 3, 4].includes(bytes[3]!) || bytes[4] === 0xff || bytes.slice(6, 10).some(byte => byte & 0x80)) throw invalidAudio()
  const size = bytes.slice(6, 10).reduce((total, byte) => total * 128 + byte, 0)
  const end = 10 + size + (bytes[3] === 4 && (bytes[5]! & 0x10) ? 10 : 0)
  if (end > bytes.length) throw invalidAudio()
  return end
}

function mp3Header(bytes: Uint8Array, offset: number) {
  const b1 = bytes[offset + 1]!, b2 = bytes[offset + 2]!
  const version = (b1 >> 3) & 3, layer = (b1 >> 1) & 3
  const bitrateIndex = b2 >> 4, rateIndex = (b2 >> 2) & 3
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0
    || version === 1 || layer !== 1 || !bitrateIndex || bitrateIndex === 15 || rateIndex === 3) throw invalidAudio()
  const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex]! * 1000
  const sampleRate = [44100, 48000, 32000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4)
  const samples = version === 3 ? 1152 : 576
  const length = Math.floor(samples / 8 * bitrate / sampleRate) + ((b2 >> 1) & 1)
  if (offset + length > bytes.length) throw invalidAudio()
  return { version, bitrate, sampleRate, samples, length }
}

/** Validate the encoded audio, without changing the bytes sent to the provider. */
export async function assertGeneratedMp3Audio(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  await inspectGeneratedMp3Audio(bytes, signal)
}

/** Read playable duration from decoded samples, never from caller metadata. */
export async function inspectGeneratedMp3Audio(bytes: Uint8Array, signal?: AbortSignal): Promise<{ durationMs: number }> {
  signal?.throwIfAborted()
  // Load the decoder only for generated audio; ordinary replies do not pay for it.
  const { MPEGDecoder } = await import('mpg123-decoder')
  const decoder = new MPEGDecoder()
  await decoder.ready
  try {
    let samplesDecoded = 0
    let durationMs = 0
    // Discard PCM after each bounded chunk, including for the five-minute music path.
    const chunkSize = 64 * 1024
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      signal?.throwIfAborted()
      const decoded = decoder.decode(bytes.subarray(offset, offset + chunkSize))
      if (decoded.errors.length > 0) {
        throw invalidAudio()
      }
      samplesDecoded += decoded.samplesDecoded
      if (decoded.samplesDecoded > 0) durationMs += decoded.samplesDecoded / decoded.sampleRate * 1000
      if (offset + chunkSize < bytes.byteLength) {
        await setImmediate(undefined, { signal })
      }
    }
    signal?.throwIfAborted()
    if (samplesDecoded === 0) {
      throw invalidAudio()
    }
    return { durationMs: Math.round(durationMs) }
  } finally {
    decoder.free()
  }
}

function invalidAudio(): VaultCliError {
  return new VaultCliError(
    'ELEVENLABS_INVALID_AUDIO',
    'Generated audio did not contain playable MP3 audio.',
    { failureStage: 'response_body', provider: 'elevenlabs', retryable: false },
  )
}
