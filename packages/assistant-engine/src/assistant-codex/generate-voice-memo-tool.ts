import { randomUUID } from 'node:crypto'

import {
  assistantVoiceMemoMusicModelId,
  assistantVoiceMemoMusicOutputFormat,
  assistantVoiceMemoSpeechOutputFormat,
  type AssistantResponseMedia,
  type AssistantVoiceMemoGeneration,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  generateElevenLabsVoiceMemoAudio,
  resolveElevenLabsApiKey,
  resolveElevenLabsModelId,
  resolveElevenLabsVoiceId,
} from '@murphai/operator-config/elevenlabs-runtime'
import {
  resolveLinqApiToken,
  uploadLinqAttachment,
} from '@murphai/operator-config/linq-runtime'
import {
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
} from '@murphai/hosted-execution/runtime-control'

import { normalizeNullableString } from '../assistant/shared.js'

export interface GenerateVoiceMemoToolArgs {
  text: string
  voiceId: string | null
}

export interface GenerateSongToolArgs {
  durationSeconds: number
  instrumental: boolean
  prompt: string
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
        generation: AssistantVoiceMemoGeneration
        signal?: AbortSignal | null
      }): Promise<{
        attachmentId: string
        filename: string
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
  const mediaConflict = rejectIfResponseMediaConflicts(
    input.currentResponseMedia ?? [],
    'voice memo',
  )
  if (mediaConflict) {
    return mediaConflict
  }

  const runtime = input.runtime ?? null
  if (!runtime) {
    return unavailableVoiceMemoResult('voice memo')
  }

  const preflight = validateElevenLabsApiKeyPrecondition(runtime, 'voice memo')
  if (preflight) {
    return preflight
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

  return await executeGeneratedVoiceMemo({
    filenameBase: `voice-memo-${randomUUID()}`,
    generation: {
      kind: 'elevenlabs_speech',
      modelId,
      outputFormat: assistantVoiceMemoSpeechOutputFormat,
      text: input.args.text,
      voiceId,
    },
    runtime,
    signal: input.abortSignal ?? null,
  })
}

export async function executeGenerateSongTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateSongToolArgs
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  runtime?: VoiceMemoToolRuntime | null
}): Promise<GenerateVoiceMemoToolResult> {
  const mediaConflict = rejectIfResponseMediaConflicts(
    input.currentResponseMedia ?? [],
    'song',
  )
  if (mediaConflict) {
    return mediaConflict
  }

  const runtime = input.runtime ?? null
  if (!runtime) {
    return unavailableVoiceMemoResult('song')
  }

  const preflight = validateElevenLabsApiKeyPrecondition(runtime, 'song')
  if (preflight) {
    return preflight
  }

  return await executeGeneratedVoiceMemo({
    filenameBase: `song-${randomUUID()}`,
    generation: {
      durationMs: input.args.durationSeconds * 1_000,
      forceInstrumental: input.args.instrumental,
      kind: 'elevenlabs_music',
      modelId: assistantVoiceMemoMusicModelId,
      outputFormat: assistantVoiceMemoMusicOutputFormat,
      prompt: input.args.prompt,
    },
    runtime,
    signal: input.abortSignal ?? null,
  })
}

