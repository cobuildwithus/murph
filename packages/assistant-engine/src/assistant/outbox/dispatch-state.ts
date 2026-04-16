import {
  assistantOutboxIntentSchema,
  type AssistantChannelDelivery,
  type AssistantDeliveryError,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import { withAssistantRuntimeWriteLock } from '../runtime-write-lock.js'
import { ensureAssistantState } from '../store/persistence.js'
import { appendAssistantTurnReceiptEvent, updateAssistantTurnReceipt } from '../turns.js'
import { writeJsonFileAtomic } from '../shared.js'
import {
  createAssistantDeliveryConfirmationPendingError,
  isAssistantOutboxRetryableError,
  normalizeAssistantDeliveryError,
  resolveAssistantOutboxRetryDelayMs,
} from './retry-policy.js'
import { readAssistantOutboxIntentAtPath } from './store.js'

/**
 * Dispatch-state owns the persisted outbox intent transitions that happen once
 * delivery work begins, so outbox.ts can focus on API orchestration.
 */

export function buildAssistantDeliveryIdempotencyKey(
  intent: Pick<AssistantOutboxIntent, 'intentId'>,
): string {
  return `assistant-outbox:${intent.intentId}`
}

export function errorImpliesAssistantDeliveryMayHaveSucceeded(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'deliveryMayHaveSucceeded' in error &&
    typeof (error as { deliveryMayHaveSucceeded?: unknown }).deliveryMayHaveSucceeded === 'boolean'
  ) {
    return (error as { deliveryMayHaveSucceeded: boolean }).deliveryMayHaveSucceeded
  }

  return normalizeAssistantDeliveryError(error).code === 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING'
}

export async function persistAssistantOutboxIntentDeliveryPendingConfirmation(input: {
  delivery: AssistantChannelDelivery
  deliveryTransportIdempotent: boolean
  intent: AssistantOutboxIntent
  intentPath: string
  vault: string
}): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath)
    const baseIntent = current ?? input.intent
    const pendingIntent = assistantOutboxIntentSchema.parse({
      ...baseIntent,
      deliveryConfirmationPending: shouldPersistLocalDeliveryConfirmationPending({
        deliveryTransportIdempotent: input.deliveryTransportIdempotent,
        intent: baseIntent,
      }),
      deliveryTransportIdempotent: input.deliveryTransportIdempotent,
      deliveryIdempotencyKey:
        input.delivery.idempotencyKey ?? baseIntent.deliveryIdempotencyKey,
      updatedAt: input.delivery.sentAt,
      nextAttemptAt: null,
      status: 'sending',
      delivery: input.delivery,
      lastError: createAssistantDeliveryConfirmationPendingError(),
    })
    await writeJsonFileAtomic(input.intentPath, pendingIntent)
    return pendingIntent
  })
}

export async function markAssistantOutboxIntentSent(input: {
  delivery: AssistantChannelDelivery
  intent: AssistantOutboxIntent
  intentPath: string
  preserveCurrentDispatchMetadata?: boolean
  vault: string
}): Promise<AssistantOutboxIntent> {
  const completedAt = input.delivery.sentAt

  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath)

    if (
      current?.status === 'sent' &&
      current.delivery &&
      sameAssistantChannelDelivery(current.delivery, input.delivery)
    ) {
      return current
    }

    const baseIntent =
      input.preserveCurrentDispatchMetadata === false
        ? input.intent
        : current ?? input.intent
    const sentIntent = assistantOutboxIntentSchema.parse({
      ...baseIntent,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey:
        input.delivery.idempotencyKey ?? baseIntent.deliveryIdempotencyKey,
      updatedAt: completedAt,
      nextAttemptAt: null,
      sentAt: completedAt,
      status: 'sent',
      delivery: input.delivery,
      lastError: null,
    })
    await writeJsonFileAtomic(input.intentPath, sentIntent)
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: sentIntent.turnId,
      kind: 'delivery.sent',
      detail: input.delivery.target,
      metadata: {
        intentId: sentIntent.intentId,
        channel: input.delivery.channel,
        target: input.delivery.target,
      },
      at: completedAt,
    })
    await updateAssistantTurnReceipt({
      vault: input.vault,
      turnId: sentIntent.turnId,
      mutate(receipt) {
        return {
          ...receipt,
          updatedAt: completedAt,
          completedAt,
          status: receipt.status === 'failed' ? 'failed' : 'completed',
          deliveryDisposition: 'sent',
          lastError: null,
        }
      },
    })
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: 'delivery',
      kind: 'delivery.sent',
      message: `Delivered outbound assistant reply over ${input.delivery.channel}.`,
      sessionId: sentIntent.sessionId,
      turnId: sentIntent.turnId,
      intentId: sentIntent.intentId,
      counterDeltas: {
        deliveriesSent: 1,
      },
      at: completedAt,
    })
    return sentIntent
  })
}

