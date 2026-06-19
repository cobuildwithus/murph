import { randomUUID } from 'node:crypto'
import { setScheduledLogStatus, upsertAutomation } from '@murphai/core'
import {
  assistantCronJobSchema,
  assistantCronRunRecordSchema,
  type AssistantCronJob,
  type AssistantCronRunRecord,
  type AssistantCronTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { sendAssistantNotificationLocal } from '../../assistant-service.js'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from '../automation-tags.js'
import { buildAssistantAutomationTurnEnvelope } from '../automation/turn-envelope.js'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderServiceTier } from '../providers/types.js'
import type { AssistantTurnEnvironment } from '../service-contracts.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import { errorMessage, normalizeNullableString } from '../shared.js'
import type { AssistantStatePaths } from '../store/paths.js'
import { withAssistantCronWriteLock } from './locking.js'
import {
  buildAssistantCronHostedDeliveryIdempotency,
  buildAssistantCronNotificationDedupeToken,
} from './notification-delivery.js'
import {
  readAssistantCronCanonicalRuntimeStore,
  writeAssistantCronCanonicalRuntimeStore,
  findAssistantCronCanonicalRuntimeRecord,
  removeAssistantCronCanonicalRuntimeRecord,
  upsertAssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeState,
  type AssistantCronCanonicalRuntimeStore,
} from './runtime-state.js'
import { runScheduledLogCronJob } from './scheduled-log.js'
import {
  buildCanonicalAutomationUpsertInput,
  buildVisibleLocalAssistantCronStore,
  isCanonicalAssistantCronSourceEnabled,
  automationContinuityUsesSessionPin,
  listCanonicalAssistantCronRecords,
  projectCanonicalAssistantCronJob,
  type CanonicalAssistantCronJobRecord,
  resolveCanonicalAssistantCronJobId,
  resolveCanonicalAssistantCronOccurrenceAt,
  resolveCanonicalRuntimeState,
  type ResolvedAssistantCronJob,
} from './canonical-jobs.js'
import {
  appendAssistantCronRun,
  isAssistantCronJobDue,
  readAssistantCronStore,
  resolveAssistantCronJobIndex,
  sortAssistantCronJobs,
  writeAssistantCronStore,
} from './store.js'
import {
  resolveAssistantCronFailureBackoffMs,
  resolveAssistantCronNextRunAfterSuccess,
} from './finalization.js'
import {
  resolveAssistantCronTargetBindingDelivery,
  validateAssistantCronDeliveryTarget,
} from './targets.js'

const ASSISTANT_CRON_RUN_SCHEMA = 'murph.assistant-cron-run.v1'
const ASSISTANT_CRON_MAX_RESPONSE_LENGTH = 4_000
const ASSISTANT_CRON_NOTIFICATION_EXPIRES_AFTER_MS = 60 * 60 * 1000
const ASSISTANT_CRON_NOTIFICATION_EXPIRED_ERROR =
  'Assistant cron notification expired before delivery.'
// Hosted cron turns are off the user hotpath, so clean first runs prefer the
// OpenAI flex tier (~50% token cost). The Codex provider boundary validates
// route support and bounds flex execution with a deadline; failures land in the
// normal cron backoff (30s first retry), and that retry runs at standard tier.

interface DueAssistantCronCandidate {
  canonicalEntry?: {
    job: AssistantCronJob
    runtimeState: AssistantCronCanonicalRuntimeRecord
    source: CanonicalAssistantCronJobRecord
  }
  job: AssistantCronJob
  localJob?: AssistantCronJob
}

