import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  type AssistantChannelDelivery,
  assistantDeliveryErrorSchema,
  assistantOutboxIntentSchema,
  type AssistantDeliveryError,
  type AssistantOutboxIntent,
  type AssistantSession,
  type AssistantStatusOutboxSummary,
} from '../assistant-cli-contracts.js'
import type { AssistantChannelDependencies } from './channel-adapters.js'
import { deliverAssistantMessageOverBinding } from '../outbound-channel.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths, saveAssistantSession } from './store.js'
import { appendAssistantTurnReceiptEvent, updateAssistantTurnReceipt } from './turns.js'
import { isMissingFileError, normalizeNullableString, writeJsonFileAtomic } from './shared.js'

const ASSISTANT_OUTBOX_INTENT_SCHEMA = 'healthybob.assistant-outbox-intent.v1'
const OUTBOX_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000]
const STALE_SENDING_AFTER_MS = 10 * 60 * 1000

export interface DispatchAssistantOutboxIntentResult {
  deliveryError: AssistantDeliveryError | null
  intent: AssistantOutboxIntent
  session: AssistantSession | null
}

export type AssistantOutboxDispatchMode = 'immediate' | 'queue-only'

export interface AssistantOutboxDispatchHooks {
  persistDeliveredIntent?: (input: {
    delivery: AssistantChannelDelivery
    intent: AssistantOutboxIntent
    vault: string
  }) => Promise<void>
  resolveDeliveredIntent?: (input: {
    intent: AssistantOutboxIntent
    vault: string
  }) => Promise<AssistantChannelDelivery | null>
}

export type DeliverAssistantOutboxMessageResult =
  | {
      delivery: AssistantChannelDelivery
      deliveryError: null
      intent: AssistantOutboxIntent
      kind: 'sent'
      session: AssistantSession | null
    }
  | {
      delivery: null
      deliveryError: AssistantDeliveryError | null
      intent: AssistantOutboxIntent
      kind: 'queued'
      session: AssistantSession | null
    }
  | {
      delivery: null
      deliveryError: AssistantDeliveryError
      intent: AssistantOutboxIntent
      kind: 'failed'
      session: AssistantSession | null
    }

