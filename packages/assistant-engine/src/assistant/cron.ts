import { resolveSystemTimeZone } from '@murphai/contracts'
import { loadVault, upsertAutomation } from '@murphai/core'
import {
  listAutomations as listCanonicalAutomations,
  showAutomation as showCanonicalAutomation,
  type AutomationQueryRecord,
} from '@murphai/query'
import {
  assistantCronJobSchema,
  assistantCronRunRecordSchema,
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
} from '../assistant-cli-contracts.ts'
import { loadRuntimeModule } from '@murphai/vault-usecases/runtime-import'
import { renderAutoLoggedFoodMealNote } from '@murphai/vault-usecases/usecases/food-autolog'
import { loadImporterRuntime } from '@murphai/vault-usecases/usecases/runtime'
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
  appendAssistantCronRun,
  assertAssistantCronJobNameIsAvailable,
  buildAssistantCronTarget,
  createAssistantCronJobId,
  createAssistantCronRunId,
  ensureAssistantCronState,
  isAssistantCronJobDue,
  normalizeRequiredAssistantCronText,
  readAssistantCronRuns,
  readAssistantCronStore,
  resolveAssistantCronJobFromStore,
  resolveAssistantCronJobIndex,
  resolveAssistantCronRunLookupId,
  sortAssistantCronJobs,
  type AssistantCronTargetInput,
  writeAssistantCronStore,
} from './cron/store.ts'
import {
  createAssistantCronAutomationRuntimeRecord,
  findAssistantCronAutomationRuntimeRecord,
  readAssistantCronAutomationRuntimeStore,
  removeAssistantCronAutomationRuntimeRecord,
  upsertAssistantCronAutomationRuntimeRecord,
  writeAssistantCronAutomationRuntimeStore,
  type AssistantCronAutomationRuntimeRecord,
} from './cron/runtime-state.ts'
import { sendAssistantMessageLocal } from '../assistant-service.ts'
import { getAssistantChannelAdapter } from './channel-adapters.ts'
import { resolveAssistantBindingDelivery } from './bindings.ts'
import { applyAssistantSelfDeliveryTargetDefaults } from '@murphai/operator-config/operator-config'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from './store/paths.ts'
import type { AssistantOutboxDispatchMode } from './outbox.ts'
import { errorMessage, normalizeNullableString } from './shared.ts'
import type { AssistantExecutionContext } from './execution-context.ts'

export type { AssistantCronTargetSnapshot } from '../assistant-cli-contracts.ts'

const ASSISTANT_CRON_JOB_SCHEMA = 'murph.assistant-cron-job.v1'
const ASSISTANT_CRON_RUN_SCHEMA = 'murph.assistant-cron-run.v1'
const ASSISTANT_CRON_MAX_RESPONSE_LENGTH = 4_000

interface FoodAutoLogRecord {
  foodId: string
  title: string
  summary?: string
  serving?: string
  ingredients?: string[]
  note?: string
}

interface FoodAutoLogCoreRuntime {
  readFood(input: {
    vaultRoot: string
    foodId?: string
    slug?: string
  }): Promise<FoodAutoLogRecord>
}

export interface AddAssistantCronJobInput extends AssistantCronTargetInput {
  enabled?: boolean
  foodAutoLog?: {
    foodId: string
  }
  keepAfterRun?: boolean
  name: string
  now?: Date
  prompt: string
  schedule: AssistantCronScheduleInput
  vault: string
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

interface CanonicalAssistantCronJobRecord extends AutomationQueryRecord {
  status: 'active' | 'paused'
}

type ResolvedAssistantCronJob =
  | {
      kind: 'automation'
      automation: CanonicalAssistantCronJobRecord
      job: AssistantCronJob
      runtimeState: AssistantCronAutomationRuntimeRecord
    }
  | {
      kind: 'local'
      job: AssistantCronJob
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
    sourceThreadId: input.sourceThreadId,
    deliverResponse: input.deliverResponse,
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
  const paths = resolveAssistantStatePaths(input.vault)
  const now = resolvedInput.now ?? new Date()
  const name = normalizeRequiredAssistantCronText(resolvedInput.name, 'name')
  const prompt = normalizeRequiredAssistantCronText(resolvedInput.prompt, 'prompt')
  const enabled = resolvedInput.enabled ?? true
  const schedule = await resolveAssistantCronScheduleForVault(
    input.vault,
    resolvedInput.schedule,
  )
  const keepAfterRun =
    schedule.kind === 'at'
      ? resolvedInput.keepAfterRun ?? false
      : true
  const nextRunAt = computeAssistantCronNextRunAt(schedule, now)

  if (enabled && nextRunAt === null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The assistant cron schedule does not produce a future run time.',
    )
  }

