import {
  assistantChannelDeliverySchema,
  assistantOutboxIntentSchema,
  type AssistantChannelDelivery,
  type AssistantDeliveryError,
  type AssistantOutboxIntent,
  type AssistantProviderMessageEffect,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { retireMaterializedExportPack } from '@murphai/vault-usecases/export-packs'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import { withAssistantRuntimeWriteLock } from '../runtime-write-lock.js'
import { ensureAssistantState } from '../store/persistence.js'
import { writeJsonFileAtomic } from '../shared.js'
import {
  sanitizeAssistantDeliveryErrorForPersistence,
  sanitizeAssistantOutboxIntentForPersistence,
} from '../redaction.js'
import { readDeliveredProviderMessageEffects } from '../channels/helpers.js'
import { reconcileAssistantCronDeliveryIntent } from '../cron/delivery-reconciliation.js'
import { repairAssistantOutboxReceiptForIntent } from './receipt-repair.js'
import {
  createAssistantDeliveryAmbiguousError,
  createAssistantDeliveryConfirmationPendingError,
  createAssistantDeliveryRetryExhaustedError,
  isAssistantOutboxRetryBudgetExhausted,
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

export interface AssistantOutboxPreparedDispatchState {
  attemptCount: number
  deliveryConfirmationPending: boolean
  deliveryTransportIdempotent: boolean
  lastAttemptAt: string | null
  lastError: AssistantDeliveryError | null
  nextAttemptAt: string | null
  preparedDispatchToken: string | null
  status: AssistantOutboxIntent['status']
}

export interface AssistantOutboxPreparedMirrorDispatch {
  intent: AssistantOutboxIntent
  ownsDispatch: boolean
  preparedDispatchToken: string | null
  previousDispatchState: AssistantOutboxPreparedDispatchState
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
    if (current && !assistantOutboxIntentMatchesDispatchOwner(current, input.intent)) {
      await repairAssistantOutboxReceiptForIntent({
        at: current.updatedAt,
        intent: current,
        vault: input.vault,
      })
      return current
    }
    const baseIntent = input.intent
    const pendingIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...baseIntent,
        deliveryConfirmationPending: input.deliveryTransportIdempotent,
        deliveryTransportIdempotent: input.deliveryTransportIdempotent,
        preparedDispatchToken: baseIntent.preparedDispatchToken,
        deliveryIdempotencyKey:
          input.delivery.idempotencyKey ?? baseIntent.deliveryIdempotencyKey,
        updatedAt: input.delivery.sentAt,
        nextAttemptAt: null,
        status: 'sending',
        delivery: input.delivery,
        lastError: createAssistantDeliveryConfirmationPendingError(),
      }),
    )
    const persistedIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence(pendingIntent),
    )
    const persistedIntentValue =
      sanitizeAssistantOutboxIntentForPersistence(persistedIntent)
    await writeJsonFileAtomic(input.intentPath, persistedIntentValue)
    return persistedIntent
  })
}

