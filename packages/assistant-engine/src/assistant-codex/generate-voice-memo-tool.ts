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

import { normalizeNullableString } from '../assistant/shared.js'

export interface GenerateVoiceMemoToolArgs {
  modelId: string | null
  text: string
  voiceId: string | null
}

export interface GenerateVoiceMemoToolResult {
  responseMedia?: AssistantResponseMedia[]
  rpcSuccess: boolean
  rpcText: string
}

const MAX_VOICE_MEMO_BYTES = 10 * 1024 * 1024

export async function executeGenerateVoiceMemoTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateVoiceMemoToolArgs
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  publicFetchImpl?: typeof fetch | null
  voiceMemoDeliveryAvailable?: boolean | null
}): Promise<GenerateVoiceMemoToolResult> {
  if (input.voiceMemoDeliveryAvailable !== true) {
    return {
      rpcSuccess: false,
      rpcText: 'voice memo generation is only available for deliverable iMessage replies',
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

  const linqApiToken = resolveLinqApiToken(input.env)
  if (!linqApiToken) {
    return {
      rpcSuccess: false,
      rpcText: 'LINQ_API_TOKEN is required for voice memo attachment upload',
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

  const modelId =
    normalizeNullableString(input.args.modelId) ??
    resolveElevenLabsModelId(input.env)
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
    }
  }

  const filename = `voice-memo-${randomUUID()}.${speech.filenameExtension}`
  try {
    const upload = await createLinqAttachmentUpload(
      {
        contentType: speech.contentType,
        filename,
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
          filename,
          sizeBytes: speech.bytes.byteLength,
          transcript: input.args.text,
          source: 'elevenlabs',
          voiceId,
          modelId,
          transportRefs: {
            linq: {
              attachmentId: upload.attachmentId,
              downloadUrl: upload.downloadUrl,
            },
          },
        },
      ],
      rpcSuccess: true,
      rpcText: 'generated voice memo attached to the final response',
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return {
      rpcSuccess: false,
      rpcText: 'voice memo generated but Linq attachment upload failed',
    }
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