  await ensureAssistantCronState(paths)
  const target = buildValidatedAssistantCronTarget(resolvedInput)

  if (!resolvedInput.foodAutoLog) {
    return withAssistantCronWriteLock(paths, async () => {
      const localStore = await readAssistantCronStore(paths)
      assertAssistantCronJobNameIsAvailable(localStore, name)

      const existingAutomation = await showCanonicalAutomation(input.vault, name)
      if (existingAutomation && existingAutomation.status !== 'archived') {
        throw new VaultCliError(
          'ASSISTANT_CRON_JOB_EXISTS',
          `Assistant cron job "${name}" already exists.`,
        )
      }

      const created = await upsertAutomation(
        buildCanonicalAutomationUpsertInput({
          vault: input.vault,
          automationId: existingAutomation?.automationId,
          automation: existingAutomation,
          title: name,
          status: enabled ? 'active' : 'paused',
          schedule,
          route: buildCanonicalAutomationRoute(target),
          prompt,
        }),
      )
      const runtimeStore = await readAssistantCronAutomationRuntimeStore(paths)
      const runtimeState = createAssistantCronAutomationRuntimeRecord({
        automationId: created.record.automationId,
        nextRunAt,
        now: now.toISOString(),
        sessionId: target.sessionId,
        alias: target.alias,
      })
      upsertAssistantCronAutomationRuntimeRecord(runtimeStore, runtimeState)
      await writeAssistantCronAutomationRuntimeStore(paths, runtimeStore)

      return projectCanonicalAssistantCronJob({
        automation: {
          ...created.record,
          status: created.record.status as 'active' | 'paused',
        },
        runtimeState,
      })
    })
  }

