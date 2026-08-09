import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  addMeasurement,
  initializeVault,
} from '@murphai/core'
import { describe, expect, it } from 'vitest'

import {
  isAssistantContextSnapshotRefreshPending,
  markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotPrompt,
  refreshAssistantContextSnapshot,
} from '../src/assistant-context-snapshot.js'
import {
  refreshAssistantContextSnapshot as refreshCoreAssistantContextSnapshot,
} from '../src/assistant/context-snapshot.js'

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
      expect(prompt).toContain(
        'Canonical health-measurement availability for navigation only:',
      )
      expect(prompt).toContain('Body/scale measurement history is available')
      expect(prompt).toContain(
        'vault-cli wearables body list --limit 30 --format json',
      )
      expect(prompt).toContain('Blood-pressure measurement history is available')
      expect(prompt).toContain(
        'vault-cli measurement list --from 2026-08-08 --limit 100 --format json',
      )
      expect(prompt).toContain('systolic-blood-pressure')
      expect(prompt).toContain('diastolic-blood-pressure')
      expect(prompt).toContain('latest canonical reading 2026-08-08')
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

  it('migrates completed snapshots that predate device-availability caching', async () => {
    const { parentRoot, vaultRoot } = await createDeviceMeasurementVault()

    try {
      await refreshCoreAssistantContextSnapshot({
        now: () => '2026-08-08T12:05:00.000Z',
        vaultRoot,
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
        .resolves.toContain('Body/scale measurement history is available')
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
