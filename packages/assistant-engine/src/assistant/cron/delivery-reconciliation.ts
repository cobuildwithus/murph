import {
  archiveAutomationIfExactRevision,
  setScheduledLogStatus,
} from '@murphai/core'
import {
  assistantCronJobSchema,
  type AssistantCronJob,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { parseHostedEmailThreadTarget } from '@murphai/runtime-state'
import type { AssistantStatePaths } from '../store/paths.js'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from '../automation-tags.js'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { withAssistantCronWriteLock } from './locking.js'
import {
  readAssistantCronCanonicalRuntimeStore,
  writeAssistantCronCanonicalRuntimeStore,
  removeAssistantCronCanonicalRuntimeRecord,
  upsertAssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeState,
} from './runtime-state.js'
import {
  readAssistantCronStore,
  writeAssistantCronStore,
} from './store.js'
import {
  listCanonicalAssistantCronRecords,
  resolveCanonicalAssistantCronOccurrenceAt,
  resolveCanonicalAssistantCronJobId,
  type CanonicalAssistantCronJobRecord,
} from './canonical-jobs.js'
import {
  resolveAssistantCronFailureBackoffMs,
  resolveAssistantCronNextRunAfterSuccess,
} from './finalization.js'
import {
  readAssistantOutboxIntent,
  snapshotAssistantOutboxIntentsLocal,
} from '../outbox/store.js'
import { assistantDeliveryErrorPreventsFreshIntentRetry } from '../outbox/retry-policy.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import { commitAssistantGroupChallengeSentDelivery } from './group-challenge-delivery-commit.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  classifyNewsletterRecipientFamily,
  isGroupNewsletterOutboxIntent,
} from '../newsletter-family.js'

const ASSISTANT_CRON_MISSING_PENDING_DELIVERY_STALE_AFTER_MS = 24 * 60 * 60 * 1000
const ASSISTANT_CRON_NEWSLETTER_PARTIAL_FAILURE =
  'ASSISTANT_CRON_NEWSLETTER_PARTIAL_FAILURE'
const ASSISTANT_CRON_NEWSLETTER_RECIPIENT_RETRYABLE =
  'ASSISTANT_CRON_NEWSLETTER_RECIPIENT_RETRYABLE'

export interface AssistantCronDeliveryReconciliationResult {
  reconciled: number
}

export interface AssistantCronPendingDeliveryRepairResult {
  checked: number
  reconciled: number
}

type TerminalAssistantCronDeliveryOutcome =
  | {
      at: string
      failureCode: string | null
      failureStatus: 'abandoned' | 'failed' | 'missing'
      kind: 'failed'
      message: string
    }
  | {
      at: string
      kind: 'sent'
    }

export async function reconcileAssistantCronDeliveryIntent(input: {
  intent: AssistantOutboxIntent
  paths?: AssistantStatePaths
  vault: string
}): Promise<AssistantCronDeliveryReconciliationResult> {
  const resolved = await resolveAssistantCronDeliveryReconciliation(input)
  if (!resolved) {
    return { reconciled: 0 }
  }

  return reconcileAssistantCronTerminalDelivery({
    intent: resolved.intent,
    intentId: resolved.intentId,
    paths: input.paths,
    terminal: resolved.terminal,
    vault: input.vault,
  })
}

