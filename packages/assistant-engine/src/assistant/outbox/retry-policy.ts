import {
  assistantDeliveryErrorSchema,
  type AssistantDeliveryError,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { redactAssistantStateString } from '../redaction.js'

const OUTBOX_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000]
const STALE_SENDING_AFTER_MS = 10 * 60 * 1000
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
  return assistantDeliveryErrorSchema.parse({
    code: readStringProperty(error, 'code'),
    message: redactAssistantStateString(
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error),
    ),
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

function readAssistantOutboxRetryableFlag(error: unknown): boolean | null {
  const contextRetryable = readBooleanProperty(readRecord(error)?.context, 'retryable')
  if (contextRetryable !== null) {
    return contextRetryable
  }

  return readBooleanProperty(error, 'retryable')
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