export async function createAssistantOutboxIntent(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  createdAt?: string
  explicitTarget?: string | null
  identityId?: string | null
  message: string
  sessionId: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
  vault: string
}): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const createdAt = input.createdAt ?? new Date().toISOString()
    const message = normalizeRequiredMessage(input.message)
    const dedupeKey = hashAssistantOutboxIdentity({
      message,
      sessionId: input.sessionId,
      turnId: input.turnId,
      channel: input.channel,
      identityId: input.identityId,
      actorId: input.actorId,
      threadId: input.threadId,
      explicitTarget: input.explicitTarget,
      bindingDelivery: input.bindingDelivery,
    })
    const existing = await findAssistantOutboxIntentByDedupeKey(input.vault, dedupeKey)
    if (existing) {
      return existing
    }

    const intent = assistantOutboxIntentSchema.parse({
      schema: ASSISTANT_OUTBOX_INTENT_SCHEMA,
      intentId: `outbox_${randomUUID().replace(/-/gu, '')}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      createdAt,
      updatedAt: createdAt,
      lastAttemptAt: null,
      nextAttemptAt: createdAt,
      sentAt: null,
      attemptCount: 0,
      status: 'pending',
      message,
      dedupeKey,
      targetFingerprint: hashAssistantOutboxTargetFingerprint({
        channel: input.channel,
        identityId: input.identityId,
        actorId: input.actorId,
        threadId: input.threadId,
        explicitTarget: input.explicitTarget,
        bindingDelivery: input.bindingDelivery,
      }),
      channel: normalizeNullableString(input.channel),
      identityId: normalizeNullableString(input.identityId),
      actorId: normalizeNullableString(input.actorId),
      threadId: normalizeNullableString(input.threadId),
      threadIsDirect:
        typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null,
      bindingDelivery: input.bindingDelivery ?? null,
      explicitTarget: normalizeNullableString(input.explicitTarget),
      delivery: null,
      lastError: null,
    })
    await writeJsonFileAtomic(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, intent.intentId),
      intent,
    )
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: input.turnId,
      kind: 'delivery.queued',
      detail: 'outbound delivery queued',
      metadata: {
        intentId: intent.intentId,
        channel: intent.channel ?? 'unknown',
      },
      at: createdAt,
    })
    await updateAssistantTurnReceipt({
      vault: input.vault,
      turnId: input.turnId,
      mutate(receipt) {
        return {
          ...receipt,
          updatedAt: createdAt,
          deliveryDisposition: 'queued',
          deliveryIntentId: intent.intentId,
        }
      },
    })
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: 'outbox',
      kind: 'delivery.queued',
      message: `Queued outbound delivery for ${intent.channel ?? 'unknown'} channel.`,
      sessionId: intent.sessionId,
      turnId: intent.turnId,
      intentId: intent.intentId,
      counterDeltas: {
        deliveriesQueued: 1,
      },
    })

    return intent
  })
}

export async function readAssistantOutboxIntent(
  vault: string,
  intentId: string,
): Promise<AssistantOutboxIntent | null> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  try {
    const parsed = JSON.parse(
      await readFile(resolveAssistantOutboxIntentPath(paths.outboxDirectory, intentId), 'utf8'),
    ) as unknown
    if (isLegacyAssistantOutboxIntent(parsed)) {
      return null
    }
    return assistantOutboxIntentSchema.parse(parsed)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

export async function saveAssistantOutboxIntent(
  vault: string,
  intent: AssistantOutboxIntent,
): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsed = assistantOutboxIntentSchema.parse(intent)
    await writeJsonFileAtomic(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, parsed.intentId),
      parsed,
    )
    return parsed
  })
}

export async function listAssistantOutboxIntents(
  vault: string,
): Promise<AssistantOutboxIntent[]> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  const entries = await readdir(paths.outboxDirectory, {
    withFileTypes: true,
  })
  const intents: AssistantOutboxIntent[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const intent = await readAssistantOutboxIntent(
      vault,
      entry.name.replace(/\.json$/u, ''),
    )
    if (intent) {
      intents.push(intent)
    }
  }

  return intents.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export async function dispatchAssistantOutboxIntent(input: {
  dependencies?: AssistantChannelDependencies
  dispatchHooks?: AssistantOutboxDispatchHooks
  force?: boolean
  intentId: string
  now?: Date
  vault: string
}): Promise<DispatchAssistantOutboxIntentResult> {
  const now = input.now ?? new Date()
  const prepared = await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, input.intentId)
    const intent = await readAssistantOutboxIntentAtPath(intentPath)
    if (!intent) {
      throw new Error(`Assistant outbox intent ${input.intentId} was not found.`)
    }

    if (!shouldBeginAssistantOutboxDispatch(intent, now, input.force === true)) {
      return {
        action: 'skip' as const,
        intent,
      }
    }

    const startedAt = now.toISOString()
    const sending = assistantOutboxIntentSchema.parse({
      ...intent,
      updatedAt: startedAt,
      lastAttemptAt: startedAt,
      attemptCount: intent.attemptCount + 1,
      status: 'sending',
    })
    await writeJsonFileAtomic(intentPath, sending)
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: sending.turnId,
      kind: 'delivery.attempt.started',
      detail: `attempt ${sending.attemptCount}`,
      metadata: {
        intentId: sending.intentId,
        attempt: String(sending.attemptCount),
      },
      at: startedAt,
    })

    return {
      action: 'dispatch' as const,
      intent,
      intentPath,
      sending,
    }
  })

  if (prepared.action === 'skip') {
    return {
      intent: prepared.intent,
      deliveryError: prepared.intent.lastError,
      session: null,
    }
  }

  try {
    const reconciledDelivery =
      (await input.dispatchHooks?.resolveDeliveredIntent?.({
        intent: prepared.sending,
        vault: input.vault,
      })) ?? null
    if (reconciledDelivery) {
      const sentIntent = await markAssistantOutboxIntentSent({
        delivery: reconciledDelivery,
        intent: prepared.intent,
        intentPath: prepared.intentPath,
        preserveCurrentDispatchMetadata: false,
        vault: input.vault,
      })

      return {
        intent: sentIntent,
        deliveryError: null,
        session: null,
      }
    }

    maybeThrowInjectedAssistantFault({
      component: 'delivery',
      fault: 'delivery',
      message: 'Injected assistant delivery failure.',
    })
    const delivered = await deliverAssistantMessageOverBinding({
      vault: input.vault,
      sessionId: prepared.sending.sessionId,
      message: prepared.sending.message,
      channel: prepared.sending.channel,
      identityId: prepared.sending.identityId,
      actorId: prepared.sending.actorId,
      threadId: prepared.sending.threadId,
      threadIsDirect: prepared.sending.threadIsDirect,
      target: prepared.sending.explicitTarget ?? null,
      session: {
        binding: {
          conversationKey: null,
          channel: prepared.sending.channel,
          identityId: prepared.sending.identityId,
          actorId: prepared.sending.actorId,
          threadId: prepared.sending.threadId,
          threadIsDirect: prepared.sending.threadIsDirect,
          delivery: prepared.sending.bindingDelivery,
        },
      },
    }, input.dependencies)

    await input.dispatchHooks?.persistDeliveredIntent?.({
      delivery: delivered.delivery,
      intent: prepared.sending,
      vault: input.vault,
    })

    const completedAt = delivered.delivery.sentAt
    if (delivered.session) {
      try {
        await saveAssistantSession(input.vault, delivered.session)
      } catch {}
    }
    const sentIntent = await markAssistantOutboxIntentSent({
      delivery: delivered.delivery,
      intent: prepared.sending,
      intentPath: prepared.intentPath,
      vault: input.vault,
    })

    return {
      intent: sentIntent,
      deliveryError: null,
      session: delivered.session ?? null,
    }
  } catch (error) {
    const deliveryError = normalizeAssistantDeliveryError(error)
    const retryable = isAssistantOutboxRetryableError(error)
    const failedIntent = await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
      await ensureAssistantState(paths)
      const current =
        await readAssistantOutboxIntentAtPath(prepared.intentPath)
      const attemptCount = current?.attemptCount ?? prepared.sending.attemptCount
      const updatedAt = new Date().toISOString()
      const nextAttemptAt = retryable
        ? new Date(now.getTime() + resolveAssistantOutboxRetryDelayMs(attemptCount)).toISOString()
        : null
      const failedIntent = assistantOutboxIntentSchema.parse({
        ...(current ?? prepared.sending),
        updatedAt,
        nextAttemptAt,
        status: retryable ? 'retryable' : 'failed',
        lastError: deliveryError,
      })
      await writeJsonFileAtomic(prepared.intentPath, failedIntent)
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
      })
      return failedIntent
    })

    return {
      intent: failedIntent,
      deliveryError,
      session: null,
    }
  }
}

export async function deliverAssistantOutboxMessage(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  dependencies?: AssistantChannelDependencies
  dispatchHooks?: AssistantOutboxDispatchHooks
  dispatchMode?: AssistantOutboxDispatchMode
  explicitTarget?: string | null
  identityId?: string | null
  message: string
  sessionId: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
  vault: string
}): Promise<DeliverAssistantOutboxMessageResult> {
  const intent = await createAssistantOutboxIntent({
    actorId: input.actorId,
    bindingDelivery: input.bindingDelivery,
    channel: input.channel,
    explicitTarget: input.explicitTarget,
    identityId: input.identityId,
    message: input.message,
    sessionId: input.sessionId,
    threadId: input.threadId,
    threadIsDirect: input.threadIsDirect,
    turnId: input.turnId,
    vault: input.vault,
  })

  if (intent.status === 'sent' && intent.delivery) {
    return {
      kind: 'sent',
      intent,
      delivery: intent.delivery,
      deliveryError: null,
      session: null,
    }
  }

  if ((input.dispatchMode ?? 'immediate') === 'queue-only') {
    return {
      kind: 'queued',
      intent,
      delivery: null,
      deliveryError: null,
      session: null,
    }
  }

  const dispatched = await dispatchAssistantOutboxIntent({
    dependencies: input.dependencies,
    dispatchHooks: input.dispatchHooks,
    force: true,
    intentId: intent.intentId,
    vault: input.vault,
  })
  if (dispatched.intent.status === 'sent' && dispatched.intent.delivery) {
    return {
      kind: 'sent',
      intent: dispatched.intent,
      delivery: dispatched.intent.delivery,
      deliveryError: null,
      session: dispatched.session ?? null,
    }
  }

  if (
    dispatched.intent.status === 'pending' ||
    dispatched.intent.status === 'retryable' ||
    dispatched.intent.status === 'sending'
  ) {
    return {
      kind: 'queued',
      intent: dispatched.intent,
      delivery: null,
      deliveryError: dispatched.deliveryError,
      session: dispatched.session ?? null,
    }
  }

  return {
    kind: 'failed',
    intent: dispatched.intent,
    delivery: null,
    deliveryError:
      dispatched.deliveryError ??
      normalizeAssistantDeliveryError(new Error('Assistant outbound delivery failed.')),
    session: dispatched.session ?? null,
  }
}

export async function drainAssistantOutbox(input: {
  dependencies?: AssistantChannelDependencies
  dispatchHooks?: AssistantOutboxDispatchHooks
  limit?: number
  now?: Date
  vault: string
}): Promise<{
  attempted: number
  failed: number
  queued: number
  sent: number
}> {
  maybeThrowInjectedAssistantFault({
    component: 'outbox',
    fault: 'outbox',
    message: 'Injected assistant outbox drain failure.',
  })
  const now = input.now ?? new Date()
  const intents = await listAssistantOutboxIntents(input.vault)
  const due = intents.filter((intent) => shouldDispatchAssistantOutboxIntent(intent, now))
  const limit = Math.max(0, Math.trunc(input.limit ?? due.length))
  const selected = due.slice(0, limit)
  let sent = 0
  let failed = 0
  let queued = 0

  if (selected.length > 0) {
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: 'outbox',
      kind: 'outbox.drain',
      message: `Draining ${selected.length} assistant outbox intent(s).`,
      counterDeltas: {
        outboxDrains: 1,
      },
    })
  }

  for (const intent of selected) {
    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: input.dependencies,
      dispatchHooks: input.dispatchHooks,
      vault: input.vault,
      intentId: intent.intentId,
      now,
    })
    switch (dispatched.intent.status) {
      case 'sent':
        sent += 1
        break
      case 'retryable':
      case 'pending':
      case 'sending':
        queued += 1
        break
      default:
        failed += 1
        break
    }
  }

  return {
    attempted: selected.length,
    sent,
    failed,
    queued,
  }
}

async function markAssistantOutboxIntentSent(input: {
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
    const baseIntent =
      input.preserveCurrentDispatchMetadata === false
        ? input.intent
        : current ?? input.intent
    const sentIntent = assistantOutboxIntentSchema.parse({
      ...baseIntent,
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

export async function buildAssistantOutboxSummary(
  vault: string,
): Promise<AssistantStatusOutboxSummary> {
  const intents = await listAssistantOutboxIntents(vault)
  let oldestPendingAt: string | null = null
  let nextAttemptAt: string | null = null

  for (const intent of intents) {
    if (
      (intent.status === 'pending' || intent.status === 'retryable' || intent.status === 'sending') &&
      (!oldestPendingAt || intent.createdAt < oldestPendingAt)
    ) {
      oldestPendingAt = intent.createdAt
    }
    if (
      (intent.status === 'pending' || intent.status === 'retryable') &&
      intent.nextAttemptAt &&
      (!nextAttemptAt || intent.nextAttemptAt < nextAttemptAt)
    ) {
      nextAttemptAt = intent.nextAttemptAt
    }
  }

  return {
    total: intents.length,
    pending: intents.filter((intent) => intent.status === 'pending').length,
    sending: intents.filter((intent) => intent.status === 'sending').length,
    retryable: intents.filter((intent) => intent.status === 'retryable').length,
    sent: intents.filter((intent) => intent.status === 'sent').length,
    failed: intents.filter((intent) => intent.status === 'failed').length,
    abandoned: intents.filter((intent) => intent.status === 'abandoned').length,
    oldestPendingAt,
    nextAttemptAt,
  }
}

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
    message:
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error),
  })
}

function normalizeRequiredMessage(value: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new Error('Assistant outbox messages must be non-empty strings.')
  }

  return normalized
}

function resolveAssistantOutboxIntentPath(
  outboxDirectory: string,
  intentId: string,
): string {
  return path.join(outboxDirectory, `${intentId}.json`)
}

function isLegacyAssistantOutboxIntent(input: unknown): boolean {
  if (!isRecord(input)) {
    return false
  }

  const schema = readRecordNullableString(input, 'schema')
  const intentId = readRecordNullableString(input, 'intentId')
  const sessionId = readRecordNullableString(input, 'sessionId')
  const idempotencyKey = readRecordNullableString(input, 'idempotencyKey')

  return (
    schema === ASSISTANT_OUTBOX_INTENT_SCHEMA &&
    intentId !== null &&
    sessionId !== null &&
    idempotencyKey !== null &&
    !('turnId' in input) &&
    !('dedupeKey' in input) &&
    !('message' in input)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecordNullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key]
  return typeof value === 'string' ? normalizeNullableString(value) : null
}

async function findAssistantOutboxIntentByDedupeKey(
  vault: string,
  dedupeKey: string,
): Promise<AssistantOutboxIntent | null> {
  const intents = await listAssistantOutboxIntents(vault)
  return (
    intents.find((intent) => {
      if (intent.dedupeKey !== dedupeKey) {
        return false
      }

      return intent.status !== 'failed' && intent.status !== 'abandoned'
    }) ?? null
  )
}

function hashAssistantOutboxIdentity(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  message: string
  sessionId: string
  threadId?: string | null
  turnId: string
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        message: input.message,
        sessionId: input.sessionId,
        turnId: input.turnId,
        channel: input.channel,
        identityId: input.identityId,
        actorId: input.actorId,
        threadId: input.threadId,
        explicitTarget: input.explicitTarget,
        bindingDelivery: input.bindingDelivery,
      }),
    )
    .digest('hex')
}

function hashAssistantOutboxTargetFingerprint(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  threadId?: string | null
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        channel: input.channel,
        identityId: input.identityId,
        actorId: input.actorId,
        threadId: input.threadId,
        explicitTarget: input.explicitTarget,
        bindingDelivery: input.bindingDelivery,
      }),
    )
    .digest('hex')
}

function resolveAssistantOutboxRetryDelayMs(attemptCount: number): number {
  return (
    OUTBOX_RETRY_DELAYS_MS[
      Math.min(Math.max(Math.trunc(attemptCount) - 1, 0), OUTBOX_RETRY_DELAYS_MS.length - 1)
    ] ?? OUTBOX_RETRY_DELAYS_MS[OUTBOX_RETRY_DELAYS_MS.length - 1]!
  )
}

async function readAssistantOutboxIntentAtPath(
  intentPath: string,
): Promise<AssistantOutboxIntent | null> {
  try {
    const parsed = JSON.parse(await readFile(intentPath, 'utf8')) as unknown
    if (isLegacyAssistantOutboxIntent(parsed)) {
      return null
    }
    return assistantOutboxIntentSchema.parse(parsed)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

function shouldBeginAssistantOutboxDispatch(
  intent: AssistantOutboxIntent,
  now: Date,
  force: boolean,
): boolean {
  if (intent.status === 'sending') {
    return shouldDispatchAssistantOutboxIntent(intent, now)
  }

  return force ? intent.status === 'pending' || intent.status === 'retryable' : shouldDispatchAssistantOutboxIntent(intent, now)
}
