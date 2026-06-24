import type {
  AssistantVoiceMemoGeneration,
} from './assistant-cli-contracts.js'
import {
  assistantVoiceMemoMusicModelId,
  assistantVoiceMemoMusicOutputFormat,
  assistantVoiceMemoSpeechOutputFormat,
} from './assistant-cli-contracts.js'
import {
  createTimeoutAbortController,
  type ResponseHeadersLike,
} from './http-retry.js'
import {
  errorMessage,
  normalizeNullableString,
} from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_ELEVENLABS_API_BASE_URL = 'https://api.elevenlabs.io'
const DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2'
const ELEVENLABS_TTS_TIMEOUT_MS = 30_000
const ELEVENLABS_MUSIC_TIMEOUT_MS = 5 * 60_000

export const ELEVENLABS_TTS_OUTPUT_FORMAT = assistantVoiceMemoSpeechOutputFormat
export const ELEVENLABS_MUSIC_MODEL_ID = assistantVoiceMemoMusicModelId
export const ELEVENLABS_MUSIC_OUTPUT_FORMAT = assistantVoiceMemoMusicOutputFormat

export interface ElevenLabsFetchResponse {
  arrayBuffer(): Promise<ArrayBuffer>
  headers?: ResponseHeadersLike | null
  ok: boolean
  status: number
  text(): Promise<string>
}

export type ElevenLabsFetch = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<ElevenLabsFetchResponse>

export interface GenerateElevenLabsAudioResult {
  bytes: Uint8Array
  contentType: 'audio/mpeg'
  filenameExtension: 'mp3'
}

export type GenerateElevenLabsSpeechResult = GenerateElevenLabsAudioResult

export function resolveElevenLabsApiKey(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.ELEVENLABS_API_KEY)
}

export function resolveElevenLabsVoiceId(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.MURPH_ELEVENLABS_VOICE_ID)
}

export function resolveElevenLabsModelId(env: NodeJS.ProcessEnv): string {
  return normalizeNullableString(env.MURPH_ELEVENLABS_MODEL_ID) ??
    DEFAULT_ELEVENLABS_MODEL_ID
}

export async function generateElevenLabsSpeech(input: {
  apiKey: string
  fetchImplementation?: ElevenLabsFetch
  modelId: string
  outputFormat?: typeof ELEVENLABS_TTS_OUTPUT_FORMAT
  signal?: AbortSignal
  text: string
  voiceId: string
}): Promise<GenerateElevenLabsSpeechResult> {
  const voiceId = normalizeRequiredElevenLabsString(input.voiceId, 'voice id')
  const modelId = normalizeRequiredElevenLabsString(input.modelId, 'model id')
  const text = normalizeRequiredElevenLabsString(input.text, 'text')

  return await requestElevenLabsAudio({
    apiKey: input.apiKey,
    body: {
      model_id: modelId,
      text,
    },
    fetchImplementation: input.fetchImplementation,
    operation: 'speech',
    outputFormat: input.outputFormat ?? ELEVENLABS_TTS_OUTPUT_FORMAT,
    path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    signal: input.signal,
    timeoutMs: ELEVENLABS_TTS_TIMEOUT_MS,
  })
}

export async function generateElevenLabsMusic(input: {
  apiKey: string
  durationMs: number
  fetchImplementation?: ElevenLabsFetch
  forceInstrumental: boolean
  modelId: typeof ELEVENLABS_MUSIC_MODEL_ID
  outputFormat: typeof ELEVENLABS_MUSIC_OUTPUT_FORMAT
  prompt: string
  signal?: AbortSignal
}): Promise<GenerateElevenLabsAudioResult> {
  const prompt = normalizeRequiredElevenLabsString(input.prompt, 'music prompt')
  if (prompt.length > 4100) {
    throw createElevenLabsInvalidInputError(
      'ElevenLabs music prompt must contain at most 4100 characters.',
    )
  }
  if (
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 3_000 ||
    input.durationMs > 300_000
  ) {
    throw createElevenLabsInvalidInputError(
      'ElevenLabs music duration must be an integer between 3000ms and 300000ms.',
    )
  }
  if (input.modelId !== ELEVENLABS_MUSIC_MODEL_ID) {
    throw createElevenLabsInvalidInputError(
      `ElevenLabs music model must be ${ELEVENLABS_MUSIC_MODEL_ID}.`,
    )
  }
  if (input.outputFormat !== ELEVENLABS_MUSIC_OUTPUT_FORMAT) {
    throw createElevenLabsInvalidInputError(
      `ElevenLabs music output format must be ${ELEVENLABS_MUSIC_OUTPUT_FORMAT}.`,
    )
  }

  return await requestElevenLabsAudio({
    apiKey: input.apiKey,
    body: {
      force_instrumental: input.forceInstrumental,
      model_id: input.modelId,
      music_length_ms: input.durationMs,
      prompt,
    },
    fetchImplementation: input.fetchImplementation,
    operation: 'music',
    outputFormat: input.outputFormat,
    path: '/v1/music',
    signal: input.signal,
    timeoutMs: ELEVENLABS_MUSIC_TIMEOUT_MS,
  })
}

