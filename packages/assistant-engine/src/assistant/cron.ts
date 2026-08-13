import {
  type AssistantCronJob,
  type AssistantCronPreset,
  type AssistantCronRunRecord,
  type AssistantCronTargetSnapshot,
  type AssistantCronTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { isVaultError, patchAutomation } from '@murphai/core'
import { withAssistantCronWriteLock } from './cron/locking.ts'
import { buildAssistantCronSchedule } from './cron/schedule.ts'
import {
  getAssistantCronPresetDefinition,
  listAssistantCronPresets as listBuiltinAssistantCronPresets,
  type AssistantCronPresetDefinition,
} from './cron/presets.ts'
import {
  ensureAssistantCronState,
  isAssistantCronJobDue,
  normalizeRequiredAssistantCronText,
  readAssistantCronRuns,
  readAssistantCronStore,
  resolveAssistantCronRunLookupId,
  sortAssistantCronJobs,
  type AssistantCronTargetInput,
  writeAssistantCronStore,
} from './cron/store.ts'
import { readAssistantCronCanonicalRuntimeStore } from './cron/runtime-state.ts'
import {
  buildVisibleLocalAssistantCronStore,
  findCanonicalAssistantCronRecordInList,
  listCanonicalAssistantCronRecords,
  projectCanonicalAssistantCronJob,
  readCanonicalAssistantCronAutomationByRelativePath,
  resolveCanonicalAssistantCronNextDeliverableOccurrenceProjection,
  resolveCanonicalAssistantCronJobId,
  resolveCanonicalRuntimeState,
  type ResolvedAssistantCronJob,
} from './cron/canonical-jobs.ts'
import {
  assertAssistantCronJobRunnableInRuntime,
  buildRunnableAssistantCronJobProjection,
  claimNextDueAssistantCronJob,
  claimResolvedAssistantCronJob,
  computeAssistantCronBackgroundMaintenanceYieldRetryAt,
  executeClaimedAssistantCronJob,
  isAssistantCronBackgroundMaintenanceYieldError,
  type AssistantCronRunnableProjectionInput,
} from './cron/execution.ts'
import {
  earliestAssistantAutomationWakeAt,
  type AssistantRunEvent,
} from './automation/shared.ts'
import {
  sanitizeAssistantAutomationFailureText,
} from './automation/failure-observability.ts'
import type { AssistantTurnEnvironment } from './service-contracts.ts'
import type { AssistantProviderTraceEvent } from './provider-traces.ts'
import { resolveAssistantStatePaths } from './store/paths.ts'
import type { AssistantOutboxDispatchMode } from './outbox.ts'
import type { AssistantExecutionContext } from './execution-context.ts'
import {
  addAssistantCronJob,
  installAssistantCronPreset,
  upsertAssistantCronAutomation,
  type AddAssistantCronJobInput,
  type InstallAssistantCronPresetInput,
  type InstallAssistantCronPresetResult,
  type UpsertAssistantCronAutomationInput,
} from './cron/authoring.ts'
import {
  assertResolvedAssistantCronJobNotRunning,
  buildAssistantCronTargetMutationPreview,
  projectResolvedCanonicalAssistantCronJob,
  removeResolvedCanonicalAssistantCronSource,
  removeResolvedLocalAssistantCronJob,
  resolveAssistantCronJobForMutation,
  setResolvedCanonicalAssistantCronSourceEnabled,
  setResolvedLocalAssistantCronJobEnabled,
  setResolvedLocalAssistantCronJobTarget,
  tryResolveLocalAssistantCronJob,
  updateResolvedCanonicalAssistantCronAutomationTarget,
  writeResolvedCanonicalAssistantCronRuntimeState,
} from './cron/mutations.ts'
import {
  buildAssistantCronTargetSnapshot,
  resolveAssistantCronTargetDefaults,
  type AssistantCronDeliveryRouteValidationProfile,
  validateAssistantCronDeliveryTarget,
} from './cron/targets.ts'
import {
  reconcileAssistantCronDeliveryIntent,
  repairPendingAssistantCronDeliveries,
} from './cron/delivery-reconciliation.ts'
import {
  isRecognizedMurphOnboardingFollowupAutomation,
} from './managed-automations.ts'

export type { AssistantCronTargetSnapshot } from '@murphai/operator-config/assistant-cli-contracts'
export {
  reconcileAssistantCronDeliveryIntent,
  repairPendingAssistantCronDeliveries,
}
export { listAssistantCronPendingDeliveryIntentIds } from './cron/delivery-reconciliation.ts'
export {
  resolveAssistantCronDefaultTimeZone,
  resolveAssistantCronDefaultTimeZoneProjection,
  resolveAssistantCronVaultTimeZone,
} from './cron/canonical-jobs.ts'
export { addAssistantCronJob, installAssistantCronPreset, upsertAssistantCronAutomation }
export type {
  AddAssistantCronJobInput,
  InstallAssistantCronPresetInput,
  InstallAssistantCronPresetResult,
  UpsertAssistantCronAutomationInput,
}

export interface AssistantCronStatusSnapshot {
  dueJobs: number
  enabledJobs: number
  nextRunAt: string | null
  runningJobs: number
  totalJobs: number
}

export interface AssistantCronStatusOptions
  extends AssistantCronRunnableProjectionInput {}

export interface AssistantCronRunExecutionResult {
  job: AssistantCronJob
  removedAfterRun: boolean
  run: AssistantCronRunRecord
  runErrorCode: string | null
}

export interface AssistantCronTargetMutationResult {
  afterTarget: AssistantCronTargetSnapshot
  beforeTarget: AssistantCronTargetSnapshot
  changed: boolean
  continuityReset: boolean
  dryRun: boolean
  job: AssistantCronJob
}

export interface AssistantCronProcessDueResult {
  failed: number
  processed: number
  succeeded: number
}

export interface RunAssistantCronJobInput {
  executionContext?: AssistantExecutionContext | null
  job: string
  signal?: AbortSignal
  trigger?: AssistantCronTrigger
  turnEnvironment?: AssistantTurnEnvironment | null
  vault: string
}

export interface ProcessDueAssistantCronJobsInput {
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  limit?: number
  onEvent?: (event: AssistantRunEvent) => void
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  shouldYield?: (() => boolean) | null
  signal?: AbortSignal
  shouldYieldBackgroundMaintenance?: (() => boolean) | null
  turnEnvironment?: AssistantTurnEnvironment | null
  vault: string
}

export interface SetAssistantCronJobTargetInput extends AssistantCronTargetInput {
  dryRun?: boolean
  job: string
  now?: Date
  resetContinuity?: boolean
  vault: string
}

export function listAssistantCronPresets(): AssistantCronPreset[] {
  return listBuiltinAssistantCronPresets()
}

export function getAssistantCronPreset(
  presetId: string,
): AssistantCronPresetDefinition {
  return getAssistantCronPresetDefinition(presetId)
}

async function projectResolvedAssistantCronJob(
  vault: string,
  lookup: string,
): Promise<ResolvedAssistantCronJob> {
  const paths = resolveAssistantStatePaths(vault)
  const [localStore, canonicalRecords, runtimeStore] = await Promise.all([
    readAssistantCronStore(paths),
    listCanonicalAssistantCronRecords(vault, ['active', 'paused']),
    readAssistantCronCanonicalRuntimeStore(paths),
  ])
  const visibleLocalStore = buildVisibleLocalAssistantCronStore(localStore)
  const localJob = tryResolveLocalAssistantCronJob(visibleLocalStore, lookup)
  if (localJob) {
    return {
      kind: 'local',
      job: localJob,
    }
  }

  const source = findCanonicalAssistantCronRecordInList(canonicalRecords, lookup)
  if (!source) {
    throw new VaultCliError(
      'ASSISTANT_CRON_JOB_NOT_FOUND',
      `Assistant cron job "${normalizeRequiredAssistantCronText(lookup, 'job')}" was not found.`,
    )
  }

  const runtimeState = resolveCanonicalRuntimeState(source, runtimeStore)

  return {
    kind: 'canonical',
    source,
    runtimeState,
    job: projectCanonicalAssistantCronJob({
      source,
      runtimeState,
    }),
  }
}

export async function listAssistantCronJobs(
  vault: string,
): Promise<AssistantCronJob[]> {
  const paths = resolveAssistantStatePaths(vault)
  const [localStore, canonicalRecords, runtimeStore] = await Promise.all([
    readAssistantCronStore(paths),
    listCanonicalAssistantCronRecords(vault),
    readAssistantCronCanonicalRuntimeStore(paths),
  ])
  return sortAssistantCronJobs([
    ...buildVisibleLocalAssistantCronStore(localStore).jobs,
    ...canonicalRecords.map((source) =>
      projectCanonicalAssistantCronJob({
        source,
        runtimeState: resolveCanonicalRuntimeState(source, runtimeStore),
      }),
    ),
  ])
}

export async function getAssistantCronJob(
  vault: string,
  job: string,
): Promise<AssistantCronJob> {
  return (await projectResolvedAssistantCronJob(vault, job)).job
}

export async function getAssistantCronAutomationTimingProjection(
  vault: string,
  relativePath: string,
  defaultTimeZone: string,
): Promise<{
  job: AssistantCronJob
  nextOccurrenceAt: string | null
  occurrenceVerified: boolean
}> {
  const paths = resolveAssistantStatePaths(vault)
  const [source, runtimeStore] = await Promise.all([
    readCanonicalAssistantCronAutomationByRelativePath({
      defaultTimeZone,
      relativePath,
      vault,
    }),
    readAssistantCronCanonicalRuntimeStore(paths),
  ])
  const runtimeState = resolveCanonicalRuntimeState(source, runtimeStore)
  const occurrenceProjection =
    resolveCanonicalAssistantCronNextDeliverableOccurrenceProjection(
      source,
      runtimeState,
      new Date(),
    )
  return {
    job: projectCanonicalAssistantCronJob({ source, runtimeState }),
    nextOccurrenceAt: occurrenceProjection.nextOccurrenceAt,
    occurrenceVerified: occurrenceProjection.verified,
  }
}

export async function getAssistantCronJobTarget(
  vault: string,
  job: string,
): Promise<AssistantCronTargetSnapshot> {
  const cronJob = await getAssistantCronJob(vault, job)
  return buildAssistantCronTargetSnapshot(cronJob)
}

export async function removeAssistantCronJob(
  vault: string,
  job: string,
): Promise<AssistantCronJob> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantCronState(paths)

  return withAssistantCronWriteLock(paths, async () => {
    const resolved = await resolveAssistantCronJobForMutation({
      job,
      paths,
      vault,
    })

    if (resolved.kind === 'local') {
      return removeResolvedLocalAssistantCronJob(resolved)
    }

    await removeResolvedCanonicalAssistantCronSource(resolved)
    return resolved.job
  })
}

