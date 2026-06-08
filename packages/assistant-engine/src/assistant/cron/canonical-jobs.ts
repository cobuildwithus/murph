import { resolveSystemTimeZone } from '@murphai/contracts'
import { loadVault, upsertAutomation } from '@murphai/core'
import {
  listAutomations as listCanonicalAutomations,
  listScheduledLogs as listCanonicalScheduledLogs,
  type AutomationQueryRecord,
} from '@murphai/query'
import {
  assistantCronJobSchema,
  assistantCronScheduleSchema,
  assistantCronTargetSchema,
  type AssistantCronJob,
  type AssistantCronSchedule,
  type AssistantCronTarget,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  createAssistantCronCanonicalRuntimeRecord,
  findAssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeState,
  type AssistantCronCanonicalRuntimeStore,
} from './runtime-state.js'
import { computeAssistantCronNextRunAt } from './schedule.js'
import {
  normalizeCanonicalScheduledLogCronRecord,
  type CanonicalScheduledLogAssistantCronJobRecord,
} from './scheduled-log.js'
import {
  normalizeRequiredAssistantCronText,
  type AssistantCronStore,
} from './store.js'

export const ASSISTANT_CRON_JOB_SCHEMA = 'murph.assistant-cron-job.v1'

export interface CanonicalAutomationAssistantCronJobRecord {
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

export type CanonicalAssistantCronJobRecord =
  | CanonicalAutomationAssistantCronJobRecord
  | CanonicalScheduledLogAssistantCronJobRecord

export type ResolvedAssistantCronJob =
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

export async function listCanonicalAssistantCronRecords(
  vault: string,
  status: ReadonlyArray<'active' | 'paused'> = ['active', 'paused'],
): Promise<CanonicalAssistantCronJobRecord[]> {
  const timeZone = await resolveAssistantCronDefaultTimeZone(vault)
  const [automationRecords, scheduledLogRecords] = await Promise.all([
    listCanonicalAutomations(vault, {
      status: [...status],
    }),
    listCanonicalScheduledLogs(vault, {
      status: [...status],
    }),
  ])

  return [
    ...automationRecords.flatMap((record) => {
      const normalized = normalizeCanonicalAssistantCronRecord(record, timeZone)
      return normalized ? [normalized] : []
    }),
    ...scheduledLogRecords.flatMap((record) => {
      const normalized = normalizeCanonicalScheduledLogCronRecord(record, timeZone)
      return normalized ? [normalized] : []
    }),
  ]
}

export function requireCanonicalAssistantCronRecord(
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

export function findCanonicalAssistantCronRecordInList(
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

export function resolveCanonicalRuntimeState(
  source: CanonicalAssistantCronJobRecord,
  store: AssistantCronCanonicalRuntimeStore,
): AssistantCronCanonicalRuntimeRecord {
  return (
    findAssistantCronCanonicalRuntimeRecord(
      store,
      resolveCanonicalAssistantCronJobId(source),
    ) ??
    createInitialCanonicalRuntimeState(source)
  )
}

export function projectCanonicalAssistantCronJob(input: {
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
          deliverySource: null,
          deliveryTarget: null,
          identityId: null,
          participantId: null,
          threadId: null,
        }
  const target = assistantCronTargetSchema.parse({
    sessionId: continuitySessionId,
    alias: continuityAlias,
    channel: targetRoute.channel,
    deliverySource: targetRoute.deliverySource,
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
    name: buildCanonicalAssistantCronJobName(input.source),
    enabled: isCanonicalAssistantCronSourceEnabled(input.source),
    keepAfterRun: input.source.schedule.kind !== 'at',
    prompt: buildCanonicalAssistantCronJobPrompt(input.source),
    schedule: input.source.schedule,
    target,
    scheduledLog:
      input.source.kind === 'scheduledLog'
        ? {
            scheduledLogId: input.source.scheduledLogId,
            actionKind: input.source.actionKind,
          }
        : undefined,
    createdAt: resolveCanonicalAssistantCronCreatedAt(input),
    updatedAt: resolveCanonicalAssistantCronUpdatedAt(input),
    state: projectedState,
  })
}

export function resolveCanonicalAssistantCronJobId(
  source: CanonicalAssistantCronJobRecord,
): string {
  switch (source.kind) {
    case 'automation':
      return source.automationId
    case 'scheduledLog':
      return source.scheduledLogId
  }
}

export function isCanonicalAssistantCronSourceEnabled(
  source: CanonicalAssistantCronJobRecord,
): boolean {
  switch (source.kind) {
    case 'automation':
    case 'scheduledLog':
      return source.status === 'active'
  }
}

export function resolveCanonicalAssistantCronOccurrenceAt(
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

export function resolveAssistantCronResolvedSchedule(input: {
  schedule: AssistantCronSchedule
  timeZone?: string | null
}):
  | AssistantCronSchedule
  | { kind: 'cron'; expression: string; timeZone: string }
  | { kind: 'dailyLocal'; localTime: string; timeZone: string } {
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

export function buildCanonicalAutomationRoute(
  target: AssistantCronTarget,
): CanonicalAutomationAssistantCronJobRecord['route'] {
  return {
    channel: target.channel ?? '',
    deliverySource: target.deliverySource,
    deliveryTarget: target.deliveryTarget,
    identityId: target.identityId,
    participantId: target.participantId,
    threadId: target.threadId,
  }
}

export function buildCanonicalAutomationUpsertInput(input: {
  automationId?: string
  automation?: Pick<
    CanonicalAutomationAssistantCronJobRecord,
    'continuityPolicy' | 'slug' | 'summary' | 'tags'
  > | null
  continuityPolicy?: CanonicalAutomationAssistantCronJobRecord['continuityPolicy']
  instructions: string
  route: CanonicalAutomationAssistantCronJobRecord['route']
  schedule: AssistantCronSchedule
  slug?: string
  status: CanonicalAutomationAssistantCronJobRecord['status'] | 'archived'
  summary?: string | null
  tags?: string[]
  title: string
  vault: string
}): Parameters<typeof upsertAutomation>[0] {
  return {
    vaultRoot: input.vault,
    automationId: input.automationId,
    slug: input.slug ?? input.automation?.slug,
    title: input.title,
    status: input.status,
    summary: input.summary ?? input.automation?.summary ?? undefined,
    schedule: input.schedule,
    route: input.route,
    continuityPolicy:
      input.continuityPolicy ?? input.automation?.continuityPolicy ?? 'preserve',
    tags: input.tags ?? input.automation?.tags ?? ['assistant', 'scheduled'],
    instructions: input.instructions,
  }
}

export function buildVisibleLocalAssistantCronStore(
  store: AssistantCronStore,
): AssistantCronStore {
  return store
}

export async function resolveAssistantCronDefaultTimeZone(
  vault: string,
): Promise<string> {
  try {
    const loadedVault = await loadVault({
      vaultRoot: vault,
    })
    return loadedVault.metadata.timezone ?? resolveSystemTimeZone()
  } catch {
    return resolveSystemTimeZone()
  }
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

  if (record.schedule.kind === 'deviceActivity') {
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

function resolveCanonicalAssistantCronJobLookupKeys(
  record: CanonicalAssistantCronJobRecord,
): string[] {
  switch (record.kind) {
    case 'automation':
      return [record.automationId, record.slug, record.title]
    case 'scheduledLog':
      return [record.scheduledLogId, record.slug, record.title]
  }
}

function createInitialCanonicalRuntimeState(
  source: CanonicalAssistantCronJobRecord,
): AssistantCronCanonicalRuntimeRecord {
  return createAssistantCronCanonicalRuntimeRecord({
    jobId: resolveCanonicalAssistantCronJobId(source),
    now: source.createdAt,
  })
}

function buildCanonicalAssistantCronJobName(
  source: CanonicalAssistantCronJobRecord,
): string {
  switch (source.kind) {
    case 'automation':
    case 'scheduledLog':
      return source.title
  }
}

function buildCanonicalAssistantCronJobPrompt(
  source: CanonicalAssistantCronJobRecord,
): string {
  switch (source.kind) {
    case 'automation':
      return source.instructions
    case 'scheduledLog':
      return `Auto-log scheduled log "${source.title}" as ${source.actionKind}.`
  }
}

function resolveCanonicalAssistantCronCreatedAt(input: {
  source: CanonicalAssistantCronJobRecord
  runtimeState: AssistantCronCanonicalRuntimeRecord
}): string {
  return input.source.createdAt
}

function resolveCanonicalAssistantCronUpdatedAt(input: {
  source: CanonicalAssistantCronJobRecord
  runtimeState: AssistantCronCanonicalRuntimeRecord
}): string {
  return input.source.updatedAt
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
    ...(input.runtimeState.state.pendingDeliveryIntentId
      ? { pendingDeliveryIntentId: input.runtimeState.state.pendingDeliveryIntentId }
      : {}),
    runningAt: input.runtimeState.state.runningAt,
    runningPid: input.runtimeState.state.runningPid,
  }
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

function resolveCanonicalAssistantCronNextRunAt(input: {
  source: CanonicalAssistantCronJobRecord
  state: AssistantCronCanonicalRuntimeState
}): string | null {
  if (!isCanonicalAssistantCronSourceEnabled(input.source)) {
    return null
  }

  if (input.state.pendingDeliveryIntentId) {
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
