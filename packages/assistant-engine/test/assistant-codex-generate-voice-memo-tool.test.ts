import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ELEVENLABS_TTS_MAX_TEXT_LENGTH } from '@murphai/operator-config/elevenlabs-runtime'

import {
  executeMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  createVoiceMemoToolRuntimeFromEnv,
  executeGenerateVoiceMemoTool,
  type VoiceMemoToolRuntime,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'
import {
  MURPH_GENERATE_VOICE_MEMO_TOOL,
} from '../src/assistant-codex/dynamic-tools/generate-voice-memo.ts'

const mp3Bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64])

type LinqVoiceMemoRuntime = Extract<
  VoiceMemoToolRuntime,
  { kind: 'linq' }
>

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('executeGenerateVoiceMemoTool', () => {
  it('rejects unavailable voice memo delivery before provider calls', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime: createRuntime({}, fetchImpl, null),
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText: 'voice memo generation is only available for deliverable iMessage or Telegram replies',
    })

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects missing voice memo runtime configuration before provider calls', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime: createRuntime({
          LINQ_API_TOKEN: 'linq-token',
          MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
        }, fetchImpl, 'linq'),
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
        runtime: createRuntime({
          ELEVENLABS_API_KEY: 'elevenlabs-key',
          MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
        }, fetchImpl, 'linq'),
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText: 'LINQ_API_TOKEN is required for voice memo attachment upload',
    })

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime: createRuntime({
          ELEVENLABS_API_KEY: 'elevenlabs-key',
          LINQ_API_TOKEN: 'linq-token',
        }, fetchImpl, 'linq'),
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText: 'MURPH_ELEVENLABS_VOICE_ID is required for voice memo generation',
    })

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects unpriced configured ElevenLabs models before provider calls', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime: createRuntime({
          ELEVENLABS_API_KEY: 'elevenlabs-key',
          LINQ_API_TOKEN: 'linq-token',
          MURPH_ELEVENLABS_MODEL_ID: 'eleven_monolingual_v1',
          MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
        }, fetchImpl, 'linq'),
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText: 'MURPH_ELEVENLABS_MODEL_ID must be a priced ElevenLabs TTS model',
    })

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses preferred voice before env default while keeping explicit tool voice override', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const runtime = createRuntime({
      ELEVENLABS_API_KEY: 'elevenlabs-key',
      MURPH_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
      MURPH_ELEVENLABS_VOICE_ID: 'voice_env_default',
    }, fetchImpl, 'telegram', null, 'voice_preferred')

    const preferredResult = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime,
    })
    const explicitResult = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: 'voice_explicit',
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
    expect(explicitResult).toMatchObject({
      responseMedia: [
        {
          transport: {
            generation: {
              voiceId: 'voice_explicit',
            },
          },
        },
      ],
      rpcSuccess: true,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses preferred voice for Linq generation before env default', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        expect(url).toBe(
          'https://api.elevenlabs.io/v1/text-to-speech/voice_preferred?output_format=mp3_44100_128',
        )
        expect(init?.method).toBe('POST')
        expect(readHeader(init?.headers, 'xi-api-key')).toBe('elevenlabs-key')
        expect(JSON.parse(String(init?.body))).toEqual({
          model_id: 'eleven_multilingual_v2',
          text: 'Send a short reminder.',
        })
        return new Response(mp3Bytes, {
          headers: {
            'content-type': 'audio/mpeg',
          },
        })
      }

      if (url === 'https://api.linqapp.com/api/partner/v3/attachments') {
        return jsonResponse({
          attachment_id: 'attachment_voice_preferred',
          download_url: 'https://cdn.example.test/preferred-voice-memo.mp3',
          expires_at: '2026-04-08T00:05:00.000Z',
          http_method: 'PUT',
          required_headers: {
            'content-type': 'audio/mpeg',
          },
          upload_url: 'https://uploads.example.test/preferred-voice-memo',
        })
      }

      if (url === 'https://uploads.example.test/preferred-voice-memo') {
        expect(init?.method).toBe('PUT')
        expect(init?.body).toBeInstanceOf(Blob)
        return new Response(null, { status: 204 })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime: createRuntime({
        ELEVENLABS_API_KEY: 'elevenlabs-key',
        LINQ_API_TOKEN: 'linq-token',
        MURPH_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_env_default',
      }, fetchImpl, 'linq', null, 'voice_preferred'),
    })

    expect(result.rpcSuccess).toBe(true)
    expect(result.responseMedia?.[0]).toMatchObject({
      kind: 'voice_memo',
      transport: {
        attachmentId: 'attachment_voice_preferred',
        kind: 'linq_attachment',
      },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('reports the ElevenLabs status in the tool result and the runtime log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response('provider failed', { status: 503 })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'Send a short reminder.',
          voiceId: null,
        },
        runtime: createRuntime({
          ELEVENLABS_API_KEY: 'elevenlabs-key',
          LINQ_API_TOKEN: 'linq-token',
          MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
        }, fetchImpl, 'linq'),
      }),
    ).resolves.toEqual({
      rpcSuccess: false,
      rpcText: expect.stringMatching(
        /^voice memo generation failed: ELEVENLABS_API_REQUEST_FAILED \(http 503, \d+ms\)$/,
      ),
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'Assistant voice memo generation failed.',
      expect.objectContaining({
        failure: expect.stringContaining('http 503'),
      }),
    )
  })

  it('names the transport stage when no ElevenLabs response arrives', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        throw new TypeError('fetch failed')
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime: createRuntime({
        ELEVENLABS_API_KEY: 'elevenlabs-key',
        LINQ_API_TOKEN: 'linq-token',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
      }, fetchImpl, 'linq'),
    })

    // The incident this replaces reported a bare "voice memo generation failed"
    // for every cause, so a transport death had to stay distinguishable from an
    // HTTP rejection in the text the model reads back.
    expect(result.rpcSuccess).toBe(false)
    expect(result.rpcText).toContain('stage=transport')
    expect(result.rpcText).toContain('TypeError')
    expect(result.rpcText).not.toContain('http ')
  })

  it('rejects text longer than one voice memo can synthesize in time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      executeGenerateVoiceMemoTool({
        args: {
          text: 'a'.repeat(ELEVENLABS_TTS_MAX_TEXT_LENGTH + 1),
          voiceId: null,
        },
        runtime: createRuntime({
          ELEVENLABS_API_KEY: 'elevenlabs-key',
          LINQ_API_TOKEN: 'linq-token',
          MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
        }, fetchImpl, 'linq'),
      }),
    ).resolves.toMatchObject({
      rpcSuccess: false,
      rpcText: expect.stringContaining('ELEVENLABS_INVALID_INPUT'),
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects oversized generated audio before creating a Linq attachment', async () => {
    const tooLargeMp3 = new Uint8Array((10 * 1024 * 1024) + 1)
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response(tooLargeMp3, {
          headers: {
            'content-type': 'audio/mpeg',
          },
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime: createRuntime({
        ELEVENLABS_API_KEY: 'elevenlabs-key',
        LINQ_API_TOKEN: 'linq-token',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
      }, fetchImpl, 'linq'),
    })

    expect(result).toMatchObject({
      rpcSuccess: false,
      rpcText: 'voice memo generation returned invalid audio data',
    })
    expect(result).not.toHaveProperty('usageDraft')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not create a local usage draft when ElevenLabs returns empty generated audio', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response(new Uint8Array(), {
          headers: {
            'content-type': 'audio/mpeg',
          },
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime: createRuntime({
        ELEVENLABS_API_KEY: 'elevenlabs-key',
        LINQ_API_TOKEN: 'linq-token',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
      }, fetchImpl, 'linq'),
    })

    expect(result).toMatchObject({
      rpcSuccess: false,
      rpcText: 'voice memo generation returned invalid audio data',
    })
    expect(result).not.toHaveProperty('usageDraft')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('generates ElevenLabs speech, uploads it to Linq, and returns response media', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        expect(url).toBe(
          'https://api.elevenlabs.io/v1/text-to-speech/voice_murph?output_format=mp3_44100_128',
        )
        expect(init?.method).toBe('POST')
        expect(readHeader(init?.headers, 'xi-api-key')).toBe('elevenlabs-key')
        expect(JSON.parse(String(init?.body))).toEqual({
          model_id: 'eleven_multilingual_v2',
          text: 'Send a short reminder.',
        })
        return new Response(mp3Bytes, {
          headers: {
            'content-type': 'audio/mpeg',
          },
        })
      }

      if (url === 'https://api.linqapp.com/api/partner/v3/attachments') {
        expect(init?.method).toBe('POST')
        expect(readHeader(init?.headers, 'authorization')?.replace(/^Bearer\s+/u, '')).toBe('linq-token')
        const body = JSON.parse(String(init?.body)) as {
          content_type: string
          filename: string
          size_bytes: number
        }
        expect(body.content_type).toBe('audio/mpeg')
        expect(body.filename).toMatch(/^voice-memo-[^.]+\.mp3$/u)
        expect(body.size_bytes).toBe(mp3Bytes.byteLength)
        return jsonResponse({
          attachment_id: 'attachment_voice_1',
          download_url: 'https://cdn.example.test/voice-memo.mp3',
          expires_at: '2026-04-08T00:05:00.000Z',
          http_method: 'PUT',
          required_headers: {
            'content-type': 'audio/mpeg',
            'x-upload-token': 'upload-token',
          },
          upload_url: 'https://uploads.example.test/voice-memo',
        })
      }

      if (url === 'https://uploads.example.test/voice-memo') {
        expect(init?.method).toBe('PUT')
        expect(init?.headers).toEqual({
          'content-type': 'audio/mpeg',
          'x-upload-token': 'upload-token',
        })
        expect(init?.body).toBeInstanceOf(Blob)
        expect(new Uint8Array(await (init?.body as Blob).arrayBuffer())).toEqual(mp3Bytes)
        return new Response(null, { status: 204 })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime: createRuntime({
        ELEVENLABS_API_KEY: 'elevenlabs-key',
        LINQ_API_TOKEN: 'linq-token',
        MURPH_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
      }, fetchImpl, 'linq'),
    })

    expect(result.rpcSuccess).toBe(true)
    expect(result.rpcText).toBe('generated voice memo attached to the final response')
    expect(result.responseMedia).toHaveLength(1)
    expect(result.responseMedia?.[0]).toMatchObject({
      kind: 'voice_memo',
      transport: {
        attachmentId: 'attachment_voice_1',
        kind: 'linq_attachment',
      },
    })
    expect(result).not.toHaveProperty('usageDraft')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('returns a Telegram delivery-time descriptor without uploading generated audio', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime: createRuntime({
        ELEVENLABS_API_KEY: 'elevenlabs-key',
        MURPH_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
      }, fetchImpl, 'telegram'),
    })

    expect(result.rpcSuccess).toBe(true)
    expect(result.responseMedia).toHaveLength(1)
    expect(result.responseMedia?.[0]).toMatchObject({
      kind: 'voice_memo',
      transport: {
        generation: {
          kind: 'elevenlabs_speech',
          modelId: 'eleven_multilingual_v2',
          outputFormat: 'mp3_44100_128',
          text: 'Send a short reminder.',
          voiceId: 'voice_murph',
        },
        kind: 'telegram_generation',
      },
    })
    expect(result).not.toHaveProperty('usageDraft')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses public fetch for the validated Linq presigned upload', async () => {
    const providerFetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response(mp3Bytes, {
          headers: {
            'content-type': 'audio/mpeg',
          },
        })
      }

      if (url === 'https://api.linqapp.com/api/partner/v3/attachments') {
        return jsonResponse({
          attachment_id: 'attachment_voice_1',
          download_url: 'https://cdn.example.test/voice-memo.mp3',
          expires_at: '2026-04-08T00:05:00.000Z',
          http_method: 'PUT',
          required_headers: {
            'content-type': 'audio/mpeg',
          },
          upload_url: 'https://uploads.example.test/voice-memo',
        })
      }

      throw new Error(`Provider fetch should not receive request: ${url}`)
    })
    const publicFetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://uploads.example.test/voice-memo')
      expect(init?.method).toBe('PUT')
      expect(init?.body).toBeInstanceOf(Blob)
      return new Response(null, { status: 204 })
    })

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime: createRuntime({
        ELEVENLABS_API_KEY: 'elevenlabs-key',
        LINQ_API_TOKEN: 'linq-token',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
      }, providerFetchImpl, 'linq', publicFetchImpl),
    })

    expect(result.rpcSuccess).toBe(true)
    expect(providerFetchImpl).toHaveBeenCalledTimes(2)
    expect(publicFetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects private Linq upload URLs before uploading generated audio', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response(mp3Bytes, {
          headers: {
            'content-type': 'audio/mpeg',
          },
        })
      }

      if (url === 'https://api.linqapp.com/api/partner/v3/attachments') {
        return jsonResponse({
          attachment_id: 'attachment_voice_1',
          download_url: 'https://cdn.example.test/voice-memo.mp3',
          expires_at: '2026-04-08T00:05:00.000Z',
          http_method: 'PUT',
          required_headers: {
            'content-type': 'audio/mpeg',
          },
          upload_url: 'http://127.0.0.1/upload/voice-memo',
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const result = await executeGenerateVoiceMemoTool({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      runtime: createRuntime({
        ELEVENLABS_API_KEY: 'elevenlabs-key',
        LINQ_API_TOKEN: 'linq-token',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
      }, fetchImpl, 'linq'),
    })

    expect(result).toMatchObject({
      rpcSuccess: false,
      rpcText: expect.stringMatching(
        /^voice memo generated but Linq attachment upload failed: LINQ_[A-Z_]+/,
      ),
    })
    expect(result).not.toHaveProperty('usageDraft')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('murph.generate_voice_memo dynamic tool execution', () => {
  it('keeps accompanying text optional and non-duplicative in the model-visible contract', () => {
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'when a loaded Murph skill or product flow explicitly asks for a voice memo',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'Final response text is optional.',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'Leave it empty when the memo fully carries the reply, the user asked for voice only, or the owning skill or product flow marks the response voice-only. When leaving it empty, finish with an empty final assistant message and do not call murph.finish_without_reply after attaching the memo.',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'Add accompanying text only when it contributes distinct necessary information, the owning flow explicitly requires it, or the user explicitly asks for both audio and text; otherwise do not duplicate the memo transcript in text.',
    )
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'For a voice-only Linq/iMessage response, do not call murph.select_reply_target because native reply targeting requires accompanying text.',
    )
  })

  it('rejects voice memo payloads on the image-only attach response media tool', async () => {
    const request = readTestMurphDynamicToolRequest({
      id: 10,
      method: 'item/tool/call',
      params: {
        arguments: {
          media: [
            {
              kind: 'voice_memo',
              filename: 'memo.mp3',
              transport: {
                attachmentId: 'attachment_voice_1',
                kind: 'linq_attachment',
              },
            },
          ],
        },
        namespace: 'murph',
        tool: 'attach_response_media',
      },
    })
    const fetchImpl = vi.fn<typeof fetch>()
    const nextUsageOrdinal = vi.fn(() => 99)

    expect(request).toMatchObject({
      kind: 'invalid-response-media-arguments',
    })

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
    })

    expect(result.rpcResult).toEqual({
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: 'invalid response media arguments',
        },
      ],
    })
    expect(result.responseMediaPatch).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(nextUsageOrdinal).not.toHaveBeenCalled()
  })

  it('returns an invalid-arguments result for malformed voice memo tool calls', async () => {
    const request = readTestMurphDynamicToolRequest({
      id: 11,
      method: 'item/tool/call',
      params: {
        arguments: {
          modelId: 'eleven_monolingual_v1',
          text: 'Send a short reminder.',
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })
    const fetchImpl = vi.fn<typeof fetch>()
    const nextUsageOrdinal = vi.fn(() => 99)

    expect(request).toMatchObject({
      kind: 'invalid-generate-voice-memo-arguments',
    })

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
    })

    expect(result.rpcResult).toEqual({
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: 'invalid voice memo generation arguments',
        },
      ],
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(nextUsageOrdinal).not.toHaveBeenCalled()
  })

  it('rejects voice memo generation when response media is already attached', async () => {
    const request = readTestMurphDynamicToolRequest({
      id: 12,
      method: 'item/tool/call',
      params: {
        arguments: {
          text: 'Send a short reminder.',
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })
    const fetchImpl = vi.fn<typeof fetch>()
    const nextUsageOrdinal = vi.fn(() => 99)

    const result = await executeMurphDynamicToolRequest({
      currentResponseMedia: [
        {
          kind: 'image',
          url: 'https://assets.example.test/image.png',
          alt: null,
          source: null,
        },
      ],
      env: {},
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
    })

    expect(result.rpcResult).toEqual({
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: 'voice memo generation cannot be combined with other response media',
        },
      ],
    })
    expect(result.responseMediaPatch).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(nextUsageOrdinal).not.toHaveBeenCalled()
  })

  it('rejects image generation when a voice memo is already attached', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const nextUsageOrdinal = vi.fn(() => 99)

    const result = await executeMurphDynamicToolRequest({
      currentResponseMedia: [
        {
          kind: 'voice_memo',
          filename: 'memo.mp3',
          transcript: null,
          transport: {
            attachmentId: 'attachment_voice_1',
            kind: 'linq_attachment',
          },
        },
      ],
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: {
        kind: 'generate-image',
        args: {
          alt: null,
          outputFormat: 'webp',
          prompt: 'A reminder card.',
          quality: 'medium',
          size: '1024x1024',
        },
      },
    })

    expect(result.rpcResult).toEqual({
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: 'image generation cannot be combined with a voice memo',
        },
      ],
    })
    expect(result.responseMediaPatch).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(nextUsageOrdinal).not.toHaveBeenCalled()
  })

  it('parses voice memo arguments and appends generated response media', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response(mp3Bytes, {
          headers: {
            'content-type': 'audio/mpeg',
          },
        })
      }

      if (url.endsWith('/attachments')) {
        return jsonResponse({
          attachment_id: 'attachment_dynamic_1',
          download_url: 'https://cdn.example.test/dynamic-voice-memo.mp3',
          expires_at: '2026-04-08T00:05:00.000Z',
          http_method: 'PUT',
          required_headers: {
            'content-type': 'audio/mpeg',
          },
          upload_url: 'https://uploads.example.test/dynamic-voice-memo',
        })
      }

      if (url === 'https://uploads.example.test/dynamic-voice-memo') {
        return new Response(null, { status: 204 })
      }

      throw new Error(`Unexpected request: ${url}`)
    })
    const request = readTestMurphDynamicToolRequest({
      id: 10,
      method: 'item/tool/call',
      params: {
        arguments: {
          text: 'Send a short reminder.',
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })

    expect(request).toMatchObject({
      args: {
        text: 'Send a short reminder.',
        voiceId: null,
      },
      kind: 'generate-voice-memo',
    })

    const nextUsageOrdinal = vi.fn(() => 99)
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
      voiceMemoRuntime: createRuntime({
        ELEVENLABS_API_KEY: 'elevenlabs-key',
        LINQ_API_TOKEN: 'linq-token',
        MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
      }, fetchImpl, 'linq'),
    })

    expect(nextUsageOrdinal).not.toHaveBeenCalled()
    expect(result.rpcResult).toEqual({
      success: true,
      contentItems: [
        {
          type: 'inputText',
          text: 'generated voice memo attached to the final response',
        },
      ],
    })
    expect(result.responseMediaPatch).toMatchObject({
      media: [
        {
          kind: 'voice_memo',
          transport: {
            attachmentId: 'attachment_dynamic_1',
            kind: 'linq_attachment',
          },
        },
      ],
      op: 'append',
    })
    expect(result.usageDraft).toBeNull()
  })
})

