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
  options: { window?: boolean; timeZone?: string; vaultZone?: string } = {},
): Promise<void> {
  await initializeVault({ vaultRoot: root, timezone: options.vaultZone ?? 'UTC', createdAt: '2026-01-01T00:00:00Z' })
  const base = { schemaVersion: 'murph.event.v1', source: 'device', dayKey: '2026-11-03', occurredAt: '2026-11-03T08:02:00Z', recordedAt: '2026-11-03T09:00:00Z', ...(options.timeZone ? { timeZone: options.timeZone } : {}) }
  const ref = { system: provider, resourceType: 'sleep', resourceId: 'synthetic-night' }
  const rows: unknown[] = options.window === false ? [] : [{ ...base, id: 'evt_synthetic_window', kind: 'sleep_session', title: 'Synthetic main sleep', startAt: '2026-11-03T00:18:00Z', endAt: '2026-11-03T08:02:00Z', durationMinutes: 464, sleepType: 'main_sleep', sleepState: 'confirmed', externalRef: ref }]
  for (const [metric, value] of Object.entries(values)) rows.push({ ...base, id: `evt_synthetic_${metric}`, kind: 'observation', title: 'Synthetic metric', metric, value, unit: metric.includes('Minutes') ? 'minutes' : metric.includes('hrv') ? 'ms' : metric.includes('HeartRate') ? 'bpm' : metric.includes('Efficiency') || metric.includes('Performance') ? '%' : 'score', externalRef: { ...ref, resourceType: metric === 'restingHeartRate' ? 'daily' : 'sleep', facet: metric } })
  await withCanonicalWriteLock(root, async () => {
    await mkdir(path.join(root, 'ledger/events/2026'), { recursive: true })
    await writeFile(path.join(root, 'ledger/events/2026/2026-11.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  })
}