async function resolveAssistantCronDeliveryReconciliation(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<{
  intent: AssistantOutboxIntent
  intentId: string
  terminal: TerminalAssistantCronDeliveryOutcome
} | null> {
  if (isGroupNewsletterOutboxIntent(input.intent)) {
    return resolveAssistantCronNewsletterDeliveryReconciliation(input)
  }

  const terminal = resolveTerminalAssistantCronDeliveryOutcome(input.intent)
  return terminal
      ? {
        intent: input.intent,
        intentId: input.intent.intentId,
        terminal,
      }
    : null
}

async function resolveAssistantCronNewsletterDeliveryReconciliation(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<{
  intent: AssistantOutboxIntent
  intentId: string
  terminal: TerminalAssistantCronDeliveryOutcome
} | null> {
  const deliveryIdempotencyKey = input.intent.deliveryIdempotencyKey
  if (!deliveryIdempotencyKey) {
    return null
  }

  const family = (await snapshotAssistantOutboxIntentsLocal(input.vault)).filter(
    (intent) =>
      intent.deliveryIdempotencyKey === deliveryIdempotencyKey &&
      intent.turnId === input.intent.turnId &&
      isGroupNewsletterOutboxIntent(intent),
  )
  const parents = family.filter((intent) =>
    parseHostedEmailThreadTarget(intent.explicitTarget)?.recipientMemberId === null,
  )
  if (parents.length !== 1) {
    return null
  }

  const parent = parents[0]
  if (!parent) {
    return null
  }
  if (isActiveAssistantCronOutboxIntent(parent)) {
    return null
  }
  if (parent.status === 'failed' || parent.status === 'abandoned') {
    const terminal = resolveTerminalAssistantCronDeliveryOutcome(parent)
    return terminal
      ? {
          intent: parent,
          intentId: parent.intentId,
          terminal,
        }
      : null
  }
  if (parent.status !== 'sent') {
    return null
  }

  const recipientFamily = classifyNewsletterRecipientFamily(family)
  if (recipientFamily.some((recipient) => recipient.state === 'active')) {
    return null
  }

  const recipientIntents = recipientFamily.flatMap((recipient) => recipient.intents)
  const terminalAt = resolveLatestAssistantCronOutboxTimestamp(
    recipientIntents,
    parent.sentAt ?? parent.updatedAt,
  )
  if (
    recipientFamily.length > 0 &&
    recipientFamily.every((recipient) => recipient.state === 'sent')
  ) {
    return {
      intent: parent,
      intentId: parent.intentId,
      terminal: {
        at: terminalAt,
        kind: 'sent',
      },
    }
  }

  if (
    !recipientFamily.some((recipient) => recipient.state === 'non_replayable') &&
    recipientFamily.some((recipient) => recipient.state === 'safely_replayable')
  ) {
    return {
      intent: parent,
      intentId: parent.intentId,
      terminal: {
        at: terminalAt,
        failureCode: ASSISTANT_CRON_NEWSLETTER_RECIPIENT_RETRYABLE,
        failureStatus: 'failed',
        kind: 'failed',
        message: 'One or more group newsletter recipients can be retried safely.',
      },
    }
  }

  return {
    intent: parent,
    intentId: parent.intentId,
    terminal: {
      at: terminalAt,
      failureCode: ASSISTANT_CRON_NEWSLETTER_PARTIAL_FAILURE,
      failureStatus: 'failed',
      kind: 'failed',
      message: 'One or more group newsletter deliveries did not complete.',
    },
  }
}

function isActiveAssistantCronOutboxIntent(intent: AssistantOutboxIntent): boolean {
  return (
    intent.status === 'awaiting_approval' ||
    intent.status === 'pending' ||
    intent.status === 'retryable' ||
    intent.status === 'sending'
  )
}

function resolveLatestAssistantCronOutboxTimestamp(
  intents: readonly AssistantOutboxIntent[],
  fallback: string,
): string {
  let latest = fallback
  let latestMs = Date.parse(fallback)
  for (const intent of intents) {
    const timestamp = intent.sentAt ?? intent.updatedAt
    const timestampMs = Date.parse(timestamp)
    if (Number.isFinite(timestampMs) && (!Number.isFinite(latestMs) || timestampMs > latestMs)) {
      latest = timestamp
      latestMs = timestampMs
    }
  }
  return latest
}

async function reconcileAssistantCronTerminalDelivery(input: {
  intent: AssistantOutboxIntent | null
  intentId: string
  paths?: AssistantStatePaths
  terminal: TerminalAssistantCronDeliveryOutcome
  vault: string
}): Promise<AssistantCronDeliveryReconciliationResult> {
  const paths = input.paths ?? resolveAssistantStatePaths(input.vault)

  return withAssistantCronWriteLock(paths, async () => {
    const [localStore, runtimeStore] = await Promise.all([
      readAssistantCronStore(paths),
      readAssistantCronCanonicalRuntimeStore(paths),
    ])
    const hasCanonicalPendingDelivery = runtimeStore.jobs.some(
      (runtimeState) => runtimeState.state.pendingDeliveryIntentId === input.intentId,
    )
    const canonicalRecords = hasCanonicalPendingDelivery
      ? await listCanonicalAssistantCronRecords(input.vault, ['active', 'paused'])
      : []
    let reconciled = 0
    let localChanged = false

    for (let index = localStore.jobs.length - 1; index >= 0; index -= 1) {
      const job = localStore.jobs[index] as AssistantCronJob
      if (job.state.pendingDeliveryIntentId !== input.intentId) {
        continue
      }

      reconciled += 1
      localChanged = true
      if (
        assistantCronTerminalDeliveryConsumesOccurrence(input.terminal, null) &&
        shouldRemoveAssistantCronJobAfterDelivery(job)
      ) {
        localStore.jobs.splice(index, 1)
        continue
      }

      localStore.jobs[index] = reconcileLocalAssistantCronJobAfterDelivery({
        job,
        terminal: input.terminal,
      })
    }

    if (localChanged) {
      await writeAssistantCronStore(paths, localStore)
    }

    let canonicalChanged = false
    for (const runtimeState of [...runtimeStore.jobs]) {
      if (runtimeState.state.pendingDeliveryIntentId !== input.intentId) {
        continue
      }

      const source = canonicalRecords.find(
        (record) => resolveCanonicalAssistantCronJobId(record) === runtimeState.jobId,
      ) ?? null
      if (
        input.terminal.kind === 'sent' &&
        input.intent?.groupChallengeDispatch
      ) {
        if (
          input.intent.automationAuthority?.automationId !== runtimeState.jobId
        ) {
          throw new VaultCliError(
            'scheduled_challenge_delivery_commit_invalid',
            'The terminal group-challenge delivery does not match its pending automation.',
          )
        }
        const challengeCommit = await commitAssistantGroupChallengeSentDelivery({
          expectedAutomationId: runtimeState.jobId,
          intent: input.intent,
          pendingOccurrenceAt:
            runtimeState.state.pendingOccurrenceAt ?? '',
          vault: input.vault,
        })
        if (challengeCommit.closeoutApplied) {
          reconciled += 1
          canonicalChanged = true
          removeAssistantCronCanonicalRuntimeRecord(runtimeStore, runtimeState.jobId)
          continue
        }
      }
      reconciled += 1
      canonicalChanged = true
      const deliveryConsumesOccurrence =
        assistantCronTerminalDeliveryConsumesOccurrence(input.terminal, source)

      if (
        source &&
        deliveryConsumesOccurrence &&
        shouldRemoveCanonicalAssistantCronSourceAfterDelivery({
          runtimeState,
          source,
        })
      ) {
        const archived = await archiveCanonicalAssistantCronSourceAfterDelivery({
          source,
          vault: input.vault,
        })
        if (archived) {
          removeAssistantCronCanonicalRuntimeRecord(runtimeStore, runtimeState.jobId)
        }
        // A concurrent source edit invalidates this exact-revision archive.
        // Keep the pending runtime record for the repair path to reconcile
        // against the current canonical source instead of consuming stale state.
        continue
      }

      upsertAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        reconcileCanonicalAssistantCronRuntimeAfterDelivery({
          runtimeState,
          source,
          terminal: input.terminal,
          deliveryConsumesOccurrence,
        }),
      )
    }

    if (canonicalChanged) {
      await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)
    }

    return { reconciled }
  })
}

