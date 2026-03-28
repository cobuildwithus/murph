import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

import type { LinqWebhookEvent } from './types.ts'

export class LinqWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinqWebhookVerificationError'
  }
}

export class LinqWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinqWebhookPayloadError'
  }
}

export function isLinqWebhookVerificationError(error: unknown): error is LinqWebhookVerificationError {
  return error instanceof LinqWebhookVerificationError
}

export function isLinqWebhookPayloadError(error: unknown): error is LinqWebhookPayloadError {
  return error instanceof LinqWebhookPayloadError
}

export interface VerifyAndParseLinqWebhookRequestInput {
  headers: Headers | IncomingHttpHeaders | Record<string, string | string[] | undefined>
  rawBody: Buffer | Uint8Array | ArrayBuffer | string
  webhookSecret: string
}

export function verifyAndParseLinqWebhookRequest(
  input: VerifyAndParseLinqWebhookRequestInput,
): LinqWebhookEvent {
  const rawBody = normalizeLinqWebhookRawBody(input.rawBody)
  const webhookSecret = normalizeNullableString(input.webhookSecret)

  if (!webhookSecret) {
    throw new LinqWebhookVerificationError('Linq webhook secret is required.')
  }

  const timestamp = readLinqWebhookHeader(input.headers, 'x-webhook-timestamp')
  const signature = readLinqWebhookHeader(input.headers, 'x-webhook-signature')

  if (!timestamp || !signature) {
    throw new LinqWebhookVerificationError('Missing Linq webhook signature headers.')
  }

  if (!verifyLinqWebhookSignature(webhookSecret, rawBody, timestamp, signature)) {
    throw new LinqWebhookVerificationError('Invalid Linq webhook signature.')
  }

  return parseLinqWebhookEvent(rawBody)
}

export function parseLinqWebhookEvent(rawBody: Buffer | Uint8Array | ArrayBuffer | string): LinqWebhookEvent {
  const payloadText = normalizeLinqWebhookRawBody(rawBody)
  let payload: unknown

  try {
    payload = JSON.parse(payloadText)
  } catch (error) {
    throw new LinqWebhookPayloadError(
      `Linq webhook payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!payload || typeof payload !== 'object') {
    throw new LinqWebhookPayloadError('Linq webhook payload must be an object.')
  }

  const record = payload as Record<string, unknown>
  const apiVersion = normalizeRequiredString(record.api_version, 'Linq webhook api_version')
  const eventId = normalizeRequiredString(record.event_id, 'Linq webhook event_id')
  const createdAt = normalizeRequiredString(record.created_at, 'Linq webhook created_at')
  const eventType = normalizeRequiredString(record.event_type, 'Linq webhook event_type')

  return {
    api_version: apiVersion as LinqWebhookEvent['api_version'],
    event_id: eventId,
    created_at: createdAt,
    event_type: eventType,
    trace_id: normalizeNullableString(record.trace_id),
    partner_id: normalizeNullableString(record.partner_id),
    data: record.data,
  }
}

export function verifyLinqWebhookSignature(
  secret: string,
  payload: Buffer | Uint8Array | ArrayBuffer | string,
  timestamp: string,
  signature: string,
): boolean {
  const normalizedPayload = normalizeLinqWebhookRawBody(payload)
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${normalizedPayload}`)
    .digest('hex')
  const normalizedSignature = signature.replace(/^sha256=/iu, '').trim().toLowerCase()

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(normalizedSignature, 'hex'))
  } catch {
    return false
  }
}

export function readLinqWebhookHeader(
  headers: Headers | IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  headerName: string,
): string | null {
  if (headers instanceof Headers) {
    return normalizeNullableString(headers.get(headerName))
  }

  const expectedHeader = headerName.toLowerCase()
  for (const [candidateName, value] of Object.entries(headers)) {
    if (candidateName.toLowerCase() !== expectedHeader) {
      continue
    }

    if (Array.isArray(value)) {
      return normalizeNullableString(value[0])
    }

    return normalizeNullableString(value)
  }

  return null
}

function normalizeLinqWebhookRawBody(value: Buffer | Uint8Array | ArrayBuffer | string): string {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString('utf8')
  }

  return Buffer.from(value).toString('utf8')
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new LinqWebhookPayloadError(`${label} is required.`)
  }

  return normalized
}
