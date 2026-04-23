import { setScheduledLogStatus, upsertAutomation } from '@murphai/core'
import { showAutomation as showCanonicalAutomation } from '@murphai/query'
import {
  assistantCronJobSchema,
  assistantCronScheduleSchema,
  assistantCronTargetSchema,
  type AssistantCronJob,
  type AssistantCronPreset,
  type AssistantCronRunRecord,
  type AssistantCronSchedule,
  type AssistantCronScheduleInput,
  type AssistantCronTarget,
  type AssistantCronTargetSnapshot,
  type AssistantCronTrigger,
  type AssistantBindingDelivery,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { withAssistantCronWriteLock } from './cron/locking.ts'
import {
  buildAssistantCronSchedule,
  computeAssistantCronNextRunAt,
} from './cron/schedule.ts'
import {
  getAssistantCronPresetDefinition,
  listAssistantCronPresets as listBuiltinAssistantCronPresets,
  renderAssistantCronPreset,
  type AssistantCronPresetDefinition,
} from './cron/presets.ts'
import {
  assertAssistantCronJobNameIsAvailable,
  buildAssistantCronTarget,
  createAssistantCronJobId,
  ensureAssistantCronState,
  isAssistantCronJobDue,
  normalizeRequiredAssistantCronText,
  readAssistantCronRuns,
  readAssistantCronStore,
  resolveAssistantCronJobFromStore,
  resolveAssistantCronJobIndex,
  resolveAssistantCronRunLookupId,
  sortAssistantCronJobs,
  type AssistantCronStore,
  type AssistantCronTargetInput,
  writeAssistantCronStore,
} from './cron/store.ts'
import {
  createAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
  removeAssistantCronCanonicalRuntimeRecord,
  upsertAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
  type AssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeStore,
} from './cron/runtime-state.ts'
import { clearCanonicalFoodAutoLogSchedule } from './cron/food-auto-log.ts'
import {
  ASSISTANT_CRON_JOB_SCHEMA,
  buildCanonicalAutomationRoute,
  buildCanonicalAutomationUpsertInput,
  buildCanonicalFoodIdSet,
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
  type ResolvedAssistantCronJob,
} from './cron/canonical-jobs.ts'
import {
  claimNextDueAssistantCronJob,
  claimResolvedAssistantCronJob,
  executeClaimedAssistantCronJob,
} from './cron/execution.ts'
import { getAssistantChannelAdapter } from './channel-adapters.ts'
import { resolveAssistantBindingDelivery } from './bindings.ts'
import { applyAssistantSelfDeliveryTargetDefaults } from '@murphai/operator-config/operator-config'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from './store/paths.ts'
import type { AssistantOutboxDispatchMode } from './outbox.ts'
import { normalizeNullableString } from './shared.ts'
import type { AssistantExecutionContext } from './execution-context.ts'

export type { AssistantCronTargetSnapshot } from '@murphai/operator-config/assistant-cli-contracts'

interface AssistantCronJobCreationBaseInput {
  enabled?: boolean
  keepAfterRun?: boolean
  name: string
  now?: Date
  prompt: string
  schedule: AssistantCronScheduleInput
  vault: string
}

export interface AddAssistantCronJobInput
  extends AssistantCronJobCreationBaseInput,
    AssistantCronTargetInput {
  foodAutoLog?: {
    foodId: string
  }
}

interface AddAssistantFoodAutoLogCronJobInput
  extends AssistantCronJobCreationBaseInput {
  foodAutoLog: {
    foodId: string
  }
}

export interface AssistantCronStatusSnapshot {
  dueJobs: number
  enabledJobs: number
  nextRunAt: string | null
  runningJobs: number
  totalJobs: number
}

export interface AssistantCronRunExecutionResult {
  job: AssistantCronJob
  removedAfterRun: boolean
  run: AssistantCronRunRecord
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
  job: string
  signal?: AbortSignal
  trigger?: AssistantCronTrigger
  vault: string
}

export interface ProcessDueAssistantCronJobsInput {
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  limit?: number
  signal?: AbortSignal
  vault: string
}

export interface SetAssistantCronJobTargetInput extends AssistantCronTargetInput {
  dryRun?: boolean
  job: string
  now?: Date
  resetContinuity?: boolean
  vault: string
}

export interface InstallAssistantCronPresetInput extends AssistantCronTargetInput {
  additionalInstructions?: string | null
  enabled?: boolean
  name?: string | null
  presetId: string
  schedule?: AssistantCronScheduleInput | null
  variables?: Record<string, string | null | undefined> | null
  vault: string
}

export interface InstallAssistantCronPresetResult {
  job: AssistantCronJob
  preset: AssistantCronPreset
  resolvedPrompt: string
  resolvedVariables: Record<string, string>
}

type ResolvedAssistantCronJobMutation =
  | ResolvedLocalAssistantCronJobMutation
  | ResolvedCanonicalAssistantCronJobMutation

interface ResolvedLocalAssistantCronJobMutation {
  kind: 'local'
  job: AssistantCronJob
  localJobIndex: number
  paths: AssistantStatePaths
  store: AssistantCronStore
  vault: string
}

interface ResolvedCanonicalAssistantCronJobMutation {
  kind: 'canonical'
  job: AssistantCronJob
  paths: AssistantStatePaths
  runtimeState: AssistantCronCanonicalRuntimeRecord
  runtimeStore: AssistantCronCanonicalRuntimeStore
  source: CanonicalAssistantCronJobRecord
  store: AssistantCronStore
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

export async function installAssistantCronPreset(
  input: InstallAssistantCronPresetInput,
): Promise<InstallAssistantCronPresetResult> {
  const rendered = renderAssistantCronPreset({
    presetId: input.presetId,
    variables: input.variables,
    additionalInstructions: input.additionalInstructions,
  })
  const resolvedName = normalizeNullableString(input.name) ?? rendered.preset.suggestedName
  const schedule = input.schedule ?? rendered.preset.suggestedSchedule
  const job = await addAssistantCronJob({
    vault: input.vault,
    name: resolvedName,
    prompt: rendered.resolvedPrompt,
    schedule,
    enabled: input.enabled,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    participantId: input.participantId,
    threadId: input.threadId,
    deliveryTarget: input.deliveryTarget,
  })

  return {
    preset: rendered.preset,
    job,
    resolvedPrompt: rendered.resolvedPrompt,
    resolvedVariables: rendered.resolvedVariables,
  }
}

export async function addAssistantCronJob(
  input: AddAssistantCronJobInput,
): Promise<AssistantCronJob> {
  const resolvedInput = await resolveAssistantCronTargetDefaults(input)
  const { foodAutoLog } = resolvedInput
  if (foodAutoLog) {
    return addAssistantFoodAutoLogCronJob({
      vault: resolvedInput.vault,
      name: resolvedInput.name,
      prompt: resolvedInput.prompt,
      schedule: resolvedInput.schedule,
      now: resolvedInput.now,
      enabled: resolvedInput.enabled,
      keepAfterRun: resolvedInput.keepAfterRun,
      foodAutoLog,
      target: buildAssistantCronTarget(resolvedInput),
    })
  }

  const resolvedCreation = await resolveAssistantCronJobCreationInput(resolvedInput)
  const target = validateAssistantCronDeliveryTarget(resolvedInput)

  return withAssistantCronWriteLock(resolvedCreation.paths, async () => {
    const localStore = await readAssistantCronStore(resolvedCreation.paths)
    assertAssistantCronJobNameIsAvailable(localStore, resolvedCreation.name)

    const existingAutomation = await showCanonicalAutomation(
      resolvedCreation.vault,
      resolvedCreation.name,
    )
    if (existingAutomation && existingAutomation.status !== 'archived') {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_EXISTS',
        `Assistant cron job "${resolvedCreation.name}" already exists.`,
      )
    }

    const created = await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault: resolvedCreation.vault,
        automationId: existingAutomation?.automationId,
        automation: existingAutomation,
        title: resolvedCreation.name,
        status: resolvedCreation.enabled ? 'active' : 'paused',
        schedule: resolvedCreation.schedule,
        route: buildCanonicalAutomationRoute(target),
        instructions: resolvedCreation.prompt,
      }),
    )
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(
      resolvedCreation.paths,
    )
    const timeZone = await resolveAssistantCronDefaultTimeZone(resolvedCreation.vault)
    const source = requireCanonicalAssistantCronRecord(
      created.record,
      timeZone,
    ) as CanonicalAutomationAssistantCronJobRecord
    const runtimeState = createAssistantCronCanonicalRuntimeRecord({
      jobId: source.automationId,
      now: resolvedCreation.now.toISOString(),
      sessionId: target.sessionId,
      alias: target.alias,
    })
    upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, runtimeState)
    await writeAssistantCronCanonicalRuntimeStore(
      resolvedCreation.paths,
      runtimeStore,
    )

    return projectCanonicalAssistantCronJob({
      source,
      runtimeState,
    })
  })
}

