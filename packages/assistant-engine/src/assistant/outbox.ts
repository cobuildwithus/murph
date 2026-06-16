import { randomUUID } from 'node:crypto'
import {
  type AssistantChannelDelivery,
  assistantChannelDeliverySchema,
  assistantOutboxIntentSchema,
  type AssistantDeliveryError,
  type AssistantDeliverySource,
  type AssistantOutboxIntent,
  type AssistantResponseMedia,
  type AssistantSession,
  type AssistantStatusOutboxSummary,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { mergeAssistantBinding } from './bindings.js'
import {
  getAssistantChannelAdapter,
  normalizeAssistantDeliverySubject,
  type AssistantChannelDependencies,
} from './channel-adapters.js'
import { deliverAssistantMessageOverBinding } from '../outbound-channel.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { ensureAssistantState } from './store/persistence.js'
import { getAssistantSession, resolveAssistantStatePaths, saveAssistantSession } from './store.js'
import { appendAssistantTurnReceiptEvent } from './turns.js'
import {
  buildAssistantOutboxPersistedTarget,
  buildAssistantOutboxRawTargetIdentity,
  hashAssistantOutboxIdentity,
  hashAssistantOutboxTargetFingerprint,
  resolveAssistantOutboxIntentPath,
} from './outbox/intents.js'
import {
  createAssistantDeliveryAmbiguousError,
  createAssistantDeliveryConfirmationPendingError,
  isAssistantOutboxRetryableError,
  normalizeAssistantDeliveryError,
  shouldBeginAssistantOutboxDispatch,
  shouldDispatchAssistantOutboxIntent,
} from './outbox/retry-policy.js'
import { buildAssistantOutboxSummary as buildAssistantOutboxSummaryLocal } from './outbox/summary.js'
import { repairAssistantOutboxReceiptForIntent } from './outbox/receipt-repair.js'
import {
  findAssistantOutboxIntentByDedupeIdentity,
  listAssistantOutboxIntentsLocal as listAssistantOutboxIntentsLocalStore,
  readAssistantOutboxIntent as readAssistantOutboxIntentLocal,
  readAssistantOutboxIntentAtPath,
  saveAssistantOutboxIntent as saveAssistantOutboxIntentLocal,
} from './outbox/store.js'
import {
  buildAssistantOutboxIntentMirrorState,
  buildAssistantDeliveryIdempotencyKey,
  errorImpliesAssistantDeliveryMayHaveSucceeded,
  markAssistantOutboxIntentMirrorRetryable,
  markAssistantOutboxIntentMirrorSending,
  markAssistantOutboxIntentMirrorSendingPrepared,
  markAssistantOutboxIntentMirrorTerminal,
  markAssistantOutboxIntentSent,
  assistantOutboxIntentMatchesDispatchOwner,
  persistAssistantOutboxIntentDeliveryPendingConfirmation,
  resetAssistantOutboxPreparedDispatch,
  rescheduleAssistantOutboxConfirmationRetry,
  sameAssistantChannelDelivery,
  updateAssistantOutboxAfterDispatchFailure,
  type AssistantOutboxPreparedDispatchState,
  type AssistantOutboxPreparedMirrorDispatch,
} from './outbox/dispatch-state.js'
import {
  normalizeNullableString,
  writeJsonFileAtomic,
} from './shared.js'
import { sanitizeAssistantOutboxIntentForPersistence } from './redaction.js'
import {
  normalizeAssistantResponseMediaList,
} from './response-media.js'

const ASSISTANT_OUTBOX_INTENT_SCHEMA = 'murph.assistant-outbox-intent.v1'

export type { AssistantChannelDelivery }
export type {
  AssistantOutboxPreparedDispatchState,
  AssistantOutboxPreparedMirrorDispatch,
}
export {
  createAssistantDeliveryAmbiguousError,
  errorImpliesAssistantDeliveryMayHaveSucceeded,
  isAssistantOutboxRetryableError,
  normalizeAssistantDeliveryError,
  shouldDispatchAssistantOutboxIntent,
}

export interface DispatchAssistantOutboxIntentResult {
  deliveryError: AssistantDeliveryError | null
  intent: AssistantOutboxIntent
  session: AssistantSession | null
}

export interface AssistantOutboxDispatchPayload {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  deliveryIdempotencyKey?: string | null
  deliverySource?: AssistantDeliverySource | null
  dedupeToken?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  media?: readonly AssistantResponseMedia[] | null
  message: string
  subject?: string | null
  replyToMessageId?: string | null
  sessionId: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
}

export type AssistantOutboxDispatchMode = 'immediate' | 'queue-only'

export type {
  AssistantOutboxIntentMirrorState,
} from './outbox/dispatch-state.js'

export interface AssistantOutboxDispatchHooks {
  clearPreparedIntent?: (input: {
    intent: AssistantOutboxIntent
    vault: string
  }) => Promise<void>
  persistDeliveredIntent?: (input: {
    delivery: AssistantChannelDelivery
    intent: AssistantOutboxIntent
    vault: string
  }) => Promise<void>
  prepareDispatchIntent?: (input: {
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
  dedupeToken?: string | null
  deliveryIdempotencyKey?: string | null
  deliverySource?: AssistantDeliverySource | null
  deliveryTransportIdempotent?: boolean
  explicitTarget?: string | null
  identityId?: string | null
  media?: readonly AssistantResponseMedia[] | null
  message: string
  subject?: string | null
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
    const media = normalizeAssistantResponseMediaList(input.media ?? [])
    assertAssistantOutboxResponseMediaSupported({
      channel: input.channel ?? null,
      media,
    })
    const persistedTarget = buildAssistantOutboxPersistedTarget(input)
    const subject = normalizeAssistantDeliverySubject({
      bindingDelivery: persistedTarget.bindingDelivery,
      channel: persistedTarget.channel,
      explicitTarget: persistedTarget.explicitTarget,
      subject: input.subject ?? null,
    })
    const rawTargetIdentity = buildAssistantOutboxRawTargetIdentity(persistedTarget)
    const dedupeKey = hashAssistantOutboxIdentity({
      dedupeToken: input.dedupeToken,
      message,
      media,
      subject,
      sessionId: input.sessionId,
      turnId: input.turnId,
      ...rawTargetIdentity,
    })
    const deliveryIdempotencyKey = normalizeNullableString(input.deliveryIdempotencyKey)
    const deliveryTransportIdempotent =
      resolveAssistantOutboxDeliveryTransportIdempotentForCreation({
        channel: input.channel ?? null,
        deliveryTransportIdempotent: input.deliveryTransportIdempotent,
      })
    const existing = await findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey,
      deliveryIdempotencyKey,
      dedupeToken: input.dedupeToken,
      vault: input.vault,
    })
    if (existing) {
      const upgradedExisting = maybeUpgradeAssistantOutboxIntentDeliveryIdempotency({
        deliveryIdempotencyKey,
        deliveryTransportIdempotent,
        intent: existing,
      })
      if (upgradedExisting !== existing) {
        await writeJsonFileAtomic(
          resolveAssistantOutboxIntentPath(paths.outboxDirectory, upgradedExisting.intentId),
          upgradedExisting,
        )
      }
      await repairAssistantOutboxReceiptForIntent({
        at: upgradedExisting.updatedAt,
        intent: upgradedExisting,
        vault: input.vault,
      })
      return upgradedExisting
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
      media,
      subject,
      dedupeKey,
      targetFingerprint: hashAssistantOutboxTargetFingerprint(rawTargetIdentity),
      ...persistedTarget,
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey,
      deliveryTransportIdempotent,
      lastError: null,
    })
    const persistedIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence(intent),
    )
    await writeJsonFileAtomic(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, intent.intentId),
      persistedIntent,
    )
    await repairAssistantOutboxReceiptForIntent({
      at: createdAt,
      intent: persistedIntent,
      vault: input.vault,
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

    return persistedIntent
  })
}

