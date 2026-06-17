import { upsertAutomation } from '@murphai/core'
import {
  listAutomations,
  readVaultRawTolerant,
  type AutomationQueryRecord,
  type VaultReadModel,
} from '@murphai/query'
import type { AutomationSchedule } from '@murphai/contracts'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from './automation-tags.js'

type DeviceActivitySchedule = Extract<AutomationSchedule, { kind: 'deviceActivity' }>
type DeviceActivityAutomation = AutomationQueryRecord & { schedule: DeviceActivitySchedule }
type ActivityEntity = VaultReadModel['events'][number]
type DeviceActivityEventKind = 'activity_session' | 'sleep_session'

interface DeviceActivityCandidate {
  activityKind: string
  durationMinutes: number | null
  entityId: string
  occurredAt: string
  provider: string | null
  recordKind: DeviceActivityEventKind
  title: string | null
  triggeredAt: string
}

interface MatchedDeviceActivity extends DeviceActivityCandidate {
  summary: string
}

export interface ScheduleDeviceActivityTriggeredAutomationsInput {
  now?: () => string
  signal?: AbortSignal
  vault: string
}

export interface ScheduleDeviceActivityTriggeredAutomationsResult {
  matched: number
  nextWakeAt: string | null
  scheduled: number
}

export async function scheduleDeviceActivityTriggeredAutomations(
  input: ScheduleDeviceActivityTriggeredAutomationsInput,
): Promise<ScheduleDeviceActivityTriggeredAutomationsResult> {
  const nowIso = input.now?.() ?? new Date().toISOString()
  return await scheduleDeviceActivityTriggeredAutomationsAt({
    ...input,
    nowIso,
  })
}

async function scheduleDeviceActivityTriggeredAutomationsAt(
  input: ScheduleDeviceActivityTriggeredAutomationsInput & { nowIso: string },
): Promise<ScheduleDeviceActivityTriggeredAutomationsResult> {
  const automations = await listAutomations(input.vault, { status: ['active'] })
  const hasDueScheduledActivityReminder = hasDueAssistantRequireSendAutomation({
    automations,
    nowIso: input.nowIso,
  })
  const deviceActivityAutomations = automations.filter(isDeviceActivityAutomation)

  if (deviceActivityAutomations.length === 0) {
    return {
      matched: 0,
      nextWakeAt: hasDueScheduledActivityReminder ? input.nowIso : null,
      scheduled: 0,
    }
  }

  const vault = await readVaultRawTolerant(input.vault)
  const activityCandidates = listDeviceActivityCandidates(vault)
  let matched = 0
  let scheduled = 0

  for (const automation of deviceActivityAutomations) {
    if (input.signal?.aborted) {
      break
    }

    const activity = findMatchingDeviceActivity({
      automation,
      candidates: activityCandidates,
    })

    if (!activity) {
      continue
    }

    matched += 1
    await scheduleDeviceActivityAutomationNotification({
      activity,
      automation,
      nowIso: input.nowIso,
      vault: input.vault,
    })
    scheduled += 1
  }

  return {
    matched,
    nextWakeAt: scheduled > 0 || hasDueScheduledActivityReminder
      ? input.nowIso
      : null,
    scheduled,
  }
}

function isDeviceActivityAutomation(record: AutomationQueryRecord): record is DeviceActivityAutomation {
  return record.schedule.kind === 'deviceActivity'
}

function hasDueAssistantRequireSendAutomation(input: {
  automations: readonly AutomationQueryRecord[]
  nowIso: string
}): boolean {
  const nowMs = Date.parse(input.nowIso)
  if (!Number.isFinite(nowMs)) {
    return false
  }

  return input.automations.some((automation) => {
    if (
      automation.schedule.kind !== 'at' ||
      !automation.tags.includes(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    ) {
      return false
    }

    const scheduledMs = Date.parse(automation.schedule.at)
    return Number.isFinite(scheduledMs) && scheduledMs <= nowMs
  })
}

function listDeviceActivityCandidates(vault: VaultReadModel): DeviceActivityCandidate[] {
  return vault.events
    .filter(isDeviceActivityEventEntity)
    .flatMap((entity) => {
      const occurredAt = resolveActivityOccurredAt(entity)
      const triggeredAt = resolveDeviceActivityTriggeredAt(entity)
      return occurredAt && triggeredAt
        ? [{
            activityKind: resolveDeviceActivityKind(entity),
            durationMinutes: readActivityDurationMinutes(entity),
            entityId: entity.entityId,
            occurredAt,
            provider: resolveActivityProvider(entity),
            recordKind: entity.kind,
            title: readEntityTitle(entity),
            triggeredAt,
          }]
        : []
    })
}

function findMatchingDeviceActivity(input: {
  automation: DeviceActivityAutomation
  candidates: readonly DeviceActivityCandidate[]
}): MatchedDeviceActivity | null {
  const [candidate] = input.candidates
    .filter((entry) => Date.parse(entry.triggeredAt) > Date.parse(input.automation.schedule.after))
    .filter((entry) => deviceActivitySourceMatches(entry, input.automation.schedule.source))
    .filter((entry) => deviceActivityKindMatches(entry, input.automation.schedule.activityKind))
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))

  return candidate ? buildMatchedDeviceActivity(input.automation, candidate) : null
}

