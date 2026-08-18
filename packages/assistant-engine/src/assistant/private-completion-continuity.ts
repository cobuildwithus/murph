import {
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
} from '@murphai/hosted-execution/assistant-identifiers'
import {
  assistantOutboxIntentSchema,
  assistantTranscriptEntrySchema,
  type AssistantOutboxIntent,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

import { resolveAssistantOutboxIntentPath } from './outbox/intents.js'
import {
  listAssistantOutboxIntentsLocal,
  persistAssistantOutboxIntentAtPaths,
  readAssistantOutboxIntentAtPath,
} from './outbox/store.js'
import { sanitizeAssistantOutboxIntentForPersistence } from './redaction.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { normalizeNullableString } from './shared.js'
import {
  appendTranscriptEntries,
  ensureAssistantState,
  readAssistantSession,
  readAssistantTranscriptEntries,
  synchronizeAssistantIndexes,
  writeAssistantSession,
} from './store/persistence.js'
import { withAssistantTurnLock } from './turn-lock.js'

/**
 * Imports a canonically sent private completion into its ordinary direct
 * conversation. The outbox intent is the recovery journal: `prepared` records
 * the pre-import turn count before either coupled session/transcript write,
 * while transcript provenance makes the append replay-safe.
 */
export async function reconcileAssistantPrivateCompletionContinuityForSession(
  input: {
    allowUnbound: boolean
    sessionId: string
    vault: string
  },
): Promise<AssistantSession> {
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    let session = await readAssistantSession({
      paths,
      sessionId: input.sessionId,
    })
    if (!session) {
      throw new Error('Assistant private completion continuity session was not found.')
    }

    const intents = await listAssistantOutboxIntentsLocal(input.vault)
    const initialSession = session
    const boundIntents: AssistantOutboxIntent[] = []
    for (const intent of intents) {
      if (!assistantPrivateCompletionCanBindToSession({
        allowUnbound: input.allowUnbound,
        intent,
        session: initialSession,
      })) {
        boundIntents.push(intent)
        continue
      }
      boundIntents.push(await writeAssistantPrivateCompletionIntent({
        intent: {
          ...intent,
          privateCompletionContinuitySessionId: initialSession.sessionId,
          updatedAt: new Date().toISOString(),
        },
        paths,
      }))
    }
    const candidates = boundIntents
      .flatMap((intent) => {
        if (
          !assistantPrivateCompletionCanJoinSession({
            allowUnbound: input.allowUnbound,
            intent,
            session: initialSession,
          })
          || intent.privateCompletionContinuity?.status === 'applied'
        ) {
          return []
        }
        return [{
          intent,
          transcriptCreatedAt:
            resolveAssistantPrivateCompletionTranscriptCreatedAt(intent),
        }]
      })
      .sort((left, right) =>
        left.transcriptCreatedAt.localeCompare(right.transcriptCreatedAt)
        || left.intent.createdAt.localeCompare(right.intent.createdAt)
        || left.intent.intentId.localeCompare(right.intent.intentId)
      )
    for (const { intent } of candidates) {
      session = await reconcileAssistantPrivateCompletionIntent({
        intent,
        paths,
        session,
      })
    }
    return session
  })
}

function assistantPrivateCompletionCanBindToSession(input: {
  allowUnbound: boolean
  intent: AssistantOutboxIntent
  session: AssistantSession
}): boolean {
  return input.allowUnbound
    && input.intent.privateCompletionContinuitySessionId === null
    && input.intent.privateCompletionContinuity === undefined
    && (
      input.intent.status === 'pending'
      || input.intent.status === 'sending'
      || input.intent.status === 'retryable'
    )
    && isCurrentPrivateAssistantAskCompletion(input.intent)
    && assistantPrivateCompletionRouteMatchesSession(input.intent, input.session)
}

/**
 * Runs from the hosted delivery's post-sent runtime step. If exactly one
 * pre-existing ordinary direct session matches the authenticated delivery
 * route, join immediately. Otherwise the next direct session resolution owns
 * the same replay-safe reconciliation before provider resume selection.
 */
