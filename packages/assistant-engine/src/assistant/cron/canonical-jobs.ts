import {
  normalizeIanaTimeZone,
  resolveSystemTimeZone,
  type AutomationSupportKind,
} from '@murphai/contracts'
import { loadVault, upsertAutomation } from '@murphai/core'
import {
  listAutomations as listCanonicalAutomations,
  listScheduledLogs as listCanonicalScheduledLogs,
  readAutomationByRelativePath as readCanonicalAutomationByRelativePath,
  type AutomationQueryRecord,
} from '@murphai/query'
import {
  assistantCronJobSchema,
  assistantCronScheduleSchema,
  assistantCronTargetSchema,
  type AssistantCronJob,
  type AssistantCronSchedule,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  createAssistantCronCanonicalRuntimeRecord,
  findAssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeState,
  type AssistantCronCanonicalRuntimeStore,
} from './runtime-state.js'
import { resolveAssistantConversationKey } from '../bindings.js'
import {
  buildGroupNewsletterScheduledExecutionPrompt,
  resolveGroupNewsletterAutomationDelivery,
} from '../group-newsletter-automation.js'
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
export const ASSISTANT_CRON_NOTIFICATION_EXPIRES_AFTER_MS = 60 * 60 * 1000

export interface CanonicalAutomationAssistantCronJobRecord {
  kind: 'automation'
  activeUntil: string | null
  automationId: string
  continuityPolicy: 'fresh' | 'preserve'
  createdAt: string
  scheduleAnchorAt?: string
  instructions: string
  route: AutomationQueryRecord['route']
  assistantTargetOverride: AutomationQueryRecord['assistantTargetOverride']
  schedule: AssistantCronSchedule
  slug: string
  status: 'active' | 'paused'
  summary: string | null
  supportKind: AutomationSupportKind | null
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

export async function readCanonicalAssistantCronAutomationByRelativePath(input: {
  defaultTimeZone: string
  relativePath: string
  vault: string
}): Promise<CanonicalAutomationAssistantCronJobRecord> {
  const record = await readCanonicalAutomationByRelativePath(
    input.vault,
    input.relativePath,
  )
  if (!record) {
    throw new VaultCliError(
      'ASSISTANT_CRON_JOB_NOT_FOUND',
      'Canonical automation was not found at its persisted path.',
    )
  }
  const source = requireCanonicalAssistantCronRecord(
    record,
    input.defaultTimeZone,
  )
  if (source.kind !== 'automation') {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_AUTOMATION',
      'Canonical automation timing projection resolved a non-automation source.',
    )
  }
  return source
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

// A route whose fields form a conversation key continues that conversation's
// live chat session at fire time, with the conversation-key path's fingerprint
// and expiry checks. Pinning a previous run's session would bypass those
// checks and go stale, so the pin is reserved for keyless routes (e.g. a bare
// delivery target), where it is the only continuity available.
export function automationContinuityUsesSessionPin(
  source: CanonicalAssistantCronJobRecord,
): boolean {
  return (
    source.kind === 'automation' &&
    source.continuityPolicy === 'preserve' &&
    resolveAssistantConversationKey({
      channel: source.route.channel,
      identityId: source.route.identityId,
      actorId: source.route.participantId,
      threadId: source.route.threadId,
    }) === null
  )
}

export function projectCanonicalAssistantCronJob(input: {
  source: CanonicalAssistantCronJobRecord
  runtimeState: AssistantCronCanonicalRuntimeRecord
}): AssistantCronJob {
  const preservesContinuity =
    input.source.kind === 'automation' &&
    input.source.continuityPolicy === 'preserve'
  const continuitySessionId = automationContinuityUsesSessionPin(input.source)
    ? input.runtimeState.sessionId
    : null
  // Aliases only enter runtime state as explicit creation-time bindings, so
  // they stay honored even when the automatic session pin is gated off.
  const continuityAlias = preservesContinuity ? input.runtimeState.alias : null
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
          threadIsDirect: undefined,
        }
  const target = assistantCronTargetSchema.parse({
    sessionId: continuitySessionId,
    alias: continuityAlias,
    channel: targetRoute.channel,
    deliverySource: targetRoute.deliverySource,
    identityId: targetRoute.identityId,
    participantId: targetRoute.participantId,
    threadId: targetRoute.threadId,
    ...(typeof targetRoute.threadIsDirect === 'boolean'
      ? { threadIsDirect: targetRoute.threadIsDirect }
      : {}),
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
  return boundCanonicalAssistantCronOccurrenceByActiveUntil(
    source,
    resolveCanonicalAssistantCronUnboundedOccurrenceAt(source, runtimeState),
  )
}

export function resolveCanonicalAssistantCronNextDeliverableOccurrenceProjection(
  source: CanonicalAssistantCronJobRecord,
  runtimeState: AssistantCronCanonicalRuntimeRecord,
  now: Date,
): {
  nextOccurrenceAt: string | null
  verified: boolean
} {
  if (
    runtimeState.state.pendingOccurrenceAt !== null ||
    runtimeState.state.retryAfterAt !== null ||
    runtimeState.state.pendingDeliveryIntentId !== null ||
    runtimeState.state.runningAt !== null
  ) {
    return {
      nextOccurrenceAt: null,
      verified: false,
    }
  }

  const occurrenceAt = resolveCanonicalAssistantCronUnboundedOccurrenceAt(
    source,
    runtimeState,
  )
  if (
    occurrenceAt === null ||
    (source.kind === 'automation' &&
      source.activeUntil !== null &&
      Date.parse(occurrenceAt) >= Date.parse(source.activeUntil))
  ) {
    return {
      nextOccurrenceAt: null,
      verified: true,
    }
  }

  if (
    source.kind === 'automation' &&
    source.schedule.kind === 'at' &&
    !isCanonicalAssistantCronNotificationOccurrenceDeliverable({
      now,
      occurrenceAt,
      source,
    })
  ) {
    return {
      nextOccurrenceAt: null,
      verified: true,
    }
  }

  return {
    nextOccurrenceAt: occurrenceAt,
    verified: true,
  }
}

export function isAssistantCronNotificationOccurrenceFresh(input: {
  now: Date
  occurrenceAt: string
}): boolean {
  const nowMs = input.now.getTime()
  const occurrenceMs = Date.parse(input.occurrenceAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(occurrenceMs)) {
    return true
  }

  return nowMs - occurrenceMs <= ASSISTANT_CRON_NOTIFICATION_EXPIRES_AFTER_MS
}

export function isCanonicalAssistantCronNotificationOccurrenceDeliverable(
  input: {
    now: Date
    occurrenceAt: string
    source: CanonicalAssistantCronJobRecord
  },
): boolean {
  if (input.source.kind === 'scheduledLog') {
    return true
  }

  if (
    input.source.schedule.kind === 'at' &&
    input.source.activeUntil !== null &&
    input.now.getTime() < Date.parse(input.source.activeUntil)
  ) {
    return true
  }

  return isAssistantCronNotificationOccurrenceFresh(input)
}

function resolveCanonicalAssistantCronUnboundedOccurrenceAt(
  source: CanonicalAssistantCronJobRecord,
  runtimeState: AssistantCronCanonicalRuntimeRecord,
): string | null {
  if (!isCanonicalAssistantCronSourceEnabled(source)) {
    return null
  }

  const pendingOccurrenceAt = resolveCurrentCanonicalPendingOccurrenceAt({
    runtimeUpdatedAt: runtimeState.updatedAt,
    source,
    state: runtimeState.state,
  })
  if (pendingOccurrenceAt) {
    return pendingOccurrenceAt
  }

  if (source.schedule.kind === 'at') {
    return source.schedule.at
  }

  const anchorAt = resolveCanonicalAssistantCronScheduleAnchorAt({
    pendingOccurrenceIgnored:
      runtimeState.state.pendingOccurrenceAt !== null &&
      pendingOccurrenceAt === null,
    source,
    state: runtimeState.state,
  })
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
      timeZone: input.schedule.timeZone ?? input.timeZone ?? 'UTC',
    }
  }

