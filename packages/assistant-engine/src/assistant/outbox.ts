import { randomUUID } from 'node:crypto'
import {
  ASSISTANT_ANSWERED_MAILBOX_ITEM_ID_LIMIT,
  type AssistantChannelDelivery,
  assistantChannelDeliverySchema,
  assistantOutboxIntentSchema,
  type AssistantDeliveryError,
  type AssistantDeliverySource,
  type AssistantMessageReaction,
  type AssistantOutboxOperation,
  type AssistantOutboxIntent,
  type AssistantResponseMedia,
  type AssistantSession,
  type AssistantStatusOutboxSummary,
  type AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantResponseCardSchema,
  renderAssistantResponseCardText,
  type AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import {
  type AutomationQueryRecord,
} from '@murphai/query'
import { parseHostedEmailThreadTarget } from '@murphai/runtime-state'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  looksLikePrivateAssistantRoutePlaceholder,
} from '@murphai/operator-config/assistant/current-delivery-route'
import { mergeAssistantBinding } from './bindings.js'
import {
  getAssistantChannelAdapter,
  normalizeAssistantDeliverySubject,
  selectedAssistantEmailDeliveryIsThreadReply,
  type AssistantChannelDependencies,
} from './channel-adapters.js'
import {
  deliverAssistantMessageOverBinding,
} from '../outbound-channel.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { ensureAssistantState } from './store/persistence.js'
import { getAssistantSession, resolveAssistantStatePaths, saveAssistantSession } from './store.js'
import { appendAssistantTurnReceiptEvent } from './turns.js'
import {
  buildAssistantOutboxPersistedTarget,
  buildAssistantOutboxRawTargetIdentity,
  type AssistantOutboxPersistedTarget,
  type AssistantOutboxRawTargetIdentityInput,
  hashAssistantOutboxIdentity,
  hashAssistantOutboxTargetFingerprint,
  resolveAssistantOutboxIntentPath,
} from './outbox/intents.js'
import {
  assistantDeliveryErrorPreventsFreshIntentRetry,
  createAssistantDeliveryAmbiguousError,
  createAssistantDeliveryConfirmationPendingError,
  createAssistantDeliveryRetryExhaustedError,
  isAssistantOutboxRetryBudgetExhausted,
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
  type AssistantOutboxInventoryScanMetrics,
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
  persistAssistantOutboxIntentLinqAppCardTextFallback,
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
import { writeAssistantAutoReplyIntentProvenance } from './automation/intent-provenance.js'
import {
  assistantDeviceActivityAuthorityKeyMatches,
  readAssistantDeviceActivityDeliveryIdempotencyMetadata,
} from './device-activity-cron-tags.js'
import { readAssistantDeviceActivityParentAutomation } from './device-activity-parent-automation.js'
import {
  resolveAssistantOutboxAutomationAuthorityError,
} from './outbox/automation-authority.js'

const ASSISTANT_OUTBOX_INTENT_SCHEMA = 'murph.assistant-outbox-intent.v1'
const ASSISTANT_OUTBOX_ANSWERED_ITEMS_UNCOVERED_CODE =
  'ASSISTANT_OUTBOX_ANSWERED_ITEMS_UNCOVERED'

export type { AssistantChannelDelivery }
export type {
  AssistantOutboxPreparedDispatchState,
  AssistantOutboxPreparedMirrorDispatch,
}
export type { AssistantOutboxInventoryScanMetrics } from './outbox/store.js'
export {
  compareAssistantOutboxDeliverySequenceOrder,
  isAssistantOutboxReplyBubbleSuccessor,
} from './outbox/ordering.js'
export {
  assistantDeliveryErrorPreventsFreshIntentRetry,
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

export interface AssistantOutboxDispatchMessage {
  actorId?: string | null
  answeredMailboxItemIds?: readonly string[] | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  card?: AssistantResponseCard | null
  channel?: string | null
  deliveryIdempotencyKey?: string | null
  deliverySource?: AssistantDeliverySource | null
  dedupeToken?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  media?: readonly AssistantResponseMedia[] | null
  message: string
  nativeReplyRequested?: AssistantOutboxIntent['nativeReplyRequested']
  replyToMessageId?: string | null
  sessionId: string
  subject?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
  turnTrigger?: AssistantTurnTrigger | null
}

export interface AssistantOutboxDispatchReaction {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  deliveryIdempotencyKey?: string | null
  deliverySource?: AssistantDeliverySource | null
  dedupeToken?: string | null
  explicitTarget?: string | null
  identityId?: string | null
  reaction: AssistantMessageReaction
  sessionId: string
  targetMessageId: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
  turnTrigger?: AssistantTurnTrigger | null
}

export type AssistantOutboxDispatchMode = 'immediate' | 'queue-only'

export type {
  AssistantOutboxIntentMirrorState,
} from './outbox/dispatch-state.js'

export type AssistantOutboxDispatchPreflightResult =
  | { action: 'continue' }
  | { action: 'defer'; intent: AssistantOutboxIntent }
  | { action: 'stop'; intent: AssistantOutboxIntent }

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
  /**
   * Runs before an outbox intent is claimed as `sending`. Preflight owns
   * local/security/control-plane prerequisites that must not increment
   * delivery attempt counters or enter timed provider retry.
   */
  preflightDispatchIntent?: (input: {
    intent: AssistantOutboxIntent
    now: Date
    vault: string
  }) => Promise<AssistantOutboxDispatchPreflightResult | void>
  prepareDispatchIntent?: (input: {
    intent: AssistantOutboxIntent
    vault: string
  }) => Promise<void>
  resolveDeliveredIntent?: (input: {
    intent: AssistantOutboxIntent
    vault: string
  }) => Promise<AssistantChannelDelivery | null>
  shouldRethrowDispatchError?: (input: {
    error: unknown
    intent: AssistantOutboxIntent
    vault: string
  }) => boolean
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

export type AssistantOutboxCreateIntentInput = {
  actorId?: string | null
  answeredMailboxItemIds?: readonly string[] | null
  reviewedAssistantAskCompletionExpiresAt?: string | null
  automationAuthority?: AssistantOutboxIntent['automationAuthority']
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  createdAt?: string
  dedupeToken?: string | null
  deliveryIdempotencyKey?: string | null
  deliverySource?: AssistantDeliverySource | null
  deliveryTransportIdempotent?: boolean
  emailHtml?: string | null
  externalThreadRouteAuthority?: AssistantOutboxIntent['externalThreadRouteAuthority']
  explicitTarget?: string | null
  identityId?: string | null
  initialState?:
    | { status: 'pending' }
    | { nextAttemptAt: string; status: 'awaiting_approval' }
  card?: AssistantResponseCard | null
  media?: readonly AssistantResponseMedia[] | null
  message: string
  nativeReplyRequested?: AssistantOutboxIntent['nativeReplyRequested']
  newsletterAuthorizationProof?: string | null
  operation?: AssistantOutboxOperation | null
  replyToMessageId?: string | null
  sessionId: string
  subject?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
  turnTrigger?: AssistantTurnTrigger | null
  vault: string
}

export async function createAssistantOutboxIntent(
  input: AssistantOutboxCreateIntentInput,
): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const createdAt = input.createdAt ?? new Date().toISOString()
    const initialState = input.initialState ?? { status: 'pending' as const }
    const media = normalizeAssistantResponseMediaList(input.media ?? [])
    const card = input.card == null
      ? null
      : assistantResponseCardSchema.parse(input.card)
    const operation = normalizeAssistantOutboxReactionOperation(
      input.operation ?? null,
    )
    assertAssistantOutboxCardCompatible({ card, media, operation })
    const message = operation
      ? ''
      : card
        ? renderAssistantResponseCardText(card)
        : normalizeOutboxMessage({
            media,
            message: input.message,
          })
    assertAssistantOutboxResponseMediaSupported({
      channel: input.channel ?? null,
      media,
    })
    const replyToMessageId = operation
      ? normalizeRequiredReactionTargetMessageId(input.replyToMessageId)
      : normalizeNullableString(input.replyToMessageId)
    const persistedTarget = buildAssistantOutboxPersistedTarget({
      ...input,
      replyToMessageId,
    })
    if (card !== null && persistedTarget.threadIsDirect !== true) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_DIRECT_AUDIENCE_REQUIRED',
        'A response card requires a private direct conversation.',
      )
    }
    assertAssistantOutboxNativeReplyTarget({
      channel: persistedTarget.channel,
      nativeReplyRequested: persistedTarget.nativeReplyRequested,
      operation,
      replyToMessageId: persistedTarget.replyToMessageId,
    })
    const subject = operation
      ? null
      : normalizeAssistantDeliverySubject({
          bindingDelivery: persistedTarget.bindingDelivery,
          channel: persistedTarget.channel,
          explicitTarget: persistedTarget.explicitTarget,
          subject: input.subject ?? null,
        })
    const rawTargetIdentity = buildAssistantOutboxRawTargetIdentity(persistedTarget)
    const dedupeKey = hashAssistantOutboxIdentity({
      dedupeToken: input.dedupeToken,
      card,
      media,
      message,
      operation,
      subject,
      sessionId: input.sessionId,
      turnId: input.turnId,
      ...rawTargetIdentity,
    })
    const deliveryIdempotencyKey = normalizeNullableString(input.deliveryIdempotencyKey)
    const answeredMailboxItemIds = normalizeAssistantOutboxAnsweredMailboxItemIds(
      input.answeredMailboxItemIds ?? [],
    )
    const deliveryTransportIdempotent =
      operation
        ? resolveAssistantOutboxReactionTransportIdempotent({
            channel: input.channel ?? null,
            deliveryTransportIdempotent: input.deliveryTransportIdempotent,
          })
        : isReplaySafeHostedEmailGroupFanoutPlanner(persistedTarget)
          ? true
          : resolveAssistantOutboxDeliveryTransportIdempotentForCreation({
              channel: input.channel ?? null,
              deliveryTransportIdempotent: input.deliveryTransportIdempotent,
              media,
              message,
            })
    const existing = await findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey,
      deliveryIdempotencyKey,
      dedupeToken: input.dedupeToken,
      vault: input.vault,
    })
    const isAutoReplyIntent = input.turnTrigger === 'automation-auto-reply'
    if (existing) {
      assertAssistantOutboxDedupeEffectMatches({
        intent: existing,
        operation,
        persistedTarget,
      })
      const idempotencyUpgradedExisting = maybeUpgradeAssistantOutboxIntentDeliveryIdempotency({
        deliveryIdempotencyKey,
        deliveryTransportIdempotent,
        intent: existing,
      })
      const authorityUpgradedExisting =
        maybeUpgradeAssistantOutboxIntentExternalThreadRouteAuthority({
          externalThreadRouteAuthority: input.externalThreadRouteAuthority ?? null,
          intent: idempotencyUpgradedExisting,
        })
      const answeredItemsUpgradedExisting = maybeUpgradeAssistantOutboxIntentAnsweredMailboxItemIds({
        answeredMailboxItemIds,
        intent: authorityUpgradedExisting,
      })
      const upgradedExisting = operation
        ? maybeUpgradeAssistantOutboxIntentReactionOperation({
            deliveryTransportIdempotent,
            intent: answeredItemsUpgradedExisting,
            operation,
            persistedTarget,
            rawTargetIdentity,
            updatedAt: createdAt,
          })
        : maybeUpgradeAssistantOutboxIntentPreDispatchTarget({
            intent: answeredItemsUpgradedExisting,
            persistedTarget,
            rawTargetIdentity,
            updatedAt: createdAt,
          })
      if (isAutoReplyIntent) {
        await writeAssistantAutoReplyIntentProvenance({
          intentId: upgradedExisting.intentId,
          recordedAt: upgradedExisting.updatedAt,
          turnId: upgradedExisting.turnId,
          vault: input.vault,
        })
      }
      if (upgradedExisting !== existing) {
        const persistedUpgradedExisting =
          sanitizeAssistantOutboxIntentForPersistence(upgradedExisting)
        await writeJsonFileAtomic(
          resolveAssistantOutboxIntentPath(paths.outboxDirectory, upgradedExisting.intentId),
          persistedUpgradedExisting,
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
      nextAttemptAt:
        initialState.status === 'awaiting_approval'
          ? initialState.nextAttemptAt
          : createdAt,
      sentAt: null,
      attemptCount: 0,
      status: initialState.status,
      message,
      emailHtml: input.emailHtml ?? null,
      media,
      card,
      subject,
      operation,
      dedupeKey,
      targetFingerprint: hashAssistantOutboxTargetFingerprint(rawTargetIdentity),
      ...persistedTarget,
      automationAuthority: input.automationAuthority ?? null,
      externalThreadRouteAuthority: input.externalThreadRouteAuthority ?? null,
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey,
      deliveryTransportIdempotent,
      newsletterAuthorizationProof: input.newsletterAuthorizationProof ?? null,
      answeredMailboxItemIds,
      reviewedAssistantAskCompletionExpiresAt:
        input.reviewedAssistantAskCompletionExpiresAt ?? undefined,
      lastError: null,
    })
    const persistedIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence(intent),
    )
    const persistedIntentValue =
      sanitizeAssistantOutboxIntentForPersistence(persistedIntent)
    if (isAutoReplyIntent) {
      await writeAssistantAutoReplyIntentProvenance({
        intentId: intent.intentId,
        recordedAt: createdAt,
        turnId: intent.turnId,
        vault: input.vault,
      })
    }
    await writeJsonFileAtomic(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, intent.intentId),
      persistedIntentValue,
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

