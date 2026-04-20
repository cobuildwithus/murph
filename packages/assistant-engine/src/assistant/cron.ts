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
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  buildDailyFoodCronJobName,
  buildDailyFoodCronPrompt,
} from '@murphai/vault-usecases/records'
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
import { buildAssistantCronNotificationDedupeToken } from './cron/notification-delivery.ts'
import {
  createAssistantCronCanonicalRuntimeRecord,
  findAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
  removeAssistantCronCanonicalRuntimeRecord,
  upsertAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
  type AssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeState,
} from './cron/runtime-state.ts'
import {
  clearCanonicalFoodAutoLogSchedule,
  listCanonicalFoodAutoLogRecords,
  runFoodAutoLogCronJob,
  type CanonicalFoodAssistantCronJobRecord,
} from './cron/food-auto-log.ts'
import { sendAssistantNotificationLocal } from '../assistant-service.ts'
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

export type { AssistantCronTargetSnapshot } from '@murphai/operator-config/assistant-cli-contracts'

const ASSISTANT_CRON_JOB_SCHEMA = 'murph.assistant-cron-job.v1'
const ASSISTANT_CRON_RUN_SCHEMA = 'murph.assistant-cron-run.v1'
const ASSISTANT_CRON_MAX_RESPONSE_LENGTH = 4_000

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

interface CanonicalAutomationAssistantCronJobRecord {
  kind: 'automation'
  automationId: string
  continuityPolicy: 'fresh' | 'preserve'
  createdAt: string
  instructions: string
  route: AutomationQueryRecord['route']
  schedule: AssistantCronSchedule
  slug: string
  status: 'active' | 'paused'
  summary: string | null
  tags: string[]
  timeZone: string | null
  title: string
  updatedAt: string
}

type CanonicalAssistantCronJobRecord =
  | CanonicalAutomationAssistantCronJobRecord
  | CanonicalFoodAssistantCronJobRecord

type ResolvedAssistantCronJob =
  | {
      kind: 'canonical'
      source: CanonicalAssistantCronJobRecord
      job: AssistantCronJob
      runtimeState: AssistantCronCanonicalRuntimeRecord
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
  const paths = resolveAssistantStatePaths(input.vault)
  const now = resolvedInput.now ?? new Date()
  const name = normalizeRequiredAssistantCronText(resolvedInput.name, 'name')
  const prompt = normalizeRequiredAssistantCronText(resolvedInput.prompt, 'prompt')
  const enabled = resolvedInput.enabled ?? true
  const resolvedSchedule = await resolveAssistantCronScheduleForVault(
    input.vault,
    resolvedInput.schedule,
  )
  const schedule = assistantCronScheduleSchema.parse(resolvedInput.schedule)
  const keepAfterRun =
    schedule.kind === 'at'
      ? resolvedInput.keepAfterRun ?? false
      : true
  const nextRunAt = computeAssistantCronNextRunAt(resolvedSchedule, now)

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
          instructions: prompt,
        }),
      )
      const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
      const timeZone = await resolveAssistantCronDefaultTimeZone(input.vault)
      const source = requireCanonicalAssistantCronRecord(
        created.record,
        timeZone,
      ) as CanonicalAutomationAssistantCronJobRecord
      const runtimeState = createAssistantCronCanonicalRuntimeRecord({
        jobId: source.automationId,
        now: now.toISOString(),
        sessionId: target.sessionId,
        alias: target.alias,
      })
      upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, runtimeState)
      await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)

      return projectCanonicalAssistantCronJob({
        source,
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

async function listCanonicalAssistantCronRecords(
  vault: string,
  status: ReadonlyArray<'active' | 'paused'> = ['active', 'paused'],
): Promise<CanonicalAssistantCronJobRecord[]> {
  const timeZone = await resolveAssistantCronDefaultTimeZone(vault)
  const [automationRecords, foodRecords] = await Promise.all([
    listCanonicalAutomations(vault, {
      status: [...status],
    }),
    listCanonicalFoodAutoLogRecords(vault, timeZone),
  ])

  return [
    ...automationRecords.flatMap((record) => {
      const normalized = normalizeCanonicalAssistantCronRecord(record, timeZone)
      return normalized ? [normalized] : []
    }),
    ...(status.includes('active') ? foodRecords : []),
  ]
}

function normalizeCanonicalAssistantCronRecord(
  record: AutomationQueryRecord & {
    instructions?: string
    prompt?: string
  },
  timeZone: string,
): CanonicalAssistantCronJobRecord | null {
  if (record.status !== 'active' && record.status !== 'paused') {
    return null
  }

  const instructions =
    typeof record.instructions === 'string' ? record.instructions : record.prompt
  if (typeof instructions !== 'string') {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_AUTOMATION',
      `Canonical automation "${record.automationId}" is missing scheduled instructions.`,
    )
  }

  return {
    kind: 'automation',
    automationId: record.automationId,
    continuityPolicy: record.continuityPolicy,
    createdAt: record.createdAt,
    instructions,
    route: record.route,
    schedule: normalizeAssistantCronPublicSchedule(record.schedule),
    slug: record.slug,
    status: record.status,
    summary: record.summary,
    tags: [...record.tags],
    timeZone:
      record.schedule.kind === 'cron' || record.schedule.kind === 'dailyLocal'
        ? timeZone
        : null,
    title: record.title,
    updatedAt: record.updatedAt,
  }
}

function requireCanonicalAssistantCronRecord(
  record: AutomationQueryRecord & {
    instructions?: string
    prompt?: string
  },
  timeZone: string,
): CanonicalAssistantCronJobRecord {
  const normalized = normalizeCanonicalAssistantCronRecord(record, timeZone)
  if (!normalized) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_AUTOMATION',
      `Canonical automation "${record.automationId}" is not active or paused.`,
    )
  }

  return normalized
}