  if (input.schedule.kind === 'dailyLocal') {
    return {
      kind: 'dailyLocal',
      localTime: input.schedule.localTime,
      timeZone: input.schedule.timeZone ?? input.timeZone ?? 'UTC',
    }
  }

  return input.schedule
}

export function buildCanonicalAutomationUpsertInput(input: {
  automationId?: string
  automation?: Pick<
    CanonicalAutomationAssistantCronJobRecord,
    | 'activeUntil'
    | 'assistantTargetOverride'
    | 'continuityPolicy'
    | 'slug'
    | 'summary'
    | 'tags'
  > | null
  activeUntil?: string | null
  assistantTargetOverride?: CanonicalAutomationAssistantCronJobRecord['assistantTargetOverride']
  continuityPolicy?: CanonicalAutomationAssistantCronJobRecord['continuityPolicy']
  instructions: string
  now?: Date
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
    now: input.now,
    automationId: input.automationId,
    slug: input.slug ?? input.automation?.slug,
    title: input.title,
    status: input.status,
    summary: input.summary ?? input.automation?.summary ?? undefined,
    schedule: input.schedule,
    route: input.route,
    assistantTargetOverride:
      input.assistantTargetOverride === undefined
        ? input.automation?.assistantTargetOverride ?? undefined
        : input.assistantTargetOverride,
    continuityPolicy:
      input.continuityPolicy ?? input.automation?.continuityPolicy ?? 'preserve',
    activeUntil:
      input.activeUntil === undefined
        ? input.automation?.activeUntil ?? undefined
        : input.activeUntil,
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
  return (await resolveAssistantCronDefaultTimeZoneProjection(vault)).timeZone
}

export async function resolveAssistantCronDefaultTimeZoneProjection(
  vault: string,
): Promise<{
  timeZone: string
  vaultTimeZoneVerified: boolean
}> {
  const vaultTimeZone = await resolveAssistantCronVaultTimeZone(vault)
  return {
    timeZone: vaultTimeZone ?? resolveSystemTimeZone(),
    vaultTimeZoneVerified: vaultTimeZone !== null,
  }
}

export async function resolveAssistantCronVaultTimeZone(
  vault: string,
): Promise<string | null> {
  try {
    const loadedVault = await loadVault({
      vaultRoot: vault,
    })
    return normalizeIanaTimeZone(loadedVault.metadata.timezone)
  } catch {
    return null
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
    activeUntil: record.activeUntil ?? null,
    automationId: record.automationId,
    continuityPolicy: record.continuityPolicy,
    createdAt: record.createdAt,
    scheduleAnchorAt: record.scheduleAnchorAt ?? record.createdAt,
    instructions,
    route: record.route,
    assistantTargetOverride: record.assistantTargetOverride,
    schedule: normalizeAssistantCronPublicSchedule(record.schedule),
    slug: record.slug,
    status: record.status,
    summary: record.summary,
    supportKind: record.supportKind ?? null,
    tags: [...record.tags],
    timeZone:
      record.schedule.kind === 'cron' || record.schedule.kind === 'dailyLocal'
        ? record.schedule.timeZone ?? timeZone
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
    case 'automation': {
      const newsletterDelivery = resolveGroupNewsletterAutomationDelivery(source)
      return newsletterDelivery === null
        ? source.instructions
        : [
            source.instructions,
            buildGroupNewsletterScheduledExecutionPrompt({
              delivery: newsletterDelivery,
              newsletterName: source.title,
            }),
          ].join('\n\n')
    }
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
    runtimeUpdatedAt: input.runtimeState.updatedAt,
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
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}),
    })
  }

  if (schedule.kind === 'dailyLocal') {
    return assistantCronScheduleSchema.parse({
      kind: 'dailyLocal',
      localTime: schedule.localTime,
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}),
    })
  }

  return assistantCronScheduleSchema.parse(schedule)
}

