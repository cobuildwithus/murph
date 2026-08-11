import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { afterEach, expect, it, vi } from 'vitest'

import { createDeferred } from './test-helpers.js'

const coreMocks = vi.hoisted(() => ({
  readCanonicalEventAvailabilityInterruptible: vi.fn(),
}))

vi.mock('@murphai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@murphai/core')>()
  return {
    ...actual,
    readCanonicalEventAvailabilityInterruptible:
      coreMocks.readCanonicalEventAvailabilityInterruptible,
  }
})

import {
  markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotPrompt,
  readAssistantContextSnapshotState,
  refreshAssistantContextSnapshot,
} from '../src/assistant-context-snapshot.js'

const tempRoots: string[] = []

afterEach(async () => {
  coreMocks.readCanonicalEventAvailabilityInterruptible.mockReset()
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ))
})

it('keeps a newer dirty sequence pending when an older refresh succeeds', async () => {
  const parentRoot = await mkdtemp(
    path.join(tmpdir(), 'assistant-context-dirty-race-'),
  )
  tempRoots.push(parentRoot)
  const vaultRoot = path.join(parentRoot, 'vault')
  await initializeVault({
    createdAt: '2026-08-09T00:00:00.000Z',
    vaultRoot,
  })
  await markAssistantContextSnapshotDirty({
    domains: ['blood_tests'],
    vaultRoot,
  })
  const startedState = await readAssistantContextSnapshotState(vaultRoot)
  const startedDirtySequence = startedState?.dirtySequence ?? 0
  const scanStarted = createDeferred<void>()
  const releaseScan = createDeferred<void>()

  coreMocks.readCanonicalEventAvailabilityInterruptible.mockImplementationOnce(
    async () => {
      scanStarted.resolve()
      await releaseScan.promise
      return emptyAvailability()
    },
  )
  const firstRefresh = refreshAssistantContextSnapshot({
    now: () => '2026-08-09T01:00:00.000Z',
    vaultRoot,
  })
  await scanStarted.promise
  await markAssistantContextSnapshotDirty({
    domains: ['blood_tests'],
    vaultRoot,
  })
  releaseScan.resolve()

  await expect(firstRefresh).resolves.toMatchObject({
    pendingDirtyDomains: ['blood_tests'],
    refreshed: true,
    skipped: false,
  })
  await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
    dirtySequence: startedDirtySequence + 1,
    lastCompleted: {
      sourceDirtySequence: startedDirtySequence,
    },
    pendingDirtyDomains: ['blood_tests'],
  })

  coreMocks.readCanonicalEventAvailabilityInterruptible.mockResolvedValueOnce({
    ...emptyAvailability(),
    latestBodyMeasurementDayKey: '2026-08-09',
    latestBodyMeasurementOccurredAt: '2026-08-09T12:00:00.000Z',
  })
  await expect(refreshAssistantContextSnapshot({
    now: () => '2026-08-09T01:01:00.000Z',
    vaultRoot,
  })).resolves.toMatchObject({
    pendingDirtyDomains: [],
    refreshed: true,
    skipped: false,
  })
  await expect(readAssistantContextSnapshotPrompt({ vaultRoot }))
    .resolves.toContain('Body/scale measurement history is present')
  await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
    dirtySequence: startedDirtySequence + 1,
    lastCompleted: {
      sourceDirtySequence: startedDirtySequence + 1,
    },
    pendingDirtyDomains: [],
  })
})

function emptyAvailability() {
  return {
    interrupted: false,
    latestBloodPressureMeasurementDayKey: null,
    latestBloodPressureMeasurementOccurredAt: null,
    latestBloodTestOccurredAt: null,
    latestBodyMeasurementDayKey: null,
    latestBodyMeasurementOccurredAt: null,
  }
}
