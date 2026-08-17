import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as coreRuntime from '@murphai/core'
import { importDeviceProviderSnapshot } from '@murphai/importers'
import {
  summarizeWearableLatestRuntime,
  summarizeWearableMetricLatestRuntime,
  summarizeWearableMetricTrendRuntime,
} from '@murphai/query'
import { expect, test } from 'vitest'

test('Junction activity summaries retain dedicated heart-rate and intensity query fields through core', async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), 'junction-activity-summary-query-'))
  const vaultRoot = path.join(parentRoot, 'vault')

  try {
    await coreRuntime.initializeVault({
      createdAt: '2026-08-09T00:00:00.000Z',
      timezone: 'UTC',
      vaultRoot,
    })
    await importDeviceProviderSnapshot(
      {
        provider: 'junction',
        sourceKind: 'poll',
        deliveryMode: 'scheduled_reconcile',
        vaultRoot,
        snapshot: {
          importedAt: '2026-08-11T12:00:00.000Z',
          summaries: {
            activity: [{
              id: 'activity-one',
              observed_at: '2026-08-10T12:00:00.000Z',
              average_heart_rate: 101,
              walking_average_heart_rate: 78,
              minimum_heart_rate: 49,
              low: 70,
              medium: 25,
              high: 10,
              source: { provider: 'garmin', type: 'watch' },
            }, {
              id: 'activity-two',
              observed_at: '2026-08-11T12:00:00.000Z',
              average_heart_rate: 106,
              walking_average_heart_rate: 81,
              minimum_heart_rate: 52,
              low: 75,
              medium: 30,
              high: 15,
              source: { provider: 'garmin', type: 'watch' },
            }],
          },
        },
      },
      { corePort: coreRuntime },
    )

    const activityOnly = await summarizeWearableLatestRuntime(vaultRoot)
    const latestActivityHeartRate = await summarizeWearableMetricLatestRuntime(
      vaultRoot,
      'activity-average-heart-rate',
      { windowDays: 2 },
    )
    const activityHeartRateTrend = await summarizeWearableMetricTrendRuntime(
      vaultRoot,
      'activity-average-heart-rate',
      { windowDays: 2 },
    )

    expect(activityOnly?.sleep).toBeNull()
    expect(activityOnly?.activity?.activityAverageHeartRate.selection.value).toBe(106)
    expect(activityOnly?.activity?.walkingAverageHeartRate.selection.value).toBe(81)
    expect(activityOnly?.activity?.minimumHeartRate.selection.value).toBe(52)
    expect(activityOnly?.activity?.lowActivityMinutes.selection.value).toBe(75)
    expect(activityOnly?.activity?.mediumActivityMinutes.selection.value).toBe(30)
    expect(activityOnly?.activity?.highActivityMinutes.selection.value).toBe(15)
    expect(latestActivityHeartRate?.value).toBe(106)
    expect(activityHeartRateTrend?.points.map((point) => point.value)).toEqual([106, 101])

    await importDeviceProviderSnapshot(
      {
        provider: 'junction',
        sourceKind: 'poll',
        deliveryMode: 'scheduled_reconcile',
        vaultRoot,
        snapshot: {
          importedAt: '2026-08-11T13:00:00.000Z',
          summaries: {
            sleep: [{
              id: 'sleep-two',
              calendar_date: '2026-08-11',
              bedtime_start: '2026-08-11T02:00:00.000Z',
              bedtime_stop: '2026-08-11T10:00:00.000Z',
              average_heart_rate: 51,
              source: { provider: 'garmin', type: 'watch' },
            }],
          },
        },
      },
      { corePort: coreRuntime },
    )

    const activityAndSleep = await summarizeWearableLatestRuntime(vaultRoot)
    expect(activityAndSleep?.activity?.activityAverageHeartRate.selection.value).toBe(106)
    expect(activityAndSleep?.sleep?.averageHeartRate.selection.value).toBe(51)
  } finally {
    await rm(parentRoot, { recursive: true, force: true })
  }
})
