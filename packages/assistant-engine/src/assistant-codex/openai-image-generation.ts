import { Buffer } from 'node:buffer'

import OpenAI, {
  APIConnectionTimeoutError,
  APIError,
  toFile,
  type APIPromise,
} from 'openai'
import type {
  ImageEditParamsNonStreaming,
  ImageGenerateParamsNonStreaming,
  ImagesResponse,
} from 'openai/resources/images'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export const OPENAI_IMAGE_GENERATION_MODEL = 'gpt-image-2'
export const OPENAI_IMAGES_BASE_URL = 'https://api.openai.com/v1'
// Image generation is slow but bounded; complex prompts can exceed two minutes,
// especially reference-image edits. TimeoutError is deliberately not an
// AbortError, so the tool's abort passthrough does not swallow it.
export const OPENAI_IMAGE_GENERATION_TIMEOUT_MS = 240_000
export const OPENAI_IMAGE_GENERATION_USAGE_EXTRACTION_VERSION =
  'openai-images-v1'

type OpenAiImageOperation = 'edit' | 'generation'

type OpenAiImageAbortContext = {
  signal: AbortSignal
  timeoutSignal: AbortSignal
}

type OpenAiImageRequestState = {
  errorResponse: Response | null
  transportError: unknown
  transportSignalAborted: boolean
}

const OPENAI_IMAGE_ERROR_MESSAGE_MAX_LENGTH = 300
const OPENAI_IMAGE_ERROR_METADATA_MAX_LENGTH = 100

export type OpenAiImageOutputFormat = 'jpeg' | 'png' | 'webp'
export type OpenAiImageQuality = 'high' | 'low' | 'medium'
export type OpenAiImageSize = '1024x1024' | '1024x1536' | '1536x1024'

export interface OpenAiImageReferenceInput {
  bytes: Uint8Array
  filename: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
}

export type OpenAiImageGenerationUsage = Partial<
  Omit<ImagesResponse.Usage, 'input_tokens_details' | 'output_tokens_details'>
> & {
  input_tokens_details?:
    Partial<ImagesResponse.Usage.InputTokensDetails> & {
      cached_tokens?: number
    }
  output_tokens_details?:
    Partial<ImagesResponse.Usage.OutputTokensDetails> & {
      reasoning_tokens?: number
    }
}

export interface OpenAiImageGenerationResult {
  imageBytes: Uint8Array
  occurredAt: string
  providerRequestId: string | null
  rawUsageJson: Record<string, unknown> | null
  usage: OpenAiImageGenerationUsage | null
}

export async function generateOpenAiImage(input: {
  abortSignal?: AbortSignal | null
  apiKey: string
  fetchImpl: typeof fetch
  outputCompression?: number
  outputFormat: OpenAiImageOutputFormat
  prompt: string
  quality: OpenAiImageQuality
  referenceImages?: readonly OpenAiImageReferenceInput[]
  size: OpenAiImageSize
}): Promise<OpenAiImageGenerationResult> {
  const referenceImages = input.referenceImages ?? []
  return referenceImages.length === 0
    ? await generateOpenAiImageFromPrompt(input)
    : await editOpenAiImageWithReferences({
        ...input,
        referenceImages,
      })
}

async function generateOpenAiImageFromPrompt(input: {
  abortSignal?: AbortSignal | null
  apiKey: string
  fetchImpl: typeof fetch
  outputCompression?: number
  outputFormat: OpenAiImageOutputFormat
  prompt: string
  quality: OpenAiImageQuality
  size: OpenAiImageSize
}): Promise<OpenAiImageGenerationResult> {
  const request = buildOpenAiImageGenerationRequest(input)
  return await requestOpenAiImage({
    abortSignal: input.abortSignal ?? null,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    operation: 'generation',
    request: (openAi, signal) => openAi.images.generate(request, {
      maxRetries: 0,
      signal,
      timeout: OPENAI_IMAGE_GENERATION_TIMEOUT_MS,
    }),
  })
}

async function editOpenAiImageWithReferences(input: {
  abortSignal?: AbortSignal | null
  apiKey: string
  fetchImpl: typeof fetch
  outputCompression?: number
  outputFormat: OpenAiImageOutputFormat
  prompt: string
  quality: OpenAiImageQuality
  referenceImages: readonly OpenAiImageReferenceInput[]
  size: OpenAiImageSize
}): Promise<OpenAiImageGenerationResult> {
  const request = await buildOpenAiImageEditRequest(input)
  return await requestOpenAiImage({
    abortSignal: input.abortSignal ?? null,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    operation: 'edit',
    request: (openAi, signal) => openAi.images.edit(request, {
      maxRetries: 0,
      signal,
      timeout: OPENAI_IMAGE_GENERATION_TIMEOUT_MS,
    }),
  })
}

