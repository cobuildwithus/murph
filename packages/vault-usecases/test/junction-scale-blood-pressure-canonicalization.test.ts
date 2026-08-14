import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as coreRuntime from '@murphai/core'
import { importDeviceProviderSnapshot } from '@murphai/importers'
import { listMetricPointsBatch } from '@murphai/query'
import { expect, test } from 'vitest'

import {
  listMeasurementRecords,
  showMeasurementRecord,
} from '../src/usecases/measurement-read.js'
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

test('Junction composition and blood-pressure readings survive as canonical vault metrics', async () => {
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
              bone_mass_percentage: 4.2,
              muscle_mass_percentage: 42.7,
              visceral_fat_index: 7,
              water_percentage: 55.3,
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
    for (const [metric, value] of [
      ['bone-mass-percentage', 4.2],
      ['muscle-mass-percentage', 42.7],
      ['visceral-fat-index', 7],
      ['body-water-percentage', 55.3],
    ] as const) {
      expect(canonicalRecords.some((record) =>
        record.kind === 'observation'
        && record.metric === metric
        && record.value === value
      )).toBe(true)
    }
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
      { metricKey: 'bone-mass-percentage', limit: 1 },
      { metricKey: 'muscle-mass-percentage', limit: 1 },
      { metricKey: 'visceral-fat-index', limit: 1 },
      { metricKey: 'body-water-percentage', limit: 1 },
      { metricKey: 'systolic-blood-pressure', limit: 1 },
      { metricKey: 'diastolic-blood-pressure', limit: 1 },
    ])
    const systolic = points.find(
      (point) => point.metricKey === 'systolic-blood-pressure',
    )
    const diastolic = points.find(
      (point) => point.metricKey === 'diastolic-blood-pressure',
    )

    for (const [metricKey, value, unit] of [
      ['bone-mass-percentage', 4.2, '%'],
      ['muscle-mass-percentage', 42.7, '%'],
      ['visceral-fat-index', 7, 'index'],
      ['body-water-percentage', 55.3, '%'],
    ] as const) {
      expect(points.find((point) => point.metricKey === metricKey)).toMatchObject({
        effectiveDate: '2026-08-08',
        unit,
        value,
      })
    }
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
    expect(bodyRead.items[0]).toMatchObject({
      bodyWaterPercentage: { provider: 'withings', unit: '%', value: 55.3 },
      boneMassPercentage: { provider: 'withings', unit: '%', value: 4.2 },
      muscleMassPercentage: { provider: 'withings', unit: '%', value: 42.7 },
      visceralFatIndex: { provider: 'withings', unit: 'index', value: 7 },
    })

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

test.each([
  ['older first', ['2026-08-07', '2026-08-09']],
  ['newer first', ['2026-08-09', '2026-08-07']],
] as const)(
  'floating Junction body summaries select the latest canonical day when imported %s',
  async (_label, orderedDays) => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), 'junction-floating-body-days-'),
    )
    const vaultRoot = path.join(parentRoot, 'vault')
    const sharedOccurredAt = '2026-08-10T00:00:00.000Z'

    try {
      await coreRuntime.initializeVault({
        createdAt: '2026-08-01T00:00:00.000Z',
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
            accountId: 'junction-floating-body-account',
            importedAt: sharedOccurredAt,
            windowEnd: sharedOccurredAt,
            summaries: {
              body: orderedDays.map((day, index) => ({
                id: `withings-body-${day}`,
                provider_slug: 'withings',
                source_type: 'scale',
                localDate: day,
                observedAt: `${day} 08:00:00`,
                timestampSemantics: 'floating',
                weight_kg: 73 + index,
              })),
            },
            timeseries: {},
          },
        },
        { corePort: coreRuntime },
      )

      const canonicalRecords = await coreRuntime.readJsonlRecords({
        vaultRoot,
        relativePath: 'ledger/events/2026/2026-08.jsonl',
      })
      const bodyRecords = canonicalRecords.filter((record) =>
        record.kind === 'observation'
        && record.metric === 'weight'
      )
      expect(bodyRecords).toHaveLength(2)
      expect(bodyRecords.map((record) => record.occurredAt))
        .toEqual([sharedOccurredAt, sharedOccurredAt])

      await expect(
        coreRuntime.readCanonicalEventAvailabilityInterruptible({ vaultRoot }),
      ).resolves.toMatchObject({
        latestBodyMeasurementDayKey: '2026-08-09',
        latestBodyMeasurementOccurredAt: sharedOccurredAt,
      })
      const bodyRead = await createIntegratedVaultServices()
        .query.listWearableBodyState({
          limit: 30,
          requestId: null,
          vault: vaultRoot,
        })
      expect(bodyRead.count).toBe(2)
      expect(bodyRead.items[0]).toMatchObject({
        date: '2026-08-09',
      })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  },
)