export async function repairPendingAssistantCronDeliveries(input: {
  missingIntentStaleAfterMs?: number
  now?: Date
  paths?: AssistantStatePaths
  vault: string
}): Promise<AssistantCronPendingDeliveryRepairResult> {
  const paths = input.paths ?? resolveAssistantStatePaths(input.vault)
  const [localStore, runtimeStore] = await Promise.all([
    readAssistantCronStore(paths),
    readAssistantCronCanonicalRuntimeStore(paths),
  ])
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const missingIntentStaleAfterMs =
    input.missingIntentStaleAfterMs ?? ASSISTANT_CRON_MISSING_PENDING_DELIVERY_STALE_AFTER_MS
  const pendingIntentIds = new Map<string, number>()
  for (const job of localStore.jobs) {
    if (job.state.pendingDeliveryIntentId) {
      recordPendingAssistantCronDeliveryIntent({
        observedAtMs: resolveAssistantCronPendingDeliveryObservedAtMs(
          job.state.lastRunAt ?? job.updatedAt,
          nowMs,
        ),
        pendingIntentIds,
        pendingIntentId: job.state.pendingDeliveryIntentId,
      })
    }
  }
  for (const runtimeState of runtimeStore.jobs) {
    if (runtimeState.state.pendingDeliveryIntentId) {
      recordPendingAssistantCronDeliveryIntent({
        observedAtMs: resolveAssistantCronPendingDeliveryObservedAtMs(
          runtimeState.state.lastRunAt ?? runtimeState.updatedAt,
          nowMs,
        ),
        pendingIntentIds,
        pendingIntentId: runtimeState.state.pendingDeliveryIntentId,
      })
    }
  }

  let reconciled = 0
  for (const [intentId, observedAtMs] of pendingIntentIds) {
    const intent = await readAssistantOutboxIntent(input.vault, intentId)
    if (!intent) {
      if (!isAssistantCronMissingPendingDeliveryStale({
        missingIntentStaleAfterMs,
        nowMs,
        observedAtMs,
      })) {
        continue
      }

      const result = await reconcileAssistantCronTerminalDelivery({
        intent: null,
        intentId,
        paths,
        terminal: {
          at: now.toISOString(),
          failureCode: 'ASSISTANT_CRON_PENDING_DELIVERY_INTENT_MISSING',
          failureStatus: 'missing',
          kind: 'failed',
          message:
            'Assistant cron pending delivery outbox intent is no longer available.',
        },
        vault: input.vault,
      })
      reconciled += result.reconciled
      if (result.reconciled > 0) {
        await recordMissingAssistantCronPendingDeliveryDiagnostic({
          at: now.toISOString(),
          intentId,
          vault: input.vault,
        })
      }
      continue
    }

    const result = await reconcileAssistantCronDeliveryIntent({
      intent,
      paths,
      vault: input.vault,
    })
    reconciled += result.reconciled
  }

  return {
    checked: pendingIntentIds.size,
    reconciled,
  }
}