export async function persistAssistantOutboxIntentLinqAppCardTextFallback(input: {
  idempotencyKey: string
  intentPath: string
  persistedAt: Date
  sending: AssistantOutboxIntent
  vault: string
}): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    const originalIdempotencyKey = input.sending.deliveryIdempotencyKey
    const fallbackIdempotencyKey = input.idempotencyKey.trim()
    const fallbackIdentityIsValid =
      originalIdempotencyKey !== null &&
      (
        fallbackIdempotencyKey === originalIdempotencyKey ||
        fallbackIdempotencyKey === `${originalIdempotencyKey}:fallback`
      )
    if (!fallbackIdentityIsValid) {
      throw new VaultCliError(
        'ASSISTANT_LINQ_APP_CARD_FALLBACK_IDENTITY_INVALID',
        'The iMessage app-card text fallback identity is invalid.',
      )
    }
    if (
      current &&
      current.card === null &&
      current.deliveryIdempotencyKey === fallbackIdempotencyKey &&
      assistantOutboxIntentMatchesDispatchOwner(
        current,
        input.sending,
        ['sending'],
        false,
      )
    ) {
      return current
    }
    if (
      !current ||
      current.card === null ||
      !assistantOutboxIntentMatchesDispatchOwner(current, input.sending)
    ) {
      throw new VaultCliError(
        'ASSISTANT_LINQ_APP_CARD_FALLBACK_OWNERSHIP_CHANGED',
        'The iMessage app-card outbox owner changed before text fallback persistence.',
        { retryable: true },
      )
    }

    const persistedIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...current,
        card: null,
        deliveryIdempotencyKey: fallbackIdempotencyKey,
        updatedAt: input.persistedAt.toISOString(),
      }),
    )
    await writeJsonFileAtomic(
      input.intentPath,
      sanitizeAssistantOutboxIntentForPersistence(persistedIntent),
    )
    return persistedIntent
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

  const sentIntent = await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })

    if (
      current?.status === 'sent' &&
      current.delivery &&
      sameAssistantChannelDelivery(current.delivery, input.delivery)
    ) {
      await repairAssistantOutboxReceiptForIntent({
        at: current.sentAt ?? current.updatedAt,
        intent: current,
        vault: input.vault,
      })
      return current
    }
    if (current?.status === 'sent') {
      return current
    }
    const deliveryOwner = {
      ...input.intent,
      deliveryIdempotencyKey:
        input.delivery.idempotencyKey ?? input.intent.deliveryIdempotencyKey,
    }
    if (
      current &&
      !assistantOutboxIntentMatchesDispatchOwner(
        current,
        deliveryOwner,
        ['pending', 'sending', 'retryable', 'failed'],
        false,
      )
    ) {
      await repairAssistantOutboxReceiptForIntent({
        at: current.updatedAt,
        intent: current,
        vault: input.vault,
      })
      return current
    }

    const baseIntent =
      input.preserveCurrentDispatchMetadata === false
        ? input.intent
        : current ?? input.intent
    const sentIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...baseIntent,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey:
          input.delivery.idempotencyKey ?? baseIntent.deliveryIdempotencyKey,
        updatedAt: completedAt,
        nextAttemptAt: null,
        preparedDispatchToken: null,
        sentAt: completedAt,
        status: 'sent',
        delivery: input.delivery,
        lastError: null,
      }),
    )
    const sentIntentValue = sanitizeAssistantOutboxIntentForPersistence(sentIntent)
    await writeJsonFileAtomic(input.intentPath, sentIntentValue)
    await repairAssistantOutboxReceiptForIntent({
      at: completedAt,
      intent: sentIntent,
      vault: input.vault,
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
  await retireSentExportPacks(input.vault, sentIntent)
  await attemptAssistantCronDeliveryReconciliation({
    intent: sentIntent,
    vault: input.vault,
  })
  return sentIntent
}

async function retireSentExportPacks(
  vault: string,
  intent: AssistantOutboxIntent,
): Promise<void> {
  const receipts = intent.media.flatMap((media) =>
    media.kind === 'vault_file' ? media.retireExportPacks ?? [] : []
  )
  await Promise.all(
    receipts.map(async (receipt) => {
      try {
        await retireMaterializedExportPack(vault, receipt)
      } catch {
        // Delivery is already durably sent. Optional cleanup may leave derived
        // residue, but it must never turn success into a retry or failure.
      }
    }),
  )
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
  const linqPartialDelivery = readLinqPartialDeliveryFromError({
    error: input.error,
    failedAt: input.failedAt,
    sending: input.sending,
  })
  const recoverableLinqRichLinkPartial =
    isRecoverableLinqRichLinkPartialDelivery({
      error: input.error,
      sending: input.sending,
    })
  const ambiguousDelivery = readAmbiguousDeliveryFromError({
    error: input.error,
    failedAt: input.failedAt,
    sending: input.sending,
  })
  const abandonedAmbiguousDelivery = Boolean(ambiguousDelivery) ||
    isAmbiguousDeliveryWithoutProviderIds({
      deliveryMayHaveSucceeded: input.deliveryMayHaveSucceeded,
      error: input.error,
      sending: input.sending,
    })
  const abandonedDelivery = abandonedAmbiguousDelivery ||
    isEmailGroupRecipientAuthoritySuperseded({
      error: input.error,
      sending: input.sending,
    })
  const classifiedDeliveryError = abandonedAmbiguousDelivery
    ? sanitizeAssistantDeliveryErrorForPersistence(
        createAssistantDeliveryAmbiguousError(input.error),
      )!
    : input.deliveryMayHaveSucceeded
      ? sanitizeAssistantDeliveryErrorForPersistence(
          createAssistantDeliveryConfirmationPendingError(input.error),
        )!
      : sanitizeAssistantDeliveryErrorForPersistence(
          normalizeAssistantDeliveryError(input.error),
        )!
  const retryRequested = abandonedDelivery
    ? false
    : input.deliveryMayHaveSucceeded || isAssistantOutboxRetryableError(input.error)

  const failedIntent = await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    if (current && !assistantOutboxIntentMatchesDispatchOwner(current, input.sending)) {
      await repairAssistantOutboxReceiptForIntent({
        at: current.updatedAt,
        intent: current,
        vault: input.vault,
      })
      return current
    }
    const baseIntent = current ?? input.sending
    const preserveNonConfirmableLinqRichLinkCheckpoint =
      carriesNonConfirmableLinqRichLinkCheckpoint(baseIntent)
    const retainLinqReactionConfirmation =
      hasConcreteLinqMessageReactionReceipt(baseIntent)
    const attemptCount = baseIntent.attemptCount
    const failedAt = input.failedAt.toISOString()
    const retryExhausted = retryRequested &&
      !input.deliveryMayHaveSucceeded &&
      isAssistantOutboxRetryBudgetExhausted(baseIntent)
    const retryable = retryRequested && !retryExhausted
    const deliveryError = retryExhausted
      ? sanitizeAssistantDeliveryErrorForPersistence(
          createAssistantDeliveryRetryExhaustedError(input.error),
        )!
      : classifiedDeliveryError
    const nextAttemptAt = retryable
      ? buildAssistantOutboxRetryTimestamp(input.failedAt, attemptCount)
      : null
    const failedIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...baseIntent,
        delivery:
          ambiguousDelivery ??
          linqPartialDelivery ??
          current?.delivery ??
          input.sending.delivery,
        deliveryConfirmationPending:
          recoverableLinqRichLinkPartial ||
          preserveNonConfirmableLinqRichLinkCheckpoint
          ? false
          : abandonedDelivery || retryExhausted
          ? false
          : input.deliveryMayHaveSucceeded
            ? input.deliveryTransportIdempotent || retainLinqReactionConfirmation
            : false,
        deliveryTransportIdempotent: abandonedDelivery
          ? false
          : input.deliveryMayHaveSucceeded
            ? input.deliveryTransportIdempotent
            : (current?.deliveryTransportIdempotent ??
                input.sending.deliveryTransportIdempotent),
        updatedAt: failedAt,
        nextAttemptAt,
        status: abandonedDelivery ? 'abandoned' : retryable ? 'retryable' : 'failed',
        lastError: deliveryError,
      }),
    )
    const failedIntentValue = sanitizeAssistantOutboxIntentForPersistence(failedIntent)
    await writeJsonFileAtomic(input.intentPath, failedIntentValue)
    await repairAssistantOutboxReceiptForIntent({
      at: failedIntent.updatedAt,
      intent: failedIntent,
      vault: input.vault,
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
  await attemptAssistantCronDeliveryReconciliation({
    intent: failedIntent,
    vault: input.vault,
  })
  return failedIntent
}

function readAmbiguousDeliveryFromError(input: {
  error: unknown
  failedAt: Date
  sending: AssistantOutboxIntent
}): AssistantChannelDelivery | null {
  const telegramDelivery = readTelegramAmbiguousDeliveryFromError(input)
  if (telegramDelivery) {
    return telegramDelivery
  }
  const linqPartialDelivery = readLinqPartialDeliveryFromError(input)
  return isRecoverableLinqRichLinkPartialDelivery(input)
    ? null
    : linqPartialDelivery
}

function isRecoverableLinqRichLinkPartialDelivery(input: {
  error: unknown
  sending: AssistantOutboxIntent
}): boolean {
  if (input.sending.channel !== 'linq') {
    return false
  }

  const errorRecord = readRecord(input.error)
  const context = readRecord(errorRecord?.context)
  const code =
    readNonEmptyString(errorRecord?.code) ??
    readNonEmptyString(context?.code) ??
    null
  if (code !== 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY') {
    return false
  }

  return readProviderMessageIdsFromErrorRecord(errorRecord, context)?.length === 1
}

function carriesNonConfirmableLinqRichLinkCheckpoint(
  intent: AssistantOutboxIntent,
): boolean {
  const delivery = intent.delivery
  return intent.channel === 'linq' &&
    delivery?.kind !== 'message-reaction' &&
    delivery?.channel === 'linq' &&
    intent.deliveryConfirmationPending === false &&
    delivery.providerMessageIds?.length === 1
}

function isAmbiguousDeliveryWithoutProviderIds(input: {
  deliveryMayHaveSucceeded: boolean
  error: unknown
  sending: AssistantOutboxIntent
}): boolean {
  return isLinqAttachmentReservationAmbiguity(input) ||
    isTelegramAmbiguousDeliveryWithoutProviderIds(input) ||
    isLinqMessageReactionAmbiguityWithoutProviderIds(input) ||
    isLinqPartialDeliveryWithoutProviderIds(input) ||
    isEmailGroupFanoutAmbiguityWithoutProviderIds(input)
}

function isLinqAttachmentReservationAmbiguity(input: {
  error: unknown
  sending: AssistantOutboxIntent
}): boolean {
  if (input.sending.channel !== 'linq') {
    return false
  }

  const errorRecord = readRecord(input.error)
  const context = readRecord(errorRecord?.context)
  if (errorRecord?.deliveryMayHaveSucceeded === false) {
    return false
  }
  if (errorRecord?.linqAttachmentReservationMayHaveSucceeded === true) {
    return true
  }
  if (
    readNonEmptyString(errorRecord?.code) !== 'LINQ_API_REQUEST_FAILED' ||
    readNonEmptyString(context?.method) !== 'POST' ||
    readNonEmptyString(context?.operation) !== 'create_attachment_upload'
  ) {
    return false
  }
  if (errorRecord?.deliveryMayHaveSucceeded === true) {
    return true
  }

  const failureStage = readNonEmptyString(context?.failureStage)
  if (failureStage === 'transport') {
    return true
  }

  // The reservation POST has no idempotency key. A successful but unusable
  // response, timeout, or server-side failure cannot prove that Linq did not
  // create the reservation.
  const status = context?.status
  return failureStage === 'http' &&
    typeof status === 'number' &&
    (
      (status >= 200 && status <= 299) ||
      status === 408 ||
      (status >= 500 && status <= 599)
    )
}

function isEmailGroupFanoutAmbiguityWithoutProviderIds(input: {
  deliveryMayHaveSucceeded: boolean
  error: unknown
  sending: AssistantOutboxIntent
}): boolean {
  if (!input.deliveryMayHaveSucceeded || input.sending.channel !== 'email') {
    return false
  }

  const errorRecord = readRecord(input.error)
  const context = readRecord(errorRecord?.context)
  const code =
    readNonEmptyString(errorRecord?.code) ??
    readNonEmptyString(context?.code) ??
    null

  return code === 'ASSISTANT_EMAIL_GROUP_FANOUT_INCOMPLETE'
}

function isEmailGroupRecipientAuthoritySuperseded(input: {
  error: unknown
  sending: AssistantOutboxIntent
}): boolean {
  if (input.sending.channel !== 'email') {
    return false
  }

  const errorRecord = readRecord(input.error)
  const context = readRecord(errorRecord?.context)
  const code =
    readNonEmptyString(errorRecord?.code) ??
    readNonEmptyString(context?.code) ??
    null

  return code === 'ASSISTANT_EMAIL_GROUP_RECIPIENT_AUTHORITY_SUPERSEDED'
}

function isTelegramAmbiguousDeliveryWithoutProviderIds(input: {
  deliveryMayHaveSucceeded: boolean
  error: unknown
  sending: AssistantOutboxIntent
}): boolean {
  if (!input.deliveryMayHaveSucceeded || input.sending.channel !== 'telegram') {
    return false
  }

  const errorRecord = readRecord(input.error)
  const context = readRecord(errorRecord?.context)
  const code =
    readNonEmptyString(errorRecord?.code) ??
    readNonEmptyString(context?.code) ??
    null
  if (
    code !== 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS' &&
    code !== 'ASSISTANT_TELEGRAM_VOICE_MEMO_DELIVERY_AMBIGUOUS'
  ) {
    return false
  }

  const providerMessageIds =
    readNonEmptyStringArray(errorRecord?.providerMessageIds) ??
    readNonEmptyStringArray(context?.providerMessageIds) ??
    null

  return providerMessageIds === null
}

function isLinqPartialDeliveryWithoutProviderIds(input: {
  deliveryMayHaveSucceeded: boolean
  error: unknown
  sending: AssistantOutboxIntent
}): boolean {
  if (!input.deliveryMayHaveSucceeded || input.sending.channel !== 'linq') {
    return false
  }

  const errorRecord = readRecord(input.error)
  const context = readRecord(errorRecord?.context)
  const code =
    readNonEmptyString(errorRecord?.code) ??
    readNonEmptyString(context?.code) ??
    null
  if (
    code !== 'ASSISTANT_LINQ_VOICE_MEMO_PARTIAL_DELIVERY'
    && code !== 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY'
  ) {
    return false
  }

  const providerMessageIds = readProviderMessageIdsFromErrorRecord(errorRecord, context)
  return providerMessageIds === null
}

function isLinqMessageReactionAmbiguityWithoutProviderIds(input: {
  deliveryMayHaveSucceeded: boolean
  sending: AssistantOutboxIntent
}): boolean {
  return input.deliveryMayHaveSucceeded &&
    input.sending.channel === 'linq' &&
    input.sending.operation?.kind === 'message-reaction' &&
    input.sending.deliveryTransportIdempotent === false &&
    !hasConcreteLinqMessageReactionReceipt(input.sending)
}

function hasConcreteLinqMessageReactionReceipt(
  intent: AssistantOutboxIntent,
): boolean {
  return intent.channel === 'linq' &&
    intent.operation?.kind === 'message-reaction' &&
    intent.delivery?.kind === 'message-reaction' &&
    intent.delivery.channel === 'linq'
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
  const cleanupTargetAliases =
    readNonEmptyStringArray(errorRecord?.cleanupTargetAliases) ??
    readNonEmptyStringArray(context?.cleanupTargetAliases) ??
    null
  const cleanupMessages =
    readAssistantDeliveryCleanupMessagesValue(errorRecord?.cleanupMessages) ??
    readAssistantDeliveryCleanupMessagesValue(context?.cleanupMessages) ??
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
    ...(cleanupMessages
      ? { cleanupMessages }
      : { cleanupMessages: providerMessageIds.map((messageId) => ({ messageId, target })) }),
    ...(cleanupTargetAliases ? { cleanupTargetAliases } : {}),
  })
}

