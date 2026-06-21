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

import { normalizeNullableString } from '../assistant/shared.js'

export interface GenerateVoiceMemoToolArgs {
  text: string
  voiceId: string | null
}

export interface GenerateVoiceMemoToolResult {
  responseMedia?: AssistantResponseMedia[]
  rpcSuccess: boolean
  rpcText: string
}

export type VoiceMemoDeliveryChannel = 'linq' | 'telegram'

export interface VoiceMemoElevenLabsRuntimeConfig {
  apiKeyAvailable: boolean
  modelId: string | null
  voiceId: string | null
}

export type VoiceMemoToolRuntime =
  | {
      elevenLabs: VoiceMemoElevenLabsRuntimeConfig
      kind: 'telegram'
    }
  | {
      elevenLabs: VoiceMemoElevenLabsRuntimeConfig
      generateAndUpload(input: {
        filenameBase: string
        modelId: string
        signal?: AbortSignal | null
        text: string
        voiceId: string
      }): Promise<{
        attachmentId: string
        contentType: 'audio/mpeg'
        filename: string
        sizeBytes: number
      }>
      kind: 'linq'
    }

const MAX_VOICE_MEMO_BYTES = 10 * 1024 * 1024

export async function executeGenerateVoiceMemoTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateVoiceMemoToolArgs
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  runtime?: VoiceMemoToolRuntime | null
}): Promise<GenerateVoiceMemoToolResult> {
  const runtime = input.runtime ?? null
  if (!runtime) {
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

  if (!runtime.elevenLabs.apiKeyAvailable) {
    return {
      rpcSuccess: false,
      rpcText: 'ELEVENLABS_API_KEY is required for voice memo generation',
    }
  }

  const voiceId =
    normalizeNullableString(input.args.voiceId) ??
    runtime.elevenLabs.voiceId
  if (!voiceId) {
    return {
      rpcSuccess: false,
      rpcText: 'MURPH_ELEVENLABS_VOICE_ID is required for voice memo generation',
    }
  }

  const modelId = runtime.elevenLabs.modelId
  if (!modelId) {
    return {
      rpcSuccess: false,
      rpcText: 'MURPH_ELEVENLABS_MODEL_ID must be a priced ElevenLabs TTS model',
    }
  }

  if (runtime.kind === 'telegram') {
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
    }
  }

  const filenameBase = `voice-memo-${randomUUID()}`
  let upload: Awaited<ReturnType<typeof runtime.generateAndUpload>>
  try {
    upload = await runtime.generateAndUpload({
      filenameBase,
      modelId,
      signal: input.abortSignal ?? null,
      text: input.args.text,
      voiceId,
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    if (error instanceof VoiceMemoToolConfigurationError) {
      return {
        rpcSuccess: false,
        rpcText: error.rpcText,
      }
    }
    if (error instanceof VoiceMemoToolGenerationError) {
      return {
        rpcSuccess: false,
        rpcText: error.rpcText,
      }
    }
    return {
      rpcSuccess: false,
      rpcText: 'voice memo generated but Linq attachment upload failed',
    }
  }

  return {
    responseMedia: [
      {
        kind: 'voice_memo',
        url: null,
        mimeType: upload.contentType,
        filename: upload.filename,
        sizeBytes: upload.sizeBytes,
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
  }
}

export function createVoiceMemoToolRuntimeFromEnv(input: {
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  publicFetchImpl?: typeof fetch | null
  voiceMemoDeliveryChannel?: VoiceMemoDeliveryChannel | null
}): VoiceMemoToolRuntime | null {
  const deliveryChannel = resolveVoiceMemoDeliveryChannel(
    input.voiceMemoDeliveryChannel,
  )
  if (!deliveryChannel) {
    return null
  }

  const apiKey = resolveElevenLabsApiKey(input.env)
  const elevenLabs: VoiceMemoElevenLabsRuntimeConfig = {
    apiKeyAvailable: apiKey !== null,
    modelId: normalizeHostedAiUsageAllowanceElevenLabsTtsModelId(
      resolveElevenLabsModelId(input.env),
    ),
    voiceId: resolveElevenLabsVoiceId(input.env),
  }

  if (deliveryChannel === 'telegram') {
    return {
      elevenLabs,
      kind: 'telegram',
    }
  }

  const fetchImplementation = createStringFetchAdapter(input.fetchImpl)
  const uploadFetchImplementation = createStringFetchAdapter(
    input.publicFetchImpl ?? input.fetchImpl,
  )

  return {
    elevenLabs,
    kind: 'linq',
    generateAndUpload: async (request) => {
      if (!apiKey) {
        throw new VoiceMemoToolConfigurationError(
          'ELEVENLABS_API_KEY is required for voice memo generation',
        )
      }
      const linqApiToken = resolveLinqApiToken(input.env)
      if (!linqApiToken) {
        throw new VoiceMemoToolConfigurationError(
          'LINQ_API_TOKEN is required for voice memo attachment upload',
        )
      }

      let speech: Awaited<ReturnType<typeof generateElevenLabsSpeech>>
      try {
        speech = await generateElevenLabsSpeech({
          apiKey,
          fetchImplementation,
          modelId: request.modelId,
          signal: request.signal ?? undefined,
          text: request.text,
          voiceId: request.voiceId,
        })
      } catch (error) {
        if (isAbortError(error)) {
          throw error
        }
        throw new VoiceMemoToolGenerationError('voice memo generation failed')
      }

      if (
        speech.bytes.byteLength === 0 ||
        speech.bytes.byteLength > MAX_VOICE_MEMO_BYTES
      ) {
        throw new VoiceMemoToolGenerationError(
          'voice memo generation returned invalid audio data',
        )
      }

      const linqFilename = `${request.filenameBase}.${speech.filenameExtension}`
      const upload = await createLinqAttachmentUpload(
        {
          contentType: speech.contentType,
          filename: linqFilename,
          sizeBytes: speech.bytes.byteLength,
        },
        {
          env: input.env,
          fetchImplementation,
          signal: request.signal ?? undefined,
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
          signal: request.signal ?? undefined,
        },
      )

      return {
        attachmentId: upload.attachmentId,
        contentType: speech.contentType,
        filename: linqFilename,
        sizeBytes: speech.bytes.byteLength,
      }
    },
  }
}

class VoiceMemoToolConfigurationError extends Error {
  constructor(readonly rpcText: string) {
    super(rpcText)
  }
}

class VoiceMemoToolGenerationError extends Error {
  constructor(readonly rpcText: string) {
    super(rpcText)
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
