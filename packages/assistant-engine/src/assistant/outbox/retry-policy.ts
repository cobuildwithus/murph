import {
  assistantDeliveryErrorSchema,
  type AssistantDeliveryError,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  redactAssistantStateString,
  sanitizeAssistantPortableStateString,
} from '../redaction.js'

const OUTBOX_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000]
const STALE_SENDING_AFTER_MS = 10 * 60 * 1000
const ASSISTANT_DELIVERY_ERROR_DIAGNOSTIC_MAX_KEYS = 24
const ASSISTANT_DELIVERY_ERROR_DIAGNOSTIC_STRING_MAX_LENGTH = 2048
const NON_RETRYABLE_OUTBOX_ERROR_CODE_MARKERS = [
  'UNSUPPORTED',
  'INVALID',
  'TARGET_REQUIRED',
  'CHANNEL_REQUIRED',
] as const
const RETRYABLE_OUTBOX_ERROR_CODE_MARKERS = [
  'REQUEST_FAILED',
  'DELIVERY_FAILED',
  'TIMEOUT',
  'CONNECTION',
  'UNAVAILABLE',
  'RATE',
  'LIMIT',
] as const
const RETRYABLE_OUTBOX_ERROR_MESSAGE_MARKERS = [
  'timed out',
  'temporary',
  'retry',
  'rate limit',
  'too many requests',
  'connection',
  'network',
] as const

export function shouldDispatchAssistantOutboxIntent(
  intent: AssistantOutboxIntent,
  now: Date,
): boolean {
  switch (intent.status) {
    case 'pending':
    case 'retryable': {
      if (!intent.nextAttemptAt) {
        return true
      }
      const nextAttemptMs = Date.parse(intent.nextAttemptAt)
      return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= now.getTime()
    }
    case 'sending': {
      const lastAttemptMs = intent.lastAttemptAt ? Date.parse(intent.lastAttemptAt) : Number.NaN
      return !Number.isFinite(lastAttemptMs) || now.getTime() - lastAttemptMs >= STALE_SENDING_AFTER_MS
    }
    default:
      return false
  }
}

export function shouldBeginAssistantOutboxDispatch(
  intent: AssistantOutboxIntent,
  now: Date,
  force: boolean,
): boolean {
  if (intent.status === 'sending') {
    return shouldDispatchAssistantOutboxIntent(intent, now)
  }

  return force
    ? intent.status === 'pending' || intent.status === 'retryable'
    : shouldDispatchAssistantOutboxIntent(intent, now)
}

export function isAssistantOutboxRetryableError(error: unknown): boolean {
  const explicitRetryable = readAssistantOutboxRetryableFlag(error)
  if (explicitRetryable !== null) {
    return explicitRetryable
  }

  const deliveryError = normalizeAssistantDeliveryError(error)
  const code = deliveryError.code?.toUpperCase() ?? ''
  const message = deliveryError.message.toLowerCase()
  if (assistantOutboxErrorCodeLooksPermanent(code)) {
    return false
  }

  return assistantOutboxErrorCodeLooksRetryable(code) ||
    assistantOutboxErrorMessageLooksRetryable(message)
}

export function normalizeAssistantDeliveryError(
  error: unknown,
): AssistantDeliveryError {
  const diagnosticContext = readAssistantDeliveryErrorDiagnosticContext(error)
  return assistantDeliveryErrorSchema.parse({
    code: readStringProperty(error, 'code'),
    ...(diagnosticContext ? { diagnosticContext } : {}),
    message: redactAssistantStateString(resolveAssistantDeliveryErrorMessage(error)),
  })
}

export function resolveAssistantOutboxRetryDelayMs(attemptCount: number): number {
  return (
    OUTBOX_RETRY_DELAYS_MS[
      Math.min(Math.max(Math.trunc(attemptCount) - 1, 0), OUTBOX_RETRY_DELAYS_MS.length - 1)
    ] ?? OUTBOX_RETRY_DELAYS_MS[OUTBOX_RETRY_DELAYS_MS.length - 1]!
  )
}

export function createAssistantDeliveryConfirmationPendingError(
  cause?: unknown,
): AssistantDeliveryError {
  const detail = cause ? normalizeAssistantDeliveryError(cause).message : null
  return assistantDeliveryErrorSchema.parse({
    code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    message: detail
      ? `Assistant outbound delivery may have succeeded already and must be reconciled before resend. ${detail}`
      : 'Assistant outbound delivery may have succeeded already and must be reconciled before resend.',
  })
}