export async function generateElevenLabsVoiceMemoAudio(input: {
  apiKey: string
  fetchImplementation?: ElevenLabsFetch
  generation: AssistantVoiceMemoGeneration
  signal?: AbortSignal
}): Promise<GenerateElevenLabsAudioResult> {
  switch (input.generation.kind) {
    case 'elevenlabs_speech':
      return await generateElevenLabsSpeech({
        apiKey: input.apiKey,
        fetchImplementation: input.fetchImplementation,
        modelId: input.generation.modelId,
        outputFormat: input.generation.outputFormat,
        signal: input.signal,
        text: input.generation.text,
        voiceId: input.generation.voiceId,
      })
    case 'elevenlabs_music':
      return await generateElevenLabsMusic({
        apiKey: input.apiKey,
        durationMs: input.generation.durationMs,
        fetchImplementation: input.fetchImplementation,
        forceInstrumental: input.generation.forceInstrumental,
        modelId: input.generation.modelId,
        outputFormat: input.generation.outputFormat,
        prompt: input.generation.prompt,
        signal: input.signal,
      })
  }
}

async function requestElevenLabsAudio(input: {
  apiKey: string
  body: Record<string, unknown>
  fetchImplementation?: ElevenLabsFetch
  operation: 'music' | 'speech'
  outputFormat: string
  path: string
  signal?: AbortSignal
  timeoutMs: number
}): Promise<GenerateElevenLabsAudioResult> {
  const apiKey = normalizeRequiredElevenLabsString(input.apiKey, 'api key')
  const fetchImplementation =
    input.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw new VaultCliError(
      'ELEVENLABS_UNAVAILABLE',
      `ElevenLabs ${input.operation} generation requires fetch support in the current Node.js runtime.`,
      {
        failureStage: 'configuration',
        provider: 'elevenlabs',
      },
    )
  }

  const url = new URL(input.path, DEFAULT_ELEVENLABS_API_BASE_URL)
  url.searchParams.set('output_format', input.outputFormat)
  const timeout = createTimeoutAbortController(input.signal, input.timeoutMs)
  try {
    const response = await fetchImplementation(url.toString(), {
      body: JSON.stringify(input.body),
      headers: {
        accept: 'audio/mpeg',
        'content-type': 'application/json',
        'xi-api-key': apiKey,
      },
      method: 'POST',
      signal: timeout.signal,
    })

    if (!response.ok) {
      const responseBodyTextLength = await readResponseTextLength(response)
      throw new VaultCliError(
        'ELEVENLABS_API_REQUEST_FAILED',
        `ElevenLabs ${input.operation} request failed with HTTP ${response.status}.`,
        {
          failureStage: 'http',
          operation: input.operation,
          provider: 'elevenlabs',
          responseBodyTextLength,
          retryable: response.status === 408 || response.status === 429 ||
            response.status >= 500,
          status: response.status,
        },
      )
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: 'audio/mpeg',
      filenameExtension: 'mp3',
    }
  } catch (error) {
    if (error instanceof VaultCliError) {
      throw error
    }
    if (input.signal?.aborted) {
      throw error
    }
    throw new VaultCliError(
      'ELEVENLABS_API_REQUEST_FAILED',
      timeout.timedOut()
        ? `ElevenLabs ${input.operation} request timed out after ${input.timeoutMs}ms.`
        : `ElevenLabs ${input.operation} request failed before a response was returned.`,
      {
        failureStage: 'transport',
        operation: input.operation,
        provider: 'elevenlabs',
        retryable: true,
        timeoutMs: input.timeoutMs,
        timedOut: timeout.timedOut(),
        transportErrorName: readSafeTransportErrorName(error),
        transportErrorTextLength: errorMessage(error).length,
      },
    )
  } finally {
    timeout.cleanup()
  }
}

function normalizeRequiredElevenLabsString(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw createElevenLabsInvalidInputError(
      `ElevenLabs ${label} must be a non-empty string.`,
    )
  }

  return normalized
}

function createElevenLabsInvalidInputError(message: string): VaultCliError {
  return new VaultCliError(
    'ELEVENLABS_INVALID_INPUT',
    message,
    {
      failureStage: 'configuration',
      provider: 'elevenlabs',
    },
  )
}

async function readResponseTextLength(
  response: Pick<ElevenLabsFetchResponse, 'text'>,
): Promise<number | null> {
  try {
    return (await response.text()).length
  } catch {
    return null
  }
}

function readSafeTransportErrorName(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(error.name) ? error.name : null
}
