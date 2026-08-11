import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'

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