export async function claimResolvedAssistantCronJob(input: {
  job: ResolvedAssistantCronJob
  occurrenceFallbackAt?: string | null
  paths: AssistantStatePaths
}): Promise<ResolvedAssistantCronJob> {
  if (input.job.kind === 'local') {
    const store = await readAssistantCronStore(input.paths)
    const index = resolveAssistantCronJobIndex(store, input.job.job.jobId)
    const existing = store.jobs[index] as AssistantCronJob

    if (existing.state.runningAt !== null) {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_RUNNING',
        `Assistant cron job "${existing.name}" is already running.`,
      )
    }

    if (existing.state.pendingDeliveryIntentId) {
      throw new VaultCliError(
        'ASSISTANT_CRON_DELIVERY_PENDING',
        `Assistant cron job "${existing.name}" is waiting for outbound delivery confirmation.`,
      )
    }

    const now = new Date().toISOString()
    const claimed = assistantCronJobSchema.parse({
      ...existing,
      updatedAt: now,
      state: {
        ...existing.state,
        runningAt: now,
        runningPid: process.pid,
      },
    })

    store.jobs[index] = claimed
    await writeAssistantCronStore(input.paths, store)
    return {
      kind: 'local',
      job: claimed,
    }
  }

  const runtimeStore = await readAssistantCronCanonicalRuntimeStore(input.paths)
  const currentRuntimeState =
    findAssistantCronCanonicalRuntimeRecord(
      runtimeStore,
      resolveCanonicalAssistantCronJobId(input.job.source),
    ) ?? input.job.runtimeState

  if (currentRuntimeState.state.runningAt !== null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_JOB_RUNNING',
      `Assistant cron job "${input.job.job.name}" is already running.`,
    )
  }

  if (currentRuntimeState.state.pendingDeliveryIntentId) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_PENDING',
      `Assistant cron job "${input.job.job.name}" is waiting for outbound delivery confirmation.`,
    )
  }

  const now = new Date().toISOString()
  const runningClaimId = cryptoRandomCronClaimId()
  const occurrenceAt =
    resolveCanonicalAssistantCronOccurrenceAt(
      input.job.source,
      currentRuntimeState,
    ) ??
    input.occurrenceFallbackAt ??
    now
  const updatedRuntimeState: AssistantCronCanonicalRuntimeRecord = {
    ...currentRuntimeState,
    updatedAt: now,
    state: {
      ...currentRuntimeState.state,
      pendingOccurrenceAt: occurrenceAt,
      retryAfterAt: null,
      runningAt: now,
      runningClaimId,
      runningPid: process.pid,
    },
  }
  upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, updatedRuntimeState)
  await writeAssistantCronCanonicalRuntimeStore(input.paths, runtimeStore)

  return {
    kind: 'canonical',
    source: input.job.source,
    runtimeState: updatedRuntimeState,
    job: projectCanonicalAssistantCronJob({
      source: input.job.source,
      runtimeState: updatedRuntimeState,
    }),
  }
}

export async function claimNextDueAssistantCronJob(
  paths: AssistantStatePaths,
  vault: string,
): Promise<ResolvedAssistantCronJob | null> {
  return withAssistantCronWriteLock(paths, async () => {
    const [store, canonicalRecords, runtimeStore] = await Promise.all([
      readAssistantCronStore(paths),
      listCanonicalAssistantCronRecords(vault, ['active']),
      readAssistantCronCanonicalRuntimeStore(paths),
    ])
    const now = new Date().toISOString()
    const candidate = resolveNextDueAssistantCronCandidate({
      canonicalRecords,
      localStore: store,
      nowIso: now,
      runtimeStore,
    })
    if (!candidate) {
      return null
    }

    if (candidate.localJob) {
      return claimResolvedAssistantCronJob({
        paths,
        job: {
          kind: 'local',
          job: candidate.localJob,
        },
      })
    }

    const canonicalEntry = candidate.canonicalEntry
    if (!canonicalEntry) {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_NOT_FOUND',
        `Assistant cron job "${candidate.job.name}" was not found.`,
      )
    }

    return claimResolvedAssistantCronJob({
      paths,
      job: {
        kind: 'canonical',
        source: canonicalEntry.source,
        runtimeState: canonicalEntry.runtimeState,
        job: canonicalEntry.job,
      },
      occurrenceFallbackAt: candidate.job.state.nextRunAt,
    })
  })
}