function resolveCanonicalAssistantCronNextRunAt(input: {
  runtimeUpdatedAt: string
  source: CanonicalAssistantCronJobRecord
  state: AssistantCronCanonicalRuntimeState
}): string | null {
  if (!isCanonicalAssistantCronSourceEnabled(input.source)) {
    return null
  }

  if (input.state.pendingDeliveryIntentId) {
    return null
  }

  const pendingOccurrenceAt = resolveCurrentCanonicalPendingOccurrenceAt(input)
  if (pendingOccurrenceAt) {
    return boundCanonicalAssistantCronOccurrenceByActiveUntil(
      input.source,
      input.state.retryAfterAt ?? pendingOccurrenceAt,
    )
  }

  if (input.source.schedule.kind === 'at') {
    return input.source.schedule.at
  }

  const anchorAt = resolveCanonicalAssistantCronScheduleAnchorAt({
    pendingOccurrenceIgnored:
      input.state.pendingOccurrenceAt !== null &&
      pendingOccurrenceAt === null,
    source: input.source,
    state: input.state,
  })
  if (!anchorAt) {
    return null
  }

  return boundCanonicalAssistantCronOccurrenceByActiveUntil(
    input.source,
    computeAssistantCronNextRunAt(
      resolveAssistantCronResolvedSchedule({
        schedule: input.source.schedule,
        timeZone: input.source.timeZone,
      }),
      new Date(anchorAt),
    ),
  )
}