function resolveCanonicalAssistantCronJobLookupKeys(
  record: CanonicalAssistantCronJobRecord,
): string[] {
  if (record.kind === 'automation') {
    return [record.automationId, record.slug, record.title]
  }

  return [record.jobId, buildDailyFoodCronJobName(record.slug)]
}

function findCanonicalAssistantCronRecordInList(
  records: readonly CanonicalAssistantCronJobRecord[],
  lookup: string,
): CanonicalAssistantCronJobRecord | null {
  const normalizedLookup = normalizeRequiredAssistantCronText(lookup, 'job')
  const foldedLookup = normalizedLookup.toLocaleLowerCase()
  return (
    records.find((record) =>
      resolveCanonicalAssistantCronJobLookupKeys(record).some(
        (candidate) =>
          typeof candidate === 'string' &&
          candidate.toLocaleLowerCase() === foldedLookup,
      ),
    ) ?? null
  )
}

function createInitialCanonicalRuntimeState(
  source: CanonicalAssistantCronJobRecord,
  now: string,
): AssistantCronCanonicalRuntimeRecord {
  return createAssistantCronCanonicalRuntimeRecord({
    jobId: resolveCanonicalAssistantCronJobId(source),
    now,
  })
}

function resolveCanonicalRuntimeState(
  source: CanonicalAssistantCronJobRecord,
  store: Awaited<ReturnType<typeof readAssistantCronCanonicalRuntimeStore>>,
): AssistantCronCanonicalRuntimeRecord {
  return (
    findAssistantCronCanonicalRuntimeRecord(
      store,
      resolveCanonicalAssistantCronJobId(source),
    ) ??
    createInitialCanonicalRuntimeState(source, new Date().toISOString())
  )
}

