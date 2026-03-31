import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import {
  type AssistantChannelDelivery,
  assistantChannelDeliverySchema,
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
import { redactAssistantStateString } from './redaction.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths, saveAssistantSession } from './store.js'
import { appendAssistantTurnReceiptEvent, updateAssistantTurnReceipt } from './turns.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  normalizeNullableString,
  warnAssistantBestEffortFailure,
  writeJsonFileAtomic,
} from './shared.js'
import { resolveAssistantOpaqueStateFilePath } from './state-ids.js'

const ASSISTANT_OUTBOX_INTENT_SCHEMA = 'murph.assistant-outbox-intent.v1'
const OUTBOX_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000]
const STALE_SENDING_AFTER_MS = 10 * 60 * 1000

export type { AssistantChannelDelivery }

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

type AssistantOutboxRawTargetIdentityInput = {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  replyToMessageId?: string | null
  threadId?: string | null
}

type AssistantOutboxPersistedTargetInput = AssistantOutboxRawTargetIdentityInput & {
  threadIsDirect?: boolean | null
}

type AssistantOutboxPersistedTarget = Pick<
  AssistantOutboxIntent,
  | 'actorId'
  | 'bindingDelivery'
  | 'channel'
  | 'explicitTarget'
  | 'identityId'
  | 'replyToMessageId'
  | 'threadId'
  | 'threadIsDirect'
>