async function requestOpenAiImage(input: {
  abortSignal: AbortSignal | null
  apiKey: string
  fetchImpl: typeof fetch
  operation: OpenAiImageOperation
  request: (
    openAi: OpenAI,
    signal: AbortSignal,
  ) => APIPromise<ImagesResponse>
}): Promise<OpenAiImageGenerationResult> {
  const startedAtMs = Date.now()
  const abortContext = buildOpenAiImageAbortContext(input.abortSignal)
  const requestState: OpenAiImageRequestState = {
    errorResponse: null,
    transportError: null,
    transportSignalAborted: false,
  }
  const openAi = new OpenAI({
    adminAPIKey: null,
    apiKey: input.apiKey,
    baseURL: OPENAI_IMAGES_BASE_URL,
    fetch: createOpenAiImageSdkFetch(input.fetchImpl, requestState),
    logLevel: 'off',
    maxRetries: 0,
    organization: null,
    project: null,
    timeout: OPENAI_IMAGE_GENERATION_TIMEOUT_MS,
    webhookSecret: null,
  })

  try {
    const response = await input.request(openAi, abortContext.signal).asResponse()
    return {
      ...await readOpenAiImageGenerationResult(response, input.operation),
      occurredAt: new Date(startedAtMs).toISOString(),
    }
  } catch (error) {
    if (error instanceof VaultCliError) {
      throw error
    }

    const errorResponse = requestState.errorResponse
    if (errorResponse) {
      return {
        ...await readOpenAiImageGenerationResult(errorResponse, input.operation),
        occurredAt: new Date(startedAtMs).toISOString(),
      }
    }

    if (error instanceof APIError && typeof error.status === 'number') {
      const providerError = readOpenAiImageApiError(error)
      throw new VaultCliError(
        'ASSISTANT_IMAGE_GENERATION_FAILED',
        `OpenAI image ${input.operation} request failed with HTTP ${error.status}.`,
        {
          failureStage: 'http',
          operation: input.operation,
          provider: 'openai-images',
          providerErrorCode: providerError.code,
          providerErrorMessage: providerError.message,
          providerRequestId: providerError.requestId,
          retryable:
            error.status === 408 ||
            error.status === 429 ||
            error.status >= 500,
          status: error.status,
        },
      )
    }

    if (input.abortSignal?.aborted) {
      throw requestState.transportError
        ?? input.abortSignal.reason
        ?? error
    }

    const transportError = requestState.transportError ?? error
    if (
      isAbortError(transportError) &&
      !requestState.transportSignalAborted &&
      !abortContext.timeoutSignal.aborted
    ) {
      throw transportError
    }

    const timedOut =
      abortContext.timeoutSignal.aborted ||
      isTimeoutError(transportError) ||
      error instanceof APIConnectionTimeoutError
    throw new VaultCliError(
      'ASSISTANT_IMAGE_GENERATION_FAILED',
      timedOut
        ? `OpenAI image ${input.operation} request timed out after ${OPENAI_IMAGE_GENERATION_TIMEOUT_MS}ms.`
        : `OpenAI image ${input.operation} request failed before a response was returned.`,
      {
        elapsedMs: Date.now() - startedAtMs,
        failureStage: 'transport',
        operation: input.operation,
        provider: 'openai-images',
        retryable: true,
        timedOut,
        timeoutMs: OPENAI_IMAGE_GENERATION_TIMEOUT_MS,
        transportErrorName: timedOut
          ? 'TimeoutError'
          : readSafeTransportErrorName(transportError),
      },
    )
  }
}

function buildOpenAiImageAbortContext(
  abortSignal: AbortSignal | null,
): OpenAiImageAbortContext {
  const timeoutSignal = AbortSignal.timeout(
    OPENAI_IMAGE_GENERATION_TIMEOUT_MS,
  )
  return {
    signal: abortSignal
      ? AbortSignal.any([abortSignal, timeoutSignal])
      : timeoutSignal,
    timeoutSignal,
  }
}

function createOpenAiImageSdkFetch(
  fetchImpl: typeof fetch,
  state: OpenAiImageRequestState,
): typeof fetch {
  const sdkFetch = async (
    request: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    try {
      const response = await fetchImpl.call(undefined, request, init)
      if (!response.ok) {
        try {
          state.errorResponse = response.clone()
        } catch {
          state.errorResponse = null
        }
      }
      return response
    } catch (error) {
      state.transportError = error
      state.transportSignalAborted = init?.signal?.aborted === true
      throw error
    }
  }

  // The Images resource checks this property before encoding multipart data.
  // Supplying it prevents a synthetic data: probe from reaching the injected
  // hosted-egress fetch while retaining the exact injected transport.
  return Object.assign(sdkFetch, { Response })
}