function projectCanonicalAssistantCronJob(input: {
  source: CanonicalAssistantCronJobRecord
  runtimeState: AssistantCronCanonicalRuntimeRecord
}): AssistantCronJob {
  const continuitySessionId =
    input.source.kind === 'automation' &&
    input.source.continuityPolicy === 'preserve'
      ? input.runtimeState.sessionId
      : null
  const continuityAlias =
    input.source.kind === 'automation' &&
    input.source.continuityPolicy === 'preserve'
      ? input.runtimeState.alias
      : null
  const targetRoute =
    input.source.kind === 'automation'
      ? input.source.route
      : {
          channel: null,
          deliveryTarget: null,
          identityId: null,
          participantId: null,
          threadId: null,
        }
  const target = assistantCronTargetSchema.parse({
    sessionId: continuitySessionId,
    alias: continuityAlias,
    channel: targetRoute.channel,
    identityId: targetRoute.identityId,
    participantId: targetRoute.participantId,
    threadId: targetRoute.threadId,
    deliveryTarget: targetRoute.deliveryTarget,
  })
  const projectedState = projectCanonicalAssistantCronJobState({
    source: input.source,
    runtimeState: input.runtimeState,
  })

  return assistantCronJobSchema.parse({
    schema: ASSISTANT_CRON_JOB_SCHEMA,
    jobId: resolveCanonicalAssistantCronJobId(input.source),
    name:
      input.source.kind === 'automation'
        ? input.source.title
        : buildDailyFoodCronJobName(input.source.slug),
    enabled: isCanonicalAssistantCronSourceEnabled(input.source),
    keepAfterRun: input.source.schedule.kind !== 'at',
    prompt:
      input.source.kind === 'automation'
        ? input.source.instructions
        : buildDailyFoodCronPrompt(input.source.title),
    schedule: input.source.schedule,
    target,
    foodAutoLog:
      input.source.kind === 'foodAutoLog'
        ? {
            foodId: input.source.foodId,
          }
        : undefined,
    createdAt:
      input.source.kind === 'automation'
        ? input.source.createdAt
        : input.runtimeState.createdAt,
    updatedAt:
      input.source.kind === 'automation'
        ? input.source.updatedAt
        : input.runtimeState.updatedAt,
    state: projectedState,
  })
}

function projectCanonicalAssistantCronJobState(input: {
  source: CanonicalAssistantCronJobRecord
  runtimeState: AssistantCronCanonicalRuntimeRecord
}): AssistantCronJob['state'] {
  const nextRunAt = resolveCanonicalAssistantCronNextRunAt({
    source: input.source,
    state: input.runtimeState.state,
  })

  return {
    nextRunAt,
    lastRunAt: input.runtimeState.state.lastRunAt,
    lastSucceededAt: input.runtimeState.state.lastSucceededAt,
    lastFailedAt: input.runtimeState.state.lastFailedAt,
    consecutiveFailures: input.runtimeState.state.consecutiveFailures,
    lastError: input.runtimeState.state.lastError,
    runningAt: input.runtimeState.state.runningAt,
    runningPid: input.runtimeState.state.runningPid,
  }
}

function resolveCanonicalAssistantCronJobId(
  source: CanonicalAssistantCronJobRecord,
): string {
  return source.kind === 'automation' ? source.automationId : source.jobId
}

function isCanonicalAssistantCronSourceEnabled(
  source: CanonicalAssistantCronJobRecord,
): boolean {
  return source.kind === 'automation' ? source.status === 'active' : true
}

function normalizeAssistantCronPublicSchedule(
  schedule: AutomationQueryRecord['schedule'],
): AssistantCronSchedule {
  if (schedule.kind === 'cron') {
    return assistantCronScheduleSchema.parse({
      kind: 'cron',
      expression: schedule.expression,
    })
  }

  if (schedule.kind === 'dailyLocal') {
    return assistantCronScheduleSchema.parse({
      kind: 'dailyLocal',
      localTime: schedule.localTime,
    })
  }

  return assistantCronScheduleSchema.parse(schedule)
}

function resolveAssistantCronResolvedSchedule(input: {
  schedule: AssistantCronSchedule
  timeZone?: string | null
}):
  | AssistantCronSchedule
  | ({ kind: 'cron'; expression: string; timeZone: string })
  | ({ kind: 'dailyLocal'; localTime: string; timeZone: string }) {
  if (input.schedule.kind === 'cron') {
    return {
      kind: 'cron',
      expression: input.schedule.expression,
      timeZone: input.timeZone ?? 'UTC',
    }
  }

  if (input.schedule.kind === 'dailyLocal') {
    return {
      kind: 'dailyLocal',
      localTime: input.schedule.localTime,
      timeZone: input.timeZone ?? 'UTC',
    }
  }

  return input.schedule
}

function buildCanonicalAutomationRoute(
  target: AssistantCronTarget,
): CanonicalAutomationAssistantCronJobRecord['route'] {
  return {
    channel: target.channel ?? '',
    deliveryTarget: target.deliveryTarget,
    identityId: target.identityId,
    participantId: target.participantId,
    threadId: target.threadId,
  }
}

