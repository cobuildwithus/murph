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
  return sleepSummaryResponseCardV1Schema.parse({
    kind: 'sleep_summary', version: 1, localDate: input.date,
    bedtime: hasWindow ? clock(start, timeZone) : null,
    wakeTime: hasWindow ? clock(end, timeZone) : null,
    totalSleepMinutes: Math.round(night.totalSleepMinutes.selection.value!),
    score: rounded(night.sleepScore.selection.value ?? night.sleepPerformance.selection.value, 0, 100),
    stages: sleepStages(night),
    awakeMinutes: rounded(night.awakeMinutes.selection.value, 1, 1440),
    efficiencyPercent: rounded(efficiency === null ? null : efficiency <= 1 ? efficiency * 100 : efficiency, 1, 100),
    hrv: rmssd !== null ? { milliseconds: rmssd, method: 'rmssd' }
      : sdnn !== null ? { milliseconds: sdnn, method: 'sdnn' } : null,
    restingHeartRate: rounded(recovery?.restingHeartRate.selection.value ?? null, 20, 250),
    wakeUps: null,
  })
}

function sleepStages(night: WearableSleepCardNight['night']): SleepSummaryResponseCardV1['stages'] {
  const deepMinutes = rounded(night.deepMinutes.selection.value, 0, 1440)
  const remMinutes = rounded(night.remMinutes.selection.value, 0, 1440)
  const lightMinutes = rounded(night.lightMinutes.selection.value, 0, 1440)
  return deepMinutes !== null && remMinutes !== null && lightMinutes !== null
    && deepMinutes + remMinutes + lightMinutes > 0 && deepMinutes + remMinutes + lightMinutes <= 1440
    ? { deepMinutes, remMinutes, lightMinutes } : null
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