async function readOpenAiImageGenerationResult(
  response: Response,
  operation: OpenAiImageOperation,
): Promise<Omit<OpenAiImageGenerationResult, 'occurredAt'>> {
  const headerProviderRequestId =
    readBoundedErrorString(
      response.headers.get('x-request-id'),
      OPENAI_IMAGE_ERROR_METADATA_MAX_LENGTH,
    ) ??
    readBoundedErrorString(
      response.headers.get('openai-request-id'),
      OPENAI_IMAGE_ERROR_METADATA_MAX_LENGTH,
    )
  const payload = await readOpenAiJsonResponse(response, {
    allowInvalidJson: !response.ok,
    providerRequestId: headerProviderRequestId,
  })

  if (!response.ok) {
    const providerError = readOpenAiImageErrorBody(payload)
    throw new VaultCliError(
      'ASSISTANT_IMAGE_GENERATION_FAILED',
      `OpenAI image ${operation} request failed with HTTP ${response.status}.`,
      {
        failureStage: 'http',
        operation,
        provider: 'openai-images',
        providerErrorCode: providerError.code,
        providerErrorMessage: providerError.message,
        providerRequestId:
          headerProviderRequestId ?? providerError.requestId,
        retryable:
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
        status: response.status,
      },
    )
  }

  return parseOpenAiImageGenerationPayload(payload, headerProviderRequestId)
}

function buildOpenAiImageGenerationRequest(input: {
  outputCompression?: number
  outputFormat: OpenAiImageOutputFormat
  prompt: string
  quality: OpenAiImageQuality
  size: OpenAiImageSize
}): ImageGenerateParamsNonStreaming {
  const request: ImageGenerateParamsNonStreaming = {
    model: OPENAI_IMAGE_GENERATION_MODEL,
    output_format: input.outputFormat,
    prompt: input.prompt,
    quality: input.quality,
    size: input.size,
  }
  if (input.outputCompression !== undefined) {
    request.output_compression = input.outputCompression
  }
  return request
}

async function buildOpenAiImageEditRequest(input: {
  outputCompression?: number
  outputFormat: OpenAiImageOutputFormat
  prompt: string
  quality: OpenAiImageQuality
  referenceImages: readonly OpenAiImageReferenceInput[]
  size: OpenAiImageSize
}): Promise<ImageEditParamsNonStreaming> {
  const request: ImageEditParamsNonStreaming = {
    image: await Promise.all(
      input.referenceImages.map((reference) =>
        toFile(reference.bytes, reference.filename, {
          type: reference.mediaType,
        })),
    ),
    model: OPENAI_IMAGE_GENERATION_MODEL,
    output_format: input.outputFormat,
    prompt: input.prompt,
    quality: input.quality,
    size: input.size,
  }
  if (input.outputCompression !== undefined) {
    request.output_compression = input.outputCompression
  }
  return request
}

async function readOpenAiJsonResponse(
  response: Response,
  input: {
    allowInvalidJson: boolean
    providerRequestId: string | null
  },
): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    if (input.allowInvalidJson) {
      return null
    }
    throw new VaultCliError(
      'ASSISTANT_IMAGE_GENERATION_INVALID_RESPONSE',
      'OpenAI image generation returned invalid JSON.',
      {
        providerRequestId: input.providerRequestId,
        retryable: false,
        status: response.status,
      },
    )
  }
}

// Custom-boundary parse of the OpenAI Images API payload (canonical SDK shape:
// `ImagesResponse` from `openai/resources/images`). The SDK owns request and
// multipart construction, while the runtime still defensively consumes only
// `data[0].b64_json` and an optional `usage` breakdown
// (`input_tokens`, `output_tokens`, `total_tokens`, and nested
// `input_tokens_details.{cached_tokens,image_tokens,text_tokens}` /
// `output_tokens_details.{image_tokens,reasoning_tokens,text_tokens}`). The
// defensive walks below are the executable shape contract for those exact
// fields: `asRecord` narrows non-object payloads, `data[0].b64_json` is type-
// checked, `decodeStrictBase64` round-trips the bytes, and
// `normalizeOpenAiImageUsage` discards any field that is not a non-negative
// integer or expected sub-record. Provider error paths (non-2xx) throw a
// `VaultCliError` upstream before this parser runs.
function parseOpenAiImageGenerationPayload(
  payload: unknown,
  providerRequestId: string | null,
): Omit<OpenAiImageGenerationResult, 'occurredAt'> {
  const record = asRecord(payload)
  const data = Array.isArray(record?.data) ? record.data : []
  const first = asRecord(data[0])
  const b64Json = typeof first?.b64_json === 'string' ? first.b64_json : null
  if (!b64Json) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_GENERATION_INVALID_RESPONSE',
      'OpenAI image generation did not return image bytes.',
      { retryable: false },
    )
  }

  const imageBytes = decodeStrictBase64(b64Json)
  const usage = normalizeOpenAiImageUsage(record?.usage)

  return {
    imageBytes,
    providerRequestId,
    rawUsageJson: usage ? normalizeOpenAiImageRawUsage(usage) : null,
    usage,
  }
}