function recordPendingAssistantCronDeliveryIntent(input: {
  observedAtMs: number
  pendingIntentId: string
  pendingIntentIds: Map<string, number>
}): void {
  const existing = input.pendingIntentIds.get(input.pendingIntentId)
  if (existing === undefined || input.observedAtMs < existing) {
    input.pendingIntentIds.set(input.pendingIntentId, input.observedAtMs)
  }
}

function resolveAssistantCronPendingDeliveryObservedAtMs(
  timestamp: string | null | undefined,
  fallbackMs: number,
): number {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallbackMs
}

function isAssistantCronMissingPendingDeliveryStale(input: {
  missingIntentStaleAfterMs: number
  nowMs: number
  observedAtMs: number
}): boolean {
  const staleAfterMs = Math.max(0, Math.trunc(input.missingIntentStaleAfterMs))
  return input.nowMs - input.observedAtMs >= staleAfterMs
}

async function recordMissingAssistantCronPendingDeliveryDiagnostic(input: {
  at: string
  intentId: string
  vault: string
}): Promise<void> {
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'automation',
    kind: 'cron.delivery-pending-outbox-missing',
    level: 'warn',
    code: 'ASSISTANT_CRON_PENDING_DELIVERY_INTENT_MISSING',
    message:
      'Assistant cron pending delivery outbox intent was unavailable long enough to fail the occurrence.',
    intentId: input.intentId,
    at: input.at,
  }).catch(() => undefined)
}

