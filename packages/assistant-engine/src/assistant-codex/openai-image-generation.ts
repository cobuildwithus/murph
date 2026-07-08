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
  providerRequestId: string | null
  rawUsageJson: Record<string, unknown> | null
  usage: OpenAiImageGenerationUsage | null
}

export async function generateOpenAiImage(input: {
  abortSignal?: AbortSignal | null
  apiKey: string
  fetchImpl: typeof fetch
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
  outputFormat: OpenAiImageOutputFormat
  prompt: string
  quality: OpenAiImageQuality
  size: OpenAiImageSize
}): Promise<OpenAiImageGenerationResult> {
  const response = await input.fetchImpl(`${OPENAI_IMAGES_BASE_URL}/images/generations`, {
    body: JSON.stringify(buildOpenAiImageGenerationRequest(input)),
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: buildOpenAiImageAbortSignal(input.abortSignal ?? null),
  })

  return await readOpenAiImageGenerationResult(response)
}

async function editOpenAiImageWithReferences(input: {
  abortSignal?: AbortSignal | null
  apiKey: string
  fetchImpl: typeof fetch
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

  for (const reference of input.referenceImages) {
    form.append(
      'image[]',
      new Blob([Buffer.from(reference.bytes)], { type: reference.mediaType }),
      reference.filename,
    )
  }

  const response = await input.fetchImpl(`${OPENAI_IMAGES_BASE_URL}/images/edits`, {
    body: form,
    headers: {
      authorization: `Bearer ${input.apiKey}`,
    },
    method: 'POST',
    signal: buildOpenAiImageAbortSignal(input.abortSignal ?? null),
  })

  return await readOpenAiImageGenerationResult(response)
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
): Promise<OpenAiImageGenerationResult> {
  const providerRequestId =
    normalizeNullableString(response.headers.get('x-request-id')) ??
    normalizeNullableString(response.headers.get('openai-request-id')) ??
    null
  const payload = await readOpenAiJsonResponse(response)

  if (!response.ok) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_GENERATION_FAILED',
      'OpenAI image generation failed.',
      {
        providerRequestId,
        retryable: response.status === 429 || response.status >= 500,
        status: response.status,
      },
    )
  }

  return parseOpenAiImageGenerationPayload(payload, providerRequestId)
}

function buildOpenAiImageGenerationRequest(input: {
  outputFormat: OpenAiImageOutputFormat
  prompt: string
  quality: OpenAiImageQuality
  size: OpenAiImageSize
}): ImageGenerateParamsNonStreaming {
  return {
    model: OPENAI_IMAGE_GENERATION_MODEL,
    output_format: input.outputFormat,
    prompt: input.prompt,
    quality: input.quality,
    size: input.size,
  }
}

async function readOpenAiJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_GENERATION_INVALID_RESPONSE',
      'OpenAI image generation returned invalid JSON.',
      {
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
): OpenAiImageGenerationResult {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