/**
 * Compare-and-set persistence for outbox-owner state transitions. The explicit
 * outcome lets callers distinguish their own write from a concurrent owner;
 * action identity reuse still fails closed.
 */
export async function saveAssistantOutboxIntentIfUnchanged(input: {
  expectedDedupeKey: string
  expectedStatus: AssistantOutboxIntent['status']
  expectedUpdatedAt: string
  intent: AssistantOutboxIntent
  vault: string
}): Promise<{
  applied: boolean
  intent: AssistantOutboxIntent
}> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const intentPath = resolveAssistantOutboxIntentPath(
      paths.outboxDirectory,
      input.intent.intentId,
    )
    const current = await readAssistantOutboxIntentAtPath(intentPath, {
      vault: input.vault,
    })
    if (!current) {
      throw new VaultCliError(
        'ASSISTANT_OUTBOX_INTENT_NOT_FOUND',
        `Assistant outbox intent ${input.intent.intentId} was not found.`,
      )
    }
    if (
      current.dedupeKey !== input.expectedDedupeKey
      || input.intent.dedupeKey !== input.expectedDedupeKey
    ) {
      throw new VaultCliError(
        'ASSISTANT_OUTBOX_IDENTITY_CONFLICT',
        'Assistant outbox action identity changed during approval reconciliation.',
      )
    }
    if (
      current.status !== input.expectedStatus
      || current.updatedAt !== input.expectedUpdatedAt
    ) {
      return {
        applied: false,
        intent: current,
      }
    }

    const parsed = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence(input.intent),
    )
    if (parsed.intentId !== current.intentId) {
      throw new VaultCliError(
        'ASSISTANT_OUTBOX_IDENTITY_CONFLICT',
        'Assistant outbox intent id changed during approval reconciliation.',
      )
    }
    const persisted = sanitizeAssistantOutboxIntentForPersistence(parsed)
    await writeJsonFileAtomic(intentPath, persisted)
    await repairAssistantOutboxReceiptForIntent({
      at: parsed.updatedAt,
      intent: parsed,
      vault: input.vault,
    })
    return {
      applied: true,
      intent: parsed,
    }
  })
}