function reconcileLocalAssistantCronJobAfterDelivery(input: {
  job: AssistantCronJob
  terminal: TerminalAssistantCronDeliveryOutcome
}): AssistantCronJob {
  const stateWithoutPending = omitPendingDeliveryIntentId(input.job.state)

  if (input.terminal.kind === 'sent') {
    return assistantCronJobSchema.parse({
      ...input.job,
      enabled:
        input.job.schedule.kind === 'at' && input.job.keepAfterRun
          ? false
          : input.job.enabled,
      updatedAt: input.terminal.at,
      state: {
        ...stateWithoutPending,
        nextRunAt: resolveAssistantCronNextRunAfterSuccess(
          input.job,
          new Date(input.terminal.at),
        ),
        lastSucceededAt: input.terminal.at,
        lastError: null,
        consecutiveFailures: 0,
      },
    })
  }

  return assistantCronJobSchema.parse({
    ...input.job,
    enabled:
      input.job.schedule.kind === 'at' && input.job.keepAfterRun
        ? false
        : input.job.enabled,
    updatedAt: input.terminal.at,
    state: {
      ...stateWithoutPending,
      nextRunAt: resolveAssistantCronNextRunAfterSuccess(
        input.job,
        new Date(input.terminal.at),
      ),
      lastFailedAt: input.terminal.at,
      lastError: input.terminal.message,
      consecutiveFailures: 0,
    },
  })
}

function reconcileCanonicalAssistantCronRuntimeAfterDelivery(input: {
  deliveryConsumesOccurrence: boolean
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAssistantCronJobRecord | null
  terminal: TerminalAssistantCronDeliveryOutcome
}): AssistantCronCanonicalRuntimeRecord {
  const runningClearedState: AssistantCronCanonicalRuntimeState =
    omitPendingDeliveryIntentId({
      ...input.runtimeState.state,
      lastRunAt: input.terminal.at,
      runningAt: null,
      runningClaimId: null,
      runningPid: null,
    })

  if (input.terminal.kind === 'sent') {
    return {
      ...input.runtimeState,
      updatedAt: input.terminal.at,
      state: {
        ...runningClearedState,
        pendingOccurrenceAt: null,
        retryAfterAt: null,
        scheduledMediaReservation: null,
        lastSucceededAt: input.terminal.at,
        lastError: null,
        consecutiveFailures: 0,
      },
    }
  }

  if (!input.deliveryConsumesOccurrence) {
    const failureCount = input.runtimeState.state.consecutiveFailures + 1
    const retryAfterAt = input.source?.status === 'active'
      ? new Date(
          Date.parse(input.terminal.at) +
            resolveAssistantCronFailureBackoffMs(failureCount),
        ).toISOString()
      : null
    return {
      ...input.runtimeState,
      updatedAt: input.terminal.at,
      state: {
        ...runningClearedState,
        pendingOccurrenceAt:
          input.runtimeState.state.pendingOccurrenceAt ??
          (input.source
            ? resolveCanonicalAssistantCronOccurrenceAt(
                input.source,
                input.runtimeState,
              )
            : null),
        retryAfterAt,
        lastFailedAt: input.terminal.at,
        lastError: input.terminal.message,
        consecutiveFailures: failureCount,
      },
    }
  }

  return {
    ...input.runtimeState,
    updatedAt: input.terminal.at,
    state: {
      ...runningClearedState,
      pendingOccurrenceAt: null,
      retryAfterAt: null,
      scheduledMediaReservation: null,
      lastFailedAt: input.terminal.at,
      lastError: input.terminal.message,
      consecutiveFailures: 0,
    },
  }
}

