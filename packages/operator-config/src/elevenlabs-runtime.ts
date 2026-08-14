import {
  ElevenLabsClient,
  ElevenLabsError,
  ElevenLabsTimeoutError,
} from '@elevenlabs/elevenlabs-js'

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
const ELEVENLABS_MUSIC_TIMEOUT_MS = 5 * 60_000
const ELEVENLABS_MAX_RETRIES = 0
const ELEVENLABS_ERROR_BODY_MAX_BYTES = 16 * 1024

// The longest supported music response is five minutes of 192 kbps MP3
// (roughly 7.2 MB). Leave ample codec/container headroom while preventing a
// provider or intermediary from exhausting the process with an unbounded body.
export const ELEVENLABS_AUDIO_MAX_BYTES = 16 * 1024 * 1024

// Speech synthesis time scales with the text, so the accepted length and the
// request timeout are one decision and must be read together. Measured against
// eleven_v3 on 2026-07-25: 300 chars took 8.6s, 600 took 17.8s, 900 took 23.0s,
// and 2900 took over 60s — roughly 25ms per character. The previous pairing
// accepted 4000 characters against a 30s timeout, so every memo longer than
// ~1100 characters timed out with certainty. Keep the timeout at several times
// the longest accepted memo's measured synthesis time so a slow-but-healthy
// request is never cut off, and raise them together if either changes.
export const ELEVENLABS_TTS_MAX_TEXT_LENGTH = 1_000
export const ELEVENLABS_TTS_TIMEOUT_MS = 90_000

export const ELEVENLABS_TTS_OUTPUT_FORMAT = assistantVoiceMemoSpeechOutputFormat
export const ELEVENLABS_MUSIC_MODEL_ID = assistantVoiceMemoMusicModelId
export const ELEVENLABS_MUSIC_OUTPUT_FORMAT = assistantVoiceMemoMusicOutputFormat

export type ElevenLabsFetchResult = Omit<
  Pick<
    Awaited<ReturnType<typeof fetch>>,
    'arrayBuffer' | 'body' | 'headers' | 'ok' | 'status' | 'text'
  >,
  'body' | 'headers'
> & {
  body?: ReadableStream<Uint8Array> | null
  headers?: ResponseHeadersLike | null
}