export function normalizeOpenAiImageRawUsage(
  usage: OpenAiImageGenerationUsage,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  if (isNonNegativeInteger(usage.input_tokens)) raw.input_tokens = usage.input_tokens
  if (isNonNegativeInteger(usage.output_tokens)) raw.output_tokens = usage.output_tokens
  if (isNonNegativeInteger(usage.total_tokens)) raw.total_tokens = usage.total_tokens
  const inputDetails = normalizeTokenDetails(usage.input_tokens_details, [
    'cached_tokens',
    'image_tokens',
    'text_tokens',
  ])
  if (inputDetails) raw.input_tokens_details = inputDetails
  const outputDetails = normalizeTokenDetails(usage.output_tokens_details, [
    'image_tokens',
    'reasoning_tokens',
    'text_tokens',
  ])
  if (outputDetails) raw.output_tokens_details = outputDetails
  return raw
}

function normalizeOpenAiImageUsage(value: unknown): OpenAiImageGenerationUsage | null {
  const record = asRecord(value)
  if (!record) return null
  return {
    ...(isNonNegativeInteger(record.input_tokens)
      ? { input_tokens: record.input_tokens }
      : {}),
    ...(isNonNegativeInteger(record.output_tokens)
      ? { output_tokens: record.output_tokens }
      : {}),
    ...(isNonNegativeInteger(record.total_tokens)
      ? { total_tokens: record.total_tokens }
      : {}),
    ...(asRecord(record.input_tokens_details)
      ? {
          input_tokens_details: normalizeTokenDetails(record.input_tokens_details, [
            'cached_tokens',
            'image_tokens',
            'text_tokens',
          ]) ?? undefined,
        }
      : {}),
    ...(asRecord(record.output_tokens_details)
      ? {
          output_tokens_details: normalizeTokenDetails(record.output_tokens_details, [
            'image_tokens',
            'reasoning_tokens',
            'text_tokens',
          ]) ?? undefined,
        }
      : {}),
  }
}

function decodeStrictBase64(value: string): Uint8Array {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) || normalized.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_GENERATION_INVALID_RESPONSE',
      'OpenAI image generation returned invalid base64 image bytes.',
      { retryable: false },
    )
  }

  const bytes = Buffer.from(normalized, 'base64')
  const roundTrip = bytes.toString('base64').replace(/=+$/u, '')
  if (roundTrip !== normalized.replace(/=+$/u, '')) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_GENERATION_INVALID_RESPONSE',
      'OpenAI image generation returned invalid base64 image bytes.',
      { retryable: false },
    )
  }

  return new Uint8Array(bytes)
}

function normalizeTokenDetails(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, number> | null {
  const record = asRecord(value)
  if (!record) return null
  const normalized: Record<string, number> = {}
  for (const key of allowedKeys) {
    const entry = record[key]
    if (isNonNegativeInteger(entry)) normalized[key] = entry
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

function readOpenAiImageErrorBody(payload: unknown) {
  const record = asRecord(payload)
  const error = asRecord(record?.error)
  return {
    code: readBoundedErrorString(
      error?.code ?? error?.type,
      OPENAI_IMAGE_ERROR_METADATA_MAX_LENGTH,
    ),
    message: readBoundedErrorString(
      error?.message,
      OPENAI_IMAGE_ERROR_MESSAGE_MAX_LENGTH,
    ),
    requestId: readBoundedErrorString(
      error?.request_id ?? record?.request_id,
      OPENAI_IMAGE_ERROR_METADATA_MAX_LENGTH,
    ),
  }
}

function readOpenAiImageApiError(error: APIError) {
  const errorRecord = asRecord(error.error)
  return {
    code: readBoundedErrorString(
      errorRecord?.code ?? errorRecord?.type,
      OPENAI_IMAGE_ERROR_METADATA_MAX_LENGTH,
    ),
    message: readBoundedErrorString(
      errorRecord?.message,
      OPENAI_IMAGE_ERROR_MESSAGE_MAX_LENGTH,
    ),
    requestId: readBoundedErrorString(
      error.requestID ?? error.headers?.get('openai-request-id'),
      OPENAI_IMAGE_ERROR_METADATA_MAX_LENGTH,
    ),
  }
}

function readBoundedErrorString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) {
    return null
  }
  const codePoints = Array.from(normalized)
  return codePoints.length > maxLength
    ? `${codePoints.slice(0, maxLength - 1).join('')}…`
    : normalized
}

function readSafeTransportErrorName(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(error.name)
    ? error.name
    : null
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