function readLinqPartialDeliveryFromError(input: {
  error: unknown
  failedAt: Date
  sending: AssistantOutboxIntent
}): AssistantChannelDelivery | null {
  if (input.sending.channel !== 'linq') {
    return null
  }

  const errorRecord = readRecord(input.error)
  const context = readRecord(errorRecord?.context)
  const code =
    readNonEmptyString(errorRecord?.code) ??
    readNonEmptyString(context?.code) ??
    null
  if (
    code !== 'ASSISTANT_LINQ_VOICE_MEMO_PARTIAL_DELIVERY'
    && code !== 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY'
  ) {
    return null
  }

  const providerMessageIds = readProviderMessageIdsFromErrorRecord(errorRecord, context)
  const target =
    readNonEmptyString(errorRecord?.target) ??
    readNonEmptyString(context?.target) ??
    input.sending.explicitTarget ??
    input.sending.bindingDelivery?.target ??
    null
  const targetKind =
    readAssistantDeliveryTargetKind(errorRecord?.targetKind) ??
    readAssistantDeliveryTargetKind(context?.targetKind) ??
    inferAssistantOutboxFailureTargetKind(input.sending)
  if (!providerMessageIds || !target || !targetKind) {
    return null
  }
  const providerMessageEffects = (
    readDeliveredProviderMessageEffects(context) ?? []
  ).filter((effect) => providerMessageIds.includes(effect.providerMessageId))

  return assistantChannelDeliverySchema.parse({
    channel: 'linq',
    idempotencyKey: input.sending.deliveryIdempotencyKey,
    messageLength: input.sending.message.length,
    providerMessageId: providerMessageIds.at(-1) ?? null,
    providerMessageIds,
    ...(providerMessageEffects.length > 0
      ? { providerMessageEffects }
      : {}),
    providerThreadId:
      readNonEmptyString(errorRecord?.providerThreadId) ??
      readNonEmptyString(context?.providerThreadId) ??
      null,
    sentAt: input.failedAt.toISOString(),
    target,
    targetKind,
  })
}

