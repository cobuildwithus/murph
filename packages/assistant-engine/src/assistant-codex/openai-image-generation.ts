import { Buffer } from 'node:buffer'

import type { ImageGenerateParamsNonStreaming } from 'openai/resources/images'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export const OPENAI_IMAGE_GENERATION_MODEL = 'gpt-image-2'
export const OPENAI_IMAGES_BASE_URL = 'https://api.openai.com/v1'
// Image generation is slow but bounded; a hung request must become a tool
// failure reply instead of stalling the turn. TimeoutError is deliberately
// not an AbortError, so the tool's abort passthrough does not swallow it.
export const OPENAI_IMAGE_GENERATION_TIMEOUT_MS = 120_000
export const OPENAI_IMAGE_GENERATION_USAGE_EXTRACTION_VERSION =
  'openai-images-v1'

export type OpenAiImageOutputFormat = 'jpeg' | 'png' | 'webp'
export type OpenAiImageQuality = 'high' | 'low' | 'medium'
export type OpenAiImageSize = '1024x1024' | '1024x1536' | '1536x1024'

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
  size: OpenAiImageSize
}): Promise<OpenAiImageGenerationResult> {
  const response = await input.fetchImpl(`${OPENAI_IMAGES_BASE_URL}/images/generations`, {
    body: JSON.stringify(buildOpenAiImageGenerationRequest(input)),
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: input.abortSignal
      ? AbortSignal.any([
          input.abortSignal,
          AbortSignal.timeout(OPENAI_IMAGE_GENERATION_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(OPENAI_IMAGE_GENERATION_TIMEOUT_MS),
  })
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