export async function executeClaimedAssistantCronJob(input: {
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  job: ResolvedAssistantCronJob
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  paths: AssistantStatePaths
  signal?: AbortSignal
  turnEnvironment?: AssistantTurnEnvironment | null
  trigger: AssistantCronTrigger
  vault: string
}): Promise<{
  job: AssistantCronJob
  removedAfterRun: boolean
  run: AssistantCronRunRecord
  runErrorCode: string | null
}> {
  const claimedJob = input.job.job
  const startedAt = new Date().toISOString()
  let finishedAt = startedAt
  let sessionId: string | null = null
  let response: string | null = null
  let errorText: string | null = null
  let errorCode: string | null = null
  let status: AssistantCronRunRecord['status'] = 'failed'
  let pendingDeliveryIntentId: string | null = null
  const occurrenceAt =
    input.job.kind === 'canonical'
      ? input.job.runtimeState.state.pendingOccurrenceAt ??
        resolveCanonicalAssistantCronOccurrenceAt(
          input.job.source,
          input.job.runtimeState,
        ) ??
        startedAt
      : claimedJob.state.nextRunAt ?? startedAt

  try {
    if (input.signal?.aborted) {
      throw new VaultCliError(
        'ASSISTANT_CRON_ABORTED',
        `Assistant cron job "${claimedJob.name}" was aborted before it started.`,
      )
    }

    if (input.job.kind === 'canonical') {
      await assertCanonicalRuntimeClaimCurrent({
        job: input.job,
        paths: input.paths,
      })
    }

    const staleError =
      input.trigger === 'scheduled'
        ? resolveStaleAssistantCronNotificationError({
            job: claimedJob,
            nowIso: startedAt,
            occurrenceAt,
          })
        : null

    if (staleError) {
      status = 'skipped'
      errorText = staleError
    } else if (
      input.job.kind === 'canonical' &&
      input.job.source.kind === 'scheduledLog'
    ) {
      response = await runScheduledLogCronJob({
        vault: input.vault,
        scheduledLogId: input.job.source.scheduledLogId,
        occurrenceAt,
      })
      status = 'succeeded'
    } else {
      validateAssistantCronDeliveryTarget(claimedJob.target, {
        allowIdentitylessEmailTarget:
          assistantCronExecutionAllowsIdentitylessEmailTarget(input),
      })
      const serviceTier = resolveAssistantCronTurnServiceTier({
        executionContext: input.executionContext ?? null,
        job: claimedJob,
      })
      const automationTurn = buildAssistantAutomationTurnEnvelope({
        deliveryDispatchMode: input.deliveryDispatchMode,
        executionContext: input.executionContext,
        serviceTier,
        signal: input.signal,
        turnEnvironment: input.turnEnvironment ?? null,
        turnTrigger: 'automation-cron',
      })
      const bindingDelivery = resolveAssistantCronTargetBindingDelivery(
        claimedJob.target,
      )
      const result = await sendAssistantNotificationLocal({
        vault: input.vault,
        ...automationTurn,
        instructions: buildAssistantCronExecutionInstructions(claimedJob),
        deliveryDedupeToken: buildAssistantCronNotificationDedupeToken({
          job: claimedJob,
          trigger: input.trigger,
        }),
        hostedDeliveryIdempotency: buildAssistantCronHostedDeliveryIdempotency({
          job: claimedJob,
          trigger: input.trigger,
        }),
        sessionId: claimedJob.target.sessionId,
        alias: claimedJob.target.alias,
        allowBindingRebind: claimedJob.target.sessionId !== null,
        channel: claimedJob.target.channel,
        identityId: claimedJob.target.identityId,
        onTraceEvent: input.onTraceEvent,
        participantId: claimedJob.target.participantId,
        responsePolicy: resolveAssistantCronNotificationResponsePolicy(input.job),
        threadId: claimedJob.target.threadId,
        bindingDeliveryTarget: bindingDelivery?.target ?? undefined,
        deliveryKind: bindingDelivery?.kind ?? undefined,
        deliverySource: claimedJob.target.deliverySource,
        deliveryTarget: claimedJob.target.deliveryTarget,
        operatorAuthority: 'direct-operator',
        workingDirectory: input.vault,
      })

      sessionId = result.session.sessionId
      response = result.response ?? result.decision.privateSummary
      if (result.deliveryOutcome?.kind === 'queued') {
        pendingDeliveryIntentId = result.deliveryOutcome.intentId
        status = 'skipped'
      } else {
        status = 'succeeded'
      }
    }
  } catch (error) {
    errorText = errorMessage(error)
    errorCode = error instanceof VaultCliError ? error.code : null
    status = 'failed'
  } finally {
    finishedAt = new Date().toISOString()
  }

  const run = assistantCronRunRecordSchema.parse({
    schema: ASSISTANT_CRON_RUN_SCHEMA,
    runId: cryptoRandomRunId(),
    jobId: claimedJob.jobId,
    trigger: input.trigger,
    status,
    startedAt,
    finishedAt,
    sessionId,
    response: truncateAssistantCronResponse(response),
    responseLength: response?.length ?? 0,
    error: errorText,
  })

  const finalized = await withAssistantCronWriteLock(input.paths, async () => {
    if (input.job.kind === 'local') {
      await appendAssistantCronRun(input.paths, run)

      const store = await readAssistantCronStore(input.paths)
      const index = store.jobs.findIndex((job) => job.jobId === claimedJob.jobId)

      if (index === -1) {
        return {
          job: claimedJob,
          removedAfterRun: true,
        }
      }

      const current = store.jobs[index] as AssistantCronJob
      const finalizedJob = finalizeAssistantCronJobAfterRun({
        job: current,
        finishedAt,
        responseSessionId: sessionId,
        pendingDeliveryIntentId,
        run: {
          ...run,
          status,
        },
      })
      let removedAfterRun = false

      if (shouldRemoveAssistantCronJobAfterRun(current, run, pendingDeliveryIntentId)) {
        store.jobs.splice(index, 1)
        removedAfterRun = true
      } else {
        store.jobs[index] = finalizedJob
      }

      await writeAssistantCronStore(input.paths, store)

      return {
        job: finalizedJob,
        removedAfterRun,
      }
    }

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(input.paths, {
      reclaimStaleRunningClaims: false,
    })
    const currentRuntimeState =
      findAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        resolveCanonicalAssistantCronJobId(input.job.source),
      ) ?? input.job.runtimeState
    if (!canonicalRuntimeClaimMatches(input.job.runtimeState, currentRuntimeState)) {
      return {
        job: projectCanonicalAssistantCronJob({
          source: input.job.source,
          runtimeState: currentRuntimeState,
        }),
        removedAfterRun: false,
      }
    }
    await appendAssistantCronRun(input.paths, run)

    const usesSessionPin = automationContinuityUsesSessionPin(input.job.source)
    const updatedRuntimeState = finalizeCanonicalAssistantCronRuntimeAfterRun({
      finishedAt,
      run: {
        ...run,
        status,
      },
      runtimeState: currentRuntimeState,
      responseSessionId: usesSessionPin ? sessionId : null,
      pendingDeliveryIntentId,
      source: input.job.source,
    })
    const persistedRuntimeState: AssistantCronCanonicalRuntimeRecord = {
      ...currentRuntimeState,
      // Aliases are explicit creation-time bindings and survive preserve runs;
      // only the automatic session pin is gated by the conversation key.
      alias:
        input.job.source.kind === 'automation' &&
        input.job.source.continuityPolicy === 'preserve'
          ? updatedRuntimeState.alias
          : null,
      sessionId: usesSessionPin ? updatedRuntimeState.sessionId : null,
      updatedAt: finishedAt,
      state: updatedRuntimeState.state,
    }
    const finalizedJob = projectCanonicalAssistantCronJob({
      source: input.job.source,
      runtimeState: persistedRuntimeState,
    })
    let removedAfterRun = false

    if (shouldRemoveAssistantCronJobAfterRun(finalizedJob, run, pendingDeliveryIntentId)) {
      if (input.job.source.kind === 'automation') {
        await upsertAutomation(
          buildCanonicalAutomationUpsertInput({
            vault: input.vault,
            automationId: input.job.source.automationId,
            automation: input.job.source,
            title: input.job.source.title,
            status: 'archived',
            schedule: input.job.source.schedule,
            route: input.job.source.route,
            instructions: input.job.source.instructions,
          }),
        )
      } else if (input.job.source.kind === 'scheduledLog') {
        await setScheduledLogStatus({
          vaultRoot: input.vault,
          scheduledLogId: input.job.source.scheduledLogId,
          status: 'archived',
        })
      }
      removeAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        resolveCanonicalAssistantCronJobId(input.job.source),
      )
      removedAfterRun = true
    } else {
      upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, persistedRuntimeState)
    }

    await writeAssistantCronCanonicalRuntimeStore(input.paths, runtimeStore)

    return {
      job:
        removedAfterRun
          ? finalizedJob
          : projectCanonicalAssistantCronJob({
              source: input.job.source,
              runtimeState: persistedRuntimeState,
            }),
      removedAfterRun,
    }
  })

  return {
    job: finalized.job,
    removedAfterRun: finalized.removedAfterRun,
    run,
    // Typed failure class (e.g. ASSISTANT_CODEX_USAGE_LIMIT) for runtime-log
    // observability; the persisted run record keeps only the error text.
    runErrorCode: errorCode,
  }
}