export async function listAssistantOutboxIntents(
  vault: string,
  onScan?: (metrics: AssistantOutboxInventoryScanMetrics) => void,
): Promise<AssistantOutboxIntent[]> {
  return listAssistantOutboxIntentsLocalStore(vault, onScan)
}

export async function listAssistantOutboxIntentsLocal(
  vault: string,
  onScan?: (metrics: AssistantOutboxInventoryScanMetrics) => void,
): Promise<AssistantOutboxIntent[]> {
  return listAssistantOutboxIntentsLocalStore(vault, onScan)
}

export interface DispatchAssistantOutboxIntentInput {
  allowPreparedSending?: boolean
  dependencies?: AssistantChannelDependencies
  dispatchHooks?: AssistantOutboxDispatchHooks
  force?: boolean
  intentId: string
  now?: Date
  preparedDispatch?: {
    deliveryIdempotencyKey: string | null
    deliveryTransportIdempotent: boolean
    preparedDispatchToken: string
  }
  signal?: AbortSignal
  vault: string
}

export async function dispatchAssistantOutboxIntent(
  input: DispatchAssistantOutboxIntentInput,
): Promise<DispatchAssistantOutboxIntentResult> {
  return dispatchAssistantOutboxIntentInternal({
    ...input,
    preflightCompleted: false,
  })
}