function readProviderMessageIdsFromErrorRecord(
  errorRecord: Record<string, unknown> | null,
  context: Record<string, unknown> | null,
): string[] | null {
  const providerMessageIds =
    readNonEmptyStringArray(errorRecord?.providerMessageIds) ??
    readNonEmptyStringArray(context?.providerMessageIds) ??
    null
  if (providerMessageIds) {
    return providerMessageIds
  }

  const providerMessageId =
    readNonEmptyString(errorRecord?.providerMessageId) ??
    readNonEmptyString(context?.providerMessageId) ??
    null
  return providerMessageId ? [providerMessageId] : null
}

function readAssistantDeliveryTargetKind(
  value: unknown,
): AssistantChannelDelivery['targetKind'] | null {
  const targetKind = readNonEmptyString(value)
  return targetKind === 'explicit' || targetKind === 'participant' || targetKind === 'thread'
    ? targetKind
    : null
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
    if (current && !assistantOutboxIntentMatchesDispatchOwner(current, input.sending)) {
      await repairAssistantOutboxReceiptForIntent({
        at: current.updatedAt,
        intent: current,
        vault: input.vault,
      })
      return current
    }
    const baseIntent = current ?? input.sending
    const scheduledAt = input.scheduledAt.toISOString()
    const retryIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...baseIntent,
        deliveryConfirmationPending: baseIntent.deliveryTransportIdempotent,
        updatedAt: scheduledAt,
        nextAttemptAt: buildAssistantOutboxRetryTimestamp(
          input.scheduledAt,
          baseIntent.attemptCount,
        ),
        status: 'retryable',
        lastError: sanitizeAssistantDeliveryErrorForPersistence(input.error),
      }),
    )
    const persistedIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence(retryIntent),
    )
    const persistedIntentValue =
      sanitizeAssistantOutboxIntentForPersistence(persistedIntent)
    await writeJsonFileAtomic(input.intentPath, persistedIntentValue)
    await repairAssistantOutboxReceiptForIntent({
      at: persistedIntent.updatedAt,
      intent: persistedIntent,
      vault: input.vault,
    })
    return persistedIntent
  })
}