function buildAssistantCronExecutionInstructions(job: AssistantCronJob): string {
  return job.prompt
}

function resolveAssistantCronTurnServiceTier(input: {
  executionContext: AssistantExecutionContext | null
  job: AssistantCronJob
}): AssistantProviderServiceTier | null {
  // Hosted API-key turns only; dev/local Codex subscription auth has no tiers.
  if (!input.executionContext?.hosted) {
    return null
  }

  // Retries after a failed (or deadline-aborted) flex run use the standard
  // tier so the existing 30s failure backoff bounds reminder lateness.
  return input.job.state.consecutiveFailures === 0 ? 'flex' : null
}

function resolveAssistantCronNotificationResponsePolicy(
  job: ResolvedAssistantCronJob,
): { kind: 'require_send' } | null {
  return job.kind === 'canonical' &&
    job.source.kind === 'automation' &&
    job.source.tags.includes(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    ? { kind: 'require_send' }
    : null
}

function finalizeAssistantCronJobAfterRun(input: {
  finishedAt: string
  job: AssistantCronJob
  pendingDeliveryIntentId: string | null
  responseSessionId: string | null
  run: AssistantCronRunRecord
}): AssistantCronJob {
  const runningClearedState = {
    ...input.job.state,
    runningAt: null,
    runningPid: null,
    lastRunAt: input.finishedAt,
  }
  const shouldAutoBindSession =
    input.responseSessionId !== null && !assistantCronJobHasStableSessionLocator(input.job)

  if (assistantCronRunConsumedOccurrence(input.run, input.pendingDeliveryIntentId)) {
    const nextRunAt = resolveAssistantCronNextRunAfterSuccess(
      input.job,
      new Date(input.finishedAt),
    )

    return assistantCronJobSchema.parse({
      ...input.job,
      enabled:
        input.job.schedule.kind === 'at' && input.job.keepAfterRun
          ? false
          : input.job.enabled,
      target: shouldAutoBindSession
        ? {
            ...input.job.target,
            sessionId: input.responseSessionId,
          }
        : input.job.target,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        nextRunAt,
        lastSucceededAt: input.finishedAt,
        lastError: null,
        consecutiveFailures: 0,
      },
    })
  }

  if (input.run.status === 'skipped' && input.pendingDeliveryIntentId !== null) {
    return assistantCronJobSchema.parse({
      ...input.job,
      target: shouldAutoBindSession
        ? {
            ...input.job.target,
            sessionId: input.responseSessionId,
          }
        : input.job.target,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        nextRunAt: null,
        lastError: null,
        pendingDeliveryIntentId: input.pendingDeliveryIntentId,
      },
    })
  }

  const failureCount = input.job.state.consecutiveFailures + 1
  const nextRunAt = input.job.enabled
    ? new Date(
        Date.parse(input.finishedAt) + resolveAssistantCronFailureBackoffMs(failureCount),
      ).toISOString()
    : input.job.state.nextRunAt

  return assistantCronJobSchema.parse({
    ...input.job,
    updatedAt: input.finishedAt,
    state: {
      ...runningClearedState,
      nextRunAt,
      lastFailedAt: input.finishedAt,
      lastError: input.run.error,
      consecutiveFailures: failureCount,
    },
  })
}

