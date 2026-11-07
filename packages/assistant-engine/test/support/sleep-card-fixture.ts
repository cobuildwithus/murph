import type { AssistantResponseCard } from '@murphai/contracts'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { initializeVault, withCanonicalWriteLock } from '@murphai/core'

export const SYNTHETIC_SLEEP_NIGHT_VALUES = {
  totalSleepMinutes: 436.2, deepMinutes: 141, remMinutes: 118, lightMinutes: 177, awakeMinutes: 28,
  sleepEfficiency: 94, sleepScore: 85, hrv: 66, restingHeartRate: 45,
} as const

/** One synthetic night waking 2026-11-03, written as canonical device ledger rows. */
export async function seedSyntheticSleepNight(
  root: string,
  provider: string,
  values: Record<string, number>,
  options: { window?: boolean; timeZone?: string; vaultZone?: string; priorNights?: readonly SyntheticPriorNight[] } = {},
): Promise<void> {
  await initializeVault({ vaultRoot: root, timezone: options.vaultZone ?? 'UTC', createdAt: '2026-01-01T00:00:00Z' })
  const base = { schemaVersion: 'murph.event.v1', source: 'device', dayKey: '2026-11-03', occurredAt: '2026-11-03T08:02:00Z', recordedAt: '2026-11-03T09:00:00Z', ...(options.timeZone ? { timeZone: options.timeZone } : {}) }
  const ref = { system: provider, resourceType: 'sleep', resourceId: 'synthetic-night' }
  const rows: unknown[] = options.window === false ? [] : [{ ...base, id: 'evt_synthetic_window', kind: 'sleep_session', title: 'Synthetic main sleep', startAt: '2026-11-03T00:18:00Z', endAt: '2026-11-03T08:02:00Z', durationMinutes: 464, sleepType: 'main_sleep', sleepState: 'confirmed', externalRef: ref }]
  for (const [metric, value] of Object.entries(values)) rows.push({ ...base, id: `evt_synthetic_${metric}`, kind: 'observation', title: 'Synthetic metric', metric, value, unit: metric.includes('Minutes') ? 'minutes' : metric.includes('hrv') ? 'ms' : metric.includes('HeartRate') ? 'bpm' : metric.includes('Efficiency') || metric.includes('Performance') ? '%' : 'score', externalRef: { ...ref, resourceType: metric === 'restingHeartRate' ? 'daily' : 'sleep', facet: metric } })
  for (const night of options.priorNights ?? []) rows.push(...syntheticPriorNightRows(provider, night, options.timeZone))
  const months = new Map<string, unknown[]>()
  for (const row of rows) {
    const month = (row as { dayKey: string }).dayKey.slice(0, 7)
    months.set(month, [...(months.get(month) ?? []), row])
  }
  await withCanonicalWriteLock(root, async () => {
    await mkdir(path.join(root, 'ledger/events/2026'), { recursive: true })
    for (const [month, monthRows] of months) {
      await writeFile(path.join(root, `ledger/events/2026/${month}.jsonl`), monthRows.map(row => JSON.stringify(row)).join('\n') + '\n')
    }
  })
}

/** An earlier synthetic night, so trend notes have recent history to compare against. */
export type SyntheticPriorNight = { dayKey: string; startAt: string; endAt: string; values: Record<string, number> }

/** Seven shorter nights before the 2026-11-03 card night, so it is the longest of the week. */
export const SYNTHETIC_PRIOR_SLEEP_NIGHTS: readonly SyntheticPriorNight[] = [
  ['2026-10-27', '00:52', '07:31', 372, 96, 90, 186, 27, 92, 73, 57, 49],
  ['2026-10-28', '01:05', '07:40', 368, 94, 88, 186, 27, 92, 72, 56, 50],
  ['2026-10-29', '00:47', '07:36', 381, 99, 93, 189, 28, 93, 75, 59, 49],
  ['2026-10-30', '00:58', '07:44', 377, 97, 91, 189, 29, 93, 74, 58, 49],
  ['2026-10-31', '01:12', '07:52', 371, 95, 90, 186, 29, 92, 73, 57, 50],
  ['2026-11-01', '00:41', '07:35', 381, 98, 92, 191, 33, 92, 74, 58, 49],
  ['2026-11-02', '00:55', '07:48', 389, 104, 96, 189, 24, 94, 77, 61, 48],
].map(([dayKey, start, end, totalSleepMinutes, deepMinutes, remMinutes, lightMinutes, awakeMinutes, sleepEfficiency, sleepScore, hrv, restingHeartRate]) => ({
  dayKey: dayKey as string,
  startAt: `${dayKey as string}T${start as string}:00Z`,
  endAt: `${dayKey as string}T${end as string}:00Z`,
  values: { totalSleepMinutes, deepMinutes, remMinutes, lightMinutes, awakeMinutes, sleepEfficiency, sleepScore, hrv, restingHeartRate } as Record<string, number>,
}))

function syntheticPriorNightRows(provider: string, night: SyntheticPriorNight, timeZone?: string): unknown[] {
  const base = { schemaVersion: 'murph.event.v1', source: 'device', dayKey: night.dayKey, occurredAt: night.endAt, recordedAt: night.endAt, ...(timeZone ? { timeZone } : {}) }
  const ref = { system: provider, resourceType: 'sleep', resourceId: `synthetic-night-${night.dayKey}` }
  const durationMinutes = (Date.parse(night.endAt) - Date.parse(night.startAt)) / 60_000
  const suffix = night.dayKey.replaceAll('-', '')
  return [
    { ...base, id: `evt_synthetic_window_${suffix}`, kind: 'sleep_session', title: 'Synthetic main sleep', startAt: night.startAt, endAt: night.endAt, durationMinutes, sleepType: 'main_sleep', sleepState: 'confirmed', externalRef: ref },
    ...Object.entries(night.values).map(([metric, value]) => ({ ...base, id: `evt_synthetic_${metric}_${suffix}`, kind: 'observation', title: 'Synthetic metric', metric, value, unit: metric.includes('Minutes') ? 'minutes' : metric.includes('hrv') ? 'ms' : metric.includes('HeartRate') ? 'bpm' : metric.includes('Efficiency') || metric.includes('Performance') ? '%' : 'score', externalRef: { ...ref, resourceType: metric === 'restingHeartRate' ? 'daily' : 'sleep', facet: metric } })),
  ]
}

export const SYNTHETIC_SLEEP_CARD = {
  kind: 'sleep_summary', version: 1, localDate: '2026-11-03',
  bedtime: null, wakeTime: null, totalSleepMinutes: 436, score: null,
  stages: null, awakeMinutes: null, efficiencyPercent: null,
  hrv: null, restingHeartRate: null, wakeUps: null,
} as const satisfies AssistantResponseCard