function buildAssistantOutboxRetryTimestamp(at: Date, attemptCount: number): string {
  return new Date(at.getTime() + resolveAssistantOutboxRetryDelayMs(attemptCount)).toISOString()
}

export function sameAssistantChannelDelivery(
  left: AssistantChannelDelivery,
  right: AssistantChannelDelivery,
): boolean {
  if (
    left.kind === 'message-reaction' ||
    right.kind === 'message-reaction'
  ) {
    return (
      left.kind === 'message-reaction' &&
      right.kind === 'message-reaction' &&
      left.channel === right.channel &&
      left.idempotencyKey === right.idempotencyKey &&
      left.reaction === right.reaction &&
      left.target === right.target &&
      left.targetKind === right.targetKind &&
      left.targetMessageId === right.targetMessageId &&
      left.sentAt === right.sentAt
    )
  }

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
    sameAssistantDeliveryProviderMessageEffects(
      left.providerMessageEffects,
      right.providerMessageEffects,
    ) &&
    sameAssistantDeliveryCleanupMessages(
      readAssistantDeliveryCleanupMessages(left),
      readAssistantDeliveryCleanupMessages(right),
    ) &&
    sameAssistantDeliveryCleanupTargetAliases(
      readAssistantDeliveryCleanupTargetAliases(left),
      readAssistantDeliveryCleanupTargetAliases(right),
    ) &&
    left.providerThreadId === right.providerThreadId
  )
}

function sameAssistantDeliveryProviderMessageEffects(
  left: readonly AssistantProviderMessageEffect[] | undefined,
  right: readonly AssistantProviderMessageEffect[] | undefined,
): boolean {
  const normalizedLeft = left ?? []
  const normalizedRight = right ?? []
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((effect, index) => {
      const other = normalizedRight[index]
      return other !== undefined &&
        effect.carriesIntentMedia === other.carriesIntentMedia &&
        effect.providerMessageId === other.providerMessageId &&
        effect.message === other.message
    })
}