export async function setAssistantCronJobEnabled(
  vault: string,
  job: string,
  enabled: boolean,
): Promise<AssistantCronJob> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantCronState(paths)

  return withAssistantCronWriteLock(paths, async () => {
    const resolved = await resolveAssistantCronJobForMutation({
      job,
      localVisibility: 'raw',
      paths,
      vault,
    })
    if (resolved.job.state.pendingDeliveryIntentId) {
      throw new VaultCliError(
        'ASSISTANT_CRON_DELIVERY_PENDING',
        `Assistant cron job "${resolved.job.name}" is waiting for outbound delivery confirmation.`,
      )
    }
    const now = new Date()

    if (resolved.kind === 'local') {
      return setResolvedLocalAssistantCronJobEnabled({
        enabled,
        now,
        resolved,
      })
    }

    const { source, runtimeState } = await setResolvedCanonicalAssistantCronSourceEnabled({
      enabled,
      now,
      resolved,
    })
    await writeResolvedCanonicalAssistantCronRuntimeState({
      resolved,
      runtimeState,
    })

    return projectResolvedCanonicalAssistantCronJob({
      resolved,
      runtimeState,
      source,
    })
  })
}

export async function setAssistantCronJobTarget(
  input: SetAssistantCronJobTargetInput,
): Promise<AssistantCronTargetMutationResult> {
  const resolvedInput = await resolveAssistantCronTargetDefaults(input)
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(paths)
  const nextTarget = validateAssistantCronDeliveryTarget(resolvedInput)

  return withAssistantCronWriteLock(paths, async () => {
    const resolved = await resolveAssistantCronJobForMutation({
      job: resolvedInput.job,
      localVisibility: 'raw',
      paths,
      vault: resolvedInput.vault,
    })
    const currentContinuity =
      resolved.kind === 'local'
        ? {
            alias: resolved.job.target.alias,
            sessionId: resolved.job.target.sessionId,
          }
        : resolved.source.kind === 'automation'
          ? {
              alias: resolved.runtimeState.alias,
              sessionId: resolved.runtimeState.sessionId,
            }
          : null

    if (resolved.kind === 'canonical' && resolved.source.kind !== 'automation') {
      throw new VaultCliError(
        'ASSISTANT_CRON_DELIVERY_REQUIRED',
        `Canonical auto-log job "${resolved.job.name}" does not support assistant delivery targeting.`,
      )
    }

    assertResolvedAssistantCronJobNotRunning(resolved)
    const preview = buildAssistantCronTargetMutationPreview({
      continuityAlias: currentContinuity?.alias ?? null,
      continuitySessionId: currentContinuity?.sessionId ?? null,
      job: resolved.job,
      nextTarget,
      resetContinuity: resolvedInput.resetContinuity,
    })

    if (resolvedInput.dryRun) {
      return {
        job: resolved.job,
        beforeTarget: preview.beforeTarget,
        afterTarget: preview.afterTarget,
        changed: preview.changed,
        continuityReset: preview.continuityReset,
        dryRun: true,
      }
    }

    if (!preview.changed && !preview.continuityReset) {
      return {
        job: resolved.job,
        beforeTarget: preview.beforeTarget,
        afterTarget: preview.afterTarget,
        changed: false,
        continuityReset: false,
        dryRun: false,
      }
    }

    const now = (resolvedInput.now ?? new Date()).toISOString()
    if (resolved.kind === 'local') {
      const updated = await setResolvedLocalAssistantCronJobTarget({
        now,
        target: preview.afterTarget.target,
        resolved,
      })

      return {
        job: updated,
        beforeTarget: preview.beforeTarget,
        afterTarget: buildAssistantCronTargetSnapshot(updated),
        changed: preview.changed,
        continuityReset: preview.continuityReset,
        dryRun: false,
      }
    }

    const { source, runtimeState } = await updateResolvedCanonicalAssistantCronAutomationTarget({
      now,
      resolved,
      target: preview.afterTarget.target,
    })
    await writeResolvedCanonicalAssistantCronRuntimeState({
      resolved,
      runtimeState,
    })
    const updatedJob = projectResolvedCanonicalAssistantCronJob({
      resolved,
      runtimeState,
      source,
    })

    return {
      job: updatedJob,
      beforeTarget: preview.beforeTarget,
      afterTarget: buildAssistantCronTargetSnapshot(updatedJob),
      changed: preview.changed,
      continuityReset: preview.continuityReset,
      dryRun: false,
    }
  })
}