function assistantCronTerminalDeliveryConsumesOccurrence(
  terminal: TerminalAssistantCronDeliveryOutcome,
  source: CanonicalAssistantCronJobRecord | null,
): boolean {
  if (terminal.kind === 'sent') {
    return true
  }

  if (terminal.failureCode === ASSISTANT_CRON_NEWSLETTER_PARTIAL_FAILURE) {
    return true
  }

  if (terminal.failureCode === ASSISTANT_CRON_NEWSLETTER_RECIPIENT_RETRYABLE) {
    return !(
      source?.kind === 'automation' && source.status === 'active'
    )
  }

  if (
    terminal.failureStatus !== 'failed' ||
    assistantDeliveryErrorPreventsFreshIntentRetry({
      code: terminal.failureCode,
      message: terminal.message,
    })
  ) {
    return true
  }

  return !(
    source?.kind === 'automation' &&
    source.status === 'active' &&
    source.tags.includes(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG) &&
    source.activeUntil !== null &&
    Number.isFinite(Date.parse(source.activeUntil)) &&
    Date.parse(terminal.at) < Date.parse(source.activeUntil)
  )
}

function resolveTerminalAssistantCronDeliveryOutcome(
  intent: AssistantOutboxIntent,
): TerminalAssistantCronDeliveryOutcome | null {
  if (intent.status === 'sent' && intent.sentAt) {
    return {
      at: intent.sentAt,
      kind: 'sent',
    }
  }

  if (intent.status === 'failed' || intent.status === 'abandoned') {
    return {
      at: intent.updatedAt,
      failureCode: intent.lastError?.code ?? null,
      failureStatus: intent.status,
      kind: 'failed',
      message:
        intent.lastError?.message ??
        (intent.status === 'abandoned'
          ? 'Outbound assistant delivery ended ambiguously.'
          : 'Outbound assistant delivery failed.'),
    }
  }

  return null
}

function shouldRemoveAssistantCronJobAfterDelivery(job: AssistantCronJob): boolean {
  return job.schedule.kind === 'at' && !job.keepAfterRun
}

function shouldRemoveCanonicalAssistantCronSourceAfterDelivery(input: {
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAssistantCronJobRecord
}): boolean {
  if (input.source.schedule.kind !== 'at') {
    return false
  }
  if (canonicalAssistantCronSourceChangedAfterRuntimeState(input)) {
    return false
  }

  const pendingOccurrenceAt = input.runtimeState.state.pendingOccurrenceAt
  return (
    pendingOccurrenceAt !== null &&
    pendingOccurrenceAt ===
      resolveCanonicalAssistantCronOccurrenceAt(input.source, input.runtimeState)
  )
}

function canonicalAssistantCronSourceChangedAfterRuntimeState(input: {
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAssistantCronJobRecord
}): boolean {
  const sourceUpdatedMs = Date.parse(input.source.updatedAt)
  const runtimeUpdatedMs = Date.parse(input.runtimeState.updatedAt)
  return (
    Number.isFinite(sourceUpdatedMs) &&
    Number.isFinite(runtimeUpdatedMs) &&
    sourceUpdatedMs > runtimeUpdatedMs
  )
}

async function archiveCanonicalAssistantCronSourceAfterDelivery(input: {
  source: CanonicalAssistantCronJobRecord
  vault: string
}): Promise<boolean> {
  if (input.source.kind === 'automation') {
    const result = await archiveAutomationIfExactRevision({
      expectedUpdatedAt: input.source.updatedAt,
      lookup: input.source.automationId,
      vaultRoot: input.vault,
    })
    return result.archived
  }

  await setScheduledLogStatus({
    vaultRoot: input.vault,
    scheduledLogId: input.source.scheduledLogId,
    status: 'archived',
  })
  return true
}

function omitPendingDeliveryIntentId<T extends { pendingDeliveryIntentId?: string | null }>(
  state: T,
): Omit<T, 'pendingDeliveryIntentId'> {
  const { pendingDeliveryIntentId: _pendingDeliveryIntentId, ...rest } = state
  return rest
}