async function addAssistantFoodAutoLogCronJob(
  input: AddAssistantFoodAutoLogCronJobInput & {
    target: AssistantCronTarget
  },
): Promise<AssistantCronJob> {
  const resolvedCreation = await resolveAssistantCronJobCreationInput(input)

  return withAssistantCronWriteLock(resolvedCreation.paths, async () => {
    const store = await readAssistantCronStore(resolvedCreation.paths)
    assertAssistantCronJobNameIsAvailable(store, resolvedCreation.name)

    const timestamp = resolvedCreation.now.toISOString()
    const job = assistantCronJobSchema.parse({
      schema: ASSISTANT_CRON_JOB_SCHEMA,
      jobId: createAssistantCronJobId(),
      name: resolvedCreation.name,
      enabled: resolvedCreation.enabled,
      keepAfterRun: resolvedCreation.keepAfterRun,
      prompt: resolvedCreation.prompt,
      schedule: resolvedCreation.schedule,
      target: input.target,
      foodAutoLog: input.foodAutoLog,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: {
        nextRunAt: resolvedCreation.nextRunAt,
        lastRunAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveFailures: 0,
        lastError: null,
        runningAt: null,
        runningPid: null,
      },
    })

    store.jobs.push(job)
    await writeAssistantCronStore(resolvedCreation.paths, store)
    return job
  })
}