export async function getAssistantCronStatus(
  vault: string,
  options: AssistantCronStatusOptions = {},
): Promise<AssistantCronStatusSnapshot> {
  const paths = resolveAssistantStatePaths(vault)
  const [localStore, canonicalRecords, runtimeStore] = await Promise.all([
    readAssistantCronStore(paths),
    listCanonicalAssistantCronRecords(vault),
    readAssistantCronCanonicalRuntimeStore(paths),
  ])
  const projection = buildRunnableAssistantCronJobProjection({
    canonicalRecords,
    localStore,
    runtimeScopeInput: options,
    runtimeStore,
  })
  const canonicalJobs = projection.jobs
  const now = new Date().toISOString()
  const enabledJobs = canonicalJobs.filter((job) => job.enabled)
  const dueJobs = enabledJobs.filter((job) => isAssistantCronJobDue(job, now)).length
  const runningJobs = canonicalJobs.filter((job) => job.state.runningAt !== null).length
  const visibleNextRunAt =
    enabledJobs.find((job) => job.state.nextRunAt !== null)?.state.nextRunAt ?? null
  // Background maintenance hidden by active foreground yield still needs a
  // wake: a released claim carries its persisted retry time, and a due but
  // never-claimed occurrence gets the same short catch-up deferral so it is
  // not disarmed until an unrelated wake.
  const backgroundMaintenanceRetryWakeAt = earliestAssistantAutomationWakeAt(
    ...projection.yieldDeferredBackgroundMaintenanceEntries.map((entry) => {
      if (entry.runtimeState.state.retryAfterAt !== null) {
        return entry.job.state.nextRunAt
      }
      return isAssistantCronJobDue(entry.job, now)
        ? computeAssistantCronBackgroundMaintenanceYieldRetryAt(now)
        : null
    }),
  )
  const nextRunAt = earliestAssistantAutomationWakeAt(
    visibleNextRunAt,
    backgroundMaintenanceRetryWakeAt,
  )

  return {
    totalJobs: canonicalJobs.length,
    enabledJobs: enabledJobs.length,
    dueJobs,
    runningJobs,
    nextRunAt,
  }
}

