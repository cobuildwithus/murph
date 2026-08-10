import { setScheduledLogStatus, upsertAutomation } from '@murphai/core'
import {
  assistantCronJobSchema,
  type AssistantCronJob,
  type AssistantCronTarget,
  type AssistantCronTargetSnapshot,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { AssistantStatePaths } from '../store/paths.js'
import {
  buildCanonicalAutomationUpsertInput,
  buildVisibleLocalAssistantCronStore,
  findCanonicalAssistantCronRecordInList,
  listCanonicalAssistantCronRecords,
  projectCanonicalAssistantCronJob,
  requireCanonicalAssistantCronRecord,
  resolveAssistantCronDefaultTimeZone,
  resolveAssistantCronResolvedSchedule,
  resolveCanonicalAssistantCronJobId,
  resolveCanonicalRuntimeState,
  type CanonicalAssistantCronJobRecord,
  type CanonicalAutomationAssistantCronJobRecord,
} from './canonical-jobs.js'
import {
  readAssistantCronCanonicalRuntimeStore,
  removeAssistantCronCanonicalRuntimeRecord,
  upsertAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
  type AssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeStore,
} from './runtime-state.js'
import { computeAssistantCronNextRunAt } from './schedule.js'
import {
  normalizeRequiredAssistantCronText,
  readAssistantCronStore,
  resolveAssistantCronJobFromStore,
  resolveAssistantCronJobIndex,
  type AssistantCronStore,
  writeAssistantCronStore,
} from './store.js'
import {
  assistantCronTargetAudienceEquals,
  buildAssistantCronTargetSnapshot,
  buildCanonicalAutomationRoute,
  validateAssistantCronDeliveryTarget,
} from './targets.js'

export type ResolvedAssistantCronJobMutation =
  | ResolvedLocalAssistantCronJobMutation
  | ResolvedCanonicalAssistantCronJobMutation

export interface ResolvedLocalAssistantCronJobMutation {
  kind: 'local'
  job: AssistantCronJob
  localJobIndex: number
  paths: AssistantStatePaths
  store: AssistantCronStore
  vault: string
}

export interface ResolvedCanonicalAssistantCronJobMutation {
  kind: 'canonical'
  job: AssistantCronJob
  paths: AssistantStatePaths
  runtimeState: AssistantCronCanonicalRuntimeRecord
  runtimeStore: AssistantCronCanonicalRuntimeStore
  source: CanonicalAssistantCronJobRecord
  store: AssistantCronStore
  vault: string
}

export function tryResolveLocalAssistantCronJob(
  store: AssistantCronStore,
  lookup: string,
): AssistantCronJob | null {
  try {
    return resolveAssistantCronJobFromStore(store, lookup)
  } catch {
    return null
  }
}

export async function resolveAssistantCronJobForMutation(input: {
  job: string
  localVisibility?: 'raw' | 'visible'
  paths: AssistantStatePaths
  vault: string
}): Promise<ResolvedAssistantCronJobMutation> {
  const store = await readAssistantCronStore(input.paths)
  const localVisibility = input.localVisibility ?? 'visible'
  const rawLocalJob =
    localVisibility === 'raw'
      ? tryResolveLocalAssistantCronJob(store, input.job)
      : null

  if (rawLocalJob) {
    return {
      kind: 'local',
      vault: input.vault,
      paths: input.paths,
      store,
      localJobIndex: resolveAssistantCronJobIndex(store, rawLocalJob.jobId),
      job: rawLocalJob,
    }
  }

  const [canonicalRecords, runtimeStore] = await Promise.all([
    listCanonicalAssistantCronRecords(input.vault),
    readAssistantCronCanonicalRuntimeStore(input.paths),
  ])
  const localJob =
    localVisibility === 'visible'
      ? tryResolveLocalAssistantCronJob(
          buildVisibleLocalAssistantCronStore(store),
          input.job,
        )
      : null

  if (localJob) {
    return {
      kind: 'local',
      vault: input.vault,
      paths: input.paths,
      store,
      localJobIndex: resolveAssistantCronJobIndex(store, localJob.jobId),
      job: localJob,
    }
  }

  const source = findCanonicalAssistantCronRecordInList(canonicalRecords, input.job)
  if (!source) {
    throw new VaultCliError(
      'ASSISTANT_CRON_JOB_NOT_FOUND',
      `Assistant cron job "${normalizeRequiredAssistantCronText(input.job, 'job')}" was not found.`,
    )
  }

  const runtimeState = resolveCanonicalRuntimeState(source, runtimeStore)

  return {
    kind: 'canonical',
    vault: input.vault,
    paths: input.paths,
    store,
    source,
    runtimeStore,
    runtimeState,
    job: projectCanonicalAssistantCronJob({
      source,
      runtimeState,
    }),
  }
}

export async function writeResolvedLocalAssistantCronJob(input: {
  job: AssistantCronJob
  resolved: ResolvedLocalAssistantCronJobMutation
}): Promise<AssistantCronJob> {
  input.resolved.store.jobs[input.resolved.localJobIndex] = input.job
  await writeAssistantCronStore(input.resolved.paths, input.resolved.store)
  return input.job
}

export async function removeResolvedLocalAssistantCronJob(
  resolved: ResolvedLocalAssistantCronJobMutation,
): Promise<AssistantCronJob> {
  const [removed] = resolved.store.jobs.splice(resolved.localJobIndex, 1)
  if (!removed) {
    throw new VaultCliError(
      'ASSISTANT_CRON_JOB_NOT_FOUND',
      `Assistant cron job "${resolved.job.name}" was not found.`,
    )
  }

  await writeAssistantCronStore(resolved.paths, resolved.store)
  return removed
}

export function projectResolvedCanonicalAssistantCronJob(input: {
  resolved: ResolvedCanonicalAssistantCronJobMutation
  runtimeState?: AssistantCronCanonicalRuntimeRecord
  source?: CanonicalAssistantCronJobRecord
}): AssistantCronJob {
  return projectCanonicalAssistantCronJob({
    source: input.source ?? input.resolved.source,
    runtimeState: input.runtimeState ?? input.resolved.runtimeState,
  })
}

export async function writeResolvedCanonicalAssistantCronRuntimeState(input: {
  resolved: ResolvedCanonicalAssistantCronJobMutation
  runtimeState: AssistantCronCanonicalRuntimeRecord | null
}): Promise<void> {
  if (input.runtimeState === null) {
    if (
      !removeAssistantCronCanonicalRuntimeRecord(
        input.resolved.runtimeStore,
        resolveCanonicalAssistantCronJobId(input.resolved.source),
      )
    ) {
      return
    }
  } else {
    upsertAssistantCronCanonicalRuntimeRecord(
      input.resolved.runtimeStore,
      input.runtimeState,
    )
  }

  await writeAssistantCronCanonicalRuntimeStore(
    input.resolved.paths,
    input.resolved.runtimeStore,
  )
}

export async function removeResolvedCanonicalAssistantCronSource(
  resolved: ResolvedCanonicalAssistantCronJobMutation,
): Promise<void> {
  switch (resolved.source.kind) {
    case 'automation':
      await upsertAutomation(
        buildCanonicalAutomationUpsertInput({
          vault: resolved.vault,
          automationId: resolved.source.automationId,
          automation: resolved.source,
          title: resolved.source.title,
          status: 'archived',
          schedule: resolved.source.schedule,
          route: resolved.source.route,
          instructions: resolved.source.instructions,
        }),
      )
      break
    case 'scheduledLog':
      await setScheduledLogStatus({
        vaultRoot: resolved.vault,
        scheduledLogId: resolved.source.scheduledLogId,
        status: 'archived',
      })
      break
  }

  await writeResolvedCanonicalAssistantCronRuntimeState({
    resolved,
    runtimeState: null,
  })
}

export async function setResolvedLocalAssistantCronJobEnabled(input: {
  enabled: boolean
  now: Date
  resolved: ResolvedLocalAssistantCronJobMutation
}): Promise<AssistantCronJob> {
  const nextRunAt = input.enabled
    ? resolveAssistantCronReenabledNextRunAt(input.resolved.job, input.now)
    : input.resolved.job.state.nextRunAt
  if (input.enabled && nextRunAt === null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_STATE',
      `Assistant cron job "${input.resolved.job.name}" no longer has a future scheduled run. Run it manually or recreate it with a new schedule.`,
    )
  }
  const target = input.enabled
    ? validateAssistantCronDeliveryTarget(input.resolved.job.target)
    : input.resolved.job.target

  const updated = assistantCronJobSchema.parse({
    ...input.resolved.job,
    enabled: input.enabled,
    target,
    updatedAt: input.now.toISOString(),
    state: {
      ...input.resolved.job.state,
      nextRunAt,
    },
  })

  return writeResolvedLocalAssistantCronJob({
    job: updated,
    resolved: input.resolved,
  })
}