  return withAssistantCronWriteLock(paths, async () => {
    const store = await readAssistantCronStore(paths)
    assertAssistantCronJobNameIsAvailable(store, name)

    const timestamp = now.toISOString()
    const jobId = createAssistantCronJobId()
    const job = assistantCronJobSchema.parse({
      schema: ASSISTANT_CRON_JOB_SCHEMA,
      jobId,
      name,
      enabled,
      keepAfterRun,
      prompt,
      schedule,
      target,
      foodAutoLog: resolvedInput.foodAutoLog,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: {
        nextRunAt,
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
    await writeAssistantCronStore(paths, store)
    return job
  })
}

async function resolveAssistantCronTargetDefaults<
  TInput extends AssistantCronTargetInput,
>(
  input: TInput,
): Promise<TInput> {
  if ('foodAutoLog' in input && input.foodAutoLog) {
    return input
  }

  const resolvedTarget = await applyAssistantSelfDeliveryTargetDefaults(
    {
      channel: input.channel,
      identityId: input.identityId,
      participantId: input.participantId,
      sourceThreadId: input.sourceThreadId,
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
    sourceThreadId: resolvedTarget.sourceThreadId ?? undefined,
    deliveryTarget: resolvedTarget.deliveryTarget ?? undefined,
  } as TInput
}

async function listCanonicalAssistantCronRecords(
  vault: string,
  status: ReadonlyArray<'active' | 'paused'> = ['active', 'paused'],
): Promise<CanonicalAssistantCronJobRecord[]> {
  const records = await listCanonicalAutomations(vault, {
    status: [...status],
  })

  return records.filter(
    (record): record is CanonicalAssistantCronJobRecord =>
      record.status === 'active' || record.status === 'paused',
  )
}

async function findCanonicalAssistantCronRecord(
  vault: string,
  lookup: string,
): Promise<CanonicalAssistantCronJobRecord | null> {
  const record = await showCanonicalAutomation(vault, lookup)
  if (!record || record.status === 'archived') {
    return null
  }

  if (record.status !== 'active' && record.status !== 'paused') {
    return null
  }

  return {
    ...record,
    status: record.status,
  }
}

function createInitialCanonicalAutomationRuntimeState(
  automation: CanonicalAssistantCronJobRecord,
): AssistantCronAutomationRuntimeRecord {
  const createdAt = automation.createdAt
  return createAssistantCronAutomationRuntimeRecord({
    automationId: automation.automationId,
    nextRunAt:
      automation.status === 'active'
        ? computeAssistantCronNextRunAt(
            toAssistantCronSchedule(automation.schedule),
            new Date(createdAt),
          )
        : null,
    now: createdAt,
  })
}

function resolveCanonicalAutomationRuntimeState(
  automation: CanonicalAssistantCronJobRecord,
  store: Awaited<ReturnType<typeof readAssistantCronAutomationRuntimeStore>>,
): AssistantCronAutomationRuntimeRecord {
  return (
    findAssistantCronAutomationRuntimeRecord(store, automation.automationId) ??
    createInitialCanonicalAutomationRuntimeState(automation)
  )
}

function projectCanonicalAssistantCronJob(input: {
  automation: CanonicalAssistantCronJobRecord
  runtimeState: AssistantCronAutomationRuntimeRecord
}): AssistantCronJob {
  const continuitySessionId =
    input.automation.continuityPolicy === 'preserve'
      ? input.runtimeState.sessionId
      : null
  const continuityAlias =
    input.automation.continuityPolicy === 'preserve'
      ? input.runtimeState.alias
      : null
  const target = assistantCronTargetSchema.parse({
    sessionId: continuitySessionId,
    alias: continuityAlias,
    channel: input.automation.route.channel,
    identityId: input.automation.route.identityId,
    participantId: input.automation.route.participantId,
    sourceThreadId: input.automation.route.sourceThreadId,
    deliveryTarget: input.automation.route.deliveryTarget,
    deliverResponse: true,
  })

  return assistantCronJobSchema.parse({
    schema: ASSISTANT_CRON_JOB_SCHEMA,
    jobId: input.automation.automationId,
    name: input.automation.title,
    enabled: input.automation.status === 'active',
    keepAfterRun: input.automation.schedule.kind !== 'at',
    prompt: input.automation.prompt,
    schedule: toAssistantCronSchedule(input.automation.schedule),
    target,
    createdAt: input.automation.createdAt,
    updatedAt: input.automation.updatedAt,
    state: input.runtimeState.state,
  })
}

function toAssistantCronSchedule(
  schedule: CanonicalAssistantCronJobRecord['schedule'],
): AssistantCronSchedule {
  return assistantCronScheduleSchema.parse(schedule)
}

function buildCanonicalAutomationRoute(
  target: AssistantCronTarget,
): CanonicalAssistantCronJobRecord['route'] {
  return {
    channel: target.channel ?? '',
    deliverResponse: true,
    deliveryTarget: target.deliveryTarget,
    identityId: target.identityId,
    participantId: target.participantId,
    sourceThreadId: target.sourceThreadId,
  }
}

function buildCanonicalAutomationUpsertInput(input: {
  automationId?: string
  automation?: Pick<
    CanonicalAssistantCronJobRecord,
    'continuityPolicy' | 'slug' | 'summary' | 'tags'
  > | null
  prompt: string
  route: CanonicalAssistantCronJobRecord['route']
  schedule: AssistantCronSchedule
  status: CanonicalAssistantCronJobRecord['status'] | 'archived'
  title: string
  vault: string
}): Parameters<typeof upsertAutomation>[0] {
  return {
    vaultRoot: input.vault,
    automationId: input.automationId,
    slug: input.automation?.slug,
    title: input.title,
    status: input.status,
    summary: input.automation?.summary ?? undefined,
    schedule: input.schedule,
    route: input.route,
    continuityPolicy: input.automation?.continuityPolicy ?? 'preserve',
    tags: input.automation?.tags ?? ['assistant', 'scheduled'],
    prompt: input.prompt,
  }
}

async function projectResolvedAssistantCronJob(
  vault: string,
  lookup: string,
): Promise<ResolvedAssistantCronJob> {
  const paths = resolveAssistantStatePaths(vault)
  const localStore = await readAssistantCronStore(paths)
  const localJob = tryResolveLocalAssistantCronJob(localStore, lookup)
  if (localJob) {
    return {
      kind: 'local',
      job: localJob,
    }
  }

  const automation = await findCanonicalAssistantCronRecord(vault, lookup)
  if (!automation) {
    throw new VaultCliError(
      'ASSISTANT_CRON_JOB_NOT_FOUND',
      `Assistant cron job "${normalizeRequiredAssistantCronText(lookup, 'job')}" was not found.`,
    )
  }

  const runtimeStore = await readAssistantCronAutomationRuntimeStore(paths)
  const runtimeState = resolveCanonicalAutomationRuntimeState(automation, runtimeStore)

  return {
    kind: 'automation',
    automation,
    runtimeState,
    job: projectCanonicalAssistantCronJob({
      automation,
      runtimeState,
    }),
  }
}

function tryResolveLocalAssistantCronJob(
  store: Awaited<ReturnType<typeof readAssistantCronStore>>,
  lookup: string,
): AssistantCronJob | null {
  try {
    return resolveAssistantCronJobFromStore(store, lookup)
  } catch {
    return null
  }
}

export async function listAssistantCronJobs(
  vault: string,
): Promise<AssistantCronJob[]> {
  const paths = resolveAssistantStatePaths(vault)
  const [localStore, canonicalRecords, runtimeStore] = await Promise.all([
    readAssistantCronStore(paths),
    listCanonicalAssistantCronRecords(vault),
    readAssistantCronAutomationRuntimeStore(paths),
  ])

  return sortAssistantCronJobs([
    ...localStore.jobs,
    ...canonicalRecords.map((automation) =>
      projectCanonicalAssistantCronJob({
        automation,
        runtimeState: resolveCanonicalAutomationRuntimeState(automation, runtimeStore),
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
    const store = await readAssistantCronStore(paths)
    const localJob = tryResolveLocalAssistantCronJob(store, job)
    if (localJob) {
      const index = resolveAssistantCronJobIndex(store, job)
      const [removed] = store.jobs.splice(index, 1)
      await writeAssistantCronStore(paths, store)
      return removed as AssistantCronJob
    }

    const resolved = await projectResolvedAssistantCronJob(vault, job)
    if (resolved.kind !== 'automation') {
      return resolved.job
    }

    await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault,
        automationId: resolved.automation.automationId,
        automation: resolved.automation,
        title: resolved.automation.title,
        status: 'archived',
        schedule: toAssistantCronSchedule(resolved.automation.schedule),
        route: resolved.automation.route,
        prompt: resolved.automation.prompt,
      }),
    )

    const runtimeStore = await readAssistantCronAutomationRuntimeStore(paths)
    if (
      removeAssistantCronAutomationRuntimeRecord(
        runtimeStore,
        resolved.automation.automationId,
      )
    ) {
      await writeAssistantCronAutomationRuntimeStore(paths, runtimeStore)
    }

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
    const store = await readAssistantCronStore(paths)
    const localJob = tryResolveLocalAssistantCronJob(store, job)
    if (localJob) {
      const index = resolveAssistantCronJobIndex(store, job)
      const existing = store.jobs[index] as AssistantCronJob
      const now = new Date()

      const nextRunAt = enabled
        ? resolveAssistantCronReenabledNextRunAt(existing, now)
        : existing.state.nextRunAt

      if (enabled && nextRunAt === null) {
        throw new VaultCliError(
          'ASSISTANT_CRON_INVALID_STATE',
          `Assistant cron job "${existing.name}" no longer has a future scheduled run. Run it manually or recreate it with a new schedule.`,
        )
      }

      const updated = assistantCronJobSchema.parse({
        ...existing,
        enabled,
        updatedAt: now.toISOString(),
        state: {
          ...existing.state,
          nextRunAt,
        },
      })

      store.jobs[index] = updated
      await writeAssistantCronStore(paths, store)
      return updated
    }

    const resolved = await projectResolvedAssistantCronJob(vault, job)
    if (resolved.kind !== 'automation') {
      return resolved.job
    }

    const now = new Date()
    const nextRunAt = enabled
      ? resolveAssistantCronReenabledNextRunAt(resolved.job, now)
      : resolved.runtimeState.state.nextRunAt

    if (enabled && nextRunAt === null) {
      throw new VaultCliError(
        'ASSISTANT_CRON_INVALID_STATE',
        `Assistant cron job "${resolved.job.name}" no longer has a future scheduled run. Run it manually or recreate it with a new schedule.`,
      )
    }

    const updatedAutomation = await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault,
        automationId: resolved.automation.automationId,
        automation: resolved.automation,
        title: resolved.automation.title,
        status: enabled ? 'active' : 'paused',
        schedule: toAssistantCronSchedule(resolved.automation.schedule),
        route: resolved.automation.route,
        prompt: resolved.automation.prompt,
      }),
    )
    const runtimeStore = await readAssistantCronAutomationRuntimeStore(paths)
    const updatedRuntimeState: AssistantCronAutomationRuntimeRecord = {
      ...resolved.runtimeState,
      updatedAt: now.toISOString(),
      state: {
        ...resolved.runtimeState.state,
        nextRunAt,
      },
    }
    upsertAssistantCronAutomationRuntimeRecord(runtimeStore, updatedRuntimeState)
    await writeAssistantCronAutomationRuntimeStore(paths, runtimeStore)

    return projectCanonicalAssistantCronJob({
      automation: {
        ...updatedAutomation.record,
        status: updatedAutomation.record.status as 'active' | 'paused',
      },
      runtimeState: updatedRuntimeState,
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
    const store = await readAssistantCronStore(paths)
    const localJob = tryResolveLocalAssistantCronJob(store, resolvedInput.job)
    if (localJob) {
      const index = resolveAssistantCronJobIndex(store, resolvedInput.job)
      const existing = store.jobs[index] as AssistantCronJob

      if (existing.state.runningAt !== null) {
        throw new VaultCliError(
          'ASSISTANT_CRON_JOB_RUNNING',
          `Assistant cron job "${existing.name}" is already running.`,
        )
      }

      const beforeTarget = buildAssistantCronTargetSnapshot(existing)
      const continuityReset =
        resolvedInput.resetContinuity === true &&
        (existing.target.sessionId !== null || existing.target.alias !== null)
      const afterTarget = buildAssistantCronTargetSnapshot({
        ...existing,
        target: {
          ...nextTarget,
          sessionId: continuityReset ? null : existing.target.sessionId,
          alias: continuityReset ? null : existing.target.alias,
        },
      })
      const changed = !assistantCronTargetAudienceEquals(
        beforeTarget.target,
        afterTarget.target,
      )

      if (resolvedInput.dryRun) {
        return {
          job: existing,
          beforeTarget,
          afterTarget,
          changed,
          continuityReset,
          dryRun: true,
        }
      }

      if (!changed && !continuityReset) {
        return {
          job: existing,
          beforeTarget,
          afterTarget,
          changed: false,
          continuityReset: false,
          dryRun: false,
        }
      }

      const now = (resolvedInput.now ?? new Date()).toISOString()
      const updated = assistantCronJobSchema.parse({
        ...existing,
        updatedAt: now,
        target: afterTarget.target,
      })

      store.jobs[index] = updated
      await writeAssistantCronStore(paths, store)

      return {
        job: updated,
        beforeTarget,
        afterTarget: buildAssistantCronTargetSnapshot(updated),
        changed,
        continuityReset,
        dryRun: false,
      }
    }

    const resolved = await projectResolvedAssistantCronJob(
      resolvedInput.vault,
      resolvedInput.job,
    )
    if (resolved.kind !== 'automation') {
      return {
        job: resolved.job,
        beforeTarget: buildAssistantCronTargetSnapshot(resolved.job),
        afterTarget: buildAssistantCronTargetSnapshot(resolved.job),
        changed: false,
        continuityReset: false,
        dryRun: Boolean(resolvedInput.dryRun),
      }
    }

    if (resolved.runtimeState.state.runningAt !== null) {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_RUNNING',
        `Assistant cron job "${resolved.job.name}" is already running.`,
      )
    }

    const beforeTarget = buildAssistantCronTargetSnapshot(resolved.job)
    const continuityReset =
      resolvedInput.resetContinuity === true &&
      (resolved.runtimeState.sessionId !== null || resolved.runtimeState.alias !== null)
    const afterTarget = buildAssistantCronTargetSnapshot({
      ...resolved.job,
      target: {
        ...nextTarget,
        sessionId: continuityReset ? null : resolved.runtimeState.sessionId,
        alias: continuityReset ? null : resolved.runtimeState.alias,
      },
    })
    const changed = !assistantCronTargetAudienceEquals(
      beforeTarget.target,
      afterTarget.target,
    )

    if (resolvedInput.dryRun) {
      return {
        job: resolved.job,
        beforeTarget,
        afterTarget,
        changed,
        continuityReset,
        dryRun: true,
      }
    }

    if (!changed && !continuityReset) {
      return {
        job: resolved.job,
        beforeTarget,
        afterTarget,
        changed: false,
        continuityReset: false,
        dryRun: false,
      }
    }

    const now = (resolvedInput.now ?? new Date()).toISOString()
    const updatedAutomation = await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault: resolvedInput.vault,
        automationId: resolved.automation.automationId,
        automation: resolved.automation,
        title: resolved.automation.title,
        status: resolved.automation.status,
        schedule: toAssistantCronSchedule(resolved.automation.schedule),
        route: buildCanonicalAutomationRoute(afterTarget.target),
        prompt: resolved.automation.prompt,
      }),
    )
    const runtimeStore = await readAssistantCronAutomationRuntimeStore(paths)
    const updatedRuntimeState: AssistantCronAutomationRuntimeRecord = {
      ...resolved.runtimeState,
      alias: afterTarget.target.alias,
      sessionId: afterTarget.target.sessionId,
      updatedAt: now,
    }
    upsertAssistantCronAutomationRuntimeRecord(runtimeStore, updatedRuntimeState)
    await writeAssistantCronAutomationRuntimeStore(paths, runtimeStore)
    const updatedJob = projectCanonicalAssistantCronJob({
      automation: {
        ...updatedAutomation.record,
        status: updatedAutomation.record.status as 'active' | 'paused',
      },
      runtimeState: updatedRuntimeState,
    })

    return {
      job: updatedJob,
      beforeTarget,
      afterTarget: buildAssistantCronTargetSnapshot(updatedJob),
      changed,
      continuityReset,
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
    const store = await readAssistantCronStore(paths)
    const localJob = tryResolveLocalAssistantCronJob(store, input.job)
    if (localJob) {
      const index = resolveAssistantCronJobIndex(store, input.job)
      const existing = store.jobs[index] as AssistantCronJob

      if (existing.state.runningAt !== null) {
        throw new VaultCliError(
          'ASSISTANT_CRON_JOB_RUNNING',
          `Assistant cron job "${existing.name}" is already running.`,
        )
      }

      const claimedJob = assistantCronJobSchema.parse({
        ...existing,
        updatedAt: new Date().toISOString(),
        state: {
          ...existing.state,
          runningAt: new Date().toISOString(),
          runningPid: process.pid,
        },
      })

      store.jobs[index] = claimedJob
      await writeAssistantCronStore(paths, store)
      return {
        kind: 'local',
        job: claimedJob,
      } satisfies ResolvedAssistantCronJob
    }

    const resolved = await projectResolvedAssistantCronJob(input.vault, input.job)
    if (resolved.kind !== 'automation') {
      return resolved
    }

    if (resolved.runtimeState.state.runningAt !== null) {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_RUNNING',
        `Assistant cron job "${resolved.job.name}" is already running.`,
      )
    }

    const runtimeStore = await readAssistantCronAutomationRuntimeStore(paths)
    const updatedRuntimeState: AssistantCronAutomationRuntimeRecord = {
      ...resolved.runtimeState,
      updatedAt: new Date().toISOString(),
      state: {
        ...resolved.runtimeState.state,
        runningAt: new Date().toISOString(),
        runningPid: process.pid,
      },
    }
    upsertAssistantCronAutomationRuntimeRecord(runtimeStore, updatedRuntimeState)
    await writeAssistantCronAutomationRuntimeStore(paths, runtimeStore)

    return {
      ...resolved,
      runtimeState: updatedRuntimeState,
      job: projectCanonicalAssistantCronJob({
        automation: resolved.automation,
        runtimeState: updatedRuntimeState,
      }),
    } satisfies ResolvedAssistantCronJob
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

function buildValidatedAssistantCronTarget(
  input: AddAssistantCronJobInput,
): ReturnType<typeof buildAssistantCronTarget> {
  if (input.foodAutoLog) {
    return buildAssistantCronTarget(input)
  }

  return validateAssistantCronDeliveryTarget(input)
}

function validateAssistantCronDeliveryTarget(
  input: AssistantCronTargetInput,
): AssistantCronTarget {
  const channel = normalizeNullableString(input.channel)
  if (!channel) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_REQUIRED',
      'Assistant cron jobs must declare an outbound channel and delivery route. Pass --channel plus --sourceThread, --participant, or --deliveryTarget. Cron jobs always deliver their response.',
    )
  }