export async function listAssistantCronRuns(input: {
  job: string
  limit?: number
  vault: string
}): Promise<{
  jobId: string
  runs: AssistantCronRunRecord[]
}> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(paths)
  const store = await readAssistantCronStore(paths)
  const localJob = tryResolveLocalAssistantCronJob(store, input.job)
  let jobId: string
  if (localJob) {
    jobId = resolveAssistantCronRunLookupId(store, input.job)
  } else {
    try {
      jobId = (await projectResolvedAssistantCronJob(input.vault, input.job)).job.jobId
    } catch {
      jobId = normalizeRequiredAssistantCronText(input.job, 'job')
    }
  }
  const runs = await readAssistantCronRuns(paths, jobId)
  const limit = typeof input.limit === 'number' ? Math.max(1, input.limit) : 20

  return {
    jobId,
    runs: runs.slice(0, limit),
  }
}

export async function runAssistantCronJobNow(
  input: RunAssistantCronJobInput,
): Promise<AssistantCronRunExecutionResult> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(paths)
  await repairPendingAssistantCronDeliveries({
    paths,
    vault: input.vault,
  })

  const claimed = await withAssistantCronWriteLock(paths, async () => {
    const resolved = await resolveAssistantCronJobForMutation({
      job: input.job,
      localVisibility: 'raw',
      paths,
      vault: input.vault,
    })
    const job =
      resolved.kind === 'local'
        ? {
            kind: 'local' as const,
            job: resolved.job,
          }
        : {
            kind: 'canonical' as const,
            source: resolved.source,
            runtimeState: resolved.runtimeState,
            job: resolved.job,
          }

    assertAssistantCronJobRunnableInRuntime({
      executionContext: input.executionContext,
      job,
      turnEnvironment: input.turnEnvironment ?? null,
    })

    return claimResolvedAssistantCronJob({
      paths,
      job,
    })
  })

  return executeClaimedAssistantCronJob({
    executionContext: input.executionContext,
    paths,
    signal: input.signal,
    turnEnvironment: input.turnEnvironment ?? null,
    trigger: input.trigger ?? 'manual',
    vault: input.vault,
    job: claimed,
  })
}

