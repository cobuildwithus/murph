import { setScheduledLogStatus, upsertAutomation } from '@murphai/core'
import {
  assistantCronJobSchema,
  type AssistantCronJob,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantStatePaths } from '../store/paths.js'
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
  buildCanonicalAutomationUpsertInput,
  isCanonicalAssistantCronSourceEnabled,
  listCanonicalAssistantCronRecords,
  resolveCanonicalAssistantCronOccurrenceAt,
  resolveCanonicalAssistantCronJobId,
  type CanonicalAssistantCronJobRecord,
} from './canonical-jobs.js'
import {
  resolveAssistantCronFailureBackoffMs,
  resolveAssistantCronNextRunAfterSuccess,
} from './finalization.js'
import { readAssistantOutboxIntent } from '../outbox/store.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'

const ASSISTANT_CRON_MISSING_PENDING_DELIVERY_STALE_AFTER_MS = 24 * 60 * 60 * 1000

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
  const terminal = resolveTerminalAssistantCronDeliveryOutcome(input.intent)
  if (!terminal) {
    return { reconciled: 0 }
  }

  return reconcileAssistantCronTerminalDelivery({
    intentId: input.intent.intentId,
    paths: input.paths,
    terminal,
    vault: input.vault,
  })
}

async function reconcileAssistantCronTerminalDelivery(input: {
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
        input.terminal.kind === 'sent' &&
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
      reconciled += 1
      canonicalChanged = true

      if (
        source &&
        input.terminal.kind === 'sent' &&
        shouldRemoveCanonicalAssistantCronSourceAfterDelivery(source)
      ) {
        await archiveCanonicalAssistantCronSourceAfterDelivery({
          source,
          vault: input.vault,
        })
        removeAssistantCronCanonicalRuntimeRecord(runtimeStore, runtimeState.jobId)
        continue
      }

      upsertAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        reconcileCanonicalAssistantCronRuntimeAfterDelivery({
          runtimeState,
          source,
          terminal: input.terminal,
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
        intentId,
        paths,
        terminal: {
          at: now.toISOString(),
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

    if (!resolveTerminalAssistantCronDeliveryOutcome(intent)) {
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

  const failureCount = input.job.state.consecutiveFailures + 1
  const nextRunAt = input.job.enabled
    ? new Date(
        Date.parse(input.terminal.at) + resolveAssistantCronFailureBackoffMs(failureCount),
      ).toISOString()
    : stateWithoutPending.nextRunAt

  return assistantCronJobSchema.parse({
    ...input.job,
    updatedAt: input.terminal.at,
    state: {
      ...stateWithoutPending,
      nextRunAt,
      lastFailedAt: input.terminal.at,
      lastError: input.terminal.message,
      consecutiveFailures: failureCount,
    },
  })
}

function reconcileCanonicalAssistantCronRuntimeAfterDelivery(input: {
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAssistantCronJobRecord | null
  terminal: TerminalAssistantCronDeliveryOutcome
}): AssistantCronCanonicalRuntimeRecord {
  const runningClearedState: AssistantCronCanonicalRuntimeState =
    omitPendingDeliveryIntentId({
      ...input.runtimeState.state,
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
        lastSucceededAt: input.terminal.at,
        lastError: null,
        consecutiveFailures: 0,
      },
    }
  }

  const pendingOccurrenceAt = input.source
    ? resolveCanonicalAssistantCronOccurrenceAt(input.source, {
        ...input.runtimeState,
        state: runningClearedState,
      })
    : runningClearedState.pendingOccurrenceAt
  const isRetryingFailedOccurrence =
    pendingOccurrenceAt !== null &&
    pendingOccurrenceAt === runningClearedState.pendingOccurrenceAt
  const failureCount = input.runtimeState.state.consecutiveFailures + 1
  const retryAfterAt =
    isRetryingFailedOccurrence &&
    input.source &&
    isCanonicalAssistantCronSourceEnabled(input.source)
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
      pendingOccurrenceAt,
      retryAfterAt,
      lastFailedAt: input.terminal.at,
      lastError: input.terminal.message,
      consecutiveFailures: failureCount,
    },
  }
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

function shouldRemoveCanonicalAssistantCronSourceAfterDelivery(
  source: CanonicalAssistantCronJobRecord,
): boolean {
  return source.schedule.kind === 'at'
}

async function archiveCanonicalAssistantCronSourceAfterDelivery(input: {
  source: CanonicalAssistantCronJobRecord
  vault: string
}): Promise<void> {
  if (input.source.kind === 'automation') {
    await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault: input.vault,
        automationId: input.source.automationId,
        automation: input.source,
        title: input.source.title,
        status: 'archived',
        schedule: input.source.schedule,
        route: input.source.route,
        instructions: input.source.instructions,
      }),
    )
    return
  }

  await setScheduledLogStatus({
    vaultRoot: input.vault,
    scheduledLogId: input.source.scheduledLogId,
    status: 'archived',
  })
}

function omitPendingDeliveryIntentId<T extends { pendingDeliveryIntentId?: string | null }>(
  state: T,
): Omit<T, 'pendingDeliveryIntentId'> {
  const { pendingDeliveryIntentId: _pendingDeliveryIntentId, ...rest } = state
  return rest
}
