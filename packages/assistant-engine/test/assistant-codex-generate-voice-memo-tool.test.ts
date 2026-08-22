import { afterEach, describe, expect, it, vi } from 'vitest'

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

afterEach(() => {
  vi.restoreAllMocks()
})

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
      modelId: input?.modelId === undefined
        ? 'eleven_multilingual_v2'
        : input.modelId,
      voiceId: input?.voiceId === undefined
        ? 'voice_default'
        : input.voiceId,
    },
    kind: 'telegram',
  }
}

function createLinqRuntime(
  generateAndUpload: LinqVoiceMemoRuntime['generateAndUpload'],
  input?: {
    apiKeyAvailable?: boolean
    defaultVoiceId?: string | null
    modelId?: string | null
    voiceId?: string | null
  },
): LinqVoiceMemoRuntime {
  return {
    elevenLabs: {
      apiKeyAvailable: input?.apiKeyAvailable ?? true,
      defaultVoiceId: input?.defaultVoiceId ?? null,
      modelId: input?.modelId === undefined
        ? 'eleven_multilingual_v2'
        : input.modelId,
      voiceId: input?.voiceId === undefined
        ? 'voice_default'
        : input.voiceId,
    },
    generateAndUpload,
    kind: 'linq',
  }
}

describe('managed voice memo runtime boundary', () => {
  it('keeps local Telegram descriptor generation while Linq fails closed', () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const env = {
      ELEVENLABS_API_KEY: 'local-elevenlabs-key',
      LINQ_API_TOKEN: 'not-used',
      MURPH_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
      MURPH_ELEVENLABS_VOICE_ID: 'voice_default',
    }

    expect(
      createVoiceMemoToolRuntimeFromEnv({
        env,
        fetchImpl,
        preferredVoiceId: 'voice_preferred',
        voiceMemoDeliveryChannel: 'telegram',
      }),
    ).toEqual({
      elevenLabs: {
        apiKeyAvailable: true,
        defaultVoiceId: 'voice_default',
        modelId: 'eleven_multilingual_v2',
        voiceId: 'voice_preferred',
      },
      kind: 'telegram',
    })

    expect(
      createVoiceMemoToolRuntimeFromEnv({
        env,
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
        },
        runtime: createTelegramRuntime({ voiceId: null }),
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText:
        'MURPH_ELEVENLABS_VOICE_ID is required for voice memo generation',
    })
  })

  it('uses the configured running-turn voice for a normal memo', async () => {
    const runtime = createTelegramRuntime({
      defaultVoiceId: 'voice_env_default',
      voiceId: 'voice_preferred',
    })

    const preferredResult = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
      },
      runtime,
    })

    expect(preferredResult).toMatchObject({
      responseMedia: [
        {
          transport: {
            generation: {
              voiceId: 'voice_preferred',
            },
          },
        },
      ],
      rpcSuccess: true,
    })
  })

  it('resolves explicitly user-requested roster voices and their configured fallback', async () => {
    const runtime = createTelegramRuntime({
      defaultVoiceId: 'voice_env_default',
      voiceId: 'voice_preferred',
    })

    const catalogResult = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        userRequestedVoiceOptionId: 'upbeat',
      },
      runtime,
    })
    const fallbackResult = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        userRequestedVoiceOptionId: 'classic',
      },
      runtime,
    })

    expect(catalogResult).toMatchObject({
      responseMedia: [
        {
          transport: {
            generation: {
              voiceId: 'tnSpp4vdxKPjI9w0GnoV',
            },
          },
        },
      ],
      rpcSuccess: true,
    })
    expect(fallbackResult).toMatchObject({
      responseMedia: [
        {
          transport: {
            generation: {
              voiceId: 'voice_env_default',
            },
          },
        },
      ],
      rpcSuccess: true,
    })
  })

  it('builds the Telegram delivery descriptor without provider I/O', async () => {
    const recordPhaseTiming = vi.fn()
    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
      },
      recordPhaseTiming,
      runtime: createTelegramRuntime(),
    })

    expect(recordPhaseTiming).toHaveBeenCalledOnce()
    expect(recordPhaseTiming).toHaveBeenCalledWith({
      deliveryMode: 'deferred',
      mediaKind: 'voice_memo',
      outcome: 'deferred',
      terminalPhase: 'delivery',
    })
    expect(recordPhaseTiming.mock.calls[0]?.[0]).not.toHaveProperty(
      'generationDurationMs',
    )
    expect(recordPhaseTiming.mock.calls[0]?.[0]).not.toHaveProperty(
      'uploadDurationMs',
    )
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
              voiceId: 'voice_default',
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
    const recordPhaseTiming = vi.fn()
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async (request) => {
      request.recordPhaseTiming?.({
        deliveryMode: 'synchronous',
        generationDurationMs: 12,
        mediaKind: 'voice_memo',
        outcome: 'succeeded',
        terminalPhase: 'upload',
        uploadDurationMs: 8,
      })
      return {
        attachmentId: 'attachment_voice_1',
        filename: 'voice-memo-1.mp3',
        ok: true,
      }
    })
    const runtime = createLinqRuntime(generateAndUpload)

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
      },
      recordPhaseTiming,
      runtime,
    })

    expect(recordPhaseTiming).toHaveBeenCalledWith({
      deliveryMode: 'synchronous',
      generationDurationMs: 12,
      mediaKind: 'voice_memo',
      outcome: 'succeeded',
      terminalPhase: 'upload',
      uploadDurationMs: 8,
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

  it('keeps phase timing callback failures diagnostic-only', async () => {
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async (request) => {
      request.recordPhaseTiming?.({
        deliveryMode: 'synchronous',
        generationDurationMs: 12,
        mediaKind: 'voice_memo',
        outcome: 'succeeded',
        terminalPhase: 'upload',
        uploadDurationMs: 8,
      })
      return {
        attachmentId: 'attachment_voice_2',
        filename: 'voice-memo-2.mp3',
        ok: true,
      }
    })

    await expect(
      executeGenerateVoiceMemoTool({
        args: { text: 'Send a short reminder.' },
        recordPhaseTiming: () => {
          throw new Error('diagnostic sink unavailable')
        },
        runtime: createLinqRuntime(generateAndUpload),
      }),
    ).resolves.toMatchObject({
      responseMedia: [
        {
          filename: 'voice-memo-2.mp3',
          transport: {
            attachmentId: 'attachment_voice_2',
            kind: 'linq_attachment',
          },
        },
      ],
      rpcSuccess: true,
    })
  })

  it('maps typed adapter failures into public model-visible semantics', async () => {
    const missingTokenRuntime = createLinqRuntime(
      vi.fn<LinqVoiceMemoRuntime['generateAndUpload']>(async () => ({
        failure: {
          kind: 'missing_configuration',
          variable: 'LINQ_API_TOKEN',
        },
        ok: false,
      })),
    )
    const generationFailureRuntime = createLinqRuntime(
      vi.fn<LinqVoiceMemoRuntime['generateAndUpload']>(async () => ({
        failure: {
          detail: 'ELEVENLABS_API_REQUEST_FAILED (http 503)',
          kind: 'generation_failed',
        },
        ok: false,
      })),
    )
    const invalidAudioRuntime = createLinqRuntime(
      vi.fn<LinqVoiceMemoRuntime['generateAndUpload']>(async () => ({
        failure: {
          kind: 'invalid_audio',
        },
        ok: false,
      })),
    )
    const uploadFailureRuntime = createLinqRuntime(
      vi.fn<LinqVoiceMemoRuntime['generateAndUpload']>(async () => ({
        failure: {
          detail: 'LINQ_API_REQUEST_FAILED (http 503)',
          kind: 'upload_failed',
        },
        ok: false,
      })),
    )

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
        },
        runtime: missingTokenRuntime,
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText:
        'LINQ_API_TOKEN is required for voice memo attachment upload',
    })
    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
        },
        runtime: generationFailureRuntime,
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText:
        'voice memo generation failed: ELEVENLABS_API_REQUEST_FAILED (http 503)',
    })
    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
        },
        runtime: invalidAudioRuntime,
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText: 'voice memo generation returned invalid audio data',
    })
    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
        },
        runtime: uploadFailureRuntime,
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText:
        'voice memo generated but Linq attachment upload failed: LINQ_API_REQUEST_FAILED (http 503)',
    })
  })

  it('does not trust rpcText properties on thrown adapter errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const runtime = createLinqRuntime(
      vi.fn<LinqVoiceMemoRuntime['generateAndUpload']>(async () => {
        throw Object.assign(new Error('provider internals'), {
          rpcText: 'secret provider response',
        })
      }),
    )

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
      },
      runtime,
    })

    expect(result.rpcSuccess).toBe(false)
    expect(result.rpcText).toContain(
      'voice memo generated but Linq attachment upload failed',
    )
    expect(result.rpcText).not.toContain('secret provider response')
  })

  it('rethrows aborts instead of converting them into delivery failures', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const runtime = createLinqRuntime(
      vi.fn<LinqVoiceMemoRuntime['generateAndUpload']>(async () => {
        throw abortError
      }),
    )

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
        },
        runtime,
      }),
    ).rejects.toBe(abortError)
  })

  it('keeps response-media conflicts in the public executor', async () => {
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >()
    const runtime = createLinqRuntime(generateAndUpload)

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
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
    const recordPhaseTiming = vi.fn()
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async (request) => {
      request.recordPhaseTiming?.({
        deliveryMode: 'synchronous',
        generationDurationMs: 120,
        mediaKind: 'song',
        outcome: 'succeeded',
        terminalPhase: 'upload',
        uploadDurationMs: 15,
      })
      return {
        attachmentId: 'attachment_song_1',
        filename: 'song-1.mp3',
        ok: true,
      }
    })
    const runtime = createLinqRuntime(generateAndUpload, {
      modelId: null,
      voiceId: null,
    })

    const result = await executeGenerateSongTool({
      args: {
        durationSeconds: 15,
        instrumental: false,
        prompt: 'A bright, original group theme.',
      },
      recordPhaseTiming,
      runtime,
    })

    expect(recordPhaseTiming).toHaveBeenCalledWith({
      deliveryMode: 'synchronous',
      generationDurationMs: 120,
      mediaKind: 'song',
      outcome: 'succeeded',
      terminalPhase: 'upload',
      uploadDurationMs: 15,
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