function boundCanonicalAssistantCronOccurrenceByActiveUntil(
  source: CanonicalAssistantCronJobRecord,
  occurrenceAt: string | null,
): string | null {
  if (source.kind !== 'automation' || !source.activeUntil) {
    return occurrenceAt
  }
  if (!occurrenceAt) {
    return source.activeUntil
  }

  return Date.parse(source.activeUntil) <= Date.parse(occurrenceAt)
    ? source.activeUntil
    : occurrenceAt
}

function resolveCurrentCanonicalPendingOccurrenceAt(input: {
  runtimeUpdatedAt: string
  source: CanonicalAssistantCronJobRecord
  state: AssistantCronCanonicalRuntimeState
}): string | null {
  const pendingOccurrenceAt = input.state.pendingOccurrenceAt
  if (!pendingOccurrenceAt) {
    return null
  }

  if (input.state.runningAt || input.state.pendingDeliveryIntentId) {
    return pendingOccurrenceAt
  }

  if (!canonicalSourceScheduleTransitionIsUnconsumed(input)) {
    return pendingOccurrenceAt
  }

  return isCanonicalPendingOccurrenceForCurrentSchedule({
    pendingOccurrenceAt,
    source: input.source,
    state: input.state,
  })
    ? pendingOccurrenceAt
    : null
}

function canonicalSourceScheduleTransitionIsUnconsumed(input: {
  runtimeUpdatedAt: string
  source: CanonicalAssistantCronJobRecord
  state: AssistantCronCanonicalRuntimeState
}): boolean {
  if (input.source.kind === 'scheduledLog') {
    return canonicalScheduledLogSourceChangedAfterRuntimeState({
      runtimeUpdatedAt: input.runtimeUpdatedAt,
      source: input.source,
    })
  }

  const sourceScheduleAnchorMs = Date.parse(
    resolveCanonicalAssistantCronSourceScheduleAnchorAt(input.source),
  )
  const consumedAnchorAt = resolveCanonicalAssistantCronConsumedAnchorAt(
    input.state,
  )
  const consumedAnchorMs = consumedAnchorAt
    ? Date.parse(consumedAnchorAt)
    : Number.NEGATIVE_INFINITY
  return (
    Number.isFinite(sourceScheduleAnchorMs) &&
    sourceScheduleAnchorMs > consumedAnchorMs
  )
}

