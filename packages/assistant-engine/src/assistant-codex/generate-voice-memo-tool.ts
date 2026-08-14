import { randomUUID } from 'node:crypto'

import {
  resolveAssistantVoiceOption,
  type AssistantVoiceOptionId,
} from '@murphai/contracts'
import {
  normalizeHostedAiUsageAllowanceElevenLabsTtsModelId,
} from '@murphai/hosted-execution/runtime-control'
import {
  assistantVoiceMemoMusicModelId,
  assistantVoiceMemoMusicOutputFormat,
  assistantVoiceMemoSpeechOutputFormat,
  type AssistantResponseMedia,
  type AssistantVoiceMemoGeneration,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  resolveElevenLabsApiKey,
  resolveElevenLabsModelId,
  resolveElevenLabsVoiceId,
} from '@murphai/operator-config/elevenlabs-runtime'
import { describeVaultCliFailure } from '@murphai/operator-config/vault-cli-errors'

import { normalizeNullableString } from '../assistant/shared.js'
import { createManagedLinqVoiceMemoRuntimeFromEnv } from './managed-voice-memo-runtime.js'

export { createManagedLinqVoiceMemoRuntimeFromEnv }

export interface GenerateVoiceMemoToolArgs {
  text: string
  /** One-off roster voice explicitly named by the current user for this memo or test. */
  userRequestedVoiceOptionId?: AssistantVoiceOptionId | null
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
  defaultVoiceId?: string | null
  modelId: string | null
  voiceId: string | null
}

export type VoiceMemoToolRuntimeFailure =
  | {
      kind: 'generation_failed'
      detail: string | null
    }
  | {
      kind: 'invalid_audio'
    }
  | {
      kind: 'upload_failed'
      detail: string | null
    }
  | {
      kind: 'missing_configuration'
      variable: 'ELEVENLABS_API_KEY' | 'LINQ_API_TOKEN'
    }

export type VoiceMemoToolRuntimeResult =
  | {
      attachmentId: string
      filename: string
      ok?: true
    }
  | {
      failure: VoiceMemoToolRuntimeFailure
      ok: false
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
      }): Promise<VoiceMemoToolRuntimeResult>
      kind: 'linq'
    }

export function createVoiceMemoToolRuntimeFromEnv(input: {
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  preferredVoiceId?: string | null
  publicFetchImpl?: typeof fetch | null
  voiceMemoDeliveryChannel?: VoiceMemoDeliveryChannel | null
}): VoiceMemoToolRuntime | null {
  if (input.voiceMemoDeliveryChannel === 'linq') {
    return createManagedLinqVoiceMemoRuntimeFromEnv(input)
  }
  if (input.voiceMemoDeliveryChannel !== 'telegram') {
    return null
  }

  const defaultVoiceId = resolveElevenLabsVoiceId(input.env)
  return {
    elevenLabs: {
      apiKeyAvailable: resolveElevenLabsApiKey(input.env) !== null,
      defaultVoiceId,
      modelId: normalizeHostedAiUsageAllowanceElevenLabsTtsModelId(
        resolveElevenLabsModelId(input.env),
      ),
      voiceId:
        normalizeNullableString(input.preferredVoiceId) ?? defaultVoiceId,
    },
    kind: 'telegram',
  }
}

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

  const voiceId = resolveVoiceMemoVoiceId({
    args: input.args,
    runtime,
  })
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

function resolveVoiceMemoVoiceId(input: {
  args: GenerateVoiceMemoToolArgs
  runtime: VoiceMemoToolRuntime
}): string | null {
  const userRequestedVoiceOptionId =
    input.args.userRequestedVoiceOptionId ?? null
  if (userRequestedVoiceOptionId !== null) {
    const voiceOption = resolveAssistantVoiceOption(userRequestedVoiceOptionId)
    if (!voiceOption) {
      return null
    }

    return normalizeNullableString(voiceOption.elevenLabsVoiceId) ??
      normalizeNullableString(input.runtime.elevenLabs.defaultVoiceId)
  }

  return input.runtime.elevenLabs.voiceId
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

  let runtimeResult: VoiceMemoToolRuntimeResult
  try {
    runtimeResult = await input.runtime.generateAndUpload({
      filenameBase: input.filenameBase,
      generation: input.generation,
      signal: input.signal,
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return {
      rpcSuccess: false,
      rpcText: appendFailureDetail(
        `${label} generated but Linq attachment upload failed`,
        warnVoiceMemoFailure(`${label} Linq attachment upload`, error),
      ),
    }
  }

  if (runtimeResult.ok === false) {
    return {
      rpcSuccess: false,
      rpcText: describeVoiceMemoRuntimeFailure(label, runtimeResult.failure),
    }
  }

  return {
    responseMedia: [
      {
        kind: 'voice_memo',
        filename: runtimeResult.filename,
        transcript,
        transport: {
          attachmentId: runtimeResult.attachmentId,
          kind: 'linq_attachment',
        },
      },
    ],
    rpcSuccess: true,
    rpcText: `generated ${label} attached to the final response`,
  }
}

type VoiceMemoGenerationLabel = 'song' | 'voice memo'

function describeVoiceMemoRuntimeFailure(
  label: VoiceMemoGenerationLabel,
  failure: VoiceMemoToolRuntimeFailure,
): string {
  switch (failure.kind) {
    case 'generation_failed':
      return appendFailureDetail(`${label} generation failed`, failure.detail)
    case 'invalid_audio':
      return `${label} generation returned invalid audio data`
    case 'upload_failed':
      return appendFailureDetail(
        `${label} generated but Linq attachment upload failed`,
        failure.detail,
      )
    case 'missing_configuration':
      return failure.variable === 'LINQ_API_TOKEN'
        ? `${failure.variable} is required for ${label} attachment upload`
        : `${failure.variable} is required for ${label} generation`
  }
}

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

/**
 * Logs an unexpected delivery-adapter failure and returns its secret-safe
 * summary for the model-visible RPC result.
 */
function warnVoiceMemoFailure(operation: string, error: unknown): string | null {
  const failure = describeVaultCliFailure(error)
  console.warn(`Assistant ${operation} failed.`, {
    failure: failure ?? 'unknown',
    errorName: error instanceof Error ? error.name : typeof error,
  })
  return failure
}

function appendFailureDetail(rpcText: string, failure: string | null): string {
  return failure === null ? rpcText : `${rpcText}: ${failure}`
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
