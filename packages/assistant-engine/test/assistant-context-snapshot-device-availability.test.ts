import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  addMeasurement,
  appendJsonlRecord,
  buildObservationEventDraft,
  initializeVault,
  toMonthlyShardRelativePath,
  upsertEvent,
  VAULT_LAYOUT,
} from '@murphai/core'
import { writeAssistantStateVersionedJson } from '@murphai/runtime-state/node'
import {
  listMeasurementRecords,
  normalizeMeasurementEntry,
  showMeasurementRecord,
} from '@murphai/vault-usecases/measurements'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA,
  ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  isAssistantContextSnapshotRefreshPending,
  markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotPrompt,
  readAssistantContextSnapshotState,
  refreshAssistantContextSnapshot,
  refreshAssistantContextSnapshotBestEffort,
  resolveAssistantContextSnapshotPath,
} from '../src/assistant-context-snapshot.js'

async function createDeviceMeasurementVault(): Promise<{
  parentRoot: string
  vaultRoot: string
}> {
  const parentRoot = await mkdtemp(
    path.join(tmpdir(), 'assistant-device-context-snapshot-'),
  )
  const vaultRoot = path.join(parentRoot, 'vault')
  await initializeVault({
    createdAt: '2026-08-08T00:00:00.000Z',
    vaultRoot,
  })
  await addMeasurement({
    vaultRoot,
    draft: {
      occurredAt: '2026-08-08T12:00:00.000Z',
      source: 'device',
      title: 'Connected health measurements',
      measurements: [
        {
          metric: 'body-weight',
          unit: 'kg',
          value: 82.5,
        },
        {
          metric: 'systolic-blood-pressure',
          unit: 'mmHg',
          value: 121,
        },
        {
          metric: 'diastolic-blood-pressure',
          unit: 'mmHg',
          value: 79,
        },
      ],
    },
  })
  await markAssistantContextSnapshotDirty({
    domains: ['blood_tests'],
    vaultRoot,
  })
  return { parentRoot, vaultRoot }
}