function canonicalScheduledLogSourceChangedAfterRuntimeState(input: {
  runtimeUpdatedAt: string
  source: CanonicalScheduledLogAssistantCronJobRecord
}): boolean {
  const sourceCreatedMs = Date.parse(input.source.createdAt)
  const sourceUpdatedMs = Date.parse(input.source.updatedAt)
  const runtimeUpdatedMs = Date.parse(input.runtimeUpdatedAt)
  if (
    !Number.isFinite(sourceCreatedMs) ||
    !Number.isFinite(sourceUpdatedMs) ||
    !Number.isFinite(runtimeUpdatedMs)
  ) {
    return false
  }

  return sourceUpdatedMs !== sourceCreatedMs && sourceUpdatedMs > runtimeUpdatedMs
}

function isCanonicalPendingOccurrenceForCurrentSchedule(input: {
  pendingOccurrenceAt: string
  source: CanonicalAssistantCronJobRecord
  state: AssistantCronCanonicalRuntimeState
}): boolean {
  const pendingOccurrenceMs = Date.parse(input.pendingOccurrenceAt)
  if (!Number.isFinite(pendingOccurrenceMs)) {
    return false
  }

  const sourceScheduleAnchorMs = Date.parse(
    resolveCanonicalAssistantCronSourceScheduleAnchorAt(input.source),
  )
  if (
    Number.isFinite(sourceScheduleAnchorMs) &&
    pendingOccurrenceMs <= sourceScheduleAnchorMs
  ) {
    return false
  }

  if (input.source.schedule.kind === 'at') {
    return input.pendingOccurrenceAt === input.source.schedule.at
  }

  if (input.source.schedule.kind === 'every') {
    const anchorAt = resolveCanonicalAssistantCronScheduleAnchorAt(input)
    if (!anchorAt) {
      return true
    }

    return (
      computeAssistantCronNextRunAt(input.source.schedule, new Date(anchorAt)) ===
      input.pendingOccurrenceAt
    )
  }

  return (
    computeAssistantCronNextRunAt(
      resolveAssistantCronResolvedSchedule({
        schedule: input.source.schedule,
        timeZone: input.source.timeZone,
      }),
      new Date(pendingOccurrenceMs - 60_000),
    ) === input.pendingOccurrenceAt
  )
}

function resolveCanonicalAssistantCronScheduleAnchorAt(input: {
  pendingOccurrenceIgnored?: boolean
  source: CanonicalAssistantCronJobRecord
  state: AssistantCronCanonicalRuntimeState
}): string | null {
  if (
    input.source.kind === 'scheduledLog' &&
    input.pendingOccurrenceIgnored === true
  ) {
    return input.source.updatedAt
  }

  return latestAssistantCronTimestamp([
    resolveCanonicalAssistantCronConsumedAnchorAt(input.state),
    resolveCanonicalAssistantCronSourceScheduleAnchorAt(input.source),
  ])
}

function resolveCanonicalAssistantCronSourceScheduleAnchorAt(
  source: CanonicalAssistantCronJobRecord,
): string {
  return source.kind === 'automation'
    ? source.scheduleAnchorAt ?? source.createdAt
    : source.createdAt
}

function resolveCanonicalAssistantCronConsumedAnchorAt(
  state: AssistantCronCanonicalRuntimeState,
): string | null {
  const consumedFailedAt =
    state.consecutiveFailures === 0 ? state.lastFailedAt : null
  return latestAssistantCronTimestamp([
    state.lastSucceededAt,
    consumedFailedAt,
    state.activatedAt,
  ])
}

function latestAssistantCronTimestamp(
  values: readonly (string | null | undefined)[],
): string | null {
  let latestValue: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!value) {
      continue
    }
    const valueMs = Date.parse(value)
    if (!Number.isFinite(valueMs) || valueMs < latestMs) {
      continue
    }
    latestValue = value
    latestMs = valueMs
  }

  return latestValue
}
