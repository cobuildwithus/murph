import { setImmediate } from 'node:timers/promises'

import { VaultCliError } from './vault-cli-errors.ts'

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
