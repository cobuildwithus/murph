import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  addMeasurement,
  initializeVault,
} from '@murphai/core'
import { writeAssistantStateVersionedJson } from '@murphai/runtime-state/node'
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
        'vault-cli measurement list --from 2026-08-08 --limit 100 --format json',
      )
      expect(prompt).toContain('systolic-blood-pressure')
      expect(prompt).toContain('diastolic-blood-pressure')
      expect(prompt).toContain('latest 2026-08-08')
      expect(prompt).toContain(
        'Never substitute raw Junction artifacts for canonical history',
      )
      expect(prompt).not.toContain('82.5')
      expect(prompt).not.toContain('121')
      expect(prompt).not.toContain('79')
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
    { metric: 'bmi', unit: 'kg/m2', value: 21.7 },
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
      } finally {
        await rm(parentRoot, {
          force: true,
          recursive: true,
        })
      }
    },
  )

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

  it('rebuilds snapshots written with the previous schema version', async () => {
    const { parentRoot, vaultRoot } = await createDeviceMeasurementVault()

    try {
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
      await expect(readAssistantContextSnapshotPrompt({ vaultRoot }))
        .resolves.toContain('Body/scale measurement history is present')
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
})
