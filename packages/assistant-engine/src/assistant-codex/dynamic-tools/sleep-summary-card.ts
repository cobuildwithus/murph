import { formatTimeZoneDateTimeParts, sleepSummaryResponseCardV1Schema, type SleepSummaryResponseCardV1 } from '@murphai/contracts'
import { resolveWearableSleepCardNight, type WearableSleepCardNight } from '@murphai/query'

export async function resolveTrustedSleepSummaryCard(input: {
  date: string
  vaultRoot: string | null
}): Promise<SleepSummaryResponseCardV1 | null> {
  if (!input.vaultRoot) return null
  const resolved = await resolveWearableSleepCardNight(input.vaultRoot, { wakeDate: input.date })
  if (!resolved) return null
  const { night, recovery, timeZone, sdnnMilliseconds } = resolved
  const start = Date.parse(night.sleepStartAt ?? '')
  const end = Date.parse(night.sleepEndAt ?? '')
  const hasWindow = timeZone !== null && Number.isFinite(start) && Number.isFinite(end) && end > start
  const efficiency = night.sleepEfficiency.selection.value
  const rmssd = rounded(night.hrv.selection.value, 1, 1000)
  const sdnn = rounded(sdnnMilliseconds, 1, 1000)
  const totalSleepMinutes = Math.round(night.totalSleepMinutes.selection.value!)
  return sleepSummaryResponseCardV1Schema.parse({
    kind: 'sleep_summary', version: 1, localDate: input.date,
    bedtime: hasWindow ? clock(start, timeZone) : null,
    wakeTime: hasWindow ? clock(end, timeZone) : null,
    totalSleepMinutes,
    score: rounded(night.sleepScore.selection.value ?? night.sleepPerformance.selection.value, 0, 100),
    stages: sleepStages(night, totalSleepMinutes),
    awakeMinutes: rounded(night.awakeMinutes.selection.value, 1, 1440),
    efficiencyPercent: rounded(efficiency === null ? null : efficiency <= 1 ? efficiency * 100 : efficiency, 1, 100),
    hrv: rmssd !== null ? { milliseconds: rmssd, method: 'rmssd' }
      : sdnn !== null ? { milliseconds: sdnn, method: 'sdnn' } : null,
    restingHeartRate: rounded(recovery?.restingHeartRate.selection.value ?? null, 20, 250),
    wakeUps: null,
  })
}

function sleepStages(night: WearableSleepCardNight['night'], totalSleepMinutes: number): SleepSummaryResponseCardV1['stages'] {
  const stageKeys = ['deepMinutes', 'remMinutes', 'lightMinutes'] as const
  const stages = { deepMinutes: 0, remMinutes: 0, lightMinutes: 0 }
  const remainders = []
  let measuredMinutes = 0
  let wholeMinutes = 0
  for (const key of stageKeys) {
    const value = night[key].selection.value
    if (value === null || !Number.isFinite(value) || value < 0 || value > 1440) return null
    stages[key] = Math.floor(value)
    measuredMinutes += value
    wholeMinutes += stages[key]
    remainders.push({ key, fraction: value - stages[key] })
  }
  const subtotal = Math.round(measuredMinutes)
  if (subtotal < 1 || subtotal > totalSleepMinutes) return null

  // Round the breakdown to its own subtotal, including partially classified nights.
  remainders.sort((left, right) => right.fraction - left.fraction)
  for (const { key } of remainders.slice(0, subtotal - wholeMinutes)) stages[key] += 1
  return stages
}

function rounded(value: number | null, min: number, max: number): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const result = Math.round(value)
  return result >= min && result <= max ? result : null
}

function clock(at: number, zone: string): string {
  const parts = formatTimeZoneDateTimeParts(new Date(at), zone)
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}
