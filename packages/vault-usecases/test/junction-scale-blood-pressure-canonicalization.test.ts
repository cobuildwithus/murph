import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as coreRuntime from '@murphai/core'
import { importDeviceProviderSnapshot } from '@murphai/importers'
import { listMetricPointsBatch } from '@murphai/query'
import { expect, test } from 'vitest'

import { listMeasurementRecords } from '../src/usecases/measurement-read.js'
import { createIntegratedVaultServices } from '../src/vault-services.js'

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
              lean_body_mass_kilogram: 61.4,
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
      && record.metric === 'lean-body-mass'
      && record.value === 61.4
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
      { metricKey: 'lean-body-mass', limit: 1 },
      { metricKey: 'systolic-blood-pressure', limit: 1 },
      { metricKey: 'diastolic-blood-pressure', limit: 1 },
    ])
    const leanBodyMass = points.find(
      (point) => point.metricKey === 'lean-body-mass',
    )
    const systolic = points.find(
      (point) => point.metricKey === 'systolic-blood-pressure',
    )
    const diastolic = points.find(
      (point) => point.metricKey === 'diastolic-blood-pressure',
    )

    expect(leanBodyMass).toMatchObject({
      effectiveDate: '2026-08-08',
      unit: 'kg',
      value: 61.4,
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

    const bodyRead = await createIntegratedVaultServices()
      .query.listWearableBodyState({
        limit: 30,
        requestId: null,
        vault: vaultRoot,
      })
    expect(bodyRead.count).toBe(1)
    expect(JSON.stringify(bodyRead.items)).toContain('leanBodyMass')

    await expect(
      coreRuntime.readCanonicalEventAvailabilityInterruptible({ vaultRoot }),
    ).resolves.toEqual({
      interrupted: false,
      latestBloodPressureMeasurementDayKey: '2026-08-08',
      latestBloodPressureMeasurementOccurredAt: '2026-08-08T12:05:00.000Z',
      latestBloodTestOccurredAt: null,
      latestBodyMeasurementDayKey: '2026-08-08',
      latestBodyMeasurementOccurredAt: '2026-08-08T12:00:00.000Z',
    })
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('Junction offset blood pressure keeps the local day used by measurement reads', async () => {
  const parentRoot = await mkdtemp(
    path.join(tmpdir(), 'junction-offset-blood-pressure-'),
  )
  const vaultRoot = path.join(parentRoot, 'vault')

  try {
    await coreRuntime.initializeVault({
      createdAt: '2026-08-07T00:00:00.000Z',
      timezone: 'America/Los_Angeles',
      vaultRoot,
    })
    await importDeviceProviderSnapshot(
      {
        provider: 'junction',
        sourceKind: 'poll',
        deliveryMode: 'scheduled_reconcile',
        vaultRoot,
        snapshot: {
          accountId: 'junction-offset-device-account',
          importedAt: '2026-08-08T02:00:00.000Z',
          summaries: {},
          timeseries: {
            blood_pressure: [{
              sourceProviderSlug: 'omron',
              timestamp: '2026-08-07T18:30:00-07:00',
              systolic: 118,
              diastolic: 76,
            }],
          },
        },
      },
      { corePort: coreRuntime },
    )

    const availability = await coreRuntime
      .readCanonicalEventAvailabilityInterruptible({ vaultRoot })
    expect(availability).toMatchObject({
      latestBloodPressureMeasurementDayKey: '2026-08-07',
      latestBloodPressureMeasurementOccurredAt: '2026-08-08T01:30:00.000Z',
    })

    const measurementRead = await listMeasurementRecords({
      from: availability.latestBloodPressureMeasurementDayKey ?? undefined,
      limit: 100,
      vault: vaultRoot,
    })
    expect(measurementRead.count).toBe(1)
    expect(measurementRead.items[0]).toMatchObject({
      data: {
        dayKey: '2026-08-07',
        measurementsCount: 2,
      },
      kind: 'measurement',
    })
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})