export async function setResolvedCanonicalAssistantCronSourceEnabled(input: {
  enabled: boolean
  now: Date
  resolved: ResolvedCanonicalAssistantCronJobMutation
}): Promise<{
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAssistantCronJobRecord
}> {
  const nextRunAt = input.enabled
    ? computeAssistantCronNextRunAt(
        resolveAssistantCronResolvedSchedule({
          schedule: input.resolved.source.schedule,
          timeZone: input.resolved.source.timeZone,
        }),
        input.now,
      )
    : null

  if (input.enabled && nextRunAt === null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_STATE',
      `Assistant cron job "${input.resolved.job.name}" no longer has a future scheduled run. Run it manually or recreate it with a new schedule.`,
    )
  }

  let source: CanonicalAssistantCronJobRecord = input.resolved.source
  if (input.resolved.source.kind === 'automation') {
    const route = input.enabled
      ? buildCanonicalAutomationRoute(
          validateAssistantCronDeliveryTarget(input.resolved.source.route),
        )
      : input.resolved.source.route
    const updatedAutomation = await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault: input.resolved.vault,
        now: input.now,
        automationId: input.resolved.source.automationId,
        automation: input.resolved.source,
        title: input.resolved.source.title,
        status: input.enabled ? 'active' : 'paused',
        schedule: input.resolved.source.schedule,
        route,
        instructions: input.resolved.source.instructions,
      }),
    )
    source = requireCanonicalAssistantCronRecord(
      updatedAutomation.record,
      await resolveAssistantCronDefaultTimeZone(input.resolved.vault),
    ) as CanonicalAutomationAssistantCronJobRecord
  } else {
    await setScheduledLogStatus({
      vaultRoot: input.resolved.vault,
      scheduledLogId: input.resolved.source.scheduledLogId,
      status: input.enabled ? 'active' : 'paused',
    })
    source = {
      ...input.resolved.source,
      status: input.enabled ? 'active' : 'paused',
      updatedAt: input.now.toISOString(),
    }
  }

  return {
    source,
    runtimeState: {
      ...input.resolved.runtimeState,
      updatedAt: input.now.toISOString(),
      state: {
        ...input.resolved.runtimeState.state,
        activatedAt: input.enabled
          ? input.now.toISOString()
          : input.resolved.runtimeState.state.activatedAt,
        pendingOccurrenceAt: null,
        retryAfterAt: null,
      },
    },
  }
}