describe('murph.generate_song dynamic tool execution', () => {
  it('forces the trusted turn duration before song generation', async () => {
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async () => ({
      attachmentId: 'attachment_song_policy',
      filename: 'sponsor-song.mp3',
    }))
    const generateSongTurnState = {
      attemptCount: 0,
      policy: {
        maxAttempts: 1,
        requiredDurationSeconds: 15,
      },
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: vi.fn<typeof fetch>(),
      generateSongTurnState,
      nextUsageOrdinal: vi.fn(() => 99),
      progressDelivery: null,
      request: {
        args: {
          durationSeconds: 30,
          instrumental: false,
          prompt: 'A bright, original group theme.',
        },
        kind: 'generate-song',
      },
      voiceMemoRuntime: {
        elevenLabs: {
          apiKeyAvailable: true,
          modelId: null,
          voiceId: null,
        },
        generateAndUpload,
        kind: 'linq',
      },
    })

    expect(generateAndUpload).toHaveBeenCalledTimes(1)
    expect(generateAndUpload.mock.calls[0]?.[0]?.generation).toMatchObject({
      durationMs: 15_000,
      kind: 'elevenlabs_music',
    })
    expect(generateSongTurnState.attemptCount).toBe(1)
    expect(result.rpcResult.success).toBe(true)
  })

  it('does not retry a failed creative song generation attempt', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async () => {
      throw new Error('provider unavailable')
    })
    const generateSongTurnState = {
      attemptCount: 0,
      policy: {
        maxAttempts: 1,
        requiredDurationSeconds: 15,
      },
    }
    const input = {
      env: {},
      fetchImpl: vi.fn<typeof fetch>(),
      generateSongTurnState,
      nextUsageOrdinal: vi.fn(() => 99),
      progressDelivery: null,
      request: {
        args: {
          durationSeconds: 15,
          instrumental: false,
          prompt: 'A bright, original group theme.',
        },
        kind: 'generate-song' as const,
      },
      voiceMemoRuntime: {
        elevenLabs: {
          apiKeyAvailable: true,
          modelId: null,
          voiceId: null,
        },
        generateAndUpload,
        kind: 'linq' as const,
      },
    }

    const first = await executeMurphDynamicToolRequest(input)
    const second = await executeMurphDynamicToolRequest(input)

    expect(first.rpcResult.success).toBe(false)
    expect(second.rpcResult).toEqual({
      success: false,
      contentItems: [{
        type: 'inputText',
        text: 'song generation attempt limit reached for this turn; no song ran',
      }],
    })
    expect(generateAndUpload).toHaveBeenCalledTimes(1)
    expect(generateSongTurnState.attemptCount).toBe(1)
  })
})

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    ...init,
  })
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name)
}

function createRuntime(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  voiceMemoDeliveryChannel: 'linq' | 'telegram' | null,
  publicFetchImpl?: typeof fetch | null,
  preferredVoiceId?: string | null,
) {
  return createVoiceMemoToolRuntimeFromEnv({
    env,
    fetchImpl,
    preferredVoiceId,
    publicFetchImpl,
    voiceMemoDeliveryChannel,
  })
}
