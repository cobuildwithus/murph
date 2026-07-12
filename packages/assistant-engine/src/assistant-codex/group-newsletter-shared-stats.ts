import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  flattenSharedVaultShareProjectionStore,
  parseSharedVaultShareProjectionStore,
  SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH,
  type HostedVaultShareDailyMetricData,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareHeartRateZoneDayData,
  type HostedVaultShareSleepTimesData,
  type HostedVaultShareWorkoutDayData,
  type SharedGroupMemberView,
} from '@murphai/hosted-execution/vault-share'
import {
  buildOverviewWeeklyStatsFromDailySampleSummaries,
  type OverviewWeeklySampleSummary,
  type OverviewWeeklyStat,
} from '@murphai/query'

export interface GroupNewsletterSharedMemberDailyRecords {
  dailySampleSummaries: OverviewWeeklySampleSummary[]
  displayName: string | null
  memberId: string
}

export class GroupNewsletterSharedProjectionUnavailableError extends Error {
  constructor(message = 'Group newsletter shared projection is unavailable.') {
    super(message)
    this.name = 'GroupNewsletterSharedProjectionUnavailableError'
  }
}

export async function readGroupNewsletterSharedMemberDailyRecords(input: {
  vaultRoot: string
}): Promise<GroupNewsletterSharedMemberDailyRecords[]> {
  const store = await readGroupNewsletterProjectionStore(input.vaultRoot)
  if (!store) {
    return []
  }

  return flattenSharedVaultShareProjectionStore(store)
    .map((member) => ({
      dailySampleSummaries: readDailySampleSummaries(member)
        .sort(compareDailySampleSummaries),
      displayName: member.displayName,
      memberId: member.memberId,
    }))
    .sort((left, right) => left.memberId.localeCompare(right.memberId))
}

export function buildGroupNewsletterSharedWeeklyStats(input: {
  dailySampleSummaries: readonly OverviewWeeklySampleSummary[]
  referenceDate?: Date | string
  timeZone?: string | null
}): OverviewWeeklyStat[] {
  return buildOverviewWeeklyStatsFromDailySampleSummaries(
    input.dailySampleSummaries,
    input.timeZone?.trim() || 'UTC',
    input.referenceDate ?? new Date(),
  )
}

async function readGroupNewsletterProjectionStore(vaultRoot: string) {
  let raw: string
  try {
    raw = await readFile(
      join(vaultRoot, SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH),
      'utf8',
    )
  } catch (error) {
    if (readErrorCode(error) === 'ENOENT') {
      return null
    }
    throw new GroupNewsletterSharedProjectionUnavailableError(
      'Group newsletter shared projection could not be read.',
    )
  }

  try {
    return parseSharedVaultShareProjectionStore(JSON.parse(raw))
  } catch {
    throw new GroupNewsletterSharedProjectionUnavailableError(
      'Group newsletter shared projection is corrupt.',
    )
  }
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }
  return typeof error.code === 'string' ? error.code : null
}

function readDailySampleSummaries(
  member: SharedGroupMemberView,
): OverviewWeeklySampleSummary[] {
  const summaries: OverviewWeeklySampleSummary[] = []
  for (const share of member.shares) {
    for (const record of share.records) {
      appendDailySampleSummaries(summaries, record)
    }
  }
  return summaries
}

function appendDailySampleSummaries(
  summaries: OverviewWeeklySampleSummary[],
  record: HostedVaultShareDeliveryRecord,
): void {
  const data = record.data
  if (isDailyMetricData(data)) {
    summaries.push(dailySummary({
      date: data.date,
      stream: data.metricKey,
      sumValue: data.value,
      unit: data.unit,
    }))
    return
  }
  if (isWorkoutDayData(data)) {
    summaries.push(
      dailySummary({
        date: data.date,
        stream: 'workout-count',
        sumValue: data.workoutCount,
        unit: 'count',
      }),
      dailySummary({
        date: data.date,
        stream: 'activity-minutes',
        sumValue: data.workoutMinutes,
        unit: 'minutes',
      }),
    )
    return
  }
  if (isSleepTimesData(data)) {
    const durationMinutes = diffMinutes(data.sleepStartAt, data.sleepEndAt)
    if (durationMinutes !== null) {
      summaries.push(dailySummary({
        date: data.date,
        stream: 'sleep-duration-minutes',
        sumValue: durationMinutes,
        unit: 'minutes',
      }))
    }
    return
  }
  if (isHeartRateZoneDayData(data)) {
    for (const zone of data.zones) {
      const stream = typeof zone.zone === 'number'
        ? `heart-rate-zone-${zone.zone}-minutes`
        : zone.label?.trim()
          ? `heart-rate-zone-${zone.label.trim().toLowerCase().replace(/\s+/gu, '-')}-minutes`
          : null
      if (!stream) {
        continue
      }
      summaries.push(dailySummary({
        date: data.date,
        stream,
        sumValue: zone.durationMinutes,
        unit: 'minutes',
      }))
    }
  }
}

function dailySummary(input: {
  date: string
  stream: string
  sumValue: number
  unit: string | null
}): OverviewWeeklySampleSummary {
  return {
    date: input.date,
    numericSampleCount: 1,
    sampleCount: 1,
    stream: input.stream,
    sumValue: input.sumValue,
    unit: input.unit,
  }
}

function diffMinutes(start: string, end: string): number | null {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null
  }
  return (endMs - startMs) / 60_000
}

function compareDailySampleSummaries(
  left: OverviewWeeklySampleSummary,
  right: OverviewWeeklySampleSummary,
): number {
  return left.date === right.date
    ? left.stream.localeCompare(right.stream)
    : left.date.localeCompare(right.date)
}

function isDailyMetricData(
  data: HostedVaultShareDeliveryRecord['data'],
): data is HostedVaultShareDailyMetricData {
  return 'metricKey' in data
}

function isHeartRateZoneDayData(
  data: HostedVaultShareDeliveryRecord['data'],
): data is HostedVaultShareHeartRateZoneDayData {
  return 'zones' in data
}

function isSleepTimesData(
  data: HostedVaultShareDeliveryRecord['data'],
): data is HostedVaultShareSleepTimesData {
  return 'sleepStartAt' in data
}

function isWorkoutDayData(
  data: HostedVaultShareDeliveryRecord['data'],
): data is HostedVaultShareWorkoutDayData {
  return 'workoutCount' in data
}