async function dispatchAssistantOutboxIntentInternal(input: DispatchAssistantOutboxIntentInput & {
  preflightCompleted: boolean
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

    if (
      (
        intent.status === 'retryable' ||
        (
          intent.status === 'sending' &&
          inferAssistantOutboxDeliveryTransportIdempotent(intent)
        )
      ) &&
      !intent.delivery &&
      (
        !intent.deliveryConfirmationPending ||
        inferAssistantOutboxDeliveryTransportIdempotent(intent)
      ) &&
      isAssistantOutboxRetryBudgetExhausted(intent)
    ) {
      return {
        action: 'retry-exhausted' as const,
        intent,
        intentPath,
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

    if (!input.preflightCompleted && input.dispatchHooks?.preflightDispatchIntent) {
      return {
        action: 'preflight' as const,
        intent,
        intentPath,
      }
    }

    const startedAt = now.toISOString()
    const sending = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...intent,
        deliveryIdempotencyKey:
          intent.deliveryIdempotencyKey ?? buildAssistantDeliveryIdempotencyKey(intent),
        preparedDispatchToken: null,
        updatedAt: startedAt,
        lastAttemptAt: startedAt,
        attemptCount: intent.attemptCount + 1,
        status: 'sending',
      }),
    )
    const persistedSending = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence(sending),
    )
    const persistedSendingValue =
      sanitizeAssistantOutboxIntentForPersistence(persistedSending)
    await writeJsonFileAtomic(intentPath, persistedSendingValue)
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

  if (prepared.action === 'retry-exhausted') {
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
      error: createAssistantDeliveryRetryExhaustedError(prepared.intent.lastError),
      failedAt: now,
      intent: prepared.intent,
      intentPath: prepared.intentPath,
      onlyCurrentStatuses: ['retryable', 'sending'],
      status: 'failed',
      vault: input.vault,
    })
    return {
      intent: failedIntent,
      deliveryError: failedIntent.lastError,
      session: null,
    }
  }

  if (prepared.action === 'preflight') {
    const preflight = await input.dispatchHooks?.preflightDispatchIntent?.({
      intent: prepared.intent,
      now,
      vault: input.vault,
    })
    if (preflight?.action === 'defer' || preflight?.action === 'stop') {
      await repairAssistantOutboxReceiptForIntent({
        intent: preflight.intent,
        vault: input.vault,
      })
      return {
        intent: preflight.intent,
        deliveryError: preflight.intent.lastError,
        session: null,
      }
    }

    return dispatchAssistantOutboxIntentInternal({
      ...input,
      preflightCompleted: true,
    })
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
  let effectiveDispatchIntent = dispatchIntent

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

    const deviceActivityAuthorityError =
      await resolveDeviceActivityOutboxAuthorityError({
        intent: dispatchIntent,
        vault: input.vault,
      })
    const authorityError =
      deviceActivityAuthorityError ??
      (await resolveAssistantOutboxAutomationAuthorityError({
        intent: dispatchIntent,
        vault: input.vault,
      }))
    if (authorityError) {
      const failedIntent = await markAssistantOutboxIntentMirrorTerminal({
        error: authorityError,
        // `now` may be the earlier drain-selection timestamp. Authority is
        // evaluated at provider entry, so persist that wall-clock failure time.
        failedAt: new Date(),
        intent: dispatchIntent,
        intentPath: dispatchIntentPath,
        status: 'failed',
        vault: input.vault,
      })
      return {
        intent: failedIntent,
        deliveryError: failedIntent.lastError,
        session: null,
      }
    }

    await input.dispatchHooks?.prepareDispatchIntent?.({
      intent: dispatchIntent,
      vault: input.vault,
    })
    preparedDispatchReserved = input.dispatchHooks?.prepareDispatchIntent !== undefined

    const dispatchDependencies = withAssistantOutboxSignal(
      input.dependencies,
      input.signal,
    )
    const delivered = await sendAssistantOutboxDispatchIntent({
      dependencies: dispatchIntent.card === null
        ? dispatchDependencies
        : {
            ...(dispatchDependencies ?? {}),
            persistLinqAppCardTextFallback: async ({ idempotencyKey }) => {
              const persisted =
                await persistAssistantOutboxIntentLinqAppCardTextFallback({
                  idempotencyKey,
                  intentPath: dispatchIntentPath,
                  persistedAt: new Date(),
                  sending: dispatchIntent,
                  vault: input.vault,
                })
              effectiveDispatchIntent = persisted
              dispatchFailureOwnerIntent = persisted
            },
          },
      ...dispatchIntent,
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
      intent: effectiveDispatchIntent,
      session: delivered.session ?? null,
    })
    const deliveredOwnerIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...deliveredIntent,
        deliveryIdempotencyKey:
          delivery.idempotencyKey ?? deliveredIntent.deliveryIdempotencyKey,
        deliveryTransportIdempotent,
      }),
    )
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
    if (input.dispatchHooks?.shouldRethrowDispatchError?.({
      error,
      intent: dispatchIntent,
      vault: input.vault,
    }) === true) {
      throw error
    }

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
    preparedDispatchToken: string
  },
): boolean {
  return intent.preparedDispatchToken === preparedDispatch.preparedDispatchToken &&
    intent.deliveryIdempotencyKey === preparedDispatch.deliveryIdempotencyKey &&
    intent.deliveryTransportIdempotent === preparedDispatch.deliveryTransportIdempotent
}

async function resolveDeviceActivityOutboxAuthorityError(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<Error | null> {
  const metadata = readAssistantDeviceActivityDeliveryIdempotencyMetadata(
    input.intent.deliveryIdempotencyKey,
  )
  if (!metadata) {
    return null
  }

  const parentAutomation = await readAssistantDeviceActivityParentAutomation({
    metadata,
    vault: input.vault,
  })
  if (
    !parentAutomation ||
    parentAutomation.status !== 'active' ||
    parentAutomation.schedule.kind !== 'deviceActivity' ||
    !assistantDeviceActivityAuthorityKeyMatches({
      authorityKey: metadata.authorityKey,
      automation: {
        ...parentAutomation,
        schedule: {
          activityKind: parentAutomation.schedule.activityKind,
          source: parentAutomation.schedule.source,
        },
      },
    })
  ) {
    return new VaultCliError(
      'ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE',
      'Device activity automation authority changed before outbound delivery.',
    )
  }

  return null
}

export async function deliverAssistantOutboxMessage(input: {
  actorId?: string | null
  answeredMailboxItemIds?: readonly string[] | null
  reviewedAssistantAskCompletionExpiresAt?: string | null
  automationAuthority?: AssistantOutboxIntent['automationAuthority']
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  card?: AssistantResponseCard | null
  channel?: string | null
  dedupeToken?: string | null
  deliveryIdempotencyKey?: string | null
  deliverySource?: AssistantDeliverySource | null
  deliveryTransportIdempotent?: boolean
  dependencies?: AssistantChannelDependencies
  dispatchHooks?: AssistantOutboxDispatchHooks
  dispatchMode?: AssistantOutboxDispatchMode
  externalThreadRouteAuthority?: AssistantOutboxIntent['externalThreadRouteAuthority']
  explicitTarget?: string | null
  identityId?: string | null
  media?: readonly AssistantResponseMedia[] | null
  message: string
  nativeReplyRequested?: AssistantOutboxIntent['nativeReplyRequested']
  subject?: string | null
  replyToMessageId?: string | null
  signal?: AbortSignal
  sessionId: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
  turnTrigger?: AssistantTurnTrigger | null
  vault: string
}): Promise<DeliverAssistantOutboxMessageResult> {
  throwIfAssistantOutboxSignalAborted(input.signal)
  const requestedAnsweredMailboxItemIds =
    normalizeAssistantOutboxAnsweredMailboxItemIds(
      input.answeredMailboxItemIds ?? [],
    )
  const intent = await createAssistantOutboxIntent({
    actorId: input.actorId,
    answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
    reviewedAssistantAskCompletionExpiresAt:
      input.reviewedAssistantAskCompletionExpiresAt ?? null,
    automationAuthority: input.automationAuthority ?? null,
    bindingDelivery: input.bindingDelivery,
    channel: input.channel,
    card: input.card ?? null,
    dedupeToken: input.dedupeToken,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    deliverySource: input.deliverySource ?? null,
    deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    externalThreadRouteAuthority: input.externalThreadRouteAuthority ?? null,
    explicitTarget: input.explicitTarget,
    identityId: input.identityId,
    media: input.media,
    message: input.message,
    ...(input.nativeReplyRequested === undefined
      ? {}
      : { nativeReplyRequested: input.nativeReplyRequested }),
    replyToMessageId: input.replyToMessageId ?? null,
    subject: input.subject ?? null,
    sessionId: input.sessionId,
    threadId: input.threadId,
    threadIsDirect: input.threadIsDirect,
    turnId: input.turnId,
    turnTrigger: input.turnTrigger ?? null,
    vault: input.vault,
  })

  const coveredAnsweredMailboxItemIds = new Set(
    intent.answeredMailboxItemIds,
  )
  if (
    requestedAnsweredMailboxItemIds.some(
      (mailboxItemId) => !coveredAnsweredMailboxItemIds.has(mailboxItemId),
    )
  ) {
    const error = Object.assign(
      new Error(
        'The existing outbound delivery does not cover every requested input; retry after the current dispatch settles.',
      ),
      {
        code: ASSISTANT_OUTBOX_ANSWERED_ITEMS_UNCOVERED_CODE,
        retryable: true,
      },
    )
    return {
      kind: 'failed',
      intent,
      delivery: null,
      deliveryError: normalizeAssistantDeliveryError(error),
      session: null,
    }
  }

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
    dispatched.intent.status === 'awaiting_approval' ||
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

function throwIfAssistantOutboxSignalAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }

  const reason: unknown = signal.reason
  if (reason instanceof Error) {
    throw reason
  }

  throw new VaultCliError(
    'ASSISTANT_OUTBOX_ABORTED',
    'Assistant outbound delivery was aborted before dispatch.',
  )
}