export async function readAssistantOutboxIntent(
  vault: string,
  intentId: string,
): Promise<AssistantOutboxIntent | null> {
  return readAssistantOutboxIntentLocal(vault, intentId)
}

export async function readAssistantOutboxIntentMirrorState(input: {
  intentId: string
  now?: Date
  sendingGraceMs?: number
  vault: string
}) {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, input.intentId)
  const intent = await readAssistantOutboxIntentAtPath(intentPath, {
    vault: input.vault,
  })
  return buildAssistantOutboxIntentMirrorState({
    intent,
    now: input.now,
    sendingGraceMs: input.sendingGraceMs,
  })
}

export async function saveAssistantOutboxIntent(
  vault: string,
  intent: AssistantOutboxIntent,
): Promise<AssistantOutboxIntent> {
  return saveAssistantOutboxIntentLocal(vault, intent)
}

export async function listAssistantOutboxIntents(
  vault: string,
): Promise<AssistantOutboxIntent[]> {
  return listAssistantOutboxIntentsLocalStore(vault)
}

export async function listAssistantOutboxIntentsLocal(
  vault: string,
): Promise<AssistantOutboxIntent[]> {
  return listAssistantOutboxIntentsLocalStore(vault)
}

export async function dispatchAssistantOutboxIntent(input: {
  allowPreparedSending?: boolean
  dependencies?: AssistantChannelDependencies
  dispatchHooks?: AssistantOutboxDispatchHooks
  force?: boolean
  intentId: string
  now?: Date
  preparedDispatch?: {
    deliveryIdempotencyKey: string | null
    deliveryTransportIdempotent: boolean
    preparedAt: string
    preparedDispatchToken: string
  }
  signal?: AbortSignal
  vault: string
}): Promise<DispatchAssistantOutboxIntentResult> {
  const now = input.now ?? new Date()
  const prepared = await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, input.intentId)
    const intent = await readAssistantOutboxIntentAtPath(intentPath, {
      vault: input.vault,
    })
    if (!intent) {
      throw new Error(`Assistant outbox intent ${input.intentId} was not found.`)
    }

    if (input.allowPreparedSending === true && intent.status === 'sending') {
      if (
        !input.preparedDispatch ||
        !assistantOutboxIntentMatchesPreparedDispatch(intent, input.preparedDispatch)
      ) {
        return {
          action: 'skip' as const,
          intent,
        }
      }
      return {
        action: 'dispatch' as const,
        intent,
        intentPath,
        sending: intent,
      }
    }

    if (!shouldBeginAssistantOutboxDispatch(intent, now, input.force === true)) {
      return {
        action: 'skip' as const,
        intent,
      }
    }

    if (shouldFailClosedAssistantOutboxStaleSendingIntent(intent)) {
      return {
        action: 'recover-stale-non-idempotent' as const,
        intent,
        intentPath,
      }
    }

    if (shouldReconcileAssistantOutboxIntent(intent)) {
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
      preparedDispatchToken: null,
      updatedAt: startedAt,
      lastAttemptAt: startedAt,
      attemptCount: intent.attemptCount + 1,
      status: 'sending',
    })
    const persistedSending = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence(sending),
    )
    await writeJsonFileAtomic(intentPath, persistedSending)
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: persistedSending.turnId,
      kind: 'delivery.attempt.started',
      detail: `attempt ${persistedSending.attemptCount}`,
      metadata: {
        intentId: persistedSending.intentId,
        attempt: String(persistedSending.attemptCount),
      },
      at: startedAt,
    })

    return {
      action: 'dispatch' as const,
      intent,
      intentPath,
      sending: persistedSending,
    }
  })

  if (prepared.action === 'skip') {
    await repairAssistantOutboxReceiptForIntent({
      intent: prepared.intent,
      vault: input.vault,
    })
    return {
      intent: prepared.intent,
      deliveryError: prepared.intent.lastError,
      session: null,
    }
  }

  if (prepared.action === 'recover-stale-non-idempotent') {
    const recoveredDelivery =
      (await input.dispatchHooks?.resolveDeliveredIntent?.({
        intent: prepared.intent,
        vault: input.vault,
      })) ??
      resolvePersistedAssistantOutboxDelivery(prepared.intent)
    if (recoveredDelivery) {
      const sentIntent = await markAssistantOutboxIntentSent({
        delivery: recoveredDelivery,
        intent: prepared.intent,
        intentPath: prepared.intentPath,
        vault: input.vault,
      })

      return {
        intent: sentIntent,
        deliveryError: null,
        session: null,
      }
    }

    const failedIntent = await markAssistantOutboxIntentMirrorTerminal({
      error: createAssistantDeliveryAmbiguousError(
        new Error(
          'Stale non-idempotent outbound delivery had no persisted delivery to reconcile after restart.',
        ),
      ),
      failedAt: now,
      intent: prepared.intent,
      intentPath: prepared.intentPath,
      status: 'failed',
      vault: input.vault,
    })

    return {
      intent: failedIntent,
      deliveryError: failedIntent.lastError,
      session: null,
    }
  }

  const dispatchIntent = prepared.action === 'dispatch' ? prepared.sending : prepared.intent
  const dispatchIntentPath = prepared.intentPath
  let deliveryMayHaveSucceeded = false
  let deliveryTransportIdempotent = inferAssistantOutboxDeliveryTransportIdempotent(dispatchIntent)
  let preparedDispatchReserved = false
  let dispatchFailureOwnerIntent = dispatchIntent

  try {
    const reconciledDelivery =
      (await input.dispatchHooks?.resolveDeliveredIntent?.({
        intent: dispatchIntent,
        vault: input.vault,
      })) ??
      resolvePersistedAssistantOutboxDelivery(dispatchIntent)
    if (reconciledDelivery) {
      const sentIntent = await markAssistantOutboxIntentSent({
        delivery: reconciledDelivery,
        intent: dispatchIntent,
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

    if (shouldReconcileAssistantOutboxIntent(dispatchIntent)) {
      const retryIntent = await rescheduleAssistantOutboxConfirmationRetry({
        error: createAssistantDeliveryConfirmationPendingError(),
        intentPath: dispatchIntentPath,
        scheduledAt: new Date(),
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

    await input.dispatchHooks?.prepareDispatchIntent?.({
      intent: dispatchIntent,
      vault: input.vault,
    })
    preparedDispatchReserved = input.dispatchHooks?.prepareDispatchIntent !== undefined

    const delivered = await sendAssistantOutboxPayload({
      dependencies: withAssistantOutboxSignal(input.dependencies, input.signal),
      payload: dispatchIntent,
      vault: input.vault,
    })
    const delivery = assistantChannelDeliverySchema.parse({
      ...delivered.delivery,
      idempotencyKey:
        delivered.delivery.idempotencyKey ??
        dispatchIntent.deliveryIdempotencyKey,
    })
    deliveryTransportIdempotent =
      dispatchIntent.deliveryTransportIdempotent ||
      delivered.deliveryTransportIdempotent === true
    deliveryMayHaveSucceeded = true
    const deliveredIntent = buildAssistantOutboxDeliveredIntent({
      delivery,
      deliveryTransportIdempotent,
      intent: dispatchIntent,
      session: delivered.session ?? null,
    })
    const deliveredOwnerIntent = assistantOutboxIntentSchema.parse({
      ...deliveredIntent,
      deliveryIdempotencyKey:
        delivery.idempotencyKey ?? deliveredIntent.deliveryIdempotencyKey,
      deliveryTransportIdempotent,
    })
    dispatchFailureOwnerIntent = deliveredOwnerIntent

    const durableDeliveredIntent =
      await persistAssistantOutboxIntentDeliveryPendingConfirmation({
        delivery,
        deliveryTransportIdempotent,
        intent: deliveredIntent,
        intentPath: dispatchIntentPath,
        vault: input.vault,
      })
    if (
      !assistantOutboxIntentMatchesDispatchOwner(
        durableDeliveredIntent,
        deliveredOwnerIntent,
        ['sending'],
        false,
      )
    ) {
      return {
        intent: durableDeliveredIntent,
        deliveryError: durableDeliveredIntent.lastError,
        session: null,
      }
    }

    if (delivered.session) {
      await saveAssistantSession(input.vault, delivered.session)
    }

    await input.dispatchHooks?.persistDeliveredIntent?.({
      delivery,
      intent: durableDeliveredIntent,
      vault: input.vault,
    })
    preparedDispatchReserved = false
    const sentIntent = await markAssistantOutboxIntentSent({
      delivery,
      intent: deliveredOwnerIntent,
      intentPath: dispatchIntentPath,
      vault: input.vault,
    })
    if (!sentIntent.delivery || !sameAssistantChannelDelivery(sentIntent.delivery, delivery)) {
      return {
        intent: sentIntent,
        deliveryError: sentIntent.lastError,
        session: null,
      }
    }

    return {
      intent: sentIntent,
      deliveryError: null,
      session: delivered.session ?? null,
    }
  } catch (error) {
    let failure = error
    let effectiveDeliveryMayHaveSucceeded =
      deliveryMayHaveSucceeded || errorImpliesAssistantDeliveryMayHaveSucceeded(error)

    if (preparedDispatchReserved && !effectiveDeliveryMayHaveSucceeded) {
      if (input.dispatchHooks?.clearPreparedIntent) {
        try {
          await input.dispatchHooks.clearPreparedIntent({
            intent: dispatchIntent,
            vault: input.vault,
          })
          preparedDispatchReserved = false
        } catch (clearError) {
          failure = clearError
          effectiveDeliveryMayHaveSucceeded = true
        }
      } else {
        effectiveDeliveryMayHaveSucceeded = true
      }
    }

    const failedIntent = await updateAssistantOutboxAfterDispatchFailure({
      deliveryMayHaveSucceeded: effectiveDeliveryMayHaveSucceeded,
      deliveryTransportIdempotent,
      error: failure,
      failedAt: new Date(),
      intentPath: dispatchIntentPath,
      sending: dispatchFailureOwnerIntent,
      vault: input.vault,
    })

    return {
      intent: failedIntent,
      deliveryError: failedIntent.lastError,
      session: null,
    }
  }
}

function assistantOutboxIntentMatchesPreparedDispatch(
  intent: AssistantOutboxIntent,
  preparedDispatch: {
    deliveryIdempotencyKey: string | null
    deliveryTransportIdempotent: boolean
    preparedAt: string
    preparedDispatchToken: string
  },
): boolean {
  return intent.lastAttemptAt === preparedDispatch.preparedAt &&
    intent.preparedDispatchToken === preparedDispatch.preparedDispatchToken &&
    intent.deliveryIdempotencyKey === preparedDispatch.deliveryIdempotencyKey &&
    intent.deliveryTransportIdempotent === preparedDispatch.deliveryTransportIdempotent
}

export async function deliverAssistantOutboxMessage(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  dedupeToken?: string | null
  deliveryIdempotencyKey?: string | null
  deliverySource?: AssistantDeliverySource | null
  deliveryTransportIdempotent?: boolean
  dependencies?: AssistantChannelDependencies
  dispatchHooks?: AssistantOutboxDispatchHooks
  dispatchMode?: AssistantOutboxDispatchMode
  explicitTarget?: string | null
  identityId?: string | null
  media?: readonly AssistantResponseMedia[] | null
  message: string
  subject?: string | null
  replyToMessageId?: string | null
  signal?: AbortSignal
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
    deliverySource: input.deliverySource ?? null,
    deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    explicitTarget: input.explicitTarget,
    identityId: input.identityId,
    media: input.media ?? [],
    message: input.message,
    subject: input.subject,
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
    signal: input.signal,
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

export async function sendAssistantOutboxPayload(input: {
  dependencies?: AssistantChannelDependencies
  payload: AssistantOutboxDispatchPayload
  signal?: AbortSignal
  vault: string
}): Promise<Awaited<ReturnType<typeof deliverAssistantMessageOverBinding>>> {
  const subject = normalizeAssistantDeliverySubject({
    bindingDelivery: input.payload.bindingDelivery ?? null,
    channel: input.payload.channel ?? null,
    explicitTarget: input.payload.explicitTarget ?? null,
    subject: input.payload.subject ?? null,
  })

  return materializeAssistantOutboxDeliveredSession({
    delivered: await deliverAssistantMessageOverBinding({
      vault: input.vault,
      sessionId: input.payload.sessionId,
      media: input.payload.media ?? [],
      message: input.payload.message,
      subject,
      channel: input.payload.channel,
      deliverySource: input.payload.deliverySource ?? null,
      idempotencyKey: input.payload.deliveryIdempotencyKey,
      identityId: input.payload.identityId,
      actorId: input.payload.actorId,
      threadId: input.payload.threadId,
      threadIsDirect: input.payload.threadIsDirect,
      replyToMessageId: input.payload.replyToMessageId,
      target: input.payload.explicitTarget ?? null,
      session: {
        binding: {
          conversationKey: null,
          channel: input.payload.channel ?? null,
          identityId: input.payload.identityId ?? null,
          actorId: input.payload.actorId ?? null,
          threadId: input.payload.threadId ?? null,
          threadIsDirect: input.payload.threadIsDirect ?? null,
          delivery: input.payload.bindingDelivery ?? null,
        },
      },
    }, withAssistantOutboxSignal(input.dependencies, input.signal)),
    payload: input.payload,
    vault: input.vault,
  })
}

function withAssistantOutboxSignal(
  dependencies: AssistantChannelDependencies | undefined,
  signal: AbortSignal | undefined,
): AssistantChannelDependencies | undefined {
  const mergedSignal = mergeAssistantOutboxSignals(dependencies?.signal, signal)
  if (!mergedSignal) {
    return dependencies
  }

  return {
    ...dependencies,
    signal: mergedSignal,
  }
}

function mergeAssistantOutboxSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!first) {
    return second
  }
  if (!second || first === second) {
    return first
  }
  return AbortSignal.any([first, second])
}

async function materializeAssistantOutboxDeliveredSession(input: {
  delivered: Awaited<ReturnType<typeof deliverAssistantMessageOverBinding>>
  payload: AssistantOutboxDispatchPayload
  vault: string
}): Promise<Awaited<ReturnType<typeof deliverAssistantMessageOverBinding>>> {
  if (input.delivered.session) {
    return input.delivered
  }

  const delivery = input.delivered.delivery
  if (
    delivery.targetKind !== 'thread' ||
    input.payload.bindingDelivery?.kind !== 'participant' ||
    input.payload.threadId !== null
  ) {
    return input.delivered
  }

  const currentSession = await getAssistantSession(input.vault, input.payload.sessionId)
  const threadIsDirect = currentSession.binding.threadIsDirect ?? input.payload.threadIsDirect ?? true
  const promoteThreadToAssistantIdentity =
    shouldPromoteMaterializedThreadToAssistantIdentity({
      bindingDeliveryTarget: input.payload.bindingDelivery.target,
      currentActorId: currentSession.binding.actorId,
    })
  return {
    ...input.delivered,
    session: {
      ...currentSession,
      binding: mergeAssistantBinding(currentSession.binding, {
        channel: delivery.channel,
        deliveryKind: 'thread',
        deliveryTarget: delivery.target,
        ...(promoteThreadToAssistantIdentity ? { threadId: delivery.target } : {}),
        threadIsDirect,
      }),
      updatedAt: delivery.sentAt,
    },
  }
}

function shouldPromoteMaterializedThreadToAssistantIdentity(input: {
  bindingDeliveryTarget: string | null | undefined
  currentActorId: string | null | undefined
}): boolean {
  const actorId = normalizeNullableString(input.currentActorId)
  const deliveryTarget = normalizeNullableString(input.bindingDeliveryTarget)
  return actorId !== null && actorId === deliveryTarget
}

export async function drainAssistantOutbox(input: {
  dependencies?: AssistantChannelDependencies
  dispatchHooks?: AssistantOutboxDispatchHooks
  limit?: number
  now?: Date
  signal?: AbortSignal
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
  signal?: AbortSignal
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
      signal: input.signal,
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

export async function buildAssistantOutboxSummary(
  vault: string,
): Promise<AssistantStatusOutboxSummary> {
  return buildAssistantOutboxSummaryLocal(vault)
}

export async function beginAssistantOutboxIntentMirrorDispatch(input: {
  deliveryIdempotencyKey?: string | null
  deliveryTransportIdempotent: boolean
  intentId: string
  startedAt?: string
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, input.intentId)
  const intent = await readAssistantOutboxIntentAtPath(intentPath, {
    vault: input.vault,
  })
  if (!intent) {
    return null
  }

  return markAssistantOutboxIntentMirrorSending({
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    intent,
    intentPath,
    startedAt: input.startedAt ?? new Date().toISOString(),
    vault: input.vault,
  })
}

export async function beginAssistantOutboxIntentMirrorPreparedDispatch(input: {
  deliveryIdempotencyKey?: string | null
  deliveryTransportIdempotent: boolean
  intentId: string
  startedAt?: string
  vault: string
}): Promise<AssistantOutboxPreparedMirrorDispatch | null> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, input.intentId)
  const intent = await readAssistantOutboxIntentAtPath(intentPath, {
    vault: input.vault,
  })
  if (!intent) {
    return null
  }

  return markAssistantOutboxIntentMirrorSendingPrepared({
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    intent,
    intentPath,
    preparedDispatchToken: randomUUID(),
    startedAt: input.startedAt ?? new Date().toISOString(),
    vault: input.vault,
  })
}

export async function markAssistantOutboxIntentMirrorRetryableById(input: {
  error: unknown
  failedAt?: Date
  intentId: string
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, input.intentId)
  const intent = await readAssistantOutboxIntentAtPath(intentPath, {
    vault: input.vault,
  })
  if (!intent) {
    return null
  }

  return markAssistantOutboxIntentMirrorRetryable({
    error: input.error,
    failedAt: input.failedAt ?? new Date(),
    intent,
    intentPath,
    vault: input.vault,
  })
}

export async function resetAssistantOutboxPreparedDispatchById(input: {
  deliveryIdempotencyKey?: string | null
  deliveryTransportIdempotent: boolean
  intentId: string
  minimumNextAttemptAt?: Date | null
  preparedAt?: string | null
  preparedDispatchToken?: string | null
  resetAt?: Date
  restoreDispatchState?: AssistantOutboxPreparedDispatchState | null
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, input.intentId)
  const intent = await readAssistantOutboxIntentAtPath(intentPath, {
    vault: input.vault,
  })
  if (!intent) {
    return null
  }

  return resetAssistantOutboxPreparedDispatch({
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    intent,
    intentPath,
    minimumNextAttemptAt: input.minimumNextAttemptAt,
    preparedAt: input.preparedAt,
    preparedDispatchToken: input.preparedDispatchToken,
    resetAt: input.resetAt ?? new Date(),
    restoreDispatchState: input.restoreDispatchState,
    vault: input.vault,
  })
}

export async function markAssistantOutboxIntentMirrorTerminalById(input: {
  error: unknown
  failedAt?: Date
  intentId: string
  status: 'abandoned' | 'failed'
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, input.intentId)
  const intent = await readAssistantOutboxIntentAtPath(intentPath, {
    vault: input.vault,
  })
  if (!intent) {
    return null
  }

  return markAssistantOutboxIntentMirrorTerminal({
    error: input.error,
    failedAt: input.failedAt ?? new Date(),
    intent,
    intentPath,
    status: input.status,
    vault: input.vault,
  })
}

export async function markAssistantOutboxIntentSentById(input: {
  delivery: AssistantChannelDelivery
  intentId: string
  preserveCurrentDispatchMetadata?: boolean
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, input.intentId)
  const intent = await readAssistantOutboxIntentAtPath(intentPath, {
    vault: input.vault,
  })
  if (!intent) {
    return null
  }

  return markAssistantOutboxIntentSent({
    delivery: input.delivery,
    intent,
    intentPath,
    preserveCurrentDispatchMetadata: input.preserveCurrentDispatchMetadata,
    vault: input.vault,
  })
}

function normalizeRequiredMessage(value: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new Error('Assistant outbox messages must be non-empty strings.')
  }

  return normalized
}

function assertAssistantOutboxResponseMediaSupported(input: {
  channel: string | null
  media: readonly AssistantResponseMedia[]
}): void {
  if (input.media.length === 0) {
    return
  }

  const adapter = getAssistantChannelAdapter(input.channel)
  if (adapter?.supportsResponseMedia === true) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_CHANNEL_MEDIA_UNSUPPORTED',
    `Outbound media delivery is not supported for ${input.channel ?? 'unknown channel'}.`,
  )
}

function buildAssistantOutboxDeliveredIntent(input: {
  delivery: AssistantChannelDelivery
  deliveryTransportIdempotent: boolean
  intent: AssistantOutboxIntent
  session: AssistantSession | null
}): AssistantOutboxIntent {
  const sessionBinding = input.session?.binding ?? null

  return assistantOutboxIntentSchema.parse({
    ...input.intent,
    actorId: sessionBinding?.actorId ?? input.intent.actorId,
    bindingDelivery: sessionBinding?.delivery ?? input.intent.bindingDelivery,
    channel: sessionBinding?.channel ?? input.intent.channel,
    deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    identityId: sessionBinding?.identityId ?? input.intent.identityId,
    threadId: sessionBinding?.threadId ?? input.intent.threadId,
    threadIsDirect: sessionBinding?.threadIsDirect ?? input.intent.threadIsDirect,
  })
}

function shouldReconcileAssistantOutboxIntent(
  intent: Pick<
    AssistantOutboxIntent,
    | 'deliveryConfirmationPending'
    | 'deliveryTransportIdempotent'
  >,
): boolean {
  if (intent.deliveryTransportIdempotent) {
    return false
  }

  return intent.deliveryConfirmationPending
}

function resolvePersistedAssistantOutboxDelivery(
  intent: Pick<
    AssistantOutboxIntent,
    | 'delivery'
    | 'deliveryConfirmationPending'
    | 'deliveryTransportIdempotent'
    | 'status'
  >,
): AssistantChannelDelivery | null {
  if (!intent.delivery) {
    return null
  }

  if (
    intent.status === 'sending' &&
    !intent.deliveryTransportIdempotent
  ) {
    return intent.delivery
  }

  if (
    !intent.deliveryConfirmationPending ||
    !intent.deliveryTransportIdempotent
  ) {
    return null
  }

  return intent.delivery
}

function shouldFailClosedAssistantOutboxStaleSendingIntent(
  intent: Pick<
    AssistantOutboxIntent,
    | 'channel'
    | 'deliveryTransportIdempotent'
    | 'status'
  >,
): boolean {
  return (
    intent.status === 'sending' &&
    !inferAssistantOutboxDeliveryTransportIdempotent(intent)
  )
}

function inferAssistantOutboxDeliveryTransportIdempotent(input: Pick<
  AssistantOutboxIntent,
  | 'channel'
  | 'deliveryTransportIdempotent'
> | {
  channel?: string | null
  deliveryTransportIdempotent?: boolean
}): boolean {
  if (input.deliveryTransportIdempotent) {
    return true
  }

  const channel = normalizeNullableString(input.channel ?? null)
  if (!channel) {
    return false
  }

  return getAssistantChannelAdapter(channel)?.supportsIdempotencyKey === true
}

function resolveAssistantOutboxDeliveryTransportIdempotentForCreation(input: {
  channel?: string | null
  deliveryTransportIdempotent?: boolean
}): boolean {
  return input.deliveryTransportIdempotent ??
    inferAssistantOutboxDeliveryTransportIdempotent({
      channel: input.channel ?? null,
      deliveryTransportIdempotent: false,
    })
}

function maybeUpgradeAssistantOutboxIntentDeliveryIdempotency(input: {
  deliveryIdempotencyKey: string | null
  deliveryTransportIdempotent: boolean
  intent: AssistantOutboxIntent
}): AssistantOutboxIntent {
  const deliveryIdempotencyKey =
    input.intent.deliveryIdempotencyKey ?? input.deliveryIdempotencyKey
  const deliveryTransportIdempotent =
    input.intent.deliveryTransportIdempotent || input.deliveryTransportIdempotent

  if (
    deliveryIdempotencyKey === input.intent.deliveryIdempotencyKey &&
    deliveryTransportIdempotent === input.intent.deliveryTransportIdempotent
  ) {
    return input.intent
  }

  return assistantOutboxIntentSchema.parse(
    sanitizeAssistantOutboxIntentForPersistence({
      ...input.intent,
      deliveryIdempotencyKey,
      deliveryTransportIdempotent,
    }),
  )
}