export type ElevenLabsFetch = {
  bivarianceHack(
    input: Extract<Parameters<typeof fetch>[0], string>,
    init: Omit<
      Pick<
        NonNullable<Parameters<typeof fetch>[1]>,
        'body' | 'headers' | 'method' | 'redirect' | 'signal'
      >,
      'body' | 'headers' | 'method' | 'redirect' | 'signal'
    > & {
      body?: string
      headers?: Record<string, string>
      method: string
      redirect: 'error'
      signal?: AbortSignal
    },
  ): Promise<ElevenLabsFetchResult>
}['bivarianceHack']

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
  if (text.length > ELEVENLABS_TTS_MAX_TEXT_LENGTH) {
    throw createElevenLabsInvalidInputError(
      `ElevenLabs speech text must contain at most ${ELEVENLABS_TTS_MAX_TEXT_LENGTH} characters.`,
    )
  }

  return await requestElevenLabsAudio({
    apiKey: input.apiKey,
    fetchImplementation: input.fetchImplementation,
    operation: 'speech',
    request: async (client, requestOptions) =>
      await client.textToSpeech.convert(
        voiceId,
        {
          modelId,
          outputFormat: input.outputFormat ?? ELEVENLABS_TTS_OUTPUT_FORMAT,
          text,
        },
        requestOptions,
      ),
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
    fetchImplementation: input.fetchImplementation,
    operation: 'music',
    request: async (client, requestOptions) =>
      await client.music.compose(
        {
          forceInstrumental: input.forceInstrumental,
          modelId: input.modelId,
          musicLengthMs: input.durationMs,
          outputFormat: input.outputFormat,
          prompt,
        },
        requestOptions,
      ),
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

type ElevenLabsRequestOptions = NonNullable<
  Parameters<ElevenLabsClient['textToSpeech']['convert']>[2]
>

interface ElevenLabsRequestDiagnostics {
  errorBodyText: string | null
  requestId: string | null
  responseTooLarge: boolean
}

async function requestElevenLabsAudio(input: {
  apiKey: string
  fetchImplementation?: ElevenLabsFetch
  operation: 'music' | 'speech'
  request: (
    client: ElevenLabsClient,
    requestOptions: ElevenLabsRequestOptions,
  ) => Promise<ReadableStream<Uint8Array>>
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

  const timeout = createTimeoutAbortController(input.signal, input.timeoutMs)
  const diagnostics: ElevenLabsRequestDiagnostics = {
    errorBodyText: null,
    requestId: null,
    responseTooLarge: false,
  }
  const client = new ElevenLabsClient({
    apiKey,
    baseUrl: DEFAULT_ELEVENLABS_API_BASE_URL,
    fetch: createElevenLabsSdkFetch(fetchImplementation, diagnostics),
    headers: {
      accept: 'audio/mpeg',
    },
    maxRetries: ELEVENLABS_MAX_RETRIES,
    timeoutInSeconds: input.timeoutMs / 1_000,
  })
  const requestOptions: ElevenLabsRequestOptions = {
    abortSignal: timeout.signal,
    maxRetries: ELEVENLABS_MAX_RETRIES,
    timeoutInSeconds: input.timeoutMs / 1_000,
  }
  const startedAtMs = Date.now()
  try {
    const stream = await input.request(client, requestOptions)
    return {
      bytes: await readElevenLabsAudioStream(stream),
      contentType: 'audio/mpeg',
      filenameExtension: 'mp3',
    }
  } catch (error) {
    if (input.signal?.aborted) {
      throw timeout.signal.reason ?? error
    }

    if (
      diagnostics.responseTooLarge ||
      error instanceof ElevenLabsResponseTooLargeError
    ) {
      throw new VaultCliError(
        'ELEVENLABS_API_REQUEST_FAILED',
        `ElevenLabs ${input.operation} returned a response larger than the ${ELEVENLABS_AUDIO_MAX_BYTES}-byte limit.`,
        {
          elapsedMs: Date.now() - startedAtMs,
          failureStage: 'response_body',
          maxResponseBytes: ELEVENLABS_AUDIO_MAX_BYTES,
          operation: input.operation,
          provider: 'elevenlabs',
          retryable: false,
        },
      )
    }

    if (
      error instanceof ElevenLabsError &&
      typeof error.statusCode === 'number'
    ) {
      const status = error.statusCode
      const responseBody = readElevenLabsErrorBody({
        fallbackBody: error.body,
        fallbackRequestId: error.requestId,
        rawText: diagnostics.errorBodyText,
        requestId: diagnostics.requestId,
      })
      throw new VaultCliError(
        'ELEVENLABS_API_REQUEST_FAILED',
        `ElevenLabs ${input.operation} request failed with HTTP ${status}.`,
        {
          elapsedMs: Date.now() - startedAtMs,
          failureStage: 'http',
          operation: input.operation,
          provider: 'elevenlabs',
          providerErrorCode: responseBody.code,
          providerErrorMessage: responseBody.message,
          providerRequestId: responseBody.requestId,
          responseBodyTextLength: responseBody.textLength,
          retryable: status === 408 || status === 429 || status >= 500,
          status,
        },
      )
    }

    const timedOut = timeout.timedOut() ||
      error instanceof ElevenLabsTimeoutError
    throw new VaultCliError(
      'ELEVENLABS_API_REQUEST_FAILED',
      timedOut
        ? `ElevenLabs ${input.operation} request timed out after ${input.timeoutMs}ms.`
        : `ElevenLabs ${input.operation} request failed before a response was returned.`,
      {
        elapsedMs: Date.now() - startedAtMs,
        failureStage: 'transport',
        operation: input.operation,
        provider: 'elevenlabs',
        retryable: true,
        timeoutMs: input.timeoutMs,
        timedOut,
        transportErrorName: readSafeTransportErrorName(error),
        transportErrorTextLength: errorMessage(error).length,
      },
    )
  } finally {
    timeout.cleanup()
  }
}

function createElevenLabsSdkFetch(
  fetchImplementation: ElevenLabsFetch,
  diagnostics: ElevenLabsRequestDiagnostics,
): typeof fetch {
  return async (input, init) => {
    const request = readRequestInput(input)
    const headers = mergeFetchHeaders(request?.headers, init?.headers)
    const body = readSdkRequestBody(init?.body)
    const response = await fetchImplementation(
      request?.url ?? String(input),
      {
        ...(body === undefined ? {} : { body }),
        headers,
        method: init?.method ?? request?.method ?? 'GET',
        redirect: 'error',
        signal: init?.signal ?? request?.signal ?? undefined,
      },
    )

    if (response instanceof Response) {
      if (!response.ok) {
        diagnostics.errorBodyText = await readElevenLabsErrorResponseText(
          response,
        ).catch(() => null)
        diagnostics.requestId = readElevenLabsRequestId(response.headers)
        return new Response(diagnostics.errorBodyText, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        })
      }
      if (
        responseExceedsDeclaredByteLimit(
          response.headers,
          ELEVENLABS_AUDIO_MAX_BYTES,
        )
      ) {
        diagnostics.responseTooLarge = true
        await cancelElevenLabsResponseBody(response)
        throw new ElevenLabsResponseTooLargeError()
      }
      return response
    }

    const responseHeaders = createSdkResponseHeaders(response.headers)
    if (!response.ok) {
      const text = await readElevenLabsErrorResponseText(
        response,
        responseHeaders,
      ).catch(() => null)
      diagnostics.errorBodyText = text
      diagnostics.requestId = readElevenLabsRequestId(responseHeaders)
      return new Response(text, {
        headers: responseHeaders,
        status: response.status,
      })
    }

    if (
      responseExceedsDeclaredByteLimit(
        responseHeaders,
        ELEVENLABS_AUDIO_MAX_BYTES,
      )
    ) {
      diagnostics.responseTooLarge = true
      await cancelElevenLabsResponseBody(response)
      throw new ElevenLabsResponseTooLargeError()
    }

    if (response.body) {
      return new Response(response.body, {
        headers: responseHeaders,
        status: response.status,
      })
    }

    const bodyBytes = await response.arrayBuffer()
    if (bodyBytes.byteLength > ELEVENLABS_AUDIO_MAX_BYTES) {
      diagnostics.responseTooLarge = true
      throw new ElevenLabsResponseTooLargeError()
    }
    return new Response(bodyBytes, {
      headers: responseHeaders,
      status: response.status,
    })
  }
}

function readRequestInput(input: RequestInfo | URL): Request | null {
  return typeof Request !== 'undefined' && input instanceof Request
    ? input
    : null
}

function mergeFetchHeaders(
  requestHeaders: Headers | undefined,
  initHeaders: HeadersInit | undefined,
): Record<string, string> {
  const headers = new Headers(requestHeaders)
  new Headers(initHeaders).forEach((value, name) => {
    headers.set(name, value)
  })
  return Object.fromEntries(headers.entries())
}

function readSdkRequestBody(
  body: BodyInit | null | undefined,
): string | undefined {
  if (body === null || body === undefined) {
    return undefined
  }
  if (typeof body === 'string') {
    return body
  }
  throw new Error('ElevenLabs SDK emitted an unsupported request body type.')
}

function createSdkResponseHeaders(
  headers: ResponseHeadersLike | null | undefined,
): Headers {
  const result = new Headers()
  for (const name of [
    'content-length',
    'content-type',
    'request-id',
    'x-request-id',
  ]) {
    const value = readResponseHeader(headers, name)
    if (value) {
      result.set(name, value)
    }
  }
  return result
}

function readResponseHeader(
  headers: ResponseHeadersLike | null | undefined,
  name: string,
): string | null {
  if (!headers) {
    return null
  }
  if (typeof headers.get === 'function') {
    return normalizeNullableString(headers.get(name))
  }
  const matchingEntry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )
  const value = matchingEntry?.[1]
  return typeof value === 'string' ? normalizeNullableString(value) : null
}

function readElevenLabsRequestId(headers: Headers): string | null {
  return readBoundedErrorString(
    headers.get('x-request-id') ?? headers.get('request-id'),
    100,
  )
}

async function readElevenLabsAudioStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        break
      }
      totalLength += next.value.byteLength
      if (totalLength > ELEVENLABS_AUDIO_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new ElevenLabsResponseTooLargeError()
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

class ElevenLabsResponseTooLargeError extends Error {
  constructor() {
    super('ElevenLabs response exceeded the configured byte limit.')
    this.name = 'ElevenLabsResponseTooLargeError'
  }
}

async function readElevenLabsErrorResponseText(
  response: ElevenLabsFetchResult,
  headers: ResponseHeadersLike | null | undefined = response.headers,
): Promise<string | null> {
  if (
    responseExceedsDeclaredByteLimit(
      headers,
      ELEVENLABS_ERROR_BODY_MAX_BYTES,
    )
  ) {
    await cancelElevenLabsResponseBody(response)
    return null
  }

  if (response.body) {
    const bytes = await readBoundedElevenLabsStream(
      response.body,
      ELEVENLABS_ERROR_BODY_MAX_BYTES,
    )
    return bytes === null ? null : new TextDecoder().decode(bytes)
  }

  const text = await response.text()
  return new TextEncoder().encode(text).byteLength <=
      ELEVENLABS_ERROR_BODY_MAX_BYTES
    ? text
    : null
}

async function readBoundedElevenLabsStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        break
      }
      totalLength += next.value.byteLength
      if (totalLength > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function responseExceedsDeclaredByteLimit(
  headers: ResponseHeadersLike | null | undefined,
  maxBytes: number,
): boolean {
  const contentLength = readResponseHeader(headers, 'content-length')
  if (!contentLength || !/^\d+$/.test(contentLength)) {
    return false
  }
  return Number(contentLength) > maxBytes
}

async function cancelElevenLabsResponseBody(
  response: ElevenLabsFetchResult,
): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
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

interface ElevenLabsErrorBody {
  code: string | null
  message: string | null
  requestId: string | null
  textLength: number | null
}

// ElevenLabs reports failures as
// `{"detail":{"code","status","message","request_id"}}`. The machine-readable
// code and request id say what to do next and what to quote to the provider;
// the message says which input was rejected. It is echoed provider text, so it
// is length-capped before it reaches an assistant context or a runtime log.
const ELEVENLABS_ERROR_MESSAGE_MAX_LENGTH = 300

function readElevenLabsErrorBody(input: {
  fallbackBody: unknown
  fallbackRequestId: string | undefined
  rawText: string | null
  requestId: string | null
}): ElevenLabsErrorBody {
  const text = input.rawText ?? stringifyElevenLabsErrorBody(input.fallbackBody)
  const detail = text === null
    ? readElevenLabsErrorDetail(input.fallbackBody)
    : readElevenLabsErrorDetailFromText(text)
  return {
    code: readBoundedErrorString(detail?.code ?? detail?.status, 100),
    message: readBoundedErrorString(
      detail?.message,
      ELEVENLABS_ERROR_MESSAGE_MAX_LENGTH,
    ),
    requestId: readBoundedErrorString(
      detail?.request_id ?? input.requestId ?? input.fallbackRequestId,
      100,
    ),
    textLength: text?.length ?? null,
  }
}

function stringifyElevenLabsErrorBody(body: unknown): string | null {
  if (typeof body === 'string') {
    return body
  }
  try {
    return JSON.stringify(body) ?? null
  } catch {
    return null
  }
}

function readElevenLabsErrorDetailFromText(text: string): {
  code?: unknown
  message?: unknown
  request_id?: unknown
  status?: unknown
} | null {
  try {
    return readElevenLabsErrorDetail(JSON.parse(text))
  } catch {
    return null
  }
}

function readElevenLabsErrorDetail(value: unknown): {
  code?: unknown
  message?: unknown
  request_id?: unknown
  status?: unknown
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const detail = (value as { detail?: unknown }).detail
  // A plain-string `detail` carries no structured fields worth splitting out.
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    return null
  }
  return detail
}

function readBoundedErrorString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}…`
    : trimmed
}

function readSafeTransportErrorName(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(error.name) ? error.name : null
}
