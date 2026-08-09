import { Buffer } from 'node:buffer'

import type { ImageGenerateParamsNonStreaming } from 'openai/resources/images'

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

export interface OpenAiImageGenerationUsage {
  input_tokens?: number
  input_tokens_details?: {
    cached_tokens?: number
    image_tokens?: number
    text_tokens?: number
  }
  output_tokens?: number
  output_tokens_details?: {
    image_tokens?: number
    reasoning_tokens?: number
    text_tokens?: number
  }
  total_tokens?: number
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
  return await requestOpenAiImage({
    abortSignal: input.abortSignal ?? null,
    apiKey: input.apiKey,
    body: JSON.stringify(buildOpenAiImageGenerationRequest(input)),
    fetchImpl: input.fetchImpl,
    headers: {
      'content-type': 'application/json',
    },
    operation: 'generation',
    path: '/images/generations',
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
  const form = new FormData()
  form.set('model', OPENAI_IMAGE_GENERATION_MODEL)
  form.set('prompt', input.prompt)
  form.set('quality', input.quality)
  form.set('size', input.size)
  form.set('output_format', input.outputFormat)
  if (input.outputCompression !== undefined) {
    form.set('output_compression', String(input.outputCompression))
  }

  for (const reference of input.referenceImages) {
    form.append(
      'image[]',
      new Blob([Buffer.from(reference.bytes)], { type: reference.mediaType }),
      reference.filename,
    )
  }

  return await requestOpenAiImage({
    abortSignal: input.abortSignal ?? null,
    apiKey: input.apiKey,
    body: form,
    fetchImpl: input.fetchImpl,
    operation: 'edit',
    path: '/images/edits',
  })
}

async function requestOpenAiImage(input: {
  abortSignal: AbortSignal | null
  apiKey: string
  body: BodyInit
  fetchImpl: typeof fetch
  headers?: Record<string, string>
  operation: OpenAiImageOperation
  path: '/images/edits' | '/images/generations'
}): Promise<OpenAiImageGenerationResult> {
  const startedAtMs = Date.now()
  try {
    const response = await input.fetchImpl(
      `${OPENAI_IMAGES_BASE_URL}${input.path}`,
      {
        body: input.body,
        headers: {
          ...(input.headers ?? {}),
          authorization: `Bearer ${input.apiKey}`,
        },
        method: 'POST',
        signal: buildOpenAiImageAbortSignal(input.abortSignal),
      },
    )
    return {
      ...await readOpenAiImageGenerationResult(response, input.operation),
      occurredAt: new Date(startedAtMs).toISOString(),
    }
  } catch (error) {
    if (error instanceof VaultCliError) {
      throw error
    }
    if (input.abortSignal?.aborted || isAbortError(error)) {
      throw error
    }

    const timedOut = isTimeoutError(error)
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
        transportErrorName: readSafeTransportErrorName(error),
      },
    )
  }
}

function buildOpenAiImageAbortSignal(abortSignal: AbortSignal | null): AbortSignal {
  return abortSignal
    ? AbortSignal.any([
        abortSignal,
        AbortSignal.timeout(OPENAI_IMAGE_GENERATION_TIMEOUT_MS),
      ])
    : AbortSignal.timeout(OPENAI_IMAGE_GENERATION_TIMEOUT_MS)
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
// `ImagesResponse` from `openai/resources/images`). We use raw fetch instead of
// the openai SDK client to keep auth/timeout/retry on our owners; the runtime
// only consumes `data[0].b64_json` and an optional `usage` breakdown
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

interface OpenAiImageErrorBody {
  code: string | null
  message: string | null
  requestId: string | null
}

function readOpenAiImageErrorBody(payload: unknown): OpenAiImageErrorBody {
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