function shouldRemoveAssistantCronJobAfterRun(
  job: AssistantCronJob,
  run: AssistantCronRunRecord,
  pendingDeliveryIntentId: string | null,
): boolean {
  return (
    job.schedule.kind === 'at' &&
    !job.keepAfterRun &&
    assistantCronRunConsumedOccurrence(run, pendingDeliveryIntentId)
  )
}

// A stale-skipped wake consumes its occurrence like a success so one-shots
// archive and recurring schedules advance; a delivery-queued skip keeps the
// occurrence pending until the outbound delivery confirms.
function assistantCronRunConsumedOccurrence(
  run: AssistantCronRunRecord,
  pendingDeliveryIntentId: string | null,
): boolean {
  return (
    run.status === 'succeeded' ||
    (run.status === 'skipped' && pendingDeliveryIntentId === null)
  )
}

function finalizeCanonicalAssistantCronRuntimeAfterRun(input: {
  finishedAt: string
  pendingDeliveryIntentId: string | null
  responseSessionId: string | null
  run: AssistantCronRunRecord
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAssistantCronJobRecord
}): AssistantCronCanonicalRuntimeRecord {
  const runningClearedState: AssistantCronCanonicalRuntimeState = {
    ...input.runtimeState.state,
    runningAt: null,
    runningClaimId: null,
    runningPid: null,
    lastRunAt: input.finishedAt,
  }

  if (assistantCronRunConsumedOccurrence(input.run, input.pendingDeliveryIntentId)) {
    return {
      ...input.runtimeState,
      sessionId: input.responseSessionId ?? input.runtimeState.sessionId,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        pendingOccurrenceAt: null,
        retryAfterAt: null,
        lastSucceededAt: input.finishedAt,
        lastError: null,
        consecutiveFailures: 0,
      },
    }
  }

  if (input.run.status === 'skipped' && input.pendingDeliveryIntentId !== null) {
    return {
      ...input.runtimeState,
      sessionId: input.responseSessionId ?? input.runtimeState.sessionId,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        retryAfterAt: null,
        lastError: null,
        pendingDeliveryIntentId: input.pendingDeliveryIntentId,
      },
    }
  }

  const failureCount = input.runtimeState.state.consecutiveFailures + 1
  const retryAfterAt = isCanonicalAssistantCronSourceEnabled(input.source)
    ? new Date(
        Date.parse(input.finishedAt) +
          resolveAssistantCronFailureBackoffMs(failureCount),
      ).toISOString()
    : null

  return {
    ...input.runtimeState,
    updatedAt: input.finishedAt,
    state: {
      ...runningClearedState,
      pendingOccurrenceAt:
        input.runtimeState.state.pendingOccurrenceAt ??
        resolveCanonicalAssistantCronOccurrenceAt(input.source, input.runtimeState),
      retryAfterAt,
      lastFailedAt: input.finishedAt,
      lastError: input.run.error,
      consecutiveFailures: failureCount,
    },
  }
}