export async function createAssistantOutboxIntent(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  createdAt?: string
  dedupeToken?: string | null
  deliveryIdempotencyKey?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  message: string
  replyToMessageId?: string | null
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
    const rawTargetIdentity = buildAssistantOutboxRawTargetIdentity(input)
    const dedupeKey = hashAssistantOutboxIdentity({
      dedupeToken: input.dedupeToken,
      message,
      sessionId: input.sessionId,
      turnId: input.turnId,
      ...rawTargetIdentity,
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
      targetFingerprint: hashAssistantOutboxTargetFingerprint(rawTargetIdentity),
      ...buildAssistantOutboxPersistedTarget(input),
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: normalizeNullableString(input.deliveryIdempotencyKey),
      deliveryTransportIdempotent: false,
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
  return listAssistantOutboxIntentsLocal(vault)
}

export async function listAssistantOutboxIntentsLocal(
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

    const intent = await readAssistantOutboxIntentInventoryEntry(
      vault,
      path.join(paths.outboxDirectory, entry.name),
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

    if (intent.deliveryConfirmationPending && !intent.deliveryTransportIdempotent) {
      return {
        action: 'reconcile' as const,
        intent,
        intentPath,
      }
    }

    const startedAt = now.toISOString()
    const sending = assistantOutboxIntentSchema.parse({
      ...intent,
      deliveryIdempotencyKey:
        intent.deliveryIdempotencyKey ?? buildAssistantDeliveryIdempotencyKey(intent),
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

  const dispatchIntent = prepared.action === 'dispatch' ? prepared.sending : prepared.intent
  const dispatchIntentPath = prepared.intentPath
  let deliveryMayHaveSucceeded = false
  let deliveryTransportIdempotent = dispatchIntent.deliveryTransportIdempotent

  try {
    const reconciledDelivery =
      (await input.dispatchHooks?.resolveDeliveredIntent?.({
        intent: dispatchIntent,
        vault: input.vault,
      })) ?? null
    if (reconciledDelivery) {
      const sentIntent = await markAssistantOutboxIntentSent({
        delivery: reconciledDelivery,
        intent: prepared.intent,
        intentPath: dispatchIntentPath,
        preserveCurrentDispatchMetadata: false,
        vault: input.vault,
      })

      return {
        intent: sentIntent,
        deliveryError: null,
        session: null,
      }
    }

    if (
      dispatchIntent.deliveryConfirmationPending &&
      !dispatchIntent.deliveryTransportIdempotent
    ) {
      const retryIntent = await rescheduleAssistantOutboxConfirmationRetry({
        error: createAssistantDeliveryConfirmationPendingError(),
        intentPath: dispatchIntentPath,
        now,
        sending: dispatchIntent,
        vault: input.vault,
      })
      return {
        intent: retryIntent,
        deliveryError: retryIntent.lastError,
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
      sessionId: dispatchIntent.sessionId,
      message: dispatchIntent.message,
      channel: dispatchIntent.channel,
      idempotencyKey: dispatchIntent.deliveryIdempotencyKey,
      identityId: dispatchIntent.identityId,
      actorId: dispatchIntent.actorId,
      threadId: dispatchIntent.threadId,
      threadIsDirect: dispatchIntent.threadIsDirect,
      replyToMessageId: dispatchIntent.replyToMessageId,
      target: dispatchIntent.explicitTarget ?? null,
      session: {
        binding: {
          conversationKey: null,
          channel: dispatchIntent.channel,
          identityId: dispatchIntent.identityId,
          actorId: dispatchIntent.actorId,
          threadId: dispatchIntent.threadId,
          threadIsDirect: dispatchIntent.threadIsDirect,
          delivery: dispatchIntent.bindingDelivery,
        },
      },
    }, input.dependencies)
    const delivery = assistantChannelDeliverySchema.parse({
      ...delivered.delivery,
      idempotencyKey:
        delivered.delivery.idempotencyKey ??
        dispatchIntent.deliveryIdempotencyKey,
    })
    deliveryTransportIdempotent = delivered.deliveryTransportIdempotent === true
    deliveryMayHaveSucceeded = true
    const deliveredIntent = assistantOutboxIntentSchema.parse({
      ...dispatchIntent,
      deliveryTransportIdempotent,
    })

    await input.dispatchHooks?.persistDeliveredIntent?.({
      delivery,
      intent: deliveredIntent,
      vault: input.vault,
    })

    const completedAt = delivery.sentAt
    if (delivered.session) {
      try {
        await saveAssistantSession(input.vault, delivered.session)
      } catch (error) {
        warnAssistantBestEffortFailure({
          error,
          operation: 'post-delivery session persistence',
        })
      }
    }
    const sentIntent = await markAssistantOutboxIntentSent({
      delivery,
      intent: deliveredIntent,
      intentPath: dispatchIntentPath,
      vault: input.vault,
    })

    return {
      intent: sentIntent,
      deliveryError: null,
      session: delivered.session ?? null,
    }
  } catch (error) {
    const failedIntent = await updateAssistantOutboxAfterDispatchFailure({
      deliveryMayHaveSucceeded,
      deliveryTransportIdempotent,
      error,
      intentPath: dispatchIntentPath,
      now,
      sending: dispatchIntent,
      vault: input.vault,
    })

    return {
      intent: failedIntent,
      deliveryError: failedIntent.lastError,
      session: null,
    }
  }
}

export async function deliverAssistantOutboxMessage(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  dedupeToken?: string | null
  deliveryIdempotencyKey?: string | null
  dependencies?: AssistantChannelDependencies
  dispatchHooks?: AssistantOutboxDispatchHooks
  dispatchMode?: AssistantOutboxDispatchMode
  explicitTarget?: string | null
  identityId?: string | null
  message: string
  replyToMessageId?: string | null
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
    dedupeToken: input.dedupeToken,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    explicitTarget: input.explicitTarget,
    identityId: input.identityId,
    message: input.message,
    replyToMessageId: input.replyToMessageId,
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
  return drainAssistantOutboxLocal(input)
}

export async function drainAssistantOutboxLocal(input: {
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
    message: redactAssistantStateString(
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error),
    ),
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
  return resolveAssistantOpaqueStateFilePath({
    directory: outboxDirectory,
    extension: '.json',
    kind: 'outbox intent',
    value: intentId,
  })
}

function resolveAssistantOutboxQuarantineDirectory(
  outboxDirectory: string,
): string {
  return path.join(outboxDirectory, '.quarantine')
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

function buildAssistantOutboxRawTargetIdentity(
  input: AssistantOutboxRawTargetIdentityInput,
): AssistantOutboxRawTargetIdentityInput {
  return {
    channel: input.channel,
    identityId: input.identityId,
    actorId: input.actorId,
    threadId: input.threadId,
    replyToMessageId: input.replyToMessageId,
    explicitTarget: input.explicitTarget,
    bindingDelivery: input.bindingDelivery,
  }
}

function buildAssistantOutboxPersistedTarget(
  input: AssistantOutboxPersistedTargetInput,
): AssistantOutboxPersistedTarget {
  return {
    channel: normalizeNullableString(input.channel),
    identityId: normalizeNullableString(input.identityId),
    actorId: normalizeNullableString(input.actorId),
    threadId: normalizeNullableString(input.threadId),
    threadIsDirect:
      typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null,
    replyToMessageId: normalizeNullableString(input.replyToMessageId),
    bindingDelivery: input.bindingDelivery ?? null,
    explicitTarget: normalizeNullableString(input.explicitTarget),
  }
}

function hashAssistantOutboxIdentity(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  dedupeToken?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  message: string
  replyToMessageId?: string | null
  sessionId: string
  threadId?: string | null
  turnId: string
}): string {
  const dedupeToken = normalizeNullableString(input.dedupeToken)
  if (dedupeToken) {
    return createHash('sha1')
      .update(JSON.stringify({ dedupeToken }))
      .digest('hex')
  }

  return createHash('sha1')
    .update(
      JSON.stringify({
        message: input.message,
        sessionId: input.sessionId,
        dedupeToken: null,
        turnId: input.turnId,
        channel: input.channel,
        identityId: input.identityId,
        actorId: input.actorId,
        threadId: input.threadId,
        replyToMessageId: input.replyToMessageId,
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
  replyToMessageId?: string | null
  threadId?: string | null
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        channel: input.channel,
        identityId: input.identityId,
        actorId: input.actorId,
        threadId: input.threadId,
        replyToMessageId: input.replyToMessageId,
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
    return assistantOutboxIntentSchema.parse(parsed)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

async function readAssistantOutboxIntentInventoryEntry(
  vault: string,
  intentPath: string,
): Promise<AssistantOutboxIntent | null> {
  try {
    return await readAssistantOutboxIntentAtPath(intentPath)
  } catch (error) {
    await quarantineAssistantOutboxIntentFile({
      error,
      intentPath,
      vault,
    })
    return null
  }
}

async function quarantineAssistantOutboxIntentFile(input: {
  error: unknown
  intentPath: string
  vault: string
}): Promise<void> {
  const paths = resolveAssistantStatePaths(input.vault)
  const quarantineDirectory = resolveAssistantOutboxQuarantineDirectory(
    paths.outboxDirectory,
  )
  const basename = path.basename(input.intentPath, '.json')
  const quarantinePath = path.join(
    quarantineDirectory,
    `${basename}.${Date.now()}.invalid.json`,
  )

  try {
    await ensureAssistantStateDirectory(quarantineDirectory)
    await rename(input.intentPath, quarantinePath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }
    throw error
  }

  try {
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: 'outbox',
      kind: 'outbox.intent.quarantined',
      level: 'warn',
      message: normalizeAssistantDeliveryError(input.error).message,
    })
  } catch {}
}

async function updateAssistantOutboxAfterDispatchFailure(input: {
  deliveryMayHaveSucceeded: boolean
  deliveryTransportIdempotent: boolean
  error: unknown
  intentPath: string
  now: Date
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
    const updatedAt = new Date().toISOString()
    const nextAttemptAt = retryable
      ? new Date(
          input.now.getTime() + resolveAssistantOutboxRetryDelayMs(attemptCount),
        ).toISOString()
      : null
    const failedIntent = assistantOutboxIntentSchema.parse({
      ...(current ?? input.sending),
      deliveryConfirmationPending: input.deliveryMayHaveSucceeded,
      deliveryTransportIdempotent: input.deliveryMayHaveSucceeded
        ? input.deliveryTransportIdempotent
        : (current?.deliveryTransportIdempotent ?? input.sending.deliveryTransportIdempotent),
      updatedAt,
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
    })
    return failedIntent
  })
}

async function rescheduleAssistantOutboxConfirmationRetry(input: {
  error: AssistantDeliveryError
  intentPath: string
  now: Date
  sending: AssistantOutboxIntent
  vault: string
}): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath)
    const baseIntent = current ?? input.sending
    const updatedAt = new Date().toISOString()
    const retryIntent = assistantOutboxIntentSchema.parse({
      ...baseIntent,
      deliveryConfirmationPending: true,
      updatedAt,
      nextAttemptAt: new Date(
        input.now.getTime() + resolveAssistantOutboxRetryDelayMs(baseIntent.attemptCount),
      ).toISOString(),
      status: 'retryable',
      lastError: input.error,
    })
    await writeJsonFileAtomic(input.intentPath, retryIntent)
    return retryIntent
  })
}

function createAssistantDeliveryConfirmationPendingError(
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

function buildAssistantDeliveryIdempotencyKey(
  intent: Pick<AssistantOutboxIntent, 'intentId'>,
): string {
  return `assistant-outbox:${intent.intentId}`
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