export async function deliverAssistantOutboxReaction(input: {
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
  reaction: AssistantMessageReaction
  sessionId: string
  signal?: AbortSignal
  targetMessageId: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
  turnTrigger?: AssistantTurnTrigger | null
  vault: string
}): Promise<DeliverAssistantOutboxMessageResult> {
  const operation: AssistantOutboxOperation = {
    kind: 'message-reaction',
    reaction: input.reaction,
  }
  const targetMessageId =
    normalizeRequiredReactionTargetMessageId(input.targetMessageId)
  const intent = await createAssistantOutboxIntent({
    actorId: input.actorId,
    bindingDelivery: input.bindingDelivery,
    channel: input.channel,
    dedupeToken: input.dedupeToken,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    deliverySource: input.deliverySource ?? null,
    deliveryTransportIdempotent:
      input.deliveryTransportIdempotent ??
      isAssistantOutboxReactionTransportIdempotent(input.channel),
    explicitTarget: input.explicitTarget,
    identityId: input.identityId,
    media: [],
    message: '',
    operation,
    replyToMessageId: targetMessageId,
    subject: null,
    sessionId: input.sessionId,
    threadId: input.threadId,
    threadIsDirect: input.threadIsDirect,
    turnId: input.turnId,
    turnTrigger: input.turnTrigger ?? null,
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
    dispatched.intent.status === 'awaiting_approval' ||
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
      normalizeAssistantDeliveryError(new Error('Assistant outbound reaction delivery failed.')),
    session: dispatched.session ?? null,
  }
}

async function sendAssistantOutboxDispatchIntent(input: AssistantOutboxDispatchMessage & {
  dependencies?: AssistantChannelDependencies
  operation?: AssistantOutboxIntent['operation']
  signal?: AbortSignal
  vault: string
}): Promise<Awaited<ReturnType<typeof deliverAssistantMessageOverBinding>>> {
  const operation = resolveAssistantOutboxOperation(input)
  if (operation?.kind === 'message-reaction') {
    return sendAssistantOutboxDispatchReaction({
      actorId: input.actorId,
      bindingDelivery: input.bindingDelivery,
      channel: input.channel,
      deliveryIdempotencyKey: input.deliveryIdempotencyKey,
      deliverySource: input.deliverySource,
      dependencies: input.dependencies,
      explicitTarget: input.explicitTarget,
      identityId: input.identityId,
      reaction: operation.reaction,
      sessionId: input.sessionId,
      targetMessageId: normalizeRequiredReactionTargetMessageId(
        input.replyToMessageId,
      ),
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect,
      turnId: input.turnId,
      vault: input.vault,
    })
  }

  return sendAssistantOutboxDispatchMessage(input)
}

export async function sendAssistantOutboxDispatchMessage(input: AssistantOutboxDispatchMessage & {
  dependencies?: AssistantChannelDependencies
  signal?: AbortSignal
  vault: string
}): Promise<Awaited<ReturnType<typeof deliverAssistantMessageOverBinding>>> {
  const subject = normalizeAssistantOutboxDispatchSubject(input)

  return materializeAssistantOutboxDeliveredSession({
    delivered: await deliverAssistantMessageOverBinding({
      vault: input.vault,
      sessionId: input.sessionId,
      card: input.card ?? null,
      media: input.media ?? [],
      message: input.message,
      ...(input.nativeReplyRequested === undefined
        ? {}
        : { nativeReplyRequested: input.nativeReplyRequested }),
      answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
      subject,
      channel: input.channel,
      deliverySource: input.deliverySource ?? null,
      idempotencyKey: input.deliveryIdempotencyKey,
      identityId: input.identityId,
      actorId: input.actorId,
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect,
      replyToMessageId: input.replyToMessageId ?? null,
      target: input.explicitTarget ?? null,
      session: {
        binding: {
          conversationKey: null,
          channel: input.channel ?? null,
          identityId: input.identityId ?? null,
          actorId: input.actorId ?? null,
          threadId: input.threadId ?? null,
          threadIsDirect: input.threadIsDirect ?? null,
          delivery: input.bindingDelivery ?? null,
        },
      },
    }, withAssistantOutboxSignal(input.dependencies, input.signal)),
    dispatch: input,
    vault: input.vault,
  })
}

function normalizeAssistantOutboxDispatchSubject(
  input: Pick<
    AssistantOutboxDispatchMessage,
    'bindingDelivery' | 'channel' | 'explicitTarget' | 'subject'
  >,
): string | null {
  if (
    normalizeNullableString(input.channel) === 'email' &&
    selectedAssistantEmailDeliveryIsThreadReply({
      bindingDelivery: input.bindingDelivery ?? null,
      explicitTarget: input.explicitTarget ?? null,
    })
  ) {
    return null
  }

  return normalizeAssistantDeliverySubject({
    bindingDelivery: input.bindingDelivery ?? null,
    channel: input.channel ?? null,
    explicitTarget: input.explicitTarget ?? null,
    subject: input.subject ?? null,
  })
}

async function sendAssistantOutboxDispatchReaction(input: AssistantOutboxDispatchReaction & {
  dependencies?: AssistantChannelDependencies
  vault: string
}): Promise<Awaited<ReturnType<typeof deliverAssistantMessageOverBinding>>> {
  const channel = normalizeNullableString(input.channel)
  const adapter = getAssistantChannelAdapter(channel)
  if (!adapter?.setMessageReaction) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_REACTION_UNSUPPORTED',
      `Outbound reactions are not supported for ${channel ?? 'unknown channel'}.`,
    )
  }

  const delivery = await adapter.setMessageReaction(
    {
      bindingDelivery: input.bindingDelivery ?? null,
      explicitTarget: input.explicitTarget ?? null,
      idempotencyKey: input.deliveryIdempotencyKey ?? null,
      reaction: input.reaction,
      targetMessageId: input.targetMessageId,
    },
    input.dependencies ?? {},
  )

  return {
    delivery,
    deliveryDeduplicated: false,
    deliveryTransportIdempotent:
      isAssistantOutboxReactionTransportIdempotent(input.channel),
    outboxIntentId: null,
    session: undefined,
  }
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
  dispatch: AssistantOutboxDispatchMessage
  vault: string
}): Promise<Awaited<ReturnType<typeof deliverAssistantMessageOverBinding>>> {
  if (input.delivered.session) {
    return input.delivered
  }

  const delivery = input.delivered.delivery
  if (
    delivery.targetKind !== 'thread' ||
    input.dispatch.bindingDelivery?.kind !== 'participant' ||
    input.dispatch.threadId !== null
  ) {
    return input.delivered
  }

  const currentSession = await getAssistantSession(input.vault, input.dispatch.sessionId)
  const threadIsDirect = currentSession.binding.threadIsDirect ?? input.dispatch.threadIsDirect ?? true
  const promoteThreadToAssistantIdentity =
    shouldPromoteMaterializedThreadToAssistantIdentity({
      bindingDeliveryTarget: input.dispatch.bindingDelivery.target,
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
  externalThreadRouteAuthority?: AssistantOutboxIntent['externalThreadRouteAuthority']
  externalThreadService?: AssistantOutboxIntent['externalThreadService']
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
    ...(input.externalThreadRouteAuthority === undefined
      ? {}
      : { externalThreadRouteAuthority: input.externalThreadRouteAuthority }),
    ...(input.externalThreadService === undefined
      ? {}
      : { externalThreadService: input.externalThreadService }),
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
  deliveryTransportIdempotent: boolean
  intentId: string
  minimumNextAttemptAt?: Date | null
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
    deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    intent,
    intentPath,
    minimumNextAttemptAt: input.minimumNextAttemptAt,
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
  onlyCurrentStatuses?: readonly AssistantOutboxIntent['status'][]
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
    ...(input.onlyCurrentStatuses
      ? { onlyCurrentStatuses: input.onlyCurrentStatuses }
      : {}),
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

function assertAssistantOutboxNativeReplyTarget(input: {
  channel: string | null
  nativeReplyRequested?: unknown
  operation: AssistantOutboxOperation | null
  replyToMessageId: string | null
}): void {
  if (input.nativeReplyRequested === undefined) {
    return
  }
  if (input.nativeReplyRequested !== true) {
    throw new VaultCliError(
      'ASSISTANT_NATIVE_REPLY_INVALID',
      'Assistant native reply requests must use the true-only marker.',
    )
  }
  if (input.operation !== null) {
    throw new VaultCliError(
      'ASSISTANT_NATIVE_REPLY_INVALID',
      'Assistant native replies must use a normal message intent.',
    )
  }

  const replyToMessageId = normalizeNullableString(input.replyToMessageId)
  if (!replyToMessageId) {
    throw new VaultCliError(
      'ASSISTANT_NATIVE_REPLY_TARGET_REQUIRED',
      'Assistant native replies require a target message id.',
    )
  }
  if (looksLikePrivateAssistantRoutePlaceholder(replyToMessageId)) {
    throw new VaultCliError(
      'ASSISTANT_NATIVE_REPLY_TARGET_INVALID',
      'Assistant native replies require a provider message id.',
    )
  }

  const channel = normalizeNullableString(input.channel)?.toLowerCase() ?? null
  if (channel !== 'linq' && channel !== 'telegram') {
    throw new VaultCliError(
      'ASSISTANT_NATIVE_REPLY_CHANNEL_UNSUPPORTED',
      `Assistant native replies are not supported for ${channel ?? 'unknown channel'}.`,
    )
  }
  if (channel === 'telegram' && !/^\d+$/u.test(replyToMessageId)) {
    throw new VaultCliError(
      'ASSISTANT_NATIVE_REPLY_TARGET_INVALID',
      'Assistant Telegram native replies require a numeric target message id.',
    )
  }
}

function assertAssistantOutboxDedupeEffectMatches(input: {
  intent: AssistantOutboxIntent
  operation: AssistantOutboxOperation | null
  persistedTarget: AssistantOutboxPersistedTarget
}): void {
  const existingOperationKind = input.intent.operation?.kind ?? null
  const requestedOperationKind = input.operation?.kind ?? null
  if (existingOperationKind !== requestedOperationKind) {
    throw createAssistantOutboxDedupeEffectMismatchError()
  }
  if (requestedOperationKind === 'message-reaction') {
    return
  }

  const existingNativeReplyRequested =
    input.intent.nativeReplyRequested === true
  const requestedNativeReplyRequested =
    input.persistedTarget.nativeReplyRequested === true
  if (!existingNativeReplyRequested && !requestedNativeReplyRequested) {
    return
  }

  const existingReplyToMessageId = normalizeNullableString(
    input.intent.replyToMessageId,
  )
  const requestedReplyToMessageId = normalizeNullableString(
    input.persistedTarget.replyToMessageId,
  )
  if (
    existingReplyToMessageId !== requestedReplyToMessageId
    || existingNativeReplyRequested !== requestedNativeReplyRequested
  ) {
    throw createAssistantOutboxDedupeEffectMismatchError()
  }
}

function assertAssistantOutboxCardCompatible(input: {
  card: AssistantResponseCard | null
  media: readonly AssistantResponseMedia[]
  operation: AssistantOutboxOperation | null
}): void {
  if (input.card !== null && input.media.length > 0) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
      'A response card cannot be combined with response media.',
    )
  }
  if (input.card !== null && input.operation !== null) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_CARD_OPERATION_CONFLICT',
      'A response card requires a normal message intent.',
    )
  }
}