function buildMatchedDeviceActivity(
  automation: DeviceActivityAutomation,
  candidate: DeviceActivityCandidate,
): MatchedDeviceActivity {
  const activityKind = automation.schedule.activityKind ?? candidate.activityKind
  const summaryParts = [
    `Kind: ${activityKind}`,
    `Occurred at: ${candidate.occurredAt}`,
    candidate.triggeredAt !== candidate.occurredAt ? `Recorded at: ${candidate.triggeredAt}` : null,
    candidate.provider ? `Source: ${candidate.provider}` : null,
    candidate.title ? `Title: ${candidate.title}` : null,
    candidate.durationMinutes !== null ? `Duration: ${Math.round(candidate.durationMinutes)} minutes` : null,
  ].filter((part): part is string => part !== null)

  return {
    ...candidate,
    activityKind,
    summary: summaryParts.join('\n'),
  }
}

function resolveActivityOccurredAt(entity: ActivityEntity): string | null {
  return normalizeTimestamp(
    readString(entity.attributes.startAt)
      ?? readString(entity.attributes.occurredAt)
      ?? entity.occurredAt
      ?? readString(entity.attributes.recordedAt),
  )
}

function resolveDeviceActivityTriggeredAt(entity: ActivityEntity): string | null {
  return normalizeTimestamp(
    readString(entity.attributes.recordedAt)
      ?? entity.occurredAt
      ?? readString(entity.attributes.occurredAt)
      ?? readString(entity.attributes.startAt),
  )
}

function readActivityDurationMinutes(entity: ActivityEntity): number | null {
  return readNumber(entity.attributes.durationMinutes)
    ?? readNumber(readRecord(entity.attributes.workout)?.durationMinutes)
    ?? null
}

function isDeviceActivityEventEntity(
  entity: ActivityEntity,
): entity is ActivityEntity & { kind: DeviceActivityEventKind } {
  return entity.kind === 'activity_session' || entity.kind === 'sleep_session'
}

function resolveDeviceActivityKind(entity: ActivityEntity & { kind: DeviceActivityEventKind }): string {
  if (entity.kind === 'sleep_session') {
    return 'sleep'
  }

  for (const candidate of listActivityKindTextCandidates(entity)) {
    const normalized = normalizeDeviceActivityKindToken(candidate)
    if (normalized) {
      return normalized
    }
  }

  return 'activity'
}

function listActivityKindTextCandidates(entity: ActivityEntity): string[] {
  const workout = readRecord(entity.attributes.workout)
  const sport = readRecord(entity.attributes.sport)
  const workoutSport = readRecord(workout?.sport)
  return [
    readString(entity.attributes.activityType),
    readString(entity.attributes.type),
    readString(entity.attributes.sport),
    readString(sport?.slug),
    readString(sport?.name),
    readString(sport?.type),
    readString(entity.attributes.name),
    readString(workout?.activityType),
    readString(workout?.type),
    readString(workout?.sport),
    readString(workoutSport?.slug),
    readString(workoutSport?.name),
    readString(workoutSport?.type),
    readString(workout?.name),
    readEntityTitle(entity),
  ].filter((entry): entry is string => entry !== null)
}

function deviceActivityKindMatches(
  candidate: DeviceActivityCandidate,
  activityKind: DeviceActivitySchedule['activityKind'],
): boolean {
  if (!activityKind) {
    return true
  }

  const requested = normalizeDeviceActivityKindToken(activityKind)
  if (!requested) {
    return false
  }

  if (isSleepActivityKind(requested)) {
    return candidate.recordKind === 'sleep_session'
      || deviceActivityTextMatchesKind(candidate.activityKind, requested)
      || deviceActivityTextMatchesKind(candidate.title, requested)
  }

  if (requested === 'activity') {
    return candidate.recordKind === 'activity_session'
  }

  if (requested === 'activity-session' || requested === 'workout' || requested === 'workouts') {
    return candidate.recordKind === 'activity_session'
  }

  return deviceActivityTextMatchesKind(candidate.activityKind, requested)
    || deviceActivityTextMatchesKind(candidate.title, requested)
}

