import { randomUUID } from 'node:crypto'

import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  generateElevenLabsSpeech,
  resolveElevenLabsApiKey,
  resolveElevenLabsModelId,
  resolveElevenLabsVoiceId,
} from '@murphai/operator-config/elevenlabs-runtime'
import {
  createLinqAttachmentUpload,
  resolveLinqApiToken,
  uploadLinqAttachmentBytes,
} from '@murphai/operator-config/linq-runtime'
import {
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
} from '@murphai/hosted-execution/runtime-control'

import { hashAssistantProviderStableJson } from '../assistant/providers/helpers.js'
import type {
  AssistantProviderUsageDraft,
} from '../assistant/providers/types.js'
import { normalizeNullableString } from '../assistant/shared.js'

export interface GenerateVoiceMemoToolArgs {
  text: string
  voiceId: string | null
}

export interface GenerateVoiceMemoToolResult {
  responseMedia?: AssistantResponseMedia[]
  rpcSuccess: boolean
  rpcText: string
  usageDraft?: AssistantProviderUsageDraft | null
}

export type VoiceMemoDeliveryChannel = 'linq' | 'telegram'

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io'
const ELEVENLABS_TTS_USAGE_EXTRACTION_VERSION = 'elevenlabs-tts-v1'
const MAX_VOICE_MEMO_BYTES = 10 * 1024 * 1024

export async function executeGenerateVoiceMemoTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateVoiceMemoToolArgs
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  providerRequestOrdinal?: number | null
  publicFetchImpl?: typeof fetch | null
  voiceMemoDeliveryChannel?: VoiceMemoDeliveryChannel | null
}): Promise<GenerateVoiceMemoToolResult> {
  const deliveryChannel = resolveVoiceMemoDeliveryChannel(
    input.voiceMemoDeliveryChannel,
  )
  if (!deliveryChannel) {
    return {
      rpcSuccess: false,
      rpcText: 'voice memo generation is only available for deliverable iMessage or Telegram replies',
    }
  }

  if ((input.currentResponseMedia ?? []).length > 0) {
    return {
      rpcSuccess: false,
      rpcText: 'voice memo generation cannot be combined with other response media',
    }
  }

  const apiKey = resolveElevenLabsApiKey(input.env)
  if (!apiKey) {
    return {
      rpcSuccess: false,
      rpcText: 'ELEVENLABS_API_KEY is required for voice memo generation',
    }
  }

  const voiceId =
    normalizeNullableString(input.args.voiceId) ??
    resolveElevenLabsVoiceId(input.env)
  if (!voiceId) {
    return {
      rpcSuccess: false,
      rpcText: 'MURPH_ELEVENLABS_VOICE_ID is required for voice memo generation',
    }
  }

  const modelId = normalizeHostedAiUsageAllowanceElevenLabsTtsModelId(
    resolveElevenLabsModelId(input.env),
  )
  if (!modelId) {
    return {
      rpcSuccess: false,
      rpcText: 'MURPH_ELEVENLABS_MODEL_ID must be a priced ElevenLabs TTS model',
    }
  }

  if (deliveryChannel === 'telegram') {
    const filename = `voice-memo-${randomUUID()}.mp3`
    return {
      responseMedia: [
        {
          kind: 'voice_memo',
          url: null,
          mimeType: 'audio/mpeg',
          filename,
          sizeBytes: null,
          transcript: input.args.text,
          source: 'elevenlabs',
          voiceId,
          modelId,
          transportRefs: {
            telegram: {
              sendMode: 'generate_at_delivery',
            },
          },
        },
      ],
      rpcSuccess: true,
      rpcText: 'generated voice memo attached to the final response',
      usageDraft: null,
    }
  }

  const linqApiToken = resolveLinqApiToken(input.env)
  if (!linqApiToken) {
    return {
      rpcSuccess: false,
      rpcText: 'LINQ_API_TOKEN is required for voice memo attachment upload',
    }
  }
  const usageDraft = buildGeneratedVoiceMemoUsageDraft({
    characterCount: input.args.text.length,
    modelId,
    providerRequestOrdinal: input.providerRequestOrdinal ?? 0,
    voiceId,
  })
  const fetchImplementation = createStringFetchAdapter(input.fetchImpl)
  const uploadFetchImplementation = createStringFetchAdapter(
    input.publicFetchImpl ?? input.fetchImpl,
  )
  let speech: Awaited<ReturnType<typeof generateElevenLabsSpeech>>
  try {
    speech = await generateElevenLabsSpeech({
      apiKey,
      fetchImplementation,
      modelId,
      signal: input.abortSignal ?? undefined,
      text: input.args.text,
      voiceId,
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return {
      rpcSuccess: false,
      rpcText: 'voice memo generation failed',
    }
  }

  if (
    speech.bytes.byteLength === 0 ||
    speech.bytes.byteLength > MAX_VOICE_MEMO_BYTES
  ) {
    return {
      rpcSuccess: false,
      rpcText: 'voice memo generation returned invalid audio data',
      usageDraft,
    }
  }

  const linqFilename = `voice-memo-${randomUUID()}.${speech.filenameExtension}`
  try {
    const upload = await createLinqAttachmentUpload(
      {
        contentType: speech.contentType,
        filename: linqFilename,
        sizeBytes: speech.bytes.byteLength,
      },
      {
        env: input.env,
        fetchImplementation,
        signal: input.abortSignal ?? undefined,
      },
    )
    await uploadLinqAttachmentBytes(
      {
        bytes: speech.bytes,
        requiredHeaders: upload.requiredHeaders,
        uploadUrl: upload.uploadUrl,
      },
      {
        fetchImplementation: uploadFetchImplementation,
        signal: input.abortSignal ?? undefined,
      },
    )

    return {
      responseMedia: [
        {
          kind: 'voice_memo',
          url: null,
          mimeType: speech.contentType,
          filename: linqFilename,
          sizeBytes: speech.bytes.byteLength,
          transcript: input.args.text,
          source: 'elevenlabs',
          voiceId,
          modelId,
          transportRefs: {
            linq: {
              attachmentId: upload.attachmentId,
            },
          },
        },
      ],
      rpcSuccess: true,
      rpcText: 'generated voice memo attached to the final response',
      usageDraft,
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return {
      rpcSuccess: false,
      rpcText: 'voice memo generated but Linq attachment upload failed',
      usageDraft,
    }
  }
}

function resolveVoiceMemoDeliveryChannel(
  channel: VoiceMemoDeliveryChannel | null | undefined,
): VoiceMemoDeliveryChannel | null {
  if (channel === 'linq' || channel === 'telegram') {
    return channel
  }
  return null
}

function buildGeneratedVoiceMemoUsageDraft(input: {
  characterCount: number
  modelId: string
  providerRequestOrdinal: number
  voiceId: string
}): AssistantProviderUsageDraft {
  const rawUsageJson = {
    characterCount: input.characterCount,
  }
  return {
    provider: 'elevenlabs',
    providerRequestOrdinal: input.providerRequestOrdinal,
    providerRequestOutcome: 'succeeded',
    usage: {
      apiKeyEnv: 'ELEVENLABS_API_KEY',
      baseUrl: ELEVENLABS_BASE_URL,
      cacheWriteTokens: null,
      cachedInputTokens: null,
      inputTokens: null,
      outputTokens: null,
      providerMetadataJson: {
        operation: 'text_to_speech',
        voiceId: input.voiceId,
      },
      providerName: 'ElevenLabs',
      providerRequestId: null,
      rawUsageJson,
      rawUsageJsonHash: hashAssistantProviderStableJson(rawUsageJson),
      reasoningTokens: null,
      requestedModel: input.modelId,
      servedModel: null,
      totalTokens: null,
      usageExtractionSourcePath: 'elevenlabs.text_to_speech',
      usageExtractionVersion: ELEVENLABS_TTS_USAGE_EXTRACTION_VERSION,
    },
  }
}

function createStringFetchAdapter(fetchImpl: typeof fetch) {
  return async (
    input: string,
    init: {
      body?: string | Blob
      headers?: Record<string, string>
      method: string
      signal?: AbortSignal
    },
  ) => fetchImpl(input, init)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