export function createAssistantDeliveryAmbiguousError(
  cause?: unknown,
): AssistantDeliveryError & { retryable: false } {
  const detail = cause ? normalizeAssistantDeliveryError(cause).message : null
  const preserveMessage = readStringProperty(cause, 'code') === 'ASSISTANT_DELIVERY_AMBIGUOUS'
    && detail
    ? detail
    : null
  return {
    ...assistantDeliveryErrorSchema.parse({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
      message: preserveMessage ?? (detail
        ? `Assistant outbound delivery could not be confirmed safely and will not be resent automatically. ${detail}`
        : 'Assistant outbound delivery could not be confirmed safely and will not be resent automatically.'),
    }),
    retryable: false,
  }
}

function readAssistantOutboxRetryableFlag(error: unknown): boolean | null {
  const contextRetryable = readBooleanProperty(readRecord(error)?.context, 'retryable')
  if (contextRetryable !== null) {
    return contextRetryable
  }

  return readBooleanProperty(error, 'retryable')
}

function resolveAssistantDeliveryErrorMessage(error: unknown): string {
  return readNonEmptyStringProperty(error, 'message') ?? String(error)
}

function readAssistantDeliveryErrorDiagnosticContext(
  source: unknown,
): NonNullable<AssistantDeliveryError['diagnosticContext']> | null {
  const details: NonNullable<AssistantDeliveryError['diagnosticContext']> = {}

  if (source instanceof Error) {
    appendAssistantDeliveryErrorDiagnosticValue(details, 'name', source.name)
  }
  const sourceRecord = readRecord(source)
  appendAssistantDeliveryErrorKnownRecordFields(details, sourceRecord)
  appendAssistantDeliveryErrorDiagnosticRecord(
    details,
    readRecord(sourceRecord?.diagnosticContext),
  )
  appendAssistantDeliveryErrorDiagnosticRecord(
    details,
    readRecord(sourceRecord?.context),
  )
  appendAssistantDeliveryErrorDiagnosticRecord(
    details,
    readRecord(sourceRecord?.details),
  )

  const keys = Object.keys(details)
  if (keys.length === 0 || keys.every((key) => key === 'code' || key === 'name')) {
    return null
  }
  return details
}

function appendAssistantDeliveryErrorKnownRecordFields(
  details: NonNullable<AssistantDeliveryError['diagnosticContext']>,
  record: Record<string, unknown> | null,
): void {
  if (!record) {
    return
  }

  for (const key of [
    'code',
    'errorCode',
    'status',
    'statusCode',
    'responseStatus',
    'retryable',
  ] as const) {
    appendAssistantDeliveryErrorDiagnosticValue(details, key, record[key])
  }
}

function appendAssistantDeliveryErrorDiagnosticRecord(
  details: NonNullable<AssistantDeliveryError['diagnosticContext']>,
  record: Record<string, unknown> | null,
): void {
  if (!record) {
    return
  }

  for (const [key, value] of Object.entries(record)) {
    appendAssistantDeliveryErrorDiagnosticValue(details, key, value)
  }
}

function appendAssistantDeliveryErrorDiagnosticValue(
  details: NonNullable<AssistantDeliveryError['diagnosticContext']>,
  key: string,
  value: unknown,
): void {
  if (Object.keys(details).length >= ASSISTANT_DELIVERY_ERROR_DIAGNOSTIC_MAX_KEYS) {
    return
  }
  if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(key)) {
    return
  }
  if (value === null || typeof value === 'boolean') {
    details[key] = value
    return
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      details[key] = value
    }
    return
  }
  if (typeof value === 'string') {
    const normalized = sanitizeAssistantPortableStateString(
      value,
      ASSISTANT_DELIVERY_ERROR_DIAGNOSTIC_STRING_MAX_LENGTH,
    )
    if (normalized.length > 0) {
      details[key] = normalized
    }
  }
}

function assistantOutboxErrorCodeLooksPermanent(code: string): boolean {
  return code.endsWith('_REQUIRED') || includesAny(code, NON_RETRYABLE_OUTBOX_ERROR_CODE_MARKERS)
}

function assistantOutboxErrorCodeLooksRetryable(code: string): boolean {
  return includesAny(code, RETRYABLE_OUTBOX_ERROR_CODE_MARKERS)
}

function assistantOutboxErrorMessageLooksRetryable(message: string): boolean {
  return includesAny(message, RETRYABLE_OUTBOX_ERROR_MESSAGE_MARKERS)
}

function includesAny(value: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => value.includes(fragment))
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function readBooleanProperty(value: unknown, property: string): boolean | null {
  const record = readRecord(value)
  return record && typeof record[property] === 'boolean'
    ? record[property] as boolean
    : null
}

function readStringProperty(value: unknown, property: string): string | null {
  const record = readRecord(value)
  return record && typeof record[property] === 'string'
    ? record[property] as string
    : null
}

function readNonEmptyStringProperty(value: unknown, property: string): string | null {
  const propertyValue = readStringProperty(value, property)
  return propertyValue && propertyValue.trim().length > 0
    ? propertyValue
    : null
}