function createAssistantOutboxDedupeEffectMismatchError(): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_OUTBOX_DEDUPE_EFFECT_MISMATCH',
    'Assistant outbox dedupe identity is already bound to a different delivery effect.',
  )
}

function normalizeOutboxMessage(input: {
  media: readonly AssistantResponseMedia[]
  message: string
}): string {
  const normalized = normalizeNullableString(input.message) ?? ''
  if (normalized || input.media.length > 0) {
    return normalized
  }

  throw new Error('Assistant outbox messages must include text or response media.')
}

function normalizeAssistantOutboxReactionOperation(
  operation: AssistantOutboxOperation | null,
): AssistantOutboxOperation | null {
  if (operation?.kind === 'message-reaction') {
    return {
      kind: 'message-reaction',
      reaction: operation.reaction,
    }
  }

  return null
}

function resolveAssistantOutboxOperation(input: {
  operation?: AssistantOutboxIntent['operation']
}): AssistantOutboxOperation | null {
  return normalizeAssistantOutboxReactionOperation(input.operation ?? null)
}

function normalizeRequiredReactionTargetMessageId(
  value: string | null | undefined,
): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new VaultCliError(
      'ASSISTANT_REACTION_TARGET_REQUIRED',
      'Assistant reaction delivery requires a target message id.',
    )
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
  const unsupported = input.media.find((item) =>
    !adapter?.supportedResponseMediaKinds.includes(item.kind))
  if (!unsupported) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_CHANNEL_MEDIA_UNSUPPORTED',
    `Outbound ${unsupported.kind} media delivery is not supported for ${input.channel ?? 'unknown channel'}.`,
  )
}

