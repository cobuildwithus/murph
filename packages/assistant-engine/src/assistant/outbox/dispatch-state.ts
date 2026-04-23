import {
  assistantChannelDeliverySchema,
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
  createAssistantDeliveryAmbiguousError,
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

export interface AssistantOutboxIntentMirrorState {
  intent: AssistantOutboxIntent | null
  sendingPastGraceWindow: boolean
  sendingStartedAt: string | null
}

export function buildAssistantOutboxIntentMirrorState(input: {
  intent: AssistantOutboxIntent | null
  now?: Date
  sendingGraceMs?: number
}): AssistantOutboxIntentMirrorState {
  const intent = input.intent
  if (!intent || intent.status !== 'sending') {
    return {
      intent,
      sendingPastGraceWindow: false,
      sendingStartedAt: null,
    }
  }

  const sendingStartedAt = intent.lastAttemptAt ?? intent.updatedAt ?? null
  const sendingGraceMs = input.sendingGraceMs
  const nowMs = (input.now ?? new Date()).getTime()
  const sendingStartedAtMs = sendingStartedAt ? Date.parse(sendingStartedAt) : Number.NaN

  return {
    intent,
    sendingPastGraceWindow:
      typeof sendingGraceMs === 'number' &&
      (!Number.isFinite(sendingStartedAtMs) || nowMs - sendingStartedAtMs >= sendingGraceMs),
    sendingStartedAt,
  }
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
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    const baseIntent = current ?? input.intent
    const pendingIntent = assistantOutboxIntentSchema.parse({
      ...baseIntent,
      deliveryConfirmationPending: input.deliveryTransportIdempotent,
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
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })

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
  const ambiguousDelivery = readTelegramAmbiguousDeliveryFromError({
    error: input.error,
    failedAt: input.failedAt,
    sending: input.sending,
  })
  const deliveryError = ambiguousDelivery
    ? createAssistantDeliveryAmbiguousError(input.error)
    : input.deliveryMayHaveSucceeded
      ? createAssistantDeliveryConfirmationPendingError(input.error)
      : normalizeAssistantDeliveryError(input.error)
  const retryable = ambiguousDelivery
    ? false
    : input.deliveryMayHaveSucceeded || isAssistantOutboxRetryableError(input.error)

  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    const attemptCount = current?.attemptCount ?? input.sending.attemptCount
    const failedAt = input.failedAt.toISOString()
    const nextAttemptAt = retryable
      ? buildAssistantOutboxRetryTimestamp(input.failedAt, attemptCount)
      : null
    const failedIntent = assistantOutboxIntentSchema.parse({
      ...(current ?? input.sending),
      delivery: ambiguousDelivery ?? current?.delivery ?? input.sending.delivery,
      deliveryConfirmationPending: input.deliveryMayHaveSucceeded
        ? ambiguousDelivery
          ? false
          : input.deliveryTransportIdempotent
        : false,
      deliveryTransportIdempotent: ambiguousDelivery
        ? false
        : input.deliveryMayHaveSucceeded
        ? input.deliveryTransportIdempotent
        : (current?.deliveryTransportIdempotent ?? input.sending.deliveryTransportIdempotent),
      updatedAt: failedAt,
      nextAttemptAt,
      status: ambiguousDelivery ? 'abandoned' : retryable ? 'retryable' : 'failed',
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

function readTelegramAmbiguousDeliveryFromError(input: {
  error: unknown
  failedAt: Date
  sending: AssistantOutboxIntent
}): AssistantChannelDelivery | null {
  if (input.sending.channel !== 'telegram') {
    return null
  }

  const errorRecord = readRecord(input.error)
  const context = readRecord(errorRecord?.context)
  const providerMessageIds =
    readNonEmptyStringArray(errorRecord?.providerMessageIds) ??
    readNonEmptyStringArray(context?.providerMessageIds) ??
    null
  const target =
    readNonEmptyString(errorRecord?.target) ??
    readNonEmptyString(context?.target) ??
    null
  const targetKind = inferAssistantOutboxFailureTargetKind(input.sending)
  if (!providerMessageIds || !target || !targetKind) {
    return null
  }

  return assistantChannelDeliverySchema.parse({
    channel: 'telegram',
    idempotencyKey: input.sending.deliveryIdempotencyKey,
    messageLength: input.sending.message.length,
    providerMessageId: providerMessageIds.at(-1) ?? null,
    providerMessageIds,
    providerThreadId: null,
    sentAt: input.failedAt.toISOString(),
    target,
    targetKind,
  })
}

function inferAssistantOutboxFailureTargetKind(
  intent: Pick<AssistantOutboxIntent, 'bindingDelivery' | 'explicitTarget'>,
): AssistantChannelDelivery['targetKind'] | null {
  if (intent.explicitTarget) {
    return 'explicit'
  }

  return intent.bindingDelivery?.kind ?? null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readNonEmptyStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const normalized = value
    .map((entry) => readNonEmptyString(entry))
    .filter((entry): entry is string => entry !== null)

  return normalized.length > 0 ? normalized : null
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
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    const baseIntent = current ?? input.sending
    const scheduledAt = input.scheduledAt.toISOString()
    const retryIntent = assistantOutboxIntentSchema.parse({
      ...baseIntent,
      deliveryConfirmationPending: baseIntent.deliveryTransportIdempotent,
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
    sameAssistantDeliveryProviderMessageIds(
      left.providerMessageIds,
      right.providerMessageIds,
    ) &&
    left.providerThreadId === right.providerThreadId
  )
}

function sameAssistantDeliveryProviderMessageIds(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (!left && !right) {
    return true
  }

  if (!left || !right || left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

export async function markAssistantOutboxIntentMirrorSending(input: {
  deliveryIdempotencyKey?: string | null
  deliveryTransportIdempotent: boolean
  intent: AssistantOutboxIntent
  intentPath: string
  startedAt: string
  vault: string
}): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    const baseIntent = current ?? input.intent
    const deliveryIdempotencyKey =
      input.deliveryIdempotencyKey ?? baseIntent.deliveryIdempotencyKey
    if (
      baseIntent.status === 'sending' &&
      baseIntent.lastAttemptAt === input.startedAt &&
      baseIntent.deliveryTransportIdempotent === input.deliveryTransportIdempotent &&
      baseIntent.deliveryIdempotencyKey === deliveryIdempotencyKey
    ) {
      return baseIntent
    }
    const sendingIntent = assistantOutboxIntentSchema.parse({
      ...baseIntent,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey,
      deliveryTransportIdempotent: input.deliveryTransportIdempotent,
      updatedAt: input.startedAt,
      lastAttemptAt: input.startedAt,
      nextAttemptAt: null,
      attemptCount: baseIntent.attemptCount + 1,
      status: 'sending',
    })
    await writeJsonFileAtomic(input.intentPath, sendingIntent)
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: sendingIntent.turnId,
      kind: 'delivery.attempt.started',
      detail: `attempt ${sendingIntent.attemptCount}`,
      metadata: {
        intentId: sendingIntent.intentId,
        attempt: String(sendingIntent.attemptCount),
      },
      at: input.startedAt,
    })
    return sendingIntent
  })
}

export async function markAssistantOutboxIntentMirrorRetryable(input: {
  error: unknown
  failedAt: Date
  intent: AssistantOutboxIntent
  intentPath: string
  vault: string
}): Promise<AssistantOutboxIntent> {
  return persistAssistantOutboxIntentMirrorFailure({
    ...input,
    retryable: true,
    status: 'retryable',
  })
}

export async function markAssistantOutboxIntentMirrorTerminal(input: {
  error: unknown
  failedAt: Date
  intent: AssistantOutboxIntent
  intentPath: string
  status: 'abandoned' | 'failed'
  vault: string
}): Promise<AssistantOutboxIntent> {
  return persistAssistantOutboxIntentMirrorFailure({
    ...input,
    retryable: false,
  })
}

async function persistAssistantOutboxIntentMirrorFailure(input: {
  error: unknown
  failedAt: Date
  intent: AssistantOutboxIntent
  intentPath: string
  retryable: boolean
  status: 'abandoned' | 'failed' | 'retryable'
  vault: string
}): Promise<AssistantOutboxIntent> {
  const deliveryError = normalizeAssistantDeliveryError(input.error)

  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    const baseIntent = current ?? input.intent
    const failedAt = input.failedAt.toISOString()
    const nextAttemptAt = input.retryable
      ? buildAssistantOutboxRetryTimestamp(input.failedAt, baseIntent.attemptCount)
      : null
    const updatedIntent = assistantOutboxIntentSchema.parse({
      ...baseIntent,
      deliveryConfirmationPending: false,
      updatedAt: failedAt,
      nextAttemptAt,
      status: input.status,
      lastError: deliveryError,
    })
    await writeJsonFileAtomic(input.intentPath, updatedIntent)
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: updatedIntent.turnId,
      kind: input.retryable ? 'delivery.retry-scheduled' : 'delivery.failed',
      detail: deliveryError.message,
      metadata: {
        intentId: updatedIntent.intentId,
        retryable: input.retryable ? 'true' : 'false',
      },
      at: updatedIntent.updatedAt,
    })
    await updateAssistantTurnReceipt({
      vault: input.vault,
      turnId: updatedIntent.turnId,
      mutate(receipt) {
        return {
          ...receipt,
          updatedAt: updatedIntent.updatedAt,
          status: input.retryable ? 'deferred' : 'failed',
          deliveryDisposition: input.retryable ? 'retryable' : 'failed',
          lastError: deliveryError,
        }
      },
    })
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: input.retryable ? 'outbox' : 'delivery',
      kind: input.retryable ? 'delivery.retry-scheduled' : 'delivery.failed',
      message: deliveryError.message,
      level: input.retryable ? 'warn' : 'error',
      code: deliveryError.code,
      sessionId: updatedIntent.sessionId,
      turnId: updatedIntent.turnId,
      intentId: updatedIntent.intentId,
      counterDeltas: input.retryable
        ? {
            deliveriesRetryable: 1,
            outboxRetries: 1,
          }
        : {
            deliveriesFailed: 1,
          },
      at: updatedIntent.updatedAt,
    })
    return updatedIntent
  })
}
