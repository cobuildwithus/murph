import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as coreRuntime from '@murphai/core'
import { importDeviceProviderSnapshot } from '@murphai/importers'
import { listMetricPointsBatch } from '@murphai/query'
import { expect, test } from 'vitest'

function isCanonicalMeasurementValue(
  value: unknown,
): value is Record<'metric' | 'unit' | 'value', unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'metric' in value
    && 'unit' in value
    && 'value' in value
}

test('Junction scale and blood-pressure readings survive as canonical vault metrics', async () => {
  const parentRoot = await mkdtemp(
    path.join(tmpdir(), 'junction-scale-blood-pressure-'),
  )
  const vaultRoot = path.join(parentRoot, 'vault')

  try {
    await coreRuntime.initializeVault({
      createdAt: '2026-08-08T00:00:00.000Z',
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
          accountId: 'junction-connected-device-account',
          importedAt: '2026-08-08T13:00:00.000Z',
          summaries: {
            body: [{
              provider_slug: 'withings',
              source_type: 'scale',
              observedAt: '2026-08-08T12:00:00.000Z',
              weight_kg: 82.5,
              body_fat_percentage: 16.2,
            }],
          },
          timeseries: {
            blood_pressure: [{
              sourceProviderSlug: 'omron',
              timestamp: '2026-08-08T12:05:00.000Z',
              systolic: 121,
              diastolic: 79,
            }],
          },
        },
      },
      { corePort: coreRuntime },
    )

    const canonicalRecords = await coreRuntime.readJsonlRecords({
      vaultRoot,
      relativePath: 'ledger/events/2026/2026-08.jsonl',
    })
    expect(canonicalRecords.some((record) =>
      record.kind === 'observation'
      && record.metric === 'weight'
      && record.value === 82.5
    )).toBe(true)
    expect(canonicalRecords.some((record) =>
      record.kind === 'measurement'
      && Array.isArray(record.measurements)
      && record.measurements.some((measurement) =>
        isCanonicalMeasurementValue(measurement)
        && measurement.metric === 'systolic-blood-pressure'
        && measurement.value === 121
        && measurement.unit === 'mmHg'
      )
      && record.measurements.some((measurement) =>
        isCanonicalMeasurementValue(measurement)
        && measurement.metric === 'diastolic-blood-pressure'
        && measurement.value === 79
        && measurement.unit === 'mmHg'
      )
    )).toBe(true)

    const points = await listMetricPointsBatch(vaultRoot, [
      { metricKey: 'body-weight', limit: 1 },
      { metricKey: 'systolic-blood-pressure', limit: 1 },
      { metricKey: 'diastolic-blood-pressure', limit: 1 },
    ])
    const bodyWeight = points.find((point) => point.metricKey === 'body-weight')
    const systolic = points.find(
      (point) => point.metricKey === 'systolic-blood-pressure',
    )
    const diastolic = points.find(
      (point) => point.metricKey === 'diastolic-blood-pressure',
    )

    expect(bodyWeight).toMatchObject({
      canonicalUnit: 'kg',
      canonicalValue: 82.5,
      effectiveDate: '2026-08-08',
    })
    expect(systolic).toMatchObject({
      canonicalUnit: 'mmHg',
      canonicalValue: 121,
      effectiveDate: '2026-08-08',
    })
    expect(diastolic).toMatchObject({
      canonicalUnit: 'mmHg',
      canonicalValue: 79,
      effectiveDate: '2026-08-08',
    })
    expect(systolic?.source).toMatchObject({
      family: 'event',
      kind: 'measurement',
    })
    expect(diastolic?.source).toMatchObject({
      family: 'event',
      kind: 'measurement',
    })
    expect(systolic?.source.recordId).toBe(diastolic?.source.recordId)
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})