async function resolveAssistantCronJobCreationInput(
  input: AssistantCronJobCreationBaseInput,
): Promise<{
  enabled: boolean
  keepAfterRun: boolean
  name: string
  nextRunAt: string | null
  now: Date
  paths: AssistantStatePaths
  prompt: string
  schedule: AssistantCronSchedule
  vault: string
}> {
  const now = input.now ?? new Date()
  const name = normalizeRequiredAssistantCronText(input.name, 'name')
  const prompt = normalizeRequiredAssistantCronText(input.prompt, 'prompt')
  const enabled = input.enabled ?? true
  const resolvedSchedule = await resolveAssistantCronScheduleForVault(
    input.vault,
    input.schedule,
  )
  const schedule = assistantCronScheduleSchema.parse(input.schedule)
  const keepAfterRun =
    schedule.kind === 'at'
      ? input.keepAfterRun ?? false
      : true
  const nextRunAt = computeAssistantCronNextRunAt(resolvedSchedule, now)

  if (enabled && nextRunAt === null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The assistant cron schedule does not produce a future run time.',
    )
  }

  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(paths)

  return {
    vault: input.vault,
    paths,
    now,
    name,
    prompt,
    enabled,
    schedule,
    keepAfterRun,
    nextRunAt,
  }
}

async function resolveAssistantCronTargetDefaults<
  TInput extends AssistantCronTargetInput,