export async function persistAssistantPrivateCompletionContinuityAfterDelivery(
  input: {
    intent: AssistantOutboxIntent
    vault: string
  },
): Promise<void> {
  if (!isDeliveredPrivateAssistantAskCompletion(input.intent)) {
    return
  }

  await withAssistantTurnLock({
    vault: input.vault,
    run: async () => {
      const sessionId = normalizeNullableString(
        input.intent.privateCompletionContinuitySessionId,
      )
      if (!sessionId) {
        return
      }
      await reconcileAssistantPrivateCompletionContinuityForSession({
        allowUnbound: false,
        sessionId,
        vault: input.vault,
      })
    },
  })
}

async function reconcileAssistantPrivateCompletionIntent(input: {
  intent: AssistantOutboxIntent
  paths: Parameters<typeof writeAssistantSession>[0]
  session: AssistantSession
}): Promise<AssistantSession> {
  const now = new Date().toISOString()
  const continuity = input.intent.privateCompletionContinuity?.status === 'prepared'
    ? input.intent.privateCompletionContinuity
    : {
        baseTurnCount: input.session.turnCount,
        preparedAt: now,
        sessionId: input.session.sessionId,
        status: 'prepared' as const,
        transcriptCreatedAt: input.intent.delivery!.sentAt,
      }
  if (continuity.sessionId !== input.session.sessionId) {
    return input.session
  }

  let journalIntent = input.intent
  if (input.intent.privateCompletionContinuity?.status !== 'prepared') {
    journalIntent = await writeAssistantPrivateCompletionIntent({
      intent: {
        ...input.intent,
        privateCompletionContinuity: continuity,
        updatedAt: now,
      },
      paths: input.paths,
    })
  }

  const updatedAt = laterIsoTimestamp(input.session.updatedAt, now)
  const lastTurnAt = laterNullableIsoTimestamp(
    input.session.lastTurnAt,
    continuity.transcriptCreatedAt,
  )
  const session = {
    ...input.session,
    codexResume: null,
    resumeState: null,
    lastTurnAt,
    turnCount: Math.max(
      input.session.turnCount,
      continuity.baseTurnCount + 1,
    ),
    updatedAt,
  }
  await writeAssistantSession(input.paths, session)
  await synchronizeAssistantIndexes(input.paths, session, input.session)

  const transcript = await readAssistantTranscriptEntries(
    input.paths,
    session.sessionId,
  )
  if (!transcript.some((entry) =>
    entry.sourceOutboxIntentId === journalIntent.intentId
  )) {
    await appendTranscriptEntries(
      input.paths,
      session.sessionId,
      [
        assistantTranscriptEntrySchema.parse({
          schema: 'murph.assistant-transcript-entry.v1',
          createdAt: continuity.transcriptCreatedAt,
          kind: 'assistant',
          sourceOutboxIntentId: journalIntent.intentId,
          text: journalIntent.message,
        }),
      ],
    )
  }

  await writeAssistantPrivateCompletionIntent({
    intent: {
      ...journalIntent,
      privateCompletionContinuity: {
        ...continuity,
        appliedAt: now,
        status: 'applied',
      },
      updatedAt: now,
    },
    paths: input.paths,
  })
  return session
}

async function writeAssistantPrivateCompletionIntent(input: {
  intent: AssistantOutboxIntent
  paths: Parameters<typeof writeAssistantSession>[0]
}): Promise<AssistantOutboxIntent> {
  const parsed = assistantOutboxIntentSchema.parse(
    sanitizeAssistantOutboxIntentForPersistence(input.intent),
  )
  const intentPath = resolveAssistantOutboxIntentPath(
    input.paths.outboxDirectory,
    parsed.intentId,
  )
  const previous = await readAssistantOutboxIntentAtPath(intentPath, {
    vault: input.paths.absoluteVaultRoot,
  })
  return persistAssistantOutboxIntentAtPaths({
    intent: parsed,
    paths: input.paths,
    previous,
  })
}

