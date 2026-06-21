import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  createVoiceMemoToolRuntimeFromEnv,
  executeGenerateVoiceMemoTool,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'
import {
  MURPH_GENERATE_VOICE_MEMO_TOOL,
} from '../src/assistant-codex/dynamic-tools/generate-voice-memo.ts'

const mp3Bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64])

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

  it('reports ElevenLabs provider failures without attempting Linq upload', async () => {
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
      rpcText: 'voice memo generation failed',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
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
      url: null,
      mimeType: 'audio/mpeg',
      sizeBytes: mp3Bytes.byteLength,
      transcript: 'Send a short reminder.',
      source: 'elevenlabs',
      voiceId: 'voice_murph',
      modelId: 'eleven_multilingual_v2',
      transportRefs: {
        linq: {
          attachmentId: 'attachment_voice_1',
        },
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
      url: null,
      mimeType: 'audio/mpeg',
      sizeBytes: null,
      transcript: 'Send a short reminder.',
      source: 'elevenlabs',
      voiceId: 'voice_murph',
      modelId: 'eleven_multilingual_v2',
      transportRefs: {
        telegram: {
          sendMode: 'generate_at_delivery',
        },
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
      rpcText: 'voice memo generated but Linq attachment upload failed',
    })
    expect(result).not.toHaveProperty('usageDraft')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('murph.generate_voice_memo dynamic tool execution', () => {
  it('keeps voice-only replies text-empty in the model-visible contract', () => {
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.description).toContain(
      'If the user asks for voice memos only, attach the voice memo and leave the final response text empty.',
    )
  })

  it('rejects voice memo payloads on the image-only attach response media tool', async () => {
    const request = readMurphDynamicToolRequest({
      id: 10,
      method: 'item/tool/call',
      params: {
        arguments: {
          media: [
            {
              kind: 'voice_memo',
              url: null,
              mimeType: 'audio/mpeg',
              filename: 'memo.mp3',
              sizeBytes: 128,
              transcript: 'Short memo',
              source: 'elevenlabs',
              voiceId: 'voice_murph',
              modelId: 'eleven_multilingual_v2',
              transportRefs: {
                linq: {
                  attachmentId: 'attachment_voice_1',
                },
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
    const request = readMurphDynamicToolRequest({
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
    const request = readMurphDynamicToolRequest({
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
          url: null,
          mimeType: 'audio/mpeg',
          filename: 'memo.mp3',
          sizeBytes: 128,
          transcript: 'Short memo',
          source: 'elevenlabs',
          voiceId: 'voice_murph',
          modelId: 'eleven_multilingual_v2',
          transportRefs: {
            linq: {
              attachmentId: 'attachment_voice_1',
            },
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
    const request = readMurphDynamicToolRequest({
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
          transportRefs: {
            linq: {
              attachmentId: 'attachment_dynamic_1',
            },
          },
        },
      ],
      op: 'append',
    })
    expect(result.usageDraft).toBeNull()
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
) {
  return createVoiceMemoToolRuntimeFromEnv({
    env,
    fetchImpl,
    publicFetchImpl,
    voiceMemoDeliveryChannel,
  })
}