  if (!getAssistantChannelAdapter(channel)) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_UNSUPPORTED',
      `Outbound delivery for channel "${channel}" is not supported in this build.`,
    )
  }

  if (input.deliverResponse === false) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_REQUIRED',
      'Assistant cron jobs always deliver their response. Remove the deliverResponse override and bind an explicit outbound route.',
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
  const sourceThreadId = normalizeNullableString(input.sourceThreadId)
  const deliveryTarget = normalizeNullableString(input.deliveryTarget)
  const bindingDelivery = resolveAssistantBindingDelivery({
    channel,
    actorId: participantId,
    threadId: sourceThreadId,
  })

  if (!deliveryTarget && !bindingDelivery) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_REQUIRED',
      'Assistant cron jobs must bind an explicit outbound route. Pass --sourceThread, --participant, or --deliveryTarget for the selected channel.',
    )
  }

  return buildAssistantCronTarget({
    ...input,
    channel,
    identityId,
    participantId,
    sourceThreadId,
    deliveryTarget,
    deliverResponse: true,
  })
}

async function claimNextDueAssistantCronJob(
  paths: AssistantStatePaths,
  vault: string,
): Promise<ResolvedAssistantCronJob | null> {
  return withAssistantCronWriteLock(paths, async () => {
    const [store, canonicalRecords, runtimeStore] = await Promise.all([
      readAssistantCronStore(paths),
      listCanonicalAssistantCronRecords(vault, ['active']),
      readAssistantCronAutomationRuntimeStore(paths),
    ])
    const now = new Date().toISOString()
    const projectedCanonicalJobs = canonicalRecords.map((automation) =>
      projectCanonicalAssistantCronJob({
        automation,
        runtimeState: resolveCanonicalAutomationRuntimeState(automation, runtimeStore),
      }),
    )
    const candidate = sortAssistantCronJobs([
      ...store.jobs,
      ...projectedCanonicalJobs,
    ]).find((job) =>
      isAssistantCronJobDue(job, now),
    )
    if (!candidate) {
      return null
    }

    const index = store.jobs.findIndex((job) => job.jobId === candidate.jobId)
    if (index !== -1) {
      const claimed = assistantCronJobSchema.parse({
        ...candidate,
        updatedAt: now,
        state: {
          ...candidate.state,
          runningAt: now,
          runningPid: process.pid,
        },
      })

      store.jobs[index] = claimed
      await writeAssistantCronStore(paths, store)
      return {
        kind: 'local',
        job: claimed,
      }
    }

    const automation = canonicalRecords.find(
      (record) => record.automationId === candidate.jobId,
    )
    if (!automation) {
      return null
    }

    const runtimeState = resolveCanonicalAutomationRuntimeState(automation, runtimeStore)
    const updatedRuntimeState: AssistantCronAutomationRuntimeRecord = {
      ...runtimeState,
      updatedAt: now,
      state: {
        ...runtimeState.state,
        runningAt: now,
        runningPid: process.pid,
      },
    }
    upsertAssistantCronAutomationRuntimeRecord(runtimeStore, updatedRuntimeState)
    await writeAssistantCronAutomationRuntimeStore(paths, runtimeStore)

    return {
      kind: 'automation',
      automation,
      runtimeState: updatedRuntimeState,
      job: projectCanonicalAssistantCronJob({
        automation,
        runtimeState: updatedRuntimeState,
      }),
    }
  })
}