export async function processDueAssistantCronJobs(
  input: ProcessDueAssistantCronJobsInput,
): Promise<AssistantCronProcessDueResult> {
  return processDueAssistantCronJobsLocal(input)
}

export async function processDueAssistantCronJobsLocal(
  input: ProcessDueAssistantCronJobsInput,
): Promise<AssistantCronProcessDueResult> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(paths)

  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.trunc(input.limit))
      : Number.POSITIVE_INFINITY
  const summary: AssistantCronProcessDueResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
  }
  if (input.shouldYield?.() === true) {
    return summary
  }

  if (
    assistantCronDeliveryRouteValidationProfileForExecutionContext(
      input.executionContext,
    ) === 'local'
  ) {
    await pauseUnsupportedLocalEmailAutomations({ vault: input.vault })
  }

  await repairPendingAssistantCronDeliveries({
    paths,
    vault: input.vault,
  })
  if (input.shouldYield?.() === true) {
    return summary
  }

  await emitAssistantCronScanEvents({
    onEvent: input.onEvent,
    paths,
    routeValidationProfile:
      assistantCronDeliveryRouteValidationProfileForExecutionContext(
        input.executionContext,
      ),
    runtimeScopeInput: {
      executionContext: input.executionContext,
      shouldYieldBackgroundMaintenance:
        input.shouldYieldBackgroundMaintenance ?? null,
      turnEnvironment: input.turnEnvironment ?? null,
    },
    vault: input.vault,
  })

  while (!input.signal?.aborted && summary.processed < limit) {
    if (input.shouldYield?.() === true) {
      break
    }

    const claimed = await claimNextDueAssistantCronJob(paths, input.vault, {
      executionContext: input.executionContext,
      shouldYieldBackgroundMaintenance:
        input.shouldYieldBackgroundMaintenance ?? null,
      turnEnvironment: input.turnEnvironment ?? null,
    })
    if (!claimed) {
      break
    }

    let result: Awaited<ReturnType<typeof executeClaimedAssistantCronJob>>
    try {
      result = await executeClaimedAssistantCronJob({
        deliveryDispatchMode: input.deliveryDispatchMode,
        executionContext: input.executionContext,
        job: claimed,
        onEvent: input.onEvent,
        onTraceEvent: input.onTraceEvent,
        paths,
        shouldYield: input.shouldYield ?? null,
        shouldYieldBackgroundMaintenance:
          input.shouldYieldBackgroundMaintenance ?? null,
        signal: input.signal,
        trigger: 'scheduled',
        turnEnvironment: input.turnEnvironment ?? null,
        vault: input.vault,
      })
    } catch (error) {
      if (isAssistantCronBackgroundMaintenanceYieldError(error)) {
        summary.processed += 1
        break
      }

      throw error
    }
    summary.processed += 1

    if (assistantCronRunCountsAsProcessSuccess(result.run)) {
      summary.succeeded += 1
    } else if (result.run.outcome === 'failed') {
      summary.failed += 1
    }
    emitAssistantCronJobCompletedEvent({
      errorCode: result.runErrorCode,
      errorMessage: result.run.error,
      errorPresent: result.run.error !== null,
      job: result.job,
      onEvent: input.onEvent,
      routeValidationProfile:
        assistantCronDeliveryRouteValidationProfileForExecutionContext(
          input.executionContext,
        ),
      runOutcome: result.run.outcome,
      sourceKind: claimed.kind === 'canonical' ? claimed.source.kind : 'local',
    })
  }

  return summary
}