describe('assistant context snapshot device availability', () => {
  it('advertises canonical scale and blood-pressure reads without injecting values', async () => {
    const { parentRoot, vaultRoot } = await createDeviceMeasurementVault()

    try {
      await expect(refreshAssistantContextSnapshot({
        now: () => '2026-08-08T12:05:00.000Z',
        vaultRoot,
      })).resolves.toMatchObject({
        pendingDirtyDomains: [],
        refreshed: true,
        skipped: false,
      })

      const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
      expect(prompt).toContain('Body/scale measurement history is present')
      expect(prompt).toContain(
        'vault-cli wearables body list --limit 30 --format json',
      )
      expect(prompt).toContain('Blood-pressure measurement history is present')
      expect(prompt).toContain(
        'vault-cli measurement list --from 2026-08-08 --to 2026-08-08 --limit 100 --format json',
      )
      expect(prompt).toContain(
        'vault-cli measurement show <event-id> --format json',
      )
      expect(prompt).toContain('systolic-blood-pressure')
      expect(prompt).toContain('diastolic-blood-pressure')
      expect(prompt).toContain('latest 2026-08-08')
      expect(prompt).toContain(
        'Never substitute raw Junction artifacts for canonical history',
      )
      expect(prompt).not.toContain('ingestion problem')
      expect(prompt).not.toContain('82.5')
      expect(prompt).not.toContain('121')
      expect(prompt).not.toContain('79')

      const candidates = await listMeasurementRecords({
        from: '2026-08-08',
        limit: 100,
        to: '2026-08-08',
        vault: vaultRoot,
      })
      const candidate = candidates.items.find((item) =>
        item.kind === 'measurement'
      )
      expect(candidate).toMatchObject({
        data: { dayKey: '2026-08-08', measurementsCount: 3 },
      })
      if (!candidate) {
        throw new Error('Expected a canonical measurement candidate.')
      }
      const shown = await showMeasurementRecord(vaultRoot, candidate.id)
      expect(shown.entity.data).toMatchObject({
        measurements: expect.arrayContaining([
          expect.objectContaining({ metric: 'systolic-blood-pressure', value: 121 }),
          expect.objectContaining({ metric: 'diastolic-blood-pressure', value: 79 }),
        ]),
      })
      await expect(
        isAssistantContextSnapshotRefreshPending({ vaultRoot }),
      ).resolves.toBe(false)
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it.each([
    {
      metric: 'bodyFat',
      storedMetric: 'body-fat-percentage',
      unit: 'percent',
      value: 18.4,
    },
    {
      metric: 'bodyMassIndex',
      storedMetric: 'bmi',
      unit: 'kg/m2',
      value: 22.1,
    },
  ] as const)(
    'advertises writer-canonicalized $metric measurement history',
    async ({ metric, storedMetric, unit, value }) => {
      const parentRoot = await mkdtemp(
        path.join(tmpdir(), `assistant-device-context-writer-${storedMetric}-`),
      )
      const vaultRoot = path.join(parentRoot, 'vault')
      const queryProjectionPath = path.join(
        vaultRoot,
        '.runtime/projections/query.sqlite',
      )

      try {
        await initializeVault({
          createdAt: '2026-08-08T00:00:00.000Z',
          vaultRoot,
        })
        await addMeasurement({
          vaultRoot,
          draft: {
            occurredAt: '2026-08-08T09:00:00.000Z',
            source: 'manual',
            title: 'Writer-normalized body measurement',
            measurements: [normalizeMeasurementEntry({
              metric,
              unit,
              value,
            })],
          },
        })
        await markAssistantContextSnapshotDirty({
          domains: ['blood_tests'],
          vaultRoot,
        })
        await refreshAssistantContextSnapshot({ vaultRoot })

        const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
        expect(prompt).toContain(
          'Body/scale measurement history is present (latest 2026-08-08)',
        )
        expect(prompt).not.toContain(String(value))
        await expect(access(queryProjectionPath)).rejects.toMatchObject({
          code: 'ENOENT',
        })

        const candidates = await listMeasurementRecords({
          from: '2026-08-08',
          limit: 100,
          to: '2026-08-08',
          vault: vaultRoot,
        })
        const candidate = candidates.items[0]
        expect(candidate).toMatchObject({ data: { dayKey: '2026-08-08' } })
        if (!candidate) {
          throw new Error('Expected a writer-normalized body measurement candidate.')
        }
        await expect(showMeasurementRecord(vaultRoot, candidate.id))
          .resolves.toMatchObject({
            entity: {
              data: {
                measurements: [expect.objectContaining({ metric: storedMetric })],
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

  it('resolves generic measurement aliases without pairing separate writer-normalized blood-pressure events', async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), 'assistant-device-context-measurement-aliases-'),
    )
    const vaultRoot = path.join(parentRoot, 'vault')
    const queryProjectionPath = path.join(
      vaultRoot,
      '.runtime/projections/query.sqlite',
    )

    try {
      await initializeVault({
        createdAt: '2026-08-07T00:00:00.000Z',
        vaultRoot,
      })
      for (const body of [
        {
          metric: 'waist',
          occurredAt: '2026-08-07T09:00:00.000Z',
          unit: 'cm',
          value: 81,
        },
        {
          metric: 'bodyweight',
          occurredAt: '2026-08-08T09:00:00.000Z',
          unit: 'kg',
          value: 74,
        },
      ] as const) {
        await addMeasurement({
          vaultRoot,
          draft: {
            occurredAt: body.occurredAt,
            source: 'manual',
            title: 'Canonical body measurement',
            measurements: [{
              metric: body.metric,
              unit: body.unit,
              value: body.value,
            }],
          },
        })
      }
      await addMeasurement({
        vaultRoot,
        draft: {
          occurredAt: '2026-08-09T09:00:00.000Z',
          source: 'manual',
          title: 'Canonical blood pressure measurement',
          measurements: [
            normalizeMeasurementEntry({
              metric: 'systolicBloodPressure',
              unit: 'mmHg',
              value: 118,
            }),
            normalizeMeasurementEntry({
              metric: 'diastolicBloodPressure',
              unit: 'mmHg',
              value: 76,
            }),
          ],
        },
      })
      for (const pressure of [
        { metric: 'systolicBloodPressure', value: 119 },
        { metric: 'diastolicBloodPressure', value: 77 },
      ] as const) {
        await addMeasurement({
          vaultRoot,
          draft: {
            occurredAt: '2026-08-10T09:00:00.000Z',
            source: 'manual',
            title: 'Unpaired blood pressure measurement',
            measurements: [normalizeMeasurementEntry({
              metric: pressure.metric,
              unit: 'mmHg',
              value: pressure.value,
            })],
          },
        })
      }
      await markAssistantContextSnapshotDirty({
        domains: ['blood_tests'],
        vaultRoot,
      })
      await refreshAssistantContextSnapshot({ vaultRoot })

      const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
      expect(prompt).toContain(
        'Body/scale measurement history is present (latest 2026-08-08)',
      )
      expect(prompt).toContain(
        'Blood-pressure measurement history is present (latest 2026-08-09)',
      )
      expect(prompt).toContain('`sbp` / `dbp`')
      for (const value of ['81', '74', '118', '76', '119', '77']) {
        expect(prompt).not.toContain(value)
      }
      await expect(access(queryProjectionPath)).rejects.toMatchObject({
        code: 'ENOENT',
      })

      const bodyCandidates = await listMeasurementRecords({
        from: '2026-08-08',
        limit: 100,
        to: '2026-08-08',
        vault: vaultRoot,
      })
      const bodyCandidate = bodyCandidates.items[0]
      expect(bodyCandidate).toMatchObject({ data: { dayKey: '2026-08-08' } })
      if (!bodyCandidate) {
        throw new Error('Expected a generic body measurement candidate.')
      }
      await expect(showMeasurementRecord(vaultRoot, bodyCandidate.id))
        .resolves.toMatchObject({
          entity: {
            data: {
              measurements: [expect.objectContaining({ metric: 'bodyweight' })],
            },
          },
        })

      const bloodPressureCandidates = await listMeasurementRecords({
        from: '2026-08-09',
        limit: 100,
        to: '2026-08-09',
        vault: vaultRoot,
      })
      const bloodPressureCandidate = bloodPressureCandidates.items[0]
      expect(bloodPressureCandidate).toMatchObject({
        data: { dayKey: '2026-08-09', measurementsCount: 2 },
      })
      if (!bloodPressureCandidate) {
        throw new Error('Expected a paired blood-pressure alias candidate.')
      }
      await expect(showMeasurementRecord(vaultRoot, bloodPressureCandidate.id))
        .resolves.toMatchObject({
          entity: {
            data: {
              measurements: expect.arrayContaining([
                expect.objectContaining({ metric: 'systolic-blood-pressure' }),
                expect.objectContaining({ metric: 'diastolic-blood-pressure' }),
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
  })

  it.each([
    { metric: 'bmi', unit: 'kg/m2', value: 21.7 },
    { metric: 'body-fat-pct', unit: '%', value: 18.4 },
    { metric: 'lean-body-mass', unit: 'kg', value: 61.4 },
    { metric: 'waist-circumference', unit: 'cm', value: 81 },
  ] as const)(
    'recognizes canonical $metric body history without injecting its value',
    async ({ metric, unit, value }) => {
      const parentRoot = await mkdtemp(
        path.join(tmpdir(), `assistant-device-context-${metric}-`),
      )
      const vaultRoot = path.join(parentRoot, 'vault')

      try {
        await initializeVault({
          createdAt: '2026-08-09T00:00:00.000Z',
          vaultRoot,
        })
        await addMeasurement({
          vaultRoot,
          draft: {
            externalRef: {
              resourceId: `body-${metric}-1`,
              resourceType: 'summary',
              system: 'test-device',
            },
            occurredAt: '2026-08-09T09:00:00.000Z',
            source: 'device',
            title: 'Connected body measurement',
            measurements: [{ metric, unit, value }],
          },
        })
        await markAssistantContextSnapshotDirty({
          domains: ['blood_tests'],
          vaultRoot,
        })
        await refreshAssistantContextSnapshot({
          now: () => '2026-08-09T09:10:00.000Z',
          vaultRoot,
        })

        const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
        expect(prompt).toContain(
          'Body/scale measurement history is present (latest 2026-08-09)',
        )
        expect(prompt).not.toContain(String(value))
        await expect(createIntegratedVaultServices().query.listWearableBodyState({
          limit: 30,
          requestId: null,
          vault: vaultRoot,
        })).resolves.toMatchObject({ count: 1 })
      } finally {
        await rm(parentRoot, {
          force: true,
          recursive: true,
        })
      }
    },
  )

  it.each([
    ['older first', ['2026-08-07', '2026-08-09']],
    ['newer first', ['2026-08-09', '2026-08-07']],
  ] as const)(
    'uses the latest canonical blood-pressure day when equal timestamps are stored %s',
    async (_label, orderedDays) => {
      const parentRoot = await mkdtemp(
        path.join(tmpdir(), 'assistant-device-context-floating-pressure-'),
      )
      const vaultRoot = path.join(parentRoot, 'vault')
      const queryProjectionPath = path.join(
        vaultRoot,
        '.runtime/projections/query.sqlite',
      )

      try {
        await initializeVault({
          createdAt: '2026-08-01T00:00:00.000Z',
          vaultRoot,
        })
        for (const [index, dayKey] of orderedDays.entries()) {
          const newerDay = dayKey === '2026-08-09'
          await appendJsonlRecord({
            vaultRoot,
            relativePath: toMonthlyShardRelativePath(
              VAULT_LAYOUT.eventLedgerDirectory,
              '2026-08-10T00:00:00.000Z',
              'occurredAt',
            ),
            record: {
              dayKey,
              externalRef: {
                resourceId: `omron-pressure-${dayKey}`,
                resourceType: 'junction-omron-blood-pressure',
                system: 'junction',
              },
              id: index === 0
                ? 'evt_01JNW7YJ7MNE7M9Q2QWQK4Z4F1'
                : 'evt_01JNW7YJ7MNE7M9Q2QWQK4Z4F2',
              kind: 'measurement',
              measurements: [
                {
                  metric: 'systolic-blood-pressure',
                  unit: 'mmHg',
                  value: newerDay ? 129 : 117,
                },
                {
                  metric: 'diastolic-blood-pressure',
                  unit: 'mmHg',
                  value: newerDay ? 84 : 75,
                },
              ],
              occurredAt: '2026-08-10T00:00:00.000Z',
              recordedAt: '2026-08-10T00:01:00.000Z',
              schemaVersion: 'murph.event.v1',
              source: 'device',
              title: 'Junction blood pressure',
            },
          })
        }
        await markAssistantContextSnapshotDirty({
          domains: ['blood_tests'],
          vaultRoot,
        })

        await refreshAssistantContextSnapshot({ vaultRoot })
        const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
        expect(prompt).toContain(
          'Blood-pressure measurement history is present (latest 2026-08-09)',
        )
        expect(prompt).toContain(
          'measurement list --from 2026-08-09 --to 2026-08-09',
        )
        expect(prompt).not.toContain('129')
        expect(prompt).not.toContain('84')
        await expect(access(queryProjectionPath)).rejects.toMatchObject({
          code: 'ENOENT',
        })

        const measurementRead = await listMeasurementRecords({
          from: '2026-08-09',
          limit: 100,
          to: '2026-08-09',
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

  it.each([
    ['older first', ['2026-08-07', '2026-08-09']],
    ['newer first', ['2026-08-09', '2026-08-07']],
  ] as const)(
    'uses the latest canonical body day when equal timestamps are stored %s',
    async (_label, orderedDays) => {
      const parentRoot = await mkdtemp(
        path.join(tmpdir(), 'assistant-device-context-floating-body-'),
      )
      const vaultRoot = path.join(parentRoot, 'vault')
      const queryProjectionPath = path.join(
        vaultRoot,
        '.runtime/projections/query.sqlite',
      )

      try {
        await initializeVault({
          createdAt: '2026-08-01T00:00:00.000Z',
          vaultRoot,
        })
        for (const [index, dayKey] of orderedDays.entries()) {
          await appendJsonlRecord({
            vaultRoot,
            relativePath: toMonthlyShardRelativePath(
              VAULT_LAYOUT.eventLedgerDirectory,
              '2026-08-10T00:00:00.000Z',
              'occurredAt',
            ),
            record: {
              dayKey,
              externalRef: {
                resourceId: `withings-body-${dayKey}`,
                resourceType: 'junction-withings-body',
                system: 'junction',
              },
              id: index === 0
                ? 'evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F1'
                : 'evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F2',
              kind: 'observation',
              metric: 'weight',
              observationGrain: 'summary',
              occurredAt: '2026-08-10T00:00:00.000Z',
              recordedAt: '2026-08-10T00:01:00.000Z',
              schemaVersion: 'murph.event.v1',
              source: 'device',
              title: 'Connected body weight',
              unit: 'kg',
              value: index === 0 ? 73.1 : 74.2,
            },
          })
        }
        await markAssistantContextSnapshotDirty({
          domains: ['blood_tests'],
          vaultRoot,
        })

        await expect(refreshAssistantContextSnapshot({ vaultRoot }))
          .resolves.toMatchObject({
            pendingDirtyDomains: [],
            refreshed: true,
          })
        const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
        expect(prompt).toContain(
          'Body/scale measurement history is present (latest 2026-08-09)',
        )
        expect(prompt).toContain(
          'measurement list --from 2026-08-09 --to 2026-08-09',
        )
        expect(prompt).not.toContain('73.1')
        expect(prompt).not.toContain('74.2')
        await expect(access(queryProjectionPath)).rejects.toMatchObject({
          code: 'ENOENT',
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

  it('does not advertise a normalized non-body measurement metric', async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), 'assistant-device-context-non-body-'),
    )
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-08-09T00:00:00.000Z',
        vaultRoot,
      })
      await addMeasurement({
        vaultRoot,
        draft: {
          externalRef: {
            resourceId: 'steps-1',
            resourceType: 'summary',
            system: 'test-device',
          },
          occurredAt: '2026-08-09T09:00:00.000Z',
          source: 'device',
          title: 'Connected step measurement',
          measurements: [{ metric: 'daily-steps', unit: 'count', value: 7000 }],
        },
      })
      await markAssistantContextSnapshotDirty({
        domains: ['blood_tests'],
        vaultRoot,
      })
      await refreshAssistantContextSnapshot({ vaultRoot })

      const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
      expect(prompt ?? '').not.toContain(
        'Body/scale measurement history is present',
      )
      await expect(createIntegratedVaultServices().query.listWearableBodyState({
        limit: 30,
        requestId: null,
        vault: vaultRoot,
      })).resolves.toMatchObject({ count: 0, items: [] })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('keeps wearable observation units separate from measurement fallback', async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), 'assistant-device-context-body-units-'),
    )
    const vaultRoot = path.join(parentRoot, 'vault')
    const queryProjectionPath = path.join(
      vaultRoot,
      '.runtime/projections/query.sqlite',
    )

    try {
      await initializeVault({
        createdAt: '2026-08-07T00:00:00.000Z',
        vaultRoot,
      })
      for (const observation of [
        {
          externalRef: {
            resourceId: 'body-weight-pounds',
            resourceType: 'summary',
            system: 'test-device',
          },
          occurredAt: '2026-08-08T09:00:00.000Z',
          unit: 'pounds',
          value: 180,
        },
        {
          externalRef: {
            resourceId: 'body-weight-stone',
            resourceType: 'summary',
            system: 'test-device',
          },
          occurredAt: '2026-08-09T09:00:00.000Z',
          unit: 'stone',
          value: 12,
        },
      ] as const) {
        await upsertEvent({
          vaultRoot,
          draft: buildObservationEventDraft({
            ...observation,
            metric: 'weight',
            observationGrain: 'summary',
            source: 'device',
            title: 'Connected body weight',
          }),
        })
      }
      await addMeasurement({
        vaultRoot,
        draft: {
          externalRef: {
            resourceId: 'measurement-weight-stone',
            resourceType: 'summary',
            system: 'test-device',
          },
          occurredAt: '2026-08-10T09:00:00.000Z',
          source: 'device',
          title: 'Connected body weight',
          measurements: [{ metric: 'weight', unit: 'stone', value: 12 }],
        },
      })
      await markAssistantContextSnapshotDirty({
        domains: ['blood_tests'],
        vaultRoot,
      })
      await refreshAssistantContextSnapshot({ vaultRoot })

      const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
      expect(prompt).toContain(
        'Body/scale measurement history is present (latest 2026-08-10)',
      )
      expect(prompt).not.toContain('180')
      expect(prompt).not.toContain('12')
      await expect(access(queryProjectionPath)).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await expect(createIntegratedVaultServices().query.listWearableBodyState({
        limit: 30,
        requestId: null,
        vault: vaultRoot,
      })).resolves.toMatchObject({
        count: 1,
        items: [{ date: '2026-08-08' }],
      })
      await expect(listMeasurementRecords({
        from: '2026-08-10',
        limit: 100,
        to: '2026-08-10',
        vault: vaultRoot,
      })).resolves.toMatchObject({
        count: 1,
        items: [{ data: { dayKey: '2026-08-10' } }],
      })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('yields during a sizable canonical ledger scan without starting a query projection', async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), 'assistant-device-context-preemption-'),
    )
    const vaultRoot = path.join(parentRoot, 'vault')
    const queryProjectionPath = path.join(
      vaultRoot,
      '.runtime/projections/query.sqlite',
    )

    try {
      await initializeVault({
        createdAt: '2026-08-09T00:00:00.000Z',
        vaultRoot,
      })
      for (let index = 0; index < 60; index += 1) {
        await addMeasurement({
          vaultRoot,
          draft: {
            occurredAt: `2026-08-09T09:${String(index).padStart(2, '0')}:00.000Z`,
            source: 'device',
            title: 'Connected body measurement',
            measurements: [{
              metric: 'lean-body-mass',
              unit: 'kg',
              value: 60 + index / 10,
            }],
          },
        })
      }
      await markAssistantContextSnapshotDirty({
        domains: ['blood_tests'],
        vaultRoot,
      })

      let continuationChecks = 0
      await expect(refreshAssistantContextSnapshotBestEffort({
        shouldYield: () => {
          continuationChecks += 1
          return continuationChecks >= 40
        },
        vaultRoot,
      })).resolves.toMatchObject({
        pendingDirtyDomains: ['blood_tests'],
        refreshed: false,
        skipped: false,
      })
      expect(continuationChecks).toBeGreaterThanOrEqual(40)
      await expect(readAssistantContextSnapshotState(vaultRoot))
        .resolves.toMatchObject({
          pendingDirtyDomains: ['blood_tests'],
        })
      await expect(access(queryProjectionPath)).rejects.toMatchObject({
        code: 'ENOENT',
      })

      await expect(refreshAssistantContextSnapshot({
        now: () => '2026-08-09T10:05:00.000Z',
        vaultRoot,
      })).resolves.toMatchObject({
        pendingDirtyDomains: [],
        refreshed: true,
        skipped: false,
      })
      await expect(readAssistantContextSnapshotPrompt({ vaultRoot }))
        .resolves.toContain('Body/scale measurement history is present')
      await expect(access(queryProjectionPath)).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('requires systolic and diastolic points from the same canonical event', async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), 'assistant-device-context-bp-pairing-'),
    )
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-08-09T00:00:00.000Z',
        vaultRoot,
      })
      await addMeasurement({
        vaultRoot,
        draft: {
          occurredAt: '2026-08-09T09:05:00.000Z',
          source: 'device',
          title: 'Incomplete systolic reading',
          measurements: [{
            metric: 'systolic-blood-pressure',
            unit: 'mmHg',
            value: 120,
          }],
        },
      })
      await addMeasurement({
        vaultRoot,
        draft: {
          occurredAt: '2026-08-09T09:05:00.000Z',
          source: 'device',
          title: 'Incomplete diastolic reading',
          measurements: [{
            metric: 'diastolic-blood-pressure',
            unit: 'mmHg',
            value: 78,
          }],
        },
      })
      await markAssistantContextSnapshotDirty({
        domains: ['blood_tests'],
        vaultRoot,
      })
      await refreshAssistantContextSnapshot({
        now: () => '2026-08-09T09:10:00.000Z',
        vaultRoot,
      })

      const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
      expect(prompt ?? '').not.toContain(
        'Blood-pressure measurement history is present',
      )
      expect(prompt ?? '').not.toContain('120')
      expect(prompt ?? '').not.toContain('78')
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('does not advertise a providerless body observation that its read commands exclude', async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), 'assistant-device-context-manual-body-'),
    )
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-08-09T00:00:00.000Z',
        vaultRoot,
      })
      await upsertEvent({
        vaultRoot,
        draft: buildObservationEventDraft({
          occurredAt: '2026-08-09T09:00:00.000Z',
          metric: 'body-weight',
          source: 'manual',
          title: 'Manual body weight',
          unit: 'kg',
          value: 82,
        }),
      })
      await markAssistantContextSnapshotDirty({
        domains: ['blood_tests'],
        vaultRoot,
      })
      await refreshAssistantContextSnapshot({ vaultRoot })

      const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
      expect(prompt ?? '').not.toContain(
        'Body/scale measurement history is present',
      )
      const services = createIntegratedVaultServices()
      await expect(services.query.listWearableBodyState({
        limit: 30,
        requestId: null,
        vault: vaultRoot,
      })).resolves.toMatchObject({ count: 0, items: [] })
      await expect(listMeasurementRecords({
        from: '2026-08-09',
        limit: 100,
        vault: vaultRoot,
      })).resolves.toMatchObject({ count: 0, items: [] })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('rebuilds snapshots written with the previous schema version', async () => {
    const { parentRoot, vaultRoot } = await createDeviceMeasurementVault()
    const queryProjectionPath = path.join(
      vaultRoot,
      '.runtime/projections/query.sqlite',
    )

    try {
      await appendJsonlRecord({
        vaultRoot,
        relativePath: toMonthlyShardRelativePath(
          VAULT_LAYOUT.eventLedgerDirectory,
          '2026-08-08T12:01:00.000Z',
          'occurredAt',
        ),
        record: {
          dayKey: '2026-08-08',
          externalRef: {
            resourceId: 'daily-hrv-2026-08-08',
            resourceType: 'daily-summary',
            system: 'oura',
          },
          id: 'evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F9',
          kind: 'observation',
          metric: 'hrv',
          observationGrain: 'daily-summary',
          occurredAt: '2026-08-08T12:01:00.000Z',
          recordedAt: '2026-08-08T12:02:00.000Z',
          schemaVersion: 'murph.event.v1',
          source: 'device',
          title: 'Legacy provider HRV summary',
          unit: 'ms',
          value: 47,
        },
      })
      await appendJsonlRecord({
        vaultRoot,
        relativePath: toMonthlyShardRelativePath(
          VAULT_LAYOUT.eventLedgerDirectory,
          '2026-08-08T12:01:30.000Z',
          'occurredAt',
        ),
        record: {
          dayKey: '2026-08-08',
          externalRef: {
            system: 'oura',
          },
          id: 'evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F7',
          kind: 'observation',
          metric: 'waist-circumference',
          occurredAt: '2026-08-08T12:01:30.000Z',
          recordedAt: '2026-08-08T12:02:30.000Z',
          schemaVersion: 'murph.event.v1',
          source: 'device',
          title: 'Legacy provider waist measurement',
          unit: 'cm',
          value: 81,
        },
      })
      await appendJsonlRecord({
        vaultRoot,
        relativePath: toMonthlyShardRelativePath(
          VAULT_LAYOUT.eventLedgerDirectory,
          '2026-08-08T12:02:00.000Z',
          'occurredAt',
        ),
        record: {
          schemaVersion: 'murph.event.v1',
          id: 'evt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8',
          kind: 'test',
          occurredAt: '2026-08-08T12:02:00.000Z',
          recordedAt: '2026-08-08T12:03:00.000Z',
          dayKey: '2026-08-08',
          source: 'manual',
          title: 'Legacy blood test result',
          testName: 'Legacy panel',
          status: 'abnormal',
          summary: 'Legacy payload used status.',
        },
      })
      await writeAssistantStateVersionedJson({
        filePath: resolveAssistantContextSnapshotPath(vaultRoot),
        schema: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA,
        schemaVersion: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA_VERSION - 1,
        value: {
          dirtySequence: 0,
          lastCompleted: {
            generatedAt: '2026-08-08T12:01:00.000Z',
            includedDomains: [],
            promptBlock: 'Legacy context snapshot.',
            sectionPresence: {
              activeExperiments: false,
              bloodTests: false,
              habitat: false,
              healthContext: false,
            },
            sourceDirtySequence: 0,
          },
          lastRefreshAttempt: null,
          pendingDirtyDomains: [],
        },
      })
      await expect(
        isAssistantContextSnapshotRefreshPending({ vaultRoot }),
      ).resolves.toBe(true)

      await expect(refreshAssistantContextSnapshot({
        now: () => '2026-08-08T12:06:00.000Z',
        vaultRoot,
      })).resolves.toMatchObject({
        pendingDirtyDomains: [],
        refreshed: true,
        skipped: false,
      })
      const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
      expect(prompt).toContain('Body/scale measurement history is present')
      expect(prompt).toContain('Blood-pressure measurement history is present')
      expect(prompt).not.toContain('Legacy context snapshot.')
      expect(prompt).not.toContain('47')
      expect(prompt).not.toContain('81')
      await expect(
        isAssistantContextSnapshotRefreshPending({ vaultRoot }),
      ).resolves.toBe(false)
      await expect(access(queryProjectionPath)).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await expect(
        createIntegratedVaultServices().query.listWearableBodyState({
          from: '2026-08-08',
          limit: 30,
          requestId: null,
          to: '2026-08-08',
          vault: vaultRoot,
        }),
      ).resolves.toMatchObject({
        count: 1,
        items: [{ date: '2026-08-08' }],
      })
      await expect(createIntegratedVaultServices().query.listWearableRecovery({
        from: '2026-08-08',
        limit: 30,
        requestId: null,
        to: '2026-08-08',
        vault: vaultRoot,
      })).resolves.toMatchObject({ count: 1 })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })
})