function buildCanonicalAutomationUpsertInput(input: {
  automationId?: string
  automation?: Pick<
    CanonicalAutomationAssistantCronJobRecord,
    'continuityPolicy' | 'slug' | 'summary' | 'tags'
  > | null
  instructions: string
  route: CanonicalAutomationAssistantCronJobRecord['route']
  schedule: AssistantCronSchedule
  status: CanonicalAutomationAssistantCronJobRecord['status'] | 'archived'
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
    instructions: input.instructions,
  }
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

function buildCanonicalFoodIdSet(
  records: readonly CanonicalAssistantCronJobRecord[],
): Set<string> {
  return new Set(
    records.flatMap((record) =>
      record.kind === 'foodAutoLog' ? [record.foodId] : [],
    ),
  )
}

function buildVisibleLocalAssistantCronStore(
  store: Awaited<ReturnType<typeof readAssistantCronStore>>,
  canonicalFoodIds: ReadonlySet<string>,
): Awaited<ReturnType<typeof readAssistantCronStore>> {
  if (canonicalFoodIds.size === 0) {
    return store
  }

  return {
    ...store,
    jobs: store.jobs.filter(
      (job) =>
        !job.foodAutoLog || !canonicalFoodIds.has(job.foodAutoLog.foodId),
    ),
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
    const store = await readAssistantCronStore(paths)
    const canonicalRecords = await listCanonicalAssistantCronRecords(vault)
    const canonicalFoodIds = buildCanonicalFoodIdSet(canonicalRecords)
    const visibleLocalStore = buildVisibleLocalAssistantCronStore(
      store,
      canonicalFoodIds,
    )
    const localJob = tryResolveLocalAssistantCronJob(visibleLocalStore, job)
    if (localJob) {
      const index = store.jobs.findIndex((entry) => entry.jobId === localJob.jobId)
      const [removed] = store.jobs.splice(index, 1)
      await writeAssistantCronStore(paths, store)
      return removed as AssistantCronJob
    }

    const resolved = await projectResolvedAssistantCronJob(vault, job)
    if (resolved.kind !== 'canonical') {
      return resolved.job
    }

    if (resolved.source.kind === 'automation') {
      await upsertAutomation(
        buildCanonicalAutomationUpsertInput({
          vault,
          automationId: resolved.source.automationId,
          automation: resolved.source,
          title: resolved.source.title,
          status: 'archived',
          schedule: resolved.source.schedule,
          route: resolved.source.route,
          instructions: resolved.source.instructions,
        }),
      )
    } else {
      const foodId = resolved.source.foodId
      await clearCanonicalFoodAutoLogSchedule(vault, foodId)
      const nextLocalJobs = store.jobs.filter(
        (entry) => entry.foodAutoLog?.foodId !== foodId,
      )
      if (nextLocalJobs.length !== store.jobs.length) {
        store.jobs = nextLocalJobs
        await writeAssistantCronStore(paths, store)
      }
    }

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    if (
      removeAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        resolveCanonicalAssistantCronJobId(resolved.source),
      )
    ) {
      await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)
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
    if (resolved.kind !== 'canonical') {
      return resolved.job
    }
    if (resolved.source.kind === 'foodAutoLog') {
      throw new VaultCliError(
        'ASSISTANT_CRON_INVALID_STATE',
        `Recurring food auto-log job "${resolved.job.name}" is controlled by the canonical food record, not assistant cron enable/disable.`,
      )
    }

    const now = new Date()
    const nextRunAt = enabled
      ? computeAssistantCronNextRunAt(
          resolveAssistantCronResolvedSchedule({
            schedule: resolved.source.schedule,
            timeZone: resolved.source.timeZone,
          }),
          now,
        )
      : null

    if (enabled && nextRunAt === null) {
      throw new VaultCliError(
        'ASSISTANT_CRON_INVALID_STATE',
        `Assistant cron job "${resolved.job.name}" no longer has a future scheduled run. Run it manually or recreate it with a new schedule.`,
      )
    }

    const updatedAutomation = await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault,
        automationId: resolved.source.automationId,
        automation: resolved.source,
        title: resolved.source.title,
        status: enabled ? 'active' : 'paused',
        schedule: resolved.source.schedule,
        route: resolved.source.route,
        instructions: resolved.source.instructions,
      }),
    )
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const updatedRuntimeState: AssistantCronCanonicalRuntimeRecord = {
      ...resolved.runtimeState,
      updatedAt: now.toISOString(),
      state: {
        ...resolved.runtimeState.state,
        activatedAt: enabled ? now.toISOString() : resolved.runtimeState.state.activatedAt,
        pendingOccurrenceAt: null,
        retryAfterAt: null,
      },
    }
    upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, updatedRuntimeState)
    await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)

    return projectCanonicalAssistantCronJob({
      source: requireCanonicalAssistantCronRecord(
        updatedAutomation.record,
        await resolveAssistantCronDefaultTimeZone(vault),
      ) as CanonicalAutomationAssistantCronJobRecord,
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
    if (resolved.kind !== 'canonical') {
      return {
        job: resolved.job,
        beforeTarget: buildAssistantCronTargetSnapshot(resolved.job),
        afterTarget: buildAssistantCronTargetSnapshot(resolved.job),
        changed: false,
        continuityReset: false,
        dryRun: Boolean(resolvedInput.dryRun),
      }
    }
    if (resolved.source.kind === 'foodAutoLog') {
      throw new VaultCliError(
        'ASSISTANT_CRON_DELIVERY_REQUIRED',
        `Recurring food auto-log job "${resolved.job.name}" does not support assistant delivery targeting.`,
      )
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
        automationId: resolved.source.automationId,
        automation: resolved.source,
        title: resolved.source.title,
        status: resolved.source.status,
        schedule: resolved.source.schedule,
        route: buildCanonicalAutomationRoute(afterTarget.target),
        instructions: resolved.source.instructions,
      }),
    )
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const updatedRuntimeState: AssistantCronCanonicalRuntimeRecord = {
      ...resolved.runtimeState,
      alias: afterTarget.target.alias,
      sessionId: afterTarget.target.sessionId,
      updatedAt: now,
    }
    upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, updatedRuntimeState)
    await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)
    const updatedJob = projectCanonicalAssistantCronJob({
      source: requireCanonicalAssistantCronRecord(
        updatedAutomation.record,
        await resolveAssistantCronDefaultTimeZone(resolvedInput.vault),
      ) as CanonicalAutomationAssistantCronJobRecord,
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
    if (resolved.kind !== 'canonical') {
      return resolved
    }

    if (resolved.runtimeState.state.runningAt !== null) {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_RUNNING',
        `Assistant cron job "${resolved.job.name}" is already running.`,
      )
    }

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    const now = new Date().toISOString()
    const occurrenceAt =
      resolveCanonicalAssistantCronOccurrenceAt(resolved.source, resolved.runtimeState) ??
      now
    const updatedRuntimeState: AssistantCronCanonicalRuntimeRecord = {
      ...resolved.runtimeState,
      updatedAt: now,
      state: {
        ...resolved.runtimeState.state,
        pendingOccurrenceAt: occurrenceAt,
        retryAfterAt: null,
        runningAt: now,
        runningPid: process.pid,
      },
    }
    upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, updatedRuntimeState)
    await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)

    return {
      ...resolved,
      runtimeState: updatedRuntimeState,
      job: projectCanonicalAssistantCronJob({
        source: resolved.source,
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

async function claimNextDueAssistantCronJob(
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
    const canonicalFoodIds = buildCanonicalFoodIdSet(canonicalRecords)
    const visibleLocalStore = buildVisibleLocalAssistantCronStore(
      store,
      canonicalFoodIds,
    )
    const canonicalEntries = canonicalRecords.map((source) => {
      const runtimeState = resolveCanonicalRuntimeState(source, runtimeStore)
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

    const canonicalEntry = canonicalEntries.find(
      (entry) => resolveCanonicalAssistantCronJobId(entry.source) === candidate.jobId,
    )!
    const occurrenceAt =
      resolveCanonicalAssistantCronOccurrenceAt(
        canonicalEntry.source,
        canonicalEntry.runtimeState,
      ) ?? candidate.state.nextRunAt ?? now
    const updatedRuntimeState: AssistantCronCanonicalRuntimeRecord = {
      ...canonicalEntry.runtimeState,
      updatedAt: now,
      state: {
        ...canonicalEntry.runtimeState.state,
        pendingOccurrenceAt: occurrenceAt,
        retryAfterAt: null,
        runningAt: now,
        runningPid: process.pid,
      },
    }
    upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, updatedRuntimeState)
    await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)

    return {
      kind: 'canonical',
      source: canonicalEntry.source,
      runtimeState: updatedRuntimeState,
      job: projectCanonicalAssistantCronJob({
        source: canonicalEntry.source,
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
  let status: 'failed' | 'succeeded' = 'failed'

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
      const result = await sendAssistantNotificationLocal({
        vault: input.vault,
        instructions: buildAssistantCronExecutionInstructions(claimedJob),
        deliveryDedupeToken: buildAssistantCronNotificationDedupeToken({
          job: claimedJob,
          trigger: input.trigger,
        }),
        executionContext: input.executionContext,
        sessionId: claimedJob.target.sessionId,
        alias: claimedJob.target.alias,
        allowBindingRebind: claimedJob.target.sessionId !== null,
        channel: claimedJob.target.channel,
        identityId: claimedJob.target.identityId,
        participantId: claimedJob.target.participantId,
        threadId: claimedJob.target.threadId,
        deliveryDispatchMode: input.deliveryDispatchMode,
        deliveryTarget: claimedJob.target.deliveryTarget,
        turnTrigger: 'automation-cron',
        workingDirectory: input.vault,
      })

      sessionId = result.session.sessionId
      response = result.response ?? result.decision.privateSummary
    }
    status = 'succeeded'
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

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(input.paths)
    const currentRuntimeState =
      findAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        resolveCanonicalAssistantCronJobId(input.job.source),
      ) ?? input.job.runtimeState
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

function finalizeAssistantCronJobAfterRun(input: {
  finishedAt: string
  job: AssistantCronJob
  responseSessionId: string | null
  run: AssistantCronRunRecord & {
    status: 'failed' | 'succeeded'
  }
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

function resolveCanonicalAssistantCronOccurrenceAt(
  source: CanonicalAssistantCronJobRecord,
  runtimeState: AssistantCronCanonicalRuntimeRecord,
): string | null {
  if (!isCanonicalAssistantCronSourceEnabled(source)) {
    return null
  }

  if (runtimeState.state.pendingOccurrenceAt) {
    return runtimeState.state.pendingOccurrenceAt
  }

  if (source.schedule.kind === 'at') {
    return source.schedule.at
  }

  const anchorAt = runtimeState.state.lastSucceededAt ?? runtimeState.state.activatedAt
  if (!anchorAt) {
    return null
  }

  return computeAssistantCronNextRunAt(
    resolveAssistantCronResolvedSchedule({
      schedule: source.schedule,
      timeZone: source.timeZone,
    }),
    new Date(anchorAt),
  )
}

function resolveCanonicalAssistantCronNextRunAt(input: {
  source: CanonicalAssistantCronJobRecord
  state: AssistantCronCanonicalRuntimeState
}): string | null {
  if (!isCanonicalAssistantCronSourceEnabled(input.source)) {
    return null
  }

  if (input.state.pendingOccurrenceAt) {
    return input.state.retryAfterAt ?? input.state.pendingOccurrenceAt
  }

  if (input.source.schedule.kind === 'at') {
    return input.source.schedule.at
  }

  const anchorAt = input.state.lastSucceededAt ?? input.state.activatedAt
  if (!anchorAt) {
    return null
  }

  return computeAssistantCronNextRunAt(
    resolveAssistantCronResolvedSchedule({
      schedule: input.source.schedule,
      timeZone: input.source.timeZone,
    }),
    new Date(anchorAt),
  )
}

function finalizeCanonicalAssistantCronRuntimeAfterRun(input: {
  finishedAt: string
  responseSessionId: string | null
  run: AssistantCronRunRecord & {
    status: 'failed' | 'succeeded'
  }
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAssistantCronJobRecord
}): AssistantCronCanonicalRuntimeRecord {
  const runningClearedState: AssistantCronCanonicalRuntimeState = {
    ...input.runtimeState.state,
    runningAt: null,
    runningPid: null,
    lastRunAt: input.finishedAt,
  }

  if (input.run.status === 'succeeded') {
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

  const failureCount = input.runtimeState.state.consecutiveFailures + 1
  const retryAfterAt = isCanonicalAssistantCronSourceEnabled(input.source)
    ? new Date(
        Date.parse(input.finishedAt) + resolveAssistantCronFailureBackoffMs(failureCount),
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
        (job.target.participantId || job.target.threadId)),
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

function truncateAssistantCronResponse(response: string | null): string | null {
  if (response === null) {
    return null
  }

  return response.slice(0, ASSISTANT_CRON_MAX_RESPONSE_LENGTH)
}