export async function pauseUnsupportedLocalEmailAutomations(input: {
  now?: Date
  vault: string
}): Promise<{ pausedAutomationCount: number }> {
  const paths = resolveAssistantStatePaths(input.vault)
  const pausedLocalJobCount = await withAssistantCronWriteLock(paths, async () => {
    const store = await readAssistantCronStore(paths)
    const updatedAt = (input.now ?? new Date()).toISOString()
    let pausedJobCount = 0
    const jobs = store.jobs.map((job) => {
      if (
        !job.enabled ||
        job.target.channel?.trim().toLowerCase() !== 'email'
      ) {
        return job
      }

      pausedJobCount += 1
      return {
        ...job,
        enabled: false,
        updatedAt,
      }
    })

    if (pausedJobCount > 0) {
      await writeAssistantCronStore(paths, {
        ...store,
        jobs,
      })
    }

    return pausedJobCount
  })
  const records = await listCanonicalAssistantCronRecords(input.vault, ['active'])
  let pausedAutomationCount = pausedLocalJobCount

  for (const record of records) {
    if (
      record.kind !== 'automation' ||
      record.route.channel.trim().toLowerCase() !== 'email'
    ) {
      continue
    }

    const pause = async (expectedUpdatedAt: string) =>
      patchAutomation({
        expectedUpdatedAt,
        lookup: record.automationId,
        now: input.now,
        status: 'paused',
        vaultRoot: input.vault,
      })

    try {
      await pause(record.updatedAt)
    } catch (error) {
      if (!isVaultError(error) || error.code !== 'VAULT_AUTOMATION_CONFLICT') {
        throw error
      }
      const refreshed = (
        await listCanonicalAssistantCronRecords(input.vault, ['active'])
      ).find(
        (candidate) =>
          candidate.kind === 'automation' &&
          candidate.automationId === record.automationId,
      )
      if (
        !refreshed ||
        refreshed.kind !== 'automation' ||
        refreshed.route.channel.trim().toLowerCase() !== 'email'
      ) {
        continue
      }
      await pause(refreshed.updatedAt)
    }
    pausedAutomationCount += 1
  }

  return { pausedAutomationCount }
}

