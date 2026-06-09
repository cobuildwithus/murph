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
import type { AssistantTurnEnvironment } from '../service-contracts.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import { errorMessage } from '../shared.js'
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

const ASSISTANT_CRON_RUN_SCHEMA = 'murph.assistant-cron-run.v1'
const ASSISTANT_CRON_MAX_RESPONSE_LENGTH = 4_000
export const ASSISTANT_CRON_ONE_SHOT_NOTIFICATION_EXPIRES_AFTER_MS =
  30 * 60 * 1000
const ASSISTANT_CRON_NOTIFICATION_EXPIRED_ERROR =
  'Assistant cron notification expired before delivery.'
const ASSISTANT_CRON_ONE_SHOT_NOTIFICATION_EXPIRED_ERROR =
  'Assistant cron one-shot notification expired before delivery.'
export interface ExpiredAssistantCronJobResult {
  job: AssistantCronJob
  run: AssistantCronRunRecord
  sourceKind: CanonicalAssistantCronJobRecord['kind'] | 'local'
}

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

export async function expireNextStaleDueAssistantCronJob(input: {
  paths: AssistantStatePaths
  vault: string
}): Promise<ExpiredAssistantCronJobResult | null> {
  return withAssistantCronWriteLock(input.paths, async () => {
    const [store, canonicalRecords, runtimeStore] = await Promise.all([
      readAssistantCronStore(input.paths),
      listCanonicalAssistantCronRecords(input.vault, ['active']),
      readAssistantCronCanonicalRuntimeStore(input.paths),
    ])
    const nowIso = new Date().toISOString()
    const candidate = resolveNextDueAssistantCronCandidate({
      canonicalRecords,
      localStore: store,
      nowIso,
      runtimeStore,
    })
    if (!candidate) {
      return null
    }

    const occurrenceAt = resolveDueAssistantCronCandidateOccurrenceAt(candidate) ?? nowIso
    const expiryError = resolveExpiredAssistantCronNotificationError({
      job: candidate.job,
      nowIso,
      occurrenceAt,
    })
    if (!expiryError) {
      return null
    }

    const run = createAssistantCronRunRecord({
      error: expiryError,
      finishedAt: nowIso,
      jobId: candidate.job.jobId,
      response: null,
      sessionId: null,
      startedAt: nowIso,
      status: 'skipped',
      trigger: 'scheduled',
    })

    if (candidate.localJob) {
      await appendAssistantCronRun(input.paths, run)
      if (candidate.localJob.schedule.kind === 'at' && !candidate.localJob.keepAfterRun) {
        store.jobs = store.jobs.filter((job) => job.jobId !== candidate.localJob?.jobId)
      } else {
        store.jobs = store.jobs.map((job) =>
          job.jobId === candidate.localJob?.jobId
            ? finalizeAssistantCronJobAfterRun({
                finishedAt: nowIso,
                job,
                pendingDeliveryIntentId: null,
                responseSessionId: null,
                run,
              })
            : job,
        )
      }
      await writeAssistantCronStore(input.paths, store)
      return {
        job: candidate.localJob,
        run,
        sourceKind: 'local',
      }
    }

    const canonicalEntry = candidate.canonicalEntry
    if (!canonicalEntry || canonicalEntry.source.kind !== 'automation') {
      return null
    }

    await appendAssistantCronRun(input.paths, run)
    let returnedJob = canonicalEntry.job
    if (canonicalEntry.source.schedule.kind === 'at') {
      await upsertAutomation(
        buildCanonicalAutomationUpsertInput({
          vault: input.vault,
          automationId: canonicalEntry.source.automationId,
          automation: canonicalEntry.source,
          title: canonicalEntry.source.title,
          status: 'archived',
          schedule: canonicalEntry.source.schedule,
          route: canonicalEntry.source.route,
          instructions: canonicalEntry.source.instructions,
        }),
      )
      removeAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        resolveCanonicalAssistantCronJobId(canonicalEntry.source),
      )
    } else {
      const updatedRuntimeState = finalizeCanonicalAssistantCronRuntimeAfterRun({
        finishedAt: nowIso,
        pendingDeliveryIntentId: null,
        responseSessionId: null,
        run,
        runtimeState: canonicalEntry.runtimeState,
        source: canonicalEntry.source,
      })
      upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, updatedRuntimeState)
      returnedJob = projectCanonicalAssistantCronJob({
        source: canonicalEntry.source,
        runtimeState: updatedRuntimeState,
      })
    }
    await writeAssistantCronCanonicalRuntimeStore(input.paths, runtimeStore)

    return {
      job: returnedJob,
      run,
      sourceKind: canonicalEntry.source.kind,
    }
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
}> {
  const claimedJob = input.job.job
  const startedAt = new Date().toISOString()
  let finishedAt = startedAt
  let sessionId: string | null = null
  let response: string | null = null
  let errorText: string | null = null
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
      : startedAt

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

    if (
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
      const automationTurn = buildAssistantAutomationTurnEnvelope({
        deliveryDispatchMode: input.deliveryDispatchMode,
        executionContext: input.executionContext,
        signal: input.signal,
        turnEnvironment: input.turnEnvironment ?? null,
        turnTrigger: 'automation-cron',
      })
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

      if (shouldRemoveAssistantCronJobAfterRun(current, run)) {
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

    const updatedRuntimeState = finalizeCanonicalAssistantCronRuntimeAfterRun({
      finishedAt,
      run: {
        ...run,
        status,
      },
      runtimeState: currentRuntimeState,
      responseSessionId:
        input.job.source.kind === 'automation' &&
        input.job.source.continuityPolicy === 'preserve'
          ? sessionId
          : null,
      pendingDeliveryIntentId,
      source: input.job.source,
    })
    const persistedRuntimeState: AssistantCronCanonicalRuntimeRecord = {
      ...currentRuntimeState,
      alias:
        input.job.source.kind === 'automation' &&
        input.job.source.continuityPolicy === 'preserve'
          ? updatedRuntimeState.alias
          : null,
      sessionId:
        input.job.source.kind === 'automation' &&
        input.job.source.continuityPolicy === 'preserve'
          ? updatedRuntimeState.sessionId
          : null,
      updatedAt: finishedAt,
      state: updatedRuntimeState.state,
    }
    const finalizedJob = projectCanonicalAssistantCronJob({
      source: input.job.source,
      runtimeState: persistedRuntimeState,
    })
    let removedAfterRun = false

    if (shouldRemoveAssistantCronJobAfterRun(finalizedJob, run)) {
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
  }
}

function buildAssistantCronExecutionInstructions(job: AssistantCronJob): string {
  return job.prompt
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

  if (
    input.run.status === 'succeeded' ||
    (input.run.status === 'skipped' && input.pendingDeliveryIntentId === null)
  ) {
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
): boolean {
  return (
    job.schedule.kind === 'at' &&
    !job.keepAfterRun &&
    run.status === 'succeeded'
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

  if (
    input.run.status === 'succeeded' ||
    (input.run.status === 'skipped' && input.pendingDeliveryIntentId === null)
  ) {
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

function resolveExpiredAssistantCronNotificationError(input: {
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
  if (ageMs <= ASSISTANT_CRON_ONE_SHOT_NOTIFICATION_EXPIRES_AFTER_MS) {
    return null
  }

  const lateMinutes = Math.floor(ageMs / 60_000)
  const baseError =
    input.job.schedule.kind === 'at' && !input.job.keepAfterRun
      ? ASSISTANT_CRON_ONE_SHOT_NOTIFICATION_EXPIRED_ERROR
      : ASSISTANT_CRON_NOTIFICATION_EXPIRED_ERROR
  return `${baseError} Scheduled occurrence was ${lateMinutes} minute(s) late.`
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

function resolveDueAssistantCronCandidateOccurrenceAt(
  candidate: DueAssistantCronCandidate,
): string | null {
  if (candidate.canonicalEntry) {
    return (
      resolveCanonicalAssistantCronOccurrenceAt(
        candidate.canonicalEntry.source,
        candidate.canonicalEntry.runtimeState,
      ) ?? candidate.job.state.nextRunAt
    )
  }

  return candidate.job.state.nextRunAt
}

function createAssistantCronRunRecord(input: {
  error: string | null
  finishedAt: string
  jobId: string
  response: string | null
  sessionId: string | null
  startedAt: string
  status: AssistantCronRunRecord['status']
  trigger: AssistantCronTrigger
}): AssistantCronRunRecord {
  return assistantCronRunRecordSchema.parse({
    schema: ASSISTANT_CRON_RUN_SCHEMA,
    runId: cryptoRandomRunId(),
    jobId: input.jobId,
    trigger: input.trigger,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    sessionId: input.sessionId,
    response: truncateAssistantCronResponse(input.response),
    responseLength: input.response?.length ?? 0,
    error: input.error,
  })
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