export async function setResolvedLocalAssistantCronJobTarget(input: {
  now: string
  resolved: ResolvedLocalAssistantCronJobMutation
  target: AssistantCronTarget
}): Promise<AssistantCronJob> {
  return writeResolvedLocalAssistantCronJob({
    job: assistantCronJobSchema.parse({
      ...input.resolved.job,
      updatedAt: input.now,
      target: input.target,
    }),
    resolved: input.resolved,
  })
}

export async function updateResolvedCanonicalAssistantCronAutomationTarget(input: {
  now: string
  resolved: ResolvedCanonicalAssistantCronJobMutation
  target: AssistantCronTarget
}): Promise<{
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAutomationAssistantCronJobRecord
}> {
  if (input.resolved.source.kind !== 'automation') {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_REQUIRED',
      `Canonical auto-log job "${input.resolved.job.name}" does not support assistant delivery targeting.`,
    )
  }

  const updatedAutomation = await upsertAutomation(
    buildCanonicalAutomationUpsertInput({
      vault: input.resolved.vault,
      now: new Date(input.now),
      automationId: input.resolved.source.automationId,
      automation: input.resolved.source,
      title: input.resolved.source.title,
      status: input.resolved.source.status,
      schedule: input.resolved.source.schedule,
      route: buildCanonicalAutomationRoute(input.target),
      instructions: input.resolved.source.instructions,
    }),
  )

  return {
    source: requireCanonicalAssistantCronRecord(
      updatedAutomation.record,
      await resolveAssistantCronDefaultTimeZone(input.resolved.vault),
    ) as CanonicalAutomationAssistantCronJobRecord,
    runtimeState: {
      ...input.resolved.runtimeState,
      alias: input.target.alias,
      sessionId: input.target.sessionId,
      updatedAt: input.now,
    },
  }
}

export function buildAssistantCronTargetMutationPreview(input: {
  continuityAlias: string | null
  continuitySessionId: string | null
  job: AssistantCronJob
  nextTarget: AssistantCronTarget
  resetContinuity?: boolean
}): {
  afterTarget: AssistantCronTargetSnapshot
  beforeTarget: AssistantCronTargetSnapshot
  changed: boolean
  continuityReset: boolean
} {
  const beforeTarget = buildAssistantCronTargetSnapshot(input.job)
  const continuityReset =
    input.resetContinuity === true &&
    (input.continuitySessionId !== null || input.continuityAlias !== null)
  const afterTarget = buildAssistantCronTargetSnapshot({
    ...input.job,
    target: {
      ...input.nextTarget,
      sessionId: continuityReset ? null : input.continuitySessionId,
      alias: continuityReset ? null : input.continuityAlias,
    },
  })

  return {
    beforeTarget,
    afterTarget,
    changed: !assistantCronTargetAudienceEquals(
      beforeTarget.target,
      afterTarget.target,
    ),
    continuityReset,
  }
}

export function assertResolvedAssistantCronJobNotRunning(
  resolved: ResolvedAssistantCronJobMutation,
): void {
  const runningAt =
    resolved.kind === 'canonical'
      ? resolved.runtimeState.state.runningAt
      : resolved.job.state.runningAt

  if (runningAt !== null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_JOB_RUNNING',
      `Assistant cron job "${resolved.job.name}" is already running.`,
    )
  }
}

function resolveAssistantCronReenabledNextRunAt(
  job: AssistantCronJob,
  now: Date,
): string | null {
  if (job.schedule.kind === 'at') {
    const oneShotTime = new Date(job.schedule.at)
    return oneShotTime.getTime() > now.getTime() ? oneShotTime.toISOString() : null
  }

  return computeAssistantCronNextRunAt(job.schedule, now)
}