function assistantCronRunCountsAsProcessSuccess(
  run: AssistantCronRunRecord,
): boolean {
  return run.outcome === 'delivered' ||
    (run.outcome === 'no_op' &&
      run.reason !== 'background_maintenance_non_replayable_work')
}

export { buildAssistantCronSchedule }

async function emitAssistantCronScanEvents(input: {
  onEvent?: (event: AssistantRunEvent) => void
  paths: ReturnType<typeof resolveAssistantStatePaths>
  routeValidationProfile: AssistantCronDeliveryRouteValidationProfile
  runtimeScopeInput?: AssistantCronRunnableProjectionInput
  vault: string
}): Promise<void> {
  if (!input.onEvent) {
    return
  }

  const [store, canonicalRecords, runtimeStore] = await Promise.all([
    readAssistantCronStore(input.paths),
    listCanonicalAssistantCronRecords(input.vault, ['active']),
    readAssistantCronCanonicalRuntimeStore(input.paths),
  ])
  const nowIso = new Date().toISOString()
  const projection = buildRunnableAssistantCronJobProjection({
    canonicalRecords,
    localStore: store,
    runtimeScopeInput: input.runtimeScopeInput ?? {},
    runtimeStore,
  })
  const visibleLocalStore = projection.visibleLocalStore
  const canonicalEntries = projection.canonicalEntries
  const jobs = projection.jobs
  const dueJobs = jobs.filter((job) => isAssistantCronJobDue(job, nowIso))

  input.onEvent({
    type: 'cron.scan.started',
    details: `${jobs.length} scheduled job(s), ${dueJobs.length} due`,
    safeDetails: 'cron_scan_started',
    failureContext: {
      canonicalJobs: canonicalEntries.length,
      dueJobs: dueJobs.length,
      localJobs: visibleLocalStore.jobs.length,
      loadedJobs: jobs.length,
    },
    providerKind: 'status',
    providerState: 'completed',
  })

  for (const job of jobs.slice(0, 50)) {
    const canonicalEntry = canonicalEntries.find(
      (entry) => resolveCanonicalAssistantCronJobId(entry.source) === job.jobId,
    )
    input.onEvent({
      type: 'cron.scan.job',
      details: 'scheduled job scan decision',
      safeDetails: resolveAssistantCronDueReason(job, nowIso),
      failureContext: {
        activeUntil:
          canonicalEntry?.source.kind === 'automation'
            ? canonicalEntry.source.activeUntil
            : null,
        due: isAssistantCronJobDue(job, nowIso),
        enabled: job.enabled,
        localTime:
          job.schedule.kind === 'dailyLocal' ? job.schedule.localTime : null,
        nextRunAt: job.state.nextRunAt,
        managedAutomationKind:
          canonicalEntry?.source.kind === 'automation' &&
          isRecognizedMurphOnboardingFollowupAutomation(canonicalEntry.source)
            ? 'onboarding_followup'
            : null,
        pendingDelivery: Boolean(job.state.pendingDeliveryIntentId),
        reason: resolveAssistantCronDueReason(job, nowIso),
        routeConfigured: assistantCronJobHasDeliveryRoute(
          job,
          input.routeValidationProfile,
        ),
        running: job.state.runningAt !== null,
        scheduleKind: job.schedule.kind,
        sourceKind: canonicalEntry?.source.kind ?? 'local',
        timeZone:
          canonicalEntry && 'timeZone' in canonicalEntry.source
            ? canonicalEntry.source.timeZone
            : null,
        runtimeStatePresent: canonicalEntry?.runtimeStatePresent ?? true,
      },
      providerKind: 'status',
      providerState: 'completed',
    })
  }
}