async function executeGeneratedVoiceMemo(input: {
  filenameBase: string
  generation: AssistantVoiceMemoGeneration
  runtime: VoiceMemoToolRuntime
  signal: AbortSignal | null
}): Promise<GenerateVoiceMemoToolResult> {
  const { label, transcript } = describeVoiceMemoGeneration(input.generation)
  const filename = `${input.filenameBase}.mp3`
  if (input.runtime.kind === 'telegram') {
    return {
      responseMedia: [
        {
          kind: 'voice_memo',
          filename,
          transcript,
          transport: {
            generation: input.generation,
            kind: 'telegram_generation',
          },
        },
      ],
      rpcSuccess: true,
      rpcText: `generated ${label} attached to the final response`,
    }
  }

  let upload: Awaited<ReturnType<typeof input.runtime.generateAndUpload>>
  try {
    upload = await input.runtime.generateAndUpload({
      filenameBase: input.filenameBase,
      generation: input.generation,
      signal: input.signal,
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    if (
      error instanceof VoiceMemoToolConfigurationError ||
      error instanceof VoiceMemoToolGenerationError
    ) {
      return {
        rpcSuccess: false,
        rpcText: error.rpcText,
      }
    }
    return {
      rpcSuccess: false,
      rpcText: `${label} generated but Linq attachment upload failed`,
    }
  }

  return {
    responseMedia: [
      {
        kind: 'voice_memo',
        filename: upload.filename,
        transcript,
        transport: {
          attachmentId: upload.attachmentId,
          kind: 'linq_attachment',
        },
      },
    ],
    rpcSuccess: true,
    rpcText: `generated ${label} attached to the final response`,
  }
}

type VoiceMemoGenerationLabel = 'song' | 'voice memo'

function rejectIfResponseMediaConflicts(
  currentResponseMedia: readonly AssistantResponseMedia[],
  label: VoiceMemoGenerationLabel,
): GenerateVoiceMemoToolResult | null {
  if (currentResponseMedia.length === 0) {
    return null
  }
  return {
    rpcSuccess: false,
    rpcText: `${label} generation cannot be combined with other response media`,
  }
}

function validateElevenLabsApiKeyPrecondition(
  runtime: VoiceMemoToolRuntime,
  label: VoiceMemoGenerationLabel,
): GenerateVoiceMemoToolResult | null {
  if (!runtime.elevenLabs.apiKeyAvailable) {
    return {
      rpcSuccess: false,
      rpcText: `ELEVENLABS_API_KEY is required for ${label} generation`,
    }
  }
  return null
}

function unavailableVoiceMemoResult(
  label: VoiceMemoGenerationLabel,
): GenerateVoiceMemoToolResult {
  return {
    rpcSuccess: false,
    rpcText: `${label} generation is only available for deliverable iMessage or Telegram replies`,
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
      const { label } = describeVoiceMemoGeneration(request.generation)
      if (!apiKey) {
        throw new VoiceMemoToolConfigurationError(
          `ELEVENLABS_API_KEY is required for ${label} generation`,
        )
      }
      const linqApiToken = resolveLinqApiToken(input.env)
      if (!linqApiToken) {
        throw new VoiceMemoToolConfigurationError(
          `LINQ_API_TOKEN is required for ${label} attachment upload`,
        )
      }

      let audio: Awaited<ReturnType<typeof generateElevenLabsVoiceMemoAudio>>
      try {
        audio = await generateElevenLabsVoiceMemoAudio({
          apiKey,
          fetchImplementation,
          generation: request.generation,
          signal: request.signal ?? undefined,
        })
      } catch (error) {
        if (isAbortError(error)) {
          throw error
        }
        throw new VoiceMemoToolGenerationError(`${label} generation failed`)
      }

      if (
        audio.bytes.byteLength === 0 ||
        audio.bytes.byteLength > MAX_VOICE_MEMO_BYTES
      ) {
        throw new VoiceMemoToolGenerationError(
          `${label} generation returned invalid audio data`,
        )
      }

      const linqFilename = `${request.filenameBase}.${audio.filenameExtension}`
      const upload = await uploadLinqAttachment(
        {
          bytes: audio.bytes,
          contentType: audio.contentType,
          filename: linqFilename,
        },
        {
          env: input.env,
          fetchImplementation,
          publicFetchImplementation: uploadFetchImplementation,
          signal: request.signal ?? undefined,
        },
      )

      return {
        attachmentId: upload.attachmentId,
        filename: linqFilename,
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

function describeVoiceMemoGeneration(
  generation: AssistantVoiceMemoGeneration,
): { label: VoiceMemoGenerationLabel; transcript: string | null } {
  switch (generation.kind) {
    case 'elevenlabs_speech':
      return { label: 'voice memo', transcript: generation.text }
    case 'elevenlabs_music':
      return { label: 'song', transcript: null }
  }
}