export async function updateAssistantOutboxAfterDispatchFailure(input: {
  deliveryMayHaveSucceeded: boolean
  deliveryTransportIdempotent: boolean
  error: unknown
  failedAt: Date
  intentPath: string
  sending: AssistantOutboxIntent
  vault: string
}): Promise<AssistantOutboxIntent> {
  const deliveryError = input.deliveryMayHaveSucceeded
    ? createAssistantDeliveryConfirmationPendingError(input.error)
    : normalizeAssistantDeliveryError(input.error)
  const retryable =
    input.deliveryMayHaveSucceeded || isAssistantOutboxRetryableError(input.error)

  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath)
    const attemptCount = current?.attemptCount ?? input.sending.attemptCount
    const failedAt = input.failedAt.toISOString()
    const nextAttemptAt = retryable
      ? buildAssistantOutboxRetryTimestamp(input.failedAt, attemptCount)
      : null
    const failedIntent = assistantOutboxIntentSchema.parse({
      ...(current ?? input.sending),
      deliveryConfirmationPending: input.deliveryMayHaveSucceeded
        ? shouldPersistLocalDeliveryConfirmationPending({
            deliveryTransportIdempotent: input.deliveryTransportIdempotent,
            intent: current ?? input.sending,
          })
        : false,
      deliveryTransportIdempotent: input.deliveryMayHaveSucceeded
        ? input.deliveryTransportIdempotent
        : (current?.deliveryTransportIdempotent ?? input.sending.deliveryTransportIdempotent),
      updatedAt: failedAt,
      nextAttemptAt,
      status: retryable ? 'retryable' : 'failed',
      lastError: deliveryError,
    })
    await writeJsonFileAtomic(input.intentPath, failedIntent)
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: failedIntent.turnId,
      kind: retryable ? 'delivery.retry-scheduled' : 'delivery.failed',
      detail: deliveryError.message,
      metadata: {
        intentId: failedIntent.intentId,
        retryable: retryable ? 'true' : 'false',
      },
      at: failedIntent.updatedAt,
    })
    await updateAssistantTurnReceipt({
      vault: input.vault,
      turnId: failedIntent.turnId,
      mutate(receipt) {
        return {
          ...receipt,
          updatedAt: failedIntent.updatedAt,
          status: retryable ? 'deferred' : 'failed',
          deliveryDisposition: retryable ? 'retryable' : 'failed',
          lastError: deliveryError,
        }
      },
    })
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: retryable ? 'outbox' : 'delivery',
      kind: retryable ? 'delivery.retry-scheduled' : 'delivery.failed',
      message: deliveryError.message,
      level: retryable ? 'warn' : 'error',
      code: deliveryError.code,
      sessionId: failedIntent.sessionId,
      turnId: failedIntent.turnId,
      intentId: failedIntent.intentId,
      counterDeltas: retryable
        ? {
            deliveriesRetryable: 1,
            outboxRetries: 1,
          }
        : {
            deliveriesFailed: 1,
          },
      at: failedIntent.updatedAt,
    })
    return failedIntent
  })
}

export async function rescheduleAssistantOutboxConfirmationRetry(input: {
  error: AssistantDeliveryError
  intentPath: string
  scheduledAt: Date
  sending: AssistantOutboxIntent
  vault: string
}): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath)
    const baseIntent = current ?? input.sending
    const scheduledAt = input.scheduledAt.toISOString()
    const retryIntent = assistantOutboxIntentSchema.parse({
      ...baseIntent,
      deliveryConfirmationPending: shouldPersistLocalDeliveryConfirmationPending({
        deliveryTransportIdempotent: baseIntent.deliveryTransportIdempotent,
        intent: baseIntent,
      }),
      updatedAt: scheduledAt,
      nextAttemptAt: buildAssistantOutboxRetryTimestamp(
        input.scheduledAt,
        baseIntent.attemptCount,
      ),
      status: 'retryable',
      lastError: input.error,
    })
    await writeJsonFileAtomic(input.intentPath, retryIntent)
    return retryIntent
  })
}

function buildAssistantOutboxRetryTimestamp(at: Date, attemptCount: number): string {
  return new Date(at.getTime() + resolveAssistantOutboxRetryDelayMs(attemptCount)).toISOString()
}

function sameAssistantChannelDelivery(
  left: AssistantChannelDelivery,
  right: AssistantChannelDelivery,
): boolean {
  return (
    left.channel === right.channel &&
    left.idempotencyKey === right.idempotencyKey &&
    left.target === right.target &&
    left.targetKind === right.targetKind &&
    left.sentAt === right.sentAt &&
    left.messageLength === right.messageLength &&
    left.providerMessageId === right.providerMessageId &&
    left.providerThreadId === right.providerThreadId
  )
}

function shouldPersistLocalDeliveryConfirmationPending(input: {
  deliveryTransportIdempotent: boolean
  intent: Pick<AssistantOutboxIntent, 'deliveryStateAuthority'>
}): boolean {
  return input.deliveryTransportIdempotent || input.intent.deliveryStateAuthority !== 'hosted-journal'
}