function assistantCronJobHasStableSessionLocator(job: AssistantCronJob): boolean {
  return Boolean(
    job.target.sessionId ||
      job.target.alias ||
      (job.target.channel &&
        (job.target.participantId || job.target.threadId)),
  )
}

function truncateAssistantCronResponse(response: string | null): string | null {
  if (response === null) {
    return null
  }

  return response.slice(0, ASSISTANT_CRON_MAX_RESPONSE_LENGTH)
}

function resolveStaleAssistantCronNotificationError(input: {
  job: AssistantCronJob
  nowIso: string
  occurrenceAt: string
}): string | null {
  if (input.job.scheduledLog) {
    return null
  }

  const nowMs = Date.parse(input.nowIso)
  const occurrenceMs = Date.parse(input.occurrenceAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(occurrenceMs)) {
    return null
  }

  const ageMs = nowMs - occurrenceMs
  if (ageMs <= ASSISTANT_CRON_NOTIFICATION_EXPIRES_AFTER_MS) {
    return null
  }

  const lateMinutes = Math.floor(ageMs / 60_000)
  return `${ASSISTANT_CRON_NOTIFICATION_EXPIRED_ERROR} Scheduled occurrence was ${lateMinutes} minute(s) late.`
}

function assistantCronExecutionAllowsIdentitylessEmailTarget(input: {
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
}): boolean {
  return (
    input.deliveryDispatchMode === 'queue-only' &&
    normalizeNullableString(input.executionContext?.hosted?.memberId) !== null
  )
}

