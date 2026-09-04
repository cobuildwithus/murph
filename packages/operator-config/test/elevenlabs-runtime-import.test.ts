import { expect, test, vi } from 'vitest'

const { sdkLoaded } = vi.hoisted(() => ({ sdkLoaded: vi.fn() }))

vi.mock('@elevenlabs/elevenlabs-js', async (importOriginal) => {
  sdkLoaded()
  return await importOriginal()
})

test('loads the audio SDK only for a validated audio request', async () => {
  const runtime = await import('../src/elevenlabs-runtime.ts')
  expect(sdkLoaded).not.toHaveBeenCalled()
  expect(runtime.resolveElevenLabsModelId({})).toBe('eleven_multilingual_v2')
  expect(runtime.ELEVENLABS_TTS_MAX_TEXT_LENGTH).toBe(1000)

  await expect(runtime.generateElevenLabsSpeech({
    apiKey: 'synthetic-key',
    modelId: 'eleven_multilingual_v2',
    text: '',
    voiceId: 'synthetic-voice',
  })).rejects.toMatchObject({ code: 'ELEVENLABS_INVALID_INPUT' })
  expect(sdkLoaded).not.toHaveBeenCalled()

  const fetchImplementation = vi.fn(async () => new Response(
    new Uint8Array([1, 2, 3]),
    { headers: { 'content-type': 'audio/mpeg' }, status: 200 },
  ))
  await expect(runtime.generateElevenLabsSpeech({
    apiKey: 'synthetic-key',
    fetchImplementation,
    modelId: 'eleven_multilingual_v2',
    text: 'A synthetic audio request.',
    voiceId: 'synthetic-voice',
  })).resolves.toMatchObject({ bytes: new Uint8Array([1, 2, 3]) })
  expect(sdkLoaded).toHaveBeenCalledOnce()
  expect(fetchImplementation).toHaveBeenCalledOnce()
})