function sameAssistantDeliveryProviderMessageIds(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const normalizedLeft = left ?? []
  const normalizedRight = right ?? []

  if (normalizedLeft.length === 0 && normalizedRight.length === 0) {
    return true
  }

  if (normalizedLeft.length !== normalizedRight.length) {
    return false
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function sameAssistantDeliveryCleanupTargetAliases(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const normalizedLeft = left ?? []
  const normalizedRight = right ?? []

  if (normalizedLeft.length === 0 && normalizedRight.length === 0) {
    return true
  }

  if (normalizedLeft.length !== normalizedRight.length) {
    return false
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function sameAssistantDeliveryCleanupMessages(
  left: ReadonlyArray<{ messageId: string; target: string }> | undefined,
  right: ReadonlyArray<{ messageId: string; target: string }> | undefined,
): boolean {
  const normalizedLeft = left ?? []
  const normalizedRight = right ?? []

  if (normalizedLeft.length === 0 && normalizedRight.length === 0) {
    return true
  }

  if (normalizedLeft.length !== normalizedRight.length) {
    return false
  }

  return normalizedLeft.every(
    (value, index) =>
      value.messageId === normalizedRight[index]?.messageId &&
      value.target === normalizedRight[index]?.target,
  )
}

function readAssistantDeliveryCleanupMessages(
  delivery: AssistantChannelDelivery,
): ReadonlyArray<{ messageId: string; target: string }> | undefined {
  if (!('cleanupMessages' in delivery)) {
    return undefined
  }

  return readAssistantDeliveryCleanupMessagesValue(delivery.cleanupMessages) ?? undefined
}

function readAssistantDeliveryCleanupTargetAliases(
  delivery: AssistantChannelDelivery,
): readonly string[] | undefined {
  if (!('cleanupTargetAliases' in delivery) || !Array.isArray(delivery.cleanupTargetAliases)) {
    return undefined
  }

  return delivery.cleanupTargetAliases
}

function readAssistantDeliveryCleanupMessagesValue(
  value: unknown,
): Array<{ messageId: string; target: string }> | null {
  if (!Array.isArray(value)) {
    return null
  }

  const cleanupMessages = Array.from(
    new Map(
      value.flatMap((entry) => {
        const record = readRecord(entry)
        const messageId = readNonEmptyString(record?.messageId)
        const target = readNonEmptyString(record?.target)
        if (!messageId || !target) {
          return []
        }

        return [[`${target}\u0000${messageId}`, { messageId, target }] as const]
      }),
    ).values(),
  )

  return cleanupMessages.length > 0 ? cleanupMessages : null
}

export async function markAssistantOutboxIntentMirrorSending(input: {
  deliveryIdempotencyKey?: string | null
  deliveryTransportIdempotent: boolean
  intent: AssistantOutboxIntent
  intentPath: string
  startedAt: string
  vault: string
}): Promise<AssistantOutboxIntent> {
  return (await markAssistantOutboxIntentMirrorSendingPrepared({
    ...input,
    preparedDispatchToken: null,
  })).intent
}

export async function markAssistantOutboxIntentMirrorSendingPrepared(input: {
  deliveryIdempotencyKey?: string | null
  deliveryTransportIdempotent: boolean
  externalThreadRouteAuthority?: AssistantOutboxIntent['externalThreadRouteAuthority']
  externalThreadService?: AssistantOutboxIntent['externalThreadService']
  intent: AssistantOutboxIntent
  intentPath: string
  preparedDispatchToken?: string | null
  startedAt: string
  vault: string
}): Promise<AssistantOutboxPreparedMirrorDispatch> {
  let retryExhausted = false
  const result = await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    const baseIntent = current ?? input.intent
    const previousDispatchState = readAssistantOutboxPreparedDispatchState(baseIntent)
    const deliveryIdempotencyKey =
      input.deliveryIdempotencyKey ?? baseIntent.deliveryIdempotencyKey
    const preparedDispatchToken = input.preparedDispatchToken ?? null
    const dispatchNow = new Date(input.startedAt)
    if (
      baseIntent.status === 'sending' &&
      (
        !preparedDispatchToken ||
        baseIntent.preparedDispatchToken !== preparedDispatchToken ||
        baseIntent.lastAttemptAt !== input.startedAt ||
        baseIntent.deliveryTransportIdempotent !== input.deliveryTransportIdempotent ||
        baseIntent.deliveryIdempotencyKey !== deliveryIdempotencyKey
      )
    ) {
      await repairAssistantOutboxReceiptForIntent({
        at: baseIntent.updatedAt,
        intent: baseIntent,
        vault: input.vault,
      })
      return {
        intent: baseIntent,
        ownsDispatch: false,
        preparedDispatchToken: null,
        previousDispatchState,
      }
    }
    if (
      baseIntent.status === 'sending' &&
      preparedDispatchToken &&
      baseIntent.preparedDispatchToken === preparedDispatchToken &&
      baseIntent.lastAttemptAt === input.startedAt &&
      baseIntent.deliveryTransportIdempotent === input.deliveryTransportIdempotent &&
      baseIntent.deliveryIdempotencyKey === deliveryIdempotencyKey
    ) {
      await repairAssistantOutboxReceiptForIntent({
        at: baseIntent.updatedAt,
        intent: baseIntent,
        vault: input.vault,
      })
      return {
        intent: baseIntent,
        ownsDispatch: true,
        preparedDispatchToken,
        previousDispatchState,
      }
    }
    if (
      baseIntent.status === 'retryable' &&
      !baseIntent.delivery &&
      (
        !baseIntent.deliveryConfirmationPending ||
        input.deliveryTransportIdempotent
      ) &&
      isAssistantOutboxRetryBudgetExhausted(baseIntent)
    ) {
      const deliveryError = sanitizeAssistantDeliveryErrorForPersistence(
        createAssistantDeliveryRetryExhaustedError(baseIntent.lastError),
      )!
      const failedIntent = assistantOutboxIntentSchema.parse(
        sanitizeAssistantOutboxIntentForPersistence({
          ...baseIntent,
          updatedAt: input.startedAt,
          nextAttemptAt: null,
          preparedDispatchToken: null,
          status: 'failed',
          lastError: deliveryError,
        }),
      )
      await writeJsonFileAtomic(
        input.intentPath,
        sanitizeAssistantOutboxIntentForPersistence(failedIntent),
      )
      await repairAssistantOutboxReceiptForIntent({
        at: failedIntent.updatedAt,
        intent: failedIntent,
        vault: input.vault,
      })
      retryExhausted = true
      return {
        intent: failedIntent,
        ownsDispatch: false,
        preparedDispatchToken: null,
        previousDispatchState,
      }
    }
    if (
      baseIntent.delivery ||
      baseIntent.deliveryConfirmationPending ||
      !shouldPrepareClaimAssistantOutboxIntent(baseIntent, dispatchNow)
    ) {
      await repairAssistantOutboxReceiptForIntent({
        at: baseIntent.updatedAt,
        intent: baseIntent,
        vault: input.vault,
      })
      return {
        intent: baseIntent,
        ownsDispatch: false,
        preparedDispatchToken: null,
        previousDispatchState,
      }
    }
    const sendingIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...baseIntent,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey,
        deliveryTransportIdempotent: input.deliveryTransportIdempotent,
        ...(input.externalThreadRouteAuthority === undefined
          ? {}
          : { externalThreadRouteAuthority: input.externalThreadRouteAuthority }),
        ...(input.externalThreadService === undefined
          ? {}
          : { externalThreadService: input.externalThreadService }),
        updatedAt: input.startedAt,
        lastAttemptAt: input.startedAt,
        nextAttemptAt: null,
        preparedDispatchToken,
        attemptCount: baseIntent.attemptCount + 1,
        status: 'sending',
      }),
    )
    const sendingIntentValue =
      sanitizeAssistantOutboxIntentForPersistence(sendingIntent)
    await writeJsonFileAtomic(input.intentPath, sendingIntentValue)
    await repairAssistantOutboxReceiptForIntent({
      at: input.startedAt,
      intent: sendingIntent,
      vault: input.vault,
    })
    return {
      intent: sendingIntent,
      ownsDispatch: preparedDispatchToken !== null,
      preparedDispatchToken,
      previousDispatchState,
    }
  })

  if (retryExhausted) {
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: 'delivery',
      kind: 'delivery.failed',
      message: result.intent.lastError?.message ??
        'Assistant outbound delivery exhausted its automatic retries.',
      level: 'error',
      code: result.intent.lastError?.code ??
        'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
      sessionId: result.intent.sessionId,
      turnId: result.intent.turnId,
      intentId: result.intent.intentId,
      counterDeltas: {
        deliveriesFailed: 1,
      },
      at: result.intent.updatedAt,
    })
    await attemptAssistantCronDeliveryReconciliation({
      intent: result.intent,
      vault: input.vault,
    })
  }

  return result
}