function assistantPrivateCompletionCanJoinSession(input: {
  allowUnbound: boolean
  intent: AssistantOutboxIntent
  session: AssistantSession
}): boolean {
  // Omission identifies an intent written before continuity ownership existed.
  // Only current writers can distinguish an exact binding from intentionally
  // unbound work, so legacy records must not infer an owner from route shape.
  if (input.intent.privateCompletionContinuitySessionId === undefined) {
    return false
  }
  const continuity = input.intent.privateCompletionContinuity
  if (
    continuity?.status === 'prepared'
    && continuity.sessionId !== input.session.sessionId
  ) {
    return false
  }
  const boundSessionId = normalizeNullableString(
    input.intent.privateCompletionContinuitySessionId,
  )
  if (
    !boundSessionId
    && continuity?.status !== 'prepared'
    && !input.allowUnbound
  ) {
    return false
  }
  if (boundSessionId && boundSessionId !== input.session.sessionId) {
    return false
  }
  return isDeliveredPrivateAssistantAskCompletion(input.intent)
    && assistantPrivateCompletionRouteMatchesSession(input.intent, input.session)
}

function isDeliveredPrivateAssistantAskCompletion(
  intent: AssistantOutboxIntent,
): boolean {
  if (!isCurrentPrivateAssistantAskCompletion(intent)) {
    return false
  }
  const completionId = intent.answeredMailboxItemIds.length === 1
    ? normalizeNullableString(intent.answeredMailboxItemIds[0])
    : null
  const deliveryKey = completionId
    ? createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(completionId)
    : null
  const delivery = intent.delivery
  const bindingDelivery = intent.bindingDelivery
  if (!bindingDelivery) {
    return false
  }
  return (
    intent.status === 'sent'
    && delivery !== null
    && delivery.kind !== 'message-reaction'
    && delivery.idempotencyKey === deliveryKey
    && delivery.channel === intent.channel
    && delivery.messageLength === intent.message.length
    && delivery.target === bindingDelivery.target
    && delivery.targetKind === bindingDelivery.kind
  )
}

function isCurrentPrivateAssistantAskCompletion(
  intent: AssistantOutboxIntent,
): boolean {
  const completionId = intent.answeredMailboxItemIds.length === 1
    ? normalizeNullableString(intent.answeredMailboxItemIds[0])
    : null
  const deliveryKey = completionId
    ? createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(completionId)
    : null
  const expiresAt = normalizeNullableString(
    intent.reviewedAssistantAskCompletionExpiresAt,
  )
  return (
    completionId !== null
    && intent.answeredMailboxItemIds[0] === completionId
    && [...completionId].length <= 256
    && deliveryKey !== null
    && expiresAt !== null
    && Number.isFinite(Date.parse(expiresAt))
    && intent.deliveryIdempotencyKey === deliveryKey
    && (intent.channel === 'linq' || intent.channel === 'telegram')
    && intent.threadIsDirect === true
    && intent.bindingDelivery !== null
    && intent.explicitTarget === null
    && intent.operation === null
    && intent.media.length === 0
    && intent.card === null
    && intent.emailHtml == null
    && intent.subject === null
    && intent.externalThreadRouteAuthority == null
    && intent.automationAuthority == null
  )
}

function assistantPrivateCompletionRouteMatchesSession(
  intent: AssistantOutboxIntent,
  session: AssistantSession,
): boolean {
  const delivery = intent.bindingDelivery
  const bindingDelivery = session.binding.delivery
  return Boolean(
    delivery
    && bindingDelivery
    && session.binding.threadIsDirect === true
    && session.binding.actorId === intent.actorId
    && session.binding.channel === intent.channel
    && session.binding.identityId === intent.identityId
    && session.binding.threadId === intent.threadId
    && bindingDelivery.kind === delivery.kind
    && bindingDelivery.target === delivery.target,
  )
}

function laterNullableIsoTimestamp(
  left: string | null,
  right: string,
): string {
  return left ? laterIsoTimestamp(left, right) : right
}

function resolveAssistantPrivateCompletionTranscriptCreatedAt(
  intent: AssistantOutboxIntent,
): string {
  if (intent.privateCompletionContinuity?.status === 'prepared') {
    return intent.privateCompletionContinuity.transcriptCreatedAt
  }
  if (!intent.delivery) {
    throw new Error(
      'Assistant private completion continuity requires a canonical delivery.',
    )
  }
  return intent.delivery.sentAt
}

function laterIsoTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right
}
