import { describe, expect, it, vi } from 'vitest'

import {
  createVoiceMemoToolRuntimeFromEnv,
  executeGenerateSongTool,
  executeGenerateVoiceMemoTool,
  type VoiceMemoToolRuntime,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'

type LinqVoiceMemoRuntime = Extract<
  VoiceMemoToolRuntime,
  { kind: 'linq' }
>

function createTelegramRuntime(input?: {
  apiKeyAvailable?: boolean
  defaultVoiceId?: string | null
  modelId?: string | null
  voiceId?: string | null
}): VoiceMemoToolRuntime {
  return {
    elevenLabs: {
      apiKeyAvailable: input?.apiKeyAvailable ?? true,
      defaultVoiceId: input?.defaultVoiceId ?? null,
      modelId: input?.modelId ?? 'eleven_multilingual_v2',
      voiceId: input?.voiceId ?? 'voice_default',
    },
    kind: 'telegram',
  }
}

describe('managed voice memo runtime boundary', () => {
  it('fails closed in the public build without calling a provider', () => {
    const fetchImpl = vi.fn<typeof fetch>()

    expect(
      createVoiceMemoToolRuntimeFromEnv({
        env: {
          ELEVENLABS_API_KEY: 'not-used',
          LINQ_API_TOKEN: 'not-used',
        },
        fetchImpl,
        voiceMemoDeliveryChannel: 'linq',
      }),
    ).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('executeGenerateVoiceMemoTool', () => {
  it('rejects unavailable delivery before any provider adapter runs', async () => {
    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime: null,
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText:
        'voice memo generation is only available for deliverable iMessage or Telegram replies',
    })
  })

  it('keeps provider configuration preconditions in the public executor', async () => {
    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime: createTelegramRuntime({ apiKeyAvailable: false }),
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText: 'ELEVENLABS_API_KEY is required for voice memo generation',
    })

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime: createTelegramRuntime({ modelId: null }),
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText:
        'MURPH_ELEVENLABS_MODEL_ID must be a priced ElevenLabs TTS model',
    })

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime: createTelegramRuntime({ voiceId: null }),
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText:
        'MURPH_ELEVENLABS_VOICE_ID is required for voice memo generation',
    })
  })

  it('builds the Telegram delivery descriptor without provider I/O', async () => {
    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: 'voice_explicit',
      },
      runtime: createTelegramRuntime(),
    })

    expect(result).toMatchObject({
      responseMedia: [
        {
          kind: 'voice_memo',
          transcript: 'Send a short reminder.',
          transport: {
            generation: {
              kind: 'elevenlabs_speech',
              modelId: 'eleven_multilingual_v2',
              outputFormat: 'mp3_44100_128',
              text: 'Send a short reminder.',
              voiceId: 'voice_explicit',
            },
            kind: 'telegram_generation',
          },
        },
      ],
      rpcSuccess: true,
      rpcText: 'generated voice memo attached to the final response',
    })
  })

  it('delegates Linq generation and upload through the bounded runtime adapter', async () => {
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async () => ({
      attachmentId: 'attachment_voice_1',
      filename: 'voice-memo-1.mp3',
    }))
    const runtime: LinqVoiceMemoRuntime = {
      elevenLabs: {
        apiKeyAvailable: true,
        modelId: 'eleven_multilingual_v2',
        voiceId: 'voice_default',
      },
      generateAndUpload,
      kind: 'linq',
    }

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime,
    })

    expect(generateAndUpload).toHaveBeenCalledTimes(1)
    expect(generateAndUpload.mock.calls[0]?.[0]).toMatchObject({
      filenameBase: expect.stringMatching(/^voice-memo-/u),
      generation: {
        kind: 'elevenlabs_speech',
        modelId: 'eleven_multilingual_v2',
        outputFormat: 'mp3_44100_128',
        text: 'Send a short reminder.',
        voiceId: 'voice_default',
      },
      signal: null,
    })
    expect(result).toMatchObject({
      responseMedia: [
        {
          filename: 'voice-memo-1.mp3',
          kind: 'voice_memo',
          transcript: 'Send a short reminder.',
          transport: {
            attachmentId: 'attachment_voice_1',
            kind: 'linq_attachment',
          },
        },
      ],
      rpcSuccess: true,
    })
  })

  it('accepts only the bounded runtime failure text from a managed adapter', async () => {
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async () => {
      throw Object.assign(new Error('provider internals'), {
        rpcText: 'voice memo generation failed: safe provider summary',
      })
    })
    const runtime: LinqVoiceMemoRuntime = {
      elevenLabs: {
        apiKeyAvailable: true,
        modelId: 'eleven_multilingual_v2',
        voiceId: 'voice_default',
      },
      generateAndUpload,
      kind: 'linq',
    }

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime,
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText: 'voice memo generation failed: safe provider summary',
    })
  })

  it('keeps response-media conflicts in the public executor', async () => {
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >()
    const runtime: LinqVoiceMemoRuntime = {
      elevenLabs: {
        apiKeyAvailable: true,
        modelId: 'eleven_multilingual_v2',
        voiceId: 'voice_default',
      },
      generateAndUpload,
      kind: 'linq',
    }

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        currentResponseMedia: [
          {
            alt: null,
            kind: 'image',
            source: null,
            url: 'https://assets.example.test/image.png',
          },
        ],
        runtime,
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText:
        'voice memo generation cannot be combined with other response media',
    })
    expect(generateAndUpload).not.toHaveBeenCalled()
  })
})

describe('executeGenerateSongTool', () => {
  it('keeps the public song envelope while delegating provider work', async () => {
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async () => ({
      attachmentId: 'attachment_song_1',
      filename: 'song-1.mp3',
    }))
    const runtime: LinqVoiceMemoRuntime = {
      elevenLabs: {
        apiKeyAvailable: true,
        modelId: null,
        voiceId: null,
      },
      generateAndUpload,
      kind: 'linq',
    }

    const result = await executeGenerateSongTool({
      args: {
        durationSeconds: 15,
        instrumental: false,
        prompt: 'A bright, original group theme.',
      },
      runtime,
    })

    expect(generateAndUpload).toHaveBeenCalledTimes(1)
    expect(generateAndUpload.mock.calls[0]?.[0]).toMatchObject({
      filenameBase: expect.stringMatching(/^song-/u),
      generation: {
        durationMs: 15_000,
        forceInstrumental: false,
        kind: 'elevenlabs_music',
        modelId: 'music_v2',
        outputFormat: 'mp3_48000_192',
        prompt: 'A bright, original group theme.',
      },
      signal: null,
    })
    expect(result).toMatchObject({
      responseMedia: [
        {
          filename: 'song-1.mp3',
          kind: 'voice_memo',
          transcript: null,
          transport: {
            attachmentId: 'attachment_song_1',
            kind: 'linq_attachment',
          },
        },
      ],
      rpcSuccess: true,
      rpcText: 'generated song attached to the final response',
    })
  })
})