function shouldPrepareClaimAssistantOutboxIntent(
  intent: AssistantOutboxIntent,
  now: Date,
): boolean {
  if (intent.status === 'pending') {
    return true
  }

  if (intent.status !== 'retryable') {
    return false
  }

  if (!intent.nextAttemptAt) {
    return true
  }

  const nextAttemptMs = Date.parse(intent.nextAttemptAt)
  return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= now.getTime()
}

function readAssistantOutboxPreparedDispatchState(
  intent: AssistantOutboxIntent,
): AssistantOutboxPreparedDispatchState {
  return {
    attemptCount: intent.attemptCount,
    deliveryConfirmationPending: intent.deliveryConfirmationPending,
    deliveryTransportIdempotent: intent.deliveryTransportIdempotent,
    lastAttemptAt: intent.lastAttemptAt,
    lastError: intent.lastError,
    nextAttemptAt: intent.nextAttemptAt,
    preparedDispatchToken: intent.preparedDispatchToken,
    status: intent.status,
  }
}

export async function resetAssistantOutboxPreparedDispatch(input: {
  deliveryTransportIdempotent: boolean
  intent: AssistantOutboxIntent
  intentPath: string
  minimumNextAttemptAt?: Date | null
  preparedDispatchToken?: string | null
  resetAt: Date
  restoreDispatchState?: AssistantOutboxPreparedDispatchState | null
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    if (
      !current ||
      (
        current.status !== 'sending' &&
        current.status !== 'retryable' &&
        current.status !== 'failed'
      )
    ) {
      return null
    }
    if (current.delivery || current.deliveryConfirmationPending) {
      return null
    }
    if (!input.preparedDispatchToken || current.preparedDispatchToken !== input.preparedDispatchToken) {
      return null
    }
    if (current.deliveryTransportIdempotent !== input.deliveryTransportIdempotent) {
      return null
    }
    const resetAt = input.resetAt.toISOString()
    const restoreDispatchState = input.restoreDispatchState ?? null
    const restoredNextAttemptAt = restoreDispatchState
      ? restoreDispatchState.nextAttemptAt
      : resetAt
    const nextAttemptAt = clampAssistantOutboxPreparedResetNextAttemptAt({
      minimumNextAttemptAt: input.minimumNextAttemptAt ?? null,
      nextAttemptAt: restoredNextAttemptAt,
    })
    const pendingIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...current,
        attemptCount: restoreDispatchState?.attemptCount ?? current.attemptCount,
        deliveryConfirmationPending:
          restoreDispatchState?.deliveryConfirmationPending ?? false,
        deliveryIdempotencyKey: current.deliveryIdempotencyKey,
        deliveryTransportIdempotent: restoreDispatchState
          ? restoreDispatchState.deliveryTransportIdempotent
          : current.deliveryTransportIdempotent,
        updatedAt: resetAt,
        lastAttemptAt: restoreDispatchState
          ? restoreDispatchState.lastAttemptAt
          : current.lastAttemptAt,
        nextAttemptAt,
        preparedDispatchToken: restoreDispatchState
          ? restoreDispatchState.preparedDispatchToken
          : null,
        status: restoreDispatchState?.status ?? 'pending',
        delivery: null,
        lastError: restoreDispatchState ? restoreDispatchState.lastError : null,
      }),
    )
    const pendingIntentValue =
      sanitizeAssistantOutboxIntentForPersistence(pendingIntent)
    await writeJsonFileAtomic(input.intentPath, pendingIntentValue)
    await repairAssistantOutboxReceiptForIntent({
      at: resetAt,
      intent: pendingIntent,
      vault: input.vault,
    })
    return pendingIntent
  })
}