function deviceActivitySourceMatches(
  candidate: DeviceActivityCandidate,
  source: DeviceActivitySchedule['source'],
): boolean {
  if (!source) {
    return true
  }

  const provider = normalizeSourceToken(candidate.provider)
  switch (source) {
    case 'whoop':
      return provider === 'whoop' || provider === 'whoop-v2'
    case 'whoop_v2':
      return provider === 'whoop-v2'
  }
}

function resolveActivityProvider(entity: ActivityEntity): string | null {
  const externalRef = readRecord(entity.attributes.externalRef)
  const dataOrigin = readRecord(entity.attributes.dataOrigin)
  const sourceProvider = normalizeSourceToken(readString(dataOrigin?.sourceProviderSlug))
  const externalSystem = normalizeSourceToken(readString(externalRef?.system))
  const resourceType = normalizeSourceToken(readString(externalRef?.resourceType))

  if (sourceProvider && sourceProvider !== 'junction') {
    return sourceProvider
  }
  if (externalSystem && externalSystem !== 'junction') {
    return externalSystem
  }
  if (resourceType?.includes('whoop-v2')) {
    return 'whoop-v2'
  }
  if (resourceType?.includes('whoop')) {
    return 'whoop'
  }

  return externalSystem
}

async function scheduleDeviceActivityAutomationNotification(input: {
  activity: MatchedDeviceActivity
  automation: DeviceActivityAutomation
  nowIso: string
  vault: string
}): Promise<void> {
  await upsertAutomation({
    vaultRoot: input.vault,
    automationId: input.automation.automationId,
    continuityPolicy: input.automation.continuityPolicy,
    instructions: buildDeviceActivityAutomationInstructions(input.automation, input.activity),
    route: input.automation.route,
    schedule: {
      kind: 'at',
      at: input.nowIso,
    },
    slug: input.automation.slug,
    status: 'active',
    ...(input.automation.summary ? { summary: input.automation.summary } : {}),
    tags: mergeAutomationTags(input.automation.tags, [ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG]),
    title: input.automation.title,
  })
}

function buildDeviceActivityAutomationInstructions(
  automation: DeviceActivityAutomation,
  activity: MatchedDeviceActivity,
): string {
  return [
    automation.instructions,
    '',
    'Device activity context:',
    activity.summary,
    '',
    'Use the device activity context only if it is helpful. Do not mention hidden implementation details.',
  ].join('\n')
}

function readEntityTitle(entity: ActivityEntity): string | null {
  return readString(entity.title) ?? readString(entity.attributes.title)
}

function mergeAutomationTags(
  existing: readonly string[],
  added: readonly string[],
): string[] {
  return [...new Set([...existing, ...added])]
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function normalizeSourceToken(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/_/gu, '-')
  return normalized && normalized.length > 0 ? normalized : null
}

function normalizeDeviceActivityKindToken(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized && normalized.length > 0 ? normalized : null
}

function deviceActivityTextMatchesKind(
  text: string | null | undefined,
  requested: string,
): boolean {
  const normalized = normalizeDeviceActivityKindToken(text)
  if (!normalized) {
    return false
  }

  if (deviceActivityKindsEquivalent(normalized, requested)) {
    return true
  }

  const requestedAliases = deviceActivityKindAliasSet(requested)
  return normalized.split('-').some((part) => requestedAliases.has(part))
}

function deviceActivityKindsEquivalent(left: string, right: string): boolean {
  return left === right
    || deviceActivityKindAliasSet(left).has(right)
    || deviceActivityKindAliasSet(right).has(left)
}

function isSleepActivityKind(value: string): boolean {
  return deviceActivityKindAliasSet('sleep').has(value)
}

function deviceActivityKindAliasSet(value: string): Set<string> {
  const aliases = new Set([value])
  for (const group of deviceActivityKindAliasGroups) {
    if ((group as readonly string[]).includes(value)) {
      for (const alias of group) {
        aliases.add(alias)
      }
    }
  }
  return aliases
}

const deviceActivityKindAliasGroups = [
  ['walk', 'walking'],
  ['run', 'running'],
  ['bike', 'biking', 'cycle', 'cycling'],
  ['dance', 'dancing'],
  ['surf', 'surfing'],
  ['swim', 'swimming'],
  ['hike', 'hiking'],
  ['row', 'rowing'],
  ['strength', 'strength-training', 'weightlifting', 'weights'],
  ['sleep', 'sleep-session', 'sleep-summary', 'sleep-cycle'],
] as const satisfies readonly (readonly string[])[]
