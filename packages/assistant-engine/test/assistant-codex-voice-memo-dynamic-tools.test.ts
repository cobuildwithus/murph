import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'

import { ELEVENLABS_TTS_MAX_TEXT_LENGTH } from '@murphai/operator-config/elevenlabs-runtime'

import {
  executeMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  MURPH_GENERATE_VOICE_MEMO_TOOL,
} from '../src/assistant-codex/dynamic-tools/generate-voice-memo.ts'
import type {
  VoiceMemoToolRuntime,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'

type LinqVoiceMemoRuntime = Extract<
  VoiceMemoToolRuntime,
  { kind: 'linq' }
>

function createLinqRuntime(
  generateAndUpload: LinqVoiceMemoRuntime['generateAndUpload'],
): LinqVoiceMemoRuntime {
  return {
    elevenLabs: {
      apiKeyAvailable: true,
      modelId: 'eleven_multilingual_v2',
      voiceId: 'voice_default',
    },
    generateAndUpload,
    kind: 'linq',
  }
}

describe('murph.generate_voice_memo dynamic tool execution', () => {
  it('keeps accompanying text optional and non-duplicative in the model-visible contract', () => {
    expect(ELEVENLABS_TTS_MAX_TEXT_LENGTH).toBe(1_000)
    expect(MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema.properties.text.maxLength).toBe(
      ELEVENLABS_TTS_MAX_TEXT_LENGTH,
    )
    for (const guidanceSurface of [
      MURPH_GENERATE_VOICE_MEMO_TOOL.description,
      MURPH_GENERATE_VOICE_MEMO_TOOL.inputSchema.properties.text.description,
    ]) {
      expect(guidanceSurface).toContain(
        'Voice memo text is limited to at most 1,000 characters. Compress it before calling the tool.',
      )
    }
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

  it('returns value-free item-kind hints without executing unsupported media', async () => {
    const privateFilename = 'synthetic-private-memo.mp3'
    const privateAttachmentId = 'synthetic-private-attachment-ref'
    const request = readTestMurphDynamicToolRequest({
      id: 10,
      method: 'item/tool/call',
      params: {
        arguments: {
          media: [
            {
              kind: 'voice_memo',
              filename: privateFilename,
              transport: {
                attachmentId: privateAttachmentId,
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
    const generateAndUpload = vi.fn<LinqVoiceMemoRuntime['generateAndUpload']>()

    expect(request).toMatchObject({
      kind: 'invalid-response-media-arguments',
    })

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
      voiceMemoRuntime: createLinqRuntime(generateAndUpload),
    })

    const feedback = result.rpcResult.contentItems[0]?.text ?? ''
    expect(result.rpcResult.success).toBe(false)
    expect(feedback).toContain(
      '"field":"media[].kind","code":"invalid_union"',
    )
    expect(feedback).not.toContain('voice_memo')
    expect(feedback).not.toContain('image/jpeg')
    expect(feedback).not.toContain('vault_image')
    expect(feedback).not.toContain(privateFilename)
    expect(feedback).not.toContain(privateAttachmentId)
    expect(feedback).not.toContain('filename')
    expect(feedback).not.toContain('transport')
    expect(feedback).not.toContain('"received"')
    expect(result.responseMediaPatch).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(nextUsageOrdinal).not.toHaveBeenCalled()
    expect(generateAndUpload).not.toHaveBeenCalled()
  })

  it('returns value-free URL hints without executing invalid public media', async () => {
    const privateUrl =
      'http://synthetic-private.example.test/catalog/private-file.png?token=private'
    const request = readTestMurphDynamicToolRequest({
      id: 15,
      method: 'item/tool/call',
      params: {
        arguments: {
          media: [{ kind: 'image', url: privateUrl }],
        },
        namespace: 'murph',
        tool: 'attach_response_media',
      },
    })
    const fetchImpl = vi.fn<typeof fetch>()
    const nextUsageOrdinal = vi.fn(() => 99)
    const generateAndUpload = vi.fn<LinqVoiceMemoRuntime['generateAndUpload']>()

    expect(request).toMatchObject({
      kind: 'invalid-response-media-arguments',
    })

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
      voiceMemoRuntime: createLinqRuntime(generateAndUpload),
    })

    const feedback = result.rpcResult.contentItems[0]?.text ?? ''
    expect(result.rpcResult.success).toBe(false)
    expect(feedback).toContain(
      '"field":"media[].url","code":"custom","expected":"public_https_image_url"',
    )
    expect(feedback).not.toContain(privateUrl)
    expect(feedback).not.toContain('synthetic-private.example.test')
    expect(feedback).not.toContain('private-file.png')
    expect(feedback).not.toContain('token=private')
    expect(feedback).not.toContain('"received"')
    expect(result.responseMediaPatch).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(nextUsageOrdinal).not.toHaveBeenCalled()
    expect(generateAndUpload).not.toHaveBeenCalled()
  })

  it('returns an invalid-arguments result for malformed voice memo tool calls', async () => {
    const privateMarker = 'synthetic-private-voice-marker'
    const request = readTestMurphDynamicToolRequest({
      id: 11,
      method: 'item/tool/call',
      params: {
        arguments: {
          modelId: 'eleven_monolingual_v1',
          text: { privateMarker },
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })
    const fetchImpl = vi.fn<typeof fetch>()
    const nextUsageOrdinal = vi.fn(() => 99)
    const generateAndUpload = vi.fn<LinqVoiceMemoRuntime['generateAndUpload']>()

    expect(request).toMatchObject({
      kind: 'invalid-generate-voice-memo-arguments',
    })

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
      voiceMemoRuntime: createLinqRuntime(generateAndUpload),
    })

    const feedback = result.rpcResult.contentItems[0]?.text ?? ''
    expect(result.rpcResult.success).toBe(false)
    expect(feedback).toContain(
      '"field":"text","code":"invalid_type","expected":"string"',
    )
    expect(feedback).not.toContain(privateMarker)
    expect(feedback).not.toContain('privateMarker')
    expect(feedback).not.toContain('modelId')
    expect(feedback).not.toContain('"received"')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(nextUsageOrdinal).not.toHaveBeenCalled()
    expect(generateAndUpload).not.toHaveBeenCalled()
  })

  it('returns value-free response-media hints without attaching media', async () => {
    const privateMarker = 'synthetic-private-media-marker'
    const request = readTestMurphDynamicToolRequest({
      id: 14,
      method: 'item/tool/call',
      params: {
        arguments: {
          media: { privateMarker },
        },
        namespace: 'murph',
        tool: 'attach_response_media',
      },
    })
    expect(request).toMatchObject({ kind: 'invalid-response-media-arguments' })

    const fetchImpl = vi.fn<typeof fetch>()
    const nextUsageOrdinal = vi.fn(() => 99)
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
    })
    const feedback = result.rpcResult.contentItems[0]?.text ?? ''

    expect(result.rpcResult.success).toBe(false)
    expect(feedback).toContain(
      '"field":"media","code":"invalid_type","expected":"array"',
    )
    expect(feedback).not.toContain(privateMarker)
    expect(feedback).not.toContain('privateMarker')
    expect(feedback).not.toContain('"received"')
    expect(result.responseMediaPatch).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(nextUsageOrdinal).not.toHaveBeenCalled()
  })

  it('keeps the shared 1,000-character voice memo maximum strict', () => {
    const accepted = readTestMurphDynamicToolRequest({
      id: 12,
      method: 'item/tool/call',
      params: {
        arguments: {
          text: 'a'.repeat(ELEVENLABS_TTS_MAX_TEXT_LENGTH),
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })
    const rejected = readTestMurphDynamicToolRequest({
      id: 13,
      method: 'item/tool/call',
      params: {
        arguments: {
          text: 'a'.repeat(ELEVENLABS_TTS_MAX_TEXT_LENGTH + 1),
        },
        namespace: 'murph',
        tool: 'generate_voice_memo',
      },
    })

    expect(accepted).toMatchObject({ kind: 'generate-voice-memo' })
    expect(rejected).toMatchObject({
      kind: 'invalid-generate-voice-memo-arguments',
    })
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
    const request = readTestMurphDynamicToolRequest({
      id: 13,
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
        userRequestedVoiceOptionId: null,
      },
      kind: 'generate-voice-memo',
    })

    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async () => ({
      attachmentId: 'attachment_dynamic_1',
      filename: 'dynamic-voice-memo.mp3',
      ok: true,
    }))
    const fetchImpl = vi.fn<typeof fetch>()
    const nextUsageOrdinal = vi.fn(() => 99)
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal,
      progressDelivery: null,
      request: request!,
      voiceMemoRuntime: createLinqRuntime(generateAndUpload),
    })

    expect(generateAndUpload).toHaveBeenCalledTimes(1)
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
          filename: 'dynamic-voice-memo.mp3',
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
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('murph.generate_song dynamic tool execution', () => {
  it('forces the trusted turn duration before song generation', async () => {
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async () => ({
      attachmentId: 'attachment_song_policy',
      filename: 'sponsor-song.mp3',
      ok: true,
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
      voiceMemoRuntime: createLinqRuntime(generateAndUpload),
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
    const generateAndUpload = vi.fn<
      LinqVoiceMemoRuntime['generateAndUpload']
    >(async () => ({
      failure: {
        detail: 'ELEVENLABS_API_REQUEST_FAILED (http 503)',
        kind: 'generation_failed',
      },
      ok: false,
    }))
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
      voiceMemoRuntime: createLinqRuntime(generateAndUpload),
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
