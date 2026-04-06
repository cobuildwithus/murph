import {
  assistantDeliveryErrorSchema,
  type AssistantDeliveryError,
  type AssistantOutboxIntent,
} from '../../assistant-cli-contracts.js'
import { redactAssistantStateString } from '../redaction.js'

const OUTBOX_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000]
const STALE_SENDING_AFTER_MS = 10 * 60 * 1000

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
  if (
    typeof error === 'object' &&
    error !== null &&
    'context' in error &&
    typeof (error as { context?: unknown }).context === 'object' &&
    (error as { context?: Record<string, unknown> }).context !== null &&
    typeof (error as { context: Record<string, unknown> }).context.retryable === 'boolean'
  ) {
    return (error as { context: { retryable: boolean } }).context.retryable
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    typeof (error as { retryable?: unknown }).retryable === 'boolean'
  ) {
    return (error as { retryable: boolean }).retryable
  }

  const deliveryError = normalizeAssistantDeliveryError(error)
  const code = deliveryError.code?.toUpperCase() ?? ''
  const message = deliveryError.message.toLowerCase()
  if (
    code.endsWith('_REQUIRED') ||
    code.includes('UNSUPPORTED') ||
    code.includes('INVALID') ||
    code.includes('TARGET_REQUIRED') ||
    code.includes('CHANNEL_REQUIRED')
  ) {
    return false
  }

  return (
    code.includes('REQUEST_FAILED') ||
    code.includes('DELIVERY_FAILED') ||
    code.includes('TIMEOUT') ||
    code.includes('CONNECTION') ||
    code.includes('UNAVAILABLE') ||
    code.includes('RATE') ||
    code.includes('LIMIT') ||
    message.includes('timed out') ||
    message.includes('temporary') ||
    message.includes('retry') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('connection') ||
    message.includes('network')
  )
}

export function normalizeAssistantDeliveryError(
  error: unknown,
): AssistantDeliveryError {
  return assistantDeliveryErrorSchema.parse({
    code:
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null,
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