function cryptoRandomRunId(): string {
  return `cronrun_${randomUUID().replace(/-/gu, '')}`
}

function resolveNextDueAssistantCronCandidate(input: {
  canonicalRecords: readonly CanonicalAssistantCronJobRecord[]
  localStore: ReturnType<typeof buildVisibleLocalAssistantCronStore>
  nowIso: string
  runtimeStore: AssistantCronCanonicalRuntimeStore
}): DueAssistantCronCandidate | null {
  const visibleLocalStore = buildVisibleLocalAssistantCronStore(input.localStore)
  const canonicalEntries = input.canonicalRecords.map((source) => {
    const runtimeState = resolveCanonicalRuntimeState(source, input.runtimeStore)
    return {
      source,
      runtimeState,
      job: projectCanonicalAssistantCronJob({
        source,
        runtimeState,
      }),
    }
  })
  const candidate = sortAssistantCronJobs([
    ...visibleLocalStore.jobs,
    ...canonicalEntries.map((entry) => entry.job),
  ]).find((job) => isAssistantCronJobDue(job, input.nowIso))
  if (!candidate) {
    return null
  }

  const localJob =
    input.localStore.jobs.find((job) => job.jobId === candidate.jobId) ?? undefined
  if (localJob) {
    return {
      job: candidate,
      localJob,
    }
  }

  const canonicalEntry = canonicalEntries.find(
    (entry) => resolveCanonicalAssistantCronJobId(entry.source) === candidate.jobId,
  )
  return {
    job: candidate,
    ...(canonicalEntry ? { canonicalEntry } : {}),
  }
}

function cryptoRandomCronClaimId(): string {
  return `cronclaim_${randomUUID().replace(/-/gu, '')}`
}

function canonicalRuntimeClaimMatches(
  claimed: AssistantCronCanonicalRuntimeRecord,
  current: AssistantCronCanonicalRuntimeRecord,
): boolean {
  return claimed.state.runningClaimId !== null &&
    claimed.state.runningClaimId === current.state.runningClaimId
}

async function assertCanonicalRuntimeClaimCurrent(input: {
  job: Extract<ResolvedAssistantCronJob, { kind: 'canonical' }>
  paths: AssistantStatePaths
}): Promise<void> {
  const runtimeStore = await readAssistantCronCanonicalRuntimeStore(input.paths)
  const currentRuntimeState =
    findAssistantCronCanonicalRuntimeRecord(
      runtimeStore,
      resolveCanonicalAssistantCronJobId(input.job.source),
    ) ?? input.job.runtimeState

  if (!canonicalRuntimeClaimMatches(input.job.runtimeState, currentRuntimeState)) {
    throw new VaultCliError(
      'ASSISTANT_CRON_CLAIM_LOST',
      `Assistant cron job "${input.job.job.name}" was reclaimed before it started.`,
    )
  }
}