function clampAssistantOutboxPreparedResetNextAttemptAt(input: {
  minimumNextAttemptAt: Date | null
  nextAttemptAt: string | null
}): string | null {
  if (!input.minimumNextAttemptAt) {
    return input.nextAttemptAt
  }
  const minimumNextAttemptAt = input.minimumNextAttemptAt.toISOString()
  if (!input.nextAttemptAt) {
    return minimumNextAttemptAt
  }
  const nextAttemptMs = Date.parse(input.nextAttemptAt)
  const minimumNextAttemptMs = input.minimumNextAttemptAt.getTime()
  if (!Number.isFinite(nextAttemptMs) || nextAttemptMs < minimumNextAttemptMs) {
    return minimumNextAttemptAt
  }
  return input.nextAttemptAt
}

export function assistantOutboxIntentMatchesDispatchOwner(
  current: AssistantOutboxIntent,
  owner: Pick<
    AssistantOutboxIntent,
    | 'attemptCount'
    | 'deliveryIdempotencyKey'
    | 'deliveryTransportIdempotent'
    | 'lastAttemptAt'
    | 'preparedDispatchToken'
  >,
  allowedStatuses: readonly AssistantOutboxIntent['status'][] = ['sending'],
  compareDeliveryState = true,
): boolean {
  if (owner.preparedDispatchToken) {
    if (current.preparedDispatchToken !== owner.preparedDispatchToken) {
      return false
    }
  } else if (current.preparedDispatchToken !== null) {
    return false
  }

  if (!allowedStatuses.includes(current.status)) {
    return false
  }

  if (
    current.attemptCount !== owner.attemptCount ||
    current.lastAttemptAt !== owner.lastAttemptAt
  ) {
    return false
  }

  if (!compareDeliveryState) {
    return true
  }

  return (
    current.deliveryIdempotencyKey === owner.deliveryIdempotencyKey &&
    current.deliveryTransportIdempotent === owner.deliveryTransportIdempotent
  )
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
  onlyCurrentStatuses?: readonly AssistantOutboxIntent['status'][]
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
  onlyCurrentStatuses?: readonly AssistantOutboxIntent['status'][]
  retryable: boolean
  status: 'abandoned' | 'failed' | 'retryable'
  vault: string
}): Promise<AssistantOutboxIntent> {
  const classifiedDeliveryError = sanitizeAssistantDeliveryErrorForPersistence(
    normalizeAssistantDeliveryError(input.error),
  )!

  const updatedIntent = await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantOutboxIntentAtPath(input.intentPath, {
      vault: input.vault,
    })
    if (
      current &&
      input.onlyCurrentStatuses &&
      !input.onlyCurrentStatuses.includes(current.status)
    ) {
      await repairAssistantOutboxReceiptForIntent({
        at: current.updatedAt,
        intent: current,
        vault: input.vault,
      })
      return current
    }
    if (
      current &&
      !assistantOutboxIntentMatchesDispatchOwner(
        current,
        input.intent,
        ['awaiting_approval', 'pending', 'sending', 'retryable', 'failed'],
      )
    ) {
      await repairAssistantOutboxReceiptForIntent({
        at: current.updatedAt,
        intent: current,
        vault: input.vault,
      })
      return current
    }
    const baseIntent = current ?? input.intent
    const failedAt = input.failedAt.toISOString()
    const retryExhausted = input.retryable &&
      isAssistantOutboxRetryBudgetExhausted(baseIntent)
    const retryable = input.retryable && !retryExhausted
    const deliveryError = retryExhausted
      ? sanitizeAssistantDeliveryErrorForPersistence(
          createAssistantDeliveryRetryExhaustedError(input.error),
        )!
      : classifiedDeliveryError
    const nextAttemptAt = retryable
      ? buildAssistantOutboxRetryTimestamp(input.failedAt, baseIntent.attemptCount)
      : null
    const updatedIntent = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence({
        ...baseIntent,
        deliveryConfirmationPending: false,
        updatedAt: failedAt,
        nextAttemptAt,
        status: retryExhausted ? 'failed' : input.status,
        lastError: deliveryError,
      }),
    )
    const updatedIntentValue =
      sanitizeAssistantOutboxIntentForPersistence(updatedIntent)
    await writeJsonFileAtomic(input.intentPath, updatedIntentValue)
    await repairAssistantOutboxReceiptForIntent({
      at: updatedIntent.updatedAt,
      intent: updatedIntent,
      vault: input.vault,
    })
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: retryable ? 'outbox' : 'delivery',
      kind: retryable ? 'delivery.retry-scheduled' : 'delivery.failed',
      message: deliveryError.message,
      level: retryable ? 'warn' : 'error',
      code: deliveryError.code,
      sessionId: updatedIntent.sessionId,
      turnId: updatedIntent.turnId,
      intentId: updatedIntent.intentId,
      counterDeltas: retryable
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
  await attemptAssistantCronDeliveryReconciliation({
    intent: updatedIntent,
    vault: input.vault,
  })
  return updatedIntent
}

async function attemptAssistantCronDeliveryReconciliation(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<void> {
  try {
    await reconcileAssistantCronDeliveryIntent(input)
  } catch (error) {
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: 'outbox',
      kind: 'cron.delivery-reconciliation.failed',
      level: 'warn',
      code: 'ASSISTANT_CRON_DELIVERY_RECONCILIATION_FAILED',
      message:
        'Assistant cron delivery reconciliation failed after an outbox terminal update.',
      intentId: input.intent.intentId,
      sessionId: input.intent.sessionId,
      turnId: input.intent.turnId,
      data: {
        errorName: readSafeAssistantOutboxErrorName(error),
        intentStatus: input.intent.status,
      },
    }).catch(() => undefined)
  }
}

function readSafeAssistantOutboxErrorName(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  const name = error.name.trim()
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(name) ? name : null
}