function buildAssistantOutboxDeliveredIntent(input: {
  delivery: AssistantChannelDelivery
  deliveryTransportIdempotent: boolean
  intent: AssistantOutboxIntent
  session: AssistantSession | null
}): AssistantOutboxIntent {
  const sessionBinding = input.session?.binding ?? null

  return assistantOutboxIntentSchema.parse(
    sanitizeAssistantOutboxIntentForPersistence({
      ...input.intent,
      actorId: sessionBinding?.actorId ?? input.intent.actorId,
      bindingDelivery: sessionBinding?.delivery ?? input.intent.bindingDelivery,
      channel: sessionBinding?.channel ?? input.intent.channel,
      deliveryTransportIdempotent: input.deliveryTransportIdempotent,
      identityId: sessionBinding?.identityId ?? input.intent.identityId,
      threadId: sessionBinding?.threadId ?? input.intent.threadId,
      threadIsDirect: sessionBinding?.threadIsDirect ?? input.intent.threadIsDirect,
    }),
  )
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
    | 'media'
    | 'message'
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
  | 'media'
  | 'message'
  | 'operation'
> | {
  channel?: string | null
  deliveryTransportIdempotent?: boolean
  media?: readonly AssistantResponseMedia[] | null
  message?: string
  operation?: AssistantOutboxOperation | null
}): boolean {
  if (input.deliveryTransportIdempotent) {
    return true
  }
  if (input.operation?.kind === 'message-reaction') {
    return isAssistantOutboxReactionTransportIdempotent(input.channel ?? null)
  }

  const channel = normalizeNullableString(input.channel ?? null)
  if (!channel) {
    return false
  }

  const adapter = getAssistantChannelAdapter(channel)
  if (!adapter) {
    return false
  }
  return adapter.resolveDeliveryTransportIdempotent?.({
    media: input.media ?? [],
    message: input.message ?? '',
  }) ?? adapter.supportsIdempotencyKey === true
}

function resolveAssistantOutboxReactionTransportIdempotent(input: {
  channel?: string | null
  deliveryTransportIdempotent?: boolean
}): boolean {
  return input.deliveryTransportIdempotent ??
    isAssistantOutboxReactionTransportIdempotent(input.channel ?? null)
}

function isAssistantOutboxReactionTransportIdempotent(
  channel: string | null | undefined,
): boolean {
  return normalizeNullableString(channel)?.toLowerCase() === 'telegram'
}

function resolveAssistantOutboxDeliveryTransportIdempotentForCreation(input: {
  channel?: string | null
  deliveryTransportIdempotent?: boolean
  media?: readonly AssistantResponseMedia[] | null
  message?: string
  operation?: AssistantOutboxOperation | null
}): boolean {
  if (input.operation?.kind === 'message-reaction') {
    return resolveAssistantOutboxReactionTransportIdempotent({
      channel: input.channel ?? null,
      deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    })
  }
  const media = input.media ?? []
  if (input.deliveryTransportIdempotent === undefined) {
    return inferAssistantOutboxDeliveryTransportIdempotent({
      channel: input.channel ?? null,
      deliveryTransportIdempotent: false,
      media,
      message: input.message ?? '',
    })
  }
  if (!input.deliveryTransportIdempotent) {
    return false
  }
  if (media.length === 0) {
    return true
  }

  return inferAssistantOutboxDeliveryTransportIdempotent({
    channel: input.channel ?? null,
    deliveryTransportIdempotent: false,
    media,
    message: input.message ?? '',
  })
}

function isReplaySafeHostedEmailGroupFanoutPlanner(
  target: AssistantOutboxPersistedTarget,
): boolean {
  if (normalizeNullableString(target.channel)?.toLowerCase() !== 'email') {
    return false
  }

  const serializedTarget = target.explicitTarget
    ?? (target.bindingDelivery?.kind === 'thread'
      ? target.bindingDelivery.target
      : null)
  const hostedTarget = parseHostedEmailThreadTarget(serializedTarget)
  return hostedTarget?.targetKind === 'group'
    && hostedTarget.recipientMemberId === null
}