function emitAssistantCronJobCompletedEvent(input: {
  errorCode: string | null
  errorMessage: string | null
  errorPresent: boolean
  job: AssistantCronJob
  onEvent?: (event: AssistantRunEvent) => void
  routeValidationProfile: AssistantCronDeliveryRouteValidationProfile
  runOutcome: AssistantCronRunRecord['outcome']
  sourceKind: string
}): void {
  const safeDetails =
    input.runOutcome === 'skipped_gate' && input.errorPresent
      ? 'cron_job_skipped_gate'
      : resolveAssistantCronCompletedSafeDetails(input.runOutcome)

  input.onEvent?.({
    type: 'cron.job.completed',
    details: 'scheduled job run completed',
    safeDetails,
    ...(input.errorMessage
      ? {
          safeErrorMessage: sanitizeAssistantAutomationFailureText(
            input.errorMessage,
          ),
        }
      : {}),
    failureContext: {
      // Typed VaultCliError code (e.g. ASSISTANT_CODEX_USAGE_LIMIT) so
      // provider-level outages are queryable in the persisted hosted runtime
      // log; the June 2026 quota incident was invisible there.
      errorCode: input.errorCode,
      errorPresent: input.errorPresent,
      routeConfigured: assistantCronJobHasDeliveryRoute(
        input.job,
        input.routeValidationProfile,
      ),
      runOutcome: input.runOutcome,
      scheduleKind: input.job.schedule.kind,
      sourceKind: input.sourceKind,
    },
    providerKind: 'status',
    providerState: 'completed',
  })
}

function resolveAssistantCronCompletedSafeDetails(
  outcome: AssistantCronRunRecord['outcome'],
): string {
  switch (outcome) {
    case 'delivered':
      return 'cron_job_delivered'
    case 'delivery_pending':
      return 'cron_job_delivery_pending'
    case 'no_op':
      return 'cron_job_no_op'
    case 'expired':
      return 'cron_job_expired'
    case 'skipped_gate':
      return 'cron_job_skipped_gate'
    case 'failed':
      return 'cron_job_enqueue_failed'
  }
}

function resolveAssistantCronDueReason(job: AssistantCronJob, nowIso: string): string {
  if (!job.enabled) {
    return 'disabled'
  }

  if (job.state.runningAt !== null) {
    return 'running'
  }

  if (job.state.pendingDeliveryIntentId) {
    return 'delivery_pending'
  }

  if (job.state.nextRunAt === null) {
    return 'no_next_run'
  }

  return isAssistantCronJobDue(job, nowIso) ? 'due' : 'not_due'
}

function assistantCronDeliveryRouteValidationProfileForExecutionContext(
  executionContext: AssistantExecutionContext | null | undefined,
): AssistantCronDeliveryRouteValidationProfile {
  const hostedMemberId = executionContext?.hosted?.memberId
  return typeof hostedMemberId === 'string' && hostedMemberId.trim().length > 0
    ? 'hosted'
    : 'local'
}

function assistantCronJobHasDeliveryRoute(
  job: AssistantCronJob,
  profile: AssistantCronDeliveryRouteValidationProfile,
): boolean {
  if (job.scheduledLog) {
    return true
  }

  if (!job.target.channel) {
    return false
  }

  try {
    validateAssistantCronDeliveryTarget(job.target, profile)
    return true
  } catch (error) {
    if (error instanceof VaultCliError) {
      return false
    }
    throw error
  }
}
