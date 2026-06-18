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
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128'

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

export interface GenerateElevenLabsSpeechResult {
  bytes: Uint8Array
  contentType: 'audio/mpeg'
  filenameExtension: 'mp3'
}

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
  outputFormat?: typeof ELEVENLABS_OUTPUT_FORMAT
  signal?: AbortSignal
  text: string
  voiceId: string
}): Promise<GenerateElevenLabsSpeechResult> {
  const apiKey = normalizeRequiredElevenLabsString(input.apiKey, 'api key')
  const voiceId = normalizeRequiredElevenLabsString(input.voiceId, 'voice id')
  const modelId = normalizeRequiredElevenLabsString(input.modelId, 'model id')
  const text = normalizeRequiredElevenLabsString(input.text, 'text')
  const fetchImplementation =
    input.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw new VaultCliError(
      'ELEVENLABS_UNAVAILABLE',
      'ElevenLabs speech generation requires fetch support in the current Node.js runtime.',
      {
        failureStage: 'configuration',
        provider: 'elevenlabs',
      },
    )
  }

  const url = new URL(
    `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    DEFAULT_ELEVENLABS_API_BASE_URL,
  )
  url.searchParams.set('output_format', input.outputFormat ?? ELEVENLABS_OUTPUT_FORMAT)
  const timeout = createTimeoutAbortController(input.signal, ELEVENLABS_TTS_TIMEOUT_MS)
  try {
    const response = await fetchImplementation(url.toString(), {
      body: JSON.stringify({
        model_id: modelId,
        text,
      }),
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
        `ElevenLabs speech request failed with HTTP ${response.status}.`,
        {
          failureStage: 'http',
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
        ? `ElevenLabs speech request timed out after ${ELEVENLABS_TTS_TIMEOUT_MS}ms.`
        : 'ElevenLabs speech request failed before a response was returned.',
      {
        failureStage: 'transport',
        provider: 'elevenlabs',
        retryable: true,
        timeoutMs: ELEVENLABS_TTS_TIMEOUT_MS,
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
    throw new VaultCliError(
      'ELEVENLABS_INVALID_INPUT',
      `ElevenLabs ${label} must be a non-empty string.`,
      {
        failureStage: 'configuration',
        provider: 'elevenlabs',
      },
    )
  }

  return normalized
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