function maybeUpgradeAssistantOutboxIntentDeliveryIdempotency(input: {
  deliveryIdempotencyKey: string | null
  deliveryTransportIdempotent: boolean
  intent: AssistantOutboxIntent
}): AssistantOutboxIntent {
  const deliveryIdempotencyKey =
    input.intent.deliveryIdempotencyKey ?? input.deliveryIdempotencyKey
  const deliveryTransportIdempotent =
    input.intent.operation?.kind === 'message-reaction'
      ? input.deliveryTransportIdempotent
      : input.intent.deliveryTransportIdempotent || input.deliveryTransportIdempotent

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

function maybeUpgradeAssistantOutboxIntentAnsweredMailboxItemIds(input: {
  answeredMailboxItemIds: readonly string[]
  intent: AssistantOutboxIntent
}): AssistantOutboxIntent {
  if (
    input.answeredMailboxItemIds.length === 0
    || (
      input.intent.status !== 'pending'
      && input.intent.status !== 'retryable'
    )
  ) {
    return input.intent
  }

  const answeredMailboxItemIds = normalizeAssistantOutboxAnsweredMailboxItemIds([
    ...input.intent.answeredMailboxItemIds,
    ...input.answeredMailboxItemIds,
  ])
  if (
    answeredMailboxItemIds.length === input.intent.answeredMailboxItemIds.length
    && answeredMailboxItemIds.every(
      (mailboxItemId, index) =>
        mailboxItemId === input.intent.answeredMailboxItemIds[index],
    )
  ) {
    return input.intent
  }

  return assistantOutboxIntentSchema.parse(
    sanitizeAssistantOutboxIntentForPersistence({
      ...input.intent,
      answeredMailboxItemIds,
    }),
  )
}

function maybeUpgradeAssistantOutboxIntentExternalThreadRouteAuthority(input: {
  externalThreadRouteAuthority: AssistantOutboxIntent['externalThreadRouteAuthority']
  intent: AssistantOutboxIntent
}): AssistantOutboxIntent {
  const requested = input.externalThreadRouteAuthority ?? null
  if (!requested) {
    return input.intent
  }

  const existing = input.intent.externalThreadRouteAuthority ?? null
  if (existing) {
    if (
      existing.accountLookupKey === requested.accountLookupKey
      && existing.channel === requested.channel
      && existing.containerMemberId === requested.containerMemberId
      && existing.threadId === requested.threadId
    ) {
      return input.intent
    }
    throw createAssistantOutboxDedupeEffectMismatchError()
  }

  if (
    input.intent.status !== 'pending'
    && input.intent.status !== 'retryable'
    && input.intent.status !== 'sending'
    && input.intent.status !== 'awaiting_approval'
  ) {
    return input.intent
  }

  return assistantOutboxIntentSchema.parse(
    sanitizeAssistantOutboxIntentForPersistence({
      ...input.intent,
      externalThreadRouteAuthority: requested,
    }),
  )
}

function maybeUpgradeAssistantOutboxIntentPreDispatchTarget(input: {
  intent: AssistantOutboxIntent
  persistedTarget: AssistantOutboxPersistedTarget
  rawTargetIdentity: AssistantOutboxRawTargetIdentityInput
  updatedAt: string
}): AssistantOutboxIntent {
  if (!shouldUpgradeAssistantOutboxIntentPreDispatchTarget(input)) {
    return input.intent
  }

  return assistantOutboxIntentSchema.parse(
    sanitizeAssistantOutboxIntentForPersistence({
      ...input.intent,
      ...input.persistedTarget,
      targetFingerprint: hashAssistantOutboxTargetFingerprint(input.rawTargetIdentity),
      updatedAt: input.updatedAt,
    }),
  )
}

function normalizeAssistantOutboxAnsweredMailboxItemIds(
  values: readonly string[],
): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const itemId = normalizeNullableString(value)
    if (!itemId || seen.has(itemId)) {
      continue
    }
    seen.add(itemId)
    result.push(itemId)
    if (result.length > ASSISTANT_ANSWERED_MAILBOX_ITEM_ID_LIMIT) {
      throw new VaultCliError(
        'ASSISTANT_OUTBOX_ANSWERED_MAILBOX_ITEM_IDS_TOO_MANY',
        `Assistant outbox answered mailbox item ids exceed the ${ASSISTANT_ANSWERED_MAILBOX_ITEM_ID_LIMIT} item limit.`,
      )
    }
  }

  return result
}

function shouldUpgradeAssistantOutboxIntentPreDispatchTarget(input: {
  intent: AssistantOutboxIntent
  persistedTarget: AssistantOutboxPersistedTarget
}): boolean {
  if (input.intent.status !== 'pending') {
    return false
  }
  if (input.intent.attemptCount !== 0) {
    return false
  }
  if (input.intent.lastAttemptAt !== null || input.intent.sentAt !== null) {
    return false
  }
  if (input.intent.delivery !== null || input.intent.deliveryConfirmationPending) {
    return false
  }
  if (input.intent.bindingDelivery !== null || input.intent.explicitTarget !== null) {
    return false
  }

  return input.persistedTarget.bindingDelivery !== null ||
    input.persistedTarget.explicitTarget !== null
}

function maybeUpgradeAssistantOutboxIntentReactionOperation(input: {
  deliveryTransportIdempotent: boolean
  intent: AssistantOutboxIntent
  operation: AssistantOutboxOperation
  persistedTarget: AssistantOutboxPersistedTarget
  rawTargetIdentity: AssistantOutboxRawTargetIdentityInput
  updatedAt: string
}): AssistantOutboxIntent {
  const targetFingerprint = hashAssistantOutboxTargetFingerprint(
    input.rawTargetIdentity,
  )
  if (
    input.intent.operation?.kind === 'message-reaction' &&
    input.intent.operation.reaction === input.operation.reaction &&
    input.intent.replyToMessageId === input.persistedTarget.replyToMessageId &&
    input.intent.targetFingerprint === targetFingerprint
  ) {
    return input.intent
  }
  if (!shouldUpgradeAssistantOutboxIntentReactionOperation(input.intent)) {
    throw createAssistantOutboxDedupeEffectMismatchError()
  }

  return assistantOutboxIntentSchema.parse(
    sanitizeAssistantOutboxIntentForPersistence({
      ...input.intent,
      ...input.persistedTarget,
      attemptCount: 0,
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryTransportIdempotent: input.deliveryTransportIdempotent,
      lastAttemptAt: null,
      lastError: null,
      media: [],
      message: '',
      nextAttemptAt: input.updatedAt,
      operation: input.operation,
      preparedDispatchToken: null,
      replyToMessageId: input.persistedTarget.replyToMessageId,
      sentAt: null,
      status: 'pending',
      subject: null,
      targetFingerprint,
      updatedAt: input.updatedAt,
    }),
  )
}

function shouldUpgradeAssistantOutboxIntentReactionOperation(
  intent: AssistantOutboxIntent,
): boolean {
  if (intent.status !== 'pending' && intent.status !== 'retryable') {
    return false
  }
  if (intent.sentAt !== null || intent.delivery !== null) {
    return false
  }
  if (intent.deliveryConfirmationPending) {
    return false
  }

  return intent.preparedDispatchToken === null
}
