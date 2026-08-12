import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as coreRuntime from '@murphai/core'
import { importDeviceProviderSnapshot } from '@murphai/importers'
import {
  buildPersonalPatternReportRuntime,
  listCanonicalEntities,
  rebuildQueryProjection,
} from '@murphai/query'
import { expect, test } from 'vitest'

const SENSITIVE_NOTE_VALUE = 'SENSITIVE_VALUE_SENTINEL'

test('replayed Oura tags reach Personal Patterns without retaining note text', async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), 'junction-oura-tags-patterns-'))
  const vaultRoot = path.join(parentRoot, 'vault')
  const start = '2026-01-05'
  const saunaDates = Array.from({ length: 8 }, (_, index) => addDays(start, index * 14))
  const snapshot = {
    importedAt: '2026-04-28T12:00:00.000Z',
    summaries: {
      sleep: Array.from({ length: 112 }, (_, index) => {
        const date = addDays(start, index)
        const followsSauna = saunaDates.includes(addDays(date, -1))
        return {
          average_hrv: followsSauna ? 70 : 50,
          bedtime_start: `${date}T00:00:00.000Z`,
          bedtime_stop: `${date}T08:00:00.000Z`,
          calendar_date: date,
          duration: 28_800,
          id: `sleep-${date}`,
          recovery_readiness_score: followsSauna ? 90 : 70,
          score: followsSauna ? 92 : 78,
          sourceProviderSlug: 'oura',
          sourceType: 'ring',
          total: 25_200,
        }
      }),
    },
    timeseries: {
      note: saunaDates.map((date, index) => ({
        end: `${date}T18:10:00.000Z`,
        sourceProviderSlug: 'oura',
        sourceType: 'ring',
        start: `${date}T18:05:00.000Z`,
        tags: index === 0 ? ['sauna', 'late meal'] : ['sauna'],
        value: SENSITIVE_NOTE_VALUE,
      })),
    },
  }

  try {
    await coreRuntime.initializeVault({
      createdAt: '2026-01-01T00:00:00.000Z',
      timezone: 'UTC',
      vaultRoot,
    })

    for (let replay = 0; replay < 2; replay += 1) {
      await importDeviceProviderSnapshot(
        {
          deliveryMode: 'scheduled_reconcile',
          provider: 'junction',
          snapshot,
          sourceKind: 'poll',
          vaultRoot,
        },
        { corePort: coreRuntime },
      )
    }

    await rebuildQueryProjection(vaultRoot)
    const canonicalEvents = await listCanonicalEntities(vaultRoot, {
      family: 'event',
      kinds: ['intervention_session'],
      limit: null,
    })
    const tagEvents = canonicalEvents.filter((entity) =>
      entity.attributes.interventionType === 'sauna'
        || entity.attributes.interventionType === 'late-meal')

    expect(canonicalEvents, 'persisted intervention sessions').not.toHaveLength(0)
    expect(tagEvents).toHaveLength(9)
    expect(tagEvents.filter((entity) => entity.attributes.interventionType === 'sauna'))
      .toHaveLength(8)
    expect(tagEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        attributes: expect.objectContaining({
          interventionType: 'late-meal',
          sessionStatus: 'completed',
        }),
        date: '2026-01-05',
      }),
    ]))

    const report = await buildPersonalPatternReportRuntime(vaultRoot, {
      asOf: '2026-04-27T12:00:00.000Z',
    })
    expect(report.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sauna' }),
    ]))
    expect(report.cells.some((cell) =>
      cell.factorId === 'sauna' && cell.stage === 'seen_again'
    )).toBe(true)

    await expect(directoryContainsText(vaultRoot, SENSITIVE_NOTE_VALUE))
      .resolves.toBe(false)
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

async function directoryContainsText(root: string, expected: string): Promise<boolean> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (await directoryContainsText(absolutePath, expected)) return true
      continue
    }
    if (entry.isFile() && (await readFile(absolutePath)).includes(expected)) return true
  }
  return false
}