test.each([
  ['older first', ['2026-08-07', '2026-08-09']],
  ['newer first', ['2026-08-09', '2026-08-07']],
] as const)(
  'floating Junction blood-pressure readings select the latest canonical day when imported %s',
  async (_label, orderedDays) => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), 'junction-floating-pressure-days-'),
    )
    const vaultRoot = path.join(parentRoot, 'vault')
    const queryProjectionPath = path.join(
      vaultRoot,
      '.runtime/projections/query.sqlite',
    )
    const sharedOccurredAt = '2026-08-10T00:00:00.000Z'

    try {
      await coreRuntime.initializeVault({
        createdAt: '2026-08-01T00:00:00.000Z',
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
            accountId: 'junction-floating-pressure-account',
            importedAt: sharedOccurredAt,
            windowEnd: sharedOccurredAt,
            summaries: {},
            timeseries: {
              blood_pressure: orderedDays.map((day) => ({
                id: `omron-pressure-${day}`,
                sourceProviderSlug: 'omron',
                localDate: day,
                timestamp: `${day} 08:00:00`,
                timestampSemantics: 'floating',
                systolic: day === '2026-08-09' ? 129 : 117,
                diastolic: day === '2026-08-09' ? 84 : 75,
              })),
            },
          },
        },
        { corePort: coreRuntime },
      )

      const canonicalRecords = await coreRuntime.readJsonlRecords({
        vaultRoot,
        relativePath: 'ledger/events/2026/2026-08.jsonl',
      })
      const pressureRecords = canonicalRecords.filter((record) =>
        record.kind === 'measurement'
        && record.title === 'Junction blood pressure'
      )
      expect(pressureRecords).toHaveLength(2)
      expect(pressureRecords.map((record) => record.occurredAt))
        .toEqual([sharedOccurredAt, sharedOccurredAt])

      const availability = await coreRuntime
        .readCanonicalEventAvailabilityInterruptible({ vaultRoot })
      expect(availability).toMatchObject({
        latestBloodPressureMeasurementDayKey: '2026-08-09',
        latestBloodPressureMeasurementOccurredAt: sharedOccurredAt,
      })
      await expect(access(queryProjectionPath)).rejects.toMatchObject({
        code: 'ENOENT',
      })

      const measurementRead = await listMeasurementRecords({
        from: availability.latestBloodPressureMeasurementDayKey ?? undefined,
        limit: 100,
        to: availability.latestBloodPressureMeasurementDayKey ?? undefined,
        vault: vaultRoot,
      })
      expect(measurementRead).toMatchObject({
        count: 1,
        items: [{ data: { dayKey: '2026-08-09' } }],
      })
      const selected = measurementRead.items[0]
      expect(selected).toBeDefined()
      if (!selected) {
        throw new Error('Expected the latest canonical pressure event.')
      }
      await expect(showMeasurementRecord(vaultRoot, selected.id))
        .resolves.toMatchObject({
          entity: {
            data: {
              measurements: expect.arrayContaining([
                expect.objectContaining({
                  metric: 'systolic-blood-pressure',
                  value: 129,
                }),
                expect.objectContaining({
                  metric: 'diastolic-blood-pressure',
                  value: 84,
                }),
              ]),
            },
          },
        })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  },
)

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
    const candidate = measurementRead.items[0]
    expect(candidate).toBeDefined()
    if (!candidate) {
      throw new Error('Expected the canonical blood-pressure event.')
    }
    const shown = await showMeasurementRecord(vaultRoot, candidate.id)
    expect(shown.entity.data).toMatchObject({
      dayKey: '2026-08-07',
      measurements: expect.arrayContaining([
        expect.objectContaining({ metric: 'systolic-blood-pressure', value: 118 }),
        expect.objectContaining({ metric: 'diastolic-blood-pressure', value: 76 }),
      ]),
    })
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})