async function executeClaimedAssistantCronJob(input: {
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  job: ResolvedAssistantCronJob
  paths: AssistantStatePaths
  signal?: AbortSignal
  trigger: AssistantCronTrigger
  vault: string
}): Promise<AssistantCronRunExecutionResult> {
  const claimedJob = input.job.job
  const startedAt = new Date().toISOString()
  let finishedAt = startedAt
  let sessionId: string | null = null
  let response: string | null = null
  let errorText: string | null = null
  let status: AssistantCronRunRecord['status'] = 'failed'

  try {
    if (input.signal?.aborted) {
      throw new VaultCliError(
        'ASSISTANT_CRON_ABORTED',
        `Assistant cron job "${claimedJob.name}" was aborted before it started.`,
      )
    }

    if (claimedJob.foodAutoLog) {
      response = await runFoodAutoLogCronJob({
        vault: input.vault,
        foodId: claimedJob.foodAutoLog.foodId,
      })
    } else {
      const result = await sendAssistantMessageLocal({
        vault: input.vault,
        prompt: buildAssistantCronExecutionPrompt(claimedJob),
        executionContext: input.executionContext,
        sessionId: claimedJob.target.sessionId,
        alias: claimedJob.target.alias,
        allowBindingRebind: claimedJob.target.sessionId !== null,
        channel: claimedJob.target.channel,
        identityId: claimedJob.target.identityId,
        participantId: claimedJob.target.participantId,
        sourceThreadId: claimedJob.target.sourceThreadId,
        deliverResponse: claimedJob.target.deliverResponse,
        deliveryDispatchMode: input.deliveryDispatchMode,
        deliveryTarget: claimedJob.target.deliveryTarget,
        turnTrigger: 'automation-cron',
        workingDirectory: input.vault,
      })

      sessionId = result.session.sessionId
      response = result.response
    }
    if (status === 'failed') {
      status = 'succeeded'
    }
  } catch (error) {
    errorText = errorMessage(error)
    status = 'failed'
  } finally {
    finishedAt = new Date().toISOString()
  }

  const run = assistantCronRunRecordSchema.parse({
    schema: ASSISTANT_CRON_RUN_SCHEMA,
    runId: createAssistantCronRunId(),
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
    await appendAssistantCronRun(input.paths, run)

    if (input.job.kind === 'local') {
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
        run,
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

    const runtimeStore = await readAssistantCronAutomationRuntimeStore(input.paths)
    const currentRuntimeState =
      findAssistantCronAutomationRuntimeRecord(
        runtimeStore,
        input.job.automation.automationId,
      ) ?? input.job.runtimeState
    const currentJob = projectCanonicalAssistantCronJob({
      automation: input.job.automation,
      runtimeState: currentRuntimeState,
    })
    const finalizedJob = finalizeAssistantCronJobAfterRun({
      job: currentJob,
      finishedAt,
      responseSessionId:
        input.job.automation.continuityPolicy === 'preserve' ? sessionId : null,
      run,
    })
    const updatedRuntimeState: AssistantCronAutomationRuntimeRecord = {
      ...currentRuntimeState,
      alias:
        input.job.automation.continuityPolicy === 'preserve'
          ? finalizedJob.target.alias
          : null,
      sessionId:
        input.job.automation.continuityPolicy === 'preserve'
          ? finalizedJob.target.sessionId
          : null,
      updatedAt: finishedAt,
      state: finalizedJob.state,
    }
    let removedAfterRun = false

    if (shouldRemoveAssistantCronJobAfterRun(finalizedJob, run)) {
      await upsertAutomation(
        buildCanonicalAutomationUpsertInput({
          vault: input.vault,
          automationId: input.job.automation.automationId,
          automation: input.job.automation,
          title: input.job.automation.title,
          status: 'archived',
          schedule: toAssistantCronSchedule(input.job.automation.schedule),
          route: input.job.automation.route,
          prompt: input.job.automation.prompt,
        }),
      )
      removeAssistantCronAutomationRuntimeRecord(
        runtimeStore,
        input.job.automation.automationId,
      )
      removedAfterRun = true
    } else {
      upsertAssistantCronAutomationRuntimeRecord(runtimeStore, updatedRuntimeState)
    }

    await writeAssistantCronAutomationRuntimeStore(input.paths, runtimeStore)

    return {
      job:
        removedAfterRun
          ? finalizedJob
          : projectCanonicalAssistantCronJob({
              automation: input.job.automation,
              runtimeState: updatedRuntimeState,
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

function buildAssistantCronExecutionPrompt(job: AssistantCronJob): string {
  return job.prompt
}

function finalizeAssistantCronJobAfterRun(input: {
  finishedAt: string
  job: AssistantCronJob
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

  if (input.run.status === 'succeeded') {
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

  if (input.run.status === 'skipped') {
    return assistantCronJobSchema.parse({
      ...input.job,
      updatedAt: input.finishedAt,
      state: runningClearedState,
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
  return job.schedule.kind === 'at' && !job.keepAfterRun && run.status === 'succeeded'
}

function resolveAssistantCronNextRunAfterSuccess(
  job: AssistantCronJob,
  now: Date,
): string | null {
  if (!job.enabled) {
    return job.state.nextRunAt
  }

  if (job.schedule.kind === 'at') {
    return null
  }

  return computeAssistantCronNextRunAt(job.schedule, now)
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

function resolveAssistantCronFailureBackoffMs(failureCount: number): number {
  if (failureCount <= 1) {
    return 30_000
  }

  if (failureCount === 2) {
    return 60_000
  }

  if (failureCount === 3) {
    return 5 * 60_000
  }

  if (failureCount === 4) {
    return 15 * 60_000
  }

  return 60 * 60_000
}

async function resolveAssistantCronScheduleForVault(
  vault: string,
  schedule: AssistantCronScheduleInput,
): Promise<AssistantCronSchedule> {
  if (schedule.kind !== 'cron' || schedule.timeZone) {
    return assistantCronScheduleSchema.parse(schedule)
  }

  return assistantCronScheduleSchema.parse({
    ...schedule,
    timeZone: await resolveAssistantCronDefaultTimeZone(vault),
  })
}

async function resolveAssistantCronDefaultTimeZone(vault: string): Promise<string> {
  try {
    const loadedVault = await loadVault({
      vaultRoot: vault,
    })
    return loadedVault.metadata.timezone ?? resolveSystemTimeZone()
  } catch {
    return resolveSystemTimeZone()
  }
}

function assistantCronJobHasStableSessionLocator(job: AssistantCronJob): boolean {
  return Boolean(
    job.target.sessionId ||
      job.target.alias ||
      (job.target.channel &&
        (job.target.participantId || job.target.sourceThreadId)),
  )
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
      threadId: job.target.sourceThreadId,
      deliveryTarget: job.target.deliveryTarget,
    }) as AssistantBindingDelivery | null,
  }
}

function assistantCronTargetAudienceEquals(
  left: Pick<
    AssistantCronTarget,
    'channel' | 'deliverResponse' | 'deliveryTarget' | 'identityId' | 'participantId' | 'sourceThreadId'
  >,
  right: Pick<
    AssistantCronTarget,
    'channel' | 'deliverResponse' | 'deliveryTarget' | 'identityId' | 'participantId' | 'sourceThreadId'
  >,
): boolean {
  return (
    left.channel === right.channel &&
    left.identityId === right.identityId &&
    left.participantId === right.participantId &&
    left.sourceThreadId === right.sourceThreadId &&
    left.deliveryTarget === right.deliveryTarget &&
    left.deliverResponse === right.deliverResponse
  )
}

function truncateAssistantCronResponse(response: string | null): string | null {
  if (response === null) {
    return null
  }

  return response.slice(0, ASSISTANT_CRON_MAX_RESPONSE_LENGTH)
}

async function runFoodAutoLogCronJob(input: {
  vault: string
  foodId: string
}) {
  const [core, importers] = await Promise.all([
    loadRuntimeModule<FoodAutoLogCoreRuntime>('@murphai/core'),
    loadImporterRuntime(),
  ])
  const food = await core.readFood({
    vaultRoot: input.vault,
    foodId: input.foodId,
  })
  const note = renderAutoLoggedFoodMealNote(food)
  const result = await importers.addMeal({
    vaultRoot: input.vault,
    occurredAt: new Date().toISOString(),
    note,
    source: 'derived',
  })

  return `Auto-logged recurring food "${food.title}" as meal ${result.mealId}.`
}