>(
  input: TInput,
): Promise<TInput> {
  const resolvedTarget = await applyAssistantSelfDeliveryTargetDefaults(
    {
      channel: input.channel,
      identityId: input.identityId,
      participantId: input.participantId,
      threadId: input.threadId,
      deliveryTarget: input.deliveryTarget,
    },
    {
      allowSingleSavedTargetFallback: true,
    },
  )

  return {
    ...input,
    channel: resolvedTarget.channel ?? undefined,
    identityId: resolvedTarget.identityId ?? undefined,
    participantId: resolvedTarget.participantId ?? undefined,
    threadId: resolvedTarget.threadId ?? undefined,
    deliveryTarget: resolvedTarget.deliveryTarget ?? undefined,
  } as TInput
}

async function projectResolvedAssistantCronJob(
  vault: string,
  lookup: string,
): Promise<ResolvedAssistantCronJob> {
  const paths = resolveAssistantStatePaths(vault)
  const [localStore, canonicalRecords, runtimeStore] = await Promise.all([
    readAssistantCronStore(paths),
    listCanonicalAssistantCronRecords(vault),
    readAssistantCronCanonicalRuntimeStore(paths),
  ])
  const canonicalFoodIds = buildCanonicalFoodIdSet(canonicalRecords)
  const visibleLocalStore = buildVisibleLocalAssistantCronStore(
    localStore,
    canonicalFoodIds,
  )
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

function tryResolveLocalAssistantCronJob(
  store: Awaited<ReturnType<typeof readAssistantCronStore>>,
  lookup: string,
  options: {
    allowFoodAutoLog?: boolean
  } = {},
): AssistantCronJob | null {
  try {
    const resolved = resolveAssistantCronJobFromStore(store, lookup)
    if (options.allowFoodAutoLog === false && resolved.foodAutoLog) {
      return null
    }

    return resolved
  } catch {
    return null
  }
}

async function resolveAssistantCronJobForMutation(input: {
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
          buildVisibleLocalAssistantCronStore(
            store,
            buildCanonicalFoodIdSet(canonicalRecords),
          ),
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

async function writeResolvedLocalAssistantCronJob(input: {
  job: AssistantCronJob
  resolved: ResolvedLocalAssistantCronJobMutation
}): Promise<AssistantCronJob> {
  input.resolved.store.jobs[input.resolved.localJobIndex] = input.job
  await writeAssistantCronStore(input.resolved.paths, input.resolved.store)
  return input.job
}

async function removeResolvedLocalAssistantCronJob(
  resolved: ResolvedLocalAssistantCronJobMutation,
): Promise<AssistantCronJob> {
  const [removed] = resolved.store.jobs.splice(resolved.localJobIndex, 1)
  await writeAssistantCronStore(resolved.paths, resolved.store)
  return removed as AssistantCronJob
}

function projectResolvedCanonicalAssistantCronJob(input: {
  resolved: ResolvedCanonicalAssistantCronJobMutation
  runtimeState?: AssistantCronCanonicalRuntimeRecord
  source?: CanonicalAssistantCronJobRecord
}): AssistantCronJob {
  return projectCanonicalAssistantCronJob({
    source: input.source ?? input.resolved.source,
    runtimeState: input.runtimeState ?? input.resolved.runtimeState,
  })
}

async function writeResolvedCanonicalAssistantCronRuntimeState(input: {
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

async function removeResolvedCanonicalAssistantCronSource(
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
    case 'foodAutoLog': {
      const foodId = resolved.source.foodId
      await clearCanonicalFoodAutoLogSchedule(resolved.vault, foodId)
      const nextLocalJobs = resolved.store.jobs.filter(
        (entry) => entry.foodAutoLog?.foodId !== foodId,
      )
      if (nextLocalJobs.length !== resolved.store.jobs.length) {
        resolved.store.jobs = nextLocalJobs
        await writeAssistantCronStore(resolved.paths, resolved.store)
      }
      break
    }
  }

  await writeResolvedCanonicalAssistantCronRuntimeState({
    resolved,
    runtimeState: null,
  })
}

async function setResolvedCanonicalAssistantCronSourceEnabled(input: {
  enabled: boolean
  now: Date
  resolved: ResolvedCanonicalAssistantCronJobMutation
}): Promise<{
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAssistantCronJobRecord
}> {
  if (input.resolved.source.kind === 'foodAutoLog') {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_STATE',
      `Recurring food auto-log job "${input.resolved.job.name}" is controlled by the canonical food record, not assistant cron enable/disable.`,
    )
  }

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
    const updatedAutomation = await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault: input.resolved.vault,
        automationId: input.resolved.source.automationId,
        automation: input.resolved.source,
        title: input.resolved.source.title,
        status: input.enabled ? 'active' : 'paused',
        schedule: input.resolved.source.schedule,
        route: input.resolved.source.route,
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

async function updateResolvedCanonicalAssistantCronAutomationTarget(input: {
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

function buildAssistantCronTargetMutationPreview(input: {
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

function assertResolvedAssistantCronJobNotRunning(
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

export async function listAssistantCronJobs(
  vault: string,
): Promise<AssistantCronJob[]> {
  const paths = resolveAssistantStatePaths(vault)
  const [localStore, canonicalRecords, runtimeStore] = await Promise.all([
    readAssistantCronStore(paths),
    listCanonicalAssistantCronRecords(vault),
    readAssistantCronCanonicalRuntimeStore(paths),
  ])
  const canonicalFoodIds = buildCanonicalFoodIdSet(canonicalRecords)

  return sortAssistantCronJobs([
    ...buildVisibleLocalAssistantCronStore(localStore, canonicalFoodIds).jobs,
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
    const now = new Date()

    if (resolved.kind === 'local') {
      const nextRunAt = enabled
        ? resolveAssistantCronReenabledNextRunAt(resolved.job, now)
        : resolved.job.state.nextRunAt
      if (enabled && nextRunAt === null) {
        throw new VaultCliError(
          'ASSISTANT_CRON_INVALID_STATE',
          `Assistant cron job "${resolved.job.name}" no longer has a future scheduled run. Run it manually or recreate it with a new schedule.`,
        )
      }

      const updated = assistantCronJobSchema.parse({
        ...resolved.job,
        enabled,
        updatedAt: now.toISOString(),
        state: {
          ...resolved.job.state,
          nextRunAt,
        },
      })

      return writeResolvedLocalAssistantCronJob({
        job: updated,
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
      const updated = await writeResolvedLocalAssistantCronJob({
        job: assistantCronJobSchema.parse({
          ...resolved.job,
          updatedAt: now,
          target: preview.afterTarget.target,
        }),
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
): Promise<AssistantCronStatusSnapshot> {
  const canonicalJobs = await listAssistantCronJobs(vault)
  const now = new Date().toISOString()
  const enabledJobs = canonicalJobs.filter((job) => job.enabled)
  const dueJobs = enabledJobs.filter((job) => isAssistantCronJobDue(job, now)).length
  const runningJobs = canonicalJobs.filter((job) => job.state.runningAt !== null).length
  const nextRunAt =
    enabledJobs
      .map((job) => job.state.nextRunAt)
      .filter((value): value is string => value !== null)
      .sort((left, right) => left.localeCompare(right))[0] ?? null

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

  const claimed = await withAssistantCronWriteLock(paths, async () => {
    const resolved = await resolveAssistantCronJobForMutation({
      job: input.job,
      localVisibility: 'raw',
      paths,
      vault: input.vault,
    })

    return claimResolvedAssistantCronJob({
      paths,
      job:
        resolved.kind === 'local'
          ? {
              kind: 'local',
              job: resolved.job,
            }
          : {
              kind: 'canonical',
              source: resolved.source,
              runtimeState: resolved.runtimeState,
              job: resolved.job,
            },
    })
  })

  return executeClaimedAssistantCronJob({
    paths,
    signal: input.signal,
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

  while (!input.signal?.aborted && summary.processed < limit) {
    const claimed = await claimNextDueAssistantCronJob(paths, input.vault)
    if (!claimed) {
      break
    }

    const result = await executeClaimedAssistantCronJob({
      deliveryDispatchMode: input.deliveryDispatchMode,
      executionContext: input.executionContext,
      paths,
      signal: input.signal,
      trigger: 'scheduled',
      vault: input.vault,
      job: claimed,
    })
    summary.processed += 1

    if (result.run.status === 'succeeded') {
      summary.succeeded += 1
    } else if (result.run.status === 'failed') {
      summary.failed += 1
    }
  }

  return summary
}

export { buildAssistantCronSchedule }

function buildAssistantCronNoDeliveryTarget(): AssistantCronTarget {
  return assistantCronTargetSchema.parse({
    alias: null,
    channel: null,
    deliveryTarget: null,
    identityId: null,
    participantId: null,
    sessionId: null,
    threadId: null,
  })
}

function validateAssistantCronDeliveryTarget(
  input: AssistantCronTargetInput,
): AssistantCronTarget {
  const channel = normalizeNullableString(input.channel)
  if (!channel) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_REQUIRED',
      'Assistant cron jobs must declare an outbound channel and delivery route. Pass --channel plus --thread, --participant, or --deliveryTarget. Cron jobs send a single notification message to the bound route.',
    )
  }

  if (!getAssistantChannelAdapter(channel)) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_UNSUPPORTED',
      `Outbound delivery for channel "${channel}" is not supported in this build.`,
    )
  }

  const identityId = normalizeNullableString(input.identityId)
  if (channel === 'email' && !identityId) {
    throw new VaultCliError(
      'ASSISTANT_EMAIL_IDENTITY_REQUIRED',
      'Email cron jobs require a configured email sender identity. Pass --identity with the email address or provider identity you want to send from.',
    )
  }

  const participantId = normalizeNullableString(input.participantId)
  const threadId = normalizeNullableString(input.threadId)
  const deliveryTarget = normalizeNullableString(input.deliveryTarget)
  const bindingDelivery = resolveAssistantBindingDelivery({
    channel,
    actorId: participantId,
    threadId,
  })

  if (!deliveryTarget && !bindingDelivery) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_REQUIRED',
      'Assistant cron jobs must bind an explicit outbound route. Pass --thread, --participant, or --deliveryTarget for the selected channel.',
    )
  }

  return buildAssistantCronTarget({
    ...input,
    channel,
    identityId,
    participantId,
    threadId,
    deliveryTarget,
  })
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

async function resolveAssistantCronScheduleForVault(
  vault: string,
  schedule: AssistantCronScheduleInput,
): Promise<
  | AssistantCronSchedule
  | ({ kind: 'cron'; expression: string; timeZone: string })
  | ({ kind: 'dailyLocal'; localTime: string; timeZone: string })
> {
  const publicSchedule = assistantCronScheduleSchema.parse(schedule)
  if (publicSchedule.kind === 'cron' || publicSchedule.kind === 'dailyLocal') {
    return resolveAssistantCronResolvedSchedule({
      schedule: publicSchedule,
      timeZone: await resolveAssistantCronDefaultTimeZone(vault),
    })
  }

  return publicSchedule
}

function buildAssistantCronTargetSnapshot(
  job: Pick<AssistantCronJob, 'jobId' | 'name' | 'target'>,
): AssistantCronTargetSnapshot {
  return {
    jobId: job.jobId,
    jobName: job.name,
    target: job.target,
    bindingDelivery: resolveAssistantBindingDelivery({
      channel: job.target.channel,
      actorId: job.target.participantId,
      threadId: job.target.threadId,
      deliveryTarget: job.target.deliveryTarget,
    }) as AssistantBindingDelivery | null,
  }
}

function assistantCronTargetAudienceEquals(
  left: Pick<
    AssistantCronTarget,
    'channel' | 'deliveryTarget' | 'identityId' | 'participantId' | 'threadId'
  >,
  right: Pick<
    AssistantCronTarget,
    'channel' | 'deliveryTarget' | 'identityId' | 'participantId' | 'threadId'
  >,
): boolean {
  return (
    left.channel === right.channel &&
    left.identityId === right.identityId &&
    left.participantId === right.participantId &&
    left.threadId === right.threadId &&
    left.deliveryTarget === right.deliveryTarget
  )
}
